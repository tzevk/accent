import { isLeadStage, type LeadStage } from '@/lib/lead-stages';

/**
 * Primitives shared by the Lead workflow and the legacy Lead review.
 *
 * Both modules interpret stored Lead values the same way, so the parsing
 * rules live here once: the same evidence handling, the same owner
 * validation, the same transaction handling, and the same error contract.
 */

/**
 * Assignable-user predicate, matching the authentication active policy:
 * `status` active-or-NULL, `is_active` 1-or-NULL, `isDelete` 0. Used for
 * assignment validation, the owner directory, and the owner-name join so a
 * status='inactive' account with a stale is_active=1 can never own leads.
 */
export const ASSIGNABLE_USER_FILTER = `(u.is_active = 1 OR u.is_active IS NULL)
    AND (u.status = 'active' OR u.status IS NULL)
    AND u.isDelete = 0`;

export type LeadWorkflowErrorCode =
	| 'company_required'
	| 'stage_unknown'
	| 'conversion_unavailable'
	| 'transition_unavailable'
	| 'owner_required'
	| 'owner_unknown'
	| 'next_action_required'
	| 'not_found'
	| 'duplicate_lead_id'
	| 'review_type_invalid'
	| 'review_item_not_open'
	| 'reason_required'
	| 'proposal_not_linked'
	| 'proposal_link_conflict';

export class LeadWorkflowError extends Error {
	readonly code: LeadWorkflowErrorCode;
	readonly status: number;

	constructor(code: LeadWorkflowErrorCode, message: string, status: number) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

export type DbConnection = {
	execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
	beginTransaction?: () => Promise<void>;
	commit?: () => Promise<void>;
	rollback?: () => Promise<void>;
	release?: () => void;
};

export function toNullableId(value: unknown): number | null {
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
export function rawOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return String(value);
}

export function trimOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
	const text = trimOrNull(value);
	if (!text) return null;
	return EMAIL_PATTERN.test(text) ? text : null;
}

export function normalizeCc(value: unknown): string | null {
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

export function normalizePriority(value: unknown): string {
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

export function normalizeDate(value: unknown): string | null {
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

export function requireDbTransaction(db: DbConnection): {
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

export async function assertOwnerAssignable(
	db: DbConnection,
	ownerUserId: number
): Promise<void> {
	const [rows] = (await db.execute(
		`SELECT u.id FROM users u
      WHERE u.id = ? AND ${ASSIGNABLE_USER_FILTER}
      LIMIT 1`,
		[ownerUserId]
	)) as unknown as [{ id: number }[], unknown];
	if (rows.length === 0) {
		throw new LeadWorkflowError(
			'owner_unknown',
			'Lead owner must be an active user',
			422
		);
	}
}

export async function recordOwnershipChange(
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
