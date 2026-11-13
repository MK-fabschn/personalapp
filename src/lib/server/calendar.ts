// Kalender und Termine: Lesen (inkl. Auflösen von Serien) und alle lokalen Änderungen.
// Jede Änderung markiert den Termin als `dirty`, der Sync überträgt ihn danach an iCloud.
import { and, asc, eq, gt, gte, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as t from './db/schema';
import type { Db } from './db/types';
import { buildIcs, expandIcs, parseIcs, skipDays as skipDaysIn, skipOccurrence, type Repeat } from './ics';
import { localDate, viennaToDate } from '#lib/format.js';

export class CalendarError extends Error {}

export type Calendar = typeof t.calendars.$inferSelect;
type EventRow = typeof t.events.$inferSelect;

/** Ein einzelner Termin für die Anzeige (bei Serien: ein Termin der Serie) */
export type CalEvent = {
	/** eindeutig pro angezeigtem Termin (Serien-Termine teilen sich `id`) */
	key: string;
	id: number;
	calendarId: number;
	color: string;
	readOnly: boolean;
	title: string;
	start: Date;
	end: Date;
	allDay: boolean;
	location: string | null;
	notes: string | null;
	recurring: boolean;
	repeat: Repeat;
	/** letzter Tag der Serie (YYYY-MM-DD) */
	until: string | null;
	/** Beginn und Ende des ersten Termins der Serie (für das Formular) */
	seriesStart: Date;
	seriesEnd: Date;
	/** ursprünglicher Beginn dieses Termins laut Serie */
	original: Date;
	managedKey: string | null;
};

export type EventWrite = {
	title: string;
	start: Date;
	end: Date;
	allDay: boolean;
	location: string | null;
	notes: string | null;
	/** null = Standardkalender */
	calendarId: number | null;
	repeat: 'none' | 'weekly' | 'keep';
	until: string | null;
};
type Extra = { managedKey?: string; skipDays?: string[] };

// ─── Kalender ─────────────────────────────────────────────────────────────

export const listCalendars = (db: Db) => db.select().from(t.calendars).orderBy(asc(t.calendars.sort), asc(t.calendars.name));

export async function defaultCalendar(db: Db): Promise<Calendar> {
	const all = await listCalendars(db);
	const cal = all.find((c) => c.isDefault && !c.readOnly) ?? all.find((c) => !c.readOnly);
	if (!cal) throw new CalendarError('Es gibt keinen Kalender, in den geschrieben werden kann.');
	return cal;
}

export async function setDefaultCalendar(db: Db, id: number) {
	const [cal] = await db.select().from(t.calendars).where(eq(t.calendars.id, id));
	if (!cal || cal.readOnly) throw new CalendarError('Dieser Kalender kann nicht Standardkalender sein.');
	await db.update(t.calendars).set({ isDefault: sql`${t.calendars.id} = ${id}` });
}

/** Kalender mit diesem Namen holen oder (lokal) anlegen */
export async function ensureCalendar(db: Db, name: string, color: string): Promise<Calendar> {
	const [found] = await db.select().from(t.calendars).where(eq(t.calendars.name, name)).orderBy(asc(t.calendars.id));
	if (found) return found;
	const [created] = await db.insert(t.calendars).values({ name, color }).returning();
	return created;
}

async function writableCalendar(db: Db, id: number | null): Promise<Calendar> {
	if (id === null) return defaultCalendar(db);
	const [cal] = await db.select().from(t.calendars).where(eq(t.calendars.id, id));
	if (!cal) throw new CalendarError('Diesen Kalender gibt es nicht.');
	if (cal.readOnly) throw new CalendarError(`„${cal.name}“ ist ein freigegebener Kalender und nur lesbar.`);
	return cal;
}

// ─── Termine lesen ────────────────────────────────────────────────────────

/** Termine aller eingeblendeten Kalender, die den Zeitraum [fromIso, toIso) (Wiener Tage) berühren */
export async function eventsBetween(db: Db, fromIso: string, toIso: string): Promise<CalEvent[]> {
	const from = viennaToDate(fromIso, '00:00');
	const to = viennaToDate(toIso, '00:00');
	const rows = await db
		.select({ e: t.events, color: t.calendars.color, readOnly: t.calendars.readOnly })
		.from(t.events)
		.innerJoin(t.calendars, eq(t.calendars.id, t.events.calendarId))
		.where(
			and(
				eq(t.calendars.visible, true),
				ne(t.events.syncState, 'deleted'),
				lt(t.events.start, to),
				or(
					and(eq(t.events.recurring, false), gt(t.events.end, from)),
					// Termine ohne Dauer (Beginn = Ende) gehören zu ihrem Tag
					and(eq(t.events.recurring, false), eq(t.events.end, t.events.start), gte(t.events.start, from)),
					and(eq(t.events.recurring, true), or(isNull(t.events.seriesUntil), gte(t.events.seriesUntil, from)))
				)
			)
		);

	const out: CalEvent[] = [];
	for (const { e, color, readOnly } of rows) {
		const common = {
			id: e.id,
			calendarId: e.calendarId,
			color,
			readOnly,
			seriesStart: e.start,
			seriesEnd: e.end,
			managedKey: e.managedKey
		};
		if (!e.recurring || !e.icalRaw) {
			out.push({
				...common,
				key: String(e.id),
				title: e.title,
				start: e.start,
				end: e.end,
				allDay: e.allDay,
				location: e.location,
				notes: e.notes,
				recurring: false,
				repeat: 'none',
				until: null,
				original: e.start
			});
			continue;
		}
		const repeat = parseIcs(e.icalRaw)?.repeat ?? 'other';
		for (const o of expandIcs(e.icalRaw, from, to)) {
			out.push({
				...common,
				...o,
				key: `${e.id}:${o.original.toISOString()}`,
				recurring: true,
				repeat,
				until: e.seriesUntil ? localDate(e.seriesUntil) : null
			});
		}
	}
	return out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.key.localeCompare(b.key));
}

