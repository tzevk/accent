import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';
import { parseLeadDetail, parseLeadListRow } from '../client.ts';

/**
 * The legacy review flow over real HTTP: what the cutover left unresolved,
 * what a permitted reviewer may decide, and what a refused decision must
 * leave untouched. Every assertion is checked against the persisted rows
 * through the independent reader.
 */

const DetailEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.unknown(),
});

const ListEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		leads: z.array(z.unknown()),
		stats: z.unknown().optional(),
		pagination: z.unknown().optional(),
	}),
});

const ReviewEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		review_type: z.string(),
		resolved_value: z.string().nullable(),
		resolved_reference: z.number().nullable(),
		legacy_review_required: z.boolean(),
		open_items: z.array(
			z.object({
				type: z.string(),
				label: z.string(),
				original_value: z.string().nullable(),
			})
		),
	}),
});

const ErrorEnvelopeSchema = z.object({
	success: z.literal(false),
	error: z.string(),
	code: z.string().optional(),
});

export interface LegacyReviewSeeds {
	/** Lead whose owner name matched exactly one active user. */
	cleanLeadId: number;
	/** Lead whose owner name matched two active users. */
	ambiguousOwnerLeadId: number;
	/** Lead with two linked Proposals. */
	conflictLeadId: number;
	conflictProposalIds: number[];
	/** Lead with exactly one linked Proposal. */
	singleLinkLeadId: number;
	singleLinkProposalId: number;
}

async function detailLead(context: ScenarioContext, leadId: number) {
	const response = await context.http.get(
		`/api/leads/${leadId}`,
		context.creator.sessionToken
	);
	assert.equal(response.status, 200, `detail status (body: ${response.text})`);
	return parseLeadDetail(DetailEnvelopeSchema.parse(response.json()).data);
}

async function resolve(
	context: ScenarioContext,
	leadId: number,
	body: Record<string, unknown>,
	sessionToken: string
) {
	return context.http.post(`/api/leads/${leadId}/review`, body, sessionToken);
}

export async function legacyReviewQueueScenario(
	context: ScenarioContext,
	seeds: LegacyReviewSeeds
): Promise<void> {
	// The duplicated enquiry keeps both Proposals and stays visibly
	// unresolved: no canonical Proposal was guessed.
	const conflict = await detailLead(context, seeds.conflictLeadId);
	assert.ok(conflict.review, 'the lead carries its review state');
	assert.equal(conflict.review.proposal_link_conflict, true);
	assert.equal(conflict.review.canonical_proposal_id, null);
	assert.deepEqual(
		conflict.review.linked_proposals.map((proposal) => proposal.id).sort(),
		[...seeds.conflictProposalIds].sort(),
		'both linked Proposals stay visible'
	);
	const openTypes = conflict.review.open_items.map((item) => item.type);
	assert.ok(openTypes.includes('proposal_link'));
	assert.ok(openTypes.includes('stage'));
	assert.ok(openTypes.includes('owner'));
	const stageItem = conflict.review.open_items.find(
		(item) => item.type === 'stage'
	);
	assert.equal(
		stageItem?.original_value,
		'Converted to Proposal',
		'the original stage label is kept verbatim'
	);
	assert.equal(conflict.review.unknown_facts.stage_entry_date, 'unknown');
	assert.equal(conflict.review.unknown_facts.original_author, 'unknown');
	assert.equal(conflict.review.unknown_facts.original_outcome, 'unknown');

	const conflictRow = await context.reader.leadRow(seeds.conflictLeadId);
	assert.ok(conflictRow);
	assert.equal(conflictRow.legacy_proposal_conflict, 1);
	assert.equal(conflictRow.canonical_proposal_id, null);
	assert.equal(conflictRow.legacy_review_required, 1);
	assert.equal(
		conflictRow.legacy_stage,
		'Converted to Proposal',
		'the stored stage survives the cutover'
	);

	// A single linked Proposal is evidence-backed: the cutover resolved it
	// without a reviewer and recorded why.
	const single = await detailLead(context, seeds.singleLinkLeadId);
	assert.equal(
		single.review?.canonical_proposal_id,
		seeds.singleLinkProposalId,
		'the only linked Proposal becomes the canonical one'
	);
	assert.equal(single.review?.proposal_link_conflict, false);
	const automatic = single.review?.resolutions.find(
		(resolution) => resolution.review_type === 'proposal_link'
	);
	assert.ok(automatic, 'the automatic cutover decision is recorded');
	assert.equal(automatic.resolution_source, 'automatic');
	assert.equal(automatic.reviewer_user_id, null);

	// An ambiguous owner name stays unresolved with its original value.
	const ambiguous = await detailLead(context, seeds.ambiguousOwnerLeadId);
	assert.equal(ambiguous.owner_user_id, null);
	assert.equal(ambiguous.legacy_review_required, true);
	const ownerItem = ambiguous.review?.open_items.find(
		(item) => item.type === 'owner'
	);
	assert.ok(ownerItem, 'the ambiguous owner is an open review item');
	assert.equal(
		ownerItem.original_value,
		ambiguous.legacy_owner_name,
		'the original owner name is kept verbatim'
	);

	// A reader without Proposal access sees no Proposal details.
	const restricted = await context.http.get(
		`/api/leads/${seeds.conflictLeadId}`,
		context.readOnly.sessionToken
	);
	assert.equal(restricted.status, 200);
	const restrictedLead = parseLeadDetail(
		DetailEnvelopeSchema.parse(restricted.json()).data
	);
	assert.deepEqual(
		restrictedLead.review?.linked_proposals,
		[],
		'no Proposal detail leaks without the Proposal read right'
	);
	assert.ok(
		(restrictedLead.review?.open_items.length ?? 0) > 0,
		'the review state itself stays visible'
	);

	// The review queue lists the unresolved Leads and leaves the resolved one.
	const reviewList = await context.http.get(
		`/api/leads/list?search=${encodeURIComponent(context.runTag)}&review=1&limit=100`,
		context.creator.sessionToken
	);
	assert.equal(
		reviewList.status,
		200,
		`review list (body: ${reviewList.text})`
	);
	const reviewIds = ListEnvelopeSchema.parse(reviewList.json())
		.data.leads.map(parseLeadListRow)
		.map((row) => row.id);
	assert.ok(reviewIds.includes(seeds.conflictLeadId));
	assert.ok(reviewIds.includes(seeds.ambiguousOwnerLeadId));
	assert.ok(
		!reviewIds.includes(seeds.cleanLeadId),
		'the evidence-backed mapping leaves the review queue'
	);
}

