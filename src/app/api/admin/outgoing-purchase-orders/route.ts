import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

/**
 * LEGACY READ ONLY (ticket #310). `outgoing_purchase_orders` is one of the
 * four pre-canonical order stores; its rows are queued in the canonical order
 * review and are not classified by the store's name. Entry and deletion moved
 * to the canonical order API, so this endpoint no longer writes.
 */
export async function GET(request: Request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PURCHASE_ORDERS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		connection = await dbConnect();

		const [rows] = await connection.execute(
			'SELECT * FROM outgoing_purchase_orders WHERE isDelete = 0 ORDER BY created_at DESC'
		);
		return NextResponse.json({ success: true, legacy: true, data: rows });
	} catch (error) {
		console.error('Error fetching outgoing purchase orders:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to fetch outgoing purchase orders',
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			{ status: 500 }
		);
	} finally {
		if (connection) {
			try {
				await connection.release();
			} catch {
				try {
					await connection.end();
				} catch {
					// Connection already closed.
				}
			}
		}
	}
}
