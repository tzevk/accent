import bcrypt from 'bcrypt';
import type { PlaywrightWorkerArgs } from '@playwright/test';
import type { APIRequestContext, Cookie } from '@playwright/test';
import { exec } from './db';

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Accrual consumption fixtures (#314). A separate namespace from every other
 * expenditure spec: orders `E2E-314-ORD-*`, accruals `E2E-314-9*`, replacement
 * invoices `E2E-314-INV-*`, cost identities `e2e-314-*`, projects `E2E-314-P*`,
 * users/roles `e2e_314_*`, months 2018-10/2018-11, and trusted IPs
 * 198.18.0.113/.114. Nothing else is read, mutated, or cleaned.
 *
 * The order timeline is seeded directly (the app writes journal timestamps
 * from the wall clock, so a recorded 2018 act is fixture state). The behavior
 * under test — automatic accrual consumption on recognition, the
 * replacement transfer, cancellation restores, refusals, and authorization —
 * is exercised through the real app and verified against these literals.
 */

export const ACCRUAL_CONSUMPTION_MONTH = '2018-10';
export const ACCRUAL_CONSUMPTION_NEXT_MONTH = '2018-11';
export const ACCRUAL_CONSUMPTION_PREFIX = 'E2E-314-';
export const ACCRUAL_CONSUMPTION_PROJECT_CODE = 'E2E-314-P1';
export const ACCRUAL_CONSUMPTION_COST_PREFIX = 'e2e-314-cost-';
export const ACCRUAL_CONSUMPTION_INVOICE_PREFIX = 'E2E-314-INV-';
export const ACCRUAL_CONSUMPTION_INVOICE_COST_PREFIX = 'e2e-314-sinv-';
export const ACCRUAL_CONSUMPTION_VENDOR_PREFIX = 'E2E-314 Vendor ';
export const ACCRUAL_CONSUMPTION_SPEC_IP = '198.18.0.113';
export const ACCRUAL_CONSUMPTION_RESTRICTED_IP = '198.18.0.114';

const ACCRUAL_CONSUMPTION_PROJECT = {
	code: ACCRUAL_CONSUMPTION_PROJECT_CODE,
	title: 'E2E 314 Accrual Consumption Project',
	client: 'E2E-314 Client',
} as const;

/**
 * Finance identity without approval: may read and capture, but recognition,
 * replacement, and consumption acts must be refused. Exercises the
 * source/financial privilege split on the #314 composition paths.
 */
export const ACCRUAL_CONSUMPTION_RESTRICTED_ROLE = {
	roleCode: 'e2e_314_restricted',
	roleName: 'E2E 314 restricted finance',
	permissions: [
		'other_expenses:read',
		'other_expenses:create',
		'reports:read',
		'purchase_orders:read',
	],
} as const;
export const ACCRUAL_CONSUMPTION_RESTRICTED_USER = {
	username: 'e2e_314_restricted',
	password: 'E2e#Acc314x!',
	email: 'e2e.314.restricted@accent.test',
	fullName: 'E2E 314 Restricted Finance',
} as const;

/** One canonical supplier order with its recorded journal acts. */
interface AccrualConsumptionOrderFixture {
	key: string;
	orderNumber: string;
	orderUid: string;
	currency: string;
	basis: 'gross' | 'net';
	value: number;
	acts: Array<{ event: 'created'; at: string; status: string }>;
	orderDate: string;
}

export const ACCRUAL_CONSUMPTION_ORDERS: readonly AccrualConsumptionOrderFixture[] =
	[
		{
			key: 'ORD-3001',
			orderNumber: `${ACCRUAL_CONSUMPTION_PREFIX}ORD-3001`,
			orderUid: 'ord-e2e-314-ord-3001',
			currency: 'INR',
			basis: 'gross',
			value: 300000,
			acts: [
				{
					event: 'created',
					at: `${ACCRUAL_CONSUMPTION_MONTH}-10 09:00:00`,
					status: 'approved',
				},
			],
			orderDate: `${ACCRUAL_CONSUMPTION_MONTH}-10`,
		},
		{
			key: 'ORD-3002',
			orderNumber: `${ACCRUAL_CONSUMPTION_PREFIX}ORD-3002`,
			orderUid: 'ord-e2e-314-ord-3002',
			currency: 'INR',
			basis: 'gross',
			value: 10000,
			acts: [
				{
					event: 'created',
					at: `${ACCRUAL_CONSUMPTION_MONTH}-11 09:00:00`,
					status: 'approved',
				},
			],
			orderDate: `${ACCRUAL_CONSUMPTION_MONTH}-11`,
		},
	] as const;

export interface SeedLinkedAccrual {
	key: string;
	accrualNumber: string;
	costUid: string;
	description: string;
	orderKey: string;
	grossAmount: string;
	evidenceReference: string;
}

export const LINKED_ACCRUALS: readonly SeedLinkedAccrual[] = [
	{
		key: 'A1',
		accrualNumber: `${ACCRUAL_CONSUMPTION_PREFIX}9001`,
		costUid: `${ACCRUAL_CONSUMPTION_COST_PREFIX}9001`,
		description: `${ACCRUAL_CONSUMPTION_PREFIX}received work 9001 (100000 estimate)`,
		orderKey: 'ORD-3001',
		grossAmount: '100000.00',
		evidenceReference: `${ACCRUAL_CONSUMPTION_PREFIX}EV-9001`,
	},
	{
		key: 'A2',
		accrualNumber: `${ACCRUAL_CONSUMPTION_PREFIX}9002`,
		costUid: `${ACCRUAL_CONSUMPTION_COST_PREFIX}9002`,
		description: `${ACCRUAL_CONSUMPTION_PREFIX}received work 9002 (50000 estimate)`,
		orderKey: 'ORD-3001',
		grossAmount: '50000.00',
		evidenceReference: `${ACCRUAL_CONSUMPTION_PREFIX}EV-9002`,
	},
	{
		key: 'A3',
		accrualNumber: `${ACCRUAL_CONSUMPTION_PREFIX}9003`,
		costUid: `${ACCRUAL_CONSUMPTION_COST_PREFIX}9003`,
		description: `${ACCRUAL_CONSUMPTION_PREFIX}received work 9003 (30000 estimate)`,
		orderKey: 'ORD-3001',
		grossAmount: '30000.00',
		evidenceReference: `${ACCRUAL_CONSUMPTION_PREFIX}EV-9003`,
	},
	{
		key: 'A4',
		accrualNumber: `${ACCRUAL_CONSUMPTION_PREFIX}9004`,
		costUid: `${ACCRUAL_CONSUMPTION_COST_PREFIX}9004`,
		description: `${ACCRUAL_CONSUMPTION_PREFIX}received work 9004 (20000 against a 10000 order)`,
		orderKey: 'ORD-3002',
		grossAmount: '20000.00',
		evidenceReference: `${ACCRUAL_CONSUMPTION_PREFIX}EV-9004`,
	},
	{
		key: 'A5',
		accrualNumber: `${ACCRUAL_CONSUMPTION_PREFIX}9005`,
		costUid: `${ACCRUAL_CONSUMPTION_COST_PREFIX}9005`,
		description: `${ACCRUAL_CONSUMPTION_PREFIX}received work 9005 (20000 estimate)`,
		orderKey: 'ORD-3001',
		grossAmount: '20000.00',
		evidenceReference: `${ACCRUAL_CONSUMPTION_PREFIX}EV-9005`,
	},
] as const;

export interface SeedTransferInvoice {
	key: string;
	invoiceNumber: string;
	costUid: string;
	description: string;
	recognitionMonth: string;
	currency: string;
	grossAmount: string;
}

export const TRANSFER_INVOICES: readonly SeedTransferInvoice[] = [
	{
		key: 'I1',
		invoiceNumber: `${ACCRUAL_CONSUMPTION_INVOICE_PREFIX}9101`,
		costUid: `${ACCRUAL_CONSUMPTION_INVOICE_COST_PREFIX}9101`,
		description: 'E2E-314 replacement invoice 9101 (partial 60000, October)',
		recognitionMonth: ACCRUAL_CONSUMPTION_MONTH,
		currency: 'INR',
		grossAmount: '60000.00',
	},
	{
		key: 'I2',
		invoiceNumber: `${ACCRUAL_CONSUMPTION_INVOICE_PREFIX}9102`,
		costUid: `${ACCRUAL_CONSUMPTION_INVOICE_COST_PREFIX}9102`,
		description: 'E2E-314 replacement invoice 9102 (final 40000, November)',
		recognitionMonth: ACCRUAL_CONSUMPTION_NEXT_MONTH,
		currency: 'INR',
		grossAmount: '40000.00',
	},
	{
		key: 'I3',
		invoiceNumber: `${ACCRUAL_CONSUMPTION_INVOICE_PREFIX}9103`,
		costUid: `${ACCRUAL_CONSUMPTION_INVOICE_COST_PREFIX}9103`,
		description: 'E2E-314 replacement invoice 9103 (USD actual, November)',
		recognitionMonth: ACCRUAL_CONSUMPTION_NEXT_MONTH,
		currency: 'USD',
		grossAmount: '1000.00',
	},
	{
		key: 'I4',
		invoiceNumber: `${ACCRUAL_CONSUMPTION_INVOICE_PREFIX}9104`,
		costUid: `${ACCRUAL_CONSUMPTION_INVOICE_COST_PREFIX}9104`,
		description: 'E2E-314 replacement invoice 9104 (stale-version probe)',
		recognitionMonth: ACCRUAL_CONSUMPTION_MONTH,
		currency: 'INR',
		grossAmount: '50000.00',
	},
	{
		key: 'I5a',
		invoiceNumber: `${ACCRUAL_CONSUMPTION_INVOICE_PREFIX}9105`,
		costUid: `${ACCRUAL_CONSUMPTION_INVOICE_COST_PREFIX}9105`,
		description: 'E2E-314 replacement invoice 9105 (concurrency winner)',
		recognitionMonth: ACCRUAL_CONSUMPTION_MONTH,
		currency: 'INR',
		grossAmount: '20000.00',
	},
	{
		key: 'I5b',
		invoiceNumber: `${ACCRUAL_CONSUMPTION_INVOICE_PREFIX}9106`,
		costUid: `${ACCRUAL_CONSUMPTION_INVOICE_COST_PREFIX}9106`,
		description: 'E2E-314 replacement invoice 9106 (concurrency loser)',
		recognitionMonth: ACCRUAL_CONSUMPTION_MONTH,
		currency: 'INR',
		grossAmount: '20000.00',
	},
] as const;

export function linkedAccrual(key: string): SeedLinkedAccrual {
	const accrual = LINKED_ACCRUALS.find((entry) => entry.key === key);
	if (!accrual) throw new Error(`Unknown linked accrual fixture key: ${key}`);
	return accrual;
}

export function transferInvoice(key: string): SeedTransferInvoice {
	const invoice = TRANSFER_INVOICES.find((entry) => entry.key === key);
	if (!invoice)
		throw new Error(`Unknown transfer invoice fixture key: ${key}`);
	return invoice;
}

export interface SeededAccrualConsumption {
	month: string;
	nextMonth: string;
	projectId: number;
	/** Accrual key → `cost_accruals.id`. */
	accrualIds: Record<string, number>;
	/** Invoice key → `purchase_invoices.id`. */
	invoiceIds: Record<string, number>;
	/** Order key → `order_uid`. */
	orderUids: Record<string, string>;
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
			'E2E accrual consumption fixture identity (e2e/lib/accrual-consumption-fixtures.ts)',
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
 * are matched by the owned description/vendor prefixes as well as the seeded
 * number prefixes, so a crashed run leaves nothing behind.
 */
export async function cleanupAccrualConsumptionFixtures(): Promise<number> {
	await cleanupRoleUser(
		ACCRUAL_CONSUMPTION_RESTRICTED_ROLE,
		ACCRUAL_CONSUMPTION_RESTRICTED_USER
	);

	let removed = 0;
	const accrualSelector = `SELECT id FROM cost_accruals
      WHERE accrual_number LIKE ? OR description LIKE ? OR vendor_name LIKE ?`;
	const accrualParams = [
		`${ACCRUAL_CONSUMPTION_PREFIX}%`,
		`${ACCRUAL_CONSUMPTION_PREFIX}%`,
		`${ACCRUAL_CONSUMPTION_VENDOR_PREFIX}%`,
	];
	const invoiceSelector = `SELECT id FROM purchase_invoices
      WHERE invoice_number LIKE ? OR vendor_name LIKE ?`;
	const invoiceParams = [
		`${ACCRUAL_CONSUMPTION_INVOICE_PREFIX}%`,
		`${ACCRUAL_CONSUMPTION_VENDOR_PREFIX}%`,
	];
	const orderUidSelector = `SELECT order_uid FROM orders WHERE order_number LIKE ?`;
	const orderUidParams = [`${ACCRUAL_CONSUMPTION_PREFIX}ORD-%`];

	// Consumption first: it points at the order and cost rows.
	for (const sql of [
		`DELETE FROM order_consumption_events WHERE order_uid IN (${orderUidSelector}) OR cost_uid LIKE ?`,
		`DELETE FROM order_consumptions WHERE order_uid IN (${orderUidSelector}) OR cost_uid LIKE ?`,
	]) {
		removed += (
			await exec(sql, [...orderUidParams, `${ACCRUAL_CONSUMPTION_COST_PREFIX}%`])
		).affectedRows;
	}
	for (const sql of [
		`DELETE FROM order_consumption_events WHERE cost_uid LIKE ?`,
		`DELETE FROM order_consumptions WHERE cost_uid LIKE ?`,
	]) {
		removed += (
			await exec(sql, [`${ACCRUAL_CONSUMPTION_INVOICE_COST_PREFIX}%`])
		).affectedRows;
	}

	// Replacements before their accrual and invoice rows.
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
           OR cost_uid LIKE ?
           OR (source_table = 'cost_accruals' AND source_id IN (${accrualSelector}))
           OR (source_table = 'purchase_invoices' AND source_id IN (${invoiceSelector}))`,
			[
				`${ACCRUAL_CONSUMPTION_COST_PREFIX}%`,
				`${ACCRUAL_CONSUMPTION_INVOICE_COST_PREFIX}%`,
				...accrualParams,
				...invoiceParams,
			]
		)
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM financial_cost_links
        WHERE cost_uid LIKE ?
           OR cost_uid LIKE ?
           OR (source_table = 'cost_accruals' AND source_id IN (${accrualSelector}))
           OR (source_table = 'purchase_invoices' AND source_id IN (${invoiceSelector}))`,
			[
				`${ACCRUAL_CONSUMPTION_COST_PREFIX}%`,
				`${ACCRUAL_CONSUMPTION_INVOICE_COST_PREFIX}%`,
				...accrualParams,
				...invoiceParams,
			]
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
			`DELETE FROM supplier_invoice_periods
        WHERE invoice_id IN (${invoiceSelector})`,
			invoiceParams
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM purchase_invoices WHERE id IN (${invoiceSelector})`,
			invoiceParams
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM order_events WHERE order_uid IN (${orderUidSelector})`, [
			...orderUidParams,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM orders WHERE order_number LIKE ?`, [
			`${ACCRUAL_CONSUMPTION_PREFIX}ORD-%`,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code = ?`, [
			ACCRUAL_CONSUMPTION_PROJECT_CODE,
		])
	).affectedRows;
	return removed;
}

/** Purge leftovers, then create the Project, orders, accruals, and invoices. */
export async function seedAccrualConsumptionFixtures(): Promise<SeededAccrualConsumption> {
	await cleanupAccrualConsumptionFixtures();
	await seedRoleUser(
		ACCRUAL_CONSUMPTION_RESTRICTED_ROLE,
		ACCRUAL_CONSUMPTION_RESTRICTED_USER
	);

	const project = await exec(
		`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
      VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
		[
			ACCRUAL_CONSUMPTION_PROJECT.code,
			ACCRUAL_CONSUMPTION_PROJECT.title,
			ACCRUAL_CONSUMPTION_PROJECT.client,
		]
	);
	const projectId = project.insertId;

	const orderUids: Record<string, string> = {};
	for (const order of ACCRUAL_CONSUMPTION_ORDERS) {
		const gross = order.basis === 'gross' ? order.value : null;
		const net = order.basis === 'net' ? order.value : null;
		await exec(
			`INSERT INTO orders
         (order_uid, order_number, direction, counterparty_name, company_id, project_id,
          currency, amount_basis, gross_amount, tax_amount, net_amount,
          client_invoiced_value, order_date, status, firmness, firmness_evidence_reference,
          source_document_reference, evidence_reference, remarks, origin_mapping_id,
          created_from, financial_version, created_by, isDelete)
       VALUES (?, ?, 'supplier', ?, NULL, ?, ?, ?, ?, NULL, ?, NULL, ?, 'approved', 'firm', ?,
               ?, ?, ?, NULL, 'entry', 1, NULL, 0)`,
			[
				order.orderUid,
				order.orderNumber,
				`${ACCRUAL_CONSUMPTION_VENDOR_PREFIX}${order.key}`,
				projectId,
				order.currency,
				order.basis,
				gross,
				net,
				order.orderDate,
				`${ACCRUAL_CONSUMPTION_PREFIX}DOC-${order.key}`,
				order.orderNumber,
				`${ACCRUAL_CONSUMPTION_PREFIX}EV-${order.key}`,
				`E2E-314 fixture order ${order.key}`,
			]
		);
		orderUids[order.key] = order.orderUid;
		let version = 0;
		for (const act of order.acts) {
			version += 1;
			await exec(
				`INSERT INTO order_events
           (order_uid, version, event, amount, reference, actor_id, reason, payload, created_at)
         VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?)`,
				[
					order.orderUid,
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
	}

	const accrualIds: Record<string, number> = {};
	for (const accrual of LINKED_ACCRUALS) {
		const order = ACCRUAL_CONSUMPTION_ORDERS.find(
			(entry) => entry.key === accrual.orderKey
		);
		if (!order) throw new Error(`[e2e] unknown fixture order: ${accrual.orderKey}`);
		const inserted = await exec(
			`INSERT INTO cost_accruals
         (accrual_number, cost_uid, description, vendor_name, vendor_reference,
          order_uid, evidence_basis, cost_classification, project_id, recognition_state,
          recognition_period, period_basis, service_period_start, service_period_end,
          gross_amount, tax_amount, tax_treatment, tax_evidence_reference, currency,
          recognized_amount, replaced_amount, source_reference, evidence_reference,
          recognized_by, recognized_at, owner_user_id, financial_version, isDelete, created_by)
       VALUES (?, ?, ?, ?, NULL, ?, 'received_work', 'project', ?, 'draft', ?,
               'service_period', ?, ?, ?, '0.00', 'none', NULL, 'INR', NULL, 0,
               ?, ?, NULL, NULL, NULL, 1, 0, NULL)`,
			[
				accrual.accrualNumber,
				accrual.costUid,
				accrual.description,
				`${ACCRUAL_CONSUMPTION_VENDOR_PREFIX}${accrual.key}`,
				order.orderUid,
				projectId,
				`${ACCRUAL_CONSUMPTION_MONTH}-01`,
				`${ACCRUAL_CONSUMPTION_MONTH}-01`,
				`${ACCRUAL_CONSUMPTION_MONTH}-28`,
				accrual.grossAmount,
				`${ACCRUAL_CONSUMPTION_PREFIX}SRC-${accrual.key}`,
				accrual.evidenceReference,
			]
		);
		accrualIds[accrual.key] = inserted.insertId;
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
					classification: 'project',
					recognition_period: `${ACCRUAL_CONSUMPTION_MONTH}-01`,
					currency: 'INR',
					gross_amount: accrual.grossAmount,
					state: 'draft',
				}),
			]
		);
	}

	const invoiceIds: Record<string, number> = {};
	for (const invoice of TRANSFER_INVOICES) {
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
				`${invoice.recognitionMonth}-28`,
				`${ACCRUAL_CONSUMPTION_VENDOR_PREFIX}${invoice.key}`,
				invoice.description,
				invoice.grossAmount,
				'0.00',
				invoice.grossAmount,
				projectId,
				`E2E note ${invoice.key}`,
				invoice.costUid,
				`${invoice.recognitionMonth}-01`,
				`${invoice.recognitionMonth}-01`,
				`${invoice.recognitionMonth}-28`,
				invoice.grossAmount,
				`${ACCRUAL_CONSUMPTION_PREFIX}INV-SRC-${invoice.key}`,
				`${ACCRUAL_CONSUMPTION_PREFIX}INV-EV-${invoice.key}`,
				`${invoice.recognitionMonth}-28 09:00:00`,
				invoice.currency,
			]
		);
		invoiceIds[invoice.key] = inserted.insertId;
		await exec(
			`INSERT INTO supplier_invoice_periods
           (invoice_id, service_period_start, service_period_end, recognition_period,
            amount, tax_amount, recognized_amount, note, created_by)
         VALUES (?, ?, ?, ?, ?, '0.00', ?, ?, NULL)`,
			[
				inserted.insertId,
				`${invoice.recognitionMonth}-01`,
				`${invoice.recognitionMonth}-28`,
				`${invoice.recognitionMonth}-01`,
				invoice.grossAmount,
				invoice.grossAmount,
				`E2E-314 slice ${invoice.key} ${invoice.recognitionMonth}`,
			]
		);
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
				`${ACCRUAL_CONSUMPTION_PREFIX}INV-EV-${invoice.key}`,
				JSON.stringify({
					classification: 'project',
					recognition_period: `${invoice.recognitionMonth}-01`,
					currency: invoice.currency,
					gross_amount: invoice.grossAmount,
					recognized_amount: invoice.grossAmount,
					state: 'recognized',
				}),
			]
		);
	}

	return {
		month: ACCRUAL_CONSUMPTION_MONTH,
		nextMonth: ACCRUAL_CONSUMPTION_NEXT_MONTH,
		projectId,
		accrualIds,
		invoiceIds,
		orderUids,
	};
}

/**
 * Sign a namespaced fixture user in through the real API and return a context
 * carrying that session (same pattern as the #312/#313 login helpers).
 */
export async function loginAccrualConsumptionFixtureUser(
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
				`[e2e] loginAccrualConsumptionFixtureUser(${user.username}) failed: POST /api/login -> ` +
					`${response.status()}${retryAfter ? ` (retry-after: ${retryAfter})` : ''}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				'[e2e] loginAccrualConsumptionFixtureUser: login succeeded but no session cookie was set'
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

export async function loginAccrualConsumptionRestricted(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginAccrualConsumptionFixtureUser(
		playwright,
		baseURL,
		ACCRUAL_CONSUMPTION_RESTRICTED_USER,
		ACCRUAL_CONSUMPTION_RESTRICTED_IP
	);
}
