/**
 * Audit evidence and retained deleted-record evidence.
 *
 * One evidence union normalizes available activities, stage/lifecycle
 * decisions, owner changes, corrections, legacy reviews, and conversions.
 * The audit date filter uses the recording timestamp of each evidence row,
 * never the occurrence time the work metrics use; occurrence time is shown
 * separately, and undated evidence stays explicitly inspectable.
 *
 * Nothing here writes: the readers only select. Retained deleted evidence is
 * a separate population with explicit unknown deletion facts; no reader
 * derives a deletion actor or date from an update timestamp.
 */
import { LEGACY_REVIEW_LABELS, type LegacyReviewType } from '@/lib/lead-review';
import {
	describeCorrectionChanges,
	type LeadActivityCorrectionValues,
} from '@/lib/lead-corrections';
import { toIsoDateTime } from '@/server/leads/activity-rows';
import {
	toNullableId,
	trimOrNull,
	type DbConnection,
} from '@/server/leads/shared';
import { buildEvidenceUnion, type EvidenceUnion } from './audit-sql';
import {
	assertAuditEventType,
	assertAuditEvidenceFilterCompatibility,
	buildActivityTypeFilterOptions,
	buildDeletedLeadFilterCondition,
	buildEventTypeFilterOptions,
	buildOutcomeFilterOptions,
	leadAuditActivityTypeLabel,
	leadAuditEvidenceActorValue,
	leadAuditEvidenceTypeLabel,
	leadAuditOutcomeLabel,
} from './audit-filters';
import {
	LEAD_AUDIT_DELETION_FACTS,
	LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS,
	type LeadAuditCorrectionFieldRef,
	type LeadAuditDeletedEvidenceRow,
	type LeadAuditDeletedEvidenceSection,
	type LeadAuditEvidenceActorRef,
	type LeadAuditEvidenceDownstream,
	type LeadAuditEvidenceDownstreamProject,
	type LeadAuditEvidenceDownstreamProposal,
	type LeadAuditEvidenceNarrative,
	type LeadAuditEvidenceReaderOptions,
	type LeadAuditEvidenceRow,
	type LeadAuditEvidenceSection,
	type LeadAuditEvidenceSummary,
	type LeadAuditEvidenceType,
	type LeadAuditEvidenceTypeCount,
	type LeadAuditNarrativeChange,
	type LeadAuditNarrativeField,
	type LeadAuditEvidenceDetailOptions,
} from './audit-types';
import { parseLeadAuditEvidenceFilters } from './evidence-filters';
import type { LeadAuditEvidenceFilters } from './evidence-filters';
import { resolveLeadAuditEvidenceEffectiveFilters } from './evidence-filters';
import {
	buildLeadAuditMeta,
	buildLeadAuditScope,
	leadAuditStageLabel,
	resolveLeadAuditEffectiveFilters,
} from './scope';
import { buildLeadAuditFilterCondition } from './sql';
import {
	LeadAuditValidationError,
	type LeadAuditClock,
	type LeadAuditDisclosure,
	type LeadAuditFilters,
	type LeadAuditPagination,
} from './types';

type QuerySource = URLSearchParams | Record<string, string | null | undefined>;

interface UnionRow {
	evidence_type: string;
	evidence_id: number | string;
	source_table: string;
	lead_pk: number | string;
	lead_code: string | null;
	company_name: string;
	recorded_at: unknown;
	occurred_at: unknown;
	actor_id: number | string | null;
	actor_name: string | null;
	activity_type: string | null;
	call_outcome: string | null;
	reply_confirmed: number | boolean | null;
	status: string | null;
	scheduled_for: unknown;
	from_value: string | null;
	to_value: string | null;
	prior_owner_id: number | string | null;
	prior_owner_name: string | null;
	owner_id: number | string | null;
	owner_name: string | null;
	activity_ref_id: number | string | null;
	proposal_id: number | string | null;
	review_type: string | null;
	resolution_source: string | null;
	original_value: string | null;
	resolved_value: string | null;
	resolved_reference: number | string | null;
	previous_values: string | null;
	corrected_values: string | null;
	detail_present: number | string | null;
	legacy_flag: number | string | null;
}

interface CountRow {
	total: number | string;
}

interface AggregateRow {
	evidence_type: string;
	total: number | string;
	undated: number | string;
	unknown_actor: number | string;
	narrative: number | string;
}

const DEFAULT_PAGINATION: LeadAuditPagination = { page: 1, limit: 25 };

const EMPTY_EVIDENCE_FILTERS: LeadAuditEvidenceFilters = {
	actor: { kind: 'all' },
	activityType: null,
	outcome: null,
	eventType: null,
	undated: false,
};

function toNumber(value: unknown): number {
	return Number(value) || 0;
}

function isTruthyFlag(value: unknown): boolean {
	return value === 1 || value === true || value === '1';
}

function sourceReferenceTable(
	type: LeadAuditEvidenceType
):
	| 'lead_activities'
	| 'lead_stage_history'
	| 'lead_ownership_history'
	| 'lead_activity_corrections'
	| 'lead_legacy_reviews'
	| 'lead_conversions' {
	switch (type) {
		case 'activity':
			return 'lead_activities';
		case 'stage_change':
			return 'lead_stage_history';
		case 'owner_change':
			return 'lead_ownership_history';
		case 'correction':
			return 'lead_activity_corrections';
		case 'legacy_review':
			return 'lead_legacy_reviews';
		case 'conversion':
			return 'lead_conversions';
	}
}

function actorRef(id: unknown, name: unknown): LeadAuditEvidenceActorRef {
	const actorId = toNullableId(id);
	const actorName = trimOrNull(name);
	return actorId === null
		? { id: null, name: actorName, is_unknown: true }
		: { id: actorId, name: actorName, is_unknown: false };
}

function parseCorrectionValues(
	raw: string | null
): LeadActivityCorrectionValues {
	const empty: LeadActivityCorrectionValues = {
		activity_type: null,
		call_outcome: null,
		reply_confirmed: null,
		occurred_at: null,
		notes: null,
	};
	if (raw === null || raw.trim() === '') return empty;
	try {
		const parsed = JSON.parse(raw) as Partial<LeadActivityCorrectionValues>;
		return {
			activity_type: parsed.activity_type ?? null,
			call_outcome: parsed.call_outcome ?? null,
			reply_confirmed:
				parsed.reply_confirmed === null || parsed.reply_confirmed === undefined
					? null
					: Boolean(parsed.reply_confirmed),
			occurred_at: parsed.occurred_at ?? null,
			notes: parsed.notes ?? null,
		};
	} catch {
		return empty;
	}
}

function correctionFieldRefs(row: UnionRow): LeadAuditCorrectionFieldRef[] {
	return describeCorrectionChanges(
		parseCorrectionValues(row.previous_values),
		parseCorrectionValues(row.corrected_values)
	).map((change) => ({ field: change.field, label: change.label }));
}

