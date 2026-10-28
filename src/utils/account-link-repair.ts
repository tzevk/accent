import { revokeAllUserSessions } from '@/utils/session';

import { canModifyTargetUser } from '@/utils/api-permissions';

export type RepairResult =
	| { ok: true; previousEmployeeId: number | null }
	| { ok: false; status: 403 | 404 | 409; error: string };

type RepairConnection = {
	execute(
		sql: string,
		values?: unknown[]
	): Promise<[Array<Record<string, unknown>>, unknown]>;
	beginTransaction(): Promise<void>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
};

type RepairInput = {
	targetId: number;
	actor: Record<string, unknown>;
	employeeId: number | null;
	reason: string;
};

const HISTORY_TABLES = [
	'user_activity_assignments',
	'work_logs',
	'user_work_sessions',
	'user_activity_logs',
	'user_screen_time',
	'user_work_logs',
] as const;

async function hasRecordedHistory(
	db: RepairConnection,
	userId: number
): Promise<boolean> {
	for (const table of HISTORY_TABLES) {
		// These tables are defined or used by the application's user-activity surfaces.
		// If a history source is unavailable, the query fails and the repair is rejected.
		const [rows] = await db.execute(
			`SELECT 1 AS found FROM ${table} WHERE user_id = ? LIMIT 1`,
			[userId]
		);
		if (rows.length > 0) return true;
	}
	return false;
}

export async function repairEmployeeLink(
	db: RepairConnection,
	{ targetId, actor, employeeId, reason }: RepairInput
): Promise<RepairResult> {
	let begun = false;
	try {
		await db.beginTransaction();
		begun = true;
		const [targets] = await db.execute(
			`SELECT u.id, u.employee_id, u.vendor_id, u.account_type, u.status,
			        u.is_active, u.is_super_admin, r.role_hierarchy
		   FROM users u
		   LEFT JOIN roles_master r ON r.id = u.role_id
		  WHERE u.id = ? AND u.isDelete = 0
		  LIMIT 1 FOR UPDATE`,
			[targetId]
		);
		const target = targets[0];
		if (!target) return await reject(db, 404, 'User not found');

		const targetAccess = canModifyTargetUser(actor, target);
		if (!targetAccess.allowed)
			return await reject(db, 403, targetAccess.reason || 'Forbidden');
		if (
			String(target.account_type || 'employee').toLowerCase() !== 'employee' ||
			target.vendor_id != null
		) {
			return await reject(
				db,
				409,
				'Only Employee-type accounts can be repaired'
			);
		}
		if (
			String(target.status || '').toLowerCase() !== 'inactive' ||
			(target.is_active !== false && Number(target.is_active) !== 0)
		) {
			return await reject(
				db,
				409,
				'Disable account access before repairing its Employee link'
			);
		}
		const previousEmployeeId =
			target.employee_id == null ? null : Number(target.employee_id);
		if (previousEmployeeId === employeeId) {
			return await reject(
				db,
				409,
				'The account is already linked to this Employee'
			);
		}

		if (employeeId !== null) {
			const [employees] = await db.execute(
				' SELECT id FROM employees WHERE id = ? AND isDelete = 0 LIMIT 1 FOR UPDATE',
				[employeeId]
			);
			if (!employees.length)
				return await reject(db, 409, 'Employee not found or deleted');
			const [owners] = await db.execute(
				`SELECT id FROM users
			  WHERE employee_id = ? AND isDelete = 0 AND id <> ?
			  LIMIT 1 FOR UPDATE`,
				[employeeId, targetId]
			);
			if (owners.length)
				return await reject(
					db,
					409,
					'Employee is already linked to another account'
				);
		}

		let hasHistory: boolean;
		try {
			hasHistory = await hasRecordedHistory(db, targetId);
		} catch {
			return await reject(
				db,
				409,
				'Could not verify recorded account history; the Employee link was not changed'
			);
		}
		if (hasHistory) {
			return await reject(
				db,
				409,
				'Account has recorded activity. Its Employee link cannot be changed without preserving historical attribution; retain the current link or contact an administrator.'
			);
		}

		await db.execute(
			'UPDATE users SET employee_id = ? WHERE id = ? AND isDelete = 0',
			[employeeId, targetId]
		);
		await db.execute(
			`INSERT INTO user_account_link_repairs
			 (user_id, actor_user_id, previous_employee_id, employee_id, reason)
			 VALUES (?, ?, ?, ?, ?)`,
			[targetId, Number(actor.id), previousEmployeeId, employeeId, reason]
		);
		await revokeAllUserSessions(db, targetId);
		await db.commit();
		begun = false;
		return { ok: true, previousEmployeeId };
	} catch (error) {
		if (begun) await db.rollback().catch(() => {});
		const details = error as { code?: string; errno?: number };
		if (
			details?.code === 'ER_DUP_ENTRY' ||
			details?.errno === 1062 ||
			details?.code === 'ER_NO_REFERENCED_ROW_2' ||
			details?.errno === 1452
		) {
			return {
				ok: false,
				status: 409,
				error:
					'Employee is already linked to another account or is unavailable',
			};
		}
		throw error;
	}
}

async function reject(
	db: RepairConnection,
	status: 403 | 404 | 409,
	error: string
): Promise<RepairResult> {
	await db.rollback();
	return { ok: false, status, error };
}
