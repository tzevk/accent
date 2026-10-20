import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';

/**
 * The Leads the runner seeds directly: a disqualified and a converted Lead
 * are states the Lead API cannot create yet, and the workflow must leave
 * both alone.
 */
export interface LifecycleSeeds {
	disqualifiedLeadId: number;
	convertedLeadId: number;
}

const EnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.unknown(),
});

const ErrorEnvelopeSchema = z.object({
	success: z.literal(false),
	error: z.string(),
	code: z.string().optional(),
});

const ActivityEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		activity_id: z.number(),
		stage: z.string().nullable(),
		next_action_date: z.string().nullable(),
	}),
});

const TaskEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		task_id: z.number(),
		next_action_date: z.string().nullable(),
	}),
});

const TaskUpdateEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		task_id: z.number(),
		status: z.string(),
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
				occurred_at: z.string().nullable(),
				recorded_at: z.string().nullable(),
				title: z.string(),
				detail: z.string().nullable(),
				actor_name: z.string().nullable(),
				status: z.string().nullable(),
				activity_type: z.string().nullable(),
				call_outcome: z.string().nullable(),
				legacy: z.boolean(),
			})
		),
	}),
});

const WorkEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		work: z.array(
			z.object({
				id: z.number(),
				lead_id: z.number(),
				company_name: z.string().nullable(),
				activity_type: z.string().nullable(),
				scheduled_for: z.string().nullable(),
				next_action: z.string().nullable(),
				status: z.string().nullable(),
			})
		),
	}),
});

const LeadDetailEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		id: z.number(),
		enquiry_status: z.string().nullable(),
		owner_user_id: z.number().nullable(),
		follow_up_date: z.string().nullable(),
		last_contact_at: z.string().nullable(),
		latest_activity_at: z.string().nullable(),
		latest_activity_outcome: z.string().nullable(),
		next_action_date: z.string().nullable(),
		next_action_type: z.string().nullable(),
		activity_count: z.number(),
	}),
});

