import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReactNode } from 'react';
import CategoryMaster from '@/app/masters/categories/page';

vi.mock('@/components/AccessGuard', () => ({
	default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/Navbar', () => ({
	default: () => null,
}));

describe('CategoryMaster page', () => {
	const mockData = [
		{ id: 1, category_name: 'Hardware', is_active: 1 },
		{ id: 2, category_name: 'Software', is_active: 0 },
	];

	beforeEach(() => {
		global.fetch = vi.fn(async () => ({
			json: async () => ({ success: true, data: mockData }),
		})) as unknown as typeof fetch;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('renders fetched categories list', async () => {
		render(<CategoryMaster />);

		const item = await screen.findByText('Hardware');
		expect(item).toBeInTheDocument();
		expect(screen.getByText('Software')).toBeInTheDocument();
	});

	it('opens add form and loads edit form when edit clicked', async () => {
		const user = userEvent.setup();
		render(<CategoryMaster />);

		await screen.findByText('Hardware');

		const addBtn = screen.getByRole('button', { name: /Add Category/i });
		await user.click(addBtn);
		expect(
			screen.getByText(/Add New Category|Edit Category/)
		).toBeInTheDocument();

		const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
		await user.click(cancelBtn);

		const editButtons = await screen.findAllByTitle('Edit Category');
		await user.click(editButtons[0]);

		const input = await screen.findByDisplayValue('Hardware');
		expect(input).toBeInTheDocument();
	});
});
