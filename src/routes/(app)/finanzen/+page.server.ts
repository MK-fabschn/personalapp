import { fail } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db, t } from '#lib/server/db/index.js';
import { accountsWithBalance } from '#lib/server/finance.js';
import { today } from '#lib/format.js';
import type { Actions, PageServerLoad } from './$types';

/** "12,50" / "12.50" / "-3" → Cent */
function parseCents(v: FormDataEntryValue | null): number | null {
	if (typeof v !== 'string') return null;
	const n = Number(v.replace(/\s/g, '').replace(',', '.'));
	return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const str = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const load: PageServerLoad = async ({ url }) => {
	const m = url.searchParams.get('m');
	const month = m && /^\d{4}-\d{2}$/.test(m) ? m : today().slice(0, 7);
	const from = `${month}-01`;
	const [y, mo] = month.split('-').map(Number);
	const to = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10); // 1. des Folgemonats

	const inMonth = and(gte(t.transactions.date, from), lt(t.transactions.date, to));
	// Umbuchungen und Korrekturen zählen nicht als Einnahme/Ausgabe
	const realFlow = and(isNull(t.transactions.transferId), sql`coalesce(${t.transactions.category}, '') <> 'Korrektur'`);

	const [accounts, txs, sums, byCategory] = await Promise.all([
		accountsWithBalance(),
		db
			.select({
				id: t.transactions.id,
				date: t.transactions.date,
				amountCents: t.transactions.amountCents,
				description: t.transactions.description,
				category: t.transactions.category,
				transferId: t.transactions.transferId,
				accountId: t.transactions.accountId
			})
			.from(t.transactions)
			.where(inMonth)
			.orderBy(desc(t.transactions.date), desc(t.transactions.id)),
		// Einnahmen/Ausgaben ohne Umbuchungen
		db
			.select({
				income: sql<number>`coalesce(sum(case when ${t.transactions.amountCents} > 0 then ${t.transactions.amountCents} end), 0)`.mapWith(Number),
				expense: sql<number>`coalesce(sum(case when ${t.transactions.amountCents} < 0 then ${t.transactions.amountCents} end), 0)`.mapWith(Number)
			})
			.from(t.transactions)
			.where(and(inMonth, realFlow)),
		db
			.select({
				category: sql<string>`coalesce(${t.transactions.category}, 'Sonstiges')`,
				cents: sql<number>`sum(${t.transactions.amountCents})`.mapWith(Number)
			})
			.from(t.transactions)
			.where(and(inMonth, realFlow, lt(t.transactions.amountCents, 0)))
			.groupBy(sql`1`)
			.orderBy(sql`2 asc`)
	]);

	const categories = await db
		.selectDistinct({ c: t.transactions.category })
		.from(t.transactions)
		.where(sql`${t.transactions.category} is not null`);

	return {
		month,
		accounts,
		txs,
		income: sums[0]?.income ?? 0,
		expense: sums[0]?.expense ?? 0,
		byCategory,
		knownCategories: categories.map((c) => c.c!).sort()
	};
};

export const actions: Actions = {
	addTx: async ({ request }) => {
		const f = await request.formData();
		const cents = parseCents(f.get('amount'));
		const accountId = Number(f.get('accountId'));
		const description = str(f.get('description'));
		if (!cents || cents <= 0) return fail(400, { error: 'Bitte einen Betrag größer 0 eingeben.' });
		if (!accountId || !description) return fail(400, { error: 'Konto und Beschreibung sind nötig.' });
		await db.insert(t.transactions).values({
			accountId,
			date: str(f.get('date')) ?? today(),
			amountCents: f.get('type') === 'in' ? cents : -cents,
			description,
			category: str(f.get('category'))
		});
	},
	transfer: async ({ request }) => {
		const f = await request.formData();
		const cents = parseCents(f.get('amount'));
		const fromId = Number(f.get('from'));
		const toId = Number(f.get('to'));
		if (!cents || cents <= 0) return fail(400, { error: 'Bitte einen Betrag größer 0 eingeben.' });
		if (!fromId || !toId || fromId === toId) return fail(400, { error: 'Bitte zwei verschiedene Konten wählen.' });
		const transferId = randomUUID();
		const date = str(f.get('date')) ?? today();
		const description = str(f.get('description')) ?? 'Umbuchung';
		await db.insert(t.transactions).values([
			{ accountId: fromId, date, amountCents: -cents, description, transferId, category: 'Umbuchung' },
			{ accountId: toId, date, amountCents: cents, description, transferId, category: 'Umbuchung' }
		]);
	},
	deleteTx: async ({ request }) => {
		const f = await request.formData();
		const id = Number(f.get('id'));
		const [tx] = await db.select().from(t.transactions).where(eq(t.transactions.id, id));
		if (!tx) return;
		// Bei Umbuchungen beide Seiten löschen
		if (tx.transferId) await db.delete(t.transactions).where(eq(t.transactions.transferId, tx.transferId));
		else await db.delete(t.transactions).where(eq(t.transactions.id, id));
	},
	/** Kontostand abgleichen: legt eine Korrekturbuchung mit der Differenz an */
	setBalance: async ({ request }) => {
		const f = await request.formData();
		const accountId = Number(f.get('accountId'));
		const target = parseCents(f.get('balance'));
		if (!accountId || target === null) return fail(400, { error: 'Ungültiger Kontostand.' });
		const acc = (await accountsWithBalance()).find((a) => a.id === accountId);
		if (!acc) return fail(404, { error: 'Konto nicht gefunden.' });
		const diff = target - acc.balanceCents;
		if (diff === 0) return;
		await db.insert(t.transactions).values({
			accountId,
			date: today(),
			amountCents: diff,
			description: 'Kontostand abgeglichen',
			category: 'Korrektur'
		});
	},
	addAccount: async ({ request }) => {
		const f = await request.formData();
		const name = str(f.get('name'));
		if (!name) return fail(400, { error: 'Name fehlt.' });
		await db.insert(t.accounts).values({
			name,
			kind: str(f.get('kind')) ?? 'bank',
			color: str(f.get('color')) ?? '#10b981',
			initialCents: parseCents(f.get('initial')) ?? 0,
			sort: 99
		});
	}
};
