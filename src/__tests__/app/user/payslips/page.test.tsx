import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	mockReplace: vi.fn(),
	mockApiGet: vi.fn(),
	mockDownloadFile: vi.fn(),
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn(), replace: mocks.mockReplace }),
}));
vi.mock('@/components/Navbar', () => ({
	default: () => <nav>Navbar</nav>,
}));
vi.mock('@/context/SessionContext', () => ({
	useSession: () => ({ loading: false, authenticated: true }),
}));
vi.mock('@/lib/api-client', () => ({ apiGet: mocks.mockApiGet }));
vi.mock('@/lib/download', () => ({ downloadFile: mocks.mockDownloadFile }));

import MyPayrollSlipsPage from '@/app/user/payslips/page';

// The page reads through TanStack Query, so it needs a client of its own — one
// per render, so no test sees another's cache.
function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={client}>
			<MyPayrollSlipsPage />
		</QueryClientProvider>
	);
}

const SLIPS = [
	{
		id: 2,
		month: '2026-07-01',
		net_pay: '46180.00',
		payment_status: 'pending',
		payment_date: null,
		employee_name: 'Asha Rao',
	},
	{
		id: 1,
		month: '2026-06-01',
		net_pay: '46180.00',
		payment_status: 'paid',
		payment_date: '2026-07-05',
		employee_name: 'Asha Rao',
	},
];

describe('My Payroll Slips page (issue #247)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDownloadFile.mockResolvedValue(undefined);
	});

	it('lists the employee’s slips month-wise, newest first', async () => {
		mocks.mockApiGet.mockResolvedValue({ success: true, data: SLIPS });

		renderPage();

		expect(await screen.findByText('July 2026')).toBeInTheDocument();
		expect(screen.getByText('June 2026')).toBeInTheDocument();
		expect(screen.getAllByText('₹46,180.00')).toHaveLength(2);
		expect(screen.getByText('pending')).toBeInTheDocument();
		expect(screen.getByText('paid')).toBeInTheDocument();
		expect(mocks.mockApiGet).toHaveBeenCalledWith('/api/me/payslips');
	});

	it('shows an empty state when no month has been published yet', async () => {
		mocks.mockApiGet.mockResolvedValue({ success: true, data: [] });

		renderPage();

		expect(await screen.findByText(/No Payroll Slips yet/)).toBeInTheDocument();
	});

	it('downloads one slip from the self-service PDF endpoint', async () => {
		mocks.mockApiGet.mockResolvedValue({ success: true, data: SLIPS });

		renderPage();
		await screen.findByText('July 2026');

		fireEvent.click(screen.getAllByRole('button', { name: /PDF/ })[0]);

		await waitFor(() =>
			expect(mocks.mockDownloadFile).toHaveBeenCalledWith(
				'/api/me/payslips/pdf?month=2026-07-01',
				'Payroll_Slip_Asha_Rao_2026-07.pdf'
			)
		);
	});

	it('reports a failed download without losing the list', async () => {
		mocks.mockApiGet.mockResolvedValue({ success: true, data: SLIPS });
		mocks.mockDownloadFile.mockRejectedValue(
			new Error('No Payroll Slip found for this month')
		);

		renderPage();
		await screen.findByText('July 2026');

		fireEvent.click(screen.getAllByRole('button', { name: /PDF/ })[0]);

		expect(
			await screen.findByText('No Payroll Slip found for this month')
		).toBeInTheDocument();
		expect(screen.getByText('July 2026')).toBeInTheDocument();
	});
});
