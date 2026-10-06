import {
	expect,
	test,
	type APIRequestContext,
	type Locator,
} from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { exec, rows } from '../lib/db';
import {
	BONUS_WORKER,
	CONTRACT_BONUS_WORKER,
	E2E_BONUS_AMOUNT,
	E2E_BONUS_LATER_AMOUNT,
	E2E_BONUS_SCHEDULE_REMARKS,
	E2E_CTC,
	E2E_MONTH,
	LATE_BONUS_WORKER,
	PREVIEW_BONUS_WORKER,
	ZERO_BONUS_WORKER,
} from '../lib/fixtures';

/**
 * Payroll bonus composition (ticket #305): a bonus is employee earnings, never
 * an employer contribution. A ₹1,000 bonus raises a slip's earnings by ₹1,000,
 * its employer contributions by ₹0 and its employer cost by ₹1,000 — once.
 *
 * Expected values are stated from the business rules, not the payroll module:
 *
 *   gross            = CTC ÷ Basis Hours × Logged Hours
 *                    = 26,000 ÷ (26 × 8) × 104               = 13,000
 *   the five hours heads (60 + 20 + 10 + 10 % of gross)      = 13,000
 *   PF employer      = (3.67 % EPF + 8.33 % EPS) × min(gross, 15,000)
 *                                                             = 1,560
 *   PF admin / EDLI  = 0.5 % of the PF wage base              = 65 each
 *   gratuity         = 4.81 % of Basic (7,800) → whole rupees = 375
 *   employer contributions (never the bonus)                  = 2,065
 *   employer cost    = total earnings + employer contributions
 *
 * The four bonus fixtures share WORKER's CTC, hours and flags, so the pair
 * E2E-EMP-0003 / E2E-EMP-0004 differs only in `include_bonus` and their slip
 * delta is the bonus itself. The contract fixture proves the second stream,
 * the run dashboard and the Salary Profile preview prove the readers, and the
 * late fixture proves a later Component Rate never reprices a stored slip.
 */

const GROSS = 13_000;
const EMPLOYER_CONTRIBUTIONS = 2_065;
const BONUS_EARNINGS = GROSS + E2E_BONUS_AMOUNT; // 14,000
const BONUS_COST = BONUS_EARNINGS + EMPLOYER_CONTRIBUTIONS; // 16,065
const ZERO_COST = GROSS + EMPLOYER_CONTRIBUTIONS; // 15,065

/** The money columns a stored slip is asserted on; never `updated_at`. */
const SLIP_MONEY_COLUMNS = `gross, basic, da, hra, conveyance, call_allowance,
	pf_employer, esic_employer, mlwf_employer, insurance, gratuity, pf_admin,
	edli, bonus, total_earnings, total_employer_contributions, employer_cost`;

interface EmployeeRow {
	id: number;
	employee_id: string;
}

interface SlipMoney {
	month: string;
	gross: string;
	basic: string;
	da: string;
	hra: string;
	conveyance: string;
	call_allowance: string;
	pf_employer: string;
	esic_employer: string;
	mlwf_employer: string;
	insurance: string;
	gratuity: string;
	pf_admin: string;
	edli: string;
	bonus: string;
	total_earnings: string;
	total_employer_contributions: string;
	employer_cost: string;
}

async function employeeIdFor(code: string): Promise<number> {
	const [row] = await rows<EmployeeRow>(
		`SELECT id, employee_id FROM employees WHERE employee_id = ?`,
		[code]
	);
	expect(row, `${code} must be seeded`).toBeTruthy();
	return row.id;
}

async function storedSlip(employeeId: number): Promise<SlipMoney> {
	const [row] = await rows<SlipMoney>(
		`SELECT ${SLIP_MONEY_COLUMNS} FROM payroll_slips
      WHERE employee_id = ? AND month = ?`,
		[employeeId, E2E_MONTH]
	);
	expect(row, `slip for employee ${employeeId} must exist`).toBeTruthy();
	return row;
}

/**
 * The whole composition rule for one slip: the bonus lands in earnings once,
 * the employer-contribution total is exactly the genuine employer
 * contributions, and employer cost is earnings + those contributions.
 */
