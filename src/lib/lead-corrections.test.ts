import { describe, expect, it } from 'vitest';
import {
	correctionVersionConflict,
	describeCorrectionChanges,
	normalizeOccurredAt,
	parseCorrectionVersion,
	planLeadActivityCorrection,
	type LeadActivityCorrectionValues,
} from '@/lib/lead-corrections';

/**
 * The pure rules of a Lead activity correction (ticket #372).
 *
 * A correction is a statement about evidence that already exists: it needs a
 * reason, it may only state values that are valid for the row, and it never
 * invents the provenance the original record did not have. The server turns
 * the plan into a write; these rules are the decision itself.
 */

function values(
	overrides: Partial<LeadActivityCorrectionValues> = {}
): LeadActivityCorrectionValues {
	return {
		activity_type: 'Call',
		call_outcome: 'No Answer',
		reply_confirmed: null,
		occurred_at: '2026-10-20T09:00:00',
		notes: 'Nobody answered.',
		...overrides,
	};
}

describe('planLeadActivityCorrection', () => {
	it('refuses a correction without a reason', () => {
		const plan = planLeadActivityCorrection(values(), { reason: '   ' });
		expect(plan.ok).toBe(false);
		if (plan.ok) return;
		expect(plan.code).toBe('reason_required');
	});

	it('refuses an unknown activity type', () => {
		const plan = planLeadActivityCorrection(values(), {
			reason: 'Wrong kind',
			activity_type: 'Voicemail',
		});
		expect(plan.ok).toBe(false);
		if (plan.ok) return;
		expect(plan.code).toBe('activity_type_invalid');
	});

	it('refuses an unknown call outcome', () => {
		const plan = planLeadActivityCorrection(values(), {
			reason: 'Wrong outcome',
			call_outcome: 'Spoke',
		});
		expect(plan.ok).toBe(false);
		if (plan.ok) return;
		expect(plan.code).toBe('activity_outcome_invalid');
	});

	it('refuses a call outcome on an activity that is not a call', () => {
		const plan = planLeadActivityCorrection(values({ activity_type: 'Note' }), {
			reason: 'Wrong outcome',
			call_outcome: 'Connected',
		});
		expect(plan.ok).toBe(false);
		if (plan.ok) return;
		expect(plan.code).toBe('activity_outcome_invalid');
	});

	it('refuses a reply flag on an activity that is not an email', () => {
		const plan = planLeadActivityCorrection(values(), {
			reason: 'Wrong flag',
			reply_confirmed: true,
		});
		expect(plan.ok).toBe(false);
		if (plan.ok) return;
		expect(plan.code).toBe('activity_invalid');
	});

	it('keeps every value the correction does not state', () => {
		const plan = planLeadActivityCorrection(values(), {
			reason: 'The note was wrong',
			notes: 'The site manager was in a meeting.',
		});
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.corrected.activity_type).toBe('Call');
		expect(plan.corrected.call_outcome).toBe('No Answer');
		expect(plan.corrected.reply_confirmed).toBeNull();
		expect(plan.corrected.occurred_at).toBe('2026-10-20T09:00:00');
		expect(plan.corrected.notes).toBe('The site manager was in a meeting.');
		expect(plan.changed).toEqual(['notes']);
	});

	it('clears the outcome that no longer applies when the kind changes', () => {
		const plan = planLeadActivityCorrection(values(), {
			reason: 'It was a note, not a call',
			activity_type: 'Note',
		});
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.corrected.call_outcome).toBeNull();
		expect(plan.changed).toEqual(['activity_type', 'call_outcome']);
	});

	it('leaves the unknown kind and the unknown outcome of a legacy row alone', () => {
		const plan = planLeadActivityCorrection(
			values({ activity_type: null, call_outcome: null, notes: null }),
			{ reason: 'The note was wrong', notes: 'The old description.' }
		);
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.corrected.activity_type).toBeNull();
		expect(plan.corrected.call_outcome).toBeNull();
		expect(plan.changed).toEqual(['notes']);
	});

	it('keeps the outcome the operator states for a call', () => {
		const plan = planLeadActivityCorrection(
			values({ activity_type: 'Note', call_outcome: null }),
			{ reason: 'It was a call', activity_type: 'Call', call_outcome: 'Busy' }
		);
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.corrected.call_outcome).toBe('Busy');
	});

	it('normalises the occurrence time it is given', () => {
		const plan = planLeadActivityCorrection(
			values({ occurred_at: '2026-10-20 09:00:00' }),
			{ reason: 'Wrong time', occurred_at: '2026-10-20T11:30' }
		);
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.corrected.occurred_at).toBe('2026-10-20T11:30:00');
		expect(plan.changed).toEqual(['occurred_at']);
	});

	it('refuses an occurrence time that is not a moment', () => {
		const plan = planLeadActivityCorrection(values(), {
			reason: 'Wrong time',
			occurred_at: 'last tuesday',
		});
		expect(plan.ok).toBe(false);
		if (plan.ok) return;
		expect(plan.code).toBe('activity_invalid');
	});

	it('refuses notes that are not text', () => {
		const plan = planLeadActivityCorrection(values(), {
			reason: 'Wrong notes',
			notes: 42,
		});
		expect(plan.ok).toBe(false);
		if (plan.ok) return;
		expect(plan.code).toBe('activity_invalid');
	});
});

describe('parseCorrectionVersion', () => {
	it('accepts a positive whole version', () => {
		expect(parseCorrectionVersion(3)).toBe(3);
		expect(parseCorrectionVersion('3')).toBe(3);
	});

	it('refuses anything that is not a positive whole version', () => {
		expect(parseCorrectionVersion(undefined)).toBeNull();
		expect(parseCorrectionVersion(null)).toBeNull();
		expect(parseCorrectionVersion(0)).toBeNull();
		expect(parseCorrectionVersion(-1)).toBeNull();
		expect(parseCorrectionVersion(1.5)).toBeNull();
		expect(parseCorrectionVersion('two')).toBeNull();
	});
});

describe('correctionVersionConflict', () => {
	it('is a conflict when the activity moved on', () => {
		expect(correctionVersionConflict(1, 2)).toBe(true);
		expect(correctionVersionConflict(2, 2)).toBe(false);
	});
});

describe('describeCorrectionChanges', () => {
	it('names the field, the old value, and the new value', () => {
		const changes = describeCorrectionChanges(
			values(),
			values({ call_outcome: 'Connected' })
		);
		expect(changes).toEqual([
			{
				field: 'call_outcome',
				label: 'Call outcome',
				from: 'No Answer',
				to: 'Connected',
			},
		]);
	});

	it('calls an unknown value unknown', () => {
		const changes = describeCorrectionChanges(
			values({ call_outcome: null }),
			values({ call_outcome: 'Connected' })
		);
		expect(changes[0]?.from).toBe('unknown');
	});
});

describe('normalizeOccurredAt', () => {
	it('reads the stored shape and the input shape alike', () => {
		expect(normalizeOccurredAt('2026-10-20 09:00:00')).toBe(
			'2026-10-20T09:00:00'
		);
		expect(normalizeOccurredAt('2026-10-20T09:00')).toBe('2026-10-20T09:00:00');
		expect(normalizeOccurredAt(null)).toBeNull();
		expect(normalizeOccurredAt('not a moment')).toBeNull();
	});
});
