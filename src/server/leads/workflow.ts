import { dbConnect } from '@/utils/database';
import {
	isActiveLeadStage,
	isLeadStage,
	type LeadStage,
} from '@/lib/lead-stages';
import { isRetryableNumberError } from '@/utils/db-number-retry';

/**
 * Cohesive server-side Lead workflow module for ticket #369.
 *
 * Small interface, deep implementation: every Lead request handler, the CSV
 * import, and future workflow actions reuse these rules instead of copying
 * them. Transaction management, locking, schema interpretation, and canonical
 * stage/owner rules live here — never in page logic or parallel route copies.
 *
 * Persistent authority:
 * - `leads.enquiry_status`: canonical stage title-case string, or NULL for
 *   unresolved (legacy evidence kept in `legacy_stage` + review flag).
 * - `leads.owner_user_id`: numeric nullable stable owner (NULL = unassigned
 *   intake). `assigned_to` stays readable as legacy evidence only.
 * - `lead_ownership_history`: assignment audit; only real actors write rows.
 */

/**
 * Assignable-user predicate, matching the authentication active policy:
 * `status` active-or-NULL, `is_active` 1-or-NULL, `isDelete` 0. Used for
 * assignment validation, the owner directory, and the owner-name join so a
 * status='inactive' account with a stale is_active=1 can never own leads.
 */
const ASSIGNABLE_USER_FILTER = `(u.is_active = 1 OR u.is_active IS NULL)
    AND (u.status = 'active' OR u.status IS NULL)
    AND u.isDelete = 0`;

export const LEAD_LIST_SELECT = `
  l.id,
  l.lead_id,
  l.company_id,
  l.company_name,
  l.contact_name,
  l.contact_email,
  l.inquiry_email,
  l.cc_emails,
  l.phone,
  l.designation,
  l.city,
  l.project_description,
  l.enquiry_type,
  l.enquiry_status,
  l.enquiry_date,
  l.lead_source,
  l.priority,
  l.notes,
  l.follow_up_date,
  l.owner_user_id,
  l.legacy_owner_name,
  l.legacy_stage,
  l.legacy_review_required,
  l.created_at,
  l.updated_at,
  u.full_name AS owner_name
`;

export const LEAD_LIST_FROM = `
  FROM leads l
  LEFT JOIN users u ON u.id = l.owner_user_id AND ${ASSIGNABLE_USER_FILTER}
`;

export const LEAD_ACTIVE_FILTER = '(l.isDelete = 0 OR l.isDelete IS NULL)';

export interface LeadOwnershipHistoryEntry {
	id: number;
	prior_owner_user_id: number | null;
	owner_user_id: number | null;
	actor_user_id: number | null;
	created_at: string | null;
}

export interface DuplicateCandidate {
	id: number;
	lead_id: string | null;
	project_description: string | null;
}

export interface LeadReadModel {
	[key: string]: unknown;
	id: number;
	lead_id: string | null;
	company_name: string | null;
	enquiry_status: LeadStage | null;
	owner_user_id: number | null;
	owner_name: string | null;
	legacy_review_required: boolean;
	legacy_owner_name: string | null;
	legacy_stage: string | null;
	follow_up_date: string | null;
	duplicate_candidates?: DuplicateCandidate[];
	ownership_history?: LeadOwnershipHistoryEntry[];
}

export interface LeadListFilters {
	page: number;
	limit: number;
	search: string;
	status: string;
	city: string;
	sortBy: string;
	sortOrder: string;
	owner: string;
	review: string;
}

export interface LeadListStats {
	total_leads: number;
	unassigned_leads: number;
	needs_review_leads: number;
	stage_new: number;
	stage_attempting_contact: number;
	stage_connected: number;
	stage_qualified: number;
	stage_nurture: number;
	stage_disqualified: number;
	stage_converted: number;
	stage_unresolved: number;
}

// MySQL driver `execute()` row tuples for the queries issued below.
type LeadRow = Record<string, unknown> & { id: number };
type CountRow = { total: number };
type StatsRow = Record<string, number | null>;
type OwnerRow = { id: number; full_name: string };
type IdRow = { id: number };
type ExistingLeadRow = Record<string, unknown> & {
	id: number;
	owner_user_id: number | null;
	enquiry_status: string | null;
	follow_up_date: string | null;
};

type DbConnection = {
	execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
	beginTransaction?: () => Promise<void>;
	commit?: () => Promise<void>;
	rollback?: () => Promise<void>;
	release?: () => void;
};

export type LeadWorkflowErrorCode =
	| 'company_required'
	| 'stage_unknown'
	| 'conversion_unavailable'
	| 'transition_unavailable'
	| 'owner_required'
	| 'owner_unknown'
	| 'next_action_required'
	| 'not_found'
	| 'duplicate_lead_id';

