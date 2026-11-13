import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';
import { payrollAuditRows } from '../audit-rows';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockExecute: vi.fn(),
}));

vi.mock('@/utils/database', () => ({
	dbConnect: mocks.mockDbConnect,
	withTransaction: vi.fn(),
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

const { GET, PUT, DELETE } = await import('@/app/api/payroll/slips/route');

const grant = grantFor(mocks.mockEnsurePermission);

/** SQL strings the route handed to the mocked connection, in call order. */
const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

const slipped = (rows: unknown[]) => [rows, undefined];

/** UPDATE/DELETE result: mysql2 hands back a ResultSetHeader, not rows. */
const affected = (count: number) => [{ affectedRows: count }, undefined];

/** The audit entries the route wrote, with their columns named. */
const auditRows = () => payrollAuditRows(mocks.mockExecute);

describe('payroll slips API — single-slip read (issue #240)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	it('denies a caller without payroll:read', async () => {
		grant('employees:read');

		const res = await GET(new Request('http://localhost/api/payroll/slips'));

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('returns the slip whose id was asked for, and no other slip', async () => {
		grant('payroll:read');
		const slip = {
			id: 42,
			month: '2026-08-01',
			employee_id: 7,
			employee_name: 'Asha Rao',
			net_pay: '48250.00',
		};
		mocks.mockExecute.mockResolvedValue([[slip], undefined]);

		const res = await GET(
			new Request('http://localhost/api/payroll/slips?id=42')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].id).toBe(42);
		// The id must reach the query — otherwise the route would return the
		// whole table and the caller's slip id would be ignored.
		const [sql, params] = mocks.mockExecute.mock.calls[0];
		expect(String(sql)).toContain('ps.id = ?');
		expect(params).toContain('42');
	});

	it('resolves the month-scheduled DA when only a slip id is given', async () => {
		grant('payroll:read');
		mocks.mockExecute
			.mockResolvedValueOnce([
				[
					{
						id: 42,
						month: '2026-08-01',
						employee_id: 7,
						name: 'Asha Rao',
						profile_basic: 60000,
						basic: 50000,
						da_used: 0,
					},
				],
				undefined,
			])
			.mockResolvedValueOnce([
				[{ value_type: 'fixed', value: 2500 }],
				undefined,
			]);

		const res = await GET(
			new Request('http://localhost/api/payroll/slips?id=42')
		);

		const body = await res.json();
		// Same normalization the month listing applies: Basic/DA must not depend
		// on whether the caller asked by id or by month. The slip's own Basic+DA
		// (50000 + 0) stands, and the month's rate only moves the split.
		expect(body.data[0].da).toBe(2500);
		expect(body.data[0].basic).toBe(47500);
		expect(body.data[0].basic_plus_da_source).toBe(50000);
		const daLookup = mocks.mockExecute.mock.calls[1];
		expect(String(daLookup[0])).toContain('FROM payroll_schedules');
		expect(daLookup[1]).toContain('2026-08-01');
	});

	it('still lists a month when no id is given', async () => {
		grant('payroll:read');
		mocks.mockExecute.mockResolvedValue([
			[
				{ id: 1, month: '2026-08-01' },
				{ id: 2, month: '2026-08-01' },
			],
			undefined,
		]);

		const res = await GET(
			new Request('http://localhost/api/payroll/slips?month=2026-08-01')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		const [sql, params] = mocks.mockExecute.mock.calls[0];
		expect(String(sql)).toContain('ps.month = ?');
		expect(String(sql)).not.toContain('ps.id = ?');
		expect(params).toContain('2026-08-01');
	});
});

describe('payroll slips API — deletion cannot strip a locked month (issue #242)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	const deleteRequest = (query: string) =>
		new Request(`http://localhost/api/payroll/slips${query}`, {
			method: 'DELETE',
		});

	const DRAFT_RUN = {
		id: 7,
		month: 8,
		year: 2026,
		run_number: 1,
		status: 'draft',
	};

	it('denies a caller without payroll:delete', async () => {
		grant('payroll:read');

		const res = await DELETE(deleteRequest('?id=5'));

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('deletes a slip whose month has no Payroll Run', async () => {
		grant('payroll:delete');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ month: '2026-08-01' }])) // the slip
			.mockResolvedValueOnce(slipped([])) // month was never generated
			.mockResolvedValueOnce(affected(1));

		const res = await DELETE(deleteRequest('?id=5'));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(true);
	});

	it('deletes a slip whose month is still a draft run', async () => {
		grant('payroll:delete');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ month: '2026-08-01' }]))
			.mockResolvedValueOnce(slipped([DRAFT_RUN]))
			.mockResolvedValueOnce(affected(1));

		const res = await DELETE(deleteRequest('?id=5'));

		expect(res.status).toBe(200);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(true);
	});

	it('refuses to delete a slip in a finalized month', async () => {
		grant('payroll:delete');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([{ month: '2026-08-01' }]))
			.mockResolvedValueOnce(slipped([{ ...DRAFT_RUN, status: 'finalized' }]));

		const res = await DELETE(deleteRequest('?id=5'));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/locked/i);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(false);
	});

	it('404s a slip id that does not exist, without deleting', async () => {
		grant('payroll:delete');
		mocks.mockExecute.mockResolvedValueOnce(slipped([]));

		const res = await DELETE(deleteRequest('?id=999'));

		expect(res.status).toBe(404);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(false);
	});

	it('refuses the bulk wipe while any month is locked', async () => {
		grant('payroll:delete');
		mocks.mockExecute.mockResolvedValueOnce(
			slipped([{ ...DRAFT_RUN, status: 'finalized' }])
		);

		const res = await DELETE(deleteRequest('?all=true'));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toMatch(/locked/i);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(false);
	});

	it('allows the bulk wipe when no month is locked, auditing every slip it erased', async () => {
		mocks.mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 9 },
		});
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([])) // no locked run anywhere
			.mockResolvedValueOnce(
				slipped([
					{
						id: 1,
						employee_id: 11,
						month: '2026-08-01',
						payment_status: 'pending',
					},
					{
						id: 2,
						employee_id: 12,
						month: '2026-08-01',
						payment_status: 'paid',
					},
				])
			)
			.mockResolvedValueOnce(affected(2));

		const res = await DELETE(deleteRequest('?all=true'));

		expect(res.status).toBe(200);
		expect(
			statements().some((sql) => sql.includes('DELETE FROM payroll_slips'))
		).toBe(true);

		// Deleting payroll history is a mutation like any other: once the rows are
		// gone, these entries are the only record of what they held.
		const audits = mocks.mockExecute.mock.calls.filter(([sql]) =>
			String(sql).includes('INSERT INTO payroll_audit_logs')
		);
		expect(audits).toHaveLength(2);
		expect(audits.map(([, params]) => params[1])).toEqual([1, 2]);
		expect(audits.map(([, params]) => params[3])).toEqual(['delete', 'delete']);
		expect(audits[0][1][9]).toBe(9);
	});

	it('audits the slip it deleted, with the row it displaced', async () => {
		mocks.mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 9 },
		});
		mocks.mockExecute
			.mockResolvedValueOnce(
				slipped([
					{
						id: 42,
						employee_id: 7,
						month: '2026-08-01',
						payment_status: 'pending',
						payment_date: null,
						payment_reference: null,
					},
				])
			)
			.mockResolvedValueOnce(slipped([DRAFT_RUN]))
			.mockResolvedValueOnce(affected(1));

		const res = await DELETE(deleteRequest('?id=42'));

		expect(res.status).toBe(200);
		const [audit] = auditRows();
		expect(audit).toMatchObject({
			entityType: 'payroll_slip',
			entityId: 42,
			employeeId: 7,
			action: 'delete',
			payrollRunId: null,
			month: 8,
			year: 2026,
			performedBy: 9,
		});
		expect(audit.oldValues).toMatchObject({ payment_status: 'pending' });
	});

	it('writes no entry for a delete that removed nothing', async () => {
		mocks.mockEnsurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 9 },
		});
		mocks.mockExecute
			.mockResolvedValueOnce(
				slipped([{ id: 42, employee_id: 7, month: '2026-08-01' }])
			)
			.mockResolvedValueOnce(slipped([DRAFT_RUN]))
			.mockResolvedValueOnce(affected(0));

		const res = await DELETE(deleteRequest('?id=42'));

		expect(res.status).toBe(200);
		expect(auditRows()).toHaveLength(0);
	});
});

