import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';
import { payrollAuditRows } from '../audit-rows';

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

/**
 * The audit entries the route wrote, with their columns named. This route
 * writes over the caller's pooled connection, so they live on its execute mock.
 */
const auditRows = () => payrollAuditRows(connection.execute);

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

		const [audit] = auditRows();
		expect(audit).toMatchObject({
			entityType: 'salary_profile',
			entityId: 61, // the row the INSERT created
			employeeId: 7,
			action: 'create',
			oldValues: null, // a create displaces nothing
		});
		expect(audit.newValues).toMatchObject({
			employee_id: 7,
			gross_salary: 60000,
			effective_from: '2026-09-01',
		});
		expect(audit.performedBy).toBe(3);
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

		const [audit] = auditRows();
		expect(audit).toMatchObject({
			entityType: 'salary_profile',
			entityId: 55,
			employeeId: 7,
			action: 'update',
		});
		// oldValues is the real prior row, free of the row's own history noise.
		expect(audit.oldValues).toEqual({
			id: 55,
			employee_id: 7,
			gross: 50000,
			gross_salary: 50000,
			basic: 30000,
			effective_from: '2026-04-01',
			effective_to: null,
			is_manual_override: 0,
		});
		expect(audit.newValues).toMatchObject({
			id: 55,
			gross_salary: 72000,
		});
		expect(audit.performedBy).toBe(3);
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

		const [audit] = auditRows();
		expect(audit).toMatchObject({
			entityId: 55,
			action: 'update',
			oldValues: { gross_salary: 50000 },
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
		expect(auditRows()).toHaveLength(0);
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

		const [audit] = auditRows();
		expect(audit).toMatchObject({
			entityType: 'salary_profile',
			entityId: 55,
			employeeId: 7,
			action: 'delete',
			newValues: null,
			oldValues: { gross_salary: 50000 },
		});
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
		expect(auditRows()).toHaveLength(0);
	});
});
