import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from './test-perms';

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

// jsPDF output is compressed bytes, so nothing can read the amounts back out of
// a rendered PDF. Capture what the renderer is handed instead: those slips are
// exactly what the document prints. `normalizeSlips` stays real — it is half of
// what this test is about.
vi.mock('@/lib/slip-pdf', async (importOriginal) => ({
	...(await importOriginal()),
	renderSlipsPdf: vi.fn(() => Buffer.from('pdf')),
}));

const { GET: getSlips } = await import('@/app/api/payroll/slips/route');
const { GET: getBulkPdf } = await import('@/app/api/payroll/bulk-pdf/route');
const { renderSlipsPdf } = await import('@/lib/slip-pdf');
const { slipFigures } = await import('@/lib/payroll');

const grant = grantFor(mocks.mockEnsurePermission);

const MONTH = '2026-08-01';

/**
 * Two shapes the fallback chain has to survive, plus the deeper candidates:
 * a stored `"0.00"` is a real zero, so row 1 and row 4 fall through it to the
 * profile; row 2 takes the profile's Basic; row 3, an old slip with no structure
 * or profile at all, ends up on its own stored `basic`. Rows 2 and 3 lean on
 * `da_used || da`, row 2 also on `total_earnings || gross`, and row 3 leaves the
 * deduction columns null.
 */
const SLIP_ROWS = [
	{
		id: 1,
		month: MONTH,
		employee_id: 7,
		employee_name: 'Asha Rao',
		structure_basic_salary: '0.00',
		profile_basic: 60000,
		profile_basic_plus_da: 64000,
		basic: '50000.00',
		da_used: '0.00',
		da: '0.00',
		total_earnings: '54000.00',
		total_deductions: '3820.00',
		net_pay: '50180.00',
	},
	{
		id: 2,
		month: MONTH,
		employee_id: 9,
		employee_name: 'Bilal Khan',
		structure_basic_salary: null,
		profile_basic: '45000.00',
		profile_basic_plus_da: '48000.00',
		basic: '42000.00',
		da_used: '2500.00',
		da: '2500.00',
		total_earnings: null,
		gross: '47500.00',
		total_deductions: '2000.00',
		net_pay: '45500.00',
	},
	{
		id: 3,
		month: MONTH,
		employee_id: 11,
		employee_name: 'Chitra Menon',
		structure_basic_salary: null,
		profile_basic: null,
		profile_basic_plus_da: null,
		basic: '36000.00',
		da_used: null,
		da: '1500.00',
		total_earnings: '39000.00',
		total_deductions: null,
		net_pay: null,
	},
	{
		id: 4,
		month: MONTH,
		employee_id: 12,
		employee_name: 'Dev Patel',
		structure_basic_salary: '0.00',
		profile_basic: '0.00',
		profile_basic_plus_da: '52000.00',
		basic: '40000.00',
		da_used: '0.00',
		da: '0.00',
		total_earnings: '55000.00',
		total_deductions: '3300.00',
		net_pay: '51700.00',
	},
];

/**
 * The month's DA Component Rate is percentage-valued, which contributes nothing
 * to the fixed amount readers expect — so every slip's stored DA has to stand in.
 */
const DA_SCHEDULE = [
	{
		value_type: 'percentage',
		value: 12,
		effective_from: '2026-04-01',
		effective_to: null,
	},
];

/** The six figures the shared derivation reads off a raw slip row. */
const rawFigures = (row: Record<string, unknown>) => {
	const figures = slipFigures(row);
	return {
		basic: figures.basic,
		da: figures.da,
		basicPlusDa: figures.basicPlusDa,
		gross: figures.gross,
		deductions: figures.deductions,
		net: figures.net,
	};
};

/**
 * The six figures a renderer reads off a row the shared normalization has
 * already written `basic`/`da`/`basic_plus_da_source` onto — the shape the
 * listing returns and the PDF renderer is handed. Only the other three come
 * straight from the derivation, as they do in the document and the PDF.
 */
