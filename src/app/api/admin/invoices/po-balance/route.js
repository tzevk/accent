import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

export async function GET(request) {
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
		const poNumber = searchParams.get('po_number');
		// client_name is accepted for backwards compatibility with the create-page
		// caller, but no longer required: purchase_orders.po_number is globally unique.
		searchParams.get('client_name');

		if (!poNumber) {
			return NextResponse.json(
				{ success: false, message: 'po_number is required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		// purchase_orders.po_number is globally unique; look it up by po_number alone.
		// client_name is accepted for backwards compatibility but no longer required.
		const [poRows] = await connection.execute(
			'SELECT id, original_value, remaining_balance FROM purchase_orders WHERE po_number = ?',
			[poNumber]
		);

		if (poRows.length === 0) {
			return NextResponse.json({
				success: true,
				data: { exists: false, remaining_balance: 0, original_value: 0 },
			});
		}

		return NextResponse.json({
			success: true,
			data: {
				exists: true,
				id: poRows[0].id,
				original_value: poRows[0].original_value,
				remaining_balance: poRows[0].remaining_balance,
			},
		});
	} catch (error) {
		console.error('Error fetching PO balance:', error);
		return NextResponse.json(
			{ success: false, message: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
