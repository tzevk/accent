import { dbConnect } from '@/utils/database';
import {
	leadProjectLinkState,
	leadProposalLinkState,
	type LeadProposalNextAction,
	type LeadProposalProgress,
	type LeadProposalSummary,
	type LeadProjectSummary,
} from '@/lib/lead-progress';
import {
	toNullableId,
	toPercent,
	trimOrNull,
	type DbConnection,
} from '@/server/leads/shared';

/**
 * The downstream read of a converted Lead (ticket #376).
 *
 * A converted Lead keeps its own history and points at the Proposal that
 * replaced it. This module reads that Proposal and the Project the
 * Proposal later links to, and it resolves both through the stored
 * canonical links only:
 *
 * - The canonical Proposal of an enquiry is the one `leads.canonical_proposal_id`
 *   names and `proposals.canonical_lead_id` points back at. A name match, a
 *   newest-date guess, and a second link are never used.
 * - The Project of a Proposal is the one `proposals.project_id` names.
 * - A reader who may not read the Proposals gets the Lead and a restricted
 *   marker; a reader who may not read the Projects gets the Proposal and a
 *   restricted Project marker. No title, status, value, or Project
 *   information crosses a read permission.
 * - Converted is a handoff, never a sale won: the Proposal keeps its own
 *   status vocabulary, and this module never renames it.
 */

/** The read permissions of the caller, resolved by the route. */
export interface LeadProposalReadOptions {
	/** The caller may read the Proposals. */
	includeProposals: boolean;
	/** The caller may read the Projects. */
	includeProjects: boolean;
}

interface CanonicalFactsRow {
	canonical_proposal_id: number | null;
	live_count: number;
	single_id: number | null;
}

interface CanonicalProposalRow {
	id: number;
	proposal_title: string | null;
	status: string | null;
	progress: unknown;
	proposal_value: unknown;
	value: unknown;
	currency: string | null;
	project_id: number | null;
	canonical_lead_id: number | null;
}

interface ProposalNextActionRow {
	follow_up_date: string | null;
	follow_up_type: string | null;
	description: string | null;
}

interface ProjectRow {
	project_id: number;
	project_title: string | null;
	name: string | null;
	status: string | null;
	progress: unknown;
}

/**
 * The canonical link of the enquiry and the live Proposals linked to it.
 * The count is the evidence of an unresolved link; the single id is the
 * evidence-backed canonical Proposal of an enquiry that carries exactly
 * one live Proposal.
 */
async function loadCanonicalFacts(
	db: DbConnection,
	leadId: number
): Promise<CanonicalFactsRow | null> {
	const [rows] = (await db.execute(
		`SELECT l.canonical_proposal_id,
        (SELECT COUNT(*) FROM proposals p
          WHERE p.lead_id = l.id AND (p.isDelete = 0 OR p.isDelete IS NULL)) AS live_count,
        (SELECT MIN(p.id) FROM proposals p
          WHERE p.lead_id = l.id AND (p.isDelete = 0 OR p.isDelete IS NULL)) AS single_id
      FROM leads l
      WHERE l.id = ? AND (l.isDelete = 0 OR l.isDelete IS NULL)
      LIMIT 1`,
		[leadId]
	)) as unknown as [CanonicalFactsRow[], unknown];
	return rows[0] ?? null;
}

/**
 * The canonical Proposal of the enquiry, or null when the stored link does
 * not resolve to one live Proposal of this enquiry.
 */
async function loadCanonicalProposal(
	db: DbConnection,
	leadId: number,
	proposalId: number
): Promise<CanonicalProposalRow | null> {
	const [rows] = (await db.execute(
		`SELECT p.id, p.proposal_title, p.status, p.progress, p.proposal_value,
        p.value, p.currency, p.project_id, p.canonical_lead_id
      FROM proposals p
      WHERE p.id = ? AND p.lead_id = ?
        AND (p.isDelete = 0 OR p.isDelete IS NULL)
      LIMIT 1`,
		[proposalId, leadId]
	)) as unknown as [CanonicalProposalRow[], unknown];
	return rows[0] ?? null;
}

/**
 * The next action of the Proposal: the earliest follow-up that is still
 * open. The Proposal owns the sales work after the handoff, so this is
 * where the next action of a converted Lead lives.
 */
