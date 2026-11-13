// Betrieb des iCloud-Syncs in der App: ein Lauf zur Zeit, Takt im Hintergrund, Zustand für die Anzeige.
import { eq } from 'drizzle-orm';
import { dev } from '$app/env';
import { ICLOUD_APPLE_ID, ICLOUD_APP_PASSWORD, ICLOUD_SYNC_IN_DEV, ICLOUD_SYNC_INTERVAL_SECONDS } from '$app/env/private';
import { db, t } from '../db';
import { AuthError, connectCalDav, type CalDav } from './caldav';
import { syncAll, type SyncReport } from './sync';

export type SyncStatus = {
	ok: boolean;
	/** Zeitpunkt des letzten Versuchs (ISO) */
	at: string;
	/** Meldung für die Anzeige, wenn etwas nicht geklappt hat */
	error: string | null;
	/** `auth` = Zugangsdaten ungültig: kein automatischer Versuch mehr, bis von Hand abgeglichen wird */
	kind: 'ok' | 'auth' | 'error';
	report: SyncReport | null;
};

const STATUS_KEY = 'icloud_sync';

// Schutz: Beim lokalen Entwickeln liegt oft dieselbe .env wie am Server daneben. Ohne ausdrückliches
// ICLOUD_SYNC_IN_DEV=1 würde sonst die Test-Datenbank mit dem echten Konto abgeglichen.
export const icloudConfigured = () => !!(ICLOUD_APPLE_ID && ICLOUD_APP_PASSWORD) && (!dev || ICLOUD_SYNC_IN_DEV === '1');

export async function syncStatus(): Promise<SyncStatus | null> {
	const [row] = await db.select().from(t.settings).where(eq(t.settings.key, STATUS_KEY));
	return (row?.value as SyncStatus | undefined) ?? null;
}

let dav: CalDav | null = null;
let running: Promise<SyncStatus> | null = null;
let again = false;
let authBlocked = false;
let lastRun = 0;

async function attempt(): Promise<SyncStatus> {
	let status: SyncStatus;
	try {
		dav ??= await connectCalDav({ appleId: ICLOUD_APPLE_ID!, appPassword: ICLOUD_APP_PASSWORD! });
		const report = await syncAll(db, dav);
		const failed = report.errors.length;
		status = {
			ok: failed === 0,
			at: new Date().toISOString(),
			error: failed ? `${failed} ${failed === 1 ? 'Termin konnte' : 'Termine konnten'} nicht abgeglichen werden: ${report.errors[0]}` : null,
			kind: failed ? 'error' : 'ok',
			report
		};
		authBlocked = false;
	} catch (e) {
		dav = null; // beim nächsten Mal neu anmelden
		const auth = e instanceof AuthError;
		authBlocked = auth;
		status = {
			ok: false,
			at: new Date().toISOString(),
			error: auth
				? 'iCloud lehnt die Anmeldung ab. Vermutlich wurde das app-spezifische Passwort widerrufen (z. B. nach einer Änderung des Apple-Passworts).'
				: `iCloud ist gerade nicht erreichbar. Änderungen werden gesammelt und nachgeholt. (${e instanceof Error ? e.message : String(e)})`,
			kind: auth ? 'auth' : 'error',
			report: null
		};
		console.error('[icloud] Abgleich fehlgeschlagen:', e instanceof Error ? e.message : e);
	}
	lastRun = Date.now();
	await db.insert(t.settings).values({ key: STATUS_KEY, value: status }).onConflictDoUpdate({ target: t.settings.key, set: { value: status } });
	return status;
}

/** Gleicht jetzt ab. Läuft schon ein Abgleich, wird direkt danach noch einer angehängt. */
export function runSync(): Promise<SyncStatus | null> {
	if (!icloudConfigured()) return Promise.resolve(null);
	if (running) {
		again = true;
		return running;
	}
	running = (async () => {
		let status = await attempt();
		while (again && status.kind !== 'auth') {
			again = false;
			status = await attempt();
		}
		again = false;
		return status;
	})().finally(() => (running = null));
	return running;
}

/** Nach einer Änderung in der App: sofort übertragen, ohne dass die Seite darauf wartet */
export function requestSync() {
	if (authBlocked) return;
	void runSync().catch((e) => console.error('[icloud]', e));
}

/** Beim Öffnen des Kalenders: abgleichen, wenn der letzte Lauf älter ist, aber höchstens `waitMs` darauf warten */
export async function syncIfStale(maxAgeMs = 30_000, waitMs = 4_000) {
	if (!icloudConfigured() || authBlocked || Date.now() - lastRun < maxAgeMs) return;
	await Promise.race([runSync().catch(() => null), new Promise((r) => setTimeout(r, waitMs))]);
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Abgleich im Hintergrund (Standard: alle 5 Minuten) */
export function startSyncScheduler() {
	if (timer || !icloudConfigured()) return;
	const seconds = Math.max(60, Number(ICLOUD_SYNC_INTERVAL_SECONDS) || 300);
	timer = setInterval(requestSync, seconds * 1000);
	timer.unref?.();
	requestSync();
	console.log(`[icloud] Abgleich alle ${seconds} s gestartet.`);
}
