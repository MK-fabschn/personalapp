import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { building } from '$app/env';
import { DATABASE_URL } from '$app/env/private';
import * as schema from './schema';

if (!DATABASE_URL && !building) console.error('⚠️  DATABASE_URL ist nicht gesetzt');

// postgres.js verbindet sich erst bei der ersten Abfrage
const client = postgres(DATABASE_URL ?? 'postgres://localhost/unset');
export const db = drizzle(client, { schema });
export * as t from './schema';
