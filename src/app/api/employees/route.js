import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';

// GET - Fetch all employees
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const department = searchParams.get('department') || '';
    const status = searchParams.get('status') || '';
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 10;
    const offset = (page - 1) * limit;

    const connection = await dbConnect();

    // Build WHERE clause for filtering
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR employee_id LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (department) {
      whereClause += ' AND department = ?';
      params.push(department);
    }

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    // Get total count for pagination
    const [countResult] = await connection.execute(
      `SELECT COUNT(*) as total FROM employees ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // Get employees with pagination
    const [employees] = await connection.execute(
      `SELECT 
        e.*,
        CONCAT(m.first_name, ' ', m.last_name) as manager_name
       FROM employees e
       LEFT JOIN employees m ON e.manager_id = m.id
       ${whereClause}
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get unique departments for filter options
    const [departments] = await connection.execute(
      'SELECT DISTINCT department FROM employees WHERE department IS NOT NULL ORDER BY department'
    );

    await connection.end();

    return NextResponse.json({
      employees,
      departments: departments.map(d => d.department),
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        limit,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Error fetching employees:', error);
    return NextResponse.json(
      { error: 'Failed to fetch employees' },
      { status: 500 }
    );
  }
}

// POST - Create new employee
export async function POST(request) {
  try {
    const data = await request.json();
    
    // Validation
    const requiredFields = ['employee_id', 'first_name', 'last_name', 'email'];
    for (const field of requiredFields) {
      if (!data[field]) {
        return NextResponse.json(
          { error: `${field} is required` },
          { status: 400 }
        );
      }
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const connection = await dbConnect();

    // Check if employee_id or email already exists
    const [existing] = await connection.execute(
      'SELECT id FROM employees WHERE employee_id = ? OR email = ?',
      [data.employee_id, data.email]
    );

    if (existing.length > 0) {
      await connection.end();
      return NextResponse.json(
        { error: 'Employee ID or email already exists' },
        { status: 409 }
      );
    }

    // Insert new employee
    const [result] = await connection.execute(
      `INSERT INTO employees (
        employee_id, first_name, last_name, email, phone, department, 
        position, hire_date, salary, status, manager_id, address, 
        emergency_contact_name, emergency_contact_phone, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.employee_id,
        data.first_name,
        data.last_name,
        data.email,
        data.phone || null,
        data.department || null,
        data.position || null,
        data.hire_date || null,
        data.salary || null,
        data.status || 'active',
        data.manager_id || null,
        data.address || null,
        data.emergency_contact_name || null,
        data.emergency_contact_phone || null,
        data.notes || null
      ]
    );

    await connection.end();

    return NextResponse.json(
      { 
        message: 'Employee created successfully',
        employeeId: result.insertId
      },
      { status: 201 }
    );

  } catch (error) {
    console.error('Error creating employee:', error);
    return NextResponse.json(
      { error: 'Failed to create employee' },
      { status: 500 }
    );
  }
}

// PUT - Update employee
export async function PUT(request) {
  try {
    const data = await request.json();
    
    if (!data.id) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 400 }
      );
    }

    const connection = await dbConnect();

    // Check if employee exists
    const [existing] = await connection.execute(
      'SELECT id FROM employees WHERE id = ?',
      [data.id]
    );

    if (existing.length === 0) {
      await connection.end();
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Check for duplicate employee_id or email (excluding current employee)
    if (data.employee_id || data.email) {
      const [duplicates] = await connection.execute(
        'SELECT id FROM employees WHERE (employee_id = ? OR email = ?) AND id != ?',
        [data.employee_id, data.email, data.id]
      );

      if (duplicates.length > 0) {
        await connection.end();
        return NextResponse.json(
          { error: 'Employee ID or email already exists' },
          { status: 409 }
        );
      }
    }

    // Build dynamic update query
    const updateFields = [];
    const values = [];

    const allowedFields = [
      'employee_id', 'first_name', 'last_name', 'email', 'phone', 
      'department', 'position', 'hire_date', 'salary', 'status', 
      'manager_id', 'address', 'emergency_contact_name', 
      'emergency_contact_phone', 'notes'
    ];

    allowedFields.forEach(field => {
      if (data.hasOwnProperty(field)) {
        updateFields.push(`${field} = ?`);
        values.push(data[field]);
      }
    });

    if (updateFields.length === 0) {
      await connection.end();
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    values.push(data.id);

    await connection.execute(
      `UPDATE employees SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    await connection.end();

    return NextResponse.json({
      message: 'Employee updated successfully'
    });

  } catch (error) {
    console.error('Error updating employee:', error);
    return NextResponse.json(
      { error: 'Failed to update employee' },
      { status: 500 }
    );
  }
}

// DELETE - Delete employee
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 400 }
      );
    }

    const connection = await dbConnect();

    // Check if employee exists
    const [existing] = await connection.execute(
      'SELECT id FROM employees WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      await connection.end();
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Check if employee is a manager of other employees
    const [managedEmployees] = await connection.execute(
      'SELECT COUNT(*) as count FROM employees WHERE manager_id = ?',
      [id]
    );

    if (managedEmployees[0].count > 0) {
      await connection.end();
      return NextResponse.json(
        { error: 'Cannot delete employee who is managing other employees. Please reassign their reports first.' },
        { status: 400 }
      );
    }

    // Delete employee
    await connection.execute(
      'DELETE FROM employees WHERE id = ?',
      [id]
    );

    await connection.end();

    return NextResponse.json({
      message: 'Employee deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting employee:', error);
    return NextResponse.json(
      { error: 'Failed to delete employee' },
      { status: 500 }
    );
  }
}
