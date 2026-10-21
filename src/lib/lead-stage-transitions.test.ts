import { describe, it, expect } from 'vitest';
import {
	resolveAutomaticStage,
	type AutomaticStageInput,
} from '@/lib/lead-stage-transitions';
import type { LeadStage } from '@/lib/lead-stages';

/**
 * The automatic stage decision is a pure rule: given the stage a Lead is in
 * and what was just recorded, which stage (if any) follows. It never
 * regresses, never touches a stage a human decided, and never mistakes a
 * note or a scheduled task for outreach.
 */

function input(
	overrides: Partial<AutomaticStageInput> = {}
): AutomaticStageInput {
	return {
		currentStage: 'New' as LeadStage | null,
		activityType: null,
		callOutcome: null,
		replyConfirmed: null,
		...overrides,
	};
}

describe('resolveAutomaticStage', () => {
	it('moves a new Lead to Attempting Contact on the first outreach', () => {
		expect(
			resolveAutomaticStage(
				input({ activityType: 'Call', callOutcome: 'No Answer' })
			)
		).toBe('Attempting Contact');
	});

	it('moves a new Lead to Attempting Contact on a sent email', () => {
		// A sent email is an attempt, not a confirmed reply.
		expect(resolveAutomaticStage(input({ activityType: 'Email' }))).toBe(
			'Attempting Contact'
		);
	});

	it('moves a new Lead to Attempting Contact on a meeting', () => {
		expect(resolveAutomaticStage(input({ activityType: 'Meeting' }))).toBe(
			'Attempting Contact'
		);
	});

	it('moves a new Lead to Connected on a connected call', () => {
		expect(
			resolveAutomaticStage(
				input({ activityType: 'Call', callOutcome: 'Connected' })
			)
		).toBe('Connected');
	});

	it('moves a new Lead to Connected on a confirmed email reply', () => {
		expect(
			resolveAutomaticStage(
				input({ activityType: 'Email', replyConfirmed: true })
			)
		).toBe('Connected');
	});

	it('keeps a failed attempt out of Connected', () => {
		for (const outcome of ['No Answer', 'Busy', 'Voicemail', 'Wrong Number']) {
			expect(
				resolveAutomaticStage(
					input({ activityType: 'Call', callOutcome: outcome as never })
				)
			).toBe('Attempting Contact');
		}
	});

	it('never moves the stage for a note', () => {
		expect(resolveAutomaticStage(input({ activityType: 'Note' }))).toBeNull();
		expect(
			resolveAutomaticStage(input({ currentStage: null, activityType: 'Note' }))
		).toBeNull();
	});

	it('never moves the stage without a recorded kind', () => {
		expect(resolveAutomaticStage(input({ activityType: null }))).toBeNull();
	});

	it('moves an Attempting Contact Lead to Connected on a connected call', () => {
		expect(
			resolveAutomaticStage(
				input({
					currentStage: 'Attempting Contact',
					activityType: 'Call',
					callOutcome: 'Connected',
				})
			)
		).toBe('Connected');
	});

	it('keeps an Attempting Contact Lead where it is on a plain attempt', () => {
		expect(
			resolveAutomaticStage(
				input({
					currentStage: 'Attempting Contact',
					activityType: 'Call',
					callOutcome: 'No Answer',
				})
			)
		).toBeNull();
	});

	it('never regresses a decided stage', () => {
		const decided: LeadStage[] = [
			'Connected',
			'Qualified',
			'Nurture',
			'Disqualified',
			'Converted',
		];
		for (const currentStage of decided) {
			expect(
				resolveAutomaticStage(
					input({
						currentStage,
						activityType: 'Call',
						callOutcome: 'Connected',
					})
				)
			).toBeNull();
			expect(
				resolveAutomaticStage(input({ currentStage, activityType: 'Email' }))
			).toBeNull();
		}
	});

	it('leaves an unresolved stage to the legacy review', () => {
		expect(
			resolveAutomaticStage(
				input({
					currentStage: null,
					activityType: 'Call',
					callOutcome: 'Connected',
				})
			)
		).toBeNull();
	});
});
