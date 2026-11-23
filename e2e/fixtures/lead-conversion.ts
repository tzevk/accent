/**
 * Disposable Lead-to-Proposal fixture for the browser journey.
 *
 * The fixture creates:
 *
 * - a namespaced ordinary identity with exactly the grants the handoff needs:
 *   read/update/convert a Lead and read/create a Proposal. It is not a super
 *   admin, has no other module rights, and shares no role with another
 *   journey;
 * - one Qualified Lead owned by that identity, carrying the qualification
 *   facts the server requires: a named contact, a usable phone and email, a
 *   project need, and a resolved owner. It has no Proposal and no prior
 *   conversion.
 *
 * The Lead id and the identity are tracked by their real primary keys. The
 * Proposal and the conversion evidence only come into existence through the
 * browser action, so cleanup finds them by the owned Lead id. A partially
 * failed seed removes what it created before rethrowing.
 */
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { createJourneyUser } from './journey-user.ts';

/**
 * Exactly what the handoff needs: the Lead panel reads the Lead, the server
 * requires update + convert + proposal create, and the destination Proposal
 * page reads the Proposal.
 */
export const LEAD_CONVERSION_PERMISSIONS = [
	'leads:read',
	'leads:update',
	'leads:convert',
	'proposals:read',
	'proposals:create',
] as const;

export interface LeadConversionFixture {
	/** The owner of the Lead and the actor of the conversion. */
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
	leadId: number;
	companyName: string;
	/** The Proposal title the browser supplies during the handoff. */
	proposalTitle: string;
	/** Delete the owned Lead rows first, then the shared identity. */
	dispose(): Promise<void>;
}

export interface StoredLeadConversionLead {
	id: number;
	companyName: string;
	enquiryStatus: string | null;
	canonicalProposalId: number | null;
	convertedAt: string | null;
	convertedBy: number | null;
	isDelete: number;
}

export interface StoredLeadConversionProposal {
	id: number;
	title: string;
	leadId: number | null;
	canonicalLeadId: number | null;
	status: string | null;
	isDelete: number;
}

export interface StoredLeadConversionEvidence {
	leadId: number;
	proposalId: number;
	convertedBy: number | null;
}

export interface LeadConversionState {
	lead: StoredLeadConversionLead | null;
	proposals: StoredLeadConversionProposal[];
	conversions: StoredLeadConversionEvidence[];
}

interface LeadRow extends RowDataPacket {
	id: number;
	company_name: string;
	enquiry_status: string | null;
	canonical_proposal_id: number | string | null;
	converted_at: string | Date | null;
	converted_by: number | string | null;
	isDelete: number | string | null;
}

interface ProposalRow extends RowDataPacket {
	id: number;
	proposal_title: string;
	lead_id: number | string | null;
	canonical_lead_id: number | string | null;
	status: string | null;
	isDelete: number | string | null;
}

interface ConversionRow extends RowDataPacket {
	lead_id: number | string;
	proposal_id: number | string;
	converted_by: number | string | null;
}

/**
 * Seed the identity and the Qualified Lead. The caller owns the returned
 * fixture and must call `dispose()` in a `finally` block.
 */
