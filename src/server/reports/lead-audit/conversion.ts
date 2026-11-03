import { LEAD_STAGES } from '@/lib/lead-stages';
import { hasPermission, PERMISSIONS, RESOURCES } from '@/utils/rbac';
import {
	toNullableId,
	toPercent,
	trimOrNull,
	type DbConnection,
} from '@/server/leads/shared';
import {
	buildLeadAuditMeta,
	buildLeadAuditScope,
	leadAuditStageLabel,
	resolveLeadAuditEffectiveFilters,
} from './scope';
import { leadAuditSourceValue } from './source';
import {
	buildLeadAuditFilterCondition,
	recordedInPeriod,
	type SqlCondition,
} from './sql';
import type {
	LeadAuditClock,
	LeadAuditDisclosure,
	LeadAuditEffectiveFilters,
	LeadAuditFilters,
	LeadAuditPagination,
} from './types';
import type {
	LeadAuditCohortConversion,
	LeadAuditConversionDownstream,
	LeadAuditConversionDownstreamSummary,
	LeadAuditConversionEvidenceDescriptor,
	LeadAuditConversionEvidenceFilter,
	LeadAuditConversionEvidenceSection,
	LeadAuditConversionProjectContext,
	LeadAuditConversionProposalContext,
	LeadAuditConversionReadOptions,
	LeadAuditConversionRow,
	LeadAuditConversionSection,
	LeadAuditPeriodHandoffs,
	LeadAuditProjectStateCounts,
	LeadAuditSectionFilterScope,
	LeadAuditSourceConversion,
	LeadAuditStageDistributionRow,
} from './conversion-types';

/**
 * The cohort, period, and source conversion read (ticket #402).
 *
 * The rules this module holds in one place:
 *
 * - The cohort is the distinct non-deleted Leads first recorded inside the
 *   selected period, under the applied filters. Its progress is observed at
 *   the generation time, so a handoff after the intake period still counts.
 * - Handoff evidence is a recorded conversion event (`lead_conversions`) or
 *   an evidence-backed, resolved canonical Proposal link. A Converted stage
 *   label alone is not evidence.
 * - A retained conversion event stays evidence when the downstream link
 *   changes. An unresolved link is an evidence gap, never a guessed handoff
 *   or a confirmed failure.
 * - Period handoffs are distinct Leads whose authoritative recorded
 *   conversion time falls inside the selected period, including Leads
 *   recorded earlier. An undated canonical link supports cohort evidence
 *   only; Proposal creation and Lead editing times are never substituted.
 * - Current stage distribution is present state, not a sequential funnel.
 * - Downstream Proposal and Project facts follow the caller's independent
 *   `proposals:read` and `projects:read` grants. Denied fields are never
 *   selected into the response payload; they are not hidden in markup.
 *
 * Every figure is one set-based read over the same predicates. The section
 * read, the paginated evidence read, and the complete export read all accept
 * the caller's shared connection, so one observation uses one connection and
 * one clock.
 */

const EFFECTIVE_FILTER_BASE = { key: 'period', label: 'Selected period' };

const IGNORED_FILTERS: LeadAuditSectionFilterScope['ignored'] = [
	{
		key: 'actor',
		reason:
			'Conversion evidence has no activity author. The activity actor filter does not narrow this section.',
	},
	{
		key: 'activity_type',
		reason:
			'Conversion evidence has no activity type. The work-type filter does not narrow this section.',
	},
	{
		key: 'outcome',
		reason:
			'Conversion evidence has no call or email outcome. The outcome filter does not narrow this section.',
	},
	{
		key: 'event_type',
		reason:
			'Conversion evidence is not an audit event type. The event-type filter does not narrow this section.',
	},
	{
		key: 'undated',
		reason:
			'The undated timing control opens conversion evidence in the drill-down. It does not narrow the cohort figures.',
	},
];

const EVIDENCE_DESCRIPTORS: Record<
	LeadAuditConversionEvidenceFilter,
	LeadAuditConversionEvidenceDescriptor
