import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Download transaction receipt as PDF (placeholder - returns JSON for now)
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
        { success: false, message: 'Transaction ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [transactions] = await connection.execute(
      'SELECT * FROM account_transactions WHERE id = ?',
      [id]
    );

    if (!transactions || transactions.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Transaction not found' },
        { status: 404 }
      );
    }

    const transaction = transactions[0];

    // Parse attachments if needed
    if (typeof transaction.attachments === 'string') {
      transaction.attachments = JSON.parse(transaction.attachments);
    }

    // For now, return JSON data
    // In production, you would generate a PDF using a library like puppeteer, pdfkit, or react-pdf
    return NextResponse.json({
      success: true,
      message: 'PDF generation not yet implemented. Transaction data returned.',
      data: transaction
    });

  } catch (error) {
    console.error('Error downloading transaction:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to download transaction', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
