import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ProjectActivityAssignments from '@/components/ProjectActivityAssignments';

const DISCIPLINE_OPTIONS = [
	{
		id: 'd1',
		function_name: 'Mechanical',
		activities: [
			{
				id: 'a1',
				activity_name: 'Fabrication',
				subActivities: [
					{ id: 's1', name: 'Welding', default_manhours: 8 },
					{ id: 's2', name: 'Cutting', default_manhours: 4 },
				],
			},
			{
				id: 'a2',
				activity_name: 'Assembly',
				subActivities: [],
			},
		],
	},
	{
		id: 'd2',
		function_name: 'Electrical',
		activities: [
			{
				id: 'a3',
				activity_name: 'Wiring',
				subActivities: [{ id: 's3', name: 'Cabling', default_manhours: 6 }],
			},
		],
	},
];

const ASSIGNMENTS = [
	{
		project_id: 1,
		project_name: 'Alpha Plant',
		project_code: 'P-001',
		project_status: 'Active',
		project_start_date: '2026-01-01',
		project_end_date: '2026-06-30',
		activity_id: 'act-1',
		activity_name: 'Foundation Work',
		discipline: 'Civil',
		sub_activity_name: 'Excavation',
		default_manhours: 12,
		planned_hours: 8,
		actual_hours: 4,
		due_date: '2026-02-15',
		status: 'In Progress',
	},
	{
		project_id: 1,
		project_name: 'Alpha Plant',
		project_code: 'P-001',
		project_status: 'Active',
		project_start_date: '2026-01-01',
		project_end_date: '2026-06-30',
		activity_id: 'act-2',
		activity_name: 'Steel Erection',
		discipline: 'Structural',
		sub_activity_name: '',
		default_manhours: 0,
		planned_hours: 5,
		actual_hours: 0,
		due_date: '2026-03-01',
		status: 'Not Started',
	},
	{
		project_id: 2,
		project_name: 'Beta Tower',
		project_code: 'P-002',
		project_status: 'Active',
		project_start_date: '2026-02-01',
		project_end_date: '2026-12-31',
		activity_id: 'act-3',
		activity_name: 'HVAC Install',
		discipline: 'Mechanical',
		sub_activity_name: 'Ducting',
		default_manhours: 10,
		planned_hours: 16,
		actual_hours: 8,
		due_date: '2026-04-01',
		status: 'On Hold',
	},
];

const EMPTY_PROJECTS = [
	{
		project_id: 3,
		project_name: 'Gamma Bridge',
		project_code: 'P-003',
		project_status: 'Active',
		project_start_date: '2026-04-01',
		project_end_date: '2026-09-30',
	},
];

const buildFetch = ({
	assignments = ASSIGNMENTS,
	empty = EMPTY_PROJECTS,
} = {}) => {
	const mock = vi.fn(async (url, options) => {
		if (
			typeof url === 'string' &&
			url.startsWith('/api/activity-master/options')
		) {
			return {
				ok: true,
				headers: { get: () => 'application/json' },
				json: async () => ({ success: true, data: DISCIPLINE_OPTIONS }),
			};
		}
		if (typeof url === 'string' && url.includes('/activity-assignments')) {
			const method = (options?.method || 'GET').toUpperCase();
			if (method === 'PATCH') {
				return {
					ok: true,
					headers: { get: () => 'application/json' },
					json: async () => ({
						success: true,
						data: { activity_id: 'new-id' },
					}),
				};
			}
			return {
				ok: true,
				headers: { get: () => 'application/json' },
				json: async () => ({
					success: true,
					data: { assignments, emptyProjects: empty, stats: {} },
				}),
			};
		}
		return {
			ok: true,
			headers: { get: () => 'application/json' },
			json: async () => ({ success: true }),
		};
	});
	return mock;
};

