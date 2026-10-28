import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/users/[id]/employee-link-repair/route';

const {
	mockExecute,
	mockBegin,
	mockCommit,
	mockRollback,
	mockRelease,
	mockEnsurePermission,
	mockRevoke,
	mockInvalidate,
} = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockBegin: vi.fn(),
	mockCommit: vi.fn(),
	mockRollback: vi.fn(),
	mockRelease: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockRevoke: vi.fn(),
	mockInvalidate: vi.fn(),
}));

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn().mockResolvedValue({
		execute: mockExecute,
		beginTransaction: mockBegin,
		commit: mockCommit,
		rollback: mockRollback,
		release: mockRelease,
	}),
}));
vi.mock('@/utils/api-permissions', async () => {
	const actual = await vi.importActual<
		typeof import('@/utils/api-permissions')
	>('@/utils/api-permissions');
	return {
		...actual,
		ensurePermission: mockEnsurePermission,
		invalidateUserCache: mockInvalidate,
	};
});
vi.mock('@/utils/session', () => ({ revokeAllUserSessions: mockRevoke }));

const actor = { id: 41, is_super_admin: true };
const target = {
	id: 8,
	employee_id: null,
	vendor_id: null,
	account_type: 'employee',
	status: 'inactive',
	is_active: 0,
	is_super_admin: 0,
	role_hierarchy: 1,
};

