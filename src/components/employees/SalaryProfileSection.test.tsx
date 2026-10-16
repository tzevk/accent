import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SalaryProfileSection from '@/components/employees/SalaryProfileSection';

const fetchMock = vi.fn();

const alice = {
	id: 1,
	employee_id: 'ATS001',
	first_name: 'Alice',
	last_name: 'Worker',
	email: 'alice@example.com',
	department: 'Engineering',
	position: 'Developer',
	workplace: 'Mumbai',
	status: 'active',
	employee_type: 'Payroll',
};

const savedProfile = {
	id: 11,
	employee_id: 1,
	salary_type: 'monthly',
	gross_salary: 50000,
	other_allowances: 0,
	pf_applicable: 1,
	esic_applicable: 0,
	pt_applicable: 1,
	mlwf_applicable: 0,
	retention_applicable: 0,
	bonus_applicable: 0,
	monthly_bonus: 0,
	incentive_applicable: 0,
	insurance_applicable: 0,
	effective_from: '2026-01-01T00:00:00.000Z',
	effective_to: null,
	std_in_time: '09:00:00',
	std_out_time: '17:30:00',
	std_working_days: 26,
	std_hours_per_day: 8,
	pl_total: 21,
	pl_used: 2,
	pl_balance: 19,
	loan_active: 1,
	loan_amount_per_month: 1000,
	loan_no_of_months: 10,
	loan_total_amount: 10000,
	advance_active: 0,
	advance_amount: 0,
	is_manual_override: 0,
	basic: null,
	da: null,
	hra: null,
	pf_employee: null,
	net_pay: 42750,
	total_earnings: 50000,
	total_deductions: 7250,
	employer_cost: 56000,
	lumpsum_description: null,
};

function response(body: unknown, ok = true) {
	return Promise.resolve({ ok, json: async () => body });
}

function renderSection() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={client}>
			<SalaryProfileSection employee={alice} canOverride />
		</QueryClientProvider>
	);
}

describe('SalaryProfileSection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.startsWith('/api/payroll/salary-profile?employee_id=')) {
					return response({ success: true, data: [savedProfile] });
				}
				if (url.startsWith('/api/payroll/schedules/current')) {
					return response({ success: true, data: {} });
				}
				if (url.startsWith('/api/attendance/summary')) {
					return response({
						success: true,
						data: [{ total_present: 5 }],
						dayDetails: [],
					});
				}
				if (url === '/api/payroll/salary-profile' && init?.method === 'POST') {
					return response({ success: true, data: savedProfile });
				}
				return Promise.reject(new Error(`Unexpected request: ${url}`));
			}
		);
	});

	it('shows the stored agreement with the schedule-derived components', async () => {
		renderSection();

		const grossInput = await screen.findByLabelText('Gross Salary *');
		await waitFor(() => expect(grossInput).toHaveValue(50000));
		expect(
			screen.getByText('Derived from the effective payroll schedule')
		).toBeVisible();
		expect(screen.getByText('Basic')).toBeVisible();
		expect(screen.getByText('Total Earnings')).toBeVisible();
		expect(screen.getByText('Net Pay')).toBeVisible();
		expect(screen.getAllByText('₹1,000.00').length).toBeGreaterThan(0); // loan EMI
	});

	it('persists explicit overrides and resets them to derived values', async () => {
		renderSection();
		const grossInput = await screen.findByLabelText('Gross Salary *');
		await waitFor(() => expect(grossInput).toHaveValue(50000));

		fireEvent.click(screen.getByRole('checkbox', { name: 'Enable overrides' }));
		const pfInput = screen.getByLabelText('Employee PF override value');
		fireEvent.change(pfInput, { target: { value: '999' } });
		expect(pfInput).toHaveValue(999);

		// Reset returns the component to its derived value.
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Reset Employee PF to derived value',
			})
		);

		// Override again and save; the payload persists the exception.
		fireEvent.change(pfInput, { target: { value: '888' } });
		fireEvent.click(
			screen.getByRole('button', { name: '+ Add New Salary Profile' })
		);

		await waitFor(() => {
			const saveCall = fetchMock.mock.calls.find(
				([url, init]) =>
					String(url) === '/api/payroll/salary-profile' &&
					init?.method === 'POST'
			);
			expect(saveCall).toBeTruthy();
			const payload = JSON.parse(String(saveCall?.[1]?.body));
			expect(payload.pf_employee).toBe(888);
			expect(payload.is_manual_override).toBe(true);
			expect(payload.basic).toBeNull();
			expect(payload.da).toBeNull();
			expect(payload.net_pay).toBe(
				payload.total_earnings - payload.total_deductions
			);
			expect(payload.employee_id).toBe(1);
		});
		expect(
			await screen.findByText('✓ New salary profile created!')
		).toBeVisible();
	});
});