> = {
	all: {
		key: 'all',
		label: 'Cohort and period conversion evidence',
		definition:
			'Every Lead in the intake cohort plus every older Lead with an authoritative recorded conversion time inside the selected period.',
	},
	handoff: {
		key: 'handoff',
		label: 'Evidenced cohort handoffs',
		definition:
			'Cohort Leads with a recorded conversion event or an evidence-backed, resolved canonical Proposal link. Handoffs after the intake period are included.',
	},
	period: {
		key: 'period',
		label: 'Dated period handoffs',
		definition:
			'Distinct Leads, recorded in or before the period, whose authoritative recorded conversion time falls inside the selected period. Undated canonical links never enter this population.',
	},
	undated: {
		key: 'undated',
		label: 'Undated canonical links',
		definition:
			'Cohort Leads with an evidence-backed, resolved canonical Proposal link and no recorded conversion time. They support cohort evidence only.',
	},
	unresolved: {
		key: 'unresolved',
		label: 'Unresolved links',
		definition:
			'Cohort Leads with live linked Proposals and no canonical choice. They are disclosed evidence gaps, not confirmed failures.',
	},
	stage_only: {
		key: 'stage_only',
		label: 'Stage labels without evidence',
		definition:
			'Cohort Leads labelled Converted with no conversion event and no resolved canonical Proposal link. The label alone is not a handoff.',
	},
};

interface ConversionBaseRow {
	id: number | string;
	lead_id: string | null;
	company_name: string | null;
	contact_name: string | null;
	lead_source: unknown;
	enquiry_status: string | null;
	owner_user_id: number | string | null;
	owner_full_name: string | null;
	owner_username: string | null;
	enquiry_date: string | null;
	created_at: string | null;
	in_cohort: number | string | null;
	event_at: string | null;
	in_period_handoff: number | string | null;
	live_count: number | string | null;
	resolved_canonical_id: number | string | null;
	canonical_id: number | string | null;
	proposal_title: string | null;
	proposal_status: string | null;
	proposal_progress: unknown;
	proposal_project_id: number | string | null;
	project_ref_id: number | string | null;
	project_title: string | null;
	project_status: string | null;
	project_progress: unknown;
}

interface CohortAggregateRow {
	cohort_size: number | string | null;
	handoffs: number | string | null;
	events: number | string | null;
	undated: number | string | null;
	unresolved: number | string | null;
	stage_only: number | string | null;
	proposal_available: number | string | null;
	proposal_restricted: number | string | null;
	proposal_unresolved: number | string | null;
	proposal_none: number | string | null;
	project_none: number | string | null;
	project_restricted: number | string | null;
	project_available: number | string | null;
}

interface SourceConversionRow {
	source: unknown;
	cohort_size: number | string | null;
	handoffs: number | string | null;
	unresolved: number | string | null;
	stage_only: number | string | null;
}

interface StageDistributionDbRow {
	stage: string | null;
	count: number | string | null;
}

interface PeriodAggregateRow {
	period_handoffs: number | string | null;
	undated_canonical_links: number | string | null;
}

export interface LeadAuditConversionReader {
	is_super_admin?: boolean | number | string | null;
}

/**
 * Resolve the caller's two independent downstream grants. The super-admin
 * bypass is the established `hasPermission` behaviour, not a second rule.
 */
export function resolveLeadAuditConversionOptions(
	user: LeadAuditConversionReader | null | undefined
): LeadAuditConversionReadOptions {
	return {
		includeProposals: hasPermission(
			user,
			RESOURCES.PROPOSALS,
			PERMISSIONS.READ
		),
		includeProjects: hasPermission(user, RESOURCES.PROJECTS, PERMISSIONS.READ),
	};
}

function toCount(value: unknown): number {
	return Number(value) || 0;
}

function conversionRate(handoffs: number, cohortSize: number): number | null {
	if (cohortSize === 0) return null;
	return Math.round((handoffs / cohortSize) * 10_000) / 100;
}

/**
 * The shared derived table: one Lead row with its cohort membership, its
 * earliest recorded conversion time, its in-period handoff flag, the live
 * linked Proposal count, and the resolved canonical Proposal id.
 *
 * The canonical id follows the stored reviewer decision first and exactly one
 * live linked Proposal second, the same resolution the converted-Lead read
 * uses. The Proposal join then requires that Proposal to still link to this
 * enquiry and not to be claimed by another one.
 */
