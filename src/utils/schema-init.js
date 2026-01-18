/**
 * Database Schema Initialization
 * 
 * This module handles all table creation and schema migrations.
 * It should be run ONCE at application startup, not on every API request.
 * 
 * Usage:
 * - Import and call ensureSchema() in your app initialization
 * - Or run via: node scripts/init-schema.js
 */

import { dbConnect } from '@/utils/database';

let schemaInitialized = false;
let initPromise = null;

/**
 * Ensures all required tables exist with correct schema.
 * Safe to call multiple times - will only run once per process.
 */
export async function ensureSchema() {
  // Return cached promise if already initializing/initialized
  if (initPromise) return initPromise;
  if (schemaInitialized) return true;
  
  initPromise = doSchemaInit();
  return initPromise;
}

async function doSchemaInit() {
  const startTime = Date.now();
  console.log('🔧 Initializing database schema...');
  
  const db = await dbConnect();
  
  try {
    // Run all schema creation in parallel where safe
    await Promise.all([
      initCompaniesTable(db),
      initUsersTable(db),
    ]);
    
    // Tables with foreign keys - run after base tables
    await Promise.all([
      initLeadsTable(db),
      initProjectsTable(db),
      initProposalsTable(db),
    ]);
    
    // Tables depending on the above
    await Promise.all([
      initFollowUpsTable(db),
      initWorkLogsTable(db),
      initUserActivityAssignmentsTable(db),
    ]);
    
    schemaInitialized = true;
    const elapsed = Date.now() - startTime;
    console.log(`✅ Database schema initialized in ${elapsed}ms`);
    
    return true;
  } catch (error) {
    console.error('❌ Schema initialization failed:', error);
    throw error;
  } finally {
    db.release();
  }
}

async function initCompaniesTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS companies (
      id INT PRIMARY KEY AUTO_INCREMENT,
      company_id VARCHAR(50) UNIQUE,
      company_name VARCHAR(255) NOT NULL,
      industry VARCHAR(100),
      company_size VARCHAR(50),
      website VARCHAR(255),
      phone VARCHAR(20),
      email VARCHAR(255),
      address TEXT,
      city VARCHAR(100),
      state VARCHAR(100),
      country VARCHAR(100),
      postal_code VARCHAR(20),
      description TEXT,
      founded_year INT,
      revenue VARCHAR(100),
      notes TEXT,
      location VARCHAR(255),
      contact_person VARCHAR(100),
      designation VARCHAR(100),
      mobile_number VARCHAR(20),
      sector VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initUsersTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      is_super_admin BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initLeadsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS leads (
      id INT PRIMARY KEY AUTO_INCREMENT,
      lead_id VARCHAR(50),
      company_id INT NULL,
      company_name VARCHAR(255),
      contact_name VARCHAR(255),
      contact_email VARCHAR(255),
      inquiry_email VARCHAR(255),
      cc_emails TEXT,
      phone VARCHAR(50),
      designation VARCHAR(255),
      city VARCHAR(255),
      project_description TEXT,
      enquiry_type VARCHAR(100),
      enquiry_status VARCHAR(100),
      enquiry_date DATE,
      lead_source VARCHAR(100),
      priority VARCHAR(50),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initProjectsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id INT PRIMARY KEY AUTO_INCREMENT,
      project_id VARCHAR(50) UNIQUE,
      name VARCHAR(255) NOT NULL,
      project_title VARCHAR(255),
      project_code VARCHAR(100),
      description TEXT,
      company_id INT,
      client_name VARCHAR(255),
      project_manager VARCHAR(255),
      start_date DATE,
      end_date DATE,
      target_date DATE,
      budget DECIMAL(15,2),
      status VARCHAR(50) DEFAULT 'NEW',
      priority VARCHAR(50) DEFAULT 'MEDIUM',
      progress INT DEFAULT 0,
      type VARCHAR(50) DEFAULT 'ONGOING',
      proposal_id INT,
      assigned_to VARCHAR(255),
      assignments JSON,
      project_schedule TEXT,
      input_document TEXT,
      list_of_deliverables TEXT,
      kickoff_meeting TEXT,
      in_house_meeting TEXT,
      project_assumption_list LONGTEXT,
      project_lessons_learnt_list LONGTEXT,
      software_items LONGTEXT,
      project_team TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initProposalsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS proposals (
      id INT PRIMARY KEY AUTO_INCREMENT,
      proposal_id VARCHAR(50) UNIQUE,
      title VARCHAR(255),
      description TEXT,
      company_id INT,
      lead_id INT,
      status VARCHAR(50) DEFAULT 'draft',
      amount DECIMAL(15,2),
      quotation_number VARCHAR(100),
      quotation_date DATE,
      enquiry_number VARCHAR(100),
      enquiry_date DATE,
      quotation_validity VARCHAR(255),
      billing_payment_terms TEXT,
      other_terms TEXT,
      general_terms TEXT,
      software VARCHAR(255),
      duration VARCHAR(100),
      budget DECIMAL(15,2),
      planned_start_date DATE,
      planned_end_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initFollowUpsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS follow_ups (
      id INT PRIMARY KEY AUTO_INCREMENT,
      lead_id INT,
      follow_up_date DATE,
      follow_up_type VARCHAR(100),
      notes TEXT,
      status VARCHAR(50),
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    )
  `);
}

async function initWorkLogsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS work_logs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT,
      project_id VARCHAR(50),
      log_date DATE,
      hours_worked DECIMAL(5,2),
      description TEXT,
      activity_type VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_date (project_id, log_date),
      INDEX idx_user_date (user_id, log_date)
    )
  `);
}

async function initUserActivityAssignmentsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_activity_assignments (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      project_id VARCHAR(50),
      activity_name VARCHAR(255),
      description TEXT,
      status VARCHAR(50) DEFAULT 'Not Started',
      priority VARCHAR(50) DEFAULT 'Medium',
      due_date DATE,
      estimated_hours DECIMAL(10,2),
      actual_hours DECIMAL(10,2),
      assigned_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_status (user_id, status),
      INDEX idx_project (project_id),
      INDEX idx_due_date (due_date)
    )
  `);
}

/**
 * Check if schema is already initialized
 */
export function isSchemaInitialized() {
  return schemaInitialized;
}

// Export for direct CLI usage
export default ensureSchema;
