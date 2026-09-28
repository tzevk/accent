/**
 * Field-level write-path sanitizers shared by route handlers (ADR-0012).
 *
 *  - `sanitizeOptionalRichText` — for HTML-bound string columns. `undefined`
 *    and `null` pass through unchanged so "not provided" and "clear" keep
 *    their meaning; every other value goes through `sanitizeRichText`
 *    (non-strings become '').
 *  - `sanitizeJsonStrings` — for JSON-shaped columns. Sanitizes every nested
 *    string leaf and keeps the shape. JSON text (a JSON column read back from
 *    MySQL arrives as text) is parsed first so the JSON syntax itself is never
 *    run through the HTML sanitizer.
 */
import { sanitizeRichText } from './sanitize.js';

export const sanitizeOptionalRichText = <T>(value: T): T | string =>
	value === undefined || value === null ? value : sanitizeRichText(value);

export const sanitizeJsonStrings = (value: unknown): unknown => {
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === 'object')
				return sanitizeJsonStrings(parsed);
		} catch {
			// not JSON — fall through and treat the value as rich text
		}
		return sanitizeRichText(value);
	}
	if (Array.isArray(value)) return value.map(sanitizeJsonStrings);
	if (value && typeof value === 'object') {
		const sanitized: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			sanitized[key] = sanitizeJsonStrings(
				(value as Record<string, unknown>)[key]
			);
		}
		return sanitized;
	}
	return value;
};
