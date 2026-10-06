import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

/**
 * LEGACY READ ONLY (ticket #310). `purchase_orders` is one of the four
 * pre-canonical order stores: its rows carry no reliable direction and are
 * queued in the canonical order review (see `/api/admin/orders/review`).
 * Order entry, edits, and deletes moved to the canonical order API — this
 * endpoint no longer writes, so it cannot create a second order truth.
 */
export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const status = searchParams.get('status');
		const sortBy = searchParams.get('sortBy') || 'po_date';
		const sortOrder = (searchParams.get('sortOrder') || 'desc').toLowerCase();
		const offset = (page - 1) * limit;

		connection = await dbConnect();

		// Build query
		let query =
			'SELECT * FROM purchase_orders WHERE (isDelete = 0 OR isDelete IS NULL)';
		const params = [];

		if (status && status !== 'all') {
			query += ' AND status = ?';
			params.push(status);
		}

		// Get total count
		const countQuery = query.replace('*', 'COUNT(*) as total');
		const [countResult] = await connection.execute(countQuery, params);
		const total = countResult?.[0]?.total || 0;

		// Validate sort parameters against allowlist
		const ALLOWED_SORT = [
			'po_date',
			'created_at',
			'po_number',
			'vendor_name',
			'total',
			'po_amount',
			'net_amount',
			'delivery_date',
			'status',
			'updated_at',
		];
		const validSortBy = ALLOWED_SORT.includes(sortBy) ? sortBy : 'po_date';
		const validSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

		// Build ORDER BY with NULL-safe handling for date columns
		let orderClause;
		const isDateColumn = ['po_date', 'delivery_date'].includes(validSortBy);
		if (isDateColumn) {
			orderClause = `ORDER BY (${validSortBy} IS NULL), ${validSortBy} ${validSortOrder}, id DESC`;
		} else {
			orderClause = `ORDER BY ${validSortBy} ${validSortOrder}, id DESC`;
		}

		// Get paginated results
		query += ` ${orderClause} LIMIT ? OFFSET ?`;
		params.push(limit, offset);

		const [purchaseOrders] = await connection.execute(query, params);

		// Parse JSON items for each purchase order
		const parsedPurchaseOrders = purchaseOrders.map((po) => ({
			...po,
			items: typeof po.items === 'string' ? JSON.parse(po.items) : po.items,
		}));

		return NextResponse.json({
			success: true,
			legacy: true,
			data: parsedPurchaseOrders,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		console.error('Error fetching purchase orders:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to fetch purchase orders',
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
