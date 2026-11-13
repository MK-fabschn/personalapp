#!/bin/sh
# Server-seitiges Deploy-Skript (läuft auf dem netcup-VPS als User "app").
# Wird von der GitHub-Action (.github/workflows/deploy.yml) per SSH aufgerufen
# oder manuell:  ./scripts/deploy.sh
set -eu

# Ins Projektverzeichnis wechseln (eine Ebene über diesem Skript).
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if [ ! -f .env ]; then
	echo "[deploy] .env fehlt – zuerst .env.example nach .env kopieren und ausfüllen." >&2
	exit 1
fi

echo "[deploy] $(date '+%F %T') – Pull …"
git pull --ff-only

echo "[deploy] Build & Start …"
# Baut das neue Image (alter Container läuft währenddessen weiter) und tauscht ihn dann aus.
# Migrationen laufen beim Start des App-Containers automatisch.
docker compose build
docker compose up -d

echo "[deploy] Aufräumen (verwaiste Images) …"
docker image prune -f

echo "[deploy] Fertig."
docker compose ps
