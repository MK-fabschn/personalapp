import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import * as schema from '../src/lib/server/db/schema';

type Journal = { entries: { tag: string }[] };
const journal: Journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));

/** Frische Postgres-Datenbank im Speicher. `upTo` = letzte Migration, die noch läuft (Präfix des Namens). */
export async function testDb(opts: { upTo?: string } = {}) {
	const pg = new PGlite();
	const migrate = async (from: number, to: number) => {
		for (const e of journal.entries.slice(from, to)) {
			const sql = readFileSync(`drizzle/${e.tag}.sql`, 'utf8');
			for (const stmt of sql.split('--> statement-breakpoint')) if (stmt.trim()) await pg.exec(stmt);
		}
	};
	const stop = opts.upTo ? journal.entries.findIndex((e) => e.tag.startsWith(opts.upTo!)) + 1 : journal.entries.length;
	await migrate(0, stop);
	return {
		pg,
		db: drizzle(pg, { schema }),
		/** Restliche Migrationen nachziehen */
		migrateRest: () => migrate(stop, journal.entries.length)
	};
}
