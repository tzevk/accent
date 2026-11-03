/**
 * Time to first outreach for a Lead Intake Cohort (#403).
 *
 * For every non-deleted Lead recorded in the selected period, the measure is
 * the database-time difference between system entry and the earliest
 * evidenced completed Call, Email, or Meeting. Notes, scheduled work, and
 * cancelled work are not outreach. Durations are `TIMESTAMPDIFF(SECOND)`
 * results, so the browser and Node time zones never decide an elapsed time.
 *
 * A Lead is timed only when the interval is known and not negative. Missing
 * occurrence times, incomplete earlier evidence, and imported prehistory are
 * disclosed and excluded; nothing is substituted and no negative interval is
 * clamped. With no valid sample the metric is unavailable, not zero.
 */
import type { DbConnection } from '@/server/leads/shared';
import { buildLeadAuditMeta, buildLeadAuditScope, resolveLeadAuditEffectiveFilters } from './scope';
import {
	buildLeadAuditFilterCondition,
	joinConditions,
	recordedInPeriod,
} from './sql';
import { LeadAuditValidationError } from './types';
import type {
	LeadAuditClock,
	LeadAuditDisclosure,
	LeadAuditPagination,
} from './types';
import {
	LEAD_AUDIT_TIMING_POPULATIONS,
	type LeadAuditTimingEvidenceSection,
	type LeadAuditTimingExclusions,
	type LeadAuditTimingFilterScope,
	type LeadAuditTimingFilters,
	type LeadAuditTimingIncomingFilters,
	type LeadAuditTimingMetric,
	type LeadAuditTimingPopulation,
	type LeadAuditTimingRow,
	type LeadAuditTimingSection,
	type LeadAuditTimingStatus,
} from './timing-types';

type QuerySource =
	| URLSearchParams
	| Record<string, string | null | undefined>;

interface TimingCandidateRow {
	lead_id: number | string;
	lead_reference: string | null;
	company_name: string;
	contact_name: string | null;
	recorded_at: string | null;
	first_outreach_id: number | string | null;
	first_outreach_at: string | null;
	first_outreach_type: string | null;
	duration_seconds: number | string | null;
	completed_outreach_count: number | string | null;
	unknown_occurrence_count: number | string | null;
}

export const LEAD_AUDIT_TIMING_METRIC: LeadAuditTimingMetric = {
	key: 'time_to_first_outreach',
	label: 'Time to first outreach',
	definition:
		"Elapsed database time from the Lead's system-entry timestamp (leads.created_at) to its earliest evidenced completed Call, Email, or Meeting occurrence. Only cohort Leads with a known, non-negative interval are timed; notes, scheduled work, and cancelled work are not outreach. No service target, business-hours rule, or response-time promise applies.",
	clock:
		'Lead system entry: leads.created_at, the stored record-creation timestamp. The editable Enquiry Date is never used.',
	observation:
		'Completed outreach evidenced up to the report generation time; the cohort stays fixed to the selected intake period.',
	unit: 'seconds',
};

const TIMING_APPLIED_FILTERS: Array<{ key: string; label: string }> = [
	{ key: 'period', label: 'Reporting period (Lead Intake Cohort)' },
	{ key: 'owner', label: 'Current owner' },
	{ key: 'source', label: 'Stored source label' },
	{ key: 'stage', label: 'Current stage' },
	{ key: 'priority', label: 'Priority' },
	{ key: 'search', label: 'Search' },
];

