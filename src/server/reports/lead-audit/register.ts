import type { DbConnection } from '@/server/leads/shared';
import { buildLeadAuditDisclosures } from './disclosures';
import {
	buildLeadAuditMeta,
	buildLeadAuditScope,
	leadAuditStageLabel,
	resolveLeadAuditEffectiveFilters,
} from './scope';
import {
	buildLeadAuditFilterCondition,
	enquiryInPeriod,
	joinConditions,
	recordedInPeriod,
} from './sql';
import { leadAuditSourceValue } from './source';
import type {
	LeadAuditClock,
	LeadAuditEffectiveFilters,
	LeadAuditFilters,
	LeadAuditMetric,
	LeadAuditPagination,
	LeadAuditRegisterMetric,
	LeadAuditRegisterResult,
	LeadAuditRegisterRow,
	LeadAuditRegisterSection,
} from './types';

interface RegisterRow {
	id: number | string;
	lead_id: string | null;
	company_name: string;
	contact_name: string | null;
	lead_source: string | null;
	priority: string | null;
	enquiry_status: string | null;
	owner_user_id: number | string | null;
	enquiry_date: string | null;
	created_at: string | null;
}

const METRICS: Record<LeadAuditMetric, LeadAuditRegisterMetric> = {
	recorded: {
		key: 'recorded',
		label: 'Leads recorded',
		definition:
			'Distinct non-deleted Leads whose creation time falls inside the selected period. This is system entry, including imports, and not verified enquiry arrival.',
	},
	enquired: {
		key: 'enquired',
		label: 'Enquiries dated in period',
		definition:
			'Distinct non-deleted Leads whose stated Enquiry Date falls inside the selected period, independent of their creation time.',
	},
	missing_enquiry_date: {
		key: 'missing_enquiry_date',
		label: 'Missing Enquiry Dates',
		definition:
			'Distinct non-deleted Leads recorded in the selected period with no stated Enquiry Date. System entry never stands in for the missing date.',
	},
};

function metricCondition(filters: LeadAuditFilters, metric: LeadAuditMetric) {
	const common = buildLeadAuditFilterCondition(filters);
	const recorded = joinConditions(common, recordedInPeriod(filters));
	switch (metric) {
		case 'recorded':
			return recorded;
		case 'enquired':
			return joinConditions(common, enquiryInPeriod(filters));
		case 'missing_enquiry_date':
			return joinConditions(recorded, {
				sql: 'l.enquiry_date IS NULL',
				params: [],
			});
		default: {
			const unreachable: never = metric;
			throw new Error(`Unknown Lead Audit metric: ${unreachable}`);
		}
	}
}

interface RegisterRead {
	total: number;
	missingEnquiryDate: number;
	leads: LeadAuditRegisterRow[];
	effective: LeadAuditEffectiveFilters;
}

/**
 * The register rows and their full-result total. The workbook passes no
 * pagination so it receives the complete applied population under exactly
 * the same condition, projection, and ordering as one HTTP page.
 */
