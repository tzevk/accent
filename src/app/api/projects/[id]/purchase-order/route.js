import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// GET - Fetch purchase order for a project
export async function GET(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    connection = await dbConnect();

    // Check if project_purchase_orders table exists, create if not
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS project_purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        po_number VARCHAR(100),
        po_date DATE,
        client_name VARCHAR(255),
        vendor_name VARCHAR(255),
        delivery_date DATE,
        scope_of_work TEXT,
        gross_amount DECIMAL(15, 2) DEFAULT 0,
        gst_percentage DECIMAL(5, 2) DEFAULT 18,
        gst_amount DECIMAL(15, 2) DEFAULT 0,
        net_amount DECIMAL(15, 2) DEFAULT 0,
        payment_terms VARCHAR(255),
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_project_id (project_id),
        UNIQUE KEY unique_project (project_id)
      )
    `);

    // Fetch purchase order for this project
    const [rows] = await connection.execute(
      'SELECT * FROM project_purchase_orders WHERE project_id = ?',
      [id]
    );

    // Generate next PO number if no purchase order exists
    let nextPONumber = '';
    if (rows.length === 0) {
      const [countResult] = await connection.execute(
        'SELECT COUNT(*) as count FROM project_purchase_orders'
      );
      const count = countResult[0]?.count || 0;
      nextPONumber = `PO-${String(count + 1).padStart(5, '0')}`;
    }

    return NextResponse.json({
      success: true,
      data: rows[0] || null,
      nextPONumber
    });
  } catch (error) {
    console.error('Error fetching project purchase order:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// POST - Create or update purchase order for a project
export async function POST(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    const body = await request.json();
    
    const {
      po_number,
      po_date,
      client_name,
      vendor_name,
      delivery_date,
      scope_of_work,
      gross_amount,
      gst_percentage = 18,
      gst_amount,
      net_amount,
      payment_terms,
      remarks
    } = body;

    connection = await dbConnect();

    // Check if project_purchase_orders table exists, create if not
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS project_purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        po_number VARCHAR(100),
        po_date DATE,
        client_name VARCHAR(255),
        vendor_name VARCHAR(255),
        delivery_date DATE,
        scope_of_work TEXT,
        gross_amount DECIMAL(15, 2) DEFAULT 0,
        gst_percentage DECIMAL(5, 2) DEFAULT 18,
        gst_amount DECIMAL(15, 2) DEFAULT 0,
        net_amount DECIMAL(15, 2) DEFAULT 0,
        payment_terms VARCHAR(255),
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_project_id (project_id),
        UNIQUE KEY unique_project (project_id)
      )
    `);

    // Check if purchase order already exists for this project
    const [existing] = await connection.execute(
      'SELECT id FROM project_purchase_orders WHERE project_id = ?',
      [id]
    );

    if (existing.length > 0) {
      // Update existing purchase order
      await connection.execute(
        `UPDATE project_purchase_orders SET
          po_number = ?,
          po_date = ?,
          client_name = ?,
          vendor_name = ?,
          delivery_date = ?,
          scope_of_work = ?,
          gross_amount = ?,
          gst_percentage = ?,
          gst_amount = ?,
          net_amount = ?,
          payment_terms = ?,
          remarks = ?,
          updated_at = NOW()
        WHERE project_id = ?`,
        [
          po_number,
          po_date || null,
          client_name,
          vendor_name,
          delivery_date || null,
          scope_of_work,
          gross_amount || 0,
          gst_percentage || 18,
          gst_amount || 0,
          net_amount || 0,
          payment_terms,
          remarks,
          id
        ]
      );
    } else {
      // Insert new purchase order
      await connection.execute(
        `INSERT INTO project_purchase_orders (
          project_id, po_number, po_date, client_name, vendor_name,
          delivery_date, scope_of_work, gross_amount, gst_percentage,
          gst_amount, net_amount, payment_terms, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          po_number,
          po_date || null,
          client_name,
          vendor_name,
          delivery_date || null,
          scope_of_work,
          gross_amount || 0,
          gst_percentage || 18,
          gst_amount || 0,
          net_amount || 0,
          payment_terms,
          remarks
        ]
      );
    }

    // Fetch updated purchase order
    const [rows] = await connection.execute(
      'SELECT * FROM project_purchase_orders WHERE project_id = ?',
      [id]
    );

    return NextResponse.json({
      success: true,
      data: rows[0],
      message: existing.length > 0 ? 'Purchase order updated' : 'Purchase order created'
    });
  } catch (error) {
    console.error('Error saving project purchase order:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
