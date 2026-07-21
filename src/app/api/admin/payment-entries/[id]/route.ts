/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { updateInvoicePaymentStatus } from '@/utils/payment-utils';

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	let db: any;

	try {
		const authResult: any = await ensurePermission(
			request,
			RESOURCES.ADMIN,
			PERMISSIONS.UPDATE
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { id } = await params;
		const data = await request.json();

		db = await dbConnect();

		const [result] = await db.execute(
			`UPDATE payment_entries SET
        company_name = ?, city = ?, receipt_no = ?, receipt_date = ?, amount = ?, payment_date = ?, transaction_id = ?, bank_name = ?, remark = ?, invoice_no = ?, invoice_date = ?, payment_type = ?, tds_amount = ?, gst_amount = ?, net_amount = ?
       WHERE id = ? AND isDelete = 0`,
			[
				data.company_name || '',
				data.city || '',
				data.receipt_no || '',
				data.receipt_date || null,
				data.amount || 0,
				data.payment_date || null,
				data.transaction_id || '',
				data.bank_name || '',
				data.remark || '',
				data.invoice_no || '',
				data.invoice_date || null,
				data.payment_type || null,
				data.tds_amount || 0,
				data.gst_amount || 0,
				data.net_amount || 0,
				id,
			]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Payment entry not found' },
				{ status: 404 }
			);
		}

		if (data.invoice_no) {
			await updateInvoicePaymentStatus(db, data.invoice_no);
		}

		return NextResponse.json({
			success: true,
			message: 'Payment entry updated successfully',
		});
	} catch (error: any) {
		console.error('Update payment entry error:', error?.message);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to update payment entry',
				details: error?.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch {
				/* ignore */
			}
		}
	}
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	let db: any;

	try {
		const authResult: any = await ensurePermission(
			request,
			RESOURCES.ADMIN,
			PERMISSIONS.DELETE
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { id } = await params;

		db = await dbConnect();

		const [entries] = (await db.execute(
			'SELECT invoice_no FROM payment_entries WHERE id = ? AND isDelete = 0',
			[id]
		)) as any;
		const invoiceNo: string = entries.length > 0 ? entries[0].invoice_no : '';

		const [result] = await db.execute(
			'UPDATE payment_entries SET isDelete = 1 WHERE id = ? AND isDelete = 0',
			[id]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Payment entry not found' },
				{ status: 404 }
			);
		}

		if (invoiceNo) {
			await updateInvoicePaymentStatus(db, invoiceNo);
		}

		return NextResponse.json({
			success: true,
			message: 'Payment entry deleted successfully',
		});
	} catch (error: any) {
		console.error('Delete payment entry error:', error?.message);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to delete payment entry',
				details: error?.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch {
				/* ignore */
			}
		}
	}
}
