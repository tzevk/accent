/**
 * Typed, journey-only helpers for the #431 payroll-review spec.
 *
 * They keep the single browser journey readable without moving any financial
 * calculation or assertion to the browser: the spec still compares authored
 * fixture sentinels with the real projection and the independent database read.
 */
import {
	expect,
	type Locator,
	type Page,
	type Request,
} from '@playwright/test';
import type {
	PayrollReviewFixture,
	PayrollReviewState,
} from '../fixtures/payroll-review.ts';

export interface CompanySheetCellPayload {
	readonly state: 'text' | 'number' | 'not_available';
	readonly value?: string | number;
	readonly reason?: string;
}

export interface CompanySheetAttendanceBucketsPayload {
	readonly total_days: number;
	readonly present: number;
	readonly absent: number;
	readonly half_days: number;
	readonly paid_leave: number;
	readonly unpaid_leave: number;
	readonly holidays: number;
	readonly weekly_off: number;
	readonly unrecorded: number;
	readonly outside_employment: number;
	readonly days_paid: number;
	readonly lwp_days: number;
	readonly ot_hours: number;
}

export interface CompanySheetDeductionDetailPayload {
	readonly id: string;
	readonly label: string;
	readonly amount: number | null;
	readonly state: 'recorded' | 'not_recorded';
	readonly in_company_columns: boolean;
	readonly note?: string;
}

export interface CompanySheetRowPayload {
	readonly slip_id: number;
	readonly employee_id: number;
	readonly cells: Readonly<Record<string, CompanySheetCellPayload>>;
	readonly attendance:
		| {
				readonly state: 'available';
				readonly buckets: CompanySheetAttendanceBucketsPayload;
		  }
		| { readonly state: 'unavailable'; readonly reason: string };
	readonly deduction_details: readonly CompanySheetDeductionDetailPayload[];
	readonly issues: readonly unknown[];
}

export interface CompanySheetMetaPayload {
	readonly month: string;
	readonly month_key: string;
	readonly total_days: number;
	readonly sources: unknown;
	readonly issues: readonly unknown[];
}

export interface PayrollProjectionRow {
	readonly id: number;
	readonly month: string;
	readonly employee_id: number;
	readonly employee_code: string;
	readonly employee_name: string;
	readonly gross: number | string;
	readonly total_earnings: number | string;
	readonly total_deductions: number | string;
	readonly net_pay: number | string;
	readonly days_present: number | string;
	readonly company_sheet: CompanySheetRowPayload;
}

export interface PayrollProjectionPayload {
	readonly success: boolean;
	readonly data: readonly PayrollProjectionRow[];
	readonly company_sheet?: CompanySheetMetaPayload;
}

/** The one returned Payroll Slip for the fixture Employee. */
export function projectionRowFor(
	payload: PayrollProjectionPayload,
	employeeId: number
): PayrollProjectionRow {
	const row = payload.data.find(
		(candidate) => Number(candidate.employee_id) === employeeId
	);
	if (!row) {
		throw new Error(`The projection did not include Employee ${employeeId}.`);
	}
	return row;
}

/** A company cell that must be a known number, never a blank or a default. */
export function numericCell(
	row: PayrollProjectionRow,
	columnId: string
): number {
	const cell = row.company_sheet.cells[columnId];
	if (cell?.state !== 'number' || typeof cell.value !== 'number') {
		throw new Error(
			`Company cell ${columnId} is not a recorded number: ${JSON.stringify(cell)}`
		);
	}
	return cell.value;
}

/**
 * The before/after evidence read through the independent connection. The
 * frozen Payroll Slip snapshot must differ from current attendance while every
 * recorded financial value stays the authored fixture value.
 */
export function expectStoredStateMatchesFixture(
	state: PayrollReviewState,
	fixture: PayrollReviewFixture
): void {
	expect(state.run).toMatchObject({
		id: fixture.runId,
		status: 'draft',
		totalGross: fixture.expected.money.gross,
		totalDeductions: fixture.expected.money.totalDeductions,
		totalNetPay: fixture.expected.money.netSal,
	});
	expect(state.slips).toHaveLength(1);
	expect(state.slips[0]).toMatchObject({
		id: fixture.employee.slip.id,
		month: fixture.month,
		gross: fixture.expected.money.fullMonthContractualGross,
		totalEarnings: fixture.expected.money.gross,
		totalDeductions: fixture.expected.money.totalDeductions,
		netPay: fixture.expected.money.netSal,
		mlwf: fixture.expected.money.mlwf,
		otherDeductions: fixture.expected.money.combinedOtherDeductions,
		daysPresent: fixture.employee.slip.snapshot.daysPresent,
	});
	expect(fixture.employee.slip.snapshot.daysPresent).not.toBe(
		fixture.expected.attendance.daysPresent
	);
}