async function loadProposalNextAction(
	db: DbConnection,
	proposalId: number
): Promise<LeadProposalNextAction | null> {
	const [rows] = (await db.execute(
		`SELECT follow_up_date, follow_up_type, description
      FROM proposal_followups
      WHERE proposal_id = ?
        AND status IN ('Scheduled', 'In Progress')
        AND (isDelete = 0 OR isDelete IS NULL)
      ORDER BY follow_up_date ASC, id ASC
      LIMIT 1`,
		[proposalId]
	)) as unknown as [ProposalNextActionRow[], unknown];
	const row = rows[0];
	if (!row) return null;
	return {
		date: trimOrNull(row.follow_up_date),
		type: trimOrNull(row.follow_up_type),
		description: trimOrNull(row.description),
	};
}

/** The Project the Proposal links to, read for the panel. */
async function loadProject(
	db: DbConnection,
	projectId: number
): Promise<ProjectRow | null> {
	const [rows] = (await db.execute(
		`SELECT project_id, project_title, name, status, progress
      FROM projects
      WHERE project_id = ? AND (isDelete = 0 OR isDelete IS NULL)
      LIMIT 1`,
		[projectId]
	)) as unknown as [ProjectRow[], unknown];
	return rows[0] ?? null;
}

/** The exact decimal of the commercial value, never a float. */
function decimalText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}

/**
 * The downstream block of the Lead detail read.
 *
 * The four states are distinguishable: an enquiry without a Proposal, an
 * enquiry whose canonical Proposal is unresolved, a Proposal the reader may
 * not read, and the Proposal itself. A failed request never reaches this
 * module: the route answers with its own error.
 */
export async function getLeadProposalProgress(
	leadId: number,
	options: LeadProposalReadOptions,
	connection?: DbConnection
): Promise<LeadProposalProgress> {
	const ownsConnection = connection === undefined;
	const db = connection ?? ((await dbConnect()) as unknown as DbConnection);
	try {
		const facts = await loadCanonicalFacts(db, leadId);
		if (facts === null) {
			return { state: 'none', proposal: null };
		}
		const liveCount = Number(facts.live_count ?? 0);
		// The stored pointer wins. An enquiry that carries exactly one live
		// Proposal names it, and an enquiry with several linked Proposals
		// and no choice stays unresolved.
		const canonicalId =
			toNullableId(facts.canonical_proposal_id) ??
			(liveCount === 1 ? toNullableId(facts.single_id) : null);

		if (canonicalId === null) {
			return {
				state: liveCount > 0 ? 'unresolved' : 'none',
				proposal: null,
			};
		}

		const proposal = await loadCanonicalProposal(db, leadId, canonicalId);
		if (proposal === null) {
			// The stored link names a Proposal that is not a live Proposal
			// of this enquiry: the link has to be reviewed, never guessed.
			return { state: 'unresolved', proposal: null };
		}
		const claimedBy = toNullableId(proposal.canonical_lead_id);
		if (claimedBy !== null && claimedBy !== leadId) {
			// The Proposal is the canonical Proposal of another enquiry.
			return { state: 'unresolved', proposal: null };
		}

		const state = leadProposalLinkState({
			canonical_proposal_id: proposal.id,
			linked_proposal_count: liveCount,
			can_read_proposals: options.includeProposals,
		});
		if (state !== 'available') {
			return { state, proposal: null };
		}

		const projectId = toNullableId(proposal.project_id);
		let projectState = leadProjectLinkState({
			project_id: projectId,
			can_read_projects: options.includeProjects,
		});
		let project: LeadProjectSummary | null = null;
		if (projectState === 'available' && projectId !== null) {
			const row = await loadProject(db, projectId);
			if (row === null) {
				// The Proposal names a Project that is not there: the link
				// resolves to no Project at all.
				projectState = 'none';
			} else {
				project = {
					id: Number(row.project_id),
					title: trimOrNull(row.project_title) ?? trimOrNull(row.name),
					status: trimOrNull(row.status),
					progress: toPercent(row.progress),
				};
			}
		}

		const summary: LeadProposalSummary = {
			id: Number(proposal.id),
			title: trimOrNull(proposal.proposal_title),
			status: trimOrNull(proposal.status),
			progress: toPercent(proposal.progress),
			value:
				decimalText(proposal.proposal_value) ?? decimalText(proposal.value),
			currency: trimOrNull(proposal.currency),
			next_action: await loadProposalNextAction(db, Number(proposal.id)),
			project_state: projectState,
			project,
		};
		return { state, proposal: summary };
	} finally {
		if (ownsConnection) db.release?.();
	}
}
