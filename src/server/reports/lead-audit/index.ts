/**
 * Lead Audit and Performance report — public read interface.
 *
 * The page, the evidence register, and (later) the workbook export consume
 * these operations. Each operation parses one filter vocabulary and reads
 * through section readers that accept the caller's shared-pool connection,
 * so a multi-section observation can stay on one connection and one clock.
 */
import { readLeadAuditClock } from './clock';
import { withLeadAuditConnection } from './connection';
import {
	parseLeadAuditFilters,
	parseLeadAuditMetric,
	parseLeadAuditPagination,
} from './filters';
import { readLeadAuditIntakeSection } from './intake';
import { readLeadAuditRegisterSection } from './register';

export { canReadLeadAudit } from './access';
export { readLeadAuditClock } from './clock';
export { withLeadAuditConnection } from './connection';
export {
	parseLeadAuditFilters,
	parseLeadAuditMetric,
	parseLeadAuditPagination,
} from './filters';
export { readLeadAuditIntakeSection } from './intake';
export { readLeadAuditRegisterSection } from './register';
export {
	LEAD_AUDIT_METRICS,
	LEAD_AUDIT_PRESETS,
	LEAD_AUDIT_PRIORITIES,
	LEAD_AUDIT_VIEWS,
	LeadAuditValidationError,
} from './types';
export type {
	LeadAuditClock,
	LeadAuditDisclosure,
	LeadAuditEffectiveFilters,
	LeadAuditFilterOptions,
	LeadAuditFilters,
	LeadAuditIntakeSection,
	LeadAuditMeta,
	LeadAuditMetric,
	LeadAuditPagination,
	LeadAuditPreset,
	LeadAuditPriority,
	LeadAuditRegisterMetric,
	LeadAuditRegisterRow,
	LeadAuditRegisterSection,
	LeadAuditScope,
	LeadAuditSourceGroup,
	LeadAuditStageFilter,
	LeadAuditSummary,
	LeadAuditTrendPoint,
	LeadAuditViewKey,
} from './types';

type QuerySource =
	| URLSearchParams
	| Record<string, string | null | undefined>;

/** Overview + intake and sources for one applied filter set. */
export async function readLeadAuditReport(source: QuerySource) {
	return withLeadAuditConnection(async (db) => {
		const clock = await readLeadAuditClock(db);
		const filters = parseLeadAuditFilters(source, clock.today);
		return readLeadAuditIntakeSection(db, filters, clock);
	});
}

/** One page of the evidence behind a selected intake figure. */
export async function readLeadAuditRegister(source: QuerySource) {
	return withLeadAuditConnection(async (db) => {
		const clock = await readLeadAuditClock(db);
		const filters = parseLeadAuditFilters(source, clock.today);
		const metric = parseLeadAuditMetric(source);
		const pagination = parseLeadAuditPagination(source);
		return readLeadAuditRegisterSection(
			db,
			filters,
			metric,
			pagination,
			clock
		);
	});
}
