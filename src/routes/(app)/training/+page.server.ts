import { weeklyStats } from '#lib/server/training.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => weeklyStats(12);
