/**
 * Data coverage for the Lead Audit report.
 *
 * This section states what the stored evidence can and cannot establish:
 * unknown current facts, missing occurrence and actor evidence, unresolved
 * legacy links, retained deleted evidence, and the metric exclusions those
 * gaps create. It never fills a gap with a timestamp, an owner, or a guess.
 *
 * The work, timing, and conversion sections contribute their own coverage;
 * the parent report combines those with this section after merge.
 */
import type { DbConnection } from '@/server/leads/shared';
import { buildEvidenceUnion } from './audit-sql';
import {
	LEAD_AUDIT_DELETION_FACTS,
	LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS,
	type LeadAuditCoverageExclusion,
	type LeadAuditCoverageHistoryLimit,
	type LeadAuditCoverageSection,
	type LeadAuditCoverageStat,
	type LeadAuditEvidenceTypeCount,
} from './audit-types';
import { buildDeletedLeadFilterCondition } from './audit-filters';
import { parseLeadAuditEvidenceFilters } from './evidence-filters';
import {
	buildLeadAuditMeta,
	buildLeadAuditScope,
	resolveLeadAuditEffectiveFilters,
} from './scope';
import { buildLeadAuditFilterCondition } from './sql';
import type {
	LeadAuditClock,
	LeadAuditDisclosure,
	LeadAuditFilters,
} from './types';

interface LeadFactsRow {
	total: number | string;
	unknown_stage: number | string;
	unresolved_legacy_stage: number | string;
	missing_enquiry_date: number | string;
	missing_source: number | string;
	unassigned: number | string;
	unresolved_legacy_owner: number | string;
	proposal_conflict: number | string;
	converted_without_date: number | string;
	converted_without_evidence: number | string;
}

interface EvidenceFactsRow {
	total: number | string;
	undated: number | string;
	unknown_activity_author: number | string;
	unknown_activity_type: number | string;
	unknown_call_outcome: number | string;
	unknown_email_reply: number | string;
	automatic_legacy_reviews: number | string;
}

function toNumber(value: unknown): number {
	return Number(value) || 0;
}

function stat(
	code: string,
	label: string,
	count: number | null,
	population: string,
	detail: string,
	isExclusion = false
): LeadAuditCoverageStat {
	return { code, label, count, population, detail, is_exclusion: isExclusion };
}

