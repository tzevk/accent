import { describe, expect, it } from 'vitest';
import {
	buildSalaryAgreementTimeline,
	classifySalaryAgreement,
	normalizeSalaryMonth,
	previousSalaryDay,
	resolveSalaryAgreementAt,
	salaryMonthAnchor,
	salaryPeriodBounds,
	type SalaryProfileRow,
} from './salary-profile-timeline';

function profile(overrides: Partial<SalaryProfileRow> = {}): SalaryProfileRow {
	return {
		id: 10,
		employee_id: 1,
		effective_from: '2026-01-01',
		effective_to: null,
		is_active: 1,
		cancelled_at: null,
		salary_type: 'monthly',
		employer_cost: 30_000,
		gross_salary: null,
		gross: null,
		...overrides,
	};
}

describe('salary calendar', () => {
	it('normalizes a month key or the first day to the first day', () => {
		expect(normalizeSalaryMonth('2026-11')).toBe('2026-11-01');
		expect(normalizeSalaryMonth(' 2026-11-01 ')).toBe('2026-11-01');
	});

	it('rejects a non-first day and impossible months', () => {
		expect(() => normalizeSalaryMonth('2026-11-02')).toThrow(RangeError);
		expect(() => normalizeSalaryMonth('2026-13')).toThrow(RangeError);
		expect(() => normalizeSalaryMonth('November')).toThrow(RangeError);
		expect(() => normalizeSalaryMonth('')).toThrow(RangeError);
	});

	it('returns inclusive month bounds without host timezone arithmetic', () => {
		expect(salaryPeriodBounds('2026-02')).toEqual({
			start: '2026-02-01',
			end: '2026-02-28',
		});
		expect(salaryPeriodBounds('2024-02')).toEqual({
			start: '2024-02-01',
			end: '2024-02-29',
		});
	});

	it('anchors established employees at month start and mid-month joiners at their joining date', () => {
		expect(salaryMonthAnchor('2026-11', '2020-01-06')).toBe('2026-11-01');
		expect(salaryMonthAnchor('2026-11', '2026-10-31')).toBe('2026-11-01');
		expect(salaryMonthAnchor('2026-11', '2026-11-01')).toBe('2026-11-01');
		expect(salaryMonthAnchor('2026-11', '2026-11-15')).toBe('2026-11-15');
		expect(salaryMonthAnchor('2026-11', null)).toBe('2026-11-01');
		expect(() => salaryMonthAnchor('2026-11', '15-11-2026')).toThrow(
			RangeError
		);
	});

	it('walks calendar days across months, years and leap days', () => {
		expect(previousSalaryDay('2026-03-01')).toBe('2026-02-28');
		expect(previousSalaryDay('2026-01-01')).toBe('2025-12-31');
		expect(previousSalaryDay('2024-03-01')).toBe('2024-02-29');
	});
});

