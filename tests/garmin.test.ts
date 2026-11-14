import { expect, test } from 'vitest';
import * as t from '../src/lib/server/db/schema';
import { GarminAuthError, connectGarmin, type GarminActivity, type GarminApi } from '../src/lib/server/garmin/api';
import { importActivities, mapActivity, sportOf } from '../src/lib/server/garmin/import';
import { daysUntilExpiry } from '../src/lib/server/garmin/expiry';
import { testDb } from './db';

// Felder und Format wie in der echten Antwort vom 14.11.2026 (Ticket „Garmin-Key erzeugen und Test-Abfrage“)
const zwift: GarminActivity = {
	activityId: 25057467222,
	activityName: 'Zwift - Tempus Fugit in Watopia',
	activityType: { typeKey: 'virtual_ride' },
	startTimeGMT: '2026-11-12 17:42:50',
	beginTimestamp: 1794505370000,
	duration: 2718,
	distance: 20929.25,
	elevationGain: 82,
	averageHR: 150,
	maxHR: 175,
	avgPower: 100,
	calories: 260
};

test('Feld-Mapping einer echten Einheit', () => {
	expect(mapActivity(zwift)).toEqual({
		garminId: '25057467222',
		name: 'Zwift - Tempus Fugit in Watopia',
		sport: 'virtual_ride',
		startTime: new Date('2026-11-12T17:42:50Z'),
		durationS: 2718,
		distanceM: 20929,
		elevationM: 82,
		avgHr: 150,
		maxHr: 175,
		avgPowerW: 100,
		calories: 260
	});
});

test('fehlende Werte werden null, Kommazahlen gerundet, unbrauchbare Einheiten übersprungen', () => {
	const atem = mapActivity({ activityId: 7, activityType: { typeKey: 'breathwork' }, startTimeGMT: '2026-01-05 06:00:00', duration: 301.6, distance: null });
	expect(atem).toMatchObject({ garminId: '7', name: null, sport: 'breathwork', durationS: 302, distanceM: null, avgHr: null, avgPowerW: null });
	// ohne lesbare Startzeit zählt beginTimestamp
	expect(mapActivity({ activityId: 8, duration: 60, beginTimestamp: 1794505370000 })!.startTime).toEqual(new Date(1794505370000));
	expect(mapActivity({ activityId: 9, startTimeGMT: '2026-01-05 06:00:00' })).toBeNull(); // keine Dauer
	expect(mapActivity({ duration: 60, startTimeGMT: '2026-01-05 06:00:00' })).toBeNull(); // keine Kennung
});

test('Zuordnung der Sportarten', () => {
	expect(['running', 'treadmill_running', 'trail_running'].map(sportOf)).toEqual(['running', 'running', 'running']);
	expect(['cycling', 'mountain_biking', 'virtual_ride', 'strength_training'].map(sportOf)).toEqual(['cycling', 'cycling', 'virtual_ride', 'strength']);
	expect(['hiking', 'resort_skiing_snowboarding_ws', undefined].map(sportOf)).toEqual(['hiking', 'resort_skiing_snowboarding_ws', 'other']);
});

/** Garmin-Konto im Speicher: Einheiten neueste zuerst, wie die echte Liste */
function fakeGarmin(count: number) {
	const all: GarminActivity[] = Array.from({ length: count }, (_, i) => ({
		activityId: 1000 + i,
		activityName: `Lauf ${i}`,
		activityType: { typeKey: 'running' },
		startTimeGMT: new Date(Date.UTC(2023, 0, 1) + i * 86400000).toISOString().slice(0, 19).replace('T', ' '),
		duration: 1800
	}));
	const calls: string[] = [];
	const api: GarminApi = {
		async activities(start, limit) {
			calls.push(`${start}+${limit}`);
			return [...all].reverse().slice(start, start + limit);
		}
	};
	return { all, calls, api };
}

