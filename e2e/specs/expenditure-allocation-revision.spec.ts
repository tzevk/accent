import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { writeArtifact } from '../lib/artifacts';
import { exec, rows } from '../lib/db';
import { E2E_ENV } from '../lib/env';
import {
	REVISION_EXPECTED,
	REVISION_MONTH,
	REVISION_MONTH_DAY,
	REVISION_PAID_MONTH,
	REVISION_PAID_MONTH_DAY,
	REVISION_PROJECTS,
	cleanupExpenditureAllocationRevisionFixtures,
	loginRevisionFinance,
	loginRevisionPayrollOnly,
	loginRevisionReader,
	seedExpenditureAllocationRevisionFixtures,
	type SeededRevision,
} from '../lib/expenditure-allocation-revision-fixtures';

/**
 * Ticket #309 — Project Cost Allocation Revision, end to end.
 *
 * The fixture file states every amount as a literal derived from the payroll
 * and allocation rules; this spec asserts those literals against the real app
 * (authenticated requests, the actual report controls) and independently
 * against MySQL. No expectation is computed by the module under test.
 *
 * Flow: generate → finalize (v1 freeze) → report/drilldown → ordinary
 * timesheet/profile edits cannot move frozen shares → unauthorized and invalid
 * commands refused with no writes → authorized revision (old/new figures) →
 * history and selected version in report + browser → stale repeat and
 * concurrent commands → browser revision through the real control → paid-month
 * restrictions on 2018-04 with a revision still allowed.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.104' },
});
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const MONTH = REVISION_MONTH;
const MONTH_DAY = REVISION_MONTH_DAY;
const PAID_MONTH = REVISION_PAID_MONTH;
const PAID_MONTH_DAY = REVISION_PAID_MONTH_DAY;
const MONTHLY = REVISION_EXPECTED.monthly;
const CONTRACT = REVISION_EXPECTED.contract;

let seeded: SeededRevision;
let monthlySlipId: number;
let contractSlipId: number;

const evidence: Record<string, unknown> = {};

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

interface PayrollEmployee {
	employee_id: number;
	employee_code: string;
	pay_stream: string;
	status: string;
	recorded_amount: number | null;
	estimated_amount: number | null;
	logged_hours: number;
	source: {
		payroll_slip_id: number | null;
		allocation_id: number | null;
		allocation_version: number | null;
		allocation_kind: string | null;
	};
	shares: PayrollShare[];
}

interface PayrollDrilldown {
	month: string;
	currency: string;
	employees: PayrollEmployee[];
	coverage: Array<{ code: string; severity: string; detail: string }>;
}

interface HistoryVersion {
	version: number;
	kind: string;
	allocation_uid: string;
	recorded_employer_cost: number;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	frozen_by: number | null;
	actor_name: string | null;
	command: string | null;
	reason: string | null;
	evidence_reference: string | null;
	journal_at: string | null;
	superseded_by: number | null;
	reconciles: boolean;
	shares: PayrollShare[];
}

interface RevisionHistory {
	payroll_slip_id: number;
	month: string;
	employee_code: string;
	currency: string;
	selected_version: number;
	versions: HistoryVersion[];
}

interface RevisionResult {
	allocation_uid: string;
	version: number;
	kind: string;
	payroll_slip_id: number;
	month: string;
	employee_code: string;
	pay_stream: string;
	recorded_employer_cost: number;
	currency: string;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	shares: PayrollShare[];
	previous: {
		version: number;
		kind: string;
		recorded_employer_cost: number;
		shares: PayrollShare[];
	};
	actor_user_id: number | null;
	revised_at: string;
}

function publish(): void {
	writeArtifact('expenditure-allocation-revision', {
		fixtureScope: {
			month: MONTH,
			paidMonth: PAID_MONTH,
			projectCodes: [REVISION_PROJECTS.p1.code, REVISION_PROJECTS.p2.code],
			employeeCodes: [MONTHLY.employeeCode, CONTRACT.employeeCode],
			gateSlips: seeded?.gateSlips ?? null,
			trustedIps: ['198.18.0.104', '198.18.0.105', '198.18.0.106'],
		},
		expected: {
			monthly: MONTHLY,
			contract: CONTRACT,
		},
		...evidence,
	});
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
	const [row] = await rows<{ n: number | string }>(sql, params);
	return Number(row?.n ?? 0);
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

async function revisionHistory(
	request: APIRequestContext,
	slipId: number
): Promise<RevisionHistory> {
	const response = await request.get(
		`/api/reports/employee-project-monthly-cost/payroll/revisions?payroll_slip_id=${slipId}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as RevisionHistory;
}

interface RevisionCommandInput {
	payroll_slip_id: number;
	expected_version: number;
	reason: string;
	evidence_reference: string;
	lines: Array<{ project_id: number | null; hours: number }>;
}

function revisionLines(
	hours: readonly number[]
): Array<{ project_id: number | null; hours: number }> {
	return [
		{ project_id: seeded.projectIds.p1, hours: hours[0] },
		{ project_id: seeded.projectIds.p2, hours: hours[1] },
		{ project_id: null, hours: hours[2] },
	];
}

function shareTuple(employee: PayrollEmployee): {
	hours: number[];
	amounts: number[];
	adjustments: number[];
} {
	const order = (share: PayrollShare) => {
		if (share.project_id === seeded.projectIds.p1) return 0;
		if (share.project_id === seeded.projectIds.p2) return 1;
		return 2;
	};
	const sorted = [...employee.shares].sort((a, b) => order(a) - order(b));
	return {
		hours: sorted.map((share) => share.hours),
		amounts: sorted.map((share) => share.amount),
		adjustments: sorted.map((share) => share.rounding_adjustment),
	};
}

function versionShares(version: HistoryVersion): { amounts: number[] } {
	const order = (share: PayrollShare) => {
		if (share.project_id === seeded.projectIds.p1) return 0;
		if (share.project_id === seeded.projectIds.p2) return 1;
		return 2;
	};
	const sorted = [...version.shares].sort((a, b) => order(a) - order(b));
	return { amounts: sorted.map((share) => share.amount) };
}

/** slip/run rows the revision must leave byte-identical. */
async function monthlySlipSnapshot(): Promise<Record<string, unknown>> {
	const [row] = await rows(
		`SELECT employer_cost, gross, basic, total_earnings,
            total_employer_contributions, net_pay, payment_status
       FROM payroll_slips WHERE id = ?`,
		[monthlySlipId]
	);
	return row;
}

