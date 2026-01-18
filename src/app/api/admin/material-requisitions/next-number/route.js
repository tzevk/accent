import { NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'accent_crm',
};

// GET - Generate next requisition number
export async function GET() {
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
    
    // Get the last requisition number
    const [rows] = await db.query(
      `SELECT requisition_number FROM material_requisitions ORDER BY id DESC LIMIT 1`
    );
    
    let nextNumber = 'ATSPL/PUR-001';
    
    if (rows.length > 0) {
      const lastNumber = rows[0].requisition_number;
      // Extract number from format ATSPL/PUR-XXX
      const match = lastNumber.match(/ATSPL\/PUR-(\d+)/);
      if (match) {
        const num = parseInt(match[1]) + 1;
        nextNumber = `ATSPL/PUR-${num.toString().padStart(3, '0')}`;
      }
    }
    
    await db.end();
    
    return NextResponse.json({
      success: true,
      requisition_number: nextNumber
    });
    
  } catch (error) {
    console.error('Error generating requisition number:', error);
    if (db) await db.end();
    return NextResponse.json({ 
      success: true, 
      requisition_number: `ATSPL/PUR-${Date.now().toString().slice(-4)}` 
    });
  }
}
