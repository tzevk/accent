import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';

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

const { GET } = await import('@/app/api/payroll/slips/route');

const grant = grantFor(mocks.mockEnsurePermission);

type Row = Record<string, unknown>;

const SLIP: Row = {
	id: 42,
	month: '2026-07-01',
	employee_id: 7,
	employee_name: 'Asha Rao',
	employee_code: 'EMP-007',
	department: 'Engineering',
	designation: 'Engineer',
	position: 'Senior Engineer',
	joining_date: '2024-04-01',
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

const NEWER_PROFILE: Row = {
	id: 9,
	employee_id: 7,
	effective_from: '2026-09-01',
	effective_to: null,
	is_active: 1,
	cancelled_at: null,
	salary_type: 'contract',
	basic: '60000.00',
	basic_plus_da: '65000.00',
};

function mockDb(options: {
	slips?: Row[];
	profiles?: Row[];
	structures?: Row[];
	scheduledDA?: Row[];
}): void {
	const slips = options.slips ?? [SLIP];
	const profiles = options.profiles ?? [];
	const structures = options.structures ?? [];
	const scheduledDA = options.scheduledDA ?? [];

	mocks.mockExecute.mockImplementation(async (sql: string) => {
		const text = String(sql);
		if (text.includes('FROM payroll_slips ps')) return [slips, undefined];
		if (text.includes('FROM employee_salary_profile'))
			return [profiles, undefined];
		if (text.includes('FROM salary_structures')) return [structures, undefined];
		if (text.includes('FROM payroll_schedules'))
			return [scheduledDA, undefined];
		return [[], undefined];
	});
}

const get = (query: string) =>
	GET(new Request(`http://localhost/api/payroll/slips${query}`));

describe('payroll slips listing — recorded salary context (#441)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	it('returns one row per slip and discloses ambiguity instead of multiplying by agreements', async () => {
		grant('payroll:read');
		mockDb({
			profiles: [COVERING_PROFILE, { ...COVERING_PROFILE, id: 8 }],
		});

		const res = await get('?month=2026-07-01');

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0]).toMatchObject({
			id: 42,
			salary_type: null,
			salary_context: {
				state: 'ambiguous',
				agreement_id: null,
				salary_type: null,
				stream: null,
			},
		});
		expect(body.data[0].salary_context.conflicts).toHaveLength(2);
		expect(body.data[0].salary_context.disclosures).toContain(
			'ambiguous_covering_agreements'
		);
	});

	it('resolves a legacy zero/missing Basic from the confirmed period context, once', async () => {
		grant('payroll:read');
		mockDb({ profiles: [COVERING_PROFILE] });

		const res = await get('?month=2026-07-01');

		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].salary_context).toMatchObject({
			state: 'confirmed',
			agreement_id: 4,
			salary_type: 'monthly',
			stream: 'payroll',
			figure_basic: 52000,
			figure_basic_source: 'canonical_basic_plus_da',
		});
		// The slip's own Basic was zero, so the confirmed period Basic+DA is the
		// one shared fallback; the slip's stored DA still owns the split.
		expect(body.data[0].basic).toBe(52000);
		expect(body.data[0].basic_plus_da_source).toBe(52000);
	});

	it('keeps a recorded Contract slip in Contract after a newer Payroll agreement appears', async () => {
		grant('payroll:read');
		const recordedContract: Row = {
			...SLIP,
			salary_profile_id: 3,
			salary_profile_source: 'employee_salary_profile',
			salary_type: 'contract',
		};
		const recordedRow: Row = {
			id: 3,
			employee_id: 7,
			effective_from: '2026-01-01',
			effective_to: '2026-06-30',
			is_active: 1,
			cancelled_at: null,
			salary_type: 'contract',
			basic: '50000.00',
			basic_plus_da: '50000.00',
		};
		mockDb({
			slips: [recordedContract],
			profiles: [recordedRow, NEWER_PROFILE],
		});

		const contract = await get('?month=2026-07-01&salary_type=contract');
		const contractBody = await contract.json();
		expect(contractBody.data).toHaveLength(1);
		expect(contractBody.data[0].salary_context).toMatchObject({
			state: 'recorded',
			salary_type: 'contract',
			salary_type_source: 'recorded_slip',
			stream: 'contract',
		});

		const payroll = await get('?month=2026-07-01&salary_type=payroll');
		const payrollBody = await payroll.json();
		expect(payrollBody.data).toEqual([]);
	});

	it('keeps an unresolved legacy slip visible in the conservative Payroll stream only', async () => {
		grant('payroll:read');
		mockDb({});

		const payroll = await get('?month=2026-07-01&salary_type=payroll');
		const payrollBody = await payroll.json();
		expect(payrollBody.data).toHaveLength(1);
		expect(payrollBody.data[0].salary_context.state).toBe('unavailable');

		const contract = await get('?month=2026-07-01&salary_type=contract');
		expect((await contract.json()).data).toEqual([]);
	});
});
