import { unlink } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcrypt';
import type {
	APIRequestContext,
	Cookie,
	PlaywrightWorkerArgs,
} from '@playwright/test';
import { exec, rows } from './db';

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Client/supplier order fixtures for ticket #310 (canonical order direction and
 * identity review).
 *
 * The module owns one namespace and nothing else:
 *   projects               `E2E-EXP-310-P*`
 *   orders                 `order_number` LIKE `E2E-EXP-310-%` (canonical rows
 *                          the spec creates through the app + review decisions)
 *   legacy order copies    the four pre-canonical stores, rows identified by
 *                          `E2E-EXP-310-LEG-*` document numbers
 *   users/roles            `e2e_order_viewer` / `e2e_order_viewer_role`
 *                          (`purchase_orders:read` without any write)
 *
 * The legacy rows are deliberately ambiguous: one document number appears in
 * two different stores (same number is not proof of one order), one row
 * carries both a client and a supplier name, and one store is client-shaped
 * while another is supplier-shaped — all four must stay queued until a
 * document-backed review resolves them, so the fixtures state no direction.
 *
 * Intended call order:
 *   1. `seedOrderFixtures()` once before the spec — from global setup.
 *      It cleans up first, so it is idempotent across runs.
 *   2. Run the spec.
 *   3. `cleanupOrderFixtures()` in the matching teardown.
 * Both use the shared pool in `e2e/lib/db.ts`.
 */

export const ORDER_FIXTURE_PREFIX = 'E2E-EXP-310-';
/** Order dates sit in a month no other slice's fixtures own. */
export const ORDER_MONTH = '2019-06';
export const ORDER_PROJECT = {
	code: 'E2E-EXP-310-P1',
	title: 'E2E Order Classification Project',
	client: 'E2E-EXP-310 Client',
} as const;
export const ORDER_SUPPLIER = 'E2E-EXP-310 Supplier';

/** Document numbers of the ambiguous legacy copies. */
export const LEGACY_NUMBERS = {
	/** Same number in `purchase_orders` and `outgoing_purchase_orders`. */
	colliding: 'E2E-EXP-310-LEG-1',
	/** Same number in `project_purchase_orders` and `project_invoices`. */
	projectPair: 'E2E-EXP-310-LEG-2',
	/** A lone legacy copy the reviewer links to an existing canonical order. */
	lonely: 'E2E-EXP-310-LEG-3',
} as const;

/** Legacy amounts, stated by each store as that store records them. */
export const LEGACY_AMOUNTS = {
	purchaseOrder: 120000,
	outgoing: 130000,
	projectPoGross: 177000,
	projectPoNet: 150000,
	projectPoTax: 27000,
	projectInvoice: 90000,
} as const;

/** The canonical orders the browser/API create through the real app. */
export const CREATED_ORDERS = {
	supplier: {
		number: 'E2E-EXP-310-SUP-1',
		counterparty: ORDER_SUPPLIER,
		currency: 'INR',
		basis: 'net' as const,
		net: 250000,
		tax: 45000,
		gross: 295000,
		orderDate: `${ORDER_MONTH}-10`,
		status: 'approved',
		firmness: 'firm' as const,
		firmnessEvidence: 'E2E-EXP-310-DOC-SUP-1',
		sourceDocument: 'E2E-EXP-310-PO-SUP-1',
		remarks: 'E2E-EXP-310 supplier order entered through the browser form',
	},
	client: {
		number: 'E2E-EXP-310-CLI-1',
		counterparty: ORDER_PROJECT.client,
		currency: 'INR',
		basis: 'net' as const,
		net: 500000,
		tax: 90000,
		gross: 590000,
		orderDate: `${ORDER_MONTH}-12`,
		status: 'approved',
		firmness: 'firm' as const,
		firmnessEvidence: 'E2E-EXP-310-DOC-CLI-1',
		sourceDocument: 'E2E-EXP-310-PO-CLI-1',
		remarks: 'E2E-EXP-310 client order entered through the browser form',
	},
	/** Supplier order whose value is not supported yet: it must stay unknown. */
	unknown: {
		number: 'E2E-EXP-310-SUP-2',
		counterparty: `${ORDER_SUPPLIER} Unknown`,
		currency: 'USD',
		basis: 'unknown' as const,
		orderDate: `${ORDER_MONTH}-14`,
		status: 'draft',
		firmness: 'unknown' as const,
		sourceDocument: '',
	},
} as const;

