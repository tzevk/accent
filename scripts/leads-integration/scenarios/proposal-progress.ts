import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';

/**
 * The downstream progress of a converted Lead (ticket #376).
 *
 * A converted Lead keeps its chronological Lead history and points at the
 * Proposal that replaced it. Every scenario asserts the HTTP response and
 * the persisted rows through the independent reader: the Proposal state,
 * the later Project linkage, the completed history, the reader who may not
 * read the downstream details, and the sales work that stays on the
 * Proposal.
 *
 * The scenarios spread their requests over the fixture sessions because the
 * application rate-limits every session at 120 API requests a minute: the
 * writes use the assignee and the proposer, the read-backs use the
 * read-only session.
 */

/**
 * The enquiries the scenarios work on: one without a Proposal, one whose
 * canonical Proposal is unresolved, one qualified enquiry the current-state
 * proof converts, and one qualified enquiry the Project linkage proof
 * converts.
 */
export interface ProposalProgressSeeds {
	missingLeadId: number;
	unresolvedLeadId: number;
	currentLeadId: number;
	projectLeadId: number;
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
		already_converted: z.boolean(),
	}),
});

const LeadDetailEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		id: z.number(),
		enquiry_status: z.string().nullable(),
		canonical_proposal_id: z.number().nullable(),
		activity_count: z.number(),
		next_action_date: z.string().nullable(),
		proposal_progress: z.object({
			state: z.enum(['none', 'unresolved', 'restricted', 'available']),
			proposal: z
				.object({
					id: z.number(),
					title: z.string().nullable(),
					status: z.string().nullable(),
					progress: z.number().nullable(),
					value: z.string().nullable(),
					currency: z.string().nullable(),
					next_action: z
						.object({
							date: z.string().nullable(),
							type: z.string().nullable(),
							description: z.string().nullable(),
						})
						.nullable(),
					project_state: z.enum(['none', 'restricted', 'available']),
					project: z
						.object({
							id: z.number(),
							title: z.string().nullable(),
							status: z.string().nullable(),
							progress: z.number().nullable(),
						})
						.nullable(),
				})
				.nullable(),
		}),
	}),
});

const TimelineEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		entries: z.array(
			z.object({
				key: z.string(),
				kind: z.string(),
				status: z.string().nullable(),
			})
		),
	}),
});

/** The Lead detail read of one enquiry, as a reader sees it. */
async function readLeadDetail(
	context: ScenarioContext,
	leadId: number,
	sessionToken: string
) {
	const response = await context.http.get(`/api/leads/${leadId}`, sessionToken);
	assert.equal(response.status, 200, `detail body: ${response.text}`);
	return {
		lead: LeadDetailEnvelopeSchema.parse(response.json()).data,
		body: response.text,
	};
}

/** The Lead-to-Proposal handoff of one enquiry. */
async function convertLead(
	context: ScenarioContext,
	leadId: number,
	proposalTitle: string
): Promise<number> {
	const response = await context.http.post(
		`/api/leads/${leadId}/convert`,
		{ proposal_title: proposalTitle },
		context.assignee.sessionToken
	);
	assert.equal(response.status, 200, `convert body: ${response.text}`);
	return ConversionEnvelopeSchema.parse(response.json()).data.proposal_id;
}

/**
 * An enquiry without a Proposal has no downstream details at all, and the
 * Lead itself stays readable.
 */
export async function proposalProgressMissingScenario(
	context: ScenarioContext,
	seeds: ProposalProgressSeeds
): Promise<void> {
	const { lead } = await readLeadDetail(
		context,
		seeds.missingLeadId,
		context.readOnly.sessionToken
	);
	assert.equal(lead.proposal_progress.state, 'none');
	assert.equal(lead.proposal_progress.proposal, null);
	assert.equal(lead.canonical_proposal_id, null);
}

/**
 * An enquiry with several linked Proposals and no canonical choice stays
 * unresolved: no Proposal is guessed, and the alternatives stay exactly as
 * they are.
 */
