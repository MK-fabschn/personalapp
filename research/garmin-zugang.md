# Garmin-Datenzugang prüfen

Stand: 13. November 2026. Ticket: „Garmin-Datenzugang prüfen“. Umfang: nur Aktivitäten
(Tabelle `activities` in `src/lib/server/db/schema.ts`), kein Schlaf und keine HRV.

## Kurzantwort

**Ja, die Garmin Connect Personal API gibt es.** Die Behauptung aus dem früheren Chat ist im
Kern richtig, und Garmin bestätigt sie selbst (Primärquellen siehe unten):

- Den Schlüssel erstellt man selbst in den Garmin-Connect-Web-Einstellungen. Es gibt keinen
  Antrag und keine Freigabe.
- Gedacht ist die API für Einzelpersonen, die auf ihre eigenen Daten zugreifen, und
  ausdrücklich nicht für kommerzielle Apps mit mehreren Nutzer:innen.
- Sie liefert Aktivitätsdaten als JSON und als .FIT. Abgerufen wird nur per Pull, Push oder
  Webhooks gibt es nicht.

Das Startdatum nennt Garmin auf keiner der gelesenen Seiten. Der „Oktober“ ist aber plausibel.
Garmins offizielles Python-Repo wurde am **20.10.2026** angelegt (GitHub-API `created_at`), und
die ersten Berichte in Fachblogs stammen vom 21. und 22.10.2026 (Sekundärquelle).

**Empfehlung:** Den Garmin-Sync auf die Personal API bauen, als täglichen bzw. stündlichen
Poll-Job auf dem VPS. Der Schlüssel liegt dann als Secret auf dem Server, das Garmin-Passwort
nicht. Als Rückfallebene dient der manuelle .FIT-Upload.

## 1. Garmin Connect Personal API (offiziell)

### Quellen

| Quelle | Art |
|---|---|
| https://developer.garmin.com/gc-developer-program/personal/personal-faq/ | primär (Garmin) |
| https://developer.garmin.com/gc-developer-program/personal/personal-api/ | primär (Garmin) |
| https://developer.garmin.com/gc-developer-program/overview | primär (Garmin), Stufenvergleich |
| https://github.com/garmin/connect-personal-api-python (v1.0.0, Apache-2.0, „Copyright 2026 Garmin Ltd.“) | primär (Garmin-Code, gelesen im Commit `979e6e9` vom 12.11.2026) |
| https://developer.garmin.com/gc-developer-program/personal/swagger-docs/ | primär. Die Seite rendert per JavaScript, der Abruf lieferte keinen Inhalt. **Nicht gelesen.** |

### Zweck und Bedingungen

- Laut FAQ ist die API für Entwickler:innen, Hobbyist:innen und Einzelpersonen für den
  persönlichen Gebrauch gedacht. Sie ist „not intended for commercial applications serving
  multiple end users“. Das passt genau zu einer selbst gehosteten Single-User-App.
- Beim Erstellen des Schlüssels muss man Nutzungsbedingungen akzeptieren. Deren Wortlaut ist
  auf den öffentlichen Seiten nicht abgebildet. Die FAQ verweist allgemein auf
  https://www.garmin.com/en-US/legal/terms-of-use/ und auf die Markenrichtlinien.
  **Offen:** Vor dem Einbau den Text beim Erstellen des Schlüssels lesen, vor allem zur
  Weitergabe an Dritte und zur KI-Nutzung.
- Die API ist nur lesend. Die Training- und Courses-API gehören zu den Business-Stufen
  (Übersichtsseite, Stufenvergleich).

### Authentifizierung

1. Schlüssel erstellen unter https://connect.garmin.com/app/settings/personalApiToken.
   Die Laufzeit wählt man aus 30, 90 oder 180 Tagen oder einem Jahr. Garmin zeigt den Schlüssel
   **nur einmal** an und schickt etwa eine Woche vor Ablauf eine Erinnerungs-Mail. Löscht man
   den Schlüssel, werden auch alle davon abgeleiteten Tokens ungültig (FAQ).
2. Token holen:
   `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token`
   mit dem Header `Authorization: ApiKey <key>`. Die Antwort ist ein JWT als reiner Text.
   (Quellen: FAQ; Code `auth.py` und `constants.py` im Garmin-Repo.)
3. Das Token gilt **24 Stunden** oder bis der Schlüssel abläuft, je nachdem, was früher eintritt.
   **Refresh-Tokens gibt es nicht**, man fordert einfach ein neues Token an (FAQ). Der
   Garmin-Client erneuert das Token, sobald es noch weniger als eine Stunde gilt.
