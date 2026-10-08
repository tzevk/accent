import bcrypt from 'bcrypt';
import type {
	APIRequestContext,
	Cookie,
	PlaywrightWorkerArgs,
} from '@playwright/test';
import { exec, rows } from './db';

/** Playwright API fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Fixture constants and utilities for Ticket #324:
 * Export version-matched expenditure evidence.
 *
 * Namespace ownership:
 *   projects:            `E2E-EXP-324-*`
 *   expenses / invoices: `E2E-EXP-324-*`, cost UIDs `e2e-324-cost-*`
 *   orders:              `E2E-EXP-324-ORD-*`, order UIDs `ord-e2e-324-*`
 *   settlements:         `E2E-EXP-324-*`, settlement UIDs `e2e-324-settle-*`
 *   budgets:             budget UIDs `bgt-e2e-324-*`
 *   close snapshots:     month `2021-12`, close UID `close-e2e-324-*`
 *   revision events:     month `2021-12`, revision UID `rev-e2e-324-*`
 *   users / roles:       `e2e_324_*`
 *   months:              **2021-11** (open month with mixed costs),
 *                        **2021-12** (closed & revised month)
 *   trusted IPs:         **198.18.0.141** (spec), **.142** (clerk),
 *                        **.143** (outsider)
 */

export const EXCEL_OPEN_MONTH = '2021-11';
export const EXCEL_OPEN_MONTH_DAY = '2021-11-01';
export const EXCEL_CLOSED_MONTH = '2021-12';
export const EXCEL_CLOSED_MONTH_DAY = '2021-12-01';
export const EXCEL_PREFIX = 'E2E-EXP-324';
export const EXCEL_COST_PREFIX = 'e2e-324-cost-';
export const EXCEL_VENDOR = 'E2E-EXP-324 Vendor';

export const EXCEL_PROJECTS = {
	alpha: {
		code: 'E2E-EXP-324-P1',
		title: 'E2E Excel Project Alpha',
		client: 'E2E Excel Client Alpha',
	},
	beta: {
		code: 'E2E-EXP-324-P2',
		title: 'E2E Excel Project Beta',
		client: 'E2E Excel Client Beta',
	},
} as const;

export type ExcelProjectKey = keyof typeof EXCEL_PROJECTS;

export const EXCEL_DIRECT_INR = {
	expenseNumber: 'E2E-EXP-324-D1',
	costUid: 'e2e-324-cost-d1',
	grossAmount: '15000.00',
	currency: 'INR',
	serviceStart: '2021-11-05',
	serviceEnd: '2021-11-20',
	billDate: '2021-11-21',
	recognitionMonth: EXCEL_OPEN_MONTH,
} as const;

export const EXCEL_DIRECT_USD_UNCONVERTED = {
	expenseNumber: 'E2E-EXP-324-D2',
	costUid: 'e2e-324-cost-d2',
	grossAmount: '500.00',
	currency: 'USD',
	serviceStart: '2021-11-10',
	serviceEnd: '2021-11-25',
	billDate: '2021-11-26',
	recognitionMonth: EXCEL_OPEN_MONTH,
} as const;

export const EXCEL_SUPPLIER_INV = {
	invoiceNumber: 'E2E-EXP-324-INV-S1',
	costUid: 'e2e-324-cost-s1',
	grossAmount: '12000.00',
	currency: 'INR',
	invoiceDate: '2021-11-15',
	serviceStart: '2021-11-01',
	serviceEnd: '2021-11-15',
	recognitionMonth: EXCEL_OPEN_MONTH,
} as const;

export const EXCEL_ACCRUAL = {
	accrualNumber: 'E2E-EXP-324-ACC-A1',
	costUid: 'e2e-324-cost-a1',
	grossAmount: '8000.00',
	currency: 'INR',
	serviceStart: '2021-11-10',
	serviceEnd: '2021-11-30',
	recognitionMonth: EXCEL_OPEN_MONTH,
} as const;

