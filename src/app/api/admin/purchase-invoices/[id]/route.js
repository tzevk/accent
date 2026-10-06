import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import { loadSupplierInvoiceDetail } from '@/lib/company-expenditure';

const TABLE = 'purchase_invoices';

export async function GET(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		db = await dbConnect();
		const [rows] = await db.execute(
			`SELECT * FROM ${TABLE} WHERE id = ? AND isDelete = 0`,
			[id]
		);
		if (rows.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Not found' },
				{ status: 404 }
			);
		}
		// The financial detail the recognition dialog reads: service-period
		// slices, the confirmed source links, and the preserved candidate
		// mappings awaiting a document-backed decision.
		const detail = await loadSupplierInvoiceDetail(db, Number(id));
		return NextResponse.json({
			success: true,
			data: {
				...rows[0],
				splits: detail?.splits ?? [],
				links: detail?.links ?? [],
				link_candidates: detail?.link_candidates ?? [],
			},
		});
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

export async function PUT(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		const body = await request.json();
		const user = authResult.user;

		db = await dbConnect();

		const [stateRows] = await db.execute(
			`SELECT recognition_state FROM ${TABLE} WHERE id = ? AND isDelete = 0`,
			[id]
		);
		if (stateRows.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Purchase invoice not found' },
				{ status: 404 }
			);
		}
		if (stateRows[0].recognition_state === 'recognized') {
			return NextResponse.json(
				{
					success: false,
					error:
						'This invoice is recognized cost. Change it through the versioned command path, not the register.',
					code: 'cost_recognized',
				},
				{ status: 409 }
			);
		}
		const versionedFields = [
			'invoice_date',
			'subtotal',
			'tax_rate',
			'tax_amount',
			'cgst_amount',
			'sgst_amount',
			'igst_amount',
			'discount',
			'total',
			'project_id',
			'currency',
			'withholding_tax_amount',
			'po_id',
			'status',
		];
		const attempted = versionedFields.filter(
			(field) => body[field] !== undefined
		);
		if (attempted.length > 0) {
			return NextResponse.json(
				{
					success: false,
					error:
						'These are versioned financial fields. Change them through POST /api/admin/purchase-invoices/{id}/commands with command "update" and the current expected_version.',
					code: 'financial_fields_versioned',
					fields: attempted,
				},
				{ status: 422 }
			);
		}

		const fields = [
			'due_date',
			'vendor_name',
			'vendor_email',
			'vendor_phone',
			'vendor_address',
			'vendor_gstin',
			'vendor_pan',
			'po_number',
			'po_date',
			'description',
			'amount_paid',
			'balance_due',
			'payment_status',
			'notes',
			'terms',
			'attachment_url',
		];
		const setClauses = [];
		const values = [];
		for (const f of fields) {
			if (body[f] !== undefined) {
				setClauses.push(`${f} = ?`);
				values.push(body[f]);
			}
		}
		if (body.items !== undefined) {
			setClauses.push('items = ?');
			values.push(JSON.stringify(body.items));
		}
		if (setClauses.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'No fields to update' },
				{ status: 400 }
			);
		}
		values.push(id);
		await db.execute(
			`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = ? AND isDelete = 0`,
			values
		);

		await logActivity({
			userId: user?.id,
			actionType: 'update',
			resourceType: 'purchase_invoice',
			resourceId: id,
			description: `Updated purchase invoice ${id}`,
			request,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

export async function DELETE(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.DELETE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		const user = authResult.user;
		db = await dbConnect();
		const [stateRows] = await db.execute(
			`SELECT recognition_state FROM ${TABLE} WHERE id = ? AND isDelete = 0`,
			[id]
		);
		if (stateRows.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Purchase invoice not found' },
				{ status: 404 }
			);
		}
		if (stateRows[0].recognition_state === 'recognized') {
			return NextResponse.json(
				{
					success: false,
					error:
						'Recognized cost cannot be deleted. Cancel it through the versioned command path so its history stays.',
					code: 'cost_recognized',
				},
				{ status: 409 }
			);
		}
		const [result] = await db.execute(
			`UPDATE ${TABLE} SET isDelete = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ? AND isDelete = 0`,
			[user?.id ?? null, id]
		);
		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Purchase invoice not found' },
				{ status: 404 }
			);
		}

		await logActivity({
			userId: user?.id,
			actionType: 'delete',
			resourceType: 'purchase_invoice',
			resourceId: id,
			description: `Deleted purchase invoice ${id}`,
			request,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
