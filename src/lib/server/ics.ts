// iCalendar lesen, schreiben und Serien in einzelne Termine auflösen.
// Das gespeicherte Objekt (events.ical_raw) wird nie neu erfunden, sondern nur gezielt
// geändert, damit Felder vom iPhone (Erinnerungen, X-APPLE-…) erhalten bleiben.
import ICAL from 'ical.js';
import { TZ, addDays, isTimeZone, localDate, wallTime, zonedToDate, type WallTime } from '#lib/format.js';

const VIENNA_VTIMEZONE = [
	'BEGIN:VTIMEZONE',
	'TZID:Europe/Vienna',
	'BEGIN:DAYLIGHT',
	'TZOFFSETFROM:+0100',
	'TZOFFSETTO:+0200',
	'TZNAME:CEST',
	'DTSTART:19700329T020000',
	'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
	'END:DAYLIGHT',
	'BEGIN:STANDARD',
	'TZOFFSETFROM:+0200',
	'TZOFFSETTO:+0100',
	'TZNAME:CET',
	'DTSTART:19701025T030000',
	'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
	'END:STANDARD',
	'END:VTIMEZONE'
].join('\r\n');

/** Wiederholung, wie das Formular sie kennt. `other` = Regel vom iPhone, die die App nur beibehält. */
export type Repeat = 'none' | 'weekly' | 'other';

export type IcsEvent = {
	uid: string;
	title: string;
	start: Date;
	end: Date;
	allDay: boolean;
	location: string | null;
	notes: string | null;
	recurring: boolean;
	repeat: Repeat;
	/** Ende der Serie; null = kein Ende (oder keine Serie) */
	seriesUntil: Date | null;
	lastModified: Date | null;
};

export type IcsFields = {
	uid: string;
	title: string;
	start: Date;
	end: Date;
	allDay: boolean;
	location: string | null;
	notes: string | null;
	/** `keep` lässt eine vorhandene Wiederholung unverändert */
	repeat: 'none' | 'weekly' | 'keep';
	/** letzter Tag der Serie (YYYY-MM-DD), null = ohne Ende */
	until?: string | null;
	/** ersetzt alle Ausnahmen der Serie: Tage (YYYY-MM-DD), an denen der Termin entfällt */
	skipDays?: string[];
};

export type Occurrence = {
	start: Date;
	end: Date;
	allDay: boolean;
	title: string;
	location: string | null;
	notes: string | null;
	/** ursprünglicher Beginn laut Serie (zum Auslassen dieses einen Termins) */
	original: Date;
};

// ─── Zeit-Umrechnung ──────────────────────────────────────────────────────

function toDate(time: ICAL.Time, fallbackTzid?: string | null): Date {
	const w: WallTime = { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second };
	// Ganztägig: der Tag gilt in Wiener Zeit
	if (time.isDate) return zonedToDate({ ...w, hour: 0, minute: 0, second: 0 }, TZ);
	const zoneId = time.zone?.tzid;
	if (zoneId === 'UTC') return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second));
	const tzid = zoneId && zoneId !== 'floating' ? zoneId : fallbackTzid;
	if (isTimeZone(tzid)) return zonedToDate(w, tzid);
	// Unbekannter Zonenname (z. B. von Outlook), aber mit VTIMEZONE im Objekt: ical.js rechnet selbst
	if (zoneId && zoneId !== 'floating') return time.toJSDate();
	return zonedToDate(w, TZ);
}

const tzidOf = (vevent: ICAL.Component) => {
	const p = vevent.getFirstProperty('dtstart');
	const v = p?.getParameter('tzid');
	return typeof v === 'string' ? v : null;
};

function icalTime(d: Date, kind: 'date' | 'vienna' | 'utc' | { tzid: string }): ICAL.Time {
	if (kind === 'utc') return ICAL.Time.fromJSDate(d, true);
	const tz = typeof kind === 'object' ? kind.tzid : TZ;
	const w = wallTime(d, tz);
	return ICAL.Time.fromData(kind === 'date' ? { year: w.year, month: w.month, day: w.day, isDate: true } : { ...w, isDate: false });
}

