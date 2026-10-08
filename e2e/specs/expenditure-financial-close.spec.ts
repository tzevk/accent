/**
 * Ticket #322 — close reconciled financial months.
 *
 * Everything here is stated from the fixture literals and the business
 * rules, never from the report module's own aggregation: the fixtures say
 * what each cost, slip, and settlement is worth, this file says what the
 * review and the frozen snapshot must therefore state, and the assertions
 * compare the app's answer with that arithmetic. The API drives payroll
 * generate/finalize, the consumption and settlement commands, and the close
 * itself; the browser drives the report close control; and the database is
 * read back independently.
 *
 * The namespace and the months (2021-01, the complete month this spec
 * closes, and 2021-02, the incomplete month it refuses) belong to this spec
 * alone (`e2e/lib/expenditure-close-fixtures.ts`); 2021-03 is read as the
 * empty month and is never written. Every company assertion here is a
 * before/after of this spec's own rows and never an absolute over another
 * namespace.
 */

import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { rows } from '../lib/db';
import { writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import {
	CLOSE_CLERK,
	CLOSE_DIRECT,
	CLOSE_EMPLOYEE,
	CLOSE_MONTH,
	CLOSE_MONTH_DAY,
	CLOSE_ORDER,
	CLOSE_OUTSIDER,
	CLOSE_PREFIX,
	CLOSE_SPEC_IP,
	CLOSE_SUPPLIER,
	EMPTY_MONTH,
	OPEN_EMPLOYEE,
	OPEN_MONTH,
	OPEN_MONTH_DAY,
	cleanupCloseFixtures,
	loginCloseUser,
	seedCloseFixtures,
	type SeededClose,
} from '../lib/expenditure-close-fixtures';

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity, set through the proxy's trusted
	// header (ADR-0013), so a combined run cannot exhaust the shared budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': CLOSE_SPEC_IP },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const CLOSE = '/api/admin/expenditure-close';
const COMMANDS = (id: number) => `/api/admin/expenses/${id}/commands`;
const ACCRUAL_COMMANDS = (id: number) =>
	`/api/admin/cost-accruals/${id}/commands`;
const SETTLEMENTS = '/api/admin/expenditure-settlements';
const SETTLEMENT_COMMANDS = (id: number) =>
	`/api/admin/expenditure-settlements/${id}/commands`;
const CONSUME = (uid: string) =>
	`/api/admin/orders/${encodeURIComponent(uid)}/consumption`;
const RELEASE = (uid: string) =>
	`/api/admin/orders/${encodeURIComponent(uid)}/consumption/release`;
const REVISIONS =
	'/api/reports/employee-project-monthly-cost/payroll/revisions';
const REPORT = '/api/reports/employee-project-monthly-cost';

/** Independently stated fixture worth, from the fixture literals. */
const WORTH = {
	directJan: 12000,
	supplierJan: 10000,
	accrualJan: 6000,
	janDirect: 28000,
	janP1Direct: 18000,
	janP2: 10000,
	settlementJan: 12000,
	orderValue: 20000,
	consumedJan: 10000,
	remainingCommitment: 10000,
} as const;

type BlockEntry = { code: string; label: string; detail: string };

type CloseReview = {
	can_close: boolean;
	blockers: BlockEntry[];
	warnings: BlockEntry[];
};

type CloseData = {
	month: string;
	status: 'open' | 'closed';
	financial_version: number;
	close_uid: string | null;
	review: CloseReview;
	snapshot: Record<string, unknown> | null;
	reviewed_by: number | null;
	reviewed_at: string | null;
	review_reason: string | null;
	evidence_reference: string | null;
	created_at: string | null;
};

let seeded: SeededClose;
let clerk: APIRequestContext;
let outsider: APIRequestContext;
const outcome = trackArtifactOutcome();
const evidence: Record<string, unknown> = {};

async function readClose(
	ctx: APIRequestContext,
	month: string
): Promise<{
	status: number;
	body: { success: boolean; data?: CloseData } & Record<string, unknown>;
}> {
	const response = await ctx.get(`${CLOSE}?month=${month}`);
	const body = (await response.json()) as {
		success: boolean;
		data?: CloseData;
	} & Record<string, unknown>;
	return { status: response.status(), body };
}

async function readReport(
	ctx: APIRequestContext,
	month: string
): Promise<{
	month: string;
	company: {
		currency: string | null;
		incurred_cost: number | null;
		currency_totals: Array<{ currency: string; incurred_cost: number }>;
	};
	groups: Array<{ key: string; amount: number }>;
	projects: Array<{
		project_code: string;
		currency: string;
		incurred_cost: number;
	}>;
	payroll: { recorded_total: number; estimated_total: number };
	coverage: Array<{ code: string }>;
}> {
	const response = await ctx.get(`${REPORT}?view=expenditure&month=${month}`);
	expect(response.ok(), `report ${month} -> ${response.status()}`).toBe(true);
	const body = (await response.json()) as {
		success: boolean;
		data: {
			month: string;
			company: {
				currency: string | null;
				incurred_cost: number | null;
				currency_totals: Array<{ currency: string; incurred_cost: number }>;
			};
			groups: Array<{ key: string; amount: number }>;
			projects: Array<{
				project_code: string;
				currency: string;
				incurred_cost: number;
			}>;
			payroll: { recorded_total: number; estimated_total: number };
			coverage: Array<{ code: string }>;
		};
	};
	expect(body.success).toBe(true);
	return body.data;
}

function blockerCodes(review: CloseReview): string[] {
	return review.blockers.map((entry) => entry.code);
}

/** Open the report on the expenditure view for one month. */
async function openExpenditure(page: Page, monthLabel: string): Promise<void> {
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await expect(page.getByTestId('expenditure-view')).toBeVisible();
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill(monthLabel);
	await page.getByRole('button', { name: monthLabel, exact: true }).click();
}

test.beforeAll(async () => {
	seeded = await seedCloseFixtures();
});

test.afterAll(async () => {
	writeArtifact('expenditure-financial-close', {
		ok: outcome.ok,
		...evidence,
	});
	await cleanupCloseFixtures();
});

test('clerk and outsider sign in through the real login', async ({
	playwright,
	baseURL,
}) => {
	if (!baseURL) {
		throw new Error('The E2E run is missing its configured baseURL');
	}
	clerk = await loginCloseUser(playwright, baseURL, 'clerk');
	outsider = await loginCloseUser(playwright, baseURL, 'outsider');
	evidence.identities = {
		clerk: CLOSE_CLERK.username,
		outsider: CLOSE_OUTSIDER.username,
	};
});

test('generates and finalizes January payroll through the real payroll flow', async () => {
	const generate = await clerk.post('/api/payroll/generate', {
		data: { month: CLOSE_MONTH_DAY, all: true },
	});
	expect(generate.status(), await generate.text()).toBe(200);
	const finalize = await clerk.post('/api/payroll/runs/finalize', {
		data: { month: CLOSE_MONTH_DAY },
	});
	expect(finalize.status(), await finalize.text()).toBe(200);
	expect((await finalize.json()).success).toBe(true);

	const runs = await rows<{ status: string }>(
		`SELECT status FROM payroll_runs WHERE year = 2021 AND month = 1`
	);
	expect(runs.map((run) => run.status)).toEqual(['finalized']);

	const data = await readReport(clerk, CLOSE_MONTH);
	const slips = await rows<{ id: number; employer_cost: string }>(
		`SELECT ps.id, ps.employer_cost FROM payroll_slips ps
       JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month = ? AND e.employee_id = ?`,
		[CLOSE_MONTH_DAY, CLOSE_EMPLOYEE.code]
	);
	expect(slips).toHaveLength(1);
	// The recorded total is whatever Generate priced (the payroll
	// calculator's own composition, read back independently): the close
	// must freeze exactly that, never recompute it.
	const slipCost = Number(slips[0].employer_cost);
	expect(slipCost).toBeGreaterThan(0);
	expect(data.payroll.recorded_total).toBe(slipCost);
	evidence.janSlipId = slips[0].id;
	evidence.janSlipCost = slipCost;
});

test('records January consumption and settlement through the real controls', async () => {
	const consume = await clerk.post(CONSUME(CLOSE_ORDER.orderUid), {
		data: {
			cost_uid: CLOSE_SUPPLIER.costUid,
			recognized_period: CLOSE_MONTH_DAY,
			tax_basis: 'gross',
			expected_version: 1,
			expected_source_version: 1,
			source: 'invoice',
			reason: `${CLOSE_PREFIX} January consumption`,
			evidence_reference: `${CLOSE_PREFIX}-EVID-C1`,
		},
	});
	expect(consume.status(), await consume.text()).toBe(200);
	const consumeBody = (await consume.json()) as {
		success: boolean;
		data: { consumption: { id: number }; remainingCommitment: number };
	};
	expect(consumeBody.success).toBe(true);
	expect(consumeBody.data.remainingCommitment).toBe(WORTH.remainingCommitment);
	evidence.consumptionId = consumeBody.data.consumption.id;

	const settle = await clerk.post(SETTLEMENTS, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CLOSE_DIRECT.costUid,
			amount: WORTH.settlementJan,
			currency: 'INR',
			settled_on: `${CLOSE_MONTH}-28`,
			reference: `${CLOSE_PREFIX}-REF-1`,
			destination: CLOSE_PREFIX,
			evidence_reference: `${CLOSE_PREFIX}-EVID-SET-1`,
		},
	});
	expect(settle.status(), await settle.text()).toBe(201);
	const settleBody = (await settle.json()) as {
		success: boolean;
		data: { id: number; financial_version: number; settlement_uid: string };
	};
	expect(settleBody.success).toBe(true);
	expect(settleBody.data.financial_version).toBe(1);
	evidence.settlementId = settleBody.data.id;
});

