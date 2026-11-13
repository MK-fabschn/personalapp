import { eq, like } from 'drizzle-orm';
import { expect, test } from 'vitest';
import * as t from '../src/lib/server/db/schema';
import { addFreeDay, deleteEvent, eventsBetween, listFreeDays, skipEventOccurrence, updateEvent } from '../src/lib/server/calendar';
import { syncAll } from '../src/lib/server/icloud/sync';
import { defaultSchoolSettings, ensureSchool, getSchoolSettings, refreshSchool, saveSchoolSettings, validateSchoolSettings } from '../src/lib/server/school';
import { fmtTime, localDate } from '../src/lib/format';
import { testDb } from './db';
import { FakeCalDav } from './fake-caldav';

// Sa 14.11.2026 → erste Schulwoche ab Mo 16.11.
const settings = () => defaultSchoolSettings('2026-11-14');
const day = async (db: Parameters<typeof eventsBetween>[0], iso: string) =>
	(await eventsBetween(db, iso, localDate(new Date(Date.parse(iso + 'T12:00:00Z') + 86400000)))).map((e) => `${fmtTime(e.start)}–${fmtTime(e.end)} ${e.title}`);

test('Zeiten laut Karte: Block und Schulwege für jeden Wochentag', async () => {
	const { db } = await testDb();
	expect(await saveSchoolSettings(db, settings())).toBe(true);

	expect(await day(db, '2026-11-16')).toEqual(['06:15–08:00 Schulweg', '08:00–16:00 Schule', '16:00–18:15 Schulweg']); // Mo
	expect(await day(db, '2026-11-17')).toEqual(['06:15–08:00 Schulweg', '08:00–16:50 Schule', '16:50–19:15 Schulweg']); // Di
	for (const d of ['2026-11-18', '2026-11-19', '2026-11-20']) {
		expect(await day(db, d)).toEqual(['06:15–08:00 Schulweg', '08:00–13:10 Schule', '13:10–15:15 Schulweg']); // Mi–Fr
	}
	expect(await day(db, '2026-11-21')).toEqual([]); // Samstag
	expect(await day(db, '2026-11-13')).toEqual([]); // vor dem Start

	const rows = await db.select().from(t.events);
	expect(rows).toHaveLength(15);
	const [schule] = await db.select().from(t.calendars).where(eq(t.calendars.name, 'Schule'));
	expect(rows.every((e) => e.calendarId === schule.id && e.recurring && e.managedKey?.startsWith('schule:'))).toBe(true);
});

test('Serien enden am letzten Unterrichtstag, Uhrzeit bleibt über die Zeitumstellung gleich', async () => {
	const { db } = await testDb();
	await saveSchoolSettings(db, settings());
	expect(await day(db, '2027-03-30')).toEqual(['06:15–08:00 Schulweg', '08:00–16:50 Schule', '16:50–19:15 Schulweg']); // Di nach der Umstellung
	expect(await day(db, '2027-04-30')).toHaveLength(3); // Fr, letzter Unterrichtstag
	expect(await day(db, '2027-05-03')).toEqual([]);
	expect(await eventsBetween(db, '2027-05-01', '2027-07-31')).toEqual([]);
});

test('erster Start: schulfreie Tage aus der Recherche, an denen Block und Schulweg entfallen', async () => {
	const { db } = await testDb();
	await ensureSchool(db);
	expect((await listFreeDays(db)).map((f) => f.label)).toEqual(['Mariä Empfängnis', 'Weihnachtsferien', 'Semesterferien', 'Josefitag', 'Osterferien']);

	expect(await day(db, '2026-12-07')).toHaveLength(3); // Mo, Schule
	expect(await day(db, '2026-12-08')).toEqual([]); // Di, Mariä Empfängnis
	expect(await day(db, '2026-12-23')).toHaveLength(3); // Mi vor Weihnachten: Schultag
	for (const d of ['2026-12-24', '2026-12-31', '2027-01-06', '2027-02-08', '2027-02-12', '2027-03-19', '2027-03-22', '2027-03-29']) {
		expect(await day(db, d), d).toEqual([]);
	}
	expect(await day(db, '2027-01-07')).toHaveLength(3); // Do nach den Ferien
	expect(await day(db, '2027-03-30')).toHaveLength(3); // Di nach Ostern
});

test('neuer Start ändert nichts und trägt gelöschte schulfreie Tage nicht wieder ein', async () => {
	const { db } = await testDb();
	await ensureSchool(db);
	const [josefi] = (await listFreeDays(db)).filter((f) => f.label === 'Josefitag');
	await db.delete(t.schoolFreeDays).where(eq(t.schoolFreeDays.id, josefi.id));
	await db.update(t.events).set({ syncState: 'synced' });

	await ensureSchool(db);
	expect((await listFreeDays(db)).map((f) => f.label)).not.toContain('Josefitag');
	// Nur die Freitags-Serien (Josefitag war ein Freitag) wurden angefasst
	const dirty = await db.select().from(t.events).where(eq(t.events.syncState, 'dirty'));
	expect(dirty.map((e) => e.managedKey).sort()).toEqual(['schule:block:5', 'schule:hin:5', 'schule:rueck:5']);
	expect(await day(db, '2027-03-19')).toHaveLength(3);

	await db.update(t.events).set({ syncState: 'synced' });
	await ensureSchool(db);
	expect(await db.select().from(t.events).where(eq(t.events.syncState, 'dirty'))).toEqual([]);
});