/** The real projection must carry the fixture month and authoritative money. */
export function expectProjectionMatchesFixture(
	payload: PayrollProjectionPayload,
	fixture: PayrollReviewFixture
): void {
	expect(payload.success).toBe(true);
	expect(payload.data).toHaveLength(1);
	expect(payload.company_sheet).toMatchObject({
		month: fixture.month,
		month_key: fixture.monthSlug,
		total_days: fixture.expected.attendance.totalDays,
	});
	const projection = projectionRowFor(payload, fixture.employee.employeeId);
	expect(projection.month).toBe(fixture.month);
	expect(projection.employee_name).toBe(fixture.employee.fullName);
	expect(projection.employee_code).toBe(fixture.employee.employeeCode);
	expect(projection.company_sheet.slip_id).toBe(fixture.employee.slip.id);
	expect(Number(projection.gross)).toBe(
		fixture.expected.money.fullMonthContractualGross
	);
	expect(Number(projection.total_earnings)).toBe(fixture.expected.money.gross);
	expect(Number(projection.total_deductions)).toBe(
		fixture.expected.money.totalDeductions
	);
	expect(Number(projection.net_pay)).toBe(fixture.expected.money.netSal);
	expect(numericCell(projection, 'total_days')).toBe(
		fixture.expected.attendance.totalDays
	);
	expect(numericCell(projection, 'days_present')).toBe(
		fixture.expected.attendance.daysPresent
	);
	expect(numericCell(projection, 'gross')).toBe(fixture.expected.money.gross);
	expect(numericCell(projection, 'total_ded')).toBe(
		fixture.expected.money.totalDeductions
	);
	expect(numericCell(projection, 'net_sal')).toBe(
		fixture.expected.money.netSal
	);
	expect(projection.company_sheet.attendance).toMatchObject({
		state: 'available',
		buckets: {
			present: fixture.expected.attendance.daysPresent,
			days_paid: fixture.expected.attendance.daysPaid,
			lwp_days: fixture.expected.attendance.lwpDays,
			ot_hours: fixture.expected.attendance.otHours,
			unrecorded: fixture.expected.attendance.unrecorded,
			outside_employment: fixture.expected.attendance.outsideEmployment,
		},
	});
}

/**
 * Scroll to the financial end and prove the frozen identity columns keep their
 * relative position and do not overlap, while NET SAL stays inside the readable
 * viewport. Observable layout, never a fixed CSS value or a screenshot baseline.
 */
export async function expectFrozenIdentityAtFinancialEnd(
	sheet: Locator,
	row: Locator,
	indexes: Readonly<Record<string, number>>,
	expectedNetText: string
): Promise<void> {
	await sheet.scrollIntoViewIfNeeded();
	const viewportBefore = await sheetViewport(sheet);
	expect(viewportBefore.scrollWidth).toBeGreaterThan(
		viewportBefore.clientWidth
	);
	const cells = row.getByRole('cell');
	const codeCell = cells.nth(indexes['Employee Code']);
	const nameCell = cells.nth(indexes['Full Name']);
	const netCell = cells.nth(indexes['NET SAL']);
	const codeBefore = await visibleBox(codeCell);
	const nameBefore = await visibleBox(nameCell);
	expect(nameBefore.x + 1).toBeGreaterThanOrEqual(
		codeBefore.x + codeBefore.width - 1
	);

	await scrollSheetToEnd(sheet);
	const viewportAfter = await sheetViewport(sheet);
	const codeAfter = await visibleBox(codeCell);
	const nameAfter = await visibleBox(nameCell);
	const netAfter = await visibleBox(netCell);
	expect(codeAfter.x).toBeGreaterThanOrEqual(viewportAfter.left - 1);
	expect(codeAfter.x + codeAfter.width).toBeLessThanOrEqual(
		viewportAfter.right + 1
	);
	expect(nameAfter.x).toBeGreaterThanOrEqual(codeAfter.x + codeAfter.width - 1);
	expect(
		Math.abs(nameAfter.x - codeAfter.x - (nameBefore.x - codeBefore.x))
	).toBeLessThanOrEqual(1);
	expect(
		Math.abs(
			nameAfter.x - viewportAfter.left - (nameBefore.x - viewportBefore.left)
		)
	).toBeLessThanOrEqual(1);
	await expect(netCell).toHaveText(expectedNetText);
	await expect(netCell).toBeVisible();
	expect(netAfter.x).toBeGreaterThanOrEqual(viewportAfter.left - 1);
	expect(netAfter.x + netAfter.width).toBeLessThanOrEqual(
		viewportAfter.right + 1
	);
	expect(netAfter.y).toBeGreaterThanOrEqual(viewportAfter.top - 1);
	expect(netAfter.y + netAfter.height).toBeLessThanOrEqual(
		viewportAfter.bottom + 1
	);
}