const normalizedFigures = (row: Record<string, unknown>) => {
	const { gross, deductions, net } = slipFigures(row);
	return {
		basic: row.basic,
		da: row.da,
		basicPlusDa: row.basic_plus_da_source,
		gross,
		deductions,
		net,
	};
};

const EXPECTED = [
	{
		basic: 60000,
		da: 0,
		basicPlusDa: 60000,
		gross: 54000,
		deductions: 3820,
		net: 50180,
	},
	{
		basic: 42500,
		da: 2500,
		basicPlusDa: 45000,
		gross: 47500,
		deductions: 2000,
		net: 45500,
	},
	{
		basic: 34500,
		da: 1500,
		basicPlusDa: 36000,
		gross: 39000,
		deductions: 0,
		net: 0,
	},
	{
		basic: 52000,
		da: 0,
		basicPlusDa: 52000,
		gross: 55000,
		deductions: 3300,
		net: 51700,
	},
];

const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

/** The slips handed to the PDF renderer by the most recent render call. */
const renderedSlips = () =>
	vi.mocked(renderSlipsPdf).mock.calls.at(-1)?.[0] ?? [];

describe('Payroll Slip figures are derived once (issue #251)', () => {
	beforeEach(() => {
		// clearAllMocks, not resetAllMocks: the renderer's stub implementation has
		// to survive between tests.
		vi.clearAllMocks();
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		// Both routes read the slips first and the month's DA rate second; anything
		// else (a run or audit lookup) gets empty rows.
		mocks.mockExecute.mockImplementation(async (sql: unknown) => {
			const text = String(sql);
			if (text.includes('FROM payroll_schedules'))
				return [DA_SCHEDULE, undefined];
			if (text.includes('FROM payroll_slips')) return [SLIP_ROWS, undefined];
			return [[], undefined];
		});
	});

	it('hands the listing and the PDF export the same six figures per slip', async () => {
		grant('payroll:read');

		const listRes = await getSlips(
			new Request(`http://localhost/api/payroll/slips?month=${MONTH}`)
		);

		expect(listRes.status).toBe(200);
		const listed = (await listRes.json()).data;

		// The route's own columns first: a stored zero must not be taken as "the
		// source", and the percentage rate must leave the slip's DA in place.
		expect(listed.map((row: Record<string, unknown>) => row.basic)).toEqual([
			60000, 42500, 34500, 52000,
		]);
		expect(listed.map((row: Record<string, unknown>) => row.da)).toEqual([
			0, 2500, 1500, 0,
		]);
		expect(
			listed.map((row: Record<string, unknown>) => row.basic_plus_da_source)
		).toEqual([60000, 45000, 36000, 52000]);
		expect(listed.map(normalizedFigures)).toEqual(EXPECTED);

		const pdfRes = await getBulkPdf(
			new Request(`http://localhost/api/payroll/bulk-pdf?month=${MONTH}`)
		);

		expect(pdfRes.status).toBe(200);

		const rendered = renderedSlips();
		expect(rendered).toHaveLength(4);
		expect(rendered.map(normalizedFigures)).toEqual(EXPECTED);
		// Same figures figure for figure — the tripwire is the literals above, this
		// is the promise that the two renderers cannot drift apart again.
		expect(rendered.map(normalizedFigures)).toEqual(
			listed.map(normalizedFigures)
		);
		// And the raw rows those two readers started from derive to the same six:
		// one chain, so there is nothing to reconcile between them.
		expect(SLIP_ROWS.map(rawFigures)).toEqual(EXPECTED);

		// Each route consulted the month's schedule, and it is the percentage row
		// the stored-DA expectations depend on.
		expect(
			statements().filter((sql) => sql.includes('FROM payroll_schedules'))
		).toHaveLength(2);
		expect(
			mocks.mockExecute.mock.calls
				.filter(([sql]) => String(sql).includes('FROM payroll_schedules'))
				.map(([, params]) => (params as unknown[])[0])
		).toEqual([MONTH, MONTH]);
	});
});
