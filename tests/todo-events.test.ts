import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import * as t from '../src/lib/server/db/schema';
import { eventsBetween } from '../src/lib/server/calendar';
import { syncAll } from '../src/lib/server/icloud/sync';
import { parseIcs } from '../src/lib/server/ics';
import { ensureTodoEvents, mirrorTodo } from '../src/lib/server/todo-events';
import { testDb } from './db';
import { FakeCalDav } from './fake-caldav';

async function setup() {
	const { db } = await testDb();
	const dav = new FakeCalDav();
	dav.defaultUrl = dav.addCalendar('Privat');
	const add = async (values: { title: string; dueDate?: string | null; notes?: string }) =>
		(await db.insert(t.todos).values(values).returning())[0].id;
	const phone = async () => {
		const report = await syncAll(db, dav);
		expect(report.errors).toEqual([]);
		const cal = [...dav.cals.values()].find((c) => c.name === 'To-Dos');
		return cal ? [...cal.objects.values()].map((o) => parseIcs(o.data)!).map((e) => `${e.start.toISOString().slice(0, 10)} ${e.title}`).sort() : null;
	};
	return { db, dav, add, phone };
}

test('To-Do mit Fälligkeit wird ein ganztägiger Termin im Kalender „To-Dos“', async () => {
	const { db, dav, add, phone } = await setup();
	const id = await add({ title: 'Referat abgeben', dueDate: '2026-11-20', notes: 'per Moodle' });
	await add({ title: 'Irgendwann', dueDate: null });
	expect(await mirrorTodo(db, id)).toBe(true);

	// Wiener Tag 20.11. beginnt um 23:00 UTC am Vortag
	expect(await phone()).toEqual(['2026-11-19 Referat abgeben']);
	const [obj] = [...[...dav.cals.values()].find((c) => c.name === 'To-Dos')!.objects.values()];
	expect(obj.data).toContain('DTSTART;VALUE=DATE:20261120');
	expect(obj.data).toContain('DTEND;VALUE=DATE:20261121');
	expect(parseIcs(obj.data)).toMatchObject({ allDay: true, notes: 'per Moodle' });
	// Unverändert → nichts zu tun
	expect(await mirrorTodo(db, id)).toBe(false);
});

test('Ändern, Abhaken, wieder Öffnen und Löschen wirken auf den Termin', async () => {
	const { db, add, phone } = await setup();
	const id = await add({ title: 'Lernen', dueDate: '2026-11-20' });
	await mirrorTodo(db, id);
	await phone();

	await db.update(t.todos).set({ title: 'Mathe lernen', dueDate: '2026-11-23' }).where(eq(t.todos.id, id));
	expect(await mirrorTodo(db, id)).toBe(true);
	expect(await phone()).toEqual(['2026-11-22 Mathe lernen']);

	await db.update(t.todos).set({ done: true }).where(eq(t.todos.id, id));
	expect(await mirrorTodo(db, id)).toBe(true);
	expect(await phone()).toEqual([]);

	await db.update(t.todos).set({ done: false }).where(eq(t.todos.id, id));
	await mirrorTodo(db, id);
	expect(await phone()).toEqual(['2026-11-22 Mathe lernen']);

	await db.update(t.todos).set({ dueDate: null }).where(eq(t.todos.id, id));
	await mirrorTodo(db, id);
	expect(await phone()).toEqual([]);

	await db.update(t.todos).set({ dueDate: '2026-11-25' }).where(eq(t.todos.id, id));
	await mirrorTodo(db, id);
	await db.delete(t.todos).where(eq(t.todos.id, id));
	expect(await mirrorTodo(db, id)).toBe(true);
	expect(await phone()).toEqual([]);
	expect(await db.select().from(t.events)).toEqual([]);
});

test('im Kalender der App erscheinen To-Do-Termine nicht (dort stehen die To-Dos schon)', async () => {
	const { db, add } = await setup();
	await mirrorTodo(db, await add({ title: 'Lernen', dueDate: '2026-11-20' }));
	expect(await db.select().from(t.events)).toHaveLength(1);
	expect(await eventsBetween(db, '2026-11-01', '2026-12-01')).toEqual([]);
});

test('Serverstart: gleicht vorhandene To-Dos ab und räumt verwaiste Termine weg', async () => {
	const { db, add, phone } = await setup();
	const a = await add({ title: 'A', dueDate: '2026-11-20' });
	await add({ title: 'B', dueDate: '2026-11-21' });
	await ensureTodoEvents(db);
	expect(await phone()).toEqual(['2026-11-19 A', '2026-11-20 B']);

	// A wird gelöscht, ohne dass der Termin mitgezogen wurde
	await db.delete(t.todos).where(eq(t.todos.id, a));
	await ensureTodoEvents(db);
	expect(await phone()).toEqual(['2026-11-20 B']);

	// Ein weiterer Start ändert nichts mehr
	await ensureTodoEvents(db);
	expect(await db.select().from(t.events).where(eq(t.events.syncState, 'dirty'))).toEqual([]);
});