test('reviews the complete January month: reconciled, no blockers', async () => {
	const { status, body } = await readClose(clerk, CLOSE_MONTH);
	expect(status).toBe(200);
	expect(body.success).toBe(true);
	const data = body.data as CloseData;
	expect(data.status).toBe('open');
	expect(data.financial_version).toBe(0);
	expect(data.review.can_close).toBe(true);
	expect(data.review.blockers).toEqual([]);

	// Company Incurred Cost equals its groups and the fixture arithmetic:
	// 28,000 direct cost plus the recorded payroll read back above.
	const janIncurred = WORTH.janDirect + (evidence.janSlipCost as number);
	const report = await readReport(clerk, CLOSE_MONTH);
	expect(report.company.incurred_cost).toBe(janIncurred);
	const groups = Object.fromEntries(
		report.groups.map((entry) => [entry.key, entry.amount])
	);
	expect(
		(groups.incurred_project_cost ?? 0) +
			(groups.company_overhead ?? 0) +
			(groups.unallocated_cost ?? 0)
	).toBe(janIncurred);
	const rowsByProject = Object.fromEntries(
		report.projects
			.filter((row) => row.currency === 'INR')
			.map((row) => [row.project_code, row.incurred_cost])
	);
	expect(rowsByProject['E2E-EXP-322-P1']).toBe(
		WORTH.janP1Direct + (evidence.janSlipCost as number)
	);
	expect(rowsByProject['E2E-EXP-322-P2']).toBe(WORTH.janP2);
	// The unpaid slip stays an unsettled cash target: disclosed, not blocking.
	expect(data.review.warnings.map((entry) => entry.code)).toContain(
		'cash_partial_coverage'
	);
	evidence.preClose = {
		incurred: report.company.incurred_cost,
		p1: rowsByProject['E2E-EXP-322-P1'],
		p2: rowsByProject['E2E-EXP-322-P2'],
	};
});

