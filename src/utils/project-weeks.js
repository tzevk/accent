import {
	DAY_MS,
	parseIsoDay,
	formatShortDayMonth,
	normalizeDate,
} from './date';

// Build week buckets starting from project start date (W1 = start..start+6).
export const buildProjectWeeks = (projectStartIso, projectEndIso) => {
	const start = parseIsoDay(projectStartIso);
	const end = parseIsoDay(projectEndIso);
	if (!start || !end) return [];

	const startMs = start.getTime();
	const endMs = end.getTime();
	if (endMs < startMs) return [];

	const totalDays = Math.floor((endMs - startMs) / DAY_MS) + 1;
	const weekCount = Math.ceil(totalDays / 7);

	const weeks = [];
	for (let i = 0; i < weekCount; i++) {
		const ws = new Date(startMs + i * 7 * DAY_MS);
		const we = new Date(Math.min(endMs, ws.getTime() + 6 * DAY_MS));
		weeks.push({
			index: i,
			label: `W${i + 1}`,
			start: ws,
			end: we,
			rangeLabel: `${formatShortDayMonth(ws)} - ${formatShortDayMonth(we)}`,
		});
	}
	return weeks;
};

// Returns { startWeek, endWeek } (inclusive) for an item range clamped to the project range.
export const getWeekSpanForProjectRange = (
	projectStartIso,
	projectEndIso,
	itemStartIso,
	itemEndIso
) => {
	const ps = parseIsoDay(projectStartIso);
	const pe = parseIsoDay(projectEndIso);
	const is = parseIsoDay(normalizeDate(itemStartIso));
	const ie = parseIsoDay(normalizeDate(itemEndIso));
	if (!ps || !pe || !is || !ie) return null;

	let startMs = is.getTime();
	let endMs = ie.getTime();
	if (endMs < startMs) [startMs, endMs] = [endMs, startMs];

	const psMs = ps.getTime();
	const peMs = pe.getTime();
	if (endMs < psMs || startMs > peMs) return null;

	const clampedStart = Math.max(psMs, startMs);
	const clampedEnd = Math.min(peMs, endMs);

	const startDayOffset = Math.floor((clampedStart - psMs) / DAY_MS);
	const endDayOffset = Math.floor((clampedEnd - psMs) / DAY_MS);

	return {
		startWeek: Math.floor(startDayOffset / 7),
		endWeek: Math.floor(endDayOffset / 7),
	};
};
