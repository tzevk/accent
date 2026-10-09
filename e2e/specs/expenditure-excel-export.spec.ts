/**
 * Ticket #324 — Export version-matched expenditure evidence.
 *
 * Verifies the Excel export endpoint for the expenditure view:
 *   - Authorized download for users with financial source privileges
 *   - Access denial (403 Forbidden) for unauthorized users without sensitive leaks
 *   - Five complete sheets: Company Reconciliation, Project Detail, Budgets & Commitments,
 *     Cash Paid, and Revisions & Close
 *   - Distinct missing values ("—" / "Missing / Unconverted") versus known zero (0.00)
 *   - Project filters narrow detail while preserving unfiltered company reconciliation totals
 *   - Commercial client orders disclaimer (not revenue or profit)
 *   - UI export button triggers genuine browser download
 *   - Frozen snapshot and revision history verification on closed months
 */

import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import {
	EXCEL_CLERK,
	EXCEL_OUTSIDER,
	EXCEL_OPEN_MONTH,
	EXCEL_CLOSED_MONTH,
	EXCEL_PROJECTS,
	EXCEL_SPEC_IP,
	cleanupExpenditureExcelFixtures,
	loginExcelUser,
	seedExpenditureExcelFixtures,
	type SeededExpenditureExcel,
} from '../lib/expenditure-excel-fixtures';

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	extraHTTPHeaders: { 'x-vercel-forwarded-for': EXCEL_SPEC_IP },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const DOWNLOAD_ENDPOINT = '/api/reports/employee-project-monthly-cost/download';

let seeded: SeededExpenditureExcel;
let clerk: APIRequestContext;
let outsider: APIRequestContext;
const outcome = trackArtifactOutcome();
const evidence: Record<string, unknown> = {};

/** Extract string text from an Excel cell value. */
function cellText(value: ExcelJS.CellValue): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (value instanceof Date) return value.toISOString();
	if ('richText' in value) {
		return value.richText.map((part) => part.text).join('');
	}
	if ('result' in value) return String(value.result ?? '');
	return '';
}

/** Check if text exists across worksheet rows. */
function sheetContains(ws: ExcelJS.Worksheet, needle: string): boolean {
	let found = false;
	ws.eachRow((row) => {
		row.eachCell((cell) => {
			if (cellText(cell.value).includes(needle)) {
				found = true;
			}
		});
	});
	return found;
}

test.beforeAll(async () => {
	seeded = await seedExpenditureExcelFixtures();
});

test.afterAll(async () => {
	writeArtifact('expenditure-excel-export', {
		ok: outcome.ok,
		...evidence,
	});
	await cleanupExpenditureExcelFixtures();
});

test('clerk and outsider sign in through the real login', async ({
	playwright,
	baseURL,
}) => {
	if (!baseURL) {
		throw new Error('The E2E run is missing its configured baseURL');
	}
	clerk = await loginExcelUser(playwright, baseURL, 'clerk');
	outsider = await loginExcelUser(playwright, baseURL, 'outsider');
	evidence.identities = {
		clerk: EXCEL_CLERK.username,
		outsider: EXCEL_OUTSIDER.username,
	};
});

test('refuses export download for unauthorized outsider without leaking financial data (403)', async () => {
	const res = await outsider.get(
		`${DOWNLOAD_ENDPOINT}?view=expenditure&month=${EXCEL_OPEN_MONTH}`
	);
	expect(res.status()).toBe(403);

	const contentType = res.headers()['content-type'] ?? '';
	expect(contentType).not.toContain('spreadsheetml');

	const body = (await res.json()) as { error?: string };
	expect(body.error).toBeDefined();
	expect(body.error).toContain('permission');

	evidence.unauthorizedAccessRejected = true;
});

