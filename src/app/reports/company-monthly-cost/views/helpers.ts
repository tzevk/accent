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
