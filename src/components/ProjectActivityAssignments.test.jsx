import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const CURRENT_WEEK = '2026-11-30';
const PREVIOUS_WEEK = '2026-11-23';

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
			project_name: 'Alpha Plant',
			project_code: 'P-001',
			activity_id: 'act-1',
			activity_name: 'Foundation Work',
			discipline: 'Civil',
			sub_activity_name: 'Excavation',
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
	weekQuantity: 0,
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
			<ProjectActivityAssignments
				userId={42}
				preloadedData={preloadedData}
				{...props}
			/>
		</QueryClientProvider>
	);
}

async function openAddForm() {
	const user = userEvent.setup();
	await user.click(await screen.findByRole('button', { name: 'Add' }));
	await screen.findByRole('form', { name: 'Log a Work Period' });
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
		vi.useRealTimers();
		vi.restoreAllMocks();
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

	it('opens on the IST Monday and clips weekly totals from API fields', async () => {
		renderAssignments();

		expect(await screen.findByText('30 Nov – 6 Dec 2026')).toBeInTheDocument();
		expect(apiGet).toHaveBeenCalledWith('/api/work-periods', {
			week: CURRENT_WEEK,
			userId: 42,
		});
		expect(await screen.findByText('Week total: 6h')).toBeInTheDocument();
		expect(screen.getByText('Week quantity: 3')).toBeInTheDocument();

		const table = screen.getByRole('table', { name: 'Work Periods' });
		expect(within(table).getAllByRole('row')).toHaveLength(4);
		const overnightRow = screen.getByText('Overnight work').closest('tr');
		expect(within(overnightRow).getByText('4h')).toBeInTheDocument();
		expect(
			within(overnightRow).getByText('30 Nov 2026, 22:00')
		).toBeInTheDocument();
		expect(
			within(overnightRow).getByText('01 Dec 2026, 02:00')
		).toBeInTheDocument();
		expect(screen.queryByPlaceholderText('Hrs')).not.toBeInTheDocument();
		expect(screen.queryByLabelText('Manhours')).not.toBeInTheDocument();
	});

	it('shows a boundary period in both weeks with only each API-clipped share', async () => {
		const user = userEvent.setup();
		renderAssignments();

		await screen.findByText('Steel Erection');
		await user.click(screen.getByRole('button', { name: 'Previous week' }));

		expect(await screen.findByText('23 Nov – 29 Nov 2026')).toBeInTheDocument();
		expect(apiGet).toHaveBeenCalledWith('/api/work-periods', {
			week: PREVIOUS_WEEK,
			userId: 42,
		});
		expect(await screen.findByText('Week total: 2h')).toBeInTheDocument();
		expect(screen.getByText('Week quantity: 0')).toBeInTheDocument();
		expect(screen.getByText('Steel Erection')).toBeInTheDocument();
		expect(screen.queryByText('Foundation Work')).not.toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Next week' }));
		expect(await screen.findByText('30 Nov – 6 Dec 2026')).toBeInTheDocument();
		expect(await screen.findByText('Week total: 6h')).toBeInTheDocument();
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
			screen.getByRole('searchbox', {
				name: 'Search Work Periods and history',
			}),
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

		expect(
			await screen.findByText('No Work Periods for this week')
		).toBeInTheDocument();
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

	it('renders raw legacy daily entries without inferred timestamps or edit controls', async () => {
		apiGet.mockImplementation(async (url) => {
			if (url === '/api/work-periods') {
				return periodPayload(CURRENT_WEEK, []);
			}
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

		const legacyTable = await screen.findByRole('table', {
			name: 'Historical duration-only logs',
		});
		expect(within(legacyTable).getByText('2.5h')).toBeInTheDocument();
		expect(
			within(legacyTable).getByText('Recorded duration')
		).toBeInTheDocument();
		expect(within(legacyTable).queryByText('99h')).not.toBeInTheDocument();
		expect(
			screen.getByText(/Start and End were not recorded/)
		).toBeInTheDocument();
		expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
		expect(screen.queryByLabelText('To')).not.toBeInTheDocument();
		expect(
			within(legacyTable).queryByRole('button', { name: /Edit|Delete/ })
		).not.toBeInTheDocument();

		const user = userEvent.setup();
		await user.selectOptions(
			screen.getByLabelText('Legacy status'),
			'In Progress'
		);
		expect(
			within(legacyTable).getByText('Foundation Work')
		).toBeInTheDocument();
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

		const legacyTable = await screen.findByRole('table', {
			name: 'Historical duration-only logs',
		});
		expect(within(legacyTable).getByText('2.5h')).toBeInTheDocument();
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

		await user.selectOptions(screen.getByLabelText('Activity'), 'a2');
		expect(screen.getByDisplayValue('No sub-activity')).toBeInTheDocument();
	});

	it('posts a self-service Work Period, defaults Date Completed, and emits save evidence', async () => {
		const onSaved = vi.fn();
		window.addEventListener('activity-log-saved', onSaved);
		renderAssignments();
		const user = await openAddForm();
		await chooseAssembly(user);
		fireEvent.change(screen.getByLabelText(/Start \(IST\)/), {
			target: { value: `${TODAY}T09:00` },
		});
		fireEvent.change(screen.getByLabelText(/End \(IST\)/), {
			target: { value: `${TODAY}T11:30` },
		});
		expect(screen.getByLabelText('Date Completed')).toHaveValue(TODAY);
		fireEvent.change(screen.getByLabelText('Quantity'), {
			target: { value: '2.5' },
		});
		fireEvent.change(screen.getByLabelText('Remarks'), {
			target: { value: 'Completed assembly' },
		});

		await user.click(screen.getByRole('button', { name: 'Save Work Period' }));

		await waitFor(() => {
			expect(apiPost).toHaveBeenCalledWith('/api/work-periods', {
				projectId: '1',
				disciplineId: 'd1',
				activityId: 'a2',
				subActivityId: null,
				start: `${TODAY}T09:00`,
				end: `${TODAY}T11:30`,
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

	it('keeps every entered value and shows the server error when a save is rejected', async () => {
		apiPost.mockRejectedValue(
			new Error('This Work Period overlaps an existing Work Period.')
		);
		const onSaved = vi.fn();
		window.addEventListener('activity-log-saved', onSaved);
		renderAssignments();
		const user = await openAddForm();
		await chooseAssembly(user);
		fireEvent.change(screen.getByLabelText(/Start \(IST\)/), {
			target: { value: `${TODAY}T09:00` },
		});
		fireEvent.change(screen.getByLabelText(/End \(IST\)/), {
			target: { value: `${TODAY}T10:00` },
		});
		fireEvent.change(screen.getByLabelText('Quantity'), {
			target: { value: '4' },
		});
		fireEvent.change(screen.getByLabelText('Remarks'), {
			target: { value: 'Keep this remark' },
		});

		await user.click(screen.getByRole('button', { name: 'Save Work Period' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'This Work Period overlaps an existing Work Period.'
		);
		expect(screen.getByLabelText(/Start \(IST\)/)).toHaveValue(
			`${TODAY}T09:00`
		);
		expect(screen.getByLabelText(/End \(IST\)/)).toHaveValue(`${TODAY}T10:00`);
		expect(screen.getByLabelText('Quantity')).toHaveValue(4);
		expect(screen.getByLabelText('Remarks')).toHaveValue('Keep this remark');
		expect(onSaved).not.toHaveBeenCalled();
		window.removeEventListener('activity-log-saved', onSaved);
	});

	it('edits one eligible overnight row without splitting it or changing its Project', async () => {
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
		expect(
			screen.getByRole('form', { name: 'Edit Work Period' })
		).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText(/End \(IST\)/), {
			target: { value: `${TODAY}T03:00` },
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
				end: `${TODAY}T03:00`,
				quantity: 2,
				dateCompleted: TODAY,
				remarks: 'Today’s work',
			});
		});
		await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
		window.removeEventListener('activity-log-saved', onSaved);
	});

	it('makes older Work Periods visibly read-only', async () => {
		renderAssignments();

		const row = (await screen.findByText('Overnight work')).closest('tr');
		expect(within(row).getByText('Locked')).toBeInTheDocument();
		expect(
			within(row).queryByRole('button', {
				name: /Edit Work Period|Delete Work Period/,
			})
		).not.toBeInTheDocument();
		expect(
			screen.getByText(/Both endpoints must fall on today or yesterday in IST/)
		).toBeInTheDocument();
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

	it('emits the complete controlled value when any shared field changes', () => {
		const onChange = vi.fn();
		render(<WorkPeriodFields value={value} onChange={onChange} />);

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
			/Start \(IST\)/,
			/End \(IST\)/,
			'Quantity',
			'Date Completed',
			'Remarks',
		]) {
			expect(screen.getByLabelText(label)).toBeDisabled();
		}
	});
});
