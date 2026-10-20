import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';
import type { LifecycleSeeds } from './activities.ts';

/**
 * The explicit lifecycle decisions of ticket #373: Qualify, Nurture,
 * Disqualify, and Reopen. Every scenario asserts the HTTP response and the
 * persisted rows through the independent reader.
 *
 * The scenarios share the request budget of the real rate limiter across
 * the fixture sessions: the application allows every session 120 API
 * requests a minute (ADR-0013), so the write-heavy scenarios use the
 * assignee and the editor, and the read-back requests use the read-only
 * session.
 */

const EnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.unknown(),
});

const ErrorEnvelopeSchema = z.object({
	success: z.literal(false),
	error: z.string(),
	code: z.string().optional(),
});

const LifecycleEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		stage: z.string(),
		next_action_date: z.string().nullable(),
		owner_user_id: z.number().nullable(),
	}),
});

const LeadDetailEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		id: z.number(),
		enquiry_status: z.string().nullable(),
		owner_user_id: z.number().nullable(),
		owner_name: z.string().nullable(),
		follow_up_date: z.string().nullable(),
		next_action_date: z.string().nullable(),
	}),
});

const TimelineEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		entries: z.array(
			z.object({
				key: z.string(),
				kind: z.string(),
				title: z.string(),
				detail: z.string().nullable(),
				actor_name: z.string().nullable(),
			})
		),
	}),
});