export async function proposalProgressUnresolvedScenario(
	context: ScenarioContext,
	seeds: ProposalProgressSeeds
): Promise<void> {
	const { lead } = await readLeadDetail(
		context,
		seeds.unresolvedLeadId,
		context.readOnly.sessionToken
	);
	assert.equal(lead.proposal_progress.state, 'unresolved');
	assert.equal(lead.proposal_progress.proposal, null);

	const proposals = await context.reader.proposalRows(seeds.unresolvedLeadId);
	assert.equal(
		proposals.length,
		2,
		'the alternatives stay exactly as they are'
	);
	for (const proposal of proposals) {
		assert.equal(proposal.canonical_lead_id, null);
	}
}

/**
 * The current state of the canonical Proposal reaches the Lead detail
 * read, and the completed history of the Lead stays visible next to it.
 */
export async function proposalProgressCurrentStateScenario(
	context: ScenarioContext,
	seeds: ProposalProgressSeeds
): Promise<void> {
	const leadId = seeds.currentLeadId;
	const proposalTitle = `${context.runTag} Progress Proposal`;
	const proposalId = await convertLead(context, leadId, proposalTitle);

	// The Proposal moves on: its own status and its own progress. The
	// Proposal revision route writes the fields of the form, so the title
	// travels with them.
	const updated = await context.http.put(
		`/api/proposals/${proposalId}`,
		{
			proposal_title: proposalTitle,
			status: 'SENT',
			progress: 45,
			proposal_value: '250000.00',
		},
		context.proposer.sessionToken
	);
	assert.equal(updated.status, 200, `proposal body: ${updated.text}`);

	// The Lead detail read states the current state of the Proposal.
	const { lead } = await readLeadDetail(
		context,
		leadId,
		context.proposer.sessionToken
	);
	assert.equal(lead.enquiry_status, 'Converted');
	assert.equal(lead.canonical_proposal_id, proposalId);
	assert.equal(lead.proposal_progress.state, 'available');
	const proposal = lead.proposal_progress.proposal;
	assert.ok(proposal, 'the canonical Proposal is exposed');
	assert.equal(proposal.id, proposalId);
	assert.equal(proposal.title, proposalTitle);
	assert.equal(proposal.status, 'SENT');
	assert.equal(proposal.progress, 45);
	assert.equal(proposal.value, '250000.00');
	assert.equal(proposal.project_state, 'none');
	assert.equal(proposal.project, null);

	// The next action of the converted Lead is the next action of the
	// Proposal, and the Lead itself has no Lead-side next action.
	assert.ok(proposal.next_action, 'the Proposal states its next action');
	assert.equal(proposal.next_action.type, 'Call');
	assert.equal(proposal.next_action.description, 'Call about the tender');
	assert.equal(
		lead.next_action_date,
		null,
		'the Lead has no Lead-side next action after the handoff'
	);

	// The completed history of the Lead stays visible.
	assert.equal(lead.activity_count, 1, 'the completed activity stays counted');
	const timeline = await context.http.get(
		`/api/leads/${leadId}/timeline`,
		context.readOnly.sessionToken
	);
	assert.equal(timeline.status, 200, `timeline body: ${timeline.text}`);
	const entries = TimelineEnvelopeSchema.parse(timeline.json()).data.entries;
	assert.ok(
		entries.some(
			(entry) => entry.kind === 'activity' && entry.status === 'Completed'
		),
		'the completed activity stays on the timeline of the Lead'
	);

	// The persisted Proposal agrees with the read.
	const stored = await context.reader.proposalRow(proposalId);
	assert.ok(stored, 'the canonical Proposal is stored');
	assert.equal(stored.status, 'SENT');
	assert.equal(stored.progress, '45.00');
	assert.equal(stored.canonical_lead_id, leadId);
}

/**
 * When the Proposal later links to a Project, the Lead exposes that link
 * under the Project read permission, resolved through the canonical link.
 */
