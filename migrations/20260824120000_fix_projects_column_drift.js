/**
 * P0.3 fix — `projects` column drift (ER_BAD_FIELD_ERROR on create/convert).
 *
 * POST /api/projects, proposal→project convert and the legacy fallback insert
 * all hardcode a column list that the baseline schema never fully declared.
 * Missing on drifted databases: budget, progress, notes, activities,
 * disciplines, priority — so project creation failed with
 * `Unknown column 'budget'` / `'priority'` in 'field list'.
 *
 * Types mirror the `proposals` table (convert copies these values verbatim):
 * - budget    DECIMAL(15,2) NULL   (proposals.budget)
 * - progress  DECIMAL(5,2) DEFAULT '0.00' (proposals.progress)
 * - notes     TEXT NULL            (proposals.notes)
 * - priority  VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' after `type`
 *   (VARCHAR not ENUM: accepts legacy case variants like 'Medium'; the
 *   projects UI uses LOW / MEDIUM / HIGH and filters case-insensitively)
 * - activities/disciplines LONGTEXT JSON strings, like input_document
 *
 * Idempotent: every step checks information_schema first, so it is a no-op on
 * databases that already have some or all of these columns.
 */
export async function up(knex) {
	const hasColumn = async (table, column) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
			 LIMIT 1`,
			[table, column]
		);
		return rows.length > 0;
	};

	const addColumn = async (ddl) => {
		if (!(await hasColumn('projects', ddl.name))) {
			await knex.raw(
				`ALTER TABLE projects ADD COLUMN ${ddl.name} ${ddl.definition}`
			);
		}
	};

	// Order matters: each AFTER target must already exist (baseline column or
	// an earlier step in this list).
	const steps = [
		{
			name: 'budget',
			definition: 'DECIMAL(15,2) NULL DEFAULT NULL AFTER target_date',
		},
		{
			name: 'priority',
			definition: `VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' AFTER type`,
		},
		{
			name: 'progress',
			definition: `DECIMAL(5,2) NULL DEFAULT '0.00' AFTER priority`,
		},
		{ name: 'notes', definition: 'TEXT NULL DEFAULT NULL AFTER proposal_id' },
		{
			name: 'activities',
			definition: 'LONGTEXT NULL DEFAULT NULL AFTER notes',
		},
		{
			name: 'disciplines',
			definition: 'LONGTEXT NULL DEFAULT NULL AFTER activities',
		},
	];

	for (const step of steps) {
		await addColumn(step);
	}

	// Backfill rows from environments where a drifted `priority` existed as nullable.
	await knex.raw(
		`UPDATE projects SET priority = 'MEDIUM' WHERE priority IS NULL`
	);
}

export async function down(knex) {
	const hasColumn = async (table, column) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
			 LIMIT 1`,
			[table, column]
		);
		return rows.length > 0;
	};

	for (const column of [
		'disciplines',
		'activities',
		'notes',
		'progress',
		'priority',
		'budget',
	]) {
		if (await hasColumn('projects', column)) {
			await knex.raw(`ALTER TABLE projects DROP COLUMN ${column}`);
		}
	}
}