/** A date the scheduled work can carry; the stage rules never look at today. */
function futureDate(daysAhead: number): string {
	const date = new Date();
	date.setDate(date.getDate() + daysAhead);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function createLead(
	context: ScenarioContext,
	companyName: string,
	options: { owner?: 'creator' | 'none' } = {}
): Promise<number> {
	const body: Record<string, unknown> = {
		company_name: companyName,
		contact_name: 'Activity Contact',
		contact_email: 'activity@example.com',
		project_description: `${context.runTag} activity need`,
	};
	if (options.owner === 'none') body.owner_user_id = null;
	const response = await context.http.post(
		'/api/leads',
		body,
		context.creator.sessionToken
	);
	assert.equal(response.status, 200, `create status (body: ${response.text})`);
	const id = z
		.object({ id: z.number() })
		.parse(EnvelopeSchema.parse(response.json()).data).id;
	context.trackLead(id);
	return id;
}

async function readLead(context: ScenarioContext, leadId: number) {
	const response = await context.http.get(
		`/api/leads/${leadId}`,
		context.creator.sessionToken
	);
	assert.equal(response.status, 200, `detail status (body: ${response.text})`);
	return LeadDetailEnvelopeSchema.parse(response.json()).data;
}

/**
 * No Answer, then Connected: the first outreach moves the Lead to Attempting
 * Contact, a connected call moves it to Connected, and only the connected
 * call counts as a successful contact.
 */
export async function outreachOutcomesScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(context, `${context.runTag} Outreach Co`);

	const noAnswer = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'No Answer',
			notes: 'First call, nobody answered.',
			next_action: {
				activity_type: 'Call',
				scheduled_for: futureDate(3),
				next_action: 'Call back',
			},
		},
		context.creator.sessionToken
	);
	assert.equal(noAnswer.status, 200, `no answer body: ${noAnswer.text}`);
	const noAnswerBody = ActivityEnvelopeSchema.parse(noAnswer.json()).data;
	assert.equal(noAnswerBody.stage, 'Attempting Contact');
	assert.equal(noAnswerBody.next_action_date, futureDate(3));

	const afterNoAnswer = await readLead(context, leadId);
	assert.equal(afterNoAnswer.enquiry_status, 'Attempting Contact');
	assert.equal(
		afterNoAnswer.last_contact_at,
		null,
		'a failed attempt is not a successful contact'
	);
	assert.equal(afterNoAnswer.latest_activity_outcome, 'No Answer');
	assert.equal(afterNoAnswer.next_action_date, futureDate(3));

	const connected = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'Connected',
			notes: 'Spoke to the site manager.',
			next_action: {
				activity_type: 'Email',
				scheduled_for: futureDate(5),
				next_action: 'Send the drawings',
			},
		},
		context.creator.sessionToken
	);
	assert.equal(connected.status, 200, `connected body: ${connected.text}`);
	const connectedBody = ActivityEnvelopeSchema.parse(connected.json()).data;
	assert.equal(connectedBody.stage, 'Connected');
	assert.equal(
		connectedBody.next_action_date,
		futureDate(3),
		'the next action date is the earliest outstanding one'
	);

	const afterConnected = await readLead(context, leadId);
	assert.equal(afterConnected.enquiry_status, 'Connected');
	assert.ok(
		afterConnected.last_contact_at,
		'a connected call is a successful contact'
	);
	assert.equal(afterConnected.latest_activity_outcome, 'Connected');
	assert.equal(afterConnected.activity_count, 2);
	assert.equal(afterConnected.next_action_date, futureDate(3));

	const rows = await context.reader.activityRows(leadId);
	const completed = rows.filter((row) => row.status === 'Completed');
	const scheduled = rows.filter((row) => row.status === 'Scheduled');
	assert.equal(completed.length, 2, 'both calls are persisted');
	assert.equal(scheduled.length, 2, 'both next actions are persisted');
	assert.deepEqual(
		completed.map((row) => row.call_outcome),
		['No Answer', 'Connected']
	);
	assert.deepEqual(
		completed.map((row) => row.created_by),
		[context.creator.id, context.creator.id],
		'the authenticated author is persisted'
	);
	assert.ok(
		completed.every((row) => row.occurred_at !== null),
		'the occurrence time is persisted'
	);
	assert.ok(
		completed.every((row) => row.recorded_at !== null),
		'the recording time is persisted'
	);
	assert.deepEqual(
		scheduled.map((row) => row.scheduled_for),
		[futureDate(3), futureDate(5)]
	);

	const history = await context.reader.stageHistory(leadId);
	assert.deepEqual(
		history.map((row) => [row.from_stage, row.to_stage, row.change_source]),
		[
			['New', 'Attempting Contact', 'automatic'],
			['Attempting Contact', 'Connected', 'automatic'],
		],
		'every automatic stage change is recorded'
	);

	const leadRow = await context.reader.leadRow(leadId);
	assert.equal(leadRow?.enquiry_status, 'Connected');
	assert.equal(
		leadRow?.follow_up_date,
		futureDate(3),
		'the Lead mirrors its earliest outstanding next action'
	);
}

/**
 * A sent email is an attempt, a confirmed reply is contact. The two are
 * different columns and they move the Lead differently.
 */
export async function emailReplyVersusSentScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(context, `${context.runTag} Email Co`);

	const sent = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Email',
			notes: 'Sent the brochure.',
			next_action: {
				scheduled_for: futureDate(2),
				next_action: 'Follow up on the brochure',
			},
		},
		context.creator.sessionToken
	);
	assert.equal(sent.status, 200, `sent email body: ${sent.text}`);
	assert.equal(
		ActivityEnvelopeSchema.parse(sent.json()).data.stage,
		'Attempting Contact'
	);

	const afterSent = await readLead(context, leadId);
	assert.equal(afterSent.enquiry_status, 'Attempting Contact');
	assert.equal(
		afterSent.last_contact_at,
		null,
		'a sent email is not a confirmed reply'
	);

	const replied = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Email',
			reply_confirmed: true,
			notes: 'The client answered with the drawings.',
			next_action: {
				scheduled_for: futureDate(7),
				next_action: 'Book the site visit',
			},
		},
		context.creator.sessionToken
	);
	assert.equal(replied.status, 200, `replied email body: ${replied.text}`);
	assert.equal(
		ActivityEnvelopeSchema.parse(replied.json()).data.stage,
		'Connected'
	);

	const afterReply = await readLead(context, leadId);
	assert.equal(afterReply.enquiry_status, 'Connected');
	assert.ok(
		afterReply.last_contact_at,
		'a confirmed reply is a successful contact'
	);

	const rows = await context.reader.activityRows(leadId);
	const emails = rows.filter((row) => row.activity_type === 'Email');
	assert.equal(emails.length, 2);
	assert.equal(
		emails[0]?.reply_confirmed,
		null,
		'an unstated reply stays unknown'
	);
	assert.equal(emails[1]?.reply_confirmed, 1);
	assert.equal(
		emails[0]?.call_outcome,
		null,
		'an email carries no call outcome'
	);
}

