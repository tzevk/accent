/**
 * Recorded employer-cost allocation for company expenditure (#307, ADR-0016).
 *
 * A Payroll Slip's employer cost is allocated across the Employee's monthly
 * Logged Hours: each Project's share is its hours' share of the month's total,
 * and hours without a Project stay in the denominator with their share kept as
 * Unallocated Employee Cost ("No project"). No Logged Hours means the whole
 * recorded cost stays unallocated ("No logged hours") — never spread over
 * known Projects.
 *
 * `payroll_employee_allocations` is one frozen allocation per Payroll Slip and
 * version. Payroll Finalize writes it in the same transaction that flips the
 * run to `finalized`, so a later timesheet or Salary Profile edit cannot move
 * the shares; a re-finalization after an authorized reopen appends the next
 * version instead of overwriting history.
 *
 *   recorded_employer_cost   the Payroll Slip's own employer_cost, the one
 *                            amount the shares must sum back to exactly.
 *   version / kind           monotonic per slip; `finalization` for a freeze
 *                            at Finalize, `reconstruction` reserved for the
 *                            reviewed historical rebuild.
 *   total_logged_hours       the allocation denominator: every eligible hour
 *                            of the month, including hours without a Project.
 *   rounding_adjustment      the deterministic cent applied by the largest-
 *                            remainder step so shares reconcile to the slip.
 *   employee_code/name       snapshotted identity: historical totals keep
 *                            naming the Employee even if the master changes.
 *
 * `payroll_employee_allocation_shares` is the per-Project breakdown, one row
 * per Project plus one `no_project` row and/or one `no_logged_hours` row.
 * Project code/name/client are snapshotted for the same historical-identity
 * reason as the Employee columns.
 *
 * `payroll_allocation_events` is the append-only journal of freezes (and, for
 * the later reconstruction/revision slices, their reasoned corrections), keyed
 * (allocation_uid, version) exactly like `financial_cost_events`.
 *
 * Idempotent: every step checks information_schema first.
 */

const ALLOCATION_TABLES = [
	`
  CREATE TABLE \`payroll_employee_allocations\` (
    \`id\` INT NOT NULL AUTO_INCREMENT,
    \`allocation_uid\` VARCHAR(64) NOT NULL COMMENT 'Stable allocation identity for later source references',
    \`payroll_slip_id\` INT NOT NULL,
    \`month\` DATE NOT NULL COMMENT 'Payroll month (first day)',
    \`employee_id\` INT NOT NULL,
    \`employee_code\` VARCHAR(50) NOT NULL COMMENT 'Snapshotted employee code',
    \`employee_name\` VARCHAR(255) NOT NULL COMMENT 'Snapshotted employee name',
    \`pay_stream\` ENUM('payroll','contract') NOT NULL DEFAULT 'payroll' COMMENT 'Salary Profile stream at freeze time',
    \`version\` INT NOT NULL COMMENT 'Monotonic per slip; a reopen/re-finalize appends',
    \`kind\` ENUM('finalization','reconstruction') NOT NULL COMMENT 'How the allocation was produced',
    \`recorded_employer_cost\` DECIMAL(12,2) NOT NULL COMMENT 'The Payroll Slip employer cost the shares sum to',
    \`currency\` VARCHAR(3) NOT NULL DEFAULT 'INR',
    \`total_logged_hours\` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'All eligible monthly Logged Hours (the denominator)',
    \`project_hours\` DECIMAL(10,2) NOT NULL DEFAULT 0,
    \`no_project_hours\` DECIMAL(10,2) NOT NULL DEFAULT 0,
    \`rounding_adjustment\` DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Total cent applied by the largest-remainder step',
    \`frozen_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`frozen_by\` INT NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`unique_slip_allocation_version\` (\`payroll_slip_id\`, \`version\`),
    KEY \`idx_allocation_month\` (\`month\`, \`employee_id\`),
    KEY \`idx_allocation_employee\` (\`employee_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`,
	`
  CREATE TABLE \`payroll_employee_allocation_shares\` (
    \`id\` INT NOT NULL AUTO_INCREMENT,
    \`allocation_id\` INT NOT NULL,
    \`project_id\` INT NULL COMMENT 'NULL = No project / No logged hours',
    \`project_code\` VARCHAR(100) NULL COMMENT 'Snapshotted project identity',
    \`project_name\` VARCHAR(255) NULL,
    \`client_name\` VARCHAR(255) NULL,
    \`hours\` DECIMAL(10,2) NOT NULL DEFAULT 0,
    \`amount\` DECIMAL(12,2) NOT NULL,
    \`rounding_adjustment\` DECIMAL(12,2) NOT NULL DEFAULT 0,
    \`basis\` ENUM('project','no_project','no_logged_hours') NOT NULL,
    PRIMARY KEY (\`id\`),
    KEY \`idx_share_allocation\` (\`allocation_id\`),
    KEY \`idx_share_project\` (\`project_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`,
	`
  CREATE TABLE \`payroll_allocation_events\` (
    \`id\` INT NOT NULL AUTO_INCREMENT,
    \`allocation_uid\` VARCHAR(64) NOT NULL,
    \`source_table\` VARCHAR(64) NOT NULL,
    \`source_id\` INT NOT NULL,
    \`version\` INT NOT NULL,
    \`command\` ENUM('frozen','reconstructed','superseded','revised') NOT NULL,
    \`actor_user_id\` INT NULL,
    \`reason\` VARCHAR(500) NULL,
    \`evidence_reference\` VARCHAR(500) NULL,
    \`snapshot\` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (json_valid(\`snapshot\`)),
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`unique_allocation_event_version\` (\`allocation_uid\`, \`version\`),
    KEY \`idx_allocation_event_source\` (\`source_table\`, \`source_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`,
];

export async function up(knex) {
	const hasTable = async (table) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.tables
			 WHERE table_schema = DATABASE() AND table_name = ?
			 LIMIT 1`,
			[table]
		);
		return rows.length > 0;
	};
	const names = [
		'payroll_employee_allocations',
		'payroll_employee_allocation_shares',
		'payroll_allocation_events',
	];
	for (let index = 0; index < names.length; index++) {
		if (!(await hasTable(names[index]))) {
			await knex.raw(ALLOCATION_TABLES[index]);
		}
	}
}

export async function down(knex) {
	for (const table of [
		'payroll_allocation_events',
		'payroll_employee_allocation_shares',
		'payroll_employee_allocations',
	]) {
		await knex.raw(`DROP TABLE IF EXISTS \`${table}\``);
	}
}
