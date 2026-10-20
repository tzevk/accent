import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';

/**
 * The correction of a logged Lead activity (ticket #372).
 *
 * A correction says that a logged activity was recorded wrongly. It keeps
 * the values it replaced, the reason, the person who corrected it, and the
 * moment of the correction. It never erases the activity, it never counts
 * the activity twice, and it never replays an automatic stage transition.
 *
 * The corrections are made by the second permitted fixture user, not by the
 * creator: every session has its own request budget, and one session must
 * not carry the whole run.
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

const CorrectionEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		activity_id: z.number(),
		version: z.number(),
		corrected_at: z.string(),
	}),
});

const CorrectionStateSchema = z.object({
	success: z.literal(true),
	data: z.object({
		activity: z.object({
			id: z.number(),
			activity_type: z.string().nullable(),
			status: z.string().nullable(),
			call_outcome: z.string().nullable(),
			reply_confirmed: z.boolean().nullable(),
			occurred_at: z.string().nullable(),
			notes: z.string().nullable(),
			version: z.number(),
		}),
		corrections: z.array(
			z.object({
				id: z.number(),
				reason: z.string(),
				previous_values: z.object({
					activity_type: z.string().nullable(),
					call_outcome: z.string().nullable(),
					reply_confirmed: z.boolean().nullable(),
					occurred_at: z.string().nullable(),
					notes: z.string().nullable(),
				}),
				corrected_values: z.object({
					activity_type: z.string().nullable(),
					call_outcome: z.string().nullable(),
					reply_confirmed: z.boolean().nullable(),
					occurred_at: z.string().nullable(),
					notes: z.string().nullable(),
				}),
				actor_name: z.string().nullable(),
				corrected_at: z.string().nullable(),
			})
		),
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

const LeadDetailEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		id: z.number(),
		enquiry_status: z.string().nullable(),
		owner_user_id: z.number().nullable(),
		last_contact_at: z.string().nullable(),
		latest_activity_outcome: z.string().nullable(),
		next_action_date: z.string().nullable(),
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
	options: { owner?: 'none' } = {}
): Promise<number> {
	const body: Record<string, unknown> = {
		company_name: companyName,
		contact_name: 'Correction Contact',
		contact_email: 'correction@example.com',
		project_description: `${context.runTag} correction need`,
	};
	if (options.owner === 'none') body.owner_user_id = null;
	const response = await context.http.post(
		'/api/leads',
		body,
		context.assignee.sessionToken
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
		context.assignee.sessionToken
	);
	assert.equal(response.status, 200, `detail status (body: ${response.text})`);
	return LeadDetailEnvelopeSchema.parse(response.json()).data;
}

async function readTimeline(context: ScenarioContext, leadId: number) {
	const response = await context.http.get(
		`/api/leads/${leadId}/timeline`,
		context.assignee.sessionToken
	);
	assert.equal(
		response.status,
		200,
		`timeline status (body: ${response.text})`
	);
	return TimelineEnvelopeSchema.parse(response.json()).data.entries;
}

/** A Lead with one logged call, ready to be corrected. */
async function leadWithLoggedCall(
	context: ScenarioContext,
	companyName: string
): Promise<{ leadId: number; activityId: number }> {
	const leadId = await createLead(context, companyName);
	const logged = await context.http.post(
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
		context.assignee.sessionToken
	);
	assert.equal(logged.status, 200, `call body: ${logged.text}`);
	const activityId = z
		.object({ activity_id: z.number() })
		.parse(EnvelopeSchema.parse(logged.json()).data).activity_id;
	return { leadId, activityId };
}

/**
 * The correction itself: the values before and after, the metadata of the
 * correction, the timeline, and the totals. A corrected activity is still
 * one activity, and the Lead keeps its stage.
 */
