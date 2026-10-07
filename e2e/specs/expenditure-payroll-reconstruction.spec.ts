import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import { exec, rows } from '../lib/db';
import { E2E_ENV } from '../lib/env';
import { parseJsonColumn } from '../lib/json-column';
import { ADMIN_USER } from '../lib/fixtures';
import {
	RECONSTRUCTION_ADMIN_IP,
	RECONSTRUCTION_EXPECTED,
	RECONSTRUCTION_MONTH,
	RECONSTRUCTION_MONTH_DAY,
	RECONSTRUCTION_PENDING_MONTH,
	RECONSTRUCTION_PENDING_MONTH_DAY,
	RECONSTRUCTION_PROJECTS,
	RECONSTRUCTION_READER_IP,
	cleanupExpenditureReconstructionFixtures,
	loginReconstructionExpense,
	loginReconstructionFinance,
	loginReconstructionReader,
	seedExpenditureReconstructionFixtures,
	type SeededReconstruction,
} from '../lib/expenditure-reconstruction-fixtures';

/**
 * Ticket #308 — reviewed historical allocation reconstruction, end to end.
 *
 * The fixture file states every amount as a literal derived from the payroll
 * rules and the recorded slips; this spec asserts those literals against the
 * real app (authenticated requests, the actual report controls, the browser)
 * and independently against MySQL. No expectation is computed by the module
 * under test, and no route, page, component, or source text is mocked.
 *
 * Flow: legacy finalized slips with no allocations → missing-timesheet freeze
 * → browser propose/approve through the report controls → persisted evidence
 * and reader gate → partial hours with a separate reviewer → rejection with
 * re-propose and refused reruns → concurrent propose/approve → stale version
 * and freeze-the-reviewed figures → pending month never repriced by the
 * profile → unauthorized identities and invalid requests → reruns and
 * stability → no Payroll Slip / payment status / run state change (the month
 * still reopens).
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	extraHTTPHeaders: { 'x-vercel-forwarded-for': RECONSTRUCTION_ADMIN_IP },
});
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const MONTH = RECONSTRUCTION_MONTH;
const MONTH_DAY = RECONSTRUCTION_MONTH_DAY;
const PENDING_MONTH = RECONSTRUCTION_PENDING_MONTH;
const MONTH_LABEL = 'January 2018';

interface PayrollTotals {
	currency: string;
	recorded_total: number;
	estimated_total: number;
	allocated_total: number;
	unallocated_total: number;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	recorded_count: number;
	known_zero_count: number;
	estimated_count: number;
	missing_slip_count: number;
	missing_pricing_count: number;
	allocation_missing_count: number;
}

interface PayrollShare {
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	client_name: string | null;
	hours: number;
	amount: number;
	rounding_adjustment: number;
	basis: string;
}

interface ReconstructionRow {
	proposal_uid: string;
	financial_version: number;
	status: string;
	recorded_employer_cost: number;
	currency: string;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	evidence: Record<string, unknown>;
	missing_evidence: Array<{ code: string; detail: string }>;
	proposed_by: number | null;
	proposed_by_name: string | null;
	proposed_at: string | null;
	reviewed_by: number | null;
	reviewed_by_name: string | null;
	reviewed_at: string | null;
	review_reason: string | null;
	evidence_reference: string | null;
	shares: PayrollShare[];
}

interface ReconstructionAllocationRef {
	allocation_id: number;
	allocation_uid: string;
	version: number;
	kind: string;
	frozen_at: string;
}

interface ReconstructionCommandData extends ReconstructionRow {
	allocation: ReconstructionAllocationRef | null;
}

interface PayrollEmployee {
	employee_id: number;
	employee_code: string;
	employee_name: string;
	pay_stream: string;
	status: string;
	recorded_amount: number | null;
	estimated_amount: number | null;
	logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	no_logged_hours: boolean;
	missing_slip: boolean;
	missing_pricing: boolean;
	allocation_missing: boolean;
	source: {
		payroll_slip_id: number | null;
		allocation_id: number | null;
		allocation_version: number | null;
		allocation_kind: string | null;
		month: string;
	};
	shares: PayrollShare[];
	reconstruction: ReconstructionRow | null;
}

interface PayrollDrilldown {
	month: string;
	month_label: string;
	currency: string;
	totals: PayrollTotals;
	employees: PayrollEmployee[];
	coverage: Array<{
		code: string;
		label: string;
		detail: string;
		severity: string;
	}>;
}

interface ReconciliationData {
	month: string;
	month_label: string;
	company: {
		currency: string | null;
		incurred_cost: number | null;
		currency_totals: Array<{
			currency: string;
			incurred_project_cost: number;
			company_overhead: number;
			unallocated_cost: number;
			incurred_cost: number;
		}>;
	};
	projects: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		currency: string;
		incurred_cost: number;
		employee_cost: number;
		estimated_employee_cost: number;
		logged_hours: number;
	}>;
	payroll: PayrollTotals;
	coverage: Array<{
		code: string;
		label: string;
		detail: string;
		severity: string;
	}>;
}

let seeded: SeededReconstruction;
let adminUserId = 0;
let financeUserId = 0;
let slipsSnapshot = '';
let runsSnapshot = '';
const evidence: Record<string, unknown> = { ok: true, month: MONTH };
const EXPECTED = RECONSTRUCTION_EXPECTED;

const outcome = trackArtifactOutcome();

function publish(): void {
	evidence.ok = outcome.ok;
	writeArtifact('expenditure-payroll-reconstruction', {
		...evidence,
		fixtureScope: {
			projects: Object.values(RECONSTRUCTION_PROJECTS).map((p) => p.code),
			employees: [
				'E2E-RECON-01',
				'E2E-RECON-02',
				'E2E-RECON-03',
				'E2E-RECON-04',
				'E2E-RECON-05',
				'E2E-RECON-06',
				'E2E-RECON-07',
			],
			months: [MONTH, PENDING_MONTH],
			ips: [RECONSTRUCTION_ADMIN_IP, RECONSTRUCTION_READER_IP],
		},
	});
}

async function reconciliation(
	request: APIRequestContext,
	month: string
): Promise<ReconciliationData> {
	const response = await request.get(
		`/api/reports/employee-project-monthly-cost?view=expenditure&month=${month}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as ReconciliationData;
}

async function payrollDrilldown(
	request: APIRequestContext,
	month: string,
	employeeId?: number
): Promise<PayrollDrilldown> {
	const params = new URLSearchParams({ month });
	if (employeeId !== undefined) params.set('employee_id', String(employeeId));
	const response = await request.get(
		`/api/reports/employee-project-monthly-cost/payroll?${params.toString()}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as PayrollDrilldown;
}

function coverageCodes(payload: {
	coverage: Array<{ code: string }>;
}): string[] {
	return payload.coverage.map((entry) => entry.code);
}

function employeeOf(data: PayrollDrilldown, code: string): PayrollEmployee {
	const found = data.employees.find((row) => row.employee_code === code);
	expect(found, `employee ${code} in drilldown`).toBeTruthy();
	return found!;
}

function shareOf(
	shares: readonly PayrollShare[],
	projectCode: string | null
): PayrollShare {
	const found = shares.find((share) =>
		projectCode === null
			? share.project_id === null
			: share.project_code === projectCode
	);
	expect(found, `share ${projectCode ?? 'no project'}`).toBeTruthy();
	return found!;
}

/** The Payroll Slip id of one fixture employee in one fixture month. */
async function slipIdOf(code: string, monthDay: string): Promise<number> {
	const found = await rows<{ id: number }>(
		`SELECT s.id FROM payroll_slips s
       JOIN employees e ON e.id = s.employee_id
      WHERE e.employee_id = ? AND s.month = ?`,
		[code, monthDay]
	);
	expect(found.length, `slip for ${code}`).toBe(1);
	return Number(found[0].id);
}

