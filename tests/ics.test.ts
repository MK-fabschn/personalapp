import { expect, test } from 'vitest';
import { buildIcs, expandIcs, parseIcs, skipOccurrence, type IcsFields } from '../src/lib/server/ics';

const base: IcsFields = {
	uid: 'test-1',
	title: 'Schule',
	start: new Date('2027-03-22T07:00:00Z'), // Mo 08:00 Wien (Winterzeit)
	end: new Date('2027-03-22T15:00:00Z'),
	allDay: false,
	location: null,
	notes: null,
	repeat: 'none'
};
const iso = (ds: Date[]) => ds.map((d) => d.toISOString());
const range = (raw: string, from: string, to: string) => expandIcs(raw, new Date(from), new Date(to));

test('neuer Termin: Wiener Zeit mit TZID, DTEND und Zeitzonen-Definition', () => {
	const raw = buildIcs({ ...base, location: 'HTL', notes: 'Zeile 1\nZeile 2' });
	expect(raw).toContain('DTSTART;TZID=Europe/Vienna:20270322T080000');
	expect(raw).toContain('DTEND;TZID=Europe/Vienna:20270322T160000');
	expect(raw).toContain('BEGIN:VTIMEZONE');
	expect(parseIcs(raw)).toMatchObject({
		uid: 'test-1',
		title: 'Schule',
		start: base.start,
		end: base.end,
		allDay: false,
		location: 'HTL',
		notes: 'Zeile 1\nZeile 2',
		recurring: false,
		repeat: 'none',
		seriesUntil: null
	});
});

test('ganztägig über mehrere Tage: DTEND ist der Tag danach', () => {
	const raw = buildIcs({ ...base, allDay: true, start: new Date('2027-06-13T22:00:00Z'), end: new Date('2027-06-18T22:00:00Z') });
	expect(raw).toContain('DTSTART;VALUE=DATE:20270614');
	expect(raw).toContain('DTEND;VALUE=DATE:20270619');
	expect(parseIcs(raw)).toMatchObject({ allDay: true, start: new Date('2027-06-13T22:00:00Z'), end: new Date('2027-06-18T22:00:00Z') });
});

test('wöchentliche Serie: UNTIL in UTC, Uhrzeit bleibt über die Zeitumstellung gleich', () => {
	const raw = buildIcs({ ...base, repeat: 'weekly', until: '2027-04-12' });
	expect(raw).toContain('RRULE:FREQ=WEEKLY;UNTIL=20270412T215959Z');
	expect(parseIcs(raw)).toMatchObject({ recurring: true, repeat: 'weekly', seriesUntil: new Date('2027-04-12T21:59:59Z') });
	// 22.3. Winterzeit (UTC+1), ab 29.3. Sommerzeit (UTC+2): immer 08:00 in Wien
	expect(iso(range(raw, '2027-03-01T00:00:00Z', '2027-06-01T00:00:00Z').map((o) => o.start))).toEqual([
		'2027-03-22T07:00:00.000Z',
		'2027-03-29T06:00:00.000Z',
		'2027-04-05T06:00:00.000Z',
		'2027-04-12T06:00:00.000Z'
	]);
});

test('Zeitraum: nur Termine, die ihn berühren', () => {
	const raw = buildIcs({ ...base, repeat: 'weekly', until: null });
	const occ = range(raw, '2027-04-05T10:00:00Z', '2027-04-12T06:00:00Z');
	// 5.4. läuft noch (bis 14:00 UTC), 12.4. beginnt genau am Ende des Zeitraums → nicht mehr dabei
	expect(iso(occ.map((o) => o.start))).toEqual(['2027-04-05T06:00:00.000Z']);
	expect(occ[0].end).toEqual(new Date('2027-04-05T14:00:00Z'));
});

test('schulfreie Tage: skipDays lassen Termine ausfallen und ersetzen frühere Ausnahmen', () => {
	let raw = buildIcs({ ...base, repeat: 'weekly', until: '2027-04-12', skipDays: ['2027-03-29'] });
	expect(raw).toContain('EXDATE;TZID=Europe/Vienna:20270329T080000');
	expect(range(raw, '2027-03-01T00:00:00Z', '2027-06-01T00:00:00Z')).toHaveLength(3);
	raw = buildIcs({ ...base, repeat: 'keep', skipDays: ['2027-04-05', '2027-04-12'] }, raw);
	expect(iso(range(raw, '2027-03-01T00:00:00Z', '2027-06-01T00:00:00Z').map((o) => o.start))).toEqual([
		'2027-03-22T07:00:00.000Z',
		'2027-03-29T06:00:00.000Z'
	]);
});

test('geänderte Uhrzeit einer Serie: Ausnahmen wandern mit', () => {
	let raw = buildIcs({ ...base, repeat: 'weekly', until: '2027-04-12', skipDays: ['2027-03-29'] });
	raw = buildIcs({ ...base, start: new Date('2027-03-22T08:00:00Z'), end: new Date('2027-03-22T15:00:00Z'), repeat: 'keep' }, raw);
	expect(raw).toContain('EXDATE;TZID=Europe/Vienna:20270329T090000');
	expect(iso(range(raw, '2027-03-01T00:00:00Z', '2027-06-01T00:00:00Z').map((o) => o.start))).toEqual([
		'2027-03-22T08:00:00.000Z',
		'2027-04-05T07:00:00.000Z',
		'2027-04-12T07:00:00.000Z'
	]);
});

