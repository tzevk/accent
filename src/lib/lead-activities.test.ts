import { describe, it, expect } from 'vitest';
import {
	LEAD_ACTIVITY_TYPES,
	LEAD_CALL_OUTCOMES,
	LEAD_WORK_STATUSES,
	isLeadActivityType,
	isLeadCallOutcome,
	isLeadWorkStatus,
} from '@/lib/lead-activities';

/**
 * The Lead activity vocabulary is one canonical list per question. The
 * expected values below come from the specification, not from the module, so
 * a silent rename or a dropped outcome fails here.
 */

describe('LEAD_ACTIVITY_TYPES', () => {
	it('holds the four kinds of Lead work', () => {
		expect([...LEAD_ACTIVITY_TYPES]).toEqual([
			'Call',
			'Email',
			'Meeting',
			'Note',
		]);
	});

	it('keeps a plain note beside the outreach kinds', () => {
		expect(LEAD_ACTIVITY_TYPES).toContain('Note');
		expect(LEAD_ACTIVITY_TYPES).not.toContain('Follow-up');
	});
});

describe('LEAD_CALL_OUTCOMES', () => {
	it('holds the five call outcomes', () => {
		expect([...LEAD_CALL_OUTCOMES]).toEqual([
			'Connected',
			'No Answer',
			'Busy',
			'Voicemail',
			'Wrong Number',
		]);
	});

	it('does not answer the task-status question', () => {
		expect(LEAD_CALL_OUTCOMES).not.toContain('Scheduled');
		expect(LEAD_CALL_OUTCOMES).not.toContain('Completed');
	});
});

describe('LEAD_WORK_STATUSES', () => {
	it('holds scheduled, completed, and cancelled work', () => {
		expect([...LEAD_WORK_STATUSES]).toEqual([
			'Scheduled',
			'Completed',
			'Cancelled',
		]);
	});

	it('does not answer the call-outcome question', () => {
		expect(LEAD_WORK_STATUSES).not.toContain('Connected');
		expect(LEAD_WORK_STATUSES).not.toContain('No Answer');
	});
});

describe('vocabulary type guards', () => {
	it('accepts only the canonical activity kinds', () => {
		expect(isLeadActivityType('Call')).toBe(true);
		expect(isLeadActivityType('Note')).toBe(true);
		expect(isLeadActivityType('Site Visit')).toBe(false);
		expect(isLeadActivityType('call')).toBe(false);
		expect(isLeadActivityType(null)).toBe(false);
		expect(isLeadActivityType(7)).toBe(false);
	});

	it('accepts only the canonical call outcomes', () => {
		expect(isLeadCallOutcome('Connected')).toBe(true);
		expect(isLeadCallOutcome('Voicemail')).toBe(true);
		expect(isLeadCallOutcome('Answered')).toBe(false);
		expect(isLeadCallOutcome(undefined)).toBe(false);
	});

	it('accepts only the canonical work statuses', () => {
		expect(isLeadWorkStatus('Scheduled')).toBe(true);
		expect(isLeadWorkStatus('Cancelled')).toBe(true);
		expect(isLeadWorkStatus('In Progress')).toBe(false);
		expect(isLeadWorkStatus('')).toBe(false);
	});
});