async function propose(
	request: APIRequestContext,
	slipId: number,
	month = MONTH,
	expectedStatus = 201
): Promise<ReconstructionCommandData> {
	const response = await request.post(
		'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
		{ data: { month, payroll_slip_id: slipId } }
	);
	expect(response.status(), await response.text()).toBe(expectedStatus);
	const body = await response.json();
	if (expectedStatus < 300) {
		expect(body.success, JSON.stringify(body)).toBe(true);
	}
	return body.data as ReconstructionCommandData;
}

async function review(
	request: APIRequestContext,
	proposalUid: string,
	command: 'approve' | 'reject',
	expectedVersion: number,
	reason?: string,
	expectedStatus = 200
): Promise<ReconstructionCommandData> {
	const response = await request.post(
		`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${proposalUid}`,
		{
			data: {
				command,
				expected_version: expectedVersion,
				reason: reason ?? undefined,
			},
		}
	);
	expect(response.status(), await response.text()).toBe(expectedStatus);
	const body = await response.json();
	if (expectedStatus < 300) {
		expect(body.success, JSON.stringify(body)).toBe(true);
	}
	return body.data as ReconstructionCommandData;
}

async function count(
	sql: string,
	params: unknown[] = [MONTH_DAY]
): Promise<number> {
	const [row] = await rows<{ n: number }>(sql, params);
	return Number(row.n);
}

const FIXTURE_ALLOCATIONS = `SELECT COUNT(*) AS n FROM payroll_employee_allocations a
  JOIN employees e ON e.id = a.employee_id
 WHERE a.month = ? AND e.employee_id LIKE 'E2E-RECON-%'`;
const FIXTURE_PROPOSALS = `SELECT COUNT(*) AS n FROM payroll_allocation_reconstruction_proposals p
  JOIN employees e ON e.id = p.employee_id
 WHERE p.month = ? AND e.employee_id LIKE 'E2E-RECON-%'`;

async function fixtureSlipsSnapshot(): Promise<string> {
	const snapshot = await rows(
		`SELECT s.* FROM payroll_slips s
       JOIN employees e ON e.id = s.employee_id
      WHERE s.month IN (?, ?) AND e.employee_id LIKE 'E2E-RECON-%'
      ORDER BY s.id`,
		[MONTH_DAY, RECONSTRUCTION_PENDING_MONTH_DAY]
	);
	return JSON.stringify(snapshot);
}

async function fixtureRunsSnapshot(): Promise<string> {
	const snapshot = await rows(
		`SELECT * FROM payroll_runs WHERE year = 2018 AND month IN (1, 2) ORDER BY id`
	);
	return JSON.stringify(snapshot);
}

/** Pick a month in the real report controls. */
async function selectMonth(page: Page, label: string) {
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill(label);
	await page.getByRole('button', { name: label, exact: true }).click();
}

test.beforeAll(async () => {
	seeded = await seedExpenditureReconstructionFixtures();
	slipsSnapshot = await fixtureSlipsSnapshot();
	runsSnapshot = await fixtureRunsSnapshot();
	const admin = await rows<{ id: number }>(
		`SELECT id FROM users WHERE username = ?`,
		[ADMIN_USER.username]
	);
	adminUserId = Number(admin[0]?.id ?? 0);
	if (adminUserId <= 0) {
		throw new Error(
			`[e2e] fixture admin user ${ADMIN_USER.username} not found`
		);
	}
	evidence.seeded = {
		projectIds: seeded.projectIds,
		employeeIds: seeded.employeeIds,
		adminUserId,
	};
});

test.afterAll(async () => {
	publish();
	await cleanupExpenditureReconstructionFixtures();
});

test('states every legacy finalized slip as unresolved before any reconstruction', async ({
	request,
}) => {
	const data = await reconciliation(request, MONTH);
	expect(data.payroll.recorded_total).toBe(0);
	expect(data.payroll.allocation_missing_count).toBe(6);
	expect(data.company.incurred_cost).toBeNull();
	const codes = coverageCodes(data);
	expect(codes).toContain('payroll_allocation_missing');
	expect(codes).not.toContain('payroll_reconstructed');
	expect(codes).not.toContain('payroll_reconstruction_pending');

	// The fixture slips predate saved allocations and stored hours bases.
	const storedBasis = await rows(
		`SELECT s.* FROM payroll_slips s
       JOIN employees e ON e.id = s.employee_id
      WHERE e.employee_id = 'E2E-RECON-01' AND s.month = ?
        AND s.ctc_used IS NULL AND s.basis_hours IS NULL
        AND s.hourly_rate IS NULL AND s.logged_hours IS NULL`,
		[MONTH_DAY]
	);
	expect(storedBasis.length).toBe(1);

	const split = employeeOf(
		await payrollDrilldown(request, MONTH, seeded.employeeIds.splitMonthly),
		'E2E-RECON-01'
	);
	expect(split.allocation_missing).toBe(true);
	expect(split.recorded_amount).toBeNull();
	expect(split.reconstruction).toBeNull();
	expect(split.status).toBe('estimated');

	evidence.beforeReconstruction = {
		recordedTotal: data.payroll.recorded_total,
		allocationMissing: data.payroll.allocation_missing_count,
		coverage: codes,
	};
});

