import { dbConnect } from '@/utils/database';
import * as xlsx from 'xlsx';

// Helper function to format dates for MySQL
function formatDateForMySQL(dateString) {
  if (!dateString || dateString.trim() === '') return null;
  
  // Remove any extra whitespace
  dateString = dateString.trim();
  
  // Handle various date formats
  // DD.MM.YYYY or DD/MM/YYYY
  const ddmmyyyyPattern = /^(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})$/;
  const ddmmyyyyMatch = dateString.match(ddmmyyyyPattern);
  
  if (ddmmyyyyMatch) {
    const day = ddmmyyyyMatch[1].padStart(2, '0');
    const month = ddmmyyyyMatch[2].padStart(2, '0');
    const year = ddmmyyyyMatch[3];
    return `${year}-${month}-${day}`;
  }
  
  // MM/DD/YYYY
  const mmddyyyyPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const mmddyyyyMatch = dateString.match(mmddyyyyPattern);
  
  if (mmddyyyyMatch) {
    const month = mmddyyyyMatch[1].padStart(2, '0');
    const day = mmddyyyyMatch[2].padStart(2, '0');
    const year = mmddyyyyMatch[3];
    return `${year}-${month}-${day}`;
  }
  
  // YYYY-MM-DD (already in correct format)
  const yyyymmddPattern = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  if (yyyymmddPattern.test(dateString)) {
    return dateString;
  }
  
  // If no pattern matches, return null
  return null;
}

// Helper function to normalize priority values
function normalizePriority(priorityString) {
  if (!priorityString || priorityString.trim() === '') return 'M';
  
  const priority = priorityString.toLowerCase().trim();
  
  // Map various priority values to single character codes
  if (priority.includes('high') || priority.includes('urgent') || priority === '1' || priority === 'critical') {
    return 'H';
  } else if (priority.includes('low') || priority === '3' || priority === 'minimal') {
    return 'L';
  } else {
    return 'M'; // Default for medium, normal, 2, or any other value
  }
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
      return Response.json({ 
        success: false, 
        error: 'No file provided' 
      }, { status: 400 });
    }

    // Check file type
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    const isCsv = fileName.endsWith('.csv');

    if (!isExcel && !isCsv) {
      return Response.json({ 
        success: false, 
        error: 'Invalid file type. Please upload Excel (.xlsx, .xls) or CSV (.csv) files only.' 
      }, { status: 400 });
    }

    if (isCsv) {
      return await importLeadsFromCSV(file);
    } else {
      return await importLeadsFromExcel(file);
    }
  } catch (error) {
    console.error('Import error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to import leads: ' + error.message 
    }, { status: 500 });
  }
}

