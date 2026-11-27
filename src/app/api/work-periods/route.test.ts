import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST, PUT } from '@/app/api/work-periods/route';
import { WorkPeriodCommandError } from '@/server/work-periods/commands';
import type * as CommandsModule from '@/server/work-periods/commands';

const mocks = vi.hoisted(() => ({
	dbConnect: vi.fn(),
	getCurrentUser: vi.fn(),
	requireProjectAccess: vi.fn(),
	loadLeadPolicy: vi.fn(),
	readWorkPeriods: vi.fn(),
	lockWorkPeriodEmployee: vi.fn(),
	assertNoWorkPeriodOverlap: vi.fn(),
	insertWorkPeriod: vi.fn(),
	updateWorkPeriod: vi.fn(),
	deleteWorkPeriod: vi.fn(),
	getLinkedEmployee: vi.fn(),
	listCurrentProjectIds: vi.fn(),
	listManagerAssignments: vi.fn(),
	createWorkPeriod: vi.fn(),
	updateWorkPeriodCommand: vi.fn(),
	deleteWorkPeriodCommand: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.dbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mocks.getCurrentUser,
}));
vi.mock('@/lib/project-rights', () => ({
	requireProjectAccess: mocks.requireProjectAccess,
	loadLeadPolicy: mocks.loadLeadPolicy,
	PROJECT_ACCESS_DENIED: 'You do not have permission to access this project',
}));
vi.mock('@/server/work-periods/store', () => ({
	readWorkPeriods: mocks.readWorkPeriods,
	lockWorkPeriodEmployee: mocks.lockWorkPeriodEmployee,
	assertNoWorkPeriodOverlap: mocks.assertNoWorkPeriodOverlap,
	insertWorkPeriod: mocks.insertWorkPeriod,
	updateWorkPeriod: mocks.updateWorkPeriod,
	deleteWorkPeriod: mocks.deleteWorkPeriod,
}));
vi.mock('@/server/work-periods/commands', async (importOriginal) => {
	const actual = await importOriginal<typeof CommandsModule>();
	return {
		...actual,
		getLinkedEmployee: mocks.getLinkedEmployee,
		listCurrentProjectIds: mocks.listCurrentProjectIds,
		listManagerAssignments: mocks.listManagerAssignments,
		createWorkPeriod: mocks.createWorkPeriod,
		updateWorkPeriodCommand: mocks.updateWorkPeriodCommand,
		deleteWorkPeriodCommand: mocks.deleteWorkPeriodCommand,
	};
});

const db = { release: vi.fn() };
const actor = { id: 42, email: 'employee@example.com' };
const project = {
	project_id: 7,
	project_team: JSON.stringify([{ user_id: 42 }]),
};

function access(edit = false) {
	return {
		user: actor,
		project,
		rights: { sections: { project_activity: { edit } } },
		db,
		ownsDb: false,
	};
}