function expectBonusCountedOnce(slip: SlipMoney, bonusAmount: number) {
	const expectedEarnings = GROSS + bonusAmount;
	const expectedCost = expectedEarnings + EMPLOYER_CONTRIBUTIONS;

	expect(Number(slip.bonus)).toBe(bonusAmount);
	expect(Number(slip.total_earnings)).toBe(expectedEarnings);

	// The five hours-based heads always add up to the gross; bonus is on top.
	expect(
		Number(slip.basic) +
			Number(slip.da) +
			Number(slip.hra) +
			Number(slip.conveyance) +
			Number(slip.call_allowance)
	).toBe(GROSS);

	// Genuine employer contributions: PF (12 % on the ₹13,000 wage base),
	// PF admin, EDLI and gratuity — never the bonus.
	expect(Number(slip.pf_employer)).toBe(1_560);
	expect(Number(slip.pf_admin)).toBe(65);
	expect(Number(slip.edli)).toBe(65);
	expect(Number(slip.gratuity)).toBe(375);
	expect(Number(slip.total_employer_contributions)).toBe(
		EMPLOYER_CONTRIBUTIONS
	);
	expect(
		Number(slip.pf_employer) +
			Number(slip.esic_employer) +
			Number(slip.mlwf_employer) +
			Number(slip.insurance) +
			Number(slip.gratuity) +
			Number(slip.pf_admin) +
			Number(slip.edli)
	).toBe(Number(slip.total_employer_contributions));

	expect(Number(slip.employer_cost)).toBe(expectedCost);
	expect(Number(slip.employer_cost)).toBe(
		Number(slip.total_earnings) + Number(slip.total_employer_contributions)
	);
}

/** Generate the same way the /reports "Generate with Bonus" modal does. */
function generateWithBonus(
	request: APIRequestContext,
	employeeIds: number[],
	includeBonus: boolean
) {
	return request.post('/api/payroll/generate', {
		data: {
			employee_ids: employeeIds,
			month: E2E_MONTH,
			include_bonus: includeBonus,
			bonus_employee_ids: employeeIds,
		},
	});
}

test('a bonus raises earnings once and never employer contributions', async ({
	request,
}) => {
	const id = await employeeIdFor(BONUS_WORKER.code);

	// The existing preview (calculate without saving) must agree with the
	// generation and the persisted snapshot.
	const previewRes = await request.post('/api/payroll/generate', {
		data: {
			employee_id: id,
			month: E2E_MONTH,
			preview: true,
			include_bonus: true,
		},
	});
	expect(previewRes.status(), await previewRes.text()).toBe(200);
	const preview = (await previewRes.json()).data;
	expect(Number(preview.bonus)).toBe(E2E_BONUS_AMOUNT);
	expect(Number(preview.total_earnings)).toBe(BONUS_EARNINGS);
	expect(Number(preview.total_employer_contributions)).toBe(
		EMPLOYER_CONTRIBUTIONS
	);
	expect(Number(preview.employer_cost)).toBe(BONUS_COST);

	const genRes = await generateWithBonus(request, [id], true);
	expect(genRes.status(), await genRes.text()).toBe(200);
	const results = (await genRes.json()).results;
	// A retry of this test may find the fixture slip already generated.
	expect(results.success + results.skipped).toBe(1);
	expect(results.failed).toBe(0);

	const slip = await storedSlip(id);
	expect(String(slip.month).slice(0, 10)).toBe(E2E_MONTH);
	expectBonusCountedOnce(slip, E2E_BONUS_AMOUNT);

	// The listing every payroll screen reads agrees with the stored row.
	const listRes = await request.get(
		`/api/payroll/slips?month=${E2E_MONTH}&employee_id=${id}`
	);
	expect(listRes.status()).toBe(200);
	const listed = ((await listRes.json()).data ?? [])[0];
	expect(Number(listed.bonus)).toBe(E2E_BONUS_AMOUNT);
	expect(Number(listed.total_earnings)).toBe(BONUS_EARNINGS);
	expect(Number(listed.total_employer_contributions)).toBe(
		EMPLOYER_CONTRIBUTIONS
	);
	expect(Number(listed.employer_cost)).toBe(BONUS_COST);

	writeArtifact('payroll-bonus-composition', {
		month: E2E_MONTH,
		inputs: {
			employee: BONUS_WORKER.code,
			ctc: E2E_CTC,
			basisHours: 208,
			loggedHours: 104,
			bonusRate: E2E_BONUS_AMOUNT,
			includeBonus: true,
		},
		expected: {
			bonus: E2E_BONUS_AMOUNT,
			earnings: BONUS_EARNINGS,
			employerContributions: EMPLOYER_CONTRIBUTIONS,
			employerCost: BONUS_COST,
		},
		observed: {
			preview: {
				bonus: Number(preview.bonus),
				totalEarnings: Number(preview.total_earnings),
				totalEmployerContributions: Number(
					preview.total_employer_contributions
				),
				employerCost: Number(preview.employer_cost),
			},
			stored: {
				bonus: Number(slip.bonus),
				totalEarnings: Number(slip.total_earnings),
				totalEmployerContributions: Number(slip.total_employer_contributions),
				employerCost: Number(slip.employer_cost),
			},
			listing: {
				bonus: Number(listed.bonus),
				totalEarnings: Number(listed.total_earnings),
				totalEmployerContributions: Number(
					listed.total_employer_contributions
				),
				employerCost: Number(listed.employer_cost),
			},
		},
		ok: true,
	});
	expect(readArtifact('payroll-bonus-composition')).toMatchObject({ ok: true });
});