/** The client invoice used to prove the canonical invoice reference. */
export const INVOICE_LINK = {
	number: 'E2E-EXP-310-INV-1',
	client: ORDER_PROJECT.client,
	firstTotal: 200000,
	secondTotal: 260000,
} as const;

/**
 * A reader with `purchase_orders:read` and **no** write permission. The order
 * screens and APIs are order-source data, so this identity must be able to
 * read orders and must be refused every write, review decision, and invoice
 * order link.
 */
export const ORDER_VIEWER_USER = {
	username: 'e2e_order_viewer',
	password: 'E2e#OrderViewer1',
	email: 'e2e.order.viewer@accent.test',
	fullName: 'E2E Order Viewer',
} as const;

/** Role row for the read-only order viewer; owns `purchase_orders:read`. */
const ORDER_VIEWER_ROLE = {
	roleCode: 'e2e_order_viewer_role',
	roleName: 'E2E Order Viewer',
} as const;

/**
 * The viewer's own login/API rate-limit identity through the proxy's trusted
 * header (ADR-0013), distinct from every other fixture.
 */
const ORDER_VIEWER_IP = '198.18.0.24';

export interface LegacyCopyRef {
	id: number;
	number: string;
}

export interface SeededOrderFixtures {
	month: string;
	projectId: number;
	legacy: {
		purchaseOrders: LegacyCopyRef;
		outgoingPurchaseOrders: LegacyCopyRef;
		projectPurchaseOrder: LegacyCopyRef;
		projectInvoice: LegacyCopyRef;
		lonelyPurchaseOrder: LegacyCopyRef;
	};
}

/** Create the read-only viewer's role and user rows from scratch. */
async function seedOrderViewer(): Promise<void> {
	const role = await exec(
		`INSERT INTO roles_master
       (role_code, role_name, role_hierarchy, department, permissions, description, status)
     VALUES (?, ?, 40, 'E2E', ?, ?, 'active')`,
		[
			ORDER_VIEWER_ROLE.roleCode,
			ORDER_VIEWER_ROLE.roleName,
			JSON.stringify(['purchase_orders:read']),
			'E2E order fixture reader (e2e/lib/order-fixtures.ts)',
		]
	);
	const passwordHash = await bcrypt.hash(ORDER_VIEWER_USER.password, 10);
	await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
		[
			ORDER_VIEWER_USER.username,
			passwordHash,
			ORDER_VIEWER_USER.email,
			ORDER_VIEWER_USER.fullName,
			role.insertId,
		]
	);
}