async function paidRunSnapshot(): Promise<Record<string, unknown>> {
	const [row] = await rows(
		`SELECT id, status, finalized_by, finalized_at, total_employees,
            total_gross, total_employer_contribution
       FROM payroll_runs WHERE year = 2018 AND month = 3`
	);
	return row;
}

async function allocationVersions(
	slipId: number
): Promise<Array<{ version: number; kind: string }>> {
	return rows<{ version: number; kind: string }>(
		`SELECT version, kind FROM payroll_employee_allocations
      WHERE payroll_slip_id = ? ORDER BY version`,
		[slipId]
	);
}

test.beforeAll(async () => {
	seeded = await seedExpenditureAllocationRevisionFixtures();
	evidence.seeded = {
		projectIds: seeded.projectIds,
		employeeIds: seeded.employeeIds,
		gateSlips: seeded.gateSlips,
	};
});

test.afterAll(async () => {
	publish();
	await cleanupExpenditureAllocationRevisionFixtures();
});

test('generates the fixture month and states the fixture slip employer costs', async ({
	request,
}) => {
	const response = await request.post('/api/payroll/generate', {
		data: { month: MONTH_DAY, all: true },
	});
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);

	const slips = await rows<{
		id: number;
		employee_id: number;
		employer_cost: string;
		gross: string;
	}>(
		`SELECT id, employee_id, employer_cost, gross FROM payroll_slips WHERE month = ?`,
		[MONTH_DAY]
	);
	const byEmployee = new Map(
		slips.map((slip) => [Number(slip.employee_id), slip])
	);
	const monthly = byEmployee.get(seeded.employeeIds.monthly);
	expect(monthly, 'E2E-REV-01 March slip').toBeTruthy();
	monthlySlipId = Number(monthly!.id);
	expect(Number(monthly!.employer_cost)).toBe(MONTHLY.slipEmployerCost);
	expect(Number(monthly!.gross)).toBe(16200);
	const contract = byEmployee.get(seeded.employeeIds.contract);
	expect(contract, 'E2E-REV-02 March slip').toBeTruthy();
	expect(Number(contract!.employer_cost)).toBe(0);

	const [run] = await rows<{ status: string }>(
		`SELECT status FROM payroll_runs WHERE year = 2018 AND month = 3`
	);
	expect(run.status).toBe('draft');
	expect(
		await count(
			`SELECT COUNT(*) AS n FROM payroll_employee_allocations WHERE month = ?`,
			[MONTH_DAY]
		)
	).toBe(0);
	evidence.generated = {
		slips: slips.length,
		monthlyEmployerCost: Number(monthly!.employer_cost),
		run: run.status,
	};
});

