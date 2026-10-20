import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';

/**
 * The Lead-to-Proposal handoff of ticket #375.
 *
 * Every scenario asserts the HTTP response and the persisted rows through
 * the independent reader. The scenarios share the request budget of the
 * real rate limiter across the fixture sessions: the application allows
 * every session 120 API requests a minute, so the write-heavy scenarios
 * use the assignee and the editor, and the read-back requests use the
 * read-only session.
 */

/**
 * The enquiries the conversion scenarios work on: a qualified enquiry with
 * scheduled work and completed evidence, one enquiry per missing
 * qualification fact, an enquiry that is not qualified yet, an enquiry with
 * two linked Proposals and no canonical choice, and the enquiries of the
 * repeat, the concurrent, the rollback, and the queue proofs.
 */
export interface ConversionSeeds {
	qualifiedLeadId: number;
	repeatLeadId: number;
	concurrentLeadId: number;
	rollbackLeadId: number;
	queueLeadId: number;
	noContactLeadId: number;
	noDetailsLeadId: number;
	noNeedLeadId: number;
	noOwnerLeadId: number;
	notQualifiedLeadId: number;
	conflictLeadId: number;
	conflictProposalIds: number[];
}

/**
 * The deterministic database failure of the conversion proof. The harness
 * arms the trigger in the disposable database; the application has no
 * control that can fail a conversion on purpose.
 */
export interface FailureInjection {
	install: () => Promise<void>;
	remove: () => Promise<void>;
}

const ErrorEnvelopeSchema = z.object({
	success: z.literal(false),
	error: z.string(),
	code: z.string().optional(),
});

const ConversionEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		proposal_id: z.number(),
		proposal: z.record(z.string(), z.unknown()),
		already_converted: z.boolean(),
	}),
});

const LeadDetailEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		id: z.number(),
		enquiry_status: z.string().nullable(),
		canonical_proposal_id: z.number().nullable(),
		next_action_date: z.string().nullable(),
	}),
});

const WorkEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		work: z.array(
			z.object({
				id: z.number(),
				lead_id: z.number(),
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
				title: z.string(),
			})
		),
	}),
});

/** The conversion request of one enquiry. */
async function convert(
	context: ScenarioContext,
	leadId: number,
	body: Record<string, unknown> = {},
	sessionToken?: string
) {
	return context.http.post(
		`/api/leads/${leadId}/convert`,
		body,
		sessionToken ?? context.assignee.sessionToken
	);
}

/** The stored Lead, read straight from the database. */
async function readLeadRow(context: ScenarioContext, leadId: number) {
	const row = await context.reader.leadRow(leadId);
	assert.ok(row, `the lead ${leadId} is stored`);
	return row;
}

/**
 * Every missing grant is refused before anything is written. The handoff
 * needs the Lead convert right, the Lead update right, and the right to
 * create Proposals.
 */
export async function conversionPermissionsScenario(
	context: ScenarioContext,
	seeds: ConversionSeeds
): Promise<void> {
	const leadId = seeds.qualifiedLeadId;

	// The Proposal user has no Lead convert right.
	const withoutConvert = await convert(
		context,
		leadId,
		{},
		context.proposer.sessionToken
	);
	assert.equal(
		withoutConvert.status,
		403,
		`denied body: ${withoutConvert.text}`
	);

	// The Lead editor has no right to create Proposals.
	const withoutProposalCreate = await convert(
		context,
		leadId,
		{},
		context.noAssign.sessionToken
	);
	assert.equal(
		withoutProposalCreate.status,
		403,
		`denied body: ${withoutProposalCreate.text}`
	);

	// The read-only user has none of the three grants.
	const readOnly = await convert(
		context,
		leadId,
		{},
		context.readOnly.sessionToken
	);
	assert.equal(readOnly.status, 403, `denied body: ${readOnly.text}`);

	// An anonymous request is not authorized at all.
	const anonymous = await context.http.post(`/api/leads/${leadId}/convert`, {});
	assert.equal(anonymous.status, 401, `anonymous body: ${anonymous.text}`);

	// Nothing was written: no Proposal, no conversion, no stage change.
	const proposals = await context.reader.proposalRows(leadId);
	assert.equal(proposals.length, 0, 'a refused handoff creates no Proposal');
	const conversions = await context.reader.conversionRows(leadId);
	assert.equal(conversions.length, 0, 'a refused handoff records no evidence');
	const row = await readLeadRow(context, leadId);
	assert.equal(row.enquiry_status, 'Qualified');
	assert.equal(row.canonical_proposal_id, null);
	assert.equal(row.converted_at, null);
}

