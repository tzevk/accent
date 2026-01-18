import { NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'accent_crm',
};

// GET - List all material requisitions
export async function GET(request) {
  let db;
  try {
    db = await mysql.createConnection(dbConfig);
    
    // Create table if not exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS material_requisitions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        requisition_number VARCHAR(50) NOT NULL UNIQUE,
        requisition_date DATE NOT NULL,
        requested_by VARCHAR(100),
        department VARCHAR(100),
        line_items JSON,
        status ENUM('pending', 'approved', 'fulfilled', 'rejected') DEFAULT 'pending',
        prepared_by VARCHAR(100),
        checked_by VARCHAR(100),
        approved_by VARCHAR(100),
        received_by VARCHAR(100),
        receipt_date DATE,
        notes TEXT,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const offset = (page - 1) * limit;
    
    // Build query
    let whereClause = '1=1';
    const params = [];
    
    if (search) {
      whereClause += ' AND (requisition_number LIKE ? OR requested_by LIKE ? OR department LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    
    // Get total count
    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM material_requisitions WHERE ${whereClause}`,
      params
    );
    
    // Get paginated data
    const [rows] = await db.query(
      `SELECT * FROM material_requisitions WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    
    // Get stats
    const [statsResult] = await db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'fulfilled' THEN 1 ELSE 0 END) as fulfilled,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM material_requisitions
    `);
    
    await db.end();
    
    return NextResponse.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      },
      stats: {
        total: statsResult[0].total || 0,
        pending: statsResult[0].pending || 0,
        approved: statsResult[0].approved || 0,
        fulfilled: statsResult[0].fulfilled || 0,
        rejected: statsResult[0].rejected || 0
      }
    });
    
  } catch (error) {
    console.error('Error fetching material requisitions:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST - Create new material requisition
export async function POST(request) {
  let db;
  try {
    db = await mysql.createConnection(dbConfig);
    
    const body = await request.json();
    const {
      requisition_number,
      requisition_date,
      requested_by,
      department,
      line_items,
      prepared_by,
      checked_by,
      approved_by,
      received_by,
      receipt_date,
      notes
    } = body;
    
    const [result] = await db.query(
      `INSERT INTO material_requisitions 
        (requisition_number, requisition_date, requested_by, department, line_items, prepared_by, checked_by, approved_by, received_by, receipt_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requisition_number,
        requisition_date,
        requested_by,
        department,
        JSON.stringify(line_items),
        prepared_by,
        checked_by,
        approved_by,
        received_by,
        receipt_date || null,
        notes
      ]
    );
    
    await db.end();
    
    return NextResponse.json({
      success: true,
      message: 'Material requisition created successfully',
      id: result.insertId
    });
    
  } catch (error) {
    console.error('Error creating material requisition:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE - Delete material requisition
export async function DELETE(request) {
  let db;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }
    
    db = await mysql.createConnection(dbConfig);
    
    await db.query('DELETE FROM material_requisitions WHERE id = ?', [id]);
    
    await db.end();
    
    return NextResponse.json({
      success: true,
      message: 'Material requisition deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting material requisition:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
