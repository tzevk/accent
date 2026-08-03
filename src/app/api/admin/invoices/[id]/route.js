import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getServerAuth } from '@/utils/server-auth';
import { logActivity } from '@/utils/activity-logger';
import {
	validateInvoice,
	classifyDuplicateError,
} from '@/utils/invoice-validation';
import { R, sub, toNumber } from '@/lib/money';

// GET - Fetch single invoice
export async function GET(request, { params }) {
	let connection;
	try {
		const authResult = await getServerAuth();
		if (!authResult.authenticated) {
			return NextResponse.json(
				{ success: false, message: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { id } = await params;

		connection = await dbConnect();
		const [invoices] = await connection.execute(
			`SELECT * FROM invoices WHERE id = ? AND isDelete = 0 LIMIT 1`,
			[id]
		);

		if (!invoices || invoices.length === 0) {
			return NextResponse.json(
				{ success: false, message: 'Invoice not found' },
				{ status: 404 }
			);
		}

		const invoice = invoices[0];

		// Parse JSON items/line_items
		if (invoice.items && typeof invoice.items === 'string') {
			try {
				invoice.items = JSON.parse(invoice.items);
			} catch {
				invoice.items = [];
			}
		}
		if (invoice.line_items && typeof invoice.line_items === 'string') {
			try {
				invoice.line_items = JSON.parse(invoice.line_items);
			} catch {
				invoice.line_items = [];
			}
		}

		return NextResponse.json({ success: true, data: invoice });
	} catch (error) {
		console.error('Error fetching invoice:', error);
		return NextResponse.json(
			{ success: false, message: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}

// PUT - Update invoice
export async function PUT(request, { params }) {
	let connection;
	try {
		const authResult = await getServerAuth();
		if (!authResult.authenticated) {
			return NextResponse.json(
				{ success: false, message: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { id } = await params;
		const body = await request.json();

		const {
			invoice_number,
			invoice_date,
			client_name,
			client_email,
			client_phone,
			client_address,
			client_pan,
			client_gstin,
			client_state,
			client_state_code,
			kind_attn,
			po_number,
			po_date,
			po_value,
			original_po_value,
			balance_po_value,
			description,
			items,
			line_items,
			subtotal,
			gross_amount,
			tax_rate,
			tax_amount,
			gst_type,
			cgst_rate,
			sgst_rate,
			igst_rate,
			discount,
			total,
			net_amount,
			amount_in_words,
			gst_number,
			pan_number,
			tan_number,
			service_category,
			bank_address,
			balance_due,
			notes,
			terms,
			due_date,
			status,
		} = body;

		if (!client_name || !String(client_name).trim()) {
			return NextResponse.json(
				{
					success: false,
					message: 'Client name is required',
					errors: [
						{ field: 'client_name', message: 'Client name is required' },
					],
				},
				{ status: 400 }
			);
		}

		const validation = validateInvoice({
			invoice_number,
			invoice_date,
			client_name,
			client_email,
			client_phone,
			client_address,
			client_pan,
			client_gstin,
			client_state,
			client_state_code,
			kind_attn,
			po_number,
			po_date,
			original_po_value,
			balance_po_value,
			line_items,
			gst_type,
			cgst_rate,
			sgst_rate,
			igst_rate,
			total,
			gross_amount,
			tax_amount,
			tax_rate,
			status,
		});
		if (!validation.valid) {
			return NextResponse.json(
				{
					success: false,
					message: 'Validation failed',
					errors: validation.errors,
				},
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		// Fetch old invoice data before updating
		const [oldInvoice] = await connection.execute(
			'SELECT total, po_number, client_name, balance_po_value, po_id FROM invoices WHERE id = ? AND isDelete = 0',
			[id]
		);
		if (!oldInvoice || oldInvoice.length === 0) {
			return NextResponse.json(
				{ success: false, message: 'Invoice not found' },
				{ status: 404 }
			);
		}

		// Check for duplicate invoice_number (excluding this row) before UPDATE
		if (invoice_number && String(invoice_number).trim()) {
			const [existingInvoice] = await connection.execute(
				'SELECT id FROM invoices WHERE invoice_number = ? AND id <> ? AND isDelete = 0 LIMIT 1',
				[invoice_number, id]
			);
			if (existingInvoice.length > 0) {
				return NextResponse.json(
					{
						success: false,
						message: `Invoice number "${invoice_number}" already exists`,
						errors: [
							{
								field: 'invoice_number',
								message: `Invoice number "${invoice_number}" already exists`,
							},
						],
					},
					{ status: 409 }
				);
			}
		}

		// PO balance updates + the invoice UPDATE must be atomic: a crash between
		// them would leave purchase_orders.remaining_balance wrong while the
		// invoice row is unchanged (or vice versa).
		await connection.beginTransaction();

		const oldTotal = R(oldInvoice[0].total);
		const oldPoNumber = oldInvoice[0].po_number;
		const oldPoId = oldInvoice[0].po_id;
		const newTotal = R(total);

		// Calculate balance_po_value based on purchase_orders.
		// purchase_orders.po_number is globally unique (single-column index from
		// purchase-orders/route.js:37), so we look it up by po_number alone.
		let calculatedBalance = balance_po_value;
		let newPoId = oldPoId;
		const poChanged = po_number !== oldPoNumber;

		if (poChanged) {
			// Restore old PO balance
			if (oldPoId) {
				await connection.execute(
					'UPDATE purchase_orders SET remaining_balance = remaining_balance + ? WHERE id = ?',
					[oldTotal.toNumber(), oldPoId]
				);
			}

			// Handle new PO
			if (po_number && client_name) {
				const [newPO] = await connection.execute(
					'SELECT id, remaining_balance FROM purchase_orders WHERE po_number = ?',
					[po_number]
				);

				if (newPO.length > 0) {
					newPoId = newPO[0].id;
					const remaining = R(newPO[0].remaining_balance);
					calculatedBalance = toNumber(sub(remaining, newTotal));
					await connection.execute(
						'UPDATE purchase_orders SET remaining_balance = ? WHERE id = ?',
						[calculatedBalance, newPoId]
					);
				} else {
					const poValue = R(original_po_value);
					calculatedBalance = toNumber(sub(poValue, newTotal));
					await connection.execute(
						`INSERT INTO purchase_orders (po_number, client_name, original_value, remaining_balance, po_date)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               remaining_balance = VALUES(remaining_balance),
               original_value = VALUES(original_value),
               client_name = VALUES(client_name),
               po_date = VALUES(po_date)`,
						[
							po_number,
							client_name,
							poValue,
							calculatedBalance,
							po_date || null,
						]
					);

					const [poRow] = await connection.execute(
						'SELECT id FROM purchase_orders WHERE po_number = ?',
						[po_number]
					);
					newPoId = poRow?.[0]?.id ?? null;
				}
			} else {
				newPoId = null;
			}
		} else if (oldPoId) {
			// Same PO — adjust remaining_balance by difference
			const diff = toNumber(sub(oldTotal, newTotal));
			await connection.execute(
				'UPDATE purchase_orders SET remaining_balance = remaining_balance + ? WHERE id = ?',
				[diff, oldPoId]
			);
			const [poRecord] = await connection.execute(
				'SELECT remaining_balance FROM purchase_orders WHERE id = ?',
				[oldPoId]
			);
			calculatedBalance = R(poRecord?.[0]?.remaining_balance).toNumber();
		} else if (po_number && client_name) {
			// No old PO, but new PO info — create/upsert
			const [existingPO] = await connection.execute(
				'SELECT id, remaining_balance FROM purchase_orders WHERE po_number = ?',
				[po_number]
			);

			if (existingPO.length > 0) {
				newPoId = existingPO[0].id;
				const remaining = R(existingPO[0].remaining_balance);
				calculatedBalance = toNumber(sub(remaining, newTotal));
				await connection.execute(
					'UPDATE purchase_orders SET remaining_balance = ? WHERE id = ?',
					[calculatedBalance, newPoId]
				);
			} else {
				const poValue = R(original_po_value);
				calculatedBalance = toNumber(sub(poValue, newTotal));
				await connection.execute(
					`INSERT INTO purchase_orders (po_number, client_name, original_value, remaining_balance, po_date)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             remaining_balance = VALUES(remaining_balance),
             original_value = VALUES(original_value),
             client_name = VALUES(client_name),
             po_date = VALUES(po_date)`,
					[po_number, client_name, poValue, calculatedBalance, po_date || null]
				);

				const [poRow] = await connection.execute(
					'SELECT id FROM purchase_orders WHERE po_number = ?',
					[po_number]
				);
				newPoId = poRow?.[0]?.id ?? null;
			}
		}

		// Update invoice with calculated balance
		await connection.execute(
			`UPDATE invoices SET
        invoice_number = ?,
        invoice_date = ?,
        client_name = ?,
        client_email = ?,
        client_phone = ?,
        client_address = ?,
        client_pan = ?,
        client_gstin = ?,
        client_state = ?,
        client_state_code = ?,
        kind_attn = ?,
        po_number = ?,
        po_date = ?,
        po_value = ?,
        original_po_value = ?,
        balance_po_value = ?,
        po_id = ?,
        description = ?,
        items = ?,
        line_items = ?,
        subtotal = ?,
        gross_amount = ?,
        tax_rate = ?,
        tax_amount = ?,
        gst_type = ?,
        cgst_rate = ?,
        sgst_rate = ?,
        igst_rate = ?,
        discount = ?,
        total = ?,
        net_amount = ?,
        amount_in_words = ?,
        gst_number = ?,
        pan_number = ?,
        tan_number = ?,
        service_category = ?,
        bank_address = ?,
        balance_due = ?,
        notes = ?,
        terms = ?,
        due_date = ?,
        status = ?,
        updated_at = NOW()
      WHERE id = ?`,
			[
				invoice_number || null,
				invoice_date || null,
				client_name,
				client_email || null,
				client_phone || null,
				client_address || null,
				client_pan || null,
				client_gstin || null,
				client_state || null,
				client_state_code || null,
				kind_attn || null,
				po_number || null,
				po_date || null,
				po_value || null,
				original_po_value || null,
				calculatedBalance || null,
				newPoId,
				description ||
					(items && items.length > 0
						? items.map((i) => i.description).join(', ')
						: null),
				JSON.stringify(items || []),
				line_items ? JSON.stringify(line_items) : null,
				subtotal || 0,
				gross_amount || 0,
				tax_rate || 0,
				tax_amount || 0,
				gst_type || 'cgst_sgst',
				cgst_rate || 9,
				sgst_rate || 9,
				igst_rate || 18,
				discount || 0,
				total || 0,
				net_amount || 0,
				amount_in_words || null,
				gst_number || null,
				pan_number || null,
				tan_number || null,
				service_category || null,
				bank_address || null,
				balance_due || total || 0,
				notes || null,
				terms || null,
				due_date || null,
				status || 'draft',
				id,
			]
		);

		await connection.commit();

		return NextResponse.json({
			success: true,
			message: 'Invoice updated successfully',
		});
	} catch (error) {
		if (connection) await connection.rollback();
		console.error('Error updating invoice:', error);
		const dup = classifyDuplicateError(error);
		if (dup) {
			return NextResponse.json(
				{
					success: false,
					message: dup.message,
					errors: [{ field: dup.field, message: dup.message }],
				},
				{ status: dup.status }
			);
		}
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to update invoice',
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}

// DELETE - Delete invoice
// Soft delete: flags the row (isDelete = 1) and records deleted_at/deleted_by.
// Active-number uniqueness is enforced by unique_active_invoice on the
// generated column active_invoice_number (= invoice_number while active, NULL
// once deleted), so a deleted number can be reused without renaming the row —
// the old '-DEL' suffix workaround is no longer needed.
export async function DELETE(request, { params }) {
	let connection;
	try {
		const authResult = await getServerAuth();
		if (!authResult.authenticated) {
			return NextResponse.json(
				{ success: false, message: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { id } = await params;

		connection = await dbConnect();

		// PO balance restore + the soft-delete flag must be atomic: a crash
		// between them would restore the balance while the invoice stays visible
		// (or vice versa).
		await connection.beginTransaction();

		let deletedInvoiceNumber = null;
		try {
			// Fetch invoice data before deleting
			const [invoiceToDelete] = await connection.execute(
				'SELECT total, po_id, invoice_number FROM invoices WHERE id = ? AND isDelete = 0',
				[id]
			);
			if (!invoiceToDelete || invoiceToDelete.length === 0) {
				await connection.rollback();
				return NextResponse.json(
					{ success: false, message: 'Invoice not found' },
					{ status: 404 }
				);
			}
			deletedInvoiceNumber = invoiceToDelete[0].invoice_number;

			// Restore PO remaining balance
			const deleteTotal = R(invoiceToDelete[0].total).toNumber();
			const deletePoId = invoiceToDelete[0].po_id;
			if (deletePoId) {
				await connection.execute(
					'UPDATE purchase_orders SET remaining_balance = remaining_balance + ? WHERE id = ?',
					[deleteTotal, deletePoId]
				);
			}

			// Soft delete the invoice
			await connection.execute(
				'UPDATE invoices SET isDelete = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ? AND isDelete = 0',
				[authResult.user?.id ?? null, id]
			);

			await connection.commit();
		} catch (err) {
			await connection.rollback();
			throw err;
		}

		await logActivity({
			userId: authResult.user?.id,
			actionType: 'delete',
			resourceType: 'invoice',
			resourceId: id,
			description: `Deleted invoice ${deletedInvoiceNumber} (soft delete)`,
			request,
		});

		return NextResponse.json({
			success: true,
			message: 'Invoice deleted successfully',
		});
	} catch (error) {
		console.error('Error deleting invoice:', error);
		return NextResponse.json(
			{ success: false, message: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
