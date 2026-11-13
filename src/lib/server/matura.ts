// Matura- und MedAT-Termine 2027: werden einmal eingetragen und sind danach normale Termine,
// die sich im Kalender ändern lassen (einige Daten sind noch Platzhalter).
import { eq } from 'drizzle-orm';
import * as t from './db/schema';
import type { Db } from './db/types';
import { createEvent, ensureCalendar } from './calendar';
import { addDays, viennaToDate } from '#lib/format.js';

const SEEDED_KEY = 'matura_2027_seeded';

type Seed = {
	key: string;
	title: string;
	/** erster und letzter Tag (YYYY-MM-DD) */
	from: string;
	to?: string;
	/** Uhrzeit von–bis; ohne Angabe ganztägig */
	time?: [string, string];
	notes?: string;
	/** `standard` = Standardkalender statt „Matura“ */
	calendar?: 'standard';
};

const UHRZEIT = 'Beginn 08:30 laut Rundschreiben des Vorjahres, für 2027 noch nicht bestätigt.';
const PLATZHALTER = 'Platzhalter: genauer Termin folgt von der Schule.';

// Quellen: Karte „Kalender-Sync“ und Recherche „Matura-Termine 2027 und schulfreie Tage“ (BGBl. II Nr. 19/2025)
export const MATURA_2027: Seed[] = [
	{ key: 'matura:deutsch', title: 'Matura schriftlich: Deutsch', from: '2027-05-05', time: ['08:30', '13:30'], notes: `Arbeitszeit 300 min. ${UHRZEIT}` },
	{
		key: 'matura:mathematik',
		title: 'Matura schriftlich: Angewandte Mathematik',
		from: '2027-05-10',
		time: ['08:30', '13:00'],
		notes: `Arbeitszeit 270 min. ${UHRZEIT}`
	},
	{ key: 'matura:englisch', title: 'Matura schriftlich: Englisch', from: '2027-05-11', time: ['08:30', '13:30'], notes: `Arbeitszeit 300 min. ${UHRZEIT}` },
	{
		key: 'matura:fachklausur',
		title: 'Fachklausur Medientechnik + Web- & Applikationsentwicklung',
		from: '2027-05-13',
		notes: 'Uhrzeit gibt die Schule bekannt.'
	},
	{ key: 'matura:da-praesentation', title: 'Diplomarbeit: Präsentation', from: '2027-05-25', to: '2027-05-26', notes: PLATZHALTER },
	{ key: 'matura:muendlich', title: 'Matura mündlich', from: '2027-06-14', to: '2027-06-18', notes: PLATZHALTER },
	{ key: 'medat', title: 'MedAT', from: '2027-07-09', calendar: 'standard' }
];

/** Trägt die Termine beim ersten Start ein. Später gelöschte oder geänderte Termine bleiben, wie sie sind. */
export async function ensureMatura(db: Db): Promise<void> {
	const [seeded] = await db.select().from(t.settings).where(eq(t.settings.key, SEEDED_KEY));
	if (seeded) return;
	const matura = await ensureCalendar(db, 'Matura', '#ef4444');

	for (const s of MATURA_2027) {
		const [exists] = await db.select({ id: t.events.id }).from(t.events).where(eq(t.events.managedKey, s.key));
		if (exists) continue;
		const lastDay = s.to ?? s.from;
		await createEvent(
			db,
			{
				title: s.title,
				start: viennaToDate(s.from, s.time?.[0] ?? '00:00'),
				end: s.time ? viennaToDate(lastDay, s.time[1]) : viennaToDate(addDays(lastDay, 1), '00:00'),
				allDay: !s.time,
				location: null,
				notes: s.notes ?? null,
				calendarId: s.calendar === 'standard' ? null : matura.id,
				repeat: 'none',
				until: null
			},
			{ managedKey: s.key }
		);
	}
	await db.insert(t.settings).values({ key: SEEDED_KEY, value: true }).onConflictDoNothing();
}
