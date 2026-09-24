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

const { GET } = await import('@/app/api/payroll/bulk-pdf/route');

const grant = grantFor(mocks.mockEnsurePermission);

const slipped = (rows: unknown[]) => [rows, undefined];

const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

const SLIP = {
	id: 5,
	month: '2026-07-01',
	employee_id: 41,
	employee_name: 'Asha Rao',
	department: 'Engineering',
	designation: 'Engineer',
	joining_date: '2024-04-01',
	standard_working_days: 26,
	payable_days: 26,
	basic: '30000.00',
	da: '0.00',
	hra: '10000.00',
	conveyance: '5000.00',
	call_allowance: '5000.00',
	other_allowances: '0.00',
	bonus: '0.00',
	incentive: '0.00',
	ot_rate: '0.00',
	pf_employee: '3600.00',
	esic_employee: '0.00',
	pt: '200.00',
	loan: '0.00',
	advance: '0.00',
	tds: '0.00',
	retention: '0.00',
	mlwf: '20.00',
	total_earnings: '50000.00',
	total_deductions: '3820.00',
	net_pay: '46180.00',
};

describe('admin bulk Payroll Slip PDF (issue #247 extraction)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	it('still denies a caller without payroll:read', async () => {
		grant('employees:read');

		const res = await GET(
			new Request('http://localhost/api/payroll/bulk-pdf?month=2026-07-01')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('renders the month’s slips into one PDF under the bulk filename', async () => {
		grant('payroll:read');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([SLIP, { ...SLIP, id: 6 }]))
			.mockResolvedValueOnce(slipped([{ value_type: 'fixed', value: 2500 }]));

		const res = await GET(
			new Request('http://localhost/api/payroll/bulk-pdf?month=2026-07-01')
		);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/pdf');
		expect(res.headers.get('content-disposition')).toContain(
			'Payroll_Slips_2026-07.pdf'
		);

		const pdf = Buffer.from(await res.arrayBuffer());
		expect(pdf.subarray(0, 4).toString()).toBe('%PDF');

		// Basic/DA still resolve through the shared normalisation: the month's
		// scheduled DA is looked up before rendering.
		expect(
			statements().some((sql) => sql.includes('FROM payroll_schedules'))
		).toBe(true);
	});

	it('keeps the single-slip filename when scoped to one employee', async () => {
		grant('payroll:read');
		mocks.mockExecute
			.mockResolvedValueOnce(slipped([SLIP]))
			.mockResolvedValueOnce(slipped([]));

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/bulk-pdf?month=2026-07-01&employee_id=41'
			)
		);

		expect(res.status).toBe(200);
		expect(res.headers.get('content-disposition')).toContain(
			'Payroll_Slip_Asha_Rao_2026-07.pdf'
		);
	});

	it('404s a month with no slips, as JSON', async () => {
		grant('payroll:read');
		mocks.mockExecute.mockResolvedValueOnce(slipped([]));

		const res = await GET(
			new Request('http://localhost/api/payroll/bulk-pdf?month=2026-09-01')
		);

		expect(res.status).toBe(404);
		expect((await res.json()).success).toBe(false);
	});
});
