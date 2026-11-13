import { expect, test } from 'vitest';
import { testDb } from './db';

const SECHS = ['Feuerwehr', 'Musik', 'Privat', 'Schule', 'Sport', 'Studium'];

test('legt die sechs Kategorien mit Farbe an', async () => {
	const { pg } = await testDb();
	const { rows } = await pg.query<{ name: string; color: string }>('select name, color from todo_categories order by name');
	expect(rows.map((r) => r.name)).toEqual(SECHS);
	for (const r of rows) expect(r.color).toMatch(/^#[0-9a-f]{6}$/);
});

test('ersetzt Beispiel-Kategorien, lässt verwendete und gleichnamige aber stehen', async () => {
	const { pg, migrateRest } = await testDb({ upTo: '0000' });
	await pg.exec(`insert into todo_categories (name, color) values ('Arbeit', '#111111'), ('Uni', '#222222'), ('schule', '#333333');
		insert into todos (title, category_id) values ('Skriptum', 2), ('Hausübung', 3), ('Ohne', null)`);
	await migrateRest();

	const cats = (await pg.query<{ name: string; color: string }>('select name, color from todo_categories order by lower(name)')).rows;
	// „Arbeit“ war unbenutzt → weg. „Uni“ hat ein To-Do → bleibt. „schule“ gibt es schon → kein Duplikat, Farbe bleibt.
	expect(cats.map((c) => c.name)).toEqual(['Feuerwehr', 'Musik', 'Privat', 'schule', 'Sport', 'Studium', 'Uni']);
	expect(cats.find((c) => c.name === 'schule')!.color).toBe('#333333');

	const todos = (await pg.query<{ title: string; cat: string | null }>(
		'select t.title, c.name as cat from todos t left join todo_categories c on c.id = t.category_id order by t.id'
	)).rows;
	expect(todos).toEqual([
		{ title: 'Skriptum', cat: 'Uni' },
		{ title: 'Hausübung', cat: 'schule' },
		{ title: 'Ohne', cat: null }
	]);
});
