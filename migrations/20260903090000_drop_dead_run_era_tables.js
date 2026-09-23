/**
 * Drop dead run-era detail tables (issue #239, ADR-0008).
 *
 * employee_payroll, employee_payroll_components, and statutory_payments were
 * the baseline schema's per-run detail design, all FK'd to payroll_runs.
 * Zero references exist anywhere in src/ or scripts/ — payroll_slips (its own
 * earnings/deductions/employer columns) replaced them long ago. Keeping them
 * invites wiring the incoming run lock into the wrong tables.
 *
 * Deliberately NOT dropped: payroll_runs and payroll_audit_logs (revived by
 * the run-lock work), payroll_slips/payroll_schedules/da_schedule (live),
 * salary_structures (live readers, retired separately per ADR-0001).
 *
 * Three baseline-era child tables still carry FKs INTO employee_payroll
 * (salary_manual_overrides, salary_slips, loan_repayment_schedule — all with
 * zero code references). They are out of this drop's scope, so up() removes
 * only their constraints and down() re-adds them; the orphaned columns stay
 * until those dead tables get their own cleanup ticket.
 */

export async function up(knex) {
	// Inbound FKs must go before their parent table.
	await knex.raw(
		'ALTER TABLE `salary_manual_overrides` DROP FOREIGN KEY `salary_manual_overrides_ibfk_1`'
	);
	await knex.raw(
		'ALTER TABLE `salary_slips` DROP FOREIGN KEY `salary_slips_ibfk_1`'
	);
	await knex.raw(
		'ALTER TABLE `loan_repayment_schedule` DROP FOREIGN KEY `fk_loan_repayment_payroll`'
	);

	// FK-safe order: components before its parent employee_payroll.
	await knex.raw('DROP TABLE IF EXISTS `employee_payroll_components`');
	await knex.raw('DROP TABLE IF EXISTS `employee_payroll`');
	await knex.raw('DROP TABLE IF EXISTS `statutory_payments`');
}

