import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import * as t from '../src/lib/server/db/schema';
import {
	CalendarError,
	addFreeDay,
	createEvent,
	defaultCalendar,
	deleteEvent,
	ensureCalendar,
	eventsBetween,
	freeDaysBetween,
	setDefaultCalendar,
	skipEventOccurrence,
	updateEvent,
	type EventWrite
} from '../src/lib/server/calendar';
import { testDb } from './db';

const probe: EventWrite = {
	title: 'Probe',
	start: new Date('2026-11-20T17:00:00Z'), // Fr 18:00 Wien
	end: new Date('2026-11-20T18:30:00Z'),
	allDay: false,
	location: null,
	notes: null,
	calendarId: null,
	repeat: 'none',
	until: null
};
const titles = (list: { title: string; start: Date }[]) => list.map((e) => `${e.start.toISOString().slice(0, 16)} ${e.title}`);

test('Migration: bestehende Termine kommen in den Standardkalender und bekommen eine UID', async () => {
	const { pg, db, migrateRest } = await testDb({ upTo: '0001' });
	await pg.exec(`insert into events (title, start, "end") values ('Alt', '2026-11-20T17:00:00Z', '2026-11-20T18:00:00Z')`);
	await migrateRest();

	const cal = await defaultCalendar(db);
	expect(cal).toMatchObject({ name: 'Kalender', isDefault: true, visible: true });
	const [e] = await db.select().from(t.events);
	expect(e).toMatchObject({ title: 'Alt', calendarId: cal.id, recurring: false, syncState: 'dirty' });
	expect(e.caldavUid).toMatch(/^[0-9a-f-]{36}$/);
	// Alte Termine ohne iCalendar-Objekt werden trotzdem angezeigt
	expect(titles(await eventsBetween(db, '2026-11-20', '2026-11-21'))).toEqual(['2026-11-20T17:00 Alt']);
});

test('neuer Termin ohne Auswahl landet im Standardkalender und wartet auf den Sync', async () => {
	const { db } = await testDb();
	const matura = await ensureCalendar(db, 'Matura', '#ef4444');
	await setDefaultCalendar(db, matura.id);
	const id = await createEvent(db, probe);
	const [e] = await db.select().from(t.events).where(eq(t.events.id, id));
	expect(e).toMatchObject({ calendarId: matura.id, syncState: 'dirty', recurring: false });
	expect(e.icalRaw).toContain(`UID:${e.caldavUid}`);
	expect((await db.select().from(t.calendars).where(eq(t.calendars.isDefault, true))).map((c) => c.name)).toEqual(['Matura']);
});

test('Wochenansicht: Serie wird aufgelöst, ausgeblendete Kalender fehlen, Farbe kommt vom Kalender', async () => {
	const { db } = await testDb();
	const schule = await ensureCalendar(db, 'Schule', '#f97316');
	const versteckt = await ensureCalendar(db, 'Versteckt', '#000000');
	await db.update(t.calendars).set({ visible: false }).where(eq(t.calendars.id, versteckt.id));

	await createEvent(db, probe);
	await createEvent(db, { ...probe, title: 'Geheim', calendarId: versteckt.id });
	// Mo–So 16.–22.11.2026: Schul-Block montags 08:00–16:00 bis 30.11.
	const serie = await createEvent(db, {
		...probe,
		title: 'Schule',
		calendarId: schule.id,
		start: new Date('2026-11-16T07:00:00Z'),
		end: new Date('2026-11-16T15:00:00Z'),
		repeat: 'weekly',
		until: '2026-11-30'
	});

	const woche = await eventsBetween(db, '2026-11-16', '2026-11-23');
	expect(titles(woche)).toEqual(['2026-11-16T07:00 Schule', '2026-11-20T17:00 Probe']);
	expect(woche[0]).toMatchObject({ id: serie, color: '#f97316', recurring: true, repeat: 'weekly', until: '2026-11-30', readOnly: false });

	const alles = await eventsBetween(db, '2026-11-01', '2027-01-01');
	expect(titles(alles.filter((e) => e.id === serie))).toEqual(['2026-11-16T07:00 Schule', '2026-11-23T07:00 Schule', '2026-11-30T07:00 Schule']);
	expect(new Set(alles.map((e) => e.key)).size).toBe(alles.length);
	// Serie ist vorbei → taucht später nicht mehr auf
	expect(await eventsBetween(db, '2026-12-01', '2026-12-31')).toEqual([]);
});