function buildConversionBase(filters: LeadAuditFilters): SqlCondition {
	const period = recordedInPeriod(filters);
	const common = buildLeadAuditFilterCondition(filters);
	return {
		sql: `SELECT
        l.id, l.lead_id, l.company_name, l.contact_name, l.lead_source,
        l.enquiry_status, l.owner_user_id, l.enquiry_date, l.created_at,
        CASE WHEN ${period.sql} THEN 1 ELSE 0 END AS in_cohort,
        event.converted_at AS event_at,
        CASE WHEN EXISTS (
          SELECT 1 FROM lead_conversions c
          WHERE c.lead_id = l.id
            AND c.converted_at >= ?
            AND c.converted_at < ?
        ) THEN 1 ELSE 0 END AS in_period_handoff,
        COALESCE(live.live_count, 0) AS live_count,
        COALESCE(
          l.canonical_proposal_id,
          CASE WHEN COALESCE(live.live_count, 0) = 1 THEN live.single_id END
        ) AS resolved_canonical_id
      FROM leads l
      LEFT JOIN (
        SELECT lead_id, MIN(converted_at) AS converted_at
        FROM lead_conversions
        GROUP BY lead_id
      ) event ON event.lead_id = l.id
      LEFT JOIN (
        SELECT lead_id, COUNT(*) AS live_count, MIN(id) AS single_id
        FROM proposals
        WHERE (isDelete = 0 OR isDelete IS NULL)
        GROUP BY lead_id
      ) live ON live.lead_id = l.id
      WHERE ${common.sql}`,
		params: [...period.params, ...period.params, ...common.params],
	};
}

const CANONICAL_PROPOSAL_JOIN = `LEFT JOIN proposals p
  ON p.id = base.resolved_canonical_id
 AND p.lead_id = base.id
 AND (p.isDelete = 0 OR p.isDelete IS NULL)
 AND (p.canonical_lead_id IS NULL OR p.canonical_lead_id = base.id)`;

const PROJECT_JOIN = `LEFT JOIN projects pr
  ON pr.project_id = p.project_id
 AND (pr.isDelete = 0 OR pr.isDelete IS NULL)`;

function evidenceCondition(
	evidence: LeadAuditConversionEvidenceFilter
): string {
	switch (evidence) {
		case 'all':
			return '(base.in_cohort = 1 OR base.in_period_handoff = 1)';
		case 'handoff':
			return '(base.in_cohort = 1 AND (base.event_at IS NOT NULL OR p.id IS NOT NULL))';
		case 'period':
			return 'base.in_period_handoff = 1';
		case 'undated':
			return '(base.in_cohort = 1 AND base.event_at IS NULL AND p.id IS NOT NULL)';
		case 'unresolved':
			return '(base.in_cohort = 1 AND base.event_at IS NULL AND p.id IS NULL AND base.live_count > 0)';
		case 'stage_only':
			return "(base.in_cohort = 1 AND base.event_at IS NULL AND p.id IS NULL AND base.live_count = 0 AND base.enquiry_status = 'Converted')";
		default: {
			const unreachable: never = evidence;
			throw new Error(`Unknown conversion evidence: ${unreachable}`);
		}
	}
}

function rowSelect(options: LeadAuditConversionReadOptions): string {
	const proposal = options.includeProposals
		? 'p.proposal_title, p.status AS proposal_status, p.progress AS proposal_progress, p.project_id AS proposal_project_id'
		: 'NULL AS proposal_title, NULL AS proposal_status, NULL AS proposal_progress, NULL AS proposal_project_id';
	const project = options.includeProjects
		? 'pr.project_id AS project_ref_id, pr.project_title, pr.status AS project_status, pr.progress AS project_progress'
		: 'NULL AS project_ref_id, NULL AS project_title, NULL AS project_status, NULL AS project_progress';
	return `base.*, p.id AS canonical_id, ${proposal}, ${project},
    u.full_name AS owner_full_name, u.username AS owner_username`;
}

