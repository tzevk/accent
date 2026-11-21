import { readFile } from 'node:fs/promises';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import { seedDeskWorkLedger } from '../fixtures/desk-work.ts';

// The owned Next dev server compiles the admin route on first visit. Every
// assertion still waits for its observable result; this only bounds that work.
test.setTimeout(300_000);

// Actor: an ordinary employee with the hook-owned `admin` role code for the
// `/admin` shell and exactly `accounts:read` plus `proposals:read` added
// directly; the ledger list route checks proposals read and the download route
// checks accounts read.
// Starting state: two independently seeded completed transactions owned by a
// unique namespace token, one income with a receipt attachment and one expense.
// Action: open the Accounts page, filter the table to income transactions,
// search for the income transaction id, and click its Download Receipt button.
// Proof: the filtered table shows the income row and hides the expense row; the
// receipt request answers with an application/json content type identifying
// the same transaction and attachment; the browser download is named
// `<transaction_id>.pdf` and contains exactly that receipt payload.
test('filters a ledger transaction and downloads its matching receipt', async ({
	page,
	db,
	namespace,
}) => {
	const ledger = await seedDeskWorkLedger(db, `${namespace}-ledger`);

	try {
		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });

		await signInThroughUi(page, {
			username: ledger.username,
			password: ledger.password,
		});

		await page.goto('/admin/accounts');
		await expect(
			page.getByRole('heading', { name: 'Accounts', exact: true })
		).toBeVisible({ timeout: 60_000 });

		const incomeRow = () =>
			page.getByRole('row').filter({ hasText: ledger.income.transactionId });
		const expenseRow = () =>
			page.getByRole('row').filter({ hasText: ledger.expense.transactionId });
		await expect(incomeRow()).toBeVisible({ timeout: 60_000 });
		await expect(expenseRow()).toBeVisible();

		const filterResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' &&
				url.pathname === '/api/admin/accounts' &&
				url.searchParams.get('type') === 'income'
			);
		});
		await page.getByRole('combobox').selectOption('income');
		expect((await filterResponse).ok()).toBe(true);

		await expect(incomeRow()).toBeVisible();
		await expect(expenseRow()).toHaveCount(0);

		await page
			.getByPlaceholder('Search transactions...')
			.fill(ledger.income.transactionId);
		await expect(incomeRow()).toBeVisible();

		const downloadPromise = page.waitForEvent('download');
		const receiptResponsePromise = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' &&
				url.pathname === '/api/admin/accounts/download' &&
				url.searchParams.get('id') === String(ledger.income.id)
			);
		});
		await incomeRow()
			.getByRole('button', { name: 'Download Receipt', exact: true })
			.click();

		const [download, receiptResponse] = await Promise.all([
			downloadPromise,
			receiptResponsePromise,
		]);
		expect(receiptResponse.ok()).toBe(true);
		expect(receiptResponse.headers()['content-type']).toContain(
			'application/json'
		);

		const receipt = await receiptResponse.json();
		expect(receipt).toMatchObject({
			success: true,
			data: {
				id: ledger.income.id,
				transaction_id: ledger.income.transactionId,
			},
		});
		expect(receipt.data.attachments).toEqual(ledger.income.attachments);

		expect(download.suggestedFilename()).toBe(
			`${ledger.income.transactionId}.pdf`
		);
		const downloadPath = await download.path();
		if (!downloadPath) {
			throw new Error('[accounts-ledger] the receipt download has no file.');
		}
		const downloaded = JSON.parse(await readFile(downloadPath, 'utf8'));
		expect(downloaded).toEqual(receipt);
		expect(downloaded).toMatchObject({
			success: true,
			data: {
				id: ledger.income.id,
				transaction_id: ledger.income.transactionId,
			},
		});
	} finally {
		await ledger.dispose();
	}
});
