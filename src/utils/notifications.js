/**
 * In-app notification producer.
 *
 * v1 scope: alert approvers (super_admin or leaves:approve holders) when a
 * new leave application awaits review. Producers insert rows directly; the
 * per-user feed is read through /api/notifications.
 */
import { dbConnect } from '@/utils/database';
import { mergePermissions } from '@/utils/rbac';

// mysql2 delivers JSON columns already parsed (object/array) or as strings.
function parsePermissions(raw) {
	if (!raw) return [];
	if (Array.isArray(raw)) return raw.filter((k) => typeof k === 'string');
	if (typeof raw === 'object') {
		return Object.values(raw).filter((k) => typeof k === 'string');
	}
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((k) => typeof k === 'string')
			: [];
	} catch {
		return [];
	}
}

/**
 * Filter candidate user rows (from the approver lookup query) to those who
 * can approve leaves, excluding the applicant. Pure — unit-testable.
 * @param {Array<{id:number, is_super_admin:number, role_permissions:unknown, user_permissions:unknown}>} rows
 * @param {number|string} applicantId
 * @returns {number[]} recipient user ids
 */
export function filterApprovers(rows, applicantId) {
	return rows
		.filter((row) => {
			if (Number(row.id) === Number(applicantId)) return false;
			if (row.is_super_admin) return true;
			return mergePermissions(
				parsePermissions(row.role_permissions),
				parsePermissions(row.user_permissions)
			).includes('leaves:approve');
		})
		.map((row) => row.id);
}

/**
 * Notify every active user who can approve leaves that a leave application
 * awaits review. Swallows its own errors so a notification failure never
 * breaks the originating request.
 */
export async function notifyLeaveApprovers({
	applicantId,
	applicantName,
	leaveTypeName,
	durationDays,
	startDate,
}) {
	let db;
	try {
		db = await dbConnect();

		const [rows] = await db.execute(
			`SELECT u.id, u.is_super_admin,
              u.permissions AS user_permissions,
              r.permissions AS role_permissions
       FROM users u
       LEFT JOIN roles_master r ON u.role_id = r.id
       WHERE u.isDelete = 0
         AND (u.is_active = 1 OR u.is_active IS NULL)
         AND (u.status = 'active' OR u.status IS NULL)`
		);

		const recipientIds = filterApprovers(rows, applicantId);
		if (recipientIds.length === 0) return;

		const body = `${applicantName ?? `User #${applicantId}`} requested ${durationDays} day(s) of ${leaveTypeName} starting ${startDate}`;
		const values = recipientIds.flatMap((userId) => [
			userId,
			'leave_request',
			'New leave request',
			body,
			'/employees/leaves',
		]);
		const placeholders = recipientIds.map(() => '(?, ?, ?, ?, ?)').join(', ');

		await db.execute(
			`INSERT INTO notifications (user_id, type, title, body, link)
       VALUES ${placeholders}`,
			values
		);
	} catch (error) {
		console.error('Failed to create leave notifications:', error);
	} finally {
		if (db) await db.release();
	}
}