export async function activityCorrectionScenario(
	context: ScenarioContext
): Promise<void> {
	const { leadId, activityId } = await leadWithLoggedCall(
		context,
		`${context.runTag} Correction Co`
	);

	const before = await context.reader.activityRows(leadId);
	const call = before.find((row) => row.id === activityId);
	assert.ok(call, 'the logged call is stored');
	assert.equal(call.version, 1, 'a fresh activity is the first version');
	const originalOccurredAt = call.occurred_at;
	const originalRecordedAt = call.recorded_at;
	const originalAuthor = call.created_by;

	const state = await context.http.get(
		`/api/leads/${leadId}/activities/${activityId}/corrections`,
		context.assignee.sessionToken
	);
	assert.equal(state.status, 200, `state body: ${state.text}`);
	const beforeState = CorrectionStateSchema.parse(state.json()).data;
	assert.equal(beforeState.activity.version, 1);
	assert.equal(beforeState.corrections.length, 0, 'nothing is corrected yet');

	const corrected = await context.http.post(
		`/api/leads/${leadId}/activities/${activityId}/corrections`,
		{
			version: 1,
			reason: 'The call connected after the first ring.',
			call_outcome: 'Connected',
			notes: 'Spoke to the site manager.',
		},
		context.assignee.sessionToken
	);
	assert.equal(corrected.status, 200, `correction body: ${corrected.text}`);
	const correction = CorrectionEnvelopeSchema.parse(corrected.json()).data;
	assert.equal(correction.activity_id, activityId);
	assert.equal(correction.version, 2, 'the version moves on');
	assert.ok(correction.corrected_at, 'the correction carries its moment');

	// The activity row holds the corrected values and keeps its provenance.
	const rows = await context.reader.activityRows(leadId);
	const correctedCall = rows.find((row) => row.id === activityId);
	assert.ok(correctedCall, 'the corrected call is stored');
	assert.equal(correctedCall.call_outcome, 'Connected');
	assert.equal(correctedCall.notes, 'Spoke to the site manager.');
	assert.equal(correctedCall.version, 2);
	assert.equal(
		correctedCall.created_by,
		originalAuthor,
		'the author of the activity is not touched'
	);
	assert.equal(
		correctedCall.occurred_at,
		originalOccurredAt,
		'the occurrence time of the activity is not touched'
	);
	assert.equal(
		correctedCall.recorded_at,
		originalRecordedAt,
		'the recording time of the activity is not touched'
	);

	// The correction history keeps the values it replaced.
	const corrections = await context.reader.correctionRows(leadId);
	assert.equal(corrections.length, 1, 'one correction is stored');
	const stored = corrections[0];
	assert.ok(stored);
	assert.equal(stored.activity_id, activityId);
	assert.equal(stored.lead_id, leadId);
	assert.equal(stored.reason, 'The call connected after the first ring.');
	assert.equal(
		stored.corrected_by,
		context.assignee.id,
		'the correcting user comes from the session'
	);
	assert.ok(stored.corrected_at, 'the correction carries its moment');
	const previous = JSON.parse(stored.previous_values) as {
		activity_type: string | null;
		call_outcome: string | null;
		notes: string | null;
	};
	const current = JSON.parse(stored.corrected_values) as {
		activity_type: string | null;
		call_outcome: string | null;
		notes: string | null;
	};
	assert.equal(previous.activity_type, 'Call');
	assert.equal(previous.call_outcome, 'No Answer');
	assert.equal(previous.notes, 'Nobody answered.');
	assert.equal(current.activity_type, 'Call');
	assert.equal(current.call_outcome, 'Connected');
	assert.equal(current.notes, 'Spoke to the site manager.');

	// The timeline shows the correction next to the activity, and the
	// activity is not a second completed call.
	const entries = await readTimeline(context, leadId);
	const activities = entries.filter((entry) => entry.kind === 'activity');
	const completed = activities.filter(
		(entry) => entry.status === 'Completed' && entry.activity_type === 'Call'
	);
	assert.equal(completed.length, 1, 'the corrected call is one activity');
	assert.equal(completed[0]?.call_outcome, 'Connected');
	const correctionEntries = entries.filter(
		(entry) => entry.kind === 'correction'
	);
	assert.equal(
		correctionEntries.length,
		1,
		'the correction is on the timeline'
	);
	assert.equal(correctionEntries[0]?.actor_name, context.assignee.fullName);
	assert.match(
		correctionEntries[0]?.detail ?? '',
		/Call outcome: No Answer → Connected/,
		'the timeline keeps the previous values'
	);
	assert.match(
		correctionEntries[0]?.detail ?? '',
		/The call connected after the first ring\./,
		'the timeline keeps the reason'
	);

	// The totals and the stage: a correction is not new outreach.
	const lead = await readLead(context, leadId);
	assert.equal(lead.activity_count, 1, 'the corrected activity counts once');
	assert.equal(
		lead.enquiry_status,
		'Attempting Contact',
		'a correction never replays an automatic stage transition'
	);
	const history = await context.reader.stageHistory(leadId);
	assert.equal(history.length, 1, 'a correction writes no stage history');
	assert.equal(lead.next_action_date, futureDate(3));

	// The correction state the interface reads.
	const afterState = await context.http.get(
		`/api/leads/${leadId}/activities/${activityId}/corrections`,
		context.assignee.sessionToken
	);
	assert.equal(afterState.status, 200);
	const stateBody = CorrectionStateSchema.parse(afterState.json()).data;
	assert.equal(stateBody.activity.version, 2);
	assert.equal(stateBody.corrections.length, 1);
	assert.equal(
		stateBody.corrections[0]?.previous_values.call_outcome,
		'No Answer'
	);
	assert.equal(
		stateBody.corrections[0]?.corrected_values.call_outcome,
		'Connected'
	);
	assert.equal(stateBody.corrections[0]?.actor_name, context.assignee.fullName);
}