4. API-Aufrufe gehen an die Basis-URL `https://personal.connectapi.garmin.com` mit dem Header
   `Authorization: Bearer <token>` (`client.py`).

Praktisch heißt das: Die App braucht ein Secret `GARMIN_PERSONAL_API_KEY` und eine
Erinnerung, den Schlüssel spätestens nach einem Jahr zu erneuern. Das geht nur von Hand im
Browser.

### Endpunkte für Aktivitäten

Aus Garmins offiziellem Client (README-Tabelle und `client.py`):

| Zweck | Request |
|---|---|
| Liste/Suche | `GET /activitylist-service/activities/search/activities?start=0&limit=20[&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&activityType=…]` |
| Aktivitätstypen | `GET /activity-service/activity/activityTypes/simple` |
| Detail | `GET /activity-service/activity/{activityId}` |
| Workouts zur Aktivität | `GET /activity-service/activity/{activityId}/workouts` |
| Datei-Download | `GET /download-service/files/activity/{activityId}` liefert ZIP-Bytes (die CLI speichert sie als `activity-<id>.zip`) |

### Formate

- Die Übersichtsseite (primär) nennt für die Personal-Stufe „Activity data (JSON and .FIT)“.
- Der Download kommt laut Garmin-Code als ZIP. Dass darin die .FIT-Datei steckt, ist
  wahrscheinlich, aber nicht an einer echten Antwort geprüft.
- **Unklar:** Liefert die API die *originale* .FIT-Datei oder eine um undokumentierte Felder
  bereinigte? Die5krunner (Sekundärquelle) schreibt: „Garmin has not said whether a personal key
  returns the complete file or the stripped one.“ Für unsere Spalten ist das egal, sie stehen
  alle in den Summary-Daten.
- **Feldnamen (Annahme, nicht geprüft):** Die Pfade gleichen der internen
  Garmin-Connect-Web-API, die auch python-garminconnect nutzt. Deshalb ist anzunehmen, dass die
  Liste die bekannten Felder liefert (`activityId`, `activityName`, `activityType.typeKey`,
  `startTimeGMT`, `duration`, `distance`, `elevationGain`, `averageHR`, `maxHR`, `avgPower`,
  `calories`). Das lässt sich mit einem einzigen Test-Request prüfen, bevor man das Mapping baut.

Mapping auf `activities` (vorläufig):

| Spalte | Garmin-Feld (Annahme) |
|---|---|
| `garmin_id` | `activityId` (als Text) |
| `name` | `activityName` |
| `sport` | `activityType.typeKey`, gemappt auf `running`/`cycling`/`virtual_ride`/… |
| `start_time` | `startTimeGMT` (UTC) |
| `duration_s` | `duration` (Sekunden als Gleitkommazahl, runden) |
| `distance_m` | `distance` (Meter) |
| `elevation_m` | `elevationGain` |
| `avg_hr` / `max_hr` | `averageHR` / `maxHR` |
| `avg_power_w` | `avgPower` |
| `calories` | `calories` |

### Rate Limits, Historie, Push

- **Rate Limits:** Keine Primärquelle nennt welche, weder FAQ noch Übersicht noch Code. Der Code
  behandelt 429 nicht eigens. Bei einem Sync alle 1–6 Stunden mit `startDate` = letzter Sync
  fällt nur eine Handvoll Requests pro Tag an.
- **Historie:** Für die Personal-Stufe nicht dokumentiert. Laut Sekundärquelle hat das ein Leser
  auch noch nicht bestätigt. Ein einmaliger Backfill (seitenweise mit `start`/`limit`) muss sich
  im Test zeigen.
- **Push/Webhook:** Nein. Die Übersicht nennt für Personal „Pull only“. Die Business-Stufen
  Starter (nur Push) und Enterprise (Push oder Ping/Pull) bieten Push.

## 2. Alternativen im Vergleich

