#!/usr/bin/env node

/**
 * Script to fetch company names and emails from the leads table
 * and export to Excel file
 * 
 * Usage: node scripts/export-leads-emails-to-excel.js
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function exportLeadsEmailsToExcel() {
  console.log('🚀 Starting export: Fetching company names and emails from leads table...\n');

  const config = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectTimeout: 10000
  };

  // Validate required environment variables
  if (!config.host || !config.database || !config.user) {
    console.error('❌ Missing required database configuration in .env.local');
    console.error('   Required: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD');
    process.exit(1);
  }

  let connection;

  try {
    console.log(`📡 Connecting to database: ${config.database}@${config.host}:${config.port}`);
    connection = await mysql.createConnection(config);
    console.log('✅ Connected to database\n');

    // Check if leads table exists
    const [tables] = await connection.execute(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leads'",
      [config.database]
    );

    if (tables.length === 0) {
      console.log('⚠️  Leads table does not exist.');
      await connection.end();
      process.exit(0);
    }

    // Fetch company name and emails from leads table
    console.log('📥 Fetching lead data...');
    const [leads] = await connection.execute(
      `SELECT id, lead_id, company_name, contact_name, contact_email, inquiry_email, cc_emails 
       FROM leads 
       ORDER BY company_name ASC`
    );

    console.log(`✅ Found ${leads.length} leads\n`);

    if (leads.length === 0) {
      console.log('⚠️  No leads found in the database.');
      await connection.end();
      process.exit(0);
    }

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Accent System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Lead Emails', {
      headerFooter: {
        firstHeader: 'Lead Master Email Export'
      }
    });

    // Define columns
    worksheet.columns = [
      { header: 'Sr. No.', key: 'sr_no', width: 10 },
      { header: 'Lead ID', key: 'lead_id', width: 15 },
      { header: 'Company Name', key: 'company_name', width: 35 },
      { header: 'Contact Name', key: 'contact_name', width: 25 },
      { header: 'Contact Email', key: 'contact_email', width: 35 },
      { header: 'Inquiry Email', key: 'inquiry_email', width: 35 },
      { header: 'CC Emails', key: 'cc_emails', width: 40 }
    ];

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF16A34A' } // Green color for leads
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    // Add data rows
    leads.forEach((lead, index) => {
      worksheet.addRow({
        sr_no: index + 1,
        lead_id: lead.lead_id || '-',
        company_name: lead.company_name || '-',
        contact_name: lead.contact_name || '-',
        contact_email: lead.contact_email || '-',
        inquiry_email: lead.inquiry_email || '-',
        cc_emails: lead.cc_emails || '-'
      });
    });

    // Style data rows with alternating colors
    for (let i = 2; i <= leads.length + 1; i++) {
      const row = worksheet.getRow(i);
      row.alignment = { vertical: 'middle' };
      if (i % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF3F4F6' } // Light gray
        };
      }
    }

    // Add borders to all cells
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
        };
      });
    });

    // Auto-filter for easy searching
    worksheet.autoFilter = {
      from: 'A1',
      to: 'G1'
    };

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(__dirname, '..', 'public', 'uploads', `leads_emails_export_${timestamp}.xlsx`);

    // Save the workbook
    await workbook.xlsx.writeFile(outputPath);

    console.log('📊 Excel file created successfully!');
    console.log(`📁 File saved to: ${outputPath}`);
    console.log(`\n📈 Summary:`);
    console.log(`   - Total leads exported: ${leads.length}`);
    console.log(`   - Leads with contact email: ${leads.filter(l => l.contact_email).length}`);
    console.log(`   - Leads with inquiry email: ${leads.filter(l => l.inquiry_email).length}`);
    console.log(`   - Leads with CC emails: ${leads.filter(l => l.cc_emails).length}`);

    await connection.end();
    console.log('\n✅ Export completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (connection) {
      await connection.end();
    }
    process.exit(1);
  }
}

// Run the export
exportLeadsEmailsToExcel();