const IGNORED_TIMING_FILTERS: Array<{
	filter: string;
	keys: string[];
	label: string;
	reason: string;
}> = [
	{
		filter: 'actor',
		keys: ['actor'],
		label: 'Recorded author',
		reason:
			'Not applied: the metric measures each cohort Lead’s earliest completed outreach, whoever recorded it.',
	},
	{
		filter: 'activity_type',
		keys: ['activityType', 'activity_type'],
		label: 'Activity type',
		reason:
			'Not applied: the earliest completed Call, Email, or Meeting defines the metric across all three kinds.',
	},
	{
		filter: 'outcome',
		keys: ['outcome'],
		label: 'Call outcome and reply evidence',
		reason:
			'Not applied: the interval ends at the first completed outreach attempt, not at a specific outcome or confirmed reply.',
	},
	{
		filter: 'event_type',
		keys: ['eventType', 'event_type'],
		label: 'Audit event type',
		reason:
			'Not applied: audit event types describe recorded decisions and corrections, not the outreach occurrence measured here.',
	},
	{
		filter: 'undated',
		keys: ['undated'],
		label: 'Undated evidence',
		reason:
			'Not applied: undated evidence belongs to the work and audit populations; timing measures only evidenced occurrence times.',
	},
];

const STATUS_EXCLUSION_REASON: Record<LeadAuditTimingStatus, string | null> = {
	sampled: null,
	no_outreach:
		'No completed Call, Email, or Meeting. Notes, scheduled work, and cancelled work are not outreach.',
	missing_timestamp:
		'Completed outreach exists, but no occurrence time is recorded. No timestamp is substituted.',
	incomplete_earlier:
		'A completed outreach row has no occurrence time, so the earliest outreach cannot be established. The interval is excluded rather than overstated.',
	negative:
		'The earliest evidenced outreach occurred before system entry. The negative interval is disclosed and excluded, never clamped.',
};

const POPULATION_META: Record<
	LeadAuditTimingPopulation,
	{ label: string; definition: string }
> = {
	all: {
		label: 'All cohort Leads',
		definition:
			'Every non-deleted Lead recorded in the selected intake period under the applied filters, with its timing status.',
	},
	sampled: {
		label: 'Timing samples',
		definition:
			'Cohort Leads with a known, non-negative interval from system entry to their earliest evidenced completed outreach occurrence.',
	},
	no_outreach: {
		label: 'Without evidenced outreach',
		definition:
			'Cohort Leads with no completed Call, Email, or Meeting. Notes, scheduled work, cancelled work, and deleted activities are not outreach.',
	},
	missing_timestamp: {
		label: 'Unknown occurrence times',
		definition:
			'Cohort Leads with completed outreach but no recorded occurrence time on any of those rows. The system-entry or recording time is never substituted.',
	},
	incomplete_earlier: {
		label: 'Incomplete earlier evidence',
		definition:
			'Cohort Leads with a known outreach time and at least one completed outreach row whose occurrence time is unknown, so the earliest outreach cannot be established. They are excluded rather than overstated.',
	},
	negative: {
		label: 'Negative intervals',
		definition:
			'Cohort Leads whose earliest evidenced outreach occurred before system entry, usually because the record was imported. The negative interval is disclosed and excluded, never clamped to zero.',
	},
};

const OUTREACH_TYPE_SQL = "('Call', 'Email', 'Meeting')";

function buildTimingBaseSelect(cohortSql: string): string {
	return `
    SELECT
      l.id AS lead_id,
      l.lead_id AS lead_reference,
      l.company_name,
      l.contact_name,
      l.created_at AS recorded_at,
      outreach.id AS first_outreach_id,
      outreach.occurred_at AS first_outreach_at,
      outreach.activity_type AS first_outreach_type,
      TIMESTAMPDIFF(SECOND, l.created_at, outreach.occurred_at) AS duration_seconds,
      COALESCE(outreach_summary.outreach_count, 0) AS completed_outreach_count,
      COALESCE(outreach_summary.unknown_occurrence_count, 0) AS unknown_occurrence_count
    FROM leads l
    LEFT JOIN (
      SELECT ranked.lead_id, ranked.id, ranked.occurred_at, ranked.activity_type
      FROM (
        SELECT lead_id, id, occurred_at, activity_type,
          ROW_NUMBER() OVER (
            PARTITION BY lead_id ORDER BY occurred_at ASC, id ASC
          ) AS position
        FROM lead_activities
        WHERE status = 'Completed'
          AND (isDelete = 0 OR isDelete IS NULL)
          AND activity_type IN ${OUTREACH_TYPE_SQL}
          AND occurred_at IS NOT NULL
      ) ranked
      WHERE ranked.position = 1
    ) outreach ON outreach.lead_id = l.id
    LEFT JOIN (
      SELECT lead_id,
        COUNT(*) AS outreach_count,
        SUM(CASE WHEN occurred_at IS NULL THEN 1 ELSE 0 END) AS unknown_occurrence_count
      FROM lead_activities
      WHERE status = 'Completed'
        AND (isDelete = 0 OR isDelete IS NULL)
        AND activity_type IN ${OUTREACH_TYPE_SQL}
      GROUP BY lead_id
    ) outreach_summary ON outreach_summary.lead_id = l.id
    WHERE ${cohortSql}`;
}

