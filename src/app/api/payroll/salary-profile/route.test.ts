import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { SALARY_WRITE_ISOLATION } from '@/lib/salary-write-isolation';

const mocks = vi.hoisted(() => ({
	mockEnsurePermission: vi.fn(),
	mockWithDb: vi.fn(),
	mockWithTransaction: vi.fn(),
	mockRunSalaryCommand: vi.fn(),
	mockReadSalaryTimeline: vi.fn(),
	mockGetPermissionsFor: vi.fn(),
}));

vi.mock('@/utils/database', () => ({
	withDb: mocks.mockWithDb,
	withTransaction: mocks.mockWithTransaction,
}));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: { PAYROLL: 'payroll' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));
vi.mock('@/utils/permissions', () => ({
	getPermissionsFor: mocks.mockGetPermissionsFor,
}));
vi.mock('@/lib/salary-profile-commands', () => ({
	runSalaryCommand: mocks.mockRunSalaryCommand,
	readSalaryTimeline: mocks.mockReadSalaryTimeline,
}));

// Dynamic import after the hoisted mocks: the repository's payroll route tests
// use this to guarantee the route module sees its faked collaborators.
const { POST, GET } = await import('@/app/api/payroll/salary-profile/route');

const connection = { execute: vi.fn() };

const TIMELINE = {
	employee: { id: 11, employee_code: 'EMP011', full_name: 'Asha Rao' },
	server_date: '2026-11-15',
	as_of: '2026-11-15',
	month: '2026-11-01',
	timeline_version: 5,
	permissions: { can_read: true, can_update: true, can_delete: false },
	use: {
		used: true,
		ambiguous: false,
		unknown_history: false,
		months: ['2026-11-01'],
		ambiguous_months: [],
		agreements: [],
	},
	basis: {
		month: '2026-11-01',
		working_days: 22,
		std_hours_per_day: 8,
		basis_hours: 176,
		std_hours_source: 'agreement',
	},
	leave_usage: {
		as_of: '2026-11-15',
		year: 2026,
		month: '2026-11-01',
		pl_total: 21,
		used: 2,
		month_used: 0,
		balance: 19,
		months_recorded: 1,
		source: 'employee_attendance_summary',
	},
	agreements: [],
	current: {
		state: 'selected',
		agreement_source: 'employee_salary_profile',
		agreement_id: 71,
		agreement_ids: [],
	},
	legacy_current: {
		state: 'unavailable',
		agreement_source: null,
		agreement_id: null,
		agreement_ids: [],
	},
};

const signedInAs = (id = 9) =>
	mocks.mockEnsurePermission.mockImplementation(async () => ({
		authorized: true,
		user: { id },
	}));

