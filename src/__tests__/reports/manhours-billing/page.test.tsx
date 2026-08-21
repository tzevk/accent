import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ManhoursBillingReportPage from '@/app/reports/manhours-billing/page';

vi.mock('@/components/Navbar', () => ({
	default: () => null,
}));

const mockSessionRBAC = {
	loading: false,
	user: {
		is_super_admin: 1,
		field_permissions: null,
	},
	can: vi.fn().mockReturnValue(true),
	RESOURCES: { REPORTS: 'reports' },
	PERMISSIONS: { READ: 'read' },
};

vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => mockSessionRBAC,
}));

vi.mock('@/lib/api-client', () => ({
	apiGet: vi.fn(),
}));

const MOCK_META = {
	success: true,
	meta: {
		clients: ['Acme Corp'],
		projects: [
			{
				project_id: 1,
				project_code: 'P-001',
				project_name: 'Site Works',
				client_name: 'Acme Corp',
			},
		],
		months: ['2026-08'],
		latest_month: '2026-08',
	},
};

// The template's mock row: 176h at 430/hr (company) and 480/hr (accent),
// TDS 10% → 75,680 / 7,568 / 68,112 / 84,480 / 16,368 / 8,800.
const MOCK_DATA = {
	success: true,
	data: {
		client_name: 'Acme Corp',
		project: {
			project_id: 1,
			project_code: 'P-001',
			project_name: 'Site Works',
		},
		month: '2026-08',
		month_label: 'August 2026',
		year: 2026,
		rows: [
			{
				sr_no: 1,
				employee_id: 1,
				employee_code: 'ATS0001',
				employee_name: 'Abrar Tamboli',
				designation: 'Designer',
				employee_charges: 430,
				total_manhours: 176,
				amount: 75680,
				tds_rate: 10,
				tds: 7568,
				net_payable: 68112,
				accent_charges: 480,
				accent_amount: 84480,
				pnl_after_deductions: 16368,
				pnl_tds: 8800,
			},
		],
		totals: {
			total_manhours: 176,
			total_amount: 75680,
			total_tds: 7568,
			total_net_payable: 68112,
			total_accent_amount: 84480,
			total_pnl_after_deductions: 16368,
			total_pnl_tds: 8800,
		},
	},
};

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 0,
			},
		},
	});
	function QueryWrapper({ children }: { children: React.ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
	}
	return QueryWrapper;
}