function activitySummary(row: UnionRow): string {
	const status = trimOrNull(row.status) ?? 'Unknown status';
	const type = leadAuditActivityTypeLabel(trimOrNull(row.activity_type));
	const outcome = trimOrNull(row.call_outcome);
	if (row.activity_type === 'Call') {
		return `${status} call · ${outcome ?? 'Unknown call outcome'}`;
	}
	if (row.activity_type === 'Email') {
		const reply =
			row.reply_confirmed === null || row.reply_confirmed === undefined
				? 'Reply flag unknown'
				: isTruthyFlag(row.reply_confirmed)
					? 'Reply confirmed'
					: 'No confirmed reply';
		return `${status} email · ${reply}`;
	}
	if (row.activity_type === 'Meeting' || row.activity_type === 'Note') {
		return `${status} ${type.toLowerCase()}`;
	}
	return `${status} activity · ${type}`;
}

function stageSummary(row: UnionRow): string {
	const from = leadAuditStageLabel(trimOrNull(row.from_value));
	const to = leadAuditStageLabel(trimOrNull(row.to_value));
	const source = trimOrNull(row.resolution_source);
	return `Stage: ${from} → ${to}${source ? ` (${source})` : ''}`;
}

function ownerSummary(row: UnionRow): string {
	const prior = trimOrNull(row.prior_owner_name);
	const next = trimOrNull(row.owner_name);
	if (next === null && prior === null) return 'Owner change';
	if (next === null) return `Owner removed (was ${prior ?? 'Unassigned'})`;
	return `Owner changed to ${next}${prior ? ` (was ${prior})` : ''}`;
}

