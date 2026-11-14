import { fail } from '@sveltejs/kit';
import { garminInfo, runGarminImport } from '#lib/server/garmin/index.js';
import { weeklyStats } from '#lib/server/training.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [stats, garmin] = await Promise.all([weeklyStats(12), garminInfo()]);
	return { ...stats, garmin };
};

export const actions: Actions = {
	// Knopf „Jetzt abrufen“
	fetch: async () => {
		const status = await runGarminImport();
		if (!status) return fail(400, { error: 'Es ist kein Garmin-Schlüssel hinterlegt.' });
		if (!status.ok) return fail(502, { error: status.error ?? 'Der Abruf ist fehlgeschlagen.' });
		return { added: status.report?.added ?? 0 };
	}
};
