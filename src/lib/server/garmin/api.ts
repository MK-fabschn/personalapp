// Garmin Connect Personal API: nur lesend, nur Abfrage. Aus dem Schlüssel wird ein Token geholt,
// das 24 Stunden gilt; Refresh-Tokens gibt es nicht, also wird rechtzeitig ein neues angefordert.

const BASE = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const RENEW_BEFORE_MS = 60 * 60 * 1000;

/** Eine Einheit, wie die Liste sie liefert (nur die Felder, die die App braucht) */
export type GarminActivity = {
	activityId?: number | string;
	activityName?: string | null;
	activityType?: { typeKey?: string | null } | null;
	/** `YYYY-MM-DD HH:MM:SS` in UTC, ohne Zonenangabe */
	startTimeGMT?: string | null;
	/** Millisekunden seit 1970 */
	beginTimestamp?: number | null;
	duration?: number | null;
	distance?: number | null;
	elevationGain?: number | null;
	averageHR?: number | null;
	maxHR?: number | null;
	avgPower?: number | null;
	calories?: number | null;
};

export interface GarminApi {
	/** Einheiten, neueste zuerst; `start` = wie viele überspringen */
	activities(start: number, limit: number): Promise<GarminActivity[]>;
}

/** Schlüssel ungültig, abgelaufen oder gelöscht */
export class GarminAuthError extends Error {}
export class GarminError extends Error {}

/** Ablaufzeit aus dem JWT lesen; null, wenn das Token nicht lesbar ist */
function expiryOf(token: string): number | null {
	try {
		const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
		return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
	} catch {
		return null;
	}
}

export function connectGarmin(apiKey: string, opts: { fetch?: typeof fetch; now?: () => number } = {}): GarminApi {
	const doFetch = opts.fetch ?? fetch;
	const now = opts.now ?? Date.now;
	let token: { value: string; expires: number } | null = null;

	async function bearer(): Promise<string> {
		if (token && token.expires - now() > RENEW_BEFORE_MS) return token.value;
		const res = await doFetch(BASE + TOKEN_PATH, { method: 'POST', headers: { Authorization: `ApiKey ${apiKey}` }, signal: AbortSignal.timeout(30000) });
		if (res.status === 401 || res.status === 403) throw new GarminAuthError('Garmin lehnt den Schlüssel ab.');
		if (!res.ok) throw new GarminError(`Garmin-Anmeldung: HTTP ${res.status}`);
		const value = (await res.text()).trim();
		// Ohne lesbare Ablaufzeit vorsichtshalber nur kurz behalten
		token = { value, expires: expiryOf(value) ?? now() + 2 * RENEW_BEFORE_MS };
		return value;
	}

	return {
		async activities(start, limit) {
			const url = `${BASE}/activitylist-service/activities/search/activities?start=${start}&limit=${limit}`;
			let res = await doFetch(url, { headers: { Authorization: `Bearer ${await bearer()}` }, signal: AbortSignal.timeout(30000) });
			if (res.status === 401) {
				// Token vorzeitig ungültig: einmal neu holen
				token = null;
				res = await doFetch(url, { headers: { Authorization: `Bearer ${await bearer()}` }, signal: AbortSignal.timeout(30000) });
				if (res.status === 401) throw new GarminAuthError('Garmin lehnt den Schlüssel ab.');
			}
			if (!res.ok) throw new GarminError(`Garmin-Abfrage: HTTP ${res.status}`);
			const body: unknown = await res.json();
			if (!Array.isArray(body)) throw new GarminError('Garmin hat keine Liste geliefert.');
			return body as GarminActivity[];
		}
	};
}
