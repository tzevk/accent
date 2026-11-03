/** A stored source label, grouped only at the missing boundary. */
export function leadAuditSourceValue(raw: unknown): {
	label: string | null;
	is_unknown: boolean;
} {
	const label = raw === null || raw === undefined ? null : String(raw);
	if (label === null || label === '') {
		return { label: null, is_unknown: true };
	}
	return { label, is_unknown: false };
}