describe('historical agreement selection', () => {
	it('returns unavailable instead of a latest agreement when nothing covers the anchor', () => {
		const resolution = resolveSalaryAgreementAt(
			[
				profile({
					id: 10,
					effective_from: '2025-01-01',
					effective_to: '2025-12-31',
				}),
				profile({ id: 11, effective_from: '2027-01-01' }),
			],
			'2026-06-01'
		);

		expect(resolution.state).toBe('unavailable');
		expect(resolution.agreement_id).toBeNull();
		expect(resolution.profile).toBeNull();
		expect(resolution.conflict_ids).toEqual([]);
	});

	it('returns ambiguous with every covering identity instead of choosing one', () => {
		const resolution = resolveSalaryAgreementAt(
			[
				profile({
					id: 20,
					effective_from: '2026-01-01',
					effective_to: '2026-12-31',
					employer_cost: 30_000,
				}),
				profile({
					id: 21,
					effective_from: '2026-04-01',
					effective_to: null,
					employer_cost: 35_000,
				}),
			],
			'2026-06-01'
		);

		expect(resolution.state).toBe('ambiguous');
		expect(resolution.agreement_id).toBeNull();
		expect(resolution.profile).toBeNull();
		expect(resolution.conflict_ids).toEqual([20, 21]);
	});

	it('selects the single covering active agreement and keeps its zero CTC', () => {
		const resolution = resolveSalaryAgreementAt(
			[
				profile({
					id: 30,
					salary_type: 'monthly',
					employer_cost: 0,
					gross_salary: null,
					gross: null,
				}),
			],
			'2026-06-01'
		);

		expect(resolution).toMatchObject({
			state: 'selected',
			agreement_id: 30,
			source: 'employee_salary_profile',
			effective_from: '2026-01-01',
			effective_to: null,
			salary_type: 'monthly',
			classification: 'current',
			conflict_ids: [],
		});
		expect(resolution.profile?.employer_cost).toBe(0);
		expect(resolution.profile?.gross_salary).toBeNull();
	});

	it('treats effective_to as inclusive', () => {
		const rows = [
			profile({
				id: 40,
				effective_from: '2026-06-01',
				effective_to: '2026-06-30',
			}),
			profile({ id: 41, effective_from: '2026-07-01' }),
		];
		expect(resolveSalaryAgreementAt(rows, '2026-06-30').agreement_id).toBe(40);
		expect(resolveSalaryAgreementAt(rows, '2026-07-01').agreement_id).toBe(41);
		expect(resolveSalaryAgreementAt(rows, '2026-05-31').state).toBe(
			'unavailable'
		);
	});

	it('excludes cancelled and inactive agreements from coverage', () => {
		const cancelled = profile({
			id: 50,
			cancelled_at: '2026-03-01 10:00:00',
			is_active: 0,
		});
		expect(resolveSalaryAgreementAt([cancelled], '2026-06-01').state).toBe(
			'unavailable'
		);

		const inactive = profile({ id: 51, is_active: 0 });
		expect(resolveSalaryAgreementAt([inactive], '2026-06-01').state).toBe(
			'unavailable'
		);

		const active = profile({ id: 52 });
		expect(
			resolveSalaryAgreementAt([cancelled, inactive, active], '2026-06-01')
				.agreement_id
		).toBe(52);
	});

	it('does not treat duplicate rows for one agreement as ambiguous', () => {
		const resolution = resolveSalaryAgreementAt(
			[profile({ id: 60 }), profile({ id: 60, employer_cost: 99_000 })],
			'2026-06-01'
		);
		expect(resolution.state).toBe('selected');
		expect(resolution.agreement_id).toBe(60);
		expect(resolution.conflict_ids).toEqual([]);
	});

	it('ignores malformed historical dates instead of inventing coverage', () => {
		expect(
			resolveSalaryAgreementAt(
				[
					profile({ id: 70, effective_from: 'not-a-date' }),
					profile({
						id: 71,
						effective_from: '2026-01-01',
						effective_to: '2026-06-01x',
					}),
				],
				'2026-06-01'
			).state
		).toBe('unavailable');
	});

	it('selects the agreement at max(month start, joining date) for a mid-month joiner', () => {
		const rows = [
			profile({
				id: 82,
				effective_from: '2025-01-01',
				effective_to: '2026-10-09',
				employer_cost: 20_000,
			}),
			profile({
				id: 83,
				effective_from: '2026-10-15',
				effective_to: '2026-10-31',
				employer_cost: 25_000,
			}),
			profile({
				id: 84,
				effective_from: '2026-11-01',
				effective_to: null,
				employer_cost: 30_000,
			}),
		];
		const anchor = salaryMonthAnchor('2026-10', '2026-10-15');

		expect(anchor).toBe('2026-10-15');
		expect(
			resolveSalaryAgreementAt(rows, anchor, { asOf: '2026-10-15' })
		).toMatchObject({
			state: 'selected',
			agreement_id: 83,
			effective_from: '2026-10-15',
		});
		expect(
			resolveSalaryAgreementAt(rows, salaryMonthAnchor('2026-10'), {
				asOf: '2026-10-01',
			}).agreement_id
		).toBe(82);
	});

	it('scopes selection to the requested Employee', () => {
		const resolution = resolveSalaryAgreementAt(
			[
				profile({ id: 80, employee_id: 2 }),
				profile({ id: 81, employee_id: 1 }),
			],
			'2026-06-01',
			{ employeeId: 1 }
		);
		expect(resolution.agreement_id).toBe(81);
	});

	it('reports all covering identities for a three-way legacy overlap', () => {
		const resolution = resolveSalaryAgreementAt(
			[
				profile({ id: 90, effective_from: '2026-01-01' }),
				profile({ id: 91, effective_from: '2026-02-01' }),
				profile({ id: 92, effective_from: '2026-03-01' }),
			],
			'2026-06-01'
		);
		expect(resolution.state).toBe('ambiguous');
		expect(resolution.conflict_ids).toEqual([90, 91, 92]);
	});

	it('rejects an invalid anchor rather than guessing', () => {
		expect(() => resolveSalaryAgreementAt([], '06/2026')).toThrow(RangeError);
	});
});

