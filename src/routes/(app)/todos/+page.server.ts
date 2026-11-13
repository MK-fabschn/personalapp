import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, t } from '#lib/server/db/index.js';
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
		const f = await request.formData();
		const title = str(f.get('title'));
		if (!title) return fail(400, { error: 'Titel fehlt.' });
		await db.insert(t.todos).values({
			title,
			notes: str(f.get('notes')),
			dueDate: str(f.get('dueDate')),
			priority: Math.min(3, Math.max(1, Number(f.get('priority')) || 2)),
			categoryId: Number(f.get('categoryId')) || null
		});
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
	deleteCategory: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		await db.delete(t.todoCategories).where(eq(t.todoCategories.id, id));
	}
};