describe('ProjectActivityAssignments', () => {
	let alertSpy;

	beforeEach(() => {
		alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
		vi.stubGlobal('fetch', buildFetch());
	});

	afterEach(() => {
		alertSpy.mockRestore();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('renders flat rows from preloaded data with project code and name columns', () => {
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{
					assignments: ASSIGNMENTS,
					emptyProjects: EMPTY_PROJECTS,
				}}
			/>
		);

		// Header columns present
		expect(screen.getByText('Project Number')).toBeInTheDocument();
		expect(screen.queryByText('Code')).not.toBeInTheDocument();
		// Project Name column is hidden
		expect(screen.queryByText('Project')).not.toBeInTheDocument();
		expect(screen.getByText('Discipline')).toBeInTheDocument();
		expect(screen.getByText('Activity')).toBeInTheDocument();
		expect(screen.getByText('Sub Activity')).toBeInTheDocument();
		expect(screen.getByText('Default MH')).toBeInTheDocument();
		expect(screen.getByText('Manhours')).toBeInTheDocument();
		expect(screen.getByText('Date Completed')).toBeInTheDocument();
		expect(screen.getByText('Status')).toBeInTheDocument();

		// Each activity appears as a flat row with project code + name
		expect(screen.getByText('Foundation Work')).toBeInTheDocument();
		expect(screen.getByText('Steel Erection')).toBeInTheDocument();
		expect(screen.getByText('HVAC Install')).toBeInTheDocument();

		// Project codes (rendered multiple times across rows)
		expect(screen.getAllByText('P-001').length).toBe(2);
		expect(screen.getAllByText('P-002').length).toBe(1);

		// Project Name column is hidden — names should not appear as table cells
		expect(screen.queryByText('Alpha Plant')).not.toBeInTheDocument();
		expect(screen.queryByText('Beta Tower')).not.toBeInTheDocument();
	});

	it('shows Total Manhours as the sum of planned_hours across all rows', () => {
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{ assignments: ASSIGNMENTS, emptyProjects: [] }}
			/>
		);

		// 8 + 5 + 16 = 29
		expect(screen.getByText('29')).toBeInTheDocument();
	});

	it('shows the empty-state message when no projects are assigned', () => {
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{ assignments: [], emptyProjects: [] }}
			/>
		);

		expect(screen.getByText('No projects assigned to you')).toBeInTheDocument();
		// No Add button when there are zero projects
		expect(screen.queryByTitle('Add a new activity')).not.toBeInTheDocument();
	});

	it('shows the "No activities yet" row when only empty projects exist', () => {
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{ assignments: [], emptyProjects: EMPTY_PROJECTS }}
			/>
		);

		// Table is rendered (with the Add button), but there is at least one project
		expect(screen.getByTitle('Add a new activity')).toBeInTheDocument();
		expect(screen.getByText(/No activities yet\. Click/i)).toBeInTheDocument();
	});

	it('renders nothing when API returns 401/403 (no access)', async () => {
		const noAccessFetch = vi.fn().mockResolvedValue({
			status: 403,
			ok: false,
			headers: { get: () => 'application/json' },
			json: async () => ({ success: false }),
		});
		vi.unstubAllGlobals();
		vi.stubGlobal('fetch', noAccessFetch);

		const { container } = render(<ProjectActivityAssignments userId={42} />);

		await waitFor(() => {
			expect(container).toBeEmptyDOMElement();
		});
	});

	it('fetches assignments and activity options when no preloaded data is given', async () => {
		render(<ProjectActivityAssignments userId={42} />);

		await waitFor(() => {
			expect(screen.getByText('Foundation Work')).toBeInTheDocument();
		});

		// Two GET endpoints hit (assignments + options); no PATCH yet
		const fetchMock = globalThis.fetch;
		const calledUrls = fetchMock.mock.calls.map(([u]) => u);
		expect(
			calledUrls.some(
				(u) =>
					typeof u === 'string' &&
					u.includes('/api/users/42/activity-assignments')
			)
		).toBe(true);
		expect(
			calledUrls.some(
				(u) => typeof u === 'string' && u === '/api/activity-master/options'
			)
		).toBe(true);
		expect(
			fetchMock.mock.calls.every(
				([, options]) => (options?.method || 'GET').toUpperCase() !== 'PATCH'
			)
		).toBe(true);
	});

	it('opens the inline add row when Add is clicked and populates the project picker', async () => {
		const user = userEvent.setup();
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{
					assignments: ASSIGNMENTS,
					emptyProjects: EMPTY_PROJECTS,
				}}
			/>
		);

		await user.click(screen.getByTitle('Add a new activity'));

		const projectSelect = screen.getByTitle(
			'Select a project you are assigned to'
		);
		expect(projectSelect).toBeInTheDocument();

		// assignableProjects = assignments ∪ emptyProjects (deduped by project_id).
		// P-001 (twice in assignments) and P-002 + P-003 from empty projects → 3 unique options.
		const options = within(projectSelect).getAllByRole('option');
		expect(options).toHaveLength(4); // 1 placeholder + 3 projects
		expect(options[1].textContent).toContain('P-001');
		expect(options[2].textContent).toContain('P-002');
		expect(options[3].textContent).toContain('P-003');
	});

	it('cancels the inline add row without making a PATCH request', async () => {
		const user = userEvent.setup();
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{ assignments: ASSIGNMENTS, emptyProjects: [] }}
			/>
		);

		await user.click(screen.getByTitle('Add a new activity'));
		expect(
			screen.getByTitle('Select a project you are assigned to')
		).toBeInTheDocument();

		await user.click(screen.getByTitle('Cancel'));

		expect(
			screen.queryByTitle('Select a project you are assigned to')
		).not.toBeInTheDocument();

		const fetchMock = globalThis.fetch;
		expect(
			fetchMock.mock.calls.every(
				([, options]) => (options?.method || 'GET').toUpperCase() !== 'PATCH'
			)
		).toBe(true);
	});

	it('alerts and skips the PATCH when no project is selected', async () => {
		const user = userEvent.setup();
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{ assignments: ASSIGNMENTS, emptyProjects: [] }}
			/>
		);

		await user.click(screen.getByTitle('Add a new activity'));
		// Select discipline + activity so the only missing piece is the project
		const disciplineSelect = screen.getAllByRole('combobox')[1];
		await user.selectOptions(disciplineSelect, 'd1');
		const activitySelect = screen.getAllByRole('combobox')[2];
		await user.selectOptions(activitySelect, 'a1');

		await user.click(screen.getByTitle('Save'));

		expect(alertSpy).toHaveBeenCalledWith('Please select a project.');
		const fetchMock = globalThis.fetch;
		expect(
			fetchMock.mock.calls.every(
				([, options]) => (options?.method || 'GET').toUpperCase() !== 'PATCH'
			)
		).toBe(true);
	});

	it('alerts and skips the PATCH when discipline/activity are missing', async () => {
		const user = userEvent.setup();
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{ assignments: ASSIGNMENTS, emptyProjects: [] }}
			/>
		);

		await user.click(screen.getByTitle('Add a new activity'));
		const projectSelect = screen.getByTitle(
			'Select a project you are assigned to'
		);
		await user.selectOptions(projectSelect, '1');

		await user.click(screen.getByTitle('Save'));

		expect(alertSpy).toHaveBeenCalledWith(
			'Please select a Discipline and Activity.'
		);
	});

	it('cascades activity and sub-activity dropdowns and fills default manhours', async () => {
		const user = userEvent.setup();
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{ assignments: ASSIGNMENTS, emptyProjects: [] }}
			/>
		);

		await user.click(screen.getByTitle('Add a new activity'));

		// Activity select is disabled until a discipline is picked
		const disciplineSelect = screen.getAllByRole('combobox')[1];
		const activitySelect = screen.getAllByRole('combobox')[2];
		const subActivitySelect = screen.getAllByRole('combobox')[3];

		expect(activitySelect).toBeDisabled();
		expect(subActivitySelect).toBeDisabled();

		await user.selectOptions(disciplineSelect, 'd1');
		expect(activitySelect).not.toBeDisabled();
		expect(within(activitySelect).getAllByRole('option')).toHaveLength(3); // 1 placeholder + 2 activities

		// Sub-activity disabled until an activity with sub-activities is chosen
		await user.selectOptions(activitySelect, 'a1');
		expect(subActivitySelect).not.toBeDisabled();
		expect(within(subActivitySelect).getAllByRole('option')).toHaveLength(3); // 1 placeholder + 2 subs

		// Default manhours read-only input reflects the selected sub-activity
		const defaultMhInput = screen.getByDisplayValue('–');
		expect(defaultMhInput).toBeInTheDocument();
		await user.selectOptions(subActivitySelect, 's1');
		expect(screen.getByDisplayValue('8')).toBeInTheDocument();

		// Picking a2 (no sub-activities) re-disables sub-activity
		await user.selectOptions(activitySelect, 'a2');
		expect(subActivitySelect).toBeDisabled();
	});

	it('sends a PATCH with the right payload and refreshes the table on success', async () => {
		const user = userEvent.setup();
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{ assignments: ASSIGNMENTS, emptyProjects: [] }}
			/>
		);

		await user.click(screen.getByTitle('Add a new activity'));

		const projectSelect = screen.getByTitle(
			'Select a project you are assigned to'
		);
		const disciplineSelect = screen.getAllByRole('combobox')[1];
		const activitySelect = screen.getAllByRole('combobox')[2];
		const subActivitySelect = screen.getAllByRole('combobox')[3];
		const manhoursInput = screen.getByPlaceholderText('Hrs');
		const dateInput = document.querySelector('input[type="date"]');

		await user.selectOptions(projectSelect, '1');
		await user.selectOptions(disciplineSelect, 'd1');
		await user.selectOptions(activitySelect, 'a1');
		await user.selectOptions(subActivitySelect, 's1');
		await user.clear(manhoursInput);
		await user.type(manhoursInput, '6');
		await user.clear(dateInput);
		await user.type(dateInput, '2026-03-15');

		await user.click(screen.getByTitle('Save'));

		await waitFor(() => {
			const fetchMock = globalThis.fetch;
			const patchCall = fetchMock.mock.calls.find(
				([, options]) => (options?.method || '').toUpperCase() === 'PATCH'
			);
			expect(patchCall).toBeDefined();
		});

		const fetchMock = globalThis.fetch;
		const [calledUrl, calledOptions] = fetchMock.mock.calls.find(
			([, options]) => (options?.method || '').toUpperCase() === 'PATCH'
		);
		expect(calledUrl).toBe('/api/users/42/activity-assignments');
		const body = JSON.parse(calledOptions.body);
		expect(body).toEqual({
			project_id: '1',
			discipline_name: 'Mechanical',
			activity_name: 'Fabrication',
			sub_activity_name: 'Welding',
			default_manhours: 8,
			manhours_assigned: '6',
			due_date: '2026-03-15',
		});

		// After success, the inline add row is closed
		await waitFor(() => {
			expect(
				screen.queryByTitle('Select a project you are assigned to')
			).not.toBeInTheDocument();
		});

		// And the GET is re-issued for refresh (it was already called once on mount
		// via preloadedData path? — actually preloadedData short-circuits, so the
		// first GET is the post-save refetch)
		await waitFor(() => {
			const getCalls = fetchMock.mock.calls.filter(
				([, options]) => (options?.method || 'GET').toUpperCase() === 'GET'
			);
			expect(
				getCalls.some(
					([u]) =>
						typeof u === 'string' &&
						u.includes('/api/users/42/activity-assignments')
				)
			).toBe(true);
		});
	});

	it('alerts when the PATCH returns a non-ok response (fetchJSON throws)', async () => {
		const failingFetch = vi.fn(async (url, options) => {
			if (typeof url === 'string' && url.includes('/activity-assignments')) {
				const method = (options?.method || 'GET').toUpperCase();
				if (method === 'PATCH') {
					return {
						ok: false,
						status: 400,
						headers: { get: () => 'application/json' },
						json: async () => ({
							success: false,
							error: 'Bad request from server',
						}),
					};
				}
				return {
					ok: true,
					headers: { get: () => 'application/json' },
					json: async () => ({
						success: true,
						data: { assignments: ASSIGNMENTS, emptyProjects: [], stats: {} },
					}),
				};
			}
			return {
				ok: true,
				headers: { get: () => 'application/json' },
				json: async () => ({ success: true, data: DISCIPLINE_OPTIONS }),
			};
		});
		vi.unstubAllGlobals();
		vi.stubGlobal('fetch', failingFetch);

		const user = userEvent.setup();
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{ assignments: ASSIGNMENTS, emptyProjects: [] }}
			/>
		);

		await user.click(screen.getByTitle('Add a new activity'));
		await user.selectOptions(
			screen.getByTitle('Select a project you are assigned to'),
			'1'
		);
		await user.selectOptions(screen.getAllByRole('combobox')[1], 'd1');
		await user.selectOptions(screen.getAllByRole('combobox')[2], 'a1');
		await user.click(screen.getByTitle('Save'));

		await waitFor(() => {
			expect(alertSpy).toHaveBeenCalledWith('Failed to add activity');
		});
	});

	it('keeps the inline add row open when the PATCH throws (catch branch)', async () => {
		const throwingFetch = vi.fn(async (url, options) => {
			if (typeof url === 'string' && url.includes('/activity-assignments')) {
				const method = (options?.method || 'GET').toUpperCase();
				if (method === 'PATCH') {
					throw new Error('Network down');
				}
				return {
					ok: true,
					headers: { get: () => 'application/json' },
					json: async () => ({
						success: true,
						data: { assignments: ASSIGNMENTS, emptyProjects: [], stats: {} },
					}),
				};
			}
			return {
				ok: true,
				headers: { get: () => 'application/json' },
				json: async () => ({ success: true, data: DISCIPLINE_OPTIONS }),
			};
		});
		vi.unstubAllGlobals();
		vi.stubGlobal('fetch', throwingFetch);

		const user = userEvent.setup();
		render(
			<ProjectActivityAssignments
				userId={42}
				preloadedData={{ assignments: ASSIGNMENTS, emptyProjects: [] }}
			/>
		);

		await user.click(screen.getByTitle('Add a new activity'));
		await user.selectOptions(
			screen.getByTitle('Select a project you are assigned to'),
			'1'
		);
		await user.selectOptions(screen.getAllByRole('combobox')[1], 'd1');
		await user.selectOptions(screen.getAllByRole('combobox')[2], 'a1');
		await user.click(screen.getByTitle('Save'));

		await waitFor(() => {
			expect(alertSpy).toHaveBeenCalledWith('Failed to add activity');
		});
		// Row is still open (Save failed, didn't close)
		expect(
			screen.getByTitle('Select a project you are assigned to')
		).toBeInTheDocument();
	});
});
