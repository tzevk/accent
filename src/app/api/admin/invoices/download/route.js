import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Download invoice as PDF (placeholder - returns JSON for now)
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Invoice ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [invoices] = await connection.execute(
      'SELECT * FROM invoices WHERE id = ?',
      [id]
    );

    if (!invoices || invoices.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Invoice not found' },
        { status: 404 }
      );
    }

    const invoice = invoices[0];

    // Parse items if needed
    if (typeof invoice.items === 'string') {
      invoice.items = JSON.parse(invoice.items);
    }

    // For now, return JSON data
    // In production, you would generate a PDF using a library like puppeteer, pdfkit, or react-pdf
    return NextResponse.json({
      success: true,
      message: 'PDF generation not yet implemented. Invoice data returned.',
      data: invoice
    });

  } catch (error) {
    console.error('Error downloading invoice:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to download invoice', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
