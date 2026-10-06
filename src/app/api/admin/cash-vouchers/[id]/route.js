import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	ensureFundingMirror,
	loadVoucherGuard,
	voucherRegisterRefusal,
} from '@/lib/company-expenditure';

/**
 * GET /api/admin/cash-vouchers/[id]
 * Get a single cash voucher by ID
 */
export async function GET(request, { params }) {
	let db;

	try {
		const { id } = await params;

		// Auth check
		let user;
		try {
			user = await getCurrentUser(request);
		} catch (authErr) {
			console.error('Auth check failed:', authErr?.message);
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

		// Only admin can access
		if (!user.is_super_admin && user.role?.code !== 'admin') {
			return NextResponse.json(
				{ success: false, error: 'Forbidden' },
				{ status: 403 }
			);
		}

		db = await dbConnect();

		const [vouchers] = await db.execute(
			'SELECT * FROM cash_vouchers WHERE id = ?',
			[id]
		);

		if (vouchers.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Voucher not found' },
				{ status: 404 }
			);
		}

		const voucher = vouchers[0];

		// Parse line_items if it's a string
		if (voucher.line_items && typeof voucher.line_items === 'string') {
			try {
				voucher.line_items = JSON.parse(voucher.line_items);
			} catch (e) {
				voucher.line_items = [];
			}
		}

		return NextResponse.json({
			success: true,
			data: voucher,
		});
	} catch (error) {
		console.error('Get cash voucher error:', error?.message, error?.stack);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch cash voucher',
				details: error?.message,
			},
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

/**
 * PUT /api/admin/cash-vouchers/[id]
 * Update a cash voucher
 */
export async function PUT(request, { params }) {
	let db;

	try {
		const { id } = await params;
		const body = await request.json();

		// Auth check
		let user;
		try {
			user = await getCurrentUser(request);
		} catch (authErr) {
			console.error('Auth check failed:', authErr?.message);
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

		// Only admin can access
		if (!user.is_super_admin && user.role?.code !== 'admin') {
			return NextResponse.json(
				{ success: false, error: 'Forbidden' },
				{ status: 403 }
			);
		}

		db = await dbConnect();

		// The voucher row is locked for the whole mutation (`loadVoucherGuard`),
		// so a concurrent spending capture serializes on it: the funding floor
		// and the mirror update cannot race a spend insert.
		const [existing] = await db.execute(
			'SELECT id, voucher_number, voucher_date FROM cash_vouchers WHERE id = ? AND (isDelete IS NULL OR isDelete = 0)',
			[id]
		);
		if (existing.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Voucher not found' },
				{ status: 404 }
			);
		}

		const {
			voucher_date,
			voucher_type = 'payment',
			paid_to,
			project_number,
			payment_mode = 'cash',
			total_amount,
			amount_in_words,
			line_items,
			prepared_by,
			checked_by,
			approved_by,
			receiver_signature,
			notes,
			description,
		} = body;

		// The voucher and its one funding mirror move together, and funding can
		// never fall below the spending already drawn from it.
		await db.execute('START TRANSACTION');
		try {
			const guard = await loadVoucherGuard(db, Number(id));
			if (!guard) {
				await db.execute('ROLLBACK');
				return NextResponse.json(
					{ success: false, error: 'Voucher not found' },
					{ status: 404 }
				);
			}
			const refusal = voucherRegisterRefusal(
				guard,
				total_amount === undefined ? null : Number(total_amount || 0)
			);
			if (refusal) {
				await db.execute('ROLLBACK');
				return NextResponse.json(
					{
						success: false,
						error: refusal.message,
						code: refusal.code,
						...refusal.detail,
					},
					{ status: refusal.status }
				);
			}

			await db.execute(
				`UPDATE cash_vouchers SET
        voucher_date = ?,
        voucher_type = ?,
        paid_to = ?,
        project_number = ?,
        payment_mode = ?,
        total_amount = ?,
        amount_in_words = ?,
        line_items = ?,
        prepared_by = ?,
        checked_by = ?,
        approved_by_name = ?,
        receiver_signature = ?,
        description = ?,
        notes = ?,
        updated_at = NOW()
      WHERE id = ?`,
				[
					voucher_date,
					voucher_type,
					paid_to || null,
					project_number || null,
					payment_mode,
					total_amount || 0,
					amount_in_words || null,
					JSON.stringify(line_items || []),
					prepared_by || null,
					checked_by || null,
					approved_by || null,
					receiver_signature || null,
					description || null,
					notes || null,
					id,
				]
			);

			if (total_amount !== undefined) {
				// Update the same funding row (never spending rows), creating it
				// once when an edit lands on a voucher that had none.
				await ensureFundingMirror(db, {
					voucherId: Number(id),
					voucherNumber: existing[0].voucher_number,
					voucherDate: voucher_date ?? existing[0].voucher_date,
					totalAmount: Number(total_amount || 0),
					description: description || notes || null,
					currency: null,
					actorId: user.id,
				});
			}

			await db.execute('COMMIT');
		} catch (txError) {
			await db.execute('ROLLBACK');
			throw txError;
		}

		return NextResponse.json({
			success: true,
			message: 'Voucher updated successfully',
		});
	} catch (error) {
		console.error('Update cash voucher error:', error?.message, error?.stack);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to update cash voucher',
				details: error?.message,
			},
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

/**
 * DELETE /api/admin/cash-vouchers/[id]
 * Delete a cash voucher
 */
export async function DELETE(request, { params }) {
	let db;

	try {
		const { id } = await params;

		// Auth check
		let user;
		try {
			user = await getCurrentUser(request);
		} catch (authErr) {
			console.error('Auth check failed:', authErr?.message);
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

		// Only admin can access
		if (!user.is_super_admin && user.role?.code !== 'admin') {
			return NextResponse.json(
				{ success: false, error: 'Forbidden' },
				{ status: 403 }
			);
		}

		db = await dbConnect();

		// Spending must not disappear with its funding voucher, and no capture
		// may slip between the count and the delete: the voucher row is locked
		// for the whole mutation, and capture locks the same row before insert.
		await db.execute('START TRANSACTION');
		try {
			const guard = await loadVoucherGuard(db, Number(id));
			if (!guard) {
				await db.execute('ROLLBACK');
				return NextResponse.json(
					{ success: false, error: 'Voucher not found' },
					{ status: 404 }
				);
			}
			const refusal = voucherRegisterRefusal(guard);
			if (refusal) {
				await db.execute('ROLLBACK');
				return NextResponse.json(
					{
						success: false,
						error: refusal.message,
						code: refusal.code,
						...refusal.detail,
					},
					{ status: refusal.status }
				);
			}

			await db.execute(
				'UPDATE cash_vouchers SET isDelete = 1 WHERE id = ? AND (isDelete IS NULL OR isDelete = 0)',
				[id]
			);
			await db.execute(
				`UPDATE petty_cash_expenses SET isDelete = 1
          WHERE source_voucher_id = ? AND entry_kind = 'funding'`,
				[id]
			);
			await db.execute('COMMIT');
		} catch (txError) {
			await db.execute('ROLLBACK');
			throw txError;
		}

		return NextResponse.json({
			success: true,
			message: 'Voucher deleted successfully',
		});
	} catch (error) {
		console.error('Delete cash voucher error:', error?.message, error?.stack);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to delete cash voucher',
				details: error?.message,
			},
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