function downstreamOf(
	row: ConversionBaseRow,
	options: LeadAuditConversionReadOptions
): LeadAuditConversionDownstream {
	const canonicalId = toNullableId(row.canonical_id);
	const liveCount = toCount(row.live_count);
	if (canonicalId === null) {
		return {
			proposal_state: liveCount > 0 ? 'unresolved' : 'none',
			proposal: null,
		};
	}
	if (!options.includeProposals) {
		// Denied facts are not carried at all: the state is the whole answer.
		return { proposal_state: 'restricted', proposal: null };
	}

	const proposalProjectId = toNullableId(row.proposal_project_id);
	let projectState: LeadAuditConversionProposalContext['project_state'];
	let project: LeadAuditConversionProjectContext | null = null;
	if (proposalProjectId === null) {
		projectState = 'none';
	} else if (!options.includeProjects) {
		projectState = 'restricted';
	} else if (toNullableId(row.project_ref_id) === null) {
		// The Proposal names a Project that is not there or is deleted: the
		// link resolves to no Project, never to a guessed one.
		projectState = 'none';
	} else {
		projectState = 'available';
		project = {
			id: Number(row.project_ref_id),
			title: trimOrNull(row.project_title),
			status: trimOrNull(row.project_status),
			progress: toPercent(row.project_progress),
		};
	}

	return {
		proposal_state: 'available',
		proposal: {
			id: canonicalId,
			title: trimOrNull(row.proposal_title),
			status: trimOrNull(row.proposal_status),
			progress: toPercent(row.proposal_progress),
			project_state: projectState,
			project,
		},
	};
}

function evidenceOf(row: ConversionBaseRow): {
	evidence: LeadAuditConversionRow['evidence'];
	handoff: boolean;
	conversionAt: string | null;
} {
	const eventAt = row.event_at ? String(row.event_at) : null;
	const canonicalResolved = toNullableId(row.canonical_id) !== null;
	if (eventAt !== null) {
		return {
			evidence: 'conversion_event',
			handoff: true,
			conversionAt: eventAt,
		};
	}
	if (canonicalResolved) {
		return { evidence: 'canonical_link', handoff: true, conversionAt: null };
	}
	if (toCount(row.live_count) > 0) {
		return { evidence: 'unresolved_link', handoff: false, conversionAt: null };
	}
	if (row.enquiry_status === 'Converted') {
		return { evidence: 'stage_only', handoff: false, conversionAt: null };
	}
	return { evidence: 'none', handoff: false, conversionAt: null };
}

function toConversionRow(
	row: ConversionBaseRow,
	options: LeadAuditConversionReadOptions
): LeadAuditConversionRow {
	const stage = row.enquiry_status ? String(row.enquiry_status) : null;
	const evidence = evidenceOf(row);
	const ownerId = toNullableId(row.owner_user_id);
	const ownerName =
		trimOrNull(row.owner_full_name) ?? trimOrNull(row.owner_username);
	return {
		id: Number(row.id),
		lead_id: row.lead_id ? String(row.lead_id) : null,
		company_name: String(row.company_name ?? ''),
		contact_name: trimOrNull(row.contact_name),
		source: leadAuditSourceValue(row.lead_source),
		stage: { value: stage, label: leadAuditStageLabel(stage) },
		owner: ownerId === null ? null : { id: ownerId, name: ownerName },
		recorded_at: row.created_at ? String(row.created_at) : '',
		enquiry_date: row.enquiry_date ? String(row.enquiry_date) : null,
		evidence: evidence.evidence,
		handoff_evidenced: evidence.handoff,
		conversion_at: evidence.conversionAt,
		in_period_handoff: toCount(row.in_period_handoff) === 1,
		downstream: downstreamOf(row, options),
	};
}

async function queryEvidenceRows(
	db: DbConnection,
	filters: LeadAuditFilters,
	evidence: LeadAuditConversionEvidenceFilter,
	pagination: LeadAuditPagination | null,
	options: LeadAuditConversionReadOptions
): Promise<LeadAuditConversionRow[]> {
	const base = buildConversionBase(filters);
	const limitClause = pagination === null ? '' : 'LIMIT ? OFFSET ?';
	const params: unknown[] = [...base.params];
	if (pagination !== null) {
		params.push(pagination.limit, (pagination.page - 1) * pagination.limit);
	}
	const order =
		evidence === 'period'
			? 'base.event_at DESC, base.id DESC'
			: 'base.created_at DESC, base.id DESC';
	const [rows] = (await db.execute(
		`SELECT ${rowSelect(options)}
     FROM (${base.sql}) base
     ${CANONICAL_PROPOSAL_JOIN}
     ${PROJECT_JOIN}
     LEFT JOIN users u ON u.id = base.owner_user_id
     WHERE ${evidenceCondition(evidence)}
     ORDER BY ${order}
     ${limitClause}`,
		params
	)) as unknown as [ConversionBaseRow[], unknown];
	return rows.map((row) => toConversionRow(row, options));
}

