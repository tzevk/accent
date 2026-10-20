import { dbConnect } from '@/utils/database';
import {
	LEAD_CONVERSION_MESSAGES,
	canConvertLead,
	hasUsableContactDetails,
	leadConversionFollowUpDescription,
	leadConversionFollowUpType,
	leadConversionProposalPriority,
	leadConversionProposalTitle,
} from '@/lib/lead-conversion';
import {
	LeadWorkflowError,
	recordStageChange,
	requireDbTransaction,
	resolveCanonicalStage,
	toNullableId,
	trimOrNull,
	type DbConnection,
} from '@/server/leads/shared';
import { syncFollowUpDateMirror } from '@/server/leads/activity-rows';

/**
 * The Lead-to-Proposal handoff (ticket #375).
 *
 * One atomic, authorized, idempotent handoff: the enquiry gets the one
 * canonical Proposal of that enquiry, the Lead is marked Converted, the
 * conversion is recorded as evidence, and the scheduled Lead work moves to
 * the Proposal with a traceable link in both directions.
 *
 * The rules:
 * - The Lead must be Qualified, with a named contact, a usable phone
 *   number or email address, a clear project need, and a resolved owner.
 *   Budget and timing are not Lead fields, so they never block a
 *   conversion.
 * - One enquiry has one canonical Proposal. A Lead that already carries a
 *   Proposal returns that Proposal and writes nothing. An enquiry with
 *   several linked Proposals and no canonical choice is refused with an
 *   actionable review conflict: no Proposal is ever guessed.
 * - Converted is a handoff, never a sale won. The Proposal keeps its own
 *   status vocabulary.
 * - The whole handoff is one transaction. A failure at any step leaves no
 *   converted Lead, no orphaned Proposal, no half-transferred work, and no
 *   conversion history.
 */

const MAX_TITLE_LENGTH = 255;
const MAX_NOTES_LENGTH = 65535;

export interface ConvertLeadInput {
	proposal_title?: unknown;
	notes?: unknown;
}

export interface ConvertLeadResult {
	proposal_id: number;
	proposal: Record<string, unknown>;
	already_converted: boolean;
}

interface LeadRow {
	id: number;
	lead_id: string | null;
	company_name: string | null;
	contact_name: string | null;
	contact_email: string | null;
	inquiry_email: string | null;
	cc_emails: string | null;
	phone: string | null;
	project_description: string | null;
	city: string | null;
	notes: string | null;
	priority: string | null;
	enquiry_status: string | null;
	owner_user_id: number | null;
	canonical_proposal_id: number | null;
}

interface ProposalRow {
	id: number;
	proposal_id: string | null;
	proposal_title: string | null;
	client_name: string | null;
	contact_name: string | null;
	contact_email: string | null;
	phone: string | null;
	city: string | null;
	description: string | null;
	status: string | null;
	priority: string | null;
	lead_id: number | null;
	canonical_lead_id: number | null;
	enquiry_no: string | null;
	created_at: unknown;
}

interface LinkedProposal {
	id: number;
}

function parseProposalTitle(value: unknown): string | null {
	const title = trimOrNull(value);
	if (title === null) return null;
	if (title.length > MAX_TITLE_LENGTH) {
		throw new LeadWorkflowError(
			'activity_invalid',
			LEAD_CONVERSION_MESSAGES.proposal_title_invalid,
			422
		);
	}
	return title;
}

function parseNotes(value: unknown): string | null {
	const notes = trimOrNull(value);
	if (notes === null) return null;
	if (notes.length > MAX_NOTES_LENGTH) {
		throw new LeadWorkflowError(
			'activity_invalid',
			LEAD_CONVERSION_MESSAGES.notes_invalid,
			422
		);
	}
	return notes;
}

/**
 * The enquiry, locked for the rest of the transaction. The lock is what
 * makes two simultaneous conversions converge on one Proposal.
 */
async function loadLead(db: DbConnection, leadId: number): Promise<LeadRow> {
	const [rows] = (await db.execute(
		`SELECT id, lead_id, company_name, contact_name, contact_email,
        inquiry_email, cc_emails, phone, project_description, city, notes,
        priority, enquiry_status, owner_user_id, canonical_proposal_id
      FROM leads
      WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)
      FOR UPDATE`,
		[leadId]
	)) as unknown as [LeadRow[], unknown];
	const row = rows[0];
	if (!row) {
		throw new LeadWorkflowError('not_found', 'Lead not found', 404);
	}
	return row;
}

