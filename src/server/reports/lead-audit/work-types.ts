/**
 * The Work and accountability vocabulary (#400).
 *
 * Period work is one population of recorded Lead Activity evidence: a
 * completed activity row with a known occurrence time inside the selected
 * period, on a non-deleted Lead. Everything else the report says about work
 * — outreach, successful contact, authors, exclusions — is a rule over that
 * population, never a second population.
 *
 * Kept apart from the shared `types.ts` so the work slice owns its own
 * shape; `index.ts` re-exports what the report response needs.
 */
import {
	LEAD_ACTIVITY_TYPES,
	isLeadActivityType,
} from '@/lib/lead-activities';
import type { LeadAuditEvidenceEffectiveFilters } from './evidence-filters';
import type { LeadAuditMeta, LeadAuditScope } from './types';

/** The activity-type filter choices: the canonical types plus no-type evidence. */
export const LEAD_AUDIT_ACTIVITY_FILTER_TYPES = [
	...LEAD_ACTIVITY_TYPES,
	'unknown',
] as const;

export const LEAD_AUDIT_WORK_DATE_BASIS =
	'Activity occurrence time (`occurred_at`). The selected calendar dates are inclusive and the query ends at the next day 00:00:00. Work is never dated by the Lead\'s creation time, the activity recording time, or the completion time.';

/**
 * The populations the work evidence can list. Every figure on the section
 * opens one of these, and every one retains the applied filters.
 */
export const LEAD_AUDIT_WORK_EVIDENCE_METRICS = [
	'completed',
	'outreach',
	'successful_contact',
	'call',
	'email',
	'meeting',
	'note',
	'unknown_type',
	'undated',
	'cancelled',
] as const;

export type LeadAuditWorkMetric =
	(typeof LEAD_AUDIT_WORK_EVIDENCE_METRICS)[number];

export interface LeadAuditWorkTypeCounts {
	call: number;
	email: number;
	meeting: number;
	note: number;
	/** Completed activities whose stored type is missing or non-canonical. */
	unknown: number;
}

export interface LeadAuditWorkSummary {
	/** Completed activities with a known occurrence inside the period. */
	completed_total: number;
	/** The same completed total, split by activity type. Sums to it. */
	by_type: LeadAuditWorkTypeCounts;
	/** Completed Call, Email, and Meeting activities. Notes never count. */
	outreach_total: number;
	/** Distinct Leads with at least one completed activity in the period. */
	distinct_leads_worked: number;
	/** Distinct Leads reached by completed outreach, not by attempt volume. */
	distinct_leads_with_outreach: number;
	/** Completed activities that evidence contact: connected calls and replies. */
	successful_contact: number;
	/** Distinct Leads with at least one successful-contact activity. */
	distinct_leads_with_successful_contact: number;
	calls_connected: number;
	/** Completed calls with a canonical non-connected outcome. */
	calls_failed: number;
	/** Completed calls with no usable outcome value; neither connected nor failed. */
	calls_outcome_unknown: number;
	emails_confirmed_reply: number;
	/** Completed emails without a confirmed reply; not successful contact. */
	emails_unconfirmed: number;
	/** Completed activities whose stored version is past its first one. */
	corrected_activities: number;
}

/**
 * Facts the period work figures cannot establish, with their counts inside
 * the applied scope. Zero is a measured zero, not a missing value.
 */
export interface LeadAuditWorkCoverage {
	/** Completed activities with no occurrence time: outside every dated total. */
	unknown_occurrence_date: number;
	/** Completed activities with a missing or non-canonical stored type. */
	unknown_activity_type: number;
	/** Completed activities with no recorded author reference. */
	unknown_author: number;
	/** Completed activities recorded by an account that is now inactive. */
	inactive_author: number;
	/** Completed calls without a stored call outcome. */
	missing_call_outcome: number;
	/** Completed calls whose stored outcome is outside the canonical list. */
	unrecognized_call_outcome: number;
	/** Completed emails with no reply evidence at all, as opposed to a known no. */
	missing_email_reply_evidence: number;
	/** Cancelled work with a known occurrence in the period; never completed work. */
	cancelled_in_period: number;
	/** Soft-deleted activity rows in the period, excluded from every work figure. */
	deleted_activity_rows: number;
}

