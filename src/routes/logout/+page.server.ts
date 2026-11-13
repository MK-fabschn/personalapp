import { redirect } from '@sveltejs/kit';
import { destroySession } from '#lib/server/auth.js';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ cookies }) => {
		await destroySession(cookies);
		redirect(303, '/login');
	}
};
