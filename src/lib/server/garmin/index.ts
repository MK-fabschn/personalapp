// Betrieb des Garmin-Imports in der App: stündlich im Hintergrund, Knopf „Jetzt abrufen“, Zustand für die Anzeige.
import { eq } from 'drizzle-orm';
import { GARMIN_API_KEY, GARMIN_API_KEY_EXPIRES } from '$app/env/private';
import { db, t } from '../db';
import { GarminAuthError, connectGarmin, type GarminApi } from './api';
import { EXPIRY_WARNING_DAYS, daysUntilExpiry } from './expiry';
import { importActivities, type ImportReport } from './import';
import { today } from '#lib/format.js';

export type GarminStatus = {
	ok: boolean;
	/** Zeitpunkt des letzten Versuchs (ISO) */
	at: string;
	error: string | null;
	report: ImportReport | null;
};

const STATUS_KEY = 'garmin_import';
const HOUR = 60 * 60 * 1000;

export const garminConfigured = () => !!GARMIN_API_KEY;

/** Für die Trainingsseite: Zustand des letzten Abrufs und Hinweis zum Ablauf des Schlüssels */
export async function garminInfo() {
	if (!garminConfigured()) return null;
	const [row] = await db.select().from(t.settings).where(eq(t.settings.key, STATUS_KEY));
	const days = daysUntilExpiry(GARMIN_API_KEY_EXPIRES, today());
	return {
		status: (row?.value as GarminStatus | undefined) ?? null,
		expires: GARMIN_API_KEY_EXPIRES ?? null,
		/** Tage bis zum Ablauf, nur wenn der Hinweis fällig ist */
		expiresInDays: days !== null && days <= EXPIRY_WARNING_DAYS ? days : null
	};
}

let api: GarminApi | null = null;
let running: Promise<GarminStatus> | null = null;
let authBlocked = false;

async function attempt(): Promise<GarminStatus> {
	let status: GarminStatus;
	try {
		api ??= connectGarmin(GARMIN_API_KEY!);
		const report = await importActivities(db, api);
		status = { ok: true, at: new Date().toISOString(), error: null, report };
		authBlocked = false;
	} catch (e) {
		const auth = e instanceof GarminAuthError;
		authBlocked = auth;
		status = {
			ok: false,
			at: new Date().toISOString(),
			error: auth
				? 'Garmin lehnt den Schlüssel ab. Er ist vermutlich abgelaufen oder wurde gelöscht; in Garmin Connect einen neuen erzeugen und am Server eintragen.'
				: `Garmin ist gerade nicht erreichbar. (${e instanceof Error ? e.message : String(e)})`,
			report: null
		};
		console.error('[garmin] Abruf fehlgeschlagen:', e instanceof Error ? e.message : e);
	}
	await db.insert(t.settings).values({ key: STATUS_KEY, value: status }).onConflictDoUpdate({ target: t.settings.key, set: { value: status } });
	return status;
}

/** Ruft jetzt ab (ein Lauf zur Zeit) */
export function runGarminImport(): Promise<GarminStatus | null> {
	if (!garminConfigured()) return Promise.resolve(null);
	running ??= attempt().finally(() => (running = null));
	return running;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Stündlicher Abruf im Hintergrund. Nach einem abgelehnten Schlüssel nur noch von Hand. */
export function startGarminScheduler() {
	if (timer || !garminConfigured()) return;
	const tick = () => {
		if (!authBlocked) void runGarminImport().catch((e) => console.error('[garmin]', e));
	};
	timer = setInterval(tick, HOUR);
	timer.unref?.();
	tick();
	console.log('[garmin] Stündlicher Abruf gestartet.');
}
