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
 * Petty-cash fixtures for the funding/spending controls (ticket #316).
 *
 * The module owns one namespace and nothing else:
 *   projects            `E2E-EXP-316-*` (`project_code`)
 *   vouchers            `cash_vouchers.paid_to` / `description` / `notes`
 *                       starting with `E2E-EXP-316`
 *   petty-cash rows     `petty_cash_expenses.notes` / `description` starting
 *                       with `E2E-EXP-316` (app-created rows always carry the
 *                       namespace note)
 *   expenses            `expense_number` / `vendor_name` like `E2E-EXP-316%`
 *   users/roles         `e2e_316_*`
 *   months              2019-06 (primary) and 2019-08 (later period)
 *
 * Other tickets must not read, mutate, or clean these rows, and must not use
 * these months.
 *
 * The seeded rows state their own recognition inputs and the recognizable
 * outcome those inputs imply, so the spec asserts amounts it computed from
 * these literals rather than from the report's own aggregation.
 */

export const PETTY_CASH_MONTH = '2019-06';
export const PETTY_CASH_LATER_MONTH = '2019-08';
export const PETTY_CASH_PREFIX = 'E2E-EXP-316';
export const PETTY_CASH_VENDOR = 'E2E-EXP-316 Vendor';
export const PETTY_CASH_CATEGORY = 'E2E Petty Cash';

/** The recognized direct expense a petty-cash receipt settles (800.00). */
export const PETTY_CASH_TARGET_EXPENSE = {
	expenseNumber: 'E2E-EXP-316-INV1',
	costUid: 'e2e-316-cost-inv1',
	amount: '800.00',
	project: 'alpha' as const,
	serviceStart: '2019-06-05',
	serviceEnd: '2019-06-05',
	billDate: '2019-06-06',
} as const;

export const PETTY_CASH_PROJECTS = {
	alpha: {
		code: 'E2E-EXP-316-P1',
		title: 'E2E Petty Cash Alpha',
		client: 'E2E Client Alpha',
	},
	beta: {
		code: 'E2E-EXP-316-P2',
		title: 'E2E Petty Cash Beta',
		client: 'E2E Client Beta',
	},
} as const;

export type PettyCashProjectKey = keyof typeof PETTY_CASH_PROJECTS;

/**
 * A petty-cash clerk: can read, record, and edit spending, but carries no
 * `petty_cash_expenses:approve`, so recognition and cancellation are refused.
 */
export const PETTY_CASH_CLERK = {
	username: 'e2e_316_petty_clerk',
	password: 'E2e#Petty316Clerk',
	email: 'e2e.316.petty.clerk@accent.test',
	fullName: 'E2E Petty Cash Clerk',
	roleCode: 'e2e_316_petty_clerk',
	roleName: 'E2E Petty Cash Clerk',
	permissions: [
		'petty_cash_expenses:read',
		'petty_cash_expenses:create',
		'petty_cash_expenses:update',
		'petty_cash_expenses:delete',
	],
	ip: '198.18.0.24',
} as const;

/** An authenticated user with no petty-cash privilege at all. */
export const PETTY_CASH_OUTSIDER = {
	username: 'e2e_316_no_cash',
	password: 'E2e#Petty316None',
	email: 'e2e.316.no.cash@accent.test',
	fullName: 'E2E No Petty Cash',
	roleCode: 'e2e_316_no_cash',
	roleName: 'E2E No Petty Cash',
	permissions: ['reports:read'],
	ip: '198.18.0.25',
} as const;

export interface SeededPettyCash {
	month: string;
	laterMonth: string;
	projects: Record<PettyCashProjectKey, number>;
	/** `expenses.id` of the seeded recognized direct expense. */
	targetExpenseId: number;
	/** Its canonical identity for the receipt-linking scenario. */
	targetCostUid: string;
	/** Chinese wall for other namespaces: the months this module owns. */
	ownedMonths: string[];
}

const NAMESPACE_USERS = [PETTY_CASH_CLERK, PETTY_CASH_OUTSIDER];

async function seedNamespaceUser(user: (typeof NAMESPACE_USERS)[number]) {
	const role = await exec(
		`INSERT INTO roles_master
       (role_code, role_name, role_hierarchy, department, permissions, description, status)
     VALUES (?, ?, 30, 'E2E', ?, ?, 'active')`,
		[
			user.roleCode,
			user.roleName,
			JSON.stringify([...user.permissions]),
			'E2E petty-cash fixture identity (e2e/lib/petty-cash-fixtures.ts)',
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
			role.insertId,
		]
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
 * are the namespaces above, so app-created rows (minted numbers, random cost
 * UIDs) are found through their namespaced notes and voucher text.
 */
export async function cleanupPettyCashFixtures(): Promise<number> {
	const prefix = `${PETTY_CASH_PREFIX}%`;
	for (const user of NAMESPACE_USERS) {
		await cleanupNamespaceUser(user);
	}
	let removed = 0;
	const pcePredicate = `(notes LIKE ? OR description LIKE ? OR recipient_name LIKE ?)`;
	const voucherPredicate = `(paid_to LIKE ? OR description LIKE ? OR notes LIKE ?)`;
	// The journal and the shared link table reference the rows by identity, so
	// they are purged before the rows themselves disappear.
	removed += (
		await exec(
			`DELETE FROM financial_cost_links
        WHERE (source_table = 'petty_cash_expenses'
               AND source_id IN (SELECT id FROM petty_cash_expenses WHERE ${pcePredicate}))
           OR (source_table = 'petty_cash_expenses'
               AND source_id IN (
                 SELECT id FROM petty_cash_expenses
                  WHERE transaction_number IN (
                    SELECT voucher_number FROM cash_vouchers WHERE ${voucherPredicate}
                  )))
           OR (source_table = 'cash_vouchers'
               AND source_id IN (SELECT id FROM cash_vouchers WHERE ${voucherPredicate}))
           OR (source_table = 'expenses'
               AND source_id IN (
                 SELECT id FROM expenses
                  WHERE expense_number LIKE ? OR vendor_name LIKE ?))
           OR cost_uid LIKE 'e2e-316-%'`,
			[
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
			]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM financial_cost_events
        WHERE cost_uid IN (
                SELECT cost_uid FROM petty_cash_expenses
                 WHERE ${pcePredicate}
                    OR transaction_number IN (
                         SELECT voucher_number FROM cash_vouchers WHERE ${voucherPredicate}
                       ))
           OR cost_uid IN (
                SELECT cost_uid FROM expenses
                 WHERE expense_number LIKE ? OR vendor_name LIKE ?)
           OR cost_uid LIKE 'e2e-316-%'`,
			[
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
				prefix,
			]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM petty_cash_expenses
        WHERE ${pcePredicate}
           OR transaction_number IN (
                SELECT voucher_number FROM cash_vouchers WHERE ${voucherPredicate}
              )`,
			[prefix, prefix, prefix, prefix, prefix, prefix]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM cash_vouchers WHERE ${voucherPredicate}`, [
			prefix,
			prefix,
			prefix,
		])
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM expenses WHERE expense_number LIKE ? OR vendor_name LIKE ?`,
			[prefix, prefix]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code LIKE ?`, [prefix])
	).affectedRows;
	return removed;
}

/**
 * Purge leftovers, then create the two Projects, the recognized direct
 * expense a petty-cash receipt settles, and the namespace identities.
 */
export async function seedPettyCashFixtures(): Promise<SeededPettyCash> {
	await cleanupPettyCashFixtures();

	const projects = {} as Record<PettyCashProjectKey, number>;
	for (const key of Object.keys(PETTY_CASH_PROJECTS) as PettyCashProjectKey[]) {
		const project = PETTY_CASH_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
       VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
			[project.code, project.title, project.client]
		);
		projects[key] = inserted.insertId;
	}

	const target = PETTY_CASH_TARGET_EXPENSE;
	const targetInserted = await exec(
		`INSERT INTO expenses
       (expense_number, expense_date, category, sub_category, description, vendor_name,
        amount, tax_amount, total_amount, currency, payment_mode, paid_to, paid_by,
        is_billable, is_reimbursable, project_id, department, notes, status,
        created_by, isDelete,
        cost_uid, cost_classification, recognition_state, recognition_period, period_basis,
        service_period_start, service_period_end, tax_treatment, tax_evidence_reference,
        recognized_amount, source_reference, evidence_reference, financial_version,
        recognized_by, recognized_at)
       VALUES (?, ?, ?, 'E2E Sub Category', ?, ?, ?, 0, ?, 'INR', 'bank', ?, NULL, 0, 0, ?, NULL, ?, 'approved',
               NULL, 0, ?, 'project', 'recognized', ?, 'service_period', ?, ?, 'none', NULL,
               ?, ?, ?, 1, NULL, '2019-06-06 09:00:00')`,
		[
			target.expenseNumber,
			target.billDate,
			PETTY_CASH_CATEGORY,
			'E2E-EXP-316 recognized cost a petty-cash receipt settles',
			PETTY_CASH_VENDOR,
			target.amount,
			target.amount,
			PETTY_CASH_VENDOR,
			projects[target.project],
			'E2E-EXP-316 target note',
			target.costUid,
			`${PETTY_CASH_MONTH}-01`,
			target.serviceStart,
			target.serviceEnd,
			target.amount,
			target.expenseNumber,
			'E2E-EXP-316-GRN1',
		]
	);
	const targetExpenseId = targetInserted.insertId;

	// The cost registry row `resolveCostReference` reads, plus the version-1
	// journal entry every cost-bearing row carries.
	await exec(
		`INSERT INTO financial_cost_links
       (cost_uid, source_table, source_id, role, basis, review_state, created_by)
     VALUES (?, 'expenses', ?, 'cost', 'system', 'confirmed', NULL)`,
		[target.costUid, String(targetExpenseId)]
	);
	await exec(
		`INSERT INTO financial_cost_events
       (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
        evidence_reference, snapshot)
     VALUES (?, 'expenses', ?, 1, 'recorded', NULL, 'E2E fixture target', 'E2E-EXP-316-GRN1', ?)`,
		[
			target.costUid,
			targetExpenseId,
			JSON.stringify({
				classification: 'project',
				recognition_period: `${PETTY_CASH_MONTH}-01`,
				currency: 'INR',
				gross_amount: target.amount,
				recognized_amount: target.amount,
				state: 'recognized',
			}),
		]
	);

	for (const user of NAMESPACE_USERS) {
		await seedNamespaceUser(user);
	}

	return {
		month: PETTY_CASH_MONTH,
		laterMonth: PETTY_CASH_LATER_MONTH,
		projects,
		targetExpenseId,
		targetCostUid: target.costUid,
		ownedMonths: [PETTY_CASH_MONTH, PETTY_CASH_LATER_MONTH],
	};
}

/**
 * Sign one namespace identity in through the real API and return a context
 * carrying that session. Mirrors the expenditure reader helper: the identity's
 * own auth bucket is cleared first (rerun safety) and its trusted-header IP
 * isolates the following API calls.
 */
export async function loginPettyCashUser(
	playwright: PlaywrightApi,
	baseURL: string,
	key: 'clerk' | 'outsider'
): Promise<APIRequestContext> {
	const user = key === 'clerk' ? PETTY_CASH_CLERK : PETTY_CASH_OUTSIDER;
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
				`[e2e] loginPettyCashUser(${key}) failed: POST /api/login -> ${response.status()}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				`[e2e] loginPettyCashUser(${key}): login succeeded but no session cookie was set`
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

/** The app-created petty-cash row behind a spending amount, for assertions. */
export async function findPettyCashSpendByAmount(
	amount: number
): Promise<Record<string, unknown> | null> {
	const found = await rows<Record<string, unknown>>(
		`SELECT id, transaction_number, cost_uid, entry_kind, recognition_state,
            financial_version, cost_classification, project_id, recognition_period,
            debit_amount, credit_amount, source_voucher_id, linked_cost_uid,
            evidence_reference, notes
       FROM petty_cash_expenses
      WHERE isDelete = 0 AND entry_kind = 'spend' AND debit_amount = ?
      ORDER BY created_at DESC
      LIMIT 1`,
		[amount]
	);
	return found[0] ?? null;
}
