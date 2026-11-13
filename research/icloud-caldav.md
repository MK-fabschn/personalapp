# iCloud-CalDAV mit app-spezifischem Passwort

Stand: 13. November 2026. Ticket: „iCloud-CalDAV mit app-spezifischem Passwort“.

Frage: Wie greift der Server der App (SvelteKit/Node, PostgreSQL, Drizzle) per CalDAV mit Apple-ID und app-spezifischem Passwort auf iCloud-Kalender zu, und wie lässt sich das effizient und konfliktsicher synchronisieren?

Quellen sind mit **[P]** (Primärquelle: RFC, Apple-Doku, Quellcode einer Bibliothek, npm-Registry) oder **[S]** (Sekundärquelle: Blog, Issue-Diskussion, Messprotokolle Dritter) gekennzeichnet. Eine eigene Messung gegen iCloud gab es nicht. Was mit „ungeprüft“ markiert ist, muss vor der Umsetzung mit einem Testkonto ausprobiert werden.

---

## 1. Kurzfassung

- **Zugang:** HTTP Basic Auth gegen `https://caldav.icloud.com/`. Benutzername ist die Apple-ID (E-Mail), Passwort ein app-spezifisches Passwort. Dafür ist Zwei-Faktor-Authentifizierung Pflicht. [P1] [S1]
- **Discovery:** `current-user-principal` → `calendar-home-set` → PROPFIND Depth 1 auf das Home. Das Home liegt auf einem Partitions-Host `pNN-caldav.icloud.com`, alle weiteren Requests gehen dorthin. [P2] [P3] [S1]
- **Kalender anlegen:** MKCALENDAR mit `displayname` und Apple-`calendar-color` funktioniert laut Messprotokoll von python-caldav. iCloud speichert die Farbe als `#RRGGBBAA`, Farbnamen ignoriert es. [P2 §5.3.1] [S1]
- **Änderungen erkennen:** `getctag` als billiger Vorab-Check und `sync-collection` REPORT (RFC 6578) mit `sync-token`. Danach `calendar-multiget` für die geänderten hrefs. ETags pro Objekt. [P4] [P5] [S1]
- **Konflikte:** Update mit `If-Match: "<etag>"`, Neuanlage mit `If-None-Match: *`. **Nie `If-Match: *` verwenden**, das verhält sich bei iCloud verkehrt herum. [S1]
- **Empfohlene Bibliothek:** `tsdav` 2.5.0 (MIT, TypeScript, Release 15. Oktober 2026) für das Protokoll und `ical.js` 2.2.1 (MPL-2.0, Mozilla) zum Parsen und Erzeugen von iCalendar inklusive RRULE-Expansion und VTIMEZONE. [P6] [P7] [P8]
- **Blocker:** Keiner, der die Umsetzung verhindert. Das bestehende Schema reicht für Wiederholungen, Zeitzonen, mehrere Kalender und lokale Löschungen aber nicht aus (siehe Abschnitt 9).

---

## 2. Zugangsdaten und app-spezifisches Passwort

Laut Apple-Support [P1]:

- App-spezifische Passwörter sind für Apps anderer Hersteller gedacht, die sich am Apple-Account anmelden, etwa für Kalender, Kontakte und Mail.
- Voraussetzung ist Zwei-Faktor-Authentifizierung: „your Apple Account must be protected with two-factor authentication“.
- Es können bis zu **25** gleichzeitig aktiv sein. Man kann sie einzeln oder alle auf einmal widerrufen.
- **Ändert oder setzt man das Hauptpasswort der Apple-ID zurück, widerruft Apple automatisch alle app-spezifischen Passwörter.** Danach antwortet der Server mit 401, bis ein neues Passwort hinterlegt ist.

Ausgestellt werden sie unter appleid.apple.com → „Anmelden und Sicherheit“ → „App-spezifische Passwörter“. [P1]