test('without the bonus the identical profile pays exactly ₹1,000 less, with unchanged employer contributions', async ({
	request,
}) => {
	const zeroId = await employeeIdFor(ZERO_BONUS_WORKER.code);

	const genRes = await generateWithBonus(request, [zeroId], false);
	expect(genRes.status(), await genRes.text()).toBe(200);

	const zero = await storedSlip(zeroId);
	expect(Number(zero.bonus)).toBe(0);
	expectBonusCountedOnce(zero, 0);
	expect(Number(zero.total_earnings)).toBe(GROSS);
	expect(Number(zero.employer_cost)).toBe(ZERO_COST);

	// The delta between the twins is the bonus: earnings +₹1,000, employer
	// contributions +₹0, employer cost +₹1,000.
	const bonus = await storedSlip(await employeeIdFor(BONUS_WORKER.code));
	expect(
		Number(bonus.total_earnings) - Number(zero.total_earnings)
	).toBe(E2E_BONUS_AMOUNT);
	expect(
		Number(bonus.total_employer_contributions) -
			Number(zero.total_employer_contributions)
	).toBe(0);
	expect(Number(bonus.employer_cost) - Number(zero.employer_cost)).toBe(
		E2E_BONUS_AMOUNT
	);

	writeArtifact('payroll-bonus-zero-baseline', {
		month: E2E_MONTH,
		inputs: {
			withBonus: BONUS_WORKER.code,
			withoutBonus: ZERO_BONUS_WORKER.code,
			bonusRate: E2E_BONUS_AMOUNT,
		},
		expected: {
			earningsDelta: E2E_BONUS_AMOUNT,
			employerContributionsDelta: 0,
			employerCostDelta: E2E_BONUS_AMOUNT,
		},
		observed: {
			withBonus: {
				bonus: Number(bonus.bonus),
				totalEarnings: Number(bonus.total_earnings),
				totalEmployerContributions: Number(bonus.total_employer_contributions),
				employerCost: Number(bonus.employer_cost),
			},
			withoutBonus: {
				bonus: Number(zero.bonus),
				totalEarnings: Number(zero.total_earnings),
				totalEmployerContributions: Number(zero.total_employer_contributions),
				employerCost: Number(zero.employer_cost),
			},
			deltas: {
				earnings:
					Number(bonus.total_earnings) - Number(zero.total_earnings),
				employerContributions:
					Number(bonus.total_employer_contributions) -
					Number(zero.total_employer_contributions),
				employerCost: Number(bonus.employer_cost) - Number(zero.employer_cost),
			},
		},
		ok: true,
	});
	expect(readArtifact('payroll-bonus-zero-baseline')).toMatchObject({
		ok: true,
	});
});

