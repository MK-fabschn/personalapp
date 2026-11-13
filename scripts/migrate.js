// Führt beim Start alle Datenbank-Migrationen aus und legt beim ersten Mal Standarddaten an.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL ist nicht gesetzt');
	process.exit(1);
}

const sql = postgres(url, { max: 1 });
await migrate(drizzle(sql), { migrationsFolder: './drizzle' });

// Standardkonten und -gewohnheiten nur anlegen, wenn noch leer
const [{ n: accounts }] = await sql`select count(*)::int as n from accounts`;
if (accounts === 0) {
	await sql`insert into accounts (name, kind, color, sort) values
		('Raika', 'bank', '#facc15', 1),
		('Revolut', 'bank', '#3b82f6', 2),
		('Sparkonto', 'savings', '#10b981', 3),
		('Bargeld', 'cash', '#a3a3a3', 4)`;
	console.log('Standardkonten angelegt.');
}
const [{ n: habits }] = await sql`select count(*)::int as n from habits`;
if (habits === 0) {
	await sql`insert into habits (name, icon, sort) values
		('2 l Wasser trinken', '💧', 1),
		('Bewegung / Training', '🏃', 2),
		('Lesen', '📖', 3),
		('Vor 23 Uhr schlafen', '😴', 4)`;
	console.log('Beispiel-Gewohnheiten angelegt.');
}

await sql.end();
console.log('Datenbank ist bereit.');