const jsonRequest = (body: unknown) =>
	new Request('http://localhost/api/payroll/salary-profile', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

describe('salary-profile route — command mapping (issue #437)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockWithDb.mockImplementation(async (fn: (db: unknown) => unknown) =>
			fn(connection)
		);
		mocks.mockWithTransaction.mockImplementation(
			async (fn: (db: unknown) => unknown) => fn(connection)
		);
		signedInAs();
		mocks.mockGetPermissionsFor.mockReturnValue(['read', 'update', 'delete']);
		mocks.mockRunSalaryCommand.mockResolvedValue({
			ok: true,
			operation: 'correct',
			agreement_id: 71,
			timeline_version: 5,
			classification: 'current',
			effective_from: '2026-11-01',
			effective_to: null,
		});
		mocks.mockReadSalaryTimeline.mockResolvedValue({
			ok: true,
			timeline: TIMELINE,
		});
	});

	it('denies a caller without payroll:update', async () => {
		mocks.mockEnsurePermission.mockResolvedValue(
			NextResponse.json(
				{ success: false, error: 'Forbidden: missing permission' },
				{ status: 403 }
			)
		);

		const response = await POST(
			jsonRequest({ operation: 'correct', employee_id: 11 })
		);

		expect(response.status).toBe(403);
		expect(mocks.mockWithTransaction).not.toHaveBeenCalled();
	});

	it('requires payroll:delete for cancellation', async () => {
		mocks.mockEnsurePermission.mockImplementation(
			async (_request: Request, _resource: string, permission: string) =>
				permission === 'update'
					? NextResponse.json(
							{ success: false, error: 'Forbidden' },
							{ status: 403 }
						)
					: { authorized: true, user: { id: 9 } }
		);
		mocks.mockRunSalaryCommand.mockResolvedValue({
			ok: true,
			operation: 'cancel',
			agreement_id: 72,
			timeline_version: 6,
			classification: 'cancelled',
			effective_from: '2026-12-01',
			effective_to: null,
		});

		const response = await POST(
			jsonRequest({
				operation: 'cancel',
				employee_id: 11,
				agreement_id: 72,
				expected_timeline_version: 5,
			})
		);

		expect(response.status).toBe(200);
		expect(mocks.mockEnsurePermission).toHaveBeenCalledWith(
			expect.any(Request),
			'payroll',
			'delete'
		);
	});

	it('uses the authenticated actor, never request actor fields, and returns the command DTO', async () => {
		const response = await POST(
			jsonRequest({
				operation: 'correct',
				employee_id: 11,
				agreement_id: 71,
				expected_timeline_version: 4,
				effective_from: '2026-11-01',
				employer_cost: 27500,
				std_hours_per_day: 8,
				performed_by: 999,
				actor_id: 444,
			})
		);

		expect(response.status).toBe(200);
		expect(mocks.mockWithTransaction).toHaveBeenCalledWith(
			expect.any(Function),
			{ isolation: SALARY_WRITE_ISOLATION }
		);
		expect(mocks.mockEnsurePermission).toHaveBeenCalledWith(
			expect.any(Request),
			'payroll',
			'update'
		);
		expect(mocks.mockRunSalaryCommand).toHaveBeenCalledWith(
			connection,
			expect.objectContaining({
				operation: 'correct',
				employee_id: 11,
				agreement_id: 71,
			}),
			{ actorId: 9 }
		);
		const body = await response.json();
		expect(body).toEqual({
			success: true,
			data: {
				operation: 'correct',
				agreement_id: 71,
				timeline_version: 5,
				classification: 'current',
				effective_from: '2026-11-01',
				effective_to: null,
			},
		});
	});

	it('maps core conflicts to their HTTP status, code and details', async () => {
		mocks.mockRunSalaryCommand.mockResolvedValue({
			ok: false,
			code: 'date_conflict',
			status: 409,
			message: 'Another agreement already starts on this date',
			details: { effective_from: '2026-12-01' },
		});

		const response = await POST(
			jsonRequest({
				operation: 'revise',
				employee_id: 11,
				agreement_id: 71,
				expected_timeline_version: 4,
				effective_from: '2026-12-01',
				employer_cost: 30000,
				std_hours_per_day: 8,
			})
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			success: false,
			error: 'Another agreement already starts on this date',
			code: 'date_conflict',
			details: { effective_from: '2026-12-01' },
		});
	});

	it('rejects an unknown operation and malformed JSON before opening a transaction', async () => {
		const unknown = await POST(jsonRequest({ operation: 'delete' }));
		expect(unknown.status).toBe(400);

		const malformed = await POST(
			new Request('http://localhost/api/payroll/salary-profile', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{',
			})
		);
		expect(malformed.status).toBe(400);
		expect(mocks.mockWithTransaction).not.toHaveBeenCalled();
	});

	it('refuses a write when the session has no performer identity', async () => {
		mocks.mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: null,
		});

		const response = await POST(
			jsonRequest({ operation: 'correct', employee_id: 11 })
		);

		expect(response.status).toBe(401);
		expect(mocks.mockWithTransaction).not.toHaveBeenCalled();
	});
});

describe('salary-profile route — payroll-authorized timeline read (issue #437)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockWithDb.mockImplementation(async (fn: (db: unknown) => unknown) =>
			fn(connection)
		);
		mocks.mockWithTransaction.mockImplementation(
			async (fn: (db: unknown) => unknown) => fn(connection)
		);
		signedInAs();
		mocks.mockGetPermissionsFor.mockReturnValue(['read', 'update']);
		mocks.mockReadSalaryTimeline.mockResolvedValue({
			ok: true,
			timeline: TIMELINE,
		});
	});

	const getRequest = (query: string) =>
		new Request(`http://localhost/api/payroll/salary-profile?${query}`);

	it('returns the timeline and passes session-derived permissions to the reader', async () => {
		const response = await GET(
			getRequest('employee_id=11&date=2026-11-15&month=2026-11')
		);

		expect(response.status).toBe(200);
		expect(mocks.mockEnsurePermission).toHaveBeenCalledWith(
			expect.any(Request),
			'payroll',
			'read'
		);
		expect(mocks.mockReadSalaryTimeline).toHaveBeenCalledWith(connection, 11, {
			asOf: '2026-11-15',
			month: '2026-11',
			permissions: { update: true, delete: false },
		});
		await expect(response.json()).resolves.toEqual({
			success: true,
			data: TIMELINE,
		});
	});

	it('denies a payroll-only reader without payroll:read', async () => {
		mocks.mockEnsurePermission.mockResolvedValue(
			NextResponse.json(
				{ success: false, error: 'Forbidden: missing permission' },
				{ status: 403 }
			)
		);

		const response = await GET(getRequest('employee_id=11'));

		expect(response.status).toBe(403);
		expect(mocks.mockWithDb).not.toHaveBeenCalled();
	});

	it('rejects a missing or malformed employee id', async () => {
		const missing = await GET(getRequest(''));
		expect(missing.status).toBe(400);

		const malformed = await GET(getRequest('employee_id=abc'));
		expect(malformed.status).toBe(400);
		expect(mocks.mockWithDb).not.toHaveBeenCalled();
	});

	it('maps a missing Employee to 404', async () => {
		mocks.mockReadSalaryTimeline.mockResolvedValue({
			ok: false,
			code: 'employee_not_found',
			status: 404,
			message: 'Employee 11 does not exist',
		});

		const response = await GET(getRequest('employee_id=11'));

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			success: false,
			error: 'Employee 11 does not exist',
			code: 'employee_not_found',
		});
	});
});
