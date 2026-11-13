import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, t } from '#lib/server/db/index.js';
import { habitsForDate, toggleHabit } from '#lib/server/habits.js';
import { today } from '#lib/format.js';
import type { Actions, PageServerLoad } from './$types';

const validDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export const load: PageServerLoad = async ({ url }) => {
	const t0 = today();
	let date = validDate(url.searchParams.get('d')) ?? t0;
	if (date > t0) date = t0;
	const [habits, [entry]] = await Promise.all([
		habitsForDate(date),
		db.select().from(t.journalEntries).where(eq(t.journalEntries.date, date))
	]);
	return { date, isToday: date === t0, habits, entry: entry?.text ?? '' };
};

export const actions: Actions = {
	toggle: async ({ request }) => {
		const f = await request.formData();
		const date = validDate(f.get('date'));
		if (!date) return fail(400);
		await toggleHabit(Number(f.get('habitId')), date, f.get('done') === 'true');
	},
	save: async ({ request }) => {
		const f = await request.formData();
		const date = validDate(f.get('date'));
		if (!date) return fail(400);
		const text = String(f.get('text') ?? '');
		await db
			.insert(t.journalEntries)
			.values({ date, text })
			.onConflictDoUpdate({ target: t.journalEntries.date, set: { text, updatedAt: new Date() } });
		return { saved: true };
	},
	addHabit: async ({ request }) => {
		const f = await request.formData();
		const name = String(f.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Name fehlt.' });
		const icon = String(f.get('icon') ?? '').trim() || '✅';
		await db.insert(t.habits).values({ name, icon, sort: 99 });
	},
	archiveHabit: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		await db.update(t.habits).set({ active: false }).where(eq(t.habits.id, id));
	}
};
