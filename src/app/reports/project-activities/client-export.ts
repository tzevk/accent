/**
 * Client-side download helpers for the Project Activities report.
 *
 * Both formats fetch the response and save it as a file, so the filename
 * from Content-Disposition survives and no popup is involved — the PDF
 * used to open with window.open, which produced no request at all when
 * the browser blocked the popup. Excel kept the same behavior.
 */

export type ExportFormat = 'pdf' | 'excel';

export interface DownloadFilters {
	startDate: string;
	endDate: string;
	discipline: string;
}

function buildParams(filters: DownloadFilters): string {
	const p = new URLSearchParams();
	if (filters.startDate) p.set('start_date', filters.startDate);
	if (filters.endDate) p.set('end_date', filters.endDate);
	if (filters.discipline && filters.discipline !== 'all')
		p.set('discipline', filters.discipline);
	const s = p.toString();
	return s ? `?${s}` : '';
}

export async function downloadReport(
	format: ExportFormat,
	filters: DownloadFilters
): Promise<void> {
	const base = '/api/reports/project-activities/download';
	const url =
		format === 'pdf'
			? `${base}${buildParams(filters)}`
			: `${base}/excel${buildParams(filters)}`;

	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) {
		const message = await res.text().catch(() => '');
		throw new Error(
			`Export failed (${res.status})${message ? `: ${message}` : ''}`
		);
	}
	const blob = await res.blob();
	const objectUrl = URL.createObjectURL(blob);
	const disposition = res.headers.get('Content-Disposition') || '';
	const match = disposition.match(/filename="?([^";]+)"?/i);
	const filename = match?.[1] || `project-activities-${format}-${Date.now()}`;

	const a = document.createElement('a');
	a.href = objectUrl;
	a.download = filename;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