test('freezes the recorded allocation at finalize with the derived cent shares', async ({
	request,
}) => {
	const response = await request.post('/api/payroll/runs/finalize', {
		data: { month: MONTH_DAY },
	});
	expect(response.status(), await response.text()).toBe(200);

	const versions = await allocationVersions(monthlySlipId);
	expect(versions).toEqual([{ version: 1, kind: 'finalization' }]);
	const [allocation] = await rows<{
		id: number;
		allocation_uid: string;
		recorded_employer_cost: string;
		total_logged_hours: string;
		project_hours: string;
		no_project_hours: string;
		rounding_adjustment: string;
	}>(
		`SELECT id, allocation_uid, recorded_employer_cost, total_logged_hours,
            project_hours, no_project_hours, rounding_adjustment
       FROM payroll_employee_allocations
      WHERE payroll_slip_id = ? AND version = 1`,
		[monthlySlipId]
	);
	expect(Number(allocation.recorded_employer_cost)).toBe(
		MONTHLY.slipEmployerCost
	);
	expect(Number(allocation.total_logged_hours)).toBe(MONTHLY.totalLoggedHours);
	expect(Number(allocation.project_hours)).toBe(MONTHLY.v1.projectHours);
	expect(Number(allocation.no_project_hours)).toBe(MONTHLY.v1.noProjectHours);
	expect(Number(allocation.rounding_adjustment)).toBe(
		MONTHLY.v1.totalAdjustment
	);
	const shares = await rows<{
		project_id: number | null;
		hours: string;
		amount: string;
		rounding_adjustment: string;
		basis: string;
	}>(
		`SELECT project_id, hours, amount, rounding_adjustment, basis
       FROM payroll_employee_allocation_shares
      WHERE allocation_id = ? ORDER BY id`,
		[allocation.id]
	);
	expect(shares.map((share) => Number(share.hours))).toEqual(MONTHLY.v1.hours);
	expect(shares.map((share) => Number(share.amount))).toEqual(
		MONTHLY.v1.shares
	);
	expect(shares.reduce((sum, share) => sum + Number(share.amount), 0)).toBe(
		MONTHLY.slipEmployerCost
	);
	evidence.frozen = {
		allocationUid: allocation.allocation_uid,
		version: 1,
		shares: shares.map((share) => ({
			project_id: share.project_id,
			hours: Number(share.hours),
			amount: Number(share.amount),
		})),
	};
});

test('reports the selected allocation version and derived shares', async ({
	request,
}) => {
	const drilldown = await payrollDrilldown(
		request,
		MONTH,
		seeded.employeeIds.monthly
	);
	const employee = drilldown.employees.find(
		(row) => row.employee_code === MONTHLY.employeeCode
	)!;
	expect(employee.status).toBe('recorded');
	expect(employee.pay_stream).toBe(MONTHLY.payStream);
	expect(employee.recorded_amount).toBe(MONTHLY.slipEmployerCost);
	expect(employee.source.payroll_slip_id).toBe(monthlySlipId);
	expect(employee.source.allocation_version).toBe(1);
	expect(employee.source.allocation_kind).toBe('finalization');
	const tuple = shareTuple(employee);
	expect(tuple.hours).toEqual(MONTHLY.v1.hours);
	expect(tuple.amounts).toEqual(MONTHLY.v1.shares);
	expect(tuple.adjustments).toEqual(MONTHLY.v1.adjustments);
	expect(drilldown.coverage.map((entry) => entry.code)).not.toContain(
		'payroll_allocation_revised'
	);
	evidence.drilldownV1 = {
		version: employee.source.allocation_version,
		kind: employee.source.allocation_kind,
		shares: tuple,
	};
});

test('ordinary timesheet and Salary Profile edits cannot alter frozen shares or the Payroll Slip', async ({
	request,
}) => {
	const before = await allocationVersions(monthlySlipId);
	const slipBefore = await monthlySlipSnapshot();

	// Timesheet: move the frozen month's P1 assignment to different hours.
	await exec(
		`UPDATE user_activity_assignments SET daily_entries = ? WHERE id = ?`,
		[
			JSON.stringify([
				{ date: `${MONTH}-05`, hours: 12 },
				{ date: `${MONTH}-06`, hours: 12 },
			]),
			'e2e-rev-assign-monthly-p1',
		]
	);
	// Salary Profile: a much larger CTC effective from the frozen month.
	const profile = await request.post('/api/payroll/salary-profile', {
		data: {
			employee_id: seeded.employeeIds.monthly,
			gross_salary: 99000,
			employer_cost: 99000,
			effective_from: MONTH_DAY,
			salary_type: 'monthly',
			std_hours_per_day: 8,
			std_working_days: 26,
		},
	});
	expect(profile.status(), await profile.text()).toBe(200);

	const drilldown = await payrollDrilldown(
		request,
		MONTH,
		seeded.employeeIds.monthly
	);
	const employee = drilldown.employees.find(
		(row) => row.employee_code === MONTHLY.employeeCode
	)!;
	expect(employee.recorded_amount).toBe(MONTHLY.slipEmployerCost);
	expect(employee.source.allocation_version).toBe(1);
	expect(shareTuple(employee).amounts).toEqual(MONTHLY.v1.shares);
	// The frozen hours shown beside recorded cost are the allocation's own.
	expect(employee.logged_hours).toBe(MONTHLY.totalLoggedHours);
	expect(await allocationVersions(monthlySlipId)).toEqual(before);
	expect(await monthlySlipSnapshot()).toEqual(slipBefore);
	evidence.ordinaryEdits = {
		versionsAfterEdits: before,
		recordedAmount: employee.recorded_amount,
	};
});