test('erster Abruf lädt die ganze Historie, weitere nur das Neue', async () => {
	const { db } = await testDb();
	const g = fakeGarmin(230);

	expect(await importActivities(db, g.api)).toEqual({ added: 230, updated: 0, skipped: 0 });
	expect(g.calls).toEqual(['0+100', '100+100', '200+100']);
	expect(await db.$count(t.activities)).toBe(230);

	// Nichts Neues: eine Seite, keine Duplikate
	g.calls.length = 0;
	expect(await importActivities(db, g.api)).toEqual({ added: 0, updated: 100, skipped: 0 });
	expect(g.calls).toEqual(['0+100']);
	expect(await db.$count(t.activities)).toBe(230);

	// Zwei neue Einheiten, eine alte am Handy umbenannt
	g.all.push({ ...zwift }, { activityId: 2, startTimeGMT: '2026-11-13 06:00:00', duration: 600, activityType: { typeKey: 'walking' } });
	g.all[229].activityName = 'Lauf 229 (Bestzeit)';
	expect(await importActivities(db, g.api)).toMatchObject({ added: 2 });
	const rows = await db.select().from(t.activities);
	expect(rows).toHaveLength(232);
	expect(rows.find((r) => r.garminId === '1229')!.name).toBe('Lauf 229 (Bestzeit)');
	expect(rows.find((r) => r.garminId === '25057467222')).toMatchObject({ sport: 'virtual_ride', avgPowerW: 100 });
});

test('nach längerer Pause wird so weit zurückgeholt, bis alles bekannt ist', async () => {
	const { db } = await testDb();
	const g = fakeGarmin(50);
	await importActivities(db, g.api);
	// 150 neue Einheiten seit dem letzten Abruf
	for (let i = 0; i < 150; i++) g.all.push({ activityId: 5000 + i, startTimeGMT: '2026-06-01 06:00:00', duration: 60, activityType: { typeKey: 'running' } });
	g.calls.length = 0;
	expect(await importActivities(db, g.api)).toMatchObject({ added: 150 });
	// Seite 2 enthält noch Neues, erst die (leere) Seite 3 beendet den Abruf
	expect(g.calls).toEqual(['0+100', '100+100', '200+100']);
	expect(await db.$count(t.activities)).toBe(200);
});

test('unbrauchbare Einträge halten den Abruf nicht auf', async () => {
	const { db } = await testDb();
	const api: GarminApi = { activities: async () => [zwift, { activityId: 3 }, {}] };
	expect(await importActivities(db, api)).toEqual({ added: 1, updated: 0, skipped: 2 });
});

// ── Token ───────────────────────────────────────────────────────────────

const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp: Math.floor(exp / 1000) })).toString('base64url')}.y`;

test('Token wird aus dem Schlüssel geholt, wiederverwendet und rechtzeitig erneuert', async () => {
	let now = Date.parse('2026-11-14T09:00:00Z');
	const seen: string[] = [];
	const fetchFake = (async (url: string | URL, init?: RequestInit) => {
		const auth = String((init?.headers as Record<string, string>).Authorization);
		if (String(url).includes('/token')) {
			seen.push(`token ${auth}`);
			return new Response(jwt(now + 24 * 3600 * 1000), { status: 200 });
		}
		seen.push(`liste ${auth.slice(0, 8)}`);
		return Response.json([zwift]);
	}) as typeof fetch;
	const api = connectGarmin('GEHEIM', { fetch: fetchFake, now: () => now });

	expect(await api.activities(0, 100)).toHaveLength(1);
	await api.activities(100, 100);
	expect(seen).toEqual(['token ApiKey GEHEIM', 'liste Bearer x', 'liste Bearer x']);

	now += 22 * 3600 * 1000; // noch 2 h gültig → weiterverwenden
	await api.activities(0, 100);
	expect(seen.filter((s) => s.startsWith('token'))).toHaveLength(1);
	now += 90 * 60 * 1000; // weniger als 1 h → neues Token
	await api.activities(0, 100);
	expect(seen.filter((s) => s.startsWith('token'))).toHaveLength(2);
});

test('abgelehnter Schlüssel wird als solcher gemeldet', async () => {
	const denied = connectGarmin('ALT', { fetch: (async () => new Response('nein', { status: 401 })) as typeof fetch });
	await expect(denied.activities(0, 100)).rejects.toThrow(GarminAuthError);
});

test('Hinweis 14 Tage vor Ablauf des Schlüssels', () => {
	expect(daysUntilExpiry('2027-11-14', '2026-11-14')).toBe(365);
	expect(daysUntilExpiry('2027-11-14', '2027-10-31')).toBe(14);
	expect(daysUntilExpiry('2027-11-14', '2027-11-14')).toBe(0);
	expect(daysUntilExpiry('2027-11-14', '2027-11-16')).toBe(-2);
	expect(daysUntilExpiry(undefined, '2026-11-14')).toBeNull();
	expect(daysUntilExpiry('nächstes Jahr', '2026-11-14')).toBeNull();
});
