import { nextDay } from './period';
import type { LeadAuditFilters } from './types';

export interface SqlCondition {
	sql: string;
	params: unknown[];
}

const ACTIVE_LEAD = '(l.isDelete = 0 OR l.isDelete IS NULL)';

/**
 * Stored source labels must group and compare byte for byte. The table's
 * default collation is case-insensitive and space-padding, so a plain
 * comparison would merge `Website` and `website` and ignore trailing spaces.
 * The BINARY cast keeps every stored byte distinct.
 */
export const LEAD_AUDIT_SOURCE_LABEL_SQL = 'BINARY l.lead_source';

/**
 * The grouping key: byte-exact labels, with NULL and the empty string folded
 * into one missing group. The BINARY result is decoded back to text before
 * grouping in JavaScript; the missing group is shown as Unknown source.
 */
export const LEAD_AUDIT_SOURCE_GROUP_SQL =
	"COALESCE(BINARY l.lead_source, BINARY '')";

function searchCondition(filters: LeadAuditFilters): SqlCondition {
	if (filters.search === '') return { sql: '', params: [] };
	const term = `%${filters.search.toLowerCase()}%`;
	return {
		sql: '(LOWER(l.lead_id) LIKE ? OR LOWER(l.company_name) LIKE ? OR LOWER(l.contact_name) LIKE ? OR LOWER(l.contact_email) LIKE ? OR LOWER(l.project_description) LIKE ?)',
		params: [term, term, term, term, term],
	};
}

/**
 * The filters every intake figure shares. Source labels compare by exact
 * stored value, so case and surrounding whitespace stay distinct; the
 * missing-source filter is the only grouping the report performs.
 */
export function buildLeadAuditFilterCondition(
	filters: LeadAuditFilters
): SqlCondition {
	const clauses: string[] = [ACTIVE_LEAD];
	const params: unknown[] = [];

	if (filters.ownerUnassigned) {
		clauses.push('l.owner_user_id IS NULL');
	} else if (filters.ownerUserId !== null) {
		clauses.push('l.owner_user_id = ?');
		params.push(filters.ownerUserId);
	}
	if (filters.sourceMissing) {
		clauses.push("(l.lead_source IS NULL OR BINARY l.lead_source = BINARY '')");
	} else if (filters.source !== null) {
		clauses.push(`${LEAD_AUDIT_SOURCE_LABEL_SQL} = CAST(? AS BINARY)`);
		params.push(filters.source);
	}
	if (filters.stage === 'unresolved') {
		clauses.push('l.enquiry_status IS NULL');
	} else if (filters.stage !== null) {
		clauses.push('l.enquiry_status = ?');
		params.push(filters.stage);
	}
	if (filters.priority !== null) {
		clauses.push('l.priority = ?');
		params.push(filters.priority);
	}
	const search = searchCondition(filters);
	if (search.sql !== '') {
		clauses.push(search.sql);
		params.push(...search.params);
	}

	return { sql: clauses.join(' AND '), params };
}

/** The search term alone, for filter options that must not narrow themselves. */
export function buildLeadAuditSearchCondition(
	filters: LeadAuditFilters
): SqlCondition {
	const search = searchCondition(filters);
	return {
		sql: search.sql === '' ? ACTIVE_LEAD : `${ACTIVE_LEAD} AND ${search.sql}`,
		params: search.params,
	};
}

/**
 * Leads recorded: creation time inside the selected calendar days. The
 * upper bound is the exclusive next day at midnight, so the whole last day
 * is included and the next day is not.
 */
export function recordedInPeriod(filters: LeadAuditFilters): SqlCondition {
	return {
		sql: 'l.created_at >= ? AND l.created_at < ?',
		params: [
			`${filters.fromDate} 00:00:00`,
			`${nextDay(filters.toDate)} 00:00:00`,
		],
	};
}

/**
 * Enquiries dated in period: the stated Enquiry Date, independently of the
 * record's creation time. Enquiry Date is a DATE column, compared with the
 * same exclusive next-day bound.
 */
export function enquiryInPeriod(filters: LeadAuditFilters): SqlCondition {
	return {
		sql: 'l.enquiry_date >= ? AND l.enquiry_date < ?',
		params: [filters.fromDate, nextDay(filters.toDate)],
	};
}

export function joinConditions(...conditions: SqlCondition[]): SqlCondition {
	return {
		sql: conditions.map((condition) => condition.sql).join(' AND '),
		params: conditions.flatMap((condition) => condition.params),
	};
}