Auth-Verfahren: Der 401 von iCloud bietet `X-MobileMe-AuthToken realm="MMCalDav", Basic realm="MMCalDav"` an. Für Clients von Dritten funktioniert Basic mit dem app-spezifischen Passwort. [S1] Mit dem normalen Apple-ID-Passwort kommt immer 401. [S2]

### Empfohlene Umgebungsvariablen

| Variable | Inhalt | Pflicht |
|---|---|---|
| `ICLOUD_APPLE_ID` | Apple-ID (E-Mail) als Basic-Auth-Benutzername | ja |
| `ICLOUD_APP_PASSWORD` | app-spezifisches Passwort im Format `xxxx-xxxx-xxxx-xxxx` | ja |
| `ICLOUD_CALDAV_URL` | Einstiegspunkt, Standard `https://caldav.icloud.com/` | nein |
| `ICLOUD_SYNC_INTERVAL_SECONDS` | Polling-Intervall, Vorschlag `300` | nein |

Die beiden Pflichtwerte gehören wie die übrigen Secrets in die Server-`.env` bzw. in `docker-compose.yml` (siehe `DEPLOYMENT.md`). Sie werden nur in `$env/static/private` oder `$env/dynamic/private` gelesen und nie geloggt. Die ermittelten URLs (Principal, Home, Partitions-Host) cacht man in der Datenbank, nicht in Variablen.

---

## 3. Discovery

Ablauf nach RFC 6764 (Bootstrap) und RFC 4791 [P3] [P2]:

1. **Einstieg:** `PROPFIND https://caldav.icloud.com/` (oder `/.well-known/caldav`), Depth 0, Property `DAV:current-user-principal`. Die Antwort enthält einen href wie `/<numerische-ID>/principal/`. Das Format der ID ist nicht dokumentiert und wird nicht ausgewertet. [P3 §6] [S1, ungeprüft]
2. **Home-Set:** `PROPFIND` auf die Principal-URL, Depth 0, Property `CALDAV:calendar-home-set` (RFC 4791 §6.2.1). [P2] Bei iCloud zeigt dieser href auf einen **Partitions-Host** `https://pNN-caldav.icloud.com/<ID>/calendars/`. Laut python-caldav wird die Root-URL des Clients dorthin verlegt, **iCloud liefert spätere hrefs aber teilweise noch mit `caldav.icloud.com`**. Der Client muss relative hrefs gegen den Partitions-Host auflösen und absolute hrefs normalisieren. [S1]
3. **Kalender auflisten:** `PROPFIND` auf das Home, Depth 1, mit `DAV:resourcetype`, `DAV:displayname`, `CALDAV:supported-calendar-component-set`, `CS:getctag`, `DAV:sync-token` und `A:calendar-color` (Namespaces siehe Abschnitt 4). Es zählen nur Collections mit `resourcetype` = `calendar`, die `VEVENT` unterstützen. iCloud-Erinnerungen liegen in eigenen VTODO-Collections. Tasks und Events in einem Kalender gemischt unterstützt iCloud nicht. [S1]

tsdav erledigt das in `createAccount`/`login()` [P6]:
- `serviceDiscovery` probiert `/.well-known/caldav` mit PROPFIND und fällt auf GET zurück. Es folgt 3xx-`Location`-Headern.
- `fetchPrincipalUrl` und `fetchHomeUrl` lösen die hrefs mit `new URL(href, rootUrl)` auf. Absolute hrefs mit dem Partitions-Host werden so übernommen.
- Eine eigene iCloud-Sonderbehandlung gibt es nicht. Ältere tsdav-Versionen (2.1.x) scheiterten an iCloud mit „cannot find homeUrl“, Auslöser waren bestimmte Header (`Accept-Language`, `Accept-Encoding`). Abhilfe: **tsdav ≥ 2.2.0** verwenden und die Server-URL mit abschließendem `/` angeben. [S3]

