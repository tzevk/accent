/**
 * The single evidence union behind the audit list.
 *
 * Six evidence tables are normalized into one shape so the report can order
 * mixed evidence by its recording time, type, and id with one deterministic
 * sort and one pagination boundary. Occurrence time is carried separately
 * and never used for the audit date filter.
 */
import { buildLeadAuditFilterCondition, type SqlCondition } from './sql';
import {
	buildDeletedLeadFilterCondition,
	buildEvidenceActivityCondition,
	buildEvidenceActorCondition,
	evidenceRecordedInPeriod,
	evidenceUndatedCondition,
} from './audit-filters';
import type { LeadAuditEvidenceFilters } from './evidence-filters';
import type {
	LeadAuditEvidenceType,
} from './audit-types';
import type { LeadAuditFilters } from './types';

export type EvidencePopulation =
	| 'active'
	| 'deleted_leads'
	| 'deleted_evidence';

export interface EvidenceUnionOptions {
	filters: LeadAuditFilters;
	evidence: LeadAuditEvidenceFilters;
	eventType: LeadAuditEvidenceType | null;
	undated: boolean;
	population: EvidencePopulation;
}

export interface EvidenceUnion {
	sql: string;
	params: unknown[];
}

function combine(...conditions: SqlCondition[]): SqlCondition {
	const active = conditions.filter((condition) => condition.sql !== '');
	return {
		sql: active.map((condition) => condition.sql).join(' AND '),
		params: active.flatMap((condition) => condition.params),
	};
}

function actorNameExpression(alias: string): string {
	return `COALESCE(NULLIF(TRIM(${alias}.full_name), ''), ${alias}.username)`;
}

const ACTIVITY_SELECT = `
  'activity' AS evidence_type, a.id AS evidence_id,
  'lead_activities' AS source_table,
  l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
  COALESCE(a.recorded_at, a.created_at) AS recorded_at,
  a.occurred_at AS occurred_at,
  a.created_by AS actor_id,
  ${actorNameExpression('u')} AS actor_name,
  a.activity_type, a.call_outcome, a.reply_confirmed, a.status, a.scheduled_for,
  NULL AS from_value, NULL AS to_value,
  NULL AS prior_owner_id, NULL AS prior_owner_name,
  NULL AS owner_id, NULL AS owner_name,
  NULL AS activity_ref_id, NULL AS proposal_id,
  NULL AS review_type, NULL AS resolution_source,
  NULL AS original_value, NULL AS resolved_value, NULL AS resolved_reference,
  NULL AS previous_values, NULL AS corrected_values,
  CASE
    WHEN (a.notes IS NOT NULL AND a.notes <> '')
      OR (a.next_action IS NOT NULL AND a.next_action <> '')
    THEN 1 ELSE 0
  END AS detail_present,
  CASE
    WHEN a.created_by IS NULL OR a.activity_type IS NULL OR a.legacy_type IS NOT NULL
    THEN 1 ELSE 0
  END AS legacy_flag
`;

const STAGE_SELECT = `
  'stage_change' AS evidence_type, h.id AS evidence_id,
  'lead_stage_history' AS source_table,
  l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
  COALESCE(h.recorded_at, h.created_at) AS recorded_at,
  COALESCE(h.recorded_at, h.created_at) AS occurred_at,
  h.actor_user_id AS actor_id,
  ${actorNameExpression('u')} AS actor_name,
  NULL AS activity_type, NULL AS call_outcome, NULL AS reply_confirmed,
  NULL AS status, NULL AS scheduled_for,
  h.from_stage AS from_value, h.to_stage AS to_value,
  NULL AS prior_owner_id, NULL AS prior_owner_name,
  NULL AS owner_id, NULL AS owner_name,
  NULL AS activity_ref_id, NULL AS proposal_id,
  NULL AS review_type, h.change_source AS resolution_source,
  NULL AS original_value, NULL AS resolved_value, NULL AS resolved_reference,
  NULL AS previous_values, NULL AS corrected_values,
  CASE WHEN h.reason IS NOT NULL AND h.reason <> '' THEN 1 ELSE 0 END AS detail_present,
  CASE WHEN h.actor_user_id IS NULL THEN 1 ELSE 0 END AS legacy_flag
`;

const OWNER_SELECT = `
  'owner_change' AS evidence_type, o.id AS evidence_id,
  'lead_ownership_history' AS source_table,
  l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
  o.created_at AS recorded_at,
  o.created_at AS occurred_at,
  o.actor_user_id AS actor_id,
  ${actorNameExpression('u')} AS actor_name,
  NULL AS activity_type, NULL AS call_outcome, NULL AS reply_confirmed,
  NULL AS status, NULL AS scheduled_for,
  NULL AS from_value, NULL AS to_value,
  o.prior_owner_user_id AS prior_owner_id, ${actorNameExpression('up')} AS prior_owner_name,
  o.owner_user_id AS owner_id, ${actorNameExpression('uo')} AS owner_name,
  NULL AS activity_ref_id, NULL AS proposal_id,
  NULL AS review_type, NULL AS resolution_source,
  NULL AS original_value, NULL AS resolved_value, NULL AS resolved_reference,
  NULL AS previous_values, NULL AS corrected_values,
  0 AS detail_present,
  CASE WHEN o.actor_user_id IS NULL THEN 1 ELSE 0 END AS legacy_flag
`;

