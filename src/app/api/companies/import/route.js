import { dbConnect } from '@/utils/database';
import * as xlsx from 'xlsx';

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type');
    
    // Check if request contains JSON data (from CSV parsing) or FormData (Excel file)
    if (contentType && contentType.includes('application/json')) {
      // Handle JSON data from CSV parsing
      const { companies, fileType } = await request.json();
      return await importCompaniesFromData(companies, fileType || 'csv');
    } else {
      // Handle Excel file upload
      const formData = await request.formData();
      const file = formData.get('file');
      
      if (!file) {
        return Response.json({ 
          success: false, 
          error: 'No file provided' 
        }, { status: 400 });
      }

      return await importCompaniesFromExcel(file);
    }
  } catch (error) {
    console.error('Import error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to import companies: ' + error.message 
    }, { status: 500 });
  }
}

async function importCompaniesFromData(companies, fileType) {
  if (!companies || !Array.isArray(companies) || companies.length === 0) {
    return Response.json({ 
      success: false, 
      error: 'No valid company data provided' 
    }, { status: 400 });
  }

  const db = await dbConnect();
  let importedCount = 0;
  const errors = [];

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    
    try {
      if (!company.company_name || !company.company_name.trim()) {
        errors.push(`Row ${i + 1}: Company name is required`);
        continue;
      }

      // Build the insert query dynamically based on available fields
      const fields = [];
      const values = [];
      const placeholders = [];

      // Always include required fields
      fields.push('company_id', 'company_name');
      values.push(company.company_id || null, company.company_name.trim());
      placeholders.push('?', '?');

      // Add optional fields if they exist and have values
      const optionalFields = [
        'industry', 'company_size', 'website', 'phone', 'email', 
        'address', 'city', 'state', 'country', 'postal_code', 
        'description', 'founded_year', 'revenue', 'notes'
      ];

      optionalFields.forEach(field => {
        if (company[field] && company[field].toString().trim()) {
          fields.push(field);
          values.push(company[field].toString().trim());
          placeholders.push('?');
        }
      });

      const query = `INSERT INTO companies (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
      await db.execute(query, values);

      importedCount++;
    } catch (error) {
      console.error(`Error importing company ${i + 1}:`, error);
      errors.push(`Row ${i + 1}: ${error.message}`);
    }
  }
  
  await db.end();
  
  if (importedCount === 0) {
    return Response.json({ 
      success: false, 
      error: `No companies were imported from ${fileType.toUpperCase()} file. Please check your file format.`,
      errors 
    }, { status: 400 });
  }
  
  return Response.json({ 
    success: true, 
    imported: importedCount,
    errors: errors.length > 0 ? errors : null,
    message: `Successfully imported ${importedCount} companies from ${fileType.toUpperCase()} file` +
      (errors.length > 0 ? ` with ${errors.length} errors` : '')
  });
}

async function importCompaniesFromExcel(file) {
  // Read the Excel file
  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert to JSON
  const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
  
  if (jsonData.length < 2) {
    return Response.json({ 
      success: false, 
      error: 'Excel file must contain at least header row and one data row' 
    }, { status: 400 });
  }

  const db = await dbConnect();
  
  // Skip header row and process data
  const dataRows = jsonData.slice(1);
  let importedCount = 0;
  const errors = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    
    // Skip empty rows
    if (!row[0] || row[0].toString().trim() === '') {
      continue;
    }

    try {
      const companyData = {
        company_id: row[0]?.toString().trim() || null, // Column A: Company ID
        company_name: row[1]?.toString().trim() || ''  // Column B: Company Name
      };

      if (!companyData.company_name) {
        errors.push(`Row ${i + 2}: Company name is required`);
        continue;
      }

      // Insert company with only ID and name
      await db.execute(
        `INSERT INTO companies (company_id, company_name) VALUES (?, ?)`,
        [companyData.company_id, companyData.company_name]
      );

      importedCount++;
    } catch (error) {
      console.error(`Error importing row ${i + 2}:`, error);
      errors.push(`Row ${i + 2}: ${error.message}`);
    }
  }
  
  await db.end();
  
  if (importedCount === 0) {
    return Response.json({ 
      success: false, 
      error: 'No companies were imported. Please check your Excel format.',
      errors 
    }, { status: 400 });
  }
  
  return Response.json({ 
    success: true, 
    imported: importedCount,
    errors: errors.length > 0 ? errors : null,
    message: `Successfully imported ${importedCount} companies` +
      (errors.length > 0 ? ` with ${errors.length} errors` : '')
  });
}
