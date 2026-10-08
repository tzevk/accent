import bcrypt from 'bcrypt';
import type {
	APIRequestContext,
	Cookie,
	PlaywrightWorkerArgs,
} from '@playwright/test';
import { exec } from './db';

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Outward cash settlement fixtures (ticket #318).
 *
 * The module owns one namespace and nothing else:
 *   projects            `E2E-EXP-318-*` (`project_code`)
 *   supplier invoices   `E2E-EXP-318-INV-*` (`invoice_number`), cost UIDs
 *                       `e2e-318-cost-*`
 *   expenses            `E2E-EXP-318-*` (`expense_number` / `vendor_name`)
 *   settlements         `financial_settlements` rows whose `reference`,
 *                       `destination`, or `evidence_reference` starts with
 *                       `E2E-EXP-318`, plus their links and journal rows
 *   payroll             employee `E2E-EXP-318-E1`, run 3/2023, slips of
 *                       `2023-03-01`
 *   petty rows/vouchers `E2E-EXP-318` notes/text, voucher `E2E-EXP-318-*`
 *   legacy/receipt rows  `E2E-EXP-318` vendor/payee/client/transaction text
 *   users/roles         `e2e_318_*`
 *   months              **2023-01 / 2023-02 / 2023-03** — reserved for #318
 *                       for cash: no other slice writes settlement, payroll,
 *                       petty-cash, or legacy receipt rows there, and #320's
 *                       day-less period charges recognize in their own months,
 *                       so cash only ever compares its own before/after cost
 *   trusted IPs         **198.18.0.115** (spec), **.116** (clerk),
 *                       **.117** (outsider) — reserved for #318
 *
 * Other tickets must not read, mutate, or clean these rows, must not use these
 * months for financial fixtures, and must not reuse those trusted IPs.
 */

export const CASH_SERVICE_MONTH = '2023-01';
export const CASH_INVOICE_MONTH = '2023-02';
export const CASH_MONTH = '2023-03';
export const CASH_PREFIX = 'E2E-EXP-318';
export const CASH_COST_PREFIX = 'e2e-318-cost-';
export const CASH_VENDOR = 'E2E-EXP-318 Vendor';

export const CASH_PROJECTS = {
	alpha: {
		code: 'E2E-EXP-318-P1',
		title: 'E2E Cash Alpha',
		client: 'E2E Client Alpha',
	},
	beta: {
		code: 'E2E-EXP-318-P2',
		title: 'E2E Cash Beta',
		client: 'E2E Client Beta',
	},
} as const;

export type CashProjectKey = keyof typeof CASH_PROJECTS;

/** Prior-month service analogue: served in January, invoiced in February. */
export const CASH_INVOICE_A = {
	invoiceNumber: 'E2E-EXP-318-INV-A',
	costUid: 'e2e-318-cost-inv-a',
	grossAmount: '15000.00',
	serviceStart: '2023-01-05',
	serviceEnd: '2023-01-25',
	invoiceDate: '2023-02-03',
	recognitionMonth: '2023-01',
} as const;

/** The partial/final invoice: served and invoiced in February. */
export const CASH_INVOICE_B = {
	invoiceNumber: 'E2E-EXP-318-INV-B',
	costUid: 'e2e-318-cost-inv-b',
	grossAmount: '10000.00',
	serviceStart: '2023-02-02',
	serviceEnd: '2023-02-20',
	invoiceDate: '2023-02-22',
	recognitionMonth: '2023-02',
} as const;

/** A non-operating advance: payment is cash movement, never operating cost. */
export const CASH_ADVANCE = {
	expenseNumber: 'E2E-EXP-318-ADV-1',
	costUid: 'e2e-318-cost-adv-1',
	amount: '5000.00',
	billDate: '2023-02-10',
	recognitionMonth: '2023-02',
} as const;

/** The payroll slip the native mark-paid control pays out. */
export const CASH_SLIP = {
	employeeCode: 'E2E-EXP-318-E1',
	firstName: 'E2E',
	lastName: 'Cash One',
	email: 'e2e.318.cash.one@accent.test',
	month: '2023-03-01',
	gross: '50000.00',
	basic: '30000.00',
	hra: '10000.00',
	conveyance: '5000.00',
	callAllowance: '5000.00',
	totalEarnings: '50000.00',
	totalDeductions: '2000.00',
	netPay: '48000.00',
	employerCost: '55000.00',
	paymentDate: '2023-03-20',
	paymentReference: 'E2E-EXP-318-NEFT-PAY',
} as const;

/** Bank-into-float funding the cash section shows apart from outward paid. */
export const CASH_FUNDING = {
	voucherNumber: 'E2E-EXP-318-CV-1',
	voucherDate: '2023-03-10',
	amount: '1000.00',
} as const;

/** Third-party spending out of the float: the outward movement. */
export const CASH_SPEND = {
	amount: '800.00',
	transactionDate: '2023-03-12',
} as const;

/**
 * A cash clerk: reads and records settlements (source + financial read, cost
 * update), may mark the month paid (payroll update) through the native
 * control, and may record petty-cash spending. Not a super admin.
 */
export const CASH_CLERK = {
	username: 'e2e_318_cash_clerk',
	password: 'E2e#Cash318Clerk',
	email: 'e2e.318.cash.clerk@accent.test',
	fullName: 'E2E Cash Clerk',
	roleCode: 'e2e_318_cash_clerk',
	roleName: 'E2E Cash Clerk',
	permissions: [
		'reports:read',
		'other_expenses:read',
		'other_expenses:update',
		'payroll:read',
		'payroll:update',
		'petty_cash_expenses:create',
	],
	ip: '198.18.0.116',
} as const;

/** An authenticated user with report access but no source privilege. */
export const CASH_OUTSIDER = {
	username: 'e2e_318_no_cash',
	password: 'E2e#Cash318None',
	email: 'e2e.318.no.cash@accent.test',
	fullName: 'E2E No Cash',
	roleCode: 'e2e_318_no_cash',
	roleName: 'E2E No Cash',
	permissions: ['reports:read'],
	ip: '198.18.0.117',
} as const;

/** The spec's own rate-limit identity. */
export const CASH_SPEC_IP = '198.18.0.115';

export interface SeededCash {
	projects: Record<CashProjectKey, number>;
	invoiceIds: Record<'a' | 'b', number>;
	advanceExpenseId: number;
	slipId: number;
	employeeId: number;
	voucherId: number;
}

const NAMESPACE_USERS = [CASH_CLERK, CASH_OUTSIDER];

async function seedNamespaceUser(user: (typeof NAMESPACE_USERS)[number]) {
	const role = await exec(
		`INSERT INTO roles_master
       (role_code, role_name, role_hierarchy, department, permissions, description, status)
     VALUES (?, ?, 30, 'E2E', ?, ?, 'active')`,
		[
			user.roleCode,
			user.roleName,
			JSON.stringify([...user.permissions]),
			'E2E cash-settlement fixture identity (e2e/lib/expenditure-cash-fixtures.ts)',
		]
	);
	const passwordHash = await bcrypt.hash(user.password, 10);
	await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
		[user.username, passwordHash, user.email, user.fullName, role.insertId]
	);
}

