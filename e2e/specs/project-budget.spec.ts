import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readProjectBudgetJournal,
	readProjectBudgets,
	readRecognizedProjectCost,
	seedProjectBudgetFixture,
	type ProjectBudgetFixture,
} from '../fixtures/project-budget.ts';

/** The expected report and journal money, authored independently of the app. */
const APPROVAL_REASON = 'Approved for the 2019-08 project cost plan.';

let fixture: ProjectBudgetFixture | null = null;

// The owned Next dev server compiles routes on first visit; every assertion
// still waits for its visible result, and this only bounds compile time.
test.setTimeout(180_000);

test.afterEach(async () => {
	if (fixture === null) return;
	const owned = fixture;
	fixture = null;
	await owned.dispose();
});

// Actor: Ordinary budget operator with exactly other_expenses:read/update/approve,
// reports:read, and payroll:read — no project or super-admin access.
// Starting state: An owned Project with one recognized operating Project cost in
// 2019-08, and no cost budget recorded yet.
// Action: Record, submit, and approve a 2019-08 Project cost budget with signed
// approval evidence, reopen the budget page, then open the monthly report.
// Proof: The report states the approved 40,000.00 budget against the confirmed
// 25,000.00 incurred cost and the 15,000.00 remaining amount after a fresh
// read; the stored budget and its recorded/submitted/approved journal match.
test('approved project budget states its signed remaining amount on the report', async ({
	page,
	db,
	namespace,
}) => {
	const owned = await seedProjectBudgetFixture(db, `${namespace}-b1`);
	fixture = owned;
	page.setDefaultNavigationTimeout(60_000);

	// The starting cost is recognized operating Project cost, not a budget.
	const startingCost = await readRecognizedProjectCost(db, owned.cost.id);
	expect(startingCost.expenseNumber).toBe(owned.cost.expenseNumber);
	expect(startingCost.projectId).toBe(owned.project.id);
	expect(startingCost.projectCode).toBe(owned.project.code);
	expect(startingCost.classification).toBe('project');
	expect(startingCost.nature).toBe('operating');
	expect(startingCost.state).toBe('recognized');
	expect(startingCost.currency).toBe('INR');
	expect(startingCost.recognitionPeriod).toBe(owned.monthStart);
	expect(startingCost.recognizedAmount).toBe('25000.00');
	expect(startingCost.totalAmount).toBe('25000.00');
	expect(startingCost.isDelete).toBe(0);
	expect(await readProjectBudgets(db, owned.project.id)).toEqual([]);

	// Anonymous sign-in attempt: 1 (this spec file runs exactly one attempt).
	await signInThroughUi(page, {
		username: owned.operator.username,
		password: owned.operator.password,
	});

	await page.goto(
		`/projects/${owned.project.id}/cost-budgets?month=${owned.month}&currency=INR`
	);
	await expect(
		page.getByRole('heading', {
			name: `Cost budgets — ${owned.project.code}`,
			exact: true,
		})
	).toBeVisible({ timeout: 30_000 });
	await expect(
		page.getByText('No cost budget recorded for this Project yet.', {
			exact: true,
		})
	).toBeVisible();

	await page
		.getByRole('button', { name: 'Record cost budget', exact: true })
		.click();
	const recordDialog = page.getByRole('dialog', {
		name: `Record cost budget for ${owned.project.code}`,
		exact: true,
	});
	await expect(recordDialog).toBeVisible();
	// New budgets start on the report's exact month and currency.
	await expect(
		recordDialog.getByLabel('Currency', { exact: true })
	).toHaveValue('INR');
	await expect(recordDialog.getByLabel('Scope', { exact: true })).toHaveValue(
		'project_incurred_cost'
	);
	await expect(
		recordDialog.getByLabel('Period start', { exact: true })
	).toHaveValue(owned.monthStart);
	await expect(
		recordDialog.getByLabel('Period end', { exact: true })
	).toHaveValue(owned.monthEnd);
	await recordDialog
		.getByLabel('Amount', { exact: true })
		.fill(String(owned.expectedBudgetAmount));
	await recordDialog
		.getByLabel('Basis note', { exact: true })
		.fill(owned.basisNote);
	await recordDialog
		.getByRole('button', { name: 'Record budget', exact: true })
		.click();

	const budgetRow = page.getByTestId('budget-row');
	await expect(budgetRow).toBeVisible({ timeout: 30_000 });
	await expect(budgetRow).toHaveAttribute('data-state', 'draft');
	await expect(budgetRow).toHaveAttribute('data-version', '1');
	await expect(budgetRow).toContainText('₹40,000.00');
	await expect(budgetRow).toContainText('Draft · version 1');
	await expect(budgetRow).toContainText(
		`${owned.monthStart} to ${owned.monthEnd}`
	);
	await expect(budgetRow).toContainText('Project cost budget (comparable)');
	await expect(budgetRow).toContainText(owned.basisNote);
	const budgetUid = await budgetRow.getAttribute('data-budget-uid');
	if (budgetUid === null || !budgetUid.startsWith('costbudget-')) {
		throw new Error(`[project-budget] unexpected budget UID: ${budgetUid}`);
	}

	await budgetRow.getByRole('button', { name: 'Submit', exact: true }).click();
	await expect(budgetRow).toHaveAttribute('data-state', 'submitted');
	await expect(budgetRow).toHaveAttribute('data-version', '2');
	await expect(budgetRow).toContainText('Submitted · version 2');
	expect(budgetUid).toBe(await budgetRow.getAttribute('data-budget-uid'));

	await budgetRow.getByRole('button', { name: 'Approve', exact: true }).click();
	const approveDialog = page.getByRole('dialog', {
		name: 'Approve budget',
		exact: true,
	});
	await expect(approveDialog).toBeVisible();
	await approveDialog
		.getByLabel('Approval evidence', { exact: true })
		.fill(owned.approvalEvidence);
	await approveDialog
		.getByLabel('Reason', { exact: true })
		.fill(APPROVAL_REASON);
	await approveDialog
		.getByRole('button', { name: 'Approve budget', exact: true })
		.click();

	await expect(budgetRow).toHaveAttribute('data-state', 'approved');
	await expect(budgetRow).toHaveAttribute('data-version', '3');
	await expect(budgetRow).toContainText('Approved · version 3');
	await expect(budgetRow).toContainText(
		`approval evidence ${owned.approvalEvidence}`
	);

	await budgetRow.getByRole('button', { name: 'History', exact: true }).click();
	const historyRows = budgetRow.getByTestId('budget-history-row');
	await expect(historyRows).toHaveCount(3);
	await expect(historyRows.nth(0)).toHaveAttribute('data-command', 'recorded');
	await expect(historyRows.nth(0)).toContainText('version 1 · recorded');
	await expect(historyRows.nth(0)).toContainText(owned.basisNote);
	await expect(historyRows.nth(1)).toHaveAttribute('data-command', 'submitted');
	await expect(historyRows.nth(1)).toContainText('version 2 · submitted');
	await expect(historyRows.nth(2)).toHaveAttribute('data-command', 'approved');
	await expect(historyRows.nth(2)).toContainText('version 3 · approved');
	await expect(historyRows.nth(2)).toContainText(
		`evidence ${owned.approvalEvidence}`
	);
	await expect(historyRows.nth(2)).toContainText(APPROVAL_REASON);

	// Fresh read: the approved budget and its journal survive a full reload.
	await page.reload();
	await expect(budgetRow).toHaveAttribute('data-state', 'approved');
	await expect(budgetRow).toHaveAttribute('data-version', '3');
	await expect(budgetRow).toContainText(owned.approvalEvidence);
	await budgetRow.getByRole('button', { name: 'History', exact: true }).click();
	await expect(historyRows).toHaveCount(3);

	// Independent saved-state proof, not a restatement of the screen.
	const [storedBudget, ...otherBudgets] = await readProjectBudgets(
		db,
		owned.project.id
	);
	expect(otherBudgets).toEqual([]);
	expect(storedBudget).toBeDefined();
	expect(storedBudget.id).toBeGreaterThan(0);
	expect(storedBudget.budgetUid).toBe(budgetUid);
	expect(storedBudget.currency).toBe('INR');
	expect(storedBudget.amount).toBe('40000.00');
	expect(storedBudget.scope).toBe('project_incurred_cost');
	expect(storedBudget.periodStart).toBe(owned.monthStart);
	expect(storedBudget.periodEnd).toBe(owned.monthEnd);
	expect(storedBudget.basisNote).toBe(owned.basisNote);
	expect(storedBudget.state).toBe('approved');
	expect(storedBudget.approvalEvidenceReference).toBe(owned.approvalEvidence);
	expect(storedBudget.approvedBy).toBe(owned.operator.userId);
	expect(storedBudget.approvedAt).not.toBeNull();
	expect(storedBudget.financialVersion).toBe(3);
	expect(storedBudget.createdBy).toBe(owned.operator.userId);
	expect(storedBudget.isDelete).toBe(0);

	const journal = await readProjectBudgetJournal(db, budgetUid);
	expect(journal.map((entry) => [entry.version, entry.command])).toEqual([
		[1, 'recorded'],
		[2, 'submitted'],
		[3, 'approved'],
	]);
	for (const entry of journal) {
		expect(entry.actorUserId).toBe(owned.operator.userId);
		expect(entry.createdAt).not.toBe('');
	}
	expect(journal[0].reason).toBe(owned.basisNote);
	expect(journal[1].reason).toBeNull();
	expect(journal[2].reason).toBe(APPROVAL_REASON);
	expect(journal[2].evidenceReference).toBe(owned.approvalEvidence);

	// A newly loaded report must state the approved budget, not an earlier read.
	await page.goto(`/reports/company-monthly-cost?month=${owned.month}`);
	const budgetSection = page.getByTestId('budget-section');
	await expect(budgetSection).toBeVisible({ timeout: 30_000 });
	const comparisonRow = page.locator(
		`[data-testid="budget-comparison-row"][data-project-code="${owned.project.code}"]`
	);
	await expect(comparisonRow).toBeVisible({ timeout: 30_000 });
	await expect(comparisonRow).toHaveAttribute('data-currency', 'INR');
	await expect(comparisonRow).toHaveAttribute('data-outcome', 'compared');
	await expect(comparisonRow).toHaveAttribute('data-incurred', '25000');
	await expect(comparisonRow).toHaveAttribute('data-budget', '40000');
	await expect(comparisonRow).toHaveAttribute('data-variance', '15000');

	const cells = comparisonRow.getByRole('cell');
	await expect(cells.nth(1)).toHaveText('INR');
	await expect(cells.nth(2)).toHaveText('₹25,000.00');
	await expect(cells.nth(3)).toHaveText('₹40,000.00');
	await expect(cells.nth(4)).toHaveText('₹15,000.00');
	await expect(comparisonRow.getByTestId('budget-outcome-detail')).toHaveText(
		`40000.00 INR approved cost budget ${budgetUid}, version 3, period ${owned.monthStart} to ${owned.monthEnd}, approval evidence ${owned.approvalEvidence} compared with confirmed Incurred Project Cost 25000.00 INR for ${owned.month}: remaining 15000.00 INR.`
	);

	const candidate = comparisonRow.getByTestId('budget-candidate');
	await expect(candidate).toHaveCount(1);
	await expect(candidate).toHaveAttribute('data-budget-uid', budgetUid);
	await expect(candidate).toHaveAttribute('data-state', 'approved');
	await expect(candidate).toContainText('₹40,000.00');
	await expect(candidate).toContainText(owned.approvalEvidence);
	await expect(
		budgetSection
			.getByTestId('budget-notice')
			.filter({ hasText: 'Remaining budget is not profit' })
	).toBeVisible();

	// The comparison is not cached UI state: a reload reads it again.
	await page.reload();
	await expect(comparisonRow).toBeVisible({ timeout: 30_000 });
	await expect(comparisonRow).toHaveAttribute('data-outcome', 'compared');
	await expect(comparisonRow).toHaveAttribute('data-variance', '15000');
	await expect(
		comparisonRow.getByTestId('budget-outcome-detail')
	).toContainText(`remaining 15000.00 INR`);
	await expect(
		comparisonRow.getByTestId('budget-outcome-detail')
	).toContainText(owned.approvalEvidence);
});
