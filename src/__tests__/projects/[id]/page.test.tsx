import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const project = {
	id: 10,
	project_id: 'PRJ-10',
	project_code: 'CODE-10',
	name: 'Employee Project',
	status: 'Ongoing',
	project_team: '[]',
	team_members: '[]',
	project_assumption_list: '[]',
	project_query_log_list: '[]',
	project_lessons_learnt_list: '[]',
	project_schedule_list: '[]',
	input_documents_list: '[]',
	documents_issued_list: '[]',
};

const useSession = vi.fn();
const useSWR = vi.fn();
const useParams = vi.fn();
const fetchJSON = vi.fn();

vi.mock('@/context/SessionContext', () => ({ useSession }));
vi.mock('swr', () => ({ default: useSWR }));
vi.mock('next/navigation', () => ({ useParams }));
vi.mock('@/utils/http', () => ({ fetchJSON }));
vi.mock('@/components/Navbar', () => ({ default: () => <nav>Navbar</nav> }));
vi.mock('@/components/LoadingSpinner', () => ({
	default: () => <div>Loading</div>,
}));
vi.mock('next/image', () => ({ default: () => <img alt="" /> }));
vi.mock('next/dynamic', () => ({
	default: () => () => null,
}));

const { default: ProjectViewPage } =
	await import('@/app/projects/[id]/page.jsx');

const employeeTabs = [
	'Scope',
	'Schedule',
	'Project Team',
	'Input Document',
	'Deliverables',
	'Assumption',
	'Discussion',
	'Query Log',
	'Lessons Learnt',
];

describe('employee project workspace', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useParams.mockReturnValue({ id: 'PRJ-10' });
		useSession.mockReturnValue({
			user: { id: 42, full_name: 'Employee', is_super_admin: '0' },
			can: vi.fn(() => false),
			RESOURCES: { PROJECTS: 'projects' },
			PERMISSIONS: { UPDATE: 'update' },
		});
		useSWR.mockReturnValue({
			data: { success: true, data: project },
			isLoading: false,
			error: null,
		});
		fetchJSON.mockResolvedValue({
			success: true,
			data: {
				assumptions: [],
				discussions: [],
				queryLog: [],
				lessonsLearnt: [],
			},
		});
	});

	it('shows the exact nine employee tabs without admin controls', async () => {
		useSWR.mockReturnValue({
			data: {
				success: true,
				data: {
					...project,
					description: 'Private project summary',
					scope_of_work: 'Visible scope',
				},
			},
			isLoading: false,
			error: null,
		});
		render(<ProjectViewPage />);

		await waitFor(() => {
			expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(
				employeeTabs
			);
		});
		expect(screen.queryByText('Edit Project')).not.toBeInTheDocument();
		expect(
			screen.queryByText('Configure Activity Library')
		).not.toBeInTheDocument();
		expect(screen.queryByText('Ongoing')).not.toBeInTheDocument();
		expect(
			screen.queryByText('Private project summary')
		).not.toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'Back to dashboard' })
		).toHaveAttribute('href', '/user/dashboard');
	});

	it('keeps the five view-only employee panels free of editable controls', async () => {
		const user = userEvent.setup();
		render(<ProjectViewPage />);
		await screen.findByRole('tab', { name: 'Scope' });

		for (const label of [
			'Scope',
			'Schedule',
			'Project Team',
			'Input Document',
			'Deliverables',
		]) {
			await user.click(screen.getByRole('tab', { name: label }));
			await waitFor(() => {
				expect(screen.getByRole('tabpanel')).toBeVisible();
			});
			expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
			expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
		}

		await user.click(screen.getByRole('tab', { name: 'Scope' }));
		expect(screen.getByText('No scope recorded.')).toBeInTheDocument();
		await user.click(screen.getByRole('tab', { name: 'Schedule' }));
		expect(screen.getByText('No schedule items recorded.')).toBeInTheDocument();
		await user.click(screen.getByRole('tab', { name: 'Project Team' }));
		expect(
			screen.getByText('No project team members recorded.')
		).toBeInTheDocument();
		await user.click(screen.getByRole('tab', { name: 'Input Document' }));
		expect(
			screen.getByText('No input documents recorded.')
		).toBeInTheDocument();
		await user.click(screen.getByRole('tab', { name: 'Deliverables' }));
		expect(screen.getByText('No deliverables recorded.')).toBeInTheDocument();
	});
});
