import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { db, t } from '#lib/server/db/index.js';
import { eventsBetween } from '#lib/server/calendar.js';
import { accountsWithBalance } from '#lib/server/finance.js';
import { habitsForDate } from '#lib/server/habits.js';
import { weeklyStats } from '#lib/server/training.js';
import { addDays, today } from '#lib/format.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const d = today();
	const [todos, openCount, events, accounts, habits, training, categories] = await Promise.all([
		// Überfällig + heute fällig + hohe Priorität ohne Datum
		db
			.select()
			.from(t.todos)
			.where(and(eq(t.todos.done, false), sql`(${t.todos.dueDate} <= ${addDays(d, 1)} or (${t.todos.dueDate} is null and ${t.todos.priority} = 1))`))
			.orderBy(sql`${t.todos.dueDate} asc nulls last`, asc(t.todos.priority))
			.limit(8),
		db.$count(t.todos, eq(t.todos.done, false)),
		eventsBetween(d, addDays(d, 2)),
		accountsWithBalance(),
		habitsForDate(d),
		weeklyStats(2),
		db.select().from(t.todoCategories)
	]);
	return { today: d, todos, openCount, events, accounts, habits, training: training.buckets, categories };
};
