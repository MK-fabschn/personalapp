import { fail } from '@sveltejs/kit';
import { and, eq, gte, lt } from 'drizzle-orm';
import { db, t } from '#lib/server/db/index.js';
import {
	CalendarError,
	createEvent,
	deleteEvent,
	eventsBetween,
	freeDaysBetween,
	listCalendars,
	skipEventOccurrence,
	updateEvent
} from '#lib/server/calendar.js';
import { parseEventForm, validDate } from '#lib/server/forms.js';
import { addDays, startOfWeek, today } from '#lib/format.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const view = url.searchParams.get('view') === 'monat' ? 'monat' : 'woche';
	const date = validDate(url.searchParams.get('d')) ?? today();

	let from: string, days: number;
	if (view === 'woche') {
		from = startOfWeek(date);
		days = 7;
	} else {
		from = startOfWeek(date.slice(0, 8) + '01');
		days = 42;
	}
	const to = addDays(from, days);

	const [calendars, events, freeDays, todos] = await Promise.all([
		listCalendars(db),
		eventsBetween(db, from, to),
		freeDaysBetween(db, from, to),
		db
			.select({ id: t.todos.id, title: t.todos.title, dueDate: t.todos.dueDate, done: t.todos.done })
			.from(t.todos)
			.where(and(gte(t.todos.dueDate, from), lt(t.todos.dueDate, to)))
	]);

	return {
		view,
		date,
		from,
		days,
		events,
		freeDays,
		todos,
		calendars: calendars.map(({ id, name, color, visible, readOnly, isDefault }) => ({ id, name, color, visible, readOnly, isDefault }))
	};
};

/** Fachliche Fehler (z. B. nur lesbarer Kalender) als Formularfehler anzeigen */
async function guarded(run: () => Promise<unknown>) {
	try {
		await run();
	} catch (e) {
		if (e instanceof CalendarError) return fail(400, { error: e.message });
		throw e;
	}
}

export const actions: Actions = {
	add: async ({ request }) => {
		const r = parseEventForm(await request.formData());
		if (!r.ok) return fail(400, { error: r.error });
		return guarded(() => createEvent(db, r.value));
	},
	update: async ({ request }) => {
		const f = await request.formData();
		const r = parseEventForm(f);
		if (!r.ok) return fail(400, { error: r.error });
		return guarded(() => updateEvent(db, Number(f.get('id')), r.value));
	},
	delete: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		return guarded(() => deleteEvent(db, id));
	},
	// Nur diesen einen Termin einer Serie auslassen
	skip: async ({ request }) => {
		const f = await request.formData();
		const original = new Date(String(f.get('original')));
		if (Number.isNaN(original.getTime())) return fail(400, { error: 'Ungültiger Termin.' });
		return guarded(() => skipEventOccurrence(db, Number(f.get('id')), original));
	},
	toggleCalendar: async ({ request }) => {
		const f = await request.formData();
		await db
			.update(t.calendars)
			.set({ visible: f.get('visible') === 'true' })
			.where(eq(t.calendars.id, Number(f.get('id'))));
	}
};
