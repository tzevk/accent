import bcrypt from 'bcrypt';
import type { PlaywrightWorkerArgs } from '@playwright/test';
import type { APIRequestContext, Cookie } from '@playwright/test';
import { exec, rows } from './db';

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Fixtures for supplier commitment consumption (#312).
 *
 * Owns exactly one namespace: orders `E2E-312-*`, costs `e2e-312-cost-*`,
 * projects `E2E-312-P1`, users/roles `e2e_312_*`, months 2018-05/06/07
 * (commitment / consumption / cancellation) and trusted IPs
 * 198.18.0.107/.108/.109. Nothing else is read, mutated, or cleaned.
 *
 * The historical order timeline is seeded directly: the app writes journal
 * timestamps from the wall clock, so a recorded 2018 act is fixture state. The
 * behavior under test (consumption commands, the rollforward read, refusals,
 * authorization) is exercised through the real app and verified against these
 * literals.
 */

export const CONSUMPTION_MONTH = '2018-05';
export const CONSUMPTION_NEXT_MONTH = '2018-06';
export const CONSUMPTION_LATER_MONTH = '2018-07';
export const CONSUMPTION_PREFIX = 'E2E-312-';
export const CONSUMPTION_PROJECT_CODE = 'E2E-312-P1';
export const CONSUMPTION_VENDOR_PREFIX = 'E2E-312 Vendor ';
export const CONSUMPTION_VIEWER_IP = '198.18.0.107';
export const CONSUMPTION_PROCUREMENT_IP = '198.18.0.108';
export const CONSUMPTION_SPEC_IP = '198.18.0.109';

const CONSUMPTION_PROJECT = {
	code: CONSUMPTION_PROJECT_CODE,
	title: 'E2E 312 Commitment Project',
	client: 'E2E-312 Client',
} as const;

const CONSUMPTION_VIEWER_ROLE = {
	roleCode: 'e2e_312_viewer',
	roleName: 'E2E 312 order viewer',
	permissions: ['purchase_orders:read'],
} as const;
const CONSUMPTION_VIEWER_USER = {
	username: 'e2e_312_viewer',
	password: 'E2e312Viewer!',
	email: 'e2e_312_viewer@example.test',
	fullName: 'E2E 312 Order Viewer',
} as const;
const CONSUMPTION_PROCUREMENT_ROLE = {
	roleCode: 'e2e_312_procurement',
	roleName: 'E2E 312 procurement editor',
	permissions: [
		'purchase_orders:read',
		'purchase_orders:create',
		'purchase_orders:update',
		'other_expenses:read',
	],
} as const;
const CONSUMPTION_PROCUREMENT_USER = {
	username: 'e2e_312_procurement',
	password: 'E2e312Procurement!',
	email: 'e2e_312_procurement@example.test',
	fullName: 'E2E 312 Procurement Editor',
} as const;

/** A recognized supplier cost with its native slices. */
interface ConsumptionInvoiceFixture {
	key: string;
	invoiceNumber: string;
	costUid: string;
	currency: string;
	gross: number;
	tax: number;
	/** Frozen recognized amount; null = not recognized (draft). */
	recognized: number | null;
	taxTreatment: string;
	taxEvidence: string | null;
	/** Used when there are no splits. */
	recognitionMonth: string | null;
	splits: Array<{ period: string; amount: number; tax: number }>;
	state: 'recognized' | 'draft';
	description: string;
}

export const CONSUMPTION_INVOICES: readonly ConsumptionInvoiceFixture[] = [
	{
		key: 'INV-1001',
		invoiceNumber: 'E2E-312-INV-1001',
		costUid: 'e2e-312-cost-1001',
		currency: 'INR',
		gross: 3000,
		tax: 0,
		recognized: 3000,
		taxTreatment: 'none',
		taxEvidence: null,
		recognitionMonth: null,
		splits: [{ period: CONSUMPTION_NEXT_MONTH, amount: 3000, tax: 0 }],
		state: 'recognized',
		description: 'E2E-312 timeline consumption slice (3k in June)',
	},
	{
		key: 'INV-1002',
		invoiceNumber: 'E2E-312-INV-1002',
		costUid: 'e2e-312-cost-1002',
		currency: 'USD',
		gross: 100000,
		tax: 0,
		recognized: 100000,
		taxTreatment: 'none',
		taxEvidence: null,
		recognitionMonth: null,
		splits: [
			{ period: CONSUMPTION_NEXT_MONTH, amount: 40000, tax: 0 },
			{ period: CONSUMPTION_NEXT_MONTH, amount: 60000, tax: 0 },
		],
		state: 'recognized',
		description: 'E2E-312 duplicate-month splits (40k + 60k in June)',
	},
	{
		key: 'INV-1003',
		invoiceNumber: 'E2E-312-INV-1003',
		costUid: 'e2e-312-cost-1003',
		currency: 'USD',
		gross: 25000,
		tax: 0,
		recognized: 25000,
		taxTreatment: 'none',
		taxEvidence: null,
		recognitionMonth: null,
		splits: [{ period: CONSUMPTION_NEXT_MONTH, amount: 25000, tax: 0 }],
		state: 'recognized',
		description: 'E2E-312 slice two competing orders fight over',
	},
	{
		key: 'INV-1004',
		invoiceNumber: 'E2E-312-INV-1004',
		costUid: 'e2e-312-cost-1004',
		currency: 'USD',
		gross: 12000,
		tax: 0,
		recognized: null,
		taxTreatment: 'none',
		taxEvidence: null,
		recognitionMonth: null,
		splits: [],
		state: 'draft',
		description: 'E2E-312 unrecognized invoice (must refuse consumption)',
	},
	{
		key: 'INV-1005',
		invoiceNumber: 'E2E-312-INV-1005',
		costUid: 'e2e-312-cost-1005',
		currency: 'INR',
		gross: 50000,
		tax: 9000,
		recognized: 41000,
		taxTreatment: 'recoverable',
		taxEvidence: 'E2E-312-TAX-1005',
		recognitionMonth: null,
		splits: [{ period: CONSUMPTION_NEXT_MONTH, amount: 50000, tax: 9000 }],
		state: 'recognized',
		description: 'E2E-312 net-basis slice (gross 50k, recoverable tax 9k)',
	},
	{
		key: 'INV-1006',
		invoiceNumber: 'E2E-312-INV-1006',
		costUid: 'e2e-312-cost-1006',
		currency: 'USD',
		gross: 5000,
		tax: 0,
		recognized: 5000,
		taxTreatment: 'none',
		taxEvidence: null,
		recognitionMonth: null,
		splits: [{ period: CONSUMPTION_NEXT_MONTH, amount: 5000, tax: 0 }],
		state: 'recognized',
		description: 'E2E-312 slice for release + re-record',
	},
	{
		key: 'INV-1007',
		invoiceNumber: 'E2E-312-INV-1007',
		costUid: 'e2e-312-cost-1007',
		currency: 'USD',
		gross: 5000,
		tax: 0,
		recognized: 5000,
		taxTreatment: 'none',
		taxEvidence: null,
		recognitionMonth: null,
		splits: [{ period: CONSUMPTION_NEXT_MONTH, amount: 5000, tax: 0 }],
		state: 'recognized',
		description: 'E2E-312 slice larger than its order (over-consumption)',
	},
	{
		key: 'INV-1008',
		invoiceNumber: 'E2E-312-INV-1008',
		costUid: 'e2e-312-cost-1008',
		currency: 'USD',
		gross: 20000,
		tax: 0,
		recognized: 20000,
		taxTreatment: 'none',
		taxEvidence: null,
		recognitionMonth: null,
		splits: [{ period: CONSUMPTION_NEXT_MONTH, amount: 20000, tax: 0 }],
		state: 'recognized',
		description: 'E2E-312 slice for the stale order version probe',
	},
	{
		key: 'INV-1009',
		invoiceNumber: 'E2E-312-INV-1009',
		costUid: 'e2e-312-cost-1009',
		currency: 'USD',
		gross: 15000,
		tax: 0,
		recognized: 15000,
		taxTreatment: 'none',
		taxEvidence: null,
		recognitionMonth: null,
		splits: [{ period: CONSUMPTION_NEXT_MONTH, amount: 15000, tax: 0 }],
		state: 'recognized',
		description: 'E2E-312 slice for the concurrent identical requests',
	},
	{
		key: 'INV-1010',
		invoiceNumber: 'E2E-312-INV-1010',
		costUid: 'e2e-312-cost-1010',
		currency: 'USD',
		gross: 20000,
		tax: 0,
		recognized: 20000,
		taxTreatment: 'none',
		taxEvidence: null,
		recognitionMonth: null,
		splits: [{ period: CONSUMPTION_NEXT_MONTH, amount: 20000, tax: 0 }],
		state: 'recognized',
		description: 'E2E-312 slice for the stale source version probe',
	},
] as const;

/** One canonical supplier order with its recorded journal acts. */
interface ConsumptionOrderFixture {
	key: string;
	orderNumber: string;
	direction: 'client' | 'supplier';
	currency: string;
	basis: 'gross' | 'net' | 'unknown';
	/** Stated value on the basis (gross or net column); null = unknown. */
	value: number | null;
	status: string;
	/** Journal acts in order; `at` is the recorded business timestamp. */
	acts: Array<{
		event: 'created' | 'updated';
		at: string;
		status: string | null;
	}>;
	financialVersion: number;
	/** A seeded active consumption: cost key + period + amount. */
	seededConsumption?: { costKey: string; period: string; amount: number };
	/** Seeded client-invoiced rollup (client-side evidence only). */
	clientInvoicedValue?: number;
	orderDate: string;
}

export const CONSUMPTION_ORDERS: readonly ConsumptionOrderFixture[] = [
	{
		key: 'ORD-2001',
		orderNumber: 'E2E-312-ORD-2001',
		direction: 'supplier',
		currency: 'INR',
		basis: 'gross',
		value: 10000,
		status: 'cancelled',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-10 09:00:00`,
				status: 'approved',
			},
			{
				event: 'updated',
				at: `${CONSUMPTION_LATER_MONTH}-15 09:00:00`,
				status: 'cancelled',
			},
		],
		financialVersion: 3,
		seededConsumption: {
			costKey: 'INV-1001',
			period: CONSUMPTION_NEXT_MONTH,
			amount: 3000,
		},
		orderDate: `${CONSUMPTION_MONTH}-10`,
	},
	{
		key: 'ORD-2002',
		orderNumber: 'E2E-312-ORD-2002',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 300000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-15 09:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-15`,
	},
	{
		key: 'ORD-2003',
		orderNumber: 'E2E-312-ORD-2003',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 1000000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-16 09:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-16`,
	},
	{
		key: 'ORD-2005',
		orderNumber: 'E2E-312-ORD-2005',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 200000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-17 09:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-17`,
	},
	{
		key: 'ORD-2006',
		orderNumber: 'E2E-312-ORD-2006',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 200000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-18 09:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-18`,
	},
	{
		key: 'ORD-2007',
		orderNumber: 'E2E-312-ORD-2007',
		direction: 'supplier',
		currency: 'INR',
		basis: 'net',
		value: 300000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-18 10:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-18`,
	},
	{
		key: 'ORD-2008',
		orderNumber: 'E2E-312-ORD-2008',
		direction: 'client',
		currency: 'INR',
		basis: 'gross',
		value: 50000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-19 09:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		clientInvoicedValue: 20000,
		orderDate: `${CONSUMPTION_MONTH}-19`,
	},
	{
		key: 'ORD-2009',
		orderNumber: 'E2E-312-ORD-2009',
		direction: 'supplier',
		currency: 'USD',
		basis: 'unknown',
		value: null,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-19 10:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-19`,
	},
	{
		key: 'ORD-2010',
		orderNumber: 'E2E-312-ORD-2010',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 200000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-20 09:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-20`,
	},
	{
		key: 'ORD-2011',
		orderNumber: 'E2E-312-ORD-2011',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 200000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-20 10:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-20`,
	},
	{
		key: 'ORD-2012',
		orderNumber: 'E2E-312-ORD-2012',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 1000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-21 09:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-21`,
	},
	{
		key: 'ORD-2013',
		orderNumber: 'E2E-312-ORD-2013',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 5000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-21 10:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-21`,
	},
	{
		key: 'ORD-2014',
		orderNumber: 'E2E-312-ORD-2014',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 8000,
		status: 'cancelled',
		acts: [],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-22`,
	},
	{
		key: 'ORD-2015',
		orderNumber: 'E2E-312-ORD-2015',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 400000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-22 09:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-22`,
	},
	{
		key: 'ORD-2016',
		orderNumber: 'E2E-312-ORD-2016',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 300000,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-22 10:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-22`,
	},
	{
		key: 'ORD-2017',
		orderNumber: 'E2E-312-ORD-2017',
		direction: 'supplier',
		currency: 'USD',
		basis: 'gross',
		value: 30000,
		status: 'draft',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-23 09:00:00`,
				status: 'draft',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-23`,
	},
	{
		key: 'ORD-2018',
		orderNumber: 'E2E-312-ORD-2018',
		direction: 'supplier',
		currency: 'EUR',
		basis: 'gross',
		value: null,
		status: 'approved',
		acts: [
			{
				event: 'created',
				at: `${CONSUMPTION_MONTH}-23 10:00:00`,
				status: 'approved',
			},
		],
		financialVersion: 1,
		orderDate: `${CONSUMPTION_MONTH}-23`,
	},
] as const;

/** A pending legacy copy: direction is ambiguous until review resolves it. */
export const CONSUMPTION_LEGACY_COPY = {
	store: 'purchase_orders',
	number: 'E2E-312-LEG-1',
	amount: 42000,
} as const;

export interface SeededConsumptionFixtures {
	month: string;
	nextMonth: string;
	laterMonth: string;
	projectId: number;
	/** Order key → order_uid. */
	orderUids: Record<string, string>;
	/** Invoice key → invoice row id. */
	invoiceIds: Record<string, number>;
	/** Invoice key → cost_uid. */
	costUids: Record<string, string>;
	/** Order key → its single seeded consumption id, when it has one. */
	seededConsumptionIds: Record<string, number>;
}

async function cleanupRoleUser(
	role: { roleCode: string },
	user: { username: string }
): Promise<void> {
	for (const sql of [
		`DELETE FROM user_activity_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
	]) {
		try {
			await exec(sql, [user.username]);
		} catch {
			// Optional table — keep purging.
		}
	}
	await exec(
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		[user.username]
	);
	await exec(`DELETE FROM users WHERE username = ?`, [user.username]);
	await exec(`DELETE FROM roles_master WHERE role_code = ?`, [role.roleCode]);
}

async function seedRoleUser(
	role: { roleCode: string; roleName: string; permissions: readonly string[] },
	user: { username: string; password: string; email: string; fullName: string }
): Promise<void> {
	const insertedRole = await exec(
		`INSERT INTO roles_master
       (role_code, role_name, role_hierarchy, department, permissions, description, status)
     VALUES (?, ?, 40, 'E2E', ?, ?, 'active')`,
		[
			role.roleCode,
			role.roleName,
			JSON.stringify(role.permissions),
			'E2E commitment consumption fixture identity (e2e/lib/order-consumption-fixtures.ts)',
		]
	);
	const passwordHash = await bcrypt.hash(user.password, 10);
	await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
		[
			user.username,
			passwordHash,
			user.email,
			user.fullName,
			insertedRole.insertId,
		]
	);
}

/** Remove every row this module owns. Safe to run repeatedly. */
export async function cleanupOrderConsumptionFixtures(): Promise<number> {
	await cleanupRoleUser(CONSUMPTION_VIEWER_ROLE, CONSUMPTION_VIEWER_USER);
	await cleanupRoleUser(
		CONSUMPTION_PROCUREMENT_ROLE,
		CONSUMPTION_PROCUREMENT_USER
	);

	let removed = 0;
	const orderUidSelector = `SELECT order_uid FROM orders WHERE order_number LIKE ?`;
	const orderUidParams = [`${CONSUMPTION_PREFIX}ORD-%`];

	for (const sql of [
		`DELETE FROM order_consumption_events WHERE order_uid IN (${orderUidSelector}) OR cost_uid LIKE ?`,
		`DELETE FROM order_consumptions WHERE order_uid IN (${orderUidSelector}) OR cost_uid LIKE ?`,
	]) {
		const result = await exec(sql, [...orderUidParams, `e2e-312-cost-%`]);
		removed += result.affectedRows ?? 0;
	}

	removed += (
		await exec(
			`DELETE FROM order_events WHERE order_uid IN (${orderUidSelector})`,
			orderUidParams
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM order_legacy_mappings WHERE document_number LIKE ?`,
			[`${CONSUMPTION_PREFIX}%`]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM orders WHERE order_number LIKE ?`, [
			`${CONSUMPTION_PREFIX}ORD-%`,
		])
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM financial_cost_links
        WHERE cost_uid LIKE ?
           OR (source_table = 'purchase_invoices'
               AND source_id IN (SELECT id FROM purchase_invoices WHERE invoice_number LIKE ?))`,
			[`e2e-312-cost-%`, `${CONSUMPTION_PREFIX}INV-%`]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM financial_cost_events WHERE cost_uid LIKE ?`, [
			`e2e-312-cost-%`,
		])
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM supplier_invoice_periods
        WHERE invoice_id IN (SELECT id FROM purchase_invoices WHERE invoice_number LIKE ?)`,
			[`${CONSUMPTION_PREFIX}INV-%`]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM purchase_invoices WHERE invoice_number LIKE ?`, [
			`${CONSUMPTION_PREFIX}INV-%`,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM purchase_orders WHERE po_number LIKE ?`, [
			`${CONSUMPTION_PREFIX}%`,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code = ?`, [
			CONSUMPTION_PROJECT_CODE,
		])
	).affectedRows;
	return removed;
}

/** Purge leftovers, then create the projects, costs, orders, and journal. */
export async function seedOrderConsumptionFixtures(): Promise<SeededConsumptionFixtures> {
	await cleanupOrderConsumptionFixtures();
	await seedRoleUser(CONSUMPTION_VIEWER_ROLE, CONSUMPTION_VIEWER_USER);
	await seedRoleUser(
		CONSUMPTION_PROCUREMENT_ROLE,
		CONSUMPTION_PROCUREMENT_USER
	);

	const project = await exec(
		`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
     VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
		[
			CONSUMPTION_PROJECT.code,
			CONSUMPTION_PROJECT.title,
			CONSUMPTION_PROJECT.client,
		]
	);
	const projectId = project.insertId;

	const invoiceIds: Record<string, number> = {};
	const costUids: Record<string, string> = {};
	for (const invoice of CONSUMPTION_INVOICES) {
		const inserted = await exec(
			`INSERT INTO purchase_invoices
         (invoice_number, invoice_date, due_date, vendor_name, description,
          subtotal, tax_rate, tax_amount, total, amount_paid, balance_due,
          payment_status, status, project_id, po_number, notes, created_by, isDelete,
          cost_uid, cost_classification, recognition_state, recognition_period,
          period_basis, service_period_start, service_period_end, tax_treatment,
          tax_evidence_reference, recognized_amount, source_reference, evidence_reference,
          financial_version, recognized_by, recognized_at, currency, withholding_tax_amount)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, 'unpaid', ?, ?, ?, ?, NULL, 0,
               ?, 'project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
			[
				invoice.invoiceNumber,
				`${CONSUMPTION_MONTH}-05`,
				`${CONSUMPTION_LATER_MONTH}-05`,
				`${CONSUMPTION_VENDOR_PREFIX}${invoice.key}`,
				invoice.description,
				invoice.gross - invoice.tax,
				invoice.tax,
				invoice.gross,
				invoice.state === 'recognized' ? 'approved' : 'draft',
				projectId,
				invoice.invoiceNumber,
				`E2E note ${invoice.key}`,
				invoice.costUid,
				invoice.state,
				invoice.recognitionMonth ? `${invoice.recognitionMonth}-01` : null,
				invoice.splits.length > 0 ? 'service_period' : 'unresolved',
				invoice.splits.length > 0 ? `${invoice.splits[0].period}-01` : null,
				invoice.splits.length > 0
					? `${invoice.splits[invoice.splits.length - 1].period}-28`
					: null,
				invoice.taxTreatment,
				invoice.taxEvidence,
				invoice.recognized,
				invoice.invoiceNumber,
				`E2E-312-EVID-${invoice.key}`,
				invoice.state === 'recognized' ? 1 : null,
				invoice.state === 'recognized'
					? `${CONSUMPTION_MONTH}-31 09:00:00`
					: null,
				invoice.currency,
			]
		);
		invoiceIds[invoice.key] = inserted.insertId;
		costUids[invoice.key] = invoice.costUid;
		for (const split of invoice.splits) {
			await exec(
				`INSERT INTO supplier_invoice_periods
           (invoice_id, service_period_start, service_period_end, recognition_period,
            amount, tax_amount, recognized_amount, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
				[
					inserted.insertId,
					`${split.period}-01`,
					`${split.period}-28`,
					`${split.period}-01`,
					split.amount,
					split.tax,
					invoice.state === 'recognized' ? split.amount - split.tax : null,
					`E2E-312 slice ${invoice.key} ${split.period}`,
				]
			);
		}
		await exec(
			`INSERT INTO financial_cost_links
         (cost_uid, source_table, source_id, role, basis, review_state, evidence_reference, created_by)
       VALUES (?, 'purchase_invoices', ?, 'cost', 'system', 'confirmed', ?, NULL)`,
			[
				invoice.costUid,
				String(inserted.insertId),
				`E2E-312-EVID-${invoice.key}`,
			]
		);
		if (invoice.state === 'recognized') {
			await exec(
				`INSERT INTO financial_cost_events
           (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
            evidence_reference, snapshot)
         VALUES (?, 'purchase_invoices', ?, 1, 'recognized', NULL, ?, ?, ?)`,
				[
					invoice.costUid,
					inserted.insertId,
					'E2E-312 fixture recognition',
					`E2E-312-EVID-${invoice.key}`,
					JSON.stringify({ state: 'recognized', fixture: true }),
				]
			);
		}
	}

	const orderUids: Record<string, string> = {};
	const seededConsumptionIds: Record<string, number> = {};
	for (const order of CONSUMPTION_ORDERS) {
		const orderUid = `ord-e2e-312-${order.key.toLowerCase()}`;
		const gross = order.basis === 'gross' ? order.value : null;
		const net = order.basis === 'net' ? order.value : null;
		await exec(
			`INSERT INTO orders
         (order_uid, order_number, direction, counterparty_name, company_id, project_id,
          currency, amount_basis, gross_amount, tax_amount, net_amount,
          client_invoiced_value, order_date, status, firmness, firmness_evidence_reference,
          source_document_reference, evidence_reference, remarks, origin_mapping_id,
          created_from, financial_version, created_by, isDelete)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'firm', ?, ?, ?, ?, NULL,
               'entry', ?, NULL, 0)`,
			[
				orderUid,
				order.orderNumber,
				order.direction,
				`${CONSUMPTION_VENDOR_PREFIX}${order.key}`,
				order.direction === 'supplier' ? projectId : null,
				order.currency,
				order.basis,
				gross,
				net,
				order.clientInvoicedValue ?? null,
				order.orderDate,
				order.status,
				`E2E-312-DOC-${order.key}`,
				order.orderNumber,
				`E2E-312-EVID-${order.key}`,
				`E2E-312 fixture order ${order.key}`,
				order.financialVersion,
			]
		);
		orderUids[order.key] = orderUid;
		let version = 0;
		for (const act of order.acts) {
			version += 1;
			await exec(
				`INSERT INTO order_events
           (order_uid, version, event, amount, reference, actor_id, reason, payload, created_at)
         VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?)`,
				[
					orderUid,
					version,
					act.event,
					order.orderNumber,
					JSON.stringify({
						status: act.status,
						amount_basis: order.basis,
						currency: order.currency,
					}),
					act.at,
				]
			);
		}
		if (order.seededConsumption) {
			const invoice = CONSUMPTION_INVOICES.find(
				(entry) => entry.key === order.seededConsumption?.costKey
			);
			if (!invoice) {
				throw new Error(
					`[e2e] unknown seeded consumption cost: ${order.seededConsumption.costKey}`
				);
			}
			const inserted = await exec(
				`INSERT INTO order_consumptions
           (order_uid, cost_uid, cost_source, source, amount, tax_basis, currency,
            recognized_period, source_version, state, version, actor_id, reason,
            evidence_reference)
         VALUES (?, ?, 'purchase_invoices', 'invoice', ?, ?, ?, ?, 1, 'active', 1, NULL, ?, ?)`,
				[
					orderUid,
					invoice.costUid,
					order.seededConsumption.amount,
					order.basis === 'unknown' ? 'gross' : order.basis,
					order.currency,
					`${order.seededConsumption.period}-01`,
					'E2E-312 seeded historical consumption',
					`E2E-312-EVID-${order.key}`,
				]
			);
			seededConsumptionIds[order.key] = inserted.insertId;
			await exec(
				`INSERT INTO order_consumption_events
           (consumption_id, order_uid, cost_uid, event, version, amount, tax_basis,
            currency, recognized_period, actor_user_id, reason, evidence_reference, snapshot)
         VALUES (?, ?, ?, 'recorded', 1, ?, ?, ?, ?, NULL, ?, ?, ?)`,
				[
					inserted.insertId,
					orderUid,
					invoice.costUid,
					order.seededConsumption.amount,
					order.basis === 'unknown' ? 'gross' : order.basis,
					order.currency,
					`${order.seededConsumption.period}-01`,
					'E2E-312 seeded historical consumption',
					`E2E-312-EVID-${order.key}`,
					JSON.stringify({ fixture: true }),
				]
			);
		}
	}

	// A pending legacy copy: an ambiguous direction that can never enter the
	// supported commitment until a document-backed review resolves it.
	await exec(
		`INSERT INTO purchase_orders
       (po_number, vendor_name, description, subtotal, tax_rate, tax_amount, discount, total,
        status, po_date, po_amount, net_amount, project_id, isDelete)
     VALUES (?, ?, ?, ?, 0, 0, 0, ?, 'pending', ?, ?, ?, ?, 0)`,
		[
			CONSUMPTION_LEGACY_COPY.number,
			`${CONSUMPTION_VENDOR_PREFIX}legacy`,
			'E2E-312 ambiguous legacy copy',
			CONSUMPTION_LEGACY_COPY.amount,
			CONSUMPTION_LEGACY_COPY.amount,
			`${CONSUMPTION_MONTH}-24`,
			CONSUMPTION_LEGACY_COPY.amount,
			CONSUMPTION_LEGACY_COPY.amount,
			projectId,
		]
	);
	const legacyInserted = await rows<{ id: number }>(
		`SELECT id FROM purchase_orders WHERE po_number = ?`,
		[CONSUMPTION_LEGACY_COPY.number]
	);
	await exec(
		`INSERT INTO order_legacy_mappings
       (legacy_store, legacy_id, document_number, counterparty_name, legacy_amount,
        legacy_date, legacy_status, project_id, review_state, resolved_direction, version)
     VALUES ('purchase_orders', ?, ?, ?, ?, ?, 'pending', ?, 'pending', NULL, 1)`,
		[
			legacyInserted[0]?.id ?? 0,
			CONSUMPTION_LEGACY_COPY.number,
			`${CONSUMPTION_VENDOR_PREFIX}legacy`,
			CONSUMPTION_LEGACY_COPY.amount,
			`${CONSUMPTION_MONTH}-24`,
			projectId,
		]
	);

	return {
		month: CONSUMPTION_MONTH,
		nextMonth: CONSUMPTION_NEXT_MONTH,
		laterMonth: CONSUMPTION_LATER_MONTH,
		projectId,
		orderUids,
		invoiceIds,
		costUids,
		seededConsumptionIds,
	};
}

/**
 * Sign a namespaced fixture user in through the real API and return a context
 * carrying that session (same pattern as the #306/#311 reader helpers).
 */
export async function loginConsumptionFixtureUser(
	playwright: PlaywrightApi,
	baseURL: string,
	user: { username: string; password: string },
	ip: string
): Promise<APIRequestContext> {
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
			const retryAfter = response.headers()['retry-after'];
			throw new Error(
				`[e2e] loginConsumptionFixtureUser(${user.username}) failed: POST /api/login -> ` +
					`${response.status()}${retryAfter ? ` (retry-after: ${retryAfter})` : ''}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				'[e2e] loginConsumptionFixtureUser: login succeeded but no session cookie was set'
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

export async function loginConsumptionViewer(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginConsumptionFixtureUser(
		playwright,
		baseURL,
		CONSUMPTION_VIEWER_USER,
		CONSUMPTION_VIEWER_IP
	);
}

export async function loginConsumptionProcurement(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginConsumptionFixtureUser(
		playwright,
		baseURL,
		CONSUMPTION_PROCUREMENT_USER,
		CONSUMPTION_PROCUREMENT_IP
	);
}
