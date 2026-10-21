import { describe, expect, it } from 'vitest';

import {
	LEAD_LIFECYCLE_ACTIONS,
	LEAD_LIFECYCLE_ACTIVE_ACTIONS,
	LEAD_LIFECYCLE_FIELD_BY_MESSAGE,
	LEAD_LIFECYCLE_MESSAGES,
	LEAD_LIFECYCLE_OWNER_ACTIONS,
	LEAD_LIFECYCLE_QUALIFICATION_ACTIONS,
	LEAD_LIFECYCLE_REASON_ACTIONS,
	LEAD_LIFECYCLE_SOURCE_STAGES,
	LEAD_LIFECYCLE_TARGET_STAGE,
	canApplyLeadLifecycleAction,
	isLeadLifecycleAction,
} from '@/lib/lead-lifecycle';
import { LEAD_STAGES, type LeadStage } from '@/lib/lead-stages';
import { resolveAutomaticStage } from '@/lib/lead-stage-transitions';

/**
 * The pure lifecycle rules of ticket #373: which decisions exist, which
 * stage each one moves the Lead to, and the stages a decision may be taken
 * from. The server module asks these rules; it never decides a stage on its
 * own.
 */

describe('the Lead lifecycle vocabulary', () => {
	it('offers exactly the four explicit decisions', () => {
		expect([...LEAD_LIFECYCLE_ACTIONS]).toEqual([
			'Qualify',
			'Nurture',
			'Disqualify',
			'Reopen',
		]);
	});

	it('recognises a decision and refuses anything else', () => {
		expect(isLeadLifecycleAction('Qualify')).toBe(true);
		expect(isLeadLifecycleAction('Reopen')).toBe(true);
		expect(isLeadLifecycleAction('qualify')).toBe(false);
		expect(isLeadLifecycleAction('Convert')).toBe(false);
		expect(isLeadLifecycleAction(null)).toBe(false);
		expect(isLeadLifecycleAction(42)).toBe(false);
	});
});

describe('the stage each decision moves the Lead to', () => {
	it('uses the canonical stage vocabulary', () => {
		for (const action of LEAD_LIFECYCLE_ACTIONS) {
			expect(LEAD_STAGES).toContain(LEAD_LIFECYCLE_TARGET_STAGE[action]);
		}
	});

	it('qualifies, nurtures, disqualifies, and reopens', () => {
		expect(LEAD_LIFECYCLE_TARGET_STAGE.Qualify).toBe('Qualified');
		expect(LEAD_LIFECYCLE_TARGET_STAGE.Nurture).toBe('Nurture');
		expect(LEAD_LIFECYCLE_TARGET_STAGE.Disqualify).toBe('Disqualified');
		expect(LEAD_LIFECYCLE_TARGET_STAGE.Reopen).toBe('Attempting Contact');
	});
});

describe('the stages a decision may be taken from', () => {
	it('qualifies a live Lead and never a disqualified one', () => {
		expect(canApplyLeadLifecycleAction('Qualify', 'New')).toBe(true);
		expect(canApplyLeadLifecycleAction('Qualify', 'Attempting Contact')).toBe(
			true
		);
		expect(canApplyLeadLifecycleAction('Qualify', 'Connected')).toBe(true);
		expect(canApplyLeadLifecycleAction('Qualify', 'Nurture')).toBe(true);
		expect(canApplyLeadLifecycleAction('Qualify', 'Disqualified')).toBe(false);
		expect(canApplyLeadLifecycleAction('Qualify', 'Qualified')).toBe(false);
	});

	it('nurtures a live Lead and never a disqualified one', () => {
		expect(canApplyLeadLifecycleAction('Nurture', 'New')).toBe(true);
		expect(canApplyLeadLifecycleAction('Nurture', 'Connected')).toBe(true);
		expect(canApplyLeadLifecycleAction('Nurture', 'Qualified')).toBe(true);
		expect(canApplyLeadLifecycleAction('Nurture', 'Disqualified')).toBe(false);
	});

	it('disqualifies a live Lead only', () => {
		expect(canApplyLeadLifecycleAction('Disqualify', 'New')).toBe(true);
		expect(canApplyLeadLifecycleAction('Disqualify', 'Qualified')).toBe(true);
		expect(canApplyLeadLifecycleAction('Disqualify', 'Nurture')).toBe(true);
		expect(canApplyLeadLifecycleAction('Disqualify', 'Disqualified')).toBe(
			false
		);
	});

	it('reopens a disqualified Lead only', () => {
		expect(canApplyLeadLifecycleAction('Reopen', 'Disqualified')).toBe(true);
		expect(canApplyLeadLifecycleAction('Reopen', 'New')).toBe(false);
		expect(canApplyLeadLifecycleAction('Reopen', 'Qualified')).toBe(false);
	});

	it('never decides anything for a converted or an unresolved Lead', () => {
		for (const action of LEAD_LIFECYCLE_ACTIONS) {
			expect(canApplyLeadLifecycleAction(action, 'Converted')).toBe(false);
			expect(canApplyLeadLifecycleAction(action, null)).toBe(false);
		}
	});

	it('keeps every source stage inside the canonical vocabulary', () => {
		for (const action of LEAD_LIFECYCLE_ACTIONS) {
			for (const stage of LEAD_LIFECYCLE_SOURCE_STAGES[action]) {
				expect(LEAD_STAGES).toContain(stage);
			}
		}
	});
});