async function importLeadsFromCSV(file) {
  try {
    const text = await file.text();
    const lines = text.split('\n');
    
    if (lines.length < 2) {
      return Response.json({ 
        success: false, 
        error: 'CSV file must contain at least header row and one data row' 
      }, { status: 400 });
    }

    // Parse CSV manually (simple approach)
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const db = await dbConnect();
    
    let importedCount = 0;
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines
      
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
      
      try {
        const leadData = {};
        
        // Map CSV columns to database fields
        headers.forEach((header, index) => {
          const value = values[index] || '';
          const lowerHeader = header.toLowerCase();
          
          if (lowerHeader.includes('company')) {
            leadData.company_name = value;
          } else if (lowerHeader.includes('contact') && lowerHeader.includes('name')) {
            leadData.contact_name = value;
          } else if (lowerHeader.includes('email')) {
            leadData.contact_email = value;
          } else if (lowerHeader.includes('phone')) {
            leadData.phone = value;
          } else if (lowerHeader.includes('city')) {
            leadData.city = value;
          } else if (lowerHeader.includes('project') || lowerHeader.includes('description')) {
            leadData.project_description = value;
          } else if (lowerHeader.includes('enquiry') && lowerHeader.includes('type')) {
            leadData.enquiry_type = value;
          } else if (lowerHeader.includes('status')) {
            leadData.enquiry_status = value;
          } else if (lowerHeader.includes('date')) {
            leadData.enquiry_date = formatDateForMySQL(value);
          } else if (lowerHeader.includes('source')) {
            leadData.lead_source = value;
          } else if (lowerHeader.includes('priority')) {
            const normalizedPriority = normalizePriority(value);
            console.log(`Row ${i + 1}: Original priority "${value}" -> Normalized: "${normalizedPriority}"`);
            leadData.priority = normalizedPriority;
          } else if (lowerHeader.includes('notes')) {
            leadData.notes = value;
          }
        });

        // Validate required fields
        if (!leadData.company_name) {
          errors.push(`Row ${i + 1}: Company name is required`);
          continue;
        }

        // Insert lead (excluding priority for now to isolate the issue)
        await db.execute(`
          INSERT INTO leads (
            company_name, contact_name, contact_email, phone, city,
            project_description, enquiry_type, enquiry_status, enquiry_date,
            lead_source, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [
          leadData.company_name || '',
          leadData.contact_name || '',
          leadData.contact_email || '',
          leadData.phone || '',
          leadData.city || '',
          leadData.project_description || '',
          leadData.enquiry_type || '',
          leadData.enquiry_status || '',
          leadData.enquiry_date || null,
          leadData.lead_source || '',
          leadData.notes || ''
        ]);

        importedCount++;
      } catch (error) {
        console.error(`Error importing row ${i + 1}:`, error);
        errors.push(`Row ${i + 1}: ${error.message}`);
      }
    }
    
    await db.end();
    
    if (importedCount === 0) {
      return Response.json({ 
        success: false, 
        error: 'No leads were imported. Please check your CSV format.',
        errors 
      }, { status: 400 });
    }
    
    return Response.json({ 
      success: true, 
      imported: importedCount,
      errors: errors.length > 0 ? errors : null,
      message: `Successfully imported ${importedCount} leads` +
        (errors.length > 0 ? ` with ${errors.length} errors` : '')
    });
  } catch (error) {
    console.error('CSV import error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to process CSV file: ' + error.message 
    }, { status: 500 });
  }
}

async function importLeadsFromExcel(file) {
  try {
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
        const leadData = {};
        
        // Map Excel columns to database fields (assuming specific column order)
        // Column A: Company Name, B: Contact Name, C: Email, etc.
        leadData.company_name = row[0]?.toString().trim() || '';
        leadData.contact_name = row[1]?.toString().trim() || '';
        leadData.contact_email = row[2]?.toString().trim() || '';
        leadData.phone = row[3]?.toString().trim() || '';
        leadData.city = row[4]?.toString().trim() || '';
        leadData.project_description = row[5]?.toString().trim() || '';
        leadData.enquiry_type = row[6]?.toString().trim() || '';
        leadData.enquiry_status = row[7]?.toString().trim() || '';
        leadData.enquiry_date = row[8]?.toString().trim() || '';
        leadData.lead_source = row[9]?.toString().trim() || '';
        leadData.priority = row[10]?.toString().trim() || '';
        leadData.notes = row[11]?.toString().trim() || '';

        if (!leadData.company_name) {
          errors.push(`Row ${i + 2}: Company name is required`);
          continue;
        }

        // Insert lead
        await db.execute(`
          INSERT INTO leads (
            company_name, contact_name, contact_email, phone, city,
            project_description, enquiry_type, enquiry_status, enquiry_date,
            lead_source, priority, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [
          leadData.company_name,
          leadData.contact_name,
          leadData.contact_email,
          leadData.phone,
          leadData.city,
          leadData.project_description,
          leadData.enquiry_type,
          leadData.enquiry_status,
          leadData.enquiry_date || null,
          leadData.lead_source,
          leadData.priority,
          leadData.notes
        ]);

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
        error: 'No leads were imported. Please check your Excel format.',
        errors 
      }, { status: 400 });
    }
    
    return Response.json({ 
      success: true, 
      imported: importedCount,
      errors: errors.length > 0 ? errors : null,
      message: `Successfully imported ${importedCount} leads` +
        (errors.length > 0 ? ` with ${errors.length} errors` : '')
    });
  } catch (error) {
    console.error('Excel import error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to process Excel file: ' + error.message 
    }, { status: 500 });
  }
}