export class LeadWorkflowError extends Error {
	readonly code: LeadWorkflowErrorCode;
	readonly status: number;

	constructor(code: LeadWorkflowErrorCode, message: string, status: number) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

function toNullableId(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value === 'number' && Number.isInteger(value) && value > 0)
		return value;
	if (typeof value === 'string') {
		const text = value.trim();
		if (/^\d+$/.test(text)) {
			const parsed = Number.parseInt(text, 10);
			if (Number.isInteger(parsed) && parsed > 0) return parsed;
		}
	}
	return null;
}

/**
 * Strict explicit-owner parsing shared by create/update/import routes: only
 * missing/null/empty means intake; any other non-numeric value (e.g.
 * '88garbage') is rejected, never coerced to a wrong user or silently
 * unassigned. Rejects non-safe integers as well.
 */
export function parseExplicitOwner(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') {
		if (Number.isSafeInteger(value) && value > 0) return value;
		throw new LeadWorkflowError(
			'owner_unknown',
			'Lead owner must be an active user id or null',
			422
		);
	}
	if (typeof value === 'string') {
		const text = value.trim();
		if (text === '') return null;
		if (/^\d+$/.test(text)) {
			const parsed = Number.parseInt(text, 10);
			if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
		}
		throw new LeadWorkflowError(
			'owner_unknown',
			'Lead owner must be an active user id or null',
			422
		);
	}
	throw new LeadWorkflowError(
		'owner_unknown',
		'Lead owner must be an active user id or null',
		422
	);
}

/** Raw evidence passthrough: originals stay verbatim, never trimmed. */
function rawOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return String(value);
}

function trimOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown): string | null {
	const text = trimOrNull(value);
	if (!text) return null;
	return EMAIL_PATTERN.test(text) ? text : null;
}

function normalizeCc(value: unknown): string | null {
	const parts: string[] = Array.isArray(value)
		? value.map((entry) => String(entry ?? '').trim())
		: String(value ?? '')
				.split(',')
				.map((part) => part.trim());
	const valid = parts.filter(
		(entry) => entry !== '' && EMAIL_PATTERN.test(entry)
	);
	return valid.length > 0 ? valid.join(',') : null;
}

function normalizePriority(value: unknown): string {
	const text = trimOrNull(value);
	if (!text) return 'Medium';
	const lower = text.toLowerCase();
	if (
		lower === 'h' ||
		lower.includes('high') ||
		lower.includes('urgent') ||
		lower === '1' ||
		lower === 'critical'
	)
		return 'High';
	if (
		lower === 'l' ||
		lower.includes('low') ||
		lower === '3' ||
		lower === 'minimal'
	)
		return 'Low';
	return 'Medium';
}

function normalizeDate(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	if (text === '') return null;
	const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
	const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;
	if (ymd.test(text)) return text;
	const match = text.match(dmy);
	if (match) {
		return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
	}
	return null;
}

/** Canonical stage value from one raw string, or NULL for unresolved. */
export function resolveCanonicalStage(value: unknown): LeadStage | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return isLeadStage(trimmed) ? trimmed : null;
}

/**
 * Serialize a DB lead row for list/detail reads. `assigned_to` is
 * deliberately excluded: `owner_user_id` is the authority and
 * `legacy_owner_name` carries the original evidence.
 */
function serializeLead(row: LeadRow): LeadReadModel {
	const rest: Record<string, unknown> = { ...row };
	delete rest.assigned_to;
	delete rest.isDelete;
	return {
		...rest,
		id: row.id,
		enquiry_status: resolveCanonicalStage(row.enquiry_status),
		owner_user_id: toNullableId(row.owner_user_id),
		owner_name: trimOrNull(row.owner_name),
		legacy_review_required:
			row.legacy_review_required === 1 || row.legacy_review_required === true,
		legacy_owner_name: rawOrNull(row.legacy_owner_name),
		legacy_stage: rawOrNull(row.legacy_stage),
		follow_up_date: trimOrNull(row.follow_up_date),
	} as LeadReadModel;
}

async function assertOwnerAssignable(
	db: DbConnection,
	ownerUserId: number
): Promise<void> {
	const [rows] = (await db.execute(
		`SELECT u.id FROM users u
      WHERE u.id = ? AND ${ASSIGNABLE_USER_FILTER}
      LIMIT 1`,
		[ownerUserId]
	)) as unknown as [IdRow[], unknown];
	if (rows.length === 0) {
		throw new LeadWorkflowError(
			'owner_unknown',
			'Lead owner must be an active user',
			422
		);
	}
}

async function recordOwnershipChange(
	db: DbConnection,
	leadId: number,
	priorOwnerUserId: number | null,
	ownerUserId: number | null,
	actorUserId: number | null
): Promise<void> {
	await db.execute(
		`INSERT INTO lead_ownership_history
      (lead_id, prior_owner_user_id, owner_user_id, actor_user_id)
      VALUES (?, ?, ?, ?)`,
		[leadId, priorOwnerUserId, ownerUserId, actorUserId]
	);
}

