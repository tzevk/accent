/**
 * Disposable two-person collaboration fixture plus the independent monitoring
 * and audit starting states those admin journeys read.
 *
 * Messaging is the only feature here that creates its own rows through the
 * browser: the pair fixture seeds two ordinary active users and owns the
 * cleanup of the direct conversation and messages their journey produces.
 * The monitoring fixture seeds a separate ordinary user with today's presence
 * and activity statistics so the admin list has a deterministic card to open.
 * The audit fixture seeds one historical `update_permissions` entry with both
 * old and new permission sets, so the admin filter and its change evidence are
 * fixed before the browser starts.
 *
 * Every identity comes from `createJourneyUser`, so passwords are ephemeral
 * and disposed sessions keep no trace. Admin identities reuse the hook-seeded
 * `admin` role only because `/admin/live-monitoring` and the admin shell are
 * hard role-code gates. The audit route additionally requires `users:read`,
 * which the fixture grants directly to that user rather than widening the
 * shared role.
 */
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { createJourneyUser, type JourneyUser } from './journey-user.ts';

const MONITORED_CURRENT_PAGE = '/user/dashboard';
const MONITORED_SCREEN_TIME_MINUTES = 47;
const MONITORED_ACTIVITIES_COMPLETED = 6;
const MONITORED_PRODUCTIVITY_PERCENT = 75;

const AUDIT_OLD_PERMISSIONS = ['users:read', 'reports:read'];
const AUDIT_NEW_PERMISSIONS = ['users:read', 'payroll:read'];

export interface CollaborationPair {
	sender: JourneyUser;
	recipient: JourneyUser;
	/** Unique subject authored by the sender. */
	subject: string;
	/** Unique body authored by the sender. */
	senderBody: string;
	/** Unique body authored by the recipient. */
	replyBody: string;
	/**
	 * Delete the direct conversation and both messages, then both users and
	 * their sessions. Safe to call more than once.
	 */
	dispose(): Promise<void>;
}

export interface LiveMonitoringFixture {
	admin: JourneyUser;
	monitored: JourneyUser;
	/** Same deterministic email `createJourneyUser` stores for monitored. */
	monitoredEmail: string;
	screenTimeMinutes: number;
	activitiesCompleted: number;
	productivityPercent: number;
	/** Delete the monitored user (cascading presence/stats) and the admin. */
	dispose(): Promise<void>;
}

export interface AuditFilterFixture {
	admin: JourneyUser;
	/** Primary key of the single seeded audit entry. */
	auditId: number;
	resourceId: number;
	oldPermissions: string[];
	newPermissions: string[];
	/** Delete the audit entry first, then the admin and its sessions. */
	dispose(): Promise<void>;
}

interface ConversationIdRow extends RowDataPacket {
	conversation_id: number | string;
}

/**
 * Create the two messaging identities and return their unique expected
 * content. No message or conversation exists yet; the browser journey authors
 * both messages through the real compose and reply controls.
 */
export async function createCollaborationPair(
	connection: Connection,
	namespace: string
): Promise<CollaborationPair> {
	const sender = await createJourneyUser(connection, `${namespace}-sender`, []);

	let recipient: JourneyUser | null = null;
	try {
		recipient = await createJourneyUser(
			connection,
			`${namespace}-recipient`,
			[]
		);

		let disposed = false;
		return {
			sender,
			recipient,
			subject: fitIdentifier(`${namespace}-direct-message`, 200),
			senderBody: `Message from ${namespace} sender to recipient: please confirm the handoff.`,
			replyBody: `Reply from ${namespace} recipient: the handoff is confirmed.`,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await removeOwnedConversations(
						connection,
						sender.userId,
						recipient!.userId
					);
				} finally {
					try {
						await recipient!.dispose();
					} finally {
						await sender.dispose();
					}
				}
			},
		};
	} catch (error) {
		try {
			await recipient?.dispose();
		} finally {
			await sender.dispose();
		}
		throw error;
	}
}

/**
 * Create the admin and the monitored employee. Presence is `online` because
 * `last_seen` is refreshed at seed time; the fixed screen-time, activity and
 * productivity values let the browser prove it opened that exact card rather
 * than merely any card. The app derives status and joins these rows on today's
 * UTC date, matching `getUsersTodayStats`.
 */
