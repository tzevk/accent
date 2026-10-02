import { describe, it, expect } from 'vitest';
import {
	BLANK_CODE_LABEL,
	aggregateUnmappedCodes,
	isPunchMapped,
	type PunchMappingLike,
} from '@/app/reports/attendance-report/unmapped-codes';

/** A mapped punch for Ada (employee_id 7), a device code that resolved. */
const mapped = (code = '101', date = '2026-08-12'): PunchMappingLike => ({
	employee_code: code,
	employee_id: 7,
	date,
});

/** A punch whose device code matched no employee → employee_id IS NULL. */
const unmapped = (code = '114', date = '2026-08-12'): PunchMappingLike => ({
	employee_code: code,
	employee_id: null,
	date,
});

describe('aggregateUnmappedCodes', () => {
	it('returns an empty summary when there are no punches at all', () => {
		expect(aggregateUnmappedCodes([])).toEqual({
			codes: [],
			total_punches: 0,
			code_count: 0,
		});
	});

	it('returns an empty summary when every punch resolved to an employee', () => {
		const summary = aggregateUnmappedCodes([
			mapped('101'),
			mapped('101'),
			mapped('102', '2026-08-13'),
		]);
		expect(summary.codes).toEqual([]);
		expect(summary.total_punches).toBe(0);
		expect(summary.code_count).toBe(0);
	});

	it('counts every punch a single unmapped code carries', () => {
		const summary = aggregateUnmappedCodes([
			unmapped('114'),
			unmapped('114'),
			unmapped('114'),
			mapped('101'),
		]);
		expect(summary.codes).toEqual([{ employee_code: '114', punch_count: 3 }]);
		expect(summary.total_punches).toBe(3);
		expect(summary.code_count).toBe(1);
	});

	it('sorts codes by punch count descending, then code ascending', () => {
		const summary = aggregateUnmappedCodes([
			...Array.from({ length: 2 }, () => unmapped('220')),
			...Array.from({ length: 5 }, () => unmapped('114')),
			...Array.from({ length: 2 }, () => unmapped('115')),
			unmapped('221'),
		]);
		// 114 (5) → 115 (2) and 220 (2) tie, so code ascending breaks it → 221 (1).
		expect(summary.codes).toEqual([
			{ employee_code: '114', punch_count: 5 },
			{ employee_code: '115', punch_count: 2 },
			{ employee_code: '220', punch_count: 2 },
			{ employee_code: '221', punch_count: 1 },
		]);
		expect(summary.total_punches).toBe(10);
	});

	it('counts a code that carries exactly one punch', () => {
		const summary = aggregateUnmappedCodes([mapped('101'), unmapped('999')]);
		expect(summary.codes).toEqual([{ employee_code: '999', punch_count: 1 }]);
		expect(summary.total_punches).toBe(1);
	});

	it('counts only the unmapped punches in a mixed batch', () => {
		const summary = aggregateUnmappedCodes([
			mapped('101'),
			unmapped('114'),
			mapped('101'),
			unmapped('115'),
			unmapped('114'),
			mapped('102'),
		]);
		expect(summary.codes).toEqual([
			{ employee_code: '114', punch_count: 2 },
			{ employee_code: '115', punch_count: 1 },
		]);
		expect(summary.total_punches).toBe(3);
	});

	it('treats employee_id 0 as unmapped — no employee row has id 0', () => {
		const summary = aggregateUnmappedCodes([
			{ employee_code: '114', employee_id: 0, date: '2026-08-12' },
			{ employee_code: '114', employee_id: 0, date: '2026-08-13' },
		]);
		expect(summary.codes).toEqual([{ employee_code: '114', punch_count: 2 }]);
		expect(summary.total_punches).toBe(2);
	});

	it('treats an empty-string or unparsable employee_id as unmapped', () => {
		const summary = aggregateUnmappedCodes([
			{ employee_code: '114', employee_id: '', date: '2026-08-12' },
			{ employee_code: '115', employee_id: '   ', date: '2026-08-12' },
			{ employee_code: '116', employee_id: 'abc', date: '2026-08-12' },
			{ employee_code: '117', employee_id: Number.NaN, date: '2026-08-12' },
		]);
		expect(summary.codes).toEqual([
			{ employee_code: '114', punch_count: 1 },
			{ employee_code: '115', punch_count: 1 },
			{ employee_code: '116', punch_count: 1 },
			{ employee_code: '117', punch_count: 1 },
		]);
		expect(summary.total_punches).toBe(4);
	});

	it('buckets a blank or whitespace-only device code under a labelled placeholder', () => {
		const summary = aggregateUnmappedCodes([
			{ employee_code: '', employee_id: null, date: '2026-08-12' },
			{ employee_code: '   ', employee_id: null, date: '2026-08-12' },
			unmapped('114'),
		]);
		expect(summary.codes).toEqual([
			{ employee_code: BLANK_CODE_LABEL, punch_count: 2 },
			{ employee_code: '114', punch_count: 1 },
		]);
		expect(summary.total_punches).toBe(3);
	});

	it('trims device codes so a padded variant groups with the bare code', () => {
		const summary = aggregateUnmappedCodes([
			{ employee_code: ' 114 ', employee_id: null, date: '2026-08-12' },
			unmapped('114'),
		]);
		expect(summary.codes).toEqual([{ employee_code: '114', punch_count: 2 }]);
	});

	it('keeps one entry for a code seen on many different days of the month', () => {
		const summary = aggregateUnmappedCodes([
			unmapped('114', '2026-08-01'),
			unmapped('114', '2026-08-01'),
			unmapped('114', '2026-08-09'),
			unmapped('114', '2026-08-17'),
			unmapped('114', '2026-08-31'),
		]);
		expect(summary.codes).toEqual([{ employee_code: '114', punch_count: 5 }]);
		expect(summary.code_count).toBe(1);
		expect(summary.total_punches).toBe(5);
	});

	it('scopes to the requested month only when one is given explicitly', () => {
		const punches = [
			unmapped('114', '2026-08-31'),
			unmapped('114', '2026-09-01'),
			unmapped('115', '2026-07-15'),
		];
		expect(aggregateUnmappedCodes(punches, { month: '2026-08' }).codes).toEqual(
			[{ employee_code: '114', punch_count: 1 }]
		);
		expect(aggregateUnmappedCodes(punches, { month: null }).codes).toHaveLength(
			2
		);
		expect(aggregateUnmappedCodes(punches).codes).toHaveLength(2);
	});

	it('keeps total_punches equal to the sum of the per-code counts', () => {
		const summary = aggregateUnmappedCodes([
			...Array.from({ length: 4 }, () => unmapped('114', '2026-08-02')),
			...Array.from({ length: 3 }, () => unmapped('115', '2026-08-03')),
			{ employee_code: '', employee_id: null, date: '2026-08-04' },
			mapped('101'),
		]);
		const sum = summary.codes.reduce((acc, c) => acc + c.punch_count, 0);
		expect(sum).toBe(summary.total_punches);
		expect(sum).toBe(8);
	});
});

describe('isPunchMapped', () => {
	it('is true only for a finite positive employee id', () => {
		expect(isPunchMapped({ employee_code: '101', employee_id: 7 })).toBe(true);
		expect(isPunchMapped({ employee_code: '101', employee_id: '7' })).toBe(
			true
		);
	});

	it('is false for null, zero, empty, unparsable, or missing ids', () => {
		expect(isPunchMapped({ employee_code: '101', employee_id: null })).toBe(
			false
		);
		expect(isPunchMapped({ employee_code: '101', employee_id: 0 })).toBe(false);
		expect(isPunchMapped({ employee_code: '101', employee_id: '' })).toBe(
			false
		);
		expect(isPunchMapped({ employee_code: '101', employee_id: 'x' })).toBe(
			false
		);
		expect(
			isPunchMapped({ employee_code: '101', employee_id: Number.NaN })
		).toBe(false);
		expect(isPunchMapped({ employee_code: '101' })).toBe(false);
	});
});
