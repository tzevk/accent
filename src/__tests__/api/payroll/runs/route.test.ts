import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockExecute: vi.fn(),
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

const { GET } = await import('@/app/api/payroll/runs/route');

const grant = grantFor(mocks.mockEnsurePermission);

const runRequest = (month?: string) =>
	new Request(
		`http://localhost/api/payroll/runs${month ? `?month=${month}` : ''}`
	);

const DRAFT_RUN = {
	id: 7,
	month: 8,
	year: 2026,
	run_number: 1,
	status: 'draft',
};

describe('payroll runs API — month status, totals and derived paid indicator (issues #242, #245)', () => {
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

		const res = await GET(runRequest('2026-08-01'));

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('rejects a request without a month', async () => {
		grant('payroll:read');

		const res = await GET(runRequest());

		expect(res.status).toBe(400);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('reports no run and an empty summary for a month never generated', async () => {
		grant('payroll:read');

		const res = await GET(runRequest('2026-08-01'));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.run).toBeNull();
		expect(body.data.summary).toEqual({
			headcount: 0,
			total_gross: 0,
			total_deductions: 0,
			total_net_pay: 0,
			total_employer_contribution: 0,
			paid_slips: 0,
			is_paid: false,
		});
	});

	it('reports the run as paid only once every slip of the month is paid', async () => {
		grant('payroll:read');
		mocks.mockExecute
			.mockResolvedValueOnce([
				[{ id: 7, month: 8, year: 2026, run_number: 1, status: 'finalized' }],
				undefined,
			])
			.mockResolvedValueOnce([
				[
					{ payment_status: 'paid', gross: '100.00' },
					{ payment_status: 'processed', gross: '100.00' },
				],
				undefined,
			]);

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		// Derived from the slips on every read, so the indicator drops the moment
		// one slip leaves `paid` — the header can never disagree with them.
		expect(body.data.summary.paid_slips).toBe(1);
		expect(body.data.summary.is_paid).toBe(false);
	});

	it('reports the run as paid when all of its slips are paid', async () => {
		grant('payroll:read');
		mocks.mockExecute
			.mockResolvedValueOnce([
				[{ id: 7, month: 8, year: 2026, run_number: 1, status: 'finalized' }],
				undefined,
			])
			.mockResolvedValueOnce([
				[
					{ payment_status: 'paid', gross: '100.00' },
					{ payment_status: 'paid', gross: '100.00' },
				],
				undefined,
			]);

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		expect(body.data.summary.paid_slips).toBe(2);
		expect(body.data.summary.is_paid).toBe(true);
	});

	it("returns the month's run status with money-library totals", async () => {
		grant('payroll:read');
		mocks.mockExecute
			.mockResolvedValueOnce([
				[{ id: 7, month: 8, year: 2026, run_number: 1, status: 'draft' }],
				undefined,
			])
			.mockResolvedValueOnce([
				[
					{
						gross: '48000.00',
						total_deductions: '200.10',
						net_pay: '47799.90',
						total_employer_contributions: '150.00',
					},
					{
						gross: '31405.46',
						total_deductions: '0.20',
						net_pay: '31405.26',
						total_employer_contributions: '150.00',
					},
				],
				undefined,
			]);

		const res = await GET(runRequest('2026-08-01'));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.run).toMatchObject({ id: 7, status: 'draft' });
		expect(body.data.summary.headcount).toBe(2);
		// Decimal sums: 48000.00 + 31405.46. Float addition yields
		// 79405.45999999999, so these assertions prove the money library.
		expect(body.data.summary.total_gross).toBe(79405.46);
		expect(body.data.summary.total_deductions).toBe(200.3);
		expect(body.data.summary.total_net_pay).toBe(79205.16);
		expect(body.data.summary.total_employer_contribution).toBe(300);
	});

	it("sums the slips' own earnings, never the contractual gross", async () => {
		grant('payroll:read');
		mocks.mockExecute
			.mockResolvedValueOnce([[DRAFT_RUN], undefined])
			.mockResolvedValueOnce([
				[
					// The shape a Payroll Slip really carries: `gross` is the
					// full-month contractual gross, `total_earnings` what the month
					// earned. A summary that summed `gross` would print a pair that
					// cannot both be true (45000 - 2000 != 52000).
					{
						gross: '45000.00',
						total_earnings: '54000.00',
						total_deductions: '2000.00',
						net_pay: '52000.00',
						total_employer_contributions: '3250.00',
						pt: '200.00',
					},
				],
				undefined,
			]);

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		expect(body.data.summary.total_gross).toBe(54000);
		expect(body.data.summary.total_deductions).toBe(2000);
		expect(body.data.summary.total_net_pay).toBe(52000);
		// The invariant every reader depends on.
		expect(
			body.data.summary.total_gross - body.data.summary.total_deductions
		).toBe(body.data.summary.total_net_pay);
	});

	it('corrects February PT the way the run dashboard does', async () => {
		grant('payroll:read');
		mocks.mockExecute
			.mockResolvedValueOnce([[DRAFT_RUN], undefined])
			.mockResolvedValueOnce([
				[
					{
						gross: '45000.00',
						total_earnings: '54000.00',
						total_deductions: '2000.00',
						net_pay: '52000.00',
						total_employer_contributions: '3250.00',
						pt: '200.00',
					},
				],
				undefined,
			]);

		const res = await GET(runRequest('2026-02-01'));

		const body = await res.json();
		// February's PT is a flat 300 for everyone: the 200 stored is corrected by
		// the difference, so the dialog that asks for sign-off cannot disagree with
		// the dashboard's own Net Pay for the same slip.
		expect(body.data.summary.total_deductions).toBe(2100);
		expect(body.data.summary.total_net_pay).toBe(51900);
	});
});
