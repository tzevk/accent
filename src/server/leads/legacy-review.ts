import { dbConnect } from '@/utils/database';
import {
	LEGACY_UNKNOWN_FACTS,
	isLegacyReviewType,
	legacyReviewRequired,
	openLegacyReviewItems,
	type LeadReviewState,
	type LegacyResolutionSource,
	type LegacyReviewLeadState,
	type LegacyReviewResolution,
	type LegacyReviewType,
	type LegacyUnknownFacts,
	type LinkedProposalSummary,
	type OpenLegacyReviewItem,
} from '@/lib/lead-review';
import { isActiveLeadStage } from '@/lib/lead-stages';
import {
	LeadWorkflowError,
	assertOwnerAssignable,
	rawOrNull,
	recordOwnershipChange,
	requireDbTransaction,
	resolveCanonicalStage,
	toNullableId,
	trimOrNull,
	type DbConnection,
} from '@/server/leads/shared';

/**
 * Legacy Lead review (ticket #370).
 *
 * The cutover could not classify every stored Lead. Whatever the evidence
 * does not support stays visibly unresolved, and a permitted reviewer
 * decides it — with the original value, the selected resolution, the
 * reason, the reviewer and the time all written down.
 *
 * Three review dimensions, one per fact the evidence could not supply:
 * the stage label, the owner display name, and the canonical Proposal of an
 * enquiry with several linked Proposals.
 *
 * Rules that hold for every resolution:
 * - Only an open item can be resolved, so the review flow never becomes a
 *   second way to edit a Lead.
 * - Nothing is guessed: an owner name is never matched by resemblance, a
 *   stage label is never mapped to Converted, and a canonical Proposal is
 *   never picked by date or title.
 * - Duplicate Proposals and their references stay exactly as they are. The
 *   decision records which one is canonical; it deletes nothing.
 * - Facts the records never stored stay explicitly unknown.
 */

const MAX_REASON_LENGTH = 2000;

export type { LeadReviewState, LegacyReviewResolution, LinkedProposalSummary };

interface ReviewLeadRow {
	id: number;
	enquiry_status: string | null;
	owner_user_id: number | null;
	legacy_stage: string | null;
	legacy_owner_name: string | null;
	legacy_stage_reviewed: number | boolean | null;
	legacy_owner_reviewed: number | boolean | null;
	legacy_proposal_reviewed: number | boolean | null;
	legacy_proposal_conflict: number | boolean | null;
	canonical_proposal_id: number | null;
}

const REVIEW_LEAD_COLUMNS = `
  l.id,
  l.enquiry_status,
  l.owner_user_id,
  l.legacy_stage,
  l.legacy_owner_name,
  l.legacy_stage_reviewed,
  l.legacy_owner_reviewed,
  l.legacy_proposal_reviewed,
  l.legacy_proposal_conflict,
  l.canonical_proposal_id
`;

function isTrue(value: unknown): boolean {
	return value === 1 || value === true;
}

function toReviewState(row: ReviewLeadRow): LegacyReviewLeadState {
	return {
		enquiry_status: row.enquiry_status,
		owner_user_id: toNullableId(row.owner_user_id),
		legacy_stage: rawOrNull(row.legacy_stage),
		legacy_owner_name: rawOrNull(row.legacy_owner_name),
		legacy_stage_reviewed: isTrue(row.legacy_stage_reviewed),
		legacy_owner_reviewed: isTrue(row.legacy_owner_reviewed),
		legacy_proposal_reviewed: isTrue(row.legacy_proposal_reviewed),
		legacy_proposal_conflict: isTrue(row.legacy_proposal_conflict),
		canonical_proposal_id: toNullableId(row.canonical_proposal_id),
	};
}

