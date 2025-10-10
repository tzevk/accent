import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';

// Helpers to ensure columns exist even on older MySQL/MariaDB where IF NOT EXISTS isn't supported
async function getExistingColumns(connection) {
  const [rows] = await connection.execute('SHOW COLUMNS FROM employees');
  return new Set(rows.map(r => r.Field));
}

async function ensureEmployeesTable(connection) {
  const desired = [
    ['username', "VARCHAR(50) UNIQUE"],
    ['middle_name', "VARCHAR(50)"],
    ['gender', "ENUM('Male','Female','Other')"],
    ['employee_type', "ENUM('Permanent','Contract','Intern')"],
    ['grade', "VARCHAR(50)"],
    ['workplace', "VARCHAR(100)"],
    ['level', "VARCHAR(50)"],
    ['reporting_to', "VARCHAR(100)"],
    ['pf_no', "VARCHAR(50)"],
    ['dob', "DATE"],
    ['marital_status', "ENUM('Single','Married','Other')"],
    ['employment_status', "VARCHAR(50)"],
    ['role', "VARCHAR(100)"],
    ['joining_date', "DATE"],
    ['present_address', "TEXT"],
    ['city', "VARCHAR(100)"],
    ['pin', "VARCHAR(20)"],
    ['state', "VARCHAR(100)"],
    ['country', "VARCHAR(100)"],
    ['mobile', "VARCHAR(30)"],
    ['personal_email', "VARCHAR(255)"],
    ['profile_photo_url', "VARCHAR(255)"],
    ['bonus_eligible', "TINYINT(1) DEFAULT 0"],
    ['stat_pf', "TINYINT(1) DEFAULT 0"],
    ['stat_mlwf', "TINYINT(1) DEFAULT 0"],
    ['stat_pt', "TINYINT(1) DEFAULT 0"],
    ['stat_esic', "TINYINT(1) DEFAULT 0"],
    ['stat_tds', "TINYINT(1) DEFAULT 0"],
    ['qualification', "VARCHAR(100)"],
    ['institute', "VARCHAR(150)"],
    ['passing_year', "VARCHAR(4)"],
    ['work_experience', "TEXT"],
    ['leave_structure', "TEXT"],
    ['salary_structure', "TEXT"],
    ['gross_salary', "DECIMAL(12,2)"],
    ['total_deductions', "DECIMAL(12,2)"],
    ['net_salary', "DECIMAL(12,2)"],
    ['bank_account_no', "VARCHAR(50)"],
    ['bank_ifsc', "VARCHAR(20)"],
    ['bank_name', "VARCHAR(100)"],
    ['bank_branch', "VARCHAR(100)"],
    ['pan', "VARCHAR(20)"],
    ['aadhar', "VARCHAR(20)"],
    ['gratuity_no', "VARCHAR(50)"],
    ['uan', "VARCHAR(50)"],
    ['esi_no', "VARCHAR(50)"],
    ['attendance_id', "VARCHAR(50)"],
    ['biometric_code', "VARCHAR(50)"],
    ['exit_date', "DATE"],
    ['exit_reason', "TEXT"],
  ];

  const existing = await getExistingColumns(connection);

  for (const [name, type] of desired) {
    if (!existing.has(name)) {
      try {
        await connection.execute(`ALTER TABLE employees ADD COLUMN ${name} ${type}`);
        existing.add(name);
      } catch (e) {
        // Ignore individual failures to avoid blocking; inserts/updates will intersect with existing columns
      }
    }
  }
}

// Ensure base employees table exists in case the environment hasn't run setup
async function ensureBaseEmployeesTable(connection) {
  const createSql = `
    CREATE TABLE IF NOT EXISTS employees (
      id INT PRIMARY KEY AUTO_INCREMENT,
      employee_id VARCHAR(20) UNIQUE NOT NULL,
      first_name VARCHAR(50) NOT NULL,
      last_name VARCHAR(50) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      phone VARCHAR(20),
      department VARCHAR(50),
      position VARCHAR(100),
      hire_date DATE,
      salary DECIMAL(10, 2),
      status ENUM('active', 'inactive', 'terminated') DEFAULT 'active',
      manager_id INT,
      address TEXT,
      emergency_contact_name VARCHAR(100),
      emergency_contact_phone VARCHAR(20),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL
    )
  `;
  await connection.execute(createSql);
}

// GET - Fetch all employees
export async function GET(request) {
  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const department = searchParams.get('department') || '';
    const status = searchParams.get('status') || '';
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 10;
    const offset = (page - 1) * limit;

  connection = await dbConnect();
  // Ensure base table exists; ignore errors silently to not break read
  try { await ensureBaseEmployeesTable(connection); } catch {}
  // Do not let schema changes block reads
  try { await ensureEmployeesTable(connection); } catch {}

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
    const limitNum = Math.max(1, Math.min(100, limit));
    const offsetNum = Math.max(0, offset);
    const [employees] = await connection.execute(
      `SELECT 
        e.*,
        CONCAT(m.first_name, ' ', m.last_name) as manager_name
       FROM employees e
       LEFT JOIN employees m ON e.manager_id = m.id
       ${whereClause}
       ORDER BY e.created_at DESC
       LIMIT ${limitNum} OFFSET ${offsetNum}`,
      params
    );

    // Get unique departments for filter options
    const [departments] = await connection.execute(
      'SELECT DISTINCT department FROM employees WHERE department IS NOT NULL ORDER BY department'
    );

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
      { error: error?.message || 'Failed to fetch employees' },
      { status: 500 }
    );
  } finally {
    if (connection) {
      try { await connection.end(); } catch {}
    }
  }
}

