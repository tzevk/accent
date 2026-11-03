/**
 * The Lead Audit and Performance report vocabulary.
 *
 * Internal filters are parsed once and shared by every read: the page view,
 * the evidence register, and (later) the workbook export. JSON responses use
 * snake_case, matching the other report APIs; the module speaks camelCase.
 */
import type { LeadStage } from '@/lib/lead-stages';

export const LEAD_AUDIT_VIEWS = [
	{ key: 'overview', label: 'Overview' },
	{ key: 'intake', label: 'Intake and sources' },
] as const;

export type LeadAuditViewKey = (typeof LEAD_AUDIT_VIEWS)[number]['key'];

export const LEAD_AUDIT_PRIORITIES = ['Low', 'Medium', 'High'] as const;
export type LeadAuditPriority = (typeof LEAD_AUDIT_PRIORITIES)[number];

export const LEAD_AUDIT_PRESETS = [
	'today',
	'current_month',
	'previous_month',
	'last_7_days',
	'last_30_days',
	'current_quarter',
	'current_year',
	'custom',
] as const;
export type LeadAuditPreset = (typeof LEAD_AUDIT_PRESETS)[number];

export type LeadAuditStageFilter = LeadStage | 'unresolved';

export const LEAD_AUDIT_METRICS = [
	'recorded',
	'enquired',
	'missing_enquiry_date',
] as const;
export type LeadAuditMetric = (typeof LEAD_AUDIT_METRICS)[number];

export interface LeadAuditFilters {
	preset: LeadAuditPreset;
	fromDate: string;
	toDate: string;
	ownerUserId: number | null;
	ownerUnassigned: boolean;
	/** The exact stored source label. Never normalized or merged. */
	source: string | null;
	sourceMissing: boolean;
	stage: LeadAuditStageFilter | null;
	priority: LeadAuditPriority | null;
	search: string;
}

export interface LeadAuditPagination {
	page: number;
	limit: number;
}

export interface LeadAuditClock {
	today: string;
	generatedAt: string;
	timeZone: {
		session: string;
		system: string;
		utcOffset: string;
		label: string;
	};
}

export interface LeadAuditEffectiveFilters {
	owner: { value: string | null; label: string };
	source: { value: string | null; label: string; is_unknown: boolean };
	stage: { value: string | null; label: string };
	priority: string | null;
	search: string;
}

export interface LeadAuditScope {
	preset: LeadAuditPreset;
	from_date: string;
	to_date: string;
	date_basis: string;
	effective_filters: LeadAuditEffectiveFilters;
}

export interface LeadAuditMeta {
	generated_at: string;
	today: string;
	time_zone: {
		session: string;
		system: string;
		utc_offset: string;
		label: string;
	};
	live_data_warning: string;
	date_basis: string;
}

export interface LeadAuditSourceGroup {
	label: string | null;
	is_unknown: boolean;
	count: number;
}

export interface LeadAuditTrendPoint {
	date: string;
	count: number;
}

export interface LeadAuditOwnerOption {
	id: number;
	full_name: string;
	is_active: boolean;
}

export interface LeadAuditFilterOptions {
	owners: LeadAuditOwnerOption[];
	sources: LeadAuditSourceGroup[];
	stages: Array<{ value: string; label: string }>;
	priorities: string[];
}

export interface LeadAuditDisclosure {
	code: string;
	text: string;
}

export interface LeadAuditSummary {
	/** Non-deleted Leads whose creation time falls inside the period. */
	leads_recorded: number;
	/** Non-deleted Leads whose stated Enquiry Date falls inside the period. */
	enquiries_dated: number;
	/** Recorded Leads of the period with no stated Enquiry Date. */
	missing_enquiry_date: number;
	/** Distinct stored source labels represented in the recorded population. */
	distinct_sources: number;
}

export interface LeadAuditIntakeSection {
	available_views: ReadonlyArray<{ key: LeadAuditViewKey; label: string }>;
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	summary: LeadAuditSummary;
	trends: {
		intake: LeadAuditTrendPoint[];
		enquiry_date: LeadAuditTrendPoint[];
	};
	sources: LeadAuditSourceGroup[];
	filter_options: LeadAuditFilterOptions;
	disclosures: LeadAuditDisclosure[];
}

export interface LeadAuditRegisterRow {
	id: number;
	lead_id: string | null;
	company_name: string;
	contact_name: string | null;
	source: { label: string | null; is_unknown: boolean };
	priority: string | null;
	stage: { value: string | null; label: string };
	owner: { id: number; name: string | null } | null;
	enquiry_date: string | null;
	recorded_at: string;
}

export interface LeadAuditRegisterMetric {
	key: LeadAuditMetric;
	label: string;
	definition: string;
}

export interface LeadAuditRegisterSection {
	scope: LeadAuditScope;
	meta: LeadAuditMeta;
	metric: LeadAuditRegisterMetric;
	leads: LeadAuditRegisterRow[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		total_pages: number;
	};
	disclosures: LeadAuditDisclosure[];
}

export class LeadAuditValidationError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = 'LeadAuditValidationError';
		this.code = code;
	}
}
