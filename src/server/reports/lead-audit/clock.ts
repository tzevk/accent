import type { DbConnection } from '@/server/leads/shared';
import type { LeadAuditClock } from './types';

interface ClockRow {
	today: string;
	generated_at: string;
	session_time_zone: string | null;
	system_time_zone: string | null;
	utc_offset: string | null;
}

function formatOffset(value: string): string {
	const match = /^(-)?(\d{2}):(\d{2})/.exec(value);
	if (!match) return value;
	return `UTC${match[1] ?? '+'}${match[2]}:${match[3]}`;
}

/**
 * Read the observation time and the actual reporting time zone from the
 * database itself. The browser and the Node process never decide the
 * calendar day: the same `CURDATE()` policy as the Lead queues does.
 */
export async function readLeadAuditClock(
	db: DbConnection
): Promise<LeadAuditClock> {
	const [result] = (await db.execute(
		`SELECT
       DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today,
       DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS generated_at,
       @@session.time_zone AS session_time_zone,
       @@system_time_zone AS system_time_zone,
       TIMEDIFF(NOW(), UTC_TIMESTAMP()) AS utc_offset`
	)) as unknown as [ClockRow[], unknown];
	const row = result[0];
	if (!row?.today) {
		throw new Error('The database clock did not return a calendar day');
	}
	const session = row.session_time_zone ? String(row.session_time_zone) : 'SYSTEM';
	const system = row.system_time_zone ? String(row.system_time_zone) : 'SYSTEM';
	const utcOffset = row.utc_offset ? String(row.utc_offset) : '00:00:00';
	const namedZone = session === 'SYSTEM' ? system : session;
	return {
		today: String(row.today),
		generatedAt: String(row.generated_at),
		timeZone: {
			session,
			system,
			utcOffset,
			label: `${namedZone} (${formatOffset(utcOffset)})`,
		},
	};
}
