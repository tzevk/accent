import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getServerAuth } from '@/utils/server-auth';

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
			`SELECT * FROM invoices WHERE id = ? LIMIT 1`,
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

		connection = await dbConnect();

		// Ensure schema has po_id column and purchase_orders table
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

		// Fetch old invoice data before updating
		const [oldInvoice] = await connection.execute(
			'SELECT total, po_number, client_name, balance_po_value, po_id FROM invoices WHERE id = ?',
			[id]
		);
		if (!oldInvoice || oldInvoice.length === 0) {
			return NextResponse.json(
				{ success: false, message: 'Invoice not found' },
				{ status: 404 }
			);
		}

		const oldTotal = parseFloat(oldInvoice[0].total) || 0;
		const oldPoNumber = oldInvoice[0].po_number;
		const oldClientName = oldInvoice[0].client_name;
		const oldPoId = oldInvoice[0].po_id;
		const newTotal = parseFloat(total) || 0;

		// Calculate balance_po_value based on purchase_orders
		let calculatedBalance = balance_po_value;
		let newPoId = oldPoId;
		const poChanged =
			po_number !== oldPoNumber || client_name !== oldClientName;

		if (poChanged) {
			// Restore old PO balance
			if (oldPoId) {
				await connection.execute(
					'UPDATE purchase_orders SET remaining_balance = remaining_balance + ? WHERE id = ?',
					[oldTotal, oldPoId]
				);
			}

			// Handle new PO
			if (po_number && client_name) {
				const [newPO] = await connection.execute(
					'SELECT id, remaining_balance FROM purchase_orders WHERE po_number = ? AND client_name = ?',
					[po_number, client_name]
				);

				if (newPO.length > 0) {
					newPoId = newPO[0].id;
					const remaining = parseFloat(newPO[0].remaining_balance) || 0;
					calculatedBalance = remaining - newTotal;
					await connection.execute(
						'UPDATE purchase_orders SET remaining_balance = ? WHERE id = ?',
						[calculatedBalance, newPoId]
					);
				} else {
					const poValue = parseFloat(original_po_value) || 0;
					calculatedBalance = poValue - newTotal;
					const [poResult] = await connection.execute(
						`INSERT INTO purchase_orders (po_number, client_name, original_value, remaining_balance, po_date)
             VALUES (?, ?, ?, ?, ?)`,
						[
							po_number,
							client_name,
							poValue,
							calculatedBalance,
							po_date || null,
						]
					);
					newPoId = poResult.insertId;
				}
			} else {
				newPoId = null;
			}
		} else if (oldPoId) {
			// Same PO — adjust remaining_balance by difference
			const diff = oldTotal - newTotal;
			await connection.execute(
				'UPDATE purchase_orders SET remaining_balance = remaining_balance + ? WHERE id = ?',
				[diff, oldPoId]
			);
			const [poRecord] = await connection.execute(
				'SELECT remaining_balance FROM purchase_orders WHERE id = ?',
				[oldPoId]
			);
			calculatedBalance = parseFloat(poRecord[0]?.remaining_balance) || 0;
		} else if (po_number && client_name) {
			// No old PO, but new PO info — create/upsert
			const [existingPO] = await connection.execute(
				'SELECT id, remaining_balance FROM purchase_orders WHERE po_number = ? AND client_name = ?',
				[po_number, client_name]
			);

			if (existingPO.length > 0) {
				newPoId = existingPO[0].id;
				const remaining = parseFloat(existingPO[0].remaining_balance) || 0;
				calculatedBalance = remaining - newTotal;
				await connection.execute(
					'UPDATE purchase_orders SET remaining_balance = ? WHERE id = ?',
					[calculatedBalance, newPoId]
				);
			} else {
				const poValue = parseFloat(original_po_value) || 0;
				calculatedBalance = poValue - newTotal;
				const [poResult] = await connection.execute(
					`INSERT INTO purchase_orders (po_number, client_name, original_value, remaining_balance, po_date)
           VALUES (?, ?, ?, ?, ?)`,
					[po_number, client_name, poValue, calculatedBalance, po_date || null]
				);
				newPoId = poResult.insertId;
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
				calculatedBalance,
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

		return NextResponse.json({
			success: true,
			message: 'Invoice updated successfully',
		});
	} catch (error) {
		console.error('Error updating invoice:', error);
		return NextResponse.json(
			{ success: false, message: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}

// DELETE - Delete invoice
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

		// Fetch invoice data before deleting
		const [invoiceToDelete] = await connection.execute(
			'SELECT total, po_id FROM invoices WHERE id = ?',
			[id]
		);
		if (!invoiceToDelete || invoiceToDelete.length === 0) {
			return NextResponse.json(
				{ success: false, message: 'Invoice not found' },
				{ status: 404 }
			);
		}

		// Restore PO remaining balance
		const deleteTotal = parseFloat(invoiceToDelete[0].total) || 0;
		const deletePoId = invoiceToDelete[0].po_id;
		if (deletePoId) {
			await connection.execute(
				'UPDATE purchase_orders SET remaining_balance = remaining_balance + ? WHERE id = ?',
				[deleteTotal, deletePoId]
			);
		}

		// Delete invoice
		await connection.execute('DELETE FROM invoices WHERE id = ?', [id]);

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