test('two competing closes create one coherent version', async () => {
	const payload = {
		month: CLOSE_MONTH,
		expected_version: 0,
		reason: `${CLOSE_PREFIX} January review complete`,
		evidence_reference: `${CLOSE_PREFIX}-EVID-CLOSE-1`,
	};
	const [first, second] = await Promise.all([
		clerk.post(CLOSE, { data: payload }),
		clerk.post(CLOSE, { data: payload }),
	]);
	const statuses = [first.status(), second.status()].sort();
	expect(statuses).toEqual([201, 409]);
	const winner = first.status() === 201 ? first : second;
	const loser = first.status() === 409 ? first : second;
	const won = (await winner.json()) as {
		success: boolean;
		data: { close_uid: string; financial_version: number; status: string };
	};
	expect(won.success).toBe(true);
	expect(won.data.status).toBe('closed');
	expect(won.data.financial_version).toBe(1);
	const lost = (await loser.json()) as { success: boolean; code: string };
	expect(lost.success).toBe(false);
	expect(lost.code).toBe('stale_version');
	evidence.closeUid = won.data.close_uid;

	const snapshots = await rows<{ close_uid: string }>(
		`SELECT close_uid FROM financial_close_snapshots
      WHERE month = ? AND isDelete = 0`,
		[CLOSE_MONTH]
	);
	expect(snapshots).toHaveLength(1);
	expect(snapshots[0].close_uid).toBe(won.data.close_uid);
});

