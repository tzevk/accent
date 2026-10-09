import bcrypt from 'bcrypt';
import type {
	APIRequestContext,
	Cookie,
	PlaywrightWorkerArgs,
} from '@playwright/test';
import { exec, rows } from './db';
import { seedInertGateSlips } from './payroll-gate-slip';

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Financial-close fixtures (ticket #322).
 *
 * The module owns one namespace and nothing else:
 *   projects            `E2E-EXP-322-*` (`project_code`)
 *   expenses            `E2E-EXP-322-*` (`expense_number` / `vendor_name`),
 *                       cost UIDs `e2e-322-cost-*`
 *   supplier invoices   `E2E-EXP-322-INV-*` (`invoice_number`), cost UIDs
 *                       `e2e-322-cost-*`
 *   accruals            `E2E-EXP-322-ACC-*` (`accrual_number`), cost UIDs
 *                       `e2e-322-cost-*`
 *   orders              `E2E-EXP-322-ORD-*` (`order_number`), order UIDs
 *                       `ord-e2e-322-*`
 *   settlements         `financial_settlements` rows whose `reference`,
 *                       `destination`, or `evidence_reference` starts with
 *                       `E2E-EXP-322`, plus their links and journal rows
 *   close snapshots     `financial_close_snapshots` rows for the owned months
 *   payroll             employees `E2E-EXP-322-E*`, runs/slips/allocations of
 *                       `2021-01-01` / `2021-02-01`
 *   assignments         `e2e-322-assign-*` (`user_activity_assignments.id`)
 *   users/roles         `e2e_322_*`
 *   months              **2021-01** (the complete month the spec closes),
 *                       **2021-02** (the incomplete month: draft cost, USD
 *                       cost without conversion evidence, payroll finalized
 *                       but never closed). 2021-03 is read as the empty
 *                       month and is never written. No other slice uses a
 *                       2021 month (petty cash owns 2021-06/2021-08 only),
 *                       so company figures for these months are this
 *                       module's rows alone.
 *   trusted IPs         **198.18.0.118** (spec), **.119** (clerk),
 *                       **.120** (outsider) — reserved for #322
 *
 * Other tickets must not read, mutate, or clean these rows, must not use
 * these months for financial fixtures, and must not reuse those trusted IPs.
 *
 * Money is stated from these literals (business rules in parentheses):
 *   2021-01  D1 direct      12,000.00 INR recognized, project P1
 *            S1 supplier     10,000.00 INR recognized, project P2
 *            A1 accrual       6,000.00 INR recognized, project P1
 *            E1 payroll      recorded through the real generate/finalize
 *                            flow (160 January hours, all on P1, so the
 *                            frozen allocation is 100% P1 with no
 *                            remainder split)
 *            Jan incurred    28,000.00 direct cost plus the recorded
 *                            payroll the spec reads back from the database
 *   2021-02  D2 direct draft  5,000.00 INR (blocker: awaiting recognition)
 *            D3 direct        100.00 USD recognized, no conversion
 *                            evidence (blocker: conversion missing)
 *            E2 payroll      recorded through the real generate/finalize
 *                            flow (96 February hours, all on P1)
 */

export const CLOSE_MONTH = '2021-01';
export const CLOSE_MONTH_DAY = '2021-01-01';
export const OPEN_MONTH = '2021-02';
export const OPEN_MONTH_DAY = '2021-02-01';
/** Read as the empty month; the spec never writes here. */
export const EMPTY_MONTH = '2021-03';
export const CLOSE_PREFIX = 'E2E-EXP-322';
export const CLOSE_COST_PREFIX = 'e2e-322-cost-';
export const CLOSE_VENDOR = 'E2E-EXP-322 Vendor';

export const CLOSE_PROJECTS = {
	alpha: {
		code: 'E2E-EXP-322-P1',
		title: 'E2E Close Alpha',
		client: 'E2E Client Alpha',
	},
	beta: {
		code: 'E2E-EXP-322-P2',
		title: 'E2E Close Beta',
		client: 'E2E Client Beta',
	},
} as const;

export type CloseProjectKey = keyof typeof CLOSE_PROJECTS;

/** The complete month's recognized direct cost (project P1). */
export const CLOSE_DIRECT = {
	expenseNumber: 'E2E-EXP-322-D1',
	costUid: 'e2e-322-cost-d1',
	grossAmount: '12000.00',
	serviceStart: '2021-01-05',
	serviceEnd: '2021-01-20',
	billDate: '2021-01-21',
	recognitionMonth: CLOSE_MONTH,
} as const;

/** The complete month's recognized supplier invoice (project P2). */
export const CLOSE_SUPPLIER = {
	invoiceNumber: 'E2E-EXP-322-INV-S1',
	costUid: 'e2e-322-cost-s1',
	grossAmount: '10000.00',
	serviceStart: '2021-01-02',
	serviceEnd: '2021-01-18',
	invoiceDate: '2021-01-19',
	recognitionMonth: CLOSE_MONTH,
} as const;

/** The complete month's recognized accrual (project P1, never replaced). */
export const CLOSE_ACCRUAL = {
	accrualNumber: 'E2E-EXP-322-ACC-A1',
	costUid: 'e2e-322-cost-a1',
	grossAmount: '6000.00',
	serviceStart: '2021-01-10',
	serviceEnd: '2021-01-15',
	recognitionMonth: CLOSE_MONTH,
} as const;

/** The incomplete month's draft cost: open state blocks the close. */
export const OPEN_DRAFT = {
	expenseNumber: 'E2E-EXP-322-D2',
	costUid: 'e2e-322-cost-d2',
	grossAmount: '5000.00',
	serviceStart: '2021-02-08',
	serviceEnd: '2021-02-09',
	billDate: '2021-02-10',
	recognitionMonth: OPEN_MONTH,
} as const;

/** The incomplete month's USD cost without conversion evidence. */
export const OPEN_USD = {
	expenseNumber: 'E2E-EXP-322-D3',
	costUid: 'e2e-322-cost-d3',
	grossAmount: '100.00',
	serviceStart: '2021-02-11',
	serviceEnd: '2021-02-12',
	billDate: '2021-02-13',
	recognitionMonth: OPEN_MONTH,
} as const;

/** The supported supplier order the complete month consumes. */
export const CLOSE_ORDER = {
	orderUid: 'ord-e2e-322-close-1',
	orderNumber: 'E2E-EXP-322-ORD-1',
	grossValue: '20000.00',
	orderDate: '2021-01-05',
} as const;

/** January employee: 160 January hours, all on P1. */
export const CLOSE_EMPLOYEE = {
	code: 'E2E-EXP-322-E1',
	firstName: 'E2E',
	lastName: 'Close One',
	email: 'e2e.322.close.one@accent.test',
	ctc: '52000.00',
	profileFrom: '2021-01-01',
} as const;

/** February employee: 96 February hours, all on P1. */
export const OPEN_EMPLOYEE = {
	code: 'E2E-EXP-322-E2',
	firstName: 'E2E',
	lastName: 'Close Two',
	email: 'e2e.322.close.two@accent.test',
	ctc: '26000.00',
	profileFrom: '2021-01-01',
} as const;

/**
 * A finance clerk: reads and writes every source the close reviews
 * (cost update/approve, settlement record, payroll generate/finalize,
 * order consumption), and may close a reviewed month. Not a super admin.
 */
export const CLOSE_CLERK = {
	username: 'e2e_322_close_clerk',
	password: 'E2e#Close322Clerk',
	email: 'e2e.322.close.clerk@accent.test',
	fullName: 'E2E Close Clerk',
	roleCode: 'e2e_322_close_clerk',
	roleName: 'E2E Close Clerk',
	permissions: [
		'reports:read',
		'other_expenses:read',
		'other_expenses:create',
		'other_expenses:update',
		'other_expenses:approve',
		'payroll:read',
		'payroll:create',
		'payroll:update',
		'purchase_orders:update',
		// The direct-cost register route (`PUT/DELETE /api/admin/expenses/:id`)
		// gates on `proposals:update`/`proposals:delete` (pre-existing, not
		// this ticket's to change). The clerk carries both so the register
		// refusal tests reach the close guard instead of the auth gate.
		'proposals:update',
		'proposals:delete',
	],
	ip: '198.18.0.119',
} as const;

/** An authenticated user with report access but no source privilege. */
export const CLOSE_OUTSIDER = {
	username: 'e2e_322_no_close',
	password: 'E2e#Close322None',
	email: 'e2e.322.no.close@accent.test',
	fullName: 'E2E No Close',
	roleCode: 'e2e_322_no_close',
	roleName: 'E2E No Close',
	permissions: ['reports:read'],
	ip: '198.18.0.120',
} as const;

/** The spec's own rate-limit identity. */
export const CLOSE_SPEC_IP = '198.18.0.118';

export interface SeededClose {
	projects: Record<CloseProjectKey, number>;
	expenseIds: Record<'d1' | 'd2' | 'd3', number>;
	invoiceId: number;
	accrualId: number;
	employeeIds: Record<'e1' | 'e2', number>;
	clerkUserId: number;
}

const NAMESPACE_USERS = [CLOSE_CLERK, CLOSE_OUTSIDER];
const MONTH_DAYS = [CLOSE_MONTH_DAY, OPEN_MONTH_DAY];

async function seedNamespaceUser(
	user: (typeof NAMESPACE_USERS)[number]
): Promise<number> {
	const role = await exec(
		`INSERT INTO roles_master
       (role_code, role_name, role_hierarchy, department, permissions, description, status)
      VALUES (?, ?, 30, 'E2E', ?, ?, 'active')`,
		[
			user.roleCode,
			user.roleName,
			JSON.stringify([...user.permissions]),
			'E2E financial-close fixture identity (e2e/lib/expenditure-close-fixtures.ts)',
		]
	);
	const passwordHash = await bcrypt.hash(user.password, 10);
	const inserted = await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
      VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
		[user.username, passwordHash, user.email, user.fullName, role.insertId]
	);
	return inserted.insertId;
}

