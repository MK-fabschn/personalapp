// Schul-Block und Schulweg: wöchentliche Serien im Kalender „Schule“, erzeugt aus den Einstellungen.
// Schulfreie Tage werden als Ausnahmen in die Serien geschrieben, damit sie auch am iPhone fehlen.
import { eq } from 'drizzle-orm';
import * as t from './db/schema';
import type { Db } from './db/types';
import { ensureCalendar, listFreeDays, removeManaged, upsertManaged, type EventWrite } from './calendar';
import { addDays, today, viennaToDate } from '#lib/format.js';

/** Zeiten eines Schultags (HH:MM, Wiener Zeit) */
export type SchoolDay = {
	/** Abfahrt in der Früh */
	leave: string;
	/** Schulbeginn */
	start: string;
	/** Schulschluss */
	end: string;
	/** Ankunft daheim */
	home: string;
};

export type SchoolSettings = {
	/** ab diesem Tag gibt es die Serien (YYYY-MM-DD) */
	from: string;
	/** letzter Unterrichtstag (YYYY-MM-DD) */
	lastDay: string;
	/** Montag bis Freitag */
	days: [SchoolDay, SchoolDay, SchoolDay, SchoolDay, SchoolDay];
};

export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'] as const;
const KEY = 'school';
const SEEDED_KEY = 'school_free_days_seeded';
const short = { leave: '06:15', start: '08:00', end: '13:10', home: '15:15' };

/** Zeiten laut Karte; letzter Unterrichtstag voraussichtlich 30.04.2027 (Recherche „Matura-Termine 2027“) */
export const defaultSchoolSettings = (from: string): SchoolSettings => ({
	from,
	lastDay: '2027-04-30',
	days: [
		{ leave: '06:15', start: '08:00', end: '16:00', home: '18:15' },
		{ leave: '06:15', start: '08:00', end: '16:50', home: '19:15' },
		{ ...short },
		{ ...short },
		{ ...short }
	]
});

/** Schulfreie Tage in Kärnten 2026/27 bis zum letzten Unterrichtstag (Recherche „Matura-Termine 2027“) */
const FREE_DAYS_2026_27 = [
	{ from: '2026-12-08', to: '2026-12-08', label: 'Mariä Empfängnis' },
	{ from: '2026-12-24', to: '2027-01-06', label: 'Weihnachtsferien' },
	{ from: '2027-02-08', to: '2027-02-13', label: 'Semesterferien' },
	{ from: '2027-03-19', to: '2027-03-19', label: 'Josefitag' },
	{ from: '2027-03-20', to: '2027-03-29', label: 'Osterferien' }
];

const time = (v: unknown) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Prüft die Eingabe aus dem Formular. Liefert eine Fehlermeldung oder die Einstellungen. */
export function validateSchoolSettings(input: unknown): { ok: true; value: SchoolSettings } | { ok: false; error: string } {
	const s = input as Partial<SchoolSettings> | null;
	const from = date(s?.from);
	const lastDay = date(s?.lastDay);
	if (!from || !lastDay) return { ok: false, error: 'Bitte den letzten Unterrichtstag angeben.' };
	if (!Array.isArray(s?.days) || s.days.length !== 5) return { ok: false, error: 'Es fehlen Zeiten für einen Wochentag.' };
	const days: SchoolDay[] = [];
	for (const [i, d] of s.days.entries()) {
		const leave = time(d?.leave);
		const start = time(d?.start);
		const end = time(d?.end);
		const home = time(d?.home);
		if (!leave || !start || !end || !home) return { ok: false, error: `${WEEKDAYS[i]}: Bitte alle vier Uhrzeiten angeben.` };
		if (!(leave < start && start < end && end < home)) {
			return { ok: false, error: `${WEEKDAYS[i]}: Die Zeiten müssen aufsteigend sein (Abfahrt, Schulbeginn, Schulschluss, Ankunft daheim).` };
		}
		days.push({ leave, start, end, home });
	}
	return { ok: true, value: { from, lastDay, days: days as SchoolSettings['days'] } };
}