async function loadResolutions(
	db: DbConnection,
	leadId: number
): Promise<LegacyReviewResolution[]> {
	const [rows] = (await db.execute(
		`SELECT r.id, r.review_type, r.original_value, r.resolved_value,
        r.resolved_reference, r.reason, r.resolution_source,
        r.reviewer_user_id, r.resolved_at, r.reviewer_name
      FROM lead_legacy_reviews r
      WHERE r.lead_id = ?
      ORDER BY r.id ASC`,
		[leadId]
	)) as unknown as [
		{
			id: number;
			review_type: string;
			original_value: string | null;
			resolved_value: string | null;
			resolved_reference: number | null;
			reason: string;
			resolution_source: string;
			reviewer_user_id: number | null;
			resolved_at: unknown;
			reviewer_name: string | null;
		}[],
		unknown,
	];
	return rows.map((row) => ({
		id: row.id,
		review_type: row.review_type as LegacyReviewType,
		original_value: rawOrNull(row.original_value),
		resolved_value: rawOrNull(row.resolved_value),
		resolved_reference: toNullableId(row.resolved_reference),
		reason: row.reason,
		resolution_source: row.resolution_source as LegacyResolutionSource,
		reviewer_user_id: toNullableId(row.reviewer_user_id),
		reviewer_name: trimOrNull(row.reviewer_name),
		resolved_at:
			row.resolved_at instanceof Date
				? row.resolved_at.toISOString()
				: trimOrNull(row.resolved_at),
	}));
}

async function loadLinkedProposals(
	db: DbConnection,
	leadId: number,
	canonicalProposalId: number | null
): Promise<LinkedProposalSummary[]> {
	const [rows] = (await db.execute(
		`SELECT p.id, p.proposal_title, p.proposal_id, p.quotation_number,
        p.status, p.created_at, p.isDelete
      FROM proposals p
      WHERE p.lead_id = ? AND p.isDelete = 0
      ORDER BY p.id ASC`,
		[leadId]
	)) as unknown as [
		{
			id: number;
			proposal_title: string | null;
			proposal_id: string | null;
			quotation_number: string | null;
			status: string | null;
			created_at: unknown;
			isDelete: number | null;
		}[],
		unknown,
	];
	return rows.map((row) => ({
		id: row.id,
		proposal_title: trimOrNull(row.proposal_title),
		proposal_id: trimOrNull(row.proposal_id),
		quotation_number: trimOrNull(row.quotation_number),
		status: trimOrNull(row.status),
		created_at:
			row.created_at instanceof Date
				? row.created_at.toISOString()
				: trimOrNull(row.created_at),
		is_deleted: isTrue(row.isDelete),
		is_canonical: canonicalProposalId === row.id,
	}));
}

/**
 * The review state of one Lead. `includeProposals` is driven by the caller's
 * Proposal read permission: restricted Proposal details never reach a caller
 * who may not read them.
 */
export async function getLeadReviewState(
	leadId: number,
	options: { includeProposals: boolean },
	connection?: DbConnection
): Promise<LeadReviewState> {
	const ownsConnection = connection === undefined;
	const db = connection ?? ((await dbConnect()) as unknown as DbConnection);
	try {
		const [rows] = (await db.execute(
			`SELECT ${REVIEW_LEAD_COLUMNS}
        FROM leads l
        WHERE l.id = ? AND (l.isDelete = 0 OR l.isDelete IS NULL)
        LIMIT 1`,
			[leadId]
		)) as unknown as [ReviewLeadRow[], unknown];
		if (rows.length === 0) {
			throw new LeadWorkflowError('not_found', 'Lead not found', 404);
		}
		const state = toReviewState(rows[0]);
		const linkedProposals = options.includeProposals
			? await loadLinkedProposals(db, leadId, state.canonical_proposal_id)
			: [];
		return {
			open_items: openLegacyReviewItems(state),
			resolutions: await loadResolutions(db, leadId),
			linked_proposals: linkedProposals,
			canonical_proposal_id: state.canonical_proposal_id,
			proposal_link_conflict: state.legacy_proposal_conflict,
			unknown_facts: LEGACY_UNKNOWN_FACTS,
		};
	} finally {
		if (ownsConnection) db.release?.();
	}
}

export interface ResolveLegacyReviewInput {
	review_type: unknown;
	resolution: unknown;
	reason: unknown;
}

export interface ResolveLegacyReviewResult {
	review_type: LegacyReviewType;
	resolved_value: string | null;
	resolved_reference: number | null;
	legacy_review_required: boolean;
	open_items: OpenLegacyReviewItem[];
}

function parseReviewType(value: unknown): LegacyReviewType {
	if (isLegacyReviewType(value)) {
		return value;
	}
	throw new LeadWorkflowError(
		'review_type_invalid',
		'Unknown review type; resolve a stage, an owner, or the canonical Proposal',
		422
	);
}

