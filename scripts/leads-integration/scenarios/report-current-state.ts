import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';

// The Lead Audit current-state slice (#401). Present ownership and the five
// operational queues are proved through the authenticated HTTP reads only:
// fixture Leads and activities go into the disposable database with dates
// taken from the database calendar day, and every expected figure is an
// independent literal derived from those known values.
//
// The current-state reads observe live state at generation time. The selected
// reporting period is deliberately ignored, so a historical range must still
// report today's risks and must say that the period was ignored.

const ObservationSchema = z
	.object({
		generated_at: z.string(),
		today: z.string(),
		time_zone: z
			.object({
				session: z.string(),
				system: z.string(),
				utc_offset: z.string(),
				label: z.string(),
			})
			.passthrough(),
		date_basis: z.string(),
		live_data_warning: z.string(),
	})
	.passthrough();

const EffectiveFiltersSchema = z
	.object({
		owner: z.object({ value: z.string().nullable(), label: z.string() }),
		source: z.object({
			value: z.string().nullable(),
			label: z.string(),
			is_unknown: z.boolean(),
		}),
		stage: z.object({ value: z.string().nullable(), label: z.string() }),
		priority: z.string().nullable(),
		search: z.string(),
	})
	.passthrough();

const IgnoredFilterSchema = z
	.object({
		key: z.string(),
		label: z.string(),
		value: z.string().nullable(),
		reason: z.string(),
	})
	.passthrough();

const ScopeSchema = z
	.object({
		effective_filters: EffectiveFiltersSchema,
		ignored_filters: z.array(IgnoredFilterSchema),
	})
	.passthrough();

const OwnerSchema = z
	.object({
		id: z.number().nullable(),
		name: z.string(),
		is_inactive: z.boolean(),
		is_unknown: z.boolean(),
	})
	.passthrough();

const SummarySchema = z
	.object({
		as_of: ObservationSchema,
		scope: ScopeSchema,
		workload: z
			.object({
				counter_unit: z.literal('distinct_leads'),
				total: z.number(),
				owners: z.array(
					z
						.object({
							owner: OwnerSchema,
							count: z.number(),
						})
						.passthrough()
				),
			})
			.passthrough(),
		risks: z.array(
			z
				.object({
					key: z.string(),
					label: z.string(),
					definition: z.string(),
					count: z.number(),
					counter_unit: z.literal('distinct_leads'),
					evidence_unit: z.enum(['lead', 'scheduled_work_item']),
					as_of: z.string(),
				})
				.passthrough()
		),
		disclosures: z.array(
			z.object({ code: z.string(), text: z.string() }).passthrough()
		),
	})
	.passthrough();

type SummaryBody = z.infer<typeof SummarySchema>;

const SummaryEnvelopeSchema = z
	.object({ success: z.literal(true), data: SummarySchema })
	.passthrough();

const EvidenceRowSchema = z
	.object({
		kind: z.enum(['lead', 'scheduled_work_item']),
		lead: z
			.object({
				id: z.number(),
				lead_id: z.string().nullable(),
				company_name: z.string(),
				contact_name: z.string().nullable(),
			})
			.passthrough(),
		source: z.object({
			label: z.string().nullable(),
			is_unknown: z.boolean(),
		}),
		priority: z.string().nullable(),
		stage: z.object({ value: z.string().nullable(), label: z.string() }),
		owner: OwnerSchema,
		enquiry_date: z.string().nullable(),
		recorded_at: z.string(),
		work_item: z
			.object({
				id: z.number(),
				activity_type: z.string().nullable(),
				scheduled_for: z.string(),
				next_action: z.string().nullable(),
			})
			.passthrough()
			.nullable(),
	})
	.passthrough();

const EvidenceSchema = z
	.object({
		as_of: ObservationSchema,
		scope: ScopeSchema,
		group: z
			.object({
				key: z.enum(['workload', 'risk']),
				risk: z.string().nullable(),
				label: z.string(),
				definition: z.string(),
				counter_unit: z.literal('distinct_leads'),
				evidence_unit: z.enum(['lead', 'scheduled_work_item']),
			})
			.passthrough(),
		rows: z.array(EvidenceRowSchema),
		pagination: z.object({
			page: z.number(),
			limit: z.number(),
			total: z.number(),
			total_pages: z.number(),
		}),
		distinct_leads_total: z.number(),
		disclosures: z.array(
			z.object({ code: z.string(), text: z.string() }).passthrough()
		),
	})
	.passthrough();

type EvidenceBody = z.infer<typeof EvidenceSchema>;

const EvidenceEnvelopeSchema = z
	.object({ success: z.literal(true), data: EvidenceSchema })
	.passthrough();

const ErrorEnvelopeSchema = z
	.object({
		success: z.literal(false),
		error: z.string(),
		code: z.string().optional(),
	})
	.passthrough();

const PREFIX = 'ReportCurrentState';
const HISTORICAL_FROM = '2025-01-01';
const HISTORICAL_TO = '2025-01-31';

function withPrefix(context: ScenarioContext, suffix: string): string {
	return `${context.runTag} ${PREFIX} ${suffix}`;
}

