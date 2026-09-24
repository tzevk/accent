import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockExecute: vi.fn(),
	mockGenerateMonthlyPayroll: vi.fn(),
	mockGeneratePayrollSlip: vi.fn(),
	mockGeneratePayrollSlipsBatch: vi.fn(),
	mockCalculateEmployeePayroll: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
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
vi.mock('@/utils/payroll-calculator', () => ({
	generatePayrollSlip: mocks.mockGeneratePayrollSlip,
	generatePayrollSlipsBatch: mocks.mockGeneratePayrollSlipsBatch,
	generateMonthlyPayroll: mocks.mockGenerateMonthlyPayroll,
	calculateEmployeePayroll: mocks.mockCalculateEmployeePayroll,
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

const jsonRequest = (body: unknown) =>
	new Request('http://localhost/api/payroll/generate', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

const runStatements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

describe('payroll generate API — Payroll Run lock (issue #242)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
		mocks.mockGenerateMonthlyPayroll.mockResolvedValue({
			month: '2026-08-01',
			total: 2,
			success: 2,
			failed: 0,
			skipped: 0,
			errors: [],
		});
	});

	it('denies a caller without payroll:create', async () => {
		grant('payroll:read');

		const res = await POST(jsonRequest({ month: '2026-08-01', all: true }));

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it("creates the month's Payroll Run as draft on first use", async () => {
		grant('payroll:create');
		mocks.mockExecute
			.mockResolvedValueOnce([[], undefined]) // no run for the month yet
			.mockResolvedValueOnce([[], undefined]) // the INSERT
			.mockResolvedValueOnce([[DRAFT_RUN], undefined]); // re-read

		const res = await POST(jsonRequest({ month: '2026-08-01', all: true }));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.run).toMatchObject({ id: 7, status: 'draft' });
		expect(
			runStatements().some((sql) => sql.includes('INSERT INTO payroll_runs'))
		).toBe(true);
		expect(mocks.mockGenerateMonthlyPayroll).toHaveBeenCalled();
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

	it('refuses a single-employee generate on a finalized month', async () => {
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

	it('does not create a run for a preview calculation', async () => {
		grant('payroll:create');
		mocks.mockCalculateEmployeePayroll.mockResolvedValue({ net_pay: 100 });

		const res = await POST(
			jsonRequest({ month: '2026-08-01', employee_id: 7, preview: true })
		);

		expect(res.status).toBe(200);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});
});
