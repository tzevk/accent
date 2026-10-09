import bcrypt from 'bcrypt';
import type { PlaywrightWorkerArgs } from '@playwright/test';
import type { APIRequestContext, Cookie } from '@playwright/test';
import { exec } from './db';

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Supplier-invoice recognition fixtures (#311). A separate namespace from the
 * #306 direct-expense fixtures: supplier invoices are their own source store,
 * their own projects, vendors, payables, users, and months (2020-03..2020-05),
 * so neither spec can change the other's expected totals.
 *
 *   1. `seedSupplierInvoiceFixtures()` once before the spec — from global
 *      setup. It cleans up first, so it is idempotent across runs.
 *   2. Run the spec, which records more invoices through the app.
 *   3. `cleanupSupplierInvoiceFixtures()` in the matching teardown.
 * Both use the shared pool in `e2e/lib/db.ts`.
 */

/** The service month the fixture invoices are received in. */
export const SUPPLIER_MONTH = '2020-03';
/** A later invoice month used by the September-service/October-invoice case. */
export const SUPPLIER_INVOICE_MONTH = '2020-04';
/** The payment month; a settlement must not create cost here. */
export const SUPPLIER_LATER_MONTH = '2020-05';
export const SUPPLIER_INVOICE_PREFIX = 'E2E-SINV-';
export const SUPPLIER_PROJECT_CODE_PREFIX = 'E2E-SINV-P';
export const SUPPLIER_COST_UID_PREFIX = 'e2e-311-cost-';
export const SUPPLIER_VENDOR_PREFIX = 'E2E Supplier Vendor ';
export const SUPPLIER_PAYABLE_PREFIX = 'E2E-SINV-PP-';
/** The invoice created and recognized through the browser in the spec. */
export const SUPPLIER_UI_INVOICE = 'E2E-SINV-9001';
/** The split invoice created and recognized through the API in the spec. */
export const SUPPLIER_API_INVOICE = 'E2E-SINV-9002';

export const SUPPLIER_PROJECTS = {
	alpha: {
		code: 'E2E-SINV-P1',
		title: 'E2E Supplier Alpha',
		client: 'E2E Supplier Client Alpha',
	},
	beta: {
		code: 'E2E-SINV-P2',
		title: 'E2E Supplier Beta',
		client: 'E2E Supplier Client Beta',
	},
} as const;

export type SupplierProjectKey = keyof typeof SUPPLIER_PROJECTS;

/**
 * Editor identity: may read/create/update supplier invoices and read the
 * financial report, but has **no** `other_expenses:approve`, so recognition
 * must be refused. Exercises the source/financial privilege split.
 */
export const SUPPLIER_EDITOR_USER = {
	username: 'e2e_311_editor',
	password: 'E2e#Supplier1',
	email: 'e2e.311.editor@accent.test',
	fullName: 'E2E Supplier Editor',
} as const;

/** Report reader without any expense/supplier read privilege (`reports:read`). */
export const SUPPLIER_REPORTS_ONLY_USER = {
	username: 'e2e_311_reports_only',
	password: 'E2e#Supplier2',
	email: 'e2e.311.reports.only@accent.test',
	fullName: 'E2E Supplier Reports Only',
} as const;

const SUPPLIER_EDITOR_ROLE = {
	roleCode: 'e2e_311_editor_role',
	roleName: 'E2E Supplier Editor',
	permissions: [
		'purchase_orders:read',
		'purchase_orders:create',
		'purchase_orders:update',
		'reports:read',
		'other_expenses:read',
		'other_expenses:create',
		'other_expenses:update',
	],
} as const;

const SUPPLIER_REPORTS_ONLY_ROLE = {
	roleCode: 'e2e_311_reports_only_role',
	roleName: 'E2E Supplier Reports Reader',
	permissions: ['reports:read'],
} as const;

/** Distinct login/API rate-limit identities (ADR-0013), never 198.18.0.2x. */
const SUPPLIER_EDITOR_IP = '198.18.0.71';
const SUPPLIER_REPORTS_ONLY_IP = '198.18.0.72';

export type SupplierState =
	| 'draft'
	| 'pending_evidence'
	| 'recognized'
	| 'rejected'
	| 'cancelled';

export type SupplierClassification =
	| 'project'
	| 'company_overhead'
	| 'unallocated'
	| null;

export interface SeedSupplierSplit {
	serviceStart: string | null;
	serviceEnd: string;
	amount: string;
	taxAmount: string;
	/** Frozen slice result; null until the invoice is recognized. */
	recognizedAmount: string | null;
}

export interface SeedSupplierInvoice {
	key: string;
	invoiceNumber: string;
	costUid: string;
	classification: SupplierClassification;
	project: SupplierProjectKey | null;
	state: SupplierState;
	/** Recognition month (`YYYY-MM`); null = placed by invoice date. */
	recognitionMonth: string | null;
	periodBasis:
		| 'service_period'
		| 'service_period_end'
		| 'bill_date_fallback'
		| 'unresolved';
	serviceStart: string | null;
	serviceEnd: string | null;
	invoiceDate: string;
	dueDate: string | null;
	currency: string;
	/** Net of tax; null means unknown. */
	netAmount: string | null;
	taxAmount: string | null;
	grossAmount: string | null;
	taxTreatment: 'none' | 'recoverable' | 'non_recoverable' | 'unresolved';
	taxEvidence: string | null;
	withholdingTax: string;
	recognizedAmount: string | null;
	sourceReference: string;
	evidenceReference: string;
	poNumber: string | null;
	description: string;
	splits: SeedSupplierSplit[];
}

/**
 * The seeded rows. Hand-computed expectations live in the spec from exactly
 * these literals: recognized slices 2020-03/2020-04, the September-service
 * invoice, the free-text-PO invoice, overhead/unallocated, and the
 * pending/rejected/cancelled/draft/unresolved states that must not count.
 */
export const SUPPLIER_INVOICES: SeedSupplierInvoice[] = [
	{
		key: 'splitInvoice',
		invoiceNumber: 'E2E-SINV-1001',
		costUid: 'e2e-311-cost-1001',
		classification: 'project',
		project: 'beta',
		state: 'recognized',
		recognitionMonth: SUPPLIER_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2020-03-01',
		serviceEnd: '2020-04-30',
		invoiceDate: '2020-04-02',
		dueDate: '2020-05-02',
		currency: 'INR',
		netAmount: '100000.00',
		taxAmount: '0.00',
		grossAmount: '100000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: '100000.00',
		sourceReference: 'E2E-SINV-VENDOR-1001',
		evidenceReference: 'E2E-SINV-GRN-1001',
		poNumber: null,
		description: 'E2E supplier invoice across two service periods',
		splits: [
			{
				serviceStart: '2020-03-01',
				serviceEnd: '2020-03-31',
				amount: '60000.00',
				taxAmount: '0.00',
				recognizedAmount: '60000.00',
			},
			{
				serviceStart: '2020-04-01',
				serviceEnd: '2020-04-30',
				amount: '40000.00',
				taxAmount: '0.00',
				recognizedAmount: '40000.00',
			},
		],
	},
	{
		key: 'septemberService',
		invoiceNumber: 'E2E-SINV-1002',
		costUid: 'e2e-311-cost-1002',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: SUPPLIER_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2020-03-05',
		serviceEnd: '2020-03-31',
		invoiceDate: '2020-04-15',
		dueDate: '2020-05-10',
		currency: 'INR',
		netAmount: '50000.00',
		taxAmount: '0.00',
		grossAmount: '50000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: '50000.00',
		sourceReference: 'E2E-SINV-VENDOR-1002',
		evidenceReference: 'E2E-SINV-GRN-1002',
		poNumber: null,
		description: 'E2E March service invoiced in April, paid in May',
		splits: [],
	},
	{
		key: 'noPurchaseOrder',
		invoiceNumber: 'E2E-SINV-1003',
		costUid: 'e2e-311-cost-1003',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: SUPPLIER_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2020-03-10',
		serviceEnd: '2020-03-10',
		invoiceDate: '2020-03-11',
		dueDate: null,
		currency: 'INR',
		netAmount: '25000.00',
		taxAmount: '0.00',
		grossAmount: '25000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: '25000.00',
		sourceReference: 'E2E-SINV-VENDOR-1003',
		evidenceReference: 'E2E-SINV-GRN-1003',
		poNumber: 'E2E-SINV-PO-FREE-1003',
		description: 'E2E standalone invoice with only a free-text PO number',
		splits: [],
	},
	{
		key: 'overhead',
		invoiceNumber: 'E2E-SINV-1004',
		costUid: 'e2e-311-cost-1004',
		classification: 'company_overhead',
		project: null,
		state: 'recognized',
		recognitionMonth: SUPPLIER_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2020-03-12',
		serviceEnd: '2020-03-12',
		invoiceDate: '2020-03-12',
		dueDate: null,
		currency: 'INR',
		netAmount: '15000.00',
		taxAmount: '0.00',
		grossAmount: '15000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: '15000.00',
		sourceReference: 'E2E-SINV-VENDOR-1004',
		evidenceReference: 'E2E-SINV-GRN-1004',
		poNumber: null,
		description: 'E2E deliberate Company Overhead supplier cost',
		splits: [],
	},
	{
		key: 'unallocated',
		invoiceNumber: 'E2E-SINV-1005',
		costUid: 'e2e-311-cost-1005',
		classification: 'unallocated',
		project: null,
		state: 'recognized',
		recognitionMonth: SUPPLIER_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2020-03-15',
		serviceEnd: '2020-03-15',
		invoiceDate: '2020-03-15',
		dueDate: null,
		currency: 'INR',
		netAmount: '5000.00',
		taxAmount: '0.00',
		grossAmount: '5000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: '5000.00',
		sourceReference: 'E2E-SINV-VENDOR-1005',
		evidenceReference: 'E2E-SINV-GRN-1005',
		poNumber: null,
		description: 'E2E supplier cost awaiting a destination',
		splits: [],
	},
	{
		key: 'pending',
		invoiceNumber: 'E2E-SINV-1006',
		costUid: 'e2e-311-cost-1006',
		classification: 'project',
		project: 'alpha',
		state: 'pending_evidence',
		recognitionMonth: SUPPLIER_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2020-03-16',
		serviceEnd: '2020-03-16',
		invoiceDate: '2020-03-16',
		dueDate: null,
		currency: 'INR',
		netAmount: '9999.00',
		taxAmount: '0.00',
		grossAmount: '9999.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: null,
		sourceReference: 'E2E-SINV-VENDOR-1006',
		evidenceReference: 'E2E-SINV-GRN-1006',
		poNumber: null,
		description: 'E2E invoice awaiting recognition',
		splits: [],
	},
	{
		key: 'rejected',
		invoiceNumber: 'E2E-SINV-1007',
		costUid: 'e2e-311-cost-1007',
		classification: 'project',
		project: 'alpha',
		state: 'rejected',
		recognitionMonth: null,
		periodBasis: 'service_period',
		serviceStart: '2020-03-17',
		serviceEnd: '2020-03-17',
		invoiceDate: '2020-03-17',
		dueDate: null,
		currency: 'INR',
		netAmount: '1111.00',
		taxAmount: '0.00',
		grossAmount: '1111.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: null,
		sourceReference: 'E2E-SINV-VENDOR-1007',
		evidenceReference: 'E2E-SINV-GRN-1007',
		poNumber: null,
		description: 'E2E supplier invoice refused by finance',
		splits: [],
	},
	{
		key: 'cancelled',
		invoiceNumber: 'E2E-SINV-1008',
		costUid: 'e2e-311-cost-1008',
		classification: 'project',
		project: 'alpha',
		state: 'cancelled',
		recognitionMonth: null,
		periodBasis: 'service_period',
		serviceStart: '2020-03-18',
		serviceEnd: '2020-03-18',
		invoiceDate: '2020-03-18',
		dueDate: null,
		currency: 'INR',
		netAmount: '2222.00',
		taxAmount: '0.00',
		grossAmount: '2222.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: null,
		sourceReference: 'E2E-SINV-VENDOR-1008',
		evidenceReference: 'E2E-SINV-GRN-1008',
		poNumber: null,
		description: 'E2E withdrawn supplier invoice',
		splits: [],
	},
	{
		key: 'unresolvedClassification',
		invoiceNumber: 'E2E-SINV-1009',
		costUid: 'e2e-311-cost-1009',
		classification: null,
		project: null,
		state: 'pending_evidence',
		recognitionMonth: SUPPLIER_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2020-03-19',
		serviceEnd: '2020-03-19',
		invoiceDate: '2020-03-19',
		dueDate: null,
		currency: 'INR',
		netAmount: '7777.00',
		taxAmount: '0.00',
		grossAmount: '7777.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: null,
		sourceReference: 'E2E-SINV-VENDOR-1009',
		evidenceReference: 'E2E-SINV-GRN-1009',
		poNumber: null,
		description: 'E2E supplier invoice with no destination yet',
		splits: [],
	},
	{
		key: 'draft',
		invoiceNumber: 'E2E-SINV-1010',
		costUid: 'e2e-311-cost-1010',
		classification: null,
		project: null,
		state: 'draft',
		recognitionMonth: null,
		periodBasis: 'unresolved',
		serviceStart: null,
		serviceEnd: null,
		invoiceDate: '2020-03-21',
		dueDate: null,
		currency: 'INR',
		netAmount: '333.00',
		taxAmount: '0.00',
		grossAmount: '333.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: null,
		sourceReference: 'E2E-SINV-VENDOR-1010',
		evidenceReference: 'E2E-SINV-GRN-1010',
		poNumber: null,
		description: 'E2E draft supplier invoice',
		splits: [],
	},
	{
		key: 'taxUnresolved',
		invoiceNumber: 'E2E-SINV-1011',
		costUid: 'e2e-311-cost-1011',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: SUPPLIER_INVOICE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2020-04-02',
		serviceEnd: '2020-04-02',
		invoiceDate: '2020-04-03',
		dueDate: null,
		currency: 'INR',
		netAmount: '109000.00',
		taxAmount: '9000.00',
		grossAmount: '118000.00',
		taxTreatment: 'unresolved',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: '118000.00',
		sourceReference: 'E2E-SINV-VENDOR-1011',
		evidenceReference: 'E2E-SINV-GRN-1011',
		poNumber: null,
		description: 'E2E supplier invoice whose tax treatment is still open',
		splits: [],
	},
	{
		key: 'recoverableNoEvidence',
		invoiceNumber: 'E2E-SINV-1012',
		costUid: 'e2e-311-cost-1012',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: SUPPLIER_INVOICE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2020-04-06',
		serviceEnd: '2020-04-06',
		invoiceDate: '2020-04-07',
		dueDate: null,
		currency: 'INR',
		netAmount: '50000.00',
		taxAmount: '9000.00',
		grossAmount: '59000.00',
		taxTreatment: 'recoverable',
		taxEvidence: null,
		withholdingTax: '0.00',
		recognizedAmount: '59000.00',
		sourceReference: 'E2E-SINV-VENDOR-1012',
		evidenceReference: 'E2E-SINV-GRN-1012',
		poNumber: null,
		description: 'E2E recoverable-tax claim without its evidence',
		splits: [],
	},
	{
		key: 'linkedCandidate',
		invoiceNumber: 'E2E-SINV-1013',
		costUid: 'e2e-311-cost-1013',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: SUPPLIER_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2020-03-20',
		serviceEnd: '2020-03-20',
		invoiceDate: '2020-03-20',
		dueDate: null,
		currency: 'INR',
		netAmount: '12000.00',
		taxAmount: '0.00',
		grossAmount: '12000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		withholdingTax: '2000.00',
		recognizedAmount: '12000.00',
		sourceReference: 'E2E-SINV-VENDOR-1013',
		evidenceReference: 'E2E-SINV-GRN-1013',
		poNumber: null,
		description: 'E2E invoice with a linked payable and a review candidate',
		splits: [],
	},
];

export interface SeedSupplierPayable {
	key: string;
	referenceNumber: string;
	/** The invoice it tracks through `purchase_invoice_id` (explicit link). */
	invoiceKey: string | null;
	vendorInvoiceNumber: string;
	amount: string;
	paidAmount: string;
	status: 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled';
	/** Set when the fixture pre-links it (explicit, confirmed). */
	linked: boolean;
}

export const SUPPLIER_PAYABLES: SeedSupplierPayable[] = [
	{
		key: 'septemberPayable',
		referenceNumber: 'E2E-SINV-PP-1002',
		invoiceKey: 'septemberService',
		vendorInvoiceNumber: 'E2E-SINV-VENDOR-1002',
		amount: '50000.00',
		paidAmount: '0.00',
		status: 'pending',
		linked: true,
	},
	{
		key: 'linkedPayable',
		referenceNumber: 'E2E-SINV-PP-1013A',
		invoiceKey: 'linkedCandidate',
		vendorInvoiceNumber: 'E2E-SINV-VENDOR-1013',
		amount: '12000.00',
		paidAmount: '0.00',
		status: 'pending',
		linked: true,
	},
	{
		key: 'candidatePayable',
		referenceNumber: 'E2E-SINV-PP-1013B',
		invoiceKey: null,
		vendorInvoiceNumber: 'E2E-SINV-VENDOR-1013',
		amount: '12000.00',
		paidAmount: '0.00',
		status: 'pending',
		linked: false,
	},
];

export interface SeededSupplierInvoices {
	month: string;
	invoiceMonth: string;
	laterMonth: string;
	projects: Record<SupplierProjectKey, number>;
	invoices: number;
	/** `purchase_invoices.id` per `SeedSupplierInvoice.key`. */
	invoiceIds: Record<string, number>;
	/** `payment_payables.id` per `SeedSupplierPayable.key`. */
	payableIds: Record<string, number>;
}

const INVOICE_STATUS: Record<SupplierState, string> = {
	draft: 'draft',
	pending_evidence: 'pending',
	recognized: 'approved',
	rejected: 'cancelled',
	cancelled: 'cancelled',
};

/** The seeded row for a key, or a thrown error when it is missing. */
export function seededInvoice(key: string): SeedSupplierInvoice {
	const invoice = SUPPLIER_INVOICES.find((entry) => entry.key === key);
	if (!invoice) throw new Error(`Unknown supplier invoice fixture key: ${key}`);
	return invoice;
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
			'E2E supplier invoice fixture identity (e2e/lib/supplier-invoice-fixtures.ts)',
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

async function cleanupRoleUser(
	role: { roleCode: string },
	user: { username: string }
): Promise<void> {
	for (const sql of [
		`DELETE FROM user_activity_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		`DELETE FROM payroll_audit_logs WHERE performed_by IN (SELECT id FROM users WHERE username = ?)`,
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

/** Remove every row this module owns. Safe to run repeatedly. */
export async function cleanupSupplierInvoiceFixtures(): Promise<number> {
	await cleanupRoleUser(SUPPLIER_EDITOR_ROLE, SUPPLIER_EDITOR_USER);
	await cleanupRoleUser(SUPPLIER_REPORTS_ONLY_ROLE, SUPPLIER_REPORTS_ONLY_USER);

	let removed = 0;
	const invoiceSelector = `SELECT id FROM purchase_invoices
      WHERE invoice_number LIKE ? OR vendor_name LIKE ?`;
	const payableSelector = `SELECT id FROM payment_payables
      WHERE reference_number LIKE ? OR vendor_invoice_number LIKE ?`;
	const invoiceParams = [
		`${SUPPLIER_INVOICE_PREFIX}%`,
		`${SUPPLIER_VENDOR_PREFIX}%`,
	];
	const payableParams = [
		`${SUPPLIER_PAYABLE_PREFIX}%`,
		`${SUPPLIER_INVOICE_PREFIX}%`,
	];

	// The append-only journal is keyed by cost_uid, so it survives its source
	// row and must be purged in its own right.
	removed += (
		await exec(
			`DELETE FROM financial_cost_events
        WHERE cost_uid LIKE ?
           OR (source_table = 'purchase_invoices' AND source_id IN (${invoiceSelector}))
           OR (source_table = 'payment_payables' AND source_id IN (${payableSelector}))`,
			[`${SUPPLIER_COST_UID_PREFIX}%`, ...invoiceParams, ...payableParams]
		)
	).affectedRows;

	// Links first: they point at the invoice/payable rows about to go.
	removed += (
		await exec(
			`DELETE FROM financial_cost_links
        WHERE cost_uid LIKE ?
           OR (source_table = 'purchase_invoices' AND source_id IN (${invoiceSelector}))
           OR (source_table = 'payment_payables' AND source_id IN (${payableSelector}))`,
			[`${SUPPLIER_COST_UID_PREFIX}%`, ...invoiceParams, ...payableParams]
		)
	).affectedRows;
	// Sweep links whose direct-expense row is already gone (the #306 fixtures
	// delete their rows without knowing about the shared link table).
	try {
		removed += (
			await exec(
				`DELETE l FROM financial_cost_links l
           LEFT JOIN expenses e ON e.id = CAST(l.source_id AS UNSIGNED)
          WHERE l.source_table = 'expenses' AND e.id IS NULL`
			)
		).affectedRows;
	} catch {
		// The link table arrives with this ticket's migration; keep cleaning up.
	}

	await exec(
		`DELETE FROM supplier_invoice_periods WHERE invoice_id IN (${invoiceSelector})`,
		invoiceParams
	);
	await exec(
		`DELETE FROM payment_payables WHERE reference_number LIKE ? OR vendor_invoice_number LIKE ?`,
		payableParams
	);
	removed += (
		await exec(
			`DELETE FROM purchase_invoices WHERE invoice_number LIKE ? OR vendor_name LIKE ?`,
			invoiceParams
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code LIKE ?`, [
			`${SUPPLIER_PROJECT_CODE_PREFIX}%`,
		])
	).affectedRows;
	return removed;
}

/** Purge leftovers, then create the projects, invoices, and payables. */
export async function seedSupplierInvoiceFixtures(): Promise<SeededSupplierInvoices> {
	await cleanupSupplierInvoiceFixtures();
	await seedRoleUser(SUPPLIER_EDITOR_ROLE, SUPPLIER_EDITOR_USER);
	await seedRoleUser(SUPPLIER_REPORTS_ONLY_ROLE, SUPPLIER_REPORTS_ONLY_USER);

	const projects = {} as Record<SupplierProjectKey, number>;
	const projectKeys = Object.keys(SUPPLIER_PROJECTS) as SupplierProjectKey[];
	for (const key of projectKeys) {
		const project = SUPPLIER_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
       VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
			[project.code, project.title, project.client]
		);
		projects[key] = inserted.insertId;
	}

	const invoiceIds: Record<string, number> = {};
	for (const invoice of SUPPLIER_INVOICES) {
		const projectId = invoice.project ? projects[invoice.project] : null;
		const inserted = await exec(
			`INSERT INTO purchase_invoices
         (invoice_number, invoice_date, due_date, vendor_name, description,
          subtotal, tax_rate, tax_amount, total, amount_paid, balance_due,
          payment_status, status, project_id, po_number, notes, created_by, isDelete,
          cost_uid, cost_classification, recognition_state, recognition_period,
          period_basis, service_period_start, service_period_end, tax_treatment,
          tax_evidence_reference, recognized_amount, source_reference, evidence_reference,
          financial_version, recognized_by, recognized_at, currency, withholding_tax_amount)
       VALUES (?, ?, ?, ?, ?, ?, 18, ?, ?, 0, 0, 'unpaid', ?, ?, ?, ?, NULL, 0,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
			[
				invoice.invoiceNumber,
				invoice.invoiceDate,
				invoice.dueDate,
				`${SUPPLIER_VENDOR_PREFIX}${invoice.key}`,
				invoice.description,
				invoice.netAmount,
				invoice.taxAmount,
				invoice.grossAmount,
				INVOICE_STATUS[invoice.state],
				projectId,
				invoice.poNumber,
				`E2E note ${invoice.key}`,
				invoice.costUid,
				invoice.classification,
				invoice.state,
				invoice.recognitionMonth ? `${invoice.recognitionMonth}-01` : null,
				invoice.periodBasis,
				invoice.serviceStart,
				invoice.serviceEnd,
				invoice.taxTreatment,
				invoice.taxEvidence,
				invoice.recognizedAmount,
				invoice.sourceReference,
				invoice.evidenceReference,
				invoice.state === 'recognized' ? 1 : null,
				invoice.state === 'recognized' ? '2020-04-30 09:00:00' : null,
				invoice.currency,
				invoice.withholdingTax,
			]
		);
		const invoiceId = inserted.insertId;
		invoiceIds[invoice.key] = invoiceId;

		for (const split of invoice.splits) {
			await exec(
				`INSERT INTO supplier_invoice_periods
           (invoice_id, service_period_start, service_period_end, recognition_period,
            amount, tax_amount, recognized_amount, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
				[
					invoiceId,
					split.serviceStart,
					split.serviceEnd,
					`${(split.serviceStart ?? split.serviceEnd).slice(0, 7)}-01`,
					split.amount,
					split.taxAmount,
					split.recognizedAmount,
					`E2E split ${invoice.key}`,
				]
			);
		}

		// Register the canonical identity and its version-1 journal row, the
		// same pair the app writes at capture.
		await exec(
			`INSERT INTO financial_cost_links
         (cost_uid, source_table, source_id, role, basis, review_state)
       VALUES (?, 'purchase_invoices', ?, 'cost', 'system', 'confirmed')`,
			[invoice.costUid, invoiceId]
		);
		await exec(
			`INSERT INTO financial_cost_events
         (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
          evidence_reference, snapshot)
       VALUES (?, 'purchase_invoices', ?, 1, 'recorded', NULL, ?, ?, ?)`,
			[
				invoice.costUid,
				invoiceId,
				`E2E fixture ${invoice.key}`,
				invoice.evidenceReference || null,
				JSON.stringify({
					classification: invoice.classification,
					recognition_period: invoice.recognitionMonth
						? `${invoice.recognitionMonth}-01`
						: null,
					currency: invoice.currency,
					gross_amount: invoice.grossAmount,
					recognized_amount: invoice.recognizedAmount,
					state: invoice.state,
				}),
			]
		);
	}

	const payableIds: Record<string, number> = {};
	for (const payable of SUPPLIER_PAYABLES) {
		const invoice = payable.invoiceKey
			? seededInvoice(payable.invoiceKey)
			: null;
		const costUid = payable.linked ? invoice!.costUid : null;
		const inserted = await exec(
			`INSERT INTO payment_payables
         (reference_number, vendor_invoice_number, purchase_invoice_id, vendor_name,
          invoice_date, due_date, invoice_amount, paid_amount, balance_due, currency,
          project_id, po_number, notes, status, created_by, isDelete, cost_uid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', NULL, NULL, ?, ?, NULL, 0, ?)`,
			[
				payable.referenceNumber,
				payable.vendorInvoiceNumber,
				invoice ? invoiceIds[payable.invoiceKey!] : null,
				invoice
					? `${SUPPLIER_VENDOR_PREFIX}${invoice.key}`
					: `${SUPPLIER_VENDOR_PREFIX}${payable.key}`,
				invoice ? invoice.invoiceDate : null,
				invoice ? invoice.dueDate : null,
				payable.amount,
				payable.paidAmount,
				payable.amount,
				`E2E payable ${payable.key}`,
				payable.status,
				costUid,
			]
		);
		payableIds[payable.key] = inserted.insertId;
		if (costUid) {
			await exec(
				`INSERT INTO financial_cost_links
           (cost_uid, source_table, source_id, role, basis, review_state)
         VALUES (?, 'payment_payables', ?, 'liability', 'explicit', 'confirmed')`,
				[costUid, inserted.insertId]
			);
		}
	}

	return {
		month: SUPPLIER_MONTH,
		invoiceMonth: SUPPLIER_INVOICE_MONTH,
		laterMonth: SUPPLIER_LATER_MONTH,
		projects,
		invoices: SUPPLIER_INVOICES.length,
		invoiceIds,
		payableIds,
	};
}

/**
 * Sign a namespaced fixture user in through the real API and return a context
 * carrying that session (same pattern as the #306 reader helper): the auth
 * bucket for the identity is cleared first, and its own trusted-header
 * identity isolates the following calls.
 */
export async function loginSupplierFixtureUser(
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
				`[e2e] loginSupplierFixtureUser(${user.username}) failed: POST /api/login -> ` +
					`${response.status()}${retryAfter ? ` (retry-after: ${retryAfter})` : ''}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				'[e2e] loginSupplierFixtureUser: login succeeded but no session cookie was set'
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

export async function loginSupplierEditor(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginSupplierFixtureUser(
		playwright,
		baseURL,
		SUPPLIER_EDITOR_USER,
		SUPPLIER_EDITOR_IP
	);
}

export async function loginSupplierReportsOnly(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginSupplierFixtureUser(
		playwright,
		baseURL,
		SUPPLIER_REPORTS_ONLY_USER,
		SUPPLIER_REPORTS_ONLY_IP
	);
}