function request(
	method: string,
	body?: unknown,
	url = 'http://localhost/api/work-periods'
) {
	return new Request(url, {
		method,
		headers:
			body === undefined ? undefined : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

function period(overrides: Record<string, unknown> = {}) {
	return {
		id: 'period-1',
		assignmentId: 'assignment-1',
		employeeId: 9,
		startMs: Date.parse('2026-11-26T10:00:00+05:30'),
		endMs: Date.parse('2026-11-26T11:30:00+05:30'),
		quantity: '2',
		dateCompleted: '2026-11-26',
		remarks: null,
		projectId: 7,
		activityId: 'activity-1',
		userId: 42,
		projectCode: 'PRJ-007',
		projectName: 'Project Seven',
		discipline: 'Engineering',
		activityName: 'Design',
		subActivityName: null,
		employeeName: 'Employee Forty Two',
		defaultManhours: 12.5,
		status: 'In Progress',
		...overrides,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-26T12:00:00.000Z'));
	vi.clearAllMocks();
	mocks.dbConnect.mockResolvedValue(db);
	mocks.getCurrentUser.mockResolvedValue(actor);
	mocks.requireProjectAccess.mockResolvedValue(access());
	mocks.readWorkPeriods.mockResolvedValue([]);
	mocks.getLinkedEmployee.mockResolvedValue({
		employeeId: 9,
		employeeName: 'Employee Forty Two',
	});
	mocks.listCurrentProjectIds.mockResolvedValue(new Set([7]));
	mocks.listManagerAssignments.mockResolvedValue([]);
	mocks.createWorkPeriod.mockResolvedValue({ id: 'period-1' });
	mocks.updateWorkPeriodCommand.mockResolvedValue({ id: 'period-1' });
	mocks.deleteWorkPeriodCommand.mockResolvedValue({ id: 'period-1' });
});

afterEach(() => {
	vi.useRealTimers();
});

describe('work periods route authentication and scope', () => {
	it.each(['GET', 'POST', 'PUT', 'DELETE'])(
		'denies unauthenticated %s before opening the database',
		async (method) => {
			mocks.getCurrentUser.mockResolvedValue(null);
			const response =
				method === 'GET'
					? await GET(request(method))
					: method === 'POST'
						? await POST(
								request(method, {
									projectId: 7,
									disciplineId: 'discipline-1',
									activityId: 'activity-1',
									subActivityId: null,
									start: '2026-11-26T10:00',
									end: '2026-11-26T11:00',
								})
							)
						: method === 'PUT'
							? await PUT(
									request(method, {
										id: 'period-1',
										projectId: 7,
										start: '2026-11-26T10:00',
										end: '2026-11-26T11:00',
									})
								)
							: await DELETE(request(method, { id: 'period-1', projectId: 7 }));

			expect(response.status).toBe(401);
			expect(mocks.dbConnect).not.toHaveBeenCalled();
		}
	);

	it('denies cross-account history to a non-admin', async () => {
		const response = await GET(
			request('GET', undefined, 'http://localhost/api/work-periods?userId=99')
		);

		expect(response.status).toBe(403);
		expect(mocks.readWorkPeriods).not.toHaveBeenCalled();
	});

	it.each([
		{ label: 'an admin', role: { code: 'admin' } },
		{ label: 'a super admin', is_super_admin: true },
	])(
		'lets $label read only the selected Employee’s Work Periods',
		async (admin) => {
			mocks.getCurrentUser.mockResolvedValue({ ...actor, ...admin });
			mocks.getLinkedEmployee.mockImplementationOnce(async (_db, userId) =>
				userId === 99
					? { employeeId: 18, employeeName: 'Selected Employee' }
					: null
			);
			mocks.readWorkPeriods.mockImplementationOnce(async (_db, scope) =>
				scope.employeeId === 18
					? [period({ id: 'selected-period', userId: 99, employeeId: 18 })]
					: []
			);

			const response = await GET(
				request('GET', undefined, 'http://localhost/api/work-periods?userId=99')
			);

			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				success: true,
				data: {
					canLog: false,
					readOnly: true,
					periods: [{ id: 'selected-period', employeeId: 18, editable: false }],
				},
			});
		}
	);

	it('returns a non-loggable empty week when the direct Employee link is missing', async () => {
		mocks.getLinkedEmployee.mockResolvedValue(null);

		const response = await GET(request('GET'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			data: {
				canLog: false,
				readOnly: false,
				today: '2026-11-26',
				weekStart: '2026-11-23',
				periods: [],
			},
		});
		expect(mocks.readWorkPeriods).not.toHaveBeenCalled();
	});

	it('requires Project Activity edit authority for manager options and history', async () => {
		const response = await GET(
			request(
				'GET',
				undefined,
				'http://localhost/api/work-periods?projectId=7&week=2026-11-23'
			)
		);

		expect(response.status).toBe(403);
		expect(mocks.readWorkPeriods).not.toHaveBeenCalled();
		expect(mocks.listManagerAssignments).not.toHaveBeenCalled();
	});

	it('returns manager assignments only after the existing Project edit policy passes', async () => {
		mocks.requireProjectAccess.mockResolvedValue(access(true));
		mocks.listManagerAssignments.mockResolvedValue([
			{
				id: 'assignment-1',
				employeeName: 'Employee Forty Two',
				activityName: 'Design',
				subActivityName: '',
			},
		]);

		const response = await GET(
			request(
				'GET',
				undefined,
				'http://localhost/api/work-periods?projectId=7&week=2026-11-23'
			)
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			success: true,
			data: {
				canLog: true,
				assignments: [
					{
						id: 'assignment-1',
						employeeName: 'Employee Forty Two',
						activityName: 'Design',
					},
				],
			},
		});
	});
});