describe('agreement classification', () => {
	const agreement = profile({
		effective_from: '2026-04-01',
		effective_to: '2026-08-31',
	});

	it('classifies by the requested calendar date', () => {
		expect(classifySalaryAgreement(agreement, '2026-06-15')).toBe('current');
		expect(classifySalaryAgreement(agreement, '2026-03-31')).toBe('scheduled');
		expect(classifySalaryAgreement(agreement, '2026-09-01')).toBe('previous');
		expect(
			classifySalaryAgreement(
				{ ...agreement, cancelled_at: '2026-05-01 09:00:00' },
				'2026-06-15'
			)
		).toBe('cancelled');
	});

	it('rejects an invalid reference date', () => {
		expect(() => classifySalaryAgreement(agreement, 'today')).toThrow(
			RangeError
		);
	});
});

describe('timeline projection', () => {
	it('keeps every historical identity, including cancelled and inactive rows', () => {
		const timeline = buildSalaryAgreementTimeline(
			[
				profile({
					id: 100,
					effective_from: '2025-01-01',
					effective_to: '2025-12-31',
					is_active: 0,
				}),
				profile({
					id: 101,
					effective_from: '2026-01-01',
					effective_to: '2026-03-31',
				}),
				profile({
					id: 102,
					effective_from: '2026-04-01',
					effective_to: null,
				}),
				profile({
					id: 103,
					effective_from: '2026-06-01',
					effective_to: '2026-07-31',
					cancelled_at: '2026-05-20 12:00:00',
					is_active: 0,
				}),
				profile({
					id: 104,
					effective_from: '2026-09-01',
					effective_to: '2026-10-31',
				}),
			],
			{ asOf: '2026-06-15' }
		);

		expect(timeline.employee_id).toBe(1);
		expect(timeline.as_of).toBe('2026-06-15');
		expect(
			timeline.agreements.map((entry) => entry.agreement.agreement_id)
		).toEqual([100, 101, 102, 103, 104]);
		expect(timeline.agreements.map((entry) => entry.classification)).toEqual([
			'previous',
			'previous',
			'current',
			'cancelled',
			'scheduled',
		]);
		expect(timeline.current).toMatchObject({
			state: 'selected',
			agreement_id: 102,
			classification: 'current',
		});
	});

	it('reports an ambiguous current selection without discarding rows', () => {
		const timeline = buildSalaryAgreementTimeline(
			[
				profile({ id: 110, effective_from: '2026-01-01' }),
				profile({ id: 111, effective_from: '2026-02-01' }),
			],
			{ asOf: '2026-06-15' }
		);

		expect(timeline.agreements).toHaveLength(2);
		expect(timeline.current.state).toBe('ambiguous');
		expect(timeline.current.conflict_ids).toEqual([110, 111]);
	});

	it('carries the requested source when selecting a legacy agreement', () => {
		const resolution = resolveSalaryAgreementAt(
			[profile({ id: 120, effective_from: '2026-01-01' })],
			'2026-06-01',
			{ source: 'salary_structures' }
		);
		expect(resolution.source).toBe('salary_structures');
	});
});
