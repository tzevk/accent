/**
 * Audit evidence and Data coverage vocabulary for the Lead Audit report.
 *
 * Client-safe: this module has no runtime server imports, so the report views
 * and the server section readers share one event, outcome, and row contract.
 * The evidence filter parser itself lives in `evidence-filters.ts`, shared by
 * the work and audit sections; `audit-types.ts` carries the labels that the
 * global report toolbar and the audit view render.
 */
import type { LeadActivityType } from '@/lib/lead-activities';
import type { LeadAuditEvidenceFilters } from './evidence-filters';
import type {
	LeadAuditDisclosure,
	LeadAuditFilters,
	LeadAuditMeta,
	LeadAuditPagination,
	LeadAuditScope,
} from './types';

/** The evidence kinds this report can show. Order is the filter order. */
export const LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS = [
	{ value: 'activity', label: 'Activity' },
	{ value: 'stage_change', label: 'Stage or lifecycle decision' },
	{ value: 'owner_change', label: 'Owner change' },
	{ value: 'correction', label: 'Activity correction' },
	{ value: 'legacy_review', label: 'Legacy review' },
	{ value: 'conversion', label: 'Conversion' },
] as const;

export type LeadAuditEvidenceType =
	(typeof LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS)[number]['value'];

export const LEAD_AUDIT_EVIDENCE_TYPES = LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS.map(
	(option) => option.value
) as LeadAuditEvidenceType[];

/**
 * The outcome filter vocabulary. The five call outcomes are the stored call
 * outcomes; the two email outcomes describe the reply flag separately from a
 * sent email, and `unknown` is the missing or unrecognized outcome.
 */
export const LEAD_AUDIT_EVIDENCE_OUTCOME_OPTIONS = [
	{ value: 'Connected', label: 'Call: Connected' },
	{ value: 'No Answer', label: 'Call: No Answer' },
	{ value: 'Busy', label: 'Call: Busy' },
	{ value: 'Voicemail', label: 'Call: Voicemail' },
	{ value: 'Wrong Number', label: 'Call: Wrong Number' },
	{ value: 'email_replied', label: 'Email: reply confirmed' },
	{ value: 'email_sent', label: 'Email: sent without a confirmed reply' },
	{ value: 'unknown', label: 'Unknown outcome' },
] as const;

export type LeadAuditEvidenceOutcome =
	(typeof LEAD_AUDIT_EVIDENCE_OUTCOME_OPTIONS)[number]['value'];

export type LeadAuditEvidenceActivityTypeFilter =
	| LeadActivityType
	| 'unknown';

/** The actor sentinel shared with the work section and the filter parser. */
export const LEAD_AUDIT_EVIDENCE_UNKNOWN_ACTOR = 'unknown' as const;

export interface LeadAuditEvidenceActorRef {
	/** The stored actor id, or null when the evidence never recorded one. */
	id: number | null;
	/** The recorded account name, or null when it cannot be named. */
	name: string | null;
	/** True when the evidence carries no actor at all. */
	is_unknown: boolean;
}

export interface LeadAuditEvidenceLeadRef {
	id: number;
	lead_id: string | null;
	company_name: string;
}

export interface LeadAuditEvidenceSourceReference {
	/** The stored table that holds the evidence row. */
	table:
		| 'lead_activities'
		| 'lead_stage_history'
		| 'lead_ownership_history'
		| 'lead_activity_corrections'
		| 'lead_legacy_reviews'
		| 'lead_conversions';
	id: number;
}

export interface LeadAuditEvidenceDownstreamProposal {
	id: number;
	/** True when the Proposal fields are withheld by a read grant. */
	restricted: boolean;
	title: string | null;
	status: string | null;
	progress: number | null;
}

export interface LeadAuditEvidenceDownstreamProject {
	id: number;
	restricted: boolean;
	title: string | null;
	status: string | null;
	progress: number | null;
}

/**
 * The permission-controlled downstream block of a conversion row. The Lead
 * evidence stays readable either way; the Proposal and Project facts are
 * absent (and marked restricted) unless the caller holds the matching grant.
 */
export interface LeadAuditEvidenceDownstream {
	proposal: LeadAuditEvidenceDownstreamProposal | null;
	proposal_state: 'available' | 'restricted' | 'unresolved' | 'none';
	project: LeadAuditEvidenceDownstreamProject | null;
	project_state: 'available' | 'restricted' | 'unresolved' | 'none';
}

/** A changed field of a correction, named without exporting the free text. */
export interface LeadAuditCorrectionFieldRef {
	field: string;
	label: string;
}

export interface LeadAuditEvidenceRow {
	evidence_type: LeadAuditEvidenceType;
	evidence_id: number;
	/** Stable `type:id` reference, used by the narrative route. */
	reference: string;
	source_reference: LeadAuditEvidenceSourceReference;
	lead: LeadAuditEvidenceLeadRef;
	actor: LeadAuditEvidenceActorRef;
	/** The moment the evidence describes, when the evidence supports one. */
	occurred_at: string | null;
	/** False when the evidence never recorded an occurrence time. */
	occurrence_known: boolean;
	/** The moment the evidence was recorded; the audit date basis. */
	recorded_at: string | null;
	activity_type: string | null;
	call_outcome: string | null;
	reply_confirmed: boolean | null;
	status: string | null;
	/** A structured, non-narrative description of the evidence. */
	summary: string;
	/** True when the record carries notes, a reason, or another narrative. */
	has_narrative: boolean;
	legacy: boolean;
	/** Correction rows only: the fields whose values changed. */
	change_fields: LeadAuditCorrectionFieldRef[];
	/** Conversion rows only; absent for every other evidence type. */
	downstream?: LeadAuditEvidenceDownstream;
}