function correctionSummary(row: UnionRow): string {
	const fields = correctionFieldRefs(row);
	const activity = toNullableId(row.activity_ref_id);
	const labels = fields.map((field) => field.label).join(', ');
	return `Correction of activity${activity === null ? '' : ` #${activity}`}${
		labels === '' ? '' : `: ${labels}`
	}`;
}

function legacySummary(row: UnionRow): string {
	const reviewType = trimOrNull(row.review_type);
	const label =
		reviewType !== null
			? (LEGACY_REVIEW_LABELS[reviewType as LegacyReviewType] ?? reviewType)
			: 'Legacy fact';
	const source = trimOrNull(row.resolution_source);
	return `${label} review${source ? ` (${source})` : ''}`;
}

function conversionSummary(): string {
	return 'Lead converted (Proposal handoff evidence)';
}

function evidenceSummary(row: UnionRow): string {
	switch (row.evidence_type) {
		case 'activity':
			return activitySummary(row);
		case 'stage_change':
			return stageSummary(row);
		case 'owner_change':
			return ownerSummary(row);
		case 'correction':
			return correctionSummary(row);
		case 'legacy_review':
			return legacySummary(row);
		case 'conversion':
			return conversionSummary();
		default:
			return 'Audit evidence';
	}
}

function toEvidenceType(value: string): LeadAuditEvidenceType {
	if (
		(LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS as readonly { value: string }[]).some(
			(option) => option.value === value
		)
	) {
		return value as LeadAuditEvidenceType;
	}
	throw new Error(`Unknown audit evidence type in the union: ${value}`);
}

function toEvidenceRow(row: UnionRow): LeadAuditEvidenceRow {
	const evidenceType = toEvidenceType(String(row.evidence_type));
	const evidenceId = toNumber(row.evidence_id);
	const occurredAt = toIsoDateTime(row.occurred_at);
	const recordedAt = toIsoDateTime(row.recorded_at);
	return {
		evidence_type: evidenceType,
		evidence_id: evidenceId,
		reference: `${evidenceType}:${evidenceId}`,
		source_reference: {
			table: sourceReferenceTable(evidenceType),
			id: evidenceId,
		},
		lead: {
			id: toNumber(row.lead_pk),
			lead_id: trimOrNull(row.lead_code),
			company_name: String(row.company_name ?? ''),
		},
		actor: actorRef(row.actor_id, row.actor_name),
		occurred_at: occurredAt,
		occurrence_known: occurredAt !== null,
		recorded_at: recordedAt,
		activity_type: trimOrNull(row.activity_type),
		call_outcome: trimOrNull(row.call_outcome),
		reply_confirmed:
			row.reply_confirmed === null || row.reply_confirmed === undefined
				? null
				: isTruthyFlag(row.reply_confirmed),
		status: trimOrNull(row.status),
		summary: evidenceSummary(row),
		has_narrative: isTruthyFlag(row.detail_present),
		legacy: isTruthyFlag(row.legacy_flag),
		change_fields:
			evidenceType === 'correction' ? correctionFieldRefs(row) : [],
	};
}

function toTypeCounts(rows: AggregateRow[]): LeadAuditEvidenceTypeCount[] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		counts.set(String(row.evidence_type), toNumber(row.total));
	}
	return LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS.map((option) => ({
		value: option.value,
		label: option.label,
		count: counts.get(option.value) ?? 0,
	}));
}

function buildEvidenceSummary(
	aggregate: AggregateRow[]
): LeadAuditEvidenceSummary {
	const byType = toTypeCounts(aggregate);
	return {
		evidence_in_period: byType.reduce((sum, type) => sum + type.count, 0),
		by_type: byType,
		undated_evidence: aggregate.reduce(
			(sum, row) => sum + toNumber(row.undated),
			0
		),
		unknown_actor: aggregate.reduce(
			(sum, row) => sum + toNumber(row.unknown_actor),
			0
		),
		narrative_available: aggregate.reduce(
			(sum, row) => sum + toNumber(row.narrative),
			0
		),
	};
}

async function readAggregate(
	db: DbConnection,
	union: EvidenceUnion
): Promise<AggregateRow[]> {
	const [rows] = (await db.execute(
		`SELECT e.evidence_type,
        COUNT(*) AS total,
        SUM(CASE WHEN e.occurred_at IS NULL THEN 1 ELSE 0 END) AS undated,
        SUM(CASE WHEN e.actor_id IS NULL THEN 1 ELSE 0 END) AS unknown_actor,
        SUM(CASE WHEN e.detail_present = 1 THEN 1 ELSE 0 END) AS narrative
      FROM (${union.sql}) e
      GROUP BY e.evidence_type`,
		union.params
	)) as unknown as [AggregateRow[], unknown];
	return rows;
}

async function readCount(db: DbConnection, sql: string, params: unknown[]) {
	const [rows] = (await db.execute(sql, params)) as unknown as [
		CountRow[],
		unknown,
	];
	return toNumber(rows[0]?.total);
}

async function readPage(
	db: DbConnection,
	union: EvidenceUnion,
	pagination: LeadAuditPagination
): Promise<UnionRow[]> {
	const offset = (pagination.page - 1) * pagination.limit;
	const [rows] = (await db.execute(
		`SELECT * FROM (${union.sql}) e
      ORDER BY e.recorded_at DESC, e.evidence_type ASC, e.evidence_id ASC
      LIMIT ? OFFSET ?`,
		[...union.params, pagination.limit, offset]
	)) as unknown as [UnionRow[], unknown];
	return rows;
}

async function readAllRows(
	db: DbConnection,
	union: EvidenceUnion
): Promise<UnionRow[]> {
	const [rows] = (await db.execute(
		`SELECT * FROM (${union.sql}) e
      ORDER BY e.recorded_at DESC, e.evidence_type ASC, e.evidence_id ASC`,
		union.params
	)) as unknown as [UnionRow[], unknown];
	return rows;
}

function paginationMeta(pagination: LeadAuditPagination, total: number) {
	return {
		page: pagination.page,
		limit: pagination.limit,
		total,
		total_pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
	};
}

const DOWNSTREAM_RESTRICTED_NOTE =
	'Downstream Proposal and Project details are withheld because the reader lacks the matching source grant.';

/**
 * Batch-read the permission-controlled downstream context of conversion
 * evidence. A denied grant yields a restricted marker with no title, status,
 * progress, or Project information; nothing is inferred from missing markup.
 */
async function loadConversionDownstream(
	db: DbConnection,
	rows: Array<{ evidence_id: number; proposal_id: number | null }>,
	includeProposals: boolean,
	includeProjects: boolean
): Promise<Map<number, LeadAuditEvidenceDownstream>> {
	const result = new Map<number, LeadAuditEvidenceDownstream>();
	if (rows.length === 0) return result;

	if (!includeProposals) {
		for (const row of rows) {
			result.set(row.evidence_id, {
				proposal: null,
				proposal_state: 'restricted',
				project: null,
				project_state: 'restricted',
			});
		}
		return result;
	}

	const proposalIds = [
		...new Set(
			rows
				.map((row) => row.proposal_id)
				.filter((id): id is number => id !== null && id > 0)
		),
	];
	const proposals = new Map<
		number,
		{
			id: number;
			title: string | null;
			status: string | null;
			progress: number | null;
			project_id: number | null;
		}
	>();
	if (proposalIds.length > 0) {
		const placeholders = proposalIds.map(() => '?').join(', ');
		const [proposalRows] = (await db.execute(
			`SELECT id, proposal_title, status, progress, project_id
        FROM proposals
        WHERE id IN (${placeholders}) AND (isDelete = 0 OR isDelete IS NULL)`,
			proposalIds
		)) as unknown as [
			Array<{
				id: number | string;
				proposal_title: string | null;
				status: string | null;
				progress: unknown;
				project_id: number | string | null;
			}>,
			unknown,
		];
		for (const proposal of proposalRows) {
			proposals.set(toNumber(proposal.id), {
				id: toNumber(proposal.id),
				title: trimOrNull(proposal.proposal_title),
				status: trimOrNull(proposal.status),
				progress:
					proposal.progress === null || proposal.progress === undefined
						? null
						: toNumber(proposal.progress),
				project_id: toNullableId(proposal.project_id),
			});
		}
	}

	const projectIds = includeProjects
		? [
				...new Set(
					[...proposals.values()]
						.map((proposal) => proposal.project_id)
						.filter((id): id is number => id !== null && id > 0)
				),
			]
		: [];
	const projects = new Map<
		number,
		{
			id: number;
			title: string | null;
			status: string | null;
			progress: number | null;
		}
	>();
	if (projectIds.length > 0) {
		const placeholders = projectIds.map(() => '?').join(', ');
		const [projectRows] = (await db.execute(
			`SELECT project_id, project_title, name, status, progress
        FROM projects
        WHERE project_id IN (${placeholders})
          AND (isDelete = 0 OR isDelete IS NULL)`,
			projectIds
		)) as unknown as [
			Array<{
				project_id: number | string;
				project_title: string | null;
				name: string | null;
				status: string | null;
				progress: unknown;
			}>,
			unknown,
		];
		for (const project of projectRows) {
			projects.set(toNumber(project.project_id), {
				id: toNumber(project.project_id),
				title: trimOrNull(project.project_title) ?? trimOrNull(project.name),
				status: trimOrNull(project.status),
				progress:
					project.progress === null || project.progress === undefined
						? null
						: toNumber(project.progress),
			});
		}
	}

	for (const row of rows) {
		const proposal =
			row.proposal_id === null ? undefined : proposals.get(row.proposal_id);
		if (!proposal) {
			result.set(row.evidence_id, {
				proposal: null,
				proposal_state: 'unresolved',
				project: null,
				project_state: 'unresolved',
			});
			continue;
		}
		const proposalBlock: LeadAuditEvidenceDownstreamProposal = {
			id: proposal.id,
			restricted: false,
			title: proposal.title,
			status: proposal.status,
			progress: proposal.progress,
		};
		if (proposal.project_id === null) {
			result.set(row.evidence_id, {
				proposal: proposalBlock,
				proposal_state: 'available',
				project: null,
				project_state: 'none',
			});
			continue;
		}
		if (!includeProjects) {
			result.set(row.evidence_id, {
				proposal: proposalBlock,
				proposal_state: 'available',
				project: null,
				project_state: 'restricted',
			});
			continue;
		}
		const project = projects.get(proposal.project_id);
		const projectBlock: LeadAuditEvidenceDownstreamProject | null = project
			? {
					id: project.id,
					restricted: false,
					title: project.title,
					status: project.status,
					progress: project.progress,
				}
			: null;
		result.set(row.evidence_id, {
			proposal: proposalBlock,
			proposal_state: 'available',
			project: projectBlock,
			project_state: projectBlock ? 'available' : 'unresolved',
		});
	}
	return result;
}

async function attachDownstream(
	db: DbConnection,
	rows: LeadAuditEvidenceRow[],
	unionRows: UnionRow[],
	includeProposals: boolean,
	includeProjects: boolean
): Promise<LeadAuditEvidenceRow[]> {
	const conversions = rows
		.map((row, index) => ({
			row,
			union: unionRows[index],
		}))
		.filter((item) => item.row.evidence_type === 'conversion')
		.map((item) => ({
			evidence_id: item.row.evidence_id,
			proposal_id: toNullableId(item.union?.proposal_id),
		}));
	const downstream = await loadConversionDownstream(
		db,
		conversions,
		includeProposals,
		includeProjects
	);
	return rows.map((row) =>
		row.evidence_type === 'conversion' && downstream.has(row.evidence_id)
			? { ...row, downstream: downstream.get(row.evidence_id) }
			: row
	);
}

async function readEvidenceFilterOptions(db: DbConnection) {
	const [actorRows] = (await db.execute(
		`SELECT id,
        COALESCE(NULLIF(TRIM(full_name), ''), username) AS full_name,
        is_active
      FROM users
      WHERE isDelete = 0
      ORDER BY full_name ASC, id ASC
      LIMIT 500`
	)) as unknown as [
		Array<{
			id: number | string;
			full_name: string | null;
			is_active: number | boolean | null;
		}>,
		unknown,
	];
	return {
		actors: actorRows
			.map((row) => ({
				id: toNumber(row.id),
				full_name: String(row.full_name ?? ''),
				is_active:
					row.is_active === null || row.is_active === undefined
						? true
						: Boolean(Number(row.is_active)),
			}))
			.filter((row) => row.id > 0),
		activity_types: buildActivityTypeFilterOptions(),
		outcomes: buildOutcomeFilterOptions(),
		event_types: buildEventTypeFilterOptions(),
	};
}

function buildEffectiveEvidenceFilters(
	filters: LeadAuditEvidenceFilters,
	undated: boolean,
	actorName: string | null,
	actorIsUnknown: boolean
): LeadAuditEvidenceSection['evidence_filters'] {
	const activityFilter = filters.activityType;
	const outcomeFilter = filters.outcome;
	const eventType = filters.eventType;
	const activitiesOnly = activityFilter !== null || outcomeFilter !== null;
	const actorValue = leadAuditEvidenceActorValue(filters);
	return {
		date_basis:
			'Evidence recording time (activity recorded_at, stage/owner change time, correction corrected_at, legacy review resolved_at, conversion created_at). Occurrence time is shown separately and never selects the audit row.',
		actor: {
			value: actorValue.value,
			label:
				filters.actor.kind === 'user' && actorName !== null
					? actorName
					: actorValue.label,
			is_unknown: actorIsUnknown,
		},
		activity_type: {
			value: activityFilter,
			label:
				activityFilter === null
					? 'All activity types'
					: leadAuditActivityTypeLabel(activityFilter),
			applies_to: 'activity evidence only',
			excludes_other_evidence: activitiesOnly,
		},
		outcome: {
			value: outcomeFilter,
			label:
				outcomeFilter === null
					? 'All outcomes'
					: (leadAuditOutcomeLabel(outcomeFilter) ?? outcomeFilter),
			applies_to: 'Call and Email activity evidence only',
			excludes_other_evidence: activitiesOnly,
		},
		event_type: {
			value: eventType,
			label:
				eventType === null
					? 'All evidence types'
					: leadAuditEvidenceTypeLabel(eventType),
		},
		undated: {
			value: undated,
			label: undated
				? 'Undated activity evidence only (no occurrence time)'
				: 'All evidence, including undated rows',
		},
		ignored: [
			{
				filter: 'Current owner, source, current stage, priority, and search',
				reason:
					'These narrow the Lead population by its current stored facts; they do not select the recording time of evidence.',
			},
			{
				filter: 'Selected period for retained deleted evidence',
				reason:
					'Deletion time was never recorded, so the retained deleted population is shown independently of the period.',
			},
			...(activitiesOnly
				? [
						{
							filter: 'Non-activity evidence',
							reason:
								'Activity type and outcome filters apply to activity evidence only, so other evidence types are excluded rather than silently left unfiltered.',
						},
					]
				: []),
		],
	};
}

export function parseAuditEvidenceRequest(source: QuerySource): {
	evidenceFilters: LeadAuditEvidenceFilters;
	undated: boolean;
} {
	const evidenceFilters = parseLeadAuditEvidenceFilters(source);
	return { evidenceFilters, undated: evidenceFilters.undated };
}

/**
 * One page of audit evidence, its full-result totals, and the first page of
 * retained deleted evidence, all read on the caller's connection.
 */
export async function readLeadAuditEvidenceSection(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock,
	options: LeadAuditEvidenceReaderOptions = {}
): Promise<LeadAuditEvidenceSection> {
	const evidenceFilters = options.evidenceFilters ?? EMPTY_EVIDENCE_FILTERS;
	const eventType = assertAuditEventType(evidenceFilters.eventType);
	assertAuditEvidenceFilterCompatibility(evidenceFilters, eventType);
	const undated = options.undated ?? evidenceFilters.undated;
	const pagination = options.pagination ?? DEFAULT_PAGINATION;
	const union = buildEvidenceUnion({
		filters,
		evidence: evidenceFilters,
		eventType,
		undated,
		population: 'active',
	});

	const [
		total,
		aggregate,
		unionRows,
		filterOptions,
		effective,
		baseEffective,
		deleted,
	] = await Promise.all([
		readCount(
			db,
			`SELECT COUNT(*) AS total FROM (${union.sql}) e`,
			union.params
		),
		readAggregate(db, union),
		readPage(db, union, pagination),
		readEvidenceFilterOptions(db),
		resolveLeadAuditEvidenceEffectiveFilters(db, evidenceFilters),
		resolveLeadAuditEffectiveFilters(db, filters),
		readLeadAuditDeletedEvidenceSection(
			db,
			filters,
			clock,
			DEFAULT_PAGINATION,
			{
				evidenceFilters,
				includeProposals: false,
				includeProjects: false,
			}
		),
	]);

	const baseRows = unionRows.map(toEvidenceRow);
	const evidence = await attachDownstream(
		db,
		baseRows,
		unionRows,
		options.includeProposals ?? false,
		options.includeProjects ?? false
	);

	return {
		scope: buildLeadAuditScope(filters, baseEffective),
		meta: buildLeadAuditMeta(clock),
		summary: buildEvidenceSummary(aggregate),
		evidence_filters: buildEffectiveEvidenceFilters(
			evidenceFilters,
			undated,
			effective.actor.label,
			effective.actor.is_unknown
		),
		filter_options: filterOptions,
		evidence,
		pagination: paginationMeta(pagination, total),
		deleted,
		narrative: {
			route: '/api/reports/lead-audit/audit/narrative',
			requires: ['reports:read', 'leads:read'],
			detail_available: true,
		},
		disclosures: auditDisclosures(deleted.summary),
	};
}

/** The complete filtered audit result, for the workbook export. */
export async function readLeadAuditEvidenceDetail(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock,
	options: LeadAuditEvidenceDetailOptions = {}
): Promise<LeadAuditEvidenceRow[]> {
	const evidenceFilters = options.evidenceFilters ?? EMPTY_EVIDENCE_FILTERS;
	const eventType = assertAuditEventType(evidenceFilters.eventType);
	assertAuditEvidenceFilterCompatibility(evidenceFilters, eventType);
	const union = buildEvidenceUnion({
		filters,
		evidence: evidenceFilters,
		eventType,
		undated: options.undated ?? evidenceFilters.undated,
		population: 'active',
	});
	const unionRows = await readAllRows(db, union);
	const baseRows = unionRows.map(toEvidenceRow);
	return attachDownstream(
		db,
		baseRows,
		unionRows,
		options.includeProposals ?? false,
		options.includeProjects ?? false
	);
}

function buildDeletedUnion(
	filters: LeadAuditFilters,
	evidence: LeadAuditEvidenceFilters,
	eventType: LeadAuditEvidenceType | null,
	undated: boolean
): EvidenceUnion {
	let deletedEventType = eventType;
	if (evidence.eventType === 'deleted_record') deletedEventType = null;
	const deletedLeads = buildEvidenceUnion({
		filters,
		evidence,
		eventType: deletedEventType,
		undated,
		population: 'deleted_leads',
	});
	const deletedEvidence = buildEvidenceUnion({
		filters,
		evidence,
		eventType: deletedEventType,
		undated,
		population: 'deleted_evidence',
	});
	return {
		sql: `${deletedLeads.sql}\nUNION ALL\n${deletedEvidence.sql}`,
		params: [...deletedLeads.params, ...deletedEvidence.params],
	};
}

function deletedEventTypeFor(
	evidence: LeadAuditEvidenceFilters
): LeadAuditEvidenceType | null {
	if (evidence.eventType === 'deleted_record') return null;
	if (evidence.eventType === 'unknown') {
		throw new LeadAuditValidationError(
			'invalid_event_type',
			'Unknown is not a deleted evidence type'
		);
	}
	return assertAuditEventType(evidence.eventType);
}

async function readDeletedSummary(
	db: DbConnection,
	filters: LeadAuditFilters
): Promise<{ deleted_leads: number; deleted_activities: number }> {
	const leadCondition = buildDeletedLeadFilterCondition(filters);
	const activeLeadCondition = buildLeadAuditFilterCondition(filters);
	const [deletedLeads, deletedActivities] = await Promise.all([
		readCount(
			db,
			`SELECT COUNT(*) AS total FROM leads l WHERE ${leadCondition.sql}`,
			leadCondition.params
		),
		readCount(
			db,
			`SELECT COUNT(*) AS total FROM lead_activities a
        JOIN leads l ON l.id = a.lead_id
        WHERE ${activeLeadCondition.sql} AND a.isDelete = 1`,
			activeLeadCondition.params
		),
	]);
	return { deleted_leads: deletedLeads, deleted_activities: deletedActivities };
}

/** One page of the separately labelled retained deleted evidence. */
export async function readLeadAuditDeletedEvidenceSection(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock,
	pagination: LeadAuditPagination = DEFAULT_PAGINATION,
	options: LeadAuditEvidenceReaderOptions = {}
): Promise<LeadAuditDeletedEvidenceSection> {
	const evidenceFilters = options.evidenceFilters ?? EMPTY_EVIDENCE_FILTERS;
	const eventType = deletedEventTypeFor(evidenceFilters);
	assertAuditEvidenceFilterCompatibility(evidenceFilters, eventType);
	const undated = options.undated ?? evidenceFilters.undated;
	const union = buildDeletedUnion(filters, evidenceFilters, eventType, undated);

	const [total, aggregate, unionRows, summary, baseEffective] =
		await Promise.all([
			readCount(
				db,
				`SELECT COUNT(*) AS total FROM (${union.sql}) e`,
				union.params
			),
			readAggregate(db, union),
			readPage(db, union, pagination),
			readDeletedSummary(db, filters),
			resolveLeadAuditEffectiveFilters(db, filters),
		]);

	const evidence = await markDeletedEvidence(db, unionRows);
	return {
		scope: buildLeadAuditScope(filters, baseEffective),
		meta: buildLeadAuditMeta(clock),
		summary: {
			deleted_leads: summary.deleted_leads,
			deleted_activities: summary.deleted_activities,
			evidence_in_view: total,
			by_type: toTypeCounts(aggregate),
			unknown_deletion_facts: true,
		},
		evidence,
		pagination: paginationMeta(pagination, total),
		deletion_facts: LEAD_AUDIT_DELETION_FACTS,
		disclosures: deletedDisclosures(),
	};
}

/** The complete retained deleted population, for the workbook export. */
export async function readLeadAuditDeletedEvidenceDetail(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock,
	options: LeadAuditEvidenceDetailOptions = {}
): Promise<LeadAuditDeletedEvidenceRow[]> {
	const evidenceFilters = options.evidenceFilters ?? EMPTY_EVIDENCE_FILTERS;
	const eventType = deletedEventTypeFor(evidenceFilters);
	assertAuditEvidenceFilterCompatibility(evidenceFilters, eventType);
	const union = buildDeletedUnion(
		filters,
		evidenceFilters,
		eventType,
		options.undated ?? evidenceFilters.undated
	);
	const unionRows = await readAllRows(db, union);
	return markDeletedEvidence(db, unionRows);
}

async function markDeletedEvidence(
	db: DbConnection,
	unionRows: UnionRow[]
): Promise<LeadAuditDeletedEvidenceRow[]> {
	const rows = unionRows.map(toEvidenceRow);
	const leadIds = [...new Set(rows.map((row) => row.lead.id))];
	const deletedLeadIds = new Set<number>();
	if (leadIds.length > 0) {
		const placeholders = leadIds.map(() => '?').join(', ');
		const [leadRows] = (await db.execute(
			`SELECT id, isDelete FROM leads WHERE id IN (${placeholders})`,
			leadIds
		)) as unknown as [
			Array<{ id: number | string; isDelete: number | boolean | null }>,
			unknown,
		];
		for (const lead of leadRows) {
			if (isTruthyFlag(lead.isDelete)) deletedLeadIds.add(toNumber(lead.id));
		}
	}
	return rows.map((row) => ({
		...row,
		deletion: LEAD_AUDIT_DELETION_FACTS,
		deleted_record: deletedLeadIds.has(row.lead.id) ? 'lead' : 'evidence',
	}));
}

function auditDisclosures(
	deleted: LeadAuditDeletedEvidenceSection['summary']
): LeadAuditDisclosure[] {
	return [
		{
			code: 'audit_recording_time',
			text: 'Audit rows are selected by the moment the evidence was recorded. Occurrence time is shown separately and never substitutes for a recording time.',
		},
		{
			code: 'audit_occurrence_unknown',
			text: 'Activity evidence with no occurrence time remains inspectable and is marked undated; it is never inserted into occurrence-dated work metrics.',
		},
		{
			code: 'audit_actor_unknown',
			text: 'An actor the evidence never recorded stays Unknown. The current Lead owner and the latest editor are never used as substitute historical actors.',
		},
		{
			code: 'audit_legacy_unknown',
			text: 'Legacy stage, owner, and call-outcome facts stay explicitly unknown or unresolved. Stage-entry and assignment times are never derived from record creation or update timestamps.',
		},
		{
			code: 'audit_not_complete_log',
			text: 'This report exposes the evidence the system stores. Generic enquiry edits, task rescheduling, and some historical stage changes lack a complete event history, so it is not a compliance-grade change log.',
		},
		{
			code: 'audit_corrections_live',
			text: 'A correction is its own audit event and never a second completed activity. Corrected values are the current facts, so earlier-period figures can change on a later observation.',
		},
		{
			code: 'audit_downstream_restricted',
			text: DOWNSTREAM_RESTRICTED_NOTE,
		},
		{
			code: 'deleted_evidence',
			text: `Retained deleted evidence is a separate population (${deleted.evidence_in_view} row(s) in this view). It never enters operational intake, work, cohort, risk, or owner totals.`,
		},
		{
			code: 'deleted_facts_unknown',
			text: LEAD_AUDIT_DELETION_FACTS.note,
		},
	];
}

function deletedDisclosures(): LeadAuditDisclosure[] {
	return [
		{
			code: 'deleted_population',
			text: 'This list contains retained evidence of soft-deleted Leads and soft-deleted activity rows. It is separate from every operational figure.',
		},
		{
			code: 'deleted_facts_unknown',
			text: LEAD_AUDIT_DELETION_FACTS.note,
		},
		{
			code: 'deleted_period',
			text: 'The selected period does not select deleted evidence: deletion time was never recorded. Current owner, source, stage, priority, search, actor, and evidence-type filters still apply.',
		},
		{
			code: 'deleted_readable',
			text: 'Deleted evidence remains readable here because an operational detail page may no longer exist for the record.',
		},
	];
}

/* ------------------------------------------------------------------ */
/* Narrative evidence                                                  */
/* ------------------------------------------------------------------ */

interface NarrativeRef {
	evidenceType: LeadAuditEvidenceType;
	evidenceId: number;
}

export function parseAuditNarrativeReference(
	source: QuerySource
): NarrativeRef {
	const rawType =
		source instanceof URLSearchParams
			? (source.get('type') ?? '')
			: (source.type ?? '');
	const rawId =
		source instanceof URLSearchParams
			? (source.get('id') ?? '')
			: (source.id ?? '');
	const type = rawType.trim();
	if (
		!(LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS as readonly { value: string }[]).some(
			(option) => option.value === type
		)
	) {
		throw new LeadAuditValidationError(
			'invalid_evidence_type',
			`Unknown evidence type: ${type}`
		);
	}
	if (!/^\d+$/.test(String(rawId).trim())) {
		throw new LeadAuditValidationError(
			'invalid_evidence_id',
			'Evidence id must be a positive integer'
		);
	}
	const evidenceId = Number(String(rawId).trim());
	if (!Number.isSafeInteger(evidenceId) || evidenceId < 1) {
		throw new LeadAuditValidationError(
			'invalid_evidence_id',
			'Evidence id must be a positive integer'
		);
	}
	return { evidenceType: type as LeadAuditEvidenceType, evidenceId };
}

function narrativeFields(
	pairs: Array<[string, string, string | null | undefined]>
): LeadAuditNarrativeField[] {
	return pairs.map(([key, label, value]) => ({
		key,
		label,
		value: value === null || value === undefined ? null : String(value),
	}));
}

function correctionNarrative(
	previous: LeadActivityCorrectionValues,
	corrected: LeadActivityCorrectionValues
): LeadAuditNarrativeChange[] {
	return describeCorrectionChanges(previous, corrected).map((change) => ({
		field: change.field,
		label: change.label,
		from: change.from,
		to: change.to,
	}));
}

function ownerDisplay(id: unknown, name: unknown): string {
	const ownerId = toNullableId(id);
	if (ownerId === null) return 'Unassigned';
	return trimOrNull(name) ?? `Unknown user #${ownerId}`;
}

