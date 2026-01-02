/**
 * Export Lead Emails Script
 * 
 * This script exports all lead company names and emails from the database to an Excel file.
 * 
 * Usage: node scripts/export-employee-emails.js
 * 
 * Requires: .env.local file with database credentials
 *   - DB_HOST
 *   - DB_PORT
 *   - DB_NAME
 *   - DB_USER
 *   - DB_PASSWORD
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function exportLeadEmails() {
  let connection;
  
  try {
    // Database connection config from environment variables
    const dbConfig = {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };

    connection = await mysql.createConnection(dbConfig);

    // Query to get lead company names and emails
    const [rows] = await connection.execute(`
      SELECT 
        company_name,
        contact_email AS email
      FROM leads 
      WHERE contact_email IS NOT NULL AND contact_email != ''
      ORDER BY company_name ASC
    `);

    console.log('\n📧 LEAD EMAILS');
    console.log('Company Name'.padEnd(45) + 'Email');
    console.log('─'.repeat(90));
    
    rows.forEach(row => {
      console.log(`${(row.company_name || '').trim().padEnd(45)}${row.email}`);
    });

    console.log('─'.repeat(90));
    console.log(`Total: ${rows.length} leads\n`);

    // Export to Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lead Emails');

    worksheet.columns = [
      { header: 'Company Name', key: 'company_name', width: 45 },
      { header: 'Email', key: 'email', width: 40 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data
    rows.forEach(row => {
      worksheet.addRow({ company_name: (row.company_name || '').trim(), email: row.email });
    });

    const outputDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFile = path.join(outputDir, 'lead-emails.xlsx');
    await workbook.xlsx.writeFile(outputFile);
    console.log(`📁 Exported to: ${outputFile}`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// Run the script
exportLeadEmails();
