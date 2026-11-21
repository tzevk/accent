import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readPayrollRateState,
	seedPayrollRatesFixture,
	type PayrollRatesFixture,
} from '../fixtures/payroll-operations.ts';

// The owned Next dev server compiles routes on first visit; every assertion
// still waits for its observable result, this only bounds compilation time.
test.setTimeout(300_000);

const calendarLabel = (date: string) =>
	new Intl.DateTimeFormat('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	}).format(new Date(date));

const numericDateLabel = (date: string) =>
	new Date(date).toLocaleDateString('en-IN');

let fixture: PayrollRatesFixture | null = null;

test.afterEach(async () => {
	if (fixture === null) return;
	const owned = fixture;
	fixture = null;
	await owned.dispose();
});

// Actor: Payroll operator with payroll:read from the admin reference role and payroll:create directly on the user, never a super-admin.
// Starting state: No Component Rate row exists for the fixture's unique 2090 effective period.
// Action: Open Component Rates, add an HRA % rate with that effective-from/effective-to period, then reopen the page.
// Proof: The saved row reads HRA %, 12.50%, the exact period, and Active after a fresh load, and the independent database read has the same stored period and a CREATE audit.
test('an HRA schedule rate persists with its effective period after reopening', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedPayrollRatesFixture(db, namespace);
	const seeded = fixture;
	const rate = seeded.scheduleRate;
	const fromLabel = calendarLabel(rate.effectiveFrom);
	const toLabel = calendarLabel(rate.effectiveTo);
	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });

	await signInThroughUi(page, seeded.operator);
	await page.goto('/admin/payroll/rates');
	await expect(
		page.getByRole('heading', { name: 'Component Rates', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: '+ Add', exact: true }).click();

	const form = page.locator('form');
	await form.getByRole('combobox').selectOption({ label: 'HRA %' });
	await form.getByRole('spinbutton').fill(String(rate.value));
	const dates = form.locator('input[type="date"]');
	await dates.nth(0).fill(rate.effectiveFrom);
	await dates.nth(1).fill(rate.effectiveTo);

	const created = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/payroll/schedules' &&
			response.request().method() === 'POST'
	);
	await form.getByRole('button', { name: 'Add', exact: true }).click();
	expect((await created).status()).toBe(200);

	const savedRow = () =>
		page
			.getByRole('row')
			.filter({ hasText: 'HRA %' })
			.filter({ hasText: '12.50%' })
			.filter({ hasText: fromLabel })
			.filter({ hasText: toLabel });
	await expect(savedRow()).toBeVisible();
	await expect(savedRow().getByText('Active', { exact: true })).toBeVisible();

	await page.reload();
	await expect(
		page.getByRole('heading', { name: 'Component Rates', exact: true })
	).toBeVisible();
	await expect(savedRow()).toBeVisible();
	await expect(savedRow()).toContainText(fromLabel);
	await expect(savedRow()).toContainText(toLabel);
	await expect(savedRow().getByText('Active', { exact: true })).toBeVisible();

	const stored = await readPayrollRateState(db, rate);
	expect(stored).not.toBeNull();
	expect(stored).toMatchObject({
		componentType: 'hra_percent',
		valueType: 'percentage',
		value: 12.5,
		effectiveFrom: rate.effectiveFrom,
		effectiveTo: rate.effectiveTo,
		isActive: 1,
	});
	expect(stored?.audits.map((audit) => audit.action)).toEqual(['create']);
	expect(stored?.audits[0]?.entityId).toBe(stored?.id);
});

// Actor: Payroll operator with payroll:read from the admin reference role and payroll:create directly on the user, never a super-admin.
// Starting state: No DA rate row exists for the fixture's unique 2090 effective period; the Add form starts Active.
// Action: Open DA Rates, add ₹4,321 for that period with Active checked, save, then reopen the page.
// Proof: The saved row reads ₹4,321, the exact period and Active after a fresh load, and the independent database read has one fixed active DA row for the period with a CREATE audit.
test('a DA rate persists with its effective period after reopening', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedPayrollRatesFixture(db, namespace);
	const seeded = fixture;
	const rate = seeded.daRate;
	const amountLabel = `₹${rate.amount.toLocaleString('en-IN')}`;
	const fromLabel = numericDateLabel(rate.effectiveFrom);
	const toLabel = numericDateLabel(rate.effectiveTo);
	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });

	await signInThroughUi(page, seeded.operator);
	await page.goto('/admin/payroll/rates/da');
	await expect(
		page.getByRole('heading', { name: 'DA Rates', exact: true })
	).toBeVisible();
	await page
		.getByRole('button', { name: '+ Add DA Rate', exact: true })
		.click();

	const form = page.locator('form');
	await form.getByRole('spinbutton').fill(String(rate.amount));
	const dates = form.locator('input[type="date"]');
	await dates.nth(0).fill(rate.effectiveFrom);
	await dates.nth(1).fill(rate.effectiveTo);
	await expect(form.getByRole('checkbox')).toBeChecked();

	const created = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/payroll/da-schedule' &&
			response.request().method() === 'POST'
	);
	await form.getByRole('button', { name: 'Save DA Rate', exact: true }).click();
	expect((await created).status()).toBe(201);

	const savedRow = () =>
		page
			.getByRole('row')
			.filter({ hasText: amountLabel })
			.filter({ hasText: fromLabel })
			.filter({ hasText: toLabel });
	await expect(savedRow()).toBeVisible();
	await expect(savedRow().getByText('Active', { exact: true })).toBeVisible();

	await page.reload();
	await expect(
		page.getByRole('heading', { name: 'DA Rates', exact: true })
	).toBeVisible();
	await expect(savedRow()).toBeVisible();
	await expect(savedRow()).toContainText(fromLabel);
	await expect(savedRow()).toContainText(toLabel);
	await expect(savedRow().getByText('Active', { exact: true })).toBeVisible();

	const stored = await readPayrollRateState(db, {
		componentType: 'da',
		value: rate.amount,
		effectiveFrom: rate.effectiveFrom,
		effectiveTo: rate.effectiveTo,
	});
	expect(stored).not.toBeNull();
	expect(stored).toMatchObject({
		componentType: 'da',
		valueType: 'fixed',
		value: 4321,
		effectiveFrom: rate.effectiveFrom,
		effectiveTo: rate.effectiveTo,
		isActive: 1,
	});
	expect(stored?.audits.map((audit) => audit.action)).toEqual(['create']);
	expect(stored?.audits[0]?.entityId).toBe(stored?.id);
});
