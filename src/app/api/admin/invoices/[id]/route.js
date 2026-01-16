import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getServerAuth } from '@/utils/server-auth';

// GET - Fetch single invoice
export async function GET(request, { params }) {
  let connection;
  try {
    const authResult = await getServerAuth();
    if (!authResult.authenticated) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    connection = await dbConnect();
    const [invoices] = await connection.execute(
      `SELECT * FROM invoices WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!invoices || invoices.length === 0) {
      return NextResponse.json({ success: false, message: 'Invoice not found' }, { status: 404 });
    }

    const invoice = invoices[0];

    // Parse items JSON
    if (invoice.items && typeof invoice.items === 'string') {
      try {
        invoice.items = JSON.parse(invoice.items);
      } catch {
        invoice.items = [];
      }
    }

    return NextResponse.json({ success: true, data: invoice });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
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
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const {
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
      balance_po_value,
      description,
      items,
      subtotal,
      tax_rate,
      tax_amount,
      discount,
      total,
      balance_due,
      notes,
      terms,
      due_date,
      status
    } = body;

    connection = await dbConnect();

    // Check if invoice exists
    const [existingInvoice] = await connection.execute('SELECT id FROM invoices WHERE id = ?', [id]);
    if (!existingInvoice || existingInvoice.length === 0) {
      return NextResponse.json({ success: false, message: 'Invoice not found' }, { status: 404 });
    }

    // Update invoice
    await connection.execute(
      `UPDATE invoices SET
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
        balance_po_value = ?,
        description = ?,
        items = ?,
        subtotal = ?,
        tax_rate = ?,
        tax_amount = ?,
        discount = ?,
        total = ?,
        balance_due = ?,
        notes = ?,
        terms = ?,
        due_date = ?,
        status = ?,
        updated_at = NOW()
      WHERE id = ?`,
      [
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
        balance_po_value || null,
        description || (items && items.length > 0 ? items.map(i => i.description).join(', ') : null),
        JSON.stringify(items || []),
        subtotal || 0,
        tax_rate || 0,
        tax_amount || 0,
        discount || 0,
        total || 0,
        balance_due || total || 0,
        notes || null,
        terms || null,
        due_date || null,
        status || 'draft',
        id
      ]
    );

    return NextResponse.json({ success: true, message: 'Invoice updated successfully' });
  } catch (error) {
    console.error('Error updating invoice:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
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
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    connection = await dbConnect();

    // Check if invoice exists
    const [existingInvoice] = await connection.execute('SELECT id FROM invoices WHERE id = ?', [id]);
    if (!existingInvoice || existingInvoice.length === 0) {
      return NextResponse.json({ success: false, message: 'Invoice not found' }, { status: 404 });
    }

    // Delete invoice
    await connection.execute('DELETE FROM invoices WHERE id = ?', [id]);

    return NextResponse.json({ success: true, message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  } finally {
    if (connection) await connection.end();
  }
}
