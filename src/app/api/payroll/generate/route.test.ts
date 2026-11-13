import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';
import { PayrollGenerationError } from '@/utils/payroll-calculator';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockWithTransaction: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockExecute: vi.fn(),
	mockGenerateMonthlyPayroll: vi.fn(),
	mockGeneratePayrollSlip: vi.fn(),
	mockGeneratePayrollSlipsBatch: vi.fn(),
	mockCalculateEmployeePayroll: vi.fn(),
	mockPayrollGenerationRefusal: vi.fn(),
	mockLoadPayrollRunRoster: vi.fn(),
	mockLoadFrozenPayrollRunRoster: vi.fn(),
}));

vi.mock('@/utils/database', () => ({
	dbConnect: mocks.mockDbConnect,
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
vi.mock('@/utils/payroll-calculator', () => {
	class PayrollGenerationError extends Error {
		constructor(message: string, options: Record<string, unknown> = {}) {
			super(message);
			this.name = 'PayrollGenerationError';
			Object.assign(this, options);
		}
	}
	return {
		PayrollGenerationError,
		generatePayrollSlip: mocks.mockGeneratePayrollSlip,
		generatePayrollSlipsBatch: mocks.mockGeneratePayrollSlipsBatch,
		generateMonthlyPayroll: mocks.mockGenerateMonthlyPayroll,
		calculateEmployeePayroll: mocks.mockCalculateEmployeePayroll,
		payrollGenerationRefusal: mocks.mockPayrollGenerationRefusal,
	};
});
vi.mock('@/lib/payroll-run-roster', () => ({
	loadPayrollRunRoster: mocks.mockLoadPayrollRunRoster,
	loadFrozenPayrollRunRoster: mocks.mockLoadFrozenPayrollRunRoster,
}));

const { POST } = await import('@/app/api/payroll/generate/route');

const grant = grantFor(mocks.mockEnsurePermission);

const DRAFT_RUN = {
	id: 7,
	month: 8,
	year: 2026,
	run_number: 1,
	status: 'draft',
};

const ELIGIBLE_MEMBER = {
	employee_id: 7,
	employee_code: 'EMP007',
	name: 'Asha Rao',
	employee_type: 'Payroll',
	employment_start: '2026-08-12',
	employment_end: null,
	profile_date: '2026-08-12',
	salary_profile: { employer_cost: 26_000 },
	profile_source: 'employee_salary_profile',
	profile_id: 3,
	salary_type: 'monthly',
	issue: null,
};

const roster = (members: readonly unknown[] = [ELIGIBLE_MEMBER], excluded: readonly unknown[] = []) => ({
	month: '2026-08-01',
	members,
	excluded,
});

const jsonRequest = (body: unknown) =>
	new Request('http://localhost/api/payroll/generate', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

const runStatements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

describe('payroll generate API — roster eligibility and Payroll Run lock (issue #242)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockWithTransaction.mockImplementation(async (fn) =>
			fn(await mocks.mockDbConnect())
		);
		mocks.mockExecute.mockResolvedValue([[], undefined]);
		mocks.mockGenerateMonthlyPayroll.mockResolvedValue({
			month: '2026-08-01',
			total: 2,
			success: 2,
			failed: 0,
			skipped: 0,
			errors: [],
		});
		mocks.mockGeneratePayrollSlip.mockResolvedValue({ id: 31, net_pay: 100 });
		mocks.mockGeneratePayrollSlipsBatch.mockResolvedValue({
			success: 1,
			failed: 0,
			skipped: 0,
			errors: [],
		});
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(roster());
		mocks.mockPayrollGenerationRefusal.mockReturnValue(null);
	});

	it('denies a caller without payroll:create', async () => {
		grant('payroll:read');

		const res = await POST(jsonRequest({ month: '2026-08-01', all: true }));

		expect(res.status).toBe(403);
		expect(mocks.mockWithTransaction).not.toHaveBeenCalled();
	});

	it("creates the month's Payroll Run as draft on first use inside the write transaction", async () => {
		grant('payroll:create');
		mocks.mockExecute
			.mockResolvedValueOnce([[], undefined]) // no run for the month yet
			.mockResolvedValueOnce([[], undefined]) // the INSERT
			.mockResolvedValueOnce([[DRAFT_RUN], undefined]) // createDraft re-read
			.mockResolvedValueOnce([[DRAFT_RUN], undefined]); // re-read with the row lock

		const res = await POST(jsonRequest({ month: '2026-08-01', all: true }));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.run).toMatchObject({ id: 7, status: 'draft' });
		expect(
			runStatements().some((sql) => sql.includes('INSERT INTO payroll_runs'))
		).toBe(true);
		expect(mocks.mockWithTransaction).toHaveBeenCalledTimes(1);
		expect(mocks.mockGenerateMonthlyPayroll).toHaveBeenCalledWith(
			'2026-08-01',
			null,
			false,
			null,
			expect.objectContaining({
				db: expect.objectContaining({ execute: mocks.mockExecute }),
			})
		);
	});

	it("reuses the month's draft run instead of creating a second one", async () => {
		grant('payroll:create');
		mocks.mockExecute.mockResolvedValue([[DRAFT_RUN], undefined]);

		const res = await POST(jsonRequest({ month: '2026-08-01', all: true }));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.run).toMatchObject({ id: 7, status: 'draft' });
		expect(
			runStatements().some((sql) => sql.includes('INSERT INTO payroll_runs'))
		).toBe(false);
		// The lookup is the month's mutex, held for the whole generation.
		expect(runStatements()[0]).toContain('FOR UPDATE');
		expect(mocks.mockGenerateMonthlyPayroll).toHaveBeenCalled();
	});

	it('refuses a full-month generate on a finalized month', async () => {
		grant('payroll:create');
		mocks.mockExecute.mockResolvedValue([
			[{ ...DRAFT_RUN, status: 'finalized' }],
			undefined,
		]);

		const res = await POST(jsonRequest({ month: '2026-08-01', all: true }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/finalized/i);
		expect(mocks.mockGenerateMonthlyPayroll).not.toHaveBeenCalled();
	});

	it('refuses a single-employee generate on a finalized month before pricing', async () => {
		grant('payroll:create');
		mocks.mockExecute.mockResolvedValue([
			[{ ...DRAFT_RUN, status: 'finalized' }],
			undefined,
		]);

		const res = await POST(
			jsonRequest({ month: '2026-08-01', employee_id: 7 })
		);

		expect(res.status).toBe(409);
		expect(mocks.mockGeneratePayrollSlip).not.toHaveBeenCalled();
	});

	it('generates a single slip using the roster inside the run-lock transaction', async () => {
		grant('payroll:create');
		mocks.mockExecute.mockResolvedValue([[DRAFT_RUN], undefined]);

		const res = await POST(
			jsonRequest({ month: '2026-08-01', employee_id: 7, include_bonus: true })
		);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.data).toEqual({ id: 31, net_pay: 100 });
		expect(mocks.mockWithTransaction).toHaveBeenCalledTimes(1);
		expect(mocks.mockGeneratePayrollSlip).toHaveBeenCalledWith(
			7,
			'2026-08-01',
			expect.objectContaining({
				include_bonus: true,
				db: expect.objectContaining({ execute: mocks.mockExecute }),
			})
		);
	});

	it('passes the locked transaction to batch generation', async () => {
		grant('payroll:create');
		mocks.mockExecute.mockResolvedValue([[DRAFT_RUN], undefined]);

		const res = await POST(
			jsonRequest({ month: '2026-08-01', employee_ids: [7, 8] })
		);

		expect(res.status).toBe(200);
		expect(mocks.mockGeneratePayrollSlipsBatch).toHaveBeenCalledWith(
			[7, 8],
			'2026-08-01',
			false,
			null,
			expect.objectContaining({
				db: expect.objectContaining({ execute: mocks.mockExecute }),
			})
		);
	});

	it('previews through the shared roster without creating a run', async () => {
		grant('payroll:create');
		mocks.mockCalculateEmployeePayroll.mockResolvedValue({ net_pay: 100 });

		const res = await POST(
			jsonRequest({ month: '2026-08-01', employee_id: 7, preview: true })
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.preview).toBe(true);
		expect(mocks.mockLoadPayrollRunRoster).toHaveBeenCalledWith(
			expect.anything(),
			'2026-08-01'
		);
		expect(mocks.mockCalculateEmployeePayroll).toHaveBeenCalledWith(
			7,
			'2026-08-01',
			expect.objectContaining({
				salaryProfile: ELIGIBLE_MEMBER.salary_profile,
			})
		);
		expect(
			runStatements().some((sql) => sql.includes('INSERT INTO payroll_runs'))
		).toBe(false);
	});

	it('refuses a preview for someone the roster does not cover, naming the reason', async () => {
		grant('payroll:create');
		const reviewMember = {
			...ELIGIBLE_MEMBER,
			employee_id: 8,
			employee_code: 'EMP008',
			name: 'Future Hire',
			employment_start: null,
			profile_date: '2026-08-01',
			issue: 'employment_dates_missing',
		};
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(
			roster([reviewMember], [
				{ employee_id: 99, employee_code: 'EMP099', name: 'Other', reason: 'no_evidence' },
			])
		);
		mocks.mockPayrollGenerationRefusal.mockReturnValue(
			new PayrollGenerationError(
				'Future Hire (EMP008) cannot be paid for 2026-08-01: employment dates are missing.',
				{
					status: 422,
					code: 'payroll_employment_review',
					reviewReason: 'employment_dates_missing',
				}
			)
		);

		const res = await POST(
			jsonRequest({ month: '2026-08-01', employee_id: 8, preview: true })
		);

		expect(res.status).toBe(422);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toContain('Future Hire (EMP008)');
		expect(body.code).toBe('payroll_employment_review');
		expect(body.review_reason).toBe('employment_dates_missing');
		expect(mocks.mockCalculateEmployeePayroll).not.toHaveBeenCalled();
	});
});