interface NarrativeRow {
	lead_pk: number | string;
	lead_code: string | null;
	company_name: string;
	lead_deleted: number | boolean | null;
	evidence_deleted: number | boolean | null;
	actor_id: number | string | null;
	actor_name: string | null;
	recorded_at: unknown;
	occurred_at: unknown;
	status: string | null;
	activity_type: string | null;
	call_outcome: string | null;
	reply_confirmed: number | boolean | null;
	scheduled_for: unknown;
	notes: string | null;
	next_action: string | null;
	from_value: string | null;
	to_value: string | null;
	change_source: string | null;
	reason: string | null;
	prior_owner_id: number | string | null;
	prior_owner_name: string | null;
	owner_id: number | string | null;
	owner_name: string | null;
	review_type: string | null;
	original_value: string | null;
	resolved_value: string | null;
	resolved_reference: number | string | null;
	resolution_source: string | null;
	reviewer_name: string | null;
	previous_values: string | null;
	corrected_values: string | null;
	activity_id: number | string | null;
	proposal_id: number | string | null;
}

async function loadNarrativeRow(
	db: DbConnection,
	ref: NarrativeRef
): Promise<NarrativeRow | null> {
	switch (ref.evidenceType) {
		case 'activity': {
			const [rows] = (await db.execute(
				`SELECT l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
            l.isDelete AS lead_deleted,
            a.isDelete AS evidence_deleted,
            a.created_by AS actor_id,
            COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS actor_name,
            COALESCE(a.recorded_at, a.created_at) AS recorded_at,
            a.occurred_at, a.status, a.activity_type, a.call_outcome,
            a.reply_confirmed, a.scheduled_for, a.notes, a.next_action,
            NULL AS from_value, NULL AS to_value, NULL AS change_source,
            NULL AS reason, NULL AS prior_owner_id, NULL AS prior_owner_name,
            NULL AS owner_id, NULL AS owner_name, NULL AS review_type,
            NULL AS original_value, NULL AS resolved_value,
            NULL AS resolved_reference, NULL AS resolution_source,
            NULL AS reviewer_name, NULL AS previous_values,
            NULL AS corrected_values, NULL AS activity_id, NULL AS proposal_id
          FROM lead_activities a
          JOIN leads l ON l.id = a.lead_id
          LEFT JOIN users u ON u.id = a.created_by
          WHERE a.id = ? LIMIT 1`,
				[ref.evidenceId]
			)) as unknown as [NarrativeRow[], unknown];
			return rows[0] ?? null;
		}
		case 'stage_change': {
			const [rows] = (await db.execute(
				`SELECT l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
            l.isDelete AS lead_deleted,
            NULL AS evidence_deleted,
            h.actor_user_id AS actor_id,
            COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS actor_name,
            COALESCE(h.recorded_at, h.created_at) AS recorded_at,
            COALESCE(h.recorded_at, h.created_at) AS occurred_at,
            NULL AS status, NULL AS activity_type, NULL AS call_outcome,
            NULL AS reply_confirmed, NULL AS scheduled_for,
            NULL AS notes, NULL AS next_action,
            h.from_stage AS from_value, h.to_stage AS to_value,
            h.change_source, h.reason,
            NULL AS prior_owner_id, NULL AS prior_owner_name,
            NULL AS owner_id, NULL AS owner_name,
            NULL AS review_type, NULL AS original_value, NULL AS resolved_value,
            NULL AS resolved_reference, NULL AS resolution_source,
            NULL AS reviewer_name, NULL AS previous_values,
            NULL AS corrected_values, NULL AS activity_id, NULL AS proposal_id
          FROM lead_stage_history h
          JOIN leads l ON l.id = h.lead_id
          LEFT JOIN users u ON u.id = h.actor_user_id
          WHERE h.id = ? LIMIT 1`,
				[ref.evidenceId]
			)) as unknown as [NarrativeRow[], unknown];
			return rows[0] ?? null;
		}
		case 'owner_change': {
			const [rows] = (await db.execute(
				`SELECT l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
            l.isDelete AS lead_deleted,
            NULL AS evidence_deleted,
            o.actor_user_id AS actor_id,
            COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS actor_name,
            o.created_at AS recorded_at, o.created_at AS occurred_at,
            NULL AS status, NULL AS activity_type, NULL AS call_outcome,
            NULL AS reply_confirmed, NULL AS scheduled_for,
            NULL AS notes, NULL AS next_action,
            NULL AS from_value, NULL AS to_value, NULL AS change_source,
            NULL AS reason,
            o.prior_owner_user_id AS prior_owner_id,
            COALESCE(NULLIF(TRIM(up.full_name), ''), up.username) AS prior_owner_name,
            o.owner_user_id AS owner_id,
            COALESCE(NULLIF(TRIM(uo.full_name), ''), uo.username) AS owner_name,
            NULL AS review_type, NULL AS original_value, NULL AS resolved_value,
            NULL AS resolved_reference, NULL AS resolution_source,
            NULL AS reviewer_name, NULL AS previous_values,
            NULL AS corrected_values, NULL AS activity_id, NULL AS proposal_id
          FROM lead_ownership_history o
          JOIN leads l ON l.id = o.lead_id
          LEFT JOIN users u ON u.id = o.actor_user_id
          LEFT JOIN users up ON up.id = o.prior_owner_user_id
          LEFT JOIN users uo ON uo.id = o.owner_user_id
          WHERE o.id = ? LIMIT 1`,
				[ref.evidenceId]
			)) as unknown as [NarrativeRow[], unknown];
			return rows[0] ?? null;
		}
		case 'correction': {
			const [rows] = (await db.execute(
				`SELECT l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
            l.isDelete AS lead_deleted,
            ca.isDelete AS evidence_deleted,
            c.corrected_by AS actor_id,
            COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS actor_name,
            c.corrected_at AS recorded_at, c.corrected_at AS occurred_at,
            NULL AS status, NULL AS activity_type, NULL AS call_outcome,
            NULL AS reply_confirmed, NULL AS scheduled_for,
            NULL AS notes, NULL AS next_action,
            NULL AS from_value, NULL AS to_value, NULL AS change_source,
            c.reason,
            NULL AS prior_owner_id, NULL AS prior_owner_name,
            NULL AS owner_id, NULL AS owner_name,
            NULL AS review_type, NULL AS original_value, NULL AS resolved_value,
            NULL AS resolved_reference, NULL AS resolution_source,
            NULL AS reviewer_name,
            c.previous_values, c.corrected_values,
            c.activity_id, NULL AS proposal_id
          FROM lead_activity_corrections c
          JOIN lead_activities ca ON ca.id = c.activity_id
          JOIN leads l ON l.id = c.lead_id
          LEFT JOIN users u ON u.id = c.corrected_by
          WHERE c.id = ? LIMIT 1`,
				[ref.evidenceId]
			)) as unknown as [NarrativeRow[], unknown];
			return rows[0] ?? null;
		}
		case 'legacy_review': {
			const [rows] = (await db.execute(
				`SELECT l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
            l.isDelete AS lead_deleted,
            NULL AS evidence_deleted,
            r.reviewer_user_id AS actor_id,
            COALESCE(
              NULLIF(TRIM(u.full_name), ''),
              NULLIF(TRIM(r.reviewer_name), ''),
              u.username
            ) AS actor_name,
            r.resolved_at AS recorded_at, r.resolved_at AS occurred_at,
            NULL AS status, NULL AS activity_type, NULL AS call_outcome,
            NULL AS reply_confirmed, NULL AS scheduled_for,
            NULL AS notes, NULL AS next_action,
            NULL AS from_value, NULL AS to_value, NULL AS change_source,
            r.reason,
            NULL AS prior_owner_id, NULL AS prior_owner_name,
            NULL AS owner_id, NULL AS owner_name,
            r.review_type, r.original_value, r.resolved_value,
            r.resolved_reference, r.resolution_source,
            r.reviewer_name, NULL AS previous_values,
            NULL AS corrected_values, NULL AS activity_id, NULL AS proposal_id
          FROM lead_legacy_reviews r
          JOIN leads l ON l.id = r.lead_id
          LEFT JOIN users u ON u.id = r.reviewer_user_id
          WHERE r.id = ? LIMIT 1`,
				[ref.evidenceId]
			)) as unknown as [NarrativeRow[], unknown];
			return rows[0] ?? null;
		}
		case 'conversion': {
			const [rows] = (await db.execute(
				`SELECT l.id AS lead_pk, l.lead_id AS lead_code, l.company_name,
            l.isDelete AS lead_deleted,
            NULL AS evidence_deleted,
            cv.converted_by AS actor_id,
            COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS actor_name,
            COALESCE(cv.created_at, cv.converted_at) AS recorded_at,
            cv.converted_at AS occurred_at,
            NULL AS status, NULL AS activity_type, NULL AS call_outcome,
            NULL AS reply_confirmed, NULL AS scheduled_for,
            NULL AS notes, NULL AS next_action,
            NULL AS from_value, NULL AS to_value, NULL AS change_source,
            NULL AS reason,
            NULL AS prior_owner_id, NULL AS prior_owner_name,
            NULL AS owner_id, NULL AS owner_name,
            NULL AS review_type, NULL AS original_value, NULL AS resolved_value,
            NULL AS resolved_reference, NULL AS resolution_source,
            NULL AS reviewer_name, NULL AS previous_values,
            NULL AS corrected_values, NULL AS activity_id,
            cv.proposal_id
          FROM lead_conversions cv
          JOIN leads l ON l.id = cv.lead_id
          LEFT JOIN users u ON u.id = cv.converted_by
          WHERE cv.id = ? LIMIT 1`,
				[ref.evidenceId]
			)) as unknown as [NarrativeRow[], unknown];
			return rows[0] ?? null;
		}
	}
}