/** Deletion evidence is retained, but never invents who or when. */
export interface LeadAuditDeletionFacts {
	known: false;
	actor: null;
	at: null;
	note: string;
}

export const LEAD_AUDIT_DELETION_FACTS: LeadAuditDeletionFacts = {
	known: false,
	actor: null,
	at: null,
	note: 'The record carries a deletion flag only. The deletion actor and time were never recorded and are not derived from update timestamps.',
};

export interface LeadAuditDeletedEvidenceRow extends LeadAuditEvidenceRow {
	deletion: LeadAuditDeletionFacts;
	/** What was deleted: the Lead, or the evidence row itself. */
	deleted_record: 'lead' | 'evidence';
}

export interface LeadAuditEvidenceTypeCount {
	value: LeadAuditEvidenceType;
	label: string;
	count: number;
}

export interface LeadAuditEvidenceEffectiveFilters {
	/** The audit date basis: evidence recording time, not occurrence time. */
	date_basis: string;
	actor: { value: string | null; label: string; is_unknown: boolean };
	activity_type: {
		value: string | null;
		label: string;
		applies_to: 'activity evidence only';
		excludes_other_evidence: boolean;
	};
	outcome: {
		value: string | null;
		label: string;
		applies_to: 'Call and Email activity evidence only';
		excludes_other_evidence: boolean;
	};
	event_type: { value: string | null; label: string };
	undated: { value: boolean; label: string };
	/** Filters that the audit population deliberately does not apply. */
	ignored: Array<{ filter: string; reason: string }>;
}

export interface LeadAuditEvidenceSummary {
	evidence_in_period: number;
	by_type: LeadAuditEvidenceTypeCount[];
	/** Evidence rows in this recording period with no occurrence time. */
	undated_evidence: number;
	unknown_actor: number;
	narrative_available: number;
}

export interface LeadAuditEvidenceFilterOptions {
	actors: Array<{ id: number; full_name: string; is_active: boolean }>;
	activity_types: Array<{ value: string; label: string }>;
	outcomes: Array<{ value: string; label: string }>;
	event_types: Array<{ value: string; label: string }>;
}

export interface LeadAuditEvidenceSection {
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	summary: LeadAuditEvidenceSummary;
	evidence_filters: LeadAuditEvidenceEffectiveFilters;
	filter_options: LeadAuditEvidenceFilterOptions;
	evidence: LeadAuditEvidenceRow[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		total_pages: number;
	};
	deleted: LeadAuditDeletedEvidenceSection;
	narrative: {
		route: string;
		requires: string[];
		detail_available: boolean;
	};
	disclosures: LeadAuditDisclosure[];
}

export interface LeadAuditDeletedEvidenceSummary {
	deleted_leads: number;
	deleted_activities: number;
	evidence_in_view: number;
	by_type: LeadAuditEvidenceTypeCount[];
	unknown_deletion_facts: true;
}

export interface LeadAuditDeletedEvidenceSection {
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	summary: LeadAuditDeletedEvidenceSummary;
	evidence: LeadAuditDeletedEvidenceRow[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		total_pages: number;
	};
	deletion_facts: LeadAuditDeletionFacts;
	disclosures: LeadAuditDisclosure[];
}

/** One narrative value, named and rendered as plain text. */
export interface LeadAuditNarrativeField {
	key: string;
	label: string;
	value: string | null;
}

/** One corrected field: the value before and after the correction. */
export interface LeadAuditNarrativeChange {
	field: string;
	label: string;
	from: string | null;
	to: string | null;
}

export interface LeadAuditEvidenceNarrative {
	evidence_type: LeadAuditEvidenceType;
	evidence_id: number;
	reference: string;
	lead: LeadAuditEvidenceLeadRef;
	actor: LeadAuditEvidenceActorRef;
	occurred_at: string | null;
	occurrence_known: boolean;
	recorded_at: string | null;
	summary: string;
	/** Plain-text narrative fields; there is no stored HTML to render. */
	fields: LeadAuditNarrativeField[];
	/** Correction entries only. */
	changes: LeadAuditNarrativeChange[];
	downstream?: LeadAuditEvidenceDownstream;
	deletion: LeadAuditDeletionFacts | null;
	disclosures: LeadAuditDisclosure[];
}

/** One coverage fact: what the evidence cannot establish. */
export interface LeadAuditCoverageStat {
	code: string;
	label: string;
	/** A literal count, or null when the fact is a statement, not a count. */
	count: number | null;
	population: string;
	detail: string;
	is_exclusion: boolean;
}

export interface LeadAuditCoverageExclusion {
	metric: string;
	label: string;
	excluded: number | null;
	reason: string;
}

export interface LeadAuditCoverageHistoryLimit {
	code: string;
	label: string;
	detail: string;
}

export interface LeadAuditCoverageSection {
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	stats: LeadAuditCoverageStat[];
	evidence_by_type: LeadAuditEvidenceTypeCount[];
	exclusions: LeadAuditCoverageExclusion[];
	history_limits: LeadAuditCoverageHistoryLimit[];
	deleted_evidence: {
		deleted_leads: number;
		deleted_activities: number;
		note: string;
	};
	disclosures: LeadAuditDisclosure[];
}

export interface LeadAuditEvidenceReaderOptions {
	evidenceFilters?: LeadAuditEvidenceFilters;
	undated?: boolean;
	pagination?: LeadAuditPagination;
	includeProposals?: boolean;
	includeProjects?: boolean;
}

export interface LeadAuditEvidenceDetailOptions {
	evidenceFilters?: LeadAuditEvidenceFilters;
	undated?: boolean;
	includeProposals?: boolean;
	includeProjects?: boolean;
}

/** The base filters the evidence population also applies. */
export type LeadAuditEvidenceBaseFilters = LeadAuditFilters;
