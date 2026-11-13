import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as t from '../src/lib/server/db/schema';
import { createEvent, deleteEvent, ensureCalendar, eventsBetween, updateEvent, type EventWrite } from '../src/lib/server/calendar';
import { AuthError } from '../src/lib/server/icloud/caldav';
import { hasPending, syncAll } from '../src/lib/server/icloud/sync';
import { parseIcs, skipOccurrence } from '../src/lib/server/ics';
import { testDb } from './db';
import { FakeCalDav } from './fake-caldav';

const probe: EventWrite = {
	title: 'Probe',
	start: new Date('2026-11-20T17:00:00Z'),
	end: new Date('2026-11-20T18:30:00Z'),
	allDay: false,
	location: null,
	notes: null,
	calendarId: null,
	repeat: 'none',
	until: null
};

// Nur die Uhr wird gestellt (für „letzte Änderung gewinnt“), Timer laufen normal weiter
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime('2026-11-13T10:00:00Z');
});
afterEach(() => vi.useRealTimers());
const later = (minutes: number) => vi.setSystemTime(Date.now() + minutes * 60000);

/** Konto wie das echte: mehrere Kalender, „Feuerwehr“ ist Standard am iPhone, „Schule“ gibt es schon */
async function setup() {
	const { db } = await testDb();
	const dav = new FakeCalDav();
	dav.addCalendar('Privat');
	dav.defaultUrl = dav.addCalendar('Feuerwehr', { color: '#d22d26' });
	dav.addCalendar('Schule', { color: '#ff9500' });
	const calId = async (name: string) => (await db.select().from(t.calendars).where(eq(t.calendars.name, name)))[0]?.id;
	const local = async () =>
		(await db.select().from(t.events).orderBy(t.events.id)).map((e) => `${e.title} [${e.syncState}]`);
	return { db, dav, calId, local };
}

test('erster Abgleich: Kalender zuordnen, vorhandene Termine hochladen, iCloud-Termine übernehmen', async () => {
	const { db, dav } = await setup();
	dav.addCalendar('Familie', { readOnly: true });
	dav.phonePut('Schule', { uid: 'S1', title: 'Schularbeit' });
	dav.phonePut('Familie', { uid: 'F1', title: 'Omas Geburtstag' });
	// Stand vor dem Sync: Platzhalter „Kalender“ mit einem Termin, dazu lokale Kalender „Schule“ und „Matura“
	const schule = await ensureCalendar(db, 'Schule', '#f97316');
	await ensureCalendar(db, 'Matura', '#ef4444');
	await createEvent(db, { ...probe, title: 'Alt' });

	const report = await syncAll(db, dav);
	expect(report).toEqual({ pushed: 1, pulled: 2, deleted: 0, errors: [] });

	const cals = await db.select().from(t.calendars).orderBy(t.calendars.name);
	expect(cals.map((c) => `${c.name}${c.isDefault ? '*' : ''}${c.readOnly ? ' (nur lesbar)' : ''}`)).toEqual([
		'Familie (nur lesbar)',
		'Feuerwehr*',
		'Matura',
		'Privat',
		'Schule'
	]);
	expect(cals.every((c) => c.caldavUrl && c.syncToken)).toBe(true);
	// „Schule“ wurde übernommen statt doppelt angelegt, Farbe kommt aus iCloud; nur „Matura“ war neu
	expect(cals.find((c) => c.name === 'Schule')).toMatchObject({ id: schule.id, color: '#ff9500' });
	expect(dav.calls.filter((c) => c.startsWith('mkcalendar'))).toEqual(['mkcalendar Matura']);
	expect([...dav.cals.values()].map((c) => c.name).sort()).toEqual(['Familie', 'Feuerwehr', 'Matura', 'Privat', 'Schule']);

	// Der alte App-Termin liegt jetzt im Standardkalender des iPhones
	expect(dav.titles('Feuerwehr')).toEqual(['Alt']);
	const events = await db.select().from(t.events).orderBy(t.events.title);
	expect(events.map((e) => [e.title, cals.find((c) => c.id === e.calendarId)!.name, e.syncState])).toEqual([
		['Alt', 'Feuerwehr', 'synced'],
		['Omas Geburtstag', 'Familie', 'synced'],
		['Schularbeit', 'Schule', 'synced']
	]);
	expect(await hasPending(db)).toBe(false);
});

