import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// GET - Generate next requisition number
export async function GET() {
	let db;
	try {
		db = await dbConnect();

		const [rows] = await db.query(
			`SELECT requisition_number FROM material_requisitions WHERE isDelete = 0 ORDER BY id DESC LIMIT 1`
		);

		let nextNumber = 'ATSPL/PUR-001';

		if (rows.length > 0) {
			const lastNumber = rows[0].requisition_number;
			// Extract number from format ATSPL/PUR-XXX
			const match = lastNumber.match(/ATSPL\/PUR-(\d+)/);
			if (match) {
				const num = parseInt(match[1]) + 1;
				nextNumber = `ATSPL/PUR-${num.toString().padStart(3, '0')}`;
			}
		}

		return NextResponse.json({
			success: true,
			requisition_number: nextNumber,
		});
	} catch (error) {
		console.error('Error generating requisition number:', error);
		return NextResponse.json({
			success: true,
			requisition_number: `ATSPL/PUR-${Date.now().toString().slice(-4)}`,
		});
	} finally {
		if (db) db.release();
	}
}