test('refuses unauthorized and invalid revision commands without any write', async ({
	request,
	playwright,
}) => {
	const baseline = await allocationVersions(monthlySlipId);
	expect(baseline).toHaveLength(1);
	const eventsBefore = await count(
		`SELECT COUNT(*) AS n FROM payroll_allocation_events`
	);
	const command: RevisionCommandInput = {
		payroll_slip_id: monthlySlipId,
		expected_version: 1,
		reason: MONTHLY.revisionReason,
		evidence_reference: MONTHLY.revisionEvidence,
		lines: revisionLines(MONTHLY.v2.hours),
	};

	// Read-gate-only reader: may read the history, may not revise.
	const reader = await loginRevisionReader(playwright, E2E_ENV.baseURL);
	// payroll:update without the expense-source read: the conjunction refuses.
	const payrollOnly = await loginRevisionPayrollOnly(
		playwright,
		E2E_ENV.baseURL
	);
	try {
		const history = await revisionHistory(reader, monthlySlipId);
		expect(history.selected_version).toBe(1);

		const readerCommand = await reader.post(
			'/api/reports/employee-project-monthly-cost/payroll/revisions',
			{ data: command }
		);
		expect(readerCommand.status()).toBe(403);
		const readerBody = await readerCommand.text();
		expect(readerBody).not.toContain(String(MONTHLY.slipEmployerCost));
		expect(readerBody).not.toContain('16668');

		const payrollRead = await payrollOnly.get(
			`/api/reports/employee-project-monthly-cost/payroll/revisions?payroll_slip_id=${monthlySlipId}`
		);
		expect(payrollRead.status()).toBe(403);
		const payrollReadBody = await payrollRead.text();
		expect(payrollReadBody).not.toContain(String(MONTHLY.slipEmployerCost));
		const payrollCommand = await payrollOnly.post(
			'/api/reports/employee-project-monthly-cost/payroll/revisions',
			{ data: command }
		);
		expect(payrollCommand.status()).toBe(403);
	} finally {
		await reader.dispose();
		await payrollOnly.dispose();
	}

	// Invalid commands through the real route: each fails explicitly.
	const cases: Array<{
		name: string;
		body: unknown;
		status: number;
		code: string;
	}> = [
		{
			name: 'missing reason',
			body: { ...command, reason: '   ' },
			status: 422,
			code: 'reason_required',
		},
		{
			name: 'missing evidence',
			body: { ...command, evidence_reference: '' },
			status: 422,
			code: 'evidence_required',
		},
		{
			name: 'negative hours',
			body: {
				...command,
				lines: [
					{ project_id: seeded.projectIds.p1, hours: -5 },
					{ project_id: null, hours: 27 },
				],
			},
			status: 422,
			code: 'invalid_lines',
		},
		{
			name: 'zero-hour destination',
			body: {
				...command,
				lines: [
					{ project_id: seeded.projectIds.p1, hours: 0 },
					{ project_id: null, hours: 27 },
				],
			},
			status: 422,
			code: 'invalid_lines',
		},
		{
			name: 'unknown project',
			body: {
				...command,
				lines: [
					{ project_id: 99999999, hours: 100 },
					{ project_id: null, hours: 27 },
				],
			},
			status: 422,
			code: 'unknown_project',
		},
		{
			name: 'duplicate destination',
			body: {
				...command,
				lines: [
					{ project_id: seeded.projectIds.p1, hours: 50 },
					{ project_id: seeded.projectIds.p1, hours: 50 },
					{ project_id: null, hours: 27 },
				],
			},
			status: 422,
			code: 'duplicate_destination',
		},
		{
			name: 'stale expected version',
			body: { ...command, expected_version: 99 },
			status: 409,
			code: 'version_conflict',
		},
		{
			name: 'unknown slip',
			body: { ...command, payroll_slip_id: 99999999 },
			status: 404,
			code: 'slip_not_found',
		},
	];
	const outcomes: Array<{ name: string; status: number; code: string }> = [];
	for (const entry of cases) {
		const response = await request.post(
			'/api/reports/employee-project-monthly-cost/payroll/revisions',
			{ data: entry.body }
		);
		expect(response.status(), `${entry.name}: ${await response.text()}`).toBe(
			entry.status
		);
		const body = await response.json();
		expect(body.success).toBe(false);
		expect(body.code).toBe(entry.code);
		outcomes.push({ name: entry.name, status: entry.status, code: body.code });
	}

	expect(await allocationVersions(monthlySlipId)).toEqual(baseline);
	expect(
		await count(`SELECT COUNT(*) AS n FROM payroll_allocation_events`)
	).toBe(eventsBefore);
	evidence.refusedCommands = outcomes;
});

