# Deployment – app.fabian-trutschnig.dev

SvelteKit-App (Node) plus PostgreSQL in Docker auf dem netcup-VPS, gleicher Server wie das Portfolio.
Sie läuft hinter dem Traefik aus dem MK-Nikolsdorf-Stack (Docker-Netz `web`). Code-Deploys laufen
per GitHub Action über SSH (`scripts/deploy.sh`).

```
Browser ─► Cloudflare (Proxy, SSL „Full (strict)“) ─► VPS :443 Traefik ─► personalapp_web (Node :3000)
                                                                              │ Netz "internal"
                                                                              ▼
                                                                         personalapp_db (Postgres)
```

Zugang nur mit dem App-Passwort (argon2-Hash in `.env`, Sessions in der DB, Sperre nach
5 Fehlversuchen pro IP in 15 Minuten). Die Datenbank hängt nur im internen Netz, die App ist nach
außen nur über Traefik erreichbar (kein veröffentlichter Port).

## 1. Cloudflare (einmalig)

- **DNS:** `A  app → <VPS-IP>` (Proxy an) – oder `CNAME app → fabian-trutschnig.dev` (Proxy an).
- SSL-Modus und die übrigen Einstellungen gelten schon für die ganze Zone (siehe Portfolio-`DEPLOYMENT.md`).
- **Zertifikat:** Das Portfolio holt über den Resolver `cloudflare` bereits `*.fabian-trutschnig.dev`.
  Traefik verwendet es auch für `app.`, es ist nichts zu tun.

## 2. Server (einmalig)

Als root: User anlegen und in die Gruppe `docker` aufnehmen.

```sh
adduser --disabled-password personalapp
usermod -aG docker personalapp
```

Als `personalapp`: Das Repo ist öffentlich, der Server klont deshalb über HTTPS ohne eigenen Key.

```sh
git clone https://github.com/MK-fabschn/personalapp.git ~/personalapp
cd ~/personalapp
cp .env.example .env
chmod 600 .env
```

`.env` ausfüllen:

- `POSTGRES_PASSWORD`: zufällig, z. B. `openssl rand -hex 32`
- `APP_PASSWORD_HASH`: lokal `npm run hash-password -- "deinLoginPasswort"` ausführen und die Zeile
  übernehmen (jedes `$` ist dort schon verdoppelt, weil docker compose `$` sonst als Variable liest)

Danach starten:

```sh
./scripts/deploy.sh
```

> **Achtung:** `POSTGRES_PASSWORD` wird nur beim allerersten Start der Datenbank übernommen.
> Wer es später ändert, muss das Passwort auch in Postgres ändern (`ALTER USER fabse PASSWORD '…'`).

## 3. Deploy-Key GitHub → Server

Lokal erzeugen:

```sh
ssh-keygen -t ed25519 -f personalapp_github_deploy -N '' -C "github-actions deploy personalapp"
```

Den Public Key (`personalapp_github_deploy.pub`) mit Zwangsbefehl in
`/home/personalapp/.ssh/authorized_keys` eintragen. Der Key kann dann nur `deploy.sh` starten,
keine Shell, kein Port-Forwarding:

```
command="cd ~/personalapp && ./scripts/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… github-actions deploy personalapp
```

Rechte: `chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`.
Der private Teil kommt nur ins GitHub-Secret `VPS_SSH_KEY`, danach die lokale Datei löschen.

## 4. GitHub Secrets

Repo → Settings → Secrets and variables → Actions:

| Secret         | Wert                                               |
| -------------- | -------------------------------------------------- |
| `VPS_HOST`     | IP des VPS (nicht ins Repo schreiben)              |
| `VPS_USER`     | `personalapp`                                      |
| `VPS_SSH_KEY`  | privater Schlüssel des Deploy-Keys GitHub → Server |
| `VPS_SSH_PORT` | optional, Standard `22`                            |
| `DEPLOY_PATH`  | `/home/personalapp/personalapp`                    |

## 5. Laufender Betrieb

- **Update:** Push auf `main` → CI (`svelte-check`, Build, Docker-Build) → bei Erfolg Deploy per SSH.
  Manuell auf dem Server: `~/personalapp/scripts/deploy.sh`. Migrationen laufen beim Start automatisch.
- **Logs:** `docker compose logs -f app` (Log-Treiber `local`, 2 × 1 MB pro Container).
- **Backup** der Datenbank:

  ```sh
  docker compose exec -T db pg_dump -U fabse fabse | gzip > ~/backup-$(date +%F).sql.gz
  ```

  Wiederherstellen: `gunzip -c backup.sql.gz | docker compose exec -T db psql -U fabse fabse`
- **Passwort ändern:** neuen Hash erzeugen, in `.env` ersetzen, `docker compose up -d`.
- **Alle Geräte abmelden:** `docker compose exec db psql -U fabse fabse -c 'delete from sessions'`.

## Hinweis zur Login-Sperre

Die App nimmt die Client-IP aus dem Header `CF-Connecting-IP`, den Cloudflare setzt. Wer die VPS-IP
direkt (ohne Cloudflare) anspricht, könnte diesen Header fälschen und so die Sperre umgehen, nicht
aber das Passwort. Wer das ausschließen will, erlaubt in Traefik für diesen Router nur die
Cloudflare-IP-Ranges (`ipAllowList`-Middleware).
