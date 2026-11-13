// Abgleich in beide Richtungen zwischen der lokalen Datenbank und iCloud.
// Regeln (Karte „Kalender-Sync“): Bei Konflikt gewinnt die letzte Änderung, Löschen wirkt auf beiden Seiten.
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import * as t from '../db/schema';
import type { Db } from '../db/types';
import { buildIcs, parseIcs } from '../ics';
import { AuthError, type CalDav, type RemoteCalendar, type RemoteObject } from './caldav';

type Calendar = typeof t.calendars.$inferSelect;
type EventRow = typeof t.events.$inferSelect;
/** Verbundener Kalender: der Ort in iCloud ist bekannt */
type Linked = Calendar & { caldavUrl: string };

export type SyncReport = {
	/** an iCloud übertragene Termine */
	pushed: number;
	/** von iCloud übernommene Termine */
	pulled: number;
	/** auf einer der beiden Seiten gelöschte Termine */
	deleted: number;
	/** Termine, die nicht abgeglichen werden konnten (der Rest läuft trotzdem durch) */
	errors: string[];
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ─── Kalender zuordnen ────────────────────────────────────────────────────

async function pickDefault(db: Db, dav: CalDav): Promise<Calendar | undefined> {
	const writable = (await db.select().from(t.calendars).where(isNotNull(t.calendars.caldavUrl)).orderBy(t.calendars.name)).filter(
		(c) => !c.readOnly
	);
	const url = await dav.defaultCalendarUrl();
	return writable.find((c) => c.caldavUrl === url) ?? writable[0];
}

/**
 * Gleicht die Kalenderliste ab: iCloud-Kalender werden übernommen, gleichnamige lokale Kalender
 * (z. B. „Schule“) damit verbunden, fehlende in iCloud angelegt. Der lokale Platzhalter-Standardkalender
 * geht im Standardkalender des iPhones auf.
 */
export async function linkCalendars(db: Db, dav: CalDav): Promise<Map<string, RemoteCalendar>> {
	const remote = await dav.listCalendars();
	// Schutz: Eine leere Liste würde sonst alle lokalen Kalender samt Terminen entfernen.
	if (remote.length === 0) throw new Error('iCloud hat keine Kalender geliefert.');

	const local = await db.select().from(t.calendars).orderBy(t.calendars.id);
	const claimed = new Set<number>();
	for (const r of remote) {
		const values = { name: r.name, readOnly: r.readOnly, ...(r.color ? { color: r.color } : {}) };
		const match = local.find((c) => c.caldavUrl === r.url) ?? local.find((c) => !c.caldavUrl && c.name === r.name && !claimed.has(c.id));
		if (match) {
			claimed.add(match.id);
			await db
				.update(t.calendars)
				.set({ ...values, caldavUrl: r.url })
				.where(eq(t.calendars.id, match.id));
		} else {
			await db.insert(t.calendars).values({ ...values, caldavUrl: r.url });
		}
	}

	// In iCloud gelöschte Kalender verschwinden auch hier (samt Terminen)
	const remoteUrls = new Set(remote.map((r) => r.url));
	for (const c of local) if (c.caldavUrl && !remoteUrls.has(c.caldavUrl)) await db.delete(t.calendars).where(eq(t.calendars.id, c.id));

	// Lokale Kalender, die es in iCloud noch nicht gibt
	for (const c of local) {
		if (c.caldavUrl || claimed.has(c.id)) continue;
		if (c.isDefault) {
			// Platzhalter aus der Zeit vor dem Sync: seine Termine wandern in den Standardkalender des iPhones
			const target = await pickDefault(db, dav);
			if (!target) continue;
			await db.update(t.events).set({ calendarId: target.id, syncState: 'dirty' }).where(eq(t.events.calendarId, c.id));
			await db.delete(t.calendars).where(eq(t.calendars.id, c.id));
		} else {
			const created = await dav.createCalendar(c.name, c.color);
			remote.push(created);
			await db.update(t.calendars).set({ caldavUrl: created.url }).where(eq(t.calendars.id, c.id));
		}
	}

	// Genau ein Standardkalender, und zwar ein beschreibbarer
	const all = await db.select().from(t.calendars);
	if (all.filter((c) => c.isDefault && !c.readOnly).length !== 1) {
		const target = all.find((c) => c.isDefault && !c.readOnly) ?? (await pickDefault(db, dav));
		if (target) await db.update(t.calendars).set({ isDefault: sql`${t.calendars.id} = ${target.id}` });
	}
	return new Map(remote.map((r) => [r.url, r]));
}

// ─── Termine ──────────────────────────────────────────────────────────────

/** Übernimmt ein Objekt aus iCloud in die Datenbank (neu oder als neuer Stand eines bekannten Termins) */
async function adopt(db: Db, cal: Linked, obj: RemoteObject): Promise<boolean> {
	const p = parseIcs(obj.data);
	if (!p) return false; // kein Termin (z. B. Aufgabe)
	const values = {
		calendarId: cal.id,
		title: p.title,
		start: p.start,
		end: p.end,
		allDay: p.allDay,
		location: p.location,
		notes: p.notes,
		recurring: p.recurring,
		seriesUntil: p.seriesUntil,
		icalRaw: obj.data,
		caldavHref: obj.href,
		caldavEtag: obj.etag,
		syncState: 'synced',
		deletedAt: null,
		updatedAt: new Date()
	};
	const [byHref] = await db.select({ id: t.events.id }).from(t.events).where(eq(t.events.caldavHref, obj.href));
	// Gleiche UID an anderem Ort: am iPhone in einen anderen Kalender verschoben
	const [known] = byHref ? [byHref] : await db.select({ id: t.events.id }).from(t.events).where(eq(t.events.caldavUid, p.uid));
	if (known) await db.update(t.events).set(values).where(eq(t.events.id, known.id));
	else await db.insert(t.events).values({ ...values, caldavUid: p.uid });
	return true;
}

const icsOf = (e: EventRow) =>
	e.icalRaw ??
	buildIcs({ uid: e.caldavUid, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, notes: e.notes, repeat: 'none' });

/** Löschaufträge ausführen. Wurde der Termin am iPhone nach dem Löschen noch geändert, gewinnt die Änderung. */
async function pushDeletes(db: Db, dav: CalDav, cal: Linked, report: SyncReport) {
	const rows = await db
		.select()
		.from(t.events)
		.where(and(eq(t.events.calendarId, cal.id), eq(t.events.syncState, 'deleted')));
	for (const e of rows) {
		try {
			if (e.caldavHref && (await dav.remove(e.caldavHref, e.caldavEtag)) === 'conflict') {
				const [remote] = await dav.fetch(cal.caldavUrl, [e.caldavHref]);
				const changedAt = remote && parseIcs(remote.data)?.lastModified;
				const remoteWins = !!changedAt && !!e.deletedAt && changedAt > e.deletedAt;
				if (remote && !remoteWins) await dav.remove(e.caldavHref, remote.etag);
				// remoteWins: Löschauftrag verwerfen, der Termin kommt beim Abholen wieder herein
			}
			await db.delete(t.events).where(eq(t.events.id, e.id));
			report.deleted++;
		} catch (err) {
			if (err instanceof AuthError) throw err;
			report.errors.push(`Löschen „${e.title}“: ${message(err)}`);
		}
	}
}

/** Lokale Änderungen übertragen */
async function pushDirty(db: Db, dav: CalDav, cal: Linked, report: SyncReport) {
	const rows = await db
		.select()
		.from(t.events)
		.where(and(eq(t.events.calendarId, cal.id), eq(t.events.syncState, 'dirty')));
	for (const e of rows) {
		try {
			const raw = icsOf(e);
			const href = e.caldavHref ?? `${cal.caldavUrl}${encodeURIComponent(e.caldavUid)}.ics`;
			let res = await dav.put(href, raw, e.caldavEtag);

			if (res.status === 'conflict') {
				const [remote] = await dav.fetch(cal.caldavUrl, [href]);
				if (!remote) {
					if (e.caldavEtag) {
						// Am iPhone gelöscht, während hier geändert wurde: Löschen wirkt auf beiden Seiten
						await db.delete(t.events).where(eq(t.events.id, e.id));
						report.deleted++;
						continue;
					}
					throw new Error('iCloud nimmt den Termin nicht an (Kennung schon vergeben).');
				}
				const changedAt = parseIcs(remote.data)?.lastModified;
				if (changedAt && changedAt > e.updatedAt) {
					// Die Änderung am iPhone ist neuer
					await adopt(db, cal, remote);
					report.pulled++;
					continue;
				}
				res = await dav.put(href, raw, remote.etag);
				if (res.status === 'conflict') continue; // schon wieder geändert → nächster Lauf
			}

			const etag = res.etag ?? (await dav.fetch(cal.caldavUrl, [href]))[0]?.etag ?? null;
			await db.update(t.events).set({ caldavHref: href, caldavEtag: etag, icalRaw: raw }).where(eq(t.events.id, e.id));
			// Nur als abgeglichen markieren, wenn der Termin währenddessen nicht erneut geändert wurde
			await db
				.update(t.events)
				.set({ syncState: 'synced' })
				.where(and(eq(t.events.id, e.id), sql`date_trunc('milliseconds', ${t.events.updatedAt}) = ${e.updatedAt.toISOString()}::timestamptz`));
			report.pushed++;
		} catch (err) {
			if (err instanceof AuthError) throw err;
			report.errors.push(`Übertragen „${e.title}“: ${message(err)}`);
		}
	}
}

/** Änderungen aus iCloud abholen */
async function pull(db: Db, dav: CalDav, cal: Linked, remoteCtag: string | null, force: boolean, report: SyncReport) {
	// Der ctag ändert sich bei jeder Änderung im Kalender: gleich geblieben = nichts zu tun
	if (!force && cal.syncToken && cal.ctag && cal.ctag === remoteCtag) return;

	const ch = await dav.changes(cal.caldavUrl, cal.syncToken);
	const rows = await db
		.select({ id: t.events.id, href: t.events.caldavHref, etag: t.events.caldavEtag, state: t.events.syncState, title: t.events.title })
		.from(t.events)
		.where(and(eq(t.events.calendarId, cal.id), isNotNull(t.events.caldavHref)));
	const byHref = new Map(rows.map((r) => [r.href!, r]));

	for (const href of ch.deleted) {
		const row = byHref.get(href);
		if (!row) continue;
		await db.delete(t.events).where(eq(t.events.id, row.id));
		if (row.state !== 'deleted') report.deleted++;
	}

	// Laden, was neu ist oder sich geändert hat. Lokal geänderte Termine klärt der nächste Lauf beim Übertragen.
	const need = ch.changed.filter((c) => {
		const row = byHref.get(c.href);
		return !row || (row.state === 'synced' && row.etag !== c.etag);
	});
	for (const obj of await dav.fetch(
		cal.caldavUrl,
		need.map((c) => c.href)
	)) {
		try {
			if (await adopt(db, cal, obj)) report.pulled++;
		} catch (err) {
			report.errors.push(`Übernehmen ${obj.href.split('/').pop()}: ${message(err)}`);
		}
	}

	if (ch.full) {
		// Vollständige Liste: was hier als abgeglichen gilt, dort aber fehlt, wurde in iCloud gelöscht
		const seen = new Set(ch.changed.map((c) => c.href));
		for (const row of rows) {
			if (row.state !== 'synced' || seen.has(row.href!)) continue;
			await db.delete(t.events).where(eq(t.events.id, row.id));
			report.deleted++;
		}
	}

	await db
		.update(t.calendars)
		.set({ syncToken: ch.token ?? cal.syncToken, ctag: remoteCtag, lastSyncedAt: new Date() })
		.where(eq(t.calendars.id, cal.id));
}

/** Ein vollständiger Abgleich aller verbundenen Kalender, bei denen der Sync eingeschaltet ist */
export async function syncAll(db: Db, dav: CalDav): Promise<SyncReport> {
	const report: SyncReport = { pushed: 0, pulled: 0, deleted: 0, errors: [] };
	const remote = await linkCalendars(db, dav);
	const cals = (await db
		.select()
		.from(t.calendars)
		.where(and(isNotNull(t.calendars.caldavUrl), eq(t.calendars.syncEnabled, true)))
		.orderBy(t.calendars.id)) as Linked[];

	// Erst alle Löschaufträge: Ein verschobener Termin muss im alten Kalender weg sein,
	// bevor er im neuen angelegt wird (iCloud erlaubt jede Kennung nur einmal).
	for (const cal of cals) if (!cal.readOnly) await pushDeletes(db, dav, cal, report);

	for (const cal of cals) {
		const before = report.pushed + report.deleted;
		if (!cal.readOnly) await pushDirty(db, dav, cal, report);
		const changedHere = report.pushed + report.deleted > before;
		await pull(db, dav, cal, remote.get(cal.caldavUrl)?.ctag ?? null, changedHere, report);
	}
	return report;
}

/** Gibt es lokale Änderungen, die noch nicht in iCloud sind? */
export async function hasPending(db: Db): Promise<boolean> {
	const [row] = await db
		.select({ id: t.events.id })
		.from(t.events)
		.innerJoin(t.calendars, eq(t.calendars.id, t.events.calendarId))
		.where(and(ne(t.events.syncState, 'synced'), eq(t.calendars.syncEnabled, true), eq(t.calendars.readOnly, false)))
		.limit(1);
	return !!row;
}