test('the closed January snapshot preserves the frozen figures', async () => {
	const { body } = await readClose(clerk, CLOSE_MONTH);
	const data = body.data as CloseData;
	expect(data.status).toBe('closed');
	expect(data.financial_version).toBe(1);
	expect(data.close_uid).toBe(evidence.closeUid);
	expect(data.reviewed_by).toBe(seeded.clerkUserId);
	expect(data.review_reason).toBe(`${CLOSE_PREFIX} January review complete`);
	expect(data.snapshot).not.toBeNull();
	const snapshot = data.snapshot as {
		month: string;
		company: { incurred_cost: number | null };
		projects: Array<{ project_code: string; incurred_cost: number }>;
	};
	expect(snapshot.month).toBe(CLOSE_MONTH);
	expect(snapshot.company.incurred_cost).toBe(
		WORTH.janDirect + (evidence.janSlipCost as number)
	);

	// A repeat close with the read-back version returns the same row.
	const repeat = await clerk.post(CLOSE, {
		data: { month: CLOSE_MONTH, expected_version: 1 },
	});
	expect(repeat.status()).toBe(200);
	const repeatBody = (await repeat.json()) as {
		success: boolean;
		data: { close_uid: string };
	};
	expect(repeatBody.data.close_uid).toBe(evidence.closeUid);

	// The live report still states the frozen figures: nothing moved.
	const report = await readReport(clerk, CLOSE_MONTH);
	expect(report.company.incurred_cost).toBe(
		WORTH.janDirect + (evidence.janSlipCost as number)
	);
	evidence.frozen = { incurred: snapshot.company.incurred_cost };
});

test('closed January refuses cost, settlement, and accrual writes', async () => {
	const versions = await rows<{ id: number; financial_version: number }>(
		`SELECT id, financial_version FROM expenses WHERE expense_number = ?`,
		[CLOSE_DIRECT.expenseNumber]
	);
	expect(versions[0].financial_version).toBe(1);

	const update = await clerk.post(COMMANDS(seeded.expenseIds.d1), {
		data: {
			command: 'update',
			expected_version: 1,
			evidence_reference: `${CLOSE_PREFIX}-EVID-EDIT`,
		},
	});
	expect(update.status()).toBe(409);
	expect(((await update.json()) as { code: string }).code).toBe('month_closed');

	const record = await clerk.post('/api/admin/expenses', {
		data: {
			expense_number: `${CLOSE_PREFIX}-LATE`,
			expense_date: `${CLOSE_MONTH}-15`,
			category: 'E2E Close',
			amount: 100,
			currency: 'INR',
			cost_classification: 'company_overhead',
			service_period_start: `${CLOSE_MONTH}-15`,
			service_period_end: `${CLOSE_MONTH}-15`,
			bill_date: `${CLOSE_MONTH}-15`,
			vendor_name: CLOSE_PREFIX,
		},
	});
	expect(record.status()).toBe(409);
	expect(((await record.json()) as { code: string }).code).toBe('month_closed');

	const settle = await clerk.post(SETTLEMENTS, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CLOSE_DIRECT.costUid,
			amount: 100,
			currency: 'INR',
			settled_on: `${CLOSE_MONTH}-29`,
			reference: `${CLOSE_PREFIX}-REF-LATE`,
		},
	});
	expect(settle.status()).toBe(409);
	expect(((await settle.json()) as { code: string }).code).toBe('month_closed');

	const cancel = await clerk.post(
		SETTLEMENT_COMMANDS(evidence.settlementId as number),
		{
			data: {
				command: 'cancel',
				expected_version: 1,
				reason: `${CLOSE_PREFIX} late cancel`,
			},
		}
	);
	expect(cancel.status()).toBe(409);
	expect(((await cancel.json()) as { code: string }).code).toBe('month_closed');

	const accrue = await clerk.post(ACCRUAL_COMMANDS(seeded.accrualId), {
		data: {
			command: 'update',
			expected_version: 1,
			patch: { vendor_name: `${CLOSE_PREFIX} late` },
		},
	});
	expect(accrue.status()).toBe(409);
	expect(((await accrue.json()) as { code: string }).code).toBe('month_closed');

	// Nothing was written: versions unchanged, no new journal rows.
	const after = await rows<{ id: number; financial_version: number }>(
		`SELECT id, financial_version FROM expenses WHERE expense_number = ?`,
		[CLOSE_DIRECT.expenseNumber]
	);
	expect(after[0].financial_version).toBe(1);
	const journals = await rows<{ events: number }>(
		`SELECT COUNT(*) AS events FROM financial_cost_events WHERE cost_uid = ?`,
		[CLOSE_DIRECT.costUid]
	);
	expect(Number(journals[0].events)).toBe(1);
	const settlementRows = await rows<{ financial_version: number }>(
		`SELECT financial_version FROM financial_settlements WHERE id = ?`,
		[evidence.settlementId as number]
	);
	expect(settlementRows[0].financial_version).toBe(1);
});

