import { defineEnvVars } from '@sveltejs/kit/env';

// Beide Werte werden erst zur Laufzeit gebraucht (nicht beim Build) → hier optional,
// die eigentliche Prüfung passiert beim ersten Zugriff.
export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Postgres-Verbindung, z. B. postgres://fabse:pw@db:5432/fabse',
		schema: (v) => v || undefined
	},
	APP_PASSWORD_HASH: {
		description: 'Argon2-Hash des Login-Passworts (npm run hash-password)',
		schema: (v) => v || undefined
	},
	// iCloud-Sync: ohne diese beiden Werte läuft die App normal, nur ohne Abgleich
	ICLOUD_APPLE_ID: {
		description: 'Apple-ID (E-Mail) für den Kalender-Sync',
		schema: (v) => v || undefined
	},
	ICLOUD_APP_PASSWORD: {
		description: 'App-spezifisches Passwort von account.apple.com',
		schema: (v) => v || undefined
	},
	ICLOUD_SYNC_IN_DEV: {
		description: 'Auf 1 setzen, damit auch der Dev-Server (npm run dev) mit iCloud abgleicht',
		schema: (v) => v || undefined
	},
	ICLOUD_SYNC_INTERVAL_SECONDS: {
		description: 'Takt des Abgleichs im Hintergrund, Standard 300',
		schema: (v) => v || undefined
	}
});