test('performs the authorized revision with old and new figures, preserving the slip and run', async ({
	request,
	playwright,
}) => {
	const [financeUser] = await rows<{ id: number }>(
		`SELECT id FROM users WHERE username = 'e2e_rev_finance'`
	);
	const slipBefore = await monthlySlipSnapshot();
	const runBefore = await paidRunSnapshot();
	const eventsBefore = await count(
		`SELECT COUNT(*) AS n FROM payroll_allocation_events`
	);

	const finance = await loginRevisionFinance(playwright, E2E_ENV.baseURL);
	// Assigned by the successful command below; a refusal throws out of the test.
	let result!: RevisionResult;
	try {
		const response = await finance.post(
			'/api/reports/employee-project-monthly-cost/payroll/revisions',
			{
				data: {
					payroll_slip_id: monthlySlipId,
					expected_version: 1,
					reason: MONTHLY.revisionReason,
					evidence_reference: MONTHLY.revisionEvidence,
					lines: revisionLines(MONTHLY.v2.hours),
				},
			}
		);
		expect(response.status(), await response.text()).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		result = body.data as RevisionResult;

		// The history is readable by the same non-super-admin identity.
		const history = await revisionHistory(finance, monthlySlipId);
		expect(history.versions.map((version) => version.version)).toEqual([1, 2]);
	} finally {
		await finance.dispose();
	}

	expect(result.version).toBe(2);
	expect(result.kind).toBe('revision');
	expect(result.recorded_employer_cost).toBe(MONTHLY.slipEmployerCost);
	expect(result.currency).toBe('INR');
	expect(result.total_logged_hours).toBe(MONTHLY.totalLoggedHours);
	expect(result.actor_user_id).toBe(Number(financeUser.id));
	expect(result.revised_at).toBeTruthy();
	const order = (share: PayrollShare) => {
		if (share.project_id === seeded.projectIds.p1) return 0;
		if (share.project_id === seeded.projectIds.p2) return 1;
		return 2;
	};
	const newShares = [...result.shares].sort((a, b) => order(a) - order(b));
	expect(newShares.map((share) => share.hours)).toEqual(MONTHLY.v2.hours);
	expect(newShares.map((share) => share.amount)).toEqual(MONTHLY.v2.shares);
	expect(newShares.map((share) => share.rounding_adjustment)).toEqual(
		MONTHLY.v2.adjustments
	);
	expect(result.previous.version).toBe(1);
	expect(result.previous.kind).toBe('finalization');
	const oldShares = [...result.previous.shares].sort(
		(a, b) => order(a) - order(b)
	);
	expect(oldShares.map((share) => share.amount)).toEqual(MONTHLY.v1.shares);

	// Durable, independent evidence: the new immutable version and journal.
	const [allocation] = await rows<{
		id: number;
		allocation_uid: string;
		kind: string;
		recorded_employer_cost: string;
		total_logged_hours: string;
		project_hours: string;
		no_project_hours: string;
		rounding_adjustment: string;
		frozen_by: number | null;
	}>(
		`SELECT id, allocation_uid, kind, recorded_employer_cost, total_logged_hours,
            project_hours, no_project_hours, rounding_adjustment, frozen_by
       FROM payroll_employee_allocations
      WHERE payroll_slip_id = ? AND version = 2`,
		[monthlySlipId]
	);
	expect(allocation.kind).toBe('revision');
	expect(Number(allocation.recorded_employer_cost)).toBe(
		MONTHLY.slipEmployerCost
	);
	expect(Number(allocation.total_logged_hours)).toBe(MONTHLY.totalLoggedHours);
	expect(Number(allocation.rounding_adjustment)).toBe(
		MONTHLY.v2.totalAdjustment
	);
	expect(Number(allocation.frozen_by)).toBe(Number(financeUser.id));
	const storedShares = await rows<{
		project_id: number | null;
		hours: string;
		amount: string;
		rounding_adjustment: string;
	}>(
		`SELECT project_id, hours, amount, rounding_adjustment
       FROM payroll_employee_allocation_shares
      WHERE allocation_id = ? ORDER BY id`,
		[allocation.id]
	);
	expect(
		storedShares.reduce((sum, share) => sum + Number(share.amount), 0)
	).toBe(16668);
	expect(storedShares.map((share) => Number(share.amount))).toEqual(
		MONTHLY.v2.shares
	);

	const [event] = await rows<{
		command: string;
		actor_user_id: number | null;
		reason: string | null;
		evidence_reference: string | null;
		snapshot: string;
	}>(
		`SELECT command, actor_user_id, reason, evidence_reference, snapshot
       FROM payroll_allocation_events
      WHERE allocation_uid = ? AND version = 2`,
		[allocation.allocation_uid]
	);
	expect(event.command).toBe('revised');
	expect(Number(event.actor_user_id)).toBe(Number(financeUser.id));
	expect(event.reason).toBe(MONTHLY.revisionReason);
	expect(event.evidence_reference).toBe(MONTHLY.revisionEvidence);
	const snapshot = JSON.parse(event.snapshot) as {
		previous_version: number;
		previous: { shares: PayrollShare[] };
		corrected_lines: Array<{ project_id: number | null; hours: number }>;
	};
	expect(snapshot.previous_version).toBe(1);
	expect(
		[...snapshot.previous.shares]
			.sort((a, b) => order(a) - order(b))
			.map((share) => share.amount)
	).toEqual(MONTHLY.v1.shares);
	expect(snapshot.corrected_lines.map((line) => line.hours)).toEqual(
		MONTHLY.v2.hours
	);

	// The slip and the run are untouched; exactly one event was appended.
	expect(await monthlySlipSnapshot()).toEqual(slipBefore);
	expect(await paidRunSnapshot()).toEqual(runBefore);
	expect(
		await count(`SELECT COUNT(*) AS n FROM payroll_allocation_events`)
	).toBe(eventsBefore + 1);
	expect(await allocationVersions(monthlySlipId)).toEqual([
		{ version: 1, kind: 'finalization' },
		{ version: 2, kind: 'revision' },
	]);

	evidence.authorizedRevision = {
		version: result.version,
		kind: result.kind,
		newShares: MONTHLY.v2,
		previousVersion: snapshot.previous_version,
		eventCommand: event.command,
		slipUnchanged: true,
	};
});

