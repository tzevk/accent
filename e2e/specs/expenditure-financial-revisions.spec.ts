/**
 * Ticket #323 — revise closed financial costs.
 *
 * Everything here is stated from the fixture literals and the business
 * rules, never from the report module's own aggregation: the fixtures say
 * what each cost, slip, settlement, and consumption is worth, this file says
 * what the revision workflow must therefore state, and the assertions
 * compare the app's answer with that arithmetic. The API drives payroll
 * generate/finalize, the consumption and settlement commands, the close,
 * and the revisions; the browser drives the report revision control; and
 * the database is read back independently.
 *
 * The namespace and the months (2021-04, the complete month this spec
 * closes and then revises, and 2021-05, the open month whose draft blocks
 * its close and whose costs stay writable through the ordinary path)
 * belong to this spec alone (`e2e/lib/expenditure-revision-fixtures.ts`).
 * Every company assertion here is a before/after of this spec's own rows
 * and never an absolute over another namespace.
 */

import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { rows } from '../lib/db';
import { writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import {
	REVISION_ACCRUAL,
	REVISION_CLERK,
	REVISION_DIRECT,
	REVISION_DIRECT_MOVE,
	REVISION_EMPLOYEE,
	REVISION_MONTH,
	REVISION_MONTH_DAY,
	REVISION_OPEN_DRAFT,
	REVISION_OPEN_MONTH,
	REVISION_OPEN_MONTH_DAY,
	REVISION_ORDER,
	REVISION_OUTSIDER,
	REVISION_PREFIX,
	REVISION_PROJECTS,
	REVISION_SPEC_IP,
	REVISION_SUPPLIER,
	cleanupFinancialRevisionFixtures,
	loginFinancialRevisionUser,
	seedFinancialRevisionFixtures,
	type SeededFinancialRevision,
} from '../lib/expenditure-revision-fixtures';

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity, set through the proxy's trusted
	// header (ADR-0013), so a combined run cannot exhaust the shared budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': REVISION_SPEC_IP },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const CLOSE = '/api/admin/expenditure-close';
const REVISIONS = '/api/admin/expenditure-revisions';
const COMMANDS = (id: number) => `/api/admin/expenses/${id}/commands`;
const SETTLEMENTS = '/api/admin/expenditure-settlements';
const CONSUME = (uid: string) =>
	`/api/admin/orders/${encodeURIComponent(uid)}/consumption`;
const ALLOCATION_REVISIONS =
	'/api/reports/employee-project-monthly-cost/payroll/revisions';
const REPORT = '/api/reports/employee-project-monthly-cost';

/** Independently stated fixture worth, from the fixture literals. */
const WORTH = {
	directApr: 12000,
	movedApr: 4000,
	supplierApr: 10000,
	accrualApr: 6000,
	aprDirect: 32000,
	orderValue: 20000,
	consumedApr: 10000,
	remainingCommitment: 10000,
	settlementApr: 12000,
} as const;

type RevisionFigures = {
	amount: number | null;
	currency: string | null;
	classification: string | null;
	period: string | null;
	state: string | null;
	project_code: string | null;
	project_name: string | null;
};

type RevisionData = {
	revision_uid: string;
	month: string;
	close_uid: string;
	close_version: number;
	target_kind: string;
	target_uid: string;
	command: string;
	prior_version: number;
	new_version: number;
	prior_figures: RevisionFigures;
	new_figures: RevisionFigures;
	repeated?: boolean;
	consumptions?: Array<{ consumption_id: number; action: string }>;
};

type HistoryEntry = {
	revision_uid: string;
	command: string;
	target_kind: string;
	target_uid: string;
	target_label: string | null;
	prior_version: number;
	new_version: number;
	close_version: number;
	reason: string | null;
	evidence_reference: string | null;
	actor_user_id: number | null;
	created_at: string;
	prior_figures: RevisionFigures;
	new_figures: RevisionFigures;
};

type RevisionHistory = {
	month: string;
	status: 'open' | 'closed';
	close_uid: string | null;
	close_version: number;
	prior: { incurred_cost: number | null; currency: string | null };
	current: { incurred_cost: number | null; currency: string | null };
	candidates: Array<{
		kind: string;
		id: number;
		uid: string;
		number: string;
		amount: number | null;
		currency: string | null;
		classification: string | null;
		period: string | null;
		state: string;
		version: number;
		project_code: string | null;
		project_name: string | null;
	}>;
	revisions: HistoryEntry[];
};

let seeded: SeededFinancialRevision;
let clerk: APIRequestContext;
let outsider: APIRequestContext;
const outcome = trackArtifactOutcome();
const evidence: Record<string, unknown> = {};

async function readHistory(
	ctx: APIRequestContext,
	month: string
): Promise<{
	status: number;
	body: { success: boolean; data?: RevisionHistory };
}> {
	const response = await ctx.get(`${REVISIONS}?month=${month}`);
	const body = (await response.json()) as {
		success: boolean;
		data?: RevisionHistory;
	};
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
		groups: Array<{ key: string; amount: number }>;
	};
	projects: Array<{
		project_code: string | null;
		currency: string;
		incurred_cost: number;
	}>;
	project_options: Array<{ project_id: number; project_code: string }>;
	payroll: { recorded_total: number; estimated_total: number };
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
				groups: Array<{ key: string; amount: number }>;
			};
			projects: Array<{
				project_code: string | null;
				currency: string;
				incurred_cost: number;
			}>;
			project_options: Array<{ project_id: number; project_code: string }>;
			payroll: { recorded_total: number; estimated_total: number };
		};
	};
	expect(body.success).toBe(true);
	return body.data;
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
	seeded = await seedFinancialRevisionFixtures();
});