describe('payroll slips API — payment changes are audited (issue #243)', () => {
	/**
	 * `grant()` authorizes without a user, and the audit trail must name a real
	 * performer — so give the mocked gate a session user for the write tests.
	 */
	const signedInAs = (id: number) =>
		mocks.mockEnsurePermission.mockImplementation(async () => ({
			authorized: true,
			user: { id },
		}));

	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	const putRequest = (body: unknown) =>
		new Request('http://localhost/api/payroll/slips', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});

	/** The slip as it stood before the payment change. */
	const PENDING_SLIP = {
		id: 42,
		employee_id: 7,
		month: '2026-08-01',
		payment_status: 'pending',
		payment_date: null,
		payment_reference: null,
		remarks: null,
		created_at: '2026-08-02 10:00:00',
		updated_at: '2026-08-02 10:00:00',
	};

	it('records who marked a slip paid, and the payment state it displaced', async () => {
		grant('payroll:update');
		signedInAs(12);
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([PENDING_SLIP]))
			.mockResolvedValueOnce(affected(1));

		const res = await PUT(
			putRequest({
				id: 42,
				payment_status: 'paid',
				payment_date: '2026-09-05',
				payment_reference: 'NEFT/9911',
			})
		);

		expect(res.status).toBe(200);
		const [audit] = auditRows();
		expect(audit).toMatchObject({
			entityType: 'payroll_slip',
			entityId: 42,
			employeeId: 7, // the employee the slip belongs to
			action: 'update',
			month: 8,
			year: 2026,
			performedBy: 12, // the session user
		});
		// The row is read before the write, so oldValues is the real prior state
		// — minus the row's own history columns.
		expect(audit.oldValues).toEqual({
			id: 42,
			employee_id: 7,
			month: '2026-08-01',
			payment_status: 'pending',
			payment_date: null,
			payment_reference: null,
			remarks: null,
		});
		expect(audit.newValues).toEqual({
			payment_status: 'paid',
			payment_date: '2026-09-05',
			payment_reference: 'NEFT/9911',
		});
	});

	it('writes nothing when the slip id matched no row', async () => {
		grant('payroll:update');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([]))
			.mockResolvedValueOnce(affected(0));

		const res = await PUT(putRequest({ id: 999, payment_status: 'paid' }));

		// The response contract is unchanged, and an entry pointing at a row that
		// was never written would be a lie.
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(auditRows()).toHaveLength(0);
	});

	it('still updates the slip when the audit write fails', async () => {
		grant('payroll:update');
		signedInAs(12);
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([PENDING_SLIP]))
			.mockResolvedValueOnce(affected(1));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mocks.mockExecute.mockImplementation(async (sql: string) =>
			String(sql).includes('INSERT INTO payroll_audit_logs')
				? Promise.reject(new Error('payroll_audit_logs is missing'))
				: [[], undefined]
		);

		const res = await PUT(putRequest({ id: 42, payment_status: 'paid' }));

		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.message).toMatch(/updated successfully/i);
		expect(auditRows()).toHaveLength(1);
		errorSpy.mockRestore();
	});

	/**
	 * The audit tests above send payment_date and payment_reference, but the one
	 * caller in the app (the Reports edit form, src/app/reports/page.jsx) sends
	 * only { id, payment_status, remarks }. Those two fields then arrive
	 * undefined, and mysql2's execute() rejects ANY undefined binding with
	 * "Bind parameters must not contain undefined" — so the request 500ed before
	 * the audit INSERT above could ever run. Mocking db.execute hid it, because
	 * the mock never inspects the bindings.
	 */
	it('accepts the edit form body, whose omitted payment fields are not undefined bindings', async () => {
		grant('payroll:update');
		signedInAs(12);
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([PENDING_SLIP]))
			.mockResolvedValueOnce(affected(1));

		const res = await PUT(
			putRequest({ id: 42, payment_status: 'paid', remarks: 'paid by NEFT' })
		);

		expect(res.status).toBe(200);

		const update = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('UPDATE payroll_slips')
		);
		expect(update).toBeDefined();
		const [sql, params] = update!;

		// The exact failure mysql2 would raise, prevented at the binding site.
		expect(
			(params as unknown[]).filter((value) => value === undefined)
		).toEqual([]);
		// An omitted field must mean "leave it alone". Binding NULL without the
		// COALESCE would wipe a recorded payment_date on a status-only edit.
		expect(String(sql)).toContain('payment_date = COALESCE(?, payment_date)');
		expect(String(sql)).toContain(
			'payment_reference = COALESCE(?, payment_reference)'
		);
		expect((params as unknown[])[1]).toBeNull();
		expect((params as unknown[])[2]).toBeNull();

		// And the entry the criterion is about does fire for that body.
		expect(auditRows()).toHaveLength(1);
	});
});

