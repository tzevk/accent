import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readCompanyById,
	readCompanyByName,
	readVendorById,
	readVendorByName,
	seedCompanyCreator,
	seedVendorCreator,
} from '../fixtures/company-vendor.ts';

// The owned Next dev server compiles routes on first visit. Every assertion
// still waits for its observable result; this only bounds compilation time.
test.setTimeout(300_000);

// Actor: an ordinary user whose custom role grants exactly companies:read and
// companies:create — no administrator or super-admin.
// Starting state: no company carries this run's namespaced name.
// Action: Company Master → Add Company → author name, industry, sector,
// website, description and contact tab data → Add Company, then reopen the new
// row from the list and reload its detail page.
// Proof: the reopened detail shows the authored name, industry, description,
// email and phone after a reload; the list row shows the authored contact
// person, designation, email, phone and mobile; an independent database read by
// the owned primary key matches every authored value.
test('company creator saves contact data and reopens the persisted company', async ({
	page,
	db,
	namespace,
}) => {
	const creator = await seedCompanyCreator(db, `${namespace}-company`);
	const draft = creator.draft;
	try {
		expect(await readCompanyByName(db, draft.companyName)).toBeNull();

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, {
			username: creator.username,
			password: creator.password,
		});

		await page.goto('/company');
		await expect(
			page.getByRole('heading', {
				level: 1,
				name: 'Company Master',
				exact: true,
			})
		).toBeVisible();

		await page
			.getByRole('button', { name: 'Add Company', exact: true })
			.click();
		await expect(
			page.getByRole('heading', { name: 'Add New Company', exact: true })
		).toBeVisible();

		await page.locator('input[name="company_name"]').fill(draft.companyName);
		await page.locator('select[name="industry"]').selectOption(draft.industry);
		await page.locator('input[name="sector"]').fill(draft.sector);
		await page.locator('input[name="website"]').fill(draft.website);
		await page.locator('textarea[name="description"]').fill(draft.description);

		await page
			.getByRole('button', { name: 'Contact Info', exact: true })
			.click();
		await page
			.locator('input[name="contact_person"]')
			.fill(draft.contactPerson);
		await page.locator('input[name="designation"]').fill(draft.designation);
		await page.locator('input[name="email"]').fill(draft.email);
		await page.locator('input[name="phone"]').fill(draft.phone);
		await page.locator('input[name="mobile_number"]').fill(draft.mobileNumber);

		let saveMessage: string | null = null;
		page.once('dialog', (dialog) => {
			saveMessage = dialog.message();
			void dialog.accept();
		});
		await page
			.getByRole('button', { name: 'Add Company', exact: true })
			.click();
		await expect
			.poll(() => saveMessage, { timeout: 60_000 })
			.toBe('Company added successfully!');

		const search = page.getByPlaceholder(
			'Search companies by name, contact, or industry...'
		);
		await search.fill(draft.companyName);
		await search.press('Enter');

		const row = page.getByRole('row').filter({ hasText: draft.companyName });
		await expect(row).toBeVisible();
		await expect(row).toContainText(draft.industry);
		await expect(row).toContainText(draft.contactPerson);
		await expect(row).toContainText(draft.designation);
		await expect(row).toContainText(draft.email);
		await expect(row).toContainText(draft.phone);
		await expect(row).toContainText(`M: ${draft.mobileNumber}`);

		await row.getByTitle('View Details', { exact: true }).click();
		await page.waitForURL(/\/company\/\d+$/, { timeout: 60_000 });
		const companyId = Number(
			new URL(page.url()).pathname.split('/').filter(Boolean).pop()
		);

		await expect(
			page.getByRole('heading', {
				level: 1,
				name: draft.companyName,
				exact: true,
			})
		).toBeVisible();
		await expect(page.getByText(draft.industry, { exact: true })).toBeVisible();
		await expect(
			page.getByText(draft.description, { exact: true })
		).toBeVisible();
		await expect(page.getByText(draft.email, { exact: true })).toBeVisible();
		await expect(page.getByText(draft.phone, { exact: true })).toBeVisible();

		// A reload proves the detail page reads the saved row, not a redirect
		// or the previous list's cached payload.
		await page.reload();
		await expect(
			page.getByRole('heading', {
				level: 1,
				name: draft.companyName,
				exact: true,
			})
		).toBeVisible();
		await expect(page.getByText(draft.email, { exact: true })).toBeVisible();
		await expect(page.getByText(draft.phone, { exact: true })).toBeVisible();
		await expect(
			page.getByText(draft.description, { exact: true })
		).toBeVisible();

		const stored = await readCompanyById(db, companyId);
		if (!stored) {
			throw new Error(
				`[company-vendor] company ${companyId} was not persisted`
			);
		}
		expect(stored.companyId).toMatch(/^COM-\d{5}$/);
		expect(stored.companyName).toBe(draft.companyName);
		expect(stored.industry).toBe(draft.industry);
		expect(stored.sector).toBe(draft.sector);
		expect(stored.website).toBe(draft.website);
		expect(stored.description).toBe(draft.description);
		expect(stored.contactPerson).toBe(draft.contactPerson);
		expect(stored.designation).toBe(draft.designation);
		expect(stored.email).toBe(draft.email);
		expect(stored.phone).toBe(draft.phone);
		expect(stored.mobileNumber).toBe(draft.mobileNumber);
		expect(stored.isDelete).toBe(0);
	} finally {
		await creator.dispose();
	}
});

