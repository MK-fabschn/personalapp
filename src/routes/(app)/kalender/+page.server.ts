import { fail } from '@sveltejs/kit';
import { and, eq, gte, lt } from 'drizzle-orm';
import { db, t } from '#lib/server/db/index.js';
import { eventsBetween } from '#lib/server/calendar.js';
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
		const r = parseEventForm(await request.formData());
		if (!r.ok) return fail(400, { error: r.error });
		await db.insert(t.events).values(r.value);
		// TODO: Hier später den Termin per CalDAV an iCloud übertragen
	},
	update: async ({ request }) => {
		const f = await request.formData();
		const r = parseEventForm(f);
		if (!r.ok) return fail(400, { error: r.error });
		await db
			.update(t.events)
			.set({ ...r.value, updatedAt: new Date() })
			.where(eq(t.events.id, Number(f.get('id'))));
	},
	delete: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		await db.delete(t.events).where(eq(t.events.id, id));
	}
};
