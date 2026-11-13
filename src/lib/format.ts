export const TZ = 'Europe/Vienna';

const eur = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' });
export const money = (cents: number) => eur.format(cents / 100);

/** Heutiges Datum in Wien als YYYY-MM-DD */
export function today(): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function addDays(iso: string, days: number): string {
	const d = new Date(iso + 'T12:00:00Z');
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** Montag der Woche, in der iso liegt */
export function startOfWeek(iso: string): string {
	const d = new Date(iso + 'T12:00:00Z');
	const wd = (d.getUTCDay() + 6) % 7; // Mo = 0
	return addDays(iso, -wd);
}

const dfLong = new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dfShort = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const dfWd = new Intl.DateTimeFormat('de-AT', { weekday: 'short', timeZone: 'UTC' });
const dfMonth = new Intl.DateTimeFormat('de-AT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const tf = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

const asDate = (iso: string) => new Date(iso + 'T12:00:00Z');
export const fmtDateLong = (iso: string) => dfLong.format(asDate(iso));
export const fmtDateShort = (iso: string) => dfShort.format(asDate(iso));
export const fmtWeekday = (iso: string) => dfWd.format(asDate(iso));
export const fmtMonth = (iso: string) => dfMonth.format(asDate(iso));
export const fmtTime = (d: Date | string) => tf.format(new Date(d));

/** Datum (YYYY-MM-DD) eines Zeitpunkts in Wiener Zeit */
export function localDate(d: Date | string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
}

/** Minuten seit Mitternacht (Wiener Zeit) */
export function localMinutes(d: Date | string): number {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(new Date(d));
	const h = Number(parts.find((p) => p.type === 'hour')?.value);
	const m = Number(parts.find((p) => p.type === 'minute')?.value);
	return h * 60 + m;
}

/** "2026-11-13" + "14:30" (Wiener Zeit) → Date */
export function viennaToDate(dateIso: string, time: string): Date {
	// Offset für diesen Tag ermitteln (berücksichtigt Sommer-/Winterzeit)
	const guess = new Date(`${dateIso}T${time}:00Z`);
	const offsetMin = (localMinutes(guess) - (guess.getUTCHours() * 60 + guess.getUTCMinutes()) + 1440) % 1440;
	const signed = offsetMin > 720 ? offsetMin - 1440 : offsetMin;
	return new Date(guess.getTime() - signed * 60000);
}

export function duration(s: number): string {
	const h = Math.floor(s / 3600);
	const m = Math.round((s % 3600) / 60);
	return h ? `${h} h ${m.toString().padStart(2, '0')} min` : `${m} min`;
}

export const PRIORITIES = [
	{ value: 1, label: 'Hoch', cls: 'text-neg' },
	{ value: 2, label: 'Mittel', cls: 'text-amber-500' },
	{ value: 3, label: 'Niedrig', cls: 'text-muted' }
] as const;
