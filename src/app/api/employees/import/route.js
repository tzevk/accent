import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

// Function to parse CSV content
function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  const headers = lines[0].split(',').map(header => header.trim().replace(/"/g, ''));
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(value => value.trim().replace(/"/g, ''));
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index];
      });
      data.push(row);
    }
  }

  return data;
}

// Function to validate employee data
function validateEmployeeData(employee, rowIndex) {
  const errors = [];
  
  // Helper function to safely convert to string and trim
  const safeString = (value) => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  };
  
  // Helper function to find column value with flexible header matching
  const getColumnValue = (employee, possibleHeaders) => {
    for (const header of possibleHeaders) {
      if (employee.hasOwnProperty(header)) {
        return employee[header];
      }
    }
    return null;
  };
  
  console.log(`Validating row ${rowIndex + 2}:`, employee);
  console.log('Available columns:', Object.keys(employee));
  
  // Required fields validation with flexible header matching
  const srNoValue = getColumnValue(employee, ['SR.NO', 'SR NO', 'SRNO', 'Sr.No', 'Serial Number']);
  const srNo = safeString(srNoValue);
  if (!srNo) {
    errors.push(`Row ${rowIndex + 2}: SR.NO is required (available columns: ${Object.keys(employee).join(', ')})`);
  }
  
  const employeeCodeValue = getColumnValue(employee, ['Employee Code', 'EmployeeCode', 'Emp Code', 'EmpCode', 'Code']);
  const employeeCode = safeString(employeeCodeValue);
  if (!employeeCode) {
    errors.push(`Row ${rowIndex + 2}: Employee Code is required (available columns: ${Object.keys(employee).join(', ')})`);
  }
  
  const fullNameValue = getColumnValue(employee, ['Full Name', 'FullName', 'Name', 'Employee Name']);
  const fullName = safeString(fullNameValue);
  if (!fullName) {
    errors.push(`Row ${rowIndex + 2}: Full Name is required (available columns: ${Object.keys(employee).join(', ')})`);
  }

  // Parse full name into first and last name
  let firstName = '';
  let lastName = '';
  
  if (fullName) {
    const nameParts = fullName.split(' ').filter(part => part.trim() !== '');
    if (nameParts.length < 2) {
      errors.push(`Row ${rowIndex + 2}: Full Name should contain at least first and last name (got: "${fullName}")`);
    } else {
      firstName = nameParts[0];
      lastName = nameParts.slice(1).join(' '); // Join remaining parts as last name
    }
  }

  // Generate email from name if not provided
  if (firstName && lastName) {
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/\s+/g, '')}@accentcrm.com`;
    
    return {
      isValid: errors.length === 0,
      errors,
      data: {
        employee_id: employeeCode,
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: safeString(getColumnValue(employee, ['Phone', 'Mobile', 'Contact'])) || null,
        department: safeString(getColumnValue(employee, ['Department', 'Dept'])) || null,
        position: safeString(getColumnValue(employee, ['Position', 'Designation', 'Role'])) || null,
        hire_date: safeString(getColumnValue(employee, ['Hire Date', 'HireDate', 'Joining Date', 'Date of Joining'])) || null,
        salary: (() => {
          const salaryValue = getColumnValue(employee, ['Salary', 'Pay', 'Compensation']);
          return salaryValue ? parseFloat(salaryValue) : null;
        })(),
        status: 'active',
        address: safeString(getColumnValue(employee, ['Address', 'Location'])) || null,
        notes: safeString(getColumnValue(employee, ['Notes', 'Remarks', 'Comments'])) || null
      }
    };
  }

  return {
    isValid: false,
    errors,
    data: null
  };
}

// POST - Import employees from CSV
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json(
        { error: 'No file uploaded' },
        { status: 400 }
      );
    }

    // Check file type
    const isCSV = file.name.toLowerCase().endsWith('.csv');

    if (!isCSV) {
      return NextResponse.json(
        { error: 'Only CSV files (.csv) are allowed' },
        { status: 400 }
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size too large. Maximum 5MB allowed.' },
        { status: 400 }
      );
    }

    // Read file content
    let parsedData;
    
    try {
      const csvContent = await file.text();
      parsedData = parseCSV(csvContent);
    } catch {
      return NextResponse.json(
        { error: 'Invalid file format or corrupted file' },
        { status: 400 }
      );
    }

    if (parsedData.length === 0) {
      return NextResponse.json(
        { error: 'File is empty or has no valid data' },
        { status: 400 }
      );
    }

    // Validate data
    console.log('Parsed data sample:', parsedData[0]); // Debug log
    const validationResults = parsedData.map((employee, index) => 
      validateEmployeeData(employee, index)
    );

    const allErrors = validationResults.flatMap(result => result.errors);
    console.log('Validation errors:', allErrors); // Debug log
    
    if (allErrors.length > 0) {
      return NextResponse.json(
        { 
          error: 'Validation failed',
          details: allErrors
        },
        { status: 400 }
      );
    }

    const validEmployees = validationResults
      .filter(result => result.isValid)
      .map(result => result.data);

    if (validEmployees.length === 0) {
      return NextResponse.json(
        { error: 'No valid employees found in the CSV' },
        { status: 400 }
      );
    }

    // Database operations
    const connection = await dbConnect();
    
    let successCount = 0;
    let errorCount = 0;
    const importErrors = [];

    try {
      // Check for existing employee IDs and emails
      const existingIds = validEmployees.map(emp => emp.employee_id);
      const existingEmails = validEmployees.map(emp => emp.email);
      
      let existing = [];
      
      if (existingIds.length > 0 && existingEmails.length > 0) {
        // Create placeholders for IN clause
        const idPlaceholders = existingIds.map(() => '?').join(',');
        const emailPlaceholders = existingEmails.map(() => '?').join(',');
        
        const [result] = await connection.execute(
          `SELECT employee_id, email FROM employees WHERE employee_id IN (${idPlaceholders}) OR email IN (${emailPlaceholders})`,
          [...existingIds, ...existingEmails]
        );
        existing = result;
      }

      const existingEmployeeIds = new Set(existing.map(emp => emp.employee_id));
      const existingEmployeeEmails = new Set(existing.map(emp => emp.email));

      // Process each employee
      for (const employee of validEmployees) {
        try {
          // Skip if employee ID or email already exists
          if (existingEmployeeIds.has(employee.employee_id)) {
            errorCount++;
            importErrors.push(`Employee ID ${employee.employee_id} already exists`);
            continue;
          }
          
          if (existingEmployeeEmails.has(employee.email)) {
            errorCount++;
            importErrors.push(`Email ${employee.email} already exists`);
            continue;
          }

          // Insert employee
          await connection.execute(
            `INSERT INTO employees (
              employee_id, first_name, last_name, email, phone, department, 
              position, hire_date, salary, status, address, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              employee.employee_id,
              employee.first_name,
              employee.last_name,
              employee.email,
              employee.phone,
              employee.department,
              employee.position,
              employee.hire_date,
              employee.salary,
              employee.status,
              employee.address,
              employee.notes
            ]
          );

          successCount++;
        } catch (insertError) {
          errorCount++;
          importErrors.push(`Failed to import ${employee.employee_id}: ${insertError.message}`);
        }
      }

    } finally {
      await connection.end();
    }

    return NextResponse.json({
      message: 'Import completed',
      summary: {
        total: validEmployees.length,
        success: successCount,
        errors: errorCount,
        details: importErrors.length > 0 ? importErrors : undefined
      }
    });

  } catch (error) {
    console.error('Error importing employees:', error);
    return NextResponse.json(
      { error: 'Failed to import employees' },
      { status: 500 }
    );
  }
}

