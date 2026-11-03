/**
 * The Time to first outreach vocabulary (#403).
 *
 * These shapes are the section's JSON contract. The section is read through
 * the shared report filters, so every timing figure retains the selected
 * Lead Intake Cohort. Durations are database time differences in whole
 * seconds; no browser or Node time zone is involved.
 */
import type {
	LeadAuditDisclosure,
	LeadAuditFilters,
	LeadAuditMeta,
	LeadAuditPagination,
	LeadAuditScope,
} from './types';

export const LEAD_AUDIT_TIMING_POPULATIONS = [
	'all',
	'sampled',
	'no_outreach',
	'missing_timestamp',
	'incomplete_earlier',
	'negative',
] as const;

/** The evidence population behind a selected timing figure. */
export type LeadAuditTimingPopulation =
	(typeof LEAD_AUDIT_TIMING_POPULATIONS)[number];

/** The measured status of one cohort Lead. `all` is not a status. */
export type LeadAuditTimingStatus = Exclude<
	LeadAuditTimingPopulation,
	'all'
>;

/**
 * Which report filters change this metric, and which are deliberately not
 * applied. Actor, activity-type, outcome, and event-type filters narrow the
 * work and audit evidence; they do not narrow the earliest outreach of a
 * cohort Lead.
 */
export interface LeadAuditTimingFilterScope {
	applied: Array<{ key: string; label: string }>;
	ignored: Array<{
		filter: string;
		label: string;
		value: string;
		reason: string;
	}>;
}

export interface LeadAuditTimingMetric {
	key: 'time_to_first_outreach';
	label: 'Time to first outreach';
	definition: string;
	/** What starts the measured interval. */
	clock: string;
	/** What ends the observation window. */
	observation: string;
	unit: 'seconds';
}

export interface LeadAuditTimingExclusions {
	/** Completed outreach exists but no occurrence time is recorded. */
	missing_timestamp: number;
	/** A known outreach time is accompanied by unknown earlier evidence. */
	incomplete_earlier: number;
	/** The earliest evidenced outreach precedes system entry. */
	negative: number;
	total: number;
}

export interface LeadAuditTimingSection {
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	metric: LeadAuditTimingMetric;
	/** False when no cohort Lead has a valid measured interval. */
	available: boolean;
	/** Null when no valid sample exists; never a fabricated zero. */
	median_seconds: number | null;
	/** Nearest-rank 90th percentile, in seconds; null without samples. */
	p90_seconds: number | null;
	valid_samples: number;
	cohort_leads: number;
	without_outreach: number;
	/** Share of the cohort with no evidenced outreach, 0–1; null if empty. */
	without_outreach_share: number | null;
	exclusions: LeadAuditTimingExclusions;
	filter_scope: LeadAuditTimingFilterScope;
	disclosures: LeadAuditDisclosure[];
}

export interface LeadAuditTimingRow {
	lead_id: number;
	lead_reference: string | null;
	company_name: string;
	contact_name: string | null;
	/** The Lead's system-entry timestamp. */
	recorded_at: string;
	status: LeadAuditTimingStatus;
	/**
	 * Database seconds from system entry to the earliest known outreach. Null
	 * when no occurrence time is known. Negative values are kept as measured,
	 * never clamped.
	 */
	duration_seconds: number | null;
	first_outreach_at: string | null;
	first_outreach_type: string | null;
	first_outreach_id: number | null;
	completed_outreach_count: number;
	unknown_occurrence_count: number;
	exclusion_reason: string | null;
}

export interface LeadAuditTimingEvidenceMetric {
	key: LeadAuditTimingPopulation;
	label: string;
	definition: string;
}

export interface LeadAuditTimingEvidenceSection {
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	metric: LeadAuditTimingEvidenceMetric;
	rows: LeadAuditTimingRow[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		total_pages: number;
	};
	filter_scope: LeadAuditTimingFilterScope;
	disclosures: LeadAuditDisclosure[];
}

/**
 * The global filters the section can receive. The common Lead Audit filters
 * are required; the activity-oriented filters are optional because they are
 * labelled as not applied rather than rejected here. Both the internal
 * camelCase field and the HTTP snake_case field are accepted so the section
 * behaves the same whether it is composed or read through its own route.
 */
export interface LeadAuditTimingIncomingFilters {
	actor?: unknown;
	activityType?: unknown;
	activity_type?: unknown;
	outcome?: unknown;
	eventType?: unknown;
	event_type?: unknown;
	undated?: unknown;
}

export type LeadAuditTimingFilters = LeadAuditFilters &
	LeadAuditTimingIncomingFilters;

export type LeadAuditTimingPagination = LeadAuditPagination;
