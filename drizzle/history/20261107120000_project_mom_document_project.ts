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

import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

async function hasColumn(
	db: MigrationDb,
	tableName: string,
	columnName: string
): Promise<boolean> {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
     LIMIT 1`,
		[tableName, columnName]
	);
	return Array.isArray(rows) && rows.length > 0;
}

async function hasIndex(
	db: MigrationDb,
	tableName: string,
	indexName: string
): Promise<boolean> {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
     LIMIT 1`,
		[tableName, indexName]
	);
	return Array.isArray(rows) && rows.length > 0;
}

export async function up(db: MigrationDb): Promise<void> {
	if (!(await hasColumn(db, 'project_mom_documents', 'project_id'))) {
		await executeMigrationSql(
			db,
			`
      ALTER TABLE project_mom_documents
      ADD COLUMN project_id INT NULL
    `
		);
	}

	if (!(await hasIndex(db, 'project_mom_documents', 'idx_project_id'))) {
		await executeMigrationSql(
			db,
			`
      ALTER TABLE project_mom_documents
      ADD INDEX idx_project_id (project_id)
    `
		);
	}
}