test('schulfreien Tag nachtragen (z. B. schulautonomer Tag)', async () => {
	const { db } = await testDb();
	await ensureSchool(db);
	await addFreeDay(db, '2026-12-07', '2026-12-07', 'Schulautonom');
	expect(await refreshSchool(db)).toBe(true);
	expect(await day(db, '2026-12-07')).toEqual([]);
	expect(await day(db, '2026-12-14')).toHaveLength(3);
});

test('Zeiten eines Wochentags und letzten Unterrichtstag ändern', async () => {
	const { db } = await testDb();
	await ensureSchool(db);
	const s = (await getSchoolSettings(db))!;
	s.days[2] = { leave: '06:45', start: '08:50', end: '14:05', home: '16:15' };
	s.lastDay = '2027-04-23';
	expect(await saveSchoolSettings(db, s)).toBe(true);

	expect(await day(db, '2026-11-18')).toEqual(['06:45–08:50 Schulweg', '08:50–14:05 Schule', '14:05–16:15 Schulweg']);
	expect(await day(db, '2026-11-19')).toEqual(['06:15–08:00 Schulweg', '08:00–13:10 Schule', '13:10–15:15 Schulweg']);
	expect(await day(db, '2026-12-23')).toHaveLength(3); // Mittwoch, weiterhin Schultag
	expect(await day(db, '2027-01-06')).toEqual([]); // Mittwoch in den Ferien bleibt frei
	expect(await day(db, '2027-04-23')).toHaveLength(3);
	expect(await day(db, '2027-04-26')).toEqual([]);
	expect(await db.select().from(t.events)).toHaveLength(15); // geändert, nicht neu angelegt
});

test('Eingabeprüfung der Zeiten', () => {
	const s = settings();
	expect(validateSchoolSettings(s)).toEqual({ ok: true, value: s });
	expect(validateSchoolSettings({ ...s, days: s.days.map((d, i) => (i === 1 ? { ...d, end: '07:00' } : d)) })).toEqual({
		ok: false,
		error: 'Dienstag: Die Zeiten müssen aufsteigend sein (Abfahrt, Schulbeginn, Schulschluss, Ankunft daheim).'
	});
	expect(validateSchoolSettings({ ...s, days: s.days.map((d, i) => (i === 4 ? { ...d, home: '' } : d)) })).toMatchObject({ ok: false, error: 'Freitag: Bitte alle vier Uhrzeiten angeben.' });
	expect(validateSchoolSettings({ ...s, lastDay: '' })).toMatchObject({ ok: false });
});

test('Schul-Termine lassen sich im Kalender nicht einzeln ändern oder löschen', async () => {
	const { db } = await testDb();
	await saveSchoolSettings(db, settings());
	const [e] = await db.select().from(t.events).where(eq(t.events.managedKey, 'schule:block:1'));
	const input = { title: 'x', start: e.start, end: e.end, allDay: false, location: null, notes: null, calendarId: null, repeat: 'keep' as const, until: null };
	await expect(updateEvent(db, e.id, input)).rejects.toThrow('Kalender-Einstellungen');
	await expect(deleteEvent(db, e.id)).rejects.toThrow('Kalender-Einstellungen');
	await expect(skipEventOccurrence(db, e.id, e.start)).rejects.toThrow('Kalender-Einstellungen');
});

test('mit iCloud: Serien landen im vorhandenen Kalender „Schule“, schulfreie Tage als Ausnahmen', async () => {
	const { db } = await testDb();
	const dav = new FakeCalDav();
	dav.defaultUrl = dav.addCalendar('Privat');
	dav.addCalendar('Schule', { color: '#ff9500' });
	dav.phonePut('Schule', { uid: 'S1', title: 'Schularbeit Mathe' });
	await ensureSchool(db);

	expect(await syncAll(db, dav)).toMatchObject({ pushed: 15, pulled: 1, errors: [] });
	expect([...dav.cals.values()].map((c) => c.name).sort()).toEqual(['Privat', 'Schule']); // kein zweiter „Schule“
	expect(dav.titles('Schule')).toHaveLength(16);
	const [di] = await db.select().from(t.events).where(eq(t.events.managedKey, 'schule:block:2'));
	const ics = dav.object('Schule', di.caldavUid)!.data;
	expect(ics).toContain('DTSTART;TZID=Europe/Vienna:20261117T080000');
	expect(ics).toContain('DTEND;TZID=Europe/Vienna:20261117T165000');
	expect(ics).toContain('RRULE:FREQ=WEEKLY;UNTIL=20270430T215959Z');
	expect(ics).toContain('EXDATE;TZID=Europe/Vienna:20261208T080000');

	// Neustart ohne Änderung überträgt nichts erneut
	await ensureSchool(db);
	expect(await syncAll(db, dav)).toMatchObject({ pushed: 0 });
	expect(await db.select().from(t.events).where(like(t.events.managedKey, 'schule:%'))).toHaveLength(15);
});
