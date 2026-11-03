export type {
	LeadAuditDisclosure,
	LeadAuditFilterOptions,
	LeadAuditIntakeSection,
	LeadAuditMetric,
	LeadAuditRegisterRow,
	LeadAuditRegisterSection,
	LeadAuditScope,
	LeadAuditSourceGroup,
	LeadAuditSummary,
	LeadAuditTrendPoint,
} from '@/server/reports/lead-audit/types';

/** The editable toolbar state, before Apply turns it into an applied query. */
export interface LeadAuditFilterDraft {
	preset: string;
	from: string;
	to: string;
	owner: string;
	source: string;
	sourceMissing: boolean;
	stage: string;
	priority: string;
	search: string;
}

export interface LeadAuditViewTab {
	key: string;
	label: string;
}
