import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ContractPaySection from '@/components/employees/ContractPaySection';

const fetchMock = vi.fn();

const bob = {
	id: 2,
	employee_id: 'ATS002',
	first_name: 'Bob',
	last_name: 'Builder',
	email: 'bob@example.com',
	department: 'Operations',
	position: 'Manager',
	workplace: 'Malvan',
	status: 'active',
	employee_type: 'Contract',
};

const bobContractProfile = {
	id: 31,
	employee_id: 2,
	salary_type: 'contract',
	contract_amount: 20000,
	contract_duration: 'quarterly',
	contract_end_date: '2026-09-30T00:00:00.000Z',
	tds_percentage: 5,
	gross_salary: 20000,
	net_pay: 19000,
	employer_cost: 20000,
	effective_from: '2026-02-01T00:00:00.000Z',
	effective_to: null,
	std_in_time: '09:00:00',
	std_out_time: '17:30:00',
	std_working_days: 26,
	pl_total: 0,
	pl_used: 0,
	pl_balance: 0,
	loan_amount: 0,
	loan_amount_per_month: 0,
	loan_no_of_months: 0,
	loan_total_amount: 0,
	loan_active: 0,
	advance_amount: 0,
	advance_active: 0,
	is_manual_override: 0,
	lumpsum_description: null,
};

function response(body: unknown, ok = true) {
	return Promise.resolve({ ok, json: async () => body });
}

/** The agreement loaded from the API, with PL usage synced from attendance. */
function respondWithSavedAgreement(
	input: RequestInfo | URL,
	init?: RequestInit,
	agreement: Record<string, unknown> = bobContractProfile
) {
	const url = String(input);
	if (url.startsWith('/api/payroll/salary-profile?employee_id=')) {
		return response({ success: true, data: [agreement] });
	}
	if (url.startsWith('/api/attendance/summary')) {
		return response({
			success: true,
			data: [{ total_privilege_leave: 2 }],
			dayDetails: [],
		});
	}
	if (url === '/api/payroll/salary-profile' && init?.method === 'POST') {
		return response({ success: true, data: agreement });
	}
	return Promise.reject(new Error(`Unexpected request: ${url}`));
}

function renderSection() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ContractPaySection employee={bob} />
		</QueryClientProvider>
	);
}

describe('ContractPaySection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) =>
				respondWithSavedAgreement(input, init)
		);
	});

	it('loads the saved contract agreement with its stored TDS rate', async () => {
		renderSection();

		const amountInput = await screen.findByLabelText('Amount (₹) *');
		await waitFor(() => expect(amountInput).toHaveValue(20000));
		expect(screen.getByLabelText('Duration')).toHaveValue('quarterly');
		expect(screen.getByLabelText('End Date')).toHaveValue('2026-09-30');
		expect(screen.getByText(/TDS @ 5% = ₹1,000/)).toBeVisible();
		expect(screen.getByText(/In-Hand CTC: ₹19,000/)).toBeVisible();
		expect(screen.getByText('Salary Type: Contract')).toBeVisible();
	});

	it('falls back to 10% TDS and persists the edited contract agreement', async () => {
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) =>
				respondWithSavedAgreement(input, init, {
					...bobContractProfile,
					contract_amount: 30000,
					tds_percentage: null,
					net_pay: 27000,
				})
		);

		renderSection();

		const amountInput = await screen.findByLabelText('Amount (₹) *');
		await waitFor(() => expect(amountInput).toHaveValue(30000));
		// No explicit rate stored: the documented Contract fallback applies.
		expect(screen.getByText(/TDS @ 10% = ₹3,000/)).toBeVisible();
		expect(screen.getByText(/In-Hand CTC: ₹27,000/)).toBeVisible();

		// Representative pay edit: new amount and duration persist as contract.
		fireEvent.change(amountInput, { target: { value: '40000' } });
		fireEvent.change(screen.getByLabelText('Duration'), {
			target: { value: 'yearly' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Update' }));

		await waitFor(() => {
			const saveCall = fetchMock.mock.calls.find(
				([url, init]) =>
					String(url) === '/api/payroll/salary-profile' &&
					init?.method === 'POST'
			);
			expect(saveCall).toBeTruthy();
			expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
				id: 31,
				employee_id: 2,
				salary_type: 'contract',
				contract_amount: 40000,
				contract_duration: 'yearly',
				contract_end_date: '2026-09-30',
				tds_percentage: 10,
				gross_salary: 40000,
				net_pay: 36000,
				employer_cost: 40000,
				// PL usage is synced from attendance before the save, as before.
				pl_used: 2,
			});
		});
		expect(await screen.findByText('✓ Salary profile updated!')).toBeVisible();
	});

	it('surfaces contract save failures scoped to the contract workflow', async () => {
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url === '/api/payroll/salary-profile' && init?.method === 'POST') {
					return response(
						{ success: false, error: 'Duplicate effective date' },
						false
					);
				}
				return respondWithSavedAgreement(input, init);
			}
		);

		renderSection();
		await waitFor(() =>
			expect(screen.getByLabelText('Amount (₹) *')).toHaveValue(20000)
		);

		fireEvent.click(screen.getByRole('button', { name: 'Update' }));

		expect(
			await screen.findByText(/Failed to save: Duplicate effective date/)
		).toBeVisible();
		expect(
			screen.queryByText('✓ Salary profile updated!')
		).not.toBeInTheDocument();
	});
});