async function cleanupNamespaceUser(
	user: (typeof NAMESPACE_USERS)[number]
): Promise<void> {
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
 * Refuse the fixture months when they are not ours to clean. Any Payroll
 * Slip in 2021-01/2021-02 that does not belong to an `E2E-` fixture
 * Employee — or a locked Payroll Run with no fixture slips to prove
 * ownership — stops cleanup and seed before anything is deleted or written.
 */
async function assertFixtureMonthsFree(): Promise<void> {
	const slips = await rows<{ month: string; code: string | null }>(
		`SELECT ps.month, e.employee_id AS code
       FROM payroll_slips ps
       LEFT JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month IN (?, ?)`,
		MONTH_DAYS
	);
	const foreign = slips.filter(
		(slip) => !String(slip.code ?? '').startsWith('E2E-')
	);
	if (foreign.length > 0) {
		throw new Error(
			`[e2e] close fixture month holds ${foreign.length} Payroll Slip(s) of non-fixture employees ` +
				`(e.g. ${foreign[0].code ?? 'unknown employee'}). Point the harness at the isolated E2E database ` +
				'instead of touching real payroll data.'
		);
	}
	const locked = await rows<{ month: number; status: string }>(
		`SELECT month, status FROM payroll_runs
      WHERE year = 2021 AND month IN (1, 2) AND status <> 'draft'`
	);
	for (const run of locked) {
		const monthDay = `2021-${String(run.month).padStart(2, '0')}-01`;
		const owned = slips.some(
			(slip) => String(slip.month).slice(0, 10) === monthDay
		);
		if (!owned) {
			throw new Error(
				`[e2e] close fixture month ${monthDay} holds a ${run.status} Payroll Run with no fixture slips ` +
					'to prove ownership. Point the harness at the isolated E2E database instead of touching real payroll data.'
			);
		}
	}
}

/**
 * Remove every row this module owns. Safe to run repeatedly: the predicates
 * are the namespaces above, so app-created rows (minted settlement UIDs,
 * the close UID, random cost UIDs) are found through their namespaced
 * references. 2021-03 is never written and never cleaned.
 */
export async function cleanupCloseFixtures(): Promise<number> {
	await assertFixtureMonthsFree();
	const prefix = `${CLOSE_PREFIX}%`;
	let removed = 0;

	removed += (
		await exec(
			`DELETE FROM financial_close_snapshots WHERE month IN (?, ?)`,
			MONTH_DAYS.map((day) => day.slice(0, 7))
		)
	).affectedRows;
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
            OR cost_uid LIKE 'e2e-322-%'`,
			[prefix, prefix, prefix]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM financial_settlements
        WHERE reference LIKE ? OR destination LIKE ? OR evidence_reference LIKE ?`,
			[prefix, prefix, prefix]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM financial_cost_events WHERE cost_uid LIKE 'e2e-322-%'`
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM order_consumption_events
         WHERE order_uid LIKE 'ord-e2e-322-%' OR cost_uid LIKE 'e2e-322-%'`
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM order_consumptions
         WHERE order_uid LIKE 'ord-e2e-322-%' OR cost_uid LIKE 'e2e-322-%'`
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM order_events WHERE order_uid LIKE 'ord-e2e-322-%'`)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM orders WHERE order_uid LIKE 'ord-e2e-322-%'`)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM purchase_invoices WHERE invoice_number LIKE ? OR vendor_name LIKE ?`,
			[prefix, `${CLOSE_VENDOR}%`]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM cost_accruals WHERE accrual_number LIKE ? OR vendor_name LIKE ?`,
			[prefix, prefix]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM expenses WHERE expense_number LIKE ? OR vendor_name LIKE ?`,
			[prefix, prefix]
		)
	).affectedRows;

	const fixtureEmployees = `employee_id IN (
    SELECT id FROM employees WHERE employee_id LIKE 'E2E-%'
  )`;
	removed += (
		await exec(
			`DELETE FROM payroll_employee_allocation_shares
      WHERE allocation_id IN (
        SELECT id FROM payroll_employee_allocations
         WHERE month IN (?, ?) AND ${fixtureEmployees}
      )`,
			MONTH_DAYS
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM payroll_allocation_events
      WHERE allocation_uid IN (
        SELECT allocation_uid FROM payroll_employee_allocations
         WHERE month IN (?, ?) AND ${fixtureEmployees}
      )`,
			MONTH_DAYS
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM payroll_employee_allocations
      WHERE month IN (?, ?) AND ${fixtureEmployees}`,
			MONTH_DAYS
		)
	).affectedRows;
	// Slips Generate wrote for every other fixture namespace in these
	// months go with ours: the guard above proved every slip here is
	// fixture-owned.
	removed += (
		await exec(`DELETE FROM payroll_slips WHERE month IN (?, ?)`, MONTH_DAYS)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM payroll_runs WHERE year = 2021 AND month IN (1, 2)`)
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM user_activity_assignments
       WHERE id LIKE 'e2e-322-assign-%' OR employee_id IN (
         SELECT id FROM employees WHERE employee_id LIKE ?
       )`,
			[`${CLOSE_PREFIX}%`]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM employee_salary_profile
       WHERE employee_id IN (
         SELECT id FROM employees WHERE employee_id LIKE ?
       )`,
			[`${CLOSE_PREFIX}%`]
		)
	).affectedRows;
	// Slips of our own employees in any month, before the employee delete:
	// inert gate slips from other fixtures' months survive the month-scoped
	// slip delete above, and an aborted run leaves them behind to trip the
	// employee delete (FK). Namespace-scoped, so no real data is touched.
	removed += (
		await exec(
			`DELETE FROM payroll_slips
       WHERE employee_id IN (
         SELECT id FROM employees WHERE employee_id LIKE ?
       )`,
			[`${CLOSE_PREFIX}%`]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM employees WHERE employee_id LIKE ?`, [
			`${CLOSE_PREFIX}%`,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code LIKE ?`, [prefix])
	).affectedRows;

	for (const user of NAMESPACE_USERS) {
		await cleanupNamespaceUser(user);
	}
	for (const ip of [CLOSE_SPEC_IP, CLOSE_CLERK.ip, CLOSE_OUTSIDER.ip]) {
		try {
			removed += (
				await exec(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?`, [
					`${ip}:%`,
				])
			).affectedRows;
		} catch {
			// Pre-migration schema — the limiter is in-memory there.
		}
	}
	return removed;
}

