import { dbConnect } from '@/utils/database';
import type { DbConnection } from '@/server/leads/shared';

/**
 * One read-only repeatable-read observation on the shared pool. Every section
 * receives this connection, so summaries and complete export details see the
 * same corrected facts even when operational writes happen during the read.
 */
export async function withLeadAuditConnection<T>(
	read: (db: DbConnection) => Promise<T>
): Promise<T> {
	const db = (await dbConnect()) as unknown as DbConnection;
	let started = false;
	try {
		await db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
		await db.execute('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
		started = true;
		const result = await read(db);
		await db.execute('COMMIT');
		started = false;
		return result;
	} catch (error) {
		if (started) await db.execute('ROLLBACK');
		throw error;
	} finally {
		db.release?.();
	}
}