Weitere iCloud-Eigenheiten bei Discovery [S1]:
- `PROPFIND` Depth 1 auf den Principal → HTTP 400. Nur Depth 0 verwenden.
- `allprop` liefert kein `resourcetype`. Properties immer explizit anfragen.
- Principal-Suche und `free-busy-query` funktionieren nicht (400).

---

## 4. Kalender „Schule“ und „Matura“ anlegen (MKCALENDAR)

**Standard:** RFC 4791 §5.3.1 macht MKCALENDAR nur zur Empfehlung („RECOMMENDED and not REQUIRED“). Name, Beschreibung und weitere Properties lassen sich gleich im Request-Body über `DAV:set` mitgeben. [P2]

**iCloud:** Im Profil von python-caldav ist für iCloud bei `create-calendar` keine Abweichung eingetragen, es gilt also der Standardwert „full“. `calendar-color` und `calendar-order` sind als „full“ markiert, mit dem Hinweis, dass Farbnamen wie `blue` ignoriert werden und `#CB30E0FF` zurückkommt. [S1] Das Profil stammt aus Messungen eines Users mit caldav-server-tester (9. und 14. Oktober 2026) und ist damit eine Sekundärquelle. Vor der Umsetzung einmal gegen ein Testkonto prüfen (**ungeprüft**).

Request-Skizze:

```http
MKCALENDAR https://pNN-caldav.icloud.com/<ID>/calendars/<neue-uuid>/
Content-Type: application/xml; charset=utf-8

<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"
              xmlns:A="http://apple.com/ns/ical/">
  <D:set><D:prop>
    <D:displayname>Schule</D:displayname>
    <A:calendar-color>#1E88E5FF</A:calendar-color>
    <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
  </D:prop></D:set>
</C:mkcalendar>
```

- Der letzte Pfadteil ist frei wählbar. Eine UUID verhindert Kollisionen. Sichtbar ist nur `displayname`.
- `calendar-color` ist eine Apple-Erweiterung im Namespace `http://apple.com/ns/ical/` und nicht standardisiert. Wert immer als Hex `#RRGGBB` oder `#RRGGBBAA` schicken.
- In tsdav: `makeCalendar({ url, props: { [`${DAVNamespaceShort.DAV}:displayname`]: 'Schule', [`${DAVNamespaceShort.CALDAV_APPLE}:calendar-color`]: '#1E88E5FF', … } })`. Standard-Properties setzt die Funktion keine, sie müssen alle übergeben werden. [P6]
- **Idempotenz:** Vor dem Anlegen die Kalenderliste nach `displayname` durchsuchen. Die URL des angelegten Kalenders in der DB speichern und danach nur noch über die URL arbeiten. Benennt der User den Kalender am iPhone um, bleibt die Zuordnung so erhalten.
- Ändern lässt sich die Farbe später per `PROPPATCH` auf `A:calendar-color`.

---

## 5. Änderungserkennung und Konflikte

### 5.1 Werkzeuge

| Mechanismus | Quelle | Zweck |
|---|---|---|
| `CS:getctag` (`http://calendarserver.org/ns/`) | Apple-Erweiterung (caldav-ctag) | Ein Wert pro Kalender, der sich bei jeder Änderung ändert. Ein PROPFIND Depth 0 zeigt also billig, ob sich überhaupt etwas getan hat. |
| `DAV:sync-token` + `sync-collection` REPORT | RFC 6578 [P4] | Liefert nur die seit dem Token geänderten oder gelöschten Mitglieder und dazu einen neuen Token. |
| `DAV:getetag` | RFC 4791 §2, RFC 9110 [P2] [P9] | Version eines einzelnen Objekts. Grundlage für bedingte Requests. |
| `calendar-multiget` REPORT | RFC 4791 §7.9 [P2] | Lädt viele Objekte per href-Liste in einem Request. |

