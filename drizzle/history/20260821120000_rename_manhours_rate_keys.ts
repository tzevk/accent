/**
 * Rename semantically inverted rate keys inside projects.project_manhours_list:
 *   rate_company -> rate_employee  (what Accent pays the employee per hour)
 *   rate_accent  -> rate_client    (what the client pays Accent per hour)
 *
 * Entries already using the new keys (or carrying neither) are untouched.
 * Application code keeps accepting the legacy keys when reading, so this
 * migration is a normalization pass, not a compatibility gate.
 */

import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

interface ProjectRow {
	project_id: number | string;
	project_manhours_list: unknown;
}

export async function up(db: MigrationDb): Promise<void> {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT project_id, project_manhours_list
		 FROM projects
		 WHERE project_manhours_list IS NOT NULL`
	);

	for (const row of rows as ProjectRow[]) {
		let list: unknown;
		try {
			list = JSON.parse(String(row.project_manhours_list));
		} catch {
			continue;
		}
		if (!Array.isArray(list)) continue;

		let changed = false;
		const next = list.map((entry: unknown) => {
			if (!entry || typeof entry !== 'object') return entry;
			if (!('rate_company' in entry) && !('rate_accent' in entry)) {
				return entry;
			}

			const out = { ...entry } as Record<string, unknown>;
			if (out.rate_employee === undefined) {
				out.rate_employee = out.rate_company;
			}
			if (out.rate_client === undefined) {
				out.rate_client = out.rate_accent;
			}
			delete out.rate_company;
			delete out.rate_accent;
			changed = true;
			return out;
		});
		if (!changed) continue;

		await executeMigrationSql(
			db,
			`UPDATE projects
			 SET project_manhours_list = ?
			 WHERE project_id = ?`,
			[JSON.stringify(next), row.project_id]
		);
	}
}