describe('ManhoursBillingReportPage', () => {
	let apiGet: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockSessionRBAC.loading = false;
		mockSessionRBAC.user = {
			is_super_admin: 1,
			field_permissions: null,
		};

		const mod = await import('@/lib/api-client');
		apiGet = mod.apiGet as ReturnType<typeof vi.fn>;
		apiGet.mockImplementation((url: string) => {
			if (String(url).includes('project_id=')) {
				return Promise.resolve(MOCK_DATA);
			}
			return Promise.resolve(MOCK_META);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('shows Access Denied for unauthorized users', async () => {
		mockSessionRBAC.user = { is_super_admin: 0, field_permissions: null };
		mockSessionRBAC.can.mockReturnValue(false);

		render(<ManhoursBillingReportPage />, { wrapper: createWrapper() });

		expect(await screen.findByText('Access Denied')).toBeInTheDocument();
	});

	it('renders the two-row header with all 12 columns', async () => {
		render(<ManhoursBillingReportPage />, { wrapper: createWrapper() });

		// The sheet only renders after meta + data load.
		expect(await screen.findByText('Abrar Tamboli')).toBeInTheDocument();

		// Plain labels are vertically merged across both header rows.
		expect(screen.getByText('Sr. No.')).toBeInTheDocument();
		expect(screen.getByText('Employee Name')).toBeInTheDocument();
		expect(screen.getByText('Designation')).toBeInTheDocument();
		expect(screen.getAllByText('Total Manhours').length).toBeGreaterThanOrEqual(
			1
		);
		expect(screen.getByText('Employee Charges')).toBeInTheDocument();
		expect(screen.getAllByText('Amount').length).toBeGreaterThanOrEqual(2);
		expect(screen.getAllByText('TDS').length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText('Net Payable')).toBeInTheDocument();
		expect(screen.getByText('Accent Charges')).toBeInTheDocument();
		// P&L merges the last two columns; sub-labels sit in the second row.
		expect(screen.getByText('P&L')).toBeInTheDocument();
		expect(screen.getByText('After Deductions')).toBeInTheDocument();

		// Merging structure: 10 rowSpan=2 cells + one colSpan=2 P&L cell.
		const ths = document.querySelectorAll('th[rowspan="2"]');
		expect(ths.length).toBe(10);
		expect(screen.getByText('P&L').closest('th')!.getAttribute('colspan')).toBe(
			'2'
		);
	});

	it('renders the template row values with tints on the data cells', async () => {
		render(<ManhoursBillingReportPage />, { wrapper: createWrapper() });

		expect(await screen.findByText('Abrar Tamboli')).toBeInTheDocument();
		expect(screen.getByText('Designer')).toBeInTheDocument();
		// Manhours and money totals repeat in the totals row, so match broadly.
		expect(screen.getAllByText('176').length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText('430.00')).toBeInTheDocument();
		expect(screen.getAllByText('75,680.00').length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText('7,568.00').length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText('68,112.00').length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText('480.00')).toBeInTheDocument();
		expect(screen.getAllByText('84,480.00').length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText('16,368.00').length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText('8,800.00').length).toBeGreaterThanOrEqual(1);

		// Section tints are applied per column group in the data row.
		const nameCell = screen.getByText('Abrar Tamboli').closest('td')!;
		expect(nameCell.className).toContain('bg-yellow-100');
		const tdCells = Array.from(document.querySelectorAll('td'));
		const manhoursTd = tdCells.find((td) => td.textContent?.trim() === '176')!;
		expect(manhoursTd.className).toContain('bg-blue-100');
		const accentCell = screen.getByText('480.00').closest('td')!;
		expect(accentCell.className).toContain('bg-green-100');
		const pnlCell = screen.getAllByText('16,368.00')[0].closest('td')!;
		expect(pnlCell.className).toContain('bg-orange-200');
	});
	it('renders the totals row', async () => {
		render(<ManhoursBillingReportPage />, { wrapper: createWrapper() });

		expect(await screen.findByText('Abrar Tamboli')).toBeInTheDocument();
		expect(screen.getByText('Total')).toBeInTheDocument();
		// Totals equal the single row's values.
		expect(screen.getAllByText('75,680.00').length).toBeGreaterThanOrEqual(2);
		expect(screen.getAllByText('8,800.00').length).toBeGreaterThanOrEqual(2);
	});

	it('shows the empty state when no hours were logged', async () => {
		apiGet.mockImplementation((url: string) => {
			if (String(url).includes('project_id=')) {
				return Promise.resolve({
					success: true,
					data: {
						...MOCK_DATA.data,
						rows: [],
						totals: {
							total_manhours: 0,
							total_amount: 0,
							total_tds: 0,
							total_net_payable: 0,
							total_accent_amount: 0,
							total_pnl_after_deductions: 0,
							total_pnl_tds: 0,
						},
					},
				});
			}
			return Promise.resolve(MOCK_META);
		});

		render(<ManhoursBillingReportPage />, { wrapper: createWrapper() });

		expect(
			await screen.findByText(
				'No manhours logged on this project in August 2026.'
			)
		).toBeInTheDocument();
	});
	it('switches to Annual FY Matrix view and renders the 12-month table', async () => {
		const MOCK_ANNUAL_DATA = {
			success: true,
			view: 'annual',
			data: {
				client_name: 'Tecnimont Private Limited',
				project: {
					project_id: 18,
					project_code: '18',
					project_name: 'Engineering Manpower on Deputation basis',
				},
				fy_label: 'FY 2026–27',
				fy_year: 2026,
				months: [
					'Apr',
					'May',
					'Jun',
					'Jul',
					'Aug',
					'Sep',
					'Oct',
					'Nov',
					'Dec',
					'Jan',
					'Feb',
					'Mar',
				],
				month_keys: [
					'apr',
					'may',
					'jun',
					'jul',
					'aug',
					'sep',
					'oct',
					'nov',
					'dec',
					'jan',
					'feb',
					'mar',
				],
				rows: [
					{
						sr_no: 1,
						id: 't1',
						employee_id: null,
						employee_code: '',
						employee_name: 'Uttam Lad',
						designation: 'Layout Engineer',
						salary_type: 'custom',
						rate_employee: 456,
						rate_client: 550,
						monthly_hours: {
							apr: 200,
							may: 200,
							jun: 0,
							jul: 0,
							aug: 0,
							sep: 0,
							oct: 0,
							nov: 0,
							dec: 0,
							jan: 0,
							feb: 0,
							mar: 0,
						},
						total_hours: 400,
						company_cost: 182400,
						accent_cost: 220000,
						pnl: 37600,
					},
				],
				totals: {
					monthly_hours: {
						apr: 200,
						may: 200,
						jun: 0,
						jul: 0,
						aug: 0,
						sep: 0,
						oct: 0,
						nov: 0,
						dec: 0,
						jan: 0,
						feb: 0,
						mar: 0,
					},
					total_hours: 400,
					total_company_cost: 182400,
					total_accent_cost: 220000,
					total_pnl: 37600,
				},
			},
		};

		apiGet.mockImplementation((url: string) => {
			if (String(url).includes('view=annual')) {
				return Promise.resolve(MOCK_ANNUAL_DATA);
			}
			if (String(url).includes('project_id=')) {
				return Promise.resolve(MOCK_DATA);
			}
			return Promise.resolve(MOCK_META);
		});

		render(<ManhoursBillingReportPage />, { wrapper: createWrapper() });

		// Wait for initial load
		expect(await screen.findByText('Abrar Tamboli')).toBeInTheDocument();

		// Switch to Annual FY Matrix view
		const annualTabButton = screen.getByRole('tab', {
			name: /annual fy matrix/i,
		});
		annualTabButton.click();

		// Wait for annual data to render
		expect(await screen.findByText('Uttam Lad')).toBeInTheDocument();
		expect(screen.getByText('RT/HR (Emp)')).toBeInTheDocument();
		expect(screen.getByText('RT/HR (Co)')).toBeInTheDocument();
		expect(screen.getByText('Grand Total')).toBeInTheDocument();
		expect(screen.getAllByText('400').length).toBeGreaterThanOrEqual(1);
	});
});