/** The complete conversion evidence of the applied scope, for one export. */
export async function readLeadAuditConversionRows(
	db: DbConnection,
	filters: LeadAuditFilters,
	options: LeadAuditConversionReadOptions
): Promise<LeadAuditConversionRow[]> {
	return queryEvidenceRows(db, filters, 'all', null, options);
}

function effectiveFilterScope(
	filters: LeadAuditFilters,
	effective: LeadAuditEffectiveFilters
): LeadAuditSectionFilterScope {
	const applied: LeadAuditSectionFilterScope['effective'] = [
		{
			...EFFECTIVE_FILTER_BASE,
			label: `${filters.fromDate} to ${filters.toDate}`,
		},
	];
	if (filters.ownerUnassigned || filters.ownerUserId !== null) {
		applied.push({ key: 'owner', label: effective.owner.label });
	}
	if (filters.sourceMissing) {
		applied.push({ key: 'source_missing', label: effective.source.label });
	} else if (filters.source !== null) {
		applied.push({ key: 'source', label: effective.source.label });
	}
	if (filters.stage !== null) {
		applied.push({ key: 'stage', label: effective.stage.label });
	}
	if (filters.priority !== null) {
		applied.push({ key: 'priority', label: filters.priority });
	}
	if (filters.search !== '') {
		applied.push({ key: 'search', label: filters.search });
	}
	return { effective: applied, ignored: IGNORED_FILTERS };
}

function buildDisclosures(
	cohort: LeadAuditCohortConversion,
	period: LeadAuditPeriodHandoffs
): LeadAuditDisclosure[] {
	const disclosures: LeadAuditDisclosure[] = [
		{
			code: 'cohort_definition',
			text: 'The Lead Intake Cohort is the distinct, non-deleted Leads first recorded inside the selected period under the applied filters. Its progress is observed at the generation time, so a handoff after the intake period still counts.',
		},
		{
			code: 'evidence_requirement',
			text: 'A handoff needs a recorded conversion event or an evidence-backed, resolved canonical Proposal link. A Converted stage label alone is not handoff evidence.',
		},
		{
			code: 'retained_events',
			text: 'A retained conversion event remains handoff evidence when the downstream Proposal link later changes.',
		},
		{
			code: 'unresolved_links',
			text: `${cohort.unresolved_evidence} cohort Lead(s) have live linked Proposals without one canonical choice. They are disclosed evidence gaps, not confirmed failures and not guessed handoffs.`,
		},
		{
			code: 'stage_only',
			text: `${cohort.stage_only_claims} cohort Lead(s) are labelled Converted without recorded handoff evidence. The stage label does not enter the handoff count.`,
		},
		{
			code: 'undated_links',
			text: `${cohort.undated_links} cohort Lead(s) have a resolved canonical Proposal link but no recorded conversion time. They support cohort evidence only; a period handoff always needs an authoritative recorded conversion date.`,
		},
		{
			code: 'period_handoffs',
			text: `Period handoffs count ${period.handoffs} distinct Lead(s) whose authoritative recorded conversion time falls inside the selected period, including Leads recorded before it. ${period.undated_canonical_links} Lead(s) with an undated canonical link stay out of that count.`,
		},
		{
			code: 'no_period_rate',
			text: 'Period handoffs are not divided by period intake. A period handoff count and a cohort conversion rate use different populations and are never presented as one ratio.',
		},
		{
			code: 'stage_distribution',
			text: 'Current stage distribution is present state at the generation time, not a sequential funnel and not proof of historical stage transitions.',
		},
		{
			code: 'downstream_redaction',
			text: 'Canonical Proposal status and progress need proposals:read; Project details need projects:read. Denied facts are removed server-side and shown as Restricted, which is not the same as no downstream record. Lead-side handoff evidence stays available either way.',
		},
		{
			code: 'deleted_leads',
			text: 'Soft-deleted Leads are excluded from cohort and period conversion figures. Their retained conversion evidence belongs to the separate deleted-record audit population.',
		},
		{
			code: 'cohort_maturity',
			text: 'Cohorts recorded near the end of the selected period have had less time to progress. Compare conversion rates with the observation time and the cohort age in mind.',
		},
	];
	if (cohort.cohort_size === 0) {
		disclosures.push({
			code: 'empty_cohort',
			text: 'This cohort has no Leads, so the Lead Cohort Conversion Rate is Not applicable rather than zero percent. A zero handoff count here does not show failure.',
		});
	}
	return disclosures;
}