const CORRECTION_SELECT = `
  'correction' AS evidence_type, c.id AS evidence_id,
  'lead_activity_corrections' AS source_table,
  l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
  c.corrected_at AS recorded_at,
  c.corrected_at AS occurred_at,
  c.corrected_by AS actor_id,
  ${actorNameExpression('u')} AS actor_name,
  NULL AS activity_type, NULL AS call_outcome, NULL AS reply_confirmed,
  NULL AS status, NULL AS scheduled_for,
  NULL AS from_value, NULL AS to_value,
  NULL AS prior_owner_id, NULL AS prior_owner_name,
  NULL AS owner_id, NULL AS owner_name,
  c.activity_id AS activity_ref_id, NULL AS proposal_id,
  NULL AS review_type, NULL AS resolution_source,
  NULL AS original_value, NULL AS resolved_value, NULL AS resolved_reference,
  c.previous_values AS previous_values, c.corrected_values AS corrected_values,
  1 AS detail_present,
  CASE WHEN c.corrected_by IS NULL THEN 1 ELSE 0 END AS legacy_flag
`;

const LEGACY_SELECT = `
  'legacy_review' AS evidence_type, r.id AS evidence_id,
  'lead_legacy_reviews' AS source_table,
  l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
  r.resolved_at AS recorded_at,
  r.resolved_at AS occurred_at,
  r.reviewer_user_id AS actor_id,
  COALESCE(${actorNameExpression('u')}, NULLIF(TRIM(r.reviewer_name), '')) AS actor_name,
  NULL AS activity_type, NULL AS call_outcome, NULL AS reply_confirmed,
  NULL AS status, NULL AS scheduled_for,
  NULL AS from_value, NULL AS to_value,
  NULL AS prior_owner_id, NULL AS prior_owner_name,
  NULL AS owner_id, NULL AS owner_name,
  NULL AS activity_ref_id, NULL AS proposal_id,
  r.review_type AS review_type, r.resolution_source AS resolution_source,
  r.original_value AS original_value, r.resolved_value AS resolved_value,
  r.resolved_reference AS resolved_reference,
  NULL AS previous_values, NULL AS corrected_values,
  1 AS detail_present,
  CASE WHEN r.reviewer_user_id IS NULL THEN 1 ELSE 0 END AS legacy_flag
`;

const CONVERSION_SELECT = `
  'conversion' AS evidence_type, cv.id AS evidence_id,
  'lead_conversions' AS source_table,
  l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
  COALESCE(cv.created_at, cv.converted_at) AS recorded_at,
  cv.converted_at AS occurred_at,
  cv.converted_by AS actor_id,
  ${actorNameExpression('u')} AS actor_name,
  NULL AS activity_type, NULL AS call_outcome, NULL AS reply_confirmed,
  NULL AS status, NULL AS scheduled_for,
  NULL AS from_value, NULL AS to_value,
  NULL AS prior_owner_id, NULL AS prior_owner_name,
  NULL AS owner_id, NULL AS owner_name,
  NULL AS activity_ref_id, cv.proposal_id AS proposal_id,
  NULL AS review_type, NULL AS resolution_source,
  NULL AS original_value, NULL AS resolved_value, NULL AS resolved_reference,
  NULL AS previous_values, NULL AS corrected_values,
  0 AS detail_present,
  CASE WHEN cv.converted_by IS NULL THEN 1 ELSE 0 END AS legacy_flag
`;

interface Branch {
	type: LeadAuditEvidenceType;
	sql: string;
	params: unknown[];
}

