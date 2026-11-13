CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'bank' NOT NULL,
	"color" text DEFAULT '#10b981' NOT NULL,
	"initial_cents" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"garmin_id" text,
	"name" text,
	"sport" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"duration_s" integer NOT NULL,
	"distance_m" integer,
	"elevation_m" integer,
	"avg_hr" integer,
	"max_hr" integer,
	"avg_power_w" integer,
	"calories" integer,
	CONSTRAINT "activities_garmin_id_unique" UNIQUE("garmin_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"notes" text,
	"caldav_uid" text,
	"caldav_href" text,
	"caldav_etag" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_caldav_uid_unique" UNIQUE("caldav_uid")
);
--> statement-breakpoint
CREATE TABLE "habit_logs" (
	"habit_id" integer NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "habit_logs_habit_id_date_pk" PRIMARY KEY("habit_id","date")
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT '✅' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"date" date PRIMARY KEY NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "todo_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6366f1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_date" date,
	"priority" integer DEFAULT 2 NOT NULL,
	"category_id" integer,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"transfer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_category_id_todo_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."todo_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_start_idx" ON "activities" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "events_start_idx" ON "events" USING btree ("start");--> statement-breakpoint
CREATE INDEX "todos_due_idx" ON "todos" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tx_account_date_idx" ON "transactions" USING btree ("account_id","date");