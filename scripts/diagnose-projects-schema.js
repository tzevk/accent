#!/usr/bin/env node

/**
 * Projects Table Schema Diagnostic Tool
 * 
 * This script inspects the actual database schema for the 'projects' table
 * and compares it against what the application code expects.
 * 
 * Usage:
 *   node scripts/diagnose-projects-schema.js
 * 
 * Requires .env.local with DB connection settings:
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env.local') });

// Expected columns that the application code tries to use
const EXPECTED_COLUMNS = [
  // Core identity columns
  { name: 'id', type: 'INT', required: true, description: 'Primary key (auto-increment)' },
  { name: 'project_id', type: 'VARCHAR', required: true, description: 'Human-readable project identifier (e.g., 001-12-2024)' },
  { name: 'project_code', type: 'VARCHAR', required: false, description: 'Alternative code field for legacy compatibility' },
  
  // Basic info
  { name: 'name', type: 'VARCHAR', required: true, description: 'Project name' },
  { name: 'description', type: 'TEXT', required: false, description: 'Project description' },
  { name: 'notes', type: 'TEXT', required: false, description: 'Additional notes' },
  
  // Company/client relationship
  { name: 'company_id', type: 'INT', required: false, description: 'Foreign key to companies table' },
  { name: 'client_name', type: 'VARCHAR', required: false, description: 'Client name (denormalized)' },
  
  // People assignments
  { name: 'project_manager', type: 'VARCHAR', required: false, description: 'Project manager name' },
  { name: 'assigned_to', type: 'VARCHAR', required: false, description: 'Primary assignee' },
  
  // Dates
  { name: 'start_date', type: 'DATE', required: false, description: 'Project start date' },
  { name: 'end_date', type: 'DATE', required: false, description: 'Project end date' },
  { name: 'target_date', type: 'DATE', required: false, description: 'Target completion date' },
  { name: 'created_at', type: 'TIMESTAMP', required: false, description: 'Creation timestamp' },
  { name: 'updated_at', type: 'TIMESTAMP', required: false, description: 'Last update timestamp' },
  
  // Status tracking
  { name: 'status', type: 'VARCHAR', required: false, description: 'Project status (NEW, IN_PROGRESS, etc.)' },
  { name: 'type', type: 'VARCHAR', required: false, description: 'Project type (ONGOING, etc.)' },
  { name: 'priority', type: 'VARCHAR', required: false, description: 'Priority level (HIGH, MEDIUM, LOW)' },
  { name: 'progress', type: 'INT', required: false, description: 'Progress percentage (0-100)' },
  
  // Financial
  { name: 'budget', type: 'DECIMAL', required: false, description: 'Project budget' },
  
  // Relationships
  { name: 'proposal_id', type: 'INT', required: false, description: 'Foreign key to proposals table' },
  
  // Structured data (JSON columns)
  { name: 'activities', type: 'JSON', required: false, description: 'Array of activity objects' },
  { name: 'disciplines', type: 'JSON', required: false, description: 'Array of discipline names' },
  { name: 'discipline_descriptions', type: 'JSON', required: false, description: 'Object mapping disciplines to descriptions' },
  { name: 'assignments', type: 'JSON', required: false, description: 'Array of assignment objects' },
  
  // Additional text fields
  { name: 'project_schedule', type: 'TEXT', required: false, description: 'Schedule information' },
  { name: 'input_document', type: 'TEXT', required: false, description: 'Input documentation' },
  { name: 'list_of_deliverables', type: 'TEXT', required: false, description: 'Deliverables list' },
  { name: 'kickoff_meeting', type: 'TEXT', required: false, description: 'Kickoff meeting notes' },
  { name: 'in_house_meeting', type: 'TEXT', required: false, description: 'Internal meeting notes' },
  
  // Long text fields
  { name: 'project_assumption_list', type: 'LONGTEXT', required: false, description: 'Project assumptions (JSON string or text)' },
  { name: 'project_lessons_learnt_list', type: 'LONGTEXT', required: false, description: 'Lessons learned (JSON string or text)' },
  { name: 'software_items', type: 'LONGTEXT', required: false, description: 'Software items list' },
  
  // Audit fields
  { name: 'converted_by', type: 'VARCHAR', required: false, description: 'User who converted from proposal' },
  { name: 'converted_at', type: 'TIMESTAMP', required: false, description: 'Timestamp of conversion' },
];

async function main() {
  console.log('🔍 Projects Table Schema Diagnostic Tool\n');
  console.log('=' .repeat(80));
  
  // Check environment variables
  const requiredEnv = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missingEnv = requiredEnv.filter(key => !process.env[key]);
  
  if (missingEnv.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingEnv.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease create .env.local in the project root with these values.');
    process.exit(1);
  }
  
  console.log('✅ Environment variables loaded');
  console.log(`   DB_HOST: ${process.env.DB_HOST}`);
  console.log(`   DB_PORT: ${process.env.DB_PORT}`);
  console.log(`   DB_NAME: ${process.env.DB_NAME}`);
  console.log(`   DB_USER: ${process.env.DB_USER}`);
  console.log(`   DB_PASSWORD: ${'*'.repeat(process.env.DB_PASSWORD?.length || 0)}\n`);
  
  let connection;
  
  try {
    // Connect to database
    console.log('📡 Connecting to database...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 10000
    });
    console.log('✅ Connected successfully\n');
    
    // Check if projects table exists
    console.log('📋 Checking if projects table exists...');
    const [tables] = await connection.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects'`,
      [process.env.DB_NAME]
    );
    
    if (tables.length === 0) {
      console.log('❌ Projects table does NOT exist in the database!');
      console.log('\nThe application expects the table to exist.');
      console.log('Run the Next.js dev server once to auto-create it via the GET /api/projects route,');
      console.log('or manually create it using the schema from src/app/api/projects/route.js\n');
      process.exit(1);
    }
    
    console.log('✅ Projects table exists\n');
    
    // Fetch actual column information
    console.log('📊 Fetching actual table schema...');
    const [columns] = await connection.execute(
      `SELECT 
        COLUMN_NAME,
        COLUMN_TYPE,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE,
        IS_NULLABLE,
        COLUMN_KEY,
        COLUMN_DEFAULT,
        EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects'
       ORDER BY ORDINAL_POSITION`,
      [process.env.DB_NAME]
    );
    
    console.log(`✅ Found ${columns.length} columns\n`);
    
    // Build a map of actual columns
    const actualColumns = new Map(
      columns.map(col => [col.COLUMN_NAME, col])
    );
    
    // Compare expected vs actual
    console.log('=' .repeat(80));
    console.log('SCHEMA COMPARISON REPORT');
    console.log('=' .repeat(80));
    console.log();
    
    const missing = [];
    const typeMismatches = [];
    const present = [];
    
    EXPECTED_COLUMNS.forEach(expected => {
      const actual = actualColumns.get(expected.name);
      
      if (!actual) {
        missing.push(expected);
      } else {
        const actualType = actual.DATA_TYPE.toUpperCase();
        const expectedType = expected.type.toUpperCase();
        
        // Normalize type comparison (e.g., VARCHAR == VARCHAR, TEXT == TEXT)
        const typeMatch = 
          actualType.includes(expectedType) || 
          expectedType.includes(actualType) ||
          (expectedType === 'VARCHAR' && actualType === 'CHAR') ||
          (expectedType === 'TEXT' && (actualType === 'MEDIUMTEXT' || actualType === 'LONGTEXT')) ||
          (expectedType === 'JSON' && actualType === 'JSON');
        
        if (!typeMatch) {
          typeMismatches.push({
            ...expected,
            actualType: actual.COLUMN_TYPE,
            actualDataType: actual.DATA_TYPE
          });
        } else {
          present.push(expected);
        }
      }
    });
    
    // Report missing columns
    if (missing.length > 0) {
      console.log('❌ MISSING COLUMNS (' + missing.length + '):');
      console.log('─'.repeat(80));
      missing.forEach(col => {
        console.log(`   ${col.name.padEnd(30)} (${col.type})`);
        console.log(`      ${col.description}`);
        if (col.required) {
          console.log(`      ⚠️  REQUIRED - Application will fail without this column!`);
        }
        console.log();
      });
    } else {
      console.log('✅ All expected columns are present!\n');
    }
    
    // Report type mismatches
    if (typeMismatches.length > 0) {
      console.log('⚠️  TYPE MISMATCHES (' + typeMismatches.length + '):');
      console.log('─'.repeat(80));
      typeMismatches.forEach(col => {
        console.log(`   ${col.name.padEnd(30)}`);
        console.log(`      Expected: ${col.type}`);
        console.log(`      Actual:   ${col.actualType}`);
        console.log(`      ${col.description}`);
        console.log();
      });
    }
    
    // Report extra columns (in DB but not in expected list)
    const expectedNames = new Set(EXPECTED_COLUMNS.map(c => c.name));
    const extraColumns = columns.filter(col => !expectedNames.has(col.COLUMN_NAME));
    
    if (extraColumns.length > 0) {
      console.log('ℹ️  EXTRA COLUMNS (in database but not expected):');
      console.log('─'.repeat(80));
      extraColumns.forEach(col => {
        console.log(`   ${col.COLUMN_NAME.padEnd(30)} (${col.COLUMN_TYPE})`);
      });
      console.log();
    }
    
    // Summary
    console.log('=' .repeat(80));
    console.log('SUMMARY');
    console.log('=' .repeat(80));
    console.log(`Total expected columns:     ${EXPECTED_COLUMNS.length}`);
    console.log(`Columns present & correct:  ${present.length}`);
    console.log(`Missing columns:            ${missing.length}`);
    console.log(`Type mismatches:            ${typeMismatches.length}`);
    console.log(`Extra columns:              ${extraColumns.length}`);
    console.log();
    
    // Recommendations
    if (missing.length > 0 || typeMismatches.length > 0) {
      console.log('🔧 RECOMMENDATIONS:');
      console.log('─'.repeat(80));
      
      if (missing.length > 0) {
        console.log('\n1. Add missing columns:');
        console.log('   Run this SQL to add all missing columns:\n');
        missing.forEach(col => {
          let sqlType = col.type;
          if (col.type === 'VARCHAR') sqlType = 'VARCHAR(255)';
          if (col.type === 'DECIMAL') sqlType = 'DECIMAL(15,2)';
          
          const nullable = col.required ? 'NOT NULL' : 'NULL';
          console.log(`   ALTER TABLE projects ADD COLUMN ${col.name} ${sqlType} ${nullable};`);
        });
        console.log();
      }
      
      if (typeMismatches.length > 0) {
        console.log('\n2. Fix type mismatches:');
        console.log('   Review these columns and modify if needed:\n');
        typeMismatches.forEach(col => {
          let sqlType = col.type;
          if (col.type === 'VARCHAR') sqlType = 'VARCHAR(255)';
          if (col.type === 'DECIMAL') sqlType = 'DECIMAL(15,2)';
          
          console.log(`   ALTER TABLE projects MODIFY COLUMN ${col.name} ${sqlType};`);
        });
        console.log();
      }
      
      console.log('\n3. Or let the application auto-fix:');
      console.log('   Start the Next.js dev server - the GET /api/projects route');
      console.log('   will attempt to add missing columns automatically.\n');
    } else {
      console.log('✅ Schema looks good! No critical issues found.\n');
    }
    
    // Check primary key
    console.log('🔑 PRIMARY KEY CHECK:');
    console.log('─'.repeat(80));
    const pkColumns = columns.filter(col => col.COLUMN_KEY === 'PRI');
    if (pkColumns.length > 0) {
      console.log('✅ Primary key(s) found:');
      pkColumns.forEach(col => {
        console.log(`   - ${col.COLUMN_NAME} (${col.COLUMN_TYPE})`);
      });
    } else {
      console.log('❌ No primary key found! This will cause issues.');
    }
    console.log();
    
    // Check indexes
    console.log('📇 INDEX CHECK:');
    console.log('─'.repeat(80));
    const [indexes] = await connection.execute(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [process.env.DB_NAME]
    );
    
    if (indexes.length > 0) {
      console.log(`✅ Found ${indexes.length} index entries:`);
      const indexGroups = {};
      indexes.forEach(idx => {
        if (!indexGroups[idx.INDEX_NAME]) {
          indexGroups[idx.INDEX_NAME] = [];
        }
        indexGroups[idx.INDEX_NAME].push(idx.COLUMN_NAME);
      });
      Object.entries(indexGroups).forEach(([name, cols]) => {
        console.log(`   ${name}: [${cols.join(', ')}]`);
      });
    } else {
      console.log('⚠️  No indexes found (besides primary key).');
      console.log('   Consider adding indexes on frequently queried columns:');
      console.log('   - project_id, company_id, status, proposal_id');
    }
    console.log();
    
    console.log('=' .repeat(80));
    console.log('✅ Diagnostic complete!');
    console.log('=' .repeat(80));
    
  } catch (error) {
    console.error('\n❌ Error during diagnosis:');
    console.error('   ', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main();