/**
 * One evidence record with its narrative fields, read on demand. The reader
 * stays readable after a soft deletion. Only the evidence row selected by
 * the reference is returned; no list or aggregate leaks through this read.
 */
export async function readLeadAuditEvidenceNarrative(
	db: DbConnection,
	ref: NarrativeRef,
	options: { includeProposals?: boolean; includeProjects?: boolean } = {}
): Promise<LeadAuditEvidenceNarrative | null> {
	const row = await loadNarrativeRow(db, ref);
	if (!row) return null;

	const actor = actorRef(row.actor_id, row.actor_name);
	const recordedAt = toIsoDateTime(row.recorded_at);
	const occurredAt = toIsoDateTime(row.occurred_at);
	const leadDeleted = isTruthyFlag(row.lead_deleted);
	const fields = narrativeFields(
		ref.evidenceType === 'activity'
			? [
					['status', 'Status', row.status],
					[
						'activity_type',
						'Activity type',
						trimOrNull(row.activity_type) === null
							? 'Unknown activity type'
							: row.activity_type,
					],
					['call_outcome', 'Call outcome', trimOrNull(row.call_outcome)],
					[
						'reply_confirmed',
						'Reply confirmed',
						row.reply_confirmed === null || row.reply_confirmed === undefined
							? 'Unknown'
							: isTruthyFlag(row.reply_confirmed)
								? 'Yes'
								: 'No',
					],
					['scheduled_for', 'Scheduled for', toIsoDateTime(row.scheduled_for)],
					['notes', 'Notes', row.notes],
					['next_action', 'Next action', row.next_action],
				]
			: ref.evidenceType === 'stage_change'
				? [
						[
							'from_stage',
							'From stage',
							leadAuditStageLabel(trimOrNull(row.from_value)),
						],
						[
							'to_stage',
							'To stage',
							leadAuditStageLabel(trimOrNull(row.to_value)),
						],
						['change_source', 'Change source', row.change_source],
						['reason', 'Reason', row.reason],
					]
				: ref.evidenceType === 'owner_change'
					? [
							[
								'prior_owner',
								'Prior owner',
								ownerDisplay(row.prior_owner_id, row.prior_owner_name),
							],
							[
								'owner',
								'New owner',
								ownerDisplay(row.owner_id, row.owner_name),
							],
						]
					: ref.evidenceType === 'correction'
						? [
								['reason', 'Correction reason', row.reason],
								[
									'activity',
									'Corrected activity',
									toNullableId(row.activity_id) === null
										? null
										: `activity:${toNullableId(row.activity_id)}`,
								],
							]
						: ref.evidenceType === 'legacy_review'
							? [
									[
										'review_type',
										'Review dimension',
										trimOrNull(row.review_type) === null
											? null
											: (LEGACY_REVIEW_LABELS[
													row.review_type as LegacyReviewType
												] ?? row.review_type),
									],
									[
										'original_value',
										'Original stored value',
										row.original_value,
									],
									['resolved_value', 'Resolved value', row.resolved_value],
									[
										'resolved_reference',
										'Resolved reference',
										row.review_type === 'proposal_link' &&
										!(options.includeProposals ?? false)
											? 'Restricted'
											: toNullableId(row.resolved_reference) === null
												? null
												: String(toNullableId(row.resolved_reference)),
									],
									[
										'resolution_source',
										'Resolution source',
										row.resolution_source,
									],
									[
										'reviewer_name',
										'Recorded reviewer name',
										row.reviewer_name,
									],
									['reason', 'Review reason', row.reason],
								]
							: []
	);

	let downstream: LeadAuditEvidenceDownstream | undefined;
	if (ref.evidenceType === 'conversion') {
		const map = await loadConversionDownstream(
			db,
			[
				{
					evidence_id: ref.evidenceId,
					proposal_id: toNullableId(row.proposal_id),
				},
			],
			options.includeProposals ?? false,
			options.includeProjects ?? false
		);
		downstream = map.get(ref.evidenceId);
		if (downstream) {
			const proposal = downstream.proposal;
			if (proposal) {
				fields.push(
					...narrativeFields([
						['proposal_title', 'Proposal title', proposal.title],
						['proposal_status', 'Proposal status', proposal.status],
						[
							'proposal_progress',
							'Proposal progress',
							proposal.progress === null ? null : `${proposal.progress}%`,
						],
					])
				);
			} else {
				fields.push(
					...narrativeFields([
						[
							'proposal_state',
							'Proposal details',
							downstream.proposal_state === 'restricted'
								? 'Restricted'
								: downstream.proposal_state === 'unresolved'
									? 'Unresolved canonical Proposal link'
									: 'No Proposal recorded',
						],
					])
				);
			}
			if (downstream.project) {
				fields.push(
					...narrativeFields([
						['project_title', 'Project title', downstream.project.title],
						['project_status', 'Project status', downstream.project.status],
						[
							'project_progress',
							'Project progress',
							downstream.project.progress === null
								? null
								: `${downstream.project.progress}%`,
						],
					])
				);
			} else if (downstream.project_state === 'restricted') {
				fields.push(
					...narrativeFields([
						['project_state', 'Project details', 'Restricted'],
					])
				);
			}
		}
	}

	const summary = evidenceSummaryFromNarrativeFields(ref, row);
	return {
		evidence_type: ref.evidenceType,
		evidence_id: ref.evidenceId,
		reference: `${ref.evidenceType}:${ref.evidenceId}`,
		lead: {
			id: toNumber(row.lead_pk),
			lead_id: trimOrNull(row.lead_code),
			company_name: String(row.company_name ?? ''),
		},
		actor,
		occurred_at: occurredAt,
		occurrence_known: occurredAt !== null,
		recorded_at: recordedAt,
		summary,
		fields,
		changes:
			ref.evidenceType === 'correction'
				? correctionNarrative(
						parseCorrectionValues(row.previous_values),
						parseCorrectionValues(row.corrected_values)
					)
				: [],
		downstream,
		deletion:
			leadDeleted || isTruthyFlag(row.evidence_deleted)
				? LEAD_AUDIT_DELETION_FACTS
				: null,
		disclosures: [
			{
				code: 'narrative_plain_text',
				text: 'Narrative evidence is stored text and is rendered as plain text. It is never interpreted as HTML.',
			},
			{
				code: 'narrative_source_grants',
				text: 'Lead-side narrative requires the report and Lead read grants. Proposal and Project details additionally require their own source read grants and are absent otherwise.',
			},
			...(leadDeleted
				? [
						{
							code: 'deleted_facts_unknown',
							text: LEAD_AUDIT_DELETION_FACTS.note,
						},
					]
				: []),
		],
	};
}