async function registerCostIdentity(
	costUid: string,
	sourceTable: string,
	sourceId: number
): Promise<void> {
	await exec(
		`INSERT INTO financial_cost_links
         (cost_uid, source_table, source_id, role, basis, review_state)
       VALUES (?, ?, ?, 'cost', 'system', 'confirmed')`,
		[costUid, sourceTable, String(sourceId)]
	);
	await exec(
		`INSERT INTO financial_cost_events
         (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
          evidence_reference, snapshot)
       VALUES (?, ?, ?, 1, 'recorded', NULL, ?, ?, ?)`,
		[
			costUid,
			sourceTable,
			sourceId,
			`E2E fixture ${costUid}`,
			`${CLOSE_PREFIX} evidence`,
			JSON.stringify({ cost_uid: costUid, fixture: true }),
		]
	);
}

/** Purge leftovers, then create the projects, costs, order, and payroll base. */
export async function seedCloseFixtures(): Promise<SeededClose> {
	await cleanupCloseFixtures();

	let clerkUserId = 0;
	for (const user of NAMESPACE_USERS) {
		const id = await seedNamespaceUser(user);
		if (user.username === CLOSE_CLERK.username) clerkUserId = id;
	}

	const projects = {} as Record<CloseProjectKey, number>;
	for (const key of Object.keys(CLOSE_PROJECTS) as CloseProjectKey[]) {
		const project = CLOSE_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
       VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
			[project.code, project.title, project.client]
		);
		projects[key] = inserted.insertId;
	}

	const expenseIds = {} as Record<'d1' | 'd2' | 'd3', number>;
	const direct = [
		{
			key: 'd1' as const,
			cost: CLOSE_DIRECT,
			state: 'recognized',
			classification: 'project',
			project: projects.alpha,
			currency: 'INR',
			taxTreatment: 'none',
			recognizedAt: '2021-01-25 09:00:00',
		},
		{
			key: 'd2' as const,
			cost: OPEN_DRAFT,
			state: 'draft',
			classification: 'project',
			project: projects.alpha,
			currency: 'INR',
			taxTreatment: 'unresolved',
			recognizedAt: null,
		},
		{
			key: 'd3' as const,
			cost: OPEN_USD,
			state: 'recognized',
			classification: 'project',
			project: projects.beta,
			currency: 'USD',
			taxTreatment: 'none',
			recognizedAt: '2021-02-25 09:00:00',
		},
	];
	for (const entry of direct) {
		const recognized = entry.state === 'recognized';
		const inserted = await exec(
			`INSERT INTO expenses
       (expense_number, expense_date, category, sub_category, description, vendor_name,
        amount, tax_amount, total_amount, currency, payment_mode, paid_to, paid_by,
        is_billable, is_reimbursable, project_id, department, notes, status,
        created_by, isDelete,
        cost_uid, cost_classification, cost_nature, recognition_state, recognition_period, period_basis,
        service_period_start, service_period_end, tax_treatment, tax_evidence_reference,
        recognized_amount, source_reference, evidence_reference, financial_version,
        reporting_currency, conversion_rate, conversion_date,
        conversion_evidence_reference, converted_amount,
        recognized_by, recognized_at)
       VALUES (?, ?, 'E2E Close', 'E2E Sub Category', ?, ?, ?, 0, ?, ?, 'bank', ?, NULL, 0, 0, ?, NULL, ?, 'approved',
               NULL, 0, ?, ?, 'operating', ?, ?, 'service_period', ?, ?, ?, NULL,
               ?, ?, ?, 1, NULL, NULL, NULL, NULL, ?,
               NULL, ?)`,
			[
				entry.cost.expenseNumber,
				entry.cost.billDate,
				`${CLOSE_PREFIX} direct cost ${entry.key}`,
				CLOSE_VENDOR,
				entry.cost.grossAmount,
				entry.cost.grossAmount,
				entry.currency,
				CLOSE_VENDOR,
				entry.project,
				`${CLOSE_PREFIX} note ${entry.key}`,
				entry.cost.costUid,
				entry.classification,
				entry.state,
				`${entry.cost.recognitionMonth}-01`,
				entry.cost.serviceStart,
				entry.cost.serviceEnd,
				entry.taxTreatment,
				recognized ? entry.cost.grossAmount : null,
				`${CLOSE_PREFIX}-SRC-${entry.key}`,
				`${CLOSE_PREFIX}-EVID-${entry.key}`,
				recognized ? entry.cost.grossAmount : null,
				entry.recognizedAt,
			]
		);
		expenseIds[entry.key] = inserted.insertId;
		await registerCostIdentity(
			entry.cost.costUid,
			'expenses',
			inserted.insertId
		);
	}

	const supplier = CLOSE_SUPPLIER;
	const supplierInserted = await exec(
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
               ?, ?, ?, 1, NULL, '2021-01-25 09:00:00', 'INR', 0)`,
		[
			supplier.invoiceNumber,
			supplier.invoiceDate,
			'2021-02-15',
			CLOSE_VENDOR,
			`${CLOSE_PREFIX} supplier invoice s1`,
			supplier.grossAmount,
			supplier.grossAmount,
			projects.beta,
			`${CLOSE_PREFIX}-PO-S1`,
			`${CLOSE_PREFIX} invoice note s1`,
			supplier.costUid,
			`${supplier.recognitionMonth}-01`,
			supplier.serviceStart,
			supplier.serviceEnd,
			supplier.grossAmount,
			`${CLOSE_PREFIX}-SRC-S1`,
			`${CLOSE_PREFIX}-EVID-S1`,
		]
	);
	await registerCostIdentity(
		supplier.costUid,
		'purchase_invoices',
		supplierInserted.insertId
	);

	const accrual = CLOSE_ACCRUAL;
	const accrualInserted = await exec(
		`INSERT INTO cost_accruals
         (accrual_number, cost_uid, description, vendor_name, vendor_reference,
          evidence_basis, cost_classification, project_id, recognition_state, recognition_period,
          period_basis, service_period_start, service_period_end, gross_amount, tax_amount,
          tax_treatment, tax_evidence_reference, currency, recognized_amount, replaced_amount,
          recognized_by, recognized_at, owner_user_id, financial_version, isDelete, created_by)
       VALUES (?, ?, ?, ?, NULL,
               'received_work', 'project', ?, 'recognized', ?, 'service_period', ?, ?, ?, 0,
               'none', NULL, 'INR', ?, 0,
               NULL, '2021-01-25 09:00:00', NULL, 1, 0, NULL)`,
		[
			accrual.accrualNumber,
			accrual.costUid,
			`${CLOSE_PREFIX} accrual a1`,
			CLOSE_VENDOR,
			projects.alpha,
			`${accrual.recognitionMonth}-01`,
			accrual.serviceStart,
			accrual.serviceEnd,
			accrual.grossAmount,
			accrual.grossAmount,
		]
	);
	await registerCostIdentity(
		accrual.costUid,
		'cost_accruals',
		accrualInserted.insertId
	);

	const order = CLOSE_ORDER;
	await exec(
		`INSERT INTO orders
         (order_uid, order_number, direction, counterparty_name, company_id, project_id,
          currency, amount_basis, gross_amount, tax_amount, net_amount,
          client_invoiced_value, order_date, status, firmness, firmness_evidence_reference,
          source_document_reference, evidence_reference, remarks, origin_mapping_id,
          created_from, financial_version, created_by, isDelete)
       VALUES (?, ?, 'supplier', ?, NULL, ?, ?, 'gross', ?, NULL, NULL, ?, ?, 'approved', 'firm', ?, ?, ?, ?, NULL,
               'entry', 1, NULL, 0)`,
		[
			order.orderUid,
			order.orderNumber,
			`${CLOSE_VENDOR} O1`,
			projects.alpha,
			'INR',
			order.grossValue,
			null,
			order.orderDate,
			`${CLOSE_PREFIX}-DOC-O1`,
			order.orderNumber,
			`${CLOSE_PREFIX}-EVID-O1`,
			`${CLOSE_PREFIX} fixture order o1`,
		]
	);
	await exec(
		`INSERT INTO order_events
           (order_uid, version, event, amount, reference, actor_id, reason, payload, created_at)
         VALUES (?, 1, 'created', NULL, ?, NULL, NULL, ?, ?)`,
		[
			order.orderUid,
			order.orderNumber,
			JSON.stringify({
				status: 'approved',
				amount_basis: 'gross',
				currency: 'INR',
			}),
			'2021-01-05 09:00:00',
		]
	);

	const employeeIds = {} as Record<'e1' | 'e2', number>;
	for (const [key, employee] of [
		['e1', CLOSE_EMPLOYEE],
		['e2', OPEN_EMPLOYEE],
	] as const) {
		const inserted = await exec(
			`INSERT INTO employees
         (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
       VALUES (?, ?, ?, ?, 'active', 'Payroll', '2021-01-01', 0)`,
			[employee.code, employee.firstName, employee.lastName, employee.email]
		);
		employeeIds[key] = inserted.insertId;
		await exec(
			`INSERT INTO employee_salary_profile
         (employee_id, gross, gross_salary, employer_cost, other_allowances,
          effective_from, effective_to, is_active, pf_applicable, esic_applicable,
          pt_applicable, mlwf_applicable, bonus_applicable, salary_type,
          std_hours_per_day, std_working_days, tds_percentage,
          loan_amount, loan_amount_per_month, loan_active, advance_amount, advance_active)
       VALUES (?, ?, ?, ?, 0, ?, NULL, 1, 0, 0, 0, 0, 0, 'monthly', 8, 26, 0, 0, 0, 0, 0, 0)`,
			[
				inserted.insertId,
				employee.ctc,
				employee.ctc,
				employee.ctc,
				employee.profileFrom,
			]
		);
	}

	// Logged hours the real Generate prices (ADR-0010: hourly rate x hours).
	// E1 January: 160h, all on P1 (Jan 4-8, 11-15, 18-22, 25-29).
	// E2 February: 96h, all on P1 (Feb 1-5, 8-12, 15-16).
	const entries = (
		month: string,
		days: number[],
		hoursPerDay: number
	): Array<{ date: string; hours: number }> =>
		days.map((day) => ({
			date: `${month}-${String(day).padStart(2, '0')}`,
			hours: hoursPerDay,
		}));
	const assignments: Array<{
		id: string;
		employee: number;
		project: number | null;
		rows: Array<{ date: string; hours: number }>;
		assignedDate: string;
	}> = [
		{
			id: 'e2e-322-assign-e1-p1',
			employee: employeeIds.e1,
			project: projects.alpha,
			rows: entries(
				CLOSE_MONTH,
				[
					4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 25, 26, 27, 28,
					29,
				],
				8
			),
			assignedDate: `${CLOSE_MONTH_DAY} 09:00:00`,
		},
		{
			id: 'e2e-322-assign-e2-p1',
			employee: employeeIds.e2,
			project: projects.alpha,
			rows: entries(OPEN_MONTH, [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 15, 16], 8),
			assignedDate: `${OPEN_MONTH_DAY} 09:00:00`,
		},
	];
	for (const row of assignments) {
		await exec(
			`INSERT INTO user_activity_assignments
         (id, user_id, employee_id, project_id, activity_id, activity_name,
          status, daily_entries, assigned_date)
       VALUES (?, ?, ?, ?, ?, 'E2E close fixture work', 'Completed', ?, ?)`,
			[
				row.id,
				clerkUserId,
				row.employee,
				row.project,
				// activity_id is varchar(36): keep the fixture namespace but
				// shorten '-assign-' to '-act-' so the value fits.
				row.id.replace('-assign-', '-act-'),
				JSON.stringify(row.rows),
				row.assignedDate,
			]
		);
	}

	// Inert zero slips for every other namespace's uncovered employee, so
	// both fixture months can finalize through the real control.
	await seedInertGateSlips({
		monthDay: CLOSE_MONTH_DAY,
		ownPrefix: `${CLOSE_PREFIX}-`,
	});
	await seedInertGateSlips({
		monthDay: OPEN_MONTH_DAY,
		ownPrefix: `${CLOSE_PREFIX}-`,
	});

	return {
		projects,
		expenseIds,
		invoiceId: supplierInserted.insertId,
		accrualId: accrualInserted.insertId,
		employeeIds,
		clerkUserId,
	};
}

export async function loginCloseUser(
	playwright: PlaywrightApi,
	baseURL: string,
	key: 'clerk' | 'outsider'
): Promise<APIRequestContext> {
	const user = key === 'clerk' ? CLOSE_CLERK : CLOSE_OUTSIDER;
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
				`[e2e] loginCloseUser(${key}) failed: POST /api/login -> ${response.status()}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				`[e2e] loginCloseUser(${key}): login succeeded but no session cookie was set`
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