function requireDbTransaction(db: DbConnection): {
	begin: () => Promise<void>;
	commit: () => Promise<void>;
	rollback: () => Promise<void>;
} {
	if (!db.beginTransaction || !db.commit || !db.rollback) {
		throw new Error('Lead workflow mutations require a transaction');
	}
	const begin = db.beginTransaction.bind(db);
	const commit = db.commit.bind(db);
	const rollback = db.rollback.bind(db);
	return { begin, commit, rollback };
}

/** Active queue membership: resolved owner plus a dated next action. */
function assertActiveStageRequirements(
	stage: LeadStage,
	ownerUserId: number | null,
	followUpDate: string | null
): void {
	if (!isActiveLeadStage(stage)) return;
	if (ownerUserId === null) {
		throw new LeadWorkflowError(
			'owner_required',
			`${stage} leads require a lead owner`,
			422
		);
	}
	if (!followUpDate) {
		throw new LeadWorkflowError(
			'next_action_required',
			`${stage} leads require a dated next action`,
			422
		);
	}
}

async function generateLeadId(db: DbConnection): Promise<string> {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const year = now.getFullYear();
	const pattern = `-${month}-${year}`;
	const [rows] = (await db.execute(
		`SELECT lead_id FROM leads l WHERE l.lead_id LIKE ? AND ${LEAD_ACTIVE_FILTER} ORDER BY l.lead_id DESC FOR UPDATE`,
		[`%${pattern}`]
	)) as unknown as [{ lead_id: string | null }[], unknown];
	let maxSerial = 0;
	for (const row of rows) {
		if (row.lead_id && row.lead_id.endsWith(pattern)) {
			const serial = Number.parseInt(row.lead_id.split('-')[0], 10);
			if (!Number.isNaN(serial) && serial > maxSerial) maxSerial = serial;
		}
	}
	return `${String(maxSerial + 1).padStart(3, '0')}${pattern}`;
}

function isDuplicateEntryError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'errno' in error &&
		error.errno === 1062
	);
}

function failOnExplicitDuplicate(
	error: unknown,
	leadIdProvided: boolean
): never {
	if (leadIdProvided && isDuplicateEntryError(error)) {
		throw new LeadWorkflowError(
			'duplicate_lead_id',
			'A lead with this lead ID already exists',
			409
		);
	}
	throw error;
}

export interface CreateLeadInput {
	lead_id?: unknown;
	company_id?: unknown;
	company_name?: unknown;
	contact_name?: unknown;
	contact_email?: unknown;
	inquiry_email?: unknown;
	cc_emails?: unknown;
	phone?: unknown;
	designation?: unknown;
	city?: unknown;
	project_description?: unknown;
	enquiry_type?: unknown;
	enquiry_status?: unknown;
	enquiry_date?: unknown;
	lead_source?: unknown;
	priority?: unknown;
	notes?: unknown;
	follow_up_date?: unknown;
	owner_user_id?: unknown;
	[key: string]: unknown;
}

/**
 * Manual creation: one Lead per project enquiry, always starting at New with
 * the authenticated creator as owner unless an explicit assign-permitted
 * override is supplied. Budget/timing are not lead fields and stay optional.
 */
