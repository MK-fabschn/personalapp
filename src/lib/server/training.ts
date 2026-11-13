import { desc, gte } from 'drizzle-orm';
import { db, t } from './db';
import { addDays, localDate, startOfWeek, today } from '#lib/format.js';


/** Wochensummen der letzten `weeks` Wochen (inkl. aktueller) */
export async function weeklyStats(weeks = 12) {
	const firstWeek = addDays(startOfWeek(today()), -(weeks - 1) * 7);
	const acts = await db
		.select()
		.from(t.activities)
		.where(gte(t.activities.startTime, new Date(firstWeek + 'T00:00:00Z')))
		.orderBy(desc(t.activities.startTime));

	const buckets = Array.from({ length: weeks }, (_, i) => ({
		week: addDays(firstWeek, i * 7),
		durationS: 0,
		distanceM: 0,
		count: 0,
		bySport: {} as Record<string, number>
	}));
	for (const a of acts) {
		const w = startOfWeek(localDate(a.startTime));
		const b = buckets.find((x) => x.week === w);
		if (!b) continue;
		b.durationS += a.durationS;
		b.distanceM += a.distanceM ?? 0;
		b.count++;
		b.bySport[a.sport] = (b.bySport[a.sport] ?? 0) + a.durationS;
	}
	return { buckets, recent: acts.slice(0, 15) };
}