test('closed January refuses allocation, consumption, and register writes', async () => {
	const history = await clerk.get(
		`${REVISIONS}?payroll_slip_id=${evidence.janSlipId as number}`
	);
	expect(history.ok()).toBe(true);
	const historyBody = (await history.json()) as {
		success: boolean;
		data: { selected_version: number };
	};
	expect(historyBody.data.selected_version).toBe(1);

	const revise = await clerk.post(REVISIONS, {
		data: {
			payroll_slip_id: evidence.janSlipId as number,
			expected_version: 1,
			reason: `${CLOSE_PREFIX} late revision`,
			evidence_reference: `${CLOSE_PREFIX}-EVID-REV`,
			lines: [{ project_id: seeded.projects.alpha, hours: 160 }],
		},
	});
	expect(revise.status()).toBe(409);
	expect(((await revise.json()) as { code: string }).code).toBe('month_closed');

	const release = await clerk.post(RELEASE(CLOSE_ORDER.orderUid), {
		data: {
			consumption_id: evidence.consumptionId as number,
			expected_version: 1,
			reason: `${CLOSE_PREFIX} late release`,
		},
	});
	expect(release.status()).toBe(409);
	expect(((await release.json()) as { code: string }).code).toBe(
		'month_closed'
	);

	const put = await clerk.put(`/api/admin/expenses/${seeded.expenseIds.d1}`, {
		data: { vendor_name: `${CLOSE_PREFIX} late vendor` },
	});
	expect(put.status()).toBe(409);
	expect(((await put.json()) as { code: string }).code).toBe('month_closed');

	const del = await clerk.delete(`/api/admin/expenses/${seeded.expenseIds.d1}`);
	expect(del.status()).toBe(409);
	expect(((await del.json()) as { code: string }).code).toBe('month_closed');

	const allocations = await rows<{ versions: number }>(
		`SELECT COUNT(*) AS versions FROM payroll_employee_allocations
      WHERE payroll_slip_id = ?`,
		[evidence.janSlipId as number]
	);
	expect(Number(allocations[0].versions)).toBe(1);
	const consumptions = await rows<{ state: string }>(
		`SELECT state FROM order_consumptions WHERE id = ?`,
		[evidence.consumptionId as number]
	);
	expect(consumptions[0].state).toBe('active');
});