export async function readLeadAuditCoverageSection(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock
): Promise<LeadAuditCoverageSection> {
	const leadCondition = buildLeadAuditFilterCondition(filters);
	const deletedCondition = buildDeletedLeadFilterCondition(filters);
	const union = buildEvidenceUnion({
		filters,
		evidence: parseLeadAuditEvidenceFilters({ actor: 'all' }),
		eventType: null,
		undated: false,
		population: 'active',
	});

	const [
		leadResult,
		evidenceResult,
		aggregateResult,
		deletedLeadsResult,
		deletedActivitiesResult,
		effective,
	] = await Promise.all([
		db.execute(
			`SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN l.enquiry_status IS NULL THEN 1 ELSE 0 END) AS unknown_stage,
          SUM(CASE WHEN l.legacy_stage IS NOT NULL AND l.enquiry_status IS NULL THEN 1 ELSE 0 END) AS unresolved_legacy_stage,
          SUM(CASE WHEN l.enquiry_date IS NULL THEN 1 ELSE 0 END) AS missing_enquiry_date,
          SUM(CASE WHEN l.lead_source IS NULL OR BINARY l.lead_source = BINARY '' THEN 1 ELSE 0 END) AS missing_source,
          SUM(CASE WHEN l.owner_user_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
          SUM(CASE WHEN l.legacy_owner_name IS NOT NULL AND l.owner_user_id IS NULL THEN 1 ELSE 0 END) AS unresolved_legacy_owner,
          SUM(CASE WHEN l.legacy_proposal_conflict = 1 AND l.canonical_proposal_id IS NULL THEN 1 ELSE 0 END) AS proposal_conflict,
          SUM(CASE WHEN l.enquiry_status = 'Converted' AND l.converted_at IS NULL THEN 1 ELSE 0 END) AS converted_without_date,
          SUM(CASE WHEN l.enquiry_status = 'Converted'
            AND l.converted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM lead_conversions cv WHERE cv.lead_id = l.id
            ) THEN 1 ELSE 0 END) AS converted_without_evidence
        FROM leads l
        WHERE ${leadCondition.sql}`,
			leadCondition.params
		),
		db.execute(
			`SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN e.evidence_type = 'activity' AND e.occurred_at IS NULL THEN 1 ELSE 0 END) AS undated,
          SUM(CASE WHEN e.evidence_type = 'activity' AND e.actor_id IS NULL THEN 1 ELSE 0 END) AS unknown_activity_author,
          SUM(CASE WHEN e.evidence_type = 'activity'
            AND (e.activity_type IS NULL OR e.activity_type NOT IN ('Call', 'Email', 'Meeting', 'Note'))
            THEN 1 ELSE 0 END) AS unknown_activity_type,
          SUM(CASE WHEN e.evidence_type = 'activity'
            AND e.activity_type = 'Call' AND e.call_outcome IS NULL
            THEN 1 ELSE 0 END) AS unknown_call_outcome,
          SUM(CASE WHEN e.evidence_type = 'activity'
            AND e.activity_type = 'Email' AND e.reply_confirmed IS NULL
            THEN 1 ELSE 0 END) AS unknown_email_reply,
          SUM(CASE WHEN e.evidence_type = 'legacy_review' AND e.actor_id IS NULL THEN 1 ELSE 0 END) AS automatic_legacy_reviews
        FROM (${union.sql}) e`,
			union.params
		),
		db.execute(
			`SELECT e.evidence_type, COUNT(*) AS total,
          SUM(CASE WHEN e.occurred_at IS NULL THEN 1 ELSE 0 END) AS undated,
          SUM(CASE WHEN e.actor_id IS NULL THEN 1 ELSE 0 END) AS unknown_actor
        FROM (${union.sql}) e
        GROUP BY e.evidence_type`,
			union.params
		),
		db.execute(
			`SELECT COUNT(*) AS total FROM leads l WHERE ${deletedCondition.sql}`,
			deletedCondition.params
		),
		db.execute(
			`SELECT COUNT(*) AS total FROM lead_activities a
        JOIN leads l ON l.id = a.lead_id
        WHERE ${leadCondition.sql} AND a.isDelete = 1`,
			leadCondition.params
		),
		resolveLeadAuditEffectiveFilters(db, filters),
	]);

	const [leadRows] = leadResult as unknown as [LeadFactsRow[], unknown];
	const [evidenceRows] = evidenceResult as unknown as [
		EvidenceFactsRow[],
		unknown,
	];
	const [aggregateRows] = aggregateResult as unknown as [
		Array<{
			evidence_type: string;
			total: number | string;
			undated: number | string;
			unknown_actor: number | string;
		}>,
		unknown,
	];
	const [deletedLeadRows] = deletedLeadsResult as unknown as [
		Array<{ total: number | string }>,
		unknown,
	];
	const [deletedActivityRows] = deletedActivitiesResult as unknown as [
		Array<{ total: number | string }>,
		unknown,
	];

	const leads = leadRows[0];
	const evidence = evidenceRows[0];
	const typeCounts = new Map(
		aggregateRows.map((row) => [String(row.evidence_type), toNumber(row.total)])
	);
	const evidenceByType: LeadAuditEvidenceTypeCount[] =
		LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS.map((option) => ({
			value: option.value,
			label: option.label,
			count: typeCounts.get(option.value) ?? 0,
		}));

	const deletedLeads = toNumber(deletedLeadRows[0]?.total);
	const deletedActivities = toNumber(deletedActivityRows[0]?.total);

	const stats: LeadAuditCoverageStat[] = [
		stat(
			'lead_population',
			'Active Leads in the applied current-state scope',
			toNumber(leads?.total),
			'Non-deleted Leads matching the applied current-state filters',
			'This is the Lead population the unknown-fact counts below describe. It is independent of the selected period.'
		),
		stat(
			'unknown_stage',
			'Leads with no resolved current stage',
			toNumber(leads?.unknown_stage),
			'Active Leads in the applied current-state scope',
			'An unresolved stage stays explicit. No stage-entry time or earlier stage is inferred from record timestamps.'
		),
		stat(
			'unresolved_legacy_stage',
			'Leads with a stored legacy stage that no reviewer resolved',
			toNumber(leads?.unresolved_legacy_stage),
			'Active Leads in the applied current-state scope',
			'The original stored label remains evidence; the canonical stage stays unresolved.'
		),
		stat(
			'missing_enquiry_date',
			'Leads with no stated Enquiry Date',
			toNumber(leads?.missing_enquiry_date),
			'Active Leads in the applied current-state scope',
			'System entry is never substituted for the missing Enquiry Date, so these Leads cannot enter Enquiry Date figures.'
		),
		stat(
			'missing_source',
			'Leads with no stored source label',
			toNumber(leads?.missing_source),
			'Active Leads in the applied current-state scope',
			'Missing labels appear as Unknown source. No label is inferred from another record.'
		),
		stat(
			'unassigned',
			'Leads with no owner',
			toNumber(leads?.unassigned),
			'Active Leads in the applied current-state scope',
			'Unassigned Leads stay unassigned; no owner is borrowed from the creator or an editor.'
		),
		stat(
			'unresolved_legacy_owner',
			'Leads with an unresolved stored legacy owner name',
			toNumber(leads?.unresolved_legacy_owner),
			'Active Leads in the applied current-state scope',
			'A legacy owner display name that did not resolve to exactly one user stays explicit evidence.'
		),
		stat(
			'proposal_link_conflict',
			'Leads with several linked Proposals and no canonical choice',
			toNumber(leads?.proposal_conflict),
			'Active Leads in the applied current-state scope',
			'An unresolved canonical Proposal link is an evidence gap, not a confirmed handoff or a confirmed failure.'
		),
		stat(
			'converted_without_date',
			'Converted Leads without an authoritative conversion date',
			toNumber(leads?.converted_without_date),
			'Active Leads with the Converted stage',
			'A Converted label alone is not dated handoff evidence. No Proposal creation or Lead update time is used instead.'
		),
		stat(
			'converted_without_evidence',
			'Converted Leads without a conversion event or conversion date',
			toNumber(leads?.converted_without_evidence),
			'Active Leads with the Converted stage',
			'The stage label is visible, but no conversion evidence establishes a handoff date.'
		),
		stat(
			'evidence_in_period',
			'Audit evidence recorded in the selected period',
			toNumber(evidence?.total),
			'Activity, stage, owner, correction, legacy-review, and conversion evidence under the applied Lead filters',
			'Selected by recording time. Occurrence time is shown separately and never selects these rows.'
		),
		stat(
			'undated_activity_evidence',
			'Activity evidence with no occurrence time',
			toNumber(evidence?.undated),
			'Audit evidence recorded in the selected period',
			'Undated evidence stays inspectable in the audit view and is excluded from occurrence-dated work totals.'
		),
		stat(
			'unknown_activity_author',
			'Activity evidence with no recorded author',
			toNumber(evidence?.unknown_activity_author),
			'Audit evidence recorded in the selected period',
			'The recorded author stays Unknown. The current owner is never used as a historical author.'
		),
		stat(
			'unknown_activity_type',
			'Activity evidence with an unknown type',
			toNumber(evidence?.unknown_activity_type),
			'Audit evidence recorded in the selected period',
			'Legacy work without a canonical type stays unknown and cannot be assigned to one activity type.'
		),
		stat(
			'unknown_call_outcome',
			'Completed calls with no recorded outcome',
			toNumber(evidence?.unknown_call_outcome),
			'Call evidence recorded in the selected period',
			'An unknown call outcome is excluded from successful-contact figures and never guessed.'
		),
		stat(
			'unknown_email_reply',
			'Email evidence without a stated reply flag',
			toNumber(evidence?.unknown_email_reply),
			'Email evidence recorded in the selected period',
			'Only a confirmed reply counts as successful contact; a missing flag is not a confirmed reply.'
		),
		stat(
			'automatic_legacy_reviews',
			'Legacy reviews with no human reviewer',
			toNumber(evidence?.automatic_legacy_reviews),
			'Legacy-review evidence recorded in the selected period',
			'An automatic resolution records no reviewer. The absence stays explicit and is never assigned to an editor.'
		),
	];

	const exclusions: LeadAuditCoverageExclusion[] = [
		{
			metric: 'period_work',
			label: 'Completed work in the period',
			excluded: toNumber(evidence?.undated),
			reason:
				'Activities with no occurrence time cannot enter an occurrence-dated work period. They remain inspectable as undated audit evidence.',
		},
		{
			metric: 'successful_contact',
			label: 'Successful contact',
			excluded:
				toNumber(evidence?.unknown_call_outcome) +
				toNumber(evidence?.unknown_email_reply),
			reason:
				'A call with no outcome and an email without a confirmed reply cannot establish successful contact. They are not counted as failures either.',
		},
		{
			metric: 'period_handoff',
			label: 'Dated conversion handoffs',
			excluded: toNumber(leads?.converted_without_date),
			reason:
				'Converted Leads without an authoritative conversion date cannot enter a dated handoff count. A Converted label, Proposal creation, or Lead update time is never substituted.',
		},
		{
			metric: 'cohort_conversion',
			label: 'Cohort conversion evidence',
			excluded: toNumber(leads?.proposal_conflict),
			reason:
				'An unresolved canonical Proposal link is disclosed as an evidence gap and cannot be counted as a confirmed handoff or a confirmed failure.',
		},
		{
			metric: 'operational_totals',
			label: 'Operational intake, work, cohort, risk, and owner totals',
			excluded: deletedLeads + deletedActivities,
			reason:
				'Retained deleted Leads and deleted activity evidence are reported separately and never enter operational totals.',
		},
		{
			metric: 'audit_occurrence_totals',
			label: 'Occurrence-dated evidence totals',
			excluded: toNumber(evidence?.undated),
			reason:
				'Undated evidence is never silently inserted into dated event totals; it stays visible as explicitly undated evidence.',
		},
	];

	const historyLimits: LeadAuditCoverageHistoryLimit[] = [
		{
			code: 'generic_enquiry_edits',
			label: 'Generic enquiry edits',
			detail:
				'Lead fields such as company, contact details, priority, source, and Enquiry Date can be edited without a field-level change event. Earlier values are not available from this report.',
		},
		{
			code: 'rescheduling',
			label: 'Task rescheduling',
			detail:
				"Changing a scheduled activity's date updates the task. The report does not reconstruct every earlier schedule from update timestamps.",
		},
		{
			code: 'stage_history',
			label: 'Stage and lifecycle history',
			detail:
				'Recorded stage changes are available, but some earlier historical stage changes lack a row. A missing stage-entry time is never derived from Lead creation or update.',
		},
		{
			code: 'author_outcome_occurrence',
			label: 'Authors, outcomes, and occurrence times',
			detail:
				'Legacy activities can lack an author, a call outcome, or an occurrence time. Those facts stay Unknown and are not borrowed from the current owner, the latest editor, or another timestamp.',
		},
		{
			code: 'corrections_live',
			label: 'Live corrected facts',
			detail:
				'A correction updates the current activity and keeps its own history. Earlier-period figures can therefore change on a later observation; this is not an immutable issued report.',
		},
		{
			code: 'deleted_facts',
			label: 'Deletion evidence',
			detail: LEAD_AUDIT_DELETION_FACTS.note,
		},
		{
			code: 'not_compliance_log',
			label: 'Not a compliance-grade change log',
			detail:
				'This report exposes available evidence. It is not a complete, tamper-evident audit trail and must not be presented as one.',
		},
	];

	const disclosures: LeadAuditDisclosure[] = [
		{
			code: 'coverage_current_state',
			text: 'Unknown current facts are counted on the applied current-state Lead population, independent of the selected period.',
		},
		{
			code: 'coverage_recording',
			text: 'Evidence counts use recording time. Occurrence time, where supported, is separate and is never substituted for a missing recording time.',
		},
		{
			code: 'coverage_not_zero',
			text: 'A missing fact is shown as Unknown, Unresolved, or Restricted. It is never reported as a measured zero.',
		},
		{
			code: 'coverage_deleted',
			text: `Retained deleted evidence (${deletedLeads} deleted Lead(s), ${deletedActivities} deleted activity row(s)) is excluded from operational totals and reported separately.`,
		},
		{
			code: 'coverage_evidence_filters',
			text: 'Actor, activity type, outcome, event type, and undated filters narrow the audit evidence list. This coverage section describes the applied Lead population and selected period, not the narrowed evidence list.',
		},
		{
			code: 'coverage_combined',
			text: 'Work, timing, and conversion sections contribute their own coverage and exclusions; this section covers the Lead facts, audit evidence, and retained deleted evidence.',
		},
	];

	return {
		scope: buildLeadAuditScope(filters, effective),
		meta: buildLeadAuditMeta(clock),
		stats,
		evidence_by_type: evidenceByType,
		exclusions,
		history_limits: historyLimits,
		deleted_evidence: {
			deleted_leads: deletedLeads,
			deleted_activities: deletedActivities,
			note: 'Retained deleted evidence is readable in the audit view and outside every operational total.',
		},
		disclosures,
	};
}
