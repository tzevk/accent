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
	if (authResult.authorized === false) return authResult.response;

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

		try {
			await connection.execute(
				`ALTER TABLE invoices ADD COLUMN po_id INT NULL`
			);
		} catch (_) {}
		try {
			await connection.execute(`
        CREATE TABLE IF NOT EXISTS purchase_orders (
          id INT AUTO_INCREMENT PRIMARY KEY,
          po_number VARCHAR(100) NOT NULL,
          client_name VARCHAR(255) NOT NULL,
          original_value DECIMAL(15, 2) NOT NULL DEFAULT 0,
          remaining_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
          po_date DATE NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_po (po_number(100), client_name(255))
        )
      `);
		} catch (_) {}
		for (const col of [
			{ name: 'po_number', definition: 'VARCHAR(100) NOT NULL' },
			{ name: 'client_name', definition: 'VARCHAR(255) NOT NULL' },
			{
				name: 'original_value',
				definition: 'DECIMAL(15, 2) NOT NULL DEFAULT 0',
			},
			{
				name: 'remaining_balance',
				definition: 'DECIMAL(15, 2) NOT NULL DEFAULT 0',
			},
			{ name: 'po_date', definition: 'DATE NULL' },
		]) {
			try {
				await connection.execute(
					`ALTER TABLE purchase_orders ADD COLUMN ${col.name} ${col.definition}`
				);
			} catch (_) {}
		}
		try {
			await connection.execute(
				`ALTER TABLE purchase_orders MODIFY COLUMN vendor_name VARCHAR(255) NULL`
			);
		} catch (_) {}
		try {
			await connection.execute(
				`ALTER TABLE purchase_orders ALTER COLUMN vendor_name SET DEFAULT ''`
			);
		} catch (_) {}

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
