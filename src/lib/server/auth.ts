import { createHash, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db, t } from './db';

export const SESSION_COOKIE = 'fabse_session';
const DAY = 1000 * 60 * 60 * 24;
const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(cookies: Cookies) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
	await db.insert(t.sessions).values({ id: hashToken(token), expiresAt });
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		expires: expiresAt
	});
}

/** Prüft das Cookie, verlängert die Session bei Bedarf. Gibt true zurück, wenn eingeloggt. */
export async function validateSession(cookies: Cookies): Promise<boolean> {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return false;
	const id = hashToken(token);
	const [session] = await db.select().from(t.sessions).where(eq(t.sessions.id, id));
	if (!session) return false;

	const now = Date.now();
	if (session.expiresAt.getTime() < now) {
		await db.delete(t.sessions).where(eq(t.sessions.id, id));
		return false;
	}
	// Sliding expiration: in der zweiten Hälfte der Laufzeit verlängern
	if (session.expiresAt.getTime() - now < (SESSION_DAYS / 2) * DAY) {
		const expiresAt = new Date(now + SESSION_DAYS * DAY);
		await db.update(t.sessions).set({ expiresAt }).where(eq(t.sessions.id, id));
		cookies.set(SESSION_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			expires: expiresAt
		});
	}
	return true;
}

export async function destroySession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await db.delete(t.sessions).where(eq(t.sessions.id, hashToken(token)));
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export async function purgeExpiredSessions() {
	await db.delete(t.sessions).where(lt(t.sessions.expiresAt, new Date()));
}
