import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');
        
        if (!file) {
            return NextResponse.json(
                { success: false, error: 'No file uploaded' },
                { status: 400 }
            );
        }

        // Read file content
        const buffer = Buffer.from(await file.arrayBuffer());
        const content = buffer.toString('utf8');
        
        // Parse CSV content
        const lines = content.split('\n');
        if (lines.length < 2) {
            return NextResponse.json(
                { success: false, error: 'File must contain at least a header and one data row' },
                { status: 400 }
            );
        }

        // Parse header
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        
        // Validate required headers
        const requiredHeaders = ['Company Name'];
        const missingHeaders = requiredHeaders.filter(header => 
            !headers.some(h => h.toLowerCase().includes(header.toLowerCase()))
        );
        
        if (missingHeaders.length > 0) {
            return NextResponse.json(
                { success: false, error: `Missing required columns: ${missingHeaders.join(', ')}` },
                { status: 400 }
            );
        }

        const db = await dbConnect();
        let imported = 0;
        let errors = [];

        // Process each data row
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '') continue;
            
            try {
                // Parse CSV row (handle quoted fields)
                const row = parseCSVRow(lines[i]);
                if (row.length < headers.length) continue;

                const rowData = {};
                headers.forEach((header, index) => {
                    rowData[header] = row[index] || '';
                });

                // Map CSV columns to database fields
                const leadData = mapCSVToLead(rowData);
                
                // Skip if no company name
                if (!leadData.company_name) {
                    errors.push(`Row ${i + 1}: Missing company name`);
                    continue;
                }

                // Insert into database
                const insertQuery = `
                    INSERT INTO leads (
                        company_name, contact_name, contact_email, phone, city,
                        project_description, enquiry_type, enquiry_status, enquiry_date,
                        lead_source, priority, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                await db.execute(insertQuery, [
                    leadData.company_name,
                    leadData.contact_name,
                    leadData.contact_email,
                    leadData.phone,
                    leadData.city,
                    leadData.project_description,
                    leadData.enquiry_type,
                    leadData.enquiry_status,
                    leadData.enquiry_date,
                    leadData.lead_source,
                    leadData.priority,
                    leadData.notes
                ]);

                imported++;
                
            } catch (rowError) {
                console.error(`Error processing row ${i + 1}:`, rowError);
                errors.push(`Row ${i + 1}: ${rowError.message}`);
            }
        }

        await db.end();

        return NextResponse.json({
            success: true,
            imported,
            errors: errors.length > 0 ? errors.slice(0, 10) : [], // Return max 10 errors
            message: `Successfully imported ${imported} leads${errors.length > 0 ? ` with ${errors.length} errors` : ''}`
        });

    } catch (error) {
        console.error('Import error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to import leads: ' + error.message },
            { status: 500 }
        );
    }
}

function parseCSVRow(row) {
    const result = [];
    let currentField = '';
    let insideQuotes = false;
    
    for (let i = 0; i < row.length; i++) {
        const char = row[i];
        
        if (char === '"') {
            insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
            result.push(currentField.trim());
            currentField = '';
        } else {
            currentField += char;
        }
    }
    result.push(currentField.trim());
    
    return result;
}

function mapCSVToLead(rowData) {
    // Function to find column value by various possible names
    const findValue = (possibleNames) => {
        for (const name of possibleNames) {
            const key = Object.keys(rowData).find(k => 
                k.toLowerCase().includes(name.toLowerCase())
            );
            if (key && rowData[key]) return rowData[key].trim();
        }
        return null;
    };

    // Parse date
    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        
        // Handle DD/MM/YYYY format
        if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                let year = parts[2];
                if (year.length === 2) year = '20' + year;
                return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }
        
        // Handle other formats or return as is
        return dateStr;
    };

    // Determine priority based on status
    const getPriority = (status) => {
        switch (status?.toLowerCase()) {
            case 'awarded': return 'High';
            case 'under discussion': return 'Medium';
            case 'awaiting': return 'Medium';
            case 'regretted': return 'Low';
            case 'close': return 'Low';
            default: return 'Medium';
        }
    };

    const enquiryStatus = findValue(['enquiry status', 'status']);
    const priority = getPriority(enquiryStatus);

    return {
        company_name: findValue(['company name', 'company']),
        contact_name: findValue(['contact name', 'contact', 'name']),
        contact_email: findValue(['contact email', 'email']),
        phone: findValue(['phone', 'mobile', 'contact number']),
        city: findValue(['city', 'location']),
        project_description: findValue(['project description', 'description', 'project']),
        enquiry_type: findValue(['enquiry type', 'source type', 'type']),
        enquiry_status: enquiryStatus,
        enquiry_date: parseDate(findValue(['enquiry date', 'date'])),
        lead_source: findValue(['lead source', 'source', 'enquiry type']),
        priority: findValue(['priority']) || priority,
        notes: `Imported from CSV on ${new Date().toISOString().split('T')[0]}`
    };
}