### 5.2 sync-collection (RFC 6578) [P4]

- Erster Lauf mit leerem `<D:sync-token/>` liefert alle Mitglieder und einen Token.
- Folgeläufe liefern geänderte Mitglieder (mit `propstat`, z. B. `getetag`) und **entfernte Mitglieder als `DAV:response` mit `DAV:status` „404 Not Found“ ohne `propstat`** (§3.2, §3.5.2).
- Mit einem ungültigen oder abgelaufenen Token schlägt der Request mit der Precondition `DAV:valid-sync-token` fehl. Dann macht der Client einen vollen Sync mit leerem Token (§3.1, §3.2). Einen festen HTTP-Status nennt die RFC nicht. In der Praxis kommt 403 oder 409, deshalb auf den Precondition-Namen im Body prüfen.
- Kürzt der Server das Ergebnis, steht in der Antwort für die Request-URI der Status 507 und der Client muss mit dem neuen Token weiter abfragen (§3.6).
- `sync-level` ist `1`. Kalender haben keine Unter-Collections.
- **iCloud:** `DAV:limit` wird ignoriert, und die Antwort listet die **Collection selbst als Mitglied** mit. Deren href muss der Client herausfiltern. Eine Abweichung bei `sync-token` an sich ist nicht vermerkt, es gilt der Standardwert „full“. [S1]

tsdav: `smartCollectionSync` nimmt automatisch `webdav` (sync-collection), wenn der Server den REPORT anbietet, und sonst `basic` (ctag-Vergleich und Volllauf mit Diff). Wird der Token abgelehnt (4xx mit `valid-sync-token`), startet die Funktion von selbst einen vollen Sync. Löschungen erkennt sie am Status 404. Geänderte Objekte lädt sie über `objectMultiGet` nach. [P6]

### 5.3 Bedingte Requests

- **Neu anlegen:** `PUT <calendarUrl>/<uid>.ics` mit `If-None-Match: *`. tsdav `createCalendarObject` setzt den Header standardmäßig. [P6] [P9 §13.1.2]
- **Ändern:** `PUT` mit `If-Match: "<gespeichertes etag>"`. tsdav `updateCalendarObject` und `deleteCalendarObject` übergeben `calendarObject.etag` als `If-Match`. [P6] Bei **412 Precondition Failed** wurde das Objekt am iPhone geändert: Objekt neu laden und den Konflikt auflösen.
- **Löschen:** `DELETE` mit `If-Match`.
- **iCloud-Fallen** [S1]:
  - `If-Match: *` ist **kaputt**: Ein vorhandenes Objekt wird mit 412 abgelehnt, ein fehlendes wird angelegt. Also immer das konkrete ETag schicken.
  - Gibt es die UID im Kalender schon, antwortet iCloud auf einen PUT (auch mit `If-None-Match: *`) mit einem **nackten 412 ohne Precondition-Body**. Ein 412 kann also „ETag veraltet“ oder „UID existiert schon“ bedeuten.
  - Die gleiche UID in einem zweiten Kalender wird abgelehnt. Eine UID ist also pro Account eindeutig, was zu `caldav_uid UNIQUE` passt.
  - `calendar-query` mit UID-Filter → 412. Objekte nie per UID suchen, sondern über den gespeicherten href.
  - Ein VEVENT ohne `DTEND` und ohne `DURATION` wird mit 404 oder 403 abgelehnt. Immer `DTEND` setzen.
- tsdav prüft den Status von `updateObject`/`deleteObject` nicht, sondern gibt die rohe `Response` zurück. `response.ok` und den Status muss der Aufrufer selbst auswerten. Das neue ETag steht im `ETag`-Header der PUT-Antwort. Fehlt der Header, holt man es per PROPFIND oder multiget nach. [P6]

---

## 6. Wiederholungen, ganztägige Termine, Zeitzonen