test('exposes the selected version and full revision history to every read gate holder', async ({
	request,
	playwright,
}) => {
	const drilldown = await payrollDrilldown(
		request,
		MONTH,
		seeded.employeeIds.monthly
	);
	const employee = drilldown.employees.find(
		(row) => row.employee_code === MONTHLY.employeeCode
	)!;
	expect(employee.source.allocation_version).toBe(2);
	expect(employee.source.allocation_kind).toBe('revision');
	expect(shareTuple(employee).amounts).toEqual(MONTHLY.v2.shares);
	expect(
		drilldown.coverage.find(
			(entry) => entry.code === 'payroll_allocation_revised'
		)
	).toBeTruthy();

	const history = await revisionHistory(request, monthlySlipId);
	expect(history.payroll_slip_id).toBe(monthlySlipId);
	expect(history.month).toBe(MONTH);
	expect(history.employee_code).toBe(MONTHLY.employeeCode);
	expect(history.selected_version).toBe(2);
	expect(history.versions.map((version) => version.version)).toEqual([1, 2]);

	const [v1, v2] = history.versions;
	expect(v1.kind).toBe('finalization');
	expect(v1.command).toBe('frozen');
	expect(v1.reconciles).toBe(true);
	expect(v1.superseded_by).toBe(2);
	expect(versionShares(v1).amounts).toEqual(MONTHLY.v1.shares);
	expect(Number(v1.recorded_employer_cost)).toBe(MONTHLY.slipEmployerCost);
	expect(v2.kind).toBe('revision');
	expect(v2.command).toBe('revised');
	expect(v2.reconciles).toBe(true);
	expect(v2.superseded_by).toBeNull();
	expect(v2.reason).toBe(MONTHLY.revisionReason);
	expect(v2.evidence_reference).toBe(MONTHLY.revisionEvidence);
	expect(v2.actor_name).toBe('E2E Revision Finance Operator');
	expect(versionShares(v2).amounts).toEqual(MONTHLY.v2.shares);
	expect(v2.total_logged_hours).toBe(MONTHLY.totalLoggedHours);

	const reader = await loginRevisionReader(playwright, E2E_ENV.baseURL);
	try {
		const readerHistory = await revisionHistory(reader, monthlySlipId);
		expect(readerHistory.selected_version).toBe(2);
	} finally {
		await reader.dispose();
	}

	// Unknown or malformed targets are explicit failures.
	const unknown = await request.get(
		'/api/reports/employee-project-monthly-cost/payroll/revisions?payroll_slip_id=99999999'
	);
	expect(unknown.status()).toBe(404);
	const malformed = await request.get(
		'/api/reports/employee-project-monthly-cost/payroll/revisions?payroll_slip_id=abc'
	);
	expect(malformed.status()).toBe(400);
	const missing = await request.get(
		'/api/reports/employee-project-monthly-cost/payroll/revisions'
	);
	expect(missing.status()).toBe(400);

	evidence.history = {
		selectedVersion: history.selected_version,
		versions: history.versions.map((version) => ({
			version: version.version,
			kind: version.kind,
			command: version.command,
			supersededBy: version.superseded_by,
			reconciles: version.reconciles,
		})),
	};
});

