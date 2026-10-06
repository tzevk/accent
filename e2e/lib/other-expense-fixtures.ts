import bcrypt from 'bcrypt';
import type { APIRequestContext, Cookie, PlaywrightWorkerArgs } from '@playwright/test';
import { exec, rows } from './db';

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Other-expense (ticket #315) fixtures: the voucher register, receipt copies,
 * duplicate review, and the read-only identity used for authorization checks.
 *
 * The namespace is its own (`E2E-EXP-315-*` in `other_expenses`, `E2E-315-*`
 * in `expenses`) and its month (`2019-04`) is used by no other ticket, so the
 * exact month totals this spec asserts cannot be moved by another spec — and
 * this fixture never matches ticket #306's broader `E2E-EXP-%` purge.
 */

/** The reconciled month for every other-expense fixture. */
export const OTHER_EXPENSE_MONTH = '2019-04';
/** Prefix of every `other_expenses` row this ticket owns. */
export const OTHER_EXPENSE_PREFIX = 'E2E-EXP-315-';
/**
 * Prefix of the one `expenses` row this ticket seeds (the receipt-copy target)
 * and of any `financial_cost_events.cost_uid` this ticket writes.
 */
export const OTHER_EXPENSE_EXPENSE_PREFIX = 'E2E-315-';
export const OTHER_EXPENSE_COST_UID_PREFIX = 'e2e-315-cost-';
export const OTHER_EXPENSE_VENDOR_PREFIX = 'E2E-EXP-315 Vendor ';
export const OTHER_EXPENSE_PROJECT_CODE = 'E2E-EXP-315-P1';
export const OTHER_EXPENSE_CATEGORY = 'E2E-EXP-315 Category';

/** The recognized direct expense a receipt copy may reference. */
export const OTHER_EXPENSE_TARGET = {
	expenseNumber: 'E2E-315-TARGET',
	costUid: `${OTHER_EXPENSE_COST_UID_PREFIX}target`,
	vendor: `${OTHER_EXPENSE_VENDOR_PREFIX}target`,
	gross: 2500,
	tax: 0,
	sourceReference: 'E2E-EXP-315/SRC-TARGET',
	evidenceReference: 'E2E-EXP-315/EV-TARGET',
} as const;

/**
 * A reader with `other_expenses:read` + `other_expenses:update` and
 * `reports:read` but no create or approve: the identity that proves the
 * approval gate (including the conversion-evidence gate on an edit).
 */
export const OTHER_EXPENSE_READER = {
	username: 'e2e_315_expense_reader',
	email: 'e2e.315.expense.reader@accent.test',
	fullName: 'E2E 315 Expense Reader',
	password: 'E2e#Reader315',
} as const;

const OTHER_EXPENSE_READER_ROLE = {
	roleCode: 'e2e_315_expense_reader',
	roleName: 'E2E 315 Other Expense Reader',
} as const;

/**
 * The reader's own trusted-header identity, distinct from the spec's fixture
 * requests and the shared security harness (ADR-0013).
 */
const OTHER_EXPENSE_READER_IP = '198.18.0.24';

export interface SeededOtherExpenses {
	month: string;
	projectId: number;
	/** `expenses.id` of the recognized receipt-copy target. */
	targetExpenseId: number;
	targetCostUid: string;
}

/** Create the read-only reader's role and user rows from scratch. */
async function seedOtherExpenseReader(): Promise<void> {
	const role = await exec(
		`INSERT INTO roles_master
       (role_code, role_name, role_hierarchy, department, permissions, description, status)
     VALUES (?, ?, 40, 'E2E', ?, ?, 'active')`,
		[
			OTHER_EXPENSE_READER_ROLE.roleCode,
			OTHER_EXPENSE_READER_ROLE.roleName,
			JSON.stringify([
				'other_expenses:read',
				'other_expenses:update',
				'reports:read'
			]),
			'E2E other-expense read-only fixture (e2e/lib/other-expense-fixtures.ts)',
		]
	);
	const passwordHash = await bcrypt.hash(OTHER_EXPENSE_READER.password, 10);
	await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
		[
			OTHER_EXPENSE_READER.username,
			passwordHash,
			OTHER_EXPENSE_READER.email,
			OTHER_EXPENSE_READER.fullName,
			role.insertId,
		]
	);
}