function query(
	values: Record<string, string | number | null | undefined>
): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value === null || value === undefined || value === '') continue;
		params.set(key, String(value));
	}
	const suffix = params.toString();
	return suffix ? `?${suffix}` : '';
}

async function readCurrentState(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<SummaryBody> {
	const response = await context.http.get(
		`/api/reports/lead-audit/current-state${query(values)}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`current-state status (body: ${response.text})`
	);
	return SummaryEnvelopeSchema.parse(response.json()).data;
}

async function readEvidence(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<EvidenceBody> {
	const response = await context.http.get(
		`/api/reports/lead-audit/current-state/evidence${query(values)}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`current-state evidence status (body: ${response.text})`
	);
	return EvidenceEnvelopeSchema.parse(response.json()).data;
}

async function expectRefused(
	context: ScenarioContext,
	path: string,
	token: string | undefined,
	status: number
): Promise<void> {
	const response = await context.http.get(path, token);
	assert.equal(
		response.status,
		status,
		`${path} status for ${token ? 'session' : 'anonymous'} (body: ${response.text})`
	);
}

function addDays(date: string, days: number): string {
	const [year, month, day] = date.split('-').map(Number);
	const value = new Date(Date.UTC(year, month - 1, day + days));
	return value.toISOString().slice(0, 10);
}

function risk(summary: SummaryBody, key: string) {
	const found = summary.risks.find((entry) => entry.key === key);
	assert.ok(found, `risk ${key} is reported`);
	return found;
}

function workloadGroup(summary: SummaryBody, ownerId: number | null) {
	const found = summary.workload.owners.find(
		(entry) => entry.owner.id === ownerId
	);
	assert.ok(found, `workload group ${String(ownerId)} is reported`);
	return found;
}

interface Seeded {
	id: number;
	company: string;
}

async function seedLead(
	context: ScenarioContext,
	suffix: string,
	input: {
		recordedAt: string;
		stage: string | null;
		ownerUserId?: number | null;
		source?: string | null;
		priority?: 'Low' | 'Medium' | 'High' | null;
		isDeleted?: boolean;
	}
): Promise<Seeded> {
	const company = withPrefix(context, suffix);
	const id = await context.reader.seedReportLead({
		companyName: company,
		contactName: `${context.runTag} Contact ${suffix}`,
		projectDescription: `${context.runTag} ${PREFIX} need ${suffix}`,
		recordedAt: input.recordedAt,
		enquiryDate: null,
		// Explicit null is the missing-label fixture; only an omitted source
		// uses the ordinary Website label.
		source: input.source === undefined ? 'Website' : input.source,
		stage: input.stage,
		priority: input.priority ?? null,
		ownerUserId: input.ownerUserId ?? null,
		isDeleted: input.isDeleted ?? false,
	});
	context.trackLead(id);
	return { id, company };
}

interface ActivityInput {
	activityType: string | null;
	status: string;
	callOutcome?: string | null;
	replyConfirmed?: number | null;
	scheduledFor?: string | null;
	occurredAt?: string | null;
	completedAt?: string | null;
	nextAction?: string | null;
	notes?: string | null;
	createdBy?: number | null;
	transferredFollowupId?: number | null;
	transferredAt?: string | null;
}

async function seedActivity(
	context: ScenarioContext,
	leadId: number,
	input: ActivityInput
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_activities (
       lead_id, activity_type, status, call_outcome, reply_confirmed,
       scheduled_for, occurred_at, completed_at, next_action, notes,
       created_by, recorded_at, isDelete, transferred_followup_id, transferred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-10 09:00:00', 0, ?, ?)`,
		[
			leadId,
			input.activityType,
			input.status,
			input.callOutcome ?? null,
			input.replyConfirmed ?? null,
			input.scheduledFor ?? null,
			input.occurredAt ?? null,
			input.completedAt ?? null,
			input.nextAction ?? null,
			input.notes ?? null,
			input.createdBy ?? null,
			input.transferredFollowupId ?? null,
			input.transferredAt ?? null,
		]
	);
	return result.insertId;
}

/** A real Proposal follow-up, so transferred work keeps a real reference. */
async function seedTransferredWork(
	context: ScenarioContext,
	leadId: number,
	scheduledFor: string
): Promise<{ proposalId: number; followupId: number }> {
	const proposal = await context.reader.fixtureWrite(
		`INSERT INTO proposals (proposal_title, lead_id, status, progress, created_at)
     VALUES (?, ?, 'draft', 0, '2026-01-10 09:00:00')`,
		[`${context.runTag} ${PREFIX} handoff`, leadId]
	);
	const followup = await context.reader.fixtureWrite(
		`INSERT INTO proposal_followups (
       proposal_id, follow_up_date, follow_up_type, status, description,
       created_by, created_at
     ) VALUES (?, ?, 'Call', 'Scheduled', ?, ?, '2026-01-10 09:00:00')`,
		[
			proposal.insertId,
			scheduledFor,
			`${context.runTag} ${PREFIX} transferred`,
			context.creator.id,
		]
	);
	return { proposalId: proposal.insertId, followupId: followup.insertId };
}

async function seedInactiveOwner(
	context: ScenarioContext
): Promise<{ id: number; fullName: string }> {
	const suffix = `${context.runTag}-${PREFIX}-inactive`;
	const username = suffix.toLowerCase().replace(/[^a-z0-9-]/g, '-');
	const fullName = `${context.runTag} ${PREFIX} Inactive Owner`;
	const result = await context.reader.fixtureWrite(
		`INSERT INTO users (
       username, password_hash, email, full_name, status, is_active,
       isDelete, permissions, is_super_admin
     ) VALUES (?, 'unused', ?, ?, 'inactive', 0, 0, '[]', 0)`,
		[username, `${username}@example.com`, fullName]
	);
	return { id: result.insertId, fullName };
}

export async function leadAuditCurrentStateScenario(
	context: ScenarioContext
): Promise<void> {
	const today = await context.reader.databaseToday();
	assert.match(today, /^\d{4}-\d{2}-\d{2}$/, 'the database calendar day');
	const yesterday = addDays(today, -1);
	const tomorrow = addDays(today, 1);
	const search = `${context.runTag} ${PREFIX}`;
	const token = context.reportReader.sessionToken;

	// ── Independent fixture evidence ────────────────────────────────────────
	const inactiveOwner = await seedInactiveOwner(context);

	const unassignedNew = await seedLead(context, 'A Unassigned New', {
		recordedAt: '2026-01-01 09:00:00',
		stage: 'New',
		ownerUserId: null,
	});
	const assignedConnectedDone = await seedLead(
		context,
		'B Connected Completed Call',
		{
			recordedAt: '2026-01-02 09:00:00',
			stage: 'Connected',
			ownerUserId: context.assignee.id,
		}
	);
	const assignedAttemptingFuture = await seedLead(
		context,
		'C Attempting Future Task',
		{
			recordedAt: '2026-01-03 09:00:00',
			stage: 'Attempting Contact',
			ownerUserId: context.assignee.id,
		}
	);
	const assignedQualifiedOverdue = await seedLead(
		context,
		'D Qualified Overdue',
		{
			recordedAt: '2026-01-04 09:00:00',
			stage: 'Qualified',
			ownerUserId: context.assignee.id,
		}
	);
	const inactiveNurtureToday = await seedLead(
		context,
		'E Nurture Due Today',
		{
			recordedAt: '2026-01-05 09:00:00',
			stage: 'Nurture',
			ownerUserId: inactiveOwner.id,
		}
	);
	const assignedConnectedTwoOverdue = await seedLead(
		context,
		'F Connected Two Overdue',
		{
			recordedAt: '2026-01-06 09:00:00',
			stage: 'Connected',
			ownerUserId: context.assignee.id,
		}
	);
	const assignedConnectedNote = await seedLead(
		context,
		'G Connected Note Only',
		{
			recordedAt: '2026-01-07 09:00:00',
			stage: 'Connected',
			ownerUserId: context.assignee.id,
		}
	);
	const assignedQualifiedClosed = await seedLead(
		context,
		'H Qualified Closed Work',
		{
			recordedAt: '2026-01-08 09:00:00',
			stage: 'Qualified',
			ownerUserId: context.assignee.id,
		}
	);
	const assignedNurtureTomorrow = await seedLead(
		context,
		'I Nurture Tomorrow',
		{
			recordedAt: '2026-01-09 09:00:00',
			stage: 'Nurture',
			ownerUserId: context.assignee.id,
		}
	);
	const assignedDisqualifiedNone = await seedLead(
		context,
		'J Disqualified None',
		{
			recordedAt: '2026-01-10 09:00:00',
			stage: 'Disqualified',
			ownerUserId: context.assignee.id,
			source: null,
		}
	);
	const assignedConvertedNone = await seedLead(
		context,
		'K Converted None',
		{
			recordedAt: '2026-01-11 09:00:00',
			stage: 'Converted',
			ownerUserId: context.assignee.id,
		}
	);
	const creatorOwnedUntouched = await seedLead(
		context,
		'L Creator Referral',
		{
			recordedAt: '2026-01-12 09:00:00',
			stage: 'New',
			ownerUserId: context.creator.id,
			source: 'Referral',
		}
	);
	const deletedOverdue = await seedLead(context, 'M Deleted Overdue', {
		recordedAt: '2026-01-13 09:00:00',
		stage: 'Connected',
		ownerUserId: null,
		isDeleted: true,
	});

	const completedCall = await seedActivity(context, assignedConnectedDone.id, {
		activityType: 'Call',
		status: 'Completed',
		callOutcome: 'Connected',
		replyConfirmed: null,
		occurredAt: '2026-01-02 10:00:00',
		completedAt: '2026-01-02 10:00:00',
		createdBy: context.creator.id,
	});
	await seedActivity(context, assignedAttemptingFuture.id, {
		activityType: 'Call',
		status: 'Scheduled',
		scheduledFor: tomorrow,
		nextAction: 'Call back',
		createdBy: context.assignee.id,
	});
	await seedActivity(context, assignedQualifiedOverdue.id, {
		activityType: 'Email',
		status: 'Scheduled',
		scheduledFor: yesterday,
		nextAction: 'Send revised scope',
		createdBy: context.assignee.id,
	});
	await seedActivity(context, inactiveNurtureToday.id, {
		activityType: 'Meeting',
		status: 'Scheduled',
		scheduledFor: today,
		nextAction: 'Nurture meeting',
		createdBy: inactiveOwner.id,
	});
	const twoOverdueOne = await seedActivity(
		context,
		assignedConnectedTwoOverdue.id,
		{
			activityType: 'Call',
			status: 'Scheduled',
			scheduledFor: yesterday,
			nextAction: 'First overdue call',
			createdBy: context.assignee.id,
		}
	);
	const twoOverdueTwo = await seedActivity(
		context,
		assignedConnectedTwoOverdue.id,
		{
			activityType: 'Email',
			status: 'Scheduled',
			scheduledFor: yesterday,
			nextAction: 'Second overdue email',
			createdBy: context.assignee.id,
		}
	);
	const noteOnly = await seedActivity(context, assignedConnectedNote.id, {
		activityType: 'Note',
		status: 'Completed',
		occurredAt: '2026-01-07 10:00:00',
		completedAt: '2026-01-07 10:00:00',
		notes: 'Documentation only',
		createdBy: context.assignee.id,
	});
	const closedCall = await seedActivity(
		context,
		assignedQualifiedClosed.id,
		{
			activityType: 'Call',
			status: 'Completed',
			callOutcome: 'Connected',
			scheduledFor: yesterday,
			occurredAt: '2026-01-08 10:00:00',
			completedAt: '2026-01-08 10:00:00',
			createdBy: context.assignee.id,
		}
	);
	const cancelled = await seedActivity(context, assignedQualifiedClosed.id, {
		activityType: 'Call',
		status: 'Cancelled',
		scheduledFor: yesterday,
		nextAction: 'Cancelled call',
		createdBy: context.assignee.id,
	});
	const transferred = await seedTransferredWork(
		context,
		assignedQualifiedClosed.id,
		yesterday
	);
	const transferredActivity = await seedActivity(
		context,
		assignedQualifiedClosed.id,
		{
			activityType: 'Meeting',
			status: 'Scheduled',
			scheduledFor: yesterday,
			nextAction: 'Transferred meeting',
			createdBy: context.assignee.id,
			transferredFollowupId: transferred.followupId,
			transferredAt: '2026-01-08 11:00:00',
		}
	);
	await seedActivity(context, assignedNurtureTomorrow.id, {
		activityType: 'Email',
		status: 'Scheduled',
		scheduledFor: tomorrow,
		nextAction: 'Future nurture email',
		createdBy: context.assignee.id,
	});
	const deletedOverdueActivity = await seedActivity(
		context,
		deletedOverdue.id,
		{
			activityType: 'Call',
			status: 'Scheduled',
			scheduledFor: yesterday,
			nextAction: 'Deleted lead overdue',
			createdBy: context.assignee.id,
		}
	);
	await seedActivity(context, deletedOverdue.id, {
		activityType: 'Note',
		status: 'Completed',
		occurredAt: '2026-01-13 10:00:00',
		completedAt: '2026-01-13 10:00:00',
		notes: 'Deleted lead note',
		createdBy: context.assignee.id,
	});

	const leadSnapshotSql = `SELECT id, company_name, enquiry_status, owner_user_id,
      isDelete, created_at, lead_source, priority
    FROM leads WHERE company_name LIKE ? ORDER BY id ASC`;
	const activitySnapshotSql = `SELECT id, lead_id, activity_type, status,
      call_outcome, reply_confirmed, scheduled_for, occurred_at, completed_at,
      next_action, notes, created_by, recorded_at, isDelete,
      transferred_followup_id, transferred_at
    FROM lead_activities WHERE lead_id IN (
      SELECT id FROM leads WHERE company_name LIKE ?
    ) ORDER BY id ASC`;
	const snapshotLeads = async () =>
		(
			await context.reader.fixtureRows(leadSnapshotSql, [`%${search}%`])
		).map((row) => JSON.stringify(row));
	const snapshotActivities = async () =>
		(
			await context.reader.fixtureRows(activitySnapshotSql, [`%${search}%`])
		).map((row) => JSON.stringify(row));

	const leadsBefore = await snapshotLeads();
	const activitiesBefore = await snapshotActivities();

	// ── Summary: live current state, independent of the selected period ─────
	const summary = await readCurrentState(context, { search }, token);
	assert.equal(summary.as_of.today, today);
	assert.equal(summary.as_of.date_basis.includes('current'), true);
	assert.ok(summary.as_of.live_data_warning.length > 0);
	assert.ok(summary.as_of.time_zone.label.length > 0);
	assert.equal(summary.workload.counter_unit, 'distinct_leads');
	assert.equal(summary.workload.total, 12);
	assert.deepEqual(
		summary.workload.owners.map((entry) => entry.owner.id),
		[null, context.assignee.id, context.creator.id, inactiveOwner.id],
		'unassigned first, then workload by descending owner count and owner id'
	);
	assert.equal(workloadGroup(summary, null).count, 1);
	assert.equal(workloadGroup(summary, context.assignee.id).count, 9);
	assert.equal(workloadGroup(summary, inactiveOwner.id).count, 1);
	assert.equal(workloadGroup(summary, context.creator.id).count, 1);
	assert.equal(
		workloadGroup(summary, context.creator.id).count,
		1,
		'activity authorship does not add another owner workload Lead'
	);
	assert.equal(workloadGroup(summary, inactiveOwner.id).owner.is_inactive, true);
	assert.equal(workloadGroup(summary, inactiveOwner.id).owner.is_unknown, false);
	assert.equal(workloadGroup(summary, null).owner.name, 'Unassigned');

	assert.deepEqual(
		summary.risks.map((entry) => entry.key),
		['unassigned', 'untouched', 'overdue', 'due_today', 'no_next_action']
	);
	assert.equal(risk(summary, 'unassigned').count, 1);
	assert.equal(risk(summary, 'untouched').count, 10);
	assert.equal(risk(summary, 'overdue').count, 2);
	assert.equal(risk(summary, 'due_today').count, 1);
	assert.equal(risk(summary, 'no_next_action').count, 3);
	for (const entry of summary.risks) {
		assert.equal(entry.counter_unit, 'distinct_leads');
		assert.equal(
			entry.as_of,
			summary.as_of.generated_at,
			'every risk group is stamped as of generation time'
		);
	}
	assert.equal(risk(summary, 'overdue').evidence_unit, 'scheduled_work_item');
	assert.equal(risk(summary, 'due_today').evidence_unit, 'scheduled_work_item');
	assert.equal(risk(summary, 'untouched').evidence_unit, 'lead');
	assert.equal(risk(summary, 'no_next_action').evidence_unit, 'lead');
	assert.ok(
		summary.disclosures.some((entry) => entry.code === 'current_state'),
		'current-state observation is disclosed'
	);

	// ── A historical range still returns today's live risks ─────────────────
	const historical = await readCurrentState(
		context,
		{ search, from_date: HISTORICAL_FROM, to_date: HISTORICAL_TO },
		token
	);
	assert.equal(historical.workload.total, 12);
	assert.equal(risk(historical, 'unassigned').count, 1);
	assert.equal(risk(historical, 'untouched').count, 10);
	assert.equal(risk(historical, 'overdue').count, 2);
	assert.equal(risk(historical, 'due_today').count, 1);
	assert.equal(risk(historical, 'no_next_action').count, 3);
	assert.ok(
		historical.scope.ignored_filters.some((entry) => entry.key === 'period'),
		'the selected period is explicitly ignored'
	);
	const period = historical.scope.ignored_filters.find(
		(entry) => entry.key === 'period'
	);
	assert.ok(period);
	assert.equal(period.value, `${HISTORICAL_FROM} to ${HISTORICAL_TO}`);
	assert.match(period.reason, /generation time|current/i);
	assert.equal(
		historical.scope.effective_filters.search,
		search,
		'effective filters stay current-state filters'
	);

	// ── Effective current-state filters, and never actor-as-owner ───────────
	const actorFiltered = await readCurrentState(
		context,
		{ search, actor: context.creator.id, outcome: 'Connected' },
		token
	);
	assert.equal(actorFiltered.workload.total, 12);
	assert.equal(risk(actorFiltered, 'overdue').count, 2);
	assert.ok(
		actorFiltered.scope.ignored_filters.some((entry) => entry.key === 'actor')
	);
	assert.ok(
		actorFiltered.scope.ignored_filters.some((entry) => entry.key === 'outcome')
	);
	assert.equal(
		workloadGroup(actorFiltered, context.creator.id).count,
		1,
		'an activity-author filter never becomes current ownership'
	);
	assert.equal(actorFiltered.scope.effective_filters.owner.value, null);

	const ownerFiltered = await readCurrentState(
		context,
		{ search, owner: context.assignee.id },
		token
	);
	assert.equal(ownerFiltered.workload.total, 9);
	assert.deepEqual(
		ownerFiltered.workload.owners.map((entry) => entry.owner.id),
		[context.assignee.id]
	);
	assert.equal(risk(ownerFiltered, 'unassigned').count, 0);
	assert.equal(risk(ownerFiltered, 'overdue').count, 2);
	assert.equal(
		ownerFiltered.scope.effective_filters.owner.label,
		context.assignee.fullName
	);

	const unassignedFiltered = await readCurrentState(
		context,
		{ search, owner: 'unassigned' },
		token
	);
	assert.equal(unassignedFiltered.workload.total, 1);
	assert.equal(risk(unassignedFiltered, 'unassigned').count, 1);
	assert.equal(unassignedFiltered.scope.effective_filters.owner.label, 'Unassigned');

	const stageFiltered = await readCurrentState(
		context,
		{ search, stage: 'Connected' },
		token
	);
	assert.equal(stageFiltered.workload.total, 3);
	assert.equal(risk(stageFiltered, 'untouched').count, 2);
	assert.equal(risk(stageFiltered, 'overdue').count, 1);
	assert.equal(risk(stageFiltered, 'due_today').count, 0);
	assert.equal(risk(stageFiltered, 'no_next_action').count, 2);
	assert.equal(stageFiltered.scope.effective_filters.stage.value, 'Connected');

	const sourceFiltered = await readCurrentState(
		context,
		{ search, source: 'Referral' },
		token
	);
	assert.equal(sourceFiltered.workload.total, 1);
	assert.equal(workloadGroup(sourceFiltered, context.creator.id).count, 1);
	assert.equal(risk(sourceFiltered, 'untouched').count, 1);
	assert.equal(sourceFiltered.scope.effective_filters.source.label, 'Referral');
	assert.equal(sourceFiltered.scope.effective_filters.source.is_unknown, false);

	const missingSource = await readCurrentState(
		context,
		{ search, source_missing: '1' },
		token
	);
	assert.equal(missingSource.workload.total, 1);
	assert.equal(
		workloadGroup(missingSource, context.assignee.id).count,
		1
	);
	assert.equal(missingSource.scope.effective_filters.source.is_unknown, true);

	// ── Risk evidence: lead queues and scheduled-work item registers ────────
	const untouchedEvidence = await readEvidence(
		context,
		{ search, group: 'risk', risk: 'untouched', page: 1, limit: 100 },
		token
	);
	assert.equal(untouchedEvidence.group.key, 'risk');
	assert.equal(untouchedEvidence.group.risk, 'untouched');
	assert.equal(untouchedEvidence.group.evidence_unit, 'lead');
	assert.equal(untouchedEvidence.pagination.total, 10);
	assert.equal(untouchedEvidence.distinct_leads_total, 10);
	assert.equal(untouchedEvidence.rows.length, 10);
	assert.ok(
		untouchedEvidence.rows.every((row) => row.kind === 'lead')
	);
	assert.ok(
		untouchedEvidence.rows.some((row) => row.lead.id === assignedConnectedNote.id),
		'a completed note alone does not remove the Lead from untouched'
	);
	assert.equal(
		untouchedEvidence.rows.some((row) => row.lead.id === assignedConnectedDone.id),
		false,
		'a completed call is outreach'
	);
	assert.equal(
		untouchedEvidence.rows.some((row) => row.lead.id === assignedQualifiedClosed.id),
		false,
		'a completed call keeps the Lead out of untouched even with closed plans'
	);
	assert.equal(
		untouchedEvidence.rows.some((row) => row.lead.id === deletedOverdue.id),
		false,
		'deleted Leads leave the operational evidence'
	);

	const unassignedEvidence = await readEvidence(
		context,
		{ search, group: 'risk', risk: 'unassigned', page: 1, limit: 100 },
		token
	);
	assert.equal(unassignedEvidence.pagination.total, 1);
	assert.equal(unassignedEvidence.rows[0]?.lead.id, unassignedNew.id);
	assert.equal(unassignedEvidence.rows[0]?.owner.id, null);
	assert.equal(unassignedEvidence.rows[0]?.owner.name, 'Unassigned');

	const noNextActionEvidence = await readEvidence(
		context,
		{ search, group: 'risk', risk: 'no_next_action', page: 1, limit: 100 },
		token
	);
	assert.equal(noNextActionEvidence.pagination.total, 3);
	assert.deepEqual(
		new Set(noNextActionEvidence.rows.map((row) => row.lead.id)),
		new Set([
			assignedConnectedDone.id,
			assignedConnectedNote.id,
			assignedQualifiedClosed.id,
		]),
		'active stages without outstanding scheduled work, cancelled and transferred work excluded'
	);
	assert.equal(
		noNextActionEvidence.rows.some((row) => row.lead.id === unassignedNew.id),
		false,
		'New does not require a next action'
	);
	assert.equal(
		noNextActionEvidence.rows.some((row) => row.lead.id === assignedDisqualifiedNone.id),
		false,
		'Disqualified does not require a next action'
	);
	assert.equal(
		noNextActionEvidence.rows.some((row) => row.lead.id === assignedConvertedNone.id),
		false,
		'Converted does not require a next action'
	);

	// Overdue evidence lists individual work items; the counter counts Leads.
	const overdueEvidence = await readEvidence(
		context,
		{ search, group: 'risk', risk: 'overdue', page: 1, limit: 100 },
		token
	);
	assert.equal(overdueEvidence.group.evidence_unit, 'scheduled_work_item');
	assert.equal(overdueEvidence.pagination.total, 3, 'three overdue work items');
	assert.equal(overdueEvidence.distinct_leads_total, 2, 'two distinct overdue Leads');
	assert.equal(risk(summary, 'overdue').count, overdueEvidence.distinct_leads_total);
	assert.ok(
		overdueEvidence.rows.every(
			(row) =>
				row.kind === 'scheduled_work_item' &&
				row.work_item?.scheduled_for === yesterday
		),
		'each row is an individual item at the overdue boundary'
	);
	assert.deepEqual(
		new Set(overdueEvidence.rows.map((row) => row.lead.id)),
		new Set([assignedQualifiedOverdue.id, assignedConnectedTwoOverdue.id])
	);
	const overdueItemIds = new Set(
		overdueEvidence.rows.map((row) => row.work_item?.id)
	);
	assert.ok(overdueItemIds.has(twoOverdueOne));
	assert.ok(overdueItemIds.has(twoOverdueTwo));
	assert.equal(
		overdueEvidence.rows.some((row) => row.lead.id === assignedQualifiedClosed.id),
		false,
		'cancelled and transferred plans are not outstanding'
	);
	assert.equal(
		overdueEvidence.rows.some((row) => row.lead.id === deletedOverdue.id),
		false,
		'deleted Leads and their work stay outside the register'
	);

	const dueTodayEvidence = await readEvidence(
		context,
		{ search, group: 'risk', risk: 'due_today', page: 1, limit: 100 },
		token
	);
	assert.equal(dueTodayEvidence.pagination.total, 1);
	assert.equal(dueTodayEvidence.distinct_leads_total, 1);
	assert.equal(dueTodayEvidence.rows[0]?.lead.id, inactiveNurtureToday.id);
	assert.equal(dueTodayEvidence.rows[0]?.work_item?.scheduled_for, today);
	assert.equal(dueTodayEvidence.rows[0]?.owner.id, inactiveOwner.id);
	assert.equal(dueTodayEvidence.rows[0]?.owner.is_inactive, true);

	// ── Workload evidence keeps the same distinct-Lead population ───────────
	const assigneeWorkload = await readEvidence(
		context,
		{ search, group: 'workload', owner: context.assignee.id, page: 1, limit: 100 },
		token
	);
	assert.equal(assigneeWorkload.group.key, 'workload');
	assert.equal(assigneeWorkload.group.evidence_unit, 'lead');
	assert.equal(assigneeWorkload.pagination.total, 9);
	assert.equal(assigneeWorkload.distinct_leads_total, 9);
	assert.equal(
		workloadGroup(summary, context.assignee.id).count,
		assigneeWorkload.pagination.total,
		'workload group counter reconciles with full evidence'
	);
	assert.ok(
		assigneeWorkload.rows.every(
			(row) => row.kind === 'lead' && row.owner.id === context.assignee.id
		)
	);
	assert.equal(
		assigneeWorkload.rows.some((row) => row.lead.id === deletedOverdue.id),
		false
	);
	const unassignedWorkload = await readEvidence(
		context,
		{ search, group: 'workload', owner: 'unassigned', page: 1, limit: 100 },
		token
	);
	assert.equal(unassignedWorkload.pagination.total, 1);
	assert.equal(unassignedWorkload.rows[0]?.lead.id, unassignedNew.id);
	assert.equal(unassignedWorkload.rows[0]?.owner.id, null);

	// ── Pagination covers the full result, not the visible page ─────────────
	const untouchedFirst = await readEvidence(
		context,
		{ search, group: 'risk', risk: 'untouched', page: 1, limit: 3 },
		token
	);
	assert.equal(untouchedFirst.rows.length, 3);
	assert.equal(untouchedFirst.pagination.total, 10);
	assert.equal(untouchedFirst.pagination.total_pages, 4);
	const untouchedLast = await readEvidence(
		context,
		{ search, group: 'risk', risk: 'untouched', page: 4, limit: 3 },
		token
	);
	assert.equal(untouchedLast.rows.length, 1);
	const untouchedBeyond = await readEvidence(
		context,
		{ search, group: 'risk', risk: 'untouched', page: 99, limit: 3 },
		token
	);
	assert.equal(untouchedBeyond.rows.length, 0);
	assert.equal(untouchedBeyond.pagination.total, 10);

	const overduePageOne = await readEvidence(
		context,
		{ search, group: 'risk', risk: 'overdue', page: 1, limit: 2 },
		token
	);
	assert.equal(overduePageOne.rows.length, 2);
	assert.equal(overduePageOne.pagination.total, 3);
	assert.equal(overduePageOne.pagination.total_pages, 2);
	assert.equal(overduePageOne.distinct_leads_total, 2);
	const overduePageTwo = await readEvidence(
		context,
		{ search, group: 'risk', risk: 'overdue', page: 2, limit: 2 },
		token
	);
	assert.equal(overduePageTwo.rows.length, 1);
	const pagedItemIds = new Set([
		...overduePageOne.rows.map((row) => row.work_item?.id),
		...overduePageTwo.rows.map((row) => row.work_item?.id),
	]);
	assert.equal(pagedItemIds.size, 3, 'each work item appears once across pages');
	assert.equal(
		new Set([
			...overduePageOne.rows.map((row) => row.lead.id),
			...overduePageTwo.rows.map((row) => row.lead.id),
		]).size,
		overduePageOne.distinct_leads_total,
		'full-result distinct Leads reconcile with the risk counter'
	);

	// ── Validation and authorization ────────────────────────────────────────
	for (const [path, code] of [
		[
			`/api/reports/lead-audit/current-state/evidence${query({
				search,
				group: 'not_a_group',
			})}`,
			'invalid_current_state_group',
		],
		[
			`/api/reports/lead-audit/current-state/evidence${query({
				search,
				group: 'risk',
				risk: 'not_a_risk',
			})}`,
			'invalid_current_state_risk',
		],
		[
			`/api/reports/lead-audit/current-state${query({
				search,
				from_date: '2026-02-30',
				to_date: '2026-03-01',
			})}`,
			'invalid_date',
		],
	] as const) {
		const response = await context.http.get(path, token);
		assert.equal(response.status, 422, `invalid request ${code} status`);
		assert.equal(ErrorEnvelopeSchema.parse(response.json()).code, code);
	}

	await expectRefused(
		context,
		'/api/reports/lead-audit/current-state',
		undefined,
		401
	);
	await expectRefused(
		context,
		'/api/reports/lead-audit/current-state/evidence',
		undefined,
		401
	);
	for (const identity of [
		context.readOnly,
		context.reportOnly,
		context.projectReportOnly,
	]) {
		await expectRefused(
			context,
			`/api/reports/lead-audit/current-state${query({ search })}`,
			identity.sessionToken,
			403
		);
		await expectRefused(
			context,
			`/api/reports/lead-audit/current-state/evidence${query({
				search,
				group: 'workload',
			})}`,
			identity.sessionToken,
			403
		);
	}
	await readCurrentState(context, { search }, context.superAdmin.sessionToken);
	await readEvidence(
		context,
		{ search, group: 'workload', page: 1, limit: 1 },
		context.superAdmin.sessionToken
	);

	// ── Report reads do not mutate Leads or their work evidence ─────────────
	const leadsAfterReads = await snapshotLeads();
	const activitiesAfterReads = await snapshotActivities();
	assert.deepEqual(leadsAfterReads, leadsBefore, 'Lead facts are unchanged');
	assert.deepEqual(
		activitiesAfterReads,
		activitiesBefore,
		'work evidence is unchanged'
	);
	const closedActivities = await context.reader.activityRows(
		assignedQualifiedClosed.id
	);
	assert.equal(closedActivities.length, 3, 'closed work evidence is retained');
	assert.ok(
		closedActivities.some(
			(activity) => activity.id === cancelled && activity.status === 'Cancelled'
		)
	);
	assert.ok(
		closedActivities.some(
			(activity) =>
				activity.id === transferredActivity &&
				activity.transferred_followup_id === transferred.followupId
		),
		'the transferred work keeps its Proposal reference'
	);
	assert.ok(
		closedActivities.some(
			(activity) => activity.id === closedCall && activity.status === 'Completed'
		)
	);
	assert.ok(completedCall > 0 && noteOnly > 0 && deletedOverdueActivity > 0);

	// ── Reassignment changes current workload, not activity authorship ──────
	await context.reader.fixtureWrite(
		'UPDATE leads SET owner_user_id = ? WHERE id = ?',
		[context.assignee.id, creatorOwnedUntouched.id]
	);
	await context.reader.fixtureWrite(
		'UPDATE leads SET owner_user_id = ? WHERE id = ?',
		[inactiveOwner.id, unassignedNew.id]
	);
	const leadsAfterReassignment = await snapshotLeads();
	const activitiesAfterReassignment = await snapshotActivities();
	const reassigned = await readCurrentState(context, { search }, token);
	assert.equal(reassigned.workload.total, 12);
	assert.equal(workloadGroup(reassigned, context.assignee.id).count, 10);
	assert.equal(workloadGroup(reassigned, inactiveOwner.id).count, 2);
	assert.equal(
		reassigned.workload.owners.some(
			(entry) => entry.owner.id === context.creator.id
		),
		false,
		'the prior owner leaves the workload when no Lead remains assigned'
	);
	assert.equal(
		reassigned.workload.owners.some((entry) => entry.owner.id === null),
		false,
		'the reassigned intake Lead leaves the unassigned workload'
	);
	assert.equal(risk(reassigned, 'unassigned').count, 0);
	assert.equal(risk(reassigned, 'untouched').count, 10, 'reassignment is not new outreach');
	assert.equal(risk(reassigned, 'overdue').count, 2);
	assert.equal(risk(reassigned, 'due_today').count, 1);
	assert.equal(risk(reassigned, 'no_next_action').count, 3);
	const inactiveWorkload = await readEvidence(
		context,
		{ search, group: 'workload', owner: inactiveOwner.id, page: 1, limit: 100 },
		token
	);
	assert.equal(inactiveWorkload.pagination.total, 2);
	assert.equal(inactiveWorkload.rows[0]?.owner.is_inactive, true);
	assert.equal(
		inactiveWorkload.rows.some((row) => row.lead.id === unassignedNew.id),
		true
	);

	const leadsAfterReassignedRead = await snapshotLeads();
	const activitiesAfterReassignedRead = await snapshotActivities();
	assert.deepEqual(
		leadsAfterReassignedRead,
		leadsAfterReassignment,
		'report reads never mutate ownership'
	);
	assert.deepEqual(
		activitiesAfterReassignedRead,
		activitiesAfterReassignment,
		'report reads never mutate activity evidence'
	);
}