test('ohne Änderungen fragt der nächste Abgleich nur die Kalenderliste ab', async () => {
	const { db, dav } = await setup();
	dav.phonePut('Privat', { uid: 'P1' });
	await syncAll(db, dav);
	await syncAll(db, dav); // gleicht den ctag nach dem eigenen Hochladen an
	dav.calls = [];
	expect(await syncAll(db, dav)).toEqual({ pushed: 0, pulled: 0, deleted: 0, errors: [] });
	expect(dav.calls).toEqual(['list']);
});

test('App → iPhone: anlegen, ändern, löschen', async () => {
	const { db, dav, calId, local } = await setup();
	await syncAll(db, dav);

	const id = await createEvent(db, { ...probe, calendarId: await calId('Privat') });
	expect(await hasPending(db)).toBe(true);
	await syncAll(db, dav);
	expect(dav.titles('Privat')).toEqual(['Probe']);
	const [row] = await db.select().from(t.events);
	expect(row).toMatchObject({ syncState: 'synced', caldavHref: `/1/calendars/privat/${row.caldavUid}.ics` });
	expect(dav.object('Privat', row.caldavUid)!.etag).toBe(row.caldavEtag);

	later(5);
	await updateEvent(db, id, { ...probe, title: 'Orchester', location: 'Musikheim' });
	await syncAll(db, dav);
	expect(parseIcs(dav.object('Privat', row.caldavUid)!.data)).toMatchObject({ title: 'Orchester', location: 'Musikheim' });
	expect(await local()).toEqual(['Orchester [synced]']);

	await deleteEvent(db, id);
	expect(await syncAll(db, dav)).toMatchObject({ deleted: 1, errors: [] });
	expect(dav.titles('Privat')).toEqual([]);
	expect(await local()).toEqual([]);
});

test('iPhone → App: anlegen, ändern, löschen', async () => {
	const { db, dav, local } = await setup();
	await syncAll(db, dav);

	dav.phonePut('Privat', { uid: 'P1', title: 'Zahnarzt' });
	expect(await syncAll(db, dav)).toMatchObject({ pulled: 1 });
	const [first] = await db.select().from(t.events);
	expect(first).toMatchObject({ title: 'Zahnarzt', caldavUid: 'P1', syncState: 'synced' });

	dav.phonePut('Privat', { uid: 'P1', title: 'Zahnarzt (verschoben)', start: new Date('2026-11-21T09:00:00Z'), end: new Date('2026-11-21T10:00:00Z') });
	await syncAll(db, dav);
	const [second] = await db.select().from(t.events);
	expect(second).toMatchObject({ id: first.id, title: 'Zahnarzt (verschoben)', start: new Date('2026-11-21T09:00:00Z') });

	dav.phoneDelete('Privat', 'P1');
	expect(await syncAll(db, dav)).toMatchObject({ deleted: 1 });
	expect(await local()).toEqual([]);
});

test('Konflikt: die letzte Änderung gewinnt', async () => {
	const { db, dav, local } = await setup();
	dav.phonePut('Privat', { uid: 'A', title: 'A' });
	dav.phonePut('Privat', { uid: 'B', title: 'B' });
	await syncAll(db, dav);
	const rows = await db.select().from(t.events).orderBy(t.events.title);

	// A: erst in der App, danach am iPhone geändert → iPhone gewinnt
	later(1);
	await updateEvent(db, rows[0].id, { ...probe, title: 'A aus der App' });
	later(1);
	dav.phonePut('Privat', { uid: 'A', title: 'A vom iPhone' });
	// B: erst am iPhone, danach in der App geändert → App gewinnt
	dav.phonePut('Privat', { uid: 'B', title: 'B vom iPhone' });
	later(1);
	await updateEvent(db, rows[1].id, { ...probe, title: 'B aus der App' });

	const report = await syncAll(db, dav);
	expect(report.errors).toEqual([]);
	expect(dav.titles('Privat')).toEqual(['A vom iPhone', 'B aus der App']);
	expect((await local()).sort()).toEqual(['A vom iPhone [synced]', 'B aus der App [synced]']);
	// Danach ist alles ruhig
	expect(await syncAll(db, dav)).toMatchObject({ pushed: 0, pulled: 0 });
});

