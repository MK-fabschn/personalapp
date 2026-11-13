// Nachbau von iCloud-CalDAV im Speicher, mit den Eigenheiten aus der Recherche:
// ETags pro Objekt, Sync-Token mit Änderungsliste, 412 bei falschem ETag und bei doppelter UID.
import { buildIcs, parseIcs, type IcsFields } from '../src/lib/server/ics';
import { AuthError, type CalDav, type Changes, type RemoteCalendar } from '../src/lib/server/icloud/caldav';

type Obj = { etag: string; data: string };
type Cal = RemoteCalendar & { objects: Map<string, Obj>; log: { rev: number; href: string }[] };

export class FakeCalDav implements CalDav {
	cals = new Map<string, Cal>();
	defaultUrl: string | null = null;
	rev = 0;
	/** true = Anmeldung schlägt fehl */
	locked = false;
	/** mitgezählte Aufrufe, um unnötige Abfragen zu erkennen */
	calls: string[] = [];

	// ── Hilfen für die Tests („am iPhone“) ──────────────────────────────────

	addCalendar(name: string, opts: { color?: string; readOnly?: boolean } = {}): string {
		const url = `/1/calendars/${name.toLowerCase()}/`;
		this.cals.set(url, { url, name, color: opts.color ?? '#1badf8', ctag: 'c0', readOnly: opts.readOnly ?? false, objects: new Map(), log: [] });
		return url;
	}
	private cal(name: string): Cal {
		const c = [...this.cals.values()].find((x) => x.name === name);
		if (!c) throw new Error(`kein Kalender ${name}`);
		return c;
	}
	private touch(c: Cal, href: string) {
		this.rev++;
		c.ctag = `c${this.rev}`;
		c.log.push({ rev: this.rev, href });
	}
	/** Termin am iPhone anlegen oder ändern */
	phonePut(calName: string, fields: Partial<IcsFields> & { uid: string }): string {
		const c = this.cal(calName);
		const href = `${c.url}${fields.uid}.ics`;
		const old = c.objects.get(href);
		const base = old ? parseIcs(old.data)! : { title: 'Termin', start: new Date('2026-11-20T17:00:00Z'), end: new Date('2026-11-20T18:00:00Z'), allDay: false, location: null, notes: null };
		const data = buildIcs({ ...base, repeat: old ? 'keep' : 'none', ...fields }, old?.data);
		this.touch(c, href);
		c.objects.set(href, { etag: `"e${this.rev}"`, data });
		return href;
	}
	phoneDelete(calName: string, uid: string) {
		const c = this.cal(calName);
		const href = `${c.url}${uid}.ics`;
		c.objects.delete(href);
		this.touch(c, href);
	}
	removeCalendar(name: string) {
		this.cals.delete(this.cal(name).url);
	}
	/** Titel aller Termine eines Kalenders, sortiert */
	titles(calName: string): string[] {
		return [...this.cal(calName).objects.values()].map((o) => parseIcs(o.data)!.title).sort();
	}
	object(calName: string, uid: string) {
		const c = this.cal(calName);
		return c.objects.get(`${c.url}${uid}.ics`);
	}

	// ── CalDav ──────────────────────────────────────────────────────────────

	private guard(call: string) {
		this.calls.push(call);
		if (this.locked) throw new AuthError('iCloud hat die Anmeldung abgelehnt.');
	}
	private byUrl(calendarUrl: string): Cal {
		const c = this.cals.get(calendarUrl);
		if (!c) throw new Error(`404 ${calendarUrl}`);
		return c;
	}
	private owner(href: string): Cal {
		return this.byUrl(href.slice(0, href.lastIndexOf('/') + 1));
	}

	async listCalendars() {
		this.guard('list');
		return [...this.cals.values()].map(({ url, name, color, ctag, readOnly }) => ({ url, name, color, ctag, readOnly }));
	}
	async defaultCalendarUrl() {
		this.guard('default');
		return this.defaultUrl;
	}
	async createCalendar(name: string, color: string) {
		this.guard(`mkcalendar ${name}`);
		const url = this.addCalendar(name, { color });
		const { objects: _o, log: _l, ...cal } = this.cals.get(url)!;
		return cal;
	}
	async changes(calendarUrl: string, syncToken: string | null): Promise<Changes> {
		this.guard(`changes ${calendarUrl}`);
		const c = this.byUrl(calendarUrl);
		const since = syncToken && /^t\d+$/.test(syncToken) ? Number(syncToken.slice(1)) : null;
		const token = `t${this.rev}`;
		if (since === null) {
			return { changed: [...c.objects].map(([href, o]) => ({ href, etag: o.etag })), deleted: [], token, full: true };
		}
		const hrefs = [...new Set(c.log.filter((l) => l.rev > since).map((l) => l.href))];
		return {
			changed: hrefs.filter((h) => c.objects.has(h)).map((href) => ({ href, etag: c.objects.get(href)!.etag })),
			deleted: hrefs.filter((h) => !c.objects.has(h)),
			token,
			full: false
		};
	}
	async fetch(calendarUrl: string, hrefs: string[]) {
		this.guard(`fetch ${hrefs.length}`);
		const c = this.byUrl(calendarUrl);
		return hrefs.filter((h) => c.objects.has(h)).map((href) => ({ href, ...c.objects.get(href)! }));
	}
	async put(href: string, data: string, etag: string | null) {
		this.guard(`put ${href}`);
		const c = this.owner(href);
		if (c.readOnly) throw new Error('403 nur lesbar');
		const old = c.objects.get(href);
		if (etag ? !old || old.etag !== etag : !!old) return { status: 'conflict' as const };
		// iCloud erlaubt jede UID nur einmal im ganzen Konto
		const uid = parseIcs(data)!.uid;
		for (const other of this.cals.values()) {
			for (const [h, o] of other.objects) if (h !== href && parseIcs(o.data)!.uid === uid) return { status: 'conflict' as const };
		}
		this.touch(c, href);
		const next = { etag: `"e${this.rev}"`, data };
		c.objects.set(href, next);
		return { status: 'ok' as const, etag: next.etag };
	}
	async remove(href: string, etag: string | null) {
		this.guard(`delete ${href}`);
		const c = this.owner(href);
		const old = c.objects.get(href);
		if (!old) return 'gone' as const;
		if (etag && old.etag !== etag) return 'conflict' as const;
		c.objects.delete(href);
		this.touch(c, href);
		return 'ok' as const;
	}
}
