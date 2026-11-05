import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchJSON = vi.fn();
const refreshSession = vi.fn();
const push = vi.fn();
const useSession = vi.fn();

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push, replace: vi.fn() }),
	useSearchParams: () => ({ get: () => null }),
	usePathname: () => '/projects',
}));

vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/LoadingSpinner', () => ({ default: () => null }));
vi.mock('@/utils/http', () => ({ fetchJSON }));
vi.mock('@/context/SessionContext', () => ({ useSession }));

const { default: ProjectsPage } = await import('@/app/projects/page.jsx');

function rights(canPerform = {}, overrides = {}) {
	return {
		canOpen: true,
		isMember: true,
		isLead: false,
		canManageTeam: false,
		canChangeLeadDesignation: false,
		sections: {},
		readableSections: [],
		editableSections: [],
		directScopes: {},
		financialAreas: { quotation: false, purchase_order: false, invoice: false },
		commercial: { view: [], edit: [] },
		canPerform: {
			create: false,
			delete: false,
			close: false,
			reopen: false,
			...canPerform,
		},
		...overrides,
	};
}

function project(overrides = {}) {
	return {
		project_id: 10,
		project_code: 'CODE-10',
		name: 'Alpha Project',
		description: 'Alpha description',
		status: 'Ongoing',
		priority: 'HIGH',
		progress: 20,
		budget: 100,
		project_team: '[]',
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	useSession.mockReturnValue({
		user: { id: 7, email: 'lead@example.com', is_super_admin: 0 },
		can: () => false,
		RESOURCES: { PROJECTS: 'projects' },
		PERMISSIONS: {
			READ: 'read',
			UPDATE: 'update',
			CREATE: 'create',
			DELETE: 'delete',
			CLOSE: 'close',
		},
		refreshSession,
	});
	fetchJSON.mockImplementation(async (url, options = {}) => {
		if (String(url).startsWith('/api/projects/list')) {
			return { success: true, data: [] };
		}
		if (String(url).startsWith('/api/project-docs')) {
			return { success: true, data: [] };
		}
		return { success: true, ...options._result };
	});
	vi.spyOn(window, 'confirm').mockReturnValue(true);
	vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function setProjects(data) {
	fetchJSON.mockImplementation(async (url, options = {}) => {
		if (String(url).startsWith('/api/projects/list')) {
			return { success: true, data };
		}
		if (String(url).startsWith('/api/project-docs')) {
			return { success: true, data: [] };
		}
		if (options.method === 'DELETE') {
			return { success: true, message: 'Project deleted successfully' };
		}
		if (options.method === 'PUT') {
			return { success: true, affected_rows: 1 };
		}
		return { success: true };
	});
}

describe('projects list lifecycle actions', () => {
	it('renders no lifecycle actions for a row without grants', async () => {
		setProjects([project({ rights: rights() })]);

		render(<ProjectsPage />);
		await screen.findByText('Alpha Project');

		expect(screen.queryByTitle('Close Project')).not.toBeInTheDocument();
		expect(screen.queryByTitle('Activate Project')).not.toBeInTheDocument();
		expect(screen.queryByTitle('Delete Project')).not.toBeInTheDocument();
	});

	it('closes a row through the status route using its close grant', async () => {
		const user = userEvent.setup();
		setProjects([project({ rights: rights({ close: true }) })]);

		render(<ProjectsPage />);
		await user.click(await screen.findByTitle('Close Project'));

		const statusCall = fetchJSON.mock.calls.find(([url]) =>
			String(url).includes('/status')
		);
		expect(statusCall?.[0]).toBe('/api/projects/10/status');
		expect(statusCall?.[1]).toMatchObject({ method: 'PUT' });
		expect(JSON.parse(statusCall[1].body)).toEqual({ status: 'completed' });
	});

	it('reopens a completed row through the status route using its reopen grant', async () => {
		const user = userEvent.setup();
		setProjects([
			project({ status: 'Completed', rights: rights({ reopen: true }) }),
		]);

		render(<ProjectsPage />);
		await screen.findByText('Projects');
		await user.click(screen.getByRole('button', { name: /Filters/i }));
		await user.selectOptions(
			screen.getByDisplayValue('All Statuses'),
			'completed'
		);
		await user.click(await screen.findByTitle('Activate Project'));

		const statusCall = fetchJSON.mock.calls.find(([url]) =>
			String(url).includes('/status')
		);
		expect(statusCall?.[0]).toBe('/api/projects/10/status');
		expect(JSON.parse(statusCall[1].body)).toEqual({ status: 'active' });
	});

	it('deletes a row through the individual project route', async () => {
		const user = userEvent.setup();
		setProjects([project({ rights: rights({ delete: true }) })]);

		render(<ProjectsPage />);
		await user.click(await screen.findByTitle('Delete Project'));

		const deleteCall = fetchJSON.mock.calls.find(
			([url, options]) =>
				String(url) === '/api/projects/10' && options?.method === 'DELETE'
		);
		expect(deleteCall).toBeTruthy();
	});

	it('shows the server message when a lifecycle action is denied', async () => {
		const user = userEvent.setup();
		setProjects([project({ rights: rights({ close: true }) })]);
		fetchJSON.mockImplementation(async (url, options = {}) => {
			if (String(url).startsWith('/api/projects/list')) {
				return {
					success: true,
					data: [project({ rights: rights({ close: true }) })],
				};
			}
			if (String(url).startsWith('/api/project-docs')) {
				return { success: true, data: [] };
			}
			if (options.method === 'PUT') {
				throw new Error(
					'You do not have permission to access this project'
				);
			}
			return { success: true };
		});

		render(<ProjectsPage />);
		await user.click(await screen.findByTitle('Close Project'));

		await waitFor(() => {
			expect(window.alert).toHaveBeenCalledWith(
				'Error closing project: You do not have permission to access this project'
			);
		});
	});
});

describe('projects list workspace entry and edit affordances', () => {
	const editableDetails = {
		editableSections: ['project_details'],
		readableSections: ['project_details'],
		sections: { project_details: { read: true, edit: true } },
	};

	it('shows View for a member who can open the project but shows no Edit', async () => {
		setProjects([project({ rights: rights() })]);

		render(<ProjectsPage />);
		await screen.findByText('Alpha Project');

		expect(screen.getByTitle('View Details')).toBeVisible();
		expect(screen.queryByTitle('Edit Project')).not.toBeInTheDocument();
	});

	it('shows Edit only when the row has an editable section', async () => {
		setProjects([
			project({ rights: rights({}, editableDetails) }),
		]);

		render(<ProjectsPage />);
		await screen.findByText('Alpha Project');

		expect(screen.getByTitle('View Details')).toBeVisible();
		expect(screen.getByTitle('Edit Project')).toBeVisible();
	});

	it('renders the project code as read-only text for a member', async () => {
		setProjects([project({ rights: rights() })]);

		render(<ProjectsPage />);
		await screen.findByText('Alpha Project');

		expect(
			screen.queryByTitle('Click to edit project code')
		).not.toBeInTheDocument();
		expect(screen.getByText('CODE-10')).toBeVisible();
	});

	it('renders the inline code editor only with project-details edit', async () => {
		const user = userEvent.setup();
		setProjects([project({ rights: rights({}, editableDetails) })]);

		render(<ProjectsPage />);
		await user.click(
			await screen.findByTitle('Click to edit project code')
		);

		expect(screen.getByDisplayValue('CODE-10')).toBeVisible();
	});

	it('makes a board card draggable only with project-details edit', async () => {
		setProjects([project({ rights: rights() })]);
		const { container } = render(<ProjectsPage />);

		await userEvent.setup().click(await screen.findByRole('tab', { name: 'Board' }));

		expect(container.querySelector('[draggable="true"]')).toBeNull();
	});

	it('refuses a drop into Completed without the close grant', async () => {
		setProjects([project({ rights: rights({}, editableDetails) })]);
		render(<ProjectsPage />);

		await userEvent.setup().click(await screen.findByRole('tab', { name: 'Board' }));
		const completed = (
			await screen.findByRole('heading', { name: 'Completed' })
		).closest('.rounded-xl');

		fireEvent.drop(completed, {
			dataTransfer: { getData: () => '10' },
		});

		expect(
			fetchJSON.mock.calls.some(([url]) => String(url).includes('/status'))
		).toBe(false);
	});

	it('permits a drop into Completed with the close grant', async () => {
		setProjects([
			project({ rights: rights({ close: true }, editableDetails) }),
		]);
		render(<ProjectsPage />);

		await userEvent.setup().click(await screen.findByRole('tab', { name: 'Board' }));
		const completed = (
			await screen.findByRole('heading', { name: 'Completed' })
		).closest('.rounded-xl');

		fireEvent.drop(completed, {
			dataTransfer: { getData: () => '10' },
		});

		await waitFor(() => {
			expect(
				fetchJSON.mock.calls.some(
					([url]) =>
						String(url).includes('/api/projects/10/status') ||
						String(url).includes('/api/projects/PROJ-10/status')
				)
			).toBe(true);
		});
	});
});