test('Löschen wirkt auf beiden Seiten, außer der Termin wurde danach noch geändert', async () => {
	const { db, dav, local } = await setup();
	for (const uid of ['A', 'B', 'C']) dav.phonePut('Privat', { uid, title: uid });
	await syncAll(db, dav);
	const id = async (title: string) => (await db.select().from(t.events).where(eq(t.events.title, title)))[0].id;

	// A: am iPhone geändert, danach in der App gelöscht → gelöscht
	dav.phonePut('Privat', { uid: 'A', title: 'A geändert' });
	later(1);
	await deleteEvent(db, await id('A'));
	// B: in der App gelöscht, danach am iPhone geändert → Änderung gewinnt, Termin bleibt
	await deleteEvent(db, await id('B'));
	later(1);
	dav.phonePut('Privat', { uid: 'B', title: 'B gerettet' });
	// C: am iPhone gelöscht, in der App geändert → gelöscht
	dav.phoneDelete('Privat', 'C');
	await updateEvent(db, await id('C'), { ...probe, title: 'C geändert' });

	const report = await syncAll(db, dav);
	expect(report.errors).toEqual([]);
	expect(dav.titles('Privat')).toEqual(['B gerettet']);
	expect(await local()).toEqual(['B gerettet [synced]']);
});

test('Termin in einen anderen Kalender verschieben (App und iPhone)', async () => {
	const { db, dav, calId } = await setup();
	await syncAll(db, dav);
	const id = await createEvent(db, { ...probe, calendarId: await calId('Privat') });
	await syncAll(db, dav);

	await updateEvent(db, id, { ...probe, calendarId: await calId('Schule') });
	expect((await syncAll(db, dav)).errors).toEqual([]);
	expect([dav.titles('Privat'), dav.titles('Schule')]).toEqual([[], ['Probe']]);
	expect(await db.select().from(t.events)).toHaveLength(1);

	// Am iPhone zurück nach „Feuerwehr“: dort neu, in „Schule“ gelöscht, gleiche Kennung
	const [row] = await db.select().from(t.events);
	dav.phoneDelete('Schule', row.caldavUid);
	dav.phonePut('Feuerwehr', { uid: row.caldavUid, title: 'Probe' });
	await syncAll(db, dav);
	const after = await db.select().from(t.events);
	expect(after).toMatchObject([{ id, calendarId: await calId('Feuerwehr'), syncState: 'synced', caldavHref: `/1/calendars/feuerwehr/${row.caldavUid}.ics` }]);
});

test('Serie: geht als ein Objekt nach iCloud, ein am iPhone gelöschter Einzeltermin fehlt danach auch hier', async () => {
	const { db, dav, calId } = await setup();
	await syncAll(db, dav);
	await createEvent(db, { ...probe, calendarId: await calId('Schule'), repeat: 'weekly', until: '2026-12-04' });
	await syncAll(db, dav);
	const [row] = await db.select().from(t.events);
	const remote = dav.object('Schule', row.caldavUid)!;
	expect(remote.data).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261204T225959Z');
	expect([...dav.cals.get('/1/calendars/schule/')!.objects]).toHaveLength(1);

	// iPhone: „nur diesen Termin löschen“ am 27.11.
	const schule = dav.cals.get('/1/calendars/schule/')!;
	dav.rev++;
	schule.ctag = `c${dav.rev}`;
	schule.log.push({ rev: dav.rev, href: row.caldavHref! });
	schule.objects.set(row.caldavHref!, { etag: `"e${dav.rev}"`, data: skipOccurrence(remote.data, new Date('2026-11-27T17:00:00Z')) });
	await syncAll(db, dav);
	expect((await eventsBetween(db, '2026-11-01', '2027-01-01')).map((e) => e.start.toISOString().slice(0, 10))).toEqual(['2026-11-20', '2026-12-04']);
});

test('ungültiger Sync-Token: vollständiger Abgleich räumt in iCloud Gelöschtes auf', async () => {
	const { db, dav, local } = await setup();
	dav.phonePut('Privat', { uid: 'A', title: 'A' });
	dav.phonePut('Privat', { uid: 'B', title: 'B' });
	await syncAll(db, dav);
	await createEvent(db, { ...probe, title: 'Neu', calendarId: (await db.select().from(t.calendars).where(eq(t.calendars.name, 'Privat')))[0].id });

	// iCloud vergisst den Token; B wurde inzwischen gelöscht
	const privat = dav.cals.get('/1/calendars/privat/')!;
	privat.objects.delete('/1/calendars/privat/B.ics');
	privat.ctag = 'anders';
	await db.update(t.calendars).set({ syncToken: 'abgelaufen' });

	expect((await syncAll(db, dav)).errors).toEqual([]);
	expect((await local()).sort()).toEqual(['A [synced]', 'Neu [synced]']);
	expect(dav.titles('Privat')).toEqual(['A', 'Neu']);
});