export async function seedLeadConversionFixture(
	db: Connection,
	namespace: string
): Promise<LeadConversionFixture> {
	const identity = await createJourneyUser(
		db,
		`${namespace}-lead-conversion`,
		LEAD_CONVERSION_PERMISSIONS
	);

	const companyName = `${namespace} Lead Conversion Co`;
	const proposalTitle = `${namespace} Conversion Proposal`;
	const contactName = 'Asha Buyer';
	const contactEmail = `${namespace}-buyer@example.com`;
	const projectDescription = `${namespace} needs a control-panel upgrade`;

	let leadId: number | null = null;
	try {
		const [result] = await db.execute<ResultSetHeader>(
			`INSERT INTO leads (
        company_name, contact_name, contact_email, phone, project_description,
        priority, enquiry_status, owner_user_id, isDelete, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'High', 'Qualified', ?, 0, NOW(), NOW())`,
			[
				companyName,
				contactName,
				contactEmail,
				'+91 98765 43210',
				projectDescription,
				identity.userId,
			]
		);
		const insertedId = Number(result.insertId);
		if (!Number.isInteger(insertedId) || insertedId <= 0) {
			throw new Error('[e2e] the Lead fixture was not inserted');
		}
		leadId = insertedId;

		return {
			userId: identity.userId,
			username: identity.username,
			password: identity.password,
			leadId: insertedId,
			companyName,
			proposalTitle,
			dispose: async () => {
				try {
					await deleteOwnedLeadRows(db, insertedId);
				} finally {
					await identity.dispose();
				}
			},
		};
	} catch (error) {
		if (leadId !== null) {
			try {
				await deleteOwnedLeadRows(db, leadId);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		await identity.dispose();
		throw error;
	}
}

/**
 * Read the exact stored linkage through an independent mysql2 connection.
 * Proposals and conversion evidence are selected by the owned Lead id, not
 * by the values the browser was told.
 */
export async function readLeadConversionState(
	db: Connection,
	fixture: { leadId: number }
): Promise<LeadConversionState> {
	const [leadRows] = await db.execute<LeadRow[]>(
		`SELECT id, company_name, enquiry_status, canonical_proposal_id,
        converted_at, converted_by, isDelete
       FROM leads
      WHERE id = ?
      LIMIT 1`,
		[fixture.leadId]
	);
	const [proposalRows] = await db.execute<ProposalRow[]>(
		`SELECT id, proposal_title, lead_id, canonical_lead_id, status, isDelete
       FROM proposals
      WHERE lead_id = ?
      ORDER BY id ASC`,
		[fixture.leadId]
	);
	const [conversionRows] = await db.execute<ConversionRow[]>(
		`SELECT lead_id, proposal_id, converted_by
       FROM lead_conversions
      WHERE lead_id = ?
      ORDER BY id ASC`,
		[fixture.leadId]
	);

	const leadRow = leadRows[0];
	return {
		lead: leadRow
			? {
					id: Number(leadRow.id),
					companyName: leadRow.company_name,
					enquiryStatus: leadRow.enquiry_status,
					canonicalProposalId: nullableNumber(leadRow.canonical_proposal_id),
					convertedAt: dateTimeText(leadRow.converted_at),
					convertedBy: nullableNumber(leadRow.converted_by),
					isDelete: Number(leadRow.isDelete ?? 0),
				}
			: null,
		proposals: proposalRows.map((row) => ({
			id: Number(row.id),
			title: row.proposal_title,
			leadId: nullableNumber(row.lead_id),
			canonicalLeadId: nullableNumber(row.canonical_lead_id),
			status: textOrNull(row.status),
			isDelete: Number(row.isDelete ?? 0),
		})),
		conversions: conversionRows.map((row) => ({
			leadId: Number(row.lead_id),
			proposalId: Number(row.proposal_id),
			convertedBy: nullableNumber(row.converted_by),
		})),
	};
}

/**
 * Remove only the rows this Lead owns. Conversion evidence and the Proposal
 * reference the Lead with RESTRICT foreign keys, so they go first; Proposal
 * follow-ups cascade with their Proposal.
 */
async function deleteOwnedLeadRows(
	db: Connection,
	leadId: number
): Promise<void> {
	await db.execute('DELETE FROM lead_conversions WHERE lead_id = ?', [leadId]);
	await db.execute('DELETE FROM lead_stage_history WHERE lead_id = ?', [
		leadId,
	]);
	await db.execute('DELETE FROM proposals WHERE lead_id = ?', [leadId]);
	await db.execute('DELETE FROM leads WHERE id = ?', [leadId]);
}

function textOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function dateTimeText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}