test('missing timesheets freeze as fully unallocated with recorded limitations', async ({
	request,
}) => {
	const slipId = await slipIdOf('E2E-RECON-02', MONTH_DAY);
	const result = await propose(request, slipId);
	expect(result.status).toBe('pending');
	expect(result.financial_version).toBe(1);
	expect(result.allocation).toBeNull();
	expect(result.recorded_employer_cost).toBe(
		EXPECTED.month.employees.missingTimesheets.slipEmployerCost
	);
	expect(result.missing_evidence.map((entry) => entry.code)).toEqual([
		'timesheet_missing',
	]);
	expect(result.shares).toHaveLength(1);
	expect(result.shares[0].basis).toBe('no_logged_hours');
	expect(result.shares[0].amount).toBe(7500);
	expect(result.proposed_by).toBe(adminUserId);
	expect(result.proposed_at).toBeTruthy();

	// Pending is visible, but nothing is recorded cost yet.
	const beforeApprove = await payrollDrilldown(
		request,
		MONTH,
		seeded.employeeIds.missingTimesheets
	);
	const pendingRow = employeeOf(beforeApprove, 'E2E-RECON-02');
	expect(pendingRow.recorded_amount).toBeNull();
	expect(pendingRow.allocation_missing).toBe(true);
	expect(pendingRow.reconstruction?.status).toBe('pending');
	const pendingMonth = await reconciliation(request, MONTH);
	expect(pendingMonth.payroll.recorded_total).toBe(0);
	expect(coverageCodes(pendingMonth)).toContain(
		'payroll_reconstruction_pending'
	);
	expect(coverageCodes(pendingMonth)).not.toContain('payroll_reconstructed');

	const approved = await review(request, result.proposal_uid, 'approve', 1);
	expect(approved.status).toBe('approved');
	expect(approved.allocation?.kind).toBe('reconstruction');
	expect(approved.allocation?.version).toBe(1);

	const row = employeeOf(
		await payrollDrilldown(
			request,
			MONTH,
			seeded.employeeIds.missingTimesheets
		),
		'E2E-RECON-02'
	);
	expect(row.status).toBe('recorded');
	expect(row.recorded_amount).toBe(7500);
	expect(row.no_logged_hours).toBe(true);
	expect(row.source.allocation_kind).toBe('reconstruction');
	expect(row.reconstruction?.status).toBe('approved');
	expect(row.shares).toHaveLength(1);
	expect(row.shares[0].basis).toBe('no_logged_hours');
	expect(row.shares[0].amount).toBe(7500);

	// Independent database evidence: allocation, share, and the review event.
	const allocation = await rows<{
		id: number;
		kind: string;
		version: number;
		recorded_employer_cost: string;
		frozen_by: number | null;
	}>(
		`SELECT a.id, a.kind, a.version, a.recorded_employer_cost, a.frozen_by
       FROM payroll_employee_allocations a
      WHERE a.payroll_slip_id = ? AND a.version = 1`,
		[slipId]
	);
	expect(allocation).toHaveLength(1);
	expect(allocation[0].kind).toBe('reconstruction');
	expect(Number(allocation[0].recorded_employer_cost)).toBe(7500);
	expect(Number(allocation[0].frozen_by)).toBe(adminUserId);
	const event = await rows<{
		command: string;
		evidence_reference: string;
		snapshot: string;
	}>(
		`SELECT command, evidence_reference, snapshot
       FROM payroll_allocation_events
      WHERE allocation_uid = ? AND version = 1`,
		[`payroll-alloc-${slipId}-v1`]
	);
	expect(event).toHaveLength(1);
	expect(event[0].command).toBe('reconstructed');
	expect(event[0].evidence_reference).toBe(result.proposal_uid);
	const snapshot = parseJsonColumn(event[0].snapshot) as {
		reconstruction: {
			proposal_uid: string;
			financial_version: number;
			missing_evidence: Array<{ code: string }>;
		};
	};
	expect(snapshot.reconstruction.proposal_uid).toBe(result.proposal_uid);
	expect(snapshot.reconstruction.financial_version).toBe(1);
	expect(
		snapshot.reconstruction.missing_evidence.map((entry) => entry.code)
	).toEqual(['timesheet_missing']);

	evidence.missingTimesheets = {
		proposalUid: result.proposal_uid,
		share: row.shares[0],
		limitations: result.missing_evidence,
	};

	// A repeated review of the same proposal is refused and duplicates nothing.
	const repeated = await request.post(
		`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${result.proposal_uid}`,
		{ data: { command: 'approve', expected_version: 1 } }
	);
	expect(repeated.status()).toBe(409);
	const repeatedBody = await repeated.json();
	expect(repeatedBody.code).toBe('already_reviewed');
	expect(await count(FIXTURE_ALLOCATIONS)).toBe(1);
});

test('the browser reader sees the report and pending state but no reconstruction controls', async ({
	page,
	browser,
	playwright,
}) => {
	const session = await loginReconstructionReader(playwright, E2E_ENV.baseURL);
	const context = await browser.newContext({
		baseURL: E2E_ENV.baseURL,
		storageState: session.storageState,
		extraHTTPHeaders: { 'x-vercel-forwarded-for': RECONSTRUCTION_READER_IP },
	});
	try {
		const readerPage = await context.newPage();
		await readerPage.goto('/reports/employee-project-monthly-cost');
		await readerPage
			.getByRole('tab', { name: 'Expenditure', exact: true })
			.click();
		await expect(readerPage.getByTestId('expenditure-view')).toBeVisible();
		await selectMonth(readerPage, MONTH_LABEL);
		await expect(readerPage.getByTestId('payroll-summary')).toBeVisible();
		// The reader holds the financial read gate, so the report itself is
		// readable — including the frozen reconstructed row.
		await expect(
			readerPage.getByTestId('payroll-employee-row').filter({
				hasText: 'E2E-RECON-02',
			})
		).toBeVisible();
		// ... but every command control is absent: the conjunction of the read
		// gate and the operation privilege fails.
		await expect(
			readerPage.getByTestId('payroll-reconstruction-propose')
		).toHaveCount(0);
		await expect(
			readerPage.getByTestId('payroll-reconstruction-approve')
		).toHaveCount(0);
		await expect(
			readerPage.getByTestId('payroll-reconstruction-reject')
		).toHaveCount(0);

		// The same month in the admin session does render the propose control on
		// an unresolved row, so the absence above is authorization, not layout.
		await page.goto('/reports/employee-project-monthly-cost');
		await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
		await selectMonth(page, MONTH_LABEL);
		const candidate = page
			.getByTestId('payroll-employee-row')
			.filter({ hasText: 'E2E-RECON-04' });
		await expect(
			candidate.getByTestId('payroll-reconstruction-propose')
		).toBeVisible();

		evidence.readerControls = {
			readerProposeButtons: 0,
			adminProposeVisible: true,
		};
	} finally {
		await session.request.dispose();
		await context.close();
	}
});

