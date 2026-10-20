import { strict as assert } from 'node:assert';
import type { ScenarioContext } from '../client.ts';

/**
 * The soft-deleted enquiry of the Lead feature.
 *
 * A Lead that is soft-deleted is gone: its state is evidence, not an
 * editable field. A Proposal write that belongs to such an enquiry may not
 * rewrite the enquiry, so the canonical link and the review state of a
 * deleted Lead stay exactly as they were.
 *
 * The scenario asserts the HTTP response and the persisted rows through the
 * independent reader.
 */

/**
 * The enquiry the scenario works on: a soft-deleted Lead with a canonical
 * Proposal, a second linked Proposal, and an open legacy review item.
 */
export interface SoftDeleteSeed {
	leadId: number;
	canonicalProposalId: number;
	secondProposalId: number;
}

export async function softDeletedLeadKeepsItsProposalStateScenario(
	context: ScenarioContext,
	seed: SoftDeleteSeed
): Promise<void> {
	const before = await context.reader.leadRow(seed.leadId);
	assert.ok(before, 'the soft deleted enquiry is stored');
	assert.equal(before.isDelete, 1, 'the enquiry is soft deleted');
	assert.equal(
		before.canonical_proposal_id,
		seed.canonicalProposalId,
		'the enquiry keeps its canonical Proposal'
	);
	assert.equal(
		Number(before.legacy_review_required),
		1,
		'the enquiry has an open legacy review item'
	);
	assert.equal(
		Number(before.legacy_proposal_conflict),
		1,
		'the enquiry still carries the proposal link conflict'
	);

	// Editing the linked Proposal may not rewrite the enquiry.
	const edited = await context.http.put(
		`/api/proposals/${seed.canonicalProposalId}`,
		{
			proposal_title: `${context.runTag} renamed soft deleted proposal`,
			lead_id: seed.leadId,
		},
		context.proposer.sessionToken
	);
	assert.equal(edited.status, 200, `proposal body: ${edited.text}`);

	const afterEdit = await context.reader.leadRow(seed.leadId);
	assert.ok(afterEdit, 'the soft deleted enquiry is still stored');
	assert.equal(
		afterEdit.canonical_proposal_id,
		seed.canonicalProposalId,
		'the edit of a linked Proposal keeps the canonical link'
	);
	assert.equal(
		Number(afterEdit.legacy_proposal_conflict),
		1,
		'the edit of a linked Proposal keeps the review state'
	);
	assert.equal(
		Number(afterEdit.legacy_review_required),
		1,
		'the edit of a linked Proposal keeps the review flag'
	);

	// Deleting the linked Proposal may not rewrite the enquiry either.
	const deleted = await context.http.delete(
		`/api/proposals/${seed.canonicalProposalId}`,
		context.proposer.sessionToken
	);
	assert.equal(deleted.status, 200, `delete body: ${deleted.text}`);

	const afterDelete = await context.reader.leadRow(seed.leadId);
	assert.ok(afterDelete, 'the soft deleted enquiry is still stored');
	assert.equal(
		afterDelete.canonical_proposal_id,
		seed.canonicalProposalId,
		'the delete of a linked Proposal keeps the canonical link'
	);
	assert.equal(
		Number(afterDelete.legacy_proposal_conflict),
		1,
		'the delete of a linked Proposal keeps the review state'
	);
	assert.equal(
		Number(afterDelete.legacy_review_required),
		1,
		'the delete of a linked Proposal keeps the review flag'
	);
}
