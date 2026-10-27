import { describe, expect, it } from 'vitest';
import { summarizePayroll } from './payroll';
import type { PayrollEmployeeCost } from './types';
import {
	availableMonthlyCost,
	availableProjectCost,
	availableReportingProjectCost,
} from './available-cost';

function employee(
	overrides: Partial<PayrollEmployeeCost>
): PayrollEmployeeCost {
	return {
		employee_id: 1,
		employee_code: 'EMP-1',
		employee_name: 'Employee 1',
		pay_stream: 'payroll',
		status: 'estimated',
		recorded_amount: null,
		estimated_amount: 100,
		logged_hours: 4,
		project_hours: 3,
		no_project_hours: 1,
		no_logged_hours: false,
		missing_slip: true,
		missing_pricing: false,
		allocation_missing: false,
		source: {
			payroll_slip_id: null,
			allocation_id: null,
			allocation_version: null,
			allocation_kind: null,
			month: '2026-10',
		},
		shares: [
			{
				project_id: 3,
				project_code: 'P-3',
				project_name: 'Project 3',
				client_name: null,
				hours: 3,
				amount: 75,
				rounding_adjustment: 0,
				basis: 'project',
			},
			{
				project_id: null,
				project_code: null,
				project_name: null,
				client_name: null,
				hours: 1,
				amount: 25,
				rounding_adjustment: 0,
				basis: 'no_project',
			},
		],
		hours_by_project: [],
		reconstruction: null,
		...overrides,
	};
}

describe('available monthly expenditure', () => {
	it('keeps estimated destinations separate from recorded payroll and counts unpriced employees', () => {
		const payroll = summarizePayroll([
			employee({}),
			employee({
				employee_id: 2,
				status: 'recorded',
				recorded_amount: 100,
				estimated_amount: null,
				missing_slip: false,
			}),
			employee({
				employee_id: 3,
				status: 'unknown',
				estimated_amount: null,
				missing_pricing: true,
				shares: [],
			}),
		]);
		expect(payroll).toMatchObject({
			recorded_total: 100,
			allocated_total: 75,
			unallocated_total: 25,
			estimated_total: 100,
			estimated_allocated_total: 75,
			estimated_unallocated_total: 25,
			unpriced_count: 1,
			total_logged_hours: 12,
		});
	});

	it('adds only estimated payroll to confirmed expenditure and keeps destination totals balanced', () => {
		const payroll = summarizePayroll([
			employee({}),
			employee({
				employee_id: 2,
				status: 'recorded',
				recorded_amount: 100,
				estimated_amount: null,
			}),
			employee({
				employee_id: 3,
				status: 'unknown',
				estimated_amount: null,
				missing_pricing: true,
				shares: [],
			}),
		]);
		const available = availableMonthlyCost(
			{
				reporting_currency: 'INR',
				currency: 'INR',
				conversion: { status: 'reporting' },
				incurred_cost: 500,
				groups: [
					{ key: 'incurred_project_cost', amount: 350 },
					{ key: 'company_overhead', amount: 100 },
					{ key: 'unallocated_cost', amount: 50 },
				],
			},
			payroll
		);
		expect(available).toMatchObject({
			currency: 'INR',
			amount: 600,
			project: 425,
			overhead: 100,
			unallocated: 75,
			estimated: true,
			partial: true,
		});
	});

	it('keeps an entirely unpriced month numeric but explicitly partial', () => {
		const payroll = summarizePayroll([
			employee({
				status: 'unknown',
				estimated_amount: null,
				missing_pricing: true,
				shares: [],
			}),
		]);
		expect(
			availableMonthlyCost(
				{
					reporting_currency: 'INR',
					currency: null,
					conversion: { status: 'reporting' },
					incurred_cost: null,
					groups: [],
				},
				payroll
			)
		).toMatchObject({
			amount: 0,
			project: 0,
			overhead: 0,
			unallocated: 0,
			partial: true,
			estimated: false,
		});
	});

	it('withholds combined figures when payroll has no matching currency conversion', () => {
		const payroll = { ...summarizePayroll([employee({})]), currency: 'USD' };
		expect(
			availableMonthlyCost(
				{
					reporting_currency: 'INR',
					currency: 'INR',
					conversion: { status: 'reporting' },
					incurred_cost: 50,
					groups: [
						{ key: 'incurred_project_cost', amount: 40 },
						{ key: 'company_overhead', amount: 10 },
						{ key: 'unallocated_cost', amount: 0 },
					],
				},
				payroll
			)
		).toMatchObject({
			amount: null,
			project: null,
			overhead: 10,
			unallocated: null,
			estimate_currency_supported: false,
		});
		expect(
			availableReportingProjectCost(
				{
					currency: 'USD',
					converted_incurred_cost: 80,
					estimated_employee_cost: 20,
				},
				'INR'
			)
		).toBeNull();
	});

	it('replaces the estimate with recorded payroll without increasing the same expenditure twice', () => {
		const draft = summarizePayroll([employee({})]);
		const recorded = summarizePayroll([
			employee({
				status: 'recorded',
				recorded_amount: 100,
				estimated_amount: null,
				missing_slip: false,
			}),
		]);
		const company = {
			reporting_currency: 'INR',
			currency: 'INR',
			conversion: { status: 'reporting' as const },
			incurred_cost: 600,
			groups: [
				{ key: 'incurred_project_cost', amount: 600 },
				{ key: 'company_overhead', amount: 0 },
				{ key: 'unallocated_cost', amount: 0 },
			],
		};
		expect(availableMonthlyCost(company, draft).amount).toBe(700);
		expect(
			availableMonthlyCost(
				{
					...company,
					incurred_cost: 700,
					groups: [
						{ key: 'incurred_project_cost', amount: 675 },
						{ key: 'company_overhead', amount: 0 },
						{ key: 'unallocated_cost', amount: 25 },
					],
				},
				recorded
			)
		).toMatchObject({
			amount: 700,
			project: 675,
			unallocated: 25,
			estimated: false,
		});
	});

	it('preserves cents when combining confirmed cost with estimated payroll', () => {
		const payroll = {
			...summarizePayroll([]),
			estimated_total: 0.2,
			estimated_allocated_total: 0.15,
			estimated_unallocated_total: 0.05,
			estimated_count: 1,
		};
		expect(
			availableMonthlyCost(
				{
					reporting_currency: 'INR',
					currency: 'INR',
					conversion: { status: 'reporting' },
					incurred_cost: 0.1,
					groups: [
						{ key: 'incurred_project_cost', amount: 0.1 },
						{ key: 'company_overhead', amount: 0 },
						{ key: 'unallocated_cost', amount: 0 },
					],
				},
				payroll
			)
		).toMatchObject({
			amount: 0.3,
			project: 0.25,
			unallocated: 0.05,
		});
		expect(
			availableProjectCost({
				incurred_cost: 0.1,
				estimated_employee_cost: 0.2,
			})
		).toBe(0.3);
	});
});