| Weg | Aufwand | Risiko | Stabilität | Push/Poll |
|---|---|---|---|---|
| **Personal API** (oben) | gering: ein Fetch-Job in TypeScript, kein Python nötig | Schlüssel (nicht das Passwort) auf dem Server. Er lässt sich sperren, ist nur lesend und läuft ab. ToS-konform | offiziell und versioniert, aber neu (seit Okt. 2026). Rate Limits und Historie nicht dokumentiert | Poll |
| **Garmin Connect Developer Program** (Starter/Enterprise) | hoch: Antrag, Firma bzw. juristische Person, Webhook-Endpunkt | gering, aber für Einzelpersonen nicht vorgesehen. Garmin verweist Einzelpersonen selbst auf die Personal API (Program-FAQ, primär). Laut the5krunner (sekundär) waren Neuanträge ab Mai 2026 rund sieben Monate gesperrt | hoch | Push (Starter), Push oder Ping/Pull (Enterprise) |
| **garth** | – | – | **tot:** Das README sagt „Garth is deprecated and no longer maintained … New logins will not work“, weil Garmin den Login geändert hat (primär: github.com/matin/garth) | – |
| **python-garminconnect** (inoffiziell) | mittel: Python-Sidecar oder Cron auf dem VPS | **Garmin-Passwort bzw. langlebige Tokens auf dem Server**, MFA-Handling nötig. Automatisierter Zugriff auf private Endpunkte ist ToS-Grauzone. Kontosperre theoretisch möglich | brüchig: mehrere Login-Strategien inklusive TLS-Impersonation (`curl_cffi`). Bekanntes Problem: Tokens werden je nach Region oder Konto später abgelehnt (Issue #369, primär: README) | Poll |
| **Manueller .FIT-Export/-Upload** | gering bis mittel: Upload-Formular plus FIT-Parser (z. B. npm `fit-file-parser`) | keins. Die Originaldatei ist vollständig | sehr stabil, aber Handarbeit pro Aktivität | keins (manuell) |
| **Strava API** (Garmin → Strava → App) | mittel: OAuth2-App, Single Player Mode (Kapazität 1 Athlet:in) reicht | OAuth-Token auf dem Server. Strava-API-Bedingungen seit Nov. 2024 strenger, z. B. KI-Training verboten (laut Sekundärquelle). Daten laufen über einen Dritten | stabil. Limits laut Primärquelle: 200 Requests pro 15 min und 2.000 pro Tag gesamt, „non-upload“ 100 pro 15 min und 1.000 pro Tag (developers.strava.com/docs/rate-limits) | **Push per Webhook** möglich (Strava Webhook Events API, nicht eigens nachgelesen) |
| **Intervals.icu API** (Garmin → Intervals → App) | gering: API-Key in den Intervals-Einstellungen | Laut Forum und Sekundärquellen (9. und 24.10.2026) muss Intervals.icu wegen neuer Garmin-Partnerbedingungen voraussichtlich **Garmin-Daten in seiner API sperren**. Entwickler:innen sollen eine eigene Garmin-Anbindung nutzen | **derzeit unsicher** für Garmin-Daten | Poll (Webhooks nicht geprüft) |

Hinweis zu Drittanbietern: Laut the5krunner (sekundär, 14.10.2026) verbieten Garmins neue
Partnerbedingungen, Garmin-Daten an nicht freigegebene Dienste weiterzureichen. Über Strava
oder Intervals bekommt man Garmin-Daten deshalb nur auf einem Umweg, der jederzeit wegfallen
kann. Bei Strava gilt das nur, wenn Strava selbst betroffen ist, und das ist nicht belegt.

## 3. Empfehlung für die App

1. **Personal API** als Hauptweg: Ein Server-Job (z. B. Node-Cron oder systemd-Timer)
   holt das Token, ruft `search/activities` mit `startDate` = letzter Sync auf und macht ein
   Upsert über `garmin_id`.
2. Secret `GARMIN_PERSONAL_API_KEY` nur in der Server-Umgebung ablegen (nicht im Repo) und den
   Ablauf des Schlüssels im Dashboard anzeigen, z. B. mit Ablaufdatum als zweitem Secret.
3. Vorher einmal von Hand testen: Wie weit reicht die Historie, wie sehen die JSON-Feldnamen aus,
   was steckt im ZIP? Erst danach das Mapping fixieren.
4. Rückfallebene: ein .FIT-Upload-Formular, falls Garmin die Personal API einschränkt.
5. Nicht verwenden: garth (tot) und python-garminconnect (Passwort am Server, brüchig, ToS-Grauzone).

**Konfidenz:** hoch (ca. 90 %), dass die Personal API wie beschrieben existiert und für diesen
Zweck gedacht ist (Garmin-Doku und Garmin-Code). Mittel bei Feldnamen, Historie und Rate
Limits, weil sie nicht dokumentiert bzw. nicht getestet sind und die Swagger-Doku nicht
abrufbar war.

## Offene Punkte

- Swagger-Doku im Browser lesen (Rate Limits, Antwortschema).
- Wortlaut der Nutzungsbedingungen beim Erstellen des Schlüssels.
- Echten Test-Request durchführen (Historie, Feldnamen, ZIP-Inhalt).
