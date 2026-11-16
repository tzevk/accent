import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SlipPdfModule from '@/lib/slip-pdf';
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
// jsPDF bytes cannot be read back; capture the slips the real normalization
// hands the renderer, which are exactly one page per recorded slip.
vi.mock('@/lib/slip-pdf', async (importOriginal) => ({
	...(await importOriginal<typeof SlipPdfModule>()),
	renderSlipsPdf: vi.fn(() => Buffer.from('pdf')),
}));

const { GET } = await import('@/app/api/payroll/bulk-pdf/route');
const { renderSlipsPdf } = await import('@/lib/slip-pdf');

const grant = grantFor(mocks.mockEnsurePermission);

type Row = Record<string, unknown>;

const MONTH = '2026-07-01';

const SLIP: Row = {
	id: 42,
	month: MONTH,
	employee_id: 7,
	employee_name: 'Asha Rao',
	department: 'Engineering',
	position: 'Senior Engineer',
	joining_date: '2024-04-01',
	standard_working_days: 26,
	payable_days: 26,
	basic: '0.00',
	da: '0.00',
	da_used: '0.00',
	hra: '10000.00',
	total_earnings: '52000.00',
	total_deductions: '2000.00',
	net_pay: '50000.00',
	salary_profile_id: null,
	salary_profile_source: null,
	salary_type: null,
};

const COVERING_PROFILE: Row = {
	id: 4,
	employee_id: 7,
	effective_from: '2026-04-01',
	effective_to: null,
	is_active: 1,
	cancelled_at: null,
	salary_type: 'monthly',
	basic: null,
	basic_plus_da: '52000.00',
};

function mockDb(options: {
	slips?: Row[];
	profiles?: Row[];
	structures?: Row[];
}): void {
	const slips = options.slips ?? [SLIP];
	const profiles = options.profiles ?? [];
	const structures = options.structures ?? [];

	mocks.mockExecute.mockImplementation(async (sql: string) => {
		const text = String(sql);
		if (text.includes('FROM payroll_slips ps')) return [slips, undefined];
		if (text.includes('FROM employee_salary_profile'))
			return [profiles, undefined];
		if (text.includes('FROM salary_structures')) return [structures, undefined];
		return [[], undefined];
	});
}

const rendered = () => vi.mocked(renderSlipsPdf).mock.calls.at(-1)?.[0] ?? [];

const get = (query: string) =>
	GET(new Request(`http://localhost/api/payroll/bulk-pdf${query}`));

describe('admin bulk Payroll Slip PDF — recorded salary context (#441)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	it('renders one document row per slip when multiple agreements cover the month', async () => {
		grant('payroll:read');
		mockDb({
			profiles: [COVERING_PROFILE, { ...COVERING_PROFILE, id: 8 }],
		});

		const res = await get(`?month=${MONTH}`);

		expect(res.status).toBe(200);
		const slips = rendered();
		expect(slips).toHaveLength(1);
		expect(slips[0].salary_context).toMatchObject({
			state: 'ambiguous',
			agreement_id: null,
		});
		expect(res.headers.get('content-disposition')).toContain(
			'Payroll_Slips_2026-07.pdf'
		);
	});

	it('normalizes a legacy zero Basic from the one confirmed covering agreement', async () => {
		grant('payroll:read');
		mockDb({ profiles: [COVERING_PROFILE] });

		const res = await get(`?month=${MONTH}`);

		expect(res.status).toBe(200);
		const [slip] = rendered();
		expect(slip.salary_context).toMatchObject({
			state: 'confirmed',
			agreement_id: 4,
			figure_basic: 52000,
		});
		expect(slip.basic).toBe(52000);
		expect(slip.basic_plus_da_source).toBe(52000);
	});

	it('does not put a recorded Contract slip into the Payroll PDF stream', async () => {
		grant('payroll:read');
		mockDb({
			slips: [
				{
					...SLIP,
					salary_profile_id: 3,
					salary_profile_source: 'employee_salary_profile',
					salary_type: 'contract',
				},
			],
			profiles: [
				{
					id: 3,
					employee_id: 7,
					effective_from: '2026-01-01',
					effective_to: null,
					is_active: 1,
					cancelled_at: null,
					salary_type: 'contract',
					basic: '50000.00',
				},
			],
		});

		const payroll = await get(`?month=${MONTH}&salary_type=payroll`);
		expect(payroll.status).toBe(404);
		expect(rendered()).toHaveLength(0);

		const contract = await get(`?month=${MONTH}&salary_type=contract`);
		expect(contract.status).toBe(200);
		expect(rendered()).toHaveLength(1);
	});
});