// GET - Download CSV/Excel template
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'csv';

    if (format === 'excel' || format === 'xlsx') {
      // Create Excel template using ExcelJS
      const templateData = [
        ['SR.NO', 'Employee Code', 'Full Name', 'Phone', 'Department', 'Position', 'Hire Date', 'Salary', 'Address', 'Notes'],
        [1, 'EMP001', 'John Doe', '+1-555-0123', 'Engineering', 'Senior Developer', '2023-01-15', 85000, '123 Main St', 'Sample employee'],
        [2, 'EMP002', 'Jane Smith', '+1-555-0124', 'Sales', 'Sales Manager', '2023-02-01', 75000, '456 Oak Ave', 'Sample employee']
      ];

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Employees');
      templateData.forEach((row) => worksheet.addRow(row));

      const buffer = await workbook.xlsx.writeBuffer();

      return new Response(Buffer.from(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="employee_template.xlsx"'
        }
      });
    } else {
      // CSV template
      const csvTemplate = `SR.NO,Employee Code,Full Name,Phone,Department,Position,Hire Date,Salary,Address,Notes
1,EMP001,John Doe,+1-555-0123,Engineering,Senior Developer,2023-01-15,85000,123 Main St,Sample employee
2,EMP002,Jane Smith,+1-555-0124,Sales,Sales Manager,2023-02-01,75000,456 Oak Ave,Sample employee`;

      return new Response(csvTemplate, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="employee_template.csv"'
        }
      });
    }

  } catch (error) {
    console.error('Error generating template:', error);
    return NextResponse.json(
      { error: 'Failed to generate template' },
      { status: 500 }
    );
  }
}
