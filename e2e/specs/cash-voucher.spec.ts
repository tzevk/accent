import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	findCashVouchersByCreator,
	readFundingMirror,
	seedCashVoucherFixture,
} from '../fixtures/cash-voucher.ts';

/**
 * Actor: an ordinary signed-in employee with the hook-owned `admin` reference
 * role (the role code the cash-voucher APIs require) and no direct grants; the
 * employee picker needs only an authenticated reader.
 *
 * Starting state: one active fixture Employee with a unique payee name, and no
 * cash voucher created by this identity.
 *
 * Action: open New Voucher from the register, pick that payee, enter one line
 * with bill number BILL-<token>, Rs 4321 and Ps 87, save, find the row through
 * the register search, then open it with the row's Edit Voucher button.
 *
 * Proof: the edit form redisplays the payee, bill number, separate rupees and
 * paise values, and ₹4,321.87; an independent MySQL read shows the same
 * voucher columns, the one-line JSON and the funding credit. A broken save,
 * list link, edit hydration, paise rounding or funding mirror fails this test.
 */
test('cash voucher saves a payee and paise line then reopens from the register', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(240_000);
	const fixture = await seedCashVoucherFixture(db, namespace);

	try {
		const before = await findCashVouchersByCreator(db, fixture.userId);
		expect(before).toEqual([]);

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, fixture);

		await page.goto('/admin/cash-voucher');
		await expect(
			page.getByRole('heading', { name: 'Cash Vouchers', exact: true })
		).toBeVisible({ timeout: 60_000 });
		await page
			.getByRole('button', { name: 'New Voucher', exact: true })
			.click();
		await expect(
			page.getByRole('heading', {
				name: 'New Petty Cash Voucher',
				exact: true,
			})
		).toBeVisible({ timeout: 60_000 });

		const voucherNumberInput = page.getByLabel('Voucher number', {
			exact: true,
		});
		// The page fetches its next number; clearing it lets the create route
		// allocate under its own lock, so parallel journeys cannot collide on
		// a number fetched outside the transaction.
		await expect(voucherNumberInput).not.toHaveValue('', {
			timeout: 60_000,
		});
		await voucherNumberInput.fill('');

		const voucherDateInput = page.getByLabel('Voucher date', {
			exact: true,
		});
		const voucherDate = await voucherDateInput.inputValue();
		expect(voucherDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		await page.getByRole('button', { name: 'Paid to', exact: true }).click();
		await page.getByPlaceholder('Search...').fill(fixture.payeeName);
		await page
			.getByRole('button', { name: fixture.payeeName, exact: true })
			.click();
		await expect(
			page.getByRole('button', { name: 'Paid to', exact: true })
		).toContainText(fixture.payeeName);

		await page
			.getByLabel('Bill no. for item 1', { exact: true })
			.fill(fixture.billNo);
		await page
			.getByLabel('Rupees (Rs) for item 1', { exact: true })
			.fill(String(fixture.rupees));
		await page
			.getByLabel('Paise (Ps) for item 1', { exact: true })
			.fill(String(fixture.paise));

		await expect(
			page.getByText(fixture.totalDisplay, { exact: true })
		).toBeVisible();
		await expect(
			page.getByText(fixture.amountInWords, { exact: true })
		).toBeVisible();

		await page
			.getByRole('button', { name: 'Save Voucher', exact: true })
			.click();
		await expect(
			page.getByRole('heading', { name: 'Cash Vouchers', exact: true })
		).toBeVisible({ timeout: 60_000 });

		const created = await findCashVouchersByCreator(db, fixture.userId);
		expect(created).toHaveLength(1);
		const stored = created[0];
		if (!stored.voucherNumber) {
			throw new Error(
				`[cash-voucher] stored voucher ${stored.id} has no voucher number`
			);
		}
		const voucherNumber = stored.voucherNumber;

		await page.getByPlaceholder('Search vouchers...').fill(voucherNumber);
		const row = page.locator('tbody tr').filter({ hasText: voucherNumber });
		await expect(row).toHaveCount(1);
		await expect(row).toContainText(fixture.payeeName);
		await expect(row).toContainText(fixture.billNo);
		await expect(row).toContainText(fixture.totalDisplay);

		await row
			.getByRole('button', { name: 'Edit Voucher', exact: true })
			.click();

		await expect(page).toHaveURL(/\/admin\/cash-voucher\/edit\/\d+$/);
		await expect(
			page.getByRole('heading', { name: 'Edit Cash Voucher', exact: true })
		).toBeVisible({ timeout: 60_000 });
		await expect(
			page.getByText(`Edit voucher #${voucherNumber}`, { exact: true })
		).toBeVisible();

		await expect(
			page.getByLabel('Voucher number', { exact: true })
		).toHaveValue(voucherNumber);
		await expect(page.getByLabel('Voucher date', { exact: true })).toHaveValue(
			voucherDate
		);
		await expect(
			page.getByRole('button', { name: 'Paid to', exact: true })
		).toContainText(fixture.payeeName);
		await expect(
			page.getByLabel('Bill no. for item 1', { exact: true })
		).toHaveValue(fixture.billNo);
		await expect(
			page.getByLabel('Rupees (Rs) for item 1', { exact: true })
		).toHaveValue(String(fixture.rupees));
		await expect(
			page.getByLabel('Paise (Ps) for item 1', { exact: true })
		).toHaveValue(String(fixture.paise));
		await expect(
			page.getByText(fixture.totalDisplay, { exact: true })
		).toBeVisible();
		await expect(
			page.getByText(fixture.amountInWords, { exact: true })
		).toBeVisible();

		expect(stored.voucherDate).toBe(voucherDate);
		expect(stored.voucherType).toBe('payment');
		expect(stored.paidTo).toBe(fixture.payeeName);
		expect(stored.totalAmount).toBe(fixture.total);
		expect(stored.amountInWords).toBe(fixture.amountInWords);
		expect(stored.status).toBe('pending');
		expect(stored.isDelete).toBe(0);
		expect(stored.createdBy).toBe(fixture.userId);
		expect(stored.lineItems).toEqual([
			{
				sr_no: 1,
				bill_date: '',
				bill_no: fixture.billNo,
				account_head: '',
				amount_rs: String(fixture.rupees),
				amount_ps: String(fixture.paise),
				description: '',
			},
		]);

		const funding = await readFundingMirror(db, stored.id);
		expect(funding).toHaveLength(1);
		expect(funding[0]).toMatchObject({
			transactionNumber: voucherNumber,
			transactionDate: voucherDate,
			creditAmount: fixture.total,
			debitAmount: '0.00',
			entryKind: 'funding',
			currency: 'INR',
			sourceVoucherId: stored.id,
		});
	} finally {
		await fixture.dispose();
	}
});
