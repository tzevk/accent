/**
 * Attach uploaded Minutes-of-Meeting documents to their project.
 *
 * `project_mom_documents` previously stored only the uploader; any
 * authenticated user could fetch a document by UUID and the project section
 * right could not be checked. The target project is now required on upload
 * and stored here so downloads can resolve the project policy.
 */

export async function up(knex) {
	await knex.raw(`
    ALTER TABLE project_mom_documents
    ADD COLUMN project_id INT NULL
  `);

	await knex.raw(`
    ALTER TABLE project_mom_documents
    ADD INDEX idx_project_id (project_id)
  `);
}

export async function down(knex) {
	await knex.raw(`
    ALTER TABLE project_mom_documents
    DROP INDEX idx_project_id
  `);

	await knex.raw(`
    ALTER TABLE project_mom_documents
    DROP COLUMN project_id
  `);
}
