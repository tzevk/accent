import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET /api/payroll/schedules - Get all or specific payroll component schedules
export async function GET(request) {
  try {
    await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.READ);

    const { searchParams } = new URL(request.url);
    const componentType = searchParams.get('component_type');
    const activeOnly = searchParams.get('active_only') === 'true';
    const currentDate = searchParams.get('date') || new Date().toISOString().split('T')[0];

    const db = await dbConnect();
    
    try {
      let query = `
        SELECT 
          id,
          component_type,
          value_type,
          value,
          effective_from,
          effective_to,
          is_active,
          min_salary,
          max_salary,
          remarks,
          created_at,
          updated_at
        FROM payroll_schedules
        WHERE 1=1
      `;
      
      const params = [];
      
      if (componentType) {
        query += ` AND component_type = ?`;
        params.push(componentType);
      }
      
      if (activeOnly) {
        query += ` AND is_active = 1 AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)`;
        params.push(currentDate, currentDate);
      }
      
      query += ` ORDER BY component_type, effective_from DESC`;
      
      const [rows] = await db.query(query, params);
      
      return NextResponse.json({
        success: true,
        data: rows
      });
      
    } finally {
      await db.end();
    }
    
  } catch (error) {
    console.error('Error fetching payroll schedules:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}

// POST /api/payroll/schedules - Create new payroll component schedule
export async function POST(request) {
  try {
    await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.CREATE);

    const body = await request.json();
    const {
      component_type,
      value_type,
      value,
      effective_from,
      effective_to = null,
      is_active = 1,
      min_salary = null,
      max_salary = null,
      remarks = null
    } = body;

    if (!component_type || !value_type || value === undefined || !effective_from) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: component_type, value_type, value, effective_from' },
        { status: 400 }
      );
    }

    const db = await dbConnect();
    
    try {
      await db.beginTransaction();

      const [result] = await db.query(
        `INSERT INTO payroll_schedules 
          (component_type, value_type, value, effective_from, effective_to, is_active, min_salary, max_salary, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [component_type, value_type, value, effective_from, effective_to, is_active, min_salary, max_salary, remarks]
      );

      await db.commit();

      return NextResponse.json({
        success: true,
        data: {
          id: result.insertId,
          component_type,
          value_type,
          value,
          effective_from,
          effective_to,
          is_active,
          min_salary,
          max_salary,
          remarks
        }
      });

    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      await db.end();
    }

  } catch (error) {
    console.error('Error creating payroll schedule:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}

// PUT /api/payroll/schedules - Update payroll component schedule
export async function PUT(request) {
  try {
    await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.UPDATE);

    const body = await request.json();
    const {
      id,
      value_type,
      value,
      effective_from,
      effective_to,
      is_active,
      min_salary,
      max_salary,
      remarks
    } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: id' },
        { status: 400 }
      );
    }

    const db = await dbConnect();
    
    try {
      await db.beginTransaction();

      const [result] = await db.query(
        `UPDATE payroll_schedules 
        SET 
          value_type = COALESCE(?, value_type),
          value = COALESCE(?, value),
          effective_from = COALESCE(?, effective_from),
          effective_to = ?,
          is_active = COALESCE(?, is_active),
          min_salary = ?,
          max_salary = ?,
          remarks = ?
        WHERE id = ?`,
        [value_type, value, effective_from, effective_to, is_active, min_salary, max_salary, remarks, id]
      );

      if (result.affectedRows === 0) {
        await db.rollback();
        return NextResponse.json(
          { success: false, error: 'Schedule not found' },
          { status: 404 }
        );
      }

      await db.commit();

      return NextResponse.json({
        success: true,
        message: 'Schedule updated successfully'
      });

    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      await db.end();
    }

  } catch (error) {
    console.error('Error updating payroll schedule:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}

// DELETE /api/payroll/schedules - Delete payroll component schedule
export async function DELETE(request) {
  try {
    await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.DELETE);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: id' },
        { status: 400 }
      );
    }

    const db = await dbConnect();
    
    try {
      await db.beginTransaction();

      const [result] = await db.query(
        'DELETE FROM payroll_schedules WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        await db.rollback();
        return NextResponse.json(
          { success: false, error: 'Schedule not found' },
          { status: 404 }
        );
      }

      await db.commit();

      return NextResponse.json({
        success: true,
        message: 'Schedule deleted successfully'
      });

    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      await db.end();
    }

  } catch (error) {
    console.error('Error deleting payroll schedule:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}