// ─── Termine ändern ───────────────────────────────────────────────────────

/** Spalten, die aus dem iCalendar-Objekt abgeleitet werden */
function columnsFrom(raw: string) {
	const p = parseIcs(raw)!;
	return {
		title: p.title,
		start: p.start,
		end: p.end,
		allDay: p.allDay,
		location: p.location,
		notes: p.notes,
		recurring: p.recurring,
		seriesUntil: p.seriesUntil,
		icalRaw: raw
	};
}

export async function createEvent(db: Db, input: EventWrite, extra: Extra = {}): Promise<number> {
	const cal = await writableCalendar(db, input.calendarId);
	const uid = randomUUID().toUpperCase();
	const raw = buildIcs({ ...input, uid, skipDays: extra.skipDays });
	const [row] = await db
		.insert(t.events)
		.values({ ...columnsFrom(raw), calendarId: cal.id, caldavUid: uid, managedKey: extra.managedKey, syncState: 'dirty' })
		.returning({ id: t.events.id });
	return row.id;
}

/** Von der App verwaltete Schul-Termine: Sie werden aus den Einstellungen erzeugt und dort geändert. */
export const isSchoolManaged = (managedKey: string | null) => !!managedKey?.startsWith('schule:');

async function editableEvent(db: Db, id: number, opts: { managed?: boolean } = {}): Promise<EventRow> {
	const [row] = await db
		.select({ e: t.events, readOnly: t.calendars.readOnly, name: t.calendars.name })
		.from(t.events)
		.innerJoin(t.calendars, eq(t.calendars.id, t.events.calendarId))
		.where(and(eq(t.events.id, id), ne(t.events.syncState, 'deleted')));
	if (!row) throw new CalendarError('Diesen Termin gibt es nicht mehr.');
	if (row.readOnly) throw new CalendarError(`„${row.name}“ ist ein freigegebener Kalender und nur lesbar.`);
	if (isSchoolManaged(row.e.managedKey) && !opts.managed) {
		throw new CalendarError('Schul-Block und Schulweg werden in den Kalender-Einstellungen geändert. Für einen einzelnen Tag dort einen schulfreien Tag eintragen.');
	}
	return row.e;
}

/** Hinterlässt für einen bereits übertragenen Termin einen Löschauftrag an iCloud */
async function leaveTombstone(db: Db, e: EventRow) {
	await db.insert(t.events).values({
		calendarId: e.calendarId,
		title: e.title,
		start: e.start,
		end: e.end,
		caldavUid: `${e.caldavUid}#entfernt-${Date.now()}`,
		caldavHref: e.caldavHref,
		caldavEtag: e.caldavEtag,
		syncState: 'deleted',
		deletedAt: new Date()
	});
}

export async function updateEvent(db: Db, id: number, input: EventWrite, extra: Extra = {}) {
	const e = await editableEvent(db, id, { managed: extra.managedKey !== undefined });
	const cal = await writableCalendar(db, input.calendarId ?? e.calendarId);
	const raw = buildIcs({ ...input, uid: e.caldavUid, skipDays: extra.skipDays }, e.icalRaw);
	const moved = cal.id !== e.calendarId;
	// Anderer Kalender = anderer Ort in iCloud: dort löschen, im neuen Kalender neu anlegen
	if (moved && e.caldavHref) await leaveTombstone(db, e);
	await db
		.update(t.events)
		.set({
			...columnsFrom(raw),
			calendarId: cal.id,
			...(moved ? { caldavHref: null, caldavEtag: null } : {}),
			syncState: 'dirty',
			updatedAt: new Date()
		})
		.where(eq(t.events.id, id));
}