async function readRegisterRows(
	db: DbConnection,
	filters: LeadAuditFilters,
	metric: LeadAuditMetric,
	pagination: LeadAuditPagination | null
): Promise<RegisterRead> {
	const condition = metricCondition(filters, metric);
	const order =
		metric === 'enquired'
			? 'l.enquiry_date DESC, l.created_at DESC, l.id DESC'
			: 'l.created_at DESC, l.id DESC';
	const pageClause = pagination === null ? '' : 'LIMIT ? OFFSET ?';
	const pageParams =
		pagination === null
			? []
			: [pagination.limit, (pagination.page - 1) * pagination.limit];
	const missingCondition = joinConditions(
		joinConditions(
			buildLeadAuditFilterCondition(filters),
			recordedInPeriod(filters)
		),
		{ sql: 'l.enquiry_date IS NULL', params: [] }
	);

	const [totalResult, rowResult, missingResult, effective] = await Promise.all([
		db.execute(
			`SELECT COUNT(*) AS total FROM leads l WHERE ${condition.sql}`,
			condition.params
		),
		db.execute(
			`SELECT l.id, l.lead_id, l.company_name, l.contact_name,
              l.lead_source, l.priority, l.enquiry_status, l.owner_user_id,
              l.enquiry_date, l.created_at
         FROM leads l
         WHERE ${condition.sql}
         ORDER BY ${order}
         ${pageClause}`,
			[...condition.params, ...pageParams]
		),
		db.execute(
			`SELECT COUNT(*) AS total FROM leads l WHERE ${missingCondition.sql}`,
			missingCondition.params
		),
		resolveLeadAuditEffectiveFilters(db, filters),
	]);

	const [totalRows] = totalResult as unknown as [Array<{ total: number | string }>, unknown];
	const total = Number(totalRows[0]?.total) || 0;
	const [missingRows] = missingResult as unknown as [
		Array<{ total: number | string }>,
		unknown,
	];
	const missingEnquiryDate = Number(missingRows[0]?.total) || 0;
	const [rows] = rowResult as unknown as [RegisterRow[], unknown];

	const ownerIds = [
		...new Set(
			rows
				.map((row) => Number(row.owner_user_id))
				.filter((id) => Number.isInteger(id) && id > 0)
		),
	];
	const ownerNames = new Map<number, string | null>();
	if (ownerIds.length > 0) {
		const placeholders = ownerIds.map(() => '?').join(', ');
		const [ownerRows] = (await db.execute(
			`SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), username) AS name
         FROM users WHERE id IN (${placeholders})`,
			ownerIds
		)) as unknown as [Array<{ id: number | string; name: string | null }>, unknown];
		for (const row of ownerRows) {
			ownerNames.set(Number(row.id), row.name ? String(row.name) : null);
		}
	}

	const leads: LeadAuditRegisterRow[] = rows.map((row) => {
		const ownerId = Number(row.owner_user_id);
		const hasOwner = Number.isInteger(ownerId) && ownerId > 0;
		return {
			id: Number(row.id),
			lead_id: row.lead_id ? String(row.lead_id) : null,
			company_name: String(row.company_name),
			contact_name: row.contact_name ? String(row.contact_name) : null,
			source: leadAuditSourceValue(row.lead_source),
			priority: row.priority ? String(row.priority) : null,
			stage: {
				value: row.enquiry_status ? String(row.enquiry_status) : null,
				label: leadAuditStageLabel(
					row.enquiry_status ? String(row.enquiry_status) : null
				),
			},
			owner: hasOwner
				? { id: ownerId, name: ownerNames.get(ownerId) ?? null }
				: null,
			enquiry_date: row.enquiry_date ? String(row.enquiry_date) : null,
			recorded_at: row.created_at ? String(row.created_at) : '',
		};
	});

	return { total, missingEnquiryDate, leads, effective };
}

/** One page of the intake evidence, retaining every applied filter. */
export async function readLeadAuditRegisterSection(
	db: DbConnection,
	filters: LeadAuditFilters,
	metric: LeadAuditMetric,
	pagination: LeadAuditPagination,
	clock: LeadAuditClock
): Promise<LeadAuditRegisterSection> {
	const read = await readRegisterRows(db, filters, metric, pagination);
	return {
		scope: buildLeadAuditScope(filters, read.effective),
		meta: buildLeadAuditMeta(clock),
		metric: METRICS[metric],
		leads: read.leads,
		pagination: {
			page: pagination.page,
			limit: pagination.limit,
			total: read.total,
			total_pages:
				read.total === 0 ? 0 : Math.ceil(read.total / pagination.limit),
		},
		disclosures: buildLeadAuditDisclosures(read.missingEnquiryDate),
	};
}

/**
 * The complete applied intake population, for the workbook export.
 *
 * It uses the same condition, row projection, and ordering as the paginated
 * reader but no page or limit, so the export never truncates the register and
 * never invents a maximum page size.
 */
export async function readLeadAuditRegisterResult(
	db: DbConnection,
	filters: LeadAuditFilters,
	metric: LeadAuditMetric,
	clock: LeadAuditClock
): Promise<LeadAuditRegisterResult> {
	const read = await readRegisterRows(db, filters, metric, null);
	return {
		scope: buildLeadAuditScope(filters, read.effective),
		meta: buildLeadAuditMeta(clock),
		metric: METRICS[metric],
		leads: read.leads,
		total: read.total,
		disclosures: buildLeadAuditDisclosures(read.missingEnquiryDate),
	};
}