/** Remove the read-only reader's rows; safe to run repeatedly. */
async function cleanupOtherExpenseReader(): Promise<void> {
	const username = OTHER_EXPENSE_READER.username;
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
	await exec(`DELETE FROM roles_master WHERE role_code = ?`, [
		OTHER_EXPENSE_READER_ROLE.roleCode,
	]);
}

/**
 * Remove every row this ticket owns. Safe to run repeatedly, and safe to run
 * next to the other expenditure fixtures: it only ever matches this ticket's
 * own namespace, and never ticket #306's `E2E-EXP-%` expenses.
 */
export async function cleanupOtherExpenseFixtures(): Promise<number> {
	await cleanupOtherExpenseReader();
	let removed = 0;
	// `other_expenses.id` is utf8mb4_general_ci and the link/journal tables are
	// utf8mb4_unicode_ci, so the sub-select states the register's collation to
	// keep the comparison legal.
	const otherExpenses = `SELECT id COLLATE utf8mb4_general_ci FROM other_expenses
     WHERE voucher_number LIKE ?
        OR source_reference LIKE ?
        OR evidence_reference LIKE ?
        OR description LIKE ?
        OR vendor_name LIKE ?
        OR employee_name LIKE ?`;
	const otherParams = [
		`${OTHER_EXPENSE_PREFIX}%`,
		`${OTHER_EXPENSE_PREFIX}%`,
		`${OTHER_EXPENSE_PREFIX}%`,
		`${OTHER_EXPENSE_PREFIX}%`,
		`${OTHER_EXPENSE_PREFIX}%`,
		`${OTHER_EXPENSE_PREFIX}%`,
	];
	removed += (
		await exec(
			`DELETE FROM financial_cost_events
        WHERE cost_uid LIKE ?
           OR cost_uid LIKE ?
           OR source_id IN (${otherExpenses})
           OR source_id IN (
                SELECT id FROM expenses
                 WHERE expense_number LIKE ?
                    OR cost_uid LIKE ?
              )`,
			[
				`${OTHER_EXPENSE_COST_UID_PREFIX}%`,
				`${OTHER_EXPENSE_COST_UID_PREFIX}run-%`,
				...otherParams,
				`${OTHER_EXPENSE_EXPENSE_PREFIX}%`,
				`${OTHER_EXPENSE_COST_UID_PREFIX}%`,
			]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM financial_cost_links
        WHERE cost_uid LIKE ?
           OR (source_table = 'other_expenses' AND source_id IN (${otherExpenses}))
           OR (source_table = 'expenses' AND source_id IN (
                SELECT id FROM expenses
                 WHERE expense_number LIKE ?
                    OR cost_uid LIKE ?
              ))`,
			[
				`${OTHER_EXPENSE_COST_UID_PREFIX}%`,
				...otherParams,
				`${OTHER_EXPENSE_EXPENSE_PREFIX}%`,
				`${OTHER_EXPENSE_COST_UID_PREFIX}%`,
			]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM other_expenses
        WHERE voucher_number LIKE ?
           OR source_reference LIKE ?
           OR evidence_reference LIKE ?
           OR description LIKE ?
           OR vendor_name LIKE ?
           OR employee_name LIKE ?`,
			otherParams
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM expenses
        WHERE expense_number LIKE ?
           OR cost_uid LIKE ?`,
			[
				`${OTHER_EXPENSE_EXPENSE_PREFIX}%`,
				`${OTHER_EXPENSE_COST_UID_PREFIX}%`,
			]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code LIKE ?`, [
			`${OTHER_EXPENSE_PROJECT_CODE}%`,
		])
	).affectedRows;
	return removed;
}

/**
 * Purge leftovers, then seed the project, the recognized receipt-copy target,
 * and the read-only reader identity.
 */