export async function legacyReviewDeniedScenario(
	context: ScenarioContext,
	seeds: LegacyReviewSeeds
): Promise<void> {
	const before = await context.reader.reviewRows(seeds.conflictLeadId);
	const beforeRow = await context.reader.leadRow(seeds.conflictLeadId);

	// A reader without the Lead update right cannot resolve a stage.
	const noUpdate = await resolve(
		context,
		seeds.conflictLeadId,
		{ review_type: 'stage', resolution: 'Qualified', reason: 'not allowed' },
		context.readOnly.sessionToken
	);
	assert.equal(noUpdate.status, 403, `denied body: ${noUpdate.text}`);

	// A user without the assignment right cannot resolve an owner.
	const noAssign = await resolve(
		context,
		seeds.conflictLeadId,
		{
			review_type: 'owner',
			resolution: context.assignee.id,
			reason: 'not allowed',
		},
		context.noAssign.sessionToken
	);
	assert.equal(noAssign.status, 403, `denied body: ${noAssign.text}`);

	// The canonical Proposal decision needs the Lead update right too.
	const noLeadUpdate = await resolve(
		context,
		seeds.conflictLeadId,
		{
			review_type: 'proposal_link',
			resolution: seeds.conflictProposalIds[0],
			reason: 'not allowed',
		},
		context.proposer.sessionToken
	);
	assert.equal(noLeadUpdate.status, 403, `denied body: ${noLeadUpdate.text}`);

	// An anonymous request is not authorized at all.
	const anonymous = await context.http.post(
		`/api/leads/${seeds.conflictLeadId}/review`,
		{
			review_type: 'stage',
			resolution: 'Qualified',
			reason: 'not allowed',
		}
	);
	assert.equal(anonymous.status, 401, `anonymous body: ${anonymous.text}`);

	// Nothing was persisted by any refused resolution.
	const after = await context.reader.reviewRows(seeds.conflictLeadId);
	assert.deepEqual(
		after.map((row) => row.id),
		before.map((row) => row.id),
		'a refused resolution writes no decision'
	);
	const afterRow = await context.reader.leadRow(seeds.conflictLeadId);
	assert.equal(afterRow?.enquiry_status, beforeRow?.enquiry_status);
	assert.equal(afterRow?.owner_user_id, beforeRow?.owner_user_id);
	assert.equal(
		afterRow?.canonical_proposal_id,
		beforeRow?.canonical_proposal_id
	);
	assert.equal(afterRow?.legacy_review_required, 1);
}