test('the browser proposes and approves a reconstruction through the real report controls', async ({
	page,
}) => {
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await expect(page.getByTestId('expenditure-view')).toBeVisible();
	await selectMonth(page, MONTH_LABEL);

	const row = page
		.getByTestId('payroll-employee-row')
		.filter({ hasText: 'E2E-RECON-01' });
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute('data-status', 'estimated');
	await expect(row).toHaveAttribute('data-recorded', '');
	await row.getByTestId('payroll-reconstruction-propose').click();

	// The pending proposal is stated as proposed, not as recorded cost.
	const pending = row.getByTestId('payroll-reconstruction-pending');
	await expect(pending).toBeVisible();
	await expect(pending).toHaveAttribute('data-financial-version', '1');
	await expect(row).toHaveAttribute('data-recorded', '');

	await row.getByTestId('payroll-reconstruction-approve').click();
	await expect(row).toHaveAttribute('data-recorded', '26000');
	const badge = row.getByTestId('payroll-reconstruction-badge');
	await expect(badge).toBeVisible();
	await expect(badge).toHaveAttribute('data-status', 'approved');

	// The expanded detail carries the reconstruction evidence distinctly.
	await row.getByTestId('payroll-employee-expand').click();
	const panel = row.getByTestId('payroll-reconstruction-evidence');
	await expect(panel).toBeVisible();
	await expect(panel).toHaveAttribute('data-financial-version', '1');
	await expect(panel).toHaveAttribute('data-status', 'approved');
	await expect(panel).toHaveAttribute('data-missing-evidence', '');
	await expect(panel).not.toHaveAttribute('data-reconstructed-at', '');
	await expect(panel).not.toHaveAttribute('data-reviewed-by', '');
	const p1 = row
		.getByTestId('payroll-share-row')
		.filter({ hasText: RECONSTRUCTION_PROJECTS.p1.code });
	await expect(p1).toHaveAttribute(
		'data-amount',
		String(EXPECTED.month.employees.splitMonthly.shares.p1)
	);
	const noProject = row
		.getByTestId('payroll-share-row')
		.filter({ hasText: 'No project' });
	await expect(noProject).toHaveAttribute(
		'data-amount',
		String(EXPECTED.month.employees.splitMonthly.shares.noProject)
	);
	await expect(noProject).toHaveAttribute('data-adjustment', '0.01');
	await expect(noProject).toHaveAttribute('data-hours', '40');

	evidence.browserFlow = {
		employee: 'E2E-RECON-01',
		recorded: EXPECTED.month.employees.splitMonthly.slipEmployerCost,
		p1: EXPECTED.month.employees.splitMonthly.shares.p1,
		noProject: EXPECTED.month.employees.splitMonthly.shares.noProject,
	};
});

test('the approved reconstruction persists as immutable evidence and reads distinctly', async ({
	request,
}) => {
	const slipId = await slipIdOf('E2E-RECON-01', MONTH_DAY);
	const allocation = await rows<{
		id: number;
		allocation_uid: string;
		kind: string;
		version: number;
		recorded_employer_cost: string;
		total_logged_hours: string;
		project_hours: string;
		no_project_hours: string;
		rounding_adjustment: string;
		currency: string;
	}>(
		`SELECT id, allocation_uid, kind, version, recorded_employer_cost,
            total_logged_hours, project_hours, no_project_hours,
            rounding_adjustment, currency
       FROM payroll_employee_allocations WHERE payroll_slip_id = ?`,
		[slipId]
	);
	expect(allocation).toHaveLength(1);
	expect(allocation[0].kind).toBe('reconstruction');
	expect(allocation[0].version).toBe(1);
	expect(allocation[0].allocation_uid).toBe(`payroll-alloc-${slipId}-v1`);
	expect(Number(allocation[0].recorded_employer_cost)).toBe(26000);
	expect(Number(allocation[0].total_logged_hours)).toBe(192);
	expect(Number(allocation[0].project_hours)).toBe(152);
	expect(Number(allocation[0].no_project_hours)).toBe(40);
	expect(Number(allocation[0].rounding_adjustment)).toBe(0.01);
	expect(allocation[0].currency).toBe('INR');

	const shares = await rows<{
		project_code: string | null;
		amount: string;
		hours: string;
		rounding_adjustment: string;
		basis: string;
	}>(
		`SELECT project_code, amount, hours, rounding_adjustment, basis
       FROM payroll_employee_allocation_shares
      WHERE allocation_id = ?
      ORDER BY id`,
		[allocation[0].id]
	);
	expect(shares).toHaveLength(3);
	expect(shares.map((share) => Number(share.amount))).toEqual([
		EXPECTED.month.employees.splitMonthly.shares.p1,
		EXPECTED.month.employees.splitMonthly.shares.p2,
		EXPECTED.month.employees.splitMonthly.shares.noProject,
	]);
	expect(Number(shares[2].rounding_adjustment)).toBe(0.01);

	// The proposal itself records the review decision and links the freeze.
	const proposal = await rows<{
		status: string;
		reviewed_by: number | null;
		reviewed_at: string | null;
		frozen_allocation_id: number | null;
		evidence: string;
		missing_evidence: string;
	}>(
		`SELECT status, reviewed_by, reviewed_at, frozen_allocation_id, evidence, missing_evidence
       FROM payroll_allocation_reconstruction_proposals
      WHERE payroll_slip_id = ?`,
		[slipId]
	);
	expect(proposal).toHaveLength(1);
	expect(proposal[0].status).toBe('approved');
	expect(Number(proposal[0].reviewed_by)).toBe(adminUserId);
	expect(proposal[0].reviewed_at).toBeTruthy();
	expect(Number(proposal[0].frozen_allocation_id)).toBe(allocation[0].id);
	const proposalEvidence = parseJsonColumn(proposal[0].evidence) as {
		source_table: string;
		source_field: string;
		recorded_employer_cost: number;
		pay_stream_source: string;
	};
	expect(proposalEvidence.source_table).toBe('user_activity_assignments');
	expect(proposalEvidence.source_field).toBe('daily_entries');
	expect(proposalEvidence.recorded_employer_cost).toBe(26000);
	expect(proposalEvidence.pay_stream_source).toBe(
		'salary_profile_observed_at_proposal'
	);
	expect(parseJsonColumn(proposal[0].missing_evidence)).toEqual([]);

	const row = employeeOf(
		await payrollDrilldown(request, MONTH, seeded.employeeIds.splitMonthly),
		'E2E-RECON-01'
	);
	expect(row.status).toBe('recorded');
	expect(row.recorded_amount).toBe(26000);
	expect(row.pay_stream).toBe('payroll');
	expect(row.logged_hours).toBe(192);
	expect(row.project_hours).toBe(152);
	expect(row.no_project_hours).toBe(40);
	expect(row.source.allocation_kind).toBe('reconstruction');
	expect(row.source.allocation_version).toBe(1);
	expect(row.reconstruction?.status).toBe('approved');
	expect(row.reconstruction?.proposed_by).toBe(adminUserId);
	expect(row.reconstruction?.recorded_employer_cost).toBe(26000);
	expect(row.shares.map((share) => share.amount)).toEqual([
		10833.33, 9750, 5416.67,
	]);
	expect(shareOf(row.shares, null).hours).toBe(40);

	// The month now states the recorded side of the two approved slips.
	const data = await reconciliation(request, MONTH);
	expect(data.payroll.recorded_total).toBe(33500);
	expect(data.payroll.recorded_count).toBe(2);
	expect(coverageCodes(data)).toContain('payroll_reconstructed');
	expect(coverageCodes(data)).not.toContain('payroll_reconstruction_pending');
	const p1 = data.projects.find(
		(row) => row.project_code === RECONSTRUCTION_PROJECTS.p1.code
	)!;
	expect(p1.employee_cost).toBe(10833.33);
	const p2 = data.projects.find(
		(row) => row.project_code === RECONSTRUCTION_PROJECTS.p2.code
	)!;
	expect(p2.employee_cost).toBe(9750);

	evidence.persisted = {
		allocationUid: allocation[0].allocation_uid,
		shares: shares.map((share) => Number(share.amount)),
		recordedTotal: data.payroll.recorded_total,
	};
});