/** The Proposals that still link to the enquiry. */
async function loadLinkedProposals(
	db: DbConnection,
	leadId: number
): Promise<LinkedProposal[]> {
	const [rows] = (await db.execute(
		`SELECT p.id
      FROM proposals p
      WHERE p.lead_id = ? AND (p.isDelete = 0 OR p.isDelete IS NULL)
      ORDER BY p.id ASC`,
		[leadId]
	)) as unknown as [LinkedProposal[], unknown];
	return rows;
}

function toIso(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return value.toISOString();
	const text = String(value).trim();
	return text === '' ? null : text;
}

/** One Proposal, read for the response and for the repeat answer. */
async function readProposal(
	db: DbConnection,
	proposalId: number
): Promise<Record<string, unknown>> {
	const [rows] = (await db.execute(
		`SELECT id, proposal_id, proposal_title, client_name, contact_name,
        contact_email, phone, city, description, status, priority, lead_id,
        canonical_lead_id, enquiry_no, created_at
      FROM proposals WHERE id = ? LIMIT 1`,
		[proposalId]
	)) as unknown as [ProposalRow[], unknown];
	const row = rows[0];
	if (!row) {
		throw new LeadWorkflowError('not_found', 'Proposal not found', 404);
	}
	return {
		id: row.id,
		proposal_id: row.proposal_id,
		proposal_title: row.proposal_title,
		client_name: row.client_name,
		contact_name: row.contact_name,
		contact_email: row.contact_email,
		phone: row.phone,
		city: row.city,
		description: row.description,
		status: row.status,
		priority: row.priority,
		lead_id: toNullableId(row.lead_id),
		canonical_lead_id: toNullableId(row.canonical_lead_id),
		enquiry_no: row.enquiry_no,
		created_at: toIso(row.created_at),
	};
}

/**
 * The Proposal that is already the canonical one of the enquiry, or null.
 * The reviewer's choice wins while that Proposal still links to the
 * enquiry; otherwise exactly one live linked Proposal is evidence-backed.
 */
async function readCanonicalProposal(
	db: DbConnection,
	leadId: number
): Promise<number | null> {
	const [rows] = (await db.execute(
		`SELECT l.canonical_proposal_id AS canonical_id,
        (SELECT MIN(p.id) FROM proposals p
          WHERE p.lead_id = l.id AND (p.isDelete = 0 OR p.isDelete IS NULL)) AS single_id,
        (SELECT COUNT(*) FROM proposals p
          WHERE p.lead_id = l.id AND (p.isDelete = 0 OR p.isDelete IS NULL)) AS live_count
      FROM leads l WHERE l.id = ? LIMIT 1`,
		[leadId]
	)) as unknown as [
		{
			canonical_id: number | null;
			single_id: number | null;
			live_count: number;
		}[],
		unknown,
	];
	const row = rows[0];
	if (!row) return null;
	const liveCount = Number(row.live_count ?? 0);
	if (liveCount === 0) return null;
	if (liveCount > 1) return toNullableId(row.canonical_id);
	return toNullableId(row.canonical_id) ?? toNullableId(row.single_id);
}

/**
 * The qualification facts of the conversion. A conversion needs the same
 * facts a qualification needs: a named contact, a usable phone number or
 * email address, a clear project need, and a resolved owner.
 */
function assertConversionFacts(lead: LeadRow): void {
	if (trimOrNull(lead.contact_name) === null) {
		throw new LeadWorkflowError(
			'contact_name_required',
			LEAD_CONVERSION_MESSAGES.contact_name_required,
			422
		);
	}
	if (
		!hasUsableContactDetails({
			phone: lead.phone,
			contact_email: lead.contact_email,
			inquiry_email: lead.inquiry_email,
			cc_emails: lead.cc_emails,
		})
	) {
		throw new LeadWorkflowError(
			'contact_details_required',
			LEAD_CONVERSION_MESSAGES.contact_details_required,
			422
		);
	}
	if (trimOrNull(lead.project_description) === null) {
		throw new LeadWorkflowError(
			'project_need_required',
			LEAD_CONVERSION_MESSAGES.project_need_required,
			422
		);
	}
	if (toNullableId(lead.owner_user_id) === null) {
		throw new LeadWorkflowError(
			'owner_required',
			LEAD_CONVERSION_MESSAGES.owner_required,
			409
		);
	}
}

/**
 * The canonical Proposal of the enquiry, created in this transaction. The
 * Proposal carries the Lead evidence and the canonical link; the unique
 * index over `canonical_lead_id` is what refuses a second canonical
 * Proposal for the same enquiry.
 */
