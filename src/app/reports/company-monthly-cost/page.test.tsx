import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	CostSalaryEvidence,
	FYCompanyCostData,
	MonthlyCompanyCostData,
	MonthlyEmployeeRow,
	MonthlyProjectRow,
	MonthlyRow,
} from './types';

const queryState = vi.hoisted(() => ({
	meta: null as unknown,
	monthly: null as unknown,
	fy: null as unknown,
}));

vi.mock('next/navigation', () => ({
	useSearchParams: () => ({
		get: (name: string) => (name === 'month' ? '2026-09' : null),
	}),
}));
vi.mock('@/components/Navbar', () => ({ default: () => <nav>Navbar</nav> }));
vi.mock('./expenditure/expenditure-view', () => ({
	default: () => <div>Expenditure workspace</div>,
}));
vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: readonly unknown[] }) => {
		const view = options.queryKey[2];
		const data =
			view === 'meta'
				? queryState.meta
				: view === 'monthly'
					? queryState.monthly
					: queryState.fy;
		return {
			data,
			isLoading: false,
			isFetching: false,
			error: null,
			refetch: () => Promise.resolve(),
		};
	},
	useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({
		loading: false,
		user: { is_super_admin: false },
		can: (resource: string, permission: string) =>
			permission === 'read' &&
			(resource === 'reports' || resource === 'payroll'),
		RESOURCES: {
			REPORTS: 'reports',
			OTHER_EXPENSES: 'other_expenses',
			PAYROLL: 'payroll',
		},
		PERMISSIONS: { READ: 'read', UPDATE: 'update' },
	}),
}));

import CompanyMonthlyCostPage from './page';

function salary(
	overrides: Partial<CostSalaryEvidence> = {}
): CostSalaryEvidence {
	return {
		availability: 'available',
		issue: null,
		profile_id: 1,
		profile_source: 'employee_salary_profile',
		salary_type: 'monthly',
		ctc_source: 'employer_cost',
		conflict_ids: [],
		legacy_fallback: false,
		...overrides,
	};
}

const ambiguousSalary = salary({
	availability: 'ambiguous',
	issue: 'salary_profile_ambiguous',
	profile_id: null,
	profile_source: null,
	salary_type: null,
	ctc_source: 'none',
	conflict_ids: [7, 8],
});
const missingSalary = salary({
	availability: 'missing',
	issue: 'salary_profile_missing',
	profile_id: null,
	profile_source: null,
	salary_type: null,
	ctc_source: 'none',
});
const invalidSalary = salary({
	availability: 'ctc_invalid',
	issue: 'salary_ctc_invalid',
	profile_id: 9,
	profile_source: 'employee_salary_profile',
});
const unavailableSalary = salary({
	availability: 'unavailable',
	issue: null,
	profile_id: null,
	profile_source: null,
	salary_type: null,
	ctc_source: 'none',
});
const legacySalary = salary({
	profile_id: 3,
	ctc_source: 'gross_salary',
	legacy_fallback: true,
});
const recordedSalary = salary({
	availability: 'recorded',
	profile_id: null,
	profile_source: null,
	salary_type: null,
	ctc_source: 'none',
});

function costRow(
	overrides: Partial<MonthlyRow> & Pick<MonthlyRow, 'employee_id'>
): MonthlyRow {
	return {
		sr_no: overrides.employee_id,
		employee_id: overrides.employee_id,
		employee_code: `EMP-${overrides.employee_id}`,
		employee_name: `Employee ${overrides.employee_id}`,
		department: 'Engineering',
		designation: 'Engineer',
		project_id: 10,
		project_code: 'PRJ-10',
		project_name: 'Project Ten',
		client_name: 'Client',
		hourly_rate: 100,
		hours: 8,
		cost: 0,
		cost_known: true,
		missing_salary_profile: false,
		in_saved_roster: true,
		worked_outside_finalized_run: false,
		employment_issue: null,
		salary: salary(),
		...overrides,
	};
}