export async function createLiveMonitoringFixture(
	connection: Connection,
	namespace: string
): Promise<LiveMonitoringFixture> {
	const admin = await createJourneyUser(
		connection,
		`${namespace}-monitor-admin`,
		[],
		{ admin: true }
	);

	let monitored: JourneyUser | null = null;
	const monitoredSeed = `${namespace}-monitored`;
	const monitoredEmail = `${fitIdentifier(monitoredSeed, 80).toLowerCase()}@e2e.invalid`;
	try {
		monitored = await createJourneyUser(connection, monitoredSeed, []);

		await connection.execute(
			`INSERT INTO user_presence (
          user_id, last_seen, is_idle, current_page, last_active_seen
        ) VALUES (?, NOW(), 0, ?, NOW())
        ON DUPLICATE KEY UPDATE
          last_seen = NOW(),
          is_idle = 0,
          current_page = ?,
          last_active_seen = NOW()`,
			[monitored.userId, MONITORED_CURRENT_PAGE, MONITORED_CURRENT_PAGE]
		);

		const today = new Date().toISOString().slice(0, 10);
		await connection.execute(
			`INSERT INTO user_screen_time (
          user_id, date, total_screen_time_minutes, active_time_minutes,
          idle_time_minutes, pages_visited
        ) VALUES (?, ?, ?, ?, ?, ?)`,
			[monitored.userId, today, MONITORED_SCREEN_TIME_MINUTES, 40, 7, 5]
		);
		await connection.execute(
			`INSERT INTO user_daily_summary (
          user_id, date, activities_completed, pages_viewed, productivity_score
        ) VALUES (?, ?, ?, ?, ?)`,
			[
				monitored.userId,
				today,
				MONITORED_ACTIVITIES_COMPLETED,
				5,
				MONITORED_PRODUCTIVITY_PERCENT,
			]
		);

		let disposed = false;
		return {
			admin,
			monitored,
			monitoredEmail,
			screenTimeMinutes: MONITORED_SCREEN_TIME_MINUTES,
			activitiesCompleted: MONITORED_ACTIVITIES_COMPLETED,
			productivityPercent: MONITORED_PRODUCTIVITY_PERCENT,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await monitored!.dispose();
				} finally {
					await admin.dispose();
				}
			},
		};
	} catch (error) {
		try {
			await monitored?.dispose();
		} finally {
			await admin.dispose();
		}
		throw error;
	}
}

/**
 * Create a `users:read` administrator and one `update_permissions` audit entry
 * whose previous and updated permission sets are deliberately different. The
 * admin's unique username is the audit search term; the entry belongs to the
 * admin's own user id so no extra identity is created for a read-only audit
 * journey.
 */
export async function createAuditFilterFixture(
	connection: Connection,
	namespace: string
): Promise<AuditFilterFixture> {
	const admin = await createJourneyUser(
		connection,
		`${namespace}-audit-admin`,
		['users:read'],
		{ admin: true }
	);

	let auditId: number | null = null;
	try {
		const [result] = await connection.execute<ResultSetHeader>(
			`INSERT INTO audit_logs (
          user_id, username, action, resource, resource_id,
          old_value, new_value, ip_address, user_agent
        ) VALUES (?, ?, 'update_permissions', 'user_permissions', ?, ?, ?, ?, ?)`,
			[
				admin.userId,
				admin.username,
				admin.userId,
				JSON.stringify({ permissions: AUDIT_OLD_PERMISSIONS }),
				JSON.stringify({ permissions: AUDIT_NEW_PERMISSIONS }),
				'198.51.100.10',
				'E2E audit filter fixture',
			]
		);
		auditId = Number(result.insertId);

		let disposed = false;
		return {
			admin,
			auditId,
			resourceId: admin.userId,
			oldPermissions: [...AUDIT_OLD_PERMISSIONS],
			newPermissions: [...AUDIT_NEW_PERMISSIONS],
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await connection.execute(
						'DELETE FROM audit_logs WHERE id = ? AND user_id = ?',
						[auditId!, admin.userId]
					);
				} finally {
					await admin.dispose();
				}
			},
		};
	} catch (error) {
		try {
			if (auditId !== null) {
				await connection.execute(
					'DELETE FROM audit_logs WHERE id = ? AND user_id = ?',
					[auditId, admin.userId]
				);
			}
		} finally {
			await admin.dispose();
		}
		throw error;
	}
}

/**
 * Conversations are found through the two disposable user ids, so cleanup
 * never depends on a subject or on another worker's data. Messages are deleted
 * before members and conversations because `messages.conversation_id` is set
 * null on conversation deletion; the pair predicate also removes any legacy
 * message row that never received a conversation id.
 */
async function removeOwnedConversations(
	connection: Connection,
	firstUserId: number,
	secondUserId: number
): Promise<void> {
	const [memberRows] = await connection.execute<ConversationIdRow[]>(
		`SELECT DISTINCT conversation_id
       FROM conversation_members
      WHERE user_id IN (?, ?)`,
		[firstUserId, secondUserId]
	);
	const conversationIds = memberRows
		.map((row) => Number(row.conversation_id))
		.filter((id) => Number.isInteger(id));

	await connection.execute(
		`DELETE FROM messages
      WHERE (sender_id = ? AND receiver_id = ?)
         OR (sender_id = ? AND receiver_id = ?)`,
		[firstUserId, secondUserId, secondUserId, firstUserId]
	);

	if (conversationIds.length === 0) return;

	const placeholders = conversationIds.map(() => '?').join(',');
	await connection.execute(
		`DELETE FROM messages WHERE conversation_id IN (${placeholders})`,
		conversationIds
	);
	await connection.execute(
		`DELETE FROM conversation_members WHERE conversation_id IN (${placeholders})`,
		conversationIds
	);
	await connection.execute(
		`DELETE FROM conversations WHERE id IN (${placeholders})`,
		conversationIds
	);
}