test('abgeschalteter Kalender wird nicht angerührt, freigegebener nur gelesen', async () => {
	const { db, dav, calId } = await setup();
	dav.addCalendar('Familie', { readOnly: true });
	await syncAll(db, dav);
	await db.update(t.calendars).set({ syncEnabled: false }).where(eq(t.calendars.name, 'Schule'));

	await createEvent(db, { ...probe, title: 'Bleibt lokal', calendarId: await calId('Schule') });
	dav.phonePut('Schule', { uid: 'S1', title: 'Kommt nicht an' });
	dav.phonePut('Familie', { uid: 'F1', title: 'Familienfest' });
	dav.calls = [];
	await syncAll(db, dav);

	expect(dav.titles('Schule')).toEqual(['Kommt nicht an']);
	expect((await db.select().from(t.events).orderBy(t.events.title)).map((e) => `${e.title} [${e.syncState}]`)).toEqual([
		'Bleibt lokal [dirty]',
		'Familienfest [synced]'
	]);
	expect(dav.calls.filter((c) => c.includes('/schule/') || (c.startsWith('put') && c.includes('/familie/')))).toEqual([]);
	// Wartet nur ein abgeschalteter Kalender, gibt es nichts nachzuholen
	expect(await hasPending(db)).toBe(false);
});

test('in iCloud gelöschter Kalender verschwindet samt Terminen', async () => {
	const { db, dav } = await setup();
	dav.phonePut('Schule', { uid: 'S1' });
	await syncAll(db, dav);
	dav.removeCalendar('Schule');
	await syncAll(db, dav);
	expect((await db.select().from(t.calendars)).map((c) => c.name).sort()).toEqual(['Feuerwehr', 'Privat']);
	expect(await db.select().from(t.events)).toEqual([]);
});

test('Passwort ungültig oder leere Kalenderliste: Abbruch, lokal bleibt alles erhalten', async () => {
	const { db, dav, calId } = await setup();
	dav.phonePut('Privat', { uid: 'P1', title: 'Bleibt' });
	await syncAll(db, dav);
	await createEvent(db, { ...probe, title: 'Wartet', calendarId: await calId('Privat') });

	dav.locked = true;
	await expect(syncAll(db, dav)).rejects.toThrow(AuthError);
	dav.locked = false;
	const saved = new Map(dav.cals);
	dav.cals.clear();
	await expect(syncAll(db, dav)).rejects.toThrow('keine Kalender');
	expect(await db.select().from(t.calendars)).toHaveLength(3);
	expect((await db.select().from(t.events).orderBy(t.events.title)).map((e) => `${e.title} [${e.syncState}]`)).toEqual(['Bleibt [synced]', 'Wartet [dirty]']);

	// Verbindung wieder da: das Gesammelte wird nachgeholt
	for (const [k, v] of saved) dav.cals.set(k, v);
	expect(await syncAll(db, dav)).toMatchObject({ pushed: 1, errors: [] });
	expect(dav.titles('Privat')).toEqual(['Bleibt', 'Wartet']);
});

test('ein Termin, den iCloud ablehnt, hält die anderen nicht auf', async () => {
	const { db, dav, calId } = await setup();
	await syncAll(db, dav);
	const privat = await calId('Privat');
	await createEvent(db, { ...probe, title: 'Kaputt', calendarId: privat });
	await createEvent(db, { ...probe, title: 'Gut', calendarId: privat });
	const [bad] = await db.select().from(t.events).where(eq(t.events.title, 'Kaputt'));
	const put = dav.put.bind(dav);
	dav.put = async (href, data, etag) => {
		if (href.includes(bad.caldavUid)) throw new Error('HTTP 403 Forbidden');
		return put(href, data, etag);
	};

	const report = await syncAll(db, dav);
	expect(report).toMatchObject({ pushed: 1, errors: ['Übertragen „Kaputt“: HTTP 403 Forbidden'] });
	expect(dav.titles('Privat')).toEqual(['Gut']);
	expect(await hasPending(db)).toBe(true);
});
