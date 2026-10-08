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
 * Financial-revision fixtures (ticket #323).
 *
 * The module owns one namespace and nothing else:
 *   projects            `E2E-EXP-323-*` (`project_code`)
 *   expenses            `E2E-EXP-323-*` (`expense_number` / `vendor_name`),
 *                       cost UIDs `e2e-323-cost-*`
 *   supplier invoices   `E2E-EXP-323-INV-*` (`invoice_number`), cost UIDs
 *                       `e2e-323-cost-*`
 *   accruals            `E2E-EXP-323-ACC-*` (`accrual_number`), cost UIDs
 *                       `e2e-323-cost-*`
 *   orders              `E2E-EXP-323-ORD-*` (`order_number`), order UIDs
 *                       `ord-e2e-323-*`
 *   settlements         `financial_settlements` rows whose `reference`,
 *                       `destination`, or `evidence_reference` starts with
 *                       `E2E-EXP-323`, plus their links and journal rows
 *   close snapshots     `financial_close_snapshots` rows for the owned months
 *   revision events     `financial_revision_events` rows for the owned months
 *   payroll             employees `E2E-EXP-323-E*`, runs/slips/allocations of
 *                       `2021-04-01` / `2021-05-01`
 *   assignments         `e2e-323-assign-*` (`user_activity_assignments.id`)
 *   users/roles         `e2e_323_*`
 *   months              **2021-04** (the complete month the spec closes and
 *                       then revises), **2021-05** (the open month: a draft
 *                       cost blocks its close and ordinary edits stay
 *                       writable there). No other slice uses a 2021-04 or
 *                       2021-05 month (close owns 2021-01/02/03, petty cash
 *                       owns 2021-06/2021-08), so company figures for these
 *                       months are this module's rows alone.
 *   trusted IPs         **198.18.0.121** (spec), **.122** (clerk),
 *                       **.123** (outsider) — reserved for #323
 *
 * Other tickets must not read, mutate, or clean these rows, must not use
 * these months for financial fixtures, and must not reuse those trusted IPs.
 *
 * Money is stated from these literals (business rules in parentheses):
 *   2021-04  D1 direct      12,000.00 INR recognized, project P1
 *            D4 direct       4,000.00 INR recognized, project P1
 *            S1 supplier    10,000.00 INR recognized, project P2, consumed
 *                            by order O1 (20,000.00, remaining 10,000.00)
 *            A1 accrual      6,000.00 INR recognized, project P1
 *            E1 payroll     recorded through the real generate/finalize
 *                            flow (120 April hours, all on P1)
 *            Apr direct     32,000.00 plus the recorded payroll the spec
 *                            reads back from the database
 *   2021-05  D5 direct draft 5,000.00 INR (open state blocks the close and
 *                            stays writable through the ordinary path)
 */

export const REVISION_MONTH = '2021-04';
export const REVISION_MONTH_DAY = '2021-04-01';
export const REVISION_OPEN_MONTH = '2021-05';
export const REVISION_OPEN_MONTH_DAY = '2021-05-01';
export const REVISION_PREFIX = 'E2E-EXP-323';
export const REVISION_COST_PREFIX = 'e2e-323-cost-';
export const REVISION_VENDOR = 'E2E-EXP-323 Vendor';

export const REVISION_PROJECTS = {
	alpha: {
		code: 'E2E-EXP-323-P1',
		title: 'E2E Revision Alpha',
		client: 'E2E Client Alpha',
	},
	beta: {
		code: 'E2E-EXP-323-P2',
		title: 'E2E Revision Beta',
		client: 'E2E Client Beta',
	},
} as const;

export type RevisionProjectKey = keyof typeof REVISION_PROJECTS;

/** The closed month's direct cost on P1 (amount-revision target). */
export const REVISION_DIRECT = {
	expenseNumber: 'E2E-EXP-323-D1',
	costUid: 'e2e-323-cost-d1',
	grossAmount: '12000.00',
	serviceStart: '2021-04-05',
	serviceEnd: '2021-04-20',
	billDate: '2021-04-21',
	recognitionMonth: REVISION_MONTH,
} as const;

/** The closed month's second direct cost on P1 (period-move target). */
export const REVISION_DIRECT_MOVE = {
	expenseNumber: 'E2E-EXP-323-D4',
	costUid: 'e2e-323-cost-d4',
	grossAmount: '4000.00',
	serviceStart: '2021-04-10',
	serviceEnd: '2021-04-12',
	billDate: '2021-04-13',
	recognitionMonth: REVISION_MONTH,
} as const;

/** The closed month's supplier invoice on P2 (consumed, then revised). */
export const REVISION_SUPPLIER = {
	invoiceNumber: 'E2E-EXP-323-INV-S1',
	costUid: 'e2e-323-cost-s1',
	grossAmount: '10000.00',
	serviceStart: '2021-04-02',
	serviceEnd: '2021-04-18',
	invoiceDate: '2021-04-19',
	recognitionMonth: REVISION_MONTH,
} as const;

/** The closed month's accrual on P1 (reclassify, then cancel). */
export const REVISION_ACCRUAL = {
	accrualNumber: 'E2E-EXP-323-ACC-A1',
	costUid: 'e2e-323-cost-a1',
	grossAmount: '6000.00',
	serviceStart: '2021-04-10',
	serviceEnd: '2021-04-15',
	recognitionMonth: REVISION_MONTH,
} as const;

/** The open month's draft cost: open state blocks the close. */
export const REVISION_OPEN_DRAFT = {
	expenseNumber: 'E2E-EXP-323-D5',
	costUid: 'e2e-323-cost-d5',
	grossAmount: '5000.00',
	serviceStart: '2021-05-08',
	serviceEnd: '2021-05-09',
	billDate: '2021-05-10',
	recognitionMonth: REVISION_OPEN_MONTH,
} as const;

/** The order the closed month consumes. */
export const REVISION_ORDER = {
	orderUid: 'ord-e2e-323-rev-1',
	orderNumber: 'E2E-EXP-323-ORD-1',
	grossValue: '20000.00',
	orderDate: '2021-04-05',
} as const;

/** April employee: 120 April hours, all on P1. */
export const REVISION_EMPLOYEE = {
	code: 'E2E-EXP-323-E1',
	firstName: 'E2E',
	lastName: 'Revision One',
	email: 'e2e.323.revision.one@accent.test',
	ctc: '52000.00',
	profileFrom: '2021-04-01',
} as const;

/**
 * A finance clerk: reads and writes every source a revision touches
 * (cost update/approve, settlement record, payroll generate/finalize,
 * order consumption, month close), and may revise a closed month.
 * Not a super admin.
 */
export const REVISION_CLERK = {
	username: 'e2e_323_revise_clerk',
	password: 'E2e#Revise323Clerk',
	email: 'e2e.323.revise.clerk@accent.test',
	fullName: 'E2E Revise Clerk',
	roleCode: 'e2e_323_revise_clerk',
	roleName: 'E2E Revise Clerk',
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
	ip: '198.18.0.122',
} as const;

/** An authenticated user with report access but no source privilege. */
export const REVISION_OUTSIDER = {
	username: 'e2e_323_no_revise',
	password: 'E2e#Revise323None',
	email: 'e2e.323.no.revise@accent.test',
	fullName: 'E2E No Revise',
	roleCode: 'e2e_323_no_revise',
	roleName: 'E2E No Revise',
	permissions: ['reports:read'],
	ip: '198.18.0.123',
} as const;

/** The spec's own rate-limit identity. */
export const REVISION_SPEC_IP = '198.18.0.121';

export interface SeededFinancialRevision {
	projects: Record<RevisionProjectKey, number>;
	expenseIds: Record<'d1' | 'd4' | 'd5', number>;
	invoiceId: number;
	accrualId: number;
	employeeIds: Record<'e1', number>;
	clerkUserId: number;
}

const NAMESPACE_USERS = [REVISION_CLERK, REVISION_OUTSIDER];
const MONTH_DAYS = [REVISION_MONTH_DAY, REVISION_OPEN_MONTH_DAY];

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
			'E2E financial-revision fixture identity (e2e/lib/expenditure-revision-fixtures.ts)',
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
 * Slip in 2021-04/2021-05 that does not belong to an `E2E-` fixture
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
			`[e2e] revision fixture month holds ${foreign.length} Payroll Slip(s) of non-fixture employees ` +
				`(e.g. ${foreign[0].code ?? 'unknown employee'}). Point the harness at the isolated E2E database ` +
				'instead of touching real payroll data.'
		);
	}
	const locked = await rows<{ month: number; status: string }>(
		`SELECT month, status FROM payroll_runs
      WHERE year = 2021 AND month IN (4, 5) AND status <> 'draft'`
	);
	for (const run of locked) {
		const monthDay = `2021-${String(run.month).padStart(2, '0')}-01`;
		const owned = slips.some(
			(slip) => String(slip.month).slice(0, 10) === monthDay
		);
		if (!owned) {
			throw new Error(
				`[e2e] revision fixture month ${monthDay} holds a ${run.status} Payroll Run with no fixture slips ` +
					'to prove ownership. Point the harness at the isolated E2E database instead of touching real payroll data.'
			);
		}
	}
}

