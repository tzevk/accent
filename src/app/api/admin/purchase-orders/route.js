import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Fetch purchase orders
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const offset = (page - 1) * limit;

    connection = await dbConnect();

    // Check if table exists, create if not
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        po_number VARCHAR(50) UNIQUE NOT NULL,
        vendor_name VARCHAR(255) NOT NULL,
        vendor_email VARCHAR(255),
        vendor_phone VARCHAR(50),
        vendor_address TEXT,
        description VARCHAR(500),
        items JSON,
        subtotal DECIMAL(15, 2) DEFAULT 0,
        tax_rate DECIMAL(5, 2) DEFAULT 18,
        tax_amount DECIMAL(15, 2) DEFAULT 0,
        discount DECIMAL(15, 2) DEFAULT 0,
        total DECIMAL(15, 2) DEFAULT 0,
        notes TEXT,
        terms TEXT,
        delivery_date DATE,
        status ENUM('draft', 'pending', 'approved', 'completed', 'cancelled') DEFAULT 'draft',
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      )
    `);

    // Build query
    let query = 'SELECT * FROM purchase_orders WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    // Get total count
    const countQuery = query.replace('*', 'COUNT(*) as total');
    const [countResult] = await connection.execute(countQuery, params);
    const total = countResult?.[0]?.total || 0;

    // Get paginated results
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [purchaseOrders] = await connection.execute(query, params);

    // Parse JSON items for each purchase order
    const parsedPurchaseOrders = purchaseOrders.map(po => ({
      ...po,
      items: typeof po.items === 'string' ? JSON.parse(po.items) : po.items
    }));

    // Get stats
    let stats = { total: 0, draft: 0, pending: 0, approved: 0, completed: 0, cancelled: 0 };
    try {
      const [statsResult] = await connection.execute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM purchase_orders
      `);
      stats = statsResult[0] || stats;
    } catch (statsError) {
      console.error('Error fetching stats:', statsError);
    }

    return NextResponse.json({
      success: true,
      data: parsedPurchaseOrders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      stats
    });

  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch purchase orders', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// POST - Create new purchase order
