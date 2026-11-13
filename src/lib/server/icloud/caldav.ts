// Dünne Schicht über tsdav: genau die CalDAV-Aufrufe, die der Sync braucht.
// Alle Orte (Kalender, Termine) werden als Pfad gehandhabt; der Host kann bei iCloud wechseln.
import {
	calendarMultiGet,
	createAccount,
	createObject,
	deleteObject,
	getBasicAuthHeaders,
	makeCalendar,
	propfind,
	syncCollection,
	updateObject,
	type DAVResponse
} from 'tsdav';
import { randomUUID } from 'node:crypto';

export type RemoteCalendar = {
	/** Pfad der Collection, endet mit / */
	url: string;
	name: string;
	/** #rrggbb */
	color: string | null;
	ctag: string | null;
	readOnly: boolean;
};
export type RemoteObject = { href: string; etag: string; data: string };
export type Changes = {
	changed: { href: string; etag: string }[];
	deleted: string[];
	token: string | null;
	/** true = vollständige Liste (kein oder ungültiger Sync-Token) */
	full: boolean;
};
export type PutResult = { status: 'ok'; etag: string | null } | { status: 'conflict' };

/** Was der Sync von einem CalDAV-Server braucht (in den Tests durch einen Nachbau ersetzt) */
export interface CalDav {
	listCalendars(): Promise<RemoteCalendar[]>;
	/** Standardkalender des Kontos, falls der Server ihn verrät */
	defaultCalendarUrl(): Promise<string | null>;
	createCalendar(name: string, color: string): Promise<RemoteCalendar>;
	changes(calendarUrl: string, syncToken: string | null): Promise<Changes>;
	fetch(calendarUrl: string, hrefs: string[]): Promise<RemoteObject[]>;
	/** etag null = neu anlegen (schlägt fehl, wenn es das Objekt schon gibt) */
	put(href: string, data: string, etag: string | null): Promise<PutResult>;
	remove(href: string, etag: string | null): Promise<'ok' | 'gone' | 'conflict'>;
}

/** Zugangsdaten ungültig (z. B. app-spezifisches Passwort widerrufen) */
export class AuthError extends Error {}
export class DavError extends Error {}

const RETRY_STATUS = new Set([429, 503]);

/** fetch mit Wiederholung bei Überlastung und klarer Meldung bei 401 */
async function politeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(input, { ...init, signal: AbortSignal.timeout(30000) });
		if (res.status === 401) throw new AuthError('iCloud hat die Anmeldung abgelehnt.');
		if (!RETRY_STATUS.has(res.status) || attempt >= 3) return res;
		const retryAfter = Number(res.headers.get('retry-after'));
		const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 20) * 1000 : 1000 * 2 ** attempt;
		await new Promise((r) => setTimeout(r, wait));
	}
}

const hasKey = (value: unknown, key: string): boolean =>
	Array.isArray(value)
		? value.some((v) => hasKey(v, key))
		: typeof value === 'object' && value !== null && (key in value || Object.values(value).some((v) => hasKey(v, key)));

const textOf = (v: unknown): string | null => {
	if (typeof v === 'string') return v.trim() || null;
	if (typeof v === 'number') return String(v);
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>;
		return textOf(o._cdata ?? o._text ?? o.href ?? null);
	}
	return null;
};

/** iCloud liefert #RRGGBBAA; die App rechnet mit #rrggbb */
const colorOf = (v: unknown) => {
	const m = /^#([0-9a-fA-F]{6})/.exec(textOf(v) ?? '');
	return m ? `#${m[1].toLowerCase()}` : null;
};