export async function readLeadAuditConversionSection(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock,
	options: LeadAuditConversionReadOptions
): Promise<LeadAuditConversionSection> {
	const base = buildConversionBase(filters);
	const includeProposals = options.includeProposals ? 1 : 0;
	const includeProjects = options.includeProjects ? 1 : 0;
	const aggregateParams = [
		// The flag markers live in the SELECT list, which precedes the derived
		// table in the SQL text, so they bind before the dates and filters.
		includeProposals,
		1 - includeProposals,
		includeProposals,
		includeProposals,
		1 - includeProjects,
		includeProposals,
		includeProjects,
		...base.params,
	];

	const [cohortResult, sourceResult, stageResult, periodResult, effective] =
		await Promise.all([
			db.execute(
				`SELECT
         COUNT(*) AS cohort_size,
         SUM(CASE WHEN base.event_at IS NOT NULL OR p.id IS NOT NULL THEN 1 ELSE 0 END) AS handoffs,
         SUM(CASE WHEN base.event_at IS NOT NULL THEN 1 ELSE 0 END) AS events,
         SUM(CASE WHEN base.event_at IS NULL AND p.id IS NOT NULL THEN 1 ELSE 0 END) AS undated,
         SUM(CASE WHEN base.event_at IS NULL AND p.id IS NULL AND base.live_count > 0 THEN 1 ELSE 0 END) AS unresolved,
         SUM(CASE WHEN base.event_at IS NULL AND p.id IS NULL AND base.live_count = 0 AND base.enquiry_status = 'Converted' THEN 1 ELSE 0 END) AS stage_only,
         SUM(CASE WHEN (base.event_at IS NOT NULL OR p.id IS NOT NULL) AND p.id IS NOT NULL AND ? = 1 THEN 1 ELSE 0 END) AS proposal_available,
         SUM(CASE WHEN (base.event_at IS NOT NULL OR p.id IS NOT NULL) AND p.id IS NOT NULL AND ? = 1 THEN 1 ELSE 0 END) AS proposal_restricted,
         SUM(CASE WHEN (base.event_at IS NOT NULL OR p.id IS NOT NULL) AND p.id IS NULL AND base.live_count > 0 THEN 1 ELSE 0 END) AS proposal_unresolved,
         SUM(CASE WHEN (base.event_at IS NOT NULL OR p.id IS NOT NULL) AND p.id IS NULL AND base.live_count = 0 THEN 1 ELSE 0 END) AS proposal_none,
         SUM(CASE WHEN p.id IS NOT NULL AND ? = 1 AND (p.project_id IS NULL OR pr.project_id IS NULL) THEN 1 ELSE 0 END) AS project_none,
         SUM(CASE WHEN p.id IS NOT NULL AND ? = 1 AND p.project_id IS NOT NULL AND ? = 0 THEN 1 ELSE 0 END) AS project_restricted,
         SUM(CASE WHEN p.id IS NOT NULL AND ? = 1 AND p.project_id IS NOT NULL AND pr.project_id IS NOT NULL AND ? = 1 THEN 1 ELSE 0 END) AS project_available
       FROM (${base.sql}) base
       ${CANONICAL_PROPOSAL_JOIN}
       ${PROJECT_JOIN}
       WHERE base.in_cohort = 1`,
				aggregateParams
			),
			db.execute(
				`SELECT
         COALESCE(BINARY base.lead_source, BINARY '') AS source,
         COUNT(*) AS cohort_size,
         SUM(CASE WHEN base.event_at IS NOT NULL OR p.id IS NOT NULL THEN 1 ELSE 0 END) AS handoffs,
         SUM(CASE WHEN base.event_at IS NULL AND p.id IS NULL AND base.live_count > 0 THEN 1 ELSE 0 END) AS unresolved,
         SUM(CASE WHEN base.event_at IS NULL AND p.id IS NULL AND base.live_count = 0 AND base.enquiry_status = 'Converted' THEN 1 ELSE 0 END) AS stage_only
       FROM (${base.sql}) base
       ${CANONICAL_PROPOSAL_JOIN}
       WHERE base.in_cohort = 1
       GROUP BY COALESCE(BINARY base.lead_source, BINARY '')`,
				base.params
			),
			db.execute(
				`SELECT base.enquiry_status AS stage, COUNT(*) AS count
       FROM (${base.sql}) base
       WHERE base.in_cohort = 1
       GROUP BY base.enquiry_status`,
				base.params
			),
			db.execute(
				`SELECT
         SUM(CASE WHEN base.in_period_handoff = 1 THEN 1 ELSE 0 END) AS period_handoffs,
         SUM(CASE WHEN base.event_at IS NULL AND p.id IS NOT NULL THEN 1 ELSE 0 END) AS undated_canonical_links
       FROM (${base.sql}) base
       ${CANONICAL_PROPOSAL_JOIN}`,
				base.params
			),
			resolveLeadAuditEffectiveFilters(db, filters),
		]);

	const [cohortRows] = cohortResult as unknown as [
		CohortAggregateRow[],
		unknown,
	];
	const aggregate = cohortRows[0];
	const cohortSize = toCount(aggregate?.cohort_size);
	const handoffs = toCount(aggregate?.handoffs);
	const unresolved = toCount(aggregate?.unresolved);
	const stageOnly = toCount(aggregate?.stage_only);
	const cohort: LeadAuditCohortConversion = {
		cohort_size: cohortSize,
		handoffs_evidenced: handoffs,
		conversion_rate: conversionRate(handoffs, cohortSize),
		conversion_events: toCount(aggregate?.events),
		undated_links: toCount(aggregate?.undated),
		unresolved_evidence: unresolved,
		stage_only_claims: stageOnly,
		no_handoff_evidence: Math.max(
			0,
			cohortSize - handoffs - unresolved - stageOnly
		),
		observed_through: clock.generatedAt,
	};

	const [sourceRows] = sourceResult as unknown as [
		SourceConversionRow[],
		unknown,
	];
	const sourceConversion: LeadAuditSourceConversion[] = sourceRows
		.map((row) => {
			const size = toCount(row.cohort_size);
			const evidenced = toCount(row.handoffs);
			return {
				...leadAuditSourceValue(row.source),
				cohort_size: size,
				handoffs_evidenced: evidenced,
				conversion_rate: conversionRate(evidenced, size),
				unresolved_evidence: toCount(row.unresolved),
				stage_only_claims: toCount(row.stage_only),
			};
		})
		.sort((left, right) => {
			if (left.cohort_size !== right.cohort_size) {
				return right.cohort_size - left.cohort_size;
			}
			if (left.is_unknown !== right.is_unknown) return left.is_unknown ? 1 : -1;
			return (left.label ?? '').localeCompare(right.label ?? '');
		});

	const [stageRows] = stageResult as unknown as [
		StageDistributionDbRow[],
		unknown,
	];
	const knownStageIndex = (value: string | null): number => {
		if (value === null) return LEAD_STAGES.length + 1;
		const index = (LEAD_STAGES as readonly string[]).indexOf(value);
		return index >= 0 ? index : LEAD_STAGES.length;
	};
	const stageDistribution: LeadAuditStageDistributionRow[] = stageRows
		.map((row) => {
			const value = row.stage ? String(row.stage) : null;
			return {
				stage: { value, label: leadAuditStageLabel(value) },
				count: toCount(row.count),
			};
		})
		.sort(
			(left, right) =>
				knownStageIndex(left.stage.value) - knownStageIndex(right.stage.value)
		);

	const [periodRows] = periodResult as unknown as [
		PeriodAggregateRow[],
		unknown,
	];
	const period: LeadAuditPeriodHandoffs = {
		handoffs: toCount(periodRows[0]?.period_handoffs),
		undated_canonical_links: toCount(periodRows[0]?.undated_canonical_links),
		date_basis:
			'Authoritative recorded conversion time (lead_conversions.converted_at) inside the selected calendar days. Proposal creation and Lead editing times are never substituted.',
	};

	const proposalStates = {
		none: toCount(aggregate?.proposal_none),
		unresolved: toCount(aggregate?.proposal_unresolved),
		restricted: toCount(aggregate?.proposal_restricted),
		available: toCount(aggregate?.proposal_available),
	};
	const projectStates: LeadAuditProjectStateCounts = {
		none: toCount(aggregate?.project_none),
		restricted: toCount(aggregate?.project_restricted),
		available: toCount(aggregate?.project_available),
	};
	const downstream: LeadAuditConversionDownstreamSummary = {
		handoffs,
		proposal_states: proposalStates,
		project_states: projectStates,
	};

	return {
		scope: buildLeadAuditScope(filters, effective),
		meta: buildLeadAuditMeta(clock),
		cohort,
		period,
		source_conversion: sourceConversion,
		stage_distribution: stageDistribution,
		downstream,
		evidence_filters: effectiveFilterScope(filters, effective),
		disclosures: buildDisclosures(cohort, period),
	};
}