Regeln aus RFC 5545 [P10] und RFC 4791 [P2], die für einen sauberen Round-Trip gelten müssen:

- **Ein Objekt pro UID:** Eine Calendar-Object-Resource enthält genau eine UID. Ein Serien-Master und seine Ausnahmen (`RECURRENCE-ID`) liegen in **derselben** `.ics`-Ressource (RFC 4791 §4.1).
- **RRULE mit UNTIL:** Hat `DTSTART` eine `TZID`, **muss `UNTIL` in UTC angegeben werden** (`…T215959Z`) (RFC 5545 §3.3.10). Bei ganztägigen Serien (`VALUE=DATE`) ist `UNTIL` ein DATE. Wöchentlich: `RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270626T215959Z`.
- **EXDATE:** muss denselben Wertetyp und dieselbe `TZID` haben wie `DTSTART`, z. B. `EXDATE;TZID=Europe/Vienna:20261223T080000` (RFC 5545 §3.8.5.1). Ausfallende Schulstunden an Feiertagen lassen sich so abbilden. Eine einzelne verschobene Stunde wird dagegen eine Ausnahme mit `RECURRENCE-ID`.
- **Ganztägig:** `DTSTART;VALUE=DATE:20270505` und `DTEND;VALUE=DATE:20270506`. **DTEND ist exklusiv** (RFC 5545 §3.6.1). Ein mehrtägiges Ereignis (z. B. Maturareise 5. bis 9. Mai) hat daher `DTEND` = 10. Mai.
- **Zeitzonen:** Für jede verwendete `TZID` braucht der VCALENDAR eine `VTIMEZONE` (RFC 5545 §3.2.19). Als TZID den Olson-Namen `Europe/Vienna` verwenden. iOS erkennt ihn und rechnet mit der eigenen Zeitzonen-Datenbank. Zeitgebundene Termine nicht in UTC speichern: Bei Serien über den Wechsel zur Sommerzeit verschiebt sich die Uhrzeit sonst um eine Stunde.
- **iCloud-Befund** [S1]: Wiederkehrende Events werden gefunden und vom Server korrekt expandiert, auch für Jahr-2000-Daten. `Schedule-Tag` gibt es nicht. Ein eigener Eintrag zu VTIMEZONE oder EXDATE fehlt im Profil. Ein separater python-caldav-Test (`save-load.icalendar.olson-tzid`) ist für iCloud nicht vermerkt. **Wie die Termine am iPhone dargestellt werden, ist ungeprüft.** Weil Kalender-App und iCloud von Apple stammen, ist das Risiko bei RFC-konformen Daten gering. Vor dem Ausrollen trotzdem einen Testkalender mit wöchentlicher Serie, EXDATE, einer Ausnahme, einem mehrtägigen Ganztagstermin und einem Termin über den Sommerzeitwechsel (28. März 2027) anlegen und am iPhone kontrollieren.
- **Fremde Daten erhalten:** Am iPhone angelegte Termine enthalten Felder, die die App nicht kennt (`VALARM`, `X-APPLE-*`, `ATTENDEE`, `URL`). Beim Zurückschreiben nicht neu generieren, sondern das **gespeicherte Original-ICS parsen, nur die geänderten Properties ersetzen und wieder serialisieren**. Das geht mit ical.js, nicht mit ical-generator.

---

## 7. Node-Bibliotheken

Versionen und Daten aus der npm-Registry vom 13. November 2026 [P8]:

| Paket | Version (Datum) | Lizenz | Zweck | Bewertung |
|---|---|---|---|---|
| **tsdav** | 2.5.0 (15. Oktober 2026) | MIT | CalDAV/CardDAV-Client in TypeScript: Discovery, `fetchCalendars`, `makeCalendar`, `syncCollection`/`smartCollectionSync`, `calendarMultiGet`, CRUD mit ETag | **Empfohlen.** Aktiv gepflegt (Push am 15. Oktober 2026, 362 Sterne, 0 offene Issues). Eigener `fetch` injizierbar, darüber lassen sich Retry und Backoff nachrüsten. Kein eingebautes Retry und keine Behandlung von 429 oder `Retry-After`. [P6] |
| dav | 1.8.0 (2018) | MPL-2.0 | Alter CalDAV-Client | Nicht verwenden, seit 2018 ohne Release. |
| **ical.js** | 2.2.1 (8. August 2025) | MPL-2.0 | Parsen und Serialisieren von RFC 5545 und jCal, Recurrence-Iterator, Zeitzonen-Umrechnung mit VTIMEZONE | **Empfohlen.** Stammt aus dem Mozilla-Kalenderprojekt (Thunderbird), ESM, keine Abhängigkeiten. Die Standard-Build registriert keine Zeitzonen. Die VTIMEZONE aus dem Objekt registrieren oder `ical.timezones.js` mitladen. [P7] |
| ical-generator | 11.1.3 (29. Oktober 2026) | MIT | Nur Erzeugen | Gut für neue Events, braucht aber einen VTIMEZONE-Generator (`@touch4it/ical-timezones` oder `timezones-ical-library`) und Zeit-Objekte mit Zone (Temporal, Luxon, `TZDate`). Native `Date` nimmt die Zeitzone des Servers an. Kann nichts parsen, damit ist kein Round-Trip fremder Felder möglich. [P11] |
| node-ical | 0.27.6 (8. November 2026) | Apache-2.0 | Nur Parsen (RRULE über `rrule`) | Brauchbar zum Lesen, aber kein Serialisieren. Neben ical.js überflüssig. |

**Empfehlung:** `tsdav` + `ical.js`. Ein Parser/Serializer für beide Richtungen hält den Round-Trip verlustfrei. ical-generator ist optional, falls das Erzeugen neuer Events mit ical.js zu umständlich wird.

---

## 8. Bekannte Stolperfallen

1. **Rate Limits:** Apple veröffentlicht keine Limits für CalDAV. Das python-caldav-Profil vermerkt für iCloud kein Rate-Limit. [S1] Vorsichtig pollen: alle 5 bis 15 Minuten ein ctag-PROPFIND pro Kalender, ein sync-collection nur bei geändertem ctag. Bei 429 oder 503 `Retry-After` beachten und exponentiell zurückweichen. Das muss man selbst in einen `fetch`-Wrapper einbauen, weil tsdav es nicht macht. [P6]
2. **Kein Push:** Für Clients von Dritten ist kein Push-Kanal dokumentiert. Änderungen vom iPhone kommen erst mit dem nächsten Poll an. Für eine Dashboard-App reicht das.
3. **Passwortwechsel:** Ändert man das Apple-ID-Passwort, werden alle app-spezifischen Passwörter ungültig. [P1] Bei 401 den Sync anhalten und im Dashboard „iCloud-Zugang erneuern“ anzeigen, statt in einer Schleife weiter zu versuchen. Mehrere Fehlanmeldungen könnten den Account sperren (Apple-Verhalten, ungeprüft).
4. **Partitions-Host:** Hrefs gegen `pNN-caldav.icloud.com` auflösen. Kommen absolute hrefs mit `caldav.icloud.com`, sie auf den Partitions-Host normalisieren. In der DB den **Pfad** des Objekts speichern, nicht den Host. [S1]
5. **Die Collection selbst in sync-collection-Antworten** herausfiltern, sonst entsteht ein Phantom-Event. [S1]
6. **412 ist mehrdeutig** (ETag veraltet oder UID-Kollision), und `If-Match: *` ist kaputt. [S1]
7. **Erinnerungen und Tasks** liegen in eigenen Collections. Diese über `supported-calendar-component-set` herausfiltern. [S1]
8. **Kein CORS:** Alle Zugriffe laufen am Server. Für tsdav ist das ohnehin der vorgesehene Weg. [S3]
9. **ETag-Format:** ETags unverändert samt Anführungszeichen speichern und zurückschicken.

