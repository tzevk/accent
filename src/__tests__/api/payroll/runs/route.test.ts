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

describe('payroll runs API — month status and totals (issue #242)', () => {
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
		});
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
});
