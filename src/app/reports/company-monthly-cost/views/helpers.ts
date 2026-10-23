// The financial-year helper lives in the pure ranking module; the server
// barrel is avoided because it also opens the database pool (server only).
import { financialYearOf } from '@/lib/company-expenditure/ranking';

export function monthLabel(month: string): string {
	if (!month || !month.includes('-')) return month;
	const [y, m] = month.split('-').map(Number);
	const names = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December',
	];
	if (!y || !m || m < 1 || m > 12) return month;
	return `${names[m - 1]} ${y}`;
}

export function compactMonthLabel(month: string): string {
	if (!month || !month.includes('-')) return month;
	const [year, monthNumber] = month.split('-').map(Number);
	const names = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	];
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${names[monthNumber - 1]}-${String(year).slice(-2)}`;
}

export function projectKey(
	projectId: number | null,
	projectCode: string,
	projectName: string
): string {
	return projectId != null
		? String(projectId)
		: projectCode || projectName || 'unknown';
}

export function projectLabel(project: {
	project_code: string;
	project_name: string;
}): string {
	return (
		[project.project_code, project.project_name].filter(Boolean).join(' - ') ||
		'Unknown project'
	);
}

const CALENDAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Months the Company Expenditure picker offers, newest first: source
 * months plus the current and selected financial years' calendar months
 * (April–March), generated through `currentMonth` only. Source and
 * selection are always kept; an unusable current month generates nothing
 * and is not added.
 */
export function expenditureMonths(input: {
	sourceMonths?: string[] | null;
	currentMonth?: string | null;
	selectedMonth?: string | null;
}): string[] {
	const months = new Set<string>(input.sourceMonths ?? []);
	const current = input.currentMonth ?? '';
	const currentValid = CALENDAR_MONTH.test(current);
	if (currentValid) months.add(current);
	if (input.selectedMonth) months.add(input.selectedMonth);
	if (!currentValid) {
		return [...months].sort().reverse();
	}
	const financialYears = new Set<number>([financialYearOf(current)]);
	if (input.selectedMonth && CALENDAR_MONTH.test(input.selectedMonth)) {
		financialYears.add(financialYearOf(input.selectedMonth));
	}
	for (const startYear of financialYears) {
		// April through March, capped at the current month.
		const yearEnd = `${startYear + 1}-03`;
		const cap = yearEnd < current ? yearEnd : current;
		let year = startYear;
		let monthNumber = 4;
		for (;;) {
			const month = `${year}-${String(monthNumber).padStart(2, '0')}`;
			if (month > cap) break;
			months.add(month);
			monthNumber += 1;
			if (monthNumber > 12) {
				monthNumber = 1;
				year += 1;
			}
		}
	}
	return [...months].sort().reverse();
}