test('the contract stream counts the same bonus once', async ({ request }) => {
	const id = await employeeIdFor(CONTRACT_BONUS_WORKER.code);

	const genRes = await generateWithBonus(request, [id], true);
	expect(genRes.status(), await genRes.text()).toBe(200);
	const results = (await genRes.json()).results;
	expect(results.success + results.skipped).toBe(1);
	expect(results.failed).toBe(0);

	const slip = await storedSlip(id);
	expectBonusCountedOnce(slip, E2E_BONUS_AMOUNT);

	// The contract stream's own listing read.
	const listRes = await request.get(
		`/api/payroll/slips?month=${E2E_MONTH}&salary_type=contract&employee_id=${id}`
	);
	expect(listRes.status()).toBe(200);
	const listed = ((await listRes.json()).data ?? [])[0];
	expect(Number(listed.bonus)).toBe(E2E_BONUS_AMOUNT);
	expect(Number(listed.total_earnings)).toBe(BONUS_EARNINGS);
	expect(Number(listed.total_employer_contributions)).toBe(
		EMPLOYER_CONTRIBUTIONS
	);
	expect(Number(listed.employer_cost)).toBe(BONUS_COST);

	writeArtifact('payroll-bonus-contract-stream', {
		month: E2E_MONTH,
		inputs: {
			employee: CONTRACT_BONUS_WORKER.code,
			salaryType: 'contract',
			bonusRate: E2E_BONUS_AMOUNT,
		},
		expected: {
			bonus: E2E_BONUS_AMOUNT,
			earnings: BONUS_EARNINGS,
			employerContributions: EMPLOYER_CONTRIBUTIONS,
			employerCost: BONUS_COST,
		},
		observed: {
			bonus: Number(slip.bonus),
			earnings: Number(slip.total_earnings),
			employerContributions: Number(slip.total_employer_contributions),
			employerCost: Number(slip.employer_cost),
		},
		ok: true,
	});
	expect(readArtifact('payroll-bonus-contract-stream')).toMatchObject({
		ok: true,
	});
});

test('the Payroll Run dashboard lists the stored bonus and gross for both streams', async ({
	page,
}) => {
	await page.goto('/admin/payroll');

	const payrollLoaded = page.waitForResponse(
		(response) =>
			response.url().includes('/api/payroll/slips') &&
			response.url().includes('2019-01-01')
	);
	await page.getByLabel('Month:').fill('2019-01');
	await payrollLoaded;

	const headers = await page.getByRole('columnheader').allTextContents();
	const bonusIndex = headers.findIndex((header) => header.trim() === 'Bonus');
	const grossIndex = headers.findIndex((header) => header.trim() === 'Gross');
	expect(bonusIndex, 'Bonus column').toBeGreaterThan(-1);
	expect(grossIndex, 'Gross column').toBeGreaterThan(-1);

	const bonusRow = page.getByRole('row', { name: /E2E BonusWorker/ });
	await expect(bonusRow).toBeVisible();
	await expect(bonusRow.getByRole('cell').nth(bonusIndex)).toHaveText(
		'₹1,000.00'
	);
	await expect(bonusRow.getByRole('cell').nth(grossIndex)).toHaveText(
		'₹14,000.00'
	);

	// The Contract toggle reads the other stream's stored slip.
	const contractLoaded = page.waitForResponse(
		(response) =>
			response.url().includes('/api/payroll/slips') &&
			response.url().includes('salary_type=contract')
	);
	await page.getByRole('button', { name: 'Contract', exact: true }).click();
	await contractLoaded;

	const contractRow = page.getByRole('row', { name: /E2E ContractBonus/ });
	await expect(contractRow).toBeVisible();
	await expect(contractRow.getByRole('cell').nth(bonusIndex)).toHaveText(
		'₹1,000.00'
	);
	await expect(contractRow.getByRole('cell').nth(grossIndex)).toHaveText(
		'₹14,000.00'
	);

	writeArtifact('payroll-bonus-run-dashboard', {
		month: E2E_MONTH,
		expected: { bonus: E2E_BONUS_AMOUNT, earnings: BONUS_EARNINGS },
		observed: {
			payrollStream: {
				employee: BONUS_WORKER.code,
				bonus: '₹1,000.00',
				gross: '₹14,000.00',
			},
			contractStream: {
				employee: CONTRACT_BONUS_WORKER.code,
				bonus: '₹1,000.00',
				gross: '₹14,000.00',
			},
		},
		ok: true,
	});
	expect(readArtifact('payroll-bonus-run-dashboard')).toMatchObject({
		ok: true,
	});
});