function evidenceSummaryFromNarrativeFields(
	ref: NarrativeRef,
	row: NarrativeRow
): string {
	const pseudo: UnionRow = {
		evidence_type: ref.evidenceType,
		evidence_id: ref.evidenceId,
		source_table: '',
		lead_pk: row.lead_pk,
		lead_code: row.lead_code,
		company_name: row.company_name,
		recorded_at: row.recorded_at,
		occurred_at: row.occurred_at,
		actor_id: row.actor_id,
		actor_name: row.actor_name,
		activity_type: row.activity_type,
		call_outcome: row.call_outcome,
		reply_confirmed: row.reply_confirmed,
		status: row.status,
		scheduled_for: row.scheduled_for,
		from_value: row.from_value,
		to_value: row.to_value,
		prior_owner_id: row.prior_owner_id,
		prior_owner_name: row.prior_owner_name,
		owner_id: row.owner_id,
		owner_name: row.owner_name,
		activity_ref_id: row.activity_id,
		proposal_id: row.proposal_id,
		review_type: row.review_type,
		resolution_source: row.resolution_source,
		original_value: row.original_value,
		resolved_value: row.resolved_value,
		resolved_reference: row.resolved_reference,
		previous_values: row.previous_values,
		corrected_values: row.corrected_values,
		detail_present: 0,
		legacy_flag: 0,
	};
	return evidenceSummary(pseudo);
}
