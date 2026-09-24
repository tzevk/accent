import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: { PAYROLL: 'payroll', EMPLOYEES: 'employees' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const { POST, DELETE } = await import('@/app/api/payroll/salary-profile/route');

const grant = grantFor(mocks.mockEnsurePermission);

/**
 * `grant()` authorizes without a user, and the audit trail must name a real
 * performer — so give the mocked gate a session user for the write tests.
 */
const signedInAs = (id: number) =>
	mocks.mockEnsurePermission.mockImplementation(async () => ({
		authorized: true,
		user: { id },
	}));

const connection = {
	query: vi.fn(),
	execute: vi.fn(),
	release: vi.fn(),
};

/** The profile as it stood before the edit. */
const PRIOR_PROFILE = {
	id: 55,
	employee_id: 7,
	gross: 50000,
	gross_salary: 50000,
	basic: 30000,
	effective_from: '2026-04-01',
	effective_to: null,
	is_manual_override: 0,
	created_at: '2026-04-01 09:00:00',
	updated_at: '2026-04-01 09:00:00',
};

const rows = (result: unknown[]) => [result, undefined];

const jsonRequest = (body: unknown) =>
	new Request('http://localhost/api/payroll/salary-profile', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

/** The audit INSERT the route made — it writes over the caller's connection. */
const auditInsert = () =>
	connection.execute.mock.calls.find(([sql]) =>
		String(sql).includes('INSERT INTO payroll_audit_logs')
	);

describe('salary-profile API — edits are audited (issue #243)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(connection);
		connection.query.mockResolvedValue([[], undefined]);
		connection.execute.mockResolvedValue([[], undefined]);
	});

	it('denies a caller without payroll:update', async () => {
		grant();

		const res = await POST(
			jsonRequest({ employee_id: 7, gross_salary: 60000 })
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('denies an employees-only caller: a pay agreement is payroll data', async () => {
		grant('employees:update');

		const res = await POST(
			jsonRequest({ employee_id: 7, gross_salary: 60000 })
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('audits a new Salary Profile as a create, attributed to the session user', async () => {
		grant('payroll:update');
		signedInAs(3);
		connection.query
			.mockResolvedValueOnce(rows([{ id: 7 }])) // the employee exists
			.mockResolvedValueOnce(rows([])) // no profile for that effective_from
			.mockResolvedValueOnce(rows({ insertId: 61, affectedRows: 1 }));

		const res = await POST(
			jsonRequest({
				employee_id: 7,
				gross_salary: 60000,
				effective_from: '2026-09-01',
			})
		);

		expect(res.status).toBe(200);
		expect((await res.json()).success).toBe(true);

		const insert = auditInsert();
		expect(insert).toBeDefined();
		const [, params] = insert!;
		expect(params[0]).toBe('salary_profile');
		expect(params[1]).toBe(61); // the row the INSERT created
		expect(params[2]).toBe(7); // employee_id
		expect(params[3]).toBe('create');
		expect(params[4]).toBeNull(); // a create displaces nothing
		expect(JSON.parse(params[5] as string)).toMatchObject({
			employee_id: 7,
			gross_salary: 60000,
			effective_from: '2026-09-01',
		});
		expect(params[9]).toBe(3);
	});

	it('audits an edit with the gross and flags it displaced', async () => {
		grant('payroll:update');
		signedInAs(3);
		connection.query
			.mockResolvedValueOnce(rows([{ id: 7 }]))
			.mockResolvedValueOnce(rows([PRIOR_PROFILE])) // read before the UPDATE
			.mockResolvedValueOnce(rows({ affectedRows: 1 }));

		const res = await POST(
			jsonRequest({ id: 55, employee_id: 7, gross_salary: 72000 })
		);

		expect(res.status).toBe(200);

		const [, params] = auditInsert()!;
		expect(params[0]).toBe('salary_profile');
		expect(params[1]).toBe(55);
		expect(params[2]).toBe(7);
		expect(params[3]).toBe('update');
		// old_values is the real prior row, free of the row's own history noise.
		expect(JSON.parse(params[4] as string)).toEqual({
			id: 55,
			employee_id: 7,
			gross: 50000,
			gross_salary: 50000,
			basic: 30000,
			effective_from: '2026-04-01',
			effective_to: null,
			is_manual_override: 0,
		});
		expect(JSON.parse(params[5] as string)).toMatchObject({
			id: 55,
			gross_salary: 72000,
		});
		expect(params[9]).toBe(3);
	});

	it('audits the existing profile an employee+effective_from save overwrote', async () => {
		grant('payroll:update');
		signedInAs(3);
		connection.query
			.mockResolvedValueOnce(rows([{ id: 7 }]))
			.mockResolvedValueOnce(rows([PRIOR_PROFILE])) // the reused lookup
			.mockResolvedValueOnce(rows({ affectedRows: 1 }));

		const res = await POST(
			jsonRequest({
				employee_id: 7,
				gross_salary: 72000,
				effective_from: '2026-04-01',
			})
		);

		expect(res.status).toBe(200);
		// Only one lookup happens before the UPDATE, and that read is what the
		// audit trail records.
		const lookups = connection.query.mock.calls.filter(([sql]) =>
			String(sql).includes('SELECT * FROM employee_salary_profile')
		);
		expect(lookups).toHaveLength(1);

		const [, params] = auditInsert()!;
		expect(params[1]).toBe(55);
		expect(params[3]).toBe('update');
		expect(JSON.parse(params[4] as string)).toMatchObject({
			gross_salary: 50000,
		});
	});

	it('writes no entry when the id matched nothing to update', async () => {
		grant('payroll:update');
		signedInAs(3);
		connection.query
			.mockResolvedValueOnce(rows([{ id: 7 }]))
			.mockResolvedValueOnce(rows([])) // the profile does not exist
			.mockResolvedValueOnce(rows({ affectedRows: 0 }));

		const res = await POST(
			jsonRequest({ id: 999, employee_id: 7, gross_salary: 72000 })
		);

		// Existing response contract is untouched; there is simply nothing that
		// was mutated to attribute.
		expect(res.status).toBe(200);
		expect(auditInsert()).toBeUndefined();
	});

	it('audits the profile it deleted', async () => {
		grant('payroll:delete');
		signedInAs(3);
		connection.query
			.mockResolvedValueOnce(rows([PRIOR_PROFILE])) // read before the DELETE
			.mockResolvedValueOnce(rows({ affectedRows: 1 }));

		const res = await DELETE(
			new Request('http://localhost/api/payroll/salary-profile?id=55', {
				method: 'DELETE',
			})
		);

		expect(res.status).toBe(200);

		const [, params] = auditInsert()!;
		expect(params[0]).toBe('salary_profile');
		expect(params[1]).toBe(55);
		expect(params[2]).toBe(7);
		expect(params[3]).toBe('delete');
		expect(JSON.parse(params[4] as string)).toMatchObject({
			gross_salary: 50000,
		});
		expect(params[5]).toBeNull();
	});

	it('writes no entry for a delete that removed nothing', async () => {
		grant('payroll:delete');
		signedInAs(3);
		connection.query
			.mockResolvedValueOnce(rows([]))
			.mockResolvedValueOnce(rows({ affectedRows: 0 }));

		const res = await DELETE(
			new Request('http://localhost/api/payroll/salary-profile?id=999', {
				method: 'DELETE',
			})
		);

		expect(res.status).toBe(404);
		expect(auditInsert()).toBeUndefined();
	});
});
