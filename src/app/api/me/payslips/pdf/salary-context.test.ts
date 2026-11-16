import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SlipPdfModule from '@/lib/slip-pdf';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockGetCurrentUser: vi.fn(),
	mockExecute: vi.fn(),
}));

vi.mock('@/utils/database', () => ({
	dbConnect: mocks.mockDbConnect,
	withTransaction: vi.fn(),
}));
vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mocks.mockGetCurrentUser,
	RESOURCES: { PAYROLL: 'payroll' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));
// jsPDF bytes cannot be read back; capture the slips the shared normalization
// hands the renderer, which are exactly one document per recorded slip.
vi.mock('@/lib/slip-pdf', async (importOriginal) => ({
	...(await importOriginal<typeof SlipPdfModule>()),
	renderSlipsPdf: vi.fn(() => Buffer.from('pdf')),
}));

const { GET } = await import('@/app/api/me/payslips/pdf/route');
const { renderSlipsPdf } = await import('@/lib/slip-pdf');

/** The signed-in employee: session user 9 is linked to Employee 41. */
const SESSION_USER = { id: 9, employee_id: 41, username: 'asha' };

type Row = Record<string, unknown>;

const MONTH = '2026-07-01';

const SLIP: Row = {
	id: 42,
	month: MONTH,
	employee_id: 41,
	employee_name: 'Asha Rao',
	employee_code: 'EMP-041',
	department: 'Engineering',
	designation: 'Engineer',
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

/**
 * The columns the retired `LIMIT 1` join used to add: whichever active
 * agreement the database happened to return first. These are the salary figures
 * a current/future agreement carries, not the slip's recorded ones.
 */
const RETIRED_JOIN_ROW: Row = {
	profile_basic: '90000.00',
	profile_basic_plus_da: '95000.00',
	structure_basic_salary: '0.00',
};

const RECORDED_PROFILE: Row = {
	id: 4,
	employee_id: 41,
	effective_from: '2025-04-01',
	effective_to: '2026-06-30',
	is_active: 1,
	cancelled_at: null,
	salary_type: 'monthly',
	basic: '18000.00',
	basic_plus_da: '18000.00',
};

const CURRENT_PROFILE: Row = {
	id: 9,
	employee_id: 41,
	effective_from: '2026-07-01',
	effective_to: null,
	is_active: 1,
	cancelled_at: null,
	salary_type: 'contract',
	basic: '90000.00',
	basic_plus_da: '95000.00',
};

const LEGACY_PROFILE: Row = {
	...CURRENT_PROFILE,
	id: 4,
	effective_from: '2025-04-01',
	effective_to: null,
	salary_type: 'monthly',
	basic: '18000.00',
	basic_plus_da: '18000.00',
};

const FUTURE_PROFILE: Row = {
	...CURRENT_PROFILE,
	effective_from: '2026-09-01',
};

/**
 * Dispatch like the database: the retired self-service query returned one
 * arbitrary joined row because of its `LIMIT 1`; the migrated query reads the
 * slip alone and the shared reader resolves its agreement separately.
 */
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
		if (text.includes('FROM users')) return [[{ employee_id: 41 }], undefined];
		if (text.includes('FROM payroll_slips ps')) {
			if (
				text.includes('employee_salary_profile') ||
				text.includes('salary_structures')
			) {
				return [[{ ...slips[0], ...RETIRED_JOIN_ROW }], undefined];
			}
			return [slips, undefined];
		}
		if (text.includes('FROM employee_salary_profile'))
			return [profiles, undefined];
		if (text.includes('FROM salary_structures')) return [structures, undefined];
		return [[], undefined];
	});
}

const rendered = () => vi.mocked(renderSlipsPdf).mock.calls.at(-1)?.[0] ?? [];

const get = (query: string) =>
	GET(new Request(`http://localhost/api/me/payslips/pdf${query}`));

describe('my Payroll Slip PDF — recorded salary context (#442)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockGetCurrentUser.mockResolvedValue(SESSION_USER);
		mocks.mockExecute.mockResolvedValue([[], undefined]);
	});

	it('prints the recorded agreement, not a newer active profile or a duplicate join row', async () => {
		mockDb({
			slips: [
				{
					...SLIP,
					salary_profile_id: 4,
					salary_profile_source: 'employee_salary_profile',
					salary_type: 'monthly',
				},
			],
			profiles: [RECORDED_PROFILE, CURRENT_PROFILE],
		});

		const res = await get('?month=2026-07&employee_id=99');

		expect(res.status).toBe(200);
		const slips = rendered();
		expect(slips).toHaveLength(1);
		expect(slips[0].salary_context).toMatchObject({
			state: 'recorded',
			agreement_id: 4,
			salary_type: 'monthly',
			figure_basic: 18000,
		});
		// The recorded agreement ended before the slip month, and a newer active
		// agreement now says 90000. The recorded row still wins; a revision never
		// re-prices an older document.
		expect(slips[0].basic).toBe(18000);
		expect(slips[0].basic_plus_da_source).toBe(18000);

		// Identity still comes from the session: the agreement read is scoped to
		// the linked Employee and never to a query-string employee.
		const agreementRead = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('FROM employee_salary_profile')
		) as [string, unknown[]];
		expect(agreementRead[1]).toContain(41);
		expect(agreementRead[1]).not.toContain(99);
	});

	it('repairs a legacy zero Basic from the one agreement covering the slip month', async () => {
		const covering = {
			...CURRENT_PROFILE,
			id: 4,
			effective_from: '2025-04-01',
			effective_to: null,
			salary_type: 'monthly',
			basic: null,
			basic_plus_da: '52000.00',
		};
		mockDb({ profiles: [covering, FUTURE_PROFILE] });

		const res = await get('?month=2026-07');

		expect(res.status).toBe(200);
		const slips = rendered();
		expect(slips).toHaveLength(1);
		expect(slips[0].salary_context).toMatchObject({
			state: 'confirmed',
			agreement_id: 4,
			figure_basic: 52000,
		});
		expect(slips[0].basic).toBe(52000);
		expect(slips[0].basic_plus_da_source).toBe(52000);
	});

	it('renders recorded money once and discloses an ambiguous legacy history', async () => {
		mockDb({
			slips: [{ ...SLIP, basic: '30000.00', da: '0.00' }],
			profiles: [LEGACY_PROFILE, { ...LEGACY_PROFILE, id: 8 }],
		});

		const res = await get('?month=2026-07');

		expect(res.status).toBe(200);
		const slips = rendered();
		expect(slips).toHaveLength(1);
		expect(slips[0].basic).toBe(30000);
		expect(slips[0].salary_context).toMatchObject({
			state: 'ambiguous',
			agreement_id: null,
		});
		expect(slips[0].salary_context.disclosures).toContain(
			'ambiguous_covering_agreements'
		);
	});

	it('does not borrow a later agreement for an uncovered legacy month', async () => {
		mockDb({ profiles: [FUTURE_PROFILE] });

		const res = await get('?month=2026-07');

		expect(res.status).toBe(200);
		const slips = rendered();
		expect(slips).toHaveLength(1);
		expect(slips[0].basic).toBe(0);
		expect(slips[0].salary_context).toMatchObject({
			state: 'unavailable',
			agreement_id: null,
			figure_basic: null,
		});
		expect(slips[0].salary_context.disclosures).toContain(
			'no_covering_agreement'
		);
	});
});
