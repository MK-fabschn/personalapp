import { expect, test } from 'vitest';
import { parseEventForm, parseTodoForm } from '../src/lib/server/forms';

const form = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.set(k, v);
	return f;
};

test('Termin mit Uhrzeit: Wiener Zeit wird zu UTC', () => {
	const r = parseEventForm(form({ title: ' Probe ', date: '2026-11-20', startTime: '18:00', endTime: '19:30', location: 'Musikheim', notes: '' }));
	expect(r).toEqual({
		ok: true,
		value: {
			title: 'Probe',
			start: new Date('2026-11-20T17:00:00Z'),
			end: new Date('2026-11-20T18:30:00Z'),
			allDay: false,
			location: 'Musikheim',
			notes: null
		}
	});
});

test('ganztägig über mehrere Tage: Ende ist Mitternacht nach dem letzten Tag', () => {
	const r = parseEventForm(form({ title: 'Ausflug', date: '2027-06-14', endDate: '2027-06-18', allDay: 'on' }));
	expect(r.ok && [r.value.start, r.value.end, r.value.allDay]).toEqual([new Date('2027-06-13T22:00:00Z'), new Date('2027-06-18T22:00:00Z'), true]);
});

test('Termin: Fehler bei fehlendem Titel, fehlender Zeit und Ende vor Beginn', () => {
	expect(parseEventForm(form({ title: '', date: '2026-11-20', allDay: 'on' }))).toEqual({ ok: false, error: 'Titel und Datum sind nötig.' });
	expect(parseEventForm(form({ title: 'x', date: '2026-11-20' }))).toEqual({ ok: false, error: 'Bitte Start- und Endzeit angeben.' });
	expect(parseEventForm(form({ title: 'x', date: '2026-11-20', startTime: '10:00', endTime: '09:00' }))).toEqual({
		ok: false,
		error: 'Das Ende muss nach dem Beginn liegen.'
	});
});

test('To-Do: alle Felder, leere Angaben werden null', () => {
	expect(parseTodoForm(form({ title: ' Üben ', notes: 'Etüde 3', dueDate: '2026-12-01', priority: '1', categoryId: '4' }))).toEqual({
		ok: true,
		value: { title: 'Üben', notes: 'Etüde 3', dueDate: '2026-12-01', priority: 1, categoryId: 4 }
	});
	expect(parseTodoForm(form({ title: 'Üben', notes: '', dueDate: '', priority: '9', categoryId: '' }))).toEqual({
		ok: true,
		value: { title: 'Üben', notes: null, dueDate: null, priority: 3, categoryId: null }
	});
});

test('To-Do: Fehler bei fehlendem Titel und kaputtem Datum', () => {
	expect(parseTodoForm(form({ title: ' ' }))).toEqual({ ok: false, error: 'Titel fehlt.' });
	expect(parseTodoForm(form({ title: 'x', dueDate: '1.12.' }))).toEqual({ ok: false, error: 'Das Fälligkeitsdatum ist ungültig.' });
});
