import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchJSON = vi.fn();

vi.mock('@/utils/http', () => ({ fetchJSON }));

const { default: ProjectActivityTab } =
	await import('@/components/ProjectActivityTab');

beforeEach(() => {
	vi.clearAllMocks();
	fetchJSON.mockImplementation(async (url) => {
		const path = String(url);
		if (path.includes('/work-logs')) {
			return {
				success: true,
				data: { users: [], total_logs: 0, total_qty: 0 },
			};
		}
		if (path.startsWith('/api/users')) {
			return { success: true, data: [] };
		}
		if (path.startsWith('/api/activity-master')) {
			return { success: true, data: [] };
		}
		if (path.includes('/assign-activities')) {
			return { success: true, data: [] };
		}
		return { success: true, data: [] };
	});
});

describe('ProjectActivityTab assignment entry', () => {
	it('renders no assignment control without assignment authority', async () => {
		render(<ProjectActivityTab projectId={10} canAssignActivity={false} />);

		await screen.findByText(/logs across 0 members/);

		expect(
			screen.queryByRole('button', { name: /Assign Activities/i })
		).not.toBeInTheDocument();
		expect(fetchJSON).not.toHaveBeenCalledWith(
			expect.stringContaining('/assign-activities')
		);
	});

	it('renders the assignment control and opens the modal with authority', async () => {
		const user = userEvent.setup();
		render(<ProjectActivityTab projectId={10} canAssignActivity />);

		const entry = await screen.findByRole('button', {
			name: /Assign Activities/i,
		});
		expect(entry).toBeVisible();

		await user.click(entry);

		// The modal mounts only for an authorised actor and loads its
		// assignment list for the same project id.
		await waitFor(() => {
			expect(fetchJSON).toHaveBeenCalledWith(
				expect.stringContaining('/api/projects/10/assign-activities')
			);
		});
	});
});