test('partial hours keep their unallocated share and a separate reviewer records the decision', async ({
	request,
	playwright,
}) => {
	const slipId = await slipIdOf('E2E-RECON-03', MONTH_DAY);
	const proposed = await propose(request, slipId);
	expect(proposed.missing_evidence.map((entry) => entry.code)).toEqual([
		'hours_without_project',
	]);
	expect(proposed.shares.map((share) => share.amount)).toEqual([8100, 900]);
	expect(shareOf(proposed.shares, null).hours).toBe(10);

	const finance = await loginReconstructionFinance(playwright, E2E_ENV.baseURL);
	try {
		financeUserId = finance.userId;
		// The reviewer holds the full read gate: the same report reads back.
		const readable = await finance.request.get(
			`/api/reports/employee-project-monthly-cost/payroll?month=${MONTH}&employee_id=${seeded.employeeIds.partialHours}`
		);
		expect(readable.status(), await readable.text()).toBe(200);

		const approved = await review(
			finance.request,
			proposed.proposal_uid,
			'approve',
			1,
			'Reviewed against the recorded hours'
		);
		expect(approved.status).toBe('approved');
		expect(approved.reviewed_by).toBe(finance.userId);
		expect(approved.proposed_by).toBe(adminUserId);

		const stored = await rows<{
			proposed_by: number | null;
			reviewed_by: number | null;
			pay_stream: string;
		}>(
			`SELECT proposed_by, reviewed_by, pay_stream
         FROM payroll_allocation_reconstruction_proposals
        WHERE proposal_uid = ?`,
			[proposed.proposal_uid]
		);
		expect(Number(stored[0].proposed_by)).toBe(adminUserId);
		expect(Number(stored[0].reviewed_by)).toBe(finance.userId);
		// The pay stream is proposal-time metadata from the canonical profile.
		expect(stored[0].pay_stream).toBe('contract');
	} finally {
		await finance.request.dispose();
	}

	const row = employeeOf(
		await payrollDrilldown(request, MONTH, seeded.employeeIds.partialHours),
		'E2E-RECON-03'
	);
	expect(row.status).toBe('recorded');
	expect(row.recorded_amount).toBe(9000);
	expect(row.pay_stream).toBe('contract');
	expect(shareOf(row.shares, RECONSTRUCTION_PROJECTS.p1.code).amount).toBe(
		8100
	);
	expect(shareOf(row.shares, null).amount).toBe(900);
	expect(row.reconstruction?.reviewed_by).toBe(financeUserId);
	expect(
		row.reconstruction?.missing_evidence.map((entry) => entry.code)
	).toEqual(['hours_without_project']);

	evidence.partialHours = {
		proposedBy: adminUserId,
		reviewedBy: financeUserId,
		shares: row.shares.map((share) => share.amount),
		limitations: row.reconstruction?.missing_evidence.map(
			(entry) => entry.code
		),
	};
});