/** The existing Payroll Slip document opened through the Full Name link. */
export async function expectSlipDocument(
	page: Page,
	fixture: PayrollReviewFixture
): Promise<void> {
	await expect(page).toHaveURL(
		new RegExp(`/admin/payroll/slips/${fixture.employee.slip.id}$`)
	);
	await expect(
		page.getByRole('heading', { name: 'Payroll Slip', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('cell', { name: fixture.employee.fullName, exact: true })
	).toBeVisible();
	const monthHeading = new Intl.DateTimeFormat('en-IN', {
		month: 'long',
		year: 'numeric',
	})
		.format(new Date(`${fixture.month}T00:00:00`))
		.toUpperCase();
	await expect(
		page.getByText(`PAYROLL SLIP FOR THE MONTH OF ${monthHeading}`, {
			exact: true,
		})
	).toBeVisible();
	// The existing document keeps its plain two-decimal amounts, not grid currency.
	await expect(
		page.getByText('TOTAL DEDUCTION', { exact: true })
	).toBeVisible();
	await expect(
		page.getByText(fixture.expected.money.totalDeductions.toFixed(2), {
			exact: true,
		})
	).toBeVisible();
	await expect(
		page.getByText('NET SALARY PAYABLE', { exact: true })
	).toBeVisible();
	await expect(
		page.getByText(fixture.expected.money.netSal.toFixed(2), { exact: true })
	).toBeVisible();
}

/**
 * Map the contract sentinel captions to their positions in the real header row.
 * The spec names only the cells it reviews; it does not duplicate the catalog.
 */
export async function payrollColumnIndexes(
	sheet: Locator,
	labels: readonly string[]
): Promise<Readonly<Record<string, number>>> {
	const headers = await sheet.getByRole('columnheader').allTextContents();
	const indexes: Record<string, number> = {};
	for (const label of labels) {
		const index = headers.indexOf(label);
		if (index < 0) {
			throw new Error(
				`Company payroll sheet has no ${JSON.stringify(label)} column.`
			);
		}
		indexes[label] = index;
	}
	return indexes;
}

export async function visibleBox(locator: Locator) {
	const box = await locator.boundingBox();
	if (!box) {
		throw new Error('Expected the observed element to have a bounding box.');
	}
	return box;
}

/** Scroll the sheet to its financial end and wait for the observable result. */
export async function scrollSheetToEnd(sheet: Locator): Promise<void> {
	await sheet.evaluate((element) => {
		element.scrollLeft = element.scrollWidth;
	});
	await expect
		.poll(
			() =>
				sheet.evaluate(
					(element) =>
						element.scrollLeft + element.clientWidth >= element.scrollWidth - 1
				),
			{ timeout: 10_000 }
		)
		.toBe(true);
}

/** The visible scroll viewport, excluding scrollbar gutters. */
export async function sheetViewport(sheet: Locator) {
	return sheet.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return {
			left: rect.left,
			right: rect.left + element.clientWidth,
			top: rect.top,
			bottom: rect.top + element.clientHeight,
			scrollWidth: element.scrollWidth,
			clientWidth: element.clientWidth,
		};
	});
}

/**
 * Record any non-read request to a payroll endpoint after authentication.
 * Fixture setup and sign-in happen before this guard is attached.
 */
export function guardPayrollWrites(page: Page): {
	readonly violations: string[];
} {
	const violations: string[] = [];
	page.on('request', (request: Request) => {
		if (request.method() === 'GET' || request.method() === 'HEAD') return;
		if (request.method() === 'OPTIONS') return;
		const { pathname } = new URL(request.url());
		if (pathname === '/api/payroll' || pathname.startsWith('/api/payroll/')) {
			violations.push(`${request.method()} ${pathname}`);
		}
	});
	return { violations };
}