test('the Salary Profile preview counts the bonus once, as earnings', async ({
	page,
}) => {
	await page.goto('/employees/payroll');
	await page.getByPlaceholder('Search employees...').fill('PreviewBonus');
	await page
		.getByRole('button', { name: `Edit E2E ${PREVIEW_BONUS_WORKER.lastName}` })
		.click();
	await page.getByRole('button', { name: 'Salary Profile' }).click();

	const section = page.getByTestId('salary-profile-section');
	// The seeded profile is Bonus applicable; the preview always includes it.
	await expect(section.getByLabel('Bonus', { exact: true })).toBeChecked();

	const earnings = section.locator(
		'section[aria-labelledby="salary-earnings-heading"]'
	);
	const employer = section.locator(
		'section[aria-labelledby="salary-employer-heading"]'
	);
	const amountRow = (scope: Locator, label: string) =>
		scope.getByText(label, { exact: true }).locator('xpath=following-sibling::output');

	// The preview prices the full month (CTC 26,000): earnings 27,000 =
	// 26,000 + 1,000 bonus; employer contributions 2,701 = PF 1,801
	// (3.67 % + 8.33 % of the ₹15,000 PF wage ceiling, each rounded half-up:
	// 551 + 1,250) + admin 75 + EDLI 75 + gratuity 750; CTC 29,701 = both,
	// once.
	await expect(amountRow(earnings, 'Bonus')).toHaveText('₹1,000.00');
	await expect(amountRow(earnings, 'Total Earnings')).toHaveText('₹27,000.00');
	await expect(amountRow(employer, 'Total Employer Contributions')).toHaveText(
		'₹2,701.00'
	);
	await expect(amountRow(employer, 'Total CTC')).toHaveText('₹29,701.00');
	// Bonus is earnings: the employer section lists no Bonus row.
	await expect(employer.getByText('Bonus', { exact: true })).toHaveCount(0);

	writeArtifact('payroll-bonus-preview-ui', {
		employee: PREVIEW_BONUS_WORKER.code,
		expected: {
			earnings: 27_000,
			employerContributions: 2_701,
			employerCost: 29_701,
		},
		observed: {
			earnings: '₹27,000.00',
			employerContributions: '₹2,701.00',
			employerCost: '₹29,701.00',
		},
		ok: true,
	});
	expect(readArtifact('payroll-bonus-preview-ui')).toMatchObject({ ok: true });
});

test.describe('payroll generation authorization', () => {
	test.use({ storageState: 'e2e/.auth/employee.json' });

	test('an employee account cannot generate a Payroll Slip', async ({
		request,
	}) => {
		const id = await employeeIdFor(LATE_BONUS_WORKER.code);

		const res = await generateWithBonus(request, [id], true);
		expect(res.status()).toBe(403);

		// No durable write escapes the refused request.
		const [slip] = await rows(
			`SELECT id FROM payroll_slips WHERE employee_id = ? AND month = ?`,
			[id, E2E_MONTH]
		);
		expect(slip).toBeFalsy();

		writeArtifact('payroll-bonus-authorization', {
			endpoint: 'POST /api/payroll/generate',
			employee: LATE_BONUS_WORKER.code,
			status: res.status(),
			slipCreated: false,
			ok: true,
		});
		expect(readArtifact('payroll-bonus-authorization')).toMatchObject({
			ok: true,
		});
	});
});