test.afterAll(async () => {
	writeArtifact('expenditure-financial-revisions', {
		ok: outcome.ok,
		...evidence,
	});
	await cleanupFinancialRevisionFixtures();
});

test('clerk and outsider sign in through the real login', async ({
	playwright,
	baseURL,
}) => {
	if (!baseURL) {
		throw new Error('The E2E run is missing its configured baseURL');
	}
	clerk = await loginFinancialRevisionUser(playwright, baseURL, 'clerk');
	outsider = await loginFinancialRevisionUser(playwright, baseURL, 'outsider');
	evidence.identities = {
		clerk: REVISION_CLERK.username,
		outsider: REVISION_OUTSIDER.username,
	};
});

test('generates and finalizes April payroll through the real payroll flow', async () => {
	const generate = await clerk.post('/api/payroll/generate', {
		data: { month: REVISION_MONTH_DAY, all: true },
	});
	expect(generate.status(), await generate.text()).toBe(200);
	const finalize = await clerk.post('/api/payroll/runs/finalize', {
		data: { month: REVISION_MONTH_DAY },
	});
	expect(finalize.status(), await finalize.text()).toBe(200);
	expect((await finalize.json()).success).toBe(true);

	const runs = await rows<{ status: string }>(
		`SELECT status FROM payroll_runs WHERE year = 2021 AND month = 4`
	);
	expect(runs.map((run) => run.status)).toEqual(['finalized']);

	const slips = await rows<{ id: number; employer_cost: string }>(
		`SELECT ps.id, ps.employer_cost FROM payroll_slips ps
       JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month = ? AND e.employee_id = ?`,
		[REVISION_MONTH_DAY, REVISION_EMPLOYEE.code]
	);
	expect(slips).toHaveLength(1);
	// The recorded total is whatever Generate priced (the payroll
	// calculator's own composition, read back independently).
	const slipCost = Number(slips[0].employer_cost);
	expect(slipCost).toBeGreaterThan(0);
	const data = await readReport(clerk, REVISION_MONTH);
	expect(data.payroll.recorded_total).toBe(slipCost);
	evidence.aprSlipId = slips[0].id;
	evidence.aprSlipCost = slipCost;
});

