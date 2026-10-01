/**
 * Shared HTML escaper for server-rendered documents (plan workstream D).
 *
 * Plain-text DB/request values reach HTML by string interpolation in print
 * pages, PDF templates and DOC/HTML exports; escape them here at the sink.
 * Rich-text columns are NOT escaped — they are HTML-authored and go through
 * `sanitizeRichText` (write path) / `sanitizeHtml` (render) instead.
 *
 * Isomorphic on purpose: route handlers and client-side print builders share it.
 */

export function escapeHtml(value: unknown): string {
	if (value === null || value === undefined) return '';
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}