/**
 * A user without the lead update right may not correct an activity, and the
 * refused request writes nothing.
 */
export async function deniedCorrectionScenario(
	context: ScenarioContext
): Promise<void> {
	const { leadId, activityId } = await leadWithLoggedCall(
		context,
		`${context.runTag} Denied Correction Co`
	);

	const denied = await context.http.post(
		`/api/leads/${leadId}/activities/${activityId}/corrections`,
		{
			version: 1,
			reason: 'Not allowed to change this.',
			call_outcome: 'Connected',
		},
		context.readOnly.sessionToken
	);
	assert.equal(denied.status, 403, `denied body: ${denied.text}`);
	assert.equal(
		(await context.reader.correctionRows(leadId)).length,
		0,
		'a denied correction writes nothing'
	);
	const rows = await context.reader.activityRows(leadId);
	assert.equal(
		rows.find((row) => row.id === activityId)?.call_outcome,
		'No Answer',
		'a denied correction changes nothing'
	);
	assert.equal(rows.find((row) => row.id === activityId)?.version, 1);
}

/**
 * A correction without a reason is refused, and the refusal writes nothing.
 */
export async function missingReasonCorrectionScenario(
	context: ScenarioContext
): Promise<void> {
	const { leadId, activityId } = await leadWithLoggedCall(
		context,
		`${context.runTag} Missing Reason Co`
	);

	const refused = await context.http.post(
		`/api/leads/${leadId}/activities/${activityId}/corrections`,
		{ version: 1, call_outcome: 'Connected' },
		context.assignee.sessionToken
	);
	assert.equal(refused.status, 422, `refused body: ${refused.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(refused.json()).code,
		'reason_required'
	);
	assert.equal(
		(await context.reader.correctionRows(leadId)).length,
		0,
		'a refused correction writes nothing'
	);
	const rows = await context.reader.activityRows(leadId);
	assert.equal(
		rows.find((row) => row.id === activityId)?.call_outcome,
		'No Answer'
	);
	assert.equal(rows.find((row) => row.id === activityId)?.version, 1);

	// An activity of another Lead is not found.
	const foreign = await context.http.post(
		`/api/leads/${leadId}/activities/999999/corrections`,
		{ version: 1, reason: 'Wrong activity.' },
		context.assignee.sessionToken
	);
	assert.equal(foreign.status, 404, `foreign body: ${foreign.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(foreign.json()).code,
		'activity_not_found'
	);
}

/**
 * A correction of an activity that moved on is refused: the accepted
 * correction is kept, and no intermediate version is lost.
 */
export async function staleVersionCorrectionScenario(
	context: ScenarioContext
): Promise<void> {
	const { leadId, activityId } = await leadWithLoggedCall(
		context,
		`${context.runTag} Stale Version Co`
	);

	const accepted = await context.http.post(
		`/api/leads/${leadId}/activities/${activityId}/corrections`,
		{
			version: 1,
			reason: 'The outcome was wrong.',
			call_outcome: 'Connected',
		},
		context.assignee.sessionToken
	);
	assert.equal(accepted.status, 200, `first correction body: ${accepted.text}`);
	assert.equal(CorrectionEnvelopeSchema.parse(accepted.json()).data.version, 2);

	const stale = await context.http.post(
		`/api/leads/${leadId}/activities/${activityId}/corrections`,
		{
			version: 1,
			reason: 'A second editor with the old version.',
			call_outcome: 'Busy',
		},
		context.assignee.sessionToken
	);
	assert.equal(stale.status, 409, `stale body: ${stale.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(stale.json()).code,
		'correction_conflict'
	);

	const rows = await context.reader.activityRows(leadId);
	const corrected = rows.find((row) => row.id === activityId);
	assert.equal(
		corrected?.call_outcome,
		'Connected',
		'the accepted correction is not overwritten'
	);
	assert.equal(corrected?.version, 2, 'the version did not move again');
	const corrections = await context.reader.correctionRows(leadId);
	assert.equal(
		corrections.length,
		1,
		'the refused correction leaves no second history row'
	);
	assert.equal(corrections[0]?.reason, 'The outcome was wrong.');

	// The next editor works with the current version, and the version
	// before it is not lost: the history keeps every step.
	const second = await context.http.post(
		`/api/leads/${leadId}/activities/${activityId}/corrections`,
		{
			version: 2,
			reason: 'The call was busy after all.',
			call_outcome: 'Busy',
		},
		context.assignee.sessionToken
	);
	assert.equal(second.status, 200, `second correction body: ${second.text}`);
	assert.equal(CorrectionEnvelopeSchema.parse(second.json()).data.version, 3);
	const history = await context.reader.correctionRows(leadId);
	assert.equal(history.length, 2, 'every accepted correction is kept');
	const middle = JSON.parse(history[1]?.previous_values ?? '{}') as {
		call_outcome: string | null;
	};
	assert.equal(
		middle.call_outcome,
		'Connected',
		'the intermediate version is not lost'
	);
	const entries = await readTimeline(context, leadId);
	assert.equal(
		entries.filter((entry) => entry.kind === 'correction').length,
		2,
		'the timeline shows every correction'
	);
	assert.equal(
		entries.filter(
			(entry) => entry.kind === 'activity' && entry.status === 'Completed'
		).length,
		1,
		'the corrected activity is still one activity'
	);
}

/**
 * A correction may not turn a record into outreach on a Lead nobody owns,
 * and it never asks for a dated next action: a correction is not new work.
 */
export async function unownedCorrectionRefusalScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		`${context.runTag} Unowned Correction Co`,
		{ owner: 'none' }
	);
	const logged = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{ activity_type: 'Note', notes: 'A note from the intake form.' },
		context.assignee.sessionToken
	);
	assert.equal(logged.status, 200, `note body: ${logged.text}`);
	const activityId = z
		.object({ activity_id: z.number() })
		.parse(EnvelopeSchema.parse(logged.json()).data).activity_id;

	const refused = await context.http.post(
		`/api/leads/${leadId}/activities/${activityId}/corrections`,
		{
			version: 1,
			reason: 'It was a call after all.',
			activity_type: 'Call',
			call_outcome: 'Connected',
		},
		context.assignee.sessionToken
	);
	assert.equal(refused.status, 409, `refused body: ${refused.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(refused.json()).code,
		'owner_required'
	);
	assert.equal(
		(await context.reader.correctionRows(leadId)).length,
		0,
		'a refused correction writes nothing'
	);
	const rows = await context.reader.activityRows(leadId);
	assert.equal(
		rows.find((row) => row.id === activityId)?.activity_type,
		'Note'
	);
	assert.equal(rows.find((row) => row.id === activityId)?.version, 1);
}

/**
 * The provenance of a legacy row stays unknown: correcting it does not
 * invent an author, and the correction itself names the person who made
 * it.
 */
export async function legacyCorrectionProvenanceScenario(
	context: ScenarioContext,
	seed: { id: number; followUpDate: string }
): Promise<void> {
	const leadId = seed.id;
	assert.ok(leadId > 0, 'the legacy scheduled lead is seeded');
	const rows = await context.reader.activityRows(leadId);
	const legacy = rows[0];
	assert.ok(legacy, 'the legacy row is stored');
	assert.equal(
		legacy.created_by,
		null,
		'the author of a legacy row is unknown'
	);
	assert.equal(
		legacy.activity_type,
		null,
		'the kind of a legacy row is unknown'
	);

	const corrected = await context.http.post(
		`/api/leads/${leadId}/activities/${legacy.id}/corrections`,
		{
			version: legacy.version ?? 1,
			reason: 'The old follow-up was a call.',
			activity_type: 'Call',
		},
		context.assignee.sessionToken
	);
	assert.equal(corrected.status, 200, `correction body: ${corrected.text}`);

	const after = await context.reader.activityRows(leadId);
	const row = after.find((item) => item.id === legacy.id);
	assert.ok(row);
	assert.equal(row.activity_type, 'Call', 'the stated kind is stored');
	assert.equal(
		row.created_by,
		null,
		'the correction does not invent the author of the activity'
	);
	assert.equal(
		row.call_outcome,
		null,
		'the correction does not invent the outcome of the activity'
	);
	const corrections = await context.reader.correctionRows(leadId);
	assert.equal(corrections.length, 1);
	assert.equal(
		corrections[0]?.corrected_by,
		context.assignee.id,
		'the correction names the person who corrected it'
	);
	const previous = JSON.parse(corrections[0]?.previous_values ?? '{}') as {
		activity_type: string | null;
		call_outcome: string | null;
	};
	assert.equal(previous.activity_type, null);
	assert.equal(previous.call_outcome, null);
}

/**
 * There is no destructive path: no route deletes an activity, and closing
 * the work keeps the activity and its correction history.
 */
export async function noDestructiveActivityPathScenario(
	context: ScenarioContext
): Promise<void> {
	const { leadId, activityId } = await leadWithLoggedCall(
		context,
		`${context.runTag} No Destruction Co`
	);
	const corrected = await context.http.post(
		`/api/leads/${leadId}/activities/${activityId}/corrections`,
		{ version: 1, reason: 'The note was wrong.', notes: 'The real note.' },
		context.assignee.sessionToken
	);
	assert.equal(corrected.status, 200, `correction body: ${corrected.text}`);

	const deleted = await context.http.delete(
		`/api/leads/${leadId}/activities/${activityId}`,
		context.assignee.sessionToken
	);
	assert.ok(
		deleted.status === 404 || deleted.status === 405,
		`delete body: ${deleted.text}`
	);

	const rows = await context.reader.activityRows(leadId);
	assert.ok(
		rows.find((row) => row.id === activityId),
		'the activity survives a delete attempt'
	);
	assert.equal(
		(await context.reader.correctionRows(leadId)).length,
		1,
		'the correction history survives a delete attempt'
	);

	// Closing the outstanding work preserves the evidence: the task is
	// cancelled, never erased.
	const scheduled = rows.find((row) => row.status === 'Scheduled');
	assert.ok(scheduled, 'the Lead has outstanding work');
	const cancelled = await context.http.patch(
		`/api/leads/${leadId}/tasks/${String(scheduled.id)}`,
		{
			status: 'Cancelled',
			next_action: { scheduled_for: futureDate(5), next_action: 'Call back' },
		},
		context.assignee.sessionToken
	);
	assert.equal(cancelled.status, 200, `cancel body: ${cancelled.text}`);
	const afterCancel = await context.reader.activityRows(leadId);
	assert.equal(
		afterCancel.find((row) => row.id === scheduled.id)?.status,
		'Cancelled',
		'the closed work is kept as evidence'
	);
	assert.ok(
		afterCancel.find((row) => row.id === activityId),
		'the corrected activity is kept'
	);
	assert.equal(
		(await context.reader.correctionRows(leadId)).length,
		1,
		'the correction history is kept'
	);
}
