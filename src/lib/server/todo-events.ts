// To-Dos mit Fälligkeit am iPhone: Jedes offene To-Do mit Datum bekommt einen ganztägigen Termin
// im Kalender „To-Dos“. Richtung nur App → iPhone; abgehakt wird in der App.
import { eq, like } from 'drizzle-orm';
import * as t from './db/schema';
import type { Db } from './db/types';
import { ensureCalendar, removeManaged, upsertManaged } from './calendar';
import { addDays, viennaToDate } from '#lib/format.js';

export const TODO_CALENDAR = 'To-Dos';
const keyOf = (todoId: number) => `todo:${todoId}`;

/** Bringt den Termin zu einem To-Do auf den aktuellen Stand. Gibt zurück, ob sich etwas geändert hat. */
export async function mirrorTodo(db: Db, todoId: number): Promise<boolean> {
	const [todo] = await db.select().from(t.todos).where(eq(t.todos.id, todoId));
	if (!todo || todo.done || !todo.dueDate) return removeManaged(db, keyOf(todoId));
	const cal = await ensureCalendar(db, TODO_CALENDAR, '#64748b');
	const result = await upsertManaged(
		db,
		keyOf(todoId),
		{
			title: todo.title,
			start: viennaToDate(todo.dueDate, '00:00'),
			end: viennaToDate(addDays(todo.dueDate, 1), '00:00'),
			allDay: true,
			location: null,
			notes: todo.notes,
			calendarId: cal.id,
			repeat: 'none',
			until: null
		},
		[]
	);
	return result !== 'unchanged';
}

/** Beim Start des Servers: alle To-Dos abgleichen (auch solche aus der Zeit vor dieser Funktion) */
export async function ensureTodoEvents(db: Db): Promise<void> {
	const todos = await db.select({ id: t.todos.id }).from(t.todos);
	const ids = new Set(todos.map((x) => x.id));
	for (const id of ids) await mirrorTodo(db, id);
	// Termine zu To-Dos, die es nicht mehr gibt
	const events = await db.select({ key: t.events.managedKey }).from(t.events).where(like(t.events.managedKey, 'todo:%'));
	for (const e of events) if (!ids.has(Number(e.key!.slice(5)))) await removeManaged(db, e.key!);
}