describe('work periods route weekly contract', () => {
	it('keeps one identity across a week boundary and clips only its time', async () => {
		mocks.readWorkPeriods.mockResolvedValue([
			period({
				startMs: Date.parse('2026-11-22T23:00:00+05:30'),
				endMs: Date.parse('2026-11-23T01:00:00+05:30'),
				dateCompleted: '2026-11-22',
			}),
		]);

		const response = await GET(
			request(
				'GET',
				undefined,
				'http://localhost/api/work-periods?week=2026-11-23'
			)
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			data: {
				periods: [
					{
						id: 'period-1',
						start: '2026-11-22T23:00',
						end: '2026-11-23T01:00',
						durationSeconds: 7200,
						weekSeconds: 3600,
						quantity: 2,
						weekQuantity: 0,
						remarks: '',
						editable: false,
					},
				],
			},
		});
	});

	it('attributes quantity once on Date Completed', async () => {
		mocks.readWorkPeriods.mockResolvedValue([period()]);

		const response = await GET(
			request(
				'GET',
				undefined,
				'http://localhost/api/work-periods?week=2026-11-23'
			)
		);

		expect(await response.json()).toMatchObject({
			data: {
				periods: [
					{
						weekQuantity: 2,
						editable: true,
						defaultManhours: 12.5,
						status: 'In Progress',
					},
				],
			},
		});
	});

	it('shows a quantity-only week row without crediting extra time', async () => {
		mocks.readWorkPeriods.mockResolvedValue([
			period({
				startMs: Date.parse('2026-11-20T10:00:00+05:30'),
				endMs: Date.parse('2026-11-20T11:00:00+05:30'),
				dateCompleted: '2026-11-26',
				quantity: '4',
			}),
		]);

		const response = await GET(
			request(
				'GET',
				undefined,
				'http://localhost/api/work-periods?week=2026-11-23'
			)
		);

		expect(await response.json()).toMatchObject({
			data: {
				periods: [{ id: 'period-1', weekSeconds: 0, weekQuantity: 4 }],
			},
		});
	});

	it.each(['week=2026-11-23T00%3A00', 'userId=not-an-id'])(
		'rejects malformed query shapes before reading periods',
		async (query) => {
			const response = await GET(
				request('GET', undefined, `http://localhost/api/work-periods?${query}`)
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				code: 'INVALID_WORK_PERIOD',
			});
			expect(mocks.dbConnect).not.toHaveBeenCalled();
		}
	);

	it('rejects a week selector that is not a Monday', async () => {
		const response = await GET(
			request(
				'GET',
				undefined,
				'http://localhost/api/work-periods?week=2026-11-24'
			)
		);

		expect(response.status).toBe(400);
		expect(mocks.readWorkPeriods).not.toHaveBeenCalled();
	});
});

