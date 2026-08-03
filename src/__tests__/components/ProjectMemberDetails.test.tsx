import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectMemberDetails from '@/components/projects/ProjectMemberDetails';

const { mockFetchJSON } = vi.hoisted(() => ({ mockFetchJSON: vi.fn() }));
vi.mock('@/utils/http', () => ({ fetchJSON: mockFetchJSON }));

const baseProps = {
	projectId: 'PRJ-10',
	projectTeamMembers: [{ id: 7, name: 'Project Lead' }],
	currentUser: { id: 42, full_name: 'Member Name', username: 'member' },
};

const emptyResponse = {
	success: true,
	data: { assumptions: [], discussions: [], queryLog: [], lessonsLearnt: [] },
};

function renderSection(
	activeSection: 'assumption' | 'discussion' | 'query_log' | 'lessons_learnt'
) {
	return render(
		<ProjectMemberDetails {...baseProps} activeSection={activeSection} />
	);
}

describe('ProjectMemberDetails', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchJSON.mockResolvedValue(emptyResponse);
	});

	it('validates the required field, announces the error, and focuses it', async () => {
		const user = userEvent.setup();
		renderSection('assumption');
		await waitFor(() => expect(mockFetchJSON).toHaveBeenCalledTimes(1));

		const field = screen.getByLabelText('Assumption *');
		await user.click(screen.getByRole('button', { name: 'Add assumption' }));

		expect(screen.getByText('This field is required.')).toBeInTheDocument();
		expect(field).toHaveAttribute('aria-invalid', 'true');
		expect(field).toHaveFocus();
		expect(mockFetchJSON).toHaveBeenCalledTimes(1);
	});

	it('posts an assumption and announces the returned entry', async () => {
		const user = userEvent.setup();
		mockFetchJSON.mockResolvedValueOnce(emptyResponse).mockResolvedValueOnce({
			success: true,
			data: {
				section: 'assumption',
				entry: { id: 'a-1', assumption_description: 'Saved assumption' },
			},
		});
		renderSection('assumption');
		await user.type(screen.getByLabelText('Assumption *'), 'New assumption');
		await user.click(screen.getByRole('button', { name: 'Add assumption' }));

		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent('Saved assumption')
		);
		expect(screen.getByRole('status')).toHaveTextContent('Saved assumption');
		const [, options] = mockFetchJSON.mock.calls[1];
		expect(JSON.parse(options.body)).toEqual({
			section: 'assumption',
			entry: {
				assumption_description: 'New assumption',
				reason: '',
				remark: '',
			},
		});
	});

	it('posts a query log with its date and resolution fields', async () => {
		const user = userEvent.setup();
		mockFetchJSON.mockResolvedValueOnce(emptyResponse).mockResolvedValueOnce({
			success: true,
			data: {
				section: 'query_log',
				entry: { id: 'q-1', query_description: 'Saved query' },
			},
		});
		renderSection('query_log');
		fireEvent.change(screen.getByLabelText('Issued date'), {
			target: { value: '2026-08-03' },
		});
		await user.type(screen.getByLabelText('Query *'), 'Client query');
		await user.selectOptions(screen.getByLabelText('Resolution'), 'Resolved');
		await user.click(screen.getByRole('button', { name: 'Add query' }));

		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent('Saved query_log')
		);
		const [, options] = mockFetchJSON.mock.calls[1];
		expect(JSON.parse(options.body)).toEqual({
			section: 'query_log',
			entry: {
				query_description: 'Client query',
				query_issued_date: '2026-08-03',
				reply_from_client: '',
				reply_received_date: '',
				query_resolved: 'Resolved',
				remark: '',
			},
		});
		expect(screen.getByRole('status')).toHaveTextContent('Saved query_log');
	});

	it('posts a lessons learnt entry and updates the list', async () => {
		const user = userEvent.setup();
		mockFetchJSON.mockResolvedValueOnce(emptyResponse).mockResolvedValueOnce({
			success: true,
			data: {
				section: 'lessons_learnt',
				entry: { id: 'l-1', what_was_new: 'Saved lesson' },
			},
		});
		renderSection('lessons_learnt');
		await user.type(screen.getByLabelText('What was new *'), 'New lesson');
		await user.click(screen.getByRole('button', { name: 'Add lesson' }));

		await waitFor(() =>
			expect(screen.getByText('Saved lesson')).toBeInTheDocument()
		);
		const [, options] = mockFetchJSON.mock.calls[1];
		expect(JSON.parse(options.body)).toEqual({
			section: 'lessons_learnt',
			entry: {
				what_was_new: 'New lesson',
				difficulty_faced: '',
				what_you_learn: '',
				areas_of_improvement: '',
				remark: '',
			},
		});
	});

	it('posts a discussion with the selected team member', async () => {
		const user = userEvent.setup();
		mockFetchJSON.mockResolvedValueOnce(emptyResponse).mockResolvedValueOnce({
			success: true,
			data: {
				section: 'discussion',
				entry: { id: 8, description: 'Saved discussion' },
			},
		});
		renderSection('discussion');
		await user.type(screen.getByLabelText('Discussion *'), 'Team review');
		await user.selectOptions(
			screen.getByLabelText('Responsible person'),
			'Project Lead'
		);
		await user.click(screen.getByRole('button', { name: 'Add discussion' }));
		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent('Saved discussion')
		);
		const [, options] = mockFetchJSON.mock.calls[1];
		expect(JSON.parse(options.body)).toEqual({
			section: 'discussion',
			entry: {
				follow_up_date: '',
				description: 'Team review',
				responsible_person: 'Project Lead',
			},
		});
	});
});