function activityBranch(options: EvidenceUnionOptions): Branch | null {
	const { filters, evidence, population } = options;
	if (options.eventType !== null && options.eventType !== 'activity') return null;
	const leadCondition =
		population === 'deleted_leads'
			? buildDeletedLeadFilterCondition(filters)
			: buildLeadAuditFilterCondition(filters);
	const conditions: SqlCondition[] = [
		leadCondition,
		buildEvidenceActorCondition('a.created_by', evidence),
		buildEvidenceActivityCondition('a', evidence),
	];
	if (population === 'deleted_leads') {
		// A Lead deletion retains every child row; the evidence itself need
		// not carry its own deletion flag.
	} else if (population === 'deleted_evidence') {
		conditions.push({ sql: 'a.isDelete = 1', params: [] });
	} else {
		conditions.push({ sql: '(a.isDelete = 0 OR a.isDelete IS NULL)', params: [] });
	}
	if (population !== 'deleted_leads' && population !== 'deleted_evidence') {
		conditions.push(
			evidenceRecordedInPeriod(
				'COALESCE(a.recorded_at, a.created_at)',
				filters
			)
		);
	}
	if (options.undated) conditions.push(evidenceUndatedCondition('a'));
	const where = combine(...conditions);
	return {
		type: 'activity',
		sql: `SELECT ${ACTIVITY_SELECT}
      FROM lead_activities a
      JOIN leads l ON l.id = a.lead_id
      LEFT JOIN users u ON u.id = a.created_by
      WHERE ${where.sql}`,
		params: where.params,
	};
}

function stageBranch(options: EvidenceUnionOptions): Branch | null {
	if (options.population === 'deleted_evidence') return null;
	if (options.eventType !== null && options.eventType !== 'stage_change')
		return null;
	if (options.undated) return null;
	const { filters, evidence } = options;
	const leadCondition =
		options.population === 'deleted_leads'
			? buildDeletedLeadFilterCondition(filters)
			: buildLeadAuditFilterCondition(filters);
	const conditions: SqlCondition[] = [
		leadCondition,
		buildEvidenceActorCondition('h.actor_user_id', evidence),
	];
	if (options.population === 'active') {
		conditions.push(
			evidenceRecordedInPeriod('COALESCE(h.recorded_at, h.created_at)', filters)
		);
	}
	const where = combine(...conditions);
	return {
		type: 'stage_change',
		sql: `SELECT ${STAGE_SELECT}
      FROM lead_stage_history h
      JOIN leads l ON l.id = h.lead_id
      LEFT JOIN users u ON u.id = h.actor_user_id
      WHERE ${where.sql}`,
		params: where.params,
	};
}

function ownerBranch(options: EvidenceUnionOptions): Branch | null {
	if (options.population === 'deleted_evidence') return null;
	if (options.eventType !== null && options.eventType !== 'owner_change')
		return null;
	if (options.undated) return null;
	const { filters, evidence } = options;
	const leadCondition =
		options.population === 'deleted_leads'
			? buildDeletedLeadFilterCondition(filters)
			: buildLeadAuditFilterCondition(filters);
	const conditions: SqlCondition[] = [
		leadCondition,
		buildEvidenceActorCondition('o.actor_user_id', evidence),
	];
	if (options.population === 'active') {
		conditions.push(evidenceRecordedInPeriod('o.created_at', filters));
	}
	const where = combine(...conditions);
	return {
		type: 'owner_change',
		sql: `SELECT ${OWNER_SELECT}
      FROM lead_ownership_history o
      JOIN leads l ON l.id = o.lead_id
      LEFT JOIN users u ON u.id = o.actor_user_id
      LEFT JOIN users up ON up.id = o.prior_owner_user_id
      LEFT JOIN users uo ON uo.id = o.owner_user_id
      WHERE ${where.sql}`,
		params: where.params,
	};
}

function correctionBranch(options: EvidenceUnionOptions): Branch | null {
	if (options.eventType !== null && options.eventType !== 'correction')
		return null;
	if (options.undated) return null;
	const { filters, evidence, population } = options;
	const leadCondition =
		population === 'deleted_leads'
			? buildDeletedLeadFilterCondition(filters)
			: buildLeadAuditFilterCondition(filters);
	const conditions: SqlCondition[] = [
		leadCondition,
		buildEvidenceActorCondition('c.corrected_by', evidence),
	];
	if (population === 'deleted_leads') {
		// Retained with the deleted Lead.
	} else if (population === 'deleted_evidence') {
		conditions.push({ sql: '(ca.isDelete = 1)', params: [] });
	} else {
		conditions.push({ sql: '(ca.isDelete = 0 OR ca.isDelete IS NULL)', params: [] });
		conditions.push(evidenceRecordedInPeriod('c.corrected_at', filters));
	}
	const where = combine(...conditions);
	return {
		type: 'correction',
		sql: `SELECT ${CORRECTION_SELECT}
      FROM lead_activity_corrections c
      JOIN lead_activities ca ON ca.id = c.activity_id
      JOIN leads l ON l.id = c.lead_id
      LEFT JOIN users u ON u.id = c.corrected_by
      WHERE ${where.sql}`,
		params: where.params,
	};
}