test('finalizes February payroll without closing the month', async () => {
	const generate = await clerk.post('/api/payroll/generate', {
		data: { month: OPEN_MONTH_DAY, all: true },
	});
	expect(generate.status(), await generate.text()).toBe(200);
	const finalize = await clerk.post('/api/payroll/runs/finalize', {
		data: { month: OPEN_MONTH_DAY },
	});
	expect(finalize.status(), await finalize.text()).toBe(200);

	const data = await readReport(clerk, OPEN_MONTH);
	const slips = await rows<{ employer_cost: string }>(
		`SELECT ps.employer_cost FROM payroll_slips ps
       JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month = ? AND e.employee_id = ?`,
		[OPEN_MONTH_DAY, OPEN_EMPLOYEE.code]
	);
	expect(slips).toHaveLength(1);
	const slipCost = Number(slips[0].employer_cost);
	expect(slipCost).toBeGreaterThan(0);
	expect(data.payroll.recorded_total).toBe(slipCost);

	// Payroll finalization freezes attribution but leaves the month open:
	// supplier cost in the finalized month stays writable.
	const update = await clerk.post(COMMANDS(seeded.expenseIds.d3), {
		data: {
			command: 'update',
			expected_version: 1,
			evidence_reference: `${CLOSE_PREFIX}-EVID-D3`,
		},
	});
	expect(update.status(), await update.text()).toBe(200);

	const { body } = await readClose(clerk, OPEN_MONTH);
	expect((body.data as CloseData).status).toBe('open');
	evidence.febPayroll = data.payroll.recorded_total;
});

test('refuses to close incomplete February with its blockers', async () => {
	const response = await clerk.post(CLOSE, {
		data: {
			month: OPEN_MONTH,
			expected_version: 0,
			reason: `${CLOSE_PREFIX} premature close`,
		},
	});
	expect(response.status()).toBe(422);
	const body = (await response.json()) as {
		success: boolean;
		code: string;
		review: CloseReview;
	};
	expect(body.success).toBe(false);
	expect(body.code).toBe('close_blocked');
	expect(blockerCodes(body.review)).toContain('records_awaiting_recognition');
	expect(blockerCodes(body.review)).toContain('currency_conversion_missing');

	const snapshots = await rows<{ month: string }>(
		`SELECT month FROM financial_close_snapshots
      WHERE month = ? AND isDelete = 0`,
		[OPEN_MONTH]
	);
	expect(snapshots).toHaveLength(0);
	evidence.febBlockers = blockerCodes(body.review);
});

test('refuses to close the empty March month', async () => {
	const response = await clerk.post(CLOSE, {
		data: { month: EMPTY_MONTH, expected_version: 0 },
	});
	expect(response.status()).toBe(422);
	const body = (await response.json()) as {
		success: boolean;
		code: string;
		review: CloseReview;
	};
	expect(body.success).toBe(false);
	expect(body.code).toBe('close_blocked');
	// An empty store is not proof of zero expenditure.
	expect(blockerCodes(body.review)).toContain('no_recognized_cost');
});

test('outsider gets no close access and changes nothing', async () => {
	const get = await outsider.get(`${CLOSE}?month=${CLOSE_MONTH}`);
	expect(get.status()).toBe(403);
	const post = await outsider.post(CLOSE, {
		data: { month: OPEN_MONTH, expected_version: 0 },
	});
	expect(post.status()).toBe(403);

	const snapshots = await rows<{ month: string }>(
		`SELECT month FROM financial_close_snapshots WHERE isDelete = 0`
	);
	expect(snapshots.map((row) => row.month)).toEqual([CLOSE_MONTH]);
});

test('browser shows the close review and the frozen January figures', async ({
	page,
}) => {
	await openExpenditure(page, 'January 2021');
	await expect(page.getByTestId('financial-close-section')).toBeVisible();
	await expect(page.getByTestId('financial-close-status')).toContainText(
		'Closed'
	);
	await expect(page.getByTestId('financial-close-totals')).toBeVisible();
	await expect(page.getByTestId('financial-close-history')).toContainText(
		String(evidence.closeUid)
	);

	await openExpenditure(page, 'February 2021');
	await expect(page.getByTestId('financial-close-section')).toBeVisible();
	await expect(page.getByTestId('financial-close-status')).toContainText(
		'Open'
	);
	await expect(page.getByTestId('financial-close-blockers')).toContainText(
		'records_awaiting_recognition'
	);
});