test('records April consumption and settlement through the real controls', async () => {
	const consume = await clerk.post(CONSUME(REVISION_ORDER.orderUid), {
		data: {
			cost_uid: REVISION_SUPPLIER.costUid,
			recognized_period: REVISION_MONTH_DAY,
			tax_basis: 'gross',
			expected_version: 1,
			expected_source_version: 1,
			source: 'invoice',
			reason: `${REVISION_PREFIX} April consumption`,
			evidence_reference: `${REVISION_PREFIX}-EVID-C1`,
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
			target_cost_uid: REVISION_DIRECT.costUid,
			amount: WORTH.settlementApr,
			currency: 'INR',
			settled_on: `${REVISION_MONTH}-28`,
			reference: `${REVISION_PREFIX}-REF-1`,
			destination: REVISION_PREFIX,
			evidence_reference: `${REVISION_PREFIX}-EVID-SET-1`,
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
	evidence.settlementUid = settleBody.data.settlement_uid;
});

test('closes April and refuses the open May month', async () => {
	const close = await clerk.post(CLOSE, {
		data: {
			month: REVISION_MONTH,
			expected_version: 0,
			reason: `${REVISION_PREFIX} April review complete`,
			evidence_reference: `${REVISION_PREFIX}-EVID-CLOSE-1`,
		},
	});
	expect(close.status(), await close.text()).toBe(201);
	const closeBody = (await close.json()) as {
		success: boolean;
		data: { close_uid: string; financial_version: number; status: string };
	};
	expect(closeBody.success).toBe(true);
	expect(closeBody.data.status).toBe('closed');
	expect(closeBody.data.financial_version).toBe(1);
	evidence.closeUid = closeBody.data.close_uid;

	// April incurred is the fixture arithmetic plus recorded payroll.
	const report = await readReport(clerk, REVISION_MONTH);
	expect(report.company.incurred_cost).toBe(
		WORTH.aprDirect + (evidence.aprSlipCost as number)
	);
	evidence.preRevision = { incurred: report.company.incurred_cost };

	// May stays open: its draft cost blocks the close.
	const may = await clerk.post(CLOSE, {
		data: { month: REVISION_OPEN_MONTH, expected_version: 0 },
	});
	expect(may.status()).toBe(422);
	expect(((await may.json()) as { code: string }).code).toBe('close_blocked');

	// The closed month refuses the ordinary command path: corrections must
	// travel through the revision workflow.
	const update = await clerk.post(COMMANDS(seeded.expenseIds.d1), {
		data: {
			command: 'update',
			expected_version: 1,
			patch: { grossAmount: 10500 },
		},
	});
	expect(update.status()).toBe(409);
	expect(((await update.json()) as { code: string }).code).toBe('month_closed');
});

test('revises the closed direct cost amount with reason and evidence', async () => {
	const revision = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'direct',
			id: seeded.expenseIds.d1,
			command: 'update',
			expected_version: 1,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} invoice corrected by vendor`,
			evidence_reference: `${REVISION_PREFIX}-EVID-R1`,
			patch: { grossAmount: 10500 },
			revision_uid: `${REVISION_PREFIX}-R1`,
		},
	});
	expect(revision.status(), await revision.text()).toBe(201);
	const body = (await revision.json()) as {
		success: boolean;
		data: RevisionData;
	};
	expect(body.success).toBe(true);
	const data = body.data;
	expect(data.revision_uid).toBe(`${REVISION_PREFIX}-R1`);
	expect(data.month).toBe(REVISION_MONTH);
	expect(data.close_uid).toBe(evidence.closeUid);
	expect(data.close_version).toBe(1);
	expect(data.command).toBe('updated');
	expect(data.prior_version).toBe(1);
	expect(data.new_version).toBe(2);
	// Old and new figures are both preserved on the revision.
	expect(data.prior_figures.amount).toBe(WORTH.directApr);
	expect(data.new_figures.amount).toBe(10500);
	expect(data.prior_figures.classification).toBe('project');
	expect(data.new_figures.classification).toBe('project');
	expect(data.prior_figures.period).toBe(REVISION_MONTH_DAY);
	expect(data.new_figures.period).toBe(REVISION_MONTH_DAY);
	expect(data.prior_figures.project_code).toBe(REVISION_PROJECTS.alpha.code);

	// The row moved on; its journal gained exactly one revision row.
	const expenseRows = await rows<{
		financial_version: number;
		total_amount: string;
		recognized_amount: string;
	}>(
		`SELECT financial_version, total_amount, recognized_amount FROM expenses
      WHERE expense_number = ?`,
		[REVISION_DIRECT.expenseNumber]
	);
	expect(expenseRows[0].financial_version).toBe(2);
	expect(Number(expenseRows[0].total_amount)).toBe(10500);
	expect(Number(expenseRows[0].recognized_amount)).toBe(10500);
	const journals = await rows<{
		version: number;
		command: string;
		reason: string | null;
	}>(
		`SELECT version, command, reason FROM financial_cost_events
      WHERE cost_uid = ? ORDER BY version`,
		[REVISION_DIRECT.costUid]
	);
	expect(journals.map((entry) => entry.version)).toEqual([1, 2]);
	expect(journals[1].command).toBe('updated');
	expect(journals[1].reason).toBe(
		`${REVISION_PREFIX} invoice corrected by vendor`
	);
	const headers = await rows<{ revision_uid: string; command: string }>(
		`SELECT revision_uid, command FROM financial_revision_events
      WHERE target_uid = ? ORDER BY new_version`,
		[REVISION_DIRECT.costUid]
	);
	expect(headers).toHaveLength(1);
	expect(headers[0].revision_uid).toBe(`${REVISION_PREFIX}-R1`);

	// The reconciliation recalculates; the frozen snapshot does not move.
	const report = await readReport(clerk, REVISION_MONTH);
	expect(report.company.incurred_cost).toBe(
		WORTH.aprDirect - 1500 + (evidence.aprSlipCost as number)
	);
	const close = await clerk.get(`${CLOSE}?month=${REVISION_MONTH}`);
	const closeBody = (await close.json()) as {
		success: boolean;
		data: { snapshot: { company: { incurred_cost: number } } };
	};
	expect(closeBody.data.snapshot.company.incurred_cost).toBe(
		WORTH.aprDirect + (evidence.aprSlipCost as number)
	);
	evidence.afterR1 = { incurred: report.company.incurred_cost };
});

test('reclassifies the closed accrual without changing the total', async () => {
	const revision = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'accrual',
			id: seeded.accrualId,
			command: 'update',
			expected_version: 1,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} shared service, not project work`,
			evidence_reference: `${REVISION_PREFIX}-EVID-R2`,
			patch: { costClassification: 'company_overhead', projectId: null },
		},
	});
	expect(revision.status(), await revision.text()).toBe(201);
	const data = (
		(await revision.json()) as { success: boolean; data: RevisionData }
	).data;
	expect(data.prior_figures.classification).toBe('project');
	expect(data.new_figures.classification).toBe('company_overhead');
	expect(data.new_figures.amount).toBe(WORTH.accrualApr);

	const report = await readReport(clerk, REVISION_MONTH);
	const groups = Object.fromEntries(
		report.company.groups.map((entry) => [entry.key, entry.amount])
	);
	// The total is unchanged; 6,000 moved from Project cost to Overhead.
	expect(report.company.incurred_cost).toBe(
		(evidence.afterR1 as { incurred: number }).incurred
	);
	expect(groups.company_overhead).toBe(WORTH.accrualApr);
});

