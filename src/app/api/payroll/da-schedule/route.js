import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

/**
 * GET - Fetch all DA schedule entries
 */
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  try {
    const db = await dbConnect();
    
    const [rows] = await db.execute(
      `SELECT * FROM da_schedule ORDER BY effective_from DESC`
    );
    
    await db.end();
    
    return NextResponse.json({ 
      success: true, 
      data: rows 
    });
  } catch (error) {
    console.error('GET /api/payroll/da-schedule error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch DA schedule', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST - Create new DA schedule entry
 */
export async function POST(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.CREATE);
  if (authResult.authorized === false) return authResult.response;

  try {
    const { da_amount, effective_from, effective_to, is_active, remarks } = await request.json();
    
    if (!da_amount || !effective_from) {
      return NextResponse.json(
        { success: false, error: 'DA amount and effective_from are required' },
        { status: 400 }
      );
    }
    
    const db = await dbConnect();
    
    // If marking as active, deactivate all other entries
    if (is_active) {
      await db.execute(`UPDATE da_schedule SET is_active = 0`);
    }
    
    const [result] = await db.execute(
      `INSERT INTO da_schedule (da_amount, effective_from, effective_to, is_active, remarks)
       VALUES (?, ?, ?, ?, ?)`,
      [da_amount, effective_from, effective_to || null, is_active ? 1 : 0, remarks || null]
    );
    
    await db.end();
    
    return NextResponse.json({
      success: true,
      message: 'DA schedule entry created successfully',
      id: result.insertId
    }, { status: 201 });
  } catch (error) {
    console.error('POST /api/payroll/da-schedule error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create DA schedule entry', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update DA schedule entry
 */
export async function PUT(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.UPDATE);
  if (authResult.authorized === false) return authResult.response;

  try {
    const { id, da_amount, effective_from, effective_to, is_active, remarks } = await request.json();
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID is required' },
        { status: 400 }
      );
    }
    
    const db = await dbConnect();
    
    // If marking as active, deactivate all other entries
    if (is_active) {
      await db.execute(`UPDATE da_schedule SET is_active = 0 WHERE id != ?`, [id]);
    }
    
    await db.execute(
      `UPDATE da_schedule 
       SET da_amount = COALESCE(?, da_amount),
           effective_from = COALESCE(?, effective_from),
           effective_to = ?,
           is_active = COALESCE(?, is_active),
           remarks = ?
       WHERE id = ?`,
      [
        da_amount ?? null,
        effective_from ?? null,
        effective_to !== undefined ? effective_to : undefined,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        remarks !== undefined ? remarks : undefined,
        id
      ]
    );
    
    await db.end();
    
    return NextResponse.json({
      success: true,
      message: 'DA schedule entry updated successfully'
    });
  } catch (error) {
    console.error('PUT /api/payroll/da-schedule error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update DA schedule entry', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Remove DA schedule entry
 */
export async function DELETE(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.DELETE);
  if (authResult.authorized === false) return authResult.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID is required' },
        { status: 400 }
      );
    }
    
    const db = await dbConnect();
    
    await db.execute(`DELETE FROM da_schedule WHERE id = ?`, [id]);
    
    await db.end();
    
    return NextResponse.json({
      success: true,
      message: 'DA schedule entry deleted successfully'
    });
  } catch (error) {
    console.error('DELETE /api/payroll/da-schedule error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete DA schedule entry', details: error.message },
      { status: 500 }
    );
  }
}