export async function legacyReviewInvalidScenario(
	context: ScenarioContext,
	seeds: LegacyReviewSeeds
): Promise<void> {
	const before = await context.reader.reviewRows(seeds.conflictLeadId);

	// An active stage needs a resolved owner first.
	const activeWithoutOwner = await resolve(
		context,
		seeds.conflictLeadId,
		{
			review_type: 'stage',
			resolution: 'Qualified',
			reason: 'Seen as qualified on the call.',
		},
		context.creator.sessionToken
	);
	assert.equal(
		activeWithoutOwner.status,
		409,
		`active stage body: ${activeWithoutOwner.text}`
	);
	assert.equal(
		ErrorEnvelopeSchema.parse(activeWithoutOwner.json()).code,
		'owner_required'
	);

	// A stage label outside the canonical vocabulary is refused.
	const unknownStage = await resolve(
		context,
		seeds.conflictLeadId,
		{
			review_type: 'stage',
			resolution: 'Attempting contact',
			reason: 'Guessing the stage.',
		},
		context.creator.sessionToken
	);
	assert.equal(
		unknownStage.status,
		422,
		`unknown stage body: ${unknownStage.text}`
	);

	// Conversion is not a review decision.
	const converted = await resolve(
		context,
		seeds.conflictLeadId,
		{
			review_type: 'stage',
			resolution: 'Converted',
			reason: 'Looks converted.',
		},
		context.creator.sessionToken
	);
	assert.equal(converted.status, 409, `conversion body: ${converted.text}`);

	// A Proposal that is not linked to this Lead cannot become its canonical.
	const foreignProposal = await resolve(
		context,
		seeds.conflictLeadId,
		{
			review_type: 'proposal_link',
			resolution: seeds.singleLinkProposalId,
			reason: 'Wrong enquiry.',
		},
		context.creator.sessionToken
	);
	assert.equal(
		foreignProposal.status,
		422,
		`foreign proposal body: ${foreignProposal.text}`
	);
	assert.equal(
		ErrorEnvelopeSchema.parse(foreignProposal.json()).code,
		'proposal_not_linked'
	);

	// A decision without a reason is refused.
	const noReason = await resolve(
		context,
		seeds.conflictLeadId,
		{
			review_type: 'stage',
			resolution: 'Qualified',
		},
		context.creator.sessionToken
	);
	assert.equal(noReason.status, 422, `no reason body: ${noReason.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(noReason.json()).code,
		'reason_required'
	);

	const after = await context.reader.reviewRows(seeds.conflictLeadId);
	assert.deepEqual(
		after.map((row) => row.id),
		before.map((row) => row.id),
		'an invalid resolution writes no decision'
	);
}

export async function legacyReviewResolutionScenario(
	context: ScenarioContext,
	seeds: LegacyReviewSeeds
): Promise<void> {
	const reason = `Reviewed from the ${context.runTag} roster.`;

	// The owner decision: the reviewer names the person behind the legacy
	// display name.
	const ownerResponse = await resolve(
		context,
		seeds.conflictLeadId,
		{
			review_type: 'owner',
			resolution: context.assignee.id,
			reason,
		},
		context.creator.sessionToken
	);
	assert.equal(
		ownerResponse.status,
		200,
		`owner resolution body: ${ownerResponse.text}`
	);
	const ownerResult = ReviewEnvelopeSchema.parse(ownerResponse.json()).data;
	assert.equal(ownerResult.review_type, 'owner');
	assert.equal(ownerResult.resolved_reference, context.assignee.id);
	assert.equal(ownerResult.legacy_review_required, true);

	const afterOwner = await detailLead(context, seeds.conflictLeadId);
	assert.equal(afterOwner.owner_user_id, context.assignee.id);
	assert.equal(afterOwner.owner_name, context.assignee.fullName);
	assert.equal(
		afterOwner.legacy_owner_name,
		'Nobody ' + context.runTag,
		'the original owner name stays visible'
	);

	// The stage decision can follow now that the owner is resolved.
	const stageResponse = await resolve(
		context,
		seeds.conflictLeadId,
		{
			review_type: 'stage',
			resolution: 'Qualified',
			reason,
		},
		context.creator.sessionToken
	);
	assert.equal(
		stageResponse.status,
		200,
		`stage resolution body: ${stageResponse.text}`
	);
	const afterStage = await detailLead(context, seeds.conflictLeadId);
	assert.equal(afterStage.enquiry_status, 'Qualified');
	assert.equal(
		afterStage.legacy_stage,
		'Converted to Proposal',
		'the original stage label is still stored'
	);

	// The canonical Proposal decision: one of the two duplicates is chosen
	// and the other stays linked.
	const chosen = seeds.conflictProposalIds[0];
	const proposalResponse = await resolve(
		context,
		seeds.conflictLeadId,
		{
			review_type: 'proposal_link',
			resolution: chosen,
			reason,
		},
		context.creator.sessionToken
	);
	assert.equal(
		proposalResponse.status,
		200,
		`proposal resolution body: ${proposalResponse.text}`
	);

	const afterProposal = await detailLead(context, seeds.conflictLeadId);
	assert.equal(afterProposal.review?.canonical_proposal_id, chosen);
	assert.deepEqual(
		afterProposal.review?.linked_proposals.map((proposal) => proposal.id),
		seeds.conflictProposalIds,
		'both Proposals stay linked to the enquiry'
	);
	assert.equal(
		afterProposal.review?.linked_proposals.filter(
			(proposal) => proposal.is_canonical
		).length,
		1,
		'exactly one Proposal is the canonical one'
	);
	assert.equal(afterProposal.review?.proposal_link_conflict, true);
	assert.equal(
		afterProposal.legacy_review_required,
		false,
		'a resolved Lead leaves the review queue'
	);

	// The decisions are auditable: original value, resolution, reviewer, time.
	const reviewRows = await context.reader.reviewRows(seeds.conflictLeadId);
	assert.equal(reviewRows.length, 3);
	const ownerRow = reviewRows.find((row) => row.review_type === 'owner');
	assert.ok(ownerRow);
	assert.equal(ownerRow.original_value, 'Nobody ' + context.runTag);
	assert.equal(ownerRow.resolved_reference, context.assignee.id);
	assert.equal(ownerRow.reason, reason);
	assert.equal(ownerRow.reviewer_user_id, context.creator.id);
	assert.equal(ownerRow.resolution_source, 'reviewer');
	assert.ok(ownerRow.resolved_at, 'the decision carries its time');
	const stageRow = reviewRows.find((row) => row.review_type === 'stage');
	assert.ok(stageRow);
	assert.equal(stageRow.original_value, 'Converted to Proposal');
	assert.equal(stageRow.resolved_value, 'Qualified');
	const proposalRow = reviewRows.find(
		(row) => row.review_type === 'proposal_link'
	);
	assert.ok(proposalRow);
	assert.equal(
		proposalRow.original_value,
		seeds.conflictProposalIds.join(', '),
		'the original Proposal evidence is kept'
	);
	assert.equal(proposalRow.resolved_reference, chosen);
	assert.equal(proposalRow.reviewer_user_id, context.creator.id);

	// The ownership history records the reviewer as the actor.
	const ownership = await context.reader.ownershipHistory(seeds.conflictLeadId);
	const latest = ownership[ownership.length - 1];
	assert.ok(latest);
	assert.equal(latest.owner_user_id, context.assignee.id);
	assert.equal(latest.actor_user_id, context.creator.id);

	// The duplicate Proposal was not deleted or unlinked.
	const proposals = await context.reader.proposalRows(seeds.conflictLeadId);
	assert.equal(proposals.length, 2);
	assert.equal(
		proposals.filter((proposal) => proposal.isDelete === 0).length,
		2
	);

	// A resolved Lead stays discoverable in the operational results.
	const list = await context.http.get(
		`/api/leads/list?search=${encodeURIComponent(context.runTag)}&limit=100`,
		context.creator.sessionToken
	);
	assert.equal(list.status, 200);
	const rows = ListEnvelopeSchema.parse(list.json()).data.leads.map(
		parseLeadListRow
	);
	const resolvedRow = rows.find((row) => row.id === seeds.conflictLeadId);
	assert.ok(resolvedRow, 'the resolved Lead stays in the Lead list');
	assert.equal(resolvedRow.enquiry_status, 'Qualified');
	assert.equal(resolvedRow.legacy_review_required, false);

	const statsResponse = await context.http.get(
		'/api/leads/list?limit=1',
		context.creator.sessionToken
	);
	const stats = ListEnvelopeSchema.parse(statsResponse.json()).data
		.stats as Record<string, number>;
	assert.ok(
		(stats.stage_qualified ?? 0) >= 1,
		'the resolved Lead counts under its stage'
	);
}

export async function proposalLinkEditScenario(
	context: ScenarioContext,
	seeds: LegacyReviewSeeds
): Promise<void> {
	// A Proposal without a Lead link.
	const created = await context.http.post(
		'/api/proposals',
		{ proposal_title: `${context.runTag} editable proposal` },
		context.proposer.sessionToken
	);
	assert.equal(created.status, 200, `create body: ${created.text}`);
	const proposalId = Number(
		z
			.object({ id: z.number() })
			.passthrough()
			.parse(
				z
					.object({ data: z.object({ id: z.number() }) })
					.passthrough()
					.parse(created.json()).data
			).id
	);

	// An edit that does not carry the Lead link keeps the link of a
	// Proposal that has one.
	const editLinked = await context.http.put(
		`/api/proposals/${seeds.singleLinkProposalId}`,
		{ proposal_title: `${context.runTag} renamed linked proposal` },
		context.proposer.sessionToken
	);
	// The edit carries no Lead link, and the link survives it.
	assert.equal(editLinked.status, 200, `edit body: ${editLinked.text}`);
	const linked = await context.reader.proposalRows(seeds.singleLinkLeadId);
	assert.equal(linked.length, 1);
	assert.equal(
		linked[0]?.lead_id,
		seeds.singleLinkLeadId,
		'an unrelated edit keeps the Lead link'
	);

	// A Proposal cannot move to an enquiry that already has a linked
	// Proposal.
	const moveToOccupied = await context.http.put(
		`/api/proposals/${proposalId}`,
		{
			proposal_title: `${context.runTag} editable proposal`,
			lead_id: seeds.singleLinkLeadId,
		},
		context.proposer.sessionToken
	);
	assert.equal(moveToOccupied.status, 409, `move body: ${moveToOccupied.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(moveToOccupied.json()).code,
		'proposal_link_conflict'
	);
	const untouched = await context.reader.proposalRows(seeds.singleLinkLeadId);
	assert.equal(untouched.length, 1, 'the occupied enquiry keeps one Proposal');

	// A Proposal may move to an enquiry that has none, and it becomes the
	// canonical Proposal of that enquiry.
	const newLead = await context.http.post(
		'/api/leads',
		{
			company_name: `${context.runTag} Edit Target Co`,
			project_description: `${context.runTag} edit target need`,
		},
		context.creator.sessionToken
	);
	assert.equal(newLead.status, 200, `lead body: ${newLead.text}`);
	const newLeadId = Number(
		z
			.object({ data: z.object({ id: z.number() }) })
			.passthrough()
			.parse(newLead.json()).data.id
	);
	context.trackLead(newLeadId);

	const move = await context.http.put(
		`/api/proposals/${proposalId}`,
		{
			proposal_title: `${context.runTag} editable proposal`,
			lead_id: newLeadId,
		},
		context.proposer.sessionToken
	);
	assert.equal(move.status, 200, `move body: ${move.text}`);
	const moved = await context.reader.proposalRows(newLeadId);
	assert.equal(moved.length, 1);
	assert.equal(moved[0]?.id, proposalId);
	const newLeadRow = await context.reader.leadRow(newLeadId);
	assert.equal(
		newLeadRow?.canonical_proposal_id,
		proposalId,
		'the only linked Proposal is the canonical one'
	);

	// Deleting the linked Proposal leaves the enquiry without a canonical
	// Proposal instead of pointing at a deleted record.
	const deleted = await context.http.delete(
		`/api/proposals/${seeds.singleLinkProposalId}`,
		context.proposer.sessionToken
	);
	assert.equal(deleted.status, 200, `delete body: ${deleted.text}`);
	const afterDelete = await context.reader.leadRow(seeds.singleLinkLeadId);
	assert.equal(
		afterDelete?.canonical_proposal_id,
		null,
		'a deleted Proposal is not the canonical one'
	);
	assert.equal(afterDelete?.legacy_proposal_conflict, 0);
	const keptLink = await context.reader.proposalRows(seeds.singleLinkLeadId);
	assert.equal(
		keptLink.length,
		1,
		'the deleted Proposal keeps its reference to the enquiry'
	);
	assert.equal(keptLink[0]?.isDelete, 1);
}

export async function proposalLinkGuardScenario(
	context: ScenarioContext,
	seeds: LegacyReviewSeeds
): Promise<void> {
	// A second Proposal cannot be linked to an enquiry that already has one.
	const secondLink = await context.http.post(
		'/api/proposals',
		{
			proposal_title: `${context.runTag} duplicate proposal`,
			lead_id: seeds.singleLinkLeadId,
		},
		context.proposer.sessionToken
	);
	assert.equal(secondLink.status, 409, `second link body: ${secondLink.text}`);
	assert.equal(
		ErrorEnvelopeSchema.parse(secondLink.json()).code,
		'proposal_link_conflict'
	);

	// The same holds for an enquiry with several linked Proposals.
	const conflictLink = await context.http.post(
		'/api/proposals',
		{
			proposal_title: `${context.runTag} third proposal`,
			lead_id: seeds.conflictLeadId,
		},
		context.proposer.sessionToken
	);
	assert.equal(
		conflictLink.status,
		409,
		`conflict link body: ${conflictLink.text}`
	);

	// The existing Proposals and their references are untouched.
	const single = await context.reader.proposalRows(seeds.singleLinkLeadId);
	assert.equal(single.length, 1);
	assert.equal(single[0]?.lead_id, seeds.singleLinkLeadId);
	const conflict = await context.reader.proposalRows(seeds.conflictLeadId);
	assert.equal(conflict.length, 2);
	for (const proposal of conflict) {
		assert.equal(proposal.lead_id, seeds.conflictLeadId);
		assert.equal(proposal.isDelete, 0);
	}

	// A Proposal without a Lead link is unaffected.
	const standalone = await context.http.post(
		'/api/proposals',
		{ proposal_title: `${context.runTag} standalone proposal` },
		context.proposer.sessionToken
	);
	assert.equal(
		standalone.status,
		200,
		`standalone proposal body: ${standalone.text}`
	);
}

/**
 * A generic edit never closes a legacy review dimension. A stage or owner
 * change on a Lead whose legacy value is still in review is refused and
 * points at the review panel; the audited review action stays the only way
 * to settle the value.
 */
export async function genericEditRefusesAnOpenReviewItemScenario(
	context: ScenarioContext,
	seeds: LegacyReviewSeeds
): Promise<void> {
	const leadId = seeds.ambiguousOwnerLeadId;
	assert.ok(leadId > 0, 'the ambiguous owner lead is seeded');
	const before = await context.reader.leadRow(leadId);
	assert.ok(before, 'the lead with the open review item is stored');
	assert.equal(before.enquiry_status, null, 'the stage is still unresolved');
	assert.equal(before.owner_user_id, null, 'the owner is still unresolved');
	assert.equal(Number(before.legacy_review_required), 1);
	const ownershipBefore = (await context.reader.ownershipHistory(leadId))
		.length;

	// A generic stage change is refused.
	const staged = await context.http.put(
		`/api/leads/${leadId}`,
		{ enquiry_status: 'Connected' },
		context.assignee.sessionToken
	);
	assert.equal(staged.status, 409, `stage body: ${staged.text}`);
	const stageError = ErrorEnvelopeSchema.parse(staged.json());
	assert.equal(stageError.code, 'transition_unavailable');
	assert.match(
		stageError.error,
		/review panel/i,
		`the refusal points at the review panel: ${stageError.error}`
	);

	// A generic owner change is refused too.
	const assigned = await context.http.put(
		`/api/leads/${leadId}`,
		{ owner_user_id: context.assignee.id },
		context.assignee.sessionToken
	);
	assert.equal(assigned.status, 409, `owner body: ${assigned.text}`);
	const ownerError = ErrorEnvelopeSchema.parse(assigned.json());
	assert.equal(ownerError.code, 'transition_unavailable');
	assert.match(
		ownerError.error,
		/review panel/i,
		`the refusal points at the review panel: ${ownerError.error}`
	);

	// Nothing was written: the review item is still open.
	const after = await context.reader.leadRow(leadId);
	assert.ok(after);
	assert.equal(after.enquiry_status, null, 'the stage stays unresolved');
	assert.equal(after.owner_user_id, null, 'the owner stays unresolved');
	assert.equal(Number(after.legacy_review_required), 1);
	assert.equal(
		(await context.reader.stageHistory(leadId)).length,
		0,
		'a refused generic edit writes no stage history'
	);
	assert.equal(
		(await context.reader.ownershipHistory(leadId)).length,
		ownershipBefore,
		'a refused generic edit writes no ownership change'
	);

	// An edit that changes neither the stage nor the owner is still allowed.
	const edited = await context.http.put(
		`/api/leads/${leadId}`,
		{ notes: `${context.runTag} note on the enquiry` },
		context.assignee.sessionToken
	);
	assert.equal(edited.status, 200, `notes body: ${edited.text}`);
}