test('refuses a repeated command and lets exactly one concurrent command append one version', async ({
	request,
}) => {
	// Repeat of the applied command: the version it expected is history now.
	const repeated = await request.post(
		'/api/reports/employee-project-monthly-cost/payroll/revisions',
		{
			data: {
				payroll_slip_id: monthlySlipId,
				expected_version: 1,
				reason: MONTHLY.revisionReason,
				evidence_reference: MONTHLY.revisionEvidence,
				lines: revisionLines(MONTHLY.v2.hours),
			},
		}
	);
	expect(repeated.status()).toBe(409);
	expect((await repeated.json()).code).toBe('version_conflict');
	expect(await allocationVersions(monthlySlipId)).toHaveLength(2);

	// Two identical concurrent commands: one wins, one is refused; the winner
	// is deterministic because both bodies are the same.
	const body = {
		payroll_slip_id: monthlySlipId,
		expected_version: 2,
		reason: 'E2E concurrent revision probe',
		evidence_reference: 'e2e-rev-concurrent.pdf',
		lines: revisionLines(MONTHLY.v3.hours),
	};
	const [first, second] = await Promise.all([
		request.post(
			'/api/reports/employee-project-monthly-cost/payroll/revisions',
			{ data: body }
		),
		request.post(
			'/api/reports/employee-project-monthly-cost/payroll/revisions',
			{ data: body }
		),
	]);
	const statuses = [first.status(), second.status()].sort();
	expect(statuses).toEqual([200, 409]);
	const refused = first.status() === 409 ? first : second;
	expect((await refused.json()).code).toBe('version_conflict');

	const versions = await allocationVersions(monthlySlipId);
	expect(versions).toEqual([
		{ version: 1, kind: 'finalization' },
		{ version: 2, kind: 'revision' },
		{ version: 3, kind: 'revision' },
	]);
	const [allocation] = await rows<{ id: number; allocation_uid: string }>(
		`SELECT id, allocation_uid FROM payroll_employee_allocations
      WHERE payroll_slip_id = ? AND version = 3`,
		[monthlySlipId]
	);
	const storedShares = await rows<{ amount: string }>(
		`SELECT amount FROM payroll_employee_allocation_shares
      WHERE allocation_id = ? ORDER BY id`,
		[allocation.id]
	);
	expect(storedShares.map((share) => Number(share.amount))).toEqual(
		MONTHLY.v3.shares
	);
	expect(
		await count(
			`SELECT COUNT(*) AS n FROM payroll_allocation_events
        WHERE allocation_uid = ?`,
			[allocation.allocation_uid]
		)
	).toBe(1);
	evidence.concurrent = {
		statuses,
		versions: versions.map((version) => version.version),
		amounts: MONTHLY.v3.shares,
	};
});

test('revises through the real report controls and shows the version history', async ({
	page,
}) => {
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await expect(page.getByTestId('expenditure-view')).toBeVisible();
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill('March 2018');
	await page.getByRole('button', { name: 'March 2018', exact: true }).click();

	const row = page
		.getByTestId('payroll-employee-row')
		.filter({ hasText: MONTHLY.employeeCode });
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute(
		'data-recorded',
		String(MONTHLY.slipEmployerCost)
	);
	await expect(row).toContainText('allocation v3');
	await expect(row).toContainText('revised');

	await row.getByTestId('payroll-employee-expand').click();
	await expect(page.getByTestId('payroll-allocation-history')).toBeVisible();
	const historyRows = page.getByTestId('payroll-history-version');
	await expect(historyRows).toHaveCount(3);
	await expect(
		page.locator('[data-testid="payroll-history-version"][data-version="3"]')
	).toHaveAttribute('data-selected', 'true');

	// The real revise control: validation surfaces, then the correction lands.
	await page.getByTestId('payroll-revise-open').click();
	await expect(page.getByTestId('payroll-revise-dialog')).toBeVisible();
	await page.getByTestId('payroll-revise-submit').click();
	await expect(page.getByTestId('payroll-revise-error')).toContainText(
		'reason'
	);

	await page
		.getByTestId('payroll-revise-hours')
		.nth(0)
		.fill(String(MONTHLY.v4.hours[0]));
	await page
		.getByTestId('payroll-revise-hours')
		.nth(1)
		.fill(String(MONTHLY.v4.hours[1]));
	await page
		.getByTestId('payroll-revise-hours')
		.nth(2)
		.fill(String(MONTHLY.v4.hours[2]));
	await page
		.getByTestId('payroll-revise-reason')
		.fill('E2E browser revision: correct P1 attribution');
	await page
		.getByTestId('payroll-revise-evidence')
		.fill('e2e-rev-browser-evidence.pdf');
	await page.getByTestId('payroll-revise-submit').click();

	await expect(page.getByTestId('payroll-revise-dialog')).toBeHidden();
	await expect(row).toContainText('allocation v4');
	await expect(historyRows).toHaveCount(4);
	const latest = page.locator(
		'[data-testid="payroll-history-version"][data-version="4"]'
	);
	await expect(latest).toHaveAttribute('data-selected', 'true');
	await expect(latest).toContainText('E2E browser revision');

	const [allocation] = await rows<{ id: number }>(
		`SELECT id FROM payroll_employee_allocations
      WHERE payroll_slip_id = ? AND version = 4`,
		[monthlySlipId]
	);
	const storedShares = await rows<{ amount: string }>(
		`SELECT amount FROM payroll_employee_allocation_shares
      WHERE allocation_id = ? ORDER BY id`,
		[allocation.id]
	);
	expect(storedShares.map((share) => Number(share.amount))).toEqual(
		MONTHLY.v4.shares
	);
	evidence.browser = {
		validatedReason: true,
		version: 4,
		amounts: MONTHLY.v4.shares,
		historyRows: 4,
	};
});

