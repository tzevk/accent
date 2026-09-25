import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SlipPdfModule from '@/lib/slip-pdf';
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
	PERMISSIONS: { READ: 'read', UPDATE: 'update', DELETE: 'delete' },
}));

// jsPDF output is compressed bytes, so nothing can read the amounts back out of
// a rendered PDF. Capture what the renderer is handed instead: those slips are
// exactly what the document prints. `normalizeSlips` stays real — it is half of
// what this test is about.
vi.mock('@/lib/slip-pdf', async (importOriginal) => ({
	...(await importOriginal<typeof SlipPdfModule>()),
	renderSlipsPdf: vi.fn(() => Buffer.from('pdf')),
}));

const { GET: getSlips } = await import('@/app/api/payroll/slips/route');
const { GET: getBulkPdf } = await import('@/app/api/payroll/bulk-pdf/route');
const { renderSlipsPdf } = await import('@/lib/slip-pdf');
const { slipFigures, normalizedSlipFigures } = await import('@/lib/payroll');

const grant = grantFor(mocks.mockEnsurePermission);

const MONTH = '2026-08-01';

/**
 * A Payroll Slip is a snapshot, so its own columns are the money. Row 1 is the
 * case that used to drift: the slip stored Basic 27000 while the Salary Profile
 * and the legacy Salary Structure now say 18000, and the slip's own totals were
 * computed from the stored 27000 — reading the profile back in is how the
 * printed slip stopped adding up.
 *
 * Rows 2 and 3 have no Basic of their own, so the canonical sources repair them
 * (Salary Profile Basic, then Salary Profile Basic+DA, and the legacy Salary
 * Structure last — ADR-0001). Row 3 also has no `total_earnings`, so its Gross
 * falls back to the stored `gross`.
 */
const SLIP_ROWS = [
	{
		id: 1,
		month: MONTH,
		employee_id: 7,
		employee_name: 'Asha Rao',
		basic: '27000.00',
		da_used: '0.00',
		da: '0.00',
		structure_basic_salary: '18000.00',
		profile_basic: '18000.00',
		profile_basic_plus_da: '21000.00',
		hra: '9000.00',
		total_earnings: '54000.00',
		total_deductions: '2000.00',
		net_pay: '52000.00',
	},
	{
		id: 2,
		month: MONTH,
		employee_id: 9,
		employee_name: 'Bilal Khan',
		basic: '0.00',
		da_used: '0.00',
		da: '0.00',
		structure_basic_salary: '0.00',
		profile_basic: '45000.00',
		profile_basic_plus_da: '48000.00',
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
		basic: null,
		da_used: null,
		da: '1500.00',
		structure_basic_salary: '40000.00',
		profile_basic: null,
		profile_basic_plus_da: '52000.00',
		total_earnings: '39000.00',
		total_deductions: null,
		net_pay: null,
	},
	{
		// DA in the snapshot AND a month rate that replaces it: the row a second
		// derivation would move a second time, because `da_used` still holds 1000
		// after the split was made against 2500.
		id: 4,
		month: MONTH,
		employee_id: 14,
		employee_name: 'Dev Patel',
		basic: '20000.00',
		da_used: '1000.00',
		da: '1000.00',
		profile_basic: '26000.00',
		profile_basic_plus_da: '28000.00',
		total_earnings: '26000.00',
		total_deductions: '1500.00',
		net_pay: '24500.00',
	},
];

/**
 * The month's DA Component Rate is percentage-valued, which contributes nothing
 * to the fixed amount readers expect — so every slip keeps its stored DA.
 */
const PERCENTAGE_DA = [
	{
		value_type: 'percentage',
		value: 12,
		effective_from: '2026-04-01',
		effective_to: null,
	},
];

