/**
 * Attach uploaded Minutes-of-Meeting documents to their project.
 *
 * `project_mom_documents` previously stored only the uploader; any
 * authenticated user could fetch a document by UUID and the project section
 * right could not be checked. The target project is now required on upload
 * and stored here so downloads can resolve the project policy.
 *
 * `schema-init.js` may have created the column on a fresh runtime database
 * before this migration runs, so both the column and the index are guarded.
 */

async function hasIndex(knex, tableName, indexName) {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
     LIMIT 1`,
		[tableName, indexName]
	);
	return Array.isArray(rows) && rows.length > 0;
}

export async function up(knex) {
	if (!(await knex.schema.hasColumn('project_mom_documents', 'project_id'))) {
		await knex.raw(`
      ALTER TABLE project_mom_documents
      ADD COLUMN project_id INT NULL
    `);
	}

	if (!(await hasIndex(knex, 'project_mom_documents', 'idx_project_id'))) {
		await knex.raw(`
      ALTER TABLE project_mom_documents
      ADD INDEX idx_project_id (project_id)
    `);
	}
}

export async function down(knex) {
	if (await hasIndex(knex, 'project_mom_documents', 'idx_project_id')) {
		await knex.raw(`
      ALTER TABLE project_mom_documents
      DROP INDEX idx_project_id
    `);
	}

	if (await knex.schema.hasColumn('project_mom_documents', 'project_id')) {
		await knex.raw(`
      ALTER TABLE project_mom_documents
      DROP COLUMN project_id
    `);
	}
}