---

## 9. Abgleich mit dem bestehenden Schema

`src/lib/server/db/schema.ts`, Tabelle `events`: `title`, `start`/`end` (timestamptz), `allDay`, `location`, `notes`, `caldavUid` (unique), `caldavHref`, `caldavEtag`, `updatedAt`.

Lücken für den Sync (Vorschlag, keine fertige Migration):

- **Tabelle `calendars`** (neu): `id`, `name` (`Schule`/`Matura`), `caldav_url` (Pfad), `color`, `ctag`, `sync_token`, `last_synced_at`. Dazu in `events` die Spalte `calendar_id` als FK. Ohne sie ist unbekannt, in welchen Kalender ein PUT gehört.
- **`ical_raw` (text):** das zuletzt vom Server geladene ICS, damit fremde Properties (Alarme, `X-APPLE-*`) beim Zurückschreiben erhalten bleiben.
- **Wiederholungen:** Entweder `rrule`, `exdates` und `tzid` als Spalten speichern und die Termine für die Anzeige zur Laufzeit mit ical.js expandieren, oder nur `ical_raw` als Quelle behalten und die Vorkommen in einem Zeitfenster expandieren. Mit `start`/`end` allein lässt sich eine Serie nicht abbilden.
- **Zeitzone:** `tzid` (Standard `Europe/Vienna`). Bei `allDay` den Tag zusätzlich als `date` ablegen oder als Mitternacht in Europe/Vienna normieren. timestamptz allein verschiebt ganztägige Termine sonst leicht um einen Tag.
- **Lokale Änderungen:** `sync_state` (`synced` | `dirty` | `deleted`), `deleted_at` für Tombstones. `updated_at` reicht dafür nicht, weil es auch beim Übernehmen vom Server gesetzt wird.

---

## 10. Sync-Algorithmus (Skizze)

```
setup (einmalig bzw. wenn calendars leer):
  login(ICLOUD_APPLE_ID, ICLOUD_APP_PASSWORD)   # Discovery → Home auf pNN-Host
  remote = fetchCalendars()                      # nur VEVENT-Kalender
  für name in ["Schule", "Matura"]:
    wenn kein remote.displayname == name: MKCALENDAR (displayname, color, VEVENT)
    calendars.upsert(name, url, ctag=null, sync_token=null)

sync (alle ICLOUD_SYNC_INTERVAL_SECONDS, pro Kalender, mit Lock gegen parallele Läufe):
  1. PUSH lokal → remote
     für e in events where calendar=c and sync_state='dirty':
       ics = merge(e, parse(e.ical_raw))          # fremde Props erhalten
       wenn e.caldav_href leer:
         href = c.url + e.caldav_uid + ".ics"; PUT If-None-Match:*
       sonst: PUT href If-Match: e.caldav_etag
       2xx → etag aus Header (sonst PROPFIND), sync_state='synced'
       412 → Remote-Version laden; Konflikt lösen (Vorschlag: Remote gewinnt,
             lokale Änderung verwerfen und loggen), sync_state='synced'
     für e where sync_state='deleted':
       DELETE href If-Match: etag; 2xx/404 → Zeile entfernen; 412 → Remote laden
  2. PULL remote → lokal
     ctag = PROPFIND Depth 0 getctag; wenn ctag == c.ctag und nichts gepusht: fertig
     res = REPORT sync-collection(sync_token=c.sync_token, props=[getetag])
       bei valid-sync-token-Fehler: sync_token=null, voller Lauf
       Eintrag mit href == c.url ignorieren (iCloud-Eigenheit)
     gelöscht (404) → events mit caldav_href löschen (nicht, wenn dirty → Konflikt)
     geändert → hrefs, deren etag ≠ lokalem etag; calendar-multiget in Blöcken
                → parse mit ical.js → upsert nach caldav_uid
                  (title, start, end, all_day, rrule, exdates, tzid, ical_raw, etag)
     Voller Lauf (Token null): lokale Events mit href, die nicht in der Liste sind → löschen
     c.sync_token = res.token; c.ctag = ctag; c.last_synced_at = now()
  Fehler: 401 → Sync stoppen und im Dashboard melden; 429/503 → Retry-After/Backoff
```

