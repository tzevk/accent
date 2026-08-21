/**
 * Rename semantically inverted rate keys inside projects.project_manhours_list:
 *   rate_company -> rate_employee  (what Accent pays the employee per hour)
 *   rate_accent  -> rate_client    (what the client pays Accent per hour)
 *
 * Entries already using the new keys (or carrying neither) are untouched.
 * Application code keeps accepting the legacy keys when reading, so this
 * migration is a normalization pass, not a compatibility gate.
 */
export async function up(knex) {
	const rows = await knex('projects')
		.select('project_id', 'project_manhours_list')
		.whereNotNull('project_manhours_list');

	for (const row of rows) {
		let list;
		try {
			list = JSON.parse(row.project_manhours_list);
		} catch {
			continue;
		}
		if (!Array.isArray(list)) continue;

		let changed = false;
		const next = list.map((entry) => {
			if (!entry || typeof entry !== 'object') return entry;
			if (!('rate_company' in entry) && !('rate_accent' in entry)) {
				return entry;
			}
			const out = { ...entry };
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

		await knex('projects')
			.where('project_id', row.project_id)
			.update({ project_manhours_list: JSON.stringify(next) });
	}
}

export async function down(knex) {
	const rows = await knex('projects')
		.select('project_id', 'project_manhours_list')
		.whereNotNull('project_manhours_list');

	for (const row of rows) {
		let list;
		try {
			list = JSON.parse(row.project_manhours_list);
		} catch {
			continue;
		}
		if (!Array.isArray(list)) continue;

		let changed = false;
		const next = list.map((entry) => {
			if (!entry || typeof entry !== 'object') return entry;
			if (!('rate_employee' in entry) && !('rate_client' in entry)) {
				return entry;
			}
			const out = { ...entry };
			if (out.rate_company === undefined) {
				out.rate_company = out.rate_employee;
			}
			if (out.rate_accent === undefined) {
				out.rate_accent = out.rate_client;
			}
			delete out.rate_employee;
			delete out.rate_client;
			changed = true;
			return out;
		});
		if (!changed) continue;

		await knex('projects')
			.where('project_id', row.project_id)
			.update({ project_manhours_list: JSON.stringify(next) });
	}
}