export const EXCEL_SETTLEMENT = {
	settlementUid: 'e2e-324-settle-1',
	targetCostUid: 'e2e-324-cost-d1',
	amount: '15000.00',
	currency: 'INR',
	settledOn: '2021-11-22',
	reference: 'E2E-EXP-324-REF-01',
	destination: 'Alpha Vendor Bank Account',
	evidenceReference: 'E2E-EXP-324-EVID-01',
} as const;

export const EXCEL_BUDGET = {
	budgetUid: 'bgt-e2e-324-p1',
	currency: 'INR',
	amount: '50000.00',
	scope: 'project_incurred_cost',
	periodStart: '2021-11-01',
	periodEnd: '2021-11-30',
	approvalEvidence: 'E2E-EXP-324-BUDGET-APPR',
	financialVersion: 1,
} as const;

export const EXCEL_SUPPLIER_ORDER = {
	orderUid: 'ord-e2e-324-supp-1',
	orderNumber: 'E2E-EXP-324-ORD-S1',
	direction: 'supplier',
	counterpartyName: 'Alpha Supplier Co',
	currency: 'INR',
	grossAmount: '25000.00',
	orderDate: '2021-11-02',
	evidenceReference: 'E2E-EXP-324-ORD-EVID-S1',
} as const;

export const EXCEL_CLIENT_ORDER = {
	orderUid: 'ord-e2e-324-client-1',
	orderNumber: 'E2E-EXP-324-ORD-C1',
	direction: 'client',
	counterpartyName: 'E2E Excel Client Alpha',
	currency: 'INR',
	grossAmount: '100000.00',
	orderDate: '2021-11-01',
	evidenceReference: 'E2E-EXP-324-ORD-EVID-C1',
} as const;

export const EXCEL_CLOSED_SNAPSHOT = {
	month: EXCEL_CLOSED_MONTH,
	closeUid: 'close-e2e-324-2021-12',
	financialVersion: 2,
	status: 'closed',
	reviewReason: 'E2E closed month for Excel export evidence',
	evidenceReference: 'E2E-EXP-324-CLOSE-EVID',
	reviewedAt: '2021-12-31 18:00:00',
} as const;

export const EXCEL_REVISION_EVENT = {
	revisionUid: 'rev-e2e-324-2021-12-01',
	month: EXCEL_CLOSED_MONTH,
	closeUid: 'close-e2e-324-2021-12',
	closeVersion: 1,
	targetKind: 'cost',
	targetUid: 'e2e-324-cost-d-rev',
	sourceTable: 'expenses',
	sourceId: 999999,
	command: 'updated',
	priorVersion: 1,
	newVersion: 2,
	reason: 'E2E revised cost post-close verification',
	evidenceReference: 'E2E-EXP-324-REV-EVID',
	createdAt: '2022-01-05 10:00:00',
} as const;

/** Clerk user with all financial source read permissions. */
export const EXCEL_CLERK = {
	username: 'e2e_324_clerk',
	password: 'E2e#Excel324Clerk',
	email: 'e2e.324.clerk@accent.test',
	fullName: 'E2E Excel Clerk',
	roleCode: 'e2e_324_clerk',
	roleName: 'E2E Excel Clerk',
	permissions: ['reports:read', 'other_expenses:read', 'payroll:read'],
	ip: '198.18.0.142',
} as const;

/** Outsider user without financial source permissions. */
export const EXCEL_OUTSIDER = {
	username: 'e2e_324_outsider',
	password: 'E2e#Excel324Outsider',
	email: 'e2e.324.outsider@accent.test',
	fullName: 'E2E Excel Outsider',
	roleCode: 'e2e_324_outsider',
	roleName: 'E2E Excel Outsider',
	permissions: ['reports:read'],
	ip: '198.18.0.143',
} as const;

export const EXCEL_SPEC_IP = '198.18.0.141';

