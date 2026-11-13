import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { validateSession } from '#lib/server/auth.js';

const PUBLIC_PATHS = ['/login', '/manifest.webmanifest'];

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.authed = await validateSession(event.cookies);

	const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));
	if (!event.locals.authed && !isPublic) {
		redirect(303, '/login');
	}
	return resolve(event);
};