test('einen Termin der Serie auslassen', () => {
	const raw = skipOccurrence(buildIcs({ ...base, repeat: 'weekly', until: '2027-04-12' }), new Date('2027-04-05T06:00:00Z'));
	expect(iso(range(raw, '2027-03-01T00:00:00Z', '2027-06-01T00:00:00Z').map((o) => o.start))).toEqual([
		'2027-03-22T07:00:00.000Z',
		'2027-03-29T06:00:00.000Z',
		'2027-04-12T06:00:00.000Z'
	]);
});

test('Serie beenden: Wiederholung „keine“ entfernt Regel und Ausnahmen', () => {
	const raw = buildIcs({ ...base, repeat: 'none' }, buildIcs({ ...base, repeat: 'weekly', skipDays: ['2027-03-29'] }));
	expect(raw).not.toMatch(/FREQ=WEEKLY|EXDATE/);
	expect(parseIcs(raw)).toMatchObject({ recurring: false });
});

// So sieht ein am iPhone angelegter Serientermin mit verschobenem Einzeltermin und Erinnerung aus
const VOM_IPHONE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//iOS 18.0//EN
BEGIN:VTIMEZONE
TZID:Europe/Vienna
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
DTSTART:19810329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
DTSTART:19961027T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:IPHONE-1
DTSTAMP:20261113T100000Z
LAST-MODIFIED:20261113T100000Z
DTSTART;TZID=Europe/Vienna:20270301T190000
DTEND;TZID=Europe/Vienna:20270301T210000
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Probe
X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT30M
DESCRIPTION:Erinnerung
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:IPHONE-1
RECURRENCE-ID;TZID=Europe/Vienna:20270308T190000
DTSTART;TZID=Europe/Vienna:20270309T180000
DTEND;TZID=Europe/Vienna:20270309T200000
SUMMARY:Probe (verschoben)
END:VEVENT
END:VCALENDAR`.replace(/\n/g, '\r\n');

test('Objekt vom iPhone: verschobener Einzeltermin wird berücksichtigt', () => {
	expect(parseIcs(VOM_IPHONE)).toMatchObject({ uid: 'IPHONE-1', title: 'Probe', recurring: true, repeat: 'other', lastModified: new Date('2026-11-13T10:00:00Z') });
	const occ = range(VOM_IPHONE, '2027-01-01T00:00:00Z', '2028-01-01T00:00:00Z');
	expect(occ.map((o) => [o.title, o.start.toISOString(), o.original.toISOString()])).toEqual([
		['Probe', '2027-03-01T18:00:00.000Z', '2027-03-01T18:00:00.000Z'],
		['Probe (verschoben)', '2027-03-09T17:00:00.000Z', '2027-03-08T18:00:00.000Z'],
		['Probe', '2027-03-15T18:00:00.000Z', '2027-03-15T18:00:00.000Z']
	]);
});

test('Objekt vom iPhone ändern: fremde Felder, Zeiten und Regel bleiben erhalten', () => {
	const p = parseIcs(VOM_IPHONE)!;
	const raw = buildIcs({ ...p, title: 'Orchesterprobe', location: 'Musikheim', repeat: 'keep' }, VOM_IPHONE);
	expect(raw).toContain('SUMMARY:Orchesterprobe');
	expect(raw).toContain('LOCATION:Musikheim');
	for (const kept of ['BEGIN:VALARM', 'TRIGGER:-PT30M', 'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC', 'RRULE:FREQ=WEEKLY;COUNT=3', 'DTSTART;TZID=Europe/Vienna:20270301T190000', 'RECURRENCE-ID;TZID=Europe/Vienna:20270308T190000']) {
		expect(raw).toContain(kept);
	}
	expect(raw).toContain('SEQUENCE:1');
	expect(parseIcs(raw)!.lastModified!.getTime()).toBeGreaterThan(Date.parse('2026-11-13T10:00:00Z'));
});

test('verschobenen Einzeltermin auslassen: Ausnahme verschwindet', () => {
	const raw = skipOccurrence(VOM_IPHONE, new Date('2027-03-08T18:00:00Z'));
	expect(raw).not.toContain('Probe (verschoben)');
	expect(range(raw, '2027-01-01T00:00:00Z', '2028-01-01T00:00:00Z')).toHaveLength(2);
});

test('Zeiten in UTC und ohne Ende (nur DTSTART) werden gelesen', () => {
	const raw = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u\r\nDTSTART:20270101T120000Z\r\nSUMMARY:Kurz\r\nEND:VEVENT\r\nEND:VCALENDAR';
	expect(parseIcs(raw)).toMatchObject({ start: new Date('2027-01-01T12:00:00Z'), end: new Date('2027-01-01T12:00:00Z') });
	expect(range(raw, '2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z')).toHaveLength(1);
});