function classifyTiming(row: TimingCandidateRow): LeadAuditTimingStatus {
	const completed = Number(row.completed_outreach_count) || 0;
	const unknown = Number(row.unknown_occurrence_count) || 0;
	const duration =
		row.duration_seconds === null || row.duration_seconds === undefined
			? null
			: Number(row.duration_seconds);
	if (completed === 0) return 'no_outreach';
	if (row.first_outreach_at === null || duration === null) {
		return 'missing_timestamp';
	}
	if (duration < 0) return 'negative';
	if (unknown > 0) return 'incomplete_earlier';
	return 'sampled';
}

function toTimingRow(row: TimingCandidateRow): LeadAuditTimingRow {
	const status = classifyTiming(row);
	const firstOutreachId =
		row.first_outreach_id === null || row.first_outreach_id === undefined
			? null
			: Number(row.first_outreach_id);
	return {
		lead_id: Number(row.lead_id),
		lead_reference: row.lead_reference ? String(row.lead_reference) : null,
		company_name: String(row.company_name),
		contact_name: row.contact_name ? String(row.contact_name) : null,
		recorded_at: String(row.recorded_at ?? ''),
		status,
		duration_seconds:
			row.duration_seconds === null || row.duration_seconds === undefined
				? null
				: Number(row.duration_seconds),
		first_outreach_at: row.first_outreach_at
			? String(row.first_outreach_at)
			: null,
		first_outreach_type: row.first_outreach_type
			? String(row.first_outreach_type)
			: null,
		first_outreach_id: firstOutreachId,
		completed_outreach_count: Number(row.completed_outreach_count) || 0,
		unknown_occurrence_count: Number(row.unknown_occurrence_count) || 0,
		exclusion_reason: STATUS_EXCLUSION_REASON[status],
	};
}

function timingCohortCondition(filters: LeadAuditTimingFilters) {
	return joinConditions(
		buildLeadAuditFilterCondition(filters),
		recordedInPeriod(filters)
	);
}

async function readTimingRows(
	db: DbConnection,
	filters: LeadAuditTimingFilters
): Promise<LeadAuditTimingRow[]> {
	const cohort = timingCohortCondition(filters);
	const [rows] = (await db.execute(
		`${buildTimingBaseSelect(cohort.sql)}
     ORDER BY l.created_at ASC, l.id ASC`,
		cohort.params
	)) as unknown as [TimingCandidateRow[], unknown];
	return rows.map(toTimingRow);
}

/**
 * The complete timing detail on the caller's connection, unpaginated, for the
 * Excel workbook. It is the same population and classification the section
 * uses, so export totals reconcile with the screen without HTTP pagination.
 */
export async function readLeadAuditTimingDetail(
	db: DbConnection,
	filters: LeadAuditTimingFilters,
	_clock: LeadAuditClock
): Promise<LeadAuditTimingRow[]> {
	return readTimingRows(db, filters);
}