In tsdav entspricht Schritt 2 weitgehend `smartCollectionSyncDetailed` (`created`/`updated`/`deleted`). Der eigene Code muss nur noch das Mapping auf die DB, den Filter für die Collection-href und die Fehlerbehandlung liefern. [P6]

Offene Punkte vor der Umsetzung (mit einem Testkonto prüfen): MKCALENDAR inklusive Farbe auf iCloud, Format des Fehlers bei ungültigem Sync-Token, Darstellung am iPhone (Serie, EXDATE, Ganztag über mehrere Tage, Sommerzeitwechsel).

---

## Quellen

Primär:
- **[P1]** Apple Support: „Sign in to apps with your Apple Account using app-specific passwords“, https://support.apple.com/en-us/102654
- **[P2]** RFC 4791, Calendaring Extensions to WebDAV (CalDAV), §2, §4.1, §5.3.1, §5.3.2.1, §6.2.1, §7.8, §7.9, https://www.rfc-editor.org/rfc/rfc4791
- **[P3]** RFC 6764, Locating Services for CalDAV and CardDAV (`/.well-known/caldav`), https://www.rfc-editor.org/rfc/rfc6764, sowie RFC 5397 (`current-user-principal`)
- **[P4]** RFC 6578, Collection Synchronization for WebDAV, §3.1, §3.2, §3.3, §3.5, §3.6, https://www.rfc-editor.org/rfc/rfc6578
- **[P5]** Apple Calendar Server: caldav-ctag (`http://calendarserver.org/ns/` getctag), Apple-Erweiterung, im Profil von tsdav und python-caldav verwendet
- **[P6]** tsdav-Quellcode (main, Stand 13. November 2026): `src/account.ts`, `src/calendar.ts`, `src/collection.ts`, `src/request.ts`, https://github.com/natelindev/tsdav
- **[P7]** ical.js README, https://github.com/kewisch/ical.js
- **[P8]** npm-Registry-Metadaten für tsdav, ical.js, ical-generator, node-ical, dav (abgerufen am 13. November 2026), https://registry.npmjs.org/
- **[P9]** RFC 9110, HTTP Semantics, §13.1.1 (If-Match), §13.1.2 (If-None-Match), https://www.rfc-editor.org/rfc/rfc9110
- **[P10]** RFC 5545, iCalendar, §3.2.19, §3.3.10, §3.6.1, §3.8.5.1, https://www.rfc-editor.org/rfc/rfc5545
- **[P11]** ical-generator README, https://github.com/sebbo2002/ical-generator

Sekundär:
- **[S1]** python-caldav, `caldav/compatibility_hints.py`, Profil `icloud` mit Messungen per caldav-server-tester vom 9., 14. und 28. Oktober 2026 (Issues #730, #783, PR 826). Code einer Bibliothek, die Befunde sind aber Beobachtungen von Usern und keine Apple-Doku. https://github.com/python-caldav/caldav/blob/master/caldav/compatibility_hints.py
- **[S2]** Nylas CLI Guide „iCloud CalDAV settings“ (Host, Port, 401 bei normalem Passwort), https://cli.nylas.com/guides/icloud-caldav-settings
- **[S3]** tsdav-Issues #238 („Cannot fetch calendar from caldav.icloud.com“, behoben ab 2.2.0) und #245 (Apple-Anleitung, Doku-Update in 2.1.7), https://github.com/natelindev/tsdav/issues/238
