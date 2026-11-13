import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, t } from '#lib/server/db/index.js';
import { parseTodoForm } from '#lib/server/forms.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const show = url.searchParams.get('show') === 'erledigt' ? 'erledigt' : 'offen';
	const cat = Number(url.searchParams.get('kat')) || null;

	const where = and(eq(t.todos.done, show === 'erledigt'), cat ? eq(t.todos.categoryId, cat) : undefined);
	const todos = await db
		.select()
		.from(t.todos)
		.where(where)
		.orderBy(
			...(show === 'erledigt'
				? [desc(t.todos.doneAt)]
				: [sql`${t.todos.dueDate} asc nulls last`, asc(t.todos.priority), asc(t.todos.createdAt)])
		)
		.limit(200);

	const categories = await db.select().from(t.todoCategories).orderBy(asc(t.todoCategories.name));
	return { todos, categories, show, cat };
};

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const actions: Actions = {
	add: async ({ request }) => {
		const r = parseTodoForm(await request.formData());
		if (!r.ok) return fail(400, { error: r.error });
		await db.insert(t.todos).values(r.value);
	},
	update: async ({ request }) => {
		const f = await request.formData();
		const r = parseTodoForm(f);
		if (!r.ok) return fail(400, { error: r.error });
		await db.update(t.todos).set(r.value).where(eq(t.todos.id, Number(f.get('id'))));
	},
	toggle: async ({ request }) => {
		const f = await request.formData();
		const id = Number(f.get('id'));
		const done = f.get('done') === 'true';
		await db
			.update(t.todos)
			.set({ done, doneAt: done ? new Date() : null })
			.where(eq(t.todos.id, id));
	},
	delete: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		await db.delete(t.todos).where(eq(t.todos.id, id));
	},
	addCategory: async ({ request }) => {
		const f = await request.formData();
		const name = str(f.get('name'));
		if (!name) return fail(400, { error: 'Name fehlt.' });
		await db.insert(t.todoCategories).values({ name, color: str(f.get('color')) ?? '#6366f1' });
	},
	updateCategory: async ({ request }) => {
		const f = await request.formData();
		const id = Number(f.get('id'));
		const name = str(f.get('name'));
		const color = str(f.get('color'));
		if (!name || !color || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(400, { error: 'Name und Farbe sind nötig.' });
		await db.update(t.todoCategories).set({ name, color }).where(eq(t.todoCategories.id, id));
	},
	deleteCategory: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		await db.delete(t.todoCategories).where(eq(t.todoCategories.id, id));
	}
};