function summarizeTiming(rows: LeadAuditTimingRow[]): {
	validSamples: number;
	medianSeconds: number | null;
	p90Seconds: number | null;
	withoutOutreach: number;
	exclusions: LeadAuditTimingExclusions;
} {
	const durations = rows
		.filter((row) => row.status === 'sampled')
		.map((row) => row.duration_seconds as number)
		.sort((left, right) => left - right);
	const count = durations.length;
	let medianSeconds: number | null = null;
	if (count > 0) {
		const middle = Math.floor(count / 2);
		medianSeconds =
			count % 2 === 1
				? durations[middle]
				: (durations[middle - 1] + durations[middle]) / 2;
	}
	let p90Seconds: number | null = null;
	if (count > 0) {
		// Nearest-rank: the ordered observation at the rounded-up rank.
		const rank = Math.ceil(0.9 * count);
		p90Seconds = durations[rank - 1];
	}
	const missing = rows.filter(
		(row) => row.status === 'missing_timestamp'
	).length;
	const incomplete = rows.filter(
		(row) => row.status === 'incomplete_earlier'
	).length;
	const negative = rows.filter((row) => row.status === 'negative').length;
	return {
		validSamples: count,
		medianSeconds,
		p90Seconds,
		withoutOutreach: rows.filter((row) => row.status === 'no_outreach')
			.length,
		exclusions: {
			missing_timestamp: missing,
			incomplete_earlier: incomplete,
			negative,
			total: missing + incomplete + negative,
		},
	};
}

function formatSharePercent(share: number): string {
	const percent = share * 100;
	return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

function buildTimingDisclosures(
	cohortLeads: number,
	validSamples: number,
	withoutOutreach: number,
	exclusions: LeadAuditTimingExclusions,
	clock: LeadAuditClock
): LeadAuditDisclosure[] {
	const disclosures: LeadAuditDisclosure[] = [
		{
			code: 'timing_clock',
			text: `Time to first outreach measures elapsed database time from each Lead's system entry (leads.created_at) to its earliest evidenced completed outreach occurrence, observed at ${clock.generatedAt} in ${clock.timeZone.label}. The editable Enquiry Date never starts the clock.`,
		},
		{
			code: 'outreach_definition',
			text: 'Lead Outreach is a completed Call, Email, or Meeting. Notes, scheduled work, and cancelled work are not outreach, and evidenced outreach does not establish successful client response.',
		},
	];
	if (cohortLeads === 0) {
		disclosures.push({
			code: 'empty_cohort',
			text: 'The applied filters contain no non-deleted Leads recorded in this period, so time to first outreach is unavailable. An empty cohort is not a zero-duration population.',
		});
	} else if (validSamples === 0) {
		disclosures.push({
			code: 'no_valid_samples',
			text: `No cohort Lead has a valid measured interval, so the metric is unavailable rather than zero. Coverage: ${cohortLeads} cohort Lead(s), ${withoutOutreach} without evidenced outreach, and ${exclusions.total} excluded for unknown or negative timing evidence.`,
		});
	}
	if (cohortLeads > 0 && withoutOutreach > 0) {
		disclosures.push({
			code: 'without_outreach',
			text: `${withoutOutreach} of ${cohortLeads} cohort Lead(s) (${formatSharePercent(withoutOutreach / cohortLeads)}) have no evidenced outreach and are not part of the timing samples. They stay visible beside the durations instead of being hidden by them.`,
		});
	}
	if (exclusions.missing_timestamp > 0) {
		disclosures.push({
			code: 'missing_timestamp',
			text: `${exclusions.missing_timestamp} cohort Lead(s) have completed outreach with no recorded occurrence time. They are excluded from the durations; no timestamp is substituted.`,
		});
	}
	if (exclusions.incomplete_earlier > 0) {
		disclosures.push({
			code: 'incomplete_earlier',
			text: `${exclusions.incomplete_earlier} cohort Lead(s) have a known outreach time alongside at least one completed outreach row with an unknown occurrence time. The earliest outreach cannot be established, so they are excluded rather than overstated.`,
		});
	}
	if (exclusions.negative > 0) {
		disclosures.push({
			code: 'negative_interval',
			text: `${exclusions.negative} cohort Lead(s) have evidenced outreach recorded before system entry, usually imported prehistory. The negative intervals are disclosed and excluded, never clamped to zero.`,
		});
	}
	disclosures.push({
		code: 'scope_limits',
		text: 'Cohort filters (period, owner, source, stage, priority, and search) apply. Soft-deleted Leads and soft-deleted activities are excluded, and current corrected facts are used once. The report exposes evidenced outreach only and cannot establish complete pre-import history; actor, activity-type, outcome, and event-type filters do not narrow this metric. No service target, business-hours rule, breach score, or employee ranking is implied.',
	});
	return disclosures;
}

function buildTimingFilterScope(
	filters: LeadAuditTimingFilters
): LeadAuditTimingFilterScope {
	const record = filters as unknown as Record<string, unknown>;
	const ignored: LeadAuditTimingFilterScope['ignored'] = [];
	for (const definition of IGNORED_TIMING_FILTERS) {
		const value = definition.keys
			.map((key) => formatIgnoredValue(record[key]))
			.find((entry): entry is string => entry !== null);
		if (value === undefined) continue;
		ignored.push({
			filter: definition.filter,
			label: definition.label,
			value,
			reason: definition.reason,
		});
	}
	return {
		applied: TIMING_APPLIED_FILTERS.map((entry) => ({ ...entry })),
		ignored,
	};
}

function formatIgnoredValue(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed === '' || trimmed === 'all' ? null : trimmed;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value.length === 0 ? null : value.map(String).join(', ');
	}
	if (typeof value === 'object') {
		if (!('value' in value)) return null;
		const inner = value.value;
		if (
			inner === null ||
			inner === undefined ||
			inner === '' ||
			inner === 'all'
		) {
			return null;
		}
		return String(inner);
	}
	return null;
}

