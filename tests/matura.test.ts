import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import * as t from '../src/lib/server/db/schema';
import { defaultCalendar, deleteEvent, eventsBetween, updateEvent } from '../src/lib/server/calendar';
import { syncAll } from '../src/lib/server/icloud/sync';
import { ensureMatura } from '../src/lib/server/matura';
import { fmtTime, localDate } from '../src/lib/format';
import { testDb } from './db';
import { FakeCalDav } from './fake-caldav';

test('Matura-Termine im Kalender „Matura“, MedAT im Standardkalender', async () => {
	const { db } = await testDb();
	await ensureMatura(db);
	const cals = await db.select().from(t.calendars);
	const name = (id: number) => cals.find((c) => c.id === id)!.name;
	const standard = await defaultCalendar(db);

	const list = (await eventsBetween(db, '2027-05-01', '2027-08-01')).map((e) => [
		name(e.calendarId),
		e.title,
		e.allDay ? `${localDate(e.start)} bis ${localDate(new Date(e.end.getTime() - 1))}` : `${localDate(e.start)} ${fmtTime(e.start)}–${fmtTime(e.end)}`
	]);
	expect(list).toEqual([
		['Matura', 'Matura schriftlich: Deutsch', '2027-05-05 08:30–13:30'],
		['Matura', 'Matura schriftlich: Angewandte Mathematik', '2027-05-10 08:30–13:00'],
		['Matura', 'Matura schriftlich: Englisch', '2027-05-11 08:30–13:30'],
		['Matura', 'Fachklausur Medientechnik + Web- & Applikationsentwicklung', '2027-05-13 bis 2027-05-13'],
		['Matura', 'Diplomarbeit: Präsentation', '2027-05-25 bis 2027-05-26'],
		['Matura', 'Matura mündlich', '2027-06-14 bis 2027-06-18'],
		[standard.name, 'MedAT', '2027-07-09 bis 2027-07-09']
	]);
	expect(await eventsBetween(db, '2026-11-01', '2027-05-01')).toEqual([]);
});

test('nur einmal: geänderte und gelöschte Termine bleiben beim nächsten Start, wie sie sind', async () => {
	const { db } = await testDb();
	await ensureMatura(db);
	const [da] = await db.select().from(t.events).where(eq(t.events.managedKey, 'matura:da-praesentation'));
	const [medat] = await db.select().from(t.events).where(eq(t.events.managedKey, 'medat'));
	// Platzhalter durch den echten Termin ersetzen, MedAT löschen
	await updateEvent(db, da.id, {
		title: 'Diplomarbeit: Präsentation',
		start: new Date('2027-05-25T07:00:00Z'),
		end: new Date('2027-05-25T08:00:00Z'),
		allDay: false,
		location: 'Festsaal',
		notes: null,
		calendarId: null,
		repeat: 'none',
		until: null
	});
	await deleteEvent(db, medat.id);

	await ensureMatura(db);
	const rows = await db.select().from(t.events);
	expect(rows).toHaveLength(6);
	expect(rows.find((e) => e.id === da.id)).toMatchObject({ allDay: false, location: 'Festsaal' });
});

test('mit iCloud: Kalender „Matura“ wird angelegt, MedAT landet im Standardkalender des iPhones', async () => {
	const { db } = await testDb();
	const dav = new FakeCalDav();
	dav.addCalendar('Prüfung');
	dav.defaultUrl = dav.addCalendar('Privat');
	await ensureMatura(db);

	expect(await syncAll(db, dav)).toMatchObject({ pushed: 7, errors: [] });
	expect(dav.calls.filter((c) => c.startsWith('mkcalendar'))).toEqual(['mkcalendar Matura']);
	expect(dav.titles('Matura')).toHaveLength(6);
	expect(dav.titles('Privat')).toEqual(['MedAT']);
	expect(dav.titles('Prüfung')).toEqual([]);
	const ics = [...dav.cals.get('/1/calendars/matura/')!.objects.values()].map((o) => o.data).join('\n');
	expect(ics).toContain('DTSTART;TZID=Europe/Vienna:20270505T083000');
	// Mehrtägig ganztägig: Ende ist der Tag danach
	expect(ics).toContain('DTSTART;VALUE=DATE:20270614');
	expect(ics).toContain('DTEND;VALUE=DATE:20270619');
});
