import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/** Datenbank-Zugriff, unabhängig vom Treiber (postgres.js in der App, pglite in den Tests) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