/**
 * Every missing qualification fact is refused with its own code, so the
 * interface can point at the field that is missing. Nothing is written.
 */
export async function conversionQualificationScenario(
	context: ScenarioContext,
	seeds: ConversionSeeds
): Promise<void> {
	const cases: Array<{ leadId: number; code: string; status: number }> = [
		{
			leadId: seeds.noContactLeadId,
			code: 'contact_name_required',
			status: 422,
		},
		{
			leadId: seeds.noDetailsLeadId,
			code: 'contact_details_required',
			status: 422,
		},
		{
			leadId: seeds.noNeedLeadId,
			code: 'project_need_required',
			status: 422,
		},
		{
			leadId: seeds.noOwnerLeadId,
			code: 'owner_required',
			status: 409,
		},
	];
	for (const entry of cases) {
		const response = await convert(context, entry.leadId);
		assert.equal(
			response.status,
			entry.status,
			`${entry.code} body: ${response.text}`
		);
		const error = ErrorEnvelopeSchema.parse(response.json());
		assert.equal(error.code, entry.code);
		const proposals = await context.reader.proposalRows(entry.leadId);
		assert.equal(
			proposals.length,
			0,
			`a refused handoff creates no Proposal (${entry.code})`
		);
		const row = await readLeadRow(context, entry.leadId);
		assert.equal(row.enquiry_status, 'Qualified');
		assert.equal(row.canonical_proposal_id, null);
	}
}

/**
 * A conversion needs a Qualified Lead. Any other stage is refused with the
 * required stage named in the message.
 */
export async function conversionStageRequiredScenario(
	context: ScenarioContext,
	seeds: ConversionSeeds
): Promise<void> {
	const response = await convert(context, seeds.notQualifiedLeadId);
	assert.equal(response.status, 409, `body: ${response.text}`);
	const error = ErrorEnvelopeSchema.parse(response.json());
	assert.equal(error.code, 'transition_unavailable');
	assert.ok(
		error.error.includes('Qualified'),
		`the refusal names the required stage: ${error.error}`
	);
	const proposals = await context.reader.proposalRows(seeds.notQualifiedLeadId);
	assert.equal(proposals.length, 0, 'a refused handoff creates no Proposal');
	const row = await readLeadRow(context, seeds.notQualifiedLeadId);
	assert.equal(row.enquiry_status, 'Connected');
	assert.equal(row.canonical_proposal_id, null);
}

/**
 * The handoff itself: one canonical Proposal, the Lead marked Converted,
 * the conversion evidence, the stage history, and the scheduled work
 * transferred to the Proposal with a traceable link in both directions.
 */