function employeeRow(
	overrides: Partial<MonthlyEmployeeRow> &
		Pick<MonthlyEmployeeRow, 'employee_id'>
): MonthlyEmployeeRow {
	return {
		sr_no: overrides.employee_id,
		employee_id: overrides.employee_id,
		employee_code: `EMP-${overrides.employee_id}`,
		employee_name: `Employee ${overrides.employee_id}`,
		department: 'Engineering',
		designation: 'Engineer',
		hourly_rate: 100,
		hours: 8,
		cost: 0,
		cost_known: true,
		project_count: 1,
		missing_salary_profile: false,
		in_saved_roster: true,
		worked_outside_finalized_run: false,
		employment_issue: null,
		salary: salary(),
		...overrides,
	};
}

const rows: MonthlyRow[] = [
	costRow({
		employee_id: 1,
		employee_name: 'Asha Ambiguous',
		cost_known: false,
		missing_salary_profile: true,
		salary: ambiguousSalary,
	}),
	costRow({
		employee_id: 2,
		employee_name: 'Rohan Zero',
		cost: 0,
		salary: salary(),
	}),
	costRow({
		employee_id: 3,
		employee_name: 'Meera Legacy',
		cost: 1000,
		salary: legacySalary,
	}),
];

const employeeRows: MonthlyEmployeeRow[] = [
	employeeRow({
		employee_id: 1,
		employee_name: 'Asha Ambiguous',
		cost_known: false,
		missing_salary_profile: true,
		salary: ambiguousSalary,
	}),
	employeeRow({
		employee_id: 2,
		employee_name: 'Rohan Missing',
		cost_known: false,
		missing_salary_profile: true,
		salary: missingSalary,
	}),
	employeeRow({
		employee_id: 3,
		employee_name: 'Kabir Invalid',
		cost_known: false,
		missing_salary_profile: true,
		salary: invalidSalary,
	}),
	employeeRow({
		employee_id: 4,
		employee_name: 'Priya Unavailable',
		cost_known: false,
		missing_salary_profile: true,
		salary: unavailableSalary,
	}),
	employeeRow({
		employee_id: 5,
		employee_name: 'Meera Legacy',
		cost: 1000,
		salary: legacySalary,
	}),
	employeeRow({
		employee_id: 6,
		employee_name: 'Dev Recorded',
		cost: 500,
		salary: recordedSalary,
	}),
];

const project: MonthlyProjectRow = {
	sr_no: 1,
	project_id: 10,
	project_code: 'PRJ-10',
	project_name: 'Project Ten',
	client_name: 'Client',
	hours: 24,
	cost: 1000,
	cost_known: true,
	employee_count: 3,
	missing_salary_profile_count: 1,
	salary_availability_counts: {
		recorded: 0,
		not_consulted: 0,
		available: 2,
		missing: 0,
		ambiguous: 1,
		ctc_missing: 0,
		ctc_invalid: 0,
		unavailable: 0,
	},
	unknown_cost_count: 1,
};

const monthly: MonthlyCompanyCostData = {
	month: '2026-09',
	month_label: 'September 2026',
	fy_label: 'FY 2026–27',
	fy_year: 2026,
	rows,
	employee_rows: employeeRows,
	project_rows: [project],
	payroll: {
		currency: 'INR',
		recorded_total: 1500,
		estimated_total: 0,
		allocated_total: 0,
		unallocated_total: 0,
		estimated_allocated_total: 0,
		estimated_unallocated_total: 0,
		total_logged_hours: 24,
		project_hours: 24,
		no_project_hours: 0,
		rounding_adjustment: 0,
		recorded_count: 1,
		known_zero_count: 1,
		estimated_count: 0,
		missing_slip_count: 0,
		missing_pricing_count: 1,
		allocation_missing_count: 0,
		unpriced_count: 1,
	},
	salary: {
		available_count: 1,
		missing_count: 1,
		ambiguous_count: 1,
		ctc_missing_count: 0,
		ctc_invalid_count: 1,
		unavailable_count: 1,
		legacy_fallback_count: 1,
		recorded_count: 1,
		not_consulted_count: 0,
		complete: false,
	},
	coverage: [
		{
			code: 'payroll_pricing_missing',
			label: 'No Salary Profile covers this month',
			detail: 'One employee has no Salary Profile covering the month.',
			severity: 'warning',
		},
		{
			code: 'payroll_salary_ambiguous',
			label: 'Several Salary Profiles cover this month',
			detail:
				'One employee has two covering Salary Profiles and no chosen agreement.',
			severity: 'warning',
		},
		{
			code: 'payroll_salary_ctc_invalid',
			label: 'Salary Profile CTC is invalid',
			detail:
				'One employee has an invalid monthly CTC in the covering profile.',
			severity: 'warning',
		},
		{
			code: 'payroll_salary_unavailable',
			label: 'Salary evidence unavailable for this month',
			detail:
				'One employee has payroll evidence without a roster salary record.',
			severity: 'warning',
		},
	],
	totals: {
		total_hours: 24,
		total_cost: 1000,
		blended_rate: 41.67,
		employee_count: 3,
		project_count: 1,
	},
};