test('moves the closed direct cost into the open month', async () => {
	const revision = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'direct',
			id: seeded.expenseIds.d4,
			command: 'update',
			expected_version: 1,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} work received in May`,
			evidence_reference: `${REVISION_PREFIX}-EVID-R3`,
			patch: {
				servicePeriodStart: '2021-05-10',
				servicePeriodEnd: '2021-05-12',
				billDate: '2021-05-13',
			},
		},
	});
	expect(revision.status(), await revision.text()).toBe(201);
	const data = (
		(await revision.json()) as { success: boolean; data: RevisionData }
	).data;
	expect(data.prior_figures.period).toBe(REVISION_MONTH_DAY);
	expect(data.new_figures.period).toBe(REVISION_OPEN_MONTH_DAY);

	const april = await readReport(clerk, REVISION_MONTH);
	expect(april.company.incurred_cost).toBe(
		((evidence.afterR1 as { incurred: number }).incurred as number) -
			WORTH.movedApr
	);
	const may = await readReport(clerk, REVISION_OPEN_MONTH);
	// May holds the moved cost (the draft is unconfirmed, never incurred).
	expect(may.company.incurred_cost).toBe(WORTH.movedApr);
	evidence.afterR3 = { april: april.company.incurred_cost };
});

test('revises the consumed supplier invoice and carries its consumption', async () => {
	const revision = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'supplier',
			id: seeded.invoiceId,
			command: 'update',
			expected_version: 1,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} invoice line corrected`,
			evidence_reference: `${REVISION_PREFIX}-EVID-R4`,
			patch: { grossAmount: 8000 },
		},
	});
	expect(revision.status(), await revision.text()).toBe(201);
	const data = (
		(await revision.json()) as { success: boolean; data: RevisionData }
	).data;
	expect(data.prior_figures.amount).toBe(WORTH.supplierApr);
	expect(data.new_figures.amount).toBe(8000);

	// The linked consumption follows the revised slice: the original row
	// is released and a carried row states the corrected amount with the
	// new source version — release + re-record, so both acts stay in
	// history and the remaining commitment restates coherently.
	const consumptions = await rows<{
		amount: string;
		source_version: number;
		state: string;
		version: number;
	}>(
		`SELECT amount, source_version, state, version FROM order_consumptions
      WHERE cost_uid = ?
      ORDER BY id`,
		[REVISION_SUPPLIER.costUid]
	);
	expect(consumptions).toHaveLength(2);
	expect(Number(consumptions[0].amount)).toBe(WORTH.supplierApr);
	expect(consumptions[0].state).toBe('released');
	expect(Number(consumptions[1].amount)).toBe(8000);
	expect(consumptions[1].source_version).toBe(2);
	expect(consumptions[1].state).toBe('active');
	const events = await rows<{ event: string; version: number }>(
		`SELECT event, version FROM order_consumption_events
      WHERE cost_uid = ? ORDER BY id`,
		[REVISION_SUPPLIER.costUid]
	);
	expect(events.map((entry) => entry.event)).toEqual([
		'recorded',
		'released',
		'recorded',
	]);

	const april = await readReport(clerk, REVISION_MONTH);
	expect(april.company.incurred_cost).toBe(
		((evidence.afterR3 as { april: number }).april as number) - 2000
	);
	evidence.afterR4 = { april: april.company.incurred_cost };
});

