import { describe, expect, it } from 'vitest';
import {
	findSandwichedDays,
	getSandwichConversions,
	isSandwichLeaveStatus,
	isSandwichOffStatus,
} from '@/utils/sandwich';

describe('sandwich detector', () => {
	it('converts the canonical Saturday-leave / Sunday-WO / Monday-leave vector', () => {
		expect(
			getSandwichConversions({
				'2026-05-09': 'CL',
				'2026-05-10': 'WO',
				'2026-05-11': 'CL',
			})
		).toEqual({ '2026-05-10': 'CL' });
	});

	it('converts multi-day WO/H runs bracketed by leave on both sides', () => {
		expect(
			getSandwichConversions({
				'2026-05-08': 'PL',
				'2026-05-09': 'WO',
				'2026-05-10': 'WO',
				'2026-05-11': 'H',
				'2026-05-12': 'PL',
			})
		).toEqual({
			'2026-05-09': 'PL',
			'2026-05-10': 'PL',
			'2026-05-11': 'PL',
		});
	});

	it('converts a Holiday wedge between two leaves', () => {
		expect(
			getSandwichConversions({
				'2026-05-11': 'SL',
				'2026-05-12': 'H',
				'2026-05-13': 'SL',
			})
		).toEqual({ '2026-05-12': 'SL' });
	});

	it('ignores single-sided adjacency with leave on one side only', () => {
		expect(
			getSandwichConversions({
				'2026-05-08': 'CL',
				'2026-05-09': 'WO',
				'2026-05-10': 'WO',
			})
		).toEqual({});
		expect(
			getSandwichConversions({
				'2026-05-09': 'WO',
				'2026-05-10': 'WO',
				'2026-05-11': 'CL',
			})
		).toEqual({});
	});

	it('leaves unsandwiched Weekly Off and Holiday cells untouched', () => {
		expect(getSandwichConversions({ '2026-05-10': 'WO' })).toEqual({});
		expect(getSandwichConversions({ '2026-05-12': 'H' })).toEqual({});
		expect(
			getSandwichConversions({
				'2026-05-09': 'P',
				'2026-05-10': 'WO',
				'2026-05-11': 'P',
			})
		).toEqual({});
	});

	it('breaks the run on Present, Absent, Half Day, OT, or a calendar gap', () => {
		expect(
			getSandwichConversions({
				'2026-05-09': 'CL',
				'2026-05-10': 'WO',
				'2026-05-11': 'P',
			})
		).toEqual({});
		expect(
			getSandwichConversions({
				'2026-05-09': 'CL',
				'2026-05-10': 'WO',
				'2026-05-11': 'A',
			})
		).toEqual({});
		expect(
			getSandwichConversions({
				'2026-05-09': 'CL',
				'2026-05-10': 'WO',
				'2026-05-11': 'HD',
			})
		).toEqual({});
		expect(
			getSandwichConversions({
				'2026-05-09': 'CL',
				'2026-05-10': 'WO',
				'2026-05-11': 'OT',
			})
		).toEqual({});
		// Gap on the 11th breaks continuity even with leave on the 12th.
		expect(
			getSandwichConversions({
				'2026-05-09': 'CL',
				'2026-05-10': 'WO',
				'2026-05-12': 'CL',
			})
		).toEqual({});
	});

	it('spans month boundaries only when the days are consecutive', () => {
		expect(
			getSandwichConversions({
				'2026-08-31': 'CL',
				'2026-09-01': 'WO',
				'2026-09-02': 'CL',
			})
		).toEqual({ '2026-09-01': 'CL' });
	});

	it('scans sorted day keys regardless of input order', () => {
		expect(
			getSandwichConversions({
				'2026-05-11': 'CL',
				'2026-05-10': 'WO',
				'2026-05-09': 'CL',
			})
		).toEqual({ '2026-05-10': 'CL' });
	});

	it('resolves mismatched bracketing leaves to the earlier code', () => {
		expect(
			getSandwichConversions({
				'2026-05-09': 'CL',
				'2026-05-10': 'WO',
				'2026-05-11': 'PL',
			})
		).toEqual({ '2026-05-10': 'CL' });
	});

	it('lists bracketed dates in ascending order', () => {
		expect(
			findSandwichedDays({
				'2026-05-12': 'PL',
				'2026-05-11': 'H',
				'2026-05-10': 'WO',
				'2026-05-09': 'WO',
				'2026-05-08': 'PL',
			})
		).toEqual(['2026-05-09', '2026-05-10', '2026-05-11']);
	});

	it('classifies bracketing leave versus off-day statuses', () => {
		for (const code of ['PL', 'CL', 'SL', 'EL', 'LWP', 'UL']) {
			expect(isSandwichLeaveStatus(code)).toBe(true);
		}
		expect(isSandwichLeaveStatus('HD')).toBe(false);
		expect(isSandwichLeaveStatus('P')).toBe(false);
		expect(isSandwichOffStatus('WO')).toBe(true);
		expect(isSandwichOffStatus('H')).toBe(true);
		expect(isSandwichOffStatus('CL')).toBe(false);
	});
});