/** A date the scheduled work can carry; the stage rules never look at today. */
function futureDate(daysAhead: number): string {
	const date = new Date();
	date.setDate(date.getDate() + daysAhead);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface LeadFixture {
	company_name: string;
	contact_name?: string | null;
	contact_email?: string | null;
	phone?: string | null;
	project_description?: string | null;
	owner_user_id?: number | null;
}

/**
 * One Lead with the given facts. The facts are what a qualification reads,
 * so a Lead without them is created without them.
 */
async function createLead(
	context: ScenarioContext,
	fixture: LeadFixture,
	sessionToken: string
): Promise<number> {
	const body: Record<string, unknown> = {
		company_name: fixture.company_name,
		contact_name: fixture.contact_name ?? null,
		contact_email: fixture.contact_email ?? null,
		phone: fixture.phone ?? null,
		project_description: fixture.project_description ?? null,
	};
	if (Object.hasOwn(fixture, 'owner_user_id')) {
		body.owner_user_id = fixture.owner_user_id;
	}
	const response = await context.http.post('/api/leads', body, sessionToken);
	assert.equal(response.status, 200, `create status (body: ${response.text})`);
	const id = z
		.object({ id: z.number() })
		.parse(EnvelopeSchema.parse(response.json()).data).id;
	context.trackLead(id);
	return id;
}

/** The stored Lead, read straight from the database. */
async function readLeadRow(context: ScenarioContext, leadId: number) {
	const row = await context.reader.leadRow(leadId);
	assert.ok(row, `the lead ${leadId} is stored`);
	return row;
}

/** The Lead over HTTP, read with the read-only session. */
async function readLeadOverHttp(context: ScenarioContext, leadId: number) {
	const response = await context.http.get(
		`/api/leads/${leadId}`,
		context.readOnly.sessionToken
	);
	assert.equal(response.status, 200, `detail status (body: ${response.text})`);
	return LeadDetailEnvelopeSchema.parse(response.json()).data;
}

async function decide(
	context: ScenarioContext,
	leadId: number,
	body: Record<string, unknown>,
	sessionToken: string
) {
	return context.http.post(`/api/leads/${leadId}/stage`, body, sessionToken);
}

/**
 * Every missing qualification fact is refused with its own code, so the
 * interface can point at the field that is missing. Nothing is written.
 */
export async function qualificationMissingFieldsScenario(
	context: ScenarioContext
): Promise<void> {
	const cases: Array<{
		company: string;
		fixture: LeadFixture;
		code: string;
	}> = [
		{
			company: `${context.runTag} No Contact Co`,
			fixture: {
				company_name: `${context.runTag} No Contact Co`,
				contact_name: null,
				contact_email: 'cleo@example.com',
				project_description: 'A plant extension',
			},
			code: 'contact_name_required',
		},
		{
			company: `${context.runTag} No Details Co`,
			fixture: {
				company_name: `${context.runTag} No Details Co`,
				contact_name: 'Cleo Client',
				contact_email: null,
				phone: null,
				project_description: 'A plant extension',
			},
			code: 'contact_details_required',
		},
		{
			company: `${context.runTag} No Need Co`,
			fixture: {
				company_name: `${context.runTag} No Need Co`,
				contact_name: 'Cleo Client',
				contact_email: 'cleo@example.com',
				project_description: null,
			},
			code: 'project_need_required',
		},
	];

	for (const entry of cases) {
		const leadId = await createLead(
			context,
			entry.fixture,
			context.assignee.sessionToken
		);
		const response = await decide(
			context,
			leadId,
			{
				action: 'Qualify',
				next_action: { scheduled_for: futureDate(4) },
			},
			context.assignee.sessionToken
		);
		assert.equal(
			response.status,
			422,
			`${entry.code} status (body: ${response.text})`
		);
		assert.equal(
			ErrorEnvelopeSchema.parse(response.json()).code,
			entry.code,
			'the refusal names the missing field'
		);
		assert.equal(
			(await context.reader.stageHistory(leadId)).length,
			0,
			'a refused decision writes no stage history'
		);
		const row = await readLeadRow(context, leadId);
		assert.equal(
			row.enquiry_status,
			'New',
			'a refused decision leaves the stage alone'
		);
		assert.equal(row.follow_up_date, null);
	}
}

/**
 * A qualified Lead has a named contact, a usable phone number or email
 * address, and a clear project need. Budget and timing are not Lead
 * fields, so a Lead without them qualifies.
 */
export async function qualificationWithoutBudgetOrTimingScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		{
			company_name: `${context.runTag} Qualified Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
		},
		context.noAssign.sessionToken
	);

	const response = await decide(
		context,
		leadId,
		{
			action: 'Qualify',
			next_action: {
				scheduled_for: futureDate(3),
				next_action: 'Send the proposal',
			},
		},
		context.noAssign.sessionToken
	);
	assert.equal(response.status, 200, `qualify body: ${response.text}`);
	const body = LifecycleEnvelopeSchema.parse(response.json()).data;
	assert.equal(body.stage, 'Qualified');
	assert.equal(body.next_action_date, futureDate(3));
	assert.equal(body.owner_user_id, context.noAssign.id);

	const lead = await readLeadOverHttp(context, leadId);
	assert.equal(lead.enquiry_status, 'Qualified');
	assert.equal(lead.owner_user_id, context.noAssign.id);
	assert.equal(lead.follow_up_date, futureDate(3));

	const history = await context.reader.stageHistory(leadId);
	assert.equal(history.length, 1, 'the decision writes one stage history row');
	assert.equal(history[0]?.from_stage, 'New');
	assert.equal(history[0]?.to_stage, 'Qualified');
	assert.equal(
		history[0]?.change_source,
		'explicit',
		'an explicit decision is never an automatic one'
	);
	assert.equal(history[0]?.actor_user_id, context.noAssign.id);

	const rows = await context.reader.activityRows(leadId);
	const scheduled = rows.filter((row) => row.status === 'Scheduled');
	assert.equal(scheduled.length, 1, 'the next action is real scheduled work');
	assert.equal(scheduled[0]?.scheduled_for, futureDate(3));
	assert.equal(scheduled[0]?.next_action, 'Send the proposal');
	assert.equal(scheduled[0]?.created_by, context.noAssign.id);
}

/**
 * Nurture means suitable but not ready now. It needs a dated next action.
 */
export async function nurtureWithNextActionScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		{
			company_name: `${context.runTag} Nurture Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
		},
		context.assignee.sessionToken
	);

	const response = await decide(
		context,
		leadId,
		{
			action: 'Nurture',
			next_action: {
				scheduled_for: futureDate(9),
				next_action: 'Call back after the budget review',
			},
		},
		context.assignee.sessionToken
	);
	assert.equal(response.status, 200, `nurture body: ${response.text}`);
	const body = LifecycleEnvelopeSchema.parse(response.json()).data;
	assert.equal(body.stage, 'Nurture');
	assert.equal(body.next_action_date, futureDate(9));

	const row = await readLeadRow(context, leadId);
	assert.equal(row.enquiry_status, 'Nurture');
	assert.equal(row.follow_up_date, futureDate(9));

	const history = await context.reader.stageHistory(leadId);
	assert.equal(history.length, 1);
	assert.equal(history[0]?.to_stage, 'Nurture');
	assert.equal(history[0]?.change_source, 'explicit');
}