/** Remove the read-only viewer's rows; safe to run repeatedly. */
async function cleanupOrderViewer(): Promise<void> {
	const username = ORDER_VIEWER_USER.username;
	for (const sql of [
		`DELETE FROM user_activity_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
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
	await exec(`DELETE FROM roles_master WHERE role_code = ?`, [
		ORDER_VIEWER_ROLE.roleCode,
	]);
}

/**
 * Order rows are referenced by the canonical store, its review mappings and
 * decisions, and by client invoices. The script and the deployments the spec
 * exercises are independent, so the purge runs in dependency order and is
 * tolerant of a missing canonical schema (pre-migration reruns).
 */
async function purgeOrderNamespaces(): Promise<number> {
	let removed = 0;
	const bestEffort = async (sql: string, params: unknown[] = []) => {
		try {
			removed += (await exec(sql, params)).affectedRows;
		} catch {
			// Canonical order schema not migrated yet — nothing to purge.
		}
	};

	// Documents attached to canonical orders (and their files on disk).
	try {
		const docs = await rows<{ id: string; file_name: string }>(
			`SELECT d.id, d.file_name FROM entity_documents d
         JOIN orders o ON o.id = d.entity_id AND d.entity_type = 'order'
        WHERE o.order_number LIKE ?`,
			[`${ORDER_FIXTURE_PREFIX}%`]
		);
		for (const doc of docs) {
			await exec(`DELETE FROM entity_documents WHERE id = ?`, [doc.id]);
			try {
				await unlink(
					path.join(process.cwd(), 'private', 'documents', doc.file_name)
				);
			} catch {
				// File already gone.
			}
		}
	} catch {
		// Canonical order schema not migrated yet.
	}

	// Client invoices linked to fixture orders or written by the spec.
	await bestEffort(
		`DELETE FROM invoices
      WHERE invoice_number LIKE ?
         OR client_name LIKE ?`,
		[`${ORDER_FIXTURE_PREFIX}%`, `${ORDER_FIXTURE_PREFIX}%`]
	);

	await bestEffort(
		`DELETE oe FROM order_events oe
      JOIN orders o ON o.order_uid = oe.order_uid
     WHERE o.order_number LIKE ?`,
		[`${ORDER_FIXTURE_PREFIX}%`]
	);
	await bestEffort(
		`DELETE od FROM order_review_decisions od
      JOIN order_legacy_mappings m ON m.id = od.mapping_id
     WHERE m.document_number LIKE ?
        OR m.id IN (SELECT origin_mapping_id FROM orders WHERE order_number LIKE ?)`,
		[`${ORDER_FIXTURE_PREFIX}%`, `${ORDER_FIXTURE_PREFIX}%`]
	);
	await bestEffort(
		`UPDATE orders SET origin_mapping_id = NULL WHERE origin_mapping_id IN
        (SELECT id FROM order_legacy_mappings WHERE document_number LIKE ?)`,
		[`${ORDER_FIXTURE_PREFIX}%`]
	);
	await bestEffort(`DELETE FROM orders WHERE order_number LIKE ?`, [
		`${ORDER_FIXTURE_PREFIX}%`,
	]);
	await bestEffort(
		`DELETE FROM order_legacy_mappings WHERE document_number LIKE ?`,
		[`${ORDER_FIXTURE_PREFIX}%`]
	);

	// Legacy copies in the four pre-canonical stores.
	removed += (
		await exec(`DELETE FROM purchase_orders WHERE po_number LIKE ?`, [
			`${ORDER_FIXTURE_PREFIX}%`,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM outgoing_purchase_orders WHERE po_number LIKE ?`, [
			`${ORDER_FIXTURE_PREFIX}%`,
		])
	).affectedRows;
	removed += (
		await exec(`DELETE FROM project_invoices WHERE invoice_number LIKE ?`, [
			`${ORDER_FIXTURE_PREFIX}%`,
		])
	).affectedRows;

	return removed;
}

/** Remove every row this module owns. Safe to run repeatedly. */
export async function cleanupOrderFixtures(): Promise<number> {
	await cleanupOrderViewer();
	const removed = await purgeOrderNamespaces();
	const projects = await exec(
		`DELETE FROM projects WHERE project_code LIKE ?`,
		[`${ORDER_FIXTURE_PREFIX}P%`]
	);
	return removed + projects.affectedRows;
}

/**
 * Purge leftovers, then create the project and the five ambiguous legacy
 * copies. No canonical order is seeded: every canonical row in the namespace
 * is produced by the app through entry or document-backed review.
 */
