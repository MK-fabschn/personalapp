import {
	pgTable,
	serial,
	text,
	integer,
	boolean,
	timestamp,
	date,
	primaryKey,
	index
} from 'drizzle-orm/pg-core';

// ─── Login ────────────────────────────────────────────────────────────────
export const sessions = pgTable('sessions', {
	id: text('id').primaryKey(), // SHA-256-Hash des Cookie-Tokens
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
});

// ─── To-Dos ───────────────────────────────────────────────────────────────
export const todoCategories = pgTable('todo_categories', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	color: text('color').notNull().default('#6366f1')
});

export const todos = pgTable(
	'todos',
	{
		id: serial('id').primaryKey(),
		title: text('title').notNull(),
		notes: text('notes'),
		dueDate: date('due_date'),
		priority: integer('priority').notNull().default(2), // 1 = hoch, 2 = mittel, 3 = niedrig
		categoryId: integer('category_id').references(() => todoCategories.id, { onDelete: 'set null' }),
		done: boolean('done').notNull().default(false),
		doneAt: timestamp('done_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('todos_due_idx').on(t.dueDate)]
);

// ─── Kalender ─────────────────────────────────────────────────────────────
// Lokale Kopie; caldav*-Felder sind für den iCloud-Sync vorgesehen.
export const events = pgTable(
	'events',
	{
		id: serial('id').primaryKey(),
		title: text('title').notNull(),
		start: timestamp('start', { withTimezone: true }).notNull(),
		end: timestamp('end', { withTimezone: true }).notNull(),
		allDay: boolean('all_day').notNull().default(false),
		location: text('location'),
		notes: text('notes'),
		caldavUid: text('caldav_uid').unique(),
		caldavHref: text('caldav_href'),
		caldavEtag: text('caldav_etag'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('events_start_idx').on(t.start)]
);

// ─── Finanzen ─────────────────────────────────────────────────────────────
// Beträge immer in Cent (Integer), damit keine Rundungsfehler entstehen.
export const accounts = pgTable('accounts', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	kind: text('kind').notNull().default('bank'), // bank | savings | cash
	color: text('color').notNull().default('#10b981'),
	initialCents: integer('initial_cents').notNull().default(0),
	sort: integer('sort').notNull().default(0)
});

export const transactions = pgTable(
	'transactions',
	{
		id: serial('id').primaryKey(),
		accountId: integer('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		date: date('date').notNull(),
		amountCents: integer('amount_cents').notNull(), // + Einnahme, − Ausgabe
		description: text('description').notNull(),
		category: text('category'),
		transferId: text('transfer_id'), // verbindet beide Buchungen einer Umbuchung
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('tx_account_date_idx').on(t.accountId, t.date)]
);

// ─── Training ─────────────────────────────────────────────────────────────
// Wird später über die Garmin Personal API befüllt (garminId = Garmin-Aktivitäts-ID).
export const activities = pgTable(
	'activities',
	{
		id: serial('id').primaryKey(),
		garminId: text('garmin_id').unique(),
		name: text('name'),
		sport: text('sport').notNull(), // running | cycling | virtual_ride | ...
		startTime: timestamp('start_time', { withTimezone: true }).notNull(),
		durationS: integer('duration_s').notNull(),
		distanceM: integer('distance_m'),
		elevationM: integer('elevation_m'),
		avgHr: integer('avg_hr'),
		maxHr: integer('max_hr'),
		avgPowerW: integer('avg_power_w'),
		calories: integer('calories')
	},
	(t) => [index('activities_start_idx').on(t.startTime)]
);

// ─── Journaling ───────────────────────────────────────────────────────────
export const habits = pgTable('habits', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	icon: text('icon').notNull().default('✅'),
	active: boolean('active').notNull().default(true),
	sort: integer('sort').notNull().default(0)
});

export const habitLogs = pgTable(
	'habit_logs',
	{
		habitId: integer('habit_id')
			.notNull()
			.references(() => habits.id, { onDelete: 'cascade' }),
		date: date('date').notNull()
	},
	(t) => [primaryKey({ columns: [t.habitId, t.date] })]
);

export const journalEntries = pgTable('journal_entries', {
	date: date('date').primaryKey(),
	text: text('text').notNull().default(''),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});