const NAMESPACE_USERS = [EXCEL_CLERK, EXCEL_OUTSIDER];
const MONTH_DAYS = [EXCEL_OPEN_MONTH_DAY, EXCEL_CLOSED_MONTH_DAY];

export interface SeededExpenditureExcel {
	projects: Record<ExcelProjectKey, number>;
	clerkUserId: number;
	outsiderUserId: number;
}

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
			'E2E expenditure-excel fixture identity (e2e/lib/expenditure-excel-fixtures.ts)',
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
			// Optional table
		}
	}
	await exec(
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		[username]
	);
	await exec(`DELETE FROM users WHERE username = ?`, [username]);
	await exec(`DELETE FROM roles_master WHERE role_code = ?`, [user.roleCode]);
}

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
			`[e2e] excel fixture month holds ${foreign.length} Payroll Slip(s) of non-fixture employees. ` +
				'Point the harness at the isolated E2E database.'
		);
	}
}

export async function cleanupExpenditureExcelFixtures(): Promise<number> {
	await assertFixtureMonthsFree();
	const prefix = `${EXCEL_PREFIX}%`;
	let removed = 0;

	removed += (
		await exec(
			`DELETE FROM financial_revision_events WHERE month IN (?, ?) OR revision_uid LIKE 'rev-e2e-324-%'`,
			MONTH_DAYS.map((day) => day.slice(0, 7))
		)
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM financial_close_snapshots WHERE month IN (?, ?) OR close_uid LIKE 'close-e2e-324-%'`,
			MONTH_DAYS.map((day) => day.slice(0, 7))
		)
	).affectedRows;

	try {
		removed += (
			await exec(
				`DELETE FROM financial_settlement_events WHERE settlement_uid LIKE 'e2e-324-%'`
			)
		).affectedRows;
	} catch {
		// table may not have events
	}

	try {
		removed += (
			await exec(
				`DELETE FROM financial_settlements WHERE settlement_uid LIKE 'e2e-324-%' OR reference LIKE ?`,
				[prefix]
			)
		).affectedRows;
	} catch {
		// optional
	}

	try {
		removed += (
			await exec(
				`DELETE FROM project_cost_budget_events WHERE budget_uid LIKE 'bgt-e2e-324-%'`
			)
		).affectedRows;
	} catch {
		// optional
	}

	try {
		removed += (
			await exec(
				`DELETE FROM project_cost_budgets WHERE budget_uid LIKE 'bgt-e2e-324-%'`
			)
		).affectedRows;
	} catch {
		// optional
	}

	try {
		removed += (
			await exec(
				`DELETE FROM order_events WHERE order_uid LIKE 'ord-e2e-324-%'`
			)
		).affectedRows;
	} catch {
		// optional
	}

	removed += (
		await exec(`DELETE FROM orders WHERE order_uid LIKE 'ord-e2e-324-%'`)
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM cost_accruals WHERE cost_uid LIKE ? OR accrual_number LIKE ?`,
			[`${EXCEL_COST_PREFIX}%`, prefix]
		)
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM purchase_invoices WHERE cost_uid LIKE ? OR invoice_number LIKE ?`,
			[`${EXCEL_COST_PREFIX}%`, prefix]
		)
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM expenses WHERE cost_uid LIKE ? OR expense_number LIKE ?`,
			[`${EXCEL_COST_PREFIX}%`, prefix]
		)
	).affectedRows;

	try {
		removed += (
			await exec(`DELETE FROM financial_cost_events WHERE cost_uid LIKE ?`, [
				`${EXCEL_COST_PREFIX}%`,
			])
		).affectedRows;
	} catch {
		// optional
	}

	try {
		removed += (
			await exec(`DELETE FROM financial_cost_links WHERE cost_uid LIKE ?`, [
				`${EXCEL_COST_PREFIX}%`,
			])
		).affectedRows;
	} catch {
		// optional
	}

	removed += (
		await exec(`DELETE FROM projects WHERE project_code LIKE ?`, [prefix])
	).affectedRows;

	for (const user of NAMESPACE_USERS) {
		await cleanupNamespaceUser(user);
	}

	for (const ip of [EXCEL_SPEC_IP, EXCEL_CLERK.ip, EXCEL_OUTSIDER.ip]) {
		try {
			removed += (
				await exec(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?`, [
					`${ip}:%`,
				])
			).affectedRows;
		} catch {
			// In-memory limiter fallback
		}
	}

	return removed;
}

async function registerCostIdentity(
	costUid: string,
	sourceTable: string,
	sourceId: number
): Promise<void> {
	try {
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
				`${EXCEL_PREFIX} evidence`,
				JSON.stringify({ cost_uid: costUid, fixture: true }),
			]
		);
	} catch {
		// Identity tables are optional in legacy schemas
	}
}

export async function seedExpenditureExcelFixtures(): Promise<SeededExpenditureExcel> {
	await cleanupExpenditureExcelFixtures();

	let clerkUserId = 0;
	let outsiderUserId = 0;
	for (const user of NAMESPACE_USERS) {
		const id = await seedNamespaceUser(user);
		if (user.username === EXCEL_CLERK.username) clerkUserId = id;
		if (user.username === EXCEL_OUTSIDER.username) outsiderUserId = id;
	}

	const projects = {} as Record<ExcelProjectKey, number>;
	for (const key of Object.keys(EXCEL_PROJECTS) as ExcelProjectKey[]) {
		const project = EXCEL_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
         VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
			[project.code, project.title, project.client]
		);
		projects[key] = inserted.insertId;
	}

	// Direct cost D1: INR 15,000 on Alpha
	const d1 = EXCEL_DIRECT_INR;
	const d1Inserted = await exec(
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
       VALUES (?, ?, 'E2E Export', 'E2E Sub Category', ?, ?, ?, 0, ?, ?, 'bank', ?, NULL, 0, 0, ?, NULL, ?, 'approved',
               NULL, 0, ?, 'project', 'operating', 'recognized', ?, 'service_period', ?, ?, 'none', NULL,
               ?, ?, ?, 1, 'INR', 1.0, ?, NULL, ?,
               ?, '2021-11-20 09:00:00')`,
		[
			d1.expenseNumber,
			d1.billDate,
			`${EXCEL_PREFIX} direct cost d1`,
			EXCEL_VENDOR,
			d1.grossAmount,
			d1.grossAmount,
			d1.currency,
			EXCEL_VENDOR,
			projects.alpha,
			`${EXCEL_PREFIX} note d1`,
			d1.costUid,
			`${d1.recognitionMonth}-01`,
			d1.serviceStart,
			d1.serviceEnd,
			d1.grossAmount,
			`${EXCEL_PREFIX}-SRC-D1`,
			`${EXCEL_PREFIX}-EVID-D1`,
			d1.billDate,
			d1.grossAmount,
			clerkUserId,
		]
	);
	await registerCostIdentity(d1.costUid, 'expenses', d1Inserted.insertId);

	// Direct cost D2: USD 500 on Beta, unsupported conversion rate
	const d2 = EXCEL_DIRECT_USD_UNCONVERTED;
	const d2Inserted = await exec(
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
       VALUES (?, ?, 'E2E Export', 'E2E Sub Category', ?, ?, ?, 0, ?, ?, 'bank', ?, NULL, 0, 0, ?, NULL, ?, 'approved',
               NULL, 0, ?, 'project', 'operating', 'recognized', ?, 'service_period', ?, ?, 'none', NULL,
               ?, ?, ?, 1, NULL, NULL, NULL, NULL, NULL,
               ?, '2021-11-20 09:00:00')`,
		[
			d2.expenseNumber,
			d2.billDate,
			`${EXCEL_PREFIX} direct cost d2`,
			EXCEL_VENDOR,
			d2.grossAmount,
			d2.grossAmount,
			d2.currency,
			EXCEL_VENDOR,
			projects.beta,
			`${EXCEL_PREFIX} note d2`,
			d2.costUid,
			`${d2.recognitionMonth}-01`,
			d2.serviceStart,
			d2.serviceEnd,
			d2.grossAmount,
			`${EXCEL_PREFIX}-SRC-D2`,
			`${EXCEL_PREFIX}-EVID-D2`,
			clerkUserId,
		]
	);
	await registerCostIdentity(d2.costUid, 'expenses', d2Inserted.insertId);

	// Supplier Invoice S1: INR 12,000 on Beta
	const s1 = EXCEL_SUPPLIER_INV;
	const s1Inserted = await exec(
		`INSERT INTO purchase_invoices
         (invoice_number, invoice_date, due_date, vendor_name, description,
          subtotal, tax_rate, tax_amount, total, amount_paid, balance_due,
          payment_status, status, project_id, po_number, notes, created_by, isDelete,
          cost_uid, cost_classification, recognition_state, recognition_period,
          period_basis, service_period_start, service_period_end, tax_treatment,
          tax_evidence_reference, recognized_amount, source_reference, evidence_reference,
          financial_version, recognized_by, recognized_at, currency, withholding_tax_amount)
       VALUES (?, ?, '2021-12-15', ?, ?, ?, 0, 0, ?, 0, 0, 'unpaid', 'approved', ?, ?, ?, NULL, 0,
               ?, 'project', 'recognized', ?, 'service_period', ?, ?, 'none', NULL,
               ?, ?, ?, 1, ?, '2021-11-20 09:00:00', 'INR', 0)`,
		[
			s1.invoiceNumber,
			s1.invoiceDate,
			EXCEL_VENDOR,
			`${EXCEL_PREFIX} supplier invoice s1`,
			s1.grossAmount,
			s1.grossAmount,
			projects.beta,
			`${EXCEL_PREFIX}-PO-S1`,
			`${EXCEL_PREFIX} invoice note s1`,
			s1.costUid,
			`${s1.recognitionMonth}-01`,
			s1.serviceStart,
			s1.serviceEnd,
			s1.grossAmount,
			`${EXCEL_PREFIX}-SRC-S1`,
			`${EXCEL_PREFIX}-EVID-S1`,
			clerkUserId,
		]
	);
	await registerCostIdentity(
		s1.costUid,
		'purchase_invoices',
		s1Inserted.insertId
	);

	// Cost Accrual A1: INR 8,000 on Alpha
	const a1 = EXCEL_ACCRUAL;
	const a1Inserted = await exec(
		`INSERT INTO cost_accruals
         (accrual_number, cost_uid, description, vendor_name, vendor_reference,
          evidence_basis, cost_classification, project_id, recognition_state, recognition_period,
          period_basis, service_period_start, service_period_end, gross_amount, tax_amount,
          tax_treatment, tax_evidence_reference, currency, recognized_amount, replaced_amount,
          recognized_by, recognized_at, owner_user_id, financial_version, isDelete, created_by)
       VALUES (?, ?, ?, ?, NULL,
               'received_work', 'project', ?, 'recognized', ?, 'service_period', ?, ?, ?, 0,
               'none', NULL, 'INR', ?, 0,
               ?, '2021-11-20 09:00:00', NULL, 1, 0, NULL)`,
		[
			a1.accrualNumber,
			a1.costUid,
			`${EXCEL_PREFIX} accrual a1`,
			EXCEL_VENDOR,
			projects.alpha,
			`${a1.recognitionMonth}-01`,
			a1.serviceStart,
			a1.serviceEnd,
			a1.grossAmount,
			a1.grossAmount,
			clerkUserId,
		]
	);
	await registerCostIdentity(a1.costUid, 'cost_accruals', a1Inserted.insertId);

	// Cash Settlement: INR 15,000 for D1
	const settle = EXCEL_SETTLEMENT;
	await exec(
		`INSERT INTO financial_settlements
         (settlement_uid, target_kind, target_cost_uid, payroll_slip_id,
          movement_kind, amount, currency, settled_on, reference, destination,
          evidence_reference, status, financial_version, created_by)
       VALUES (?, 'cost', ?, NULL, 'payment', ?, ?, ?, ?, ?, ?, 'recorded', 1, ?)`,
		[
			settle.settlementUid,
			settle.targetCostUid,
			settle.amount,
			settle.currency,
			settle.settledOn,
			settle.reference,
			settle.destination,
			settle.evidenceReference,
			clerkUserId,
		]
	);

	// Project Budget: INR 50,000 on Alpha
	const bgt = EXCEL_BUDGET;
	const bgtInserted = await exec(
		`INSERT INTO project_cost_budgets
         (budget_uid, project_id, currency, amount, scope, period_start, period_end,
          basis_note, state, approval_evidence_reference, approved_by, approved_at,
          financial_version, created_by, isDelete)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Approved test budget', 'approved', ?, ?, '2021-11-01 10:00:00',
               ?, ?, 0)`,
		[
			bgt.budgetUid,
			projects.alpha,
			bgt.currency,
			bgt.amount,
			bgt.scope,
			bgt.periodStart,
			bgt.periodEnd,
			bgt.approvalEvidence,
			clerkUserId,
			bgt.financialVersion,
			clerkUserId,
		]
	);
	await exec(
		`INSERT INTO project_cost_budget_events
         (budget_uid, source_table, source_id, version, command, actor_user_id, reason,
          evidence_reference, snapshot)
       VALUES (?, 'project_cost_budgets', ?, 1, 'approved', ?, 'Initial approval', ?, ?)`,
		[
			bgt.budgetUid,
			bgtInserted.insertId,
			clerkUserId,
			bgt.approvalEvidence,
			JSON.stringify({ amount: bgt.amount, currency: bgt.currency }),
		]
	);

	// Supplier Order: INR 25,000 on Alpha
	const so = EXCEL_SUPPLIER_ORDER;
	await exec(
		`INSERT INTO orders
         (order_uid, order_number, direction, counterparty_name, company_id, project_id,
          currency, amount_basis, gross_amount, tax_amount, net_amount,
          client_invoiced_value, order_date, status, firmness, firmness_evidence_reference,
          source_document_reference, evidence_reference, remarks, origin_mapping_id,
          created_from, financial_version, created_by, isDelete)
       VALUES (?, ?, 'supplier', ?, NULL, ?, ?, 'gross', ?, NULL, NULL, NULL, ?, 'approved', 'firm',
               ?, ?, ?, 'Fixture supplier order', NULL, 'entry', 1, NULL, 0)`,
		[
			so.orderUid,
			so.orderNumber,
			so.counterpartyName,
			projects.alpha,
			so.currency,
			so.grossAmount,
			so.orderDate,
			`${EXCEL_PREFIX}-DOC-SO1`,
			so.orderNumber,
			so.evidenceReference,
		]
	);
	await exec(
		`INSERT INTO order_events
           (order_uid, version, event, amount, reference, actor_id, reason, payload, created_at)
         VALUES (?, 1, 'created', NULL, ?, NULL, NULL, ?, ?)`,
		[
			so.orderUid,
			so.orderNumber,
			JSON.stringify({
				status: 'approved',
				amount_basis: 'gross',
				currency: 'INR',
			}),
			`${so.orderDate} 09:00:00`,
		]
	);

	// Client Order: INR 100,000 on Alpha
	const co = EXCEL_CLIENT_ORDER;
	await exec(
		`INSERT INTO orders
         (order_uid, order_number, direction, counterparty_name, company_id, project_id,
          currency, amount_basis, gross_amount, tax_amount, net_amount,
          client_invoiced_value, order_date, status, firmness, firmness_evidence_reference,
          source_document_reference, evidence_reference, remarks, origin_mapping_id,
          created_from, financial_version, created_by, isDelete)
       VALUES (?, ?, 'client', ?, NULL, ?, ?, 'gross', ?, NULL, NULL, NULL, ?, 'approved', 'firm',
               ?, ?, ?, 'Fixture client order', NULL, 'entry', 1, NULL, 0)`,
		[
			co.orderUid,
			co.orderNumber,
			co.counterpartyName,
			projects.alpha,
			co.currency,
			co.grossAmount,
			co.orderDate,
			`${EXCEL_PREFIX}-DOC-CO1`,
			co.orderNumber,
			co.evidenceReference,
		]
	);
	await exec(
		`INSERT INTO order_events
           (order_uid, version, event, amount, reference, actor_id, reason, payload, created_at)
         VALUES (?, 1, 'created', NULL, ?, NULL, NULL, ?, ?)`,
		[
			co.orderUid,
			co.orderNumber,
			JSON.stringify({
				status: 'approved',
				amount_basis: 'gross',
				currency: 'INR',
			}),
			`${co.orderDate} 09:00:00`,
		]
	);

	// Closed month 2021-12 Snapshot
	const snap = EXCEL_CLOSED_SNAPSHOT;
	const dummySnapshotPayload = {
		month: snap.month,
		status: 'closed',
		company: {
			incurred_cost: 35000.0,
			currency: 'INR',
			groups: [],
			conversion: { status: 'reporting' },
		},
		projects: [],
	};
	await exec(
		`INSERT INTO financial_close_snapshots
         (month, close_uid, financial_version, status, snapshot, reviewed_by, reviewed_at,
          review_reason, evidence_reference, created_by, isDelete)
       VALUES (?, ?, ?, 'closed', ?, ?, ?, ?, ?, ?, 0)`,
		[
			snap.month,
			snap.closeUid,
			snap.financialVersion,
			JSON.stringify(dummySnapshotPayload),
			clerkUserId,
			snap.reviewedAt,
			snap.reviewReason,
			snap.evidenceReference,
			clerkUserId,
		]
	);

	// Revision Event in 2021-12
	const rev = EXCEL_REVISION_EVENT;
	await exec(
		`INSERT INTO financial_revision_events
         (revision_uid, month, close_uid, close_version, target_kind, target_uid,
          source_table, source_id, command, prior_version, new_version, actor_user_id,
          reason, evidence_reference, prior_snapshot, new_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			rev.revisionUid,
			rev.month,
			rev.closeUid,
			rev.closeVersion,
			rev.targetKind,
			rev.targetUid,
			rev.sourceTable,
			rev.sourceId,
			rev.command,
			rev.priorVersion,
			rev.newVersion,
			clerkUserId,
			rev.reason,
			rev.evidenceReference,
			JSON.stringify({ amount: 10000, version: 1 }),
			JSON.stringify({ amount: 12000, version: 2 }),
			rev.createdAt,
		]
	);

	return {
		projects,
		clerkUserId,
		outsiderUserId,
	};
}

export async function loginExcelUser(
	playwright: PlaywrightApi,
	baseURL: string,
	key: 'clerk' | 'outsider'
): Promise<APIRequestContext> {
	const user = key === 'clerk' ? EXCEL_CLERK : EXCEL_OUTSIDER;
	const ip = user.ip;
	const probe = await playwright.request.newContext({ baseURL });
	try {
		try {
			await exec(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?`, [
				`${ip}:%:auth`,
			]);
		} catch {
			// In-memory limiter fallback
		}
		const response = await probe.post('/api/login', {
			headers: { 'x-vercel-forwarded-for': ip },
			data: { username: user.username, password: user.password },
		});
		if (!response.ok()) {
			throw new Error(
				`[e2e] loginExcelUser(${key}) failed: POST /api/login -> ${response.status()}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				`[e2e] loginExcelUser(${key}): login succeeded but no session cookie was set`
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
