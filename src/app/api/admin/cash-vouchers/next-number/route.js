import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/admin/cash-vouchers/next-number
 * Get the next voucher number
 */
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

		// Get current month number (01-12)
		const now = new Date();
		const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
		const monthPattern = `C-${currentMonth}|`;

		// Get last voucher number for current month
		const [lastVoucher] = await db.execute(
			`SELECT voucher_number FROM cash_vouchers 
       WHERE voucher_number LIKE ? 
       ORDER BY id DESC LIMIT 1`,
			[`C-${currentMonth}|%`]
		);

		let voucherNumber = `${monthPattern}001`;
		if (lastVoucher.length > 0 && lastVoucher[0].voucher_number) {
			// Extract the serial number from format C-MM|XXX
			const match = lastVoucher[0].voucher_number.match(/C-\d{2}\|(\d+)/);
			if (match) {
				const lastNum = parseInt(match[1]) || 0;
				voucherNumber = `${monthPattern}${String(lastNum + 1).padStart(3, '0')}`;
			}
		}

		return NextResponse.json({
			success: true,
			voucher_number: voucherNumber,
		});
	} catch (error) {
		console.error('Get next voucher number error:', error?.message);
		return NextResponse.json(
			{ success: false, error: 'Failed to get voucher number' },
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
