import { dbConnect } from '@/utils/database';
import type { DbConnection } from '@/server/leads/shared';

/**
 * One connection for one report observation. Every section read accepts this
 * connection, so a later workbook export can build all sections from one
 * consistent observation without opening a report-specific pool.
 */
export async function withLeadAuditConnection<T>(
	read: (db: DbConnection) => Promise<T>
): Promise<T> {
	const db = (await dbConnect()) as unknown as DbConnection;
	try {
		return await read(db);
	} finally {
		db.release?.();
	}
}
