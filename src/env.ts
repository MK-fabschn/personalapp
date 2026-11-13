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
	}
});
