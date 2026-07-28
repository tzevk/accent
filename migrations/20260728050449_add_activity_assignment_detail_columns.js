export async function up(knex) {
	await knex.raw(`
    ALTER TABLE user_activity_assignments
      ADD COLUMN sub_activity_name VARCHAR(255) DEFAULT NULL AFTER activity_name,
      ADD COLUMN remarks TEXT DEFAULT NULL AFTER notes,
      ADD COLUMN default_manhours DECIMAL(10,2) DEFAULT 0.00 AFTER estimated_hours,
      ADD UNIQUE KEY idx_user_project_activity (user_id, project_id, activity_id);
  `);
}

export async function down(knex) {
	await knex.raw(`
    ALTER TABLE user_activity_assignments
      DROP INDEX idx_user_project_activity,
      DROP COLUMN sub_activity_name,
      DROP COLUMN remarks,
      DROP COLUMN default_manhours;
  `);
}
