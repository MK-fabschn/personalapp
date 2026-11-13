import { fail, redirect } from '@sveltejs/kit';
import { verify } from '@node-rs/argon2';
import { APP_PASSWORD_HASH } from '$app/env/private';
import { createSession, purgeExpiredSessions } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

// Einfacher Schutz gegen Durchprobieren: max. 5 Fehlversuche pro IP in 15 Minuten
const attempts = new Map<string, { count: number; since: number }>();
const WINDOW = 15 * 60 * 1000;

export const load: PageServerLoad = ({ locals }) => {
	if (locals.authed) redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const ip = getClientAddress();
		const now = Date.now();
		const a = attempts.get(ip);
		if (a && now - a.since < WINDOW && a.count >= 5) {
			return fail(429, { error: 'Zu viele Versuche. Bitte in 15 Minuten nochmal probieren.' });
		}

		const password = String((await request.formData()).get('password') ?? '');
		const hash = APP_PASSWORD_HASH;
		if (!hash) return fail(500, { error: 'APP_PASSWORD_HASH ist am Server nicht gesetzt.' });

		const ok = password.length > 0 && (await verify(hash, password).catch(() => false));
		if (!ok) {
			if (!a || now - a.since >= WINDOW) attempts.set(ip, { count: 1, since: now });
			else a.count++;
			return fail(401, { error: 'Falsches Passwort.' });
		}

		attempts.delete(ip);
		await purgeExpiredSessions();
		await createSession(cookies);
		redirect(303, '/');
	}
};