/**
 * A note is not outreach: it never moves the stage and it never needs a
 * dated next action.
 */
export async function noteOnlyLoggingScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(context, `${context.runTag} Note Co`);

	const note = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Note',
			notes: 'The enquiry mentions a plant extension.',
		},
		context.creator.sessionToken
	);
	assert.equal(note.status, 200, `note body: ${note.text}`);
	const body = ActivityEnvelopeSchema.parse(note.json()).data;
	assert.equal(body.stage, 'New', 'a note never moves the stage');
	assert.equal(body.next_action_date, null);

	const lead = await readLead(context, leadId);
	assert.equal(lead.enquiry_status, 'New');
	assert.equal(lead.last_contact_at, null);
	assert.equal(lead.activity_count, 1);

	const rows = await context.reader.activityRows(leadId);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.activity_type, 'Note');
	assert.equal(rows[0]?.status, 'Completed');
	assert.equal(rows[0]?.notes, 'The enquiry mentions a plant extension.');
	assert.equal(rows[0]?.created_by, context.creator.id);

	const history = await context.reader.stageHistory(leadId);
	assert.equal(history.length, 0, 'a note writes no stage history');
}

/**
 * The refusals: outreach needs an owner, and an active Lead needs a dated
 * next action. A refused write persists nothing.
 */
export async function ownerAndDateRefusalScenario(
	context: ScenarioContext
): Promise<void> {
	const unownedId = await createLead(context, `${context.runTag} Unowned Co`, {
		owner: 'none',
	});

	const withoutOwner = await context.http.post(
		`/api/leads/${unownedId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'No Answer',
			next_action: { scheduled_for: futureDate(1) },
		},
		context.creator.sessionToken
	);
	assert.equal(
		withoutOwner.status,
		409,
		`outreach without an owner body: ${withoutOwner.text}`
	);
	assert.equal(
		ErrorEnvelopeSchema.parse(withoutOwner.json()).code,
		'owner_required'
	);
	assert.equal(
		(await context.reader.activityRows(unownedId)).length,
		0,
		'a refused write persists nothing'
	);

	const ownedId = await createLead(context, `${context.runTag} Dated Co`);

	const withoutDate = await context.http.post(
		`/api/leads/${ownedId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'No Answer',
		},
		context.creator.sessionToken
	);
	assert.equal(
		withoutDate.status,
		409,
		`first outreach without a next action body: ${withoutDate.text}`
	);
	assert.equal(
		ErrorEnvelopeSchema.parse(withoutDate.json()).code,
		'next_action_required'
	);
	assert.equal(
		(await context.reader.activityRows(ownedId)).length,
		0,
		'a refused write persists nothing'
	);
	assert.equal(
		(await context.reader.stageHistory(ownedId)).length,
		0,
		'a refused write writes no stage history'
	);
	const afterRefusal = await readLead(context, ownedId);
	assert.equal(afterRefusal.enquiry_status, 'New');

	// A read-only user may not record activity at all.
	const denied = await context.http.post(
		`/api/leads/${ownedId}/activities`,
		{ activity_type: 'Note', notes: 'Not allowed.' },
		context.readOnly.sessionToken
	);
	assert.equal(denied.status, 403, `denied body: ${denied.text}`);
	assert.equal(
		(await context.reader.activityRows(ownedId)).length,
		0,
		'a denied write persists nothing'
	);
}

/**
 * Closing the last outstanding task of an active Lead needs its
 * replacement in the same request.
 */
