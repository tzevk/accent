#!/usr/bin/env node

/**
 * Script to fetch vendor name and vendor email from the vendors table
 * and export to Excel file
 * 
 * Usage: node scripts/export-vendors-to-excel.js
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

async function exportVendorsToExcel() {
  console.log('🚀 Starting export: Fetching vendor names and emails from vendors table...\n');

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

    // Check if vendors table exists
    const [tables] = await connection.execute(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'vendors'",
      [config.database]
    );

    if (tables.length === 0) {
      console.log('⚠️  Vendors table does not exist.');
      await connection.end();
      process.exit(0);
    }

    // Fetch vendor name and email from vendors table
    console.log('📥 Fetching vendor data...');
    const [vendors] = await connection.execute(
      'SELECT id, vendor_id, vendor_name, email FROM vendors ORDER BY vendor_name ASC'
    );

    console.log(`✅ Found ${vendors.length} vendors\n`);

    if (vendors.length === 0) {
      console.log('⚠️  No vendors found in the database.');
      await connection.end();
      process.exit(0);
    }

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Accent System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Vendors', {
      headerFooter: {
        firstHeader: 'Vendor Master Export'
      }
    });

    // Define columns
    worksheet.columns = [
      { header: 'Sr. No.', key: 'sr_no', width: 10 },
      { header: 'Vendor ID', key: 'vendor_id', width: 15 },
      { header: 'Vendor Name', key: 'vendor_name', width: 40 },
      { header: 'Email', key: 'email', width: 35 }
    ];

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2563EB' } // Blue color for vendors
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    // Add data rows
    vendors.forEach((vendor, index) => {
      worksheet.addRow({
        sr_no: index + 1,
        vendor_id: vendor.vendor_id || '-',
        vendor_name: vendor.vendor_name || '-',
        email: vendor.email || '-'
      });
    });

    // Style data rows with alternating colors
    for (let i = 2; i <= vendors.length + 1; i++) {
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
      to: 'D1'
    };

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(__dirname, '..', 'public', 'uploads', `vendors_export_${timestamp}.xlsx`);

    // Save the workbook
    await workbook.xlsx.writeFile(outputPath);

    console.log('📊 Excel file created successfully!');
    console.log(`📁 File saved to: ${outputPath}`);
    console.log(`\n📈 Summary:`);
    console.log(`   - Total vendors exported: ${vendors.length}`);
    console.log(`   - Vendors with email: ${vendors.filter(v => v.email).length}`);
    console.log(`   - Vendors without email: ${vendors.filter(v => !v.email).length}`);

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
exportVendorsToExcel();