describe('what each decision needs', () => {
	it('asks for a reason only when the decision closes or reopens the Lead', () => {
		expect([...LEAD_LIFECYCLE_REASON_ACTIONS]).toEqual([
			'Disqualify',
			'Reopen',
		]);
	});

	it('asks for an owner and a dated next action for the active decisions', () => {
		expect([...LEAD_LIFECYCLE_ACTIVE_ACTIONS]).toEqual([
			'Qualify',
			'Nurture',
			'Reopen',
		]);
	});

	it('asks for the qualification facts only when the Lead is qualified', () => {
		expect([...LEAD_LIFECYCLE_QUALIFICATION_ACTIONS]).toEqual(['Qualify']);
	});

	it('lets the active decisions set the owner, and never a disqualification', () => {
		expect([...LEAD_LIFECYCLE_OWNER_ACTIONS]).toEqual([
			'Qualify',
			'Nurture',
			'Reopen',
		]);
	});
});

describe('the refusal messages of the lifecycle', () => {
	it('attaches every message to the field it belongs to', () => {
		for (const message of Object.values(LEAD_LIFECYCLE_MESSAGES)) {
			expect(LEAD_LIFECYCLE_FIELD_BY_MESSAGE[message]).toBeDefined();
		}
	});

	it('points the qualification refusals at the missing Lead field', () => {
		expect(
			LEAD_LIFECYCLE_FIELD_BY_MESSAGE[
				LEAD_LIFECYCLE_MESSAGES.contact_name_required
			]
		).toBe('contact_name');
		expect(
			LEAD_LIFECYCLE_FIELD_BY_MESSAGE[
				LEAD_LIFECYCLE_MESSAGES.contact_details_required
			]
		).toBe('contact_details');
		expect(
			LEAD_LIFECYCLE_FIELD_BY_MESSAGE[
				LEAD_LIFECYCLE_MESSAGES.project_need_required
			]
		).toBe('project_need');
	});
});

describe('the stages the lifecycle decides about', () => {
	it('never decides about a stage outside the vocabulary', () => {
		const stages: LeadStage[] = [
			'New',
			'Attempting Contact',
			'Connected',
			'Qualified',
			'Nurture',
			'Disqualified',
			'Converted',
		];
		expect(stages).toEqual([...LEAD_STAGES]);
	});
});

describe('an automatic activity update', () => {
	it('never overrides an explicit decision', () => {
		const decided: LeadStage[] = ['Qualified', 'Nurture', 'Disqualified'];
		for (const stage of decided) {
			expect(
				resolveAutomaticStage({
					currentStage: stage,
					activityType: 'Call',
					callOutcome: 'Connected',
					replyConfirmed: null,
				})
			).toBe(null);
			expect(
				resolveAutomaticStage({
					currentStage: stage,
					activityType: 'Email',
					callOutcome: null,
					replyConfirmed: true,
				})
			).toBe(null);
		}
	});
});
