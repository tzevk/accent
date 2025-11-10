#!/usr/bin/env node
import dotenv from 'dotenv'
dotenv.config({ path: process.env.DOTENV_PATH || '.env.local' })

const dbUtilsPath = new URL('../src/utils/database.js', import.meta.url).href
let dbConnect
try {
  const mod = await import(dbUtilsPath)
  dbConnect = mod.dbConnect
} catch (err) {
  console.error('Failed to import db helper:', err)
  process.exit(1)
}

async function main() {
  const db = await dbConnect()
  try {
    // Table 1: projects
    await db.execute(`CREATE TABLE IF NOT EXISTS projects (
      project_id INT AUTO_INCREMENT PRIMARY KEY,
      project_title VARCHAR(255),
      client_name VARCHAR(255),
      contact_name VARCHAR(255),
      contact_email VARCHAR(255),
      phone VARCHAR(50),
      project_description TEXT,
      city VARCHAR(255),
      project_manager VARCHAR(255),
      start_date DATE,
      end_date DATE,
      duration VARCHAR(100),
      quotation_validity VARCHAR(100),
      mode_of_delivery VARCHAR(255),
      revision VARCHAR(50),
      exclusion TEXT,
      billing_and_payment_terms TEXT,
      other_terms_and_conditions TEXT,
      status VARCHAR(50) DEFAULT 'Active',
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`)
    console.log('Created/verified: projects')

    // Table 2: project_scope
    await db.execute(`CREATE TABLE IF NOT EXISTS project_scope (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      scope_of_work TEXT,
      input_documents TEXT,
      deliverables TEXT,
      software_included TEXT,
      duration VARCHAR(100),
      mode_of_delivery VARCHAR(255),
      revision VARCHAR(50),
      site_visit TEXT,
      quotation_validity VARCHAR(100),
      exclusion TEXT,
      billing_and_payment_terms TEXT,
      other_terms_and_conditions TEXT,
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: project_scope')

    // Table 3: kom_with_client
    await db.execute(`CREATE TABLE IF NOT EXISTS kom_with_client (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      meeting_date DATE,
      discussion_points TEXT,
      decisions_taken TEXT,
      attendees TEXT,
      next_action_items TEXT,
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: kom_with_client')

    // Table 4: internal_meet_minutes
    await db.execute(`CREATE TABLE IF NOT EXISTS internal_meet_minutes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      meeting_date DATE,
      discussion_points TEXT,
      assigned_to VARCHAR(255),
      target_date DATE,
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: internal_meet_minutes')

    // Table 5: documents_received
    await db.execute(`CREATE TABLE IF NOT EXISTS documents_received (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      date_received DATE,
      document_name VARCHAR(255),
      drawing_number VARCHAR(100),
      revision_number VARCHAR(50),
      unit_or_qty VARCHAR(100),
      document_sent_by VARCHAR(255),
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: documents_received')

    // Table 6: project_schedule
    await db.execute(`CREATE TABLE IF NOT EXISTS project_schedule (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      total_activity INT,
      activity_completed INT,
      percentage_completed DECIMAL(5,2),
      sr_no INT,
      activity_description TEXT,
      unit_or_qty VARCHAR(100),
      start_date DATE,
      completion_date DATE,
      time_or_hours_required VARCHAR(100),
      status_completed ENUM('Yes', 'No', 'Ongoing'),
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: project_schedule')

    // Table 7: project_daily_activity
    await db.execute(`CREATE TABLE IF NOT EXISTS project_daily_activity (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      date DATE,
      daily_activity TEXT,
      unit_or_qty VARCHAR(100),
      planned_hours DECIMAL(6,2),
      start_time TIME,
      end_time TIME,
      actual_hours_consumed DECIMAL(6,2),
      activity_done_by VARCHAR(255),
      status_completed ENUM('Yes', 'No', 'Ongoing'),
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: project_daily_activity')

    // Table 8: documents_issued
    await db.execute(`CREATE TABLE IF NOT EXISTS documents_issued (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      document_name VARCHAR(255),
      document_number VARCHAR(100),
      revision_no VARCHAR(50),
      issue_date DATE,
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: documents_issued')

    // Table 9: project_handover
    await db.execute(`CREATE TABLE IF NOT EXISTS project_handover (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      output_by_accent TEXT,
      requirement_accomplished ENUM('Y','N'),
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: project_handover')

    // Table 10: project_manhours
    await db.execute(`CREATE TABLE IF NOT EXISTS project_manhours (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      month VARCHAR(50),
      engineer_or_designer_name VARCHAR(255),
      engineering_hours DECIMAL(6,2),
      designer_hours DECIMAL(6,2),
      drafting_hours DECIMAL(6,2),
      checking_hours DECIMAL(6,2),
      coordination_hours DECIMAL(6,2),
      site_visit_hours DECIMAL(6,2),
      others_hours DECIMAL(6,2),
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: project_manhours')

    // Table 11: query_log
    await db.execute(`CREATE TABLE IF NOT EXISTS query_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      query_description TEXT,
      query_issued_date DATE,
      reply_from_client TEXT,
      reply_received_date DATE,
      query_updated_by VARCHAR(255),
      query_resolved ENUM('Yes','No','Pending'),
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: query_log')

    // Table 12: project_assumptions
    await db.execute(`CREATE TABLE IF NOT EXISTS project_assumptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      assumption_description TEXT,
      reason TEXT,
      assumption_taken_by VARCHAR(255),
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: project_assumptions')

    // Table 13: project_lessons
    await db.execute(`CREATE TABLE IF NOT EXISTS project_lessons (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT,
      lesson_description TEXT,
      impact TEXT,
      recommendation TEXT,
      remarks TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    )`)
    console.log('Created/verified: project_lessons')

    await db.end()
    console.log('All project tables created/verified.')
  } catch (err) {
    console.error('Migration failed:', err)
    try { await db.end() } catch(e){}
    process.exit(2)
  }
}

main()