function request(body: unknown) {
	return new Request('http://localhost/api/users/8/employee-link-repair', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

async function post(
	body: unknown = { employee_id: 12, reason: 'Correcting an erroneous link' },
	id = '8'
) {
	return POST(request(body), { params: Promise.resolve({ id }) });
}

function setSuccessfulDatabaseReplies() {
	mockExecute.mockImplementation(async (sql: string) => {
		if (sql.includes('FROM users u')) return [[target]];
		if (sql.includes('FROM employees')) return [[{ id: 12 }]];
		if (sql.includes('SELECT id FROM users')) return [[]];
		if (
			sql.includes('FROM user_activity_assignments') ||
			sql.includes('FROM work_logs') ||
			sql.includes('FROM user_work_sessions') ||
			sql.includes('FROM user_activity_logs') ||
			sql.includes('FROM user_screen_time') ||
			sql.includes('FROM user_work_logs')
		)
			return [[]];
		return [{ affectedRows: 1 }];
	});
}

describe('POST /api/users/[id]/employee-link-repair', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnsurePermission.mockResolvedValue({ user: actor });
		mockExecute.mockReset();
		mockBegin.mockResolvedValue(undefined);
		mockCommit.mockResolvedValue(undefined);
		mockRollback.mockResolvedValue(undefined);
		mockRelease.mockReturnValue(undefined);
		mockRevoke.mockResolvedValue(undefined);
	});

	it('updates an inactive unused account and records the authenticated actor and reason atomically', async () => {
		setSuccessfulDatabaseReplies();

		const response = await post();

		expect(response.status).toBe(200);
		expect(mockBegin).toHaveBeenCalledOnce();
		expect(mockCommit).toHaveBeenCalledOnce();
		expect(mockRollback).not.toHaveBeenCalled();
		const audit = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_account_link_repairs')
		);
		expect(audit?.[1]).toEqual([
			8,
			41,
			null,
			12,
			'Correcting an erroneous link',
		]);
		expect(mockRevoke).toHaveBeenCalledWith(expect.anything(), 8);
		expect(mockInvalidate).toHaveBeenCalledWith(8);
	});

	it('rejects missing reason and malformed Employee IDs before connecting', async () => {
		const missingReason = await post({ employee_id: 12 });
		const badId = await post({ employee_id: '12', reason: 'Correction' });

		expect(missingReason.status).toBe(400);
		expect(badId.status).toBe(400);
		expect(mockBegin).not.toHaveBeenCalled();
	});

	it('rejects non-super-admin callers before connecting', async () => {
		mockEnsurePermission.mockResolvedValue({
			user: { id: 41, is_super_admin: false },
		});

		const response = await post();

		expect(response.status).toBe(403);
		expect(mockBegin).not.toHaveBeenCalled();
	});

	it('rejects a duplicate destination without changing the link or writing audit', async () => {
		mockExecute
			.mockResolvedValueOnce([[target]])
			.mockResolvedValueOnce([[{ id: 12 }]])
			.mockResolvedValueOnce([[{ id: 9 }]]);

		const response = await post();

		expect(response.status).toBe(409);
		expect(mockRollback).toHaveBeenCalledOnce();
		expect(mockCommit).not.toHaveBeenCalled();
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE users')
			)
		).toBe(false);
	});

	it('rejects history-bearing and active accounts without mutation', async () => {
		setSuccessfulDatabaseReplies();
		mockExecute.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM users u')) return [[target]];
			if (sql.includes('FROM employees')) return [[{ id: 12 }]];
			if (sql.includes('SELECT id FROM users')) return [[]];
			if (sql.includes('FROM user_activity_assignments')) return [[{ id: 4 }]];
			return [{ affectedRows: 1 }];
		});

		const historyResponse = await post();
		expect(historyResponse.status).toBe(409);
		expect(mockRollback).toHaveBeenCalledOnce();
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE users')
			)
		).toBe(false);

		vi.clearAllMocks();
		mockExecute.mockReset();
		mockEnsurePermission.mockResolvedValue({ user: actor });
		mockBegin.mockResolvedValue(undefined);
		mockRollback.mockResolvedValue(undefined);
		mockExecute.mockResolvedValueOnce([
			[{ ...target, status: 'active', is_active: 1 }],
		]);
		const activeResponse = await post();
		expect(activeResponse.status).toBe(409);
		expect(mockRollback).toHaveBeenCalledOnce();
	});

	it.each(['user_screen_time', 'user_work_logs'])(
		'rejects a history-bearing account with only %s records without changing the link or writing audit',
		async (historyTable) => {
			mockExecute.mockImplementation(async (sql: string) => {
				if (sql.includes('FROM users u')) return [[target]];
				if (sql.includes('FROM employees')) return [[{ id: 12 }]];
				if (sql.includes('SELECT id FROM users')) return [[]];
				if (sql.includes(`FROM ${historyTable}`)) return [[{ id: 4 }]];
				if (
					sql.includes('FROM user_activity_assignments') ||
					sql.includes('FROM work_logs') ||
					sql.includes('FROM user_work_sessions') ||
					sql.includes('FROM user_activity_logs') ||
					sql.includes('FROM user_screen_time') ||
					sql.includes('FROM user_work_logs')
				)
					return [[]];
				return [{ affectedRows: 1 }];
			});

			const response = await post();

			expect(response.status).toBe(409);
			expect(mockRollback).toHaveBeenCalledOnce();
			expect(mockCommit).not.toHaveBeenCalled();
			expect(
				mockExecute.mock.calls.some(([sql]) =>
					String(sql).startsWith('UPDATE users')
				)
			).toBe(false);
			expect(
				mockExecute.mock.calls.some(([sql]) =>
					String(sql).includes('INSERT INTO user_account_link_repairs')
				)
			).toBe(false);
		}
	);
	it('fails closed when a history source cannot be read', async () => {
		mockExecute.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM users u')) return [[target]];
			if (sql.includes('FROM employees')) return [[{ id: 12 }]];
			if (sql.includes('SELECT id FROM users')) return [[]];
			if (sql.includes('FROM user_activity_assignments'))
				throw new Error('history table unavailable');
			return [[]];
		});

		const response = await post();

		expect(response.status).toBe(409);
		expect(mockRollback).toHaveBeenCalledOnce();
		expect(mockCommit).not.toHaveBeenCalled();
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE users')
			)
		).toBe(false);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).includes('INSERT INTO user_account_link_repairs')
			)
		).toBe(false);
	});

	it('rolls back when audit insertion fails', async () => {
		mockExecute.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM users u')) return [[target]];
			if (sql.includes('FROM employees')) return [[{ id: 12 }]];
			if (sql.includes('SELECT id FROM users')) return [[]];
			if (
				sql.includes('FROM user_activity_assignments') ||
				sql.includes('FROM work_logs') ||
				sql.includes('FROM user_work_sessions') ||
				sql.includes('FROM user_activity_logs') ||
				sql.includes('FROM user_screen_time') ||
				sql.includes('FROM user_work_logs')
			)
				return [[]];
			if (sql.includes('INSERT INTO user_account_link_repairs'))
				throw new Error('audit unavailable');
			return [{ affectedRows: 1 }];
		});

		const response = await post();

		expect(response.status).toBe(409);
		expect(mockRollback).toHaveBeenCalledOnce();
		expect(mockCommit).not.toHaveBeenCalled();
	});
});
