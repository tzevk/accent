import { describe, expect, it } from 'vitest';
import {
	summarizeWorkSessions,
	unavailableWorkSessionSummary,
	type WorkSessionObservation,
} from '@/lib/work-session-summary';

/**
 * One observation row, mirroring what the attendance query reads: numeric
 * epoch-ms strings from the driver's DECIMAL cells, SQL-formatted HH:MM
 * labels, and the row status. Defaults are an ended morning session.
 */
function row(
	overrides: Partial<WorkSessionObservation> = {}
): WorkSessionObservation {
	const start = Date.UTC(2026, 9, 26, 9, 6, 11);
	const end = Date.UTC(2026, 9, 26, 9, 37, 11);
	return {
		startMs: String(start),
		endMs: String(end),
		startLabel: '09:06',
		endLabel: '09:37',
		endSource: 'logout',
		status: 'ended',
		...overrides,
	};
}

const AS_OF = Date.UTC(2026, 9, 26, 18, 30, 0, 123);

describe('summarizeWorkSessions', () => {
	it('surfaces the production reversed 09:06/04:07 end as invalid, never repaired', () => {
		// 2026-10-26 evidence: the beacon end lands five hours before its
		// start. The row stays visible through the start label; the total and
		// the end are withheld rather than guessed.
		const summary = summarizeWorkSessions(
			[
				row({
					endMs: String(Date.UTC(2026, 9, 26, 4, 7, 37)),
					endLabel: '04:07',
					endSource: 'beacon',
				}),
			],
			AS_OF
		);

		expect(summary.sessionStartTime).toBe('09:06');
		expect(summary.sessionTimeInvalid).toBe(true);
		expect(summary.sessionElapsedMinutes).toBeNull();
		expect(summary.sessionEndTime).toBeNull();
		expect(summary.sessionEndSource).toBeNull();
		expect(summary.sessionActive).toBe(false);
		expect(summary.sessionAsOf).toBe(AS_OF);
	});

	it('excludes the break between two disjoint sessions', () => {
		// 09:00–10:00 and 11:00–12:00: two hours of presence with an idle
		// hour between, which the total must not claim.
		const summary = summarizeWorkSessions(
			[
				row({
					startMs: String(Date.UTC(2026, 9, 26, 9, 0, 0)),
					endMs: String(Date.UTC(2026, 9, 26, 10, 0, 0)),
					startLabel: '09:00',
					endLabel: '10:00',
				}),
				row({
					startMs: String(Date.UTC(2026, 9, 26, 11, 0, 0)),
					endMs: String(Date.UTC(2026, 9, 26, 12, 0, 0)),
					startLabel: '11:00',
					endLabel: '12:00',
					endSource: 'beacon',
				}),
			],
			AS_OF
		);

		expect(summary.sessionTimeInvalid).toBe(false);
		expect(summary.sessionActive).toBe(false);
		expect(summary.sessionElapsedMinutes).toBe(120);
		expect(summary.sessionStartTime).toBe('09:00');
		expect(summary.sessionEndTime).toBe('12:00');
		expect(summary.sessionEndSource).toBe('beacon');
	});

	it('unions overlapping rows instead of double counting them', () => {
		// 09:00–10:30 and 10:00–11:00 share half an hour across two tabs;
		// the day holds two hours of presence, not two and a half.
		const summary = summarizeWorkSessions(
			[
				row({
					startMs: String(Date.UTC(2026, 9, 26, 9, 0, 0)),
					endMs: String(Date.UTC(2026, 9, 26, 10, 30, 0)),
					startLabel: '09:00',
					endLabel: '10:30',
				}),
				row({
					startMs: String(Date.UTC(2026, 9, 26, 10, 0, 0)),
					endMs: String(Date.UTC(2026, 9, 26, 11, 0, 0)),
					startLabel: '10:00',
					endLabel: '11:00',
					endSource: 'sweep',
				}),
			],
			AS_OF
		);

		expect(summary.sessionTimeInvalid).toBe(false);
		expect(summary.sessionElapsedMinutes).toBe(120);
		expect(summary.sessionEndTime).toBe('11:00');
		expect(summary.sessionEndSource).toBe('sweep');
	});

	it('suppresses the old end while a session is active and runs the total to now', () => {
		// A closed 09:00–09:31 morning span plus a session open since 18:15:
		// the morning end is history, and the total advances with the clock.
		const early = summarizeWorkSessions(
			[
				row({
					startMs: String(Date.UTC(2026, 9, 26, 9, 0, 0)),
					endMs: String(Date.UTC(2026, 9, 26, 9, 31, 0)),
					startLabel: '09:00',
					endLabel: '09:31',
					endSource: 'logout',
				}),
				row({
					startMs: String(Date.UTC(2026, 9, 26, 18, 15, 0)),
					endMs: null,
					startLabel: '18:15',
					endLabel: null,
					endSource: null,
					status: 'active',
				}),
			],
			Date.UTC(2026, 9, 26, 18, 30, 0)
		);
		const later = summarizeWorkSessions(
			[
				row({
					startMs: String(Date.UTC(2026, 9, 26, 9, 0, 0)),
					endMs: String(Date.UTC(2026, 9, 26, 9, 31, 0)),
					startLabel: '09:00',
					endLabel: '09:31',
					endSource: 'logout',
				}),
				row({
					startMs: String(Date.UTC(2026, 9, 26, 18, 15, 0)),
					endMs: null,
					startLabel: '18:15',
					endLabel: null,
					endSource: null,
					status: 'active',
				}),
			],
			Date.UTC(2026, 9, 26, 19, 0, 0)
		);

		expect(early.sessionActive).toBe(true);
		expect(early.sessionTimeInvalid).toBe(false);
		expect(early.sessionEndTime).toBeNull();
		expect(early.sessionEndSource).toBeNull();
		expect(early.sessionElapsedMinutes).toBe(46);
		expect(early.sessionStartTime).toBe('09:00');
		// The same spans read later advance the snapshot: 31m + 45m.
		expect(later.sessionElapsedMinutes).toBe(76);
		expect(later.sessionEndTime).toBeNull();
	});

	it('measures a full-dated overnight span as genuine elapsed time', () => {
		// 22:00 → 06:00 the next morning is eight hours on the full dates,
		// never a negative minutes-of-day difference on the clock face.
		const summary = summarizeWorkSessions(
			[
				row({
					startMs: String(Date.UTC(2026, 9, 25, 22, 0, 0)),
					endMs: String(Date.UTC(2026, 9, 26, 6, 0, 0)),
					startLabel: '22:00',
					endLabel: '06:00',
				}),
			],
			AS_OF
		);

		expect(summary.sessionTimeInvalid).toBe(false);
		expect(summary.sessionElapsedMinutes).toBe(480);
		expect(summary.sessionStartTime).toBe('22:00');
		expect(summary.sessionEndTime).toBe('06:00');
	});

	it('answers null, not zero, when the day holds no sessions at all', () => {
		const summary = summarizeWorkSessions([], AS_OF);

		expect(summary.sessionElapsedMinutes).toBeNull();
		expect(summary.sessionStartTime).toBeNull();
		expect(summary.sessionEndTime).toBeNull();
		expect(summary.sessionEndSource).toBeNull();
		expect(summary.sessionActive).toBe(false);
		expect(summary.sessionTimeInvalid).toBe(false);
		expect(summary.sessionAsOf).toBe(AS_OF);
	});

	it('withholds the total when the snapshot clock is unreadable', () => {
		const summary = summarizeWorkSessions([row()], 'not-an-epoch');

		expect(summary.sessionTimeInvalid).toBe(true);
		expect(summary.sessionElapsedMinutes).toBeNull();
		expect(summary.sessionEndTime).toBeNull();
		expect(summary.sessionEndSource).toBeNull();
		expect(summary.sessionAsOf).toBeNull();
	});

	it('treats a legacy end without a source as unknown, not inferred', () => {
		// A row written before the column existed carries a genuine end but
		// no record of how; the label stands, the source stays null.
		const summary = summarizeWorkSessions([row({ endSource: null })], AS_OF);

		expect(summary.sessionTimeInvalid).toBe(false);
		expect(summary.sessionEndTime).toBe('09:37');
		expect(summary.sessionEndSource).toBeNull();
		expect(summary.sessionElapsedMinutes).toBe(31);
	});
});

describe('unavailableWorkSessionSummary', () => {
	it('returns an unavailable snapshot with no invented duration', () => {
		expect(unavailableWorkSessionSummary()).toEqual({
			sessionStartTime: null,
			sessionEndTime: null,
			sessionEndSource: null,
			sessionElapsedMinutes: null,
			sessionAsOf: null,
			sessionActive: false,
			sessionTimeInvalid: false,
		});
	});
});
