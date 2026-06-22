import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';

export async function GET(request) {
	let db;
	try {
		let user;
		try {
			user = await getCurrentUser(request);
		} catch (authErr) {
			return NextResponse.json(
				{ success: false, error: 'Authentication failed' },
				{ status: 500 }
			);
		}

		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		db = await dbConnect();

		const now = new Date();
		const year = now.getFullYear().toString().slice(-2);
		const month = (now.getMonth() + 1).toString().padStart(2, '0');
		const pattern = `INV-${year}${month}-%`;

		// Get the last invoice_number for this month
		const [rows] = await db.execute(
			`SELECT invoice_number FROM invoices
			 WHERE invoice_number LIKE ?
			 ORDER BY id DESC LIMIT 1`,
			[pattern]
		);

		let sequence = 1;
		if (rows.length > 0 && rows[0].invoice_number) {
			const match = rows[0].invoice_number.match(
				new RegExp(`INV-${year}${month}-(\\d+)`)
			);
			if (match) {
				sequence = parseInt(match[1], 10) + 1;
			}
		}

		const invoiceNumber = `INV-${year}${month}-${String(sequence).padStart(4, '0')}`;

		return NextResponse.json({
			success: true,
			invoice_number: invoiceNumber,
		});
	} catch (error) {
		console.error('Error generating next invoice number:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to generate invoice number' },
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
				/* ignore */
			}
		}
	}
}
