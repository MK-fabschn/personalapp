import { fail } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db, t } from '#lib/server/db/index.js';
import { CalendarError, addFreeDay, deleteFreeDay, listCalendars, listFreeDays, setDefaultCalendar } from '#lib/server/calendar.js';
import { validDate } from '#lib/server/forms.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [calendars, freeDays] = await Promise.all([listCalendars(db), listFreeDays(db)]);
	return {
		calendars: calendars.map(({ id, name, color, visible, syncEnabled, readOnly, isDefault, caldavUrl }) => ({
			id,
			name,
			color,
			visible,
			syncEnabled,
			readOnly,
			isDefault,
			linked: caldavUrl !== null
		})),
		freeDays
	};
};

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const color = (v: FormDataEntryValue | null) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);

export const actions: Actions = {
	saveCalendar: async ({ request }) => {
		const f = await request.formData();
		const id = Number(f.get('id'));
		await db
			.update(t.calendars)
			.set({ visible: f.get('visible') === 'on', syncEnabled: f.get('syncEnabled') === 'on' })
			.where(eq(t.calendars.id, id));
	},
	setDefault: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		try {
			await setDefaultCalendar(db, id);
		} catch (e) {
			if (e instanceof CalendarError) return fail(400, { error: e.message });
			throw e;
		}
	},
	addCalendar: async ({ request }) => {
		const f = await request.formData();
		const name = text(f.get('name'));
		if (!name) return fail(400, { error: 'Der Kalender braucht einen Namen.' });
		const [same] = await db.select().from(t.calendars).where(eq(t.calendars.name, name));
		if (same) return fail(400, { error: `Einen Kalender „${name}“ gibt es schon.` });
		await db.insert(t.calendars).values({ name, color: color(f.get('color')) ?? '#4f46e5' });
	},
	// Nur Kalender, die es in iCloud (noch) nicht gibt: ein verbundener Kalender wird am iPhone gelöscht.
	deleteCalendar: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		const [cal] = await db.select().from(t.calendars).where(eq(t.calendars.id, id));
		if (!cal) return;
		if (cal.caldavUrl) return fail(400, { error: 'Dieser Kalender ist mit iCloud verbunden. Bitte am iPhone löschen.' });
		if (cal.isDefault) return fail(400, { error: 'Der Standardkalender kann nicht gelöscht werden.' });
		await db.delete(t.calendars).where(and(eq(t.calendars.id, id), isNull(t.calendars.caldavUrl)));
	},
	addFreeDay: async ({ request }) => {
		const f = await request.formData();
		const from = validDate(f.get('from'));
		const to = validDate(f.get('to')) ?? from;
		const label = text(f.get('label'));
		if (!from || !to || !label) return fail(400, { error: 'Bezeichnung und Datum sind nötig.' });
		try {
			await addFreeDay(db, from, to, label);
		} catch (e) {
			if (e instanceof CalendarError) return fail(400, { error: e.message });
			throw e;
		}
	},
	deleteFreeDay: async ({ request }) => {
		await deleteFreeDay(db, Number((await request.formData()).get('id')));
	}
};