export async function proposalProgressProjectLinkScenario(
	context: ScenarioContext,
	seeds: ProposalProgressSeeds
): Promise<void> {
	const leadId = seeds.projectLeadId;
	const proposalId = await convertLead(
		context,
		leadId,
		`${context.runTag} Project Proposal`
	);

	// The Proposal later becomes a Project, with the app's own conversion.
	const converted = await context.http.post(
		'/api/proposals/convert',
		{ proposalId },
		context.proposer.sessionToken
	);
	assert.ok(
		converted.status === 200 || converted.status === 201,
		`convert body: ${converted.text}`
	);

	// The Lead detail read exposes the Project of the Proposal.
	const { lead } = await readLeadDetail(
		context,
		leadId,
		context.proposer.sessionToken
	);
	assert.equal(lead.proposal_progress.state, 'available');
	const proposal = lead.proposal_progress.proposal;
	assert.ok(proposal, 'the canonical Proposal is exposed');
	assert.equal(proposal.project_state, 'available');
	const project = proposal.project;
	assert.ok(project, 'the Project of the Proposal is exposed');
	assert.ok(project.id > 0);

	// The link is the stored one: the Proposal names the Project and the
	// Project names the Proposal.
	const stored = await context.reader.proposalRow(proposalId);
	assert.ok(stored, 'the canonical Proposal is stored');
	assert.equal(stored.project_id, project.id);
	const storedProject = await context.reader.projectRow(project.id);
	assert.ok(storedProject, 'the Project is stored');
	assert.equal(storedProject.proposal_id, proposalId);
	assert.equal(storedProject.isDelete, 0);
}

/**
 * A reader who may only read Leads gets the Lead, its history, and the
 * restricted marker: no Proposal title, status, value, or Project
 * information.
 */
export async function proposalProgressRestrictedScenario(
	context: ScenarioContext,
	seeds: ProposalProgressSeeds
): Promise<void> {
	const { lead, body } = await readLeadDetail(
		context,
		seeds.currentLeadId,
		context.readOnly.sessionToken
	);
	assert.equal(lead.proposal_progress.state, 'restricted');
	assert.equal(lead.proposal_progress.proposal, null);

	// The Lead and its history stay visible.
	assert.equal(lead.enquiry_status, 'Converted');
	assert.equal(lead.activity_count, 1);
	assert.ok(lead.canonical_proposal_id);

	// No downstream detail crosses the read permission.
	assert.ok(!body.includes('Progress Proposal'), 'no Proposal title leaks');
	assert.ok(!body.includes('"SENT"'), 'no Proposal status leaks');
	assert.ok(!body.includes('250000'), 'no Proposal value leaks');
	assert.ok(!body.includes('proposal_value'), 'no Proposal value leaks');
}

/**
 * The sales work of a converted enquiry stays on the Proposal: the Lead
 * refuses new Lead-side work, and the transferred task is Proposal work.
 */
export async function proposalProgressWorkOnProposalScenario(
	context: ScenarioContext,
	seeds: ProposalProgressSeeds
): Promise<void> {
	const leadId = seeds.currentLeadId;

	// The Lead refuses new sales work.
	const activity = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{ activity_type: 'Call', call_outcome: 'Connected' },
		context.assignee.sessionToken
	);
	assert.equal(activity.status, 409, `activity body: ${activity.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(activity.json()).code,
		'lead_converted'
	);
	const task = await context.http.post(
		`/api/leads/${leadId}/tasks`,
		{ activity_type: 'Call', scheduled_for: '2026-12-01' },
		context.assignee.sessionToken
	);
	assert.equal(task.status, 409, `task body: ${task.text}`);
	assert.equal(ErrorEnvelopeSchema.parse(task.json()).code, 'lead_converted');

	// The work sits on the Proposal.
	const { lead } = await readLeadDetail(
		context,
		leadId,
		context.readOnly.sessionToken
	);
	const proposalId = lead.canonical_proposal_id;
	assert.ok(proposalId, 'the enquiry names its canonical Proposal');
	const followups = await context.reader.proposalFollowups(proposalId);
	assert.equal(followups.length, 1, 'the Proposal holds the scheduled work');
	assert.equal(followups[0]?.status, 'Scheduled');
	assert.equal(followups[0]?.follow_up_type, 'Call');
	assert.equal(followups[0]?.description, 'Call about the tender');

	// The Lead keeps the trace of the handoff and no outstanding work.
	const activities = await context.reader.activityRows(leadId);
	const scheduled = activities.filter(
		(activity) => activity.status === 'Scheduled'
	);
	assert.equal(scheduled.length, 1);
	assert.ok(
		scheduled[0]?.transferred_followup_id,
		'the source task keeps the link to its destination'
	);
	assert.equal(
		scheduled[0]?.transferred_followup_id,
		followups[0]?.id,
		'the destination is the Proposal work'
	);
}
