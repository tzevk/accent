import { dbConnect } from '@/utils/database';

// ✅ Helper: Format date for MySQL (supports multiple formats)
function formatDateForMySQL(dateString) {
  if (!dateString || dateString.trim() === '') return null;
  dateString = dateString.trim();

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

  // YYYY-MM-DD (already valid)
  const yyyymmddPattern = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  if (yyyymmddPattern.test(dateString)) {
    return dateString;
  }

  return null; // fallback
}

// ✅ Helper: Normalize priority
function normalizePriority(priorityString) {
  if (!priorityString || priorityString.trim() === '') return 'M';
  const priority = priorityString.toLowerCase().trim();

  if (
    priority.includes('high') ||
    priority.includes('urgent') ||
    priority === '1' ||
    priority === 'critical'
  ) {
    return 'H';
  } else if (
    priority.includes('low') ||
    priority === '3' ||
    priority === 'minimal'
  ) {
    return 'L';
  } else {
    return 'M';
  }
}

// ✅ Helper: Normalize phone
function normalizePhone(phoneString) {
  if (!phoneString || phoneString.trim() === '') return '';
  let cleaned = phoneString.trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = '+' + cleaned.substring(1).replace(/[^\d]/g, '');
  }
  return cleaned.substring(0, 20);
}

// ✅ Helper: Normalize text
function normalizeText(text, maxLength = 255) {
  if (!text || text.trim() === '') return '';
  return text.trim().substring(0, maxLength);
}

// ✅ Main POST route
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return Response.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.csv')) {
      return Response.json(
        { success: false, error: 'Invalid file type. Please upload a CSV file.' },
        { status: 400 }
      );
    }

    return await importLeadsFromCSV(file);
  } catch (error) {
    console.error('Import error:', error);
    return Response.json(
      { success: false, error: 'Failed to import leads: ' + error.message },
      { status: 500 }
    );
  }
}

// ✅ CSV Import Logic
async function importLeadsFromCSV(file) {
  try {
    const text = await file.text();
    const lines = text.split('\n');

    if (lines.length < 2) {
      return Response.json(
        { success: false, error: 'CSV must have headers and at least one data row' },
        { status: 400 }
      );
    }

    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
    const db = await dbConnect();

    let importedCount = 0;
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = line.split(',').map((v) => v.trim().replace(/"/g, ''));
      try {
        const leadData = {};

        headers.forEach((header, index) => {
          const value = values[index] || '';
          const lowerHeader = header.toLowerCase();

          if (lowerHeader.includes('company')) {
            leadData.company_name = normalizeText(value, 255);
          } else if (lowerHeader.includes('contact') && lowerHeader.includes('name')) {
            leadData.contact_name = normalizeText(value, 255);
          } else if (lowerHeader.includes('email')) {
            leadData.contact_email = normalizeText(value, 255);
          } else if (lowerHeader.includes('phone')) {
            leadData.phone = normalizePhone(value);
          } else if (lowerHeader.includes('city')) {
            leadData.city = normalizeText(value, 100);
          } else if (lowerHeader.includes('project') || lowerHeader.includes('description')) {
            leadData.project_description = normalizeText(value, 1000);
          } else if (lowerHeader.includes('enquiry') && lowerHeader.includes('type')) {
            leadData.enquiry_type = normalizeText(value, 100);
          } else if (lowerHeader.includes('status')) {
            leadData.enquiry_status = normalizeText(value, 100);
          } else if (lowerHeader.includes('date')) {
            leadData.enquiry_date = formatDateForMySQL(value);
          } else if (lowerHeader.includes('source')) {
            leadData.lead_source = normalizeText(value, 255);
          } else if (lowerHeader.includes('priority')) {
            leadData.priority = normalizePriority(value);
          } else if (lowerHeader.includes('notes')) {
            leadData.notes = normalizeText(value, 1000);
          }
        });

        if (!leadData.company_name) {
          errors.push(`Row ${i + 1}: Missing company name`);
          continue;
        }

        await db.execute(
          `
          INSERT INTO leads (
            company_name, contact_name, contact_email, phone, city,
            project_description, enquiry_type, enquiry_status, enquiry_date,
            lead_source, priority, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
          [
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
            leadData.priority || 'M',
            leadData.notes || '',
          ]
        );

        importedCount++;
      } catch (err) {
        console.error(`Error on row ${i + 1}:`, err);
        errors.push(`Row ${i + 1}: ${err.message}`);
      }
    }

    await db.end();

    if (importedCount === 0) {
      return Response.json(
        {
          success: false,
          error: 'No valid leads imported. Please check CSV formatting.',
          errors,
        },
        { status: 400 }
      );
    }

    return Response.json({
      success: true,
      imported: importedCount,
      errors: errors.length ? errors : null,
      message: `Successfully imported ${importedCount} leads${
        errors.length ? ` with ${errors.length} errors` : ''
      }`,
    });
  } catch (error) {
    console.error('CSV import error:', error);
    return Response.json(
      { success: false, error: 'Failed to process CSV: ' + error.message },
      { status: 500 }
    );
  }
}