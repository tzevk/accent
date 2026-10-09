import type { Knex } from 'knex';

/**
 * Reviewed historical allocation reconstruction (#308, ADR-0016).
 *
 * A finalized legacy Payroll Slip without saved allocation shares is rebuilt
 * once from its recorded employer cost and the available monthly Logged Hours,
 * but the rebuild is a **proposal** first: it lives in its own tables until an
 * authorized reviewer approves it, so unreviewed data never becomes the
 * current allocation header.
 *
 * `payroll_allocation_reconstruction_proposals` — one row per Payroll Slip ×
 * proposal version:
 *
 *   financial_version        monotonic per slip; a review command must state
 *                            the version it expects (stale commands refuse).
 *   status                   pending | approved | rejected — the review
 *                            decision, with actor and time.
 *   evidence / missing_evidence
 *                            JSON snapshots of the reconstruction basis
 *                            (recorded cost + monthly timesheets) and the
 *                            evidence limitations; missing evidence keeps its
 *                            amount unallocated, never invented attribution.
 *   frozen_allocation_id     set on approval: links to the allocation row the
 *                            reviewed proposal froze.
 *
 * `payroll_allocation_reconstruction_shares` — the proposed destinations, the
 * same shape and semantics as `payroll_employee_allocation_shares`. Approval
 * copies these exact rows into the allocation tables, so what the reviewer saw
 * is what freezes; approval never recomputes from later timesheets.
 *
 * The two tables never touch `payroll_slips` or `payroll_runs`: a
 * reconstruction changes no slip, payment status, or run state.
 *
 * Idempotent: every step checks information_schema first.
 */

const RECONSTRUCTION_TABLES = [
	`
  CREATE TABLE \`payroll_allocation_reconstruction_proposals\` (
    \`id\` INT NOT NULL AUTO_INCREMENT,
    \`proposal_uid\` VARCHAR(64) NOT NULL COMMENT 'Stable identity: payroll-recon-<slipId>-v<financial_version>',
    \`payroll_slip_id\` INT NOT NULL,
    \`month\` DATE NOT NULL COMMENT 'Payroll month (first day)',
    \`employee_id\` INT NOT NULL,
    \`employee_code\` VARCHAR(50) NOT NULL COMMENT 'Snapshotted employee code',
    \`employee_name\` VARCHAR(255) NOT NULL COMMENT 'Snapshotted employee name',
    \`pay_stream\` ENUM('payroll','contract') NOT NULL DEFAULT 'payroll' COMMENT 'Salary Profile stream observed at proposal time (metadata only)',
    \`financial_version\` INT NOT NULL COMMENT 'Monotonic per slip; review commands state the expected version',
    \`status\` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending' COMMENT 'Review decision',
    \`recorded_employer_cost\` DECIMAL(12,2) NOT NULL COMMENT 'The Payroll Slip employer cost the proposed shares sum to',
    \`currency\` VARCHAR(3) NOT NULL DEFAULT 'INR',
    \`total_logged_hours\` DECIMAL(10,2) NOT NULL DEFAULT 0,
    \`project_hours\` DECIMAL(10,2) NOT NULL DEFAULT 0,
    \`no_project_hours\` DECIMAL(10,2) NOT NULL DEFAULT 0,
    \`rounding_adjustment\` DECIMAL(12,2) NOT NULL DEFAULT 0,
    \`evidence\` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Source evidence snapshot' CHECK (json_valid(\`evidence\`)),
    \`missing_evidence\` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Evidence limitations; [] when complete' CHECK (json_valid(\`missing_evidence\`)),
    \`evidence_reference\` VARCHAR(500) NULL COMMENT 'Caller-supplied reference for the review',
    \`proposed_by\` INT NULL,
    \`proposed_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`reviewed_by\` INT NULL,
    \`reviewed_at\` DATETIME NULL,
    \`review_reason\` VARCHAR(500) NULL,
    \`frozen_allocation_id\` INT NULL COMMENT 'payroll_employee_allocations.id frozen by approval',
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`unique_slip_reconstruction_version\` (\`payroll_slip_id\`, \`financial_version\`),
    KEY \`idx_reconstruction_month\` (\`month\`, \`employee_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`,
	`
  CREATE TABLE \`payroll_allocation_reconstruction_shares\` (
    \`id\` INT NOT NULL AUTO_INCREMENT,
    \`proposal_id\` INT NOT NULL,
    \`project_id\` INT NULL COMMENT 'NULL = No project / No logged hours',
    \`project_code\` VARCHAR(100) NULL COMMENT 'Snapshotted project identity',
    \`project_name\` VARCHAR(255) NULL,
    \`client_name\` VARCHAR(255) NULL,
    \`hours\` DECIMAL(10,2) NOT NULL DEFAULT 0,
    \`amount\` DECIMAL(12,2) NOT NULL,
    \`rounding_adjustment\` DECIMAL(12,2) NOT NULL DEFAULT 0,
    \`basis\` ENUM('project','no_project','no_logged_hours') NOT NULL,
    PRIMARY KEY (\`id\`),
    KEY \`idx_reconstruction_share_proposal\` (\`proposal_id\`),
    KEY \`idx_reconstruction_share_project\` (\`project_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`,
] as const;

export async function up(knex: Knex): Promise<void> {
	const hasTable = async (table: string): Promise<boolean> => {
		const [rows] = (await knex.raw(
			`SELECT 1 FROM information_schema.tables
			 WHERE table_schema = DATABASE() AND table_name = ?
			 LIMIT 1`,
			[table]
		)) as [Array<Record<string, unknown>>, unknown];
		return rows.length > 0;
	};
	const names = [
		'payroll_allocation_reconstruction_proposals',
		'payroll_allocation_reconstruction_shares',
	];
	for (let index = 0; index < names.length; index++) {
		if (!(await hasTable(names[index]))) {
			await knex.raw(RECONSTRUCTION_TABLES[index]);
		}
	}
}

export async function down(knex: Knex): Promise<void> {
	for (const table of [
		'payroll_allocation_reconstruction_shares',
		'payroll_allocation_reconstruction_proposals',
	]) {
		await knex.raw(`DROP TABLE IF EXISTS \`${table}\``);
	}
}
