import { dbConnect } from './src/utils/database.js';
import fs from 'fs';

// Function to parse CSV data
function parseCSV(csvContent) {
    const lines = csvContent.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;
        
        // Handle CSV parsing with commas inside quoted fields
        const row = [];
        let currentField = '';
        let insideQuotes = false;
        
        for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            
            if (char === '"') {
                insideQuotes = !insideQuotes;
            } else if (char === ',' && !insideQuotes) {
                row.push(currentField.trim());
                currentField = '';
            } else {
                currentField += char;
            }
        }
        row.push(currentField.trim()); // Add the last field
        
        if (row.length >= headers.length) {
            const rowData = {};
            headers.forEach((header, index) => {
                rowData[header] = row[index] || '';
            });
            data.push(rowData);
        }
    }
    
    return data;
}

// Function to convert Excel date serial number to MySQL date
function convertExcelDate(serialDate) {
    if (!serialDate || isNaN(serialDate)) return null;
    
    // Excel epoch starts from 1900-01-01, but with 1900 wrongly considered a leap year
    const excelEpoch = new Date(1900, 0, 1);
    const days = parseInt(serialDate) - 2; // Adjust for Excel's leap year bug
    const date = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
    
    return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
}

async function importCSVLeads() {
    const db = await dbConnect();
    
    try {
        // Read the CSV file
        const csvPath = '/Users/tanvikadam/Downloads/leads_import.csv';
        const csvContent = fs.readFileSync(csvPath, 'utf8');
        const leads = parseCSV(csvContent);
        
        console.log(`📄 Found ${leads.length} leads in CSV file`);
        
        // Clear existing sample data first
        await db.execute('DELETE FROM leads WHERE id <= 5');
        console.log('🧹 Cleared sample data');
        
        // Prepare insert statements
        let successCount = 0;
        let errorCount = 0;
        
        for (const lead of leads) {
            try {
                // Convert enquiry date if it's an Excel serial number
                let enquiryDate = null;
                if (lead['Enquiry Date']) {
                    if (lead['Enquiry Date'].includes('/')) {
                        // Already in DD/MM/YYYY format, convert to YYYY-MM-DD
                        const parts = lead['Enquiry Date'].split('/');
                        if (parts.length === 3) {
                            // Handle both DD/MM/YYYY and DD/MM/YY formats
                            let year = parts[2];
                            if (year.length === 2) {
                                year = '20' + year;
                            }
                            enquiryDate = `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                        }
                    } else if (!isNaN(lead['Enquiry Date'])) {
                        // Excel serial number
                        enquiryDate = convertExcelDate(lead['Enquiry Date']);
                    } else {
                        // Try to parse other date formats
                        const dateStr = lead['Enquiry Date'].toString();
                        if (dateStr.includes('.')) {
                            // Handle DD.MM.YYYY format
                            const parts = dateStr.split('.');
                            if (parts.length === 3) {
                                let year = parts[2];
                                if (year.length === 2) {
                                    year = '20' + year;
                                }
                                enquiryDate = `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                            }
                        }
                    }
                }
                
                // Determine lead score based on status
                let leadScore = 50; // Default
                let priority = 'Medium';
                
                switch (lead['Enquiry Status']?.toLowerCase()) {
                    case 'awarded':
                        leadScore = 100;
                        priority = 'High';
                        break;
                    case 'under discussion':
                        leadScore = 75;
                        priority = 'High';
                        break;
                    case 'awaiting':
                        leadScore = 60;
                        priority = 'Medium';
                        break;
                    case 'regretted':
                        leadScore = 20;
                        priority = 'Low';
                        break;
                    case 'close':
                        leadScore = 10;
                        priority = 'Low';
                        break;
                }
                
                // Estimate project value based on project type
                let estimatedValue = 50000; // Default
                const projectDesc = lead['Project Description']?.toLowerCase() || '';
                
                if (projectDesc.includes('stress analysis')) estimatedValue = 75000;
                if (projectDesc.includes('mep')) estimatedValue = 150000;
                if (projectDesc.includes('3d') || projectDesc.includes('modeling')) estimatedValue = 100000;
                if (projectDesc.includes('solar')) estimatedValue = 200000;
                if (projectDesc.includes('manpower') || projectDesc.includes('deputation')) estimatedValue = 300000;
                if (projectDesc.includes('detailed engineering')) estimatedValue = 500000;
                
                const insertQuery = `
                    INSERT INTO leads (
                        company_name, contact_name, contact_email, city, project_description,
                        enquiry_type, enquiry_status, enquiry_date, lead_score, estimated_value,
                        priority, lead_source, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                await db.execute(insertQuery, [
                    lead['Company Name'] || '',
                    lead['Contact Name'] || '',
                    lead['Contact Email'] || '',
                    lead['City'] || '',
                    lead['Project Description'] || '',
                    lead['Enquiry Type'] || '',
                    lead['Enquiry Status'] || '',
                    enquiryDate,
                    leadScore,
                    estimatedValue,
                    priority,
                    lead['Enquiry Type'] || 'Unknown',
                    `Imported from CSV on ${new Date().toISOString().split('T')[0]}`
                ]);
                
                successCount++;
            } catch (insertError) {
                console.error(`❌ Error inserting lead ${lead['Company Name']}: ${insertError.message}`);
                errorCount++;
            }
        }
        
        console.log(`\n✅ Import completed:`);
        console.log(`   - Successfully imported: ${successCount} leads`);
        console.log(`   - Errors: ${errorCount} leads`);
        
        // Display final count
        const [[{count}]] = await db.execute('SELECT COUNT(*) as count FROM leads');
        console.log(`\n📊 Total leads in database: ${count}`);
        
        // Show some statistics
        const [statusStats] = await db.execute(`
            SELECT enquiry_status, COUNT(*) as count 
            FROM leads 
            GROUP BY enquiry_status 
            ORDER BY count DESC
        `);
        
        console.log('\n📈 Leads by Status:');
        statusStats.forEach(stat => {
            console.log(`   ${stat.enquiry_status}: ${stat.count}`);
        });
        
    } catch (error) {
        console.error('❌ Error importing CSV leads:', error);
    } finally {
        await db.end();
    }
}

// Run the import
importCSVLeads().catch(console.error);
