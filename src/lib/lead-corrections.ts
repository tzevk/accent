import { isLeadActivityType, isLeadCallOutcome } from '@/lib/lead-activities';

/**
 * The pure rules of a Lead activity correction (ticket #372).
 *
 * Client-safe: this module has no server imports, so the interface, the
 * server workflow, and the tests share one decision without a second
 * convention. Persistence authority is `lead_activity_corrections`; this
 * file decides what a correction may say and nothing else.
 *
 * A correction is a statement about evidence that already exists:
 * - It needs a reason. A correction without one is refused.
 * - It may only state values that are valid for the row. A call outcome
 *   belongs to a call, a reply flag belongs to an email.
 * - It never invents provenance. The author of a row and the outcome the
 *   original record did not have stay unknown unless the operator states
 *   them, and the correction keeps the previous values either way.
 * - It never changes what the row is scheduled for: the status, the
 *   scheduled date, and the recording provenance of the row stay as they
 *   were.
 */

/** The fields a correction may state. */
export const LEAD_CORRECTION_FIELDS = [
	'activity_type',
	'call_outcome',
	'reply_confirmed',
	'occurred_at',
	'notes',
] as const;

export type LeadCorrectionField = (typeof LEAD_CORRECTION_FIELDS)[number];

/** The values of one activity row a correction speaks about. */
export interface LeadActivityCorrectionValues {
	activity_type: string | null;
	call_outcome: string | null;
	reply_confirmed: boolean | null;
	occurred_at: string | null;
	notes: string | null;
}

/** The values one correction request may state. */
export interface LeadCorrectionRequest {
	reason?: unknown;
	activity_type?: unknown;
	call_outcome?: unknown;
	reply_confirmed?: unknown;
	occurred_at?: unknown;
	notes?: unknown;
}

export type LeadCorrectionErrorCode =
	| 'reason_required'
	| 'activity_type_invalid'
	| 'activity_outcome_invalid'
	| 'activity_invalid';

export type LeadCorrectionPlan =
	| {
			ok: true;
			reason: string;
			previous: LeadActivityCorrectionValues;
			corrected: LeadActivityCorrectionValues;
			changed: LeadCorrectionField[];
	  }
	| { ok: false; code: LeadCorrectionErrorCode; message: string };

/** One changed value, ready to be shown to a person. */
export interface LeadCorrectionChange {
	field: LeadCorrectionField;
	label: string;
	from: string;
	to: string;
}

const CHANGE_LABELS: Record<LeadCorrectionField, string> = {
	activity_type: 'Activity type',
	call_outcome: 'Call outcome',
	reply_confirmed: 'Reply confirmed',
	occurred_at: 'Occurred at',
	notes: 'Notes',
};

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * The canonical shape of a moment: `YYYY-MM-DDTHH:mm:ss` in the local time
 * of the server, so the value that is written and the value that is read
 * back are the same moment.
 */
export function normalizeOccurredAt(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string') return null;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return null;
	return (
		`${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` +
		`T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`
	);
}

/** The correction version the editor saw, or null when it is not one. */
export function parseCorrectionVersion(value: unknown): number | null {
	const parsed =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim() !== ''
				? Number(value)
				: Number.NaN;
	if (!Number.isInteger(parsed) || parsed < 1) return null;
	return parsed;
}

/** True when the activity moved on since the editor opened it. */
export function correctionVersionConflict(
	expected: number,
	actual: number
): boolean {
	return expected !== actual;
}

/** The value as a person reads it. An unknown value says so. */
function describeValue(field: LeadCorrectionField, value: unknown): string {
	if (field === 'reply_confirmed') {
		if (value === true) return 'yes';
		if (value === false) return 'no';
		return 'unknown';
	}
	if (
		value === null ||
		value === undefined ||
		(typeof value === 'string' && value.trim() === '')
	) {
		return 'unknown';
	}
	return String(value);
}

/**
 * The values the correction changes, with the old and the new value ready
 * to be shown. The correction history and the timeline read the same
 * description, so both tell the same story.
 */
export function describeCorrectionChanges(
	previous: LeadActivityCorrectionValues,
	corrected: LeadActivityCorrectionValues
): LeadCorrectionChange[] {
	const changes: LeadCorrectionChange[] = [];
	for (const field of LEAD_CORRECTION_FIELDS) {
		if (previous[field] === corrected[field]) continue;
		changes.push({
			field,
			label: CHANGE_LABELS[field],
			from: describeValue(field, previous[field]),
			to: describeValue(field, corrected[field]),
		});
	}
	return changes;
}

