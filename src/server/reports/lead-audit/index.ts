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
import { parseLeadAuditEvidenceFilters } from './evidence-filters';
import { readLeadAuditWorkSection } from './work';
import {
	buildCurrentStateIgnoredFilters,
	readLeadAuditCurrentStateSection,
} from './current-state';
import { readLeadAuditConversionSection } from './conversion';
import type { LeadAuditConversionReadOptions } from './conversion-types';
import {
	readLeadAuditTimingIncomingFilters,
	readLeadAuditTimingSection,
} from './timing';
import { readLeadAuditEvidenceSection } from './audit';
import { readLeadAuditCoverageSection } from './coverage';
import type { LeadAuditReport } from './types';

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
export { resolveLeadAuditConversionOptions } from './conversion';
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
	LeadAuditReport,
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

type QuerySource = URLSearchParams | Record<string, string | null | undefined>;

/** All report views share one calendar, filter set, and read-only snapshot. */
export async function readLeadAuditReport(
	source: QuerySource,
	downstream: LeadAuditConversionReadOptions = {
		includeProposals: false,
		includeProjects: false,
	}
): Promise<LeadAuditReport> {
	return withLeadAuditConnection(async (db) => {
		const clock = await readLeadAuditClock(db);
		const filters = parseLeadAuditFilters(source, clock.today);
		const evidenceFilters = parseLeadAuditEvidenceFilters(source);
		const [intake, work, currentState, conversion, timing, audit, coverage] =
			await Promise.all([
				readLeadAuditIntakeSection(db, filters, clock),
				readLeadAuditWorkSection(db, filters, clock, evidenceFilters),
				readLeadAuditCurrentStateSection(db, filters, clock, {
					ignoredFilters: buildCurrentStateIgnoredFilters(filters, source),
				}),
				readLeadAuditConversionSection(db, filters, clock, downstream),
				readLeadAuditTimingSection(
					db,
					{
						...filters,
						...readLeadAuditTimingIncomingFilters(source),
					},
					clock
				),
				readLeadAuditEvidenceSection(db, filters, clock, {
					evidenceFilters,
					undated: evidenceFilters.undated,
					...downstream,
				}),
				readLeadAuditCoverageSection(db, filters, clock),
			]);
		const actors = new Map(
			work.filter_options.actors.map((actor) => [actor.id, actor])
		);
		for (const actor of audit.filter_options.actors) {
			actors.set(actor.id, {
				id: actor.id,
				name: actor.full_name,
				is_active: actor.is_active,
			});
		}
		coverage.exclusions.push({
			metric: 'time_to_first_outreach',
			label: 'Time to first outreach',
			excluded: timing.exclusions.total,
			reason: `${timing.exclusions.missing_timestamp} missing timestamps; ${timing.exclusions.incomplete_earlier} incomplete earlier evidence; ${timing.exclusions.negative} negative intervals. ${timing.without_outreach} cohort Leads have no evidenced outreach.`,
		});
		return {
			...intake,
			filter_options: {
				...intake.filter_options,
				actors: [...actors.values()],
			},
			work,
			current_state: currentState,
			conversion,
			timing,
			audit,
			coverage,
		};
	});
}

/** One page of the evidence behind a selected intake figure. */
export async function readLeadAuditRegister(source: QuerySource) {
	return withLeadAuditConnection(async (db) => {
		const clock = await readLeadAuditClock(db);
		const filters = parseLeadAuditFilters(source, clock.today);
		const metric = parseLeadAuditMetric(source);
		const pagination = parseLeadAuditPagination(source);
		return readLeadAuditRegisterSection(db, filters, metric, pagination, clock);
	});
}
