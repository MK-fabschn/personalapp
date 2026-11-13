// Liest und prüft die Formulare für Termine und To-Dos (Anlegen und Bearbeiten teilen sich die Regeln).
import { addDays, viennaToDate } from '#lib/format.js';
import type { EventWrite } from './calendar';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.trim() ? v.trim() : null);
export const validDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const validTime = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);

export function parseEventForm(f: FormData): Result<EventWrite> {
	const title = text(f.get('title'));
	const date = validDate(f.get('date'));
	const endDate = validDate(f.get('endDate')) ?? date;
	const allDay = f.get('allDay') === 'on';
	if (!title || !date || !endDate) return { ok: false, error: 'Titel und Datum sind nötig.' };

	let start: Date, end: Date;
	if (allDay) {
		start = viennaToDate(date, '00:00');
		end = viennaToDate(addDays(endDate, 1), '00:00');
	} else {
		const st = validTime(f.get('startTime'));
		const et = validTime(f.get('endTime'));
		if (!st || !et) return { ok: false, error: 'Bitte Start- und Endzeit angeben.' };
		start = viennaToDate(date, st);
		end = viennaToDate(endDate, et);
	}
	if (end <= start) return { ok: false, error: 'Das Ende muss nach dem Beginn liegen.' };

	// Wiederholung: keine, wöchentlich (optional bis zu einem Tag) oder unverändert lassen
	const rawRepeat = f.get('repeat');
	const repeat = rawRepeat === 'weekly' || rawRepeat === 'keep' ? rawRepeat : 'none';
	const until = repeat === 'weekly' ? validDate(f.get('until')) : null;
	if (until && until < date) return { ok: false, error: 'Die Serie muss nach dem ersten Termin enden.' };

	return {
		ok: true,
		value: {
			title,
			start,
			end,
			allDay,
			location: text(f.get('location')),
			notes: text(f.get('notes')),
			calendarId: Number(f.get('calendarId')) || null,
			repeat,
			until
		}
	};
}

export type TodoInput = {
	title: string;
	notes: string | null;
	dueDate: string | null;
	priority: number;
	categoryId: number | null;
};

export function parseTodoForm(f: FormData): Result<TodoInput> {
	const title = text(f.get('title'));
	if (!title) return { ok: false, error: 'Titel fehlt.' };
	const rawDue = text(f.get('dueDate'));
	const dueDate = validDate(rawDue);
	if (rawDue && !dueDate) return { ok: false, error: 'Das Fälligkeitsdatum ist ungültig.' };
	return {
		ok: true,
		value: {
			title,
			notes: text(f.get('notes')),
			dueDate,
			priority: Math.min(3, Math.max(1, Number(f.get('priority')) || 2)),
			categoryId: Number(f.get('categoryId')) || null
		}
	};
}
