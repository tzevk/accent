import type { DbConnection } from '@/server/leads/shared';
import {
	buildQueueCondition,
	buildQueueCounterSelect,
} from '@/server/leads/queues';
import {
	CURRENT_STATE_RISK_DEFINITIONS,
	CURRENT_STATE_RISK_KEYS,
	CURRENT_STATE_WORKLOAD_DEFINITION,
	type CurrentStateCounterUnit,
	type CurrentStateEvidenceGroup,
	type CurrentStateEvidenceSelection,
	type CurrentStateEvidenceUnit,
	type CurrentStateIgnoredFilter,
	type CurrentStateObservation,
	type CurrentStateOwner,
	type CurrentStateRisk,
	type CurrentStateRiskKey,
	type CurrentStateScope,
	type LeadAuditCurrentStateEvidenceSection,
	type LeadAuditCurrentStateSection,
} from './current-state-types';
import { leadAuditStageLabel, buildLeadAuditMeta, resolveLeadAuditEffectiveFilters } from './scope';
import {
	buildLeadAuditFilterCondition,
	joinConditions,
	type SqlCondition,
} from './sql';
import { leadAuditSourceValue } from './source';
import {
	LeadAuditValidationError,
	type LeadAuditClock,
	type LeadAuditDisclosure,
	type LeadAuditFilters,
	type LeadAuditPagination,
} from './types';

/**
 * Lead Audit current state (#401): present ownership and the five existing
 * operational queues.
 *
 * The queue conditions and counters come from `src/server/leads/queues.ts`;
 * this module only composes them with the report's current-state filters.
 * The selected reporting period is deliberately not applied: these are live
 * facts at the observation calendar day, not a period-end backlog.
 */

export type CurrentStateQuerySource =
	| URLSearchParams
	| Record<string, string | null | undefined>;

export interface CurrentStateReadOptions {
	ignoredFilters?: CurrentStateIgnoredFilter[];
}

const CURRENT_STATE_DATE_BASIS =
	'Live current state at the database calendar day (CURDATE()); the selected reporting period is not applied.';

const IGNORED_FILTERS: ReadonlyArray<Omit<CurrentStateIgnoredFilter, 'value'>> = [
	{
		key: 'actor',
		label: 'Activity author',
		reason:
			'Activity authorship is not current ownership. Current-state workload uses the present Lead owner.',
	},
	{
		key: 'activity_type',
		label: 'Activity type',
		reason:
			'Activity-type filters select period work evidence, not the present Lead state.',
	},
	{
		key: 'outcome',
		label: 'Work outcome',
		reason:
			'Outcome filters select period work evidence, not the present Lead state.',
	},
	{
		key: 'event_type',
		label: 'Audit event type',
		reason:
			'Audit event filters select recorded evidence, not the present Lead state.',
	},
	{
		key: 'undated',
		label: 'Undated evidence',
		reason:
			'Undated-evidence filters select period work or audit evidence, not the present Lead state.',
	},
];

function readQuery(source: CurrentStateQuerySource, key: string): string {
	const raw =
		source instanceof URLSearchParams
			? source.get(key)
			: (source[key] ?? null);
	return typeof raw === 'string' ? raw.trim() : '';
}

export function isCurrentStateRiskKey(
	value: string
): value is CurrentStateRiskKey {
	return (CURRENT_STATE_RISK_KEYS as readonly string[]).includes(value);
}

/** The evidence selector. `workload` is the default; risks must be named. */
export function parseCurrentStateEvidenceSelection(
	source: CurrentStateQuerySource
): CurrentStateEvidenceSelection {
	const group = readQuery(source, 'group');
	if (group === '' || group === 'workload') {
		return { group: 'workload', risk: null };
	}
	if (group !== 'risk') {
		throw new LeadAuditValidationError(
			'invalid_current_state_group',
			`Unknown current-state evidence group: ${group}`
		);
	}
	const risk = readQuery(source, 'risk');
	if (!isCurrentStateRiskKey(risk)) {
		throw new LeadAuditValidationError(
			'invalid_current_state_risk',
			`Unknown current-state risk: ${risk}`
		);
	}
	return { group: 'risk', risk };
}

