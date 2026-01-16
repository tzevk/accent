#!/usr/bin/env node

/**
 * Migration script to add GSTIN, PAN Number, and Company Profile columns to the companies table
 * 
 * Usage: node scripts/add-company-columns.js
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function migrate() {
  console.log('🚀 Starting migration: Adding GSTIN, PAN Number, and Company Profile columns to companies table...\n');

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

    // Check if companies table exists
    const [tables] = await connection.execute(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'companies'",
      [config.database]
    );

    if (tables.length === 0) {
      console.log('⚠️  Companies table does not exist. It will be created when you first access the Company Master.');
      await connection.end();
      process.exit(0);
    }

    // Check existing columns
    const [columns] = await connection.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'companies'",
      [config.database]
    );

    const existingColumns = columns.map(col => col.COLUMN_NAME.toLowerCase());
    const columnsToAdd = [];

    // Define new columns
    const newColumns = [
      { name: 'gstin', definition: 'VARCHAR(20)', description: 'GSTIN' },
      { name: 'pan_number', definition: 'VARCHAR(15)', description: 'PAN Number' },
      { name: 'company_profile', definition: 'TEXT', description: 'Company Profile' }
    ];

    // Check which columns need to be added
    for (const col of newColumns) {
      if (!existingColumns.includes(col.name.toLowerCase())) {
        columnsToAdd.push(col);
      } else {
        console.log(`ℹ️  Column '${col.name}' already exists, skipping...`);
      }
    }

    if (columnsToAdd.length === 0) {
      console.log('\n✅ All columns already exist. No migration needed.');
      await connection.end();
      process.exit(0);
    }

    // Add missing columns
    console.log(`\n📝 Adding ${columnsToAdd.length} new column(s)...\n`);

    for (const col of columnsToAdd) {
      const sql = `ALTER TABLE companies ADD COLUMN ${col.name} ${col.definition}`;
      console.log(`   Adding '${col.name}' (${col.description})...`);
      await connection.execute(sql);
      console.log(`   ✅ Added '${col.name}' successfully`);
    }

    console.log('\n🎉 Migration completed successfully!');
    console.log('\nNew columns added:');
    columnsToAdd.forEach(col => {
      console.log(`   • ${col.name} (${col.definition}) - ${col.description}`);
    });

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   Could not connect to the database. Please check your .env.local configuration.');
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n📡 Database connection closed.');
    }
  }
}

migrate();