// ─── Laden ────────────────────────────────────────────────────────────────

function load(raw: string) {
	const comp = new ICAL.Component(ICAL.parse(raw));
	const vevents = comp.getAllSubcomponents('vevent');
	const masterComp = vevents.find((v) => !v.hasProperty('recurrence-id')) ?? vevents[0];
	if (!masterComp) return null;
	const exceptions = vevents.filter((v) => v !== masterComp && v.hasProperty('recurrence-id'));
	const master = new ICAL.Event(masterComp, { strictExceptions: false, exceptions });
	return { comp, masterComp, master, exceptions };
}

const textOf = (vevent: ICAL.Component, name: string) => {
	const v = vevent.getFirstPropertyValue(name);
	return typeof v === 'string' && v.trim() ? v : null;
};

function describe(masterComp: ICAL.Component, master: ICAL.Event): IcsEvent {
	const tzid = tzidOf(masterComp);
	const start = toDate(master.startDate, tzid);
	const end = toDate(master.endDate, tzid);
	const rule = masterComp.getFirstPropertyValue('rrule') as ICAL.Recur | null;
	const recurring = master.isRecurring();
	const simpleWeekly =
		!!rule &&
		rule.freq === 'WEEKLY' &&
		rule.interval === 1 &&
		!rule.count &&
		masterComp.getAllProperties('rrule').length === 1 &&
		!masterComp.hasProperty('rdate') &&
		Object.keys(rule.parts).every((k) => k === 'BYDAY') &&
		(rule.parts.BYDAY?.length ?? 0) <= 1;
	const lm = masterComp.getFirstPropertyValue('last-modified') as ICAL.Time | null;
	return {
		uid: master.uid,
		title: textOf(masterComp, 'summary') ?? '(ohne Titel)',
		start,
		end: end > start ? end : start,
		allDay: master.startDate.isDate,
		location: textOf(masterComp, 'location'),
		notes: textOf(masterComp, 'description'),
		recurring,
		repeat: !recurring ? 'none' : simpleWeekly ? 'weekly' : 'other',
		seriesUntil: recurring && rule?.until ? toDate(rule.until, tzid) : null,
		lastModified: lm ? toDate(lm) : null
	};
}

/** Liest den Termin (bei Serien: den ersten) aus einem iCalendar-Objekt. null, wenn kein VEVENT enthalten ist. */
export function parseIcs(raw: string): IcsEvent | null {
	const l = load(raw);
	return l ? describe(l.masterComp, l.master) : null;
}

// ─── Serien auflösen ──────────────────────────────────────────────────────

const MAX_STEPS = 20000;

/** Alle Termine des Objekts, die den Zeitraum [from, to) berühren */
export function expandIcs(raw: string, from: Date, to: Date): Occurrence[] {
	const l = load(raw);
	if (!l) return [];
	const { master, masterComp } = l;
	const tzid = tzidOf(masterComp);

	if (!master.isRecurring()) {
		const e = describe(masterComp, master);
		if (!(e.start < to && e.end > from) && !(e.start.getTime() === e.end.getTime() && e.start >= from && e.start < to)) return [];
		return [{ start: e.start, end: e.end, allDay: e.allDay, title: e.title, location: e.location, notes: e.notes, original: e.start }];
	}

	const out: Occurrence[] = [];
	const it = master.iterator();
	for (let i = 0; i < MAX_STEPS; i++) {
		const next = it.next();
		if (!next) break;
		const original = toDate(next, tzid);
		if (original >= to) break;
		const d = master.getOccurrenceDetails(next);
		const item = d.item.component;
		if (textOf(item, 'status')?.toUpperCase() === 'CANCELLED') continue;
		const itemTz = tzidOf(item) ?? tzid;
		const start = toDate(d.startDate, itemTz);
		const end = toDate(d.endDate, itemTz);
		if (start < to && (end > from || (end.getTime() === start.getTime() && start >= from))) {
			out.push({
				start,
				end,
				allDay: d.startDate.isDate,
				title: textOf(item, 'summary') ?? '(ohne Titel)',
				location: textOf(item, 'location'),
				notes: textOf(item, 'description'),
				original
			});
		}
	}
	return out;
}

