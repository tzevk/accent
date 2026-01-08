import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Download purchase order as PDF (placeholder - returns JSON for now)
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
        { success: false, message: 'Purchase order ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [purchaseOrders] = await connection.execute(
      'SELECT * FROM purchase_orders WHERE id = ?',
      [id]
    );

    if (!purchaseOrders || purchaseOrders.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Purchase order not found' },
        { status: 404 }
      );
    }

    const purchaseOrder = purchaseOrders[0];

    // Parse items if needed
    if (typeof purchaseOrder.items === 'string') {
      purchaseOrder.items = JSON.parse(purchaseOrder.items);
    }

    // For now, return JSON data
    // In production, you would generate a PDF using a library like puppeteer, pdfkit, or react-pdf
    return NextResponse.json({
      success: true,
      message: 'PDF generation not yet implemented. Purchase order data returned.',
      data: purchaseOrder
    });

  } catch (error) {
    console.error('Error downloading purchase order:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to download purchase order', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