test('a rejection leaves no allocation; re-proposing appends a version and reruns are refused', async ({
	request,
	playwright,
}) => {
	const slipId = await slipIdOf('E2E-RECON-04', MONTH_DAY);
	const first = await propose(request, slipId);
	expect(first.financial_version).toBe(1);

	const finance = await loginReconstructionFinance(playwright, E2E_ENV.baseURL);
	try {
		const rejected = await review(
			finance.request,
			first.proposal_uid,
			'reject',
			1,
			'Legacy hours evidence is incomplete for this slip'
		);
		expect(rejected.status).toBe('rejected');
		expect(rejected.review_reason).toBe(
			'Legacy hours evidence is incomplete for this slip'
		);
		expect(rejected.allocation).toBeNull();
	} finally {
		await finance.request.dispose();
	}

	// No allocation exists, and the report still states the gap and the
	// decided proposal — no silent replacement of anything.
	expect(
		await count(
			`SELECT COUNT(*) AS n FROM payroll_employee_allocations WHERE payroll_slip_id = ?`,
			[slipId]
		)
	).toBe(0);
	const rejectedRow = employeeOf(
		await payrollDrilldown(request, MONTH, seeded.employeeIds.rejected),
		'E2E-RECON-04'
	);
	expect(rejectedRow.allocation_missing).toBe(true);
	expect(rejectedRow.recorded_amount).toBeNull();
	expect(rejectedRow.reconstruction?.status).toBe('rejected');
	expect(rejectedRow.reconstruction?.review_reason).toBeTruthy();

	// Re-proposing is a new version; repeating it is refused.
	const second = await propose(request, slipId);
	expect(second.financial_version).toBe(2);
	expect(second.status).toBe('pending');
	const duplicate = await request.post(
		'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
		{ data: { month: MONTH, payroll_slip_id: slipId } }
	);
	expect(duplicate.status()).toBe(409);
	const duplicateBody = await duplicate.json();
	expect(duplicateBody.code).toBe('reconstruction_pending');
	expect(
		await count(
			`SELECT COUNT(*) AS n FROM payroll_allocation_reconstruction_proposals WHERE payroll_slip_id = ?`,
			[slipId]
		)
	).toBe(2);

	evidence.rejection = {
		firstUid: first.proposal_uid,
		rejectedReason: 'Legacy hours evidence is incomplete for this slip',
		secondVersion: second.financial_version,
		duplicateStatus: duplicate.status(),
	};
});

test('concurrent proposals and reviews create exactly one allocation', async ({
	request,
}) => {
	const slipId = await slipIdOf('E2E-RECON-05', MONTH_DAY);
	const [a, b] = await Promise.all([
		request.post(
			'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
			{ data: { month: MONTH, payroll_slip_id: slipId } }
		),
		request.post(
			'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
			{ data: { month: MONTH, payroll_slip_id: slipId } }
		),
	]);
	const proposeStatuses = [a.status(), b.status()].sort();
	expect(proposeStatuses).toEqual([201, 409]);
	expect(
		await count(
			`SELECT COUNT(*) AS n FROM payroll_allocation_reconstruction_proposals
          WHERE payroll_slip_id = ? AND status = 'pending'`,
			[slipId]
		)
	).toBe(1);

	const pending = await rows<{ proposal_uid: string }>(
		`SELECT proposal_uid FROM payroll_allocation_reconstruction_proposals
        WHERE payroll_slip_id = ? AND status = 'pending'`,
		[slipId]
	);
	const [first, second] = await Promise.all([
		request.post(
			`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${pending[0].proposal_uid}`,
			{ data: { command: 'approve', expected_version: 1 } }
		),
		request.post(
			`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${pending[0].proposal_uid}`,
			{ data: { command: 'approve', expected_version: 1 } }
		),
	]);
	const reviewStatuses = [first.status(), second.status()].sort();
	expect(reviewStatuses).toEqual([200, 409]);

	expect(
		await count(
			`SELECT COUNT(*) AS n FROM payroll_employee_allocations WHERE payroll_slip_id = ?`,
			[slipId]
		)
	).toBe(1);
	expect(
		await count(
			`SELECT COUNT(*) AS n FROM payroll_allocation_events WHERE allocation_uid = ?`,
			[`payroll-alloc-${slipId}-v1`]
		)
	).toBe(1);
	const row = employeeOf(
		await payrollDrilldown(request, MONTH, seeded.employeeIds.concurrent),
		'E2E-RECON-05'
	);
	expect(row.status).toBe('recorded');
	expect(row.recorded_amount).toBe(5000);
	expect(row.shares.map((share) => share.amount)).toEqual([5000]);

	evidence.concurrency = {
		propose: proposeStatuses,
		review: reviewStatuses,
		allocationShares: row.shares[0],
	};
});

test('a stale review is refused and approval freezes the reviewed figures, not later timesheet edits', async ({
	request,
}) => {
	const slipId = await slipIdOf('E2E-RECON-06', MONTH_DAY);
	const proposed = await propose(request, slipId);
	expect(proposed.shares.map((share) => share.amount)).toEqual([
		1000, 1000, 1000,
	]);
	expect(proposed.shares.map((share) => share.hours)).toEqual([30, 30, 30]);

	// Stale expected version: refused with no partial write.
	const stale = await request.post(
		`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${proposed.proposal_uid}`,
		{ data: { command: 'approve', expected_version: 2 } }
	);
	expect(stale.status()).toBe(409);
	const staleBody = await stale.json();
	expect(staleBody.code).toBe('version_conflict');
	expect(
		await count(
			`SELECT COUNT(*) AS n FROM payroll_employee_allocations WHERE payroll_slip_id = ?`,
			[slipId]
		)
	).toBe(0);
	const stillPending = await rows<{
		status: string;
		reviewed_at: string | null;
	}>(
		`SELECT status, reviewed_at FROM payroll_allocation_reconstruction_proposals WHERE proposal_uid = ?`,
		[proposed.proposal_uid]
	);
	expect(stillPending[0].status).toBe('pending');
	expect(stillPending[0].reviewed_at).toBeNull();

	// A later timesheet edit (the way the assignment screen writes it) must not
	// move the reviewed proposal: P1 30h → 3h, P2 30h → 57h.
	await exec(
		`UPDATE user_activity_assignments SET daily_entries = ? WHERE id = ?`,
		[
			JSON.stringify([{ date: `${MONTH}-02`, hours: 3 }]),
			'e2e-recon-assign-06-p1',
		]
	);
	await exec(
		`UPDATE user_activity_assignments SET daily_entries = ? WHERE id = ?`,
		[
			JSON.stringify([{ date: `${MONTH}-08`, hours: 57 }]),
			'e2e-recon-assign-06-p2',
		]
	);

	const approved = await review(request, proposed.proposal_uid, 'approve', 1);
	expect(approved.status).toBe('approved');
	expect(approved.shares.map((share) => share.amount)).toEqual([
		1000, 1000, 1000,
	]);
	expect(approved.shares.map((share) => share.hours)).toEqual([30, 30, 30]);

	// The frozen allocation equals the reviewed proposal, and the report keeps
	// showing those figures despite the edited timesheet.
	const frozenShares = await rows<{ amount: string; hours: string }>(
		`SELECT amount, hours FROM payroll_employee_allocation_shares
        WHERE allocation_id = (
          SELECT id FROM payroll_employee_allocations WHERE payroll_slip_id = ?
        ) ORDER BY id`,
		[slipId]
	);
	expect(frozenShares.map((share) => Number(share.amount))).toEqual([
		1000, 1000, 1000,
	]);
	expect(frozenShares.map((share) => Number(share.hours))).toEqual([
		30, 30, 30,
	]);

	const row = employeeOf(
		await payrollDrilldown(request, MONTH, seeded.employeeIds.staleFreeze),
		'E2E-RECON-06'
	);
	expect(row.recorded_amount).toBe(3000);
	expect(row.shares.map((share) => share.amount)).toEqual([1000, 1000, 1000]);
	expect(row.shares.map((share) => share.hours)).toEqual([30, 30, 30]);
	expect(row.logged_hours).toBe(90);

	evidence.staleFreeze = {
		staleStatus: stale.status(),
		frozenShares: frozenShares.map((share) => Number(share.amount)),
		frozenHours: frozenShares.map((share) => Number(share.hours)),
	};
});