/**
 * The filters the reader must not silently apply. The period is always
 * ignored here, even when valid; actor and audit filters are listed when the
 * caller supplied them so an activity-author filter can never be mistaken
 * for historical ownership.
 */
export function buildCurrentStateIgnoredFilters(
	filters: LeadAuditFilters,
	source?: CurrentStateQuerySource
): CurrentStateIgnoredFilter[] {
	const ignored: CurrentStateIgnoredFilter[] = [
		{
			key: 'period',
			label: 'Reporting period',
			value: `${filters.fromDate} to ${filters.toDate}`,
			reason:
				'Current-state figures are observed at generation time, not at the selected period end. A historical period selection never reconstructs a historical backlog.',
		},
	];
	if (!source) return ignored;
	for (const definition of IGNORED_FILTERS) {
		const value = readQuery(source, definition.key);
		if (value === '' || value === 'all') continue;
		ignored.push({ ...definition, value });
	}
	return ignored;
}

function buildObservation(clock: LeadAuditClock): CurrentStateObservation {
	return {
		...buildLeadAuditMeta(clock),
		date_basis: CURRENT_STATE_DATE_BASIS,
	};
}

function riskDefinition(key: CurrentStateRiskKey) {
	const definition = CURRENT_STATE_RISK_DEFINITIONS.find(
		(entry) => entry.key === key
	);
	if (!definition) {
		throw new Error(`Unknown current-state risk: ${key}`);
	}
	return definition;
}

function count(value: unknown): number {
	return Number(value) || 0;
}

function ownerFromRow(row: Record<string, unknown>): CurrentStateOwner {
	const rawId = row.owner_user_id;
	const id =
		rawId === null || rawId === undefined || rawId === ''
			? null
			: Number(rawId);
	if (id === null || !Number.isInteger(id) || id <= 0) {
		return {
			id: null,
			name: 'Unassigned',
			is_inactive: false,
			is_unknown: false,
		};
	}
	const exists =
		row.owner_exists !== undefined
			? row.owner_exists !== null
			: row.owner_is_unknown !== undefined && row.owner_is_unknown !== null
				? Number(row.owner_is_unknown) === 0
				: true;
	const rawName = row.owner_name;
	const name =
		rawName === null || rawName === undefined || String(rawName) === ''
			? null
			: String(rawName);
	const inactive =
		row.owner_is_inactive !== undefined && row.owner_is_inactive !== null
			? Number(row.owner_is_inactive) === 1
			: exists &&
				(Number(row.owner_is_active) === 0 ||
					String(row.owner_status ?? '') === 'inactive' ||
					Number(row.owner_is_deleted) === 1);
	return {
		id,
		name: name ?? `Unknown user #${id}`,
		is_inactive: inactive,
		is_unknown: !exists,
	};
}

function leadColumns(row: Record<string, unknown>) {
	const enquiryStatus =
		row.enquiry_status === null || row.enquiry_status === undefined
			? null
			: String(row.enquiry_status);
	return {
		lead: {
			id: Number(row.lead_row_id),
			lead_id:
				row.lead_reference === null || row.lead_reference === undefined
					? null
					: String(row.lead_reference),
			company_name: String(row.company_name),
			contact_name:
				row.contact_name === null || row.contact_name === undefined
					? null
					: String(row.contact_name),
		},
		source: leadAuditSourceValue(row.lead_source),
		priority: row.priority === null || row.priority === undefined
			? null
			: String(row.priority),
		stage: {
			value: enquiryStatus,
			label: leadAuditStageLabel(enquiryStatus),
		},
		owner: ownerFromRow(row),
		enquiry_date:
			row.enquiry_date === null || row.enquiry_date === undefined
				? null
				: String(row.enquiry_date),
		recorded_at:
			row.created_at === null || row.created_at === undefined
				? ''
				: String(row.created_at),
	};
}