/**
 * Remove every row this module owns. Safe to run repeatedly: the predicates
 * are the namespaces above, so app-created rows (minted settlement UIDs,
 * the close UID, revision UIDs, random cost UIDs) are found through their
 * namespaced references.
 */
export async function cleanupFinancialRevisionFixtures(): Promise<number> {
	await assertFixtureMonthsFree();
	const prefix = `${REVISION_PREFIX}%`;
	let removed = 0;

	removed += (
		await exec(`DELETE FROM financial_revision_events WHERE month IN (?, ?)`, [
			REVISION_MONTH,
			REVISION_OPEN_MONTH,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM financial_close_snapshots WHERE month IN (?, ?)`, [
			REVISION_MONTH,
			REVISION_OPEN_MONTH,
		])
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
            OR cost_uid LIKE 'e2e-323-%'`,
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
			`DELETE FROM financial_cost_events WHERE cost_uid LIKE 'e2e-323-%'`
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM order_consumption_events
         WHERE order_uid LIKE 'ord-e2e-323-%' OR cost_uid LIKE 'e2e-323-%'`
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM order_consumptions
         WHERE order_uid LIKE 'ord-e2e-323-%' OR cost_uid LIKE 'e2e-323-%'`
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM order_events WHERE order_uid LIKE 'ord-e2e-323-%'`)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM orders WHERE order_uid LIKE 'ord-e2e-323-%'`)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM purchase_invoices WHERE invoice_number LIKE ? OR vendor_name LIKE ?`,
			[prefix, `${REVISION_VENDOR}%`]
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
		await exec(`DELETE FROM payroll_runs WHERE year = 2021 AND month IN (4, 5)`)
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM user_activity_assignments
       WHERE id LIKE 'e2e-323-assign-%' OR employee_id IN (
         SELECT id FROM employees WHERE employee_id LIKE ?
       )`,
			[`${REVISION_PREFIX}%`]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM employee_salary_profile
       WHERE employee_id IN (
         SELECT id FROM employees WHERE employee_id LIKE ?
       )`,
			[`${REVISION_PREFIX}%`]
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
			[`${REVISION_PREFIX}%`]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM employees WHERE employee_id LIKE ?`, [
			`${REVISION_PREFIX}%`,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code LIKE ?`, [prefix])
	).affectedRows;

	for (const user of NAMESPACE_USERS) {
		await cleanupNamespaceUser(user);
	}
	for (const ip of [
		REVISION_SPEC_IP,
		REVISION_CLERK.ip,
		REVISION_OUTSIDER.ip,
	]) {
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
			`${REVISION_PREFIX} evidence`,
			JSON.stringify({ cost_uid: costUid, fixture: true }),
		]
	);
}

/** Purge leftovers, then create the projects, costs, order, and payroll base. */
export async function seedFinancialRevisionFixtures(): Promise<SeededFinancialRevision> {
	await cleanupFinancialRevisionFixtures();

	let clerkUserId = 0;
	for (const user of NAMESPACE_USERS) {
		const id = await seedNamespaceUser(user);
		if (user.username === REVISION_CLERK.username) clerkUserId = id;
	}

	const projects = {} as Record<RevisionProjectKey, number>;
	for (const key of Object.keys(REVISION_PROJECTS) as RevisionProjectKey[]) {
		const project = REVISION_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
       VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
			[project.code, project.title, project.client]
		);
		projects[key] = inserted.insertId;
	}

	const expenseIds = {} as Record<'d1' | 'd4' | 'd5', number>;
	const direct = [
		{
			key: 'd1' as const,
			cost: REVISION_DIRECT,
			state: 'recognized',
			classification: 'project',
			project: projects.alpha,
			currency: 'INR',
			taxTreatment: 'none',
			recognizedAt: '2021-04-25 09:00:00',
		},
		{
			key: 'd4' as const,
			cost: REVISION_DIRECT_MOVE,
			state: 'recognized',
			classification: 'project',
			project: projects.alpha,
			currency: 'INR',
			taxTreatment: 'none',
			recognizedAt: '2021-04-25 09:00:00',
		},
		{
			key: 'd5' as const,
			cost: REVISION_OPEN_DRAFT,
			state: 'draft',
			classification: 'project',
			project: projects.alpha,
			currency: 'INR',
			taxTreatment: 'unresolved',
			recognizedAt: null,
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
       VALUES (?, ?, 'E2E Revision', 'E2E Sub Category', ?, ?, ?, 0, ?, ?, 'bank', ?, NULL, 0, 0, ?, NULL, ?, 'approved',
               NULL, 0, ?, ?, 'operating', ?, ?, 'service_period', ?, ?, ?, NULL,
               ?, ?, ?, 1, NULL, NULL, NULL, NULL, ?,
               NULL, ?)`,
			[
				entry.cost.expenseNumber,
				entry.cost.billDate,
				`${REVISION_PREFIX} direct cost ${entry.key}`,
				REVISION_VENDOR,
				entry.cost.grossAmount,
				entry.cost.grossAmount,
				entry.currency,
				REVISION_VENDOR,
				entry.project,
				`${REVISION_PREFIX} note ${entry.key}`,
				entry.cost.costUid,
				entry.classification,
				entry.state,
				`${entry.cost.recognitionMonth}-01`,
				entry.cost.serviceStart,
				entry.cost.serviceEnd,
				entry.taxTreatment,
				recognized ? entry.cost.grossAmount : null,
				`${REVISION_PREFIX}-SRC-${entry.key}`,
				`${REVISION_PREFIX}-EVID-${entry.key}`,
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

	const supplier = REVISION_SUPPLIER;
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
               ?, ?, ?, 1, NULL, '2021-04-25 09:00:00', 'INR', 0)`,
		[
			supplier.invoiceNumber,
			supplier.invoiceDate,
			'2021-05-15',
			REVISION_VENDOR,
			`${REVISION_PREFIX} supplier invoice s1`,
			supplier.grossAmount,
			supplier.grossAmount,
			projects.beta,
			`${REVISION_PREFIX}-PO-S1`,
			`${REVISION_PREFIX} invoice note s1`,
			supplier.costUid,
			`${supplier.recognitionMonth}-01`,
			supplier.serviceStart,
			supplier.serviceEnd,
			supplier.grossAmount,
			`${REVISION_PREFIX}-SRC-S1`,
			`${REVISION_PREFIX}-EVID-S1`,
		]
	);
	await registerCostIdentity(
		supplier.costUid,
		'purchase_invoices',
		supplierInserted.insertId
	);

	const accrual = REVISION_ACCRUAL;
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
               NULL, '2021-04-25 09:00:00', NULL, 1, 0, NULL)`,
		[
			accrual.accrualNumber,
			accrual.costUid,
			`${REVISION_PREFIX} accrual a1`,
			REVISION_VENDOR,
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

	const order = REVISION_ORDER;
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
			`${REVISION_VENDOR} O1`,
			projects.alpha,
			'INR',
			order.grossValue,
			null,
			order.orderDate,
			`${REVISION_PREFIX}-DOC-O1`,
			order.orderNumber,
			`${REVISION_PREFIX}-EVID-O1`,
			`${REVISION_PREFIX} fixture order o1`,
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
			'2021-04-05 09:00:00',
		]
	);

	const employeeIds = {} as Record<'e1', number>;
	const employee = REVISION_EMPLOYEE;
	const inserted = await exec(
		`INSERT INTO employees
         (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
       VALUES (?, ?, ?, ?, 'active', 'Payroll', '2021-04-01', 0)`,
		[employee.code, employee.firstName, employee.lastName, employee.email]
	);
	employeeIds.e1 = inserted.insertId;
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

	// Logged hours the real Generate prices (ADR-0010: hourly rate x hours).
	// E1 April: 120h, all on P1 (Apr 5-9, 12-16, 19-23).
	const days = [5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23];
	await exec(
		`INSERT INTO user_activity_assignments
         (id, user_id, employee_id, project_id, activity_id, activity_name,
          status, daily_entries, assigned_date)
       VALUES (?, ?, ?, ?, ?, 'E2E revision fixture work', 'Completed', ?, ?)`,
		[
			'e2e-323-assign-e1-p1',
			clerkUserId,
			employeeIds.e1,
			projects.alpha,
			// activity_id is varchar(36): keep the fixture namespace but
			// shorten '-assign-' to '-act-' so the value fits.
			'e2e-323-act-e1-p1',
			JSON.stringify(
				days.map((day) => ({
					date: `${REVISION_MONTH}-${String(day).padStart(2, '0')}`,
					hours: 8,
				}))
			),
			`${REVISION_MONTH_DAY} 09:00:00`,
		]
	);

	// Inert zero slips for every other namespace's uncovered employee, so
	// the fixture month can finalize through the real control.
	await seedInertGateSlips({
		monthDay: REVISION_MONTH_DAY,
		ownPrefix: `${REVISION_PREFIX}-`,
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

export async function loginFinancialRevisionUser(
	playwright: PlaywrightApi,
	baseURL: string,
	key: 'clerk' | 'outsider'
): Promise<APIRequestContext> {
	const user = key === 'clerk' ? REVISION_CLERK : REVISION_OUTSIDER;
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
				`[e2e] loginFinancialRevisionUser(${key}) failed: POST /api/login -> ${response.status()}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				`[e2e] loginFinancialRevisionUser(${key}): login succeeded but no session cookie was set`
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