export async function down(knex) {
	// Recreate exactly as in 20260722080106_baseline_schema.js (parents first).
	await knex.raw(`
CREATE TABLE IF NOT EXISTS \`employee_payroll\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`payroll_run_id\` int(11) NOT NULL,
  \`employee_id\` int(11) NOT NULL,
  \`salary_structure_id\` int(11) NOT NULL,
  \`attendance_id\` int(11) DEFAULT NULL,
  \`month\` int(11) NOT NULL,
  \`year\` int(11) NOT NULL,
  \`pay_type\` enum('monthly','hourly','daily') NOT NULL DEFAULT 'monthly',
  \`working_days\` int(11) NOT NULL,
  \`present_days\` decimal(4,1) NOT NULL,
  \`payable_days\` decimal(4,1) NOT NULL,
  \`lop_days\` decimal(4,1) DEFAULT 0.0,
  \`regular_hours\` decimal(6,2) DEFAULT 0.00,
  \`overtime_hours\` decimal(6,2) DEFAULT 0.00,
  \`hourly_rate\` decimal(10,2) DEFAULT NULL,
  \`ot_rate\` decimal(10,2) DEFAULT NULL,
  \`basic_earned\` decimal(12,2) DEFAULT 0.00,
  \`hra_earned\` decimal(12,2) DEFAULT 0.00,
  \`other_allowances\` decimal(12,2) DEFAULT 0.00,
  \`overtime_pay\` decimal(12,2) DEFAULT 0.00,
  \`arrears\` decimal(12,2) DEFAULT 0.00,
  \`total_earnings\` decimal(12,2) DEFAULT 0.00,
  \`pf_employee\` decimal(12,2) DEFAULT 0.00,
  \`esic_employee\` decimal(12,2) DEFAULT 0.00,
  \`professional_tax\` decimal(12,2) DEFAULT 0.00,
  \`mlwf_employee\` decimal(12,2) DEFAULT 0.00,
  \`tds\` decimal(12,2) DEFAULT 0.00,
  \`lop_deduction\` decimal(12,2) DEFAULT 0.00,
  \`loan_recovery\` decimal(12,2) DEFAULT 0.00,
  \`other_deductions\` decimal(12,2) DEFAULT 0.00,
  \`total_deductions\` decimal(12,2) DEFAULT 0.00,
  \`pf_employer\` decimal(12,2) DEFAULT 0.00,
  \`esic_employer\` decimal(12,2) DEFAULT 0.00,
  \`mlwf_employer\` decimal(12,2) DEFAULT 0.00,
  \`total_employer_contribution\` decimal(12,2) DEFAULT 0.00,
  \`gross_salary\` decimal(12,2) NOT NULL DEFAULT 0.00,
  \`net_pay\` decimal(12,2) NOT NULL DEFAULT 0.00,
  \`payment_status\` enum('pending','processed','paid','hold') DEFAULT 'pending',
  \`payment_reference\` varchar(100) DEFAULT NULL,
  \`payment_date\` date DEFAULT NULL,
  \`bank_name\` varchar(100) DEFAULT NULL,
  \`bank_account_no\` varchar(50) DEFAULT NULL,
  \`bank_ifsc\` varchar(20) DEFAULT NULL,
  \`remarks\` text DEFAULT NULL,
  \`created_at\` timestamp NULL DEFAULT current_timestamp(),
  \`updated_at\` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_run_employee\` (\`payroll_run_id\`,\`employee_id\`),
  KEY \`salary_structure_id\` (\`salary_structure_id\`),
  KEY \`attendance_id\` (\`attendance_id\`),
  KEY \`idx_employee_period\` (\`employee_id\`,\`year\`,\`month\`),
  KEY \`idx_payment_status\` (\`payment_status\`),
  CONSTRAINT \`employee_payroll_ibfk_1\` FOREIGN KEY (\`payroll_run_id\`) REFERENCES \`payroll_runs\` (\`id\`),
  CONSTRAINT \`employee_payroll_ibfk_2\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\` (\`id\`),
  CONSTRAINT \`employee_payroll_ibfk_3\` FOREIGN KEY (\`salary_structure_id\`) REFERENCES \`salary_structures\` (\`id\`),
  CONSTRAINT \`employee_payroll_ibfk_4\` FOREIGN KEY (\`attendance_id\`) REFERENCES \`attendance_monthly\` (\`id\`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
	await knex.raw(`
CREATE TABLE IF NOT EXISTS \`employee_payroll_components\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`employee_payroll_id\` int(11) NOT NULL,
  \`component_name\` varchar(100) NOT NULL,
  \`component_code\` varchar(20) NOT NULL,
  \`component_type\` enum('earning','deduction','employer_contribution') NOT NULL,
  \`calculated_amount\` decimal(12,2) NOT NULL,
  \`actual_amount\` decimal(12,2) NOT NULL,
  \`is_statutory\` tinyint(1) DEFAULT 0,
  \`statutory_type\` varchar(10) DEFAULT NULL,
  \`display_order\` int(11) DEFAULT 0,
  \`created_at\` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`),
  KEY \`idx_payroll_type\` (\`employee_payroll_id\`,\`component_type\`),
  CONSTRAINT \`employee_payroll_components_ibfk_1\` FOREIGN KEY (\`employee_payroll_id\`) REFERENCES \`employee_payroll\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
	await knex.raw(`
CREATE TABLE IF NOT EXISTS \`statutory_payments\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`payroll_run_id\` int(11) NOT NULL,
  \`statutory_type\` enum('pf','esic','pt','mlwf','tds') NOT NULL,
  \`month\` int(11) NOT NULL,
  \`year\` int(11) NOT NULL,
  \`employee_contribution\` decimal(15,2) DEFAULT 0.00,
  \`employer_contribution\` decimal(15,2) DEFAULT 0.00,
  \`total_amount\` decimal(15,2) NOT NULL,
  \`employee_count\` int(11) DEFAULT 0,
  \`due_date\` date DEFAULT NULL,
  \`status\` enum('pending','paid','delayed') DEFAULT 'pending',
  \`challan_number\` varchar(100) DEFAULT NULL,
  \`challan_date\` date DEFAULT NULL,
  \`paid_date\` date DEFAULT NULL,
  \`paid_amount\` decimal(15,2) DEFAULT NULL,
  \`payment_reference\` varchar(100) DEFAULT NULL,
  \`late_fee\` decimal(12,2) DEFAULT 0.00,
  \`interest\` decimal(12,2) DEFAULT 0.00,
  \`receipt_path\` varchar(500) DEFAULT NULL,
  \`remarks\` text DEFAULT NULL,
  \`created_at\` timestamp NULL DEFAULT current_timestamp(),
  \`updated_at\` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_run_type\` (\`payroll_run_id\`,\`statutory_type\`),
  KEY \`idx_type_period\` (\`statutory_type\`,\`year\`,\`month\`),
  KEY \`idx_status\` (\`status\`),
  CONSTRAINT \`statutory_payments_ibfk_1\` FOREIGN KEY (\`payroll_run_id\`) REFERENCES \`payroll_runs\` (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

	// Re-add the inbound FKs dropped in up() (baseline definitions:
	// RESTRICT on the two NOT NULL columns, SET NULL for the nullable one).
	await knex.raw(
		'ALTER TABLE `salary_manual_overrides` ADD CONSTRAINT `salary_manual_overrides_ibfk_1` FOREIGN KEY (`employee_payroll_id`) REFERENCES `employee_payroll` (`id`)'
	);
	await knex.raw(
		'ALTER TABLE `salary_slips` ADD CONSTRAINT `salary_slips_ibfk_1` FOREIGN KEY (`employee_payroll_id`) REFERENCES `employee_payroll` (`id`)'
	);
	await knex.raw(
		'ALTER TABLE `loan_repayment_schedule` ADD CONSTRAINT `fk_loan_repayment_payroll` FOREIGN KEY (`payroll_id`) REFERENCES `employee_payroll` (`id`) ON DELETE SET NULL'
	);
}
