// Übernimmt Einheiten von Garmin in die Tabelle `activities` (Upsert über garmin_id).
import { inArray, isNotNull } from 'drizzle-orm';
import * as t from '../db/schema';
import type { Db } from '../db/types';
import type { GarminActivity, GarminApi } from './api';

const PAGE = 100;
/** Schutz gegen Endlosschleifen, falls Garmin immer volle Seiten liefert */
const MAX_PAGES = 200;

// Garmin kennt viele Unterarten; die Statistik fasst sie zu den Sportarten der App zusammen.
// Was hier nicht steht (z. B. hiking, walking), behält Garmins Bezeichnung.
const SPORTS: Record<string, string> = {
	running: 'running',
	treadmill_running: 'running',
	trail_running: 'running',
	track_running: 'running',
	street_running: 'running',
	indoor_running: 'running',
	virtual_run: 'running',
	cycling: 'cycling',
	road_biking: 'cycling',
	mountain_biking: 'cycling',
	gravel_cycling: 'cycling',
	indoor_cycling: 'cycling',
	virtual_ride: 'virtual_ride',
	strength_training: 'strength'
};

export const sportOf = (typeKey: string | null | undefined) => (typeKey ? (SPORTS[typeKey] ?? typeKey) : 'other');

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

function startOf(a: GarminActivity): Date | null {
	// `2026-11-12 17:42:50` ist UTC, trägt aber keine Zonenangabe
	const fromText = a.startTimeGMT ? new Date(a.startTimeGMT.replace(' ', 'T') + 'Z') : null;
	if (fromText && !Number.isNaN(fromText.getTime())) return fromText;
	return typeof a.beginTimestamp === 'number' ? new Date(a.beginTimestamp) : null;
}

/** Garmin-Einheit → Zeile für `activities`. null, wenn Pflichtangaben fehlen. */
export function mapActivity(a: GarminActivity): typeof t.activities.$inferInsert | null {
	const startTime = startOf(a);
	const durationS = int(a.duration);
	if (a.activityId === undefined || a.activityId === null || !startTime || durationS === null) return null;
	return {
		garminId: String(a.activityId),
		name: a.activityName?.trim() || null,
		sport: sportOf(a.activityType?.typeKey),
		startTime,
		durationS,
		distanceM: int(a.distance),
		elevationM: int(a.elevationGain),
		avgHr: int(a.averageHR),
		maxHr: int(a.maxHR),
		avgPowerW: int(a.avgPower),
		calories: int(a.calories)
	};
}

export type ImportReport = { added: number; updated: number; skipped: number };

/**
 * Holt Einheiten seitenweise, neueste zuerst. Beim ersten Mal (noch keine Garmin-Einheit gespeichert)
 * die ganze Historie; danach nur so weit zurück, bis eine Seite nichts Neues mehr enthält.
 */
export async function importActivities(db: Db, api: GarminApi): Promise<ImportReport> {
	const report: ImportReport = { added: 0, updated: 0, skipped: 0 };
	const [any] = await db.select({ id: t.activities.id }).from(t.activities).where(isNotNull(t.activities.garminId)).limit(1);
	const full = !any;

	for (let page = 0; page < MAX_PAGES; page++) {
		const list = await api.activities(page * PAGE, PAGE);
		const rows = list.map(mapActivity).filter((r) => r !== null);
		report.skipped += list.length - rows.length;

		let addedHere = 0;
		if (rows.length) {
			const ids = rows.map((r) => r.garminId!);
			const known = new Set(
				(await db.select({ garminId: t.activities.garminId }).from(t.activities).where(inArray(t.activities.garminId, ids))).map((r) => r.garminId)
			);
			for (const row of rows) {
				const { garminId: _id, ...values } = row;
				await db.insert(t.activities).values(row).onConflictDoUpdate({ target: t.activities.garminId, set: values });
				if (known.has(row.garminId!)) report.updated++;
				else addedHere++;
			}
			report.added += addedHere;
		}
		if (list.length < PAGE) break; // letzte Seite
		if (!full && addedHere === 0) break; // ab hier ist alles bekannt
	}
	return report;
}
