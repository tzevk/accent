/**
 * Client-side download helpers for the Project Activities report.
 *
 * PDF: the server returns Content-Disposition: inline, so opening in a new
 *      tab lets the browser render the PDF.  We hit the URL directly to keep
 *      the UX snappy (the user sees a loading indicator in the tab title).
 * Excel: the server returns Content-Disposition: attachment with a
 *      filename.  We fetch the blob and trigger a download so the filename
 *      is preserved and the user can continue working in the tab.
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

	if (format === 'pdf') {
		// Inline PDF — let the browser render in a new tab.
		window.open(url, '_blank', 'noopener,noreferrer');
		return;
	}

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
	const filename = match?.[1] || `project-activities-${Date.now()}.xlsx`;

	const a = document.createElement('a');
	a.href = objectUrl;
	a.download = filename;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
