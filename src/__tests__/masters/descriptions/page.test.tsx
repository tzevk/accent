import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DescriptionMaster from '@/app/masters/descriptions/page';

vi.mock('@/components/AccessGuard', () => ({
	default: ({ children }) => children,
}));

vi.mock('@/components/Navbar', () => ({
	default: () => null,
}));

describe('DescriptionMaster page', () => {
	const mockData = [
		{ id: 1, description_name: 'Travelling Expenses', is_active: 1 },
		{ id: 2, description_name: 'Office Supplies', is_active: 0 },
	];

	beforeEach(() => {
		// mock global fetch used by the page
		global.fetch = vi.fn(() =>
			Promise.resolve({
				json: () => Promise.resolve({ success: true, data: mockData }),
			})
		) as any;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('renders fetched descriptions list', async () => {
		render(<DescriptionMaster />);

		// wait for an item from the mocked data to appear
		const item = await screen.findByText('Travelling Expenses');
		expect(item).toBeInTheDocument();
		expect(screen.getByText('Office Supplies')).toBeInTheDocument();
	});

	it('opens add form and loads edit form when edit clicked', async () => {
		const user = userEvent.setup();
		render(<DescriptionMaster />);

		// wait for list to render
		await screen.findByText('Travelling Expenses');

		// click Add Description to open add form
		const addBtn = screen.getByRole('button', { name: /Add Description/i });
		await user.click(addBtn);
		expect(
			screen.getByText(/Add New Description|Edit Description/)
		).toBeInTheDocument();

		// go back to list and click edit on first row
		const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
		await user.click(cancelBtn);

		const editButtons = await screen.findAllByTitle('Edit Description');
		await user.click(editButtons[0]);

		// form should show with pre-filled value
		const input = await screen.findByDisplayValue('Travelling Expenses');
		expect(input).toBeInTheDocument();
	});
});