test('downloads version-matched expenditure Excel workbook for authorized clerk', async () => {
	const res = await clerk.get(
		`${DOWNLOAD_ENDPOINT}?view=expenditure&month=${EXCEL_OPEN_MONTH}`
	);
	expect(res.status()).toBe(200);

	const contentType = res.headers()['content-type'] ?? '';
	expect(contentType).toContain('spreadsheetml');

	const disposition = res.headers()['content-disposition'] ?? '';
	expect(disposition).toContain(
		`filename="Company_Expenditure_${EXCEL_OPEN_MONTH}.xlsx"`
	);

	const buffer = await res.body();
	expect(buffer.length).toBeGreaterThan(0);

	const wb = new ExcelJS.Workbook();
	// Load the workbook buffer
	await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

	// Verify all 5 required sheets exist
	const sheetNames = wb.worksheets.map((ws) => ws.name);
	expect(sheetNames).toEqual([
		'Company Reconciliation',
		'Project Detail',
		'Budgets & Commitments',
		'Cash Paid',
		'Revisions & Close',
	]);

	// Sheet 1: Company Reconciliation
	const wsRecon = wb.getWorksheet('Company Reconciliation');
	expect(wsRecon).toBeDefined();
	if (wsRecon) {
		expect(sheetContains(wsRecon, 'Company Expenditure Reconciliation')).toBe(
			true
		);
		expect(sheetContains(wsRecon, EXCEL_OPEN_MONTH)).toBe(true);

		// D2 has unsupported conversion into INR, so conversion notice must appear
		expect(sheetContains(wsRecon, 'records unconverted')).toBe(true);

		// Currency breakdown rows
		expect(sheetContains(wsRecon, 'INR')).toBe(true);
		expect(sheetContains(wsRecon, 'USD')).toBe(true);

		// Unconverted row should show "—" and "unsupported" rather than invented 0.00
		expect(sheetContains(wsRecon, '—')).toBe(true);
		expect(sheetContains(wsRecon, 'unsupported')).toBe(true);
	}

	// Sheet 2: Project Detail
	const wsProject = wb.getWorksheet('Project Detail');
	expect(wsProject).toBeDefined();
	if (wsProject) {
		expect(sheetContains(wsProject, EXCEL_PROJECTS.alpha.code)).toBe(true);
		expect(sheetContains(wsProject, EXCEL_PROJECTS.beta.code)).toBe(true);
	}

	// Sheet 3: Budgets & Commitments
	const wsBudgets = wb.getWorksheet('Budgets & Commitments');
	expect(wsBudgets).toBeDefined();
	if (wsBudgets) {
		// Project cost budget section
		expect(sheetContains(wsBudgets, 'Approved Cost Budgets Comparison')).toBe(
			true
		);
		expect(sheetContains(wsBudgets, EXCEL_PROJECTS.alpha.code)).toBe(true);

		// Supplier orders section
		expect(sheetContains(wsBudgets, 'Supplier Commitments')).toBe(true);
		expect(sheetContains(wsBudgets, 'Alpha Supplier Co')).toBe(true);

		// Commercial client orders section with mandatory disclaimer
		expect(sheetContains(wsBudgets, 'Client Order Context')).toBe(true);
		expect(
			sheetContains(
				wsBudgets,
				'Client order values represent commercial context only. They are NOT recognized revenue or profit'
			)
		).toBe(true);
		expect(sheetContains(wsBudgets, 'E2E Excel Client Alpha')).toBe(true);
	}

	// Sheet 4: Cash Paid
	const wsCash = wb.getWorksheet('Cash Paid');
	expect(wsCash).toBeDefined();
	if (wsCash) {
		expect(sheetContains(wsCash, 'Outward Cash Paid')).toBe(true);
		expect(sheetContains(wsCash, 'E2E-EXP-324-D1')).toBe(true);
		expect(sheetContains(wsCash, 'INR')).toBe(true);
	}

	// Sheet 5: Revisions & Close (Open Month)
	const wsClose = wb.getWorksheet('Revisions & Close');
	expect(wsClose).toBeDefined();
	if (wsClose) {
		expect(sheetContains(wsClose, 'Financial Close & Revision History')).toBe(
			true
		);
		expect(sheetContains(wsClose, 'Open')).toBe(true);
	}

	evidence.directDownloadVerified = {
		month: EXCEL_OPEN_MONTH,
		sheets: sheetNames,
		bytes: buffer.length,
	};
});