export async function connectCalDav(opts: { appleId: string; appPassword: string; serverUrl?: string }): Promise<CalDav> {
	const headers = getBasicAuthHeaders({ username: opts.appleId, password: opts.appPassword });
	const common = { headers, fetch: politeFetch as typeof fetch };
	const account = await createAccount({
		account: { serverUrl: opts.serverUrl ?? 'https://caldav.icloud.com/', accountType: 'caldav' },
		...common
	});
	if (!account.homeUrl) throw new DavError('iCloud hat keinen Kalender-Ordner geliefert.');
	const home = account.homeUrl;
	const abs = (path: string) => new URL(path, home).href;
	const pathOf = (href: string) => new URL(href, home).pathname;

	const expectOk = (res: DAVResponse[], what: string) => {
		const bad = res.find((r) => !r.ok && r.status !== 404);
		if (bad) throw new DavError(`${what}: HTTP ${bad.status} ${bad.statusText}`);
	};

	async function listCalendars(): Promise<RemoteCalendar[]> {
		const res = await propfind({
			url: home,
			depth: '1',
			props: {
				'd:displayname': {},
				'd:resourcetype': {},
				'd:current-user-privilege-set': {},
				'c:supported-calendar-component-set': {},
				'cs:getctag': {},
				'ca:calendar-color': {}
			},
			...common
		});
		expectOk(res, 'Kalenderliste');
		return res
			.filter((r) => r.href && hasKey(r.props?.resourcetype, 'calendar'))
			.filter((r) => {
				// Nur Kalender mit Terminen; „Erinnerungen“ sind eigene VTODO-Sammlungen
				const comps = r.props?.supportedCalendarComponentSet?.comp;
				const names = (Array.isArray(comps) ? comps : [comps]).map((c) => c?._attributes?.name);
				return names.includes('VEVENT');
			})
			.map((r) => ({
				url: pathOf(r.href!),
				name: textOf(r.props?.displayname) ?? 'Kalender',
				color: colorOf(r.props?.calendarColor),
				ctag: textOf(r.props?.getctag),
				readOnly: !hasKey(r.props?.currentUserPrivilegeSet, 'write')
			}));
	}

	return {
		listCalendars,

		async defaultCalendarUrl() {
			try {
				if (!account.principalUrl) return null;
				const [principal] = await propfind({ url: account.principalUrl, depth: '0', props: { 'c:schedule-inbox-URL': {} }, ...common });
				const inbox = textOf(principal?.props?.scheduleInboxURL);
				if (!inbox) return null;
				const [res] = await propfind({ url: abs(inbox), depth: '0', props: { 'c:schedule-default-calendar-URL': {} }, ...common });
				const href = textOf(res?.props?.scheduleDefaultCalendarURL);
				return href ? pathOf(href) : null;
			} catch (e) {
				if (e instanceof AuthError) throw e;
				return null;
			}
		},

		async createCalendar(name, color) {
			const url = abs(`${randomUUID().toUpperCase()}/`);
			const res = await makeCalendar({
				url,
				props: {
					'd:displayname': name,
					'ca:calendar-color': `${color.toUpperCase()}FF`,
					'c:supported-calendar-component-set': { 'c:comp': { _attributes: { name: 'VEVENT' } } }
				},
				...common
			});
			expectOk(res, `Kalender „${name}“ anlegen`);
			const created = (await listCalendars()).find((c) => c.url === pathOf(url));
			if (!created) throw new DavError(`Kalender „${name}“ wurde angelegt, taucht aber nicht in der Liste auf.`);
			return created;
		},

		async changes(calendarUrl, syncToken) {
			const run = (token: string | null) =>
				syncCollection({ url: abs(calendarUrl), props: { 'd:getetag': {} }, syncLevel: 1, syncToken: token ?? '', ...common });
			let full = !syncToken;
			let res = await run(syncToken);
			// Ungültiger Token: iCloud antwortet mit 403 und <valid-sync-token/> → alles neu holen
			if (res.length === 1 && !res[0].ok && typeof res[0].raw === 'string' && res[0].raw.includes('valid-sync-token')) {
				full = true;
				res = await run(null);
			}
			if (res.length === 1 && !res[0].ok && !res[0].href?.endsWith('.ics')) throw new DavError(`Änderungen abfragen: HTTP ${res[0].status}`);

			const changed: Changes['changed'] = [];
			const deleted: string[] = [];
			for (const r of res) {
				if (!r.href) continue;
				const href = pathOf(r.href);
				if (href === calendarUrl || href.endsWith('/')) continue; // iCloud listet die Collection selbst mit auf
				if (r.status === 404) deleted.push(href);
				else {
					const etag = textOf(r.props?.getetag);
					if (etag) changed.push({ href, etag });
				}
			}
			return { changed, deleted, token: textOf(res[0]?.raw?.multistatus?.syncToken), full };
		},

		async fetch(calendarUrl, hrefs) {
			const out: RemoteObject[] = [];
			for (let i = 0; i < hrefs.length; i += 50) {
				const res = await calendarMultiGet({
					url: abs(calendarUrl),
					props: { 'd:getetag': {}, 'c:calendar-data': {} },
					objectUrls: hrefs.slice(i, i + 50),
					depth: '1',
					...common
				});
				expectOk(res, 'Termine laden');
				for (const r of res) {
					const data = textOf(r.props?.calendarData);
					const etag = textOf(r.props?.getetag);
					if (r.href && data && etag) out.push({ href: pathOf(r.href), etag, data });
				}
			}
			return out;
		},

		async put(href, data, etag) {
			const ical = { ...headers, 'content-type': 'text/calendar; charset=utf-8' };
			const res = etag
				? await updateObject({ url: abs(href), data, etag, headers: ical, fetch: common.fetch })
				: await createObject({ url: abs(href), data, headers: { ...ical, 'If-None-Match': '*' }, fetch: common.fetch });
			if (res.status === 412) return { status: 'conflict' };
			if (!res.ok) throw new DavError(`Termin übertragen: HTTP ${res.status} ${res.statusText}`);
			return { status: 'ok', etag: res.headers.get('etag') };
		},

		async remove(href, etag) {
			const res = await deleteObject({ url: abs(href), etag: etag ?? undefined, headers, fetch: common.fetch });
			if (res.status === 404) return 'gone';
			if (res.status === 412) return 'conflict';
			if (!res.ok) throw new DavError(`Termin löschen: HTTP ${res.status} ${res.statusText}`);
			return 'ok';
		}
	};
}