export async function seedOrderFixtures(): Promise<SeededOrderFixtures> {
	await cleanupOrderFixtures();
	await seedOrderViewer();

	const project = await exec(
		`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
     VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
		[ORDER_PROJECT.code, ORDER_PROJECT.title, ORDER_PROJECT.client]
	);
	const projectId = project.insertId;

	// Legacy copy 1: the supplier-shaped store. The number collides with the
	// outgoing store's copy — that collision is a review candidate, not proof.
	const purchaseOrder = await exec(
		`INSERT INTO purchase_orders
       (po_number, vendor_name, description, subtotal, tax_rate, tax_amount, discount, total,
        status, po_date, po_amount, net_amount, project_id, isDelete)
     VALUES (?, ?, ?, ?, 0, 0, 0, ?, 'pending', ?, ?, ?, ?, 0)`,
		[
			LEGACY_NUMBERS.colliding,
			`${ORDER_SUPPLIER} Legacy One`,
			'E2E-EXP-310 legacy incoming purchase order',
			LEGACY_AMOUNTS.purchaseOrder,
			LEGACY_AMOUNTS.purchaseOrder,
			`${ORDER_MONTH}-03`,
			LEGACY_AMOUNTS.purchaseOrder,
			LEGACY_AMOUNTS.purchaseOrder,
			projectId,
		]
	);

	// Legacy copy 2: the outgoing store, client-shaped by name only.
	const outgoing = await exec(
		`INSERT INTO outgoing_purchase_orders
       (sr_no, company_name, city, po_number, po_date, po_amount, tax_amount, net_amount,
        project_number, description, remarks, status, isDelete)
     VALUES (931001, ?, 'E2E City', ?, ?, ?, 0, ?, ?, ?, ?, 'pending', 0)`,
		[
			ORDER_PROJECT.client,
			LEGACY_NUMBERS.colliding,
			`${ORDER_MONTH}-04`,
			LEGACY_AMOUNTS.outgoing,
			LEGACY_AMOUNTS.outgoing,
			ORDER_PROJECT.code,
			'E2E-EXP-310 legacy outgoing purchase order',
			'E2E-EXP-310 legacy outgoing purchase order',
		]
	);

	// Legacy copy 3: one row carrying both a client name and a vendor name.
	const projectPo = await exec(
		`INSERT INTO project_purchase_orders
       (project_id, po_number, po_date, client_name, vendor_name, delivery_date,
        scope_of_work, gross_amount, gst_percentage, gst_amount, net_amount,
        payment_terms, remarks)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 18, ?, ?, ?, ?)`,
		[
			projectId,
			LEGACY_NUMBERS.projectPair,
			`${ORDER_MONTH}-05`,
			ORDER_PROJECT.client,
			`${ORDER_SUPPLIER} Legacy Three`,
			'E2E-EXP-310 legacy project scope',
			LEGACY_AMOUNTS.projectPoNet,
			LEGACY_AMOUNTS.projectPoTax,
			LEGACY_AMOUNTS.projectPoGross,
			'E2E-EXP-310 payment terms',
			'E2E-EXP-310 legacy project purchase order',
		]
	);

	// Legacy copy 4: a project_invoice row carrying a purchase-order tab type.
	const projectInvoice = await exec(
		`INSERT INTO project_invoices
       (project_id, invoice_number, invoice_date, client_name, po_number, po_date, po_amount,
        invoice_amount, scope_of_work, status, remarks, tab_type, isDelete)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'purchase_order', 0)`,
		[
			projectId,
			LEGACY_NUMBERS.projectPair,
			`${ORDER_MONTH}-06`,
			ORDER_PROJECT.client,
			LEGACY_NUMBERS.projectPair,
			`${ORDER_MONTH}-06`,
			LEGACY_AMOUNTS.projectInvoice,
			LEGACY_AMOUNTS.projectInvoice,
			'E2E-EXP-310 legacy project purchase order copy',
			'E2E-EXP-310 legacy project_invoices copy',
		]
	);

	// Legacy copy 5: a lone copy the reviewer links to an existing order.
	const lonely = await exec(
		`INSERT INTO purchase_orders
       (po_number, vendor_name, description, subtotal, tax_rate, tax_amount, discount, total,
        status, po_date, po_amount, net_amount, project_id, isDelete)
     VALUES (?, ?, ?, ?, 0, 0, 0, ?, 'draft', ?, ?, ?, ?, 0)`,
		[
			LEGACY_NUMBERS.lonely,
			`${ORDER_SUPPLIER} Legacy Five`,
			'E2E-EXP-310 lone legacy copy',
			15000,
			15000,
			`${ORDER_MONTH}-07`,
			15000,
			15000,
			projectId,
		]
	);

	return {
		month: ORDER_MONTH,
		projectId,
		legacy: {
			purchaseOrders: {
				id: purchaseOrder.insertId,
				number: LEGACY_NUMBERS.colliding,
			},
			outgoingPurchaseOrders: {
				id: outgoing.insertId,
				number: LEGACY_NUMBERS.colliding,
			},
			projectPurchaseOrder: {
				id: projectPo.insertId,
				number: LEGACY_NUMBERS.projectPair,
			},
			projectInvoice: {
				id: projectInvoice.insertId,
				number: LEGACY_NUMBERS.projectPair,
			},
			lonelyPurchaseOrder: {
				id: lonely.insertId,
				number: LEGACY_NUMBERS.lonely,
			},
		},
	};
}

/**
 * Sign in the read-only order viewer through the real API and return a context
 * carrying that session (same pattern as the expenditure fixture reader: its
 * own trusted-header identity and a cleared `auth` bucket so reruns start with
 * a full budget).
 */
export async function loginOrderViewer(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	const user = ORDER_VIEWER_USER;
	const ip = ORDER_VIEWER_IP;
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
				`[e2e] loginOrderViewer failed: POST /api/login -> ${response.status()}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				'[e2e] loginOrderViewer: login succeeded but no session cookie was set'
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