const FIXED_DA = [
	{
		value_type: 'fixed',
		value: 2500,
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

/** The month rate is percentage-valued, so no slip's stored DA moves. */
const EXPECTED = [
	{
		basic: 27000,
		da: 0,
		basicPlusDa: 27000,
		gross: 54000,
		deductions: 2000,
		net: 52000,
	},
	{
		basic: 45000,
		da: 0,
		basicPlusDa: 45000,
		gross: 47500,
		deductions: 2000,
		net: 45500,
	},
	{
		// No Basic of its own: the Salary Profile's Basic+DA repairs it and the
		// legacy Salary Structure (40000) is not reached.
		basic: 50500,
		da: 1500,
		basicPlusDa: 52000,
		gross: 39000,
		deductions: 0,
		net: 0,
	},
	{
		basic: 20000,
		da: 1000,
		basicPlusDa: 21000,
		gross: 26000,
		deductions: 1500,
		net: 24500,
	},
];

/** A fixed rate for the month replaces every slip's stored DA. */
const EXPECTED_FIXED_DA = [
	{
		basic: 24500,
		da: 2500,
		basicPlusDa: 27000,
		gross: 54000,
		deductions: 2000,
		net: 52000,
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
		basic: 49500,
		da: 2500,
		basicPlusDa: 52000,
		gross: 39000,
		deductions: 0,
		net: 0,
	},
	{
		basic: 18500,
		da: 2500,
		basicPlusDa: 21000,
		gross: 26000,
		deductions: 1500,
		net: 24500,
	},
];

const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

/** The slips handed to the PDF renderer by the most recent render call. */
const renderedSlips = () =>
	vi.mocked(renderSlipsPdf).mock.calls.at(-1)?.[0] ?? [];

const listedSlips = async () => {
	grant('payroll:read');
	const res = await getSlips(
		new Request(`http://localhost/api/payroll/slips?month=${MONTH}`)
	);
	expect(res.status).toBe(200);
	return (await res.json()).data as Array<Record<string, unknown>>;
};

const pdfSlips = async () => {
	grant('payroll:read');
	const res = await getBulkPdf(
		new Request(`http://localhost/api/payroll/bulk-pdf?month=${MONTH}`)
	);
	expect(res.status).toBe(200);
	return renderedSlips() as Array<Record<string, unknown>>;
};

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
				return [PERCENTAGE_DA, undefined];
			if (text.includes('FROM payroll_slips')) return [SLIP_ROWS, undefined];
			return [[], undefined];
		});
	});

	it('hands the listing and the PDF export the same six figures per slip', async () => {
		const listed = await listedSlips();

		// The route's own columns first: the snapshot's Basic wins over the Salary
		// Profile, a stored zero falls through to the profile, and a percentage
		// rate leaves the slip's own DA in place.
		expect(listed.map((row) => row.basic)).toEqual([
			27000, 45000, 50500, 20000,
		]);
		expect(listed.map((row) => row.da)).toEqual([0, 0, 1500, 1000]);
		expect(listed.map((row) => row.basic_plus_da_source)).toEqual([
			27000, 45000, 52000, 21000,
		]);
		expect(listed.map(normalizedFigures)).toEqual(EXPECTED);

		const rendered = await pdfSlips();

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

	it("lets the month's fixed DA rate re-split the snapshot, Basic+DA intact", async () => {
		mocks.mockExecute.mockImplementation(async (sql: unknown) => {
			const text = String(sql);
			if (text.includes('FROM payroll_schedules')) return [FIXED_DA, undefined];
			if (text.includes('FROM payroll_slips')) return [SLIP_ROWS, undefined];
			return [[], undefined];
		});

		const listed = await listedSlips();

		expect(listed.map(normalizedFigures)).toEqual(EXPECTED_FIXED_DA);
		// A reader of that same row — the run dashboard — reads these figures back
		// instead of deriving them again. Deriving again would take row 4's derived
		// Basic (18500) and the raw `da_used` still behind it (1000) and move the
		// split a second time, printing a Basic no other reader shows.
		expect(listed.map(normalizedSlipFigures)).toEqual(EXPECTED_FIXED_DA);
		// Basic+DA is the snapshot's own number either way: the scheduled rate only
		// moves the split, never the amount.
		expect(listed.map((row) => row.basic_plus_da_source)).toEqual(
			SLIP_ROWS.map((row) => rawFigures(row).basicPlusDa)
		);
	});

	it('keeps the three totals on the snapshot, whatever the profile says now', async () => {
		const listed = await listedSlips();

		// A reader that recomputed Gross from the row's allowance columns would
		// report 45000 here, and a Net of 43000 — money the employee never got.
		expect(listed[0]).toMatchObject({
			total_earnings: '54000.00',
			total_deductions: '2000.00',
			net_pay: '52000.00',
		});
		expect(normalizedFigures(listed[0]).gross).toBe(54000);
		expect(normalizedFigures(listed[0]).net).toBe(52000);
	});
});