test('a later Bonus rate never reprices stored slips, and a duplicate generate is refused', async ({
	request,
}) => {
	const bonusId = await employeeIdFor(BONUS_WORKER.code);
	const zeroId = await employeeIdFor(ZERO_BONUS_WORKER.code);
	const contractId = await employeeIdFor(CONTRACT_BONUS_WORKER.code);

	const snapshots: { employee: string; id: number; slip: SlipMoney }[] = [];
	for (const entry of [
		{ employee: BONUS_WORKER.code, id: bonusId },
		{ employee: ZERO_BONUS_WORKER.code, id: zeroId },
		{ employee: CONTRACT_BONUS_WORKER.code, id: contractId },
	]) {
		snapshots.push({ ...entry, slip: await storedSlip(entry.id) });
	}

	// An operator publishes a later Bonus Component Rate for the same month.
	await exec(
		`INSERT INTO payroll_schedules
       (component_type, value_type, value, effective_from, effective_to, is_active, remarks)
     VALUES ('bonus', 'fixed', ?, '2019-01-01', NULL, 1, ?)`,
		[E2E_BONUS_LATER_AMOUNT, `${E2E_BONUS_SCHEDULE_REMARKS} (later)`]
	);

	// A new slip prices at the later rate, still counting the bonus once.
	const lateId = await employeeIdFor(LATE_BONUS_WORKER.code);
	const genRes = await generateWithBonus(request, [lateId], true);
	expect(genRes.status(), await genRes.text()).toBe(200);
	const late = await storedSlip(lateId);
	expectBonusCountedOnce(late, E2E_BONUS_LATER_AMOUNT);

	// The stored slips keep their snapshot: identical money columns.
	for (const entry of snapshots) {
		expect(await storedSlip(entry.id)).toEqual(entry.slip);
	}

	// Generating over an existing slip is refused, not recomputed.
	const duplicate = await request.post('/api/payroll/generate', {
		data: { employee_id: bonusId, month: E2E_MONTH, include_bonus: true },
	});
	expect(duplicate.status()).toBe(409);
	expect(await storedSlip(bonusId)).toEqual(snapshots[0].slip);

	const afterSnapshots: { employee: string; bonus: number }[] = [];
	for (const entry of snapshots) {
		afterSnapshots.push({
			employee: entry.employee,
			bonus: Number((await storedSlip(entry.id)).bonus),
		});
	}

	// The listing still reads the frozen snapshot, not the new rate.
	const listRes = await request.get(
		`/api/payroll/slips?month=${E2E_MONTH}&employee_id=${bonusId}`
	);
	expect(listRes.status()).toBe(200);
	const listed = ((await listRes.json()).data ?? [])[0];
	expect(Number(listed.bonus)).toBe(E2E_BONUS_AMOUNT);
	expect(Number(listed.employer_cost)).toBe(BONUS_COST);

	// Restore the fixture-owned schedule so later flows in the same run price
	// the original ₹1,000 rate; the snapshot assertions above already happened
	// while the later rate was live.
	await exec(`DELETE FROM payroll_schedules WHERE remarks = ?`, [
		`${E2E_BONUS_SCHEDULE_REMARKS} (later)`,
	]);

	writeArtifact('payroll-bonus-snapshot-stability', {
		month: E2E_MONTH,
		inputs: {
			storedSlips: [
				BONUS_WORKER.code,
				ZERO_BONUS_WORKER.code,
				CONTRACT_BONUS_WORKER.code,
			],
			laterRateEmployee: LATE_BONUS_WORKER.code,
			originalRate: E2E_BONUS_AMOUNT,
			laterRate: E2E_BONUS_LATER_AMOUNT,
		},
		expected: {
			storedSlipsUnchanged: true,
			lateSlipBonus: E2E_BONUS_LATER_AMOUNT,
			duplicateGenerateStatus: 409,
		},
		observed: {
			storedSlipsUnchanged: afterSnapshots,
			lateSlip: {
				bonus: Number(late.bonus),
				totalEarnings: Number(late.total_earnings),
				totalEmployerContributions: Number(late.total_employer_contributions),
				employerCost: Number(late.employer_cost),
			},
			duplicateGenerateStatus: duplicate.status(),
			listingBonusAfterRateChange: Number(listed.bonus),
		},
		ok: true,
	});
	expect(readArtifact('payroll-bonus-snapshot-stability')).toMatchObject({
		ok: true,
	});
});