test('cancels the closed accrual through an explicit revision', async () => {
	const revision = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'accrual',
			id: seeded.accrualId,
			command: 'cancel',
			expected_version: 2,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} duplicate accrual, never received`,
			evidence_reference: `${REVISION_PREFIX}-EVID-R5`,
		},
	});
	expect(revision.status(), await revision.text()).toBe(201);
	const data = (
		(await revision.json()) as { success: boolean; data: RevisionData }
	).data;
	expect(data.command).toBe('cancelled');
	expect(data.prior_version).toBe(2);
	expect(data.new_version).toBe(3);
	expect(data.new_figures.state).toBe('cancelled');

	// The row and its history stay: cancellation never erases the
	// historical contribution.
	const accrualRows = await rows<{
		recognition_state: string;
		financial_version: number;
		gross_amount: string;
	}>(
		`SELECT recognition_state, financial_version, gross_amount FROM cost_accruals
      WHERE accrual_number = ? AND isDelete = 0`,
		[REVISION_ACCRUAL.accrualNumber]
	);
	expect(accrualRows).toHaveLength(1);
	expect(accrualRows[0].recognition_state).toBe('cancelled');
	expect(Number(accrualRows[0].gross_amount)).toBe(WORTH.accrualApr);

	const april = await readReport(clerk, REVISION_MONTH);
	expect(april.company.incurred_cost).toBe(
		((evidence.afterR4 as { april: number }).april as number) - WORTH.accrualApr
	);
	evidence.afterR5 = { april: april.company.incurred_cost };
});

test('cancels the consumed supplier invoice and releases its consumption', async () => {
	const revision = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'supplier',
			id: seeded.invoiceId,
			command: 'cancel',
			expected_version: 2,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} invoice voided by supplier`,
			evidence_reference: `${REVISION_PREFIX}-EVID-R6`,
		},
	});
	expect(revision.status(), await revision.text()).toBe(201);
	const data = (
		(await revision.json()) as { success: boolean; data: RevisionData }
	).data;
	expect(data.command).toBe('cancelled');
	expect(data.new_figures.state).toBe('cancelled');

	// Cancelling the cost releases its commitment consumption in the same
	// revision: the estimate returns to the commitment, documented.
	const consumptions = await rows<{ state: string }>(
		`SELECT state FROM order_consumptions WHERE cost_uid = ? ORDER BY id`,
		[REVISION_SUPPLIER.costUid]
	);
	expect(consumptions.map((entry) => entry.state)).toEqual([
		'released',
		'released',
	]);

	const april = await readReport(clerk, REVISION_MONTH);
	expect(april.company.incurred_cost).toBe(
		((evidence.afterR5 as { april: number }).april as number) - 8000
	);
	evidence.afterR6 = { april: april.company.incurred_cost };
});

