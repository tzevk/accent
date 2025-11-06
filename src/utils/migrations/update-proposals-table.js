// Migration: Update proposals table schema to match backend
// Usage: node src/utils/migrations/update-proposals-table.js

import { dbConnect } from '../database.js';

const columns = [
  'proposal_id VARCHAR(50) UNIQUE',
  'proposal_title VARCHAR(255)',
  'description TEXT',
  'company_id INT',
  'client_name VARCHAR(255)',
  'project_manager VARCHAR(255)',
  'industry VARCHAR(100)',
  'contract_type VARCHAR(100)',
  'proposal_value DECIMAL(18,2)',
  'currency VARCHAR(10) DEFAULT "INR"',
  'payment_terms TEXT',
  'planned_start_date DATE',
  'planned_end_date DATE',
  'project_duration_planned VARCHAR(50)',
  'target_date DATE',
  'project_schedule TEXT',
  'input_document TEXT',
  'list_of_deliverables TEXT',
  'disciplines JSON',
  'activities JSON',
  'discipline_descriptions JSON',
  'planning_activities_list JSON',
  'documents_list JSON',
  'kickoff_meeting VARCHAR(100)',
  'in_house_meeting VARCHAR(100)',
  'kickoff_meeting_date DATE',
  'internal_meeting_date DATE',
  'next_internal_meeting DATE',
  'software VARCHAR(100)',
  'duration VARCHAR(50)',
  'site_visit VARCHAR(100)',
  'quotation_validity VARCHAR(100)',
  'mode_of_delivery VARCHAR(100)',
  'revision VARCHAR(50)',
  'exclusions TEXT',
  'billing_payment_terms TEXT',
  'other_terms TEXT',
  'additional_fields TEXT',
  'general_terms TEXT',
  'budget DECIMAL(18,2)',
  'cost_to_company DECIMAL(18,2)',
  'profitability_estimate DECIMAL(18,2)',
  'major_risks TEXT',
  'mitigation_plans TEXT',
  'planned_hours_total DECIMAL(10,2)',
  'actual_hours_total DECIMAL(10,2)',
  'planned_hours_by_discipline JSON',
  'actual_hours_by_discipline JSON',
  'planned_hours_per_activity JSON',
  'actual_hours_per_activity JSON',
  'hours_variance_total DECIMAL(10,2)',
  'hours_variance_percentage DECIMAL(5,2)',
  'productivity_index DECIMAL(5,2)',
  'client_contact_details TEXT',
  'project_location_country VARCHAR(100)',
  'project_location_city VARCHAR(100)',
  'project_location_site VARCHAR(100)',
  'status VARCHAR(50)',
  'priority VARCHAR(50)',
  'progress INT',
  'notes TEXT',
  'lead_id INT',
  'project_id INT',
  'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
  'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
];

const MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS proposals (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ${columns.join(',\n  ')}
)`;

async function migrate() {
  const db = await dbConnect();
  await db.execute(MIGRATION_SQL);
  console.log('✅ proposals table migrated/created successfully.');
  await db.end();
}

migrate();
