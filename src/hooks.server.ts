import { redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { db } from '#lib/server/db/index.js';
import { startSyncScheduler } from '#lib/server/icloud/index.js';
import { ensureSchool } from '#lib/server/school.js';
import { validateSession } from '#lib/server/auth.js';

const PUBLIC_PATHS = ['/login', '/manifest.webmanifest'];

// Einmal beim Start des Servers: Abgleich mit iCloud im Hintergrund
export const init: ServerInit = async () => {
	if (building) return;
	try {
		// Schul-Blöcke und Schulwege anlegen bzw. auf den Stand der Einstellungen bringen
		await ensureSchool(db);
	} catch (e) {
		console.error('[start] Schul-Termine konnten nicht vorbereitet werden:', e);
	}
	startSyncScheduler();
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.authed = await validateSession(event.cookies);

	const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));
	if (!event.locals.authed && !isPublic) {
		redirect(303, '/login');
	}
	return resolve(event);
};
