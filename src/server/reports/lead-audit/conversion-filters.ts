import { LeadAuditValidationError } from './types';
import {
	LEAD_AUDIT_CONVERSION_EVIDENCE,
	type LeadAuditConversionEvidenceFilter,
} from './conversion-types';

type QuerySource =
	| URLSearchParams
	| Record<string, string | null | undefined>;

function read(source: QuerySource, key: string): string {
	const value =
		source instanceof URLSearchParams ? source.get(key) : (source[key] ?? null);
	return typeof value === 'string' ? value.trim() : '';
}

/**
 * The conversion drill-down population. It is a closed vocabulary: an
 * unsupported value is refused with a named code instead of returning a
 * silently empty evidence table. The intake, period, owner, source, stage,
 * priority, and search filters remain the shared ones.
 */
export function parseLeadAuditConversionEvidence(
	source: QuerySource
): LeadAuditConversionEvidenceFilter {
	const raw = read(source, 'evidence');
	if (raw === '') {
		// The shared toolbar's undated timing control opens this evidence
		// population; it is an explicit alias, not a silent fallback.
		const undated = read(source, 'undated');
		if (undated === '1' || undated.toLowerCase() === 'true') return 'undated';
		return 'all';
	}
	if ((LEAD_AUDIT_CONVERSION_EVIDENCE as readonly string[]).includes(raw)) {
		return raw as LeadAuditConversionEvidenceFilter;
	}
	throw new LeadAuditValidationError(
		'invalid_conversion_evidence',
		`Unknown conversion evidence filter: ${raw}`
	);
}
