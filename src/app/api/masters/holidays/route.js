import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Fetch holidays
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') || new Date().getFullYear();
    const type = searchParams.get('type');
    const includeOptional = searchParams.get('include_optional') !== 'false';

    connection = await dbConnect();

    // Check if table exists, create if not
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS holiday_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        type ENUM('national', 'religious', 'regional', 'company', 'optional') DEFAULT 'national',
        is_optional BOOLEAN DEFAULT FALSE,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_holiday_date (name, date)
      )
    `);

    let query = `
      SELECT * FROM holiday_master
      WHERE YEAR(date) = ? AND is_active = TRUE
    `;
    const params = [year];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    if (!includeOptional) {
      query += ' AND is_optional = FALSE';
    }

    query += ' ORDER BY date ASC';

    const [holidays] = await connection.execute(query, params);

    return NextResponse.json({
      success: true,
      data: holidays,
      count: holidays.length
    });
  } catch (error) {
    console.error('Error fetching holidays:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch holidays' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// POST - Add new holiday
export async function POST(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.CREATE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    const { name, date, type, is_optional, description, is_active } = body;

    if (!name || !date) {
      return NextResponse.json(
        { success: false, error: 'Name and date are required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    // Check if table exists, create if not
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS holiday_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        type ENUM('national', 'religious', 'regional', 'company', 'optional') DEFAULT 'national',
        is_optional BOOLEAN DEFAULT FALSE,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_holiday_date (name, date)
      )
    `);

    const [result] = await connection.execute(
      `INSERT INTO holiday_master (name, date, type, is_optional, description, is_active) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name,
        date,
        type || 'national',
        is_optional || false,
        description || null,
        is_active !== false
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'Holiday added successfully',
      id: result.insertId
    });
  } catch (error) {
    console.error('Error adding holiday:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json(
        { success: false, error: 'A holiday with this name already exists on this date' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to add holiday' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// PUT - Update holiday
export async function PUT(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.UPDATE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    const { id, name, date, type, is_optional, description, is_active } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Holiday ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [result] = await connection.execute(
      `UPDATE holiday_master 
       SET name = ?, date = ?, type = ?, is_optional = ?, description = ?, is_active = ?
       WHERE id = ?`,
      [
        name,
        date,
        type || 'national',
        is_optional || false,
        description || null,
        is_active !== false,
        id
      ]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, error: 'Holiday not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Holiday updated successfully'
    });
  } catch (error) {
    console.error('Error updating holiday:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update holiday' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// DELETE - Delete holiday
export async function DELETE(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.DELETE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Holiday ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [result] = await connection.execute(
      'DELETE FROM holiday_master WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, error: 'Holiday not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Holiday deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting holiday:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete holiday' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