async function cleanupNamespaceUser(user: (typeof NAMESPACE_USERS)[number]) {
	const username = user.username;
	for (const sql of [
		`DELETE FROM user_activity_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		`DELETE FROM payroll_audit_logs WHERE performed_by IN (SELECT id FROM users WHERE username = ?)`,
	]) {
		try {
			await exec(sql, [username]);
		} catch {
			// Optional table — keep purging.
		}
	}
	await exec(
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		[username]
	);
	await exec(`DELETE FROM users WHERE username = ?`, [username]);
	await exec(`DELETE FROM roles_master WHERE role_code = ?`, [user.roleCode]);
}

/**
 * Remove every row this module owns. Safe to run repeatedly: the predicates
 * are the namespaces above, so app-created rows (minted settlement UIDs,
 * random cost UIDs) are found through their namespaced references.
 */
export async function cleanupCashFixtures(): Promise<number> {
	const prefix = `${CASH_PREFIX}%`;
	for (const user of NAMESPACE_USERS) {
		await cleanupNamespaceUser(user);
	}
	let removed = 0;
	// Settlement journal and links reference the settlement rows by identity,
	// so they are purged before the rows themselves disappear.
	removed += (
		await exec(
			`DELETE FROM financial_settlement_events
         WHERE settlement_uid IN (
                 SELECT settlement_uid FROM financial_settlements
                  WHERE reference LIKE ? OR destination LIKE ? OR evidence_reference LIKE ?
               )`,
			[prefix, prefix, prefix]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM financial_cost_links
         WHERE (source_table = 'financial_settlements'
                AND source_id IN (
                  SELECT id FROM financial_settlements
                   WHERE reference LIKE ? OR destination LIKE ? OR evidence_reference LIKE ?))
            OR cost_uid LIKE 'e2e-318-%'
            OR (source_table = 'cash_vouchers'
                AND source_id IN (
                  SELECT id FROM cash_vouchers
                   WHERE paid_to LIKE ? OR description LIKE ? OR notes LIKE ?))
            OR (source_table = 'petty_cash_expenses'
                AND source_id IN (
                  SELECT id FROM petty_cash_expenses
                   WHERE notes LIKE ? OR description LIKE ? OR recipient_name LIKE ?))`,
			[prefix, prefix, prefix, prefix, prefix, prefix, prefix, prefix, prefix]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM financial_settlements
        WHERE reference LIKE ? OR destination LIKE ? OR evidence_reference LIKE ?`,
			[prefix, prefix, prefix]
		)
	).affectedRows;
	// Native payout slips first: they reference the fixture employee.
	removed += (
		await exec(
			`DELETE FROM payroll_slips
        WHERE month IN ('2023-01-01', '2023-02-01', '2023-03-01')
          AND employee_id IN (SELECT id FROM employees WHERE employee_id LIKE ?)`,
			[`${CASH_PREFIX}%`]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM payroll_runs WHERE month = 3 AND year = 2023 AND run_number = 1`
		)
	).affectedRows;
	// Slips of our own employees in any month, before the employee delete:
	// inert gate slips from other fixtures' months survive the month-scoped
	// delete above, and an aborted run leaves them behind to trip the
	// employee delete (FK). Namespace-scoped, so no real data is touched.
	removed += (
		await exec(
			`DELETE FROM payroll_slips
        WHERE employee_id IN (
          SELECT id FROM employees WHERE employee_id LIKE ?
        )`,
			[`${CASH_PREFIX}%`]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM employees WHERE employee_id LIKE ?`, [
			`${CASH_PREFIX}%`,
		])
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM financial_cost_events WHERE cost_uid LIKE 'e2e-318-%'`
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM purchase_invoices WHERE invoice_number LIKE ? OR vendor_name LIKE ?`,
			[prefix, `${CASH_VENDOR}%`]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM expenses WHERE expense_number LIKE ? OR vendor_name LIKE ?`,
			[prefix, prefix]
		)
	).affectedRows;
	const pcePredicate = `(notes LIKE ? OR description LIKE ? OR recipient_name LIKE ?)`;
	// App-recorded spends mint their own cost identities; their journal rows
	// are keyed by that identity, so they go before the spend rows.
	removed += (
		await exec(
			`DELETE FROM financial_cost_events
         WHERE cost_uid IN (
                 SELECT cost_uid FROM petty_cash_expenses WHERE ${pcePredicate}
               )`,
			[prefix, prefix, prefix]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM petty_cash_expenses WHERE ${pcePredicate}`, [
			prefix,
			prefix,
			prefix,
		])
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM cash_vouchers WHERE paid_to LIKE ? OR description LIKE ? OR notes LIKE ?`,
			[prefix, prefix, prefix]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM payment_payables WHERE vendor_name LIKE ?`, [
			prefix,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM payment_issues WHERE payee_name LIKE ?`, [prefix])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM payment_entries WHERE company_name LIKE ?`, [
			prefix,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM payment_receivables WHERE client_name LIKE ?`, [
			prefix,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM invoices WHERE client_name LIKE ?`, [prefix])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM account_transactions WHERE transaction_id LIKE ?`, [
			`${CASH_PREFIX}%`,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code LIKE ?`, [prefix])
	).affectedRows;
	return removed;
}

/** Purge leftovers, then create the projects, costs, slip, legacy rows. */
export async function seedCashFixtures(): Promise<SeededCash> {
	await cleanupCashFixtures();

	const projects = {} as Record<CashProjectKey, number>;
	for (const key of Object.keys(CASH_PROJECTS) as CashProjectKey[]) {
		const project = CASH_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
       VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
			[project.code, project.title, project.client]
		);
		projects[key] = inserted.insertId;
	}

	const invoiceIds = {} as Record<'a' | 'b', number>;
	for (const [key, invoice] of [
		['a', CASH_INVOICE_A],
		['b', CASH_INVOICE_B],
	] as const) {
		const inserted = await exec(
			`INSERT INTO purchase_invoices
         (invoice_number, invoice_date, due_date, vendor_name, description,
          subtotal, tax_rate, tax_amount, total, amount_paid, balance_due,
          payment_status, status, project_id, po_number, notes, created_by, isDelete,
          cost_uid, cost_classification, recognition_state, recognition_period,
          period_basis, service_period_start, service_period_end, tax_treatment,
          tax_evidence_reference, recognized_amount, source_reference, evidence_reference,
          financial_version, recognized_by, recognized_at, currency, withholding_tax_amount)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0, 'unpaid', 'approved', ?, ?, ?, NULL, 0,
               ?, 'project', 'recognized', ?, 'service_period', ?, ?, 'none', NULL,
               ?, ?, ?, 1, NULL, '2023-02-25 09:00:00', 'INR', 0)`,
			[
				invoice.invoiceNumber,
				invoice.invoiceDate,
				'2023-03-15',
				CASH_VENDOR,
				`E2E-EXP-318 supplier invoice ${key}`,
				invoice.grossAmount,
				invoice.grossAmount,
				projects.alpha,
				`E2E-EXP-318-PO-${key}`,
				`E2E-EXP-318 invoice note ${key}`,
				invoice.costUid,
				`${invoice.recognitionMonth}-01`,
				invoice.serviceStart,
				invoice.serviceEnd,
				invoice.grossAmount,
				invoice.invoiceNumber,
				'E2E-EXP-318-GRN1',
			]
		);
		invoiceIds[key] = inserted.insertId;
		await exec(
			`INSERT INTO financial_cost_links
         (cost_uid, source_table, source_id, role, basis, review_state)
       VALUES (?, 'purchase_invoices', ?, 'cost', 'system', 'confirmed')`,
			[invoice.costUid, String(inserted.insertId)]
		);
		await exec(
			`INSERT INTO financial_cost_events
         (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
          evidence_reference, snapshot)
       VALUES (?, 'purchase_invoices', ?, 1, 'recorded', NULL, ?, ?, ?)`,
			[
				invoice.costUid,
				inserted.insertId,
				`E2E fixture ${invoice.invoiceNumber}`,
				'E2E-EXP-318-GRN1',
				JSON.stringify({
					classification: 'project',
					recognition_period: `${invoice.recognitionMonth}-01`,
					currency: 'INR',
					gross_amount: invoice.grossAmount,
					recognized_amount: invoice.grossAmount,
					state: 'recognized',
				}),
			]
		);
	}

	const advance = CASH_ADVANCE;
	const advanceInserted = await exec(
		`INSERT INTO expenses
       (expense_number, expense_date, category, sub_category, description, vendor_name,
        amount, tax_amount, total_amount, currency, payment_mode, paid_to, paid_by,
        is_billable, is_reimbursable, project_id, department, notes, status,
        created_by, isDelete,
        cost_uid, cost_classification, cost_nature, recognition_state, recognition_period, period_basis,
        service_period_start, service_period_end, tax_treatment, tax_evidence_reference,
        recognized_amount, source_reference, evidence_reference, financial_version,
        recognized_by, recognized_at)
       VALUES (?, ?, 'E2E Cash Advance', 'E2E Sub Category', ?, ?, ?, 0, ?, 'INR', 'bank', ?, NULL, 0, 0, ?, NULL, ?, 'approved',
               NULL, 0, ?, 'project', 'advance', 'recognized', ?, 'service_period', ?, ?, 'none', NULL,
               ?, ?, ?, 1, NULL, '2023-02-11 09:00:00')`,
		[
			advance.expenseNumber,
			advance.billDate,
			'E2E-EXP-318 supplier advance (non-operating)',
			CASH_VENDOR,
			advance.amount,
			advance.amount,
			CASH_VENDOR,
			projects.alpha,
			'E2E-EXP-318 advance note',
			advance.costUid,
			`${advance.recognitionMonth}-01`,
			advance.billDate,
			advance.billDate,
			advance.amount,
			advance.expenseNumber,
			'E2E-EXP-318-ADV-PO1',
		]
	);
	await exec(
		`INSERT INTO financial_cost_links
       (cost_uid, source_table, source_id, role, basis, review_state)
     VALUES (?, 'expenses', ?, 'cost', 'system', 'confirmed')`,
		[advance.costUid, String(advanceInserted.insertId)]
	);

	// The payroll slip the native mark-paid control pays out (still unpaid:
	// the spec drives the payout through the real control).
	const slip = CASH_SLIP;
	const employeeInserted = await exec(
		`INSERT INTO employees
         (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
       VALUES (?, ?, ?, ?, 'active', 'Payroll', '2023-01-01', 0)`,
		[slip.employeeCode, slip.firstName, slip.lastName, slip.email]
	);
	await exec(
		`INSERT INTO payroll_runs
         (month, year, run_number, status, total_employees, total_gross,
          total_deductions, total_net_pay, total_employer_contribution)
       VALUES (3, 2023, 1, 'finalized', 1, ?, ?, ?, ?)`,
		[slip.gross, slip.totalDeductions, slip.netPay, slip.employerCost]
	);
	const slipInserted = await exec(
		`INSERT INTO payroll_slips
         (month, employee_id, gross, basic, hra, conveyance, call_allowance,
          other_allowances, total_earnings, pf_employee, pt, total_deductions,
          net_pay, employer_cost, payment_status)
       VALUES ('2023-03-01', ?, ?, ?, ?, ?, ?, 0, ?, 1800.00, 200.00, ?, ?, ?, 'pending')`,
		[
			employeeInserted.insertId,
			slip.gross,
			slip.basic,
			slip.hra,
			slip.conveyance,
			slip.callAllowance,
			slip.totalEarnings,
			slip.totalDeductions,
			slip.netPay,
			slip.employerCost,
		]
	);

	// Undated legacy balance: paid money with no usable date — disclosed,
	// never counted.
	await exec(
		`INSERT INTO payment_payables
         (reference_number, vendor_name, invoice_date, invoice_amount, paid_amount,
          balance_due, currency, status, paid_date, notes, isDelete)
       VALUES ('E2E-EXP-318-PP-1', ?, '2023-02-20', 5000.00, 3000.00, 2000.00,
               'INR', 'paid', NULL, 'E2E-EXP-318 undated legacy balance', 0)`,
		[`${CASH_PREFIX} Legacy Vendor`]
	);
	await exec(
		`INSERT INTO payment_issues
         (payee_name, invoice_number, invoice_date, invoice_amount, amount,
          net_amount, issue_date, status, notes, isDelete)
       VALUES (?, 'E2E-EXP-318-ISS-1', '2023-03-04', 2000.00, 2000.00, 1500.00,
               '2023-03-05', 'full', 'E2E-EXP-318 free-text legacy issue', 0)`,
		[`${CASH_PREFIX} Legacy Payee`]
	);

	// Client receipts and an internal transfer dated in the month: excluded,
	// disclosed, never outward cash.
	await exec(
		`INSERT INTO payment_entries
         (id, company_name, receipt_no, receipt_date, amount, payment_date,
          invoice_no, net_amount, isDelete)
       VALUES ('e2e-318-rc-1', ?, 'E2E-EXP-318-RC-1', '2023-03-08', 9000.00,
               '2023-03-08', 'E2E-EXP-318-CINV-1', 9000.00, 0)`,
		[`${CASH_PREFIX} Client Co`]
	);
	await exec(
		`INSERT INTO payment_receivables
         (reference_number, client_name, invoice_date, invoice_amount, paid_amount,
          balance_due, currency, status, received_date, isDelete)
       VALUES ('E2E-EXP-318-PR-1', ?, '2023-03-01', 6000.00, 4000.00, 2000.00,
               'INR', 'partial', '2023-03-09', 0)`,
		[`${CASH_PREFIX} Client`]
	);
	await exec(
		`INSERT INTO invoices
         (invoice_number, client_name, invoice_date, total, net_amount,
          amount_paid, balance_due, status, isDelete)
       VALUES ('E2E-EXP-318-CINV-1', ?, '2023-03-10', 10000.00, 10000.00,
               7000.00, 3000.00, 'partially_paid', 0)`,
		[`${CASH_PREFIX} Client`]
	);
	await exec(
		`INSERT INTO account_transactions
         (transaction_id, description, category, type, amount, account_from,
          account_to, transaction_date, status)
       VALUES ('E2E-EXP-318-T1', 'E2E-EXP-318 own-account transfer', 'E2E Transfer',
               'transfer', 6000.00, 'E2E Current', 'E2E Petty Float', '2023-03-11', 'completed')`,
		[]
	);

	// Bank-into-float funding: the voucher and its mirrored credit are one
	// funding movement (the same pair the voucher control writes). The clerk
	// cannot create vouchers (admin-only control), so the fixture states the
	// pair directly; the spec records the third-party spend through the real
	// petty-cash control.
	const funding = CASH_FUNDING;
	const voucherInserted = await exec(
		`INSERT INTO cash_vouchers
         (voucher_number, voucher_date, voucher_type, paid_to, payment_mode,
          total_amount, description, status, notes, created_by, isDelete)
       VALUES (?, ?, 'payment', ?, 'bank', ?, ?, 'approved', ?, NULL, 0)`,
		[
			funding.voucherNumber,
			funding.voucherDate,
			`${CASH_PREFIX} Bank Funding`,
			funding.amount,
			'E2E-EXP-318 bank-into-float funding',
			'E2E-EXP-318 funding note',
		]
	);
	const voucherId = voucherInserted.insertId;
	const mirrorUuid = `e2e-318-mirror-${voucherId}`;
	await exec(
		`INSERT INTO petty_cash_expenses
         (id, transaction_number, transaction_date, credit_amount, debit_amount,
          description, status, created_by, source_voucher_id, entry_kind, cost_uid,
          currency, notes, isDelete)
       VALUES (?, ?, ?, ?, 0, ?, 'submitted', NULL, ?, 'funding', ?, 'INR', ?, 0)`,
		[
			mirrorUuid,
			funding.voucherNumber,
			funding.voucherDate,
			funding.amount,
			'E2E-EXP-318 bank-into-float funding',
			voucherId,
			`fund-${voucherId}`,
			'E2E-EXP-318 funding note',
		]
	);
	await exec(
		`INSERT INTO financial_cost_links
         (cost_uid, source_table, source_id, role, basis, review_state, evidence_reference)
       VALUES (?, 'cash_vouchers', ?, 'funding', 'system', 'confirmed', ?)`,
		[`fund-${voucherId}`, String(voucherId), funding.voucherNumber]
	);
	await exec(
		`INSERT INTO financial_cost_links
         (cost_uid, source_table, source_id, role, basis, review_state, evidence_reference)
       VALUES (?, 'petty_cash_expenses', ?, 'mirror', 'system', 'confirmed', ?)`,
		[`fund-${voucherId}`, mirrorUuid, funding.voucherNumber]
	);

	for (const user of NAMESPACE_USERS) {
		await seedNamespaceUser(user);
	}

	return {
		projects,
		invoiceIds,
		advanceExpenseId: advanceInserted.insertId,
		slipId: slipInserted.insertId,
		employeeId: employeeInserted.insertId,
		voucherId,
	};
}

/**
 * Sign one namespace identity in through the real API and return a context
 * carrying that session. The identity's own auth bucket is cleared first
 * (rerun safety) and its trusted-header IP isolates the following API calls.
 */
export async function loginCashUser(
	playwright: PlaywrightApi,
	baseURL: string,
	key: 'clerk' | 'outsider'
): Promise<APIRequestContext> {
	const user = key === 'clerk' ? CASH_CLERK : CASH_OUTSIDER;
	const ip = user.ip;
	const probe = await playwright.request.newContext({ baseURL });
	try {
		try {
			await exec(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?`, [
				`${ip}:%:auth`,
			]);
		} catch {
			// Pre-migration schema — the limiter is in-memory there.
		}
		const response = await probe.post('/api/login', {
			headers: { 'x-vercel-forwarded-for': ip },
			data: { username: user.username, password: user.password },
		});
		if (!response.ok()) {
			throw new Error(
				`[e2e] loginCashUser(${key}) failed: POST /api/login -> ${response.status()}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				`[e2e] loginCashUser(${key}): login succeeded but no session cookie was set`
			);
		}
		const storageState: { cookies: Cookie[]; origins: [] } = {
			cookies: [
				{
					name: 'session',
					value: match[1],
					domain: new URL(baseURL).hostname,
					path: '/',
					expires: -1,
					httpOnly: true,
					secure: false,
					sameSite: 'Lax',
				},
			],
			origins: [],
		};
		return await playwright.request.newContext({
			baseURL,
			extraHTTPHeaders: { 'x-vercel-forwarded-for': ip },
			storageState,
		});
	} finally {
		await probe.dispose();
	}
}