test('einzelnen Termin einer Serie auslassen', async () => {
	const { db } = await testDb();
	const id = await createEvent(db, { ...probe, repeat: 'weekly', until: '2026-12-04' });
	await skipEventOccurrence(db, id, new Date('2026-11-27T17:00:00Z'));
	expect(titles(await eventsBetween(db, '2026-11-01', '2027-01-01'))).toEqual(['2026-11-20T17:00 Probe', '2026-12-04T17:00 Probe']);
	await expect(skipEventOccurrence(db, await createEvent(db, probe), probe.start)).rejects.toThrow(CalendarError);
});

test('Bearbeiten: Felder, Serie beenden, Kalender wechseln', async () => {
	const { db } = await testDb();
	const musik = await ensureCalendar(db, 'Musik', '#a855f7');
	const id = await createEvent(db, { ...probe, repeat: 'weekly', until: null });

	await updateEvent(db, id, { ...probe, title: 'Orchester', location: 'Musikheim', calendarId: musik.id, repeat: 'none' });
	const [e] = await db.select().from(t.events).where(eq(t.events.id, id));
	expect(e).toMatchObject({ title: 'Orchester', location: 'Musikheim', calendarId: musik.id, recurring: false, syncState: 'dirty' });
	expect(titles(await eventsBetween(db, '2026-11-01', '2027-01-01'))).toEqual(['2026-11-20T17:00 Orchester']);
});

test('übertragener Termin: Löschen und Kalenderwechsel hinterlassen einen Löschauftrag für iCloud', async () => {
	const { db } = await testDb();
	const musik = await ensureCalendar(db, 'Musik', '#a855f7');
	const synced = { caldavHref: '/123/calendars/home/a.ics', caldavEtag: '"e1"', syncState: 'synced' };

	const a = await createEvent(db, probe);
	await db.update(t.events).set(synced).where(eq(t.events.id, a));
	await deleteEvent(db, a);
	expect(await db.select().from(t.events)).toMatchObject([{ id: a, syncState: 'deleted', caldavHref: '/123/calendars/home/a.ics' }]);
	expect(await eventsBetween(db, '2026-11-01', '2027-01-01')).toEqual([]);

	// noch nie übertragen → einfach weg
	const b = await createEvent(db, probe);
	await deleteEvent(db, b);
	expect(await db.select().from(t.events)).toHaveLength(1);

	const c = await createEvent(db, probe);
	await db.update(t.events).set({ ...synced, caldavHref: '/123/calendars/home/c.ics' }).where(eq(t.events.id, c));
	const standard = await defaultCalendar(db);
	await updateEvent(db, c, { ...probe, calendarId: musik.id });
	const rows = await db.select().from(t.events).orderBy(t.events.id);
	expect(rows.at(-2)).toMatchObject({ id: c, calendarId: musik.id, caldavHref: null, caldavEtag: null, syncState: 'dirty' });
	expect(rows.at(-1)).toMatchObject({ calendarId: standard.id, caldavHref: '/123/calendars/home/c.ics', caldavEtag: '"e1"', syncState: 'deleted' });
});

test('freigegebener Kalender ist nur lesbar', async () => {
	const { db } = await testDb();
	const [geteilt] = await db.insert(t.calendars).values({ name: 'Familie', readOnly: true }).returning();
	await expect(createEvent(db, { ...probe, calendarId: geteilt.id })).rejects.toThrow('nur lesbar');
	await expect(setDefaultCalendar(db, geteilt.id)).rejects.toThrow(CalendarError);

	const [fremd] = await db
		.insert(t.events)
		.values({ calendarId: geteilt.id, title: 'Fremd', start: probe.start, end: probe.end, caldavUid: 'fremd-1', syncState: 'synced' })
		.returning();
	await expect(updateEvent(db, fremd.id, probe)).rejects.toThrow('nur lesbar');
	await expect(deleteEvent(db, fremd.id)).rejects.toThrow('nur lesbar');
	expect((await eventsBetween(db, '2026-11-20', '2026-11-21'))[0]).toMatchObject({ title: 'Fremd', readOnly: true });
});

test('schulfreie Tage im Zeitraum', async () => {
	const { db } = await testDb();
	await addFreeDay(db, '2026-12-24', '2027-01-06', 'Weihnachtsferien');
	await addFreeDay(db, '2026-12-08', '2026-12-08', 'Mariä Empfängnis');
	expect((await freeDaysBetween(db, '2026-12-07', '2026-12-14')).map((f) => f.label)).toEqual(['Mariä Empfängnis']);
	expect((await freeDaysBetween(db, '2027-01-04', '2027-01-11')).map((f) => f.label)).toEqual(['Weihnachtsferien']);
	expect(await freeDaysBetween(db, '2027-01-07', '2027-01-14')).toEqual([]);
	await expect(addFreeDay(db, '2027-02-13', '2027-02-08', 'verkehrt')).rejects.toThrow(CalendarError);
});