function parseReason(value: unknown): string {
	const reason = trimOrNull(value);
	if (!reason) {
		throw new LeadWorkflowError(
			'reason_required',
			'A resolution needs a reason',
			422
		);
	}
	if (reason.length > MAX_REASON_LENGTH) {
		throw new LeadWorkflowError(
			'reason_required',
			`A resolution reason must be ${MAX_REASON_LENGTH} characters or fewer`,
			422
		);
	}
	return reason;
}

/** The linked Proposal ids of one enquiry: the original evidence. */
async function linkedProposalIds(
	db: DbConnection,
	leadId: number
): Promise<number[]> {
	const [rows] = (await db.execute(
		`SELECT p.id
      FROM proposals p
      WHERE p.lead_id = ?
      ORDER BY p.id ASC`,
		[leadId]
	)) as unknown as [{ id: number }[], unknown];
	return rows.map((row) => row.id);
}

/**
 * Recompute the aggregate review flag from the current facts. The rule is
 * the one in `src/lib/lead-review.ts`; the cutover migration computes the
 * same flag in SQL.
 */
async function refreshReviewFlag(
	db: DbConnection,
	leadId: number
): Promise<boolean> {
	const [rows] = (await db.execute(
		`SELECT enquiry_status, owner_user_id, legacy_stage, legacy_owner_name,
        legacy_stage_reviewed, legacy_owner_reviewed, legacy_proposal_reviewed,
        legacy_proposal_conflict, canonical_proposal_id
      FROM leads
      WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)
      LIMIT 1`,
		[leadId]
	)) as unknown as [ReviewLeadRow[], unknown];
	if (rows.length === 0) return false;
	const required = legacyReviewRequired(toReviewState(rows[0]));
	await db.execute(
		`UPDATE leads SET legacy_review_required = ?
      WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
		[required ? 1 : 0, leadId]
	);
	return required;
}

/**
 * Resolve one open legacy review item. The decision, the original value, the
 * reason, the reviewer and the time are written in a single transaction, so
 * a refused resolution changes nothing.
 */
export async function resolveLegacyReview(
	leadId: number,
	input: ResolveLegacyReviewInput,
	reviewerUserId: number
): Promise<ResolveLegacyReviewResult> {
	const reviewType = parseReviewType(input.review_type);
	const reason = parseReason(input.reason);

	const db = (await dbConnect()) as unknown as DbConnection;
	const tx = requireDbTransaction(db);
	try {
		await tx.begin();
		try {
			const [rows] = (await db.execute(
				`SELECT ${REVIEW_LEAD_COLUMNS}
          FROM leads l
          WHERE l.id = ? AND (l.isDelete = 0 OR l.isDelete IS NULL)
          FOR UPDATE`,
				[leadId]
			)) as unknown as [ReviewLeadRow[], unknown];
			if (rows.length === 0) {
				throw new LeadWorkflowError('not_found', 'Lead not found', 404);
			}
			const row = rows[0];
			const state = toReviewState(row);
			const openItems = openLegacyReviewItems(state);
			const openItem = openItems.find((item) => item.type === reviewType);
			if (!openItem) {
				throw new LeadWorkflowError(
					'review_item_not_open',
					openItems.length === 0
						? 'This Lead has no open legacy review item'
						: `This Lead has no open ${reviewType} review item. Open items: ${openItems.map((item) => item.type).join(', ')}.`,
					409
				);
			}

			let resolvedValue: string | null = null;
			let resolvedReference: number | null = null;
			let originalValue: string | null = null;
			let originalReference: number | null = null;

			if (reviewType === 'stage') {
				const stage = resolveCanonicalStage(input.resolution);
				if (!stage) {
					throw new LeadWorkflowError(
						'stage_unknown',
						'Choose a canonical Lead Stage to resolve the legacy value',
						422
					);
				}
				if (stage === 'Converted') {
					throw new LeadWorkflowError(
						'conversion_unavailable',
						'Lead conversion arrives through the linked Proposal handoff, not a stage review',
						409
					);
				}
				if (isActiveLeadStage(stage) && state.owner_user_id === null) {
					throw new LeadWorkflowError(
						'owner_required',
						`Resolve the Lead Owner first: a ${stage} lead needs a resolved owner`,
						409
					);
				}
				originalValue = state.legacy_stage;
				resolvedValue = stage;
				await db.execute(
					`UPDATE leads
            SET enquiry_status = ?, legacy_stage_reviewed = 1, updated_at = NOW()
            WHERE id = ?`,
					[stage, leadId]
				);
			} else if (reviewType === 'owner') {
				const requested = input.resolution;
				// Only the explicit "no owner" choice leaves the Lead in
				// unassigned intake. An empty choice is no choice at all.
				const unassigned =
					requested === null ||
					requested === undefined ||
					requested === 'unassigned';
				let ownerUserId: number | null = null;
				if (!unassigned) {
					ownerUserId = toNullableId(requested);
					if (ownerUserId === null) {
						throw new LeadWorkflowError(
							'owner_unknown',
							'Choose an active user, or decide that the Lead stays in unassigned intake',
							422
						);
					}
					await assertOwnerAssignable(db, ownerUserId);
				}
				originalValue = state.legacy_owner_name;
				if (ownerUserId === null) {
					resolvedValue = 'Unassigned intake';
				} else {
					const [ownerRows] = (await db.execute(
						'SELECT u.full_name FROM users u WHERE u.id = ? LIMIT 1',
						[ownerUserId]
					)) as unknown as [{ full_name: string | null }[], unknown];
					resolvedValue =
						trimOrNull(ownerRows[0]?.full_name) ?? `User #${ownerUserId}`;
				}
				resolvedReference = ownerUserId;
				await db.execute(
					`UPDATE leads
            SET owner_user_id = ?, legacy_owner_reviewed = 1, updated_at = NOW()
            WHERE id = ?`,
					[ownerUserId, leadId]
				);
				await recordOwnershipChange(
					db,
					leadId,
					state.owner_user_id,
					ownerUserId,
					reviewerUserId
				);
			} else {
				const proposalId = toNullableId(input.resolution);
				if (proposalId === null) {
					throw new LeadWorkflowError(
						'proposal_not_linked',
						'Choose the Proposal that is the canonical one for this enquiry',
						422
					);
				}
				const [proposalRows] = (await db.execute(
					`SELECT p.id, p.proposal_title
            FROM proposals p
            WHERE p.id = ? AND p.lead_id = ? AND p.isDelete = 0
            LIMIT 1`,
					[proposalId, leadId]
				)) as unknown as [
					{ id: number; proposal_title: string | null }[],
					unknown,
				];
				if (proposalRows.length === 0) {
					throw new LeadWorkflowError(
						'proposal_not_linked',
						'That Proposal is not linked to this Lead',
						422
					);
				}
				const linkedIds = await linkedProposalIds(db, leadId);
				originalValue = linkedIds.join(', ');
				originalReference = state.canonical_proposal_id;
				resolvedReference = proposalId;
				const title = trimOrNull(proposalRows[0].proposal_title);
				resolvedValue = title
					? `Proposal #${proposalId} — ${title}`
					: `Proposal #${proposalId}`;
				await db.execute(
					`UPDATE leads
            SET canonical_proposal_id = ?, legacy_proposal_reviewed = 1, updated_at = NOW()
            WHERE id = ?`,
					[proposalId, leadId]
				);
			}

			// The reviewer's name is stored with the decision, so the history
			// keeps naming them even after their account is removed.
			const [reviewerRows] = (await db.execute(
				'SELECT u.full_name FROM users u WHERE u.id = ? AND u.isDelete = 0 LIMIT 1',
				[reviewerUserId]
			)) as unknown as [{ full_name: string | null }[], unknown];
			const reviewerName = trimOrNull(reviewerRows[0]?.full_name);

			await db.execute(
				`INSERT INTO lead_legacy_reviews
          (lead_id, review_type, original_value, original_reference,
           resolved_value, resolved_reference, reason, resolution_source,
           reviewer_user_id, reviewer_name, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'reviewer', ?, ?, NOW())`,
				[
					leadId,
					reviewType,
					originalValue,
					originalReference,
					resolvedValue,
					resolvedReference,
					reason,
					reviewerUserId,
					reviewerName,
				]
			);

			const stillRequired = await refreshReviewFlag(db, leadId);
			await tx.commit();

			const [stateRows] = (await db.execute(
				`SELECT ${REVIEW_LEAD_COLUMNS}
          FROM leads l
          WHERE l.id = ? AND (l.isDelete = 0 OR l.isDelete IS NULL)
          LIMIT 1`,
				[leadId]
			)) as unknown as [ReviewLeadRow[], unknown];
			return {
				review_type: reviewType,
				resolved_value: resolvedValue,
				resolved_reference: resolvedReference,
				legacy_review_required: stillRequired,
				open_items: stateRows.length
					? openLegacyReviewItems(toReviewState(stateRows[0]))
					: [],
			};
		} catch (error) {
			// A failed rollback must not mask the original failure: the
			// connection is released either way.
			try {
				await tx.rollback();
			} catch {
				// ignore
			}
			throw error;
		}
	} finally {
		db.release?.();
	}
}