export async function lastOpenTaskCloseScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(context, `${context.runTag} Task Co`);

	const firstCall = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'No Answer',
			next_action: {
				activity_type: 'Call',
				scheduled_for: futureDate(2),
				next_action: 'Call back',
			},
		},
		context.creator.sessionToken
	);
	assert.equal(firstCall.status, 200, `first call body: ${firstCall.text}`);

	const taskId = ActivityEnvelopeSchema.parse(firstCall.json()).data
		.activity_id;
	const scheduledRows = await context.reader.activityRows(leadId);
	const openTask = scheduledRows.find((row) => row.status === 'Scheduled');
	assert.ok(openTask, 'the next action is a scheduled row');

	const withoutReplacement = await context.http.patch(
		`/api/leads/${leadId}/tasks/${String(openTask.id)}`,
		{ status: 'Cancelled' },
		context.creator.sessionToken
	);
	assert.equal(
		withoutReplacement.status,
		409,
		`cancelling the last task body: ${withoutReplacement.text}`
	);
	assert.equal(
		ErrorEnvelopeSchema.parse(withoutReplacement.json()).code,
		'next_action_required'
	);
	assert.equal(
		(await context.reader.activityRows(leadId)).find(
			(row) => row.id === openTask.id
		)?.status,
		'Scheduled',
		'a refused write leaves the task open'
	);

	const withReplacement = await context.http.patch(
		`/api/leads/${leadId}/tasks/${String(openTask.id)}`,
		{
			status: 'Cancelled',
			next_action: {
				activity_type: 'Email',
				scheduled_for: futureDate(9),
				next_action: 'Send the revised quotation',
			},
		},
		context.creator.sessionToken
	);
	assert.equal(
		withReplacement.status,
		200,
		`cancelling with a replacement body: ${withReplacement.text}`
	);
	const cancelled = TaskUpdateEnvelopeSchema.parse(withReplacement.json()).data;
	assert.equal(cancelled.status, 'Cancelled');
	assert.equal(cancelled.next_action_date, futureDate(9));

	const rows = await context.reader.activityRows(leadId);
	assert.equal(rows.find((row) => row.id === openTask.id)?.status, 'Cancelled');
	const replacement = rows.filter(
		(row) => row.status === 'Scheduled' && row.scheduled_for === futureDate(9)
	);
	assert.equal(replacement.length, 1, 'the replacement is persisted');

	// Completing the replacement works the same way.
	const completed = await context.http.patch(
		`/api/leads/${leadId}/tasks/${String(replacement[0]?.id)}`,
		{
			status: 'Completed',
			next_action: {
				activity_type: 'Meeting',
				scheduled_for: futureDate(14),
				next_action: 'Site visit',
			},
		},
		context.creator.sessionToken
	);
	assert.equal(completed.status, 200, `completion body: ${completed.text}`);
	const completedBody = TaskUpdateEnvelopeSchema.parse(completed.json()).data;
	assert.equal(completedBody.status, 'Completed');
	assert.equal(completedBody.next_action_date, futureDate(14));

	// A task of another Lead is not found.
	const foreign = await context.http.patch(
		`/api/leads/${leadId}/tasks/999999`,
		{ status: 'Completed' },
		context.creator.sessionToken
	);
	assert.equal(foreign.status, 404, `foreign task body: ${foreign.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(foreign.json()).code,
		'task_not_found'
	);

	// A task that is already closed cannot be closed twice.
	const closed = await context.http.patch(
		`/api/leads/${leadId}/tasks/${String(replacement[0]?.id)}`,
		{ status: 'Completed' },
		context.creator.sessionToken
	);
	assert.equal(closed.status, 409, `closed task body: ${closed.text}`);

	const lead = await readLead(context, leadId);
	assert.equal(lead.enquiry_status, 'Attempting Contact');
	assert.equal(lead.next_action_date, futureDate(14));
	assert.equal(lead.next_action_type, 'Meeting');
	assert.ok(taskId > 0);
}

/**
 * Routine logging never regresses a decided stage and never overwrites a
 * closed one.
 */
export async function noRegressionScenario(
	context: ScenarioContext,
	seeds: LifecycleSeeds
): Promise<void> {
	const qualifiedId = await createLead(
		context,
		`${context.runTag} Qualified Co`
	);
	const staged = await context.http.put(
		`/api/leads/${qualifiedId}`,
		{
			enquiry_status: 'Qualified',
			follow_up_date: futureDate(4),
		},
		context.creator.sessionToken
	);
	assert.equal(staged.status, 200, `stage body: ${staged.text}`);

	// The dated next action of the Lead is real work: editing it moves the
	// scheduled row instead of writing a loose column value.
	const moved = await context.http.put(
		`/api/leads/${qualifiedId}`,
		{ follow_up_date: futureDate(9) },
		context.creator.sessionToken
	);
	assert.equal(moved.status, 200, `next action body: ${moved.text}`);
	const scheduledRows = (await context.reader.activityRows(qualifiedId)).filter(
		(row) => row.status === 'Scheduled'
	);
	assert.equal(scheduledRows.length, 1, 'the Lead keeps one scheduled row');
	assert.equal(scheduledRows[0]?.scheduled_for, futureDate(9));
	const movedLead = await readLead(context, qualifiedId);
	assert.equal(movedLead.next_action_date, futureDate(9));
	assert.equal(movedLead.enquiry_status, 'Qualified');

	const logged = await context.http.post(
		`/api/leads/${qualifiedId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'No Answer',
			next_action: { scheduled_for: futureDate(6) },
		},
		context.creator.sessionToken
	);
	assert.equal(logged.status, 200, `call body: ${logged.text}`);
	assert.equal(
		ActivityEnvelopeSchema.parse(logged.json()).data.stage,
		'Qualified',
		'routine logging never regresses a qualified lead'
	);
	const history = await context.reader.stageHistory(qualifiedId);
	assert.equal(
		history.length,
		0,
		'no stage change is written when the stage stays'
	);

	const disqualified = await context.http.post(
		`/api/leads/${seeds.disqualifiedLeadId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'Busy',
			next_action: { scheduled_for: futureDate(8) },
		},
		context.creator.sessionToken
	);
	assert.equal(
		disqualified.status,
		200,
		`disqualified body: ${disqualified.text}`
	);
	const disqualifiedRow = await context.reader.leadRow(
		seeds.disqualifiedLeadId
	);
	assert.equal(
		disqualifiedRow?.enquiry_status,
		'Disqualified',
		'logging never overwrites a disqualified lead'
	);

	const converted = await context.http.post(
		`/api/leads/${seeds.convertedLeadId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'Connected',
			next_action: { scheduled_for: futureDate(8) },
		},
		context.creator.sessionToken
	);
	assert.equal(converted.status, 409, `converted body: ${converted.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(converted.json()).code,
		'lead_converted'
	);
	assert.equal(
		(await context.reader.activityRows(seeds.convertedLeadId)).length,
		0,
		'a converted lead takes no new sales work'
	);
}

/**
 * The timeline is chronological, it separates completed work from scheduled
 * work, and it survives a reload.
 */
export async function timelinePersistenceScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(context, `${context.runTag} Timeline Co`);

	await context.http.post(
		`/api/leads/${leadId}/activities`,
		{ activity_type: 'Note', notes: 'First note.' },
		context.creator.sessionToken
	);
	await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'No Answer',
			notes: 'Nobody answered.',
			next_action: {
				activity_type: 'Call',
				scheduled_for: futureDate(3),
				next_action: 'Call back',
			},
		},
		context.creator.sessionToken
	);

	const first = await context.http.get(
		`/api/leads/${leadId}/timeline`,
		context.creator.sessionToken
	);
	assert.equal(first.status, 200, `timeline body: ${first.text}`);
	const entries = TimelineEnvelopeSchema.parse(first.json()).data.entries;

	const activities = entries.filter((entry) => entry.kind === 'activity');
	assert.equal(activities.length, 3, 'the note, the call, and the next action');
	assert.equal(activities[0]?.status, 'Completed');
	assert.equal(activities[0]?.activity_type, 'Note');
	assert.equal(activities[1]?.status, 'Completed');
	assert.equal(activities[1]?.activity_type, 'Call');
	assert.equal(activities[1]?.call_outcome, 'No Answer');
	assert.equal(activities[2]?.status, 'Scheduled');
	assert.equal(activities[2]?.activity_type, 'Call');
	assert.equal(
		activities[0]?.actor_name,
		context.creator.fullName,
		'the author is named'
	);
	assert.equal(activities[0]?.legacy, false);

	const stageChanges = entries.filter((entry) => entry.kind === 'stage_change');
	assert.equal(stageChanges.length, 1);
	assert.equal(stageChanges[0]?.title, 'Stage: New → Attempting Contact');

	const ownerChanges = entries.filter((entry) => entry.kind === 'owner_change');
	assert.equal(
		ownerChanges.length,
		1,
		'the assignment is part of the timeline'
	);

	// Chronological: the entries never move backwards in time.
	const times = entries
		.map((entry) => entry.occurred_at ?? entry.recorded_at)
		.filter((value): value is string => value !== null);
	assert.deepEqual(times, [...times].sort(), 'the timeline is ordered by time');

	// The timeline survives a reload and still matches the stored rows.
	const second = await context.http.get(
		`/api/leads/${leadId}/timeline`,
		context.creator.sessionToken
	);
	assert.equal(second.status, 200);
	assert.deepEqual(
		TimelineEnvelopeSchema.parse(second.json()).data.entries.map(
			(entry) => entry.key
		),
		entries.map((entry) => entry.key)
	);

	const rows = await context.reader.activityRows(leadId);
	assert.equal(rows.length, 3, 'every timeline activity is a stored row');
}

/**
 * The legacy evidence: a Lead that carried a dated next action before the
 * activity log existed. The cutover turned that date into real scheduled
 * work whose author and kind are unknown, and the timeline says so.
 */
export async function legacyActivityEvidenceScenario(
	context: ScenarioContext,
	seed: { id: number; followUpDate: string }
): Promise<void> {
	const leadId = seed.id;
	assert.ok(leadId > 0, 'the legacy scheduled lead is seeded');

	const rows = await context.reader.activityRows(leadId);
	assert.equal(rows.length, 1, 'the legacy date became one scheduled row');
	const row = rows[0];
	assert.equal(row?.status, 'Scheduled');
	assert.equal(row?.scheduled_for, seed.followUpDate);
	assert.equal(row?.created_by, null, 'the author of a legacy row is unknown');
	assert.equal(row?.activity_type, null, 'the kind of a legacy row is unknown');

	const leadRow = await context.reader.leadRow(leadId);
	assert.equal(
		leadRow?.follow_up_date,
		seed.followUpDate,
		'the Lead still carries its dated next action'
	);

	const response = await context.http.get(
		`/api/leads/${leadId}/timeline`,
		context.creator.sessionToken
	);
	assert.equal(response.status, 200, `timeline body: ${response.text}`);
	const entries = TimelineEnvelopeSchema.parse(response.json()).data.entries;
	const activity = entries.find((entry) => entry.kind === 'activity');
	assert.ok(activity, 'the legacy work is on the timeline');
	assert.equal(activity.legacy, true, 'the timeline marks the legacy row');
	assert.equal(activity.actor_name, null, 'the author stays unknown');
	assert.equal(activity.activity_type, null, 'the kind stays unknown');
	assert.match(
		activity.title,
		/scheduled for/,
		'the timeline names the scheduled date'
	);

	const detail = await readLead(context, leadId);
	assert.equal(detail.next_action_date, seed.followUpDate);
	assert.equal(
		detail.next_action_type,
		null,
		'the kind of the legacy next action stays unknown'
	);
}

/**
 * The cross-Lead work queue: the outstanding scheduled work of every Lead,
 * soonest first.
 */
export async function leadWorkQueueScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(context, `${context.runTag} Queue Co`);

	await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'No Answer',
			next_action: {
				activity_type: 'Call',
				scheduled_for: futureDate(11),
				next_action: 'Call back',
			},
		},
		context.creator.sessionToken
	);

	const response = await context.http.get(
		'/api/leads/work?scope=upcoming&limit=50',
		context.readOnly.sessionToken
	);
	assert.equal(response.status, 200, `work body: ${response.text}`);
	const work = WorkEnvelopeSchema.parse(response.json()).data.work;

	const mine = work.filter((item) => item.lead_id === leadId);
	assert.equal(mine.length, 1, 'the scheduled work of the lead is listed');
	assert.equal(mine[0]?.activity_type, 'Call');
	assert.equal(mine[0]?.scheduled_for, futureDate(11));
	assert.equal(mine[0]?.next_action, 'Call back');
	assert.equal(mine[0]?.status, 'Scheduled');
	assert.equal(mine[0]?.company_name, `${context.runTag} Queue Co`);

	const dates = work.map((item) => item.scheduled_for ?? '');
	assert.deepEqual(
		dates,
		[...dates].sort(),
		'the work queue is ordered by date'
	);

	const unsupported = await context.http.get(
		'/api/leads/work?scope=everything',
		context.readOnly.sessionToken
	);
	assert.equal(unsupported.status, 400, `scope body: ${unsupported.text}`);
}
