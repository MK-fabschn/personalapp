-- Beispiel-Kategorien ersetzen: unbenutzte fremde Kategorien entfernen,
-- Kategorien mit To-Dos behalten ihre Zuordnung.
DELETE FROM "todo_categories" c
WHERE lower(c."name") NOT IN ('sport', 'schule', 'musik', 'studium', 'privat', 'feuerwehr')
	AND NOT EXISTS (SELECT 1 FROM "todos" t WHERE t."category_id" = c."id");
--> statement-breakpoint
INSERT INTO "todo_categories" ("name", "color")
SELECT v."name", v."color"
FROM (VALUES
	('Sport', '#22c55e'),
	('Schule', '#f97316'),
	('Musik', '#a855f7'),
	('Studium', '#3b82f6'),
	('Privat', '#14b8a6'),
	('Feuerwehr', '#ef4444')
) AS v("name", "color")
WHERE NOT EXISTS (SELECT 1 FROM "todo_categories" c WHERE lower(c."name") = lower(v."name"));