export async function createLead(
	input: CreateLeadInput,
	actorUserId: number
): Promise<{ id: number }> {
	const companyName = trimOrNull(input.company_name);
	if (!companyName) {
		throw new LeadWorkflowError(
			'company_required',
			'Company name is required',
			400
		);
	}
	if (input.enquiry_status !== undefined && input.enquiry_status !== null) {
		const canonical = resolveCanonicalStage(input.enquiry_status);
		if (canonical !== 'New') {
			throw new LeadWorkflowError(
				'stage_unknown',
				'Manually created leads start at New',
				422
			);
		}
	}
	const ownerProvided = Object.hasOwn(input, 'owner_user_id');
	const ownerUserId = ownerProvided
		? parseExplicitOwner(input.owner_user_id)
		: actorUserId;

	const db = (await dbConnect()) as unknown as DbConnection;
	const tx = requireDbTransaction(db);
	try {
		if (ownerUserId !== null && ownerUserId !== actorUserId) {
			await assertOwnerAssignable(db, ownerUserId);
		}
		const normalizedCompanyId = toNullableId(input.company_id);
		const leadIdProvided =
			trimOrNull(input.lead_id) !== null && String(input.lead_id).trim() !== '';
		let insertId = 0;
		for (let attempt = 1; ; attempt++) {
			await tx.begin();
			try {
				const leadId = leadIdProvided
					? String(input.lead_id).trim()
					: await generateLeadId(db);
				const [result] = (await db.execute(
					`INSERT INTO leads (
            lead_id, company_id, company_name, contact_name, contact_email,
            inquiry_email, cc_emails, phone, designation, city,
            project_description, enquiry_type, enquiry_status, enquiry_date,
            lead_source, priority, notes, follow_up_date, owner_user_id,
            legacy_review_required
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
					[
						leadId,
						normalizedCompanyId,
						companyName,
						trimOrNull(input.contact_name),
						normalizeEmail(input.contact_email),
						normalizeEmail(input.inquiry_email),
						normalizeCc(input.cc_emails),
						trimOrNull(input.phone),
						trimOrNull(input.designation),
						trimOrNull(input.city),
						trimOrNull(input.project_description),
						trimOrNull(input.enquiry_type),
						'New',
						normalizeDate(input.enquiry_date),
						trimOrNull(input.lead_source),
						normalizePriority(input.priority),
						trimOrNull(input.notes),
						normalizeDate(input.follow_up_date),
						ownerUserId,
					]
				)) as unknown as [{ insertId: number }, unknown];
				insertId = result.insertId;
				await recordOwnershipChange(
					db,
					insertId,
					null,
					ownerUserId,
					actorUserId
				);
				await tx.commit();
				break;
			} catch (error) {
				await tx.rollback();
				if (!leadIdProvided && isRetryableNumberError(error) && attempt < 5) {
					const { promise, resolve } = Promise.withResolvers<void>();
					setTimeout(resolve, 15 * attempt);
					await promise;
					continue;
				}
				failOnExplicitDuplicate(error, leadIdProvided);
			}
		}
		return { id: insertId };
	} finally {
		db.release?.();
	}
}

export interface UpdateLeadInput extends CreateLeadInput {
	[key: string]: unknown;
}

/**
 * Ordinary edit plus assignment in one cohesive update. Assignment changes
 * record actor/time and prior ownership in the same transaction. Stage edits
 * touching active stages validate owner + dated next action against the
 * resulting state. Generic edits can never set Converted, leave Converted, or
 * enter/leave Disqualified — conversion, disqualification, and reopening are
 * later audited actions, safely refused here with 409.
 */
export async function updateLead(
	id: number,
	input: UpdateLeadInput,
	actorUserId: number
): Promise<{
	id: number;
	owner_user_id: number | null;
	owner_name: string | null;
}> {
	const db = (await dbConnect()) as unknown as DbConnection;
	const tx = requireDbTransaction(db);
	try {
		await tx.begin();
		try {
			const [existingRows] = (await db.execute(
				`SELECT id, owner_user_id, enquiry_status, follow_up_date
          FROM leads
          WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)
          FOR UPDATE`,
				[id]
			)) as unknown as [ExistingLeadRow[], unknown];
			if (existingRows.length === 0) {
				throw new LeadWorkflowError('not_found', 'Lead not found', 404);
			}
			const existing = existingRows[0];
			const priorOwner = toNullableId(existing.owner_user_id);

			const ownerProvided = Object.hasOwn(input, 'owner_user_id');
			const nextOwner = ownerProvided
				? parseExplicitOwner(input.owner_user_id)
				: priorOwner;
			if (ownerProvided && nextOwner !== null) {
				await assertOwnerAssignable(db, nextOwner);
			}

			const stageProvided = Object.hasOwn(input, 'enquiry_status');
			const currentStage = resolveCanonicalStage(existing.enquiry_status);
			let nextStage = currentStage;
			if (stageProvided) {
				const raw = input.enquiry_status;
				if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
					throw new LeadWorkflowError(
						'stage_unknown',
						'Lead stage must be a canonical stage',
						422
					);
				}
				const canonical = resolveCanonicalStage(raw);
				if (!canonical) {
					throw new LeadWorkflowError(
						'stage_unknown',
						'Unknown lead stage; use the canonical stage vocabulary',
						422
					);
				}
				if (canonical === 'Converted') {
					throw new LeadWorkflowError(
						'conversion_unavailable',
						'Lead conversion arrives through the linked Proposal handoff, not a direct stage edit',
						409
					);
				}
				// Converted leads continue through the Proposal: no generic edit
				// may move a stage out of Converted. (Any 'Converted' target
				// already threw above, so reaching here with a Converted
				// current stage always means leaving it.)
				if (currentStage === 'Converted') {
					throw new LeadWorkflowError(
						'transition_unavailable',
						'Converted leads continue through the linked Proposal; stage changes out of Converted are unavailable',
						409
					);
				}
				// Disqualification needs an audited reason action and reopening
				// needs reason + owner + dated next action; neither exists in
				// #369, so generic edits cannot enter or leave Disqualified.
				if (canonical === 'Disqualified' || currentStage === 'Disqualified') {
					throw new LeadWorkflowError(
						'transition_unavailable',
						'Disqualification and reopening need an audited reason and are unavailable through generic edits',
						409
					);
				}
				nextStage = canonical;
			}

			const followUpProvided = Object.hasOwn(input, 'follow_up_date');
			const nextFollowUp = followUpProvided
				? normalizeDate(input.follow_up_date)
				: trimOrNull(existing.follow_up_date);
			if (nextStage) {
				assertActiveStageRequirements(nextStage, nextOwner, nextFollowUp);
			}

			const sets: string[] = [];
			const params: unknown[] = [];
			const push = (column: string, value: unknown): void => {
				sets.push(`${column} = ?`);
				params.push(value);
			};
			if (Object.hasOwn(input, 'lead_id'))
				push('lead_id', trimOrNull(input.lead_id));
			if (Object.hasOwn(input, 'company_id'))
				push('company_id', toNullableId(input.company_id));
			if (Object.hasOwn(input, 'company_name')) {
				const companyName = trimOrNull(input.company_name);
				if (!companyName) {
					throw new LeadWorkflowError(
						'company_required',
						'Company name is required',
						400
					);
				}
				push('company_name', companyName);
			}
			if (Object.hasOwn(input, 'contact_name'))
				push('contact_name', trimOrNull(input.contact_name));
			if (Object.hasOwn(input, 'contact_email'))
				push('contact_email', normalizeEmail(input.contact_email));
			if (Object.hasOwn(input, 'inquiry_email'))
				push('inquiry_email', normalizeEmail(input.inquiry_email));
			if (Object.hasOwn(input, 'cc_emails'))
				push('cc_emails', normalizeCc(input.cc_emails));
			if (Object.hasOwn(input, 'phone')) push('phone', trimOrNull(input.phone));
			if (Object.hasOwn(input, 'designation'))
				push('designation', trimOrNull(input.designation));
			if (Object.hasOwn(input, 'city')) push('city', trimOrNull(input.city));
			if (Object.hasOwn(input, 'project_description'))
				push('project_description', trimOrNull(input.project_description));
			if (Object.hasOwn(input, 'enquiry_type'))
				push('enquiry_type', trimOrNull(input.enquiry_type));
			if (stageProvided) push('enquiry_status', nextStage);
			if (Object.hasOwn(input, 'enquiry_date'))
				push('enquiry_date', normalizeDate(input.enquiry_date));
			if (Object.hasOwn(input, 'lead_source'))
				push('lead_source', trimOrNull(input.lead_source));
			if (Object.hasOwn(input, 'priority'))
				push('priority', normalizePriority(input.priority));
			if (Object.hasOwn(input, 'notes')) push('notes', trimOrNull(input.notes));
			if (followUpProvided) push('follow_up_date', nextFollowUp);
			if (ownerProvided) push('owner_user_id', nextOwner);
			sets.push('updated_at = NOW()');

			params.push(id);
			await db.execute(
				`UPDATE leads SET ${sets.join(', ')}
          WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
				params
			);

			if (ownerProvided && nextOwner !== priorOwner) {
				await recordOwnershipChange(db, id, priorOwner, nextOwner, actorUserId);
			}
			await tx.commit();

			let ownerName: string | null = null;
			if (nextOwner !== null) {
				const [ownerRows] = (await db.execute(
					`SELECT u.full_name FROM users u WHERE u.id = ? AND ${ASSIGNABLE_USER_FILTER} LIMIT 1`,
					[nextOwner]
				)) as unknown as [{ full_name: string | null }[], unknown];
				ownerName = trimOrNull(ownerRows[0]?.full_name);
			}
			return { id, owner_user_id: nextOwner, owner_name: ownerName };
		} catch (error) {
			await tx.rollback();
			if (Object.hasOwn(input, 'lead_id') && isDuplicateEntryError(error)) {
				throw new LeadWorkflowError(
					'duplicate_lead_id',
					'A lead with this lead ID already exists',
					409
				);
			}
			throw error;
		}
	} finally {
		db.release?.();
	}
}

/** Soft-delete one active lead; related records and history are preserved. */
export async function deleteLead(id: number): Promise<{ id: number }> {
	const db = (await dbConnect()) as unknown as DbConnection;
	try {
		const [result] = (await db.execute(
			'UPDATE leads SET isDelete = 1 WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)',
			[id]
		)) as unknown as [{ affectedRows: number }, unknown];
		if (result.affectedRows === 0) {
			throw new LeadWorkflowError('not_found', 'Lead not found', 404);
		}
		return { id };
	} finally {
		db.release?.();
	}
}

export interface ImportLeadRow {
	rowNumber: number;
	company_name: string | null;
	contact_name: string | null;
	contact_email: string | null;
	phone: string | null;
	city: string | null;
	project_description: string | null;
	enquiry_type: string | null;
	enquiry_status: string | null;
	enquiry_date: string | null;
	follow_up_date: string | null;
	lead_source: string | null;
	priority: string | null;
	designation: string | null;
	notes: string | null;
	owner_evidence: string | null;
}

export interface ImportLeadResult {
	imported: number;
	needs_review: number;
	errors: string[] | null;
}

/** Oversize evidence is rejected per row, never truncated. */
const MAX_EVIDENCE_LENGTH = 65535;

/**
 * Bulk intake: every row becomes one Lead owned by the selected owner or
 * unassigned. All field interpretation uses the SAME helpers as manual
 * create — the route passes raw cells only. Canonical stages stay; unknown
 * raw stages keep the original as evidence with a review flag. Raw owner
 * evidence is never silently resolved to a user — authority comes only from
 * the selected owner. Active canonical stages share the manual owner +
 * dated-next-action validation; invalid active rows fail as row errors with
 * NO saved Lead. Each row commits in its own transaction so an audit-write
 * failure cannot leave a saved Lead behind a reported error.
 */
export async function importLeads(
	rows: ImportLeadRow[],
	ownerUserId: number | null,
	actorUserId: number
): Promise<ImportLeadResult> {
	const db = (await dbConnect()) as unknown as DbConnection;
	const tx = requireDbTransaction(db);
	try {
		if (ownerUserId !== null) {
			await assertOwnerAssignable(db, ownerUserId);
		}
		let imported = 0;
		let needsReview = 0;
		const errors: string[] = [];
		for (const row of rows) {
			const companyName = trimOrNull(row.company_name);
			if (!companyName) {
				errors.push(`Row ${row.rowNumber}: Missing company name`);
				continue;
			}
			const canonical = resolveCanonicalStage(row.enquiry_status);
			const hasStageEvidence =
				row.enquiry_status !== null && String(row.enquiry_status).trim() !== '';
			const hasOwnerEvidence =
				row.owner_evidence !== null && String(row.owner_evidence).trim() !== '';
			const reviewRequired =
				(hasStageEvidence && canonical === null) || hasOwnerEvidence;
			const rawStage = hasStageEvidence ? String(row.enquiry_status) : null;
			const ownerEvidence = hasOwnerEvidence
				? String(row.owner_evidence)
				: null;
			if (
				(rawStage !== null && rawStage.length > MAX_EVIDENCE_LENGTH) ||
				(ownerEvidence !== null && ownerEvidence.length > MAX_EVIDENCE_LENGTH)
			) {
				errors.push(
					`Row ${row.rowNumber}: legacy evidence exceeds ${MAX_EVIDENCE_LENGTH} characters; row rejected without truncation`
				);
				continue;
			}
			const followUpDate = normalizeDate(row.follow_up_date);
			if (canonical !== null) {
				try {
					assertActiveStageRequirements(canonical, ownerUserId, followUpDate);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					errors.push(`Row ${row.rowNumber}: ${message}`);
					continue;
				}
			}
			let begun = false;
			try {
				await tx.begin();
				begun = true;
				const [result] = (await db.execute(
					`INSERT INTO leads (
              company_name, contact_name, contact_email, phone, city,
              project_description, enquiry_type, enquiry_status, enquiry_date,
              follow_up_date, lead_source, priority, designation, notes,
              owner_user_id, legacy_owner_name, legacy_stage,
              legacy_review_required, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
					[
						companyName,
						trimOrNull(row.contact_name),
						normalizeEmail(row.contact_email),
						trimOrNull(row.phone),
						trimOrNull(row.city),
						trimOrNull(row.project_description),
						trimOrNull(row.enquiry_type),
						canonical,
						normalizeDate(row.enquiry_date),
						followUpDate,
						trimOrNull(row.lead_source),
						normalizePriority(row.priority),
						trimOrNull(row.designation),
						trimOrNull(row.notes),
						ownerUserId,
						ownerEvidence,
						rawStage,
						reviewRequired ? 1 : 0,
					]
				)) as unknown as [{ insertId: number }, unknown];
				await recordOwnershipChange(
					db,
					result.insertId,
					null,
					ownerUserId,
					actorUserId
				);
				await tx.commit();
				begun = false;
				imported++;
				if (reviewRequired) needsReview++;
			} catch (error) {
				if (begun) {
					try {
						await tx.rollback();
					} catch {
						// A failed rollback after a failed row must not mask the
						// original row error; the connection is released below.
					}
				}
				const message = error instanceof Error ? error.message : String(error);
				errors.push(`Row ${row.rowNumber}: ${message}`);
			}
		}
		return {
			imported,
			needs_review: needsReview,
			errors: errors.length > 0 ? errors : null,
		};
	} finally {
		db.release?.();
	}
}

function buildListWhere(filters: LeadListFilters): {
	clause: string;
	params: unknown[];
} {
	let clause = `WHERE ${LEAD_ACTIVE_FILTER}`;
	const params: unknown[] = [];
	if (filters.search) {
		const term = `%${filters.search.toLowerCase()}%`;
		clause +=
			' AND (LOWER(l.lead_id) LIKE ? OR LOWER(l.company_name) LIKE ? OR LOWER(l.contact_name) LIKE ? OR LOWER(l.contact_email) LIKE ? OR LOWER(l.project_description) LIKE ?)';
		params.push(term, term, term, term, term);
	}
	if (filters.status) {
		if (isLeadStage(filters.status)) {
			clause += ' AND l.enquiry_status = ?';
			params.push(filters.status);
		} else if (filters.status === 'Unresolved') {
			clause += ' AND l.enquiry_status IS NULL';
		} else {
			// Unknown status values match nothing rather than leaking rows.
			clause += ' AND 1 = 0';
		}
	}
	if (filters.city) {
		clause += ' AND l.city LIKE ?';
		params.push(`%${filters.city}%`);
	}
	if (filters.owner === 'unassigned') {
		clause += ' AND l.owner_user_id IS NULL';
	} else if (filters.owner) {
		const ownerId = toNullableId(filters.owner);
		if (ownerId === null) {
			clause += ' AND 1 = 0';
		} else {
			clause += ' AND l.owner_user_id = ?';
			params.push(ownerId);
		}
	}
	if (filters.review === '1') {
		clause += ' AND l.legacy_review_required = 1';
	}
	return { clause, params };
}

function buildOrderBy(sortBy: string, sortOrder: string): string {
	const allowed: Record<string, true> = {
		created_at: true,
		enquiry_date: true,
		company_name: true,
		contact_name: true,
		enquiry_status: true,
		lead_id: true,
		owner_name: true,
		follow_up_date: true,
	};
	const field = allowed[sortBy] ? sortBy : 'created_at';
	const direction = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
	if (field === 'lead_id') {
		return `ORDER BY CAST(REGEXP_REPLACE(l.lead_id, '[^0-9]', '') AS UNSIGNED) ${direction}, l.lead_id ${direction}, l.id ${direction}`;
	}
	if (field === 'owner_name') {
		return `ORDER BY u.full_name ${direction}, l.id ${direction}`;
	}
	// Every branch ends in l.id so page order is deterministic.
	return `ORDER BY l.${field} ${direction}, l.id ${direction}`;
}

/**
 * Strictly validated pagination literals. mysql2 prepared statements reject
 * bound LIMIT/OFFSET on MySQL 8.4 (ER_WRONG_ARGUMENTS), so the integers are
 * clamped in code and inlined — no user SQL can reach this string.
 */
function buildLimitOffset(page: number, limit: number): string {
	const safeLimit =
		Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 20;
	const safePage = Number.isInteger(page) && page > 0 ? page : 1;
	const safeOffset = (safePage - 1) * safeLimit;
	return `LIMIT ${safeLimit} OFFSET ${safeOffset}`;
}

/** Shared list query: same filters, same soft-delete, full-dataset stats. */
export async function listLeads(filters: LeadListFilters): Promise<{
	leads: LeadReadModel[];
	stats: LeadListStats;
	total: number;
}> {
	const db = (await dbConnect()) as unknown as DbConnection;
	try {
		const { clause, params } = buildListWhere(filters);
		const orderBy = buildOrderBy(filters.sortBy, filters.sortOrder);
		const limitOffset = buildLimitOffset(filters.page, filters.limit);

		const [countResult, leadsResult, statsResult] = await Promise.all([
			db.execute(
				`SELECT COUNT(*) as total ${LEAD_LIST_FROM} ${clause}`,
				params
			),
			db.execute(
				`SELECT ${LEAD_LIST_SELECT} ${LEAD_LIST_FROM} ${clause} ${orderBy} ${limitOffset}`,
				params
			),
			db.execute(
				`SELECT
            COUNT(*) as total_leads,
            SUM(CASE WHEN l.owner_user_id IS NULL THEN 1 ELSE 0 END) as unassigned_leads,
            SUM(CASE WHEN l.legacy_review_required = 1 THEN 1 ELSE 0 END) as needs_review_leads,
            SUM(CASE WHEN l.enquiry_status = 'New' THEN 1 ELSE 0 END) as stage_new,
            SUM(CASE WHEN l.enquiry_status = 'Attempting Contact' THEN 1 ELSE 0 END) as stage_attempting_contact,
            SUM(CASE WHEN l.enquiry_status = 'Connected' THEN 1 ELSE 0 END) as stage_connected,
            SUM(CASE WHEN l.enquiry_status = 'Qualified' THEN 1 ELSE 0 END) as stage_qualified,
            SUM(CASE WHEN l.enquiry_status = 'Nurture' THEN 1 ELSE 0 END) as stage_nurture,
            SUM(CASE WHEN l.enquiry_status = 'Disqualified' THEN 1 ELSE 0 END) as stage_disqualified,
            SUM(CASE WHEN l.enquiry_status = 'Converted' THEN 1 ELSE 0 END) as stage_converted,
            SUM(CASE WHEN l.enquiry_status IS NULL THEN 1 ELSE 0 END) as stage_unresolved
          ${LEAD_LIST_FROM} ${clause}`,
				params
			),
		]);
		const [[countRow]] = countResult as unknown as [CountRow[], unknown];
		const [leadRows] = leadsResult as unknown as [LeadRow[], unknown];
		const [[statsRow]] = statsResult as unknown as [StatsRow[], unknown];

		const stats: LeadListStats = {
			total_leads: Number(statsRow.total_leads) || 0,
			unassigned_leads: Number(statsRow.unassigned_leads) || 0,
			needs_review_leads: Number(statsRow.needs_review_leads) || 0,
			stage_new: Number(statsRow.stage_new) || 0,
			stage_attempting_contact: Number(statsRow.stage_attempting_contact) || 0,
			stage_connected: Number(statsRow.stage_connected) || 0,
			stage_qualified: Number(statsRow.stage_qualified) || 0,
			stage_nurture: Number(statsRow.stage_nurture) || 0,
			stage_disqualified: Number(statsRow.stage_disqualified) || 0,
			stage_converted: Number(statsRow.stage_converted) || 0,
			stage_unresolved: Number(statsRow.stage_unresolved) || 0,
		};
		return {
			leads: leadRows.map(serializeLead),
			stats,
			total: countRow.total,
		};
	} finally {
		db.release?.();
	}
}

/**
 * Detail read: durable fields plus same-enquiry duplicate candidates and the
 * assignment audit. Candidates share company + project evidence but stay
 * separate leads — review only, never merged.
 */
export async function getLeadDetail(id: number): Promise<LeadReadModel> {
	const db = (await dbConnect()) as unknown as DbConnection;
	try {
		const [rows] = (await db.execute(
			`SELECT ${LEAD_LIST_SELECT} ${LEAD_LIST_FROM}
        WHERE l.id = ? AND ${LEAD_ACTIVE_FILTER}
        LIMIT 1`,
			[id]
		)) as unknown as [LeadRow[], unknown];
		if (rows.length === 0) {
			throw new LeadWorkflowError('not_found', 'Lead not found', 404);
		}
		const lead = serializeLead(rows[0]);
		const companyName = trimOrNull(rows[0].company_name);
		const project = trimOrNull(rows[0].project_description);
		let duplicateCandidates: DuplicateCandidate[] = [];
		if (companyName && project) {
			const [candidateRows] = (await db.execute(
				`SELECT id, lead_id, project_description
          FROM leads
          WHERE id <> ?
            AND (isDelete = 0 OR isDelete IS NULL)
            AND TRIM(company_name) = ?
            AND TRIM(project_description) = ?
          ORDER BY id ASC
          LIMIT 20`,
				[id, companyName, project]
			)) as unknown as [DuplicateCandidate[], unknown];
			duplicateCandidates = candidateRows.map((row) => ({
				id: row.id,
				lead_id: trimOrNull(row.lead_id),
				project_description: trimOrNull(row.project_description),
			}));
		}
		const [historyRows] = (await db.execute(
			`SELECT id, prior_owner_user_id, owner_user_id, actor_user_id, created_at
        FROM lead_ownership_history
        WHERE lead_id = ?
        ORDER BY id ASC`,
			[id]
		)) as unknown as [
			{
				id: number;
				prior_owner_user_id: number | null;
				owner_user_id: number | null;
				actor_user_id: number | null;
				created_at: unknown;
			}[],
			unknown,
		];
		lead.duplicate_candidates = duplicateCandidates;
		lead.ownership_history = historyRows.map((row) => ({
			id: row.id,
			prior_owner_user_id: toNullableId(row.prior_owner_user_id),
			owner_user_id: toNullableId(row.owner_user_id),
			actor_user_id: toNullableId(row.actor_user_id),
			created_at:
				row.created_at instanceof Date
					? row.created_at.toISOString()
					: trimOrNull(row.created_at),
		}));
		return lead;
	} finally {
		db.release?.();
	}
}

/** Minimal assignment directory: active users only, name-ordered. */
export async function listLeadOwners(): Promise<OwnerRow[]> {
	const db = (await dbConnect()) as unknown as DbConnection;
	try {
		const [rows] = (await db.execute(
			`SELECT u.id, u.full_name
        FROM users u
        WHERE ${ASSIGNABLE_USER_FILTER}
          AND u.full_name IS NOT NULL AND TRIM(u.full_name) <> ''
        ORDER BY u.full_name ASC, u.id ASC`
		)) as unknown as [OwnerRow[], unknown];
		return rows;
	} finally {
		db.release?.();
	}
}