/** One recorded author of completed work. */
export interface LeadAuditWorkAuthorRow {
	author: {
		id: number | null;
		name: string | null;
		/** No author reference was stored at all. */
		is_unknown: boolean;
		/** The account exists but is inactive; the reference is preserved. */
		is_inactive: boolean;
	};
	completed_total: number;
	by_type: LeadAuditWorkTypeCounts;
	outreach_total: number;
	successful_contact: number;
	/** Distinct Leads this author recorded any completed activity on. */
	distinct_leads: number;
}

/** One applied evidence filter and whether the Work section honours it. */
export interface LeadAuditWorkAppliedFilter {
	key: 'actor' | 'activity_type' | 'outcome' | 'event_type' | 'undated';
	label: string;
	value: string | null;
	display: string;
	state: 'effective' | 'all' | 'ignored';
	reason: string;
}

export interface LeadAuditWorkFilterScope {
	/** The resolved labels behind the applied values. */
	effective: LeadAuditEvidenceEffectiveFilters;
	/** Every evidence filter, including the ones this section ignores. */
	applied: LeadAuditWorkAppliedFilter[];
	/** The Lead-level filters the period work population shares with intake. */
	lead_filters: LeadAuditScope['effective_filters'];
}

export interface LeadAuditWorkFilterOptions {
	/** Recorded authors, including inactive accounts and no active filter. */
	actors: Array<{ id: number; name: string | null; is_active: boolean }>;
	activity_types: Array<{ value: string; label: string }>;
	outcomes: Array<{ value: string; label: string }>;
	event_types: Array<{ value: string; label: string }>;
}

export interface LeadAuditWorkSection {
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	work_date_basis: string;
	summary: LeadAuditWorkSummary;
	coverage: LeadAuditWorkCoverage;
	/** Completed work grouped by recorded author, Unknown author included. */
	authors: LeadAuditWorkAuthorRow[];
	work_filters: LeadAuditWorkFilterScope;
	filter_options: LeadAuditWorkFilterOptions;
	disclosures: Array<{ code: string; text: string }>;
}

export interface LeadAuditWorkEvidenceRow {
	id: number;
	lead: {
		id: number;
		lead_id: string | null;
		company_name: string;
		/** Present-state context only; it never attributes the activity. */
		current_owner: { id: number; name: string | null } | null;
	};
	activity_type: {
		value: string | null;
		label: string;
		is_unknown: boolean;
	};
	status: string;
	call_outcome: string | null;
	reply_confirmed: boolean | null;
	occurred_at: string | null;
	recorded_at: string | null;
	author: LeadAuditWorkAuthorRow['author'];
	is_outreach: boolean;
	is_successful_contact: boolean;
	/** The stored row is past its first version: a correction changed it. */
	corrected: boolean;
}

export interface LeadAuditWorkEvidenceMetric {
	key: LeadAuditWorkMetric;
	label: string;
	definition: string;
}

export interface LeadAuditWorkEvidenceSection {
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	work_date_basis: string;
	metric: LeadAuditWorkEvidenceMetric;
	activities: LeadAuditWorkEvidenceRow[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		total_pages: number;
	};
	work_filters: LeadAuditWorkFilterScope;
	disclosures: Array<{ code: string; text: string }>;
}

/** The canonical type label of one stored activity type value. */
export function leadAuditActivityTypeLabel(
	value: string | null
): { value: string | null; label: string; is_unknown: boolean } {
	if (value === null || !isLeadActivityType(value)) {
		return { value, label: 'Unknown activity type', is_unknown: true };
	}
	return { value, label: value, is_unknown: false };
}