// ─── Schreiben ────────────────────────────────────────────────────────────

function setText(vevent: ICAL.Component, name: string, value: string | null) {
	if (value) vevent.updatePropertyWithValue(name, value);
	else vevent.removeAllProperties(name);
}

function setTime(vevent: ICAL.Component, name: string, d: Date, allDay: boolean) {
	vevent.removeAllProperties(name);
	const p = new ICAL.Property(name);
	p.setValue(icalTime(d, allDay ? 'date' : 'vienna'));
	if (!allDay) p.setParameter('tzid', TZ);
	vevent.addProperty(p);
}

function ensureViennaZone(comp: ICAL.Component) {
	const has = comp.getAllSubcomponents('vtimezone').some((z) => z.getFirstPropertyValue('tzid') === TZ);
	if (!has) comp.addSubcomponent(new ICAL.Component(ICAL.parse(VIENNA_VTIMEZONE)));
}

/** EXDATE für einen Tag, im selben Format wie DTSTART der Serie */
function exdateProp(masterComp: ICAL.Component, original: Date): ICAL.Property {
	const dtstart = masterComp.getFirstProperty('dtstart')!;
	const startTime = dtstart.getFirstValue() as ICAL.Time;
	const tzid = tzidOf(masterComp);
	const p = new ICAL.Property('exdate');
	if (startTime.isDate) p.setValue(icalTime(original, 'date'));
	else if (startTime.zone?.tzid === 'UTC') p.setValue(icalTime(original, 'utc'));
	else {
		const zone = isTimeZone(tzid) ? tzid : TZ;
		p.setValue(icalTime(original, { tzid: zone }));
		if (tzid) p.setParameter('tzid', tzid);
	}
	return p;
}

function untilValue(until: string, allDay: boolean): ICAL.Time {
	const [year, month, day] = until.split('-').map(Number);
	if (allDay) return ICAL.Time.fromData({ year, month, day, isDate: true });
	// Bei DTSTART mit TZID muss UNTIL in UTC stehen (RFC 5545): Ende dieses Tages in Wien
	const endOfDay = new Date(zonedToDate({ year, month, day, hour: 23, minute: 59, second: 59 }, TZ));
	return icalTime(endOfDay, 'utc');
}

/**
 * Baut das iCalendar-Objekt für einen Termin. Mit `raw` wird das vorhandene Objekt geändert
 * (nur die Felder, die sich unterscheiden), ohne `raw` entsteht ein neues.
 */
