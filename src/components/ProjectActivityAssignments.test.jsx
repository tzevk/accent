import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast, Toaster } from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const { apiGet, apiPost, apiPut, apiDelete } = vi.hoisted(() => ({
	apiGet: vi.fn(),
	apiPost: vi.fn(),
	apiPut: vi.fn(),
	apiDelete: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({ apiGet, apiPost, apiPut, apiDelete }));
vi.mock('next/link', () => ({
	default: ({ href, children, ...props }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

import ProjectActivityAssignments from '@/components/ProjectActivityAssignments';
import { WorkPeriodFields } from '@/components/WorkPeriodFields';

const FIXED_NOW = new Date('2026-12-02T12:00:00Z');
const TODAY = '2026-12-02';
const PREVIOUS_WEEK = '2026-11-23';
const CURRENT_WEEK = '2026-11-30';
const WEEK_END = '2026-12-06';

const DISCIPLINE_OPTIONS = [
	{
		id: 'd1',
		function_name: 'Mechanical',
		activities: [
			{
				id: 'a1',
				activity_name: 'Fabrication',
				subActivities: [{ id: 's1', name: 'Welding', default_manhours: 8 }],
			},
			{ id: 'a2', activity_name: 'Assembly', subActivities: [] },
		],
	},
];

const PRELOADED_DATA = {
	assignments: [
		{
			project_id: 1,
			id: 'assignment-1',
			project_name: 'Alpha Plant',
			project_code: 'P-001',
			activity_id: 'act-1',
			activity_name: 'Foundation Work',
			discipline: 'Civil',
			default_manhours: 12,
			planned_hours: 8,
			actual_hours: 4,
			status: 'In Progress',
			remarks: 'Assignment remark',
			daily_entries: [
				{
					date: '2026-12-01',
					hours: 2.5,
					qty_done: 4,
					remarks: 'Recorded duration',
				},
			],
		},
	],
	emptyProjects: [
		{ project_id: 3, project_name: 'Gamma Bridge', project_code: 'P-003' },
	],
	accessibleProjects: [],
	documentCounts: { 1: 2 },
};

const OVERNIGHT_PERIOD = {
	id: 'wp-overnight',
	assignmentId: 'assignment-1',
	projectId: 1,
	activityId: 'act-1',
	employeeId: 7,
	userId: 42,
	projectCode: 'P-001',
	projectName: 'Alpha Plant',
	discipline: 'Civil',
	activityName: 'Foundation Work',
	subActivityName: 'Excavation',
	employeeName: 'Test Employee',
	start: '2026-11-30T22:00',
	end: '2026-12-01T02:00',
	quantity: 3,
	dateCompleted: '2026-12-01',
	remarks: 'Overnight work',
	durationSeconds: 14400,
	weekSeconds: 14400,
	weekQuantity: 3,
	editable: false,
};

const BOUNDARY_PERIOD = {
	...OVERNIGHT_PERIOD,
	id: 'wp-boundary',
	assignmentId: 'assignment-2',
	projectId: 2,
	projectCode: 'P-002',
	projectName: 'Beta Tower',
	activityId: 'act-2',
	activityName: 'Steel Erection',
	subActivityName: '',
	start: '2026-11-29T22:00',
	end: '2026-11-30T02:00',
	quantity: 8,
	dateCompleted: '2026-11-30',
	remarks: 'Sunday to Monday',
	durationSeconds: 14400,
	weekSeconds: 7200,
	weekQuantity: 8,
	editable: false,
};

const EDITABLE_PERIOD = {
	...OVERNIGHT_PERIOD,
	id: 'wp-editable',
	start: '2026-12-01T22:00',
	end: `${TODAY}T02:00`,
	quantity: 1.5,
	dateCompleted: TODAY,
	remarks: 'Today’s work',
	durationSeconds: 14400,
	weekSeconds: 14400,
	weekQuantity: 1.5,
	editable: true,
};

function periodPayload(
	week = CURRENT_WEEK,
	periods = [OVERNIGHT_PERIOD, BOUNDARY_PERIOD]
) {
	return {
		success: true,
		data: {
			canLog: true,
			today: TODAY,
			weekStart: week,
			periods,
		},
	};
}

function renderAssignments({ preloadedData = PRELOADED_DATA, ...props } = {}) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
			mutations: { retry: false },
		},
	});
	return render(
		<QueryClientProvider client={client}>
			<TooltipProvider>
				<ProjectActivityAssignments
					userId={42}
					preloadedData={preloadedData}
					{...props}
				/>
			</TooltipProvider>
		</QueryClientProvider>
	);
}

async function openAddForm() {
	const user = userEvent.setup();
	await user.click(await screen.findByRole('button', { name: 'Add' }));
	const table = await screen.findByRole('table', {
		name: 'Project activity table',
	});
	const editor = screen.getByRole('form', { name: 'Work Period editor' });
	expect(editor).toContainElement(table);
	const addRow = within(table).getByLabelText('Project').closest('tr');
	expect(addRow).not.toBeNull();
	for (const label of [
		'Project',
		'Discipline',
		'Activity',
		'Sub Activity',
		'Activity Description',
		'Quantity',
		'Date Completed',
		'Save Work Period',
	]) {
		expect(within(addRow).getByLabelText(label)).toBeVisible();
	}
	for (const name of ['Start Period Pick time', 'End Period Pick time']) {
		expect(within(addRow).getByRole('button', { name })).toBeVisible();
	}
	await waitFor(() =>
		expect(screen.getByLabelText('Discipline')).not.toBeDisabled()
	);
	return user;
}

async function chooseAssembly(user) {
	await user.selectOptions(screen.getByLabelText('Project'), '1');
	await user.selectOptions(screen.getByLabelText('Discipline'), 'd1');
	await user.selectOptions(screen.getByLabelText('Activity'), 'a2');
}

function activityTable() {
	return screen.getByRole('table', { name: 'Project activity table' });
}

async function expectTotals(manhours, quantity) {
	const label = await screen.findByText('Total Manhours');
	const cells = within(label.closest('tr')).getAllByRole('cell');
	await waitFor(() => {
		expect(cells[1].textContent.trim()).toBe(manhours);
		expect(cells[2].textContent.trim()).toBe(quantity);
	});
}

async function rowContaining(text) {
	const table = await screen.findByRole('table', {
		name: 'Project activity table',
	});
	const row = (await within(table).findByText(text)).closest('tr');
	expect(row).not.toBeNull();
	return row;
}

function periodButton(label, root = screen) {
	return root.getByRole('button', { name: new RegExp(`^${label} `) });
}

async function setEndpoint(user, label, hour, minute, meridiem) {
	await user.click(periodButton(label));
	const picker = within(screen.getByRole('dialog', { name: label }));
	for (const [name, option] of [
		['Hour', hour],
		['Minute', minute],
		['AM/PM', meridiem],
	]) {
		await user.click(
			within(picker.getByRole('group', { name })).getByRole('radio', {
				name: option,
			})
		);
	}
	await user.click(picker.getByRole('button', { name: 'OK' }));
}

describe('ProjectActivityAssignments Work Periods', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(FIXED_NOW);
		apiGet.mockReset();
		apiPost.mockReset();
		apiPut.mockReset();
		apiDelete.mockReset();
		apiGet.mockImplementation(async (url, params) => {
			if (url === '/api/work-periods') {
				if (params?.week === PREVIOUS_WEEK) {
					return periodPayload(PREVIOUS_WEEK, [
						{
							...BOUNDARY_PERIOD,
							weekSeconds: 7200,
							weekQuantity: 0,
						},
					]);
				}
				return periodPayload(params?.week || CURRENT_WEEK);
			}
			if (url === '/api/activity-master/options') {
				return { success: true, data: DISCIPLINE_OPTIONS };
			}
			if (url === '/api/users/42/activity-assignments') {
				return { success: true, data: PRELOADED_DATA };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		apiPost.mockResolvedValue({
			success: true,
			data: { id: 'wp-new' },
			affected_rows: 1,
		});
		apiPut.mockResolvedValue({
			success: true,
			data: { id: EDITABLE_PERIOD.id },
			affected_rows: 1,
		});
		apiDelete.mockResolvedValue({
			success: true,
			data: { id: EDITABLE_PERIOD.id },
			affected_rows: 1,
		});
	});

	afterEach(() => {
		toast.remove();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it.each([401, 403])(
		'renders nothing when the API denies access with %s',
		async (status) => {
			apiGet.mockRejectedValue(new Error(`Request failed (${status})`));

			const { container } = renderAssignments({ preloadedData: null });

			await waitFor(() => {
				expect(container).toBeEmptyDOMElement();
			});
		}
	);

	it('opens on the IST Monday in one dense table with derived Manhours', async () => {
		renderAssignments();

		expect(await screen.findByText('30 Nov – 6 Dec 2026')).toBeInTheDocument();
		expect(apiGet).toHaveBeenCalledWith('/api/work-periods', {
			week: CURRENT_WEEK,
			userId: 42,
		});
		await expectTotals('8.5', '15');

		const table = activityTable();
		expect(
			within(table)
				.getAllByRole('columnheader')
				.map((heading) => heading.textContent.trim())
		).toEqual([
			'Project Number',
			'Discipline',
			'Activity',
			'Sub Activity',
			'Activity Description',
			'Default MH',
			'Start Period',
			'End Period',
			'Manhours',
			'Quantity',
			'Date Completed',
			'Status',
			'Actions',
		]);
		expect(screen.getByLabelText('From')).toHaveValue(CURRENT_WEEK);
		expect(screen.getByLabelText('To')).toHaveValue(WEEK_END);
		expect(
			screen.getByRole('textbox', { name: 'Search activities' })
		).toBeInTheDocument();
		expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();

		const overnightRow = await rowContaining('Overnight work');
		const overnightCells = within(overnightRow).getAllByRole('cell');
		expect(overnightCells).toHaveLength(13);
		expect(overnightCells[4]).toHaveTextContent('Overnight work');
		expect(overnightCells[6]).toHaveTextContent('Previous day');
		expect(overnightCells[6]).toHaveTextContent('10:00 PM');
		expect(overnightCells[7]).toHaveTextContent('02:00 AM');
		expect(overnightCells[8].textContent.trim()).toBe('4');
		expect(overnightCells[9]).toHaveTextContent('3');
		expect(overnightCells[10]).toHaveTextContent('01 Dec 2026');

		const boundaryRow = await rowContaining('Sunday to Monday');
		const boundaryCells = within(boundaryRow).getAllByRole('cell');
		expect(boundaryCells[8].textContent).toContain('4');
		expect(boundaryCells[8]).toHaveTextContent('Week: 2');
		expect(boundaryCells[9].textContent.trim()).toBe('8');

		const legacyRow = await rowContaining('Recorded duration');
		const legacyCells = within(legacyRow).getAllByRole('cell');
		expect(legacyCells[5]).toHaveTextContent('12');
		expect(legacyCells[8].textContent.trim()).toBe('2.5');
		expect(legacyCells[9]).toHaveTextContent('4');
		expect(screen.queryByPlaceholderText('Hrs')).not.toBeInTheDocument();
		expect(screen.queryByLabelText('Manhours')).not.toBeInTheDocument();
	});

	it('explains sortable and plain columns without changing how sorting works', async () => {
		const user = userEvent.setup();
		renderAssignments();
		const table = await screen.findByRole('table', {
			name: 'Project activity table',
		});
		const start = within(table).getByText('Start Period');
		await user.hover(start);
		expect(await screen.findByRole('tooltip')).toHaveTextContent(
			'When you started work, in Indian Standard Time (IST).'
		);
		await user.unhover(start);
		await waitFor(() =>
			expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
		);
		const header = within(table).getByRole('columnheader', {
			name: 'Manhours',
		});
		const sortButton = within(header).getByRole('button', { name: 'Manhours' });
		const previousHeader = within(table).getByRole('columnheader', {
			name: 'End Period',
		});
		within(previousHeader).getByText('End Period').focus();
		await user.tab();
		expect(sortButton).toHaveFocus();
		expect(await screen.findByRole('tooltip')).toHaveTextContent(
			'Hours worked, calculated from the start and end times for new entries.'
		);
		await user.keyboard('{Escape}');
		await waitFor(() =>
			expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
		);
		await user.keyboard('{Enter}');
		expect(header).toHaveAttribute('aria-sort', 'ascending');
	});

	it('shows a boundary period in both weeks with only each clipped share', async () => {
		const user = userEvent.setup();
		renderAssignments();

		await screen.findByText('Steel Erection');
		await user.click(screen.getByRole('button', { name: 'Previous week' }));

		expect(await screen.findByText('23 Nov – 29 Nov 2026')).toBeInTheDocument();
		expect(apiGet).toHaveBeenCalledWith('/api/work-periods', {
			week: PREVIOUS_WEEK,
			userId: 42,
		});
		expect(screen.getByLabelText('From')).toHaveValue(PREVIOUS_WEEK);
		await expectTotals('2', '0');
		const boundary = await rowContaining('Sunday to Monday');
		expect(within(boundary).getByText('Week: 0')).toBeInTheDocument();
		const placeholder = await rowContaining('Foundation Work');
		expect(
			within(placeholder).getByRole('button', {
				name: 'No Work Period recorded for Foundation Work',
			})
		).toBeDisabled();

		await user.click(screen.getByRole('button', { name: 'Next week' }));
		expect(await screen.findByText('30 Nov – 6 Dec 2026')).toBeInTheDocument();
		await expectTotals('8.5', '15');
	});

	it('preserves Project document links and searches Work Periods and history', async () => {
		const user = userEvent.setup();
		renderAssignments();

		const alphaLinks = await screen.findAllByRole('link', {
			name: 'Open documents for Alpha Plant',
		});
		expect(alphaLinks.length).toBeGreaterThan(0);
		for (const link of alphaLinks) {
			expect(link).toHaveAttribute('href', '/projects/1?tab=upload_documents');
		}
		expect(
			await screen.findByRole('link', { name: 'Open documents for Beta Tower' })
		).toHaveAttribute('href', '/projects/2?tab=upload_documents');

		await user.type(
			screen.getByRole('textbox', { name: 'Search activities' }),
			'Beta'
		);
		expect(screen.getByText('Steel Erection')).toBeInTheDocument();
		expect(screen.queryByText('Foundation Work')).not.toBeInTheDocument();
		expect(screen.queryByText('Recorded duration')).not.toBeInTheDocument();
	});

	it('keeps project discovery and explains a missing Employee link when no period exists', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods') {
				return {
					success: true,
					data: {
						canLog: false,
						today: TODAY,
						weekStart: CURRENT_WEEK,
						periods: [],
					},
				};
			}
			if (url === '/api/activity-master/options') {
				return { success: true, data: DISCIPLINE_OPTIONS };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		renderAssignments({
			preloadedData: {
				assignments: [],
				emptyProjects: PRELOADED_DATA.emptyProjects,
				accessibleProjects: [],
				documentCounts: {},
			},
		});
		expect(await screen.findByText(/No activities yet/)).toBeInTheDocument();
		expect(
			screen.getByText(
				/Ask your manager or support to link your User Account to an Employee/
			)
		).toBeInTheDocument();
		expect(screen.getByText('Assigned projects')).toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'Open documents for Gamma Bridge' })
		).toHaveAttribute('href', '/projects/3?tab=upload_documents');
		expect(
			screen.queryByRole('button', { name: 'Add' })
		).not.toBeInTheDocument();
	});

	it('renders raw legacy daily entries read-only in the same activity table', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods') return periodPayload(CURRENT_WEEK, []);
			if (url === '/api/activity-master/options') {
				return { success: true, data: DISCIPLINE_OPTIONS };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		renderAssignments({
			preloadedData: {
				...PRELOADED_DATA,
				assignments: [
					{
						...PRELOADED_DATA.assignments[0],
						daily_entries: [{ date: '2026-12-01', hours: 99, qty_done: 99 }],
						legacy_daily_entries: PRELOADED_DATA.assignments[0].daily_entries,
					},
				],
			},
		});

		const table = await screen.findByRole('table', {
			name: 'Project activity table',
		});
		const legacyRow = within(table)
			.getByText('Recorded duration')
			.closest('tr');
		const cells = within(legacyRow).getAllByRole('cell');
		expect(cells[6].textContent).toBe('');
		expect(cells[7].textContent).toBe('');
		expect(cells[8].textContent.trim()).toBe('2.5');
		expect(cells[9]).toHaveTextContent('4');
		expect(within(legacyRow).queryByText('99')).not.toBeInTheDocument();
		expect(
			screen.getByText(/Older entries may have no recorded times/)
		).toBeInTheDocument();
		expect(screen.getByLabelText('From')).toHaveValue(CURRENT_WEEK);
		expect(screen.getByLabelText('To')).toHaveValue(WEEK_END);
		expect(
			within(legacyRow).getByRole('button', {
				name: 'Historical duration-only log for Foundation Work',
			})
		).toBeDisabled();
		expect(
			screen.queryByRole('table', { name: 'Historical duration-only logs' })
		).not.toBeInTheDocument();

		const user = userEvent.setup();
		await user.selectOptions(
			screen.getByLabelText('Filter by status'),
			'In Progress'
		);
		expect(within(table).getByText('Foundation Work')).toBeInTheDocument();
	});

	it('falls back to daily_entries only when the legacy projection is absent', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods') return periodPayload(CURRENT_WEEK, []);
			if (url === '/api/activity-master/options') {
				return { success: true, data: DISCIPLINE_OPTIONS };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		renderAssignments();

		const row = await rowContaining('Recorded duration');
		expect(within(row).getByText('2.5')).toBeInTheDocument();
	});

	it('keeps empty assignments as read-only placeholders only for the full week', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods') return periodPayload(CURRENT_WEEK, []);
			if (url === '/api/activity-master/options') {
				return { success: true, data: DISCIPLINE_OPTIONS };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		renderAssignments({
			preloadedData: {
				...PRELOADED_DATA,
				assignments: [
					{
						...PRELOADED_DATA.assignments[0],
						daily_entries: [],
						legacy_daily_entries: [],
						qty_completed: 0,
					},
				],
			},
		});

		const row = await rowContaining('Foundation Work');
		const cells = within(row).getAllByRole('cell');
		expect(cells[4]).toHaveTextContent('Assignment remark');
		expect(cells[5].textContent.trim()).toBe('12');
		expect(cells[6].textContent).toBe('');
		expect(cells[7].textContent).toBe('');
		expect(cells[8].textContent).toBe('');
		expect(cells[9].textContent).toBe('');
		expect(cells[10].textContent).toBe('');
		expect(cells[11]).toHaveTextContent('In Progress');
		expect(
			within(row).getByRole('link', { name: 'Open documents for Alpha Plant' })
		).toHaveAttribute('href', '/projects/1?tab=upload_documents');
		expect(
			within(row).getByRole('button', {
				name: 'No Work Period recorded for Foundation Work',
			})
		).toBeDisabled();
		await expectTotals('0', '0');

		fireEvent.change(screen.getByLabelText('From'), {
			target: { value: TODAY },
		});
		fireEvent.change(screen.getByLabelText('To'), {
			target: { value: TODAY },
		});
		expect(screen.queryByText('Foundation Work')).not.toBeInTheDocument();
	});

	it('keeps unlogged assignments visible beside a legacy log on the same project without catalog IDs', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods') return periodPayload(CURRENT_WEEK, []);
			throw new Error(`Unexpected request: ${url}`);
		});
		const assignment = {
			...PRELOADED_DATA.assignments[0],
			activity_id: null,
		};
		renderAssignments({
			preloadedData: {
				...PRELOADED_DATA,
				assignments: [
					assignment,
					{
						...assignment,
						id: 'pending-a',
						activity_name: 'Pending inspection',
						daily_entries: [],
					},
					{
						...assignment,
						id: 'pending-b',
						activity_name: 'Pending drawing',
						daily_entries: [],
					},
				],
			},
		});

		const table = activityTable();
		for (const label of [
			'Recorded duration',
			'Pending inspection',
			'Pending drawing',
		]) {
			expect(await within(table).findByText(label)).toBeVisible();
		}
		await userEvent.click(
			within(table).getByRole('button', { name: 'Activity' })
		);
		for (const label of [
			'Recorded duration',
			'Pending inspection',
			'Pending drawing',
		]) {
			expect(within(table).getAllByText(label)).toHaveLength(1);
		}
	});

	it('defaults From and To to the selected IST week and filters adjacent dates', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods') return periodPayload(CURRENT_WEEK, []);
			if (url === '/api/activity-master/options') {
				return { success: true, data: DISCIPLINE_OPTIONS };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		renderAssignments({
			preloadedData: {
				...PRELOADED_DATA,
				assignments: [
					PRELOADED_DATA.assignments[0],
					{
						...PRELOADED_DATA.assignments[0],
						id: 'assignment-adjacent',
						activity_id: 'act-adjacent',
						activity_name: 'Adjacent Activity',
						daily_entries: [
							{ date: TODAY, hours: 1, qty_done: 1, remarks: 'Adjacent date' },
						],
					},
				],
			},
		});

		expect(screen.getByLabelText('From')).toHaveValue(CURRENT_WEEK);
		expect(screen.getByLabelText('To')).toHaveValue(WEEK_END);
		expect(await screen.findByText('Foundation Work')).toBeInTheDocument();
		expect(screen.getByText('Adjacent Activity')).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText('From'), {
			target: { value: TODAY },
		});
		fireEvent.change(screen.getByLabelText('To'), {
			target: { value: TODAY },
		});
		expect(await screen.findByText('Adjacent Activity')).toBeInTheDocument();
		expect(screen.queryByText('Foundation Work')).not.toBeInTheDocument();
	});
	it('requires a real sub-activity only when the selected Activity has children', async () => {
		renderAssignments();
		const user = await openAddForm();
		await user.selectOptions(screen.getByLabelText('Project'), '1');
		await user.selectOptions(screen.getByLabelText('Discipline'), 'd1');
		await user.selectOptions(screen.getByLabelText('Activity'), 'a1');
		expect(screen.getByLabelText('Sub Activity')).toBeRequired();
		expect(
			within(screen.getByLabelText('Sub Activity')).queryByRole('option', {
				name: 'No sub-activity',
			})
		).not.toBeInTheDocument();
		await user.selectOptions(screen.getByLabelText('Sub Activity'), 's1');
		expect(screen.getByLabelText('Default MH')).toHaveValue('8');

		await user.selectOptions(screen.getByLabelText('Activity'), 'a2');
		expect(screen.getByDisplayValue('No sub-activity')).toBeInTheDocument();
	});

	it('posts a self-service overnight Work Period and emits save evidence', async () => {
		const onSaved = vi.fn();
		window.addEventListener('activity-log-saved', onSaved);
		renderAssignments();
		const user = await openAddForm();
		await chooseAssembly(user);
		await setEndpoint(user, 'Start Period', '10', '00', 'PM');
		await setEndpoint(user, 'End Period', '12', '00', 'AM');
		expect(screen.getByLabelText('Date Completed')).toHaveValue(TODAY);
		fireEvent.change(screen.getByLabelText('Quantity'), {
			target: { value: '2.5' },
		});
		fireEvent.change(screen.getByLabelText('Activity Description'), {
			target: { value: 'Completed assembly' },
		});

		await user.click(screen.getByRole('button', { name: 'Save Work Period' }));

		await waitFor(() => {
			expect(apiPost).toHaveBeenCalledWith('/api/work-periods', {
				projectId: '1',
				disciplineId: 'd1',
				activityId: 'a2',
				subActivityId: null,
				start: '2026-12-01T22:00',
				end: `${TODAY}T00:00`,
				quantity: 2.5,
				dateCompleted: TODAY,
				remarks: 'Completed assembly',
			});
		});
		await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
		expect(onSaved.mock.calls[0][0].detail).toMatchObject({ userId: 42 });
		expect(
			screen.queryByRole('button', { name: 'Save Work Period' })
		).not.toBeInTheDocument();
		window.removeEventListener('activity-log-saved', onSaved);
	});

	it('rejects equal clocks for a new Work Period without calling the API', async () => {
		renderAssignments();
		const user = await openAddForm();
		await chooseAssembly(user);
		await setEndpoint(user, 'Start Period', '09', '00', 'AM');
		await setEndpoint(user, 'End Period', '09', '00', 'AM');

		await user.click(screen.getByRole('button', { name: 'Save Work Period' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'End must be after Start.'
		);
		expect(apiPost).not.toHaveBeenCalled();
	});

	it('asks for a description after a save attempt and keeps the entered times', async () => {
		renderAssignments();
		const user = await openAddForm();
		await chooseAssembly(user);
		await setEndpoint(user, 'Start Period', '09', '00', 'AM');
		await setEndpoint(user, 'End Period', '12', '30', 'PM');
		const description = screen.getByRole('textbox', {
			name: 'Activity Description',
		});
		expect(description).toBeRequired();
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		fireEvent.change(description, { target: { value: '   ' } });
		await user.click(screen.getByRole('button', { name: 'Save Work Period' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Enter an Activity Description.'
		);
		expect(description).toHaveFocus();
		expect(description).toHaveAccessibleDescription(
			'Enter an Activity Description.'
		);
		expect(apiPost).not.toHaveBeenCalled();

		fireEvent.change(description, {
			target: { value: 'Reviewed the drawing.' },
		});
		await user.click(screen.getByRole('button', { name: 'Save Work Period' }));
		await waitFor(() =>
			expect(apiPost).toHaveBeenCalledWith(
				'/api/work-periods',
				expect.objectContaining({
					start: `${TODAY}T09:00`,
					end: `${TODAY}T12:30`,
					remarks: expect.stringContaining('Reviewed the drawing.'),
				})
			)
		);
	});

	it.each([
		'This Work Period overlaps another Work Period. Adjust the Start or End.',
		'The end time is later than now (IST). Check the date and time, or save after the work ends.',
	])('shows “%s” in a toast and keeps the rejected draft', async (message) => {
		apiPost.mockRejectedValue(new Error(message));
		vi.stubGlobal('matchMedia', () => ({ matches: false }));
		const { container: notifications } = render(<Toaster />);
		const onSaved = vi.fn();
		window.addEventListener('activity-log-saved', onSaved);
		renderAssignments();
		const user = await openAddForm();
		await chooseAssembly(user);
		await setEndpoint(user, 'Start Period', '10', '00', 'PM');
		await setEndpoint(user, 'End Period', '01', '00', 'AM');
		fireEvent.change(screen.getByLabelText('Quantity'), {
			target: { value: '4' },
		});
		fireEvent.change(screen.getByLabelText('Activity Description'), {
			target: { value: 'Keep this remark' },
		});

		await user.click(screen.getByRole('button', { name: 'Save Work Period' }));

		expect(await within(notifications).findByRole('alert')).toHaveTextContent(
			message
		);
		expect(screen.getAllByRole('alert')).toHaveLength(1);
		expect(screen.getByLabelText('Project')).toHaveValue('1');
		expect(screen.getByLabelText('Discipline')).toHaveValue('d1');
		expect(screen.getByLabelText('Activity')).toHaveValue('a2');
		expect(screen.getByLabelText('Sub Activity')).toHaveValue('');
		expect(periodButton('Start Period')).toHaveTextContent('10:00 PM');
		expect(periodButton('End Period')).toHaveTextContent('01:00 AM');
		expect(screen.getByLabelText('Date Completed')).toHaveValue(TODAY);
		expect(screen.getByLabelText('Quantity')).toHaveValue(4);
		expect(screen.getByLabelText('Activity Description')).toHaveValue(
			'Keep this remark'
		);
		expect(onSaved).not.toHaveBeenCalled();
		window.removeEventListener('activity-log-saved', onSaved);
	});

	it('edits one eligible overnight row in place without moving its saved dates', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods')
				return periodPayload(CURRENT_WEEK, [EDITABLE_PERIOD]);
			if (url === '/api/activity-master/options') {
				return { success: true, data: DISCIPLINE_OPTIONS };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		const onSaved = vi.fn();
		window.addEventListener('activity-log-saved', onSaved);
		const user = userEvent.setup();
		renderAssignments();

		await user.click(
			await screen.findByRole('button', {
				name: 'Edit Work Period for Foundation Work',
			})
		);
		const table = activityTable();
		const editor = screen.getByRole('form', { name: 'Work Period editor' });
		expect(editor).toContainElement(table);
		const editRow = periodButton('Start Period', within(table)).closest('tr');
		expect(periodButton('Start Period', within(editRow))).toHaveTextContent(
			'10:00 PM'
		);
		expect(periodButton('End Period', within(editRow))).toHaveTextContent(
			'02:00 AM'
		);
		await setEndpoint(user, 'End Period', '03', '00', 'AM');
		fireEvent.change(screen.getByLabelText('Quantity'), {
			target: { value: '2' },
		});
		await user.click(screen.getByRole('button', { name: 'Save Work Period' }));

		await waitFor(() => {
			expect(apiPut).toHaveBeenCalledWith('/api/work-periods', {
				id: EDITABLE_PERIOD.id,
				projectId: 1,
				start: '2026-12-01T22:00',
				end: `${TODAY}T03:00`,
				quantity: 2,
				dateCompleted: TODAY,
				remarks: 'Today’s work',
			});
		});
		await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
		window.removeEventListener('activity-log-saved', onSaved);
	});

	it('changes only quantity attribution when an existing Date Completed changes', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods')
				return periodPayload(CURRENT_WEEK, [EDITABLE_PERIOD]);
			if (url === '/api/activity-master/options') {
				return { success: true, data: DISCIPLINE_OPTIONS };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		const user = userEvent.setup();
		renderAssignments();
		await user.click(
			await screen.findByRole('button', {
				name: 'Edit Work Period for Foundation Work',
			})
		);
		fireEvent.change(screen.getByLabelText('Date Completed'), {
			target: { value: '2026-12-01' },
		});
		fireEvent.change(screen.getByLabelText('Quantity'), {
			target: { value: '2' },
		});
		await user.click(screen.getByRole('button', { name: 'Save Work Period' }));

		await waitFor(() => {
			expect(apiPut).toHaveBeenCalledWith('/api/work-periods', {
				id: EDITABLE_PERIOD.id,
				projectId: 1,
				start: '2026-12-01T22:00',
				end: `${TODAY}T02:00`,
				quantity: 2,
				dateCompleted: '2026-12-01',
				remarks: 'Today’s work',
			});
		});
	});

	it('makes older Work Periods visibly read-only', async () => {
		renderAssignments();

		const row = await rowContaining('Overnight work');
		const lock = within(row).getByRole('button', {
			name: 'Locked for Foundation Work',
		});
		expect(lock).toBeDisabled();
		expect(lock).toHaveAccessibleDescription(
			'Both work dates must be today or yesterday to edit.'
		);
	});

	it('deletes only the selected Work Period after confirmation', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods')
				return periodPayload(CURRENT_WEEK, [EDITABLE_PERIOD]);
			if (url === '/api/activity-master/options') {
				return { success: true, data: DISCIPLINE_OPTIONS };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		vi.spyOn(window, 'confirm').mockReturnValue(true);
		const user = userEvent.setup();
		renderAssignments();

		await user.click(
			await screen.findByRole('button', {
				name: 'Delete Work Period for Foundation Work',
			})
		);

		await waitFor(() => {
			expect(apiDelete).toHaveBeenCalledWith('/api/work-periods', {
				id: EDITABLE_PERIOD.id,
				projectId: 1,
			});
		});
	});

	it('keeps preloaded Project discovery visible when the Work Period read fails', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods')
				throw new Error('Work Periods could not load.');
			if (url === '/api/activity-master/options') {
				return { success: true, data: DISCIPLINE_OPTIONS };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		renderAssignments({
			preloadedData: {
				assignments: [],
				emptyProjects: PRELOADED_DATA.emptyProjects,
				accessibleProjects: [],
				documentCounts: {},
			},
		});

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Work Periods could not load.'
		);
		expect(
			screen.getByRole('link', { name: 'Open documents for Gamma Bridge' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Try again' })
		).toBeInTheDocument();
	});
});

describe('WorkPeriodFields', () => {
	const value = {
		start: `${TODAY}T09:00`,
		end: `${TODAY}T10:00`,
		quantity: '2.5',
		dateCompleted: TODAY,
		remarks: 'A remark',
	};

	it('keeps explicit calendar dates for the manager editor', () => {
		render(<WorkPeriodFields value={value} onChange={vi.fn()} />);

		expect(screen.getByLabelText('Start (IST)')).toHaveAttribute(
			'type',
			'datetime-local'
		);
		expect(screen.getByLabelText('Start (IST)')).toHaveValue(value.start);
		expect(screen.getByLabelText('End (IST)')).toHaveAttribute(
			'type',
			'datetime-local'
		);
		expect(screen.getByLabelText('End (IST)')).toHaveValue(value.end);
		expect(screen.getByLabelText('Date Completed')).toHaveValue(TODAY);
	});

	it('emits the complete controlled value when any shared field changes', () => {
		const onChange = vi.fn();
		render(<WorkPeriodFields value={value} onChange={onChange} />);

		fireEvent.change(screen.getByLabelText('Start (IST)'), {
			target: { value: '2026-12-01T22:00' },
		});
		expect(onChange).toHaveBeenCalledWith({
			...value,
			start: '2026-12-01T22:00',
		});
		fireEvent.change(screen.getByLabelText('End (IST)'), {
			target: { value: `${TODAY}T03:00` },
		});
		expect(onChange).toHaveBeenLastCalledWith({
			...value,
			end: `${TODAY}T03:00`,
		});
		fireEvent.change(screen.getByLabelText('Quantity'), {
			target: { value: '3' },
		});
		expect(onChange).toHaveBeenCalledWith({ ...value, quantity: '3' });
		fireEvent.change(screen.getByLabelText('Remarks'), {
			target: { value: 'Updated remark' },
		});
		expect(onChange).toHaveBeenLastCalledWith({
			...value,
			remarks: 'Updated remark',
		});
	});

	it('disables every shared field while a mutation is pending', () => {
		render(<WorkPeriodFields value={value} onChange={vi.fn()} disabled />);

		for (const label of [
			'Start (IST)',
			'End (IST)',
			'Quantity',
			'Date Completed',
			'Remarks',
		]) {
			expect(screen.getByLabelText(label)).toBeDisabled();
		}
	});
});