function evidenceGroup(
	selection: CurrentStateEvidenceSelection
): CurrentStateEvidenceGroup {
	if (selection.group === 'workload') {
		return {
			key: 'workload',
			risk: null,
			label: 'Current-owner workload',
			definition: CURRENT_STATE_WORKLOAD_DEFINITION,
			counter_unit: 'distinct_leads',
			evidence_unit: 'lead',
		};
	}
	const definition = riskDefinition(selection.risk as CurrentStateRiskKey);
	return {
		key: 'risk',
		risk: definition.key,
		label: definition.label,
		definition: definition.definition,
		counter_unit: 'distinct_leads',
		evidence_unit: definition.evidence_unit,
	};
}

function buildDisclosures(
	observation: CurrentStateObservation
): LeadAuditDisclosure[] {
	return [
		{
			code: 'current_state',
			text: `Current-state figures are live state observed at ${observation.generated_at} on ${observation.today}. They are not the backlog at the selected period end, and a historical period selection never changes them.`,
		},
		{
			code: 'current_state_units',
			text: 'Every current-state counter counts distinct Leads. The Overdue and Due today evidence registers identify individual scheduled work items, so their row totals can exceed their distinct-Lead counts.',
		},
		{
			code: 'current_ownership',
			text: 'Current-owner workload uses the Lead present owner. It does not credit activity authors, and it preserves Unassigned Leads and retained inactive or unknown user references.',
		},
		{
			code: 'queue_definitions',
			text: 'Unassigned, Untouched, Overdue, Due today, and No Next Action reuse the operational Lead queue definitions. Notes alone do not count as outreach, and completed, cancelled, or Proposal-transferred work is not outstanding Lead work.',
		},
		{
			code: 'current_state_deleted',
			text: 'Soft-deleted Leads and their work are excluded from every current-state count, workload group, and evidence register.',
		},
		{
			code: 'current_state_calendar',
			text: 'Due-today and overdue boundaries use the database calendar day (CURDATE()), the same policy as the Lead workspace queues. The browser or Node time zone never decides the boundary.',
		},
	];
}

export async function readLeadAuditCurrentStateSection(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock,
	options: CurrentStateReadOptions = {}
): Promise<LeadAuditCurrentStateSection> {
	const filter = buildLeadAuditFilterCondition(filters);
	const counters = buildQueueCounterSelect(null);
	const observation = buildObservation(clock);

	const [counterResult, workloadResult, effective] = await Promise.all([
		db.execute(
			`SELECT ${counters.select}
       FROM leads l
       WHERE ${filter.sql}`,
			[...counters.params, ...filter.params]
		),
		db.execute(
			`SELECT l.owner_user_id,
              COUNT(*) AS lead_count,
              MAX(COALESCE(NULLIF(TRIM(u.full_name), ''), u.username)) AS owner_name,
              MAX(CASE WHEN u.id IS NULL THEN 1 ELSE 0 END) AS owner_is_unknown,
              MAX(CASE WHEN u.id IS NOT NULL
                    AND (u.is_active = 0 OR u.status = 'inactive' OR u.isDelete = 1)
                  THEN 1 ELSE 0 END) AS owner_is_inactive
         FROM leads l
         LEFT JOIN users u ON u.id = l.owner_user_id
         WHERE ${filter.sql}
         GROUP BY l.owner_user_id
         ORDER BY (l.owner_user_id IS NOT NULL) ASC, lead_count DESC, l.owner_user_id ASC`,
			filter.params
		),
		resolveLeadAuditEffectiveFilters(db, filters),
	]);

	const [counterRows] = counterResult as unknown as [
		Array<Record<string, unknown>>,
		unknown,
	];
	const counterRow = counterRows[0] ?? {};
	const [workloadRows] = workloadResult as unknown as [
		Array<Record<string, unknown>>,
		unknown,
	];

	const counts: Record<CurrentStateRiskKey, number> = {
		unassigned: count(counterRow.queue_unassigned),
		untouched: count(counterRow.queue_untouched),
		overdue: count(counterRow.queue_overdue),
		due_today: count(counterRow.queue_due_today),
		no_next_action: count(counterRow.queue_no_next_action),
	};
	const risks: CurrentStateRisk[] = CURRENT_STATE_RISK_DEFINITIONS.map(
		(definition) => ({
			key: definition.key,
			label: definition.label,
			definition: definition.definition,
			count: counts[definition.key],
			counter_unit: 'distinct_leads' as CurrentStateCounterUnit,
			evidence_unit: definition.evidence_unit as CurrentStateEvidenceUnit,
			as_of: clock.today,
		})
	);

	const scope: CurrentStateScope = {
		effective_filters: effective,
		ignored_filters:
			options.ignoredFilters ?? buildCurrentStateIgnoredFilters(filters),
	};

	return {
		as_of: observation,
		scope,
		workload: {
			counter_unit: 'distinct_leads',
			total: count(counterRow.queue_all),
			owners: workloadRows.map((row) => ({
				owner: ownerFromRow(row),
				count: count(row.lead_count),
			})),
		},
		risks,
		disclosures: buildDisclosures(observation),
	};
}