async function createCanonicalProposal(
	db: DbConnection,
	lead: LeadRow,
	title: string | null,
	notes: string | null
): Promise<number> {
	const proposalTitle =
		title ??
		leadConversionProposalTitle({
			company_name: lead.company_name,
			project_description: lead.project_description,
		});
	const contactEmail =
		trimOrNull(lead.contact_email) ?? trimOrNull(lead.inquiry_email);
	// A Proposal that no longer belongs to this enquiry never keeps a claim
	// on it, so the canonical link is free for the new Proposal.
	await db.execute(
		`UPDATE proposals SET canonical_lead_id = NULL
      WHERE canonical_lead_id = ?
        AND (lead_id IS NULL OR lead_id <> ? OR isDelete = 1)`,
		[lead.id, lead.id]
	);
	const [result] = (await db.execute(
		`INSERT INTO proposals (
        proposal_title, description, client_name, contact_name, contact_email,
        phone, city, notes, status, priority, lead_id, enquiry_no,
        canonical_lead_id, isDelete, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 0, NOW(), NOW())`,
		[
			proposalTitle,
			trimOrNull(lead.project_description),
			trimOrNull(lead.company_name),
			trimOrNull(lead.contact_name),
			contactEmail,
			trimOrNull(lead.phone),
			trimOrNull(lead.city),
			notes ?? trimOrNull(lead.notes),
			leadConversionProposalPriority(lead.priority),
			lead.id,
			String(lead.id),
			lead.id,
		]
	)) as unknown as [{ insertId: number }, unknown];
	return result.insertId;
}

/**
 * The scheduled Lead work moves to the Proposal. Every outstanding
 * scheduled row becomes one Proposal follow-up, and the source row keeps
 * the link to its destination, so the handoff is traceable and every
 * source task has exactly one destination. The completed and cancelled
 * activities of the Lead stay where they are.
 */
async function transferScheduledWork(
	db: DbConnection,
	leadId: number,
	proposalId: number,
	actorUserId: number
): Promise<number> {
	const [rows] = (await db.execute(
		`SELECT id, activity_type, scheduled_for, next_action, notes
      FROM lead_activities
      WHERE lead_id = ?
        AND status = 'Scheduled'
        AND transferred_followup_id IS NULL
        AND scheduled_for IS NOT NULL
        AND (isDelete = 0 OR isDelete IS NULL)
      ORDER BY scheduled_for ASC, id ASC
      FOR UPDATE`,
		[leadId]
	)) as unknown as [
		{
			id: number;
			activity_type: string | null;
			scheduled_for: string;
			next_action: string | null;
			notes: string | null;
		}[],
		unknown,
	];
	let transferred = 0;
	for (const row of rows) {
		const [inserted] = (await db.execute(
			`INSERT INTO proposal_followups (
        proposal_id, follow_up_date, follow_up_type, description, status,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Scheduled', ?, NOW(), NOW())`,
			[
				proposalId,
				String(row.scheduled_for).slice(0, 10),
				leadConversionFollowUpType(row.activity_type),
				leadConversionFollowUpDescription(row.next_action, row.notes),
				actorUserId,
			]
		)) as unknown as [{ insertId: number }, unknown];
		await db.execute(
			`UPDATE lead_activities
        SET transferred_followup_id = ?, transferred_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
			[inserted.insertId, row.id]
		);
		transferred += 1;
	}
	return transferred;
}

/**
 * The canonical link of the Proposals of one enquiry.
 *
 * The database enforces the canonical linkage with the unique index over
 * `canonical_lead_id`, so the column follows the canonical choice of the
 * enquiry: exactly one live Proposal of an enquiry carries the link, and
 * every other Proposal of that enquiry carries none. A Proposal that no
 * longer links to the enquiry never keeps a claim on it.
 */
export async function syncCanonicalProposalLink(
	db: DbConnection,
	leadId: number
): Promise<void> {
	const [rows] = (await db.execute(
		`SELECT l.canonical_proposal_id AS canonical_id
      FROM leads l WHERE l.id = ? LIMIT 1`,
		[leadId]
	)) as unknown as [{ canonical_id: number | null }[], unknown];
	const canonicalId = toNullableId(rows[0]?.canonical_id);
	await db.execute(
		`UPDATE proposals SET canonical_lead_id = NULL
      WHERE canonical_lead_id = ?
         OR (lead_id = ? AND canonical_lead_id IS NOT NULL)`,
		[leadId, leadId]
	);
	if (canonicalId !== null) {
		await db.execute(
			`UPDATE proposals SET canonical_lead_id = ?
        WHERE id = ? AND lead_id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
			[leadId, canonicalId, leadId]
		);
	}
}

