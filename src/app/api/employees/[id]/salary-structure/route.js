import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// GET - Fetch salary structures for an employee
export async function GET(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    
    if (!id) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    connection = await dbConnect();
    
    // Get all salary structures for the employee
    const [structures] = await connection.execute(`
        SELECT 
          ss.*,
          (SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', ssc.id,
              'component_name', ssc.component_name,
              'component_code', ssc.component_code,
              'component_type', ssc.component_type,
              'calculation_type', ssc.calculation_type,
              'fixed_amount', ssc.fixed_amount,
              'percentage_value', ssc.percentage_value,
              'percentage_of', ssc.percentage_of,
              'max_amount', ssc.max_amount,
              'is_taxable', ssc.is_taxable,
              'is_statutory', ssc.is_statutory,
              'statutory_type', ssc.statutory_type,
              'display_order', ssc.display_order,
              'show_in_slip', ssc.show_in_slip,
              'is_active', ssc.is_active
            )
          ) FROM salary_structure_components ssc WHERE ssc.salary_structure_id = ss.id AND ssc.is_active = 1) as components
        FROM salary_structures ss
        WHERE ss.employee_id = ?
        ORDER BY ss.effective_from DESC, ss.version DESC
      `, [id]);

      // Parse the JSON components
      const parsedStructures = structures.map(s => ({
        ...s,
        components: s.components ? JSON.parse(s.components) : []
      }));

      // Find the active structure
      const activeSalaryStructure = parsedStructures.find(s => s.is_active === 1) || null;

      return NextResponse.json({
        success: true,
        salaryStructures: parsedStructures,
        activeSalaryStructure
      });

  } catch (error) {
    console.error('Error fetching salary structures:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch salary structures' }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// POST - Create a new salary structure
export async function POST(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    const body = await request.json();
    
    if (!id) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    const {
      pay_type = 'monthly',
      effective_from,
      ctc,
      gross_salary,
      basic_salary,
      hourly_rate,
      daily_rate,
      ot_multiplier = 1.5,
      pf_applicable = true,
      esic_applicable = false,
      pt_applicable = true,
      mlwf_applicable = true,
      tds_applicable = true,
      pf_wage_ceiling = '15000',
      standard_working_days = 26,
      standard_hours_per_day = 8,
      remarks,
      components = []
    } = body;

    if (!effective_from) {
      return NextResponse.json({ error: 'Effective from date is required' }, { status: 400 });
    }

    connection = await dbConnect();
    
    await connection.beginTransaction();

      // Get the next version number for this employee
      const [versionResult] = await connection.execute(
        'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM salary_structures WHERE employee_id = ?',
        [id]
      );
      const nextVersion = versionResult[0].next_version;

      // Deactivate previous active structures and set effective_to date
      await connection.execute(`
        UPDATE salary_structures 
        SET is_active = 0, 
            effective_to = DATE_SUB(?, INTERVAL 1 DAY),
            updated_at = NOW()
        WHERE employee_id = ? AND is_active = 1
      `, [effective_from, id]);

      // Insert the new salary structure
      const [result] = await connection.execute(`
        INSERT INTO salary_structures (
          employee_id, version, effective_from, is_active, pay_type,
          ctc, gross_salary, basic_salary, hourly_rate, daily_rate, ot_multiplier,
          pf_applicable, esic_applicable, pt_applicable, mlwf_applicable, tds_applicable,
          pf_wage_ceiling, standard_working_days, standard_hours_per_day, remarks
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, nextVersion, effective_from, pay_type,
        ctc || 0, gross_salary || 0, basic_salary || 0,
        hourly_rate || null, daily_rate || null, ot_multiplier,
        pf_applicable ? 1 : 0, esic_applicable ? 1 : 0, pt_applicable ? 1 : 0,
        mlwf_applicable ? 1 : 0, tds_applicable ? 1 : 0,
        pf_wage_ceiling, standard_working_days, standard_hours_per_day, remarks || null
      ]);

      const salaryStructureId = result.insertId;

      // Insert salary components if provided
      if (components && components.length > 0) {
        for (let i = 0; i < components.length; i++) {
          const comp = components[i];
          await connection.execute(`
            INSERT INTO salary_structure_components (
              salary_structure_id, component_name, component_code, component_type,
              calculation_type, fixed_amount, percentage_value, percentage_of,
              max_amount, is_taxable, is_statutory, statutory_type,
              display_order, show_in_slip, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          `, [
            salaryStructureId,
            comp.component_name,
            comp.component_code,
            comp.component_type || 'earning',
            comp.calculation_type || 'fixed',
            comp.fixed_amount || 0,
            comp.percentage_value || null,
            comp.percentage_of || null,
            comp.max_amount || null,
            comp.is_taxable ? 1 : 0,
            comp.is_statutory ? 1 : 0,
            comp.statutory_type || null,
            i,
            comp.show_in_slip ? 1 : 0
          ]);
        }
      }

      await connection.commit();

      return NextResponse.json({
        success: true,
        message: 'Salary structure created successfully',
        salaryStructureId,
        version: nextVersion
      });

  } catch (error) {
    console.error('Error creating salary structure:', error);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error('Error rolling back transaction:', rollbackErr);
      }
    }
    return NextResponse.json({ error: error.message || 'Failed to create salary structure' }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// PUT - Update an existing salary structure
export async function PUT(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    const body = await request.json();
    
    if (!id) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    const {
      salary_structure_id,
      pay_type = 'monthly',
      effective_from,
      ctc,
      gross_salary,
      basic_salary,
      hourly_rate,
      daily_rate,
      ot_multiplier = 1.5,
      pf_applicable = true,
      esic_applicable = false,
      pt_applicable = true,
      mlwf_applicable = true,
      tds_applicable = true,
      pf_wage_ceiling = '15000',
      standard_working_days = 26,
      standard_hours_per_day = 8,
      remarks,
      components = []
    } = body;

    if (!salary_structure_id) {
      return NextResponse.json({ error: 'Salary structure ID is required' }, { status: 400 });
    }

    connection = await dbConnect();
    
    await connection.beginTransaction();

    // Verify the salary structure belongs to this employee
    const [existing] = await connection.execute(
      'SELECT id FROM salary_structures WHERE id = ? AND employee_id = ?',
      [salary_structure_id, id]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return NextResponse.json({ error: 'Salary structure not found' }, { status: 404 });
    }

    // Update the salary structure
    await connection.execute(`
      UPDATE salary_structures SET
        pay_type = ?,
        effective_from = ?,
        ctc = ?,
        gross_salary = ?,
        basic_salary = ?,
        hourly_rate = ?,
        daily_rate = ?,
        ot_multiplier = ?,
        pf_applicable = ?,
        esic_applicable = ?,
        pt_applicable = ?,
        mlwf_applicable = ?,
        tds_applicable = ?,
        pf_wage_ceiling = ?,
        standard_working_days = ?,
        standard_hours_per_day = ?,
        remarks = ?,
        updated_at = NOW()
      WHERE id = ?
    `, [
      pay_type,
      effective_from,
      ctc || 0,
      gross_salary || 0,
      basic_salary || 0,
      hourly_rate || null,
      daily_rate || null,
      ot_multiplier,
      pf_applicable ? 1 : 0,
      esic_applicable ? 1 : 0,
      pt_applicable ? 1 : 0,
      mlwf_applicable ? 1 : 0,
      tds_applicable ? 1 : 0,
      pf_wage_ceiling,
      standard_working_days,
      standard_hours_per_day,
      remarks || null,
      salary_structure_id
    ]);

    // Delete existing components and re-insert
    await connection.execute(
      'DELETE FROM salary_structure_components WHERE salary_structure_id = ?',
      [salary_structure_id]
    );

    // Insert updated salary components if provided
    if (components && components.length > 0) {
      for (let i = 0; i < components.length; i++) {
        const comp = components[i];
        await connection.execute(`
          INSERT INTO salary_structure_components (
            salary_structure_id, component_name, component_code, component_type,
            calculation_type, fixed_amount, percentage_value, percentage_of,
            max_amount, is_taxable, is_statutory, statutory_type,
            display_order, show_in_slip, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
          salary_structure_id,
          comp.component_name,
          comp.component_code,
          comp.component_type || 'earning',
          comp.calculation_type || 'fixed',
          comp.fixed_amount || 0,
          comp.percentage_value || null,
          comp.percentage_of || null,
          comp.max_amount || null,
          comp.is_taxable ? 1 : 0,
          comp.is_statutory ? 1 : 0,
          comp.statutory_type || null,
          i,
          comp.show_in_slip ? 1 : 0
        ]);
      }
    }

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: 'Salary structure updated successfully'
    });

  } catch (error) {
    console.error('Error updating salary structure:', error);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error('Error rolling back transaction:', rollbackErr);
      }
    }
    return NextResponse.json({ error: error.message || 'Failed to update salary structure' }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// DELETE - Delete a salary structure
export async function DELETE(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const salaryStructureId = searchParams.get('structureId');
    
    if (!id) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    if (!salaryStructureId) {
      return NextResponse.json({ error: 'Salary structure ID is required' }, { status: 400 });
    }

    connection = await dbConnect();
    
    await connection.beginTransaction();

    // Verify the salary structure belongs to this employee
    const [existing] = await connection.execute(
      'SELECT id, is_active FROM salary_structures WHERE id = ? AND employee_id = ?',
      [salaryStructureId, id]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return NextResponse.json({ error: 'Salary structure not found' }, { status: 404 });
    }

    const wasActive = existing[0].is_active === 1;

    // Delete salary structure components first
    await connection.execute(
      'DELETE FROM salary_structure_components WHERE salary_structure_id = ?',
      [salaryStructureId]
    );

    // Delete the salary structure
    await connection.execute(
      'DELETE FROM salary_structures WHERE id = ?',
      [salaryStructureId]
    );

    // If the deleted structure was active, make the latest remaining one active
    if (wasActive) {
      const [latestStructure] = await connection.execute(
        `SELECT id FROM salary_structures 
         WHERE employee_id = ? 
         ORDER BY effective_from DESC, version DESC 
         LIMIT 1`,
        [id]
      );

      if (latestStructure.length > 0) {
        await connection.execute(
          'UPDATE salary_structures SET is_active = 1 WHERE id = ?',
          [latestStructure[0].id]
        );
      }
    }

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: 'Salary structure deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting salary structure:', error);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error('Error rolling back transaction:', rollbackErr);
      }
    }
    return NextResponse.json({ error: error.message || 'Failed to delete salary structure' }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