/**
 * The evidence table explains its own population without restating cohort or
 * period counts it did not observe. Counts belong to the section read.
 */
function buildEvidenceDisclosures(
	evidence: LeadAuditConversionEvidenceFilter
): LeadAuditDisclosure[] {
	const descriptor = EVIDENCE_DESCRIPTORS[evidence];
	return [
		{
			code: 'evidence_population',
			text: descriptor.definition,
		},
		{
			code: 'evidence_requirement',
			text: 'A handoff needs a recorded conversion event or an evidence-backed, resolved canonical Proposal link. A Converted stage label alone is not handoff evidence.',
		},
		{
			code: 'retained_events',
			text: 'A retained conversion event remains handoff evidence when the downstream Proposal link later changes.',
		},
		{
			code: 'unresolved_and_stage_only',
			text: 'Unresolved links and Converted stage labels without evidence are disclosed gaps. They are neither guessed handoffs nor confirmed failures.',
		},
		{
			code: 'undated_links',
			text: 'An undated canonical link supports cohort evidence only. A period handoff always needs an authoritative recorded conversion time; Proposal creation and Lead editing times are never substituted.',
		},
		{
			code: 'no_period_rate',
			text: 'Period handoffs are not divided by period intake. The cohort conversion rate uses the whole cohort denominator.',
		},
		{
			code: 'downstream_redaction',
			text: 'Canonical Proposal status and progress need proposals:read; Project details need projects:read. Denied facts are removed server-side and shown as Restricted, which is not the same as no downstream record.',
		},
		{
			code: 'deleted_leads',
			text: 'Soft-deleted Leads are excluded from operational conversion evidence. Their retained evidence belongs to the separate deleted-record audit population.',
		},
	];
}