/**
 * Nurture without a dated next action is refused: an active Lead needs
 * real work. Nothing is written.
 */
export async function nurtureWithoutNextActionScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		{
			company_name: `${context.runTag} Undated Nurture Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
		},
		context.noAssign.sessionToken
	);

	const response = await decide(
		context,
		leadId,
		{ action: 'Nurture' },
		context.noAssign.sessionToken
	);
	assert.equal(response.status, 409, `nurture body: ${response.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(response.json()).code,
		'next_action_required'
	);
	assert.equal((await context.reader.stageHistory(leadId)).length, 0);
	const row = await readLeadRow(context, leadId);
	assert.equal(row.enquiry_status, 'New');
	assert.equal(row.follow_up_date, null);
}

/**
 * A disqualification needs a reason. The refusal writes nothing.
 */
export async function disqualifyWithoutReasonScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		{
			company_name: `${context.runTag} No Reason Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
		},
		context.assignee.sessionToken
	);

	const response = await decide(
		context,
		leadId,
		{ action: 'Disqualify' },
		context.assignee.sessionToken
	);
	assert.equal(response.status, 422, `disqualify body: ${response.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(response.json()).code,
		'reason_required'
	);
	assert.equal((await context.reader.stageHistory(leadId)).length, 0);
	const row = await readLeadRow(context, leadId);
	assert.equal(row.enquiry_status, 'New');
}

/**
 * A disqualification closes the Lead: the outstanding work is cancelled
 * explicitly, the evidence stays, and the reason is kept in the stage
 * history. The Lead leaves the active work queue.
 */
export async function disqualifyCancelsOutstandingWorkScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		{
			company_name: `${context.runTag} Disqualified Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
		},
		context.noAssign.sessionToken
	);

	const logged = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'No Answer',
			notes: 'Nobody answered.',
			next_action: {
				activity_type: 'Call',
				scheduled_for: futureDate(2),
				next_action: 'Call back',
			},
		},
		context.noAssign.sessionToken
	);
	assert.equal(logged.status, 200, `call body: ${logged.text}`);

	const before = await context.reader.activityRows(leadId);
	const scheduledBefore = before.filter((row) => row.status === 'Scheduled');
	assert.equal(scheduledBefore.length, 1, 'the next action is a scheduled row');
	const scheduledId = scheduledBefore[0]?.id;

	const response = await decide(
		context,
		leadId,
		{
			action: 'Disqualify',
			reason: 'The budget was withdrawn by the client.',
		},
		context.noAssign.sessionToken
	);
	assert.equal(response.status, 200, `disqualify body: ${response.text}`);
	const body = LifecycleEnvelopeSchema.parse(response.json()).data;
	assert.equal(body.stage, 'Disqualified');
	assert.equal(
		body.next_action_date,
		null,
		'a disqualified lead has no dated next action'
	);

	const rows = await context.reader.activityRows(leadId);
	const scheduled = rows.find((row) => row.id === scheduledId);
	assert.ok(scheduled, 'the scheduled row is still there');
	assert.equal(
		scheduled.status,
		'Cancelled',
		'the outstanding work is cancelled, never deleted'
	);
	assert.equal(
		rows.filter((row) => row.status === 'Completed').length,
		1,
		'the recorded call stays'
	);

	const row = await readLeadRow(context, leadId);
	assert.equal(row.enquiry_status, 'Disqualified');
	assert.equal(row.follow_up_date, null);

	const history = await context.reader.stageHistory(leadId);
	const disqualification = history.find(
		(entry) => entry.to_stage === 'Disqualified'
	);
	assert.ok(disqualification, 'the disqualification is recorded');
	assert.equal(disqualification.change_source, 'explicit');
	assert.equal(
		disqualification.reason,
		'The budget was withdrawn by the client.',
		'the reason of the decision is kept'
	);
	assert.equal(disqualification.actor_user_id, context.noAssign.id);

	const work = await context.http.get(
		'/api/leads/work?scope=upcoming&limit=50',
		context.readOnly.sessionToken
	);
	assert.equal(work.status, 200, `work body: ${work.text}`);
	const workItems = z
		.object({
			success: z.literal(true),
			data: z.object({
				work: z.array(z.object({ lead_id: z.number() })),
			}),
		})
		.parse(work.json()).data.work;
	assert.equal(
		workItems.filter((item) => item.lead_id === leadId).length,
		0,
		'a disqualified lead leaves the active work queue'
	);
}

/**
 * A reopened Lead needs a reason, an owner, and a dated next action. The
 * earlier disqualification stays visible in the timeline.
 */
export async function reopenWithRequiredFieldsScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		{
			company_name: `${context.runTag} Reopened Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
		},
		context.assignee.sessionToken
	);

	const disqualified = await decide(
		context,
		leadId,
		{
			action: 'Disqualify',
			reason: 'The budget was withdrawn by the client.',
		},
		context.assignee.sessionToken
	);
	assert.equal(
		disqualified.status,
		200,
		`disqualify body: ${disqualified.text}`
	);

	const reopened = await decide(
		context,
		leadId,
		{
			action: 'Reopen',
			reason: 'The client came back with the budget approved.',
			owner_user_id: context.creator.id,
			next_action: {
				scheduled_for: futureDate(5),
				next_action: 'Book the site visit',
			},
		},
		context.assignee.sessionToken
	);
	assert.equal(reopened.status, 200, `reopen body: ${reopened.text}`);
	const body = LifecycleEnvelopeSchema.parse(reopened.json()).data;
	assert.equal(body.stage, 'Attempting Contact');
	assert.equal(body.next_action_date, futureDate(5));
	assert.equal(body.owner_user_id, context.creator.id);

	const lead = await readLeadOverHttp(context, leadId);
	assert.equal(lead.enquiry_status, 'Attempting Contact');
	assert.equal(lead.owner_user_id, context.creator.id);
	assert.equal(lead.owner_name, context.creator.fullName);
	assert.equal(lead.next_action_date, futureDate(5));

	const history = await context.reader.stageHistory(leadId);
	assert.equal(history.length, 2, 'both decisions stay in the history');
	assert.equal(history[0]?.from_stage, 'New');
	assert.equal(history[0]?.to_stage, 'Disqualified');
	assert.equal(history[1]?.from_stage, 'Disqualified');
	assert.equal(history[1]?.to_stage, 'Attempting Contact');
	assert.equal(history[1]?.change_source, 'explicit');
	assert.equal(
		history[1]?.reason,
		'The client came back with the budget approved.'
	);

	const ownership = await context.reader.ownershipHistory(leadId);
	assert.equal(
		ownership.length,
		2,
		'the owner of the reopened lead is recorded'
	);
	assert.equal(ownership[1]?.prior_owner_user_id, context.assignee.id);
	assert.equal(ownership[1]?.owner_user_id, context.creator.id);
	assert.equal(ownership[1]?.actor_user_id, context.assignee.id);

	const timeline = await context.http.get(
		`/api/leads/${leadId}/timeline`,
		context.readOnly.sessionToken
	);
	assert.equal(timeline.status, 200, `timeline body: ${timeline.text}`);
	const entries = TimelineEnvelopeSchema.parse(timeline.json()).data.entries;
	const stageChanges = entries.filter((entry) => entry.kind === 'stage_change');
	assert.equal(stageChanges.length, 2, 'both decisions are on the timeline');
	assert.equal(
		stageChanges.some((entry) => entry.title.includes('Disqualified')),
		true,
		'the earlier disqualification stays visible'
	);
	assert.equal(
		stageChanges.some((entry) =>
			entry.detail?.includes('budget was withdrawn')
		),
		true,
		'the reason of the disqualification stays visible'
	);
}