/** Löscht den Termin (bei Serien die ganze Serie). Bereits übertragene Termine bleiben als Löschauftrag stehen. */
export async function deleteEvent(db: Db, id: number) {
	const e = await editableEvent(db, id);
	if (e.caldavHref) {
		await db.update(t.events).set({ syncState: 'deleted', deletedAt: new Date(), managedKey: null }).where(eq(t.events.id, id));
	} else {
		await db.delete(t.events).where(eq(t.events.id, id));
	}
}

/** Lässt einen einzelnen Termin einer Serie ausfallen */
export async function skipEventOccurrence(db: Db, id: number, original: Date) {
	const e = await editableEvent(db, id);
	if (!e.recurring || !e.icalRaw) throw new CalendarError('Dieser Termin ist keine Serie.');
	const raw = skipOccurrence(e.icalRaw, original);
	await db
		.update(t.events)
		.set({ ...columnsFrom(raw), syncState: 'dirty', updatedAt: new Date() })
		.where(eq(t.events.id, id));
}

// ─── Verwaltete Termine ───────────────────────────────────────────────────

/**
 * Legt einen von der App verwalteten Serientermin an oder bringt ihn auf den gewünschten Stand.
 * Stimmt er schon, bleibt er unberührt (sonst würde er bei jedem Start erneut an iCloud übertragen).
 */
export async function upsertManaged(db: Db, key: string, input: EventWrite, skipDays: string[]): Promise<'created' | 'updated' | 'unchanged'> {
	const [e] = await db
		.select()
		.from(t.events)
		.where(and(eq(t.events.managedKey, key), ne(t.events.syncState, 'deleted')));
	if (!e) {
		await createEvent(db, input, { managedKey: key, skipDays });
		return 'created';
	}
	const cal = await writableCalendar(db, input.calendarId);
	const now = e.icalRaw ? parseIcs(e.icalRaw) : null;
	const wantedUntil = parseIcs(buildIcs({ ...input, uid: e.caldavUid }))!.seriesUntil;
	const same =
		!!now &&
		cal.id === e.calendarId &&
		now.title === input.title &&
		now.allDay === input.allDay &&
		now.start.getTime() === input.start.getTime() &&
		now.end.getTime() === input.end.getTime() &&
		now.repeat === (input.repeat === 'keep' ? now.repeat : input.repeat) &&
		now.seriesUntil?.getTime() === wantedUntil?.getTime() &&
		skipDaysIn(e.icalRaw!).join() === [...new Set(skipDays)].sort().join();
	if (same) return 'unchanged';
	await updateEvent(db, e.id, input, { managedKey: key, skipDays });
	return 'updated';
}

/** Entfernt einen verwalteten Termin (falls vorhanden) */
export async function removeManaged(db: Db, key: string) {
	const [e] = await db
		.select({ id: t.events.id, href: t.events.caldavHref })
		.from(t.events)
		.where(and(eq(t.events.managedKey, key), ne(t.events.syncState, 'deleted')));
	if (!e) return;
	if (e.href) await db.update(t.events).set({ syncState: 'deleted', deletedAt: new Date(), managedKey: null }).where(eq(t.events.id, e.id));
	else await db.delete(t.events).where(eq(t.events.id, e.id));
}

// ─── Schulfreie Tage ──────────────────────────────────────────────────────

export const listFreeDays = (db: Db) => db.select().from(t.schoolFreeDays).orderBy(asc(t.schoolFreeDays.from));

/** Schulfreie Tage, die den Zeitraum [fromIso, toIso) berühren */
export const freeDaysBetween = (db: Db, fromIso: string, toIso: string) =>
	db
		.select()
		.from(t.schoolFreeDays)
		.where(and(lt(t.schoolFreeDays.from, toIso), gte(t.schoolFreeDays.to, fromIso)))
		.orderBy(asc(t.schoolFreeDays.from));

export async function addFreeDay(db: Db, from: string, to: string, label: string) {
	if (to < from) throw new CalendarError('Das Ende muss am oder nach dem Beginn liegen.');
	await db.insert(t.schoolFreeDays).values({ from, to, label });
}

export const deleteFreeDay = (db: Db, id: number) => db.delete(t.schoolFreeDays).where(eq(t.schoolFreeDays.id, id));