test('revises the closed settlement amount through its version journal', async () => {
	const revision = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'settlement',
			id: evidence.settlementId as number,
			command: 'update',
			expected_version: 1,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} bank fee deducted`,
			evidence_reference: `${REVISION_PREFIX}-EVID-R7`,
			patch: {
				amount: 10500,
				evidenceReference: `${REVISION_PREFIX}-EVID-SET-2`,
			},
		},
	});
	expect(revision.status(), await revision.text()).toBe(201);
	const data = (
		(await revision.json()) as { success: boolean; data: RevisionData }
	).data;
	expect(data.prior_figures.amount).toBe(WORTH.settlementApr);
	expect(data.new_figures.amount).toBe(10500);

	const journals = await rows<{ version: number; command: string }>(
		`SELECT version, command FROM financial_settlement_events
      WHERE settlement_uid = ? ORDER BY version`,
		[evidence.settlementUid as string]
	);
	expect(journals.map((entry) => entry.version)).toEqual([1, 2]);
	expect(journals[1].command).toBe('updated');
	const settlementRows = await rows<{
		financial_version: number;
		amount: string;
	}>(
		`SELECT financial_version, amount FROM financial_settlements WHERE id = ?`,
		[evidence.settlementId as number]
	);
	expect(settlementRows[0].financial_version).toBe(2);
	expect(Number(settlementRows[0].amount)).toBe(10500);
});

test('retains frozen identities when masters are renamed or soft-deleted', async () => {
	await rows(`UPDATE projects SET project_title = ? WHERE project_code = ?`, [
		'E2E Revision Alpha Renamed',
		REVISION_PROJECTS.alpha.code,
	]);
	await rows(`UPDATE projects SET isDelete = 1 WHERE project_code = ?`, [
		REVISION_PROJECTS.beta.code,
	]);

	// The frozen snapshot keeps the identities the month closed with.
	const close = await clerk.get(`${CLOSE}?month=${REVISION_MONTH}`);
	const closeBody = (await close.json()) as {
		success: boolean;
		data: {
			snapshot: {
				projects: Array<{
					project_code: string;
					project_name: string;
					incurred_cost: number;
				}>;
			};
		};
	};
	const frozen = Object.fromEntries(
		closeBody.data.snapshot.projects.map((row) => [row.project_code, row])
	);
	expect(frozen[REVISION_PROJECTS.alpha.code].project_name).toBe(
		REVISION_PROJECTS.alpha.title
	);
	expect(frozen[REVISION_PROJECTS.beta.code].project_name).toBe(
		REVISION_PROJECTS.beta.title
	);
	expect(frozen[REVISION_PROJECTS.beta.code].incurred_cost).toBe(
		WORTH.supplierApr
	);

	// The revision history keeps the labels captured at revision time,
	// reconstructed from stored snapshots rather than live masters.
	const { body } = await readHistory(clerk, REVISION_MONTH);
	const supplierRevisions = (body.data?.revisions ?? []).filter(
		(entry) => entry.target_uid === REVISION_SUPPLIER.costUid
	);
	expect(supplierRevisions.length).toBeGreaterThan(0);
	for (const entry of supplierRevisions) {
		expect(entry.prior_figures.project_code).toBe(REVISION_PROJECTS.beta.code);
		expect(entry.prior_figures.project_name).toBe(REVISION_PROJECTS.beta.title);
	}

	// The live report still answers with unchanged company figures, while
	// open operational reads drop the deleted project.
	const april = await readReport(clerk, REVISION_MONTH);
	expect(april.company.incurred_cost).toBe(
		(evidence.afterR6 as { april: number }).april
	);
	expect(
		april.project_options.map((option) => option.project_code)
	).not.toContain(REVISION_PROJECTS.beta.code);
});

test('routes payroll corrections to the allocation contract, never the slip', async () => {
	const revision = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'allocation',
			id: evidence.aprSlipId as number,
			command: 'update',
			expected_version: 1,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} attribution fix`,
			evidence_reference: `${REVISION_PREFIX}-EVID-PAY`,
			patch: {},
		},
	});
	expect(revision.status()).toBe(422);
	expect(((await revision.json()) as { code: string }).code).toBe(
		'use_allocation_revision'
	);

	// The allocation contract itself still refuses the closed month, and the
	// slip keeps its recorded employer cost.
	const revise = await clerk.post(ALLOCATION_REVISIONS, {
		data: {
			payroll_slip_id: evidence.aprSlipId as number,
			expected_version: 1,
			reason: `${REVISION_PREFIX} late attribution`,
			evidence_reference: `${REVISION_PREFIX}-EVID-ALLOC`,
			lines: [{ project_id: seeded.projects.alpha, hours: 120 }],
		},
	});
	expect(revise.status()).toBe(409);
	expect(((await revise.json()) as { code: string }).code).toBe('month_closed');

	const slips = await rows<{ employer_cost: string }>(
		`SELECT employer_cost FROM payroll_slips WHERE id = ?`,
		[evidence.aprSlipId as number]
	);
	expect(Number(slips[0].employer_cost)).toBe(evidence.aprSlipCost);
	const allocations = await rows<{ versions: number }>(
		`SELECT COUNT(*) AS versions FROM payroll_employee_allocations
      WHERE payroll_slip_id = ?`,
		[evidence.aprSlipId as number]
	);
	expect(Number(allocations[0].versions)).toBe(1);
});