describe('payroll slips API — company-sheet projection (issue #428)', () => {
	/**
	 * One normalized January slip shape is not enough for the projection: the
	 * route must read Employees, Attendance Records and Holiday Master rows for
	 * exactly the returned slips, and must not turn a source failure into a
	 * failed listing. These tests dispatch the mocked connection by SQL so the
	 * batch shape is observable without a second harness.
	 */
	const SLIP = {
		id: 42,
		month: '2026-02-01',
		employee_id: 7,
		employee_name: 'Asha Rao',
		employee_code: 'EMP-007',
		department: 'Engineering',
		// The listing's grade alias must not become the company Designation.
		designation: 'Grade A',
		position: 'Senior Engineer',
		joining_date: '2020-01-01',
		basic: 50000,
		da: 0,
		da_used: 0,
		profile_basic: 50000,
		profile_basic_plus_da: 50000,
		structure_basic_salary: null,
		hra: 10000,
		conveyance: 1600,
		call_allowance: 500,
		other_allowances: 200,
		bonus: 0,
		incentive: 1000,
		total_earnings: '70000.00',
		// The full-month contractual gross is deliberately different: GROSS in
		// the company sheet is the stored total_earnings, never this fallback.
		gross: '80000.00',
		total_deductions: '8000.00',
		net_pay: '62000.00',
		pf_employee: '1800.00',
		esic_employee: '0.00',
		pt: '200.00',
		tds: '0.00',
		retention: '0.00',
		mlwf: '0.00',
		lwf: '0.00',
		other_deductions: '6000.00',
		lop_deduction: '0.00',
		payment_status: 'paid',
		device_code: 'DEV-99',
	};

	const EMPLOYEE = {
		id: 7,
		employee_id: 'EMP-007',
		position: 'Senior Engineer',
		uan: '100200300400',
		pf_no: 'PF/007',
		esi_no: 'ESIC/007',
		status: 'active',
		joining_date: '2020-01-01',
		hire_date: '2019-12-15',
		exit_date: null,
	};

	const FEBRUARY_ATTENDANCE = [
		{
			employee_id: 7,
			attendance_date: '2026-02-02',
			status: 'P',
			overtime_hours: 0,
		},
		{
			employee_id: 7,
			attendance_date: '2026-02-03',
			status: 'OT',
			overtime_hours: '3.00',
		},
		{
			employee_id: 7,
			attendance_date: '2026-02-04',
			status: 'HD',
			overtime_hours: 0,
		},
		{
			employee_id: 7,
			attendance_date: '2026-02-05',
			status: 'PL',
			overtime_hours: 0,
		},
		{
			employee_id: 7,
			attendance_date: '2026-02-06',
			status: 'A',
			overtime_hours: 0,
		},
		{
			employee_id: 7,
			attendance_date: '2026-02-09',
			status: 'H',
			overtime_hours: 0,
		},
		{
			employee_id: 7,
			attendance_date: '2026-02-10',
			status: 'WO',
			overtime_hours: 0,
		},
	];

	const FEBRUARY_HOLIDAYS = [
		{ date: '2026-02-11', is_active: 1, is_optional: 0 },
		// An optional holiday is a working day unless an explicit H record says
		// otherwise; the route hands it to the model raw so that policy is applied
		// in one place.
		{ date: '2026-02-12', is_active: 1, is_optional: 1 },
	];

	interface ProjectionMock {
		slips?: unknown[];
		employees?: unknown[];
		attendance?: unknown[];
		holidays?: unknown[];
		scheduledDA?: unknown[];
		employeeError?: Error;
		attendanceError?: Error;
		holidayError?: Error;
	}

	function mockProjectionDb(overrides: ProjectionMock = {}): void {
		const slips = overrides.slips ?? [SLIP];
		const employees = overrides.employees ?? [EMPLOYEE];
		const attendance = overrides.attendance ?? FEBRUARY_ATTENDANCE;
		const holidays = overrides.holidays ?? FEBRUARY_HOLIDAYS;
		const scheduledDA = overrides.scheduledDA ?? [];

		mocks.mockExecute.mockImplementation(async (sql: string) => {
			const text = String(sql);
			if (text.includes('FROM payroll_slips ps')) return [slips, undefined];
			if (text.includes('FROM payroll_schedules'))
				return [scheduledDA, undefined];
			if (text.includes('FROM employees')) {
				if (overrides.employeeError) throw overrides.employeeError;
				return [employees, undefined];
			}
			if (text.includes('FROM employee_attendance')) {
				if (overrides.attendanceError) throw overrides.attendanceError;
				return [attendance, undefined];
			}
			if (text.includes('FROM holiday_master')) {
				if (overrides.holidayError) throw overrides.holidayError;
				return [holidays, undefined];
			}
			return [[], undefined];
		});
	}

	const projectionRequest = (query: string) =>
		new Request(`http://localhost/api/payroll/slips${query}`);

	const sourceStatements = (table: string) =>
		statements().filter((sql) => sql.includes(`FROM ${table}`));

	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	it('attaches one aggregate company_sheet projection per returned slip', async () => {
		grant('payroll:read');
		mockProjectionDb();

		const res = await GET(
			projectionRequest('?include=company-sheet&month=2026-02')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toHaveLength(1);

		// Short month shape is accepted and normalised for the DATE column.
		const [slipSql, slipParams] = mocks.mockExecute.mock.calls[0];
		expect(String(slipSql)).toContain('ps.month = ?');
		expect(slipParams).toContain('2026-02-01');

		const row = body.data[0];
		// The Payroll Slip snapshot fields stay exactly as the ordinary listing
		// reports them; the projection rides alongside them.
		expect(row.id).toBe(42);
		expect(row.net_pay).toBe('62000.00');
		expect(row.other_deductions).toBe('6000.00');

		const sheet = row.company_sheet;
		expect(sheet.slip_id).toBe(42);
		expect(sheet.employee_id).toBe(7);
		expect(Object.keys(sheet.cells)).toHaveLength(51);

		// Identity uses the business Employee Code and `position`, never the
		// grade alias or the biometric device code.
		expect(sheet.cells.employee_code).toEqual({
			state: 'text',
			value: 'EMP-007',
		});
		expect(sheet.cells.designation).toEqual({
			state: 'text',
			value: 'Senior Engineer',
		});
		expect(sheet.cells.uan).toEqual({ state: 'text', value: '100200300400' });

		// Calendar Total Days and the company attendance buckets.
		expect(sheet.cells.total_days).toEqual({ state: 'number', value: 28 });
		expect(sheet.cells.days_present).toEqual({ state: 'number', value: 2.5 });
		expect(sheet.cells.days_paid).toEqual({ state: 'number', value: 12.5 });
		expect(sheet.cells.lwp_days).toEqual({ state: 'number', value: 1.5 });
		expect(sheet.cells.leave).toEqual({ state: 'number', value: 1 });
		expect(sheet.cells.week_off).toEqual({ state: 'number', value: 7 });
		expect(sheet.cells.paid_holiday).toEqual({ state: 'number', value: 2 });
		expect(sheet.cells.ot_hours).toEqual({ state: 'number', value: 3 });
		expect(sheet.attendance.state).toBe('available');
		expect(sheet.attendance.buckets.unrecorded).toBe(14);
		expect(sheet.attendance.buckets.reconciliation).toEqual({
			calendar_balanced: true,
			paid_balanced: true,
		});

		// Stored totals stay authoritative.
		expect(sheet.cells.gross).toEqual({ state: 'number', value: 70000 });
		expect(sheet.cells.total_ded).toEqual({ state: 'number', value: 8000 });
		expect(sheet.cells.net_sal).toEqual({ state: 'number', value: 62000 });
		expect(sheet.cells.loan).toEqual({
			state: 'not_available',
			reason: 'unsupported_mapping',
		});

		// Month-level source state and issues travel once, not per row.
		expect(body.company_sheet).toMatchObject({
			month: '2026-02-01',
			month_key: '2026-02',
			total_days: 28,
			sources: {
				attendance: { state: 'loaded', message: null },
				holidays: { state: 'loaded', message: null },
			},
		});
		expect(body.company_sheet.rows).toBeUndefined();

		// Aggregate-only disclosure: no daily records, no employee directory.
		expect(JSON.stringify(body)).not.toContain('attendance_date');
		expect(JSON.stringify(body)).not.toContain('2026-02-02');
	});

	it('normalises Basic/DA once and exposes the same values in the projection', async () => {
		grant('payroll:read');
		mockProjectionDb({
			scheduledDA: [{ value_type: 'fixed', value: 2500 }],
		});

		const res = await GET(
			projectionRequest('?include=company-sheet&month=2026-02-01')
		);

		const body = await res.json();
		expect(body.data[0].basic).toBe(47500);
		expect(body.data[0].da).toBe(2500);
		expect(body.data[0].basic_plus_da_source).toBe(50000);
		expect(body.data[0].company_sheet.cells.basic).toEqual({
			state: 'number',
			value: 47500,
		});
		expect(body.data[0].company_sheet.cells.da).toEqual({
			state: 'number',
			value: 2500,
		});
	});

	it('preserves ordinary listing requests without projection reads', async () => {
		grant('payroll:read');
		mockProjectionDb();

		const res = await GET(
			projectionRequest('?month=2026-02-01&salary_type=payroll')
		);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].company_sheet).toBeUndefined();
		expect(body.company_sheet).toBeUndefined();
		expect(sourceStatements('employee_attendance')).toHaveLength(0);
		expect(sourceStatements('holiday_master')).toHaveLength(0);
		expect(sourceStatements('employees')).toHaveLength(0);
	});

	it('keeps the ordinary filters when the projection is requested', async () => {
		grant('payroll:read');
		mockProjectionDb();

		const res = await GET(
			projectionRequest(
				'?include=company-sheet&month=2026-02-01&employee_id=7&payment_status=paid&salary_type=payroll'
			)
		);

		const [sql, params] = mocks.mockExecute.mock.calls[0];
		expect(String(sql)).toContain('ps.employee_id = ?');
		expect(String(sql)).toContain('ps.payment_status = ?');
		expect(String(sql)).toContain("sp.salary_type = 'contract'");
		expect(params).toEqual(expect.arrayContaining(['2026-02-01', '7', 'paid']));
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].company_sheet.attendance.state).toBe('available');
	});

	it('requires a valid month before reading the database', async () => {
		grant('payroll:read');

		const missing = await GET(projectionRequest('?include=company-sheet'));
		expect(missing.status).toBe(400);
		expect((await missing.json()).success).toBe(false);

		const invalid = await GET(
			projectionRequest('?include=company-sheet&month=2026-13')
		);
		expect(invalid.status).toBe(400);

		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('denies the projection without payroll:read', async () => {
		grant('employees:read');

		const res = await GET(
			projectionRequest('?include=company-sheet&month=2026-02-01')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		const body = await res.json();
		expect(JSON.stringify(body)).not.toContain('EMP-007');
	});

	it('keeps stored money when the attendance source fails', async () => {
		grant('payroll:read');
		mockProjectionDb({ attendanceError: new Error('attendance down') });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const res = await GET(
			projectionRequest('?include=company-sheet&month=2026-02-01')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		const sheet = body.data[0].company_sheet;

		expect(sheet.attendance).toEqual({
			state: 'unavailable',
			reason: 'attendance_source_error',
		});
		expect(sheet.cells.days_present).toEqual({
			state: 'not_available',
			reason: 'attendance_source_error',
		});
		expect(sheet.cells.total_days).toEqual({ state: 'number', value: 28 });
		// Money is never replaced by the source failure.
		expect(sheet.cells.net_sal).toEqual({ state: 'number', value: 62000 });
		expect(sheet.cells.gross).toEqual({ state: 'number', value: 70000 });
		expect(body.company_sheet.sources.attendance.state).toBe('error');
		expect(
			body.company_sheet.issues.some(
				(issue: { code: string }) => issue.code === 'attendance_source_error'
			)
		).toBe(true);

		errorSpy.mockRestore();
	});

	it('keeps stored money when the holiday source fails', async () => {
		grant('payroll:read');
		mockProjectionDb({ holidayError: new Error('holiday down') });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const res = await GET(
			projectionRequest('?include=company-sheet&month=2026-02-01')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		const sheet = body.data[0].company_sheet;

		expect(sheet.attendance).toEqual({
			state: 'unavailable',
			reason: 'holiday_source_error',
		});
		expect(sheet.cells.total_days).toEqual({ state: 'number', value: 28 });
		expect(sheet.cells.net_sal).toEqual({ state: 'number', value: 62000 });
		expect(body.company_sheet.sources.holidays.state).toBe('error');

		errorSpy.mockRestore();
	});

	it('distinguishes a failed employee source from genuinely missing identifiers', async () => {
		grant('payroll:read');
		mockProjectionDb({ employeeError: new Error('employees table down') });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const res = await GET(
			projectionRequest('?include=company-sheet&month=2026-02-01')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		const sheet = body.data[0].company_sheet;

		expect(body.company_sheet.sources.employees.state).toBe('error');
		expect(
			body.company_sheet.issues.some(
				(issue: { code: string }) => issue.code === 'employees_source_error'
			)
		).toBe(true);
		expect(sheet.attendance).toEqual({
			state: 'unavailable',
			reason: 'employment_source_error',
		});
		expect(sheet.cells.uan).toEqual({
			state: 'not_available',
			reason: 'source_error',
		});
		expect(sheet.cells.pf_no).toEqual({
			state: 'not_available',
			reason: 'source_error',
		});
		expect(sheet.cells.esic_no).toEqual({
			state: 'not_available',
			reason: 'source_error',
		});
		// The ordinary listing's identity, the calendar and the money survive.
		expect(sheet.cells.employee_code).toEqual({
			state: 'text',
			value: 'EMP-007',
		});
		expect(sheet.cells.designation).toEqual({
			state: 'text',
			value: 'Senior Engineer',
		});
		expect(sheet.cells.total_days).toEqual({ state: 'number', value: 28 });
		expect(sheet.cells.gross).toEqual({ state: 'number', value: 70000 });
		expect(sheet.cells.net_sal).toEqual({ state: 'number', value: 62000 });
		// Raw database text never leaks through the source-error message.
		expect(JSON.stringify(body)).not.toContain('employees table down');

		errorSpy.mockRestore();
	});

	it('returns issue counts, never daily date arrays, in the projection', async () => {
		grant('payroll:read');
		mockProjectionDb({
			employees: [
				{
					...EMPLOYEE,
					// The 27th is outside this validated employment window.
					exit_date: '2026-02-10',
				},
			],
			attendance: [
				{
					employee_id: 7,
					attendance_date: '2026-02-03',
					status: 'Z',
					overtime_hours: 0,
				},
				{
					employee_id: 7,
					attendance_date: '2026-02-04',
					status: 'P',
					overtime_hours: 0,
				},
				{
					employee_id: 7,
					attendance_date: '2026-02-04',
					status: 'OT',
					overtime_hours: 0,
				},
				{
					employee_id: 7,
					attendance_date: '2026-02-27',
					status: 'P',
					overtime_hours: 0,
				},
			],
			holidays: [{ date: '2026-02-31', is_active: 1, is_optional: 0 }],
		});

		const res = await GET(
			projectionRequest('?include=company-sheet&month=2026-02-01')
		);

		const body = await res.json();
		const sheet = body.data[0].company_sheet;
		const rowCodes = sheet.issues.map((issue: { code: string }) => issue.code);
		expect(rowCodes).toEqual(
			expect.arrayContaining([
				'invalid_attendance_status',
				'attendance_duplicate_date',
				'attendance_outside_employment',
			])
		);
		for (const code of [
			'invalid_attendance_status',
			'attendance_duplicate_date',
			'attendance_outside_employment',
		]) {
			const issue = sheet.issues.find(
				(candidate: { code: string }) => candidate.code === code
			);
			expect(issue.count).toBeGreaterThan(0);
			expect(issue).not.toHaveProperty('dates');
		}

		const holidayIssue = body.company_sheet.issues.find(
			(issue: { code: string }) => issue.code === 'holiday_date_invalid'
		);
		expect(holidayIssue).toMatchObject({ count: 1 });
		expect(holidayIssue).not.toHaveProperty('dates');

		// The network payload carries monthly aggregates only: none of the
		// offending dates leaks, and no attendance row is echoed.
		const payload = JSON.stringify(body);
		expect(payload).not.toContain('attendance_date');
		for (const dailyEvidence of [
			'2026-02-03',
			'2026-02-04',
			'2026-02-27',
			'2026-02-31',
		]) {
			expect(payload).not.toContain(dailyEvidence);
		}
	});

	it('treats a successful empty attendance read as calendar defaults', async () => {
		grant('payroll:read');
		mockProjectionDb({ attendance: [], holidays: [] });

		const res = await GET(
			projectionRequest('?include=company-sheet&month=2026-02-01')
		);

		const sheet = (await res.json()).data[0].company_sheet;
		expect(sheet.attendance.state).toBe('available');
		expect(sheet.cells.days_present).toEqual({ state: 'number', value: 0 });
		expect(sheet.cells.days_paid).toEqual({ state: 'number', value: 6 });
		expect(sheet.cells.leave).toEqual({ state: 'number', value: 0 });
		expect(sheet.attendance.buckets.holidays).toBe(0);
		expect(sheet.attendance.buckets.unrecorded).toBe(22);
	});

	it('batches one attendance read and one holiday read for every returned slip', async () => {
		grant('payroll:read');
		const secondSlip = {
			...SLIP,
			id: 43,
			employee_id: 8,
			employee_name: 'Bala Iyer',
			employee_code: 'EMP-008',
		};
		const secondEmployee = {
			...EMPLOYEE,
			id: 8,
			employee_id: 'EMP-008',
			position: 'Analyst',
		};
		mockProjectionDb({
			slips: [SLIP, secondSlip],
			employees: [EMPLOYEE, secondEmployee],
			attendance: [
				...FEBRUARY_ATTENDANCE,
				{
					employee_id: 8,
					attendance_date: '2026-02-02',
					status: 'P',
					overtime_hours: 0,
				},
			],
		});

		const res = await GET(
			projectionRequest('?include=company-sheet&month=2026-02-01')
		);

		const body = await res.json();
		// Attendance never adds a Payroll Slip row.
		expect(body.data).toHaveLength(2);
		expect(
			body.data.map(
				(row: { company_sheet: { employee_id: number } }) =>
					row.company_sheet.employee_id
			)
		).toEqual([7, 8]);

		const attendanceQueries = sourceStatements('employee_attendance');
		const holidayQueries = sourceStatements('holiday_master');
		expect(attendanceQueries).toHaveLength(1);
		expect(holidayQueries).toHaveLength(1);
		// No per-row attendance request.
		const attendanceCall = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('FROM employee_attendance')
		);
		expect(attendanceCall?.[1]).toEqual(
			expect.arrayContaining([7, 8, '2026-02-01', '2026-02-28'])
		);
	});

	it('returns an empty, still-versioned projection for a month with no slips', async () => {
		grant('payroll:read');
		mockProjectionDb({ slips: [] });

		const res = await GET(
			projectionRequest('?include=company-sheet&month=2026-02-01')
		);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toEqual([]);
		expect(body.company_sheet).toMatchObject({
			month: '2026-02-01',
			total_days: 28,
		});
		expect(sourceStatements('employee_attendance')).toHaveLength(0);
		expect(sourceStatements('holiday_master')).toHaveLength(0);
	});
});
