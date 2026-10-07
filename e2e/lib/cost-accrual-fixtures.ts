import bcrypt from 'bcrypt';
import type { PlaywrightWorkerArgs } from '@playwright/test';
import type { APIRequestContext, Cookie } from '@playwright/test';
import { exec } from './db';

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Cost Accrual fixtures (#313). A separate namespace from every other
 * expenditure spec: accruals, their replacement invoices, projects, vendors,
 * users, and months (2018-07..2018-09) are owned here, so no other spec can
 * change this one's expected totals and this one never touches theirs.
 *
 *   1. `seedCostAccrualFixtures()` once before the spec — from global setup.
 *      It cleans up first, so it is idempotent across runs.
 *   2. Run the spec, which records and replaces more rows through the app.
 *   3. `cleanupCostAccrualFixtures()` in the matching teardown.
 * Both use the shared pool in `e2e/lib/db.ts`.
 *
 * Expected amounts are stated in the spec from exactly these literals.
 */

/** The received-work month the seeded accruals are recognized in. */
export const ACCRUAL_MONTH = '2018-07';
/** The month the partial replacement invoice is recognized in. */
export const ACCRUAL_PARTIAL_MONTH = '2018-08';
/** The month the final replacement invoice is recognized in. */
export const ACCRUAL_FINAL_MONTH = '2018-09';
export const ACCRUAL_NUMBER_PREFIX = 'E2E-ACCR-';
export const ACCRUAL_DESCRIPTION_PREFIX = 'E2E-ACCR received work ';
export const ACCRUAL_PROJECT_CODE_PREFIX = 'E2E-ACCR-P';
export const ACCRUAL_COST_UID_PREFIX = 'e2e-313-cost-';
export const ACCRUAL_INVOICE_PREFIX = 'E2E-ACCR-INV-';
export const ACCRUAL_INVOICE_COST_UID_PREFIX = 'e2e-313-sinv-';
export const ACCRUAL_VENDOR_PREFIX = 'E2E Accrual Vendor ';

export const ACCRUAL_PROJECTS = {
	alpha: {
		code: 'E2E-ACCR-P1',
		title: 'E2E Accrual Alpha',
		client: 'E2E Accrual Client Alpha',
	},
} as const;

export type AccrualProjectKey = keyof typeof ACCRUAL_PROJECTS;

/**
 * Editor identity: may read/capture/update accruals and read the financial
 * report, but has **no** `other_expenses:approve`, so recognition and
 * replacement must be refused. Exercises the source/financial privilege split.
 */
export const ACCRUAL_EDITOR_USER = {
	username: 'e2e_313_editor',
	password: 'E2e#Accrual1',
	email: 'e2e.313.editor@accent.test',
	fullName: 'E2E Accrual Editor',
} as const;

/** Report reader without any expense read privilege (`reports:read`). */
export const ACCRUAL_REPORTS_ONLY_USER = {
	username: 'e2e_313_reports_only',
	password: 'E2e#Accrual2',
	email: 'e2e.313.reports.only@accent.test',
	fullName: 'E2E Accrual Reports Only',
} as const;

const ACCRUAL_EDITOR_ROLE = {
	roleCode: 'e2e_313_editor_role',
	roleName: 'E2E Accrual Editor',
	permissions: [
		'other_expenses:read',
		'other_expenses:create',
		'other_expenses:update',
		'reports:read',
		'purchase_orders:read',
	],
} as const;

const ACCRUAL_REPORTS_ONLY_ROLE = {
	roleCode: 'e2e_313_reports_only_role',
	roleName: 'E2E Accrual Reports Reader',
	permissions: ['reports:read'],
} as const;

/** Distinct login/API rate-limit identities (ADR-0013), never another spec's. */
const ACCRUAL_EDITOR_IP = '198.18.0.110';
const ACCRUAL_REPORTS_ONLY_IP = '198.18.0.111';

export type AccrualState =
	| 'draft'
	| 'pending_evidence'
	| 'recognized'
	| 'rejected'
	| 'cancelled';

export type AccrualEvidenceBasis =
	| 'received_work'
	| 'supported_estimate'
	| 'purchase_order';

export interface SeedCostAccrual {
	key: string;
	accrualNumber: string;
	costUid: string;
	description: string;
	project: AccrualProjectKey | null;
	state: AccrualState;
	evidenceBasis: AccrualEvidenceBasis;
	/** Recognition month (`YYYY-MM`); null = no period yet. */
	recognitionMonth: string | null;
	serviceStart: string | null;
	serviceEnd: string | null;
	classification: 'project' | 'company_overhead' | 'unallocated' | null;
	currency: string;
	/** Net of tax; null means unknown. */
	grossAmount: string | null;
	taxAmount: string | null;
	taxTreatment: 'none' | 'recoverable' | 'non_recoverable' | 'unresolved';
	taxEvidence: string | null;
	/** Frozen recognition result; null until recognized. */
	recognizedAmount: string | null;
	sourceReference: string | null;
	evidenceReference: string | null;
	ownerUserId: number | null;
}

/**
 * The seeded accruals, all on Project alpha in July 2018 unless stated.
 * Hand-computed expectations in the spec come from these literals.
 */
export const COST_ACCRUALS: SeedCostAccrual[] = [
	{
		key: 'a1',
		accrualNumber: `${ACCRUAL_NUMBER_PREFIX}9001`,
		costUid: `${ACCRUAL_COST_UID_PREFIX}9001`,
		description: `${ACCRUAL_DESCRIPTION_PREFIX}9001 (118000 gross, 18000 recoverable tax)`,
		project: 'alpha',
		state: 'recognized',
		evidenceBasis: 'received_work',
		recognitionMonth: ACCRUAL_MONTH,
		serviceStart: '2018-07-01',
		serviceEnd: '2018-07-31',
		classification: 'project',
		currency: 'INR',
		grossAmount: '118000.00',
		taxAmount: '18000.00',
		taxTreatment: 'recoverable',
		taxEvidence: 'E2E-ACCR-TAX-9001',
		recognizedAmount: '100000.00',
		sourceReference: 'E2E-ACCR-SRC-9001',
		evidenceReference: 'E2E-ACCR-EV-9001',
		ownerUserId: null,
	},
	{
		key: 'a2',
		accrualNumber: `${ACCRUAL_NUMBER_PREFIX}9002`,
		costUid: `${ACCRUAL_COST_UID_PREFIX}9002`,
		description: `${ACCRUAL_DESCRIPTION_PREFIX}9002 (100000 estimate, no tax)`,
		project: 'alpha',
		state: 'recognized',
		evidenceBasis: 'supported_estimate',
		recognitionMonth: ACCRUAL_MONTH,
		serviceStart: '2018-07-01',
		serviceEnd: '2018-07-31',
		classification: 'project',
		currency: 'INR',
		grossAmount: '100000.00',
		taxAmount: '0.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '100000.00',
		sourceReference: 'E2E-ACCR-SRC-9002',
		evidenceReference: 'E2E-ACCR-EV-9002',
		ownerUserId: null,
	},
	{
		key: 'a3',
		accrualNumber: `${ACCRUAL_NUMBER_PREFIX}9003`,
		costUid: `${ACCRUAL_COST_UID_PREFIX}9003`,
		description: `${ACCRUAL_DESCRIPTION_PREFIX}9003 (pending evidence, must not count)`,
		project: 'alpha',
		state: 'pending_evidence',
		evidenceBasis: 'received_work',
		recognitionMonth: ACCRUAL_MONTH,
		serviceStart: '2018-07-01',
		serviceEnd: '2018-07-31',
		classification: 'project',
		currency: 'INR',
		grossAmount: '50000.00',
		taxAmount: '0.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-ACCR-SRC-9003',
		evidenceReference: null,
		ownerUserId: null,
	},
	{
		key: 'a4',
		accrualNumber: `${ACCRUAL_NUMBER_PREFIX}9004`,
		costUid: `${ACCRUAL_COST_UID_PREFIX}9004`,
		description: `${ACCRUAL_DESCRIPTION_PREFIX}9004 (unused PO balance is not evidence)`,
		project: 'alpha',
		state: 'draft',
		evidenceBasis: 'purchase_order',
		recognitionMonth: ACCRUAL_MONTH,
		serviceStart: '2018-07-01',
		serviceEnd: '2018-07-31',
		classification: 'project',
		currency: 'INR',
		grossAmount: '25000.00',
		taxAmount: '0.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-ACCR-SRC-9004',
		evidenceReference: 'E2E-ACCR-PO-9004',
		ownerUserId: null,
	},
	{
		key: 'a5',
		accrualNumber: `${ACCRUAL_NUMBER_PREFIX}9005`,
		costUid: `${ACCRUAL_COST_UID_PREFIX}9005`,
		description: `${ACCRUAL_DESCRIPTION_PREFIX}9005 (lifecycle: replaced then cancelled)`,
		project: 'alpha',
		state: 'recognized',
		evidenceBasis: 'received_work',
		recognitionMonth: ACCRUAL_MONTH,
		serviceStart: '2018-07-01',
		serviceEnd: '2018-07-31',
		classification: 'project',
		currency: 'INR',
		grossAmount: '40000.00',
		taxAmount: '0.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '40000.00',
		sourceReference: 'E2E-ACCR-SRC-9005',
		evidenceReference: 'E2E-ACCR-EV-9005',
		ownerUserId: null,
	},
	{
		key: 'a6',
		accrualNumber: `${ACCRUAL_NUMBER_PREFIX}9006`,
		costUid: `${ACCRUAL_COST_UID_PREFIX}9006`,
		description: `${ACCRUAL_DESCRIPTION_PREFIX}9006 (September, concurrency)`,
		project: 'alpha',
		state: 'recognized',
		evidenceBasis: 'received_work',
		recognitionMonth: ACCRUAL_FINAL_MONTH,
		serviceStart: '2018-09-01',
		serviceEnd: '2018-09-30',
		classification: 'project',
		currency: 'INR',
		grossAmount: '20000.00',
		taxAmount: '0.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '20000.00',
		sourceReference: 'E2E-ACCR-SRC-9006',
		evidenceReference: 'E2E-ACCR-EV-9006',
		ownerUserId: null,
	},
];

export interface SeedAccrualInvoice {
	key: string;
	invoiceNumber: string;
	costUid: string;
	description: string;
	project: AccrualProjectKey | null;
	/** Recognition month (`YYYY-MM`). */
	recognitionMonth: string;
	serviceStart: string;
	serviceEnd: string;
	currency: string;
	grossAmount: string;
	taxAmount: string;
	recognizedAmount: string;
	sourceReference: string;
	evidenceReference: string;
}

/**
 * The recognized replacement invoices. Each is a normal recognized supplier
 * cost (#311) waiting to supersede a matching accrual amount.
 */
export const ACCRUAL_INVOICES: SeedAccrualInvoice[] = [
	{
		key: 'i1',
		invoiceNumber: `${ACCRUAL_INVOICE_PREFIX}9101`,
		costUid: `${ACCRUAL_INVOICE_COST_UID_PREFIX}9101`,
		description: 'E2E accrual replacement invoice 9101 (partial 60000)',
		project: 'alpha',
		recognitionMonth: ACCRUAL_PARTIAL_MONTH,
		serviceStart: '2018-08-01',
		serviceEnd: '2018-08-31',
		currency: 'INR',
		grossAmount: '60000.00',
		taxAmount: '0.00',
		recognizedAmount: '60000.00',
		sourceReference: 'E2E-ACCR-INV-SRC-9101',
		evidenceReference: 'E2E-ACCR-INV-EV-9101',
	},
	{
		key: 'i2',
		invoiceNumber: `${ACCRUAL_INVOICE_PREFIX}9102`,
		costUid: `${ACCRUAL_INVOICE_COST_UID_PREFIX}9102`,
		description: 'E2E accrual replacement invoice 9102 (final 50000)',
		project: 'alpha',
		recognitionMonth: ACCRUAL_FINAL_MONTH,
		serviceStart: '2018-08-01',
		serviceEnd: '2018-08-31',
		currency: 'INR',
		grossAmount: '50000.00',
		taxAmount: '0.00',
		recognizedAmount: '50000.00',
		sourceReference: 'E2E-ACCR-INV-SRC-9102',
		evidenceReference: 'E2E-ACCR-INV-EV-9102',
	},
	{
		key: 'i3',
		invoiceNumber: `${ACCRUAL_INVOICE_PREFIX}9103`,
		costUid: `${ACCRUAL_INVOICE_COST_UID_PREFIX}9103`,
		description: 'E2E accrual replacement invoice 9103 (final below estimate)',
		project: 'alpha',
		recognitionMonth: ACCRUAL_PARTIAL_MONTH,
		serviceStart: '2018-08-01',
		serviceEnd: '2018-08-31',
		currency: 'INR',
		grossAmount: '80000.00',
		taxAmount: '0.00',
		recognizedAmount: '80000.00',
		sourceReference: 'E2E-ACCR-INV-SRC-9103',
		evidenceReference: 'E2E-ACCR-INV-EV-9103',
	},
	{
		key: 'i4',
		invoiceNumber: `${ACCRUAL_INVOICE_PREFIX}9104`,
		costUid: `${ACCRUAL_INVOICE_COST_UID_PREFIX}9104`,
		description:
			'E2E accrual replacement invoice 9104 (cancelled in lifecycle)',
		project: 'alpha',
		recognitionMonth: ACCRUAL_PARTIAL_MONTH,
		serviceStart: '2018-08-01',
		serviceEnd: '2018-08-31',
		currency: 'INR',
		grossAmount: '30000.00',
		taxAmount: '0.00',
		recognizedAmount: '30000.00',
		sourceReference: 'E2E-ACCR-INV-SRC-9104',
		evidenceReference: 'E2E-ACCR-INV-EV-9104',
	},
	{
		key: 'i5',
		invoiceNumber: `${ACCRUAL_INVOICE_PREFIX}9105`,
		costUid: `${ACCRUAL_INVOICE_COST_UID_PREFIX}9105`,
		description: 'E2E accrual replacement invoice 9105 (repeat/concurrent)',
		project: 'alpha',
		recognitionMonth: ACCRUAL_PARTIAL_MONTH,
		serviceStart: '2018-08-01',
		serviceEnd: '2018-08-31',
		currency: 'INR',
		grossAmount: '10000.00',
		taxAmount: '0.00',
		recognizedAmount: '10000.00',
		sourceReference: 'E2E-ACCR-INV-SRC-9105',
		evidenceReference: 'E2E-ACCR-INV-EV-9105',
	},
	{
		key: 'i6',
		invoiceNumber: `${ACCRUAL_INVOICE_PREFIX}9106`,
		costUid: `${ACCRUAL_INVOICE_COST_UID_PREFIX}9106`,
		description: 'E2E accrual replacement invoice 9106 (September concurrency)',
		project: 'alpha',
		recognitionMonth: ACCRUAL_FINAL_MONTH,
		serviceStart: '2018-09-01',
		serviceEnd: '2018-09-30',
		currency: 'INR',
		grossAmount: '8000.00',
		taxAmount: '0.00',
		recognizedAmount: '8000.00',
		sourceReference: 'E2E-ACCR-INV-SRC-9106',
		evidenceReference: 'E2E-ACCR-INV-EV-9106',
	},
];

export interface SeededCostAccruals {
	month: string;
	partialMonth: string;
	finalMonth: string;
	projects: Record<AccrualProjectKey, number>;
	accruals: number;
	invoices: number;
	/** `cost_accruals.id` per `SeedCostAccrual.key`. */
	accrualIds: Record<string, number>;
	/** `purchase_invoices.id` per `SeedAccrualInvoice.key`. */
	invoiceIds: Record<string, number>;
}

/** The seeded accrual row for a key, or a thrown error when it is missing. */
export function seededAccrual(key: string): SeedCostAccrual {
	const accrual = COST_ACCRUALS.find((entry) => entry.key === key);
	if (!accrual) throw new Error(`Unknown cost accrual fixture key: ${key}`);
	return accrual;
}

/** The seeded invoice row for a key, or a thrown error when it is missing. */
export function seededAccrualInvoice(key: string): SeedAccrualInvoice {
	const invoice = ACCRUAL_INVOICES.find((entry) => entry.key === key);
	if (!invoice) throw new Error(`Unknown accrual invoice fixture key: ${key}`);
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
			'E2E cost accrual fixture identity (e2e/lib/cost-accrual-fixtures.ts)',
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

/**
 * Remove every row this module owns. Safe to run repeatedly. App-created rows
 * are matched by their owned vendor/description prefixes as well as by the
 * seeded number prefixes, so a crashed run leaves nothing behind.
 */
export async function cleanupCostAccrualFixtures(): Promise<number> {
	await cleanupRoleUser(ACCRUAL_EDITOR_ROLE, ACCRUAL_EDITOR_USER);
	await cleanupRoleUser(ACCRUAL_REPORTS_ONLY_ROLE, ACCRUAL_REPORTS_ONLY_USER);

	let removed = 0;
	const accrualSelector = `SELECT id FROM cost_accruals
      WHERE accrual_number LIKE ? OR description LIKE ? OR vendor_name LIKE ?`;
	const accrualParams = [
		`${ACCRUAL_NUMBER_PREFIX}%`,
		`${ACCRUAL_DESCRIPTION_PREFIX}%`,
		`${ACCRUAL_VENDOR_PREFIX}%`,
	];
	const invoiceSelector = `SELECT id FROM purchase_invoices
      WHERE invoice_number LIKE ? OR vendor_name LIKE ?`;
	const invoiceParams = [
		`${ACCRUAL_INVOICE_PREFIX}%`,
		`${ACCRUAL_VENDOR_PREFIX}%`,
	];

	// Replacements first: they point at the accrual and invoice rows.
	removed += (
		await exec(
			`DELETE FROM cost_accrual_replacements
        WHERE accrual_id IN (${accrualSelector}) OR invoice_id IN (${invoiceSelector})`,
			[...accrualParams, ...invoiceParams]
		)
	).affectedRows;

	// The append-only journal is keyed by cost_uid, so it survives its source
	// row and must be purged in its own right.
	removed += (
		await exec(
			`DELETE FROM financial_cost_events
        WHERE cost_uid LIKE ?
           OR (source_table = 'cost_accruals' AND source_id IN (${accrualSelector}))
           OR (source_table = 'purchase_invoices' AND source_id IN (${invoiceSelector}))`,
			[`${ACCRUAL_COST_UID_PREFIX}%`, ...accrualParams, ...invoiceParams]
		)
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM financial_cost_links
        WHERE cost_uid LIKE ?
           OR (source_table = 'cost_accruals' AND source_id IN (${accrualSelector}))
           OR (source_table = 'purchase_invoices' AND source_id IN (${invoiceSelector}))`,
			[`${ACCRUAL_COST_UID_PREFIX}%`, ...accrualParams, ...invoiceParams]
		)
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM cost_accruals WHERE id IN (${accrualSelector})`,
			accrualParams
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM purchase_invoices WHERE id IN (${invoiceSelector})`,
			invoiceParams
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code LIKE ?`, [
			`${ACCRUAL_PROJECT_CODE_PREFIX}%`,
		])
	).affectedRows;
	return removed;
}

/** Purge leftovers, then create the projects, accruals, and invoices. */
export async function seedCostAccrualFixtures(): Promise<SeededCostAccruals> {
	await cleanupCostAccrualFixtures();
	await seedRoleUser(ACCRUAL_EDITOR_ROLE, ACCRUAL_EDITOR_USER);
	await seedRoleUser(ACCRUAL_REPORTS_ONLY_ROLE, ACCRUAL_REPORTS_ONLY_USER);

	const projects = {} as Record<AccrualProjectKey, number>;
	const projectKeys = Object.keys(ACCRUAL_PROJECTS) as AccrualProjectKey[];
	for (const key of projectKeys) {
		const project = ACCRUAL_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
       VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
			[project.code, project.title, project.client]
		);
		projects[key] = inserted.insertId;
	}

	const accrualIds: Record<string, number> = {};
	for (const accrual of COST_ACCRUALS) {
		const projectId = accrual.project ? projects[accrual.project] : null;
		const inserted = await exec(
			`INSERT INTO cost_accruals
         (accrual_number, cost_uid, description, vendor_name, vendor_reference,
          evidence_basis, cost_classification, recognition_state, recognition_period,
          period_basis, service_period_start, service_period_end, gross_amount, tax_amount,
          tax_treatment, tax_evidence_reference, currency, recognized_amount, replaced_amount,
          recognized_by, recognized_at, owner_user_id, financial_version, isDelete, created_by)
       VALUES (?, ?, ?, ?, NULL,
               ?, ?, ?, ?, 'service_period', ?, ?, ?, ?,
               ?, ?, ?, ?, 0,
               NULL, ?, ?, 1, 0, NULL)`,
			[
				accrual.accrualNumber,
				accrual.costUid,
				accrual.description,
				`${ACCRUAL_VENDOR_PREFIX}${accrual.key}`,
				accrual.evidenceBasis,
				accrual.classification,
				accrual.state,
				accrual.recognitionMonth ? `${accrual.recognitionMonth}-01` : null,
				accrual.serviceStart,
				accrual.serviceEnd,
				accrual.grossAmount,
				accrual.taxAmount,
				accrual.taxTreatment,
				accrual.taxEvidence,
				accrual.currency,
				accrual.recognizedAmount,
				accrual.state === 'recognized' ? '2018-07-31 09:00:00' : null,
				accrual.ownerUserId,
			]
		);
		accrualIds[accrual.key] = inserted.insertId;
		// Register the canonical identity and its version-1 journal row, the
		// same pair the app writes at capture.
		await exec(
			`INSERT INTO financial_cost_links
         (cost_uid, source_table, source_id, role, basis, review_state)
       VALUES (?, 'cost_accruals', ?, 'cost', 'system', 'confirmed')`,
			[accrual.costUid, inserted.insertId]
		);
		await exec(
			`INSERT INTO financial_cost_events
         (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
          evidence_reference, snapshot)
       VALUES (?, 'cost_accruals', ?, 1, 'recorded', NULL, ?, ?, ?)`,
			[
				accrual.costUid,
				inserted.insertId,
				`E2E fixture ${accrual.key}`,
				accrual.evidenceReference,
				JSON.stringify({
					classification: accrual.classification,
					recognition_period: accrual.recognitionMonth
						? `${accrual.recognitionMonth}-01`
						: null,
					currency: accrual.currency,
					gross_amount: accrual.grossAmount,
					recognized_amount: accrual.recognizedAmount,
					state: accrual.state,
				}),
			]
		);
	}

	const invoiceIds: Record<string, number> = {};
	for (const invoice of ACCRUAL_INVOICES) {
		const projectId = invoice.project ? projects[invoice.project] : null;
		const inserted = await exec(
			`INSERT INTO purchase_invoices
         (invoice_number, invoice_date, due_date, vendor_name, description,
          subtotal, tax_rate, tax_amount, total, amount_paid, balance_due,
          payment_status, status, project_id, notes, created_by, isDelete,
          cost_uid, cost_classification, recognition_state, recognition_period,
          period_basis, service_period_start, service_period_end, tax_treatment,
          recognized_amount, source_reference, evidence_reference,
          financial_version, recognized_by, recognized_at, currency, withholding_tax_amount)
       VALUES (?, ?, NULL, ?, ?, ?, 0, ?, ?, 0, 0, 'unpaid', 'approved', ?, ?, NULL, 0,
               ?, 'project', 'recognized', ?,
               'service_period', ?, ?, 'none',
               ?, ?, ?, 1, NULL, ?, ?, 0)`,
			[
				invoice.invoiceNumber,
				invoice.serviceEnd,
				`${ACCRUAL_VENDOR_PREFIX}${invoice.key}`,
				invoice.description,
				invoice.grossAmount,
				invoice.taxAmount,
				invoice.grossAmount,
				projectId,
				`E2E note ${invoice.key}`,
				invoice.costUid,
				`${invoice.recognitionMonth}-01`,
				invoice.serviceStart,
				invoice.serviceEnd,
				invoice.recognizedAmount,
				invoice.sourceReference,
				invoice.evidenceReference,
				'2018-08-31 09:00:00',
				invoice.currency,
			]
		);
		invoiceIds[invoice.key] = inserted.insertId;
		await exec(
			`INSERT INTO financial_cost_links
         (cost_uid, source_table, source_id, role, basis, review_state)
       VALUES (?, 'purchase_invoices', ?, 'cost', 'system', 'confirmed')`,
			[invoice.costUid, inserted.insertId]
		);
		await exec(
			`INSERT INTO financial_cost_events
         (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
          evidence_reference, snapshot)
       VALUES (?, 'purchase_invoices', ?, 1, 'recorded', NULL, ?, ?, ?)`,
			[
				invoice.costUid,
				inserted.insertId,
				`E2E fixture ${invoice.key}`,
				invoice.evidenceReference,
				JSON.stringify({
					classification: 'project',
					recognition_period: `${invoice.recognitionMonth}-01`,
					currency: invoice.currency,
					gross_amount: invoice.grossAmount,
					recognized_amount: invoice.recognizedAmount,
					state: 'recognized',
				}),
			]
		);
	}

	return {
		month: ACCRUAL_MONTH,
		partialMonth: ACCRUAL_PARTIAL_MONTH,
		finalMonth: ACCRUAL_FINAL_MONTH,
		projects,
		accruals: COST_ACCRUALS.length,
		invoices: ACCRUAL_INVOICES.length,
		accrualIds,
		invoiceIds,
	};
}

/**
 * Sign a namespaced fixture user in through the real API and return a context
 * carrying that session: the auth bucket for the identity is cleared first,
 * and its own trusted-header identity isolates the following calls.
 */
export async function loginAccrualFixtureUser(
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
				`[e2e] loginAccrualFixtureUser(${user.username}) failed: POST /api/login -> ` +
					`${response.status()}${retryAfter ? ` (retry-after: ${retryAfter})` : ''}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				'[e2e] loginAccrualFixtureUser: login succeeded but no session cookie was set'
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

export async function loginAccrualEditor(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginAccrualFixtureUser(
		playwright,
		baseURL,
		ACCRUAL_EDITOR_USER,
		ACCRUAL_EDITOR_IP
	);
}

export async function loginAccrualReportsOnly(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginAccrualFixtureUser(
		playwright,
		baseURL,
		ACCRUAL_REPORTS_ONLY_USER,
		ACCRUAL_REPORTS_ONLY_IP
	);
}
