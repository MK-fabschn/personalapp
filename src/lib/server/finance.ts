import { asc, eq, sql } from 'drizzle-orm';
import { db, t } from './db';

/** Alle Konten mit aktuellem Kontostand in Cent */
export async function accountsWithBalance() {
	return db
		.select({
			id: t.accounts.id,
			name: t.accounts.name,
			kind: t.accounts.kind,
			color: t.accounts.color,
			balanceCents: sql<number>`${t.accounts.initialCents} + coalesce(sum(${t.transactions.amountCents}), 0)`.mapWith(Number)
		})
		.from(t.accounts)
		.leftJoin(t.transactions, eq(t.transactions.accountId, t.accounts.id))
		.groupBy(t.accounts.id)
		.orderBy(asc(t.accounts.sort), asc(t.accounts.id));
}