export async function getSchoolSettings(db: Db): Promise<SchoolSettings | null> {
	const [row] = await db.select().from(t.settings).where(eq(t.settings.key, KEY));
	const r = row ? validateSchoolSettings(row.value) : null;
	return r?.ok ? r.value : null;
}

const put = (db: Db, key: string, value: unknown) =>
	db.insert(t.settings).values({ key, value }).onConflictDoUpdate({ target: t.settings.key, set: { value } });

/** Erster Tag ab `from`, der auf den Wochentag fällt (0 = Montag) */
function firstOn(from: string, weekday: number): string {
	const wd = (new Date(from + 'T12:00:00Z').getUTCDay() + 6) % 7;
	return addDays(from, (weekday - wd + 7) % 7);
}

/** Alle schulfreien Tage auf diesem Wochentag zwischen erstem Termin und letztem Unterrichtstag */
function skipDaysFor(first: string, lastDay: string, free: { from: string; to: string }[]): string[] {
	const out: string[] = [];
	for (let d = first; d <= lastDay; d = addDays(d, 7)) if (free.some((f) => f.from <= d && f.to >= d)) out.push(d);
	return out;
}

/**
 * Bringt die 15 Serien (Mo–Fr je Schulweg hin, Schul-Block, Schulweg zurück) auf den Stand der
 * Einstellungen und der schulfreien Tage. Gibt zurück, ob sich etwas geändert hat.
 */
export async function applySchool(db: Db, s: SchoolSettings): Promise<boolean> {
	const cal = await ensureCalendar(db, 'Schule', '#f97316');
	const free = await listFreeDays(db);
	let changed = false;

	for (const [i, day] of s.days.entries()) {
		const first = firstOn(s.from, i);
		const parts = [
			{ key: `schule:hin:${i + 1}`, title: 'Schulweg', from: day.leave, to: day.start },
			{ key: `schule:block:${i + 1}`, title: 'Schule', from: day.start, to: day.end },
			{ key: `schule:rueck:${i + 1}`, title: 'Schulweg', from: day.end, to: day.home }
		];
		for (const p of parts) {
			if (first > s.lastDay) {
				await removeManaged(db, p.key);
				continue;
			}
			const input: EventWrite = {
				title: p.title,
				start: viennaToDate(first, p.from),
				end: viennaToDate(first, p.to),
				allDay: false,
				location: null,
				notes: null,
				calendarId: cal.id,
				repeat: 'weekly',
				until: s.lastDay
			};
			if ((await upsertManaged(db, p.key, input, skipDaysFor(first, s.lastDay, free))) !== 'unchanged') changed = true;
		}
	}
	return changed;
}

/** Einstellungen speichern und die Serien anpassen */
export async function saveSchoolSettings(db: Db, s: SchoolSettings): Promise<boolean> {
	await put(db, KEY, s);
	return applySchool(db, s);
}

/** Nach einer Änderung der schulfreien Tage */
export async function refreshSchool(db: Db): Promise<boolean> {
	const s = await getSchoolSettings(db);
	return s ? applySchool(db, s) : false;
}

/**
 * Beim Start des Servers: beim allerersten Mal die schulfreien Tage und die Standardzeiten eintragen,
 * danach nur noch prüfen, ob die Serien zum gespeicherten Stand passen.
 */
export async function ensureSchool(db: Db): Promise<void> {
	const [seeded] = await db.select().from(t.settings).where(eq(t.settings.key, SEEDED_KEY));
	if (!seeded) {
		const existing = await listFreeDays(db);
		const missing = FREE_DAYS_2026_27.filter((f) => !existing.some((e) => e.from === f.from && e.to === f.to));
		if (missing.length) await db.insert(t.schoolFreeDays).values(missing);
		await put(db, SEEDED_KEY, true);
	}
	const s = (await getSchoolSettings(db)) ?? defaultSchoolSettings(today());
	await saveSchoolSettings(db, s);
}
