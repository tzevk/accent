import { describe, it, expect } from 'vitest';
import { pickRecentDecision, DECISION_WINDOW_DAYS } from '@/lib/leave-display';

const NOW = new Date('2026-08-25T10:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('pickRecentDecision', () => {
	it('returns null when there are no applications', () => {
		expect(pickRecentDecision([], NOW)).toBeNull();
		expect(pickRecentDecision(undefined, NOW)).toBeNull();
	});

	it('returns null when nothing has been reviewed yet', () => {
		expect(
			pickRecentDecision([{ id: 1, status: 'pending', reviewed_at: null }], NOW)
		).toBeNull();
	});

	it('surfaces a recent approval', () => {
		const decision = pickRecentDecision(
			[{ id: 7, status: 'approved', reviewed_at: daysAgo(1) }],
			NOW
		);
		expect(decision).toEqual({
			id: 7,
			kind: 'approved',
			reviewedAt: daysAgo(1),
		});
	});

	it('surfaces a recent rejection the same way', () => {
		const decision = pickRecentDecision(
			[{ id: 8, status: 'rejected', reviewed_at: daysAgo(2) }],
			NOW
		);
		expect(decision?.kind).toBe('rejected');
	});

	it('ignores decisions older than the window', () => {
		expect(
			pickRecentDecision(
				[
					{
						id: 9,
						status: 'approved',
						reviewed_at: daysAgo(DECISION_WINDOW_DAYS + 1),
					},
				],
				NOW
			)
		).toBeNull();
	});

	it('keeps a decision exactly at the window boundary', () => {
		const decision = pickRecentDecision(
			[
				{
					id: 10,
					status: 'approved',
					reviewed_at: daysAgo(DECISION_WINDOW_DAYS),
				},
			],
			NOW
		);
		expect(decision?.id).toBe(10);
	});

	it('prefers the most recent review when several qualify', () => {
		const decision = pickRecentDecision(
			[
				{ id: 11, status: 'approved', reviewed_at: daysAgo(3) },
				{ id: 12, status: 'rejected', reviewed_at: daysAgo(1) },
			],
			NOW
		);
		expect(decision).toEqual({
			id: 12,
			kind: 'rejected',
			reviewedAt: daysAgo(1),
		});
	});

	it('skips applications with missing or invalid reviewed_at', () => {
		expect(
			pickRecentDecision(
				[
					{ id: 13, status: 'approved' },
					{ id: 14, status: 'rejected', reviewed_at: 'not-a-date' },
				],
				NOW
			)
		).toBeNull();
	});
});