test('a pending proposal in the next month stays distinct and never reprices from the profile', async ({
	request,
}) => {
	const slipId = await slipIdOf(
		'E2E-RECON-07',
		RECONSTRUCTION_PENDING_MONTH_DAY
	);
	const proposed = await propose(request, slipId, PENDING_MONTH);
	expect(proposed.shares.map((share) => share.amount)).toEqual([3000, 3000]);

	const row = employeeOf(
		await payrollDrilldown(
			request,
			PENDING_MONTH,
			seeded.employeeIds.pendingMonth
		),
		'E2E-RECON-07'
	);
	expect(row.reconstruction?.status).toBe('pending');
	expect(row.allocation_missing).toBe(true);
	expect(row.recorded_amount).toBeNull();
	// The profile estimate and the slip-cost proposal are different figures:
	// reconstruction never reads the current Salary Profile for pricing.
	expect(row.estimated_amount).not.toBeNull();
	expect(row.estimated_amount).not.toBe(3000);
	expect(row.estimated_amount).toBeGreaterThan(3000);

	const data = await reconciliation(request, PENDING_MONTH);
	expect(data.payroll.recorded_total).toBe(0);
	expect(data.payroll.allocation_missing_count).toBe(1);
	expect(data.company.incurred_cost).toBeNull();
	const codes = coverageCodes(data);
	expect(codes).toContain('payroll_reconstruction_pending');
	expect(codes).not.toContain('payroll_reconstructed');
	expect(
		await count(FIXTURE_ALLOCATIONS, [RECONSTRUCTION_PENDING_MONTH_DAY])
	).toBe(0);
	expect(
		await count(FIXTURE_PROPOSALS, [RECONSTRUCTION_PENDING_MONTH_DAY])
	).toBe(1);

	evidence.pendingMonth = {
		proposalUid: proposed.proposal_uid,
		proposedShares: proposed.shares.map((share) => share.amount),
		estimateShown: row.estimated_amount,
	};
});

test('refuses unauthorized identities and invalid requests without leaking values or writing rows', async ({
	request,
	playwright,
}) => {
	const allocationsBefore = await count(FIXTURE_ALLOCATIONS);
	const proposalsBefore = await count(FIXTURE_PROPOSALS);
	const pending = await rows<{ proposal_uid: string }>(
		`SELECT proposal_uid FROM payroll_allocation_reconstruction_proposals
        WHERE month = ? AND status = 'pending'`,
		[RECONSTRUCTION_PENDING_MONTH_DAY]
	);
	const pendingUid = pending[0].proposal_uid;
	const candidateSlip = await slipIdOf('E2E-RECON-04', MONTH_DAY);

	// The read-gate-only reader can read, but neither proposes nor reviews.
	const reader = await loginReconstructionReader(playwright, E2E_ENV.baseURL);
	try {
		const readable = await reader.request.get(
			`/api/reports/employee-project-monthly-cost/payroll?month=${MONTH}`
		);
		expect(readable.status(), await readable.text()).toBe(200);
		const proposeAttempt = await reader.request.post(
			'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
			{ data: { month: MONTH, payroll_slip_id: candidateSlip } }
		);
		expect(proposeAttempt.status()).toBe(403);
		const reviewAttempt = await reader.request.post(
			`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${pendingUid}`,
			{ data: { command: 'approve', expected_version: 1 } }
		);
		expect(reviewAttempt.status()).toBe(403);
		const bodies = (await proposeAttempt.text()) + (await reviewAttempt.text());
		for (const value of ['26000', '10833.33', '50500', 'E2E-RECON-01']) {
			expect(bodies).not.toContain(value);
		}
	} finally {
		await reader.request.dispose();
	}

	// An expense updater/approver without the payroll source read is refused on
	// both operations, with no leaked values and no writes.
	const expense = await loginReconstructionExpense(playwright, E2E_ENV.baseURL);
	try {
		const proposeAttempt = await expense.request.post(
			'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
			{ data: { month: MONTH, payroll_slip_id: candidateSlip } }
		);
		expect(proposeAttempt.status()).toBe(403);
		const reviewAttempt = await expense.request.post(
			`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${pendingUid}`,
			{ data: { command: 'approve', expected_version: 1 } }
		);
		expect(reviewAttempt.status()).toBe(403);
		const bodies = (await proposeAttempt.text()) + (await reviewAttempt.text());
		for (const value of ['26000', '10833.33', '50500', 'E2E-RECON-01']) {
			expect(bodies).not.toContain(value);
		}
	} finally {
		await expense.request.dispose();
	}

	expect(await count(FIXTURE_ALLOCATIONS)).toBe(allocationsBefore);
	expect(await count(FIXTURE_PROPOSALS)).toBe(proposalsBefore);

	// Invalid and unknown requests change nothing either.
	const missingMonth = await request.post(
		'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
		{ data: { payroll_slip_id: candidateSlip } }
	);
	expect(missingMonth.status()).toBe(400);
	const badMonth = await request.post(
		'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
		{ data: { month: '2018-13', payroll_slip_id: candidateSlip } }
	);
	expect(badMonth.status()).toBe(400);
	const badSlip = await request.post(
		'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
		{ data: { month: MONTH, payroll_slip_id: 'abc' } }
	);
	expect(badSlip.status()).toBe(400);
	const unknownSlip = await request.post(
		'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
		{ data: { month: MONTH, payroll_slip_id: 99999999 } }
	);
	expect(unknownSlip.status()).toBe(404);
	const mismatch = await request.post(
		'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
		{
			data: {
				month: MONTH,
				payroll_slip_id: await slipIdOf(
					'E2E-RECON-07',
					RECONSTRUCTION_PENDING_MONTH_DAY
				),
			},
		}
	);
	expect(mismatch.status()).toBe(409);
	expect((await mismatch.json()).code).toBe('month_mismatch');
	const unknownProposal = await request.post(
		'/api/reports/employee-project-monthly-cost/payroll/reconstruction/payroll-recon-999999-v1',
		{ data: { command: 'approve', expected_version: 1 } }
	);
	expect(unknownProposal.status()).toBe(404);
	const missingVersion = await request.post(
		`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${pendingUid}`,
		{ data: { command: 'approve' } }
	);
	expect(missingVersion.status()).toBe(400);
	const badCommand = await request.post(
		`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${pendingUid}`,
		{ data: { command: 'freeze', expected_version: 1 } }
	);
	expect(badCommand.status()).toBe(400);
	const zeroVersion = await request.post(
		`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${pendingUid}`,
		{ data: { command: 'approve', expected_version: 0 } }
	);
	expect(zeroVersion.status()).toBe(400);

	expect(await count(FIXTURE_ALLOCATIONS)).toBe(allocationsBefore);
	expect(await count(FIXTURE_PROPOSALS)).toBe(proposalsBefore);

	evidence.authorization = {
		readerPropose: 403,
		readerReview: 403,
		expenseOnlyPropose: 403,
		expenseOnlyReview: 403,
		missingMonth: 400,
		badMonth: 400,
		unknownSlip: 404,
		monthMismatch: 409,
		unknownProposal: 404,
		missingVersion: 400,
		badCommand: 400,
	};
});