/**
 * Guard for every Proposal write that links a Proposal to an enquiry.
 *
 * One enquiry has one canonical Proposal. A new link is refused when the
 * enquiry already carries a linked Proposal, so a second authoritative link
 * cannot be created by a generic Proposal create or edit. The existing
 * Proposals and their references are left untouched.
 */
export async function assertSingleAuthoritativeLeadLink(
	db: DbConnection,
	leadId: number,
	proposalId: number | null
): Promise<void> {
	// The Lead row is locked for the rest of the transaction, so two
	// concurrent writes to the same enquiry cannot both pass this check.
	const [leadRows] = (await db.execute(
		`SELECT l.id FROM leads l
      WHERE l.id = ? AND (l.isDelete = 0 OR l.isDelete IS NULL)
      FOR UPDATE`,
		[leadId]
	)) as unknown as [{ id: number }[], unknown];
	if (leadRows.length === 0) {
		throw new LeadWorkflowError('not_found', 'Lead not found', 404);
	}
	const clause = proposalId === null ? '' : ' AND p.id <> ?';
	const params: unknown[] = [leadId];
	if (proposalId !== null) params.push(proposalId);
	const [rows] = (await db.execute(
		`SELECT p.id
      FROM proposals p
      WHERE p.lead_id = ? AND (p.isDelete = 0 OR p.isDelete IS NULL)${clause}
      ORDER BY p.id ASC
      LIMIT 1`,
		params
	)) as unknown as [{ id: number }[], unknown];
	if (rows.length > 0) {
		throw new LeadWorkflowError(
			'proposal_link_conflict',
			`This enquiry already has a linked Proposal (#${rows[0].id}). One enquiry has one canonical Proposal: use the linked Proposal, or resolve the legacy review to choose the canonical one.`,
			409
		);
	}
}