describe('work periods route mutations', () => {
	it.each([[], null, 'not-an-object'])(
		'rejects a non-object JSON body before opening the database',
		async (body) => {
			const response = await POST(request('POST', body));

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				code: 'INVALID_WORK_PERIOD',
				error: 'A valid JSON request body is required.',
			});
			expect(mocks.dbConnect).not.toHaveBeenCalled();
		}
	);

	it('rejects a non-boolean manager option with the actionable scope message', async () => {
		const response = await POST(
			request('POST', { manager: 'true', projectId: 7 })
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: 'INVALID_WORK_PERIOD',
			error: 'manager must be true when using manager scope.',
		});
		expect(mocks.dbConnect).not.toHaveBeenCalled();
	});

	it('rejects a projectId that cannot be a positive safe integer', async () => {
		const response = await POST(
			request('POST', { manager: false, projectId: '7-project' })
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: 'INVALID_WORK_PERIOD',
			error: 'projectId is required.',
		});
		expect(mocks.dbConnect).not.toHaveBeenCalled();
	});
	it('rejects missing endpoints without writing', async () => {
		const response = await POST(
			request('POST', {
				projectId: 7,
				disciplineId: 'discipline-1',
				activityId: 'activity-1',
				subActivityId: null,
				start: '2026-11-26T10:00',
				remarks: 'Reviewed the drawing.',
			})
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			success: false,
			code: 'INVALID_WORK_PERIOD',
		});
		expect(mocks.createWorkPeriod).not.toHaveBeenCalled();
	});

	it('rejects a future end without writing', async () => {
		const response = await POST(
			request('POST', {
				projectId: 7,
				disciplineId: 'discipline-1',
				activityId: 'activity-1',
				subActivityId: null,
				start: '2026-11-26T16:00',
				end: '2026-11-26T18:00',
				remarks: 'Reviewed the drawing.',
			})
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error:
				'The end time is later than now (IST). Check the date and time, or save after the work ends.',
		});
		expect(mocks.createWorkPeriod).not.toHaveBeenCalled();
	});

	it('requires the direct Employee link for self mutations', async () => {
		mocks.getLinkedEmployee.mockResolvedValue(null);

		const response = await POST(
			request('POST', {
				projectId: 7,
				disciplineId: 'discipline-1',
				activityId: 'activity-1',
				subActivityId: null,
				start: '2026-11-26T10:00',
				end: '2026-11-26T11:00',
			})
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			success: false,
			code: 'EMPLOYEE_LINK_REQUIRED',
		});
		expect(mocks.createWorkPeriod).not.toHaveBeenCalled();
	});

	it('does not accept manager scope without Project Activity edit authority', async () => {
		const response = await POST(
			request('POST', {
				manager: true,
				projectId: 7,
				assignmentId: 'assignment-1',
				start: '2026-11-20T10:00',
				end: '2026-11-20T11:00',
			})
		);

		expect(response.status).toBe(403);
		expect(mocks.createWorkPeriod).not.toHaveBeenCalled();
	});

	it('denies self work when the actor is not in the current Project Team', async () => {
		mocks.requireProjectAccess.mockResolvedValue({
			...access(),
			project: {
				...project,
				project_team: JSON.stringify([{ user_id: 99 }]),
			},
		});

		const response = await POST(
			request('POST', {
				projectId: 7,
				disciplineId: 'discipline-1',
				activityId: 'activity-1',
				subActivityId: null,
				start: '2026-11-26T10:00',
				end: '2026-11-26T11:00',
			})
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			code: 'PROJECT_ACCESS_DENIED',
		});
		expect(mocks.createWorkPeriod).not.toHaveBeenCalled();
	});

	it('returns a distinct overlap refusal without conflict details', async () => {
		mocks.createWorkPeriod.mockRejectedValue(
			new WorkPeriodCommandError(
				409,
				'WORK_PERIOD_OVERLAP',
				'This Work Period overlaps another Work Period. Adjust the Start or End.'
			)
		);

		const response = await POST(
			request('POST', {
				projectId: 7,
				disciplineId: 'discipline-1',
				activityId: 'activity-1',
				subActivityId: null,
				start: '2026-11-26T10:00',
				end: '2026-11-26T11:00',
				remarks: 'Reviewed the drawing.',
			})
		);

		expect(response.status).toBe(409);
		const body = await response.json();
		expect(body).toMatchObject({
			success: false,
			code: 'WORK_PERIOD_OVERLAP',
		});
		expect(body.details).toBeUndefined();
	});

	it('explains when work is outside the self-service window', async () => {
		mocks.createWorkPeriod.mockRejectedValue(
			new WorkPeriodCommandError(
				403,
				'OUTSIDE_SELF_SERVICE_WINDOW',
				'Both Start and End must fall today or yesterday in IST. Contact an authorized manager for older work.'
			)
		);

		const response = await POST(
			request('POST', {
				projectId: 7,
				disciplineId: 'discipline-1',
				activityId: 'activity-1',
				subActivityId: null,
				start: '2026-11-23T10:00',
				end: '2026-11-23T11:00',
				remarks: 'Reviewed the drawing.',
			})
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			success: false,
			code: 'OUTSIDE_SELF_SERVICE_WINDOW',
			error: expect.stringContaining('authorized manager'),
		});
	});

	it('maps a stale or mismatching correction to a non-disclosing not-found response', async () => {
		mocks.updateWorkPeriodCommand.mockRejectedValue(
			new WorkPeriodCommandError(
				404,
				'WORK_PERIOD_NOT_FOUND',
				'Work Period not found'
			)
		);

		const response = await PUT(
			request('PUT', {
				id: 'period-1',
				projectId: 8,
				start: '2026-11-26T10:00',
				end: '2026-11-26T11:00',
				remarks: 'Reviewed the drawing.',
			})
		);

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({
			success: false,
			code: 'WORK_PERIOD_NOT_FOUND',
		});
	});

	it('defaults a blank Date Completed from the IST end date and returns the mutation envelope', async () => {
		const response = await POST(
			request('POST', {
				projectId: 7,
				disciplineId: 'discipline-1',
				activityId: 'activity-1',
				subActivityId: null,
				start: '2026-11-26T10:00',
				end: '2026-11-26T11:00',
				dateCompleted: '',
				remarks: '  Reviewed the drawing.  ',
			})
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			data: { id: 'period-1' },
			affected_rows: 1,
		});
		expect(mocks.createWorkPeriod).toHaveBeenCalledWith(
			expect.objectContaining({
				manager: false,
				employeeId: 9,
				disciplineId: 'discipline-1',
				activityId: 'activity-1',
				subActivityId: null,
				input: expect.objectContaining({
					quantity: '0',
					dateCompleted: '2026-11-26',
					remarks: 'Reviewed the drawing.',
				}),
			})
		);
	});

	it.each([
		['POST', undefined],
		['POST', '   '],
		['PUT', undefined],
		['PUT', '   '],
	] as const)(
		'requires a description on employee %s (input %j)',
		async (method, remarks) => {
			const save = method === 'POST' ? POST : PUT;
			const response = await save(
				request(method, {
					id: 'period-1',
					projectId: 7,
					disciplineId: 'discipline-1',
					activityId: 'activity-1',
					subActivityId: null,
					start: '2026-11-26T10:00',
					end: '2026-11-26T11:00',
					remarks,
				})
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				code: 'INVALID_WORK_PERIOD',
				error: 'Enter an Activity Description.',
			});
			expect(mocks.createWorkPeriod).not.toHaveBeenCalled();
			expect(mocks.updateWorkPeriodCommand).not.toHaveBeenCalled();
		}
	);

	it('lets an authorized manager save by assignment without requiring their own Employee link', async () => {
		mocks.requireProjectAccess.mockResolvedValue(access(true));
		mocks.getLinkedEmployee.mockResolvedValue(null);

		const response = await POST(
			request('POST', {
				manager: true,
				projectId: 7,
				assignmentId: 'assignment-1',
				start: '2026-11-20T10:00',
				end: '2026-11-20T11:00',
			})
		);

		expect(response.status).toBe(200);
		expect(mocks.getLinkedEmployee).not.toHaveBeenCalled();
		expect(mocks.createWorkPeriod).toHaveBeenCalledWith(
			expect.objectContaining({
				manager: true,
				assignmentId: 'assignment-1',
			})
		);
	});

	it('deletes by stable Work Period identity without endpoint fields', async () => {
		const response = await DELETE(
			request('DELETE', { id: 'period-1', projectId: 7 })
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			data: { id: 'period-1' },
			affected_rows: 1,
		});
		expect(mocks.deleteWorkPeriodCommand).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'period-1', manager: false, employeeId: 9 })
		);
	});

	it('does not leak unexpected database errors', async () => {
		mocks.deleteWorkPeriodCommand.mockRejectedValue(
			new Error('secret database detail')
		);

		const response = await DELETE(
			request('DELETE', { id: 'period-1', projectId: 7 })
		);

		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body.error).toBe('Failed to delete Work Period');
		expect(body.details).toBeUndefined();
	});
});
