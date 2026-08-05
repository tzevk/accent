import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DeliverablesMasterPage from '@/app/masters/deliverables/page';

vi.mock('@/components/AccessGuard', () => ({
	default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/Navbar', () => ({
	default: () => null,
}));

vi.mock('@/components/admin/ResourceFormModal', () => ({
	default: (props: { title: string }) => (
		<div data-testid="modal-title">{props.title}</div>
	),
}));

const mockApiGet = vi.fn().mockResolvedValue({
	success: true,
	data: [{ id: 1, deliverable_name: 'Process Design Basis' }],
});
const mockApiDelete = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/lib/api-client', () => ({
	apiGet: (...args: unknown[]) => mockApiGet(...args),
	apiDelete: (...args: unknown[]) => mockApiDelete(...args),
}));

vi.mock('react-hot-toast', () => ({
	default: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

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

describe('DeliverablesMasterPage', () => {
	beforeEach(() => {
		mockApiGet.mockClear();
		mockApiDelete.mockClear();
		mockApiGet.mockResolvedValue({
			success: true,
			data: [{ id: 1, deliverable_name: 'Process Design Basis' }],
		});
	});

	it('renders the master list', async () => {
		render(<DeliverablesMasterPage />, { wrapper: createWrapper() });
		expect(await screen.findByText('Process Design Basis')).toBeInTheDocument();
		expect(screen.getByText('Deliverables Master')).toBeInTheDocument();
		expect(mockApiGet).toHaveBeenCalledWith('/api/masters/deliverables');
	});

	it('opens the add modal when clicking Add Deliverable', async () => {
		const user = userEvent.setup();
		render(<DeliverablesMasterPage />, { wrapper: createWrapper() });
		await screen.findByText('Process Design Basis');
		await user.click(screen.getByText('Add Deliverable'));
		expect(screen.getByTestId('modal-title')).toHaveTextContent(
			'Add Deliverable'
		);
	});

	it('deletes a deliverable after confirmation', async () => {
		const user = userEvent.setup();
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		render(<DeliverablesMasterPage />, { wrapper: createWrapper() });
		await screen.findByText('Process Design Basis');
		await user.click(screen.getByTitle('Delete deliverable'));
		expect(mockApiDelete).toHaveBeenCalledWith('/api/masters/deliverables/1');
		confirmSpy.mockRestore();
	});
});