async function readLeadEvidence(
	db: DbConnection,
	filters: LeadAuditFilters,
	condition: SqlCondition,
	group: CurrentStateEvidenceGroup,
	clock: LeadAuditClock,
	pagination: LeadAuditPagination,
	ignoredFilters: CurrentStateIgnoredFilter[]
): Promise<LeadAuditCurrentStateEvidenceSection> {
	const offset = (pagination.page - 1) * pagination.limit;
	const observation = buildObservation(clock);
	const [totalResult, rowResult, effective] = await Promise.all([
		db.execute(
			`SELECT COUNT(*) AS total FROM leads l WHERE ${condition.sql}`,
			condition.params
		),
		db.execute(
			`SELECT l.id AS lead_row_id, l.lead_id AS lead_reference,
              l.company_name, l.contact_name, l.lead_source, l.priority,
              l.enquiry_status, l.owner_user_id, l.enquiry_date, l.created_at,
              u.id AS owner_exists,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS owner_name,
              u.is_active AS owner_is_active, u.status AS owner_status,
              u.isDelete AS owner_is_deleted
         FROM leads l
         LEFT JOIN users u ON u.id = l.owner_user_id
         WHERE ${condition.sql}
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT ? OFFSET ?`,
			[...condition.params, pagination.limit, offset]
		),
		resolveLeadAuditEffectiveFilters(db, filters),
	]);

	const [totalRows] = totalResult as unknown as [
		Array<Record<string, unknown>>,
		unknown,
	];
	const total = count(totalRows[0]?.total);
	const [rows] = rowResult as unknown as [
		Array<Record<string, unknown>>,
		unknown,
	];

	return {
		as_of: observation,
		scope: { effective_filters: effective, ignored_filters: ignoredFilters },
		group,
		rows: rows.map((row) => ({
			kind: 'lead' as const,
			...leadColumns(row),
			work_item: null,
		})),
		pagination: {
			page: pagination.page,
			limit: pagination.limit,
			total,
			total_pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
		},
		distinct_leads_total: total,
		disclosures: buildDisclosures(observation),
	};
}