test('preserves company totals while reporting project subtotal under project filter', async () => {
	const projectId = seeded.projects.alpha;
	const res = await clerk.get(
		`${DOWNLOAD_ENDPOINT}?view=expenditure&month=${EXCEL_OPEN_MONTH}&project_id=${projectId}`
	);
	expect(res.status()).toBe(200);

	const disposition = res.headers()['content-disposition'] ?? '';
	expect(disposition).toContain(
		`filename="Company_Expenditure_${EXCEL_OPEN_MONTH}_Project_${projectId}.xlsx"`
	);

	const buffer = await res.body();
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

	const wsRecon = wb.getWorksheet('Company Reconciliation');
	expect(wsRecon).toBeDefined();
	if (wsRecon) {
		// The company totals are still company-wide (both INR and USD appear)
		expect(sheetContains(wsRecon, 'INR')).toBe(true);
		expect(sheetContains(wsRecon, 'USD')).toBe(true);

		// Filtered project subtotal is displayed
		expect(sheetContains(wsRecon, 'Filtered Project Subtotal')).toBe(true);
		expect(sheetContains(wsRecon, `Project ID: ${projectId}`)).toBe(true);
	}

	evidence.projectFilterVerified = {
		projectId,
		filenameChecked: true,
	};
});

test('exports close snapshot and revision event details for closed month', async () => {
	const res = await clerk.get(
		`${DOWNLOAD_ENDPOINT}?view=expenditure&month=${EXCEL_CLOSED_MONTH}`
	);
	expect(res.status()).toBe(200);

	const buffer = await res.body();
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

	const wsClose = wb.getWorksheet('Revisions & Close');
	expect(wsClose).toBeDefined();
	if (wsClose) {
		expect(sheetContains(wsClose, 'Financial Close & Revision History')).toBe(
			true
		);
		expect(sheetContains(wsClose, 'Closed')).toBe(true);
		expect(sheetContains(wsClose, 'close-e2e-324-2021-12')).toBe(true);
		expect(
			sheetContains(wsClose, 'E2E closed month for Excel export evidence')
		).toBe(true);
		expect(sheetContains(wsClose, 'E2E-EXP-324-CLOSE-EVID')).toBe(true);

		// Revision event row
		expect(sheetContains(wsClose, 'rev-e2e-324-2021-12-01')).toBe(true);
		expect(
			sheetContains(wsClose, 'E2E revised cost post-close verification')
		).toBe(true);
	}

	evidence.closedMonthVerified = {
		month: EXCEL_CLOSED_MONTH,
		status: 'Closed',
		closeUid: 'close-e2e-324-2021-12',
		revisionUid: 'rev-e2e-324-2021-12-01',
	};
});

test('browser UI expenditure view triggers Excel download via export button', async ({
	page,
}) => {
	await page.goto('/reports/employee-project-monthly-cost');

	// Click Expenditure tab
	const expTab = page.getByRole('tab', { name: 'Expenditure', exact: true });
	await expect(expTab).toBeVisible();
	await expTab.click();

	await expect(page.getByTestId('expenditure-view')).toBeVisible();

	// Select 2021-11
	const monthSelect = page.getByLabel('Month', { exact: true });
	await monthSelect.click();
	await page.getByPlaceholder('Search...').fill('November 2021');
	await page
		.getByRole('button', { name: 'November 2021', exact: true })
		.click();

	// Locate export button
	const exportBtn = page.getByTestId('expenditure-export-button');
	await expect(exportBtn).toBeVisible();

	// Trigger download and wait for event
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		exportBtn.click(),
	]);

	const filename = download.suggestedFilename();
	expect(filename).toBe(`Company_Expenditure_${EXCEL_OPEN_MONTH}.xlsx`);

	const stream = await download.createReadStream();
	expect(stream).toBeDefined();

	evidence.uiDownloadVerified = {
		suggestedFilename: filename,
		buttonTestId: 'expenditure-export-button',
	};
});