/**
 * The decision a correction request makes: the reason, the values before
 * the correction, the values after it, and the fields that changed.
 *
 * A refused correction changes nothing: the caller writes nothing at all.
 */
export function planLeadActivityCorrection(
	current: LeadActivityCorrectionValues,
	input: LeadCorrectionRequest
): LeadCorrectionPlan {
	const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
	if (reason === '') {
		return {
			ok: false,
			code: 'reason_required',
			message: 'A correction needs a reason.',
		};
	}

	const previous: LeadActivityCorrectionValues = {
		activity_type: current.activity_type ?? null,
		call_outcome: current.call_outcome ?? null,
		reply_confirmed:
			current.reply_confirmed === null || current.reply_confirmed === undefined
				? null
				: Boolean(current.reply_confirmed),
		occurred_at: normalizeOccurredAt(current.occurred_at),
		notes: current.notes ?? null,
	};
	const corrected: LeadActivityCorrectionValues = { ...previous };

	// The kind of the work. An unknown kind stays unknown: a correction
	// states a kind, it never erases one.
	if (input.activity_type !== undefined) {
		if (!isLeadActivityType(input.activity_type)) {
			return {
				ok: false,
				code: 'activity_type_invalid',
				message: 'The activity type must be Call, Email, Meeting, or Note.',
			};
		}
		corrected.activity_type = input.activity_type;
	}

	// The outcome of a call.
	if (input.call_outcome !== undefined && input.call_outcome !== null) {
		if (!isLeadCallOutcome(input.call_outcome)) {
			return {
				ok: false,
				code: 'activity_outcome_invalid',
				message: 'A call outcome must be one of the canonical call outcomes.',
			};
		}
		if (corrected.activity_type !== 'Call') {
			return {
				ok: false,
				code: 'activity_outcome_invalid',
				message: 'A call outcome applies to call activities only.',
			};
		}
		corrected.call_outcome = input.call_outcome;
	} else if (input.call_outcome === null) {
		corrected.call_outcome = null;
	}

	// Whether the client answered the email.
	if (input.reply_confirmed !== undefined && input.reply_confirmed !== null) {
		if (typeof input.reply_confirmed !== 'boolean') {
			return {
				ok: false,
				code: 'activity_invalid',
				message: 'reply_confirmed must be true or false.',
			};
		}
		if (corrected.activity_type !== 'Email') {
			return {
				ok: false,
				code: 'activity_invalid',
				message: 'reply_confirmed applies to email activities only.',
			};
		}
		corrected.reply_confirmed = input.reply_confirmed;
	} else if (input.reply_confirmed === null) {
		corrected.reply_confirmed = null;
	}

	// When the work happened.
	if (input.occurred_at !== undefined) {
		if (input.occurred_at === null || input.occurred_at === '') {
			corrected.occurred_at = null;
		} else {
			const occurredAt = normalizeOccurredAt(input.occurred_at);
			if (occurredAt === null) {
				return {
					ok: false,
					code: 'activity_invalid',
					message: 'occurred_at must be an ISO date-time.',
				};
			}
			corrected.occurred_at = occurredAt;
		}
	}

	// The plain-text note.
	if (input.notes !== undefined) {
		if (input.notes === null) {
			corrected.notes = null;
		} else if (typeof input.notes !== 'string') {
			return {
				ok: false,
				code: 'activity_invalid',
				message: 'notes must be plain text.',
			};
		} else {
			corrected.notes = input.notes.trim() === '' ? null : input.notes.trim();
		}
	}

	// A kind that changed takes its evidence with it: an outcome that no
	// longer applies and a reply flag of another kind are cleared. A kind
	// that stayed leaves the evidence of the row as it was.
	if (corrected.activity_type !== previous.activity_type) {
		if (corrected.activity_type !== 'Call') corrected.call_outcome = null;
		if (corrected.activity_type !== 'Email') corrected.reply_confirmed = null;
	}

	const changed = describeCorrectionChanges(previous, corrected).map(
		(change) => change.field
	);
	return { ok: true, reason, previous, corrected, changed };
}