function legacyBranch(options: EvidenceUnionOptions): Branch | null {
	if (options.population === 'deleted_evidence') return null;
	if (options.eventType !== null && options.eventType !== 'legacy_review')
		return null;
	if (options.undated) return null;
	const { filters, evidence } = options;
	const leadCondition =
		options.population === 'deleted_leads'
			? buildDeletedLeadFilterCondition(filters)
			: buildLeadAuditFilterCondition(filters);
	const conditions: SqlCondition[] = [
		leadCondition,
		buildEvidenceActorCondition('r.reviewer_user_id', evidence),
	];
	if (options.population === 'active') {
		conditions.push(evidenceRecordedInPeriod('r.resolved_at', filters));
	}
	const where = combine(...conditions);
	return {
		type: 'legacy_review',
		sql: `SELECT ${LEGACY_SELECT}
      FROM lead_legacy_reviews r
      JOIN leads l ON l.id = r.lead_id
      LEFT JOIN users u ON u.id = r.reviewer_user_id
      WHERE ${where.sql}`,
		params: where.params,
	};
}

function conversionBranch(options: EvidenceUnionOptions): Branch | null {
	if (options.population === 'deleted_evidence') return null;
	if (options.eventType !== null && options.eventType !== 'conversion')
		return null;
	if (options.undated) return null;
	const { filters, evidence } = options;
	const leadCondition =
		options.population === 'deleted_leads'
			? buildDeletedLeadFilterCondition(filters)
			: buildLeadAuditFilterCondition(filters);
	const conditions: SqlCondition[] = [
		leadCondition,
		buildEvidenceActorCondition('cv.converted_by', evidence),
	];
	if (options.population === 'active') {
		conditions.push(
			evidenceRecordedInPeriod('COALESCE(cv.created_at, cv.converted_at)', filters)
		);
	}
	const where = combine(...conditions);
	return {
		type: 'conversion',
		sql: `SELECT ${CONVERSION_SELECT}
      FROM lead_conversions cv
      JOIN leads l ON l.id = cv.lead_id
      LEFT JOIN users u ON u.id = cv.converted_by
      WHERE ${where.sql}`,
		params: where.params,
	};
}

/** Every evidence branch the selected population and filters include. */
export function buildEvidenceUnion(
	options: EvidenceUnionOptions
): EvidenceUnion {
	// Activity type and outcome speak about activity rows only. When either is
	// applied the population is the activity branch, never a mixed list where
	// the other evidence types silently escape the filter.
	const restricted: EvidenceUnionOptions =
		options.evidence.activityType !== null || options.evidence.outcome !== null
			? { ...options, eventType: 'activity' }
			: options;
	const branches = [
		activityBranch(restricted),
		stageBranch(restricted),
		ownerBranch(restricted),
		correctionBranch(restricted),
		legacyBranch(restricted),
		conversionBranch(restricted),
	].filter((branch): branch is Branch => branch !== null);

	if (branches.length === 0) {
		// No branch can match: an empty typed union keeps the count and page
		// queries valid without inventing a row.
		return {
			sql: `SELECT
        CAST(NULL AS CHAR) AS evidence_type, CAST(NULL AS SIGNED) AS evidence_id,
        CAST(NULL AS CHAR) AS source_table,
        CAST(NULL AS SIGNED) AS lead_pk, CAST(NULL AS CHAR) AS lead_code,
        CAST(NULL AS CHAR) AS company_name,
        CAST(NULL AS DATETIME) AS recorded_at, CAST(NULL AS DATETIME) AS occurred_at,
        CAST(NULL AS SIGNED) AS actor_id, CAST(NULL AS CHAR) AS actor_name,
        CAST(NULL AS CHAR) AS activity_type, CAST(NULL AS CHAR) AS call_outcome,
        CAST(NULL AS SIGNED) AS reply_confirmed, CAST(NULL AS CHAR) AS status,
        CAST(NULL AS DATE) AS scheduled_for,
        CAST(NULL AS CHAR) AS from_value, CAST(NULL AS CHAR) AS to_value,
        CAST(NULL AS SIGNED) AS prior_owner_id, CAST(NULL AS CHAR) AS prior_owner_name,
        CAST(NULL AS SIGNED) AS owner_id, CAST(NULL AS CHAR) AS owner_name,
        CAST(NULL AS SIGNED) AS activity_ref_id, CAST(NULL AS SIGNED) AS proposal_id,
        CAST(NULL AS CHAR) AS review_type, CAST(NULL AS CHAR) AS resolution_source,
        CAST(NULL AS CHAR) AS original_value, CAST(NULL AS CHAR) AS resolved_value,
        CAST(NULL AS SIGNED) AS resolved_reference,
        CAST(NULL AS CHAR) AS previous_values, CAST(NULL AS CHAR) AS corrected_values,
        CAST(NULL AS SIGNED) AS detail_present, CAST(NULL AS SIGNED) AS legacy_flag
        FROM (SELECT 1 AS empty) x WHERE 1 = 0`,
		params: [],
	};
}

	return {
		sql: branches.map((branch) => branch.sql).join('\nUNION ALL\n'),
		params: branches.flatMap((branch) => branch.params),
	};
}