function buildTimingEvidenceDisclosures(
	population: LeadAuditTimingPopulation,
	clock: LeadAuditClock
): LeadAuditDisclosure[] {
	return [
		{
			code: 'timing_clock',
			text: `Each interval is database time from system entry (leads.created_at) to the earliest evidenced completed outreach occurrence, observed at ${clock.generatedAt} in ${clock.timeZone.label}. The editable Enquiry Date is never used.`,
		},
		{
			code: 'outreach_definition',
			text: 'Lead Outreach is a completed Call, Email, or Meeting. Notes, scheduled work, cancelled work, and deleted activities are not outreach.',
		},
		{
			code: 'evidence_population',
			text: POPULATION_META[population].definition,
		},
		{
			code: 'scope_limits',
			text: 'Cohort filters are retained from the report. The evidence shows current corrected facts once; missing occurrence times are never replaced, incomplete earlier evidence is excluded rather than overstated, and negative intervals are shown as measured rather than clamped.',
		},
	];
}

/** The timing figure and its coverage for one applied filter set. */
export async function readLeadAuditTimingSection(
	db: DbConnection,
	filters: LeadAuditTimingFilters,
	clock: LeadAuditClock
): Promise<LeadAuditTimingSection> {
	const [rows, effective] = await Promise.all([
		readTimingRows(db, filters),
		resolveLeadAuditEffectiveFilters(db, filters),
	]);
	const summary = summarizeTiming(rows);
	const cohortLeads = rows.length;
	return {
		scope: buildLeadAuditScope(filters, effective),
		meta: buildLeadAuditMeta(clock),
		metric: LEAD_AUDIT_TIMING_METRIC,
		available: summary.validSamples > 0,
		median_seconds: summary.medianSeconds,
		p90_seconds: summary.p90Seconds,
		valid_samples: summary.validSamples,
		cohort_leads: cohortLeads,
		without_outreach: summary.withoutOutreach,
		without_outreach_share:
			cohortLeads === 0 ? null : summary.withoutOutreach / cohortLeads,
		exclusions: summary.exclusions,
		filter_scope: buildTimingFilterScope(filters),
		disclosures: buildTimingDisclosures(
			cohortLeads,
			summary.validSamples,
			summary.withoutOutreach,
			summary.exclusions,
			clock
		),
	};
}

