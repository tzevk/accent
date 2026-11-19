import { strict as assert } from 'node:assert';
import type { ScenarioContext } from '../client.ts';

/**
 * Differential proof for the canonical Proposal rule (ADR-0031).
 *
 * The application computes `leads.canonical_proposal_id` after a Proposal
 * delete. The oracle here is the rule written independently from the
 * database rows: a live reviewer choice survives, exactly one remaining
 * live linked Proposal becomes canonical, and several live links mean no
 * canonical choice. Each case starts from a directly seeded state, so the
 * fixture itself cannot decide the answer.
 */

interface CaseSpec {
	name: string;
	/** Linked Proposals, in creation order. */
	proposals: Array<{ live: boolean }>;
	/** Index of the Proposal a reviewer already chose, or `none`. */
	canonical: number | 'none';
	/** Index of the live Proposal this case deletes. */
	deleteIndex: number;
}

const CASES: CaseSpec[] = [
	{
		name: 'two live, canonical survives an unrelated delete',
		proposals: [{ live: true }, { live: true }],
		canonical: 0,
		deleteIndex: 1,
	},
	{
		name: 'two live, deleting the canonical leaves the other',
		proposals: [{ live: true }, { live: true }],
		canonical: 1,
		deleteIndex: 1,
	},
	{
		name: 'two live, no canonical, one remains after delete',
		proposals: [{ live: true }, { live: true }],
		canonical: 'none',
		deleteIndex: 0,
	},
	{
		name: 'three live, canonical survives a third delete',
		proposals: [{ live: true }, { live: true }, { live: true }],
		canonical: 0,
		deleteIndex: 2,
	},
	{
		name: 'three live, no canonical, two remain and stay conflicted',
		proposals: [{ live: true }, { live: true }, { live: true }],
		canonical: 'none',
		deleteIndex: 0,
	},
	{
		name: 'canonical pointed at a deleted Proposal, one live remains',
		proposals: [{ live: true }, { live: false }],
		canonical: 1,
		deleteIndex: 0,
	},
	{
		name: 'canonical pointed at a deleted Proposal, two live remain conflicted',
		proposals: [{ live: true }, { live: true }, { live: false }],
		canonical: 2,
		deleteIndex: 0,
	},
	{
		name: 'single live removed, no canonical is invented',
		proposals: [{ live: true }],
		canonical: 'none',
		deleteIndex: 0,
	},
];

export async function proposalCanonicalDifferentialScenario(
	context: ScenarioContext
): Promise<void> {
	for (const [caseIndex, spec] of CASES.entries()) {
		const leadId = await context.reader.seedReportLead({
			companyName: `${context.runTag} differential ${caseIndex}`,
			recordedAt: '2026-09-15 10:00:00',
		});
		context.trackLead(leadId);

		const proposalIds: number[] = [];
		for (const [proposalIndex, proposal] of spec.proposals.entries()) {
			const inserted = await context.reader.fixtureWrite(
				`INSERT INTO proposals (proposal_title, lead_id, status, isDelete)
         VALUES (?, ?, 'DRAFT', ?)`,
				[
					`${context.runTag} differential ${caseIndex} proposal ${proposalIndex}`,
					leadId,
					proposal.live ? 0 : 1,
				]
			);
			proposalIds.push(inserted.insertId);
		}

		const canonicalId =
			spec.canonical === 'none' ? null : proposalIds[spec.canonical];
		await context.reader.fixtureWrite(
			`UPDATE leads SET canonical_proposal_id = ?, legacy_proposal_conflict = 0
       WHERE id = ?`,
			[canonicalId, leadId]
		);

		const before = await context.reader.proposalRows(leadId);
		const liveBefore = before
			.filter((proposal) => proposal.isDelete === 0)
			.map((proposal) => proposal.id);
		const deleteId = proposalIds[spec.deleteIndex];
		assert.ok(
			liveBefore.includes(deleteId),
			`${spec.name}: the deleted Proposal is live before the operation`
		);

		const response = await context.http.delete(
			`/api/proposals/${deleteId}`,
			context.proposer.sessionToken
		);
		assert.equal(response.status, 200, `${spec.name}: ${response.text}`);

		const after = await context.reader.proposalRows(leadId);
		const lead = await context.reader.leadRow(leadId);
		assert.ok(lead, `${spec.name}: the Lead still exists`);

		const liveAfter = after
			.filter((proposal) => proposal.isDelete === 0)
			.map((proposal) => proposal.id);
		const expectedCanonical =
			canonicalId !== null && liveAfter.includes(canonicalId)
				? canonicalId
				: liveAfter.length === 1
					? liveAfter[0]
					: null;
		const expectedConflict = liveAfter.length > 1;

		assert.equal(
			lead.canonical_proposal_id,
			expectedCanonical,
			`${spec.name}: canonical Proposal`
		);
		assert.equal(
			Number(lead.legacy_proposal_conflict),
			expectedConflict ? 1 : 0,
			`${spec.name}: conflict flag`
		);

		// The delete is a soft delete that keeps the reference: it changes
		// no other row's link or liveness, and no Proposal is removed.
		assert.equal(after.length, before.length, `${spec.name}: no row is lost`);
		const deleted = after.find((proposal) => proposal.id === deleteId);
		assert.equal(deleted?.isDelete, 1, `${spec.name}: the row is soft-deleted`);
		assert.equal(
			deleted?.lead_id,
			leadId,
			`${spec.name}: the reference to the enquiry survives`
		);
		for (const proposal of after) {
			if (proposal.id === deleteId) continue;
			const previous = before.find((candidate) => candidate.id === proposal.id);
			assert.equal(
				proposal.isDelete,
				previous?.isDelete,
				`${spec.name}: an unrelated Proposal keeps its liveness`
			);
			assert.equal(
				proposal.lead_id,
				previous?.lead_id,
				`${spec.name}: an unrelated Proposal keeps its link`
			);
		}
	}
}