/**
 * Recompute the canonical Proposal and the conflict flag of an enquiry from
 * the Proposals that currently link to it.
 *
 * The canonical Proposal is the reviewer's choice while that Proposal still
 * links to the enquiry; otherwise exactly one live linked Proposal is
 * evidence-backed and becomes the canonical one. Several live Proposals mean
 * a conflict, and no Proposal is chosen for it.
 */
export async function refreshLeadProposalState(
	db: DbConnection,
	leadId: number
): Promise<void> {
	const [rows] = (await db.execute(
		`SELECT
        (SELECT COUNT(*) FROM proposals p
          WHERE p.lead_id = l.id AND p.isDelete = 0) AS live_count,
        (SELECT MIN(p.id) FROM proposals p
          WHERE p.lead_id = l.id AND p.isDelete = 0) AS single_id,
        l.canonical_proposal_id AS canonical_id,
        (SELECT COUNT(*) FROM proposals p
          WHERE p.id = l.canonical_proposal_id
            AND p.lead_id = l.id AND p.isDelete = 0) AS canonical_live
      FROM leads l
      WHERE l.id = ? AND (l.isDelete = 0 OR l.isDelete IS NULL)
      LIMIT 1`,
		[leadId]
	)) as unknown as [
		{
			live_count: number | null;
			single_id: number | null;
			canonical_id: number | null;
			canonical_live: number | null;
		}[],
		unknown,
	];
	const row = rows[0];
	if (!row) return;
	const liveCount = Number(row.live_count ?? 0);
	const singleId = toNullableId(row.single_id);
	const canonicalId = toNullableId(row.canonical_id);
	const canonicalIsLive = Number(row.canonical_live ?? 0) > 0;
	const nextCanonical = canonicalIsLive
		? canonicalId
		: liveCount === 1
			? singleId
			: null;
	await db.execute(
		`UPDATE leads
      SET canonical_proposal_id = ?, legacy_proposal_conflict = ?
      WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
		[nextCanonical, liveCount > 1 ? 1 : 0, leadId]
	);
	await refreshReviewFlag(db, leadId);
}
