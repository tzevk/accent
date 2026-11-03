/**
 * Cohort, period, and source conversion vocabulary (ticket #402).
 *
 * The downstream state names are the ones the converted-Lead read already
 * uses (`@/lib/lead-progress`), so a Restricted, unresolved, absent, or
 * available Proposal never gets a second spelling in this report.
 *
 * JSON responses use snake_case; the module speaks camelCase.
 */
import type {
	LeadProjectLinkState,
	LeadProposalLinkState,
} from '@/lib/lead-progress';
import type {
	LeadAuditDisclosure,
	LeadAuditMeta,
	LeadAuditScope,
} from './types';

/** The evidence states of one cohort Lead, mutually exclusive. */
export const LEAD_AUDIT_CONVERSION_EVIDENCE_STATES = [
	'conversion_event',
	'canonical_link',
	'unresolved_link',
	'stage_only',
	'none',
] as const;
export type LeadAuditConversionEvidenceState =
	(typeof LEAD_AUDIT_CONVERSION_EVIDENCE_STATES)[number];

/** The selectable evidence populations of the conversion drill-down. */
export const LEAD_AUDIT_CONVERSION_EVIDENCE = [
	'all',
	'handoff',
	'period',
	'undated',
	'unresolved',
	'stage_only',
] as const;
export type LeadAuditConversionEvidenceFilter =
	(typeof LEAD_AUDIT_CONVERSION_EVIDENCE)[number];

/** The caller's downstream read grants, resolved once by the route. */
export interface LeadAuditConversionReadOptions {
	includeProposals: boolean;
	includeProjects: boolean;
}

/** A Project the canonical Proposal later links to, when permitted. */
export interface LeadAuditConversionProjectContext {
	id: number;
	title: string | null;
	status: string | null;
	progress: number | null;
}

/** The canonical Proposal of a handoff, when the reader may read it. */
export interface LeadAuditConversionProposalContext {
	id: number;
	title: string | null;
	status: string | null;
	progress: number | null;
	project_state: LeadProjectLinkState;
	project: LeadAuditConversionProjectContext | null;
}

/**
 * The downstream block of one Lead. A restricted reader gets the state and
 * nothing else: no Proposal id, title, status, progress, or Project field is
 * carried in the payload at all.
 */
export interface LeadAuditConversionDownstream {
	proposal_state: LeadProposalLinkState;
	proposal: LeadAuditConversionProposalContext | null;
}

export interface LeadAuditConversionRow {
	id: number;
	lead_id: string | null;
	company_name: string;
	contact_name: string | null;
	source: { label: string | null; is_unknown: boolean };
	stage: { value: string | null; label: string };
	owner: { id: number; name: string | null } | null;
	recorded_at: string;
	enquiry_date: string | null;
	/** The mutually exclusive evidence state of this Lead's handoff. */
	evidence: LeadAuditConversionEvidenceState;
	/** A recorded event or a resolved canonical link, never a stage label. */
	handoff_evidenced: boolean;
	/** The authoritative recorded conversion time; null when undated. */
	conversion_at: string | null;
	in_period_handoff: boolean;
	downstream: LeadAuditConversionDownstream;
}

export interface LeadAuditCohortConversion {
	cohort_size: number;
	handoffs_evidenced: number;
	/** Percentage with two decimals, or null for an empty cohort. */
	conversion_rate: number | null;
	conversion_events: number;
	undated_links: number;
	unresolved_evidence: number;
	stage_only_claims: number;
	no_handoff_evidence: number;
	observed_through: string;
}

export interface LeadAuditPeriodHandoffs {
	handoffs: number;
	/**
	 * Resolved canonical links with no recorded conversion time. They can
	 * support cohort evidence but never a dated period handoff.
	 */
	undated_canonical_links: number;
	date_basis: string;
}

export interface LeadAuditSourceConversion {
	label: string | null;
	is_unknown: boolean;
	cohort_size: number;
	handoffs_evidenced: number;
	conversion_rate: number | null;
	unresolved_evidence: number;
	stage_only_claims: number;
}

export interface LeadAuditStageDistributionRow {
	stage: { value: string | null; label: string };
	count: number;
}

export interface LeadAuditDownstreamStateCounts {
	none: number;
	unresolved: number;
	restricted: number;
	available: number;
}

export interface LeadAuditProjectStateCounts {
	none: number;
	restricted: number;
	available: number;
}

export interface LeadAuditConversionDownstreamSummary {
	handoffs: number;
	proposal_states: LeadAuditDownstreamStateCounts;
	project_states: LeadAuditProjectStateCounts;
}

/** The filter scope one section applied and the ones it did not. */
export interface LeadAuditSectionFilterScope {
	effective: Array<{ key: string; label: string }>;
	ignored: Array<{ key: string; reason: string }>;
}

export interface LeadAuditConversionSection {
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	cohort: LeadAuditCohortConversion;
	period: LeadAuditPeriodHandoffs;
	source_conversion: LeadAuditSourceConversion[];
	stage_distribution: LeadAuditStageDistributionRow[];
	downstream: LeadAuditConversionDownstreamSummary;
	evidence_filters: LeadAuditSectionFilterScope;
	disclosures: LeadAuditDisclosure[];
}

export interface LeadAuditConversionEvidenceDescriptor {
	key: LeadAuditConversionEvidenceFilter;
	label: string;
	definition: string;
}

export interface LeadAuditConversionEvidenceSection {
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	evidence: LeadAuditConversionEvidenceDescriptor;
	rows: LeadAuditConversionRow[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		total_pages: number;
	};
	/** What the reader's grants allow, so the interface can explain Restricted. */
	downstream_options: {
		include_proposals: boolean;
		include_projects: boolean;
	};
	evidence_filters: LeadAuditSectionFilterScope;
	disclosures: LeadAuditDisclosure[];
}