/** The duplicate-key failure of the canonical link, and nothing else. */
function isDuplicateCanonicalLink(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	if (!('code' in error) || !('message' in error)) return false;
	const code = error.code;
	const message = error.message;
	return (
		code === 'ER_DUP_ENTRY' &&
		typeof message === 'string' &&
		message.includes('uk_proposals_canonical_lead')
	);
}

/**
 * Convert one Lead into its canonical Proposal.
 *
 * The actor comes from the authenticated session, never from the body. The
 * Proposal, the Lead mark, the conversion evidence, the stage history, and
 * the work transfer commit in one transaction.
 */
export async function convertLead(
	leadId: number,
	input: ConvertLeadInput,
	actorUserId: number
): Promise<ConvertLeadResult> {
	const title = parseProposalTitle(input.proposal_title);
	const notes = parseNotes(input.notes);

	const db = (await dbConnect()) as unknown as DbConnection;
	const tx = requireDbTransaction(db);
	try {
		await tx.begin();
		try {
			const lead = await loadLead(db, leadId);
			const linked = await loadLinkedProposals(db, leadId);

			// One enquiry has one canonical Proposal. A Lead that already
			// carries one returns it and writes nothing.
			const canonicalId = toNullableId(lead.canonical_proposal_id);
			const canonicalIsLive =
				canonicalId !== null &&
				linked.some((proposal) => proposal.id === canonicalId);
			if (canonicalId !== null && canonicalIsLive) {
				return {
					proposal_id: canonicalId,
					proposal: await readProposal(db, canonicalId),
					already_converted: true,
				};
			}
			if (linked.length === 1) {
				// Exactly one live Proposal links to the enquiry: it is the
				// evidence-backed canonical one.
				return {
					proposal_id: linked[0].id,
					proposal: await readProposal(db, linked[0].id),
					already_converted: true,
				};
			}
			if (linked.length > 1) {
				// Several linked Proposals and no canonical choice: the
				// reviewer decides, the server never guesses.
				throw new LeadWorkflowError(
					'conversion_conflict',
					LEAD_CONVERSION_MESSAGES.conversion_conflict,
					409
				);
			}

			const stage = resolveCanonicalStage(lead.enquiry_status);
			if (stage === 'Converted') {
				throw new LeadWorkflowError(
					'lead_converted',
					LEAD_CONVERSION_MESSAGES.lead_converted,
					409
				);
			}
			if (!canConvertLead(stage)) {
				throw new LeadWorkflowError(
					'transition_unavailable',
					LEAD_CONVERSION_MESSAGES.stage_required,
					409
				);
			}

			assertConversionFacts(lead);

			const proposalId = await createCanonicalProposal(db, lead, title, notes);

			await db.execute(
				`UPDATE leads
          SET enquiry_status = 'Converted',
              canonical_proposal_id = ?,
              converted_at = NOW(),
              converted_by = ?,
              updated_at = NOW()
          WHERE id = ?`,
				[proposalId, actorUserId, leadId]
			);

			await db.execute(
				`INSERT INTO lead_conversions
          (lead_id, proposal_id, converted_by, converted_at, created_at)
        VALUES (?, ?, ?, NOW(), NOW())`,
				[leadId, proposalId, actorUserId]
			);

			await recordStageChange(db, {
				leadId,
				fromStage: stage,
				toStage: 'Converted',
				changeSource: 'conversion',
				reason: `Converted to Proposal #${proposalId}`,
				actorUserId,
			});

			await transferScheduledWork(db, leadId, proposalId, actorUserId);
			await syncFollowUpDateMirror(db, leadId);

			await tx.commit();
			return {
				proposal_id: proposalId,
				proposal: await readProposal(db, proposalId),
				already_converted: false,
			};
		} catch (error) {
			try {
				await tx.rollback();
			} catch {
				// the connection is released either way
			}
			// The unique index refused a second canonical Proposal: another
			// request won the race, so the same Proposal is the answer.
			if (isDuplicateCanonicalLink(error)) {
				const existing = await readCanonicalProposal(db, leadId);
				if (existing !== null) {
					return {
						proposal_id: existing,
						proposal: await readProposal(db, existing),
						already_converted: true,
					};
				}
			}
			if (error instanceof LeadWorkflowError) throw error;
			throw new LeadWorkflowError(
				'conversion_failed',
				'The conversion failed and nothing was changed',
				500
			);
		}
	} finally {
		db.release?.();
	}
}
