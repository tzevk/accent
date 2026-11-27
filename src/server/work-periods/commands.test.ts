import type { PoolConnection } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createWorkPeriod,
	deleteWorkPeriodCommand,
	updateWorkPeriodCommand,
	WorkPeriodCommandError,
} from '@/server/work-periods/commands';
import type { WorkPeriodRecord } from '@/server/work-periods/store';

const mocks = vi.hoisted(() => ({
	execute: vi.fn(),
	beginTransaction: vi.fn(),
	commit: vi.fn(),
	rollback: vi.fn(),
	lockWorkPeriodEmployee: vi.fn(),
	assertNoWorkPeriodOverlap: vi.fn(),
	insertWorkPeriod: vi.fn(),
	updateWorkPeriod: vi.fn(),
	deleteWorkPeriod: vi.fn(),
	getWorkPeriod: vi.fn(),
}));

vi.mock('@/server/work-periods/store', () => ({
	lockWorkPeriodEmployee: mocks.lockWorkPeriodEmployee,
	assertNoWorkPeriodOverlap: mocks.assertNoWorkPeriodOverlap,
	insertWorkPeriod: mocks.insertWorkPeriod,
	updateWorkPeriod: mocks.updateWorkPeriod,
	deleteWorkPeriod: mocks.deleteWorkPeriod,
	getWorkPeriod: mocks.getWorkPeriod,
}));

const db = {
	query: mocks.execute,
	beginTransaction: mocks.beginTransaction,
	commit: mocks.commit,
	rollback: mocks.rollback,
} as unknown as PoolConnection;

const actor = { id: 1, email: 'manager@example.com' };
const project = { project_id: 7 };
const input = {
	startMs: Date.parse('2026-10-01T09:00:00+05:30'),
	endMs: Date.parse('2026-10-01T11:00:00+05:30'),
	quantity: '2',
	dateCompleted: '2026-10-01',
	remarks: 'Correction',
};

function assignment(employeeId = 9) {
	return {
		id: 'assignment-1',
		user_id: 42,
		employee_id: employeeId,
		project_id: 7,
		activity_id: 'activity-1',
		activity_name: 'Structural design',
		discipline_id: 'discipline-1',
		discipline_name: 'Structures',
		catalog_activity_id: 'activity-1',
		catalog_sub_activity_id: null,
		sub_activity_name: null,
		default_manhours: '8',
		linked_user_email: 'asha@example.com',
		linked_user_name: 'Asha Rao',
		first_name: 'Asha',
		last_name: 'Rao',
		daily_entries: '[]',
		work_period_entries: null,
	};
}

function period(): WorkPeriodRecord {
	return {
		id: 'period-1',
		assignmentId: 'assignment-1',
		employeeId: 9,
		startMs: input.startMs,
		endMs: input.endMs,
		quantity: input.quantity,
		dateCompleted: input.dateCompleted,
		remarks: input.remarks,
	};
}

function queueCreateReads(currentEmployeeId = 9) {
	mocks.execute
		.mockResolvedValueOnce([[assignment()]])
		.mockResolvedValueOnce([
			[
				{
					project_team: JSON.stringify([{ user_id: 42 }]),
					project_activities_list: '[]',
				},
			],
		])
		.mockResolvedValueOnce([[assignment(currentEmployeeId)]])
		.mockResolvedValueOnce([[assignment(currentEmployeeId)]])
		.mockResolvedValueOnce([{ affectedRows: 1 }]);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.execute.mockReset();
	mocks.beginTransaction.mockResolvedValue(undefined);
	mocks.commit.mockResolvedValue(undefined);
	mocks.rollback.mockResolvedValue(undefined);
	mocks.lockWorkPeriodEmployee.mockResolvedValue(true);
	mocks.assertNoWorkPeriodOverlap.mockResolvedValue(true);
	mocks.getWorkPeriod.mockResolvedValue(period());
	mocks.insertWorkPeriod.mockImplementation(async (_db, data) => ({
		...period(),
		id: data.id,
	}));
	mocks.updateWorkPeriod.mockImplementation(async (_db, data) => ({
		...period(),
		...data,
	}));
	mocks.deleteWorkPeriod.mockResolvedValue(true);
});

describe('Work Period manager attribution', () => {
	it('creates against the Employee immutable on the selected assignment', async () => {
		queueCreateReads();

		await expect(
			createWorkPeriod({
				db,
				actor,
				project,
				projectId: 7,
				input,
				nowMs: Date.parse('2026-10-02T00:00:00+05:30'),
				manager: true,
				assignmentId: 'assignment-1',
			})
		).resolves.toEqual({ id: expect.any(String) });

		expect(mocks.lockWorkPeriodEmployee).toHaveBeenCalledWith(
			expect.anything(),
			9
		);
		expect(mocks.insertWorkPeriod).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				assignmentId: 'assignment-1',
				employeeId: 9,
			})
		);
	});

	it('rejects a stale manager create when the assignment Employee changed', async () => {
		queueCreateReads(10);

		await expect(
			createWorkPeriod({
				db,
				actor,
				project,
				projectId: 7,
				input,
				nowMs: Date.parse('2026-10-02T00:00:00+05:30'),
				manager: true,
				assignmentId: 'assignment-1',
			})
		).rejects.toMatchObject({
			name: 'WorkPeriodCommandError',
			status: 409,
			code: 'WORK_PERIOD_WRITE_FAILED',
		});

		expect(mocks.insertWorkPeriod).not.toHaveBeenCalled();
		expect(mocks.rollback).toHaveBeenCalledOnce();
	});

	it('keeps corrections and deletions on the recorded period Employee', async () => {
		mocks.execute
			.mockResolvedValueOnce([[assignment()]])
			.mockResolvedValueOnce([
				[
					{
						project_team: JSON.stringify([{ user_id: 42 }]),
						project_activities_list: '[]',
					},
				],
			])
			.mockResolvedValueOnce([[assignment()]])
			.mockResolvedValueOnce([[assignment()]])
			.mockResolvedValueOnce([[assignment()]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([[assignment()]])
			.mockResolvedValueOnce([
				[
					{
						project_team: JSON.stringify([{ user_id: 42 }]),
						project_activities_list: '[]',
					},
				],
			])
			.mockResolvedValueOnce([[assignment()]])
			.mockResolvedValueOnce([[assignment()]])
			.mockResolvedValueOnce([[assignment()]])
			.mockResolvedValueOnce([{ affectedRows: 1 }]);

		const options = {
			db,
			actor,
			project,
			projectId: 7,
			id: 'period-1',
			manager: true,
			nowMs: Date.parse('2026-10-02T00:00:00+05:30'),
		};
		await updateWorkPeriodCommand({ ...options, input });
		await deleteWorkPeriodCommand(options);

		expect(mocks.lockWorkPeriodEmployee).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			9
		);
		expect(mocks.lockWorkPeriodEmployee).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			9
		);
		expect(mocks.updateWorkPeriod).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ employeeId: 9, assignmentId: 'assignment-1' })
		);
	});

	it('does not move a historical period to a mismatched assignment Employee', async () => {
		mocks.execute.mockResolvedValueOnce([[assignment(10)]]);

		await expect(
			updateWorkPeriodCommand({
				db,
				actor,
				project,
				projectId: 7,
				id: 'period-1',
				manager: true,
				nowMs: Date.parse('2026-10-02T00:00:00+05:30'),
				input,
			})
		).rejects.toEqual(expect.any(WorkPeriodCommandError));

		expect(mocks.beginTransaction).not.toHaveBeenCalled();
		expect(mocks.updateWorkPeriod).not.toHaveBeenCalled();
	});
});