test('refuses open-month, stale, repeated, and invalid revisions safely', async () => {
	// An open cost is corrected through the ordinary path, not a revision.
	const openRevision = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'direct',
			id: seeded.expenseIds.d5,
			command: 'update',
			expected_version: 1,
			target_close_version: 0,
			reason: `${REVISION_PREFIX} open correction`,
			evidence_reference: `${REVISION_PREFIX}-EVID-OPEN`,
			patch: { grossAmount: 4500 },
		},
	});
	expect(openRevision.status()).toBe(422);
	expect(((await openRevision.json()) as { code: string }).code).toBe(
		'revision_not_required'
	);
	const ordinary = await clerk.post(COMMANDS(seeded.expenseIds.d5), {
		data: {
			command: 'update',
			expected_version: 1,
			patch: { evidenceReference: `${REVISION_PREFIX}-EVID-D5` },
		},
	});
	expect(ordinary.status(), await ordinary.text()).toBe(200);

	// A stale version changes nothing.
	const stale = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'direct',
			id: seeded.expenseIds.d1,
			command: 'update',
			expected_version: 1,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} stale attempt`,
			evidence_reference: `${REVISION_PREFIX}-EVID-STALE`,
			patch: { grossAmount: 9000 },
		},
	});
	expect(stale.status()).toBe(409);
	expect(((await stale.json()) as { code: string }).code).toBe(
		'version_conflict'
	);

	// A repeated revision key returns the existing result, not a duplicate.
	const repeat = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'direct',
			id: seeded.expenseIds.d1,
			command: 'update',
			expected_version: 1,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} invoice corrected by vendor`,
			evidence_reference: `${REVISION_PREFIX}-EVID-R1`,
			patch: { grossAmount: 10500 },
			revision_uid: `${REVISION_PREFIX}-R1`,
		},
	});
	expect(repeat.status()).toBe(200);
	const repeatBody = (await repeat.json()) as {
		success: boolean;
		data: RevisionData;
	};
	expect(repeatBody.data.revision_uid).toBe(`${REVISION_PREFIX}-R1`);
	expect(repeatBody.data.new_version).toBe(2);
	const headers = await rows<{ revisions: number }>(
		`SELECT COUNT(*) AS revisions FROM financial_revision_events
      WHERE revision_uid = ?`,
		[`${REVISION_PREFIX}-R1`]
	);
	expect(Number(headers[0].revisions)).toBe(1);

	// Reason and evidence are mandatory; the closed version must match.
	for (const payload of [
		{ reason: '', evidence_reference: `${REVISION_PREFIX}-EVID-X` },
		{ reason: `${REVISION_PREFIX} no evidence`, evidence_reference: '' },
	]) {
		const invalid = await clerk.post(REVISIONS, {
			data: {
				target_kind: 'direct',
				id: seeded.expenseIds.d1,
				command: 'update',
				expected_version: 2,
				target_close_version: 1,
				reason: payload.reason,
				evidence_reference: payload.evidence_reference,
				patch: { grossAmount: 9500 },
			},
		});
		expect(invalid.status()).toBe(422);
	}
	const wrongClose = await clerk.post(REVISIONS, {
		data: {
			target_kind: 'direct',
			id: seeded.expenseIds.d1,
			command: 'update',
			expected_version: 2,
			target_close_version: 7,
			reason: `${REVISION_PREFIX} wrong close`,
			evidence_reference: `${REVISION_PREFIX}-EVID-X`,
			patch: { grossAmount: 9500 },
		},
	});
	expect(wrongClose.status()).toBe(409);

	// Two competing revisions create one coherent version.
	const racerA = clerk.post(REVISIONS, {
		data: {
			target_kind: 'direct',
			id: seeded.expenseIds.d1,
			command: 'update',
			expected_version: 2,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} racer A`,
			evidence_reference: `${REVISION_PREFIX}-EVID-RA`,
			patch: { sourceReference: `${REVISION_PREFIX}-SRC-RA` },
		},
	});
	const racerB = clerk.post(REVISIONS, {
		data: {
			target_kind: 'direct',
			id: seeded.expenseIds.d1,
			command: 'update',
			expected_version: 2,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} racer B`,
			evidence_reference: `${REVISION_PREFIX}-EVID-RB`,
			patch: { sourceReference: `${REVISION_PREFIX}-SRC-RB` },
		},
	});
	const [first, second] = await Promise.all([racerA, racerB]);
	const statuses = [first.status(), second.status()].sort();
	expect(statuses).toEqual([201, 409]);
	const winner = first.status() === 201 ? first : second;
	const won = (
		(await winner.json()) as { success: boolean; data: RevisionData }
	).data;
	expect(won.new_version).toBe(3);
	evidence.raceWinner = won.revision_uid;

	// Deletion of closed cost stays refused: removal needs a revision.
	const del = await clerk.delete(`/api/admin/expenses/${seeded.expenseIds.d1}`);
	expect(del.status()).toBe(409);
	expect(((await del.json()) as { code: string }).code).toBe('month_closed');
});