async function readWorkItemEvidence(
	db: DbConnection,
	filters: LeadAuditFilters,
	risk: CurrentStateRiskKey,
	group: CurrentStateEvidenceGroup,
	clock: LeadAuditClock,
	pagination: LeadAuditPagination,
	ignoredFilters: CurrentStateIgnoredFilter[]
): Promise<LeadAuditCurrentStateEvidenceSection> {
	const offset = (pagination.page - 1) * pagination.limit;
	const observation = buildObservation(clock);
	const scheduledWindow =
		risk === 'overdue'
			? 'item.scheduled_for < CURDATE()'
			: 'item.scheduled_for = CURDATE()';
	const condition = joinConditions(
		buildLeadAuditFilterCondition(filters),
		buildQueueCondition(risk, null),
		{
			sql: `item.status = 'Scheduled'
        AND item.transferred_followup_id IS NULL
        AND item.scheduled_for IS NOT NULL
        AND (item.isDelete = 0 OR item.isDelete IS NULL)
        AND ${scheduledWindow}`,
			params: [],
		}
	);

	const [totalResult, rowResult, effective] = await Promise.all([
		db.execute(
			`SELECT COUNT(*) AS total, COUNT(DISTINCT l.id) AS distinct_leads
         FROM lead_activities item
         JOIN leads l ON l.id = item.lead_id
         WHERE ${condition.sql}`,
			condition.params
		),
		db.execute(
			`SELECT item.id AS activity_id, item.activity_type,
              item.scheduled_for, item.next_action,
              l.id AS lead_row_id, l.lead_id AS lead_reference,
              l.company_name, l.contact_name, l.lead_source, l.priority,
              l.enquiry_status, l.owner_user_id, l.enquiry_date, l.created_at,
              u.id AS owner_exists,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS owner_name,
              u.is_active AS owner_is_active, u.status AS owner_status,
              u.isDelete AS owner_is_deleted
         FROM lead_activities item
         JOIN leads l ON l.id = item.lead_id
         LEFT JOIN users u ON u.id = l.owner_user_id
         WHERE ${condition.sql}
         ORDER BY item.scheduled_for ASC, item.id ASC
         LIMIT ? OFFSET ?`,
			[...condition.params, pagination.limit, offset]
		),
		resolveLeadAuditEffectiveFilters(db, filters),
	]);

	const [totalRows] = totalResult as unknown as [
		Array<Record<string, unknown>>,
		unknown,
	];
	const totalRow = totalRows[0] ?? {};
	const total = count(totalRow.total);
	const distinctLeadsTotal = count(totalRow.distinct_leads);
	const [rows] = rowResult as unknown as [
		Array<Record<string, unknown>>,
		unknown,
	];

	return {
		as_of: observation,
		scope: { effective_filters: effective, ignored_filters: ignoredFilters },
		group,
		rows: rows.map((row) => ({
			kind: 'scheduled_work_item' as const,
			...leadColumns(row),
			work_item: {
				id: Number(row.activity_id),
				activity_type:
					row.activity_type === null || row.activity_type === undefined
						? null
						: String(row.activity_type),
				scheduled_for:
					row.scheduled_for === null || row.scheduled_for === undefined
						? ''
						: String(row.scheduled_for),
				next_action:
					row.next_action === null || row.next_action === undefined
						? null
						: String(row.next_action),
			},
		})),
		pagination: {
			page: pagination.page,
			limit: pagination.limit,
			total,
			total_pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
		},
		distinct_leads_total: distinctLeadsTotal,
		disclosures: buildDisclosures(observation),
	};
}

export async function readLeadAuditCurrentStateEvidence(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock,
	selection: CurrentStateEvidenceSelection,
	pagination: LeadAuditPagination,
	options: CurrentStateReadOptions = {}
): Promise<LeadAuditCurrentStateEvidenceSection> {
	const group = evidenceGroup(selection);
	const ignoredFilters =
		options.ignoredFilters ?? buildCurrentStateIgnoredFilters(filters);
	if (group.evidence_unit === 'scheduled_work_item') {
		return readWorkItemEvidence(
			db,
			filters,
			selection.risk as CurrentStateRiskKey,
			group,
			clock,
			pagination,
			ignoredFilters
		);
	}
	const condition =
		selection.group === 'risk'
			? joinConditions(
					buildLeadAuditFilterCondition(filters),
					buildQueueCondition(selection.risk as CurrentStateRiskKey, null)
				)
			: buildLeadAuditFilterCondition(filters);
	return readLeadEvidence(
		db,
		filters,
		condition,
		group,
		clock,
		pagination,
		ignoredFilters
	);
}
