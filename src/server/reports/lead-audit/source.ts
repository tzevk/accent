import { Buffer } from 'node:buffer';

/** A stored source label, grouped only at the missing boundary. */
export function leadAuditSourceValue(raw: unknown): {
	label: string | null;
	is_unknown: boolean;
} {
	const label =
		raw === null || raw === undefined
			? null
			: Buffer.isBuffer(raw)
				? raw.toString('utf8')
				: String(raw);
	if (label === null || label === '') {
		return { label: null, is_unknown: true };
	}
	return { label, is_unknown: false };
}