const fy: FYCompanyCostData = {
	fy_label: 'FY 2026–27',
	fy_year: 2026,
	months: ['Apr'],
	month_keys: ['apr'],
	rows: [],
	employee_rows: [],
	project_rows: [],
	totals: {
		monthly_cost_known: { apr: false },
		monthly_hours: { apr: 0 },
		monthly_cost: { apr: 0 },
		total_hours: 0,
		total_cost: 0,
		cost_known: false,
		blended_rate: 0,
	},
	summary: {
		total_hours: 0,
		total_cost: 0,
		cost_known: false,
		blended_rate: 0,
		employee_count: 0,
		project_count: 0,
	},
};

beforeEach(() => {
	queryState.meta = {
		success: true,
		meta: {
			financial_years: [{ year: 2026, label: 'FY 2026–27' }],
			current_fy: 2026,
			months: ['2026-09'],
			latest_month: '2026-09',
			current_month: '2026-10',
		},
	};
	queryState.monthly = { success: true, data: monthly };
	queryState.fy = { success: true, data: fy };
});

describe('Company Monthly Cost page salary disclosure', () => {
	it('shows every salary cause from the payload instead of one binary missing-profile banner', async () => {
		render(<CompanyMonthlyCostPage />);

		const disclosure = await screen.findByRole('status', {
			name: 'Salary disclosure for September 2026',
		});
		expect(
			within(disclosure).getByText('Several Salary Profiles cover this month')
		).toBeInTheDocument();
		expect(
			within(disclosure).getByText(
				'One employee has two covering Salary Profiles and no chosen agreement.'
			)
		).toBeInTheDocument();
		expect(
			within(disclosure).getByText('Salary Profile CTC is invalid')
		).toBeInTheDocument();
		expect(
			within(disclosure).getByText('No Salary Profile covers this month')
		).toBeInTheDocument();
		expect(
			within(disclosure).getByText('Salary evidence unavailable for this month')
		).toBeInTheDocument();
		expect(
			within(disclosure).getByText(/Legacy gross basis/)
		).toBeInTheDocument();
		expect(
			within(disclosure).getByText(/recorded from frozen Payroll Finalize/)
		).toBeInTheDocument();
		expect(
			screen.queryByText('Employees missing salary profiles')
		).not.toBeInTheDocument();
		expect(
			screen.getByText('Employee cost — partial estimate')
		).toBeInTheDocument();
	});

	it('labels the FY header partial without inventing salary causes', async () => {
		render(<CompanyMonthlyCostPage />);
		await screen.findByRole('status', {
			name: 'Salary disclosure for September 2026',
		});

		fireEvent.click(screen.getByRole('button', { name: 'Employee Cost — FY' }));

		expect(
			await screen.findByText('Employee cost — partial · FY 2026–27')
		).toBeInTheDocument();
		expect(
			screen.getByText(/Unknown monthly cost is excluded/)
		).toBeInTheDocument();
		expect(screen.queryByText(/Salary Profile covers/)).not.toBeInTheDocument();
	});
});