export function buildIcs(f: IcsFields, raw?: string | null): string {
	const loaded = raw ? load(raw) : null;
	let comp: ICAL.Component, vevent: ICAL.Component;
	let before: IcsEvent | null = null;

	if (loaded) {
		comp = loaded.comp;
		vevent = loaded.masterComp;
		before = describe(vevent, loaded.master);
	} else {
		comp = new ICAL.Component('vcalendar');
		comp.updatePropertyWithValue('version', '2.0');
		comp.updatePropertyWithValue('prodid', '-//Fabse//Personal App//DE');
		vevent = new ICAL.Component('vevent');
		vevent.updatePropertyWithValue('uid', f.uid);
		comp.addSubcomponent(vevent);
	}

	setText(vevent, 'summary', f.title);
	setText(vevent, 'location', f.location);
	setText(vevent, 'description', f.notes);

	// Zeiten nur anfassen, wenn sie sich geändert haben (erhält z. B. eine fremde Zeitzone)
	const timesChanged =
		!before || before.allDay !== f.allDay || before.start.getTime() !== f.start.getTime() || before.end.getTime() !== f.end.getTime();
	if (timesChanged) {
		const oldSkips = before?.recurring ? skipDaysOf(vevent) : [];
		setTime(vevent, 'dtstart', f.start, f.allDay);
		setTime(vevent, 'dtend', f.end, f.allDay);
		vevent.removeAllProperties('duration');
		if (!f.allDay) ensureViennaZone(comp);
		// Ausnahmen wandern mit: gleiche Tage (verschoben um die Tagesdifferenz), neue Uhrzeit
		if (before?.recurring && f.skipDays === undefined && oldSkips.length) {
			const shift = Math.round((Date.parse(localDate(f.start)) - Date.parse(localDate(before.start))) / 86400000);
			replaceSkipDays(vevent, f, oldSkips.map((d) => addDays(d, shift)));
		}
	}

	if (f.repeat === 'none') {
		for (const name of ['rrule', 'exdate', 'rdate', 'exrule']) vevent.removeAllProperties(name);
		for (const ex of comp.getAllSubcomponents('vevent')) if (ex !== vevent) comp.removeSubcomponent(ex);
	} else if (f.repeat === 'weekly') {
		const rule = new ICAL.Recur({ freq: 'WEEKLY' });
		if (f.until) rule.until = untilValue(f.until, f.allDay);
		vevent.removeAllProperties('rrule');
		vevent.addPropertyWithValue('rrule', rule);
	} else if (timesChanged && before?.seriesUntil) {
		// Ganztägig ↔ mit Uhrzeit: UNTIL muss zum neuen DTSTART passen
		const rule = vevent.getFirstPropertyValue('rrule') as ICAL.Recur | null;
		if (rule?.until) {
			rule.until = untilValue(localDate(before.seriesUntil), f.allDay);
			vevent.updatePropertyWithValue('rrule', rule);
		}
	}

	if (f.skipDays !== undefined && f.repeat !== 'none') replaceSkipDays(vevent, f, f.skipDays);

	const now = icalTime(new Date(), 'utc');
	vevent.updatePropertyWithValue('dtstamp', now);
	vevent.updatePropertyWithValue('last-modified', now);
	if (before) vevent.updatePropertyWithValue('sequence', (Number(vevent.getFirstPropertyValue('sequence')) || 0) + 1);

	return comp.toString();
}

/** Tage (Wiener Datum), an denen die Serie entfällt, sortiert */
export function skipDays(raw: string): string[] {
	const l = load(raw);
	return l ? skipDaysOf(l.masterComp).sort() : [];
}

/** Tage (Wiener Datum), an denen die Serie laut EXDATE entfällt */
function skipDaysOf(vevent: ICAL.Component): string[] {
	const tzid = tzidOf(vevent);
	return vevent
		.getAllProperties('exdate')
		.flatMap((p) => p.getValues() as ICAL.Time[])
		.map((t) => localDate(toDate(t, tzid)));
}

function replaceSkipDays(vevent: ICAL.Component, f: Pick<IcsFields, 'start' | 'allDay'>, days: string[]) {
	vevent.removeAllProperties('exdate');
	const w = wallTime(f.start, TZ);
	for (const day of [...new Set(days)].sort()) {
		const [year, month, dd] = day.split('-').map(Number);
		const original = zonedToDate(f.allDay ? { year, month, day: dd, hour: 0, minute: 0, second: 0 } : { ...w, year, month, day: dd }, TZ);
		vevent.addProperty(exdateProp(vevent, original));
	}
}

/** Lässt genau einen Termin einer Serie ausfallen (EXDATE) und entfernt eine dazugehörige Ausnahme. */
export function skipOccurrence(raw: string, original: Date): string {
	const l = load(raw);
	if (!l) return raw;
	const tzid = tzidOf(l.masterComp);
	for (const ex of l.exceptions) {
		const rid = ex.getFirstPropertyValue('recurrence-id') as ICAL.Time | null;
		if (rid && toDate(rid, tzid).getTime() === original.getTime()) l.comp.removeSubcomponent(ex);
	}
	l.masterComp.addProperty(exdateProp(l.masterComp, original));
	const now = icalTime(new Date(), 'utc');
	l.masterComp.updatePropertyWithValue('last-modified', now);
	l.masterComp.updatePropertyWithValue('sequence', (Number(l.masterComp.getFirstPropertyValue('sequence')) || 0) + 1);
	return l.comp.toString();
}