/** One page of the cohort evidence behind a selected timing figure. */
export async function readLeadAuditTimingEvidence(
	db: DbConnection,
	filters: LeadAuditTimingFilters,
	clock: LeadAuditClock,
	population: LeadAuditTimingPopulation,
	pagination: LeadAuditPagination
): Promise<LeadAuditTimingEvidenceSection> {
	const cohort = timingCohortCondition(filters);
	const base = buildTimingBaseSelect(cohort.sql);
	const classified = `(
    SELECT base.*,
      CASE
        WHEN base.completed_outreach_count = 0 THEN 'no_outreach'
        WHEN base.first_outreach_at IS NULL OR base.duration_seconds IS NULL
          THEN 'missing_timestamp'
        WHEN base.duration_seconds < 0 THEN 'negative'
        WHEN base.unknown_occurrence_count > 0 THEN 'incomplete_earlier'
        ELSE 'sampled'
      END AS timing_status
    FROM (${base}) base
  ) classified`;
	const populationSql =
		population === 'all' ? '' : 'WHERE classified.timing_status = ?';
	const populationParams = population === 'all' ? [] : [population];
	const offset = (pagination.page - 1) * pagination.limit;

	const [countResult, rowResult, effective] = await Promise.all([
		db.execute(
			`SELECT COUNT(*) AS total FROM ${classified} ${populationSql}`,
			[...cohort.params, ...populationParams]
		),
		db.execute(
			`SELECT * FROM ${classified} ${populationSql}
       ORDER BY classified.recorded_at ASC, classified.lead_id ASC
       LIMIT ? OFFSET ?`,
			[...cohort.params, ...populationParams, pagination.limit, offset]
		),
		resolveLeadAuditEffectiveFilters(db, filters),
	]);

	const [countRows] = countResult as unknown as [
		Array<{ total: number | string }>,
		unknown,
	];
	const total = Number(countRows[0]?.total) || 0;
	const [rows] = rowResult as unknown as [TimingCandidateRow[], unknown];

	return {
		scope: buildLeadAuditScope(filters, effective),
		meta: buildLeadAuditMeta(clock),
		metric: {
			key: population,
			label: POPULATION_META[population].label,
			definition: POPULATION_META[population].definition,
		},
		rows: rows.map(toTimingRow),
		pagination: {
			page: pagination.page,
			limit: pagination.limit,
			total,
			total_pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
		},
		filter_scope: buildTimingFilterScope(filters),
		disclosures: buildTimingEvidenceDisclosures(population, clock),
	};
}

/** The timing evidence population named by `metric`, defaulting to all. */
export function parseLeadAuditTimingPopulation(
	source: QuerySource
): LeadAuditTimingPopulation {
	const raw =
		source instanceof URLSearchParams
			? source.get('metric')
			: (source.metric ?? null);
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (value === '') return 'all';
	if ((LEAD_AUDIT_TIMING_POPULATIONS as readonly string[]).includes(value)) {
		return value as LeadAuditTimingPopulation;
	}
	throw new LeadAuditValidationError(
		'invalid_timing_metric',
		`Unknown timing evidence population: ${value}`
	);
}

/**
 * The activity-oriented filters the section labels as not applied. The only
 * route that reads them is the section's own evidence route; the composed
 * report already carries its parsed filter object.
 */
export function readLeadAuditTimingIncomingFilters(
	source: QuerySource
): LeadAuditTimingIncomingFilters {
	const read = (key: string): string | undefined => {
		const value =
			source instanceof URLSearchParams ? source.get(key) : source[key];
		return typeof value === 'string' && value !== '' ? value : undefined;
	};
	return {
		actor: read('actor'),
		activityType: read('activity_type'),
		activity_type: read('activity_type'),
		outcome: read('outcome'),
		eventType: read('event_type'),
		event_type: read('event_type'),
		undated: read('undated'),
	};
}
