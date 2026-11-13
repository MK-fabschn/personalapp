import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db, t } from './db';
import { addDays } from '#lib/format.js';

/** Aktive Habits inkl. Status für `date`, Streak und den letzten 7 Tagen */
export async function habitsForDate(date: string) {
	const habits = await db.select().from(t.habits).where(eq(t.habits.active, true)).orderBy(asc(t.habits.sort), asc(t.habits.id));
	const from = addDays(date, -365);
	const logs = await db
		.select()
		.from(t.habitLogs)
		.where(and(gte(t.habitLogs.date, from), lte(t.habitLogs.date, date)));

	const byHabit = new Map<number, Set<string>>();
	for (const l of logs) {
		if (!byHabit.has(l.habitId)) byHabit.set(l.habitId, new Set());
		byHabit.get(l.habitId)!.add(l.date);
	}

	return habits.map((h) => {
		const days = byHabit.get(h.id) ?? new Set<string>();
		const done = days.has(date);
		// Streak: zählt ab heute bzw. – falls heute noch offen – ab gestern
		let streak = 0;
		let d = done ? date : addDays(date, -1);
		while (days.has(d)) {
			streak++;
			d = addDays(d, -1);
		}
		const week = Array.from({ length: 7 }, (_, i) => {
			const day = addDays(date, i - 6);
			return { day, done: days.has(day) };
		});
		return { ...h, done, streak, week };
	});
}

export async function toggleHabit(habitId: number, date: string, done: boolean) {
	if (done) await db.insert(t.habitLogs).values({ habitId, date }).onConflictDoNothing();
	else await db.delete(t.habitLogs).where(and(eq(t.habitLogs.habitId, habitId), eq(t.habitLogs.date, date)));
}