test('outsider gets no revision access and changes nothing', async () => {
	const get = await outsider.get(`${REVISIONS}?month=${REVISION_MONTH}`);
	expect(get.status()).toBe(403);
	const post = await outsider.post(REVISIONS, {
		data: {
			target_kind: 'direct',
			id: seeded.expenseIds.d1,
			command: 'update',
			expected_version: 3,
			target_close_version: 1,
			reason: `${REVISION_PREFIX} outsider attempt`,
			evidence_reference: `${REVISION_PREFIX}-EVID-OUT`,
			patch: { grossAmount: 1 },
		},
	});
	expect(post.status()).toBe(403);

	const expenseRows = await rows<{ financial_version: number }>(
		`SELECT financial_version FROM expenses WHERE expense_number = ?`,
		[REVISION_DIRECT.expenseNumber]
	);
	expect(expenseRows[0].financial_version).toBe(3);
});

test('selected-version history exposes reasons, prior and updated totals', async () => {
	const { status, body } = await readHistory(clerk, REVISION_MONTH);
	expect(status).toBe(200);
	expect(body.success).toBe(true);
	const data = body.data as RevisionHistory;
	expect(data.status).toBe('closed');
	expect(data.close_uid).toBe(evidence.closeUid);
	expect(data.close_version).toBe(1);
	// Prior totals are the frozen snapshot; updated totals are the live
	// reconciliation after every revision above.
	expect(data.prior.incurred_cost).toBe(
		WORTH.aprDirect + (evidence.aprSlipCost as number)
	);
	expect(data.current.incurred_cost).toBe(
		10500 + (evidence.aprSlipCost as number)
	);
	// Every accepted revision states its reason, actor, timestamp, and both
	// figures; the losing racer wrote nothing.
	const reasons = data.revisions.map((entry) => entry.reason);
	expect(reasons).toContain(`${REVISION_PREFIX} invoice corrected by vendor`);
	expect(reasons).toContain(`${REVISION_PREFIX} invoice voided by supplier`);
	expect(data.revisions.length).toBeGreaterThanOrEqual(7);
	for (const entry of data.revisions) {
		expect(entry.actor_user_id).toBe(seeded.clerkUserId);
		expect(entry.created_at).not.toBe('');
		expect(entry.prior_figures.amount).not.toBeNull();
	}
	evidence.revisionCount = data.revisions.length;
});

test('browser revises a closed cost through the report control', async ({
	page,
}) => {
	await openExpenditure(page, 'April 2021');
	await expect(page.getByTestId('financial-revision-section')).toBeVisible();
	await expect(page.getByTestId('financial-revision-status')).toContainText(
		'Closed'
	);
	await expect(page.getByTestId('financial-revision-totals')).toContainText(
		String(evidence.closeUid)
	);

	await page.getByTestId('financial-revision-target').selectOption({
		label: `${REVISION_DIRECT.expenseNumber} — 10500 INR (project)`,
	});
	await page.getByTestId('financial-revision-amount-input').fill('10000');
	await page
		.getByTestId('financial-revision-reason-input')
		.fill(`${REVISION_PREFIX} browser correction`);
	await page
		.getByTestId('financial-revision-evidence-input')
		.fill(`${REVISION_PREFIX}-EVID-UI`);
	await page.getByTestId('financial-revision-submit').click();
	await expect(page.getByTestId('financial-revision-history')).toContainText(
		`${REVISION_PREFIX} browser correction`
	);

	const april = await readReport(clerk, REVISION_MONTH);
	expect(april.company.incurred_cost).toBe(
		10000 + (evidence.aprSlipCost as number)
	);
});
