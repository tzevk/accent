import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockExecute, mockRelease, mockEnd, mockQuery } = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockRelease: vi.fn(),
	mockEnd: vi.fn(),
	mockQuery: vi.fn(),
}));

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn().mockResolvedValue({
		execute: mockExecute,
		release: mockRelease,
		end: mockEnd,
	}),
	query: (...args: unknown[]) => mockQuery(...args),
}));

let currentMockUser: Record<string, unknown> | null = null;

vi.mock('@/utils/api-permissions', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/utils/api-permissions')>();
	return {
		...actual,
		getCurrentUser: vi.fn().mockImplementation(async () => currentMockUser),
		ensurePermission: vi.fn().mockImplementation(async () => {
			if (!currentMockUser) {
				return NextResponse.json(
					{ success: false, error: 'Unauthorized' },
					{ status: 401 }
				);
			}
			return { authorized: true, user: currentMockUser };
		}),
		invalidateUserCache: vi.fn(),
		canModifyTargetUser: vi.fn().mockReturnValue({ allowed: true }),
		validateUserGrants: vi.fn().mockResolvedValue({ allowed: true }),
	};
});

describe('SEC-07 — Password Hash and Sensitive PII Leakage Protection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockReset();
		currentMockUser = {
			id: 1,
			username: 'admin',
			is_super_admin: 1,
			role_id: 1,
			role: { id: 1, hierarchy: 100 },
			merged_permissions: [
				'users:read',
				'users:create',
				'users:update',
				'users:delete',
				'employees:read',
				'employees:create',
				'employees:update',
				'employees:delete',
			],
		};
	});

	describe('User Endpoints — password_hash Exclusion', () => {
		it('GET /api/users never queries or returns password_hash', async () => {
			mockExecute.mockResolvedValueOnce([
				[
					{
						id: 10,
						username: 'alice',
						email: 'alice@example.com',
						full_name: 'Alice',
						is_active: 1,
						status: 'active',
					},
				],
			]); // SELECT users
			mockExecute.mockResolvedValueOnce([[{ total: 1 }]]); // COUNT

			const { GET } = await import('@/app/api/users/route');
			const req = new Request('http://localhost/api/users');
			const res = await GET(req);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data[0]).not.toHaveProperty('password_hash');

			const [sql] = mockExecute.mock.calls[0];
			expect(sql).not.toContain('u.*');
			expect(sql).not.toContain('password_hash');
		});

		it('POST /api/users never queries or returns password_hash', async () => {
			mockExecute.mockResolvedValueOnce([[]]); // check existing username/email
			mockExecute.mockResolvedValueOnce([
				[{ id: 1, department: 'Engineering' }],
			]); // role
			mockExecute.mockResolvedValueOnce([{ insertId: 25 }]); // INSERT
			mockExecute.mockResolvedValueOnce([
				[
					{
						id: 25,
						username: 'newuser',
						email: 'new@example.com',
						full_name: 'New User',
						is_active: 1,
						status: 'active',
					},
				],
			]); // SELECT created user

			const { POST } = await import('@/app/api/users/route');
			const req = new Request('http://localhost/api/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: 'newuser',
					password: 'secretPassword123',
					email: 'new@example.com',
					employee_id: 10,
				}),
			});

			const res = await POST(req);
			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.data).not.toHaveProperty('password_hash');

			const selectCreated = mockExecute.mock.calls.find(([sql]) =>
				String(sql).includes('WHERE u.id = ?')
			);
			expect(selectCreated).toBeDefined();
			expect(selectCreated[0]).not.toContain('u.*');
			expect(selectCreated[0]).not.toContain('password_hash');
		});

		it('PUT /api/users never queries or returns password_hash', async () => {
			mockExecute.mockResolvedValueOnce([[{ id: 25, role_id: 1 }]]); // existing user
			mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE
			mockExecute.mockResolvedValueOnce([
				[
					{
						id: 25,
						username: 'updated_user',
						email: 'up@example.com',
						full_name: 'Updated User',
					},
				],
			]); // SELECT updated user

			const { PUT } = await import('@/app/api/users/route');
			const req = new Request('http://localhost/api/users', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: 25,
					full_name: 'Updated User',
				}),
			});

			const res = await PUT(req);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data).not.toHaveProperty('password_hash');

			const selectUpdated = mockExecute.mock.calls.find(([sql]) =>
				String(sql).includes('FROM users WHERE id = ?')
			);
			expect(selectUpdated).toBeDefined();
			expect(selectUpdated[0]).not.toContain('SELECT *');
			expect(selectUpdated[0]).not.toContain('password_hash');
		});

		it('GET /api/users/[id] never queries or returns password_hash', async () => {
			mockExecute.mockResolvedValueOnce([
				[
					{
						id: 10,
						username: 'target',
						email: 'target@example.com',
						full_name: 'Target',
					},
				],
			]);

			const { GET } = await import('@/app/api/users/[id]/route');
			const req = new Request('http://localhost/api/users/10');
			const res = await GET(req, { params: Promise.resolve({ id: '10' }) });

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data).not.toHaveProperty('password_hash');

			const [sql] = mockExecute.mock.calls[0];
			expect(sql).not.toContain('u.*');
			expect(sql).not.toContain('password_hash');
		});

		it('GET /api/users/list never queries or returns password_hash', async () => {
			mockExecute.mockResolvedValueOnce([
				[
					{
						id: 10,
						username: 'alice',
						full_name: 'Alice',
					},
				],
			]); // users
			mockExecute.mockResolvedValueOnce([[{ total: 1 }]]); // count
			mockExecute.mockResolvedValueOnce([
				[{ total: 1, active: 1, inactive: 0, admins: 0 }],
			]); // stats

			const { GET } = await import('@/app/api/users/list/route');
			const req = new Request('http://localhost/api/users/list');
			const res = await GET(req);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data[0]).not.toHaveProperty('password_hash');

			const [sql] = mockExecute.mock.calls[0];
			expect(sql).not.toContain('u.*');
			expect(sql).not.toContain('password_hash');
		});
	});

	describe('Employee Endpoints — Bank, PAN, Aadhaar PII Protection', () => {
		it('GET /api/employees excludes bank_account_no, bank_ifsc, pan, aadhar in list queries', async () => {
			mockExecute.mockResolvedValueOnce([[{ total: 1 }]]); // COUNT
			mockExecute.mockResolvedValueOnce([
				[
					{
						id: 1,
						employee_id: 'ATS001',
						first_name: 'John',
						last_name: 'Doe',
						email: 'john@example.com',
						department: 'Engineering',
					},
				],
			]); // SELECT employees
			mockExecute.mockResolvedValueOnce([[{ department: 'Engineering' }]]); // departments
			mockExecute.mockResolvedValueOnce([[{ workplace: 'Office' }]]); // workplaces

			const { GET } = await import('@/app/api/employees/route');
			const req = new Request('http://localhost/api/employees');
			const res = await GET(req);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.employees[0]).not.toHaveProperty('bank_account_no');
			expect(body.employees[0]).not.toHaveProperty('bank_ifsc');
			expect(body.employees[0]).not.toHaveProperty('pan');
			expect(body.employees[0]).not.toHaveProperty('aadhar');

			const selectCall = mockExecute.mock.calls[1];
			const selectSql = selectCall[0];
			expect(selectSql).not.toContain('e.*');
			expect(selectSql).not.toContain('bank_account_no');
			expect(selectSql).not.toContain('aadhar');
		});

		it('GET /api/employees/list excludes bank_account_no, bank_ifsc, pan, aadhar in list queries', async () => {
			mockExecute.mockResolvedValueOnce([
				[
					{
						id: 1,
						employee_id: 'ATS001',
						first_name: 'John',
						last_name: 'Doe',
						email: 'john@example.com',
					},
				],
			]); // SELECT employees
			mockExecute.mockResolvedValueOnce([[{ total: 1 }]]); // count
			mockExecute.mockResolvedValueOnce([[{ department: 'Engineering' }]]); // departments
			mockExecute.mockResolvedValueOnce([[{ workplace: 'Office' }]]); // workplaces
			mockExecute.mockResolvedValueOnce([
				[{ total: 1, active: 1, inactive: 0, terminated: 0 }],
			]); // stats

			const { GET } = await import('@/app/api/employees/list/route');
			const req = new Request('http://localhost/api/employees/list');
			const res = await GET(req);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.employees[0]).not.toHaveProperty('bank_account_no');
			expect(body.employees[0]).not.toHaveProperty('bank_ifsc');
			expect(body.employees[0]).not.toHaveProperty('pan');
			expect(body.employees[0]).not.toHaveProperty('aadhar');

			const selectCall = mockExecute.mock.calls[0];
			expect(selectCall[0]).not.toContain('e.*');
			expect(selectCall[0]).not.toContain('bank_account_no');
			expect(selectCall[0]).not.toContain('aadhar');
		});

		it('GET /api/employees/[id] strips bank_account_no, pan, aadhar for non-payroll/non-privileged users', async () => {
			currentMockUser = {
				id: 8,
				username: 'regular_employee',
				is_super_admin: 0,
				employee_id: 88, // different employee ID
				merged_permissions: ['employees:read'], // lacks payroll:read
			};

			mockExecute.mockResolvedValueOnce([
				[
					{
						id: 99,
						employee_id: 'ATS099',
						first_name: 'Target',
						last_name: 'Colleague',
						email: 'target@example.com',
						bank_account_no: '123456789012',
						bank_ifsc: 'HDFC0001234',
						pan: 'ABCDE1234F',
						aadhar: '987654321098',
					},
				],
			]);

			const { GET } = await import('@/app/api/employees/[id]/route');
			const req = new Request('http://localhost/api/employees/99');
			const res = await GET(req, { params: Promise.resolve({ id: '99' }) });

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.first_name).toBe('Target');
			expect(body.data).not.toHaveProperty('bank_account_no');
			expect(body.data).not.toHaveProperty('bank_ifsc');
			expect(body.data).not.toHaveProperty('pan');
			expect(body.data).not.toHaveProperty('aadhar');
		});

		it('GET /api/employees/[id] preserves financial details when requested by super admin', async () => {
			currentMockUser = {
				id: 1,
				username: 'admin',
				is_super_admin: 1,
				merged_permissions: ['employees:read'],
			};

			mockExecute.mockResolvedValueOnce([
				[
					{
						id: 99,
						employee_id: 'ATS099',
						first_name: 'Target',
						last_name: 'Colleague',
						email: 'target@example.com',
						bank_account_no: '123456789012',
						bank_ifsc: 'HDFC0001234',
						pan: 'ABCDE1234F',
						aadhar: '987654321098',
					},
				],
			]);

			const { GET } = await import('@/app/api/employees/[id]/route');
			const req = new Request('http://localhost/api/employees/99');
			const res = await GET(req, { params: Promise.resolve({ id: '99' }) });

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.bank_account_no).toBe('123456789012');
			expect(body.data.pan).toBe('ABCDE1234F');
			expect(body.data.aadhar).toBe('987654321098');
		});

		it('GET /api/employees/[id] preserves financial details when employee views their own profile', async () => {
			currentMockUser = {
				id: 15,
				username: 'self_user',
				is_super_admin: 0,
				employee_id: 99, // matches employee ID
				merged_permissions: ['employees:read'],
			};

			mockExecute.mockResolvedValueOnce([
				[
					{
						id: 99,
						employee_id: 'ATS099',
						first_name: 'Self',
						last_name: 'User',
						email: 'self@example.com',
						bank_account_no: '123456789012',
						bank_ifsc: 'HDFC0001234',
						pan: 'ABCDE1234F',
						aadhar: '987654321098',
					},
				],
			]);

			const { GET } = await import('@/app/api/employees/[id]/route');
			const req = new Request('http://localhost/api/employees/99');
			const res = await GET(req, { params: Promise.resolve({ id: '99' }) });

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.bank_account_no).toBe('123456789012');
			expect(body.data.pan).toBe('ABCDE1234F');
		});
	});
});
