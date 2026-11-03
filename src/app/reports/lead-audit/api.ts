import { apiGet } from '@/lib/api-client';

/**
 * The report's own query transport.
 *
 * `apiGet` drops the literal value `all`, because other reports use it as an
 * "unset" sentinel. In this report `all` is real data: a stored source label,
 * a free-text search term, and the default conversion evidence population.
 * Sharing that filter would silently widen or narrow the applied scope while
 * the toolbar still showed the selection. Build the query here and let
 * `apiGet` pass the already-built suffix through untouched.
 */
export function leadAuditGet<T>(
	url: string,
	params?: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
	if (!params) return apiGet<T>(url);
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === '') continue;
		query.append(key, String(value));
	}
	const suffix = query.toString();
	return apiGet<T>(suffix === '' ? url : `${url}?${suffix}`);
}
