import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';

/**
 * GET /api/salary-master
 * Fetch all salary structures or a single one by ID
 */
export async function GET(request) {
  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const activeOnly = searchParams.get('active') === 'true';

    connection = await dbConnect();

    if (id) {
      // Fetch single salary structure
      const [rows] = await connection.execute(
        'SELECT * FROM salary_master WHERE id = ?',
        [id]
      );

      if (rows.length === 0) {
        return NextResponse.json({ 
          success: false, 
          error: 'Salary structure not found' 
        }, { status: 404 });
      }

      return NextResponse.json({ success: true, data: rows[0] });
    }

    // Fetch all salary structures
    let query = 'SELECT * FROM salary_master';
    if (activeOnly) {
      query += ' WHERE is_active = 1';
    }
    query += ' ORDER BY name ASC';

    const [rows] = await connection.execute(query);

    return NextResponse.json({ 
      success: true, 
      data: rows,
      total: rows.length
    });

  } catch (error) {
    console.error('GET salary-master error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Failed to fetch salary structures' 
    }, { status: 500 });
  } finally {
    if (connection) await connection.end();
  }
}

/**
 * POST /api/salary-master
 * Create a new salary structure
 */
export async function POST(request) {
  let connection;
  try {
    const data = await request.json();

    // Validate required fields
    if (!data.name) {
      return NextResponse.json({ 
        success: false, 
        error: 'Name is required' 
      }, { status: 400 });
    }

    connection = await dbConnect();

    // Calculate gross salary if not provided
    const grossSalary = data.gross_salary || (
      parseFloat(data.basic_salary || 0) +
      parseFloat(data.da || 0) +
      parseFloat(data.hra || 0) +
      parseFloat(data.conveyance_allowance || 0) +
      parseFloat(data.medical_allowance || 0) +
      parseFloat(data.special_allowance || 0) +
      parseFloat(data.call_allowance || 0) +
      parseFloat(data.other_allowance || 0)
    );

    const [result] = await connection.execute(
      `INSERT INTO salary_master (
        name, description, basic_salary, da, hra, 
        conveyance_allowance, medical_allowance, special_allowance, 
        call_allowance, other_allowance, gross_salary,
        pf_percentage, esi_percentage, professional_tax,
        mlwf_employee, mlwf_employer, tds_percentage, mediclaim,
        employer_pf_percentage, bonus_percentage, gratuity_percentage,
        annual_leaves, casual_leaves, sick_leaves, ot_rate_per_hour,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.description || null,
        data.basic_salary || 0,
        data.da || 0,
        data.hra || 0,
        data.conveyance_allowance || 0,
        data.medical_allowance || 0,
        data.special_allowance || 0,
        data.call_allowance || 0,
        data.other_allowance || 0,
        grossSalary,
        data.pf_percentage ?? 12,
        data.esi_percentage ?? 0.75,
        data.professional_tax ?? 200,
        data.mlwf_employee ?? 5,
        data.mlwf_employer ?? 13,
        data.tds_percentage ?? 0,
        data.mediclaim ?? 0,
        data.employer_pf_percentage ?? 12,
        data.bonus_percentage ?? 8.33,
        data.gratuity_percentage ?? 4.81,
        data.annual_leaves ?? 21,
        data.casual_leaves ?? 7,
        data.sick_leaves ?? 7,
        data.ot_rate_per_hour ?? 0,
        data.is_active ?? 1
      ]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'Salary structure created successfully',
      data: { id: result.insertId }
    }, { status: 201 });

  } catch (error) {
    console.error('POST salary-master error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Failed to create salary structure' 
    }, { status: 500 });
  } finally {
    if (connection) await connection.end();
  }
}

/**
 * PUT /api/salary-master
 * Update an existing salary structure
 */
export async function PUT(request) {
  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: 'ID is required' 
      }, { status: 400 });
    }

    const data = await request.json();

    connection = await dbConnect();

    // Calculate gross salary if not provided
    const grossSalary = data.gross_salary || (
      parseFloat(data.basic_salary || 0) +
      parseFloat(data.da || 0) +
      parseFloat(data.hra || 0) +
      parseFloat(data.conveyance_allowance || 0) +
      parseFloat(data.medical_allowance || 0) +
      parseFloat(data.special_allowance || 0) +
      parseFloat(data.call_allowance || 0) +
      parseFloat(data.other_allowance || 0)
    );

    const [result] = await connection.execute(
      `UPDATE salary_master SET
        name = ?, description = ?, basic_salary = ?, da = ?, hra = ?,
        conveyance_allowance = ?, medical_allowance = ?, special_allowance = ?,
        call_allowance = ?, other_allowance = ?, gross_salary = ?,
        pf_percentage = ?, esi_percentage = ?, professional_tax = ?,
        mlwf_employee = ?, mlwf_employer = ?, tds_percentage = ?, mediclaim = ?,
        employer_pf_percentage = ?, bonus_percentage = ?, gratuity_percentage = ?,
        annual_leaves = ?, casual_leaves = ?, sick_leaves = ?, ot_rate_per_hour = ?,
        is_active = ?, updated_at = NOW()
      WHERE id = ?`,
      [
        data.name,
        data.description || null,
        data.basic_salary || 0,
        data.da || 0,
        data.hra || 0,
        data.conveyance_allowance || 0,
        data.medical_allowance || 0,
        data.special_allowance || 0,
        data.call_allowance || 0,
        data.other_allowance || 0,
        grossSalary,
        data.pf_percentage ?? 12,
        data.esi_percentage ?? 0.75,
        data.professional_tax ?? 200,
        data.mlwf_employee ?? 5,
        data.mlwf_employer ?? 13,
        data.tds_percentage ?? 0,
        data.mediclaim ?? 0,
        data.employer_pf_percentage ?? 12,
        data.bonus_percentage ?? 8.33,
        data.gratuity_percentage ?? 4.81,
        data.annual_leaves ?? 21,
        data.casual_leaves ?? 7,
        data.sick_leaves ?? 7,
        data.ot_rate_per_hour ?? 0,
        data.is_active ?? 1,
        id
      ]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Salary structure not found' 
      }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Salary structure updated successfully' 
    });

  } catch (error) {
    console.error('PUT salary-master error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Failed to update salary structure' 
    }, { status: 500 });
  } finally {
    if (connection) await connection.end();
  }
}

/**
 * DELETE /api/salary-master
 * Delete a salary structure (soft delete by setting is_active = 0)
 */
export async function DELETE(request) {
  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const hardDelete = searchParams.get('hard') === 'true';
    
    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: 'ID is required' 
      }, { status: 400 });
    }

    connection = await dbConnect();

    let result;
    if (hardDelete) {
      // Hard delete - remove from database
      [result] = await connection.execute(
        'DELETE FROM salary_master WHERE id = ?',
        [id]
      );
    } else {
      // Soft delete - set is_active to 0
      [result] = await connection.execute(
        'UPDATE salary_master SET is_active = 0, updated_at = NOW() WHERE id = ?',
        [id]
      );
    }

    if (result.affectedRows === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Salary structure not found' 
      }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Salary structure deleted successfully' 
    });

  } catch (error) {
    console.error('DELETE salary-master error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Failed to delete salary structure' 
    }, { status: 500 });
  } finally {
    if (connection) await connection.end();
  }
}
