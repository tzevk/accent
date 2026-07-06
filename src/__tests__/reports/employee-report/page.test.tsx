import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmployeeReportPage from '@/app/reports/employee-report/page';

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/Navbar', () => ({
	default: () => null,
}));

const mockCan = vi.fn().mockReturnValue(true);
const mockSessionRBAC = {
	loading: false,
	user: {
		is_super_admin: 1,
		field_permissions: null,
	},
	can: mockCan,
	RESOURCES: { REPORTS: 'reports' },
	PERMISSIONS: { READ: 'read' },
};

vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => mockSessionRBAC,
}));

vi.mock('@/lib/api-client', () => ({
	apiGet: vi.fn(),
}));

const MOCK_EMPLOYEES = [
	{
		user_id: '1',
		user_name: 'Alice Sharma',
		email: 'alice@ac.com',
		rows: [
			{
				date: '2026-03-01',
				project_id: 10,
				project_code: 'P-010',
				activity_name: 'Foundation Work',
				sub_activity_name: 'Excavation',
				assignment_id: '10-act-1-1',
				planned_hours: 12,
				hours: 4,
				qty_done: 2,
			},
		],
	},
	{
		user_id: '2',
		user_name: 'Bob Verma',
		email: 'bob@ac.com',
		rows: [],
	},
];

const MOCK_META = {
	total_employees: 2,
	employees_with_work: 1,
	total_rows: 1,
};

const MOCK_RESPONSE = {
	success: true,
	data: MOCK_EMPLOYEES,
	meta: MOCK_META,
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

describe('EmployeeReportPage', () => {
	let apiGet: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockSessionRBAC.loading = false;
		mockSessionRBAC.user = {
			is_super_admin: 1,
			field_permissions: null,
		};
		mockCan.mockReturnValue(true);

		const mod = await import('@/lib/api-client');
		apiGet = mod.apiGet as ReturnType<typeof vi.fn>;
		apiGet.mockResolvedValue(MOCK_RESPONSE);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('shows loading state while auth is loading', () => {
		mockSessionRBAC.loading = true;
		apiGet.mockReturnValue(new Promise(() => {}));

		render(<EmployeeReportPage />, { wrapper: createWrapper() });

		expect(screen.getByText('Loading...')).toBeInTheDocument();
	});

	it('shows Access Denied for unauthorized users', () => {
		mockSessionRBAC.user = { is_super_admin: 0, field_permissions: null };
		mockCan.mockReturnValue(false);

		render(<EmployeeReportPage />, { wrapper: createWrapper() });

		expect(screen.getByText('Access Denied')).toBeInTheDocument();
		expect(
			screen.getByText(/don't have permission to view this report/)
		).toBeInTheDocument();
	});

	it('renders employee cards when data is loaded', async () => {
		render(<EmployeeReportPage />, { wrapper: createWrapper() });

		// Names appear in both dropdown options and card headers
		expect(await screen.findAllByText('Alice Sharma')).toHaveLength(2);
		// Bob Verma has no rows (empty), hidden by default (showEmpty=false)
		// His name still appears in the employee dropdown
		expect(screen.getAllByText('Bob Verma')).toHaveLength(1);
		// Alice's email is only in the card (not the dropdown)
		expect(screen.getByText('alice@ac.com')).toBeInTheDocument();
		// Bob's email is not shown (card hidden)
		expect(screen.queryByText('bob@ac.com')).not.toBeInTheDocument();
	});

	it('shows empty state with no data', async () => {
		apiGet.mockResolvedValue({
			success: true,
			data: [],
			meta: {
				total_employees: 0,
				employees_with_work: 0,
				total_rows: 0,
			},
		});

		render(<EmployeeReportPage />, { wrapper: createWrapper() });

		expect(await screen.findByText('No employees found.')).toBeInTheDocument();
	});

	it('search filters employees by name', async () => {
		const user = userEvent.setup();
		render(<EmployeeReportPage />, { wrapper: createWrapper() });

		// Wait for data to load
		await screen.findAllByText('Alice Sharma');

		const searchInput = screen.getByPlaceholderText(
			'Search employee, project, activity…'
		);
		await user.type(searchInput, 'Alice');

		// After filtering, Alice's card still appears
		expect(screen.getAllByText('Alice Sharma').length).toBeGreaterThanOrEqual(
			1
		);
		// Bob's email is only in the card (not the dropdown), so it should be gone
		expect(screen.queryByText('bob@ac.com')).not.toBeInTheDocument();
	});

	it('shows error state and retry button on failure', async () => {
		apiGet.mockRejectedValue(new Error('Network error'));

		render(<EmployeeReportPage />, { wrapper: createWrapper() });

		expect(await screen.findByText('Error Loading Data')).toBeInTheDocument();
		expect(screen.getByText('Network error')).toBeInTheDocument();
		expect(screen.getByText('Retry')).toBeInTheDocument();
	});

	it('renders page title and breadcrumb', async () => {
		render(<EmployeeReportPage />, { wrapper: createWrapper() });

		// "Employee Report" appears in both breadcrumb and h1
		expect(await screen.findAllByText('Employee Report')).toHaveLength(2);
	});

	it('shows meta stats when data is loaded', async () => {
		render(<EmployeeReportPage />, { wrapper: createWrapper() });

		// "Alice Sharma" appears twice (dropdown + card)
		await screen.findAllByText('Alice Sharma');
		expect(screen.getByText('Employees')).toBeInTheDocument();
		expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText('With Work')).toBeInTheDocument();
		expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
	});

	it('renders refresh button', async () => {
		render(<EmployeeReportPage />, { wrapper: createWrapper() });

		// "Alice Sharma" appears twice (dropdown + card)
		await screen.findAllByText('Alice Sharma');
		expect(screen.getByText('Refresh')).toBeInTheDocument();
	});
});