test('the browser reader sees no review controls while the pending proposal is visible', async ({
	page,
	browser,
	playwright,
}) => {
	const session = await loginReconstructionReader(playwright, E2E_ENV.baseURL);
	const context = await browser.newContext({
		baseURL: E2E_ENV.baseURL,
		storageState: session.storageState,
		extraHTTPHeaders: { 'x-vercel-forwarded-for': RECONSTRUCTION_READER_IP },
	});
	try {
		const readerPage = await context.newPage();
		await readerPage.goto('/reports/employee-project-monthly-cost');
		await readerPage
			.getByRole('tab', { name: 'Expenditure', exact: true })
			.click();
		await selectMonth(readerPage, MONTH_LABEL);
		await expect(readerPage.getByTestId('payroll-summary')).toBeVisible();
		// The rejected-then-reproposed pending proposal is readable, without
		// any approve/reject/propose control for the read-only identity.
		const readerPendingRow = readerPage
			.getByTestId('payroll-employee-row')
			.filter({ hasText: 'E2E-RECON-04' });
		await expect(
			readerPendingRow.getByTestId('payroll-reconstruction-pending')
		).toBeVisible();
		await expect(
			readerPage.getByTestId('payroll-reconstruction-approve')
		).toHaveCount(0);
		await expect(
			readerPage.getByTestId('payroll-reconstruction-reject')
		).toHaveCount(0);
		await expect(
			readerPage.getByTestId('payroll-reconstruction-propose')
		).toHaveCount(0);

		// The same pending proposal renders its review controls for the admin.
		await page.goto('/reports/employee-project-monthly-cost');
		await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
		await selectMonth(page, MONTH_LABEL);
		const pendingRow = page
			.getByTestId('payroll-employee-row')
			.filter({ hasText: 'E2E-RECON-04' });
		await expect(
			pendingRow.getByTestId('payroll-reconstruction-approve')
		).toBeVisible();
		await expect(
			pendingRow.getByTestId('payroll-reconstruction-reject')
		).toBeVisible();

		evidence.readerReviewControls = {
			readerApprove: 0,
			adminApproveVisible: true,
		};
	} finally {
		await session.request.dispose();
		await context.close();
	}
});

test('reconstruction changes no Payroll Slip, payment status, or Payroll Run state, and the month still reopens', async ({
	request,
}) => {
	// Byte-for-byte identity of every fixture slip and run across the whole
	// propose/approve/reject cycle.
	expect(await fixtureSlipsSnapshot()).toBe(slipsSnapshot);
	expect(await fixtureRunsSnapshot()).toBe(runsSnapshot);

	// The month's final reviewed state.
	const data = await reconciliation(request, MONTH);
	expect(data.payroll.recorded_total).toBe(EXPECTED.month.recordedTotal);
	expect(data.payroll.recorded_count).toBe(EXPECTED.month.recordedCount);
	expect(data.payroll.known_zero_count).toBe(EXPECTED.month.knownZeroCount);
	expect(data.payroll.allocation_missing_count).toBe(
		EXPECTED.month.allocationMissingCount
	);
	expect(data.payroll.rounding_adjustment).toBe(
		EXPECTED.month.roundingAdjustment
	);
	expect(data.payroll.unallocated_total).toBe(EXPECTED.month.unallocated);
	expect(data.company.incurred_cost).toBe(EXPECTED.month.recordedTotal);
	const inr = data.company.currency_totals.find(
		(row) => row.currency === 'INR'
	)!;
	expect(inr.incurred_cost).toBe(EXPECTED.month.recordedTotal);
	expect(inr.unallocated_cost).toBe(EXPECTED.month.unallocated);
	const p1 = data.projects.find(
		(row) => row.project_code === RECONSTRUCTION_PROJECTS.p1.code
	)!;
	expect(p1.employee_cost).toBe(EXPECTED.month.project1);
	const p2 = data.projects.find(
		(row) => row.project_code === RECONSTRUCTION_PROJECTS.p2.code
	)!;
	expect(p2.employee_cost).toBe(EXPECTED.month.project2);
	const codes = coverageCodes(data);
	expect(codes).toContain('payroll_reconstructed');
	expect(codes).toContain('payroll_reconstruction_pending');
	expect(codes).toContain('payroll_allocation_missing');

	// The reconstruction did not make the run unreopenable; after the reopen
	// the frozen versions remain readable history.
	const reopened = await request.post('/api/payroll/runs/reopen', {
		data: { month: MONTH_DAY },
	});
	expect(reopened.status(), await reopened.text()).toBe(200);
	const afterReopen = await reconciliation(request, MONTH);
	expect(afterReopen.payroll.recorded_total).toBe(0);
	expect(await count(FIXTURE_ALLOCATIONS)).toBe(5);

	evidence.unchanged = {
		slipsIdentical: true,
		runsIdentical: true,
		recordedTotal: EXPECTED.month.recordedTotal,
		reopenStatus: reopened.status(),
		allocationsAfterReopen: 5,
	};
});