// POST - Create new employee
export async function POST(request) {
  try {
    const data = await request.json();
    // Trim and sanitize incoming values
    const sanitized = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t === '') continue; // drop empty strings to avoid strict mode issues
        sanitized[k] = t;
      } else {
        sanitized[k] = v;
      }
    }
    
    // Validation
    const requiredFields = ['employee_id', 'first_name', 'last_name', 'email'];
    for (const field of requiredFields) {
      if (!sanitized[field]) {
        return NextResponse.json(
          { error: `${field} is required` },
          { status: 400 }
        );
      }
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitized.email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

  const connection = await dbConnect();
  await ensureBaseEmployeesTable(connection);
  await ensureEmployeesTable(connection);

    // Check if employee_id or email already exists
    const [existing] = await connection.execute(
      'SELECT id FROM employees WHERE employee_id = ? OR email = ?',
      [sanitized.employee_id, sanitized.email]
    );

    if (existing.length > 0) {
      await connection.end();
      return NextResponse.json(
        { error: 'Employee ID or email already exists' },
        { status: 409 }
      );
    }

    // Dynamic insert for provided fields
    const allowedFields = [
      'employee_id','first_name','middle_name','last_name','username','email','personal_email','phone','mobile',
      'department','position','hire_date','joining_date','salary','status','employment_status','manager_id','reporting_to',
      'address','present_address','city','pin','state','country','gender','employee_type','grade','workplace','level',
      'pf_no','dob','marital_status','role','profile_photo_url','emergency_contact_name','emergency_contact_phone','notes',
      'bonus_eligible','stat_pf','stat_mlwf','stat_pt','stat_esic','stat_tds',
      'qualification','institute','passing_year','work_experience','leave_structure','salary_structure',
      'gross_salary','total_deductions','net_salary','bank_account_no','bank_ifsc','bank_name','bank_branch','pan','aadhar','gratuity_no','uan','esi_no',
      'attendance_id','biometric_code','exit_date','exit_reason'
    ];
    // Only include columns that actually exist in DB
    const existingCols = await getExistingColumns(connection);
    const insertable = allowedFields.filter(f => existingCols.has(f));
    const cols = [];
    const placeholders = [];
    const vals = [];
    for (const key of insertable) {
      if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
        cols.push(key);
        placeholders.push('?');
        vals.push(sanitized[key]);
      }
    }
    // Required fields safety
    if (!cols.includes('employee_id') || !cols.includes('first_name') || !cols.includes('last_name') || !cols.includes('email')) {
      return NextResponse.json(
        { error: 'Missing required fields (employee_id, first_name, last_name, email)' },
        { status: 400 }
      );
    }
    let result;
    try {
      [result] = await connection.execute(
        `INSERT INTO employees (${cols.join(',')}) VALUES (${placeholders.join(',')})`,
        vals
      );
    } catch (e) {
      // Handle duplicate key errors gracefully
      if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
        await connection.end();
        return NextResponse.json(
          { error: 'Employee ID or email already exists' },
          { status: 409 }
        );
      }
      throw e;
    }

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
      { error: error?.message || 'Failed to create employee' },
      { status: 500 }
    );
  }
}

// PUT - Update employee
export async function PUT(request) {
  try {
    const raw = await request.json();
    // Trim and sanitize
    const data = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t === '') continue;
        data[k] = t;
      } else {
        data[k] = v;
      }
    }
    
    if (!data.id) {
      return NextResponse.json(
        { error: 'Employee ID is required' },
        { status: 400 }
      );
    }

  const connection = await dbConnect();
  await ensureBaseEmployeesTable(connection);
  await ensureEmployeesTable(connection);

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
      'employee_id','first_name','middle_name','last_name','username','email','personal_email','phone','mobile',
      'department','position','hire_date','joining_date','salary','status','employment_status','manager_id','reporting_to',
      'address','present_address','city','pin','state','country','gender','employee_type','grade','workplace','level',
      'pf_no','dob','marital_status','role','profile_photo_url','emergency_contact_name','emergency_contact_phone','notes',
      'bonus_eligible','stat_pf','stat_mlwf','stat_pt','stat_esic','stat_tds',
      'qualification','institute','passing_year','work_experience','leave_structure','salary_structure',
      'gross_salary','total_deductions','net_salary','bank_account_no','bank_ifsc','bank_name','bank_branch','pan','aadhar','gratuity_no','uan','esi_no',
      'attendance_id','biometric_code','exit_date','exit_reason'
    ];
    const existingCols = await getExistingColumns(connection);
    const updatable = allowedFields.filter(f => existingCols.has(f));

    updatable.forEach(field => {
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
      { error: error?.message || 'Failed to update employee' },
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
  await ensureBaseEmployeesTable(connection);

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
