import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockExecute,
	mockBeginTransaction,
	mockCommit,
	mockRollback,
	mockRelease,
	mockValidateGrants,
	mockHashPassword,
} = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockBeginTransaction: vi.fn(),
	mockCommit: vi.fn(),
	mockRollback: vi.fn(),
	mockRelease: vi.fn(),
	mockValidateGrants: vi.fn(),
	mockHashPassword: vi.fn(),
}));

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn().mockResolvedValue({
		execute: mockExecute,
		beginTransaction: mockBeginTransaction,
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
		ensurePermission: vi
			.fn()
			.mockResolvedValue({ user: { id: 41 }, authorized: true }),
		validateUserGrants: mockValidateGrants,
	};
});
vi.mock('@/utils/password', () => ({ hashPassword: mockHashPassword }));

const creation = {
	username: 'new.employee',
	password: 'password',
	employee_id: 12,
	created_by: 999,
};

async function post(body = creation) {
	const { POST } = await import('@/app/api/users/route');
	return POST(
		new Request('http://localhost/api/users', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		})
	);
}

describe('POST /api/users account ownership', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockBeginTransaction.mockReset();
		mockCommit.mockReset();
		mockRollback.mockReset();
		mockRelease.mockReset();
		mockValidateGrants.mockReset();
		mockHashPassword.mockReset();
		mockValidateGrants.mockResolvedValue({ allowed: true });
		mockHashPassword.mockResolvedValue('hashed');
	});

	it('returns 409 and rolls back when an inactive account already owns the Employee', async () => {
		mockExecute
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([
				[{ id: 12, first_name: 'Ada', last_name: 'Lovelace' }],
			])
			.mockResolvedValueOnce([[{ id: 12 }]])
			.mockResolvedValueOnce([[{ id: 8 }]]);

		const response = await post();

		expect(response.status).toBe(409);
		expect(mockBeginTransaction).toHaveBeenCalledOnce();
		expect(mockRollback).toHaveBeenCalledOnce();
		expect(mockCommit).not.toHaveBeenCalled();
		expect(mockRelease).toHaveBeenCalledOnce();
	});
	it('rejects a non-number Employee ID before querying the database', async () => {
		const response = await post({
			...creation,
			employee_id: '12' as unknown as number,
		});

		expect(response.status).toBe(400);
		expect(mockExecute).not.toHaveBeenCalled();
		expect(mockHashPassword).not.toHaveBeenCalled();
	});

	it('rejects an Employee that is missing or deleted before account creation', async () => {
		mockExecute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);

		const response = await post();

		expect(response.status).toBe(400);
		expect(mockHashPassword).not.toHaveBeenCalled();
		expect(mockBeginTransaction).not.toHaveBeenCalled();
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});

	it('rolls back when an Employee is deleted before its transaction lock is acquired', async () => {
		mockExecute
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([
				[{ id: 12, first_name: 'Ada', last_name: 'Lovelace' }],
			])
			.mockResolvedValueOnce([[]]);

		const response = await post();

		expect(response.status).toBe(400);
		expect(mockBeginTransaction).toHaveBeenCalledOnce();
		expect(mockExecute).toHaveBeenCalledTimes(3);
		expect(mockRollback).toHaveBeenCalledOnce();
		expect(mockCommit).not.toHaveBeenCalled();
		expect(mockRelease).toHaveBeenCalledOnce();
	});

	it('preserves grant authorization and denies a disallowed creation', async () => {
		mockValidateGrants.mockResolvedValue({
			allowed: false,
			reason: 'Insufficient grants',
		});

		const response = await post();

		expect(response.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
		expect(mockHashPassword).not.toHaveBeenCalled();
		expect(mockRelease).toHaveBeenCalledOnce();
	});

	it('rolls back and releases the connection when insertion fails', async () => {
		mockExecute
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([
				[{ id: 12, first_name: 'Ada', last_name: 'Lovelace' }],
			])
			.mockResolvedValueOnce([[{ id: 12 }]])
			.mockResolvedValueOnce([[]])
			.mockRejectedValueOnce(new Error('insert failed'));

		const response = await post();

		expect(response.status).toBe(500);
		expect(mockRollback).toHaveBeenCalledOnce();
		expect(mockRelease).toHaveBeenCalledOnce();
	});

	it('uses the authenticated actor for created_by and returns success only after commit', async () => {
		mockExecute
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([
				[{ id: 12, first_name: 'Ada', last_name: 'Lovelace' }],
			])
			.mockResolvedValueOnce([[{ id: 12 }]])
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([{ insertId: 15 }])
			.mockResolvedValueOnce([[{ id: 15, username: 'new.employee' }]]);

		const response = await post();

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toMatchObject({
			success: true,
			data: { id: 15, username: 'new.employee' },
		});
		const insert = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO users')
		);
		expect(insert?.[1]?.[10]).toBe(41);
		expect(mockCommit).toHaveBeenCalledOnce();
		expect(mockRollback).not.toHaveBeenCalled();
	});
});