/**
 * A reopening without its required fields is refused, one field at a time.
 * Nothing is written.
 */
export async function reopenMissingFieldsScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		{
			company_name: `${context.runTag} Reopen Refused Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
		},
		context.assignee.sessionToken
	);
	const disqualified = await decide(
		context,
		leadId,
		{
			action: 'Disqualify',
			reason: 'The budget was withdrawn by the client.',
		},
		context.assignee.sessionToken
	);
	assert.equal(
		disqualified.status,
		200,
		`disqualify body: ${disqualified.text}`
	);

	const withoutReason = await decide(
		context,
		leadId,
		{ action: 'Reopen' },
		context.assignee.sessionToken
	);
	assert.equal(withoutReason.status, 422, `reopen body: ${withoutReason.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(withoutReason.json()).code,
		'reason_required'
	);

	const withoutNextAction = await decide(
		context,
		leadId,
		{
			action: 'Reopen',
			reason: 'The client came back.',
		},
		context.assignee.sessionToken
	);
	assert.equal(
		withoutNextAction.status,
		409,
		`reopen body: ${withoutNextAction.text}`
	);
	assert.equal(
		ErrorEnvelopeSchema.parse(withoutNextAction.json()).code,
		'next_action_required'
	);

	assert.equal(
		(await context.reader.stageHistory(leadId)).length,
		1,
		'a refused reopening writes no stage history'
	);
	const row = await readLeadRow(context, leadId);
	assert.equal(
		row.enquiry_status,
		'Disqualified',
		'a refused reopening leaves the lead closed'
	);

	// A Lead without an owner cannot be reopened either.
	const unownedId = await createLead(
		context,
		{
			company_name: `${context.runTag} Unowned Reopen Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
			owner_user_id: null,
		},
		context.assignee.sessionToken
	);
	const unownedDisqualified = await decide(
		context,
		unownedId,
		{
			action: 'Disqualify',
			reason: 'The budget was withdrawn by the client.',
		},
		context.assignee.sessionToken
	);
	assert.equal(
		unownedDisqualified.status,
		200,
		`disqualify body: ${unownedDisqualified.text}`
	);
	const withoutOwner = await decide(
		context,
		unownedId,
		{
			action: 'Reopen',
			reason: 'The client came back.',
			next_action: { scheduled_for: futureDate(5) },
		},
		context.assignee.sessionToken
	);
	assert.equal(withoutOwner.status, 409, `reopen body: ${withoutOwner.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(withoutOwner.json()).code,
		'owner_required'
	);
}

/**
 * A converted Lead never takes a lifecycle decision: its routine sales work
 * belongs to the linked Proposal.
 */
export async function convertedLeadTakesNoDecisionScenario(
	context: ScenarioContext,
	seeds: LifecycleSeeds
): Promise<void> {
	const leadId = seeds.convertedLeadId;
	assert.ok(leadId > 0, 'the converted lead is seeded');

	for (const action of ['Qualify', 'Nurture', 'Disqualify', 'Reopen']) {
		const response = await decide(
			context,
			leadId,
			{ action },
			context.noAssign.sessionToken
		);
		assert.equal(response.status, 409, `${action} body: ${response.text}`);
		assert.equal(
			ErrorEnvelopeSchema.parse(response.json()).code,
			'lead_converted',
			'a converted lead takes no lifecycle decision'
		);
	}
	assert.equal(
		(await context.reader.stageHistory(leadId)).length,
		0,
		'a refused decision writes no stage history'
	);
	const row = await readLeadRow(context, leadId);
	assert.equal(row.enquiry_status, 'Converted');
}

/**
 * Generic edits and imports cannot express the lifecycle decisions: the
 * conversion and the disqualification arrive through their audited actions
 * only.
 */
export async function genericPathsCannotDecideTheLifecycleScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		{
			company_name: `${context.runTag} Generic Edit Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
		},
		context.assignee.sessionToken
	);

	const disqualified = await context.http.put(
		`/api/leads/${leadId}`,
		{ enquiry_status: 'Disqualified' },
		context.assignee.sessionToken
	);
	assert.equal(
		disqualified.status,
		409,
		`generic disqualification body: ${disqualified.text}`
	);
	assert.equal(
		ErrorEnvelopeSchema.parse(disqualified.json()).code,
		'transition_unavailable'
	);

	const converted = await context.http.put(
		`/api/leads/${leadId}`,
		{ enquiry_status: 'Converted' },
		context.assignee.sessionToken
	);
	assert.equal(
		converted.status,
		409,
		`generic conversion body: ${converted.text}`
	);
	assert.equal(
		ErrorEnvelopeSchema.parse(converted.json()).code,
		'conversion_unavailable'
	);

	const row = await readLeadRow(context, leadId);
	assert.equal(row.enquiry_status, 'New');

	// The import refuses the same two stages, row by row.
	const csv = [
		'Company,Status',
		`${context.runTag} Import Disqualified Co,Disqualified`,
		`${context.runTag} Import Converted Co,Converted`,
	].join('\n');
	const form = new FormData();
	form.append(
		'file',
		new File([csv], `${context.runTag}-lifecycle.csv`, {
			type: 'text/csv',
		})
	);
	const imported = await context.http.post(
		'/api/leads/import',
		form,
		context.assignee.sessionToken
	);
	assert.equal(imported.status, 400, `import body: ${imported.text}`);
	const importBody = z
		.object({
			success: z.literal(false),
			error: z.string(),
			errors: z.array(z.string()).nullable(),
		})
		.parse(imported.json());
	const rowErrors = importBody.errors ?? [];
	assert.equal(
		rowErrors.length,
		2,
		'both rows are refused: ' + rowErrors.join(' | ')
	);
	assert.match(
		rowErrors.join(' | '),
		/Disqualification arrives through an audited decision/
	);
	assert.match(
		rowErrors.join(' | '),
		/Conversion arrives through the linked Proposal handoff/
	);
	assert.equal(
		await context.reader.countLeadsByCompany(
			`${context.runTag} Import Disqualified Co`
		),
		0,
		'a refused row saves no lead'
	);
	assert.equal(
		await context.reader.countLeadsByCompany(
			`${context.runTag} Import Converted Co`
		),
		0,
		'a refused row saves no lead'
	);
}

/**
 * A user without the Lead update right decides nothing. The refusal writes
 * nothing.
 */
export async function lifecycleUnauthorizedScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		{
			company_name: `${context.runTag} Unauthorized Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
		},
		context.assignee.sessionToken
	);

	const denied = await decide(
		context,
		leadId,
		{
			action: 'Qualify',
			next_action: { scheduled_for: futureDate(4) },
		},
		context.readOnly.sessionToken
	);
	assert.equal(denied.status, 403, `denied body: ${denied.text}`);
	assert.equal((await context.reader.stageHistory(leadId)).length, 0);
	const row = await readLeadRow(context, leadId);
	assert.equal(row.enquiry_status, 'New');
	assert.equal(row.follow_up_date, null);

	const anonymous = await context.http.post(`/api/leads/${leadId}/stage`, {
		action: 'Qualify',
	});
	assert.equal(anonymous.status, 401, `anonymous body: ${anonymous.text}`);
	assert.equal((await context.reader.stageHistory(leadId)).length, 0);
}
