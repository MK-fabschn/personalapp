# Fabse – persönliches Dashboard

Web-App für **app.fabian-trutschnig.dev**: To-Dos, Kalender, Training, Finanzen und Journal.
Läuft am Handy als installierbare App (PWA) und passt sich automatisch an Hell-/Dunkelmodus an.

**Stack:** SvelteKit 3 · Svelte 5 · TypeScript · Tailwind 4 · Drizzle ORM · PostgreSQL · Docker

## Lokal entwickeln

```bash
npm install
# Postgres lokal starten, z. B.:
docker run -d --name fabse-db -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:17-alpine

export DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres
npm run db:migrate                       # Tabellen + Standardkonten anlegen
npm run hash-password -- "meinPasswort"  # Hash kopieren (für die Shell: $$ wieder zu $ machen)
export APP_PASSWORD_HASH='$argon2id$...'
npm run dev
```

Schema geändert? → `npm run db:generate` erzeugt eine neue Migration in `drizzle/`.

## Auf dem eigenen Server

Läuft auf dem netcup-VPS hinter Traefik und Cloudflare, Deploy automatisch per GitHub Actions
bei jedem Push auf `main`. Einrichtung und Betrieb: siehe **[DEPLOYMENT.md](DEPLOYMENT.md)**.

Am iPhone in Safari öffnen → Teilen → **Zum Home-Bildschirm**.

> HTTPS ist Pflicht: Das Login-Cookie ist `secure` und funktioniert über reines HTTP nur auf `localhost`.

## Kalender-Sync mit iCloud

Mit `ICLOUD_APPLE_ID` und `ICLOUD_APP_PASSWORD` (app-spezifisches Passwort) gleicht der Server alle eigenen
iCloud-Kalender in beide Richtungen ab: alle 5 Minuten, beim Öffnen des Kalenders, nach jeder Änderung und
per Knopf „Jetzt abgleichen“. Bei Konflikten gewinnt die letzte Änderung, Löschen wirkt auf beiden Seiten.
Ohne die beiden Werte läuft die App ohne Abgleich.

Der Dev-Server (`npm run dev`) gleicht absichtlich **nicht** ab, auch wenn die Werte in `.env` stehen,
damit keine Testdaten im echten Konto landen. Wer das will, setzt `ICLOUD_SYNC_IN_DEV=1`.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/lib/server/db/schema.ts` | Datenbankschema für alle Module |
| `src/lib/server/auth.ts` | Login mit Sessions (Token gehasht in der DB, 30 Tage) |
| `src/routes/(app)/` | Seiten: Übersicht, `todos`, `kalender`, `training`, `finanzen`, `journal` |
| `src/lib/server/calendar.ts` | Kalender, Termine, Serien auflösen, schulfreie Tage |
| `src/lib/server/ics.ts` | iCalendar lesen/schreiben |
| `src/lib/server/icloud/` | Sync mit iCloud: `caldav.ts` (Protokoll), `sync.ts` (Abgleich), `index.ts` (Takt und Zustand) |
| `tests/` | Vitest, Datenbank-Tests mit Postgres im Speicher (`npm test`) |
| `src/lib/format.ts` | Datum/Zeit (Europe/Vienna), Euro-Format |
| `scripts/migrate.js` | Migrationen + Startdaten (Raika, Revolut, Sparkonto, Bargeld; Beispiel-Habits) |

## Noch offen

- **Garmin:** Import über die Garmin Personal API in die Tabelle `activities`
