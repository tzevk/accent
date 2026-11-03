import type { LeadAuditDisclosure, LeadAuditEffectiveFilters } from './types';

/**
 * The Lead Audit current-state vocabulary (#401).
 *
 * Current-state figures are live present facts: the Lead's owner now and the
 * five operational queues now. They never describe the selected reporting
 * period. The queue keys and their meanings are the existing ones from
 * `src/server/leads/queues.ts`; this module only names them for the report.
 */
export const CURRENT_STATE_RISK_KEYS = [
	'unassigned',
	'untouched',
	'overdue',
	'due_today',
	'no_next_action',
] as const;

export type CurrentStateRiskKey = (typeof CURRENT_STATE_RISK_KEYS)[number];

export type CurrentStateEvidenceGroupKey = 'workload' | 'risk';

/** What the view asks the page to open; the page owns the evidence query. */
export interface CurrentStateEvidenceSelection {
	group: CurrentStateEvidenceGroupKey;
	risk: CurrentStateRiskKey | null;
	/** The current-owner value for workload evidence, when one row was chosen. */
	owner?: number | 'unassigned';
}

export type CurrentStateCounterUnit = 'distinct_leads';

export type CurrentStateEvidenceUnit = 'lead' | 'scheduled_work_item';

export interface CurrentStateIgnoredFilter {
	key: string;
	label: string;
	value: string | null;
	reason: string;
}

export interface CurrentStateScope {
	effective_filters: LeadAuditEffectiveFilters;
	ignored_filters: CurrentStateIgnoredFilter[];
}

/** The observation metadata shared by the section and its evidence. */
export interface CurrentStateObservation {
	generated_at: string;
	today: string;
	time_zone: {
		session: string;
		system: string;
		utc_offset: string;
		label: string;
	};
	date_basis: string;
	live_data_warning: string;
}

export interface CurrentStateOwner {
	/** The current owner, or null for the intake queue. */
	id: number | null;
	name: string;
	is_inactive: boolean;
	is_unknown: boolean;
}

export interface CurrentStateWorkloadGroup {
	owner: CurrentStateOwner;
	count: number;
}

export interface CurrentStateWorkload {
	counter_unit: CurrentStateCounterUnit;
	total: number;
	owners: CurrentStateWorkloadGroup[];
}

export interface CurrentStateRisk {
	key: CurrentStateRiskKey;
	label: string;
	definition: string;
	count: number;
	counter_unit: CurrentStateCounterUnit;
	evidence_unit: CurrentStateEvidenceUnit;
	as_of: string;
}

export interface LeadAuditCurrentStateSection {
	as_of: CurrentStateObservation;
	scope: CurrentStateScope;
	workload: CurrentStateWorkload;
	risks: CurrentStateRisk[];
	disclosures: LeadAuditDisclosure[];
}

export interface CurrentStateEvidenceLead {
	id: number;
	lead_id: string | null;
	company_name: string;
	contact_name: string | null;
}

export interface CurrentStateEvidenceWorkItem {
	id: number;
	activity_type: string | null;
	scheduled_for: string;
	next_action: string | null;
}

/**
 * One evidence row. A Lead queue identifies one Lead; the overdue and
 * due-today registers identify individual scheduled work items, each still
 * carrying its Lead's current owner, source, stage, and priority.
 */
export interface CurrentStateEvidenceRow {
	kind: 'lead' | 'scheduled_work_item';
	lead: CurrentStateEvidenceLead;
	source: { label: string | null; is_unknown: boolean };
	priority: string | null;
	stage: { value: string | null; label: string };
	owner: CurrentStateOwner;
	enquiry_date: string | null;
	recorded_at: string;
	work_item: CurrentStateEvidenceWorkItem | null;
}

export interface CurrentStateEvidenceGroup {
	key: CurrentStateEvidenceGroupKey;
	risk: CurrentStateRiskKey | null;
	label: string;
	definition: string;
	counter_unit: CurrentStateCounterUnit;
	evidence_unit: CurrentStateEvidenceUnit;
}

export interface LeadAuditCurrentStateEvidenceSection {
	as_of: CurrentStateObservation;
	scope: CurrentStateScope;
	group: CurrentStateEvidenceGroup;
	rows: CurrentStateEvidenceRow[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		total_pages: number;
	};
	/** The full-result distinct-Lead count, matching the risk counter. */
	distinct_leads_total: number;
	disclosures: LeadAuditDisclosure[];
}

/** Exported for the view and for evidence descriptions. */
export const CURRENT_STATE_RISK_DEFINITIONS: ReadonlyArray<{
	key: CurrentStateRiskKey;
	label: string;
	definition: string;
	evidence_unit: CurrentStateEvidenceUnit;
}> = [
	{
		key: 'unassigned',
		label: 'Unassigned',
		definition:
			'Non-deleted Leads with no current owner. Current ownership is independent of who recorded work.',
		evidence_unit: 'lead',
	},
	{
		key: 'untouched',
		label: 'Untouched',
		definition:
			'Non-deleted Leads with no completed call, email, or meeting. A completed note alone does not count as outreach.',
		evidence_unit: 'lead',
	},
	{
		key: 'overdue',
		label: 'Overdue work',
		definition:
			'Non-deleted Leads with outstanding scheduled work dated before the database calendar day. Completed, cancelled, and Proposal-transferred work is not outstanding.',
		evidence_unit: 'scheduled_work_item',
	},
	{
		key: 'due_today',
		label: 'Due today',
		definition:
			'Non-deleted Leads with outstanding scheduled work dated on the database calendar day.',
		evidence_unit: 'scheduled_work_item',
	},
	{
		key: 'no_next_action',
		label: 'No Next Action',
		definition:
			'Non-deleted Leads in Attempting Contact, Connected, Qualified, or Nurture with no outstanding scheduled work. New, Disqualified, and Converted Leads do not require a next action.',
		evidence_unit: 'lead',
	},
];

export const CURRENT_STATE_WORKLOAD_DEFINITION =
	'Non-deleted Leads matching the applied current-state filters, grouped by their present owner. Each row is one distinct Lead, including Unassigned Leads and retained inactive or unknown user references.';
