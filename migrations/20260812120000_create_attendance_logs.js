/**
 * Smart Office (BioMax) attendance webhook store.
 *
 * Smart Office pushes biometric punches to POST /api/attendance/webhook
 * (body: employeeCode, logDate, serialNumber, direction, raw payload).
 * Records are keyed by the device identity — (employee_code, log_date,
 * serial_number) — so re-pushes from Smart Office or the pull-based
 * reconciliation job are idempotent (INSERT ... ON DUPLICATE KEY UPDATE).
 *
 * employee_id is populated lazily by the mapping step: `employee_code`
 * matches `employees.smartoffice_code`. Unmapped rows keep employee_id
 * NULL and are never dropped.
 *
 * `raw_payload` stores the full received body (JSON) for debugging/replay.
 */

export async function up(knex) {
	await knex.raw(`
    CREATE TABLE attendance_logs (
      id INT NOT NULL AUTO_INCREMENT,
      employee_code VARCHAR(50) NOT NULL,
      log_date DATETIME NOT NULL,
      serial_number VARCHAR(64) NOT NULL,
      direction VARCHAR(10) NULL,
      raw_payload JSON NULL,
      employee_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY unique_employee_log (employee_code, log_date, serial_number),
      KEY idx_log_date (log_date),
      KEY idx_serial_number (serial_number),
      KEY idx_employee_id (employee_id),
      CONSTRAINT fk_attendance_logs_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
	// Smart Office employee_code → Accent employee lookup used by the
	// webhook mapper and reconciliation; plain index (code is nullable and
	// not enforced unique — dedupe happens in the mapping step).
	await knex.raw(
		'CREATE INDEX idx_employees_smartoffice_code ON employees (smartoffice_code)'
	);
}

export async function down(knex) {
	await knex.raw('DROP TABLE IF EXISTS attendance_logs');
	await knex.raw('DROP INDEX idx_employees_smartoffice_code ON employees');
}