export async function POST(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.WRITE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    const {
      po_number: providedPoNumber,
      vendor_name,
      vendor_email,
      vendor_phone,
      vendor_address,
      description,
      items,
      subtotal,
      tax_rate,
      tax_amount,
      discount,
      total,
      notes,
      terms,
      delivery_date,
      status = 'draft',
      company_id,
      project_id
    } = body;

    if (!vendor_name) {
      return NextResponse.json(
        { success: false, message: 'Vendor name is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    // Ensure table exists with project_id column
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        po_number VARCHAR(50) UNIQUE NOT NULL,
        vendor_name VARCHAR(255) NOT NULL,
        vendor_email VARCHAR(255),
        vendor_phone VARCHAR(50),
        vendor_address TEXT,
        description VARCHAR(500),
        items JSON,
        subtotal DECIMAL(15, 2) DEFAULT 0,
        tax_rate DECIMAL(5, 2) DEFAULT 18,
        tax_amount DECIMAL(15, 2) DEFAULT 0,
        discount DECIMAL(15, 2) DEFAULT 0,
        total DECIMAL(15, 2) DEFAULT 0,
        notes TEXT,
        terms TEXT,
        delivery_date DATE,
        status ENUM('draft', 'pending', 'approved', 'completed', 'cancelled') DEFAULT 'draft',
        company_id INT,
        project_id INT,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        INDEX idx_project_id (project_id)
      )
    `);

    // Add project_id column if it doesn't exist (for existing tables)
    try {
      await connection.execute(`ALTER TABLE purchase_orders ADD COLUMN project_id INT, ADD INDEX idx_project_id (project_id)`);
    } catch (e) {
      // Column likely already exists, ignore
    }

    // Add company_id column if it doesn't exist (for existing tables)
    try {
      await connection.execute(`ALTER TABLE purchase_orders ADD COLUMN company_id INT`);
    } catch (e) {
      // Column likely already exists, ignore
    }

    // Use provided PO number or generate a new one
    let poNumber = providedPoNumber;
    if (!poNumber) {
      const [lastPO] = await connection.execute(
        'SELECT po_number FROM purchase_orders ORDER BY id DESC LIMIT 1'
      );
      
      let nextNumber = 1;
      if (lastPO.length > 0 && lastPO[0].po_number) {
        const match = lastPO[0].po_number.match(/PO-(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1]) + 1;
        }
      }
      poNumber = `PO-${String(nextNumber).padStart(5, '0')}`;
    }

    // Check if PO with same number already exists (for updates)
    const [existingPO] = await connection.execute(
      'SELECT id FROM purchase_orders WHERE po_number = ?',
      [poNumber]
    );

    let result;
    if (existingPO.length > 0) {
      // Update existing PO
      await connection.execute(
        `UPDATE purchase_orders SET
         vendor_name = ?, vendor_email = ?, vendor_phone = ?, vendor_address = ?,
         description = ?, items = ?, subtotal = ?, tax_rate = ?, tax_amount = ?,
         discount = ?, total = ?, notes = ?, terms = ?, delivery_date = ?,
         status = ?, company_id = ?, project_id = ?
         WHERE po_number = ?`,
        [
          vendor_name,
          vendor_email || null,
          vendor_phone || null,
          vendor_address || null,
          description || null,
          JSON.stringify(items || []),
          subtotal || 0,
          tax_rate || 18,
          tax_amount || 0,
          discount || 0,
          total || 0,
          notes || null,
          terms || null,
          delivery_date || null,
          status,
          company_id || null,
          project_id || null,
          poNumber
        ]
      );
      result = { insertId: existingPO[0].id };
    } else {
      // Insert new purchase order
      [result] = await connection.execute(
        `INSERT INTO purchase_orders 
         (po_number, vendor_name, vendor_email, vendor_phone, vendor_address, description, items, subtotal, tax_rate, tax_amount, discount, total, notes, terms, delivery_date, status, company_id, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          poNumber,
          vendor_name,
          vendor_email || null,
          vendor_phone || null,
          vendor_address || null,
          description || null,
          JSON.stringify(items || []),
          subtotal || 0,
          tax_rate || 18,
          tax_amount || 0,
          discount || 0,
          total || 0,
          notes || null,
          terms || null,
          delivery_date || null,
          status,
          company_id || null,
          project_id || null
        ]
      );
    }

    // Fetch the created/updated purchase order
    const [newPO] = await connection.execute(
      'SELECT * FROM purchase_orders WHERE po_number = ?',
      [poNumber]
    );

    return NextResponse.json({
      success: true,
      message: existingPO.length > 0 ? 'Purchase order updated successfully' : 'Purchase order created successfully',
      data: {
        ...newPO[0],
        items: typeof newPO[0].items === 'string' ? JSON.parse(newPO[0].items) : newPO[0].items
      }
    });

  } catch (error) {
    console.error('Error creating purchase order:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create purchase order', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// PUT - Update existing purchase order
export async function PUT(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.WRITE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    const {
      id,
      vendor_name,
      vendor_email,
      vendor_phone,
      vendor_address,
      vendor_gstin,
      description,
      items,
      subtotal,
      tax_rate,
      tax_amount,
      discount,
      total,
      notes,
      terms,
      delivery_date,
      status,
      quotation_no,
      quotation_date,
      kind_attn
    } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'Purchase order ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    // Add new columns if they don't exist
    const newColumns = ['vendor_gstin', 'quotation_no', 'quotation_date', 'kind_attn'];
    for (const col of newColumns) {
      try {
        await connection.execute(`ALTER TABLE purchase_orders ADD COLUMN ${col} VARCHAR(255)`);
      } catch (e) {
        // Column likely already exists, ignore
      }
    }

    // Check if PO exists
    const [existingPO] = await connection.execute(
      'SELECT id FROM purchase_orders WHERE id = ?',
      [id]
    );

    if (existingPO.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Purchase order not found' },
        { status: 404 }
      );
    }

    // Update purchase order
    await connection.execute(
      `UPDATE purchase_orders SET
       vendor_name = ?, vendor_email = ?, vendor_phone = ?, vendor_address = ?,
       vendor_gstin = ?, description = ?, items = ?, subtotal = ?, tax_rate = ?,
       tax_amount = ?, discount = ?, total = ?, notes = ?, terms = ?,
       delivery_date = ?, status = ?, quotation_no = ?, quotation_date = ?, kind_attn = ?
       WHERE id = ?`,
      [
        vendor_name || null,
        vendor_email || null,
        vendor_phone || null,
        vendor_address || null,
        vendor_gstin || null,
        description || null,
        JSON.stringify(items || []),
        subtotal || 0,
        tax_rate || 18,
        tax_amount || 0,
        discount || 0,
        total || 0,
        notes || null,
        terms || null,
        delivery_date || null,
        status || 'draft',
        quotation_no || null,
        quotation_date || null,
        kind_attn || null,
        id
      ]
    );

    // Fetch the updated purchase order
    const [updatedPO] = await connection.execute(
      'SELECT * FROM purchase_orders WHERE id = ?',
      [id]
    );

    return NextResponse.json({
      success: true,
      message: 'Purchase order updated successfully',
      data: {
        ...updatedPO[0],
        items: typeof updatedPO[0].items === 'string' ? JSON.parse(updatedPO[0].items) : updatedPO[0].items
      }
    });

  } catch (error) {
    console.error('Error updating purchase order:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update purchase order', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// DELETE - Delete purchase order
export async function DELETE(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.DELETE);
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

    // Check if PO exists
    const [existingPO] = await connection.execute(
      'SELECT id, po_number FROM purchase_orders WHERE id = ?',
      [id]
    );

    if (existingPO.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Purchase order not found' },
        { status: 404 }
      );
    }

    // Delete the purchase order
    await connection.execute('DELETE FROM purchase_orders WHERE id = ?', [id]);

    return NextResponse.json({
      success: true,
      message: `Purchase order ${existingPO[0].po_number} deleted successfully`
    });

  } catch (error) {
    console.error('Error deleting purchase order:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete purchase order', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