// Actor: an ordinary user whose custom role grants exactly vendors:read and
// vendors:create — no administrator or super-admin.
// Starting state: no vendor carries this run's namespaced name.
// Action: Vendor Master → Add Vendor → author Basic Information, Contact
// Information and Financial Information → Save Vendor, then reopen the new row
// from the list and reload its detail page.
// Proof: after the reload the detail shows the authored type, category,
// status, contact person, designation, phone, email, address, website, bank,
// account, IFSC, currency, payment terms and credit limit; an independent
// database read by the owned primary key matches those values.
test('vendor creator saves Basic, Contact and Financial details that reopen', async ({
	page,
	db,
	namespace,
}) => {
	const creator = await seedVendorCreator(db, `${namespace}-vendor`);
	const draft = creator.draft;
	const addressLine = [
		draft.addressStreet,
		draft.addressCity,
		draft.addressState,
		draft.addressCountry,
		draft.addressPin,
	].join(', ');
	try {
		expect(await readVendorByName(db, draft.vendorName)).toBeNull();

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, {
			username: creator.username,
			password: creator.password,
		});

		await page.goto('/vendors');
		await expect(
			page.getByRole('heading', {
				level: 1,
				name: 'Vendor Master',
				exact: true,
			})
		).toBeVisible();

		await page.getByRole('button', { name: 'Add Vendor', exact: true }).click();
		await page.waitForURL(/\/vendors\/new$/, { timeout: 60_000 });
		await expect(
			page.getByRole('heading', {
				level: 1,
				name: 'Add New Vendor',
				exact: true,
			})
		).toBeVisible();

		// Basic Information.
		await page.locator('input[name="vendor_name"]').fill(draft.vendorName);
		await page
			.locator('select[name="vendor_type"]')
			.selectOption(draft.vendorType);
		await page
			.locator('select[name="industry_category"]')
			.selectOption(draft.industryCategory);
		await page.locator('select[name="status"]').selectOption(draft.status);

		// Contact Information.
		await page
			.getByRole('button', { name: 'Contact Information', exact: true })
			.click();
		await page
			.locator('input[name="contact_person"]')
			.fill(draft.contactPerson);
		await page
			.locator('input[name="contact_designation"]')
			.fill(draft.contactDesignation);
		await page.locator('input[name="phone"]').fill(draft.phone);
		await page.locator('input[name="email"]').fill(draft.email);
		await page
			.locator('input[name="address_street"]')
			.fill(draft.addressStreet);
		await page.locator('input[name="address_city"]').fill(draft.addressCity);
		await page.locator('input[name="address_state"]').fill(draft.addressState);
		await page
			.locator('input[name="address_country"]')
			.fill(draft.addressCountry);
		await page.locator('input[name="address_pin"]').fill(draft.addressPin);
		await page.locator('input[name="website"]').fill(draft.website);

		// Financial Information.
		await page
			.getByRole('button', { name: 'Financial Information', exact: true })
			.click();
		await page.locator('input[name="bank_name"]').fill(draft.bankName);
		await page
			.locator('input[name="bank_account_no"]')
			.fill(draft.bankAccountNo);
		await page
			.locator('input[name="ifsc_swift_code"]')
			.fill(draft.ifscSwiftCode);
		await page
			.locator('select[name="currency_preference"]')
			.selectOption(draft.currencyPreference);
		await page.locator('input[name="payment_terms"]').fill(draft.paymentTerms);
		await page.locator('input[name="credit_limit"]').fill(draft.creditLimit);

		let saveMessage: string | null = null;
		page.once('dialog', (dialog) => {
			saveMessage = dialog.message();
			void dialog.accept();
		});
		await page
			.getByRole('button', { name: 'Save Vendor', exact: true })
			.click();
		await expect
			.poll(() => saveMessage, { timeout: 60_000 })
			.toBe('Vendor created successfully!');
		await page.waitForURL(/\/vendors$/, { timeout: 60_000 });

		const search = page.getByPlaceholder('Search vendors...');
		await search.fill(draft.vendorName);
		const row = page.getByRole('row').filter({ hasText: draft.vendorName });
		await expect(row).toBeVisible();
		await expect(row).toContainText(draft.vendorType);
		await expect(row).toContainText(draft.industryCategory);
		await expect(row).toContainText(draft.contactPerson);
		await expect(row).toContainText(draft.phone);
		await expect(row).toContainText(draft.email);
		await expect(row).toContainText(draft.status);

		await row.getByTitle('View', { exact: true }).click();
		await page.waitForURL(/\/vendors\/\d+$/, { timeout: 60_000 });
		const vendorId = Number(
			new URL(page.url()).pathname.split('/').filter(Boolean).pop()
		);

		await expect(
			page.getByRole('heading', {
				level: 1,
				name: draft.vendorName,
				exact: true,
			})
		).toBeVisible();

		const expectReopenedValues = async () => {
			await expect(
				page.getByText(draft.vendorType, { exact: true })
			).toBeVisible();
			await expect(
				page.getByText(draft.industryCategory, { exact: true })
			).toBeVisible();
			await expect(page.getByText(draft.status, { exact: true })).toBeVisible();
			await expect(
				page.getByText(draft.contactPerson, { exact: true })
			).toBeVisible();
			await expect(
				page.getByText(draft.contactDesignation, { exact: true })
			).toBeVisible();
			await expect(page.getByText(draft.phone, { exact: true })).toBeVisible();
			await expect(page.getByText(draft.email, { exact: true })).toBeVisible();
			await expect(page.getByText(addressLine, { exact: true })).toBeVisible();
			await expect(
				page.getByText(draft.website, { exact: true })
			).toBeVisible();
			await expect(
				page.getByText(draft.bankName, { exact: true })
			).toBeVisible();
			await expect(
				page.getByText(draft.bankAccountNo, { exact: true })
			).toBeVisible();
			await expect(
				page.getByText(draft.ifscSwiftCode, { exact: true })
			).toBeVisible();
			await expect(
				page.getByText(draft.currencyPreference, { exact: true })
			).toBeVisible();
			await expect(
				page.getByText(draft.paymentTerms, { exact: true })
			).toBeVisible();
			await expect(
				page.getByText(
					`${draft.currencyPreference} ${Number(draft.creditLimit).toLocaleString('en-US')}`,
					{ exact: true }
				)
			).toBeVisible();
		};

		await expectReopenedValues();

		// A reload proves the detail page reads the saved row, not a redirect
		// or the previous list's cached payload.
		await page.reload();
		await expect(
			page.getByRole('heading', {
				level: 1,
				name: draft.vendorName,
				exact: true,
			})
		).toBeVisible();
		await expectReopenedValues();

		const stored = await readVendorById(db, vendorId);
		if (!stored) {
			throw new Error(`[company-vendor] vendor ${vendorId} was not persisted`);
		}
		expect(stored.vendorId).toMatch(/^\d{3}-\d{2}-\d{4}$/);
		expect(stored.vendorName).toBe(draft.vendorName);
		expect(stored.vendorType).toBe(draft.vendorType);
		expect(stored.industryCategory).toBe(draft.industryCategory);
		expect(stored.status).toBe(draft.status);
		expect(stored.contactPerson).toBe(draft.contactPerson);
		expect(stored.contactDesignation).toBe(draft.contactDesignation);
		expect(stored.phone).toBe(draft.phone);
		expect(stored.email).toBe(draft.email);
		expect(stored.addressStreet).toBe(draft.addressStreet);
		expect(stored.addressCity).toBe(draft.addressCity);
		expect(stored.addressState).toBe(draft.addressState);
		expect(stored.addressCountry).toBe(draft.addressCountry);
		expect(stored.addressPin).toBe(draft.addressPin);
		expect(stored.website).toBe(draft.website);
		expect(stored.bankName).toBe(draft.bankName);
		expect(stored.bankAccountNo).toBe(draft.bankAccountNo);
		expect(stored.ifscSwiftCode).toBe(draft.ifscSwiftCode);
		expect(stored.currencyPreference).toBe(draft.currencyPreference);
		expect(stored.paymentTerms).toBe(draft.paymentTerms);
		expect(stored.creditLimit).toBe('1000.00');
		expect(stored.isDelete).toBe(0);
	} finally {
		await creator.dispose();
	}
});
