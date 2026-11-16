import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
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

const { GET } = await import('@/app/api/payroll/export-sheet/route');

const grant = grantFor(mocks.mockEnsurePermission);

type Row = Record<string, unknown>;

const MONTH = '2026-07-01';

const SLIP: Row = {
	id: 42,
	month: MONTH,
	employee_id: 7,
	employee_code: 'EMP-007',
	full_name: 'Asha Rao',
	position: 'Senior Engineer',
	uan: '100200300400',
	pf_no: 'PF/007',
	esi_no: 'ESIC/007',
	joining_date: '2024-04-01',
	basic: '30000.00',
	da: '0.00',
	da_used: '0.00',
	hra: '10000.00',
	conveyance: '0.00',
	call_allowance: '0.00',
	other_allowances: '0.00',
	bonus: '0.00',
	incentive: '0.00',
	ot_rate: '0.00',
	total_earnings: '40000.00',
	pf_employee: '1800.00',
	esic_employee: '0.00',
	pt: '200.00',
	loan: '0.00',
	advance: '0.00',
	tds: '0.00',
	retention: '0.00',
	mlwf: '0.00',
	total_deductions: '2000.00',
	net_pay: '38000.00',
	salary_profile_id: null,
	salary_profile_source: null,
	salary_type: null,
};

const COVERING_PROFILE: Row = {
	id: 1,
	employee_id: 7,
	effective_from: '2026-04-01',
	effective_to: null,
	is_active: 1,
	cancelled_at: null,
	salary_type: 'monthly',
	basic: '30000.00',
	basic_plus_da: '30000.00',
	loan_active: 1,
	loan_amount_per_month: '500.00',
	advance_active: 0,
	advance_amount: '0.00',
};

const LATER_PROFILE: Row = {
	...COVERING_PROFILE,
	id: 2,
	effective_from: '2026-09-01',
	salary_type: 'monthly',
	basic: '40000.00',
	basic_plus_da: '40000.00',
	loan_amount_per_month: '2000.00',
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

const get = (query: string) =>
	GET(new Request(`http://localhost/api/payroll/export-sheet${query}`));

async function workbookSheet(res: Response) {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(await res.arrayBuffer());
	const sheet = workbook.getWorksheet('Sheet1');
	if (!sheet) throw new Error('Sheet1 is missing from the exported workbook');
	return sheet;
}

describe('salary-sheet export — recorded salary context (#441)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	it('writes one employee row whose loan comes from the period-effective agreement, not a later profile', async () => {
		grant('payroll:read');
		// Later profile first mirrors the old ORDER BY id DESC read, so taking the
		// first profile row is exactly the later-salary repair this test rejects.
		mockDb({ profiles: [LATER_PROFILE, COVERING_PROFILE] });

		const res = await get(`?month=${MONTH}`);

		expect(res.status).toBe(200);
		const sheet = await workbookSheet(res);
		expect(sheet.getRow(7).getCell(2).value).toBe('EMP-007');
		expect(sheet.getRow(7).getCell(30).value).toBe(500);
		// The row after the one slip is the totals row: no duplicated employee row.
		expect(sheet.getRow(8).getCell(3).value).toBe('TOTAL');
	});

	it('keeps a recorded Contract slip out of the Payroll sheet and in the Contract sheet', async () => {
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
					...COVERING_PROFILE,
					id: 3,
					basic: '50000.00',
					basic_plus_da: '50000.00',
				},
			],
		});

		const payroll = await get(`?month=${MONTH}&salary_type=payroll`);
		expect(payroll.status).toBe(404);

		const contract = await get(`?month=${MONTH}&salary_type=contract`);
		expect(contract.status).toBe(200);
		const sheet = await workbookSheet(contract);
		expect(sheet.getRow(7).getCell(1).value).toBe('Asha Rao');
		expect(sheet.getRow(8).getCell(1).value).toBe('TOTAL');
	});
});
