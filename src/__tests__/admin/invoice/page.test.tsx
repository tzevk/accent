import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import InvoicePage from '@/app/admin/invoice/page';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({ user: { id: 1 }, loading: false }),
}));

vi.mock('@/components/Navbar', () => ({
	default: () => null,
}));

describe('InvoicePage', () => {
	const mockInvoices = [
		{
			id: 1,
			invoice_number: 'ATS-I/JAN-26/001',
			client_name: 'Test Client',
			client_email: 'client@test.com',
			description: 'Test invoice',
			total: 50000,
			status: 'draft',
			created_at: '2026-01-15T00:00:00.000Z',
			due_date: '2026-02-14T00:00:00.000Z',
		},
		{
			id: 2,
			invoice_number: 'ATS-I/JAN-26/002',
			client_name: 'Another Client',
			client_email: 'another@test.com',
			description: 'Consulting services',
			total: 75000,
			status: 'sent',
			created_at: '2026-01-20T00:00:00.000Z',
			due_date: '2026-02-19T00:00:00.000Z',
		},
	];

	const mockStats = {
		total: 2,
		draft: 1,
		sent: 1,
		paid: 0,
		overdue: 0,
		cancelled: 0,
	};

	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation((input) => {
				const urlStr = typeof input === 'string' ? input : String(input);
				const searchMatch = urlStr.match(/[?&]search=([^&]*)/);
				const search = searchMatch ? decodeURIComponent(searchMatch[1]) : '';
				const filtered = search
					? mockInvoices.filter(
							(inv) =>
								inv.invoice_number
									.toLowerCase()
									.includes(search.toLowerCase()) ||
								inv.client_name.toLowerCase().includes(search.toLowerCase()) ||
								(inv.description || '')
									.toLowerCase()
									.includes(search.toLowerCase())
						)
					: mockInvoices;
				return Promise.resolve({
					json: vi.fn().mockResolvedValue({
						success: true,
						data: filtered,
						pagination: {
							page: 1,
							limit: 20,
							total: filtered.length,
							totalPages: 1,
						},
						stats: { ...mockStats, total: filtered.length },
					}),
				});
			})
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders page title and stats', async () => {
		render(<InvoicePage />);

		expect(await screen.findByText('Sale Invoices')).toBeInTheDocument();
		expect(screen.getByText('Total')).toBeInTheDocument();
		expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
	});

	it('renders invoice list from API', async () => {
		render(<InvoicePage />);

		expect(await screen.findByText('ATS-I/JAN-26/001')).toBeInTheDocument();
		expect(screen.getByText('ATS-I/JAN-26/002')).toBeInTheDocument();
		expect(screen.getByText('Test Client')).toBeInTheDocument();
		expect(screen.getByText('Another Client')).toBeInTheDocument();
	});

	it('navigates to create page on button click', async () => {
		const user = userEvent.setup();
		render(<InvoicePage />);

		await screen.findByText('Sale Invoices');
		await user.click(screen.getByText('Create Invoice'));
		expect(mockPush).toHaveBeenCalledWith('/admin/invoice/create');
	});

	it('navigates to edit page on edit button click', async () => {
		const user = userEvent.setup();
		render(<InvoicePage />);

		await screen.findByText('ATS-I/JAN-26/001');
		const editBtns = await screen.findAllByTitle('Edit Invoice');
		await user.click(editBtns[0]);
		expect(mockPush).toHaveBeenCalledWith('/admin/invoice/edit/1');
	});

	it('filters invoices by search term', async () => {
		const user = userEvent.setup();
		render(<InvoicePage />);

		await screen.findByText('ATS-I/JAN-26/001');

		const searchInput = screen.getByPlaceholderText('Search invoices...');
		await user.type(searchInput, 'Another');

		expect(screen.queryByText('ATS-I/JAN-26/001')).not.toBeInTheDocument();
		expect(screen.getByText('Another Client')).toBeInTheDocument();
	});
});
