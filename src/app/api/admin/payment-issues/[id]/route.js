import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

export async function PUT(request, { params }) {
	let db;
	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.ADMIN,
			PERMISSIONS.UPDATE
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { id } = await params;
		const body = await request.json();
		db = await dbConnect();

		const [result] = await db.execute(
			`UPDATE payment_issues SET
        payee_name = ?, payee_type = ?, invoice_number = ?, invoice_date = ?,
        invoice_amount = ?, amount = ?, deduction = ?, net_amount = ?,
        issue_date = ?, transaction_reference = ?, bank_name = ?, status = ?, notes = ?
       WHERE id = ? AND isDelete = 0`,
			[
				body.payee_name,
				body.payee_type || 'company',
				body.invoice_number || null,
				body.invoice_date || null,
				body.invoice_amount || 0,
				body.amount || 0,
				body.deduction || 0,
				body.net_amount || 0,
				body.issue_date || null,
				body.transaction_reference || null,
				body.bank_name || null,
				body.status || 'full',
				body.notes || null,
				id,
			]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Payment issue not found' },
				{ status: 404 }
			);
		}

		return NextResponse.json({
			success: true,
			message: 'Payment issue updated',
		});
	} catch (error) {
		console.error('Error updating payment issue:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to update payment issue' },
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

export async function DELETE(request, { params }) {
	let db;
	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.ADMIN,
			PERMISSIONS.DELETE
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { id } = await params;
		db = await dbConnect();

		const [result] = await db.execute(
			`UPDATE payment_issues SET isDelete = 1 WHERE id = ? AND isDelete = 0`,
			[id]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Payment issue not found' },
				{ status: 404 }
			);
		}

		return NextResponse.json({
			success: true,
			message: 'Payment issue deleted',
		});
	} catch (error) {
		console.error('Error deleting payment issue:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to delete payment issue' },
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
