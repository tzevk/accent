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

		// Current month (01-12)
		const now = new Date();
		const month = String(now.getMonth() + 1).padStart(2, '0');

		// Financial year (April start)
		const currentYear = now.getFullYear();
		const currentMonth = now.getMonth() + 1;
		let fyStart = currentMonth >= 4 ? currentYear : currentYear - 1;
		let fyEnd = fyStart + 1;
		const fyString = `${String(fyStart).slice(-2)}-${String(fyEnd).slice(-2)}`;

		const pattern = `ATSPL/Q/${month}/${fyString}/%`;

		// Get the last quotation_number for this month+FY
		const [rows] = await db.execute(
			`SELECT quotation_number FROM quotations
			 WHERE quotation_number LIKE ?
			 AND (isDelete = 0 OR isDelete IS NULL)
			 ORDER BY id DESC LIMIT 1`,
			[pattern]
		);

		let sequence = 1;
		if (rows.length > 0 && rows[0].quotation_number) {
			const match = rows[0].quotation_number.match(
				new RegExp(`ATSPL/Q/${month}/${fyString}/(\\d+)`)
			);
			if (match) {
				sequence = parseInt(match[1], 10) + 1;
			}
		}

		const quotationNumber = `ATSPL/Q/${month}/${fyString}/${String(sequence).padStart(3, '0')}`;

		return NextResponse.json({
			success: true,
			quotation_number: quotationNumber,
		});
	} catch (error) {
		console.error('Error generating next quotation number:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to generate quotation number' },
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
