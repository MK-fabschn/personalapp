import { and, asc, gt, lt } from 'drizzle-orm';
import { db, t } from './db';
import { viennaToDate } from '#lib/format.js';

/** Termine, die den Zeitraum [fromIso, toIso) (Wiener Tage) berühren */
export async function eventsBetween(fromIso: string, toIso: string) {
	return db
		.select()
		.from(t.events)
		.where(and(lt(t.events.start, viennaToDate(toIso, '00:00')), gt(t.events.end, viennaToDate(fromIso, '00:00'))))
		.orderBy(asc(t.events.start));
}