export async function seedOtherExpenseFixtures(): Promise<SeededOtherExpenses> {
	await cleanupOtherExpenseFixtures();
	await seedOtherExpenseReader();

	const project = await exec(
		`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
     VALUES (?, ?, NULL, 'E2E 315 Client', 'ONGOING', 0)`,
		[OTHER_EXPENSE_PROJECT_CODE, 'E2E 315 Project']
	);
	const projectId = project.insertId;

	// The authoritative cost a receipt copy may reference: a recognized direct
	// expense with its registry row and its versioned journal, exactly as if it
	// had been recorded and recognized through the app.
	const target = await exec(
		`INSERT INTO expenses
       (expense_number, expense_date, category, sub_category, description, vendor_name,
        amount, tax_amount, total_amount, currency, payment_mode, paid_to, paid_by,
        is_billable, is_reimbursable, project_id, department, notes, status,
        created_by, isDelete,
        cost_uid, cost_classification, recognition_state, recognition_period, period_basis,
        service_period_start, service_period_end, tax_treatment, tax_evidence_reference,
        recognized_amount, source_reference, evidence_reference, financial_version,
        recognized_by, recognized_at)
     VALUES (?, ?, ?, 'E2E Sub Category', ?, ?, ?, 0, ?, 'INR', 'bank', ?, NULL, 0, 0, ?, NULL, ?, 'approved', NULL, 0,
             ?, 'project', 'recognized', ?, 'service_period',
             ?, ?, 'none', NULL,
             ?, ?, ?, 2, NULL, '2019-04-12 09:00:00')`,
		[
			OTHER_EXPENSE_TARGET.expenseNumber,
			`${OTHER_EXPENSE_MONTH}-12`,
			OTHER_EXPENSE_CATEGORY,
			'E2E 315 recognized receipt-copy target',
			OTHER_EXPENSE_TARGET.vendor,
			OTHER_EXPENSE_TARGET.gross,
			OTHER_EXPENSE_TARGET.gross,
			OTHER_EXPENSE_TARGET.vendor,
			projectId,
			'E2E 315 target note',
			OTHER_EXPENSE_TARGET.costUid,
			`${OTHER_EXPENSE_MONTH}-01`,
			`${OTHER_EXPENSE_MONTH}-10`,
			`${OTHER_EXPENSE_MONTH}-10`,
			OTHER_EXPENSE_TARGET.gross,
			OTHER_EXPENSE_TARGET.sourceReference,
			OTHER_EXPENSE_TARGET.evidenceReference,
		]
	);
	const targetExpenseId = target.insertId;

	for (const [version, command, reason] of [
		[1, 'recorded', 'E2E fixture target recorded'],
		[2, 'recognized', 'E2E fixture target recognized'],
	] as const) {
		await exec(
			`INSERT INTO financial_cost_events
         (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
          evidence_reference, snapshot)
       VALUES (?, 'expenses', ?, ?, ?, NULL, ?, ?, ?)`,
			[
				OTHER_EXPENSE_TARGET.costUid,
				targetExpenseId,
				version,
				command,
				reason,
				OTHER_EXPENSE_TARGET.evidenceReference,
				JSON.stringify({
					classification: 'project',
					recognition_period: `${OTHER_EXPENSE_MONTH}-01`,
					period_basis: 'service_period',
					currency: 'INR',
					gross_amount: OTHER_EXPENSE_TARGET.gross,
					recognized_amount: OTHER_EXPENSE_TARGET.gross,
					state: 'recognized',
				}),
			]
		);
	}
	await exec(
		`INSERT INTO financial_cost_links
       (cost_uid, source_table, source_id, role, basis, review_state)
     VALUES (?, 'expenses', ?, 'cost', 'system', 'confirmed')`,
		[OTHER_EXPENSE_TARGET.costUid, String(targetExpenseId)]
	);

	return {
		month: OTHER_EXPENSE_MONTH,
		projectId,
		targetExpenseId,
		targetCostUid: OTHER_EXPENSE_TARGET.costUid,
	};
}

/**
 * `expenses.id` of the seeded target, re-read in case a spec needs it after a
 * restart; the seed itself is idempotent.
 */
export async function seededTargetExpenseId(): Promise<number> {
	const found = await rows<{ id: number }>(
		`SELECT id FROM expenses WHERE expense_number = ? AND isDelete = 0`,
		[OTHER_EXPENSE_TARGET.expenseNumber]
	);
	if (found.length === 0) {
		throw new Error(
			`[e2e] other-expense target ${OTHER_EXPENSE_TARGET.expenseNumber} is missing`
		);
	}
	return Number(found[0].id);
}

/**
 * Sign in the read-only reader through the real API and return a context
 * carrying that session, mirroring the expenditure report reader's helper.
 */
export async function loginOtherExpenseReader(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	const user = OTHER_EXPENSE_READER;
	const ip = OTHER_EXPENSE_READER_IP;
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
				`[e2e] loginOtherExpenseReader failed: POST /api/login -> ${response.status()}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				'[e2e] loginOtherExpenseReader: login succeeded but no session cookie was set'
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