test('keeps paid-payroll restrictions while still allowing an attributed correction', async ({
	request,
	playwright,
}) => {
	const generate = await request.post('/api/payroll/generate', {
		data: { month: PAID_MONTH_DAY, all: true },
	});
	expect(generate.status(), await generate.text()).toBe(200);
	const [contract] = await rows<{ id: number; employer_cost: string }>(
		`SELECT ps.id, ps.employer_cost FROM payroll_slips ps
       JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month = ? AND e.employee_id = ?`,
		[PAID_MONTH_DAY, CONTRACT.employeeCode]
	);
	contractSlipId = Number(contract.id);
	expect(Number(contract.employer_cost)).toBe(CONTRACT.slipEmployerCost);

	const finalize = await request.post('/api/payroll/runs/finalize', {
		data: { month: PAID_MONTH_DAY },
	});
	expect(finalize.status(), await finalize.text()).toBe(200);

	// v1 freeze: the contract stream's own cents.
	const [v1] = await rows<{ id: number }>(
		`SELECT id FROM payroll_employee_allocations
      WHERE payroll_slip_id = ? AND version = 1`,
		[contractSlipId]
	);
	const v1Shares = await rows<{ amount: string }>(
		`SELECT amount FROM payroll_employee_allocation_shares
      WHERE allocation_id = ? ORDER BY id`,
		[v1.id]
	);
	expect(v1Shares.map((share) => Number(share.amount))).toEqual(
		CONTRACT.v1.shares
	);

	const paid = await request.post('/api/payroll/runs/mark-paid', {
		data: { month: PAID_MONTH_DAY, payment_date: `${PAID_MONTH}-27` },
	});
	expect(paid.status(), await paid.text()).toBe(200);

	// The paid restriction is unchanged: no reopen. A revision still corrects
	// attribution without touching the slip, and it preserves the stream.
	const reopen = await request.post('/api/payroll/runs/reopen', {
		data: { month: PAID_MONTH_DAY },
	});
	expect(reopen.status()).toBe(409);

	const slipBefore = await rows(
		`SELECT employer_cost, gross, net_pay, payment_status
       FROM payroll_slips WHERE id = ?`,
		[contractSlipId]
	);
	const finance = await loginRevisionFinance(playwright, E2E_ENV.baseURL);
	// Assigned by the successful command below; a refusal throws out of the test.
	let result!: RevisionResult;
	try {
		const response = await finance.post(
			'/api/reports/employee-project-monthly-cost/payroll/revisions',
			{
				data: {
					payroll_slip_id: contractSlipId,
					expected_version: 1,
					reason: CONTRACT.revisionReason,
					evidence_reference: CONTRACT.revisionEvidence,
					lines: revisionLines(CONTRACT.v2.hours),
				},
			}
		);
		expect(response.status(), await response.text()).toBe(200);
		result = (await response.json()).data as RevisionResult;
	} finally {
		await finance.dispose();
	}
	expect(result.version).toBe(2);
	expect(result.pay_stream).toBe(CONTRACT.payStream);
	expect(result.recorded_employer_cost).toBe(CONTRACT.slipEmployerCost);
	const order = (share: PayrollShare) => {
		if (share.project_id === seeded.projectIds.p1) return 0;
		if (share.project_id === seeded.projectIds.p2) return 1;
		return 2;
	};
	expect(
		[...result.shares].sort((a, b) => order(a) - order(b)).map((s) => s.amount)
	).toEqual(CONTRACT.v2.shares);

	const history = await revisionHistory(request, contractSlipId);
	expect(history.selected_version).toBe(2);
	expect(history.versions[1].kind).toBe('revision');

	const reopenAfter = await request.post('/api/payroll/runs/reopen', {
		data: { month: PAID_MONTH_DAY },
	});
	expect(reopenAfter.status()).toBe(409);
	const slipAfter = await rows(
		`SELECT employer_cost, gross, net_pay, payment_status
       FROM payroll_slips WHERE id = ?`,
		[contractSlipId]
	);
	expect(slipAfter).toEqual(slipBefore);
	expect(slipAfter[0].payment_status).toBe('paid');
	evidence.paidMonth = {
		reopen: 409,
		version: result.version,
		payStream: result.pay_stream,
		amounts: CONTRACT.v2.shares,
		paymentStatus: slipAfter[0].payment_status,
	};
});
