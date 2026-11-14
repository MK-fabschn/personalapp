/** Ab so vielen Tagen vor Ablauf des Schlüssels erscheint der Hinweis auf der Trainingsseite */
export const EXPIRY_WARNING_DAYS = 14;

/** Tage bis zum Ablauf des Schlüssels (negativ = abgelaufen). null, wenn kein gültiges Datum hinterlegt ist. */
export function daysUntilExpiry(expires: string | undefined, todayIso: string): number | null {
	if (!expires || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return null;
	const days = (Date.parse(expires + 'T12:00:00Z') - Date.parse(todayIso + 'T12:00:00Z')) / 86400000;
	return Number.isFinite(days) ? Math.round(days) : null;
}
