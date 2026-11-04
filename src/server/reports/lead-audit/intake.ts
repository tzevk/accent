import { LEAD_STAGES } from '@/lib/lead-stages';
import type { DbConnection } from '@/server/leads/shared';
import {
	LEAD_AUDIT_SOURCE_GROUP_SQL,
	buildLeadAuditFilterCondition,
	buildLeadAuditSearchCondition,
	enquiryInPeriod,
	joinConditions,
	recordedInPeriod,
} from './sql';
import { buildLeadAuditDisclosures } from './disclosures';
import { leadAuditSourceValue } from './source';
import {
	buildLeadAuditMeta,
	buildLeadAuditScope,
	leadAuditStageLabel,
	resolveLeadAuditEffectiveFilters,
} from './scope';
import {
	LEAD_AUDIT_PRIORITIES,
	LEAD_AUDIT_VIEWS,
	type LeadAuditClock,
	type LeadAuditFilters,
	type LeadAuditIntakeSection,
	type LeadAuditSourceGroup,
	type LeadAuditSummary,
} from './types';

interface SummaryRow {
	leads_recorded: number | string;
	enquiries_dated: number | string;
	missing_enquiry_date: number | string;
}

interface BucketRow {
	bucket: string | null;
	count: number | string;
}

interface SourceRow {
	source: string | null;
	count: number | string;
}

interface OwnerOptionRow {
	id: number | string;
	full_name: string | null;
	username: string | null;
	is_active: number | boolean | null;
	status: string | null;
	isDelete: number | boolean | null;
}

function toCount(value: unknown): number {
	return Number(value) || 0;
}

/**
 * Group stored source labels without merging. NULL and the empty string are
 * the missing label; any other value is preserved byte for byte, including
 * case and surrounding whitespace.
 */
function toSourceGroups(rows: SourceRow[]): LeadAuditSourceGroup[] {
	return rows
		.map((row) => ({
			...leadAuditSourceValue(row.source),
			count: toCount(row.count),
		}))
		.sort((left, right) => {
			if (left.count !== right.count) return right.count - left.count;
			if (left.is_unknown !== right.is_unknown) return left.is_unknown ? 1 : -1;
			return (left.label ?? '').localeCompare(right.label ?? '');
		});
}

export async function readLeadAuditIntakeSection(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock
): Promise<LeadAuditIntakeSection> {
	const common = buildLeadAuditFilterCondition(filters);
	const recorded = joinConditions(common, recordedInPeriod(filters));
	const enquiry = joinConditions(common, enquiryInPeriod(filters));
	const recordedWithoutEnquiry = joinConditions(recorded, {
		sql: 'l.enquiry_date IS NULL',
		params: [],
	});
	const searchOnly = buildLeadAuditSearchCondition(filters);

	const [
		summaryResult,
		intakeTrendResult,
		enquiryTrendResult,
		sourceResult,
		ownerOptionResult,
		sourceOptionResult,
		effective,
	] = await Promise.all([
		db.execute(
			`SELECT
         (SELECT COUNT(*) FROM leads l WHERE ${recorded.sql}) AS leads_recorded,
         (SELECT COUNT(*) FROM leads l WHERE ${enquiry.sql}) AS enquiries_dated,
         (SELECT COUNT(*) FROM leads l WHERE ${recordedWithoutEnquiry.sql}) AS missing_enquiry_date`,
			[...recorded.params, ...enquiry.params, ...recordedWithoutEnquiry.params]
		),
		db.execute(
			`SELECT DATE_FORMAT(l.created_at, '%Y-%m-%d') AS bucket, COUNT(*) AS count
         FROM leads l WHERE ${recorded.sql}
         GROUP BY bucket ORDER BY bucket ASC`,
			recorded.params
		),
		db.execute(
			`SELECT DATE_FORMAT(l.enquiry_date, '%Y-%m-%d') AS bucket, COUNT(*) AS count
         FROM leads l WHERE ${enquiry.sql}
         GROUP BY bucket ORDER BY bucket ASC`,
			enquiry.params
		),
		db.execute(
			`SELECT ${LEAD_AUDIT_SOURCE_GROUP_SQL} AS source, COUNT(*) AS count
         FROM leads l WHERE ${recorded.sql}
         GROUP BY ${LEAD_AUDIT_SOURCE_GROUP_SQL}`,
			recorded.params
		),
		db.execute(
			`SELECT u.id,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS full_name,
              u.username, u.is_active, u.status, u.isDelete
         FROM leads l
         JOIN users u ON u.id = l.owner_user_id
         WHERE ${searchOnly.sql}
         GROUP BY u.id, u.full_name, u.username, u.is_active, u.status, u.isDelete
         ORDER BY full_name ASC, u.id ASC`,
			searchOnly.params
		),
		db.execute(
			`SELECT ${LEAD_AUDIT_SOURCE_GROUP_SQL} AS source, COUNT(*) AS count
         FROM leads l WHERE ${searchOnly.sql}
         GROUP BY ${LEAD_AUDIT_SOURCE_GROUP_SQL}`,
			searchOnly.params
		),
		resolveLeadAuditEffectiveFilters(db, filters),
	]);

	const [summaryRows] = summaryResult as unknown as [SummaryRow[], unknown];
	const summaryRow = summaryRows[0];
	const summary: LeadAuditSummary = {
		leads_recorded: toCount(summaryRow?.leads_recorded),
		enquiries_dated: toCount(summaryRow?.enquiries_dated),
		missing_enquiry_date: toCount(summaryRow?.missing_enquiry_date),
		distinct_sources: 0,
	};

	const [intakeRows] = intakeTrendResult as unknown as [BucketRow[], unknown];
	const [enquiryRows] = enquiryTrendResult as unknown as [BucketRow[], unknown];
	const [sourceRows] = sourceResult as unknown as [SourceRow[], unknown];
	const [ownerRows] = ownerOptionResult as unknown as [
		OwnerOptionRow[],
		unknown,
	];
	const [sourceOptionRows] = sourceOptionResult as unknown as [
		SourceRow[],
		unknown,
	];

	const sources = toSourceGroups(sourceRows);
	summary.distinct_sources = sources.length;

	return {
		available_views: LEAD_AUDIT_VIEWS,
		scope: buildLeadAuditScope(filters, effective),
		meta: buildLeadAuditMeta(clock),
		summary,
		trends: {
			intake: intakeRows.map((row) => ({
				date: String(row.bucket ?? ''),
				count: toCount(row.count),
			})),
			enquiry_date: enquiryRows.map((row) => ({
				date: String(row.bucket ?? ''),
				count: toCount(row.count),
			})),
		},
		sources,
		filter_options: {
			owners: ownerRows.map((row) => ({
				id: Number(row.id),
				full_name: String(row.full_name ?? row.username ?? ''),
				is_active: !(
					(row.is_active !== null &&
						row.is_active !== undefined &&
						Number(row.is_active) === 0) ||
					String(row.status ?? '').toLowerCase() === 'inactive' ||
					(row.isDelete !== null &&
						row.isDelete !== undefined &&
						Number(row.isDelete) === 1)
				),
			})),
			sources: toSourceGroups(sourceOptionRows),
			stages: [
				...LEAD_STAGES.map((stage) => ({ value: stage, label: stage })),
				{ value: 'unresolved', label: leadAuditStageLabel(null) },
			],
			priorities: [...LEAD_AUDIT_PRIORITIES],
		},
		disclosures: buildLeadAuditDisclosures(summary.missing_enquiry_date),
	};
}