export async function conversionHandoffScenario(
	context: ScenarioContext
): Promise<void> {
	// A Lead with the evidence a conversion needs, created over HTTP.
	const created = await context.http.post(
		'/api/leads',
		{
			company_name: `${context.runTag} Handoff Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			phone: '+91 98765 43210',
			project_description: 'A plant extension for the Chakan unit',
		},
		context.assignee.sessionToken
	);
	assert.equal(created.status, 200, `create body: ${created.text}`);
	const leadId = Number(
		z
			.object({ id: z.number() })
			.parse(
				z.object({ data: z.object({ id: z.number() }) }).parse(created.json())
					.data
			).id
	);
	context.trackLead(leadId);

	// The Lead is qualified, with a dated next action.
	const scheduledFor = new Date();
	scheduledFor.setDate(scheduledFor.getDate() + 4);
	const dateText = `${scheduledFor.getFullYear()}-${String(
		scheduledFor.getMonth() + 1
	).padStart(2, '0')}-${String(scheduledFor.getDate()).padStart(2, '0')}`;
	const qualified = await context.http.post(
		`/api/leads/${leadId}/stage`,
		{
			action: 'Qualify',
			next_action: {
				activity_type: 'Call',
				scheduled_for: dateText,
				next_action: 'Call about the tender',
			},
		},
		context.assignee.sessionToken
	);
	assert.equal(qualified.status, 200, `qualify body: ${qualified.text}`);

	// A completed call: the evidence of the Lead stays with the Lead.
	const logged = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'Connected',
			notes: 'The client asked for a proposal',
		},
		context.assignee.sessionToken
	);
	assert.equal(logged.status, 200, `activity body: ${logged.text}`);

	// The handoff.
	const response = await convert(context, leadId, {
		proposal_title: `${context.runTag} Handoff Proposal`,
	});
	assert.equal(response.status, 200, `convert body: ${response.text}`);
	const data = ConversionEnvelopeSchema.parse(response.json()).data;
	assert.equal(data.already_converted, false);
	assert.ok(data.proposal_id > 0);

	// The Lead is Converted, with the conversion recorded on the enquiry.
	const row = await readLeadRow(context, leadId);
	assert.equal(row.enquiry_status, 'Converted');
	assert.equal(row.canonical_proposal_id, data.proposal_id);
	assert.ok(row.converted_at, 'the enquiry records the conversion time');
	assert.equal(row.converted_by, context.assignee.id);
	assert.equal(
		row.follow_up_date,
		null,
		'the transferred work leaves the dated next action of the Lead'
	);

	// The Proposal carries the Lead evidence and the canonical link.
	const proposal = await context.reader.proposalRow(data.proposal_id);
	assert.ok(proposal, 'the canonical Proposal is stored');
	assert.equal(proposal.lead_id, leadId);
	assert.equal(proposal.canonical_lead_id, leadId);
	assert.equal(proposal.proposal_title, `${context.runTag} Handoff Proposal`);
	assert.equal(
		proposal.status,
		'DRAFT',
		'a conversion is a handoff, never a sale won'
	);

	// The conversion evidence and the stage history.
	const conversions = await context.reader.conversionRows(leadId);
	assert.equal(conversions.length, 1, 'the conversion is recorded once');
	assert.equal(conversions[0]?.proposal_id, data.proposal_id);
	assert.equal(conversions[0]?.converted_by, context.assignee.id);
	const history = await context.reader.stageHistory(leadId);
	const conversionRows = history.filter(
		(entry) => entry.change_source === 'conversion'
	);
	assert.equal(conversionRows.length, 1, 'the stage change is recorded once');
	assert.equal(conversionRows[0]?.from_stage, 'Qualified');
	assert.equal(conversionRows[0]?.to_stage, 'Converted');

	// The scheduled work moved to the Proposal, and the completed work
	// stayed with the Lead.
	const activities = await context.reader.activityRows(leadId);
	const scheduled = activities.filter(
		(activity) => activity.status === 'Scheduled'
	);
	assert.equal(scheduled.length, 1);
	const transferred = scheduled[0];
	assert.ok(
		transferred?.transferred_followup_id,
		'the source task keeps the link to its destination'
	);
	assert.ok(
		transferred?.transferred_at,
		'the source task records the transfer'
	);
	const completed = activities.filter(
		(activity) => activity.status === 'Completed'
	);
	assert.equal(
		completed.length,
		1,
		'the completed activity stays with the Lead'
	);
	assert.equal(completed[0]?.transferred_followup_id, null);

	// The Proposal inherited the task, with the context of the Lead task.
	const followups = await context.reader.proposalFollowups(data.proposal_id);
	assert.equal(followups.length, 1, 'one destination task per source task');
	assert.equal(followups[0]?.id, transferred?.transferred_followup_id);
	assert.equal(followups[0]?.follow_up_type, 'Call');
	assert.equal(followups[0]?.status, 'Scheduled');
	assert.equal(followups[0]?.description, 'Call about the tender');
	assert.equal(followups[0]?.created_by, context.assignee.id);
	assert.equal(followups[0]?.follow_up_date, dateText);
}

/**
 * A repeated handoff returns the Proposal that already exists and writes
 * nothing a second time.
 */
export async function conversionRepeatScenario(
	context: ScenarioContext,
	seeds: ConversionSeeds
): Promise<void> {
	const first = await convert(context, seeds.repeatLeadId);
	assert.equal(first.status, 200, `first body: ${first.text}`);
	const firstData = ConversionEnvelopeSchema.parse(first.json()).data;
	assert.equal(firstData.already_converted, false);

	const second = await convert(context, seeds.repeatLeadId);
	assert.equal(second.status, 200, `second body: ${second.text}`);
	const secondData = ConversionEnvelopeSchema.parse(second.json()).data;
	assert.equal(secondData.already_converted, true);
	assert.equal(
		secondData.proposal_id,
		firstData.proposal_id,
		'a repeated handoff returns the same Proposal'
	);

	const proposals = await context.reader.proposalRows(seeds.repeatLeadId);
	assert.equal(proposals.length, 1, 'the enquiry keeps one Proposal');
	const conversions = await context.reader.conversionRows(seeds.repeatLeadId);
	assert.equal(conversions.length, 1, 'the conversion is recorded once');
	const history = await context.reader.stageHistory(seeds.repeatLeadId);
	assert.equal(
		history.filter((entry) => entry.change_source === 'conversion').length,
		1,
		'the stage change is recorded once'
	);
	const followups = await context.reader.proposalFollowups(
		firstData.proposal_id
	);
	assert.equal(followups.length, 1, 'the work is transferred once');
}

/**
 * Two simultaneous handoffs converge on one canonical Proposal and one
 * destination task per source task.
 */
export async function conversionConcurrentScenario(
	context: ScenarioContext,
	seeds: ConversionSeeds
): Promise<void> {
	const [first, second] = await Promise.all([
		convert(context, seeds.concurrentLeadId),
		convert(context, seeds.concurrentLeadId),
	]);
	assert.equal(first.status, 200, `first body: ${first.text}`);
	assert.equal(second.status, 200, `second body: ${second.text}`);
	const firstData = ConversionEnvelopeSchema.parse(first.json()).data;
	const secondData = ConversionEnvelopeSchema.parse(second.json()).data;
	assert.equal(
		firstData.proposal_id,
		secondData.proposal_id,
		'the concurrent handoffs answer with one Proposal'
	);

	const proposals = await context.reader.proposalRows(seeds.concurrentLeadId);
	assert.equal(proposals.length, 1, 'the enquiry keeps one Proposal');
	const conversions = await context.reader.conversionRows(
		seeds.concurrentLeadId
	);
	assert.equal(conversions.length, 1, 'the conversion is recorded once');
	const followups = await context.reader.proposalFollowups(
		firstData.proposal_id
	);
	assert.equal(
		followups.length,
		1,
		'one destination task per source task, even under a race'
	);
	const activities = await context.reader.activityRows(seeds.concurrentLeadId);
	const scheduled = activities.filter(
		(activity) => activity.status === 'Scheduled'
	);
	assert.equal(scheduled.length, 1);
	assert.ok(scheduled[0]?.transferred_followup_id);
}

/**
 * An enquiry with several linked Proposals and no canonical choice is
 * refused with an actionable review conflict. No Proposal is guessed and
 * the prior alternatives stay exactly as they are.
 */
export async function conversionConflictScenario(
	context: ScenarioContext,
	seeds: ConversionSeeds
): Promise<void> {
	const response = await convert(context, seeds.conflictLeadId);
	assert.equal(response.status, 409, `body: ${response.text}`);
	const error = ErrorEnvelopeSchema.parse(response.json());
	assert.equal(error.code, 'conversion_conflict');
	assert.ok(
		error.error.toLowerCase().includes('review'),
		`the refusal points at the review panel: ${error.error}`
	);

	const proposals = await context.reader.proposalRows(seeds.conflictLeadId);
	assert.equal(
		proposals.length,
		2,
		'the prior alternatives stay exactly as they are'
	);
	for (const proposal of proposals) {
		assert.equal(proposal.isDelete, 0);
		assert.equal(proposal.canonical_lead_id, null);
	}
	const conversions = await context.reader.conversionRows(seeds.conflictLeadId);
	assert.equal(conversions.length, 0, 'a refused handoff records no evidence');
	const row = await readLeadRow(context, seeds.conflictLeadId);
	assert.equal(row.enquiry_status, 'Qualified');
	assert.equal(row.canonical_proposal_id, null);
}

/**
 * A deterministic database failure during the handoff rolls the whole
 * handoff back. The retry after the failure creates nothing twice.
 */
export async function conversionRollbackScenario(
	context: ScenarioContext,
	seeds: ConversionSeeds,
	injection: FailureInjection
): Promise<void> {
	const followupsBefore = await context.reader.countProposalFollowups();
	await injection.install();
	try {
		const response = await convert(context, seeds.rollbackLeadId);
		assert.equal(response.status, 500, `body: ${response.text}`);
		const error = ErrorEnvelopeSchema.parse(response.json());
		assert.equal(error.code, 'conversion_failed');
	} finally {
		await injection.remove();
	}

	// Nothing of the handoff survived: no Proposal, no Lead mark, no
	// conversion evidence, no stage change, and no transferred work.
	const proposals = await context.reader.proposalRows(seeds.rollbackLeadId);
	assert.equal(proposals.length, 0, 'the failed handoff left no Proposal');
	const row = await readLeadRow(context, seeds.rollbackLeadId);
	assert.equal(row.enquiry_status, 'Qualified');
	assert.equal(row.canonical_proposal_id, null);
	assert.equal(row.converted_at, null);
	assert.equal(row.converted_by, null);
	const conversions = await context.reader.conversionRows(seeds.rollbackLeadId);
	assert.equal(conversions.length, 0, 'the failed handoff left no evidence');
	const history = await context.reader.stageHistory(seeds.rollbackLeadId);
	assert.equal(
		history.filter((entry) => entry.change_source === 'conversion').length,
		0,
		'the failed handoff left no stage change'
	);
	const activities = await context.reader.activityRows(seeds.rollbackLeadId);
	const scheduled = activities.filter(
		(activity) => activity.status === 'Scheduled'
	);
	assert.equal(scheduled.length, 2, 'the source tasks stayed with the Lead');
	for (const activity of scheduled) {
		assert.equal(
			activity.transferred_followup_id,
			null,
			'the failed handoff transferred no task'
		);
	}
	assert.equal(
		await context.reader.countProposalFollowups(),
		followupsBefore,
		'the failed handoff wrote no Proposal work'
	);

	// The retry after the failure succeeds and creates nothing twice.
	const retry = await convert(context, seeds.rollbackLeadId);
	assert.equal(retry.status, 200, `retry body: ${retry.text}`);
	const data = ConversionEnvelopeSchema.parse(retry.json()).data;
	assert.equal(data.already_converted, false);
	const retryProposals = await context.reader.proposalRows(
		seeds.rollbackLeadId
	);
	assert.equal(retryProposals.length, 1, 'the retry creates one Proposal');
	const retryConversions = await context.reader.conversionRows(
		seeds.rollbackLeadId
	);
	assert.equal(
		retryConversions.length,
		1,
		'the retry records the evidence once'
	);
	const followups = await context.reader.proposalFollowups(data.proposal_id);
	assert.equal(
		followups.length,
		2,
		'one destination task per source task after the retry'
	);
}

/**
 * After the handoff the Lead reads as Converted, the transferred work has
 * left the Lead work queue, and the conversion is on the timeline.
 */
export async function conversionReadAndQueueScenario(
	context: ScenarioContext,
	seeds: ConversionSeeds
): Promise<void> {
	const leadId = seeds.queueLeadId;

	// Before the handoff the scheduled work is in the Lead work queue.
	const before = await context.http.get(
		'/api/leads/work?scope=upcoming&limit=50',
		context.readOnly.sessionToken
	);
	assert.equal(before.status, 200, `work body: ${before.text}`);
	const beforeWork = WorkEnvelopeSchema.parse(before.json()).data.work;
	assert.ok(
		beforeWork.some((item) => item.lead_id === leadId),
		'the scheduled work starts in the Lead work queue'
	);

	const response = await convert(context, leadId);
	assert.equal(response.status, 200, `convert body: ${response.text}`);
	const data = ConversionEnvelopeSchema.parse(response.json()).data;

	// The Lead reads as Converted, with its canonical Proposal.
	const detail = await context.http.get(
		`/api/leads/${leadId}`,
		context.readOnly.sessionToken
	);
	assert.equal(detail.status, 200, `detail body: ${detail.text}`);
	const lead = LeadDetailEnvelopeSchema.parse(detail.json()).data;
	assert.equal(lead.enquiry_status, 'Converted');
	assert.equal(lead.canonical_proposal_id, data.proposal_id);
	assert.equal(
		lead.next_action_date,
		null,
		'the transferred work is no longer the next action of the Lead'
	);

	// The transferred work left the Lead work queue.
	const after = await context.http.get(
		'/api/leads/work?scope=upcoming&limit=50',
		context.readOnly.sessionToken
	);
	assert.equal(after.status, 200, `work body: ${after.text}`);
	const afterWork = WorkEnvelopeSchema.parse(after.json()).data.work;
	assert.ok(
		!afterWork.some((item) => item.lead_id === leadId),
		'the transferred work left the Lead work queue'
	);

	// The conversion is on the timeline of the Lead.
	const timeline = await context.http.get(
		`/api/leads/${leadId}/timeline`,
		context.readOnly.sessionToken
	);
	assert.equal(timeline.status, 200, `timeline body: ${timeline.text}`);
	const entries = TimelineEnvelopeSchema.parse(timeline.json()).data.entries;
	assert.ok(
		entries.some((entry) => entry.title.includes('Converted')),
		'the conversion is on the timeline of the Lead'
	);
}

/** A date the scheduled work of a new enquiry can carry. */
function futureDate(daysAhead: number): string {
	const date = new Date();
	date.setDate(date.getDate() + daysAhead);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A qualified enquiry with the evidence a conversion needs and one
 * scheduled task for the handoff to move.
 */
async function createQualifiedLead(
	context: ScenarioContext,
	companyName: string,
	projectDescription: string
): Promise<number> {
	const created = await context.http.post(
		'/api/leads',
		{
			company_name: companyName,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			phone: '+91 98765 43210',
			project_description: projectDescription,
		},
		context.assignee.sessionToken
	);
	assert.equal(created.status, 200, `create body: ${created.text}`);
	const leadId = z
		.object({ id: z.number() })
		.parse(
			z.object({ data: z.object({ id: z.number() }) }).parse(created.json())
				.data
		).id;
	context.trackLead(leadId);

	const qualified = await context.http.post(
		`/api/leads/${leadId}/stage`,
		{
			action: 'Qualify',
			next_action: {
				activity_type: 'Call',
				scheduled_for: futureDate(4),
				next_action: 'Call about the tender',
			},
		},
		context.assignee.sessionToken
	);
	assert.equal(qualified.status, 200, `qualify body: ${qualified.text}`);
	return leadId;
}

/**
 * The description of the canonical Proposal is an HTML-bound column, so
 * the plain text of the Lead goes through the shared write-path sanitiser
 * (ADR-0012). A payload in the project description never reaches the
 * Proposal.
 */
export async function conversionDescriptionIsSanitisedScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createQualifiedLead(
		context,
		`${context.runTag} Sanitised Co`,
		'<img src=x onerror="alert(1)"><script>alert(2)</script>A plant extension for the Chakan unit'
	);

	const response = await convert(context, leadId, {
		proposal_title: `${context.runTag} Sanitised Proposal`,
	});
	assert.equal(response.status, 200, `convert body: ${response.text}`);
	const data = ConversionEnvelopeSchema.parse(response.json()).data;

	const proposal = await context.reader.proposalRow(data.proposal_id);
	assert.ok(proposal, 'the canonical Proposal is stored');
	const description = proposal.description ?? '';
	assert.ok(
		!description.includes('<'),
		`the stored description carries no markup: ${description}`
	);
	assert.ok(
		!description.includes('onerror'),
		`the stored description carries no event handler: ${description}`
	);
	assert.ok(
		description.includes('A plant extension for the Chakan unit'),
		`the plain text of the Lead survives: ${description}`
	);
}

/**
 * A repeated handoff ends its transaction. The connection goes back to the
 * pool with the lock closed, and the other work on the same pool keeps
 * running.
 */
export async function conversionRepeatEndsTheTransactionScenario(
	context: ScenarioContext
): Promise<void> {
	// Its own enquiry: the repeat of an enquiry another scenario already
	// converted would prove nothing about the transaction of the first
	// handoff.
	const leadId = await createQualifiedLead(
		context,
		`${context.runTag} Repeat Transaction Co`,
		'A plant extension for the Chakan unit'
	);

	const first = await convert(context, leadId);
	assert.equal(first.status, 200, `first body: ${first.text}`);
	const firstData = ConversionEnvelopeSchema.parse(first.json()).data;
	assert.equal(firstData.already_converted, false);

	const second = await convert(context, leadId);
	assert.equal(second.status, 200, `second body: ${second.text}`);
	const secondData = ConversionEnvelopeSchema.parse(second.json()).data;
	assert.equal(secondData.already_converted, true);
	assert.equal(secondData.proposal_id, firstData.proposal_id);

	// The repeat left no open transaction behind: the connection went back
	// to the pool with the lock of the enquiry closed.
	assert.equal(
		await context.reader.countOpenTransactions(),
		0,
		'a repeated handoff leaves no open transaction behind'
	);

	// The other work of the pool keeps running.
	const created = await context.http.post(
		'/api/leads',
		{
			company_name: `${context.runTag} After Repeat Co`,
			contact_name: 'Cleo Client',
			contact_email: 'cleo@example.com',
			project_description: 'A plant extension for the workshop',
		},
		context.assignee.sessionToken
	);
	assert.equal(created.status, 200, `create body: ${created.text}`);
	const list = await context.http.get(
		'/api/leads/list?search=After%20Repeat&limit=10',
		context.readOnly.sessionToken
	);
	assert.equal(list.status, 200, `list body: ${list.text}`);
	assert.equal(
		await context.reader.countOpenTransactions(),
		0,
		'the other work of the pool leaves no open transaction behind'
	);
}

/**
 * The transferred work links in both directions: the source activity names
 * its destination, and the destination names the Lead activity it came
 * from.
 */
export async function conversionTransferredWorkLinkScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createQualifiedLead(
		context,
		`${context.runTag} Two Way Link Co`,
		'A plant extension for the Chakan unit'
	);

	const response = await convert(context, leadId, {
		proposal_title: `${context.runTag} Two Way Link Proposal`,
	});
	assert.equal(response.status, 200, `convert body: ${response.text}`);
	const data = ConversionEnvelopeSchema.parse(response.json()).data;

	const activities = await context.reader.activityRows(leadId);
	const scheduled = activities.filter(
		(activity) => activity.status === 'Scheduled'
	);
	assert.equal(scheduled.length, 1, 'the enquiry had one scheduled task');
	const source = scheduled[0];
	assert.ok(
		source?.transferred_followup_id,
		'the source names its destination'
	);

	const followups = await context.reader.proposalFollowups(data.proposal_id);
	assert.equal(followups.length, 1, 'the Proposal inherited one task');
	assert.equal(
		followups[0]?.id,
		source.transferred_followup_id,
		'the destination is the task the source names'
	);
	assert.equal(
		followups[0]?.source_lead_activity_id,
		source.id,
		'the destination names the Lead activity it came from'
	);
}

/**
 * The migration backfills the rows that already carry a transferred work
 * link: a Proposal follow-up a Lead activity already points at gets its
 * source.
 */
export async function conversionBackfilledSourceLinkScenario(
	context: ScenarioContext,
	seed: { proposalId: number; followupId: number; activityId: number }
): Promise<void> {
	assert.ok(seed.proposalId > 0, 'the backfill Proposal is stored');
	assert.ok(seed.followupId > 0, 'the backfill follow-up is stored');
	assert.ok(seed.activityId > 0, 'the backfill activity is stored');
	const followups = await context.reader.proposalFollowups(seed.proposalId);
	const backfilled = followups.find(
		(followup) => followup.id === seed.followupId
	);
	assert.ok(backfilled, 'the transferred work is stored');
	assert.equal(
		backfilled.source_lead_activity_id,
		seed.activityId,
		'the migration backfilled the source of the transferred work'
	);
}

/**
 * The super admin converts a Lead without the three grants and reads the
 * downstream Proposal details.
 */
export async function superAdminConversionScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createQualifiedLead(
		context,
		`${context.runTag} Super Admin Co`,
		'A plant extension for the Chakan unit'
	);

	const response = await convert(
		context,
		leadId,
		{ proposal_title: `${context.runTag} Super Admin Proposal` },
		context.superAdmin.sessionToken
	);
	assert.equal(response.status, 200, `convert body: ${response.text}`);
	const data = ConversionEnvelopeSchema.parse(response.json()).data;
	assert.equal(data.already_converted, false);

	// The super admin reads the downstream Proposal of the enquiry.
	const detail = await context.http.get(
		`/api/leads/${leadId}`,
		context.superAdmin.sessionToken
	);
	assert.equal(detail.status, 200, `detail body: ${detail.text}`);
	const lead = z
		.object({
			success: z.literal(true),
			data: z.object({
				enquiry_status: z.string().nullable(),
				canonical_proposal_id: z.number().nullable(),
				proposal_progress: z
					.object({
						state: z.string(),
						proposal: z
							.object({
								id: z.number(),
								title: z.string().nullable(),
							})
							.nullable(),
					})
					.nullable(),
			}),
		})
		.parse(detail.json()).data;
	assert.equal(lead.enquiry_status, 'Converted');
	assert.equal(lead.canonical_proposal_id, data.proposal_id);
	assert.equal(lead.proposal_progress?.state, 'available');
	assert.equal(lead.proposal_progress?.proposal?.id, data.proposal_id);
	assert.equal(
		lead.proposal_progress?.proposal?.title,
		`${context.runTag} Super Admin Proposal`
	);
}

/**
 * The handoff needs the Lead convert right, the Lead update right, and the
 * right to create Proposals. Each grant is isolated: a user who has the
 * other two is still refused, and the refusal writes nothing.
 */
export async function conversionPermissionIsolationScenario(
	context: ScenarioContext,
	seeds: ConversionSeeds
): Promise<void> {
	const leadId = seeds.qualifiedLeadId;

	// The Lead convert right and the Proposal create right, no Lead update.
	const withoutUpdate = await convert(
		context,
		leadId,
		{},
		context.convertOnly.sessionToken
	);
	assert.equal(withoutUpdate.status, 403, `denied body: ${withoutUpdate.text}`);

	// The Lead update right and the Proposal create right, no Lead convert.
	const withoutConvert = await convert(
		context,
		leadId,
		{},
		context.updateOnly.sessionToken
	);
	assert.equal(
		withoutConvert.status,
		403,
		`denied body: ${withoutConvert.text}`
	);

	// Nothing was written by either refusal.
	const proposals = await context.reader.proposalRows(leadId);
	assert.equal(proposals.length, 0, 'a refused handoff creates no Proposal');
	const conversions = await context.reader.conversionRows(leadId);
	assert.equal(conversions.length, 0, 'a refused handoff records no evidence');
	const row = await readLeadRow(context, leadId);
	assert.equal(row.enquiry_status, 'Qualified');
	assert.equal(row.canonical_proposal_id, null);
	assert.equal(row.converted_at, null);
}
