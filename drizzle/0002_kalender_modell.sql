CREATE TABLE "calendars" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#4f46e5' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"caldav_url" text,
	"ctag" text,
	"sync_token" text,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "calendars_caldav_url_unique" UNIQUE("caldav_url")
);
--> statement-breakpoint
CREATE TABLE "school_free_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
-- Von Hand ergänzt: Standardkalender anlegen und bestehende Termine zuordnen,
-- erst danach werden calendar_id und caldav_uid Pflicht.
INSERT INTO "calendars" ("name", "is_default") VALUES ('Kalender', true);--> statement-breakpoint
UPDATE "events" SET "caldav_uid" = gen_random_uuid()::text WHERE "caldav_uid" IS NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "caldav_uid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "calendar_id" integer;--> statement-breakpoint
UPDATE "events" SET "calendar_id" = (SELECT "id" FROM "calendars" WHERE "is_default");--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "calendar_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recurring" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "series_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ical_raw" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "managed_key" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sync_state" text DEFAULT 'dirty' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_calendar_idx" ON "events" USING btree ("calendar_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_managed_key_unique" UNIQUE("managed_key");