export async function readLeadAuditConversionEvidenceSection(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock,
	evidence: LeadAuditConversionEvidenceFilter,
	pagination: LeadAuditPagination,
	options: LeadAuditConversionReadOptions
): Promise<LeadAuditConversionEvidenceSection> {
	const base = buildConversionBase(filters);
	const countParams = [...base.params];
	const [countResult, rowResult, effective] = await Promise.all([
		db.execute(
			`SELECT COUNT(*) AS total
       FROM (${base.sql}) base
       ${CANONICAL_PROPOSAL_JOIN}
       WHERE ${evidenceCondition(evidence)}`,
			countParams
		),
		queryEvidenceRows(db, filters, evidence, pagination, options),
		resolveLeadAuditEffectiveFilters(db, filters),
	]);
	const [countRows] = countResult as unknown as [
		Array<{ total: number | string | null }>,
		unknown,
	];
	const total = toCount(countRows[0]?.total);

	return {
		scope: buildLeadAuditScope(filters, effective),
		meta: buildLeadAuditMeta(clock),
		evidence: EVIDENCE_DESCRIPTORS[evidence],
		rows: rowResult,
		pagination: {
			page: pagination.page,
			limit: pagination.limit,
			total,
			total_pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
		},
		downstream_options: {
			include_proposals: options.includeProposals,
			include_projects: options.includeProjects,
		},
		evidence_filters: effectiveFilterScope(filters, effective),
		disclosures: buildEvidenceDisclosures(evidence),
	};
}

/** The evidence descriptors, for the drill-down control and the workbook. */
export const LEAD_AUDIT_CONVERSION_EVIDENCE_DESCRIPTORS: Readonly<
	Record<
		LeadAuditConversionEvidenceFilter,
		LeadAuditConversionEvidenceDescriptor
	>
> = EVIDENCE_DESCRIPTORS;
