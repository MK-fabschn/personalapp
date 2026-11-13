import { fail } from '@sveltejs/kit';
import { and, eq, gte, lt } from 'drizzle-orm';
import { db, t } from '#lib/server/db/index.js';
import { eventsBetween } from '#lib/server/calendar.js';
import { addDays, startOfWeek, today, viennaToDate } from '#lib/format.js';
import type { Actions, PageServerLoad } from './$types';

const validDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const validTime = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);

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

	const [events, todos] = await Promise.all([
		eventsBetween(from, to),
		db
			.select({ id: t.todos.id, title: t.todos.title, dueDate: t.todos.dueDate, done: t.todos.done })
			.from(t.todos)
			.where(and(gte(t.todos.dueDate, from), lt(t.todos.dueDate, to)))
	]);

	return { view, date, from, days, events, todos };
};

export const actions: Actions = {
	add: async ({ request }) => {
		const f = await request.formData();
		const title = String(f.get('title') ?? '').trim();
		const date = validDate(f.get('date'));
		const endDate = validDate(f.get('endDate')) ?? date;
		const allDay = f.get('allDay') === 'on';
		if (!title || !date || !endDate) return fail(400, { error: 'Titel und Datum sind nötig.' });

		let start: Date, end: Date;
		if (allDay) {
			start = viennaToDate(date, '00:00');
			end = viennaToDate(addDays(endDate, 1), '00:00');
		} else {
			const st = validTime(f.get('startTime'));
			const et = validTime(f.get('endTime'));
			if (!st || !et) return fail(400, { error: 'Bitte Start- und Endzeit angeben.' });
			start = viennaToDate(date, st);
			end = viennaToDate(endDate, et);
		}
		if (end <= start) return fail(400, { error: 'Das Ende muss nach dem Beginn liegen.' });

		await db.insert(t.events).values({
			title,
			start,
			end,
			allDay,
			location: String(f.get('location') ?? '').trim() || null,
			notes: String(f.get('notes') ?? '').trim() || null
		});
		// TODO: Hier später den Termin per CalDAV an iCloud übertragen
	},
	delete: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		await db.delete(t.events).where(eq(t.events.id, id));
	}
};
