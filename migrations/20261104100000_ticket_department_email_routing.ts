import type { Knex } from 'knex';

/**
 * Ticket department routing and the email outbox.
 *
 * Schema:
 * - `ticket_departments` is the selectable routing catalog. A department is
 *   selectable only when it is active, mapped to one active `roles_master`
 *   role, and that role has at least one active live user with a usable
 *   email. The seed rows (IT, HR, Admin) start unmapped on purpose: a super
 *   administrator must choose the responsible role for each one.
 * - `support_tickets.ticket_department_id` records the routed department for
 *   new tickets. Tickets created before this migration keep NULL and their
 *   legacy `assigned_to` value. `assignment_version` increments only when the
 *   department changes, so stale notification jobs can be identified.
 * - `ticket_email_outbox` stores one row per recipient and routing event.
 *   Jobs are written in the same transaction as the ticket change. Unique
 *   `(ticket_id, assignment_version, event_type, recipient_user_id)` makes the
 *   enqueue idempotent, and the due index supports the retry worker.
 *
 * Safe to re-run: every step checks `information_schema` first. `down()`
 * removes only what this migration created, in reverse order, and tolerates
 * partially applied runs.
 */

const DEPARTMENTS_TABLE = 'ticket_departments';
const OUTBOX_TABLE = 'ticket_email_outbox';
const TICKETS_TABLE = 'support_tickets';
const DEPARTMENT_COLUMN = 'ticket_department_id';
const ASSIGNMENT_VERSION_COLUMN = 'assignment_version';
const DEPARTMENT_INDEX = 'idx_support_tickets_ticket_department_id';
const ROLE_INDEX = 'idx_ticket_departments_role_id';
const OUTBOX_DUE_INDEX = 'idx_ticket_email_outbox_due';
const OUTBOX_TICKET_INDEX = 'idx_ticket_email_outbox_ticket_id';
const OUTBOX_RECIPIENT_UNIQUE = 'uq_ticket_email_outbox_event_recipient';

async function hasTable(knex: Knex, table: string): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema = DATABASE() AND table_name = ?
		 LIMIT 1`,
		[table]
	);
	return rows.length > 0;
}

async function hasColumn(
	knex: Knex,
	table: string,
	column: string
): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.columns
		 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
		 LIMIT 1`,
		[table, column]
	);
	return rows.length > 0;
}

async function hasIndex(
	knex: Knex,
	table: string,
	index: string
): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.statistics
		 WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
		 LIMIT 1`,
		[table, index]
	);
	return rows.length > 0;
}

async function createDepartmentsTable(knex: Knex): Promise<void> {
	await knex.raw(`
		CREATE TABLE IF NOT EXISTS \`${DEPARTMENTS_TABLE}\` (
			id INT UNSIGNED NOT NULL AUTO_INCREMENT,
			name VARCHAR(100) NOT NULL,
			role_id INT NULL,
			is_active TINYINT(1) NOT NULL DEFAULT 1,
			isDelete TINYINT(1) NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY \`uq_ticket_departments_name\` (name),
			KEY \`${ROLE_INDEX}\` (role_id),
			KEY \`idx_ticket_departments_isDelete\` (isDelete)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);
}

async function createOutboxTable(knex: Knex): Promise<void> {
	await knex.raw(`
		CREATE TABLE IF NOT EXISTS \`${OUTBOX_TABLE}\` (
			id INT UNSIGNED NOT NULL AUTO_INCREMENT,
			ticket_id INT NOT NULL,
			department_id INT UNSIGNED NOT NULL,
			role_id INT NOT NULL,
			assignment_version INT UNSIGNED NOT NULL,
			event_type VARCHAR(20) NOT NULL,
			recipient_user_id INT NOT NULL,
			recipient_email VARCHAR(255) NOT NULL,
			payload JSON NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			attempts INT UNSIGNED NOT NULL DEFAULT 0,
			next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			locked_until DATETIME NULL,
			lock_token VARCHAR(64) NULL,
			provider_message_id VARCHAR(255) NULL,
			last_error TEXT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			sent_at DATETIME NULL,
			isDelete TINYINT(1) NOT NULL DEFAULT 0,
			PRIMARY KEY (id),
			UNIQUE KEY \`${OUTBOX_RECIPIENT_UNIQUE}\`
				(ticket_id, assignment_version, event_type, recipient_user_id),
			KEY \`${OUTBOX_DUE_INDEX}\` (status, next_attempt_at),
			KEY \`${OUTBOX_TICKET_INDEX}\` (ticket_id),
			KEY \`idx_ticket_email_outbox_department_id\` (department_id),
			KEY \`idx_ticket_email_outbox_isDelete\` (isDelete)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);
}

async function seedDepartments(knex: Knex): Promise<void> {
	// Existing names are left untouched, so re-running never overwrites a
	// super administrator's role mapping or activation choice.
	await knex.raw(
		`INSERT IGNORE INTO \`${DEPARTMENTS_TABLE}\` (name, role_id)
		 VALUES ('IT', NULL), ('HR', NULL), ('Admin', NULL)`
	);
}

export async function up(knex: Knex): Promise<void> {
	await createDepartmentsTable(knex);
	await seedDepartments(knex);
	await createOutboxTable(knex);

	if (!(await hasColumn(knex, TICKETS_TABLE, DEPARTMENT_COLUMN))) {
		await knex.raw(
			`ALTER TABLE \`${TICKETS_TABLE}\`
			 ADD COLUMN \`${DEPARTMENT_COLUMN}\` INT UNSIGNED NULL`
		);
	}
	if (!(await hasColumn(knex, TICKETS_TABLE, ASSIGNMENT_VERSION_COLUMN))) {
		await knex.raw(
			`ALTER TABLE \`${TICKETS_TABLE}\`
			 ADD COLUMN \`${ASSIGNMENT_VERSION_COLUMN}\` INT UNSIGNED NOT NULL DEFAULT 0`
		);
	}
	if (!(await hasIndex(knex, TICKETS_TABLE, DEPARTMENT_INDEX))) {
		await knex.raw(
			`ALTER TABLE \`${TICKETS_TABLE}\`
			 ADD INDEX \`${DEPARTMENT_INDEX}\` (\`${DEPARTMENT_COLUMN}\`)`
		);
	}
}

export async function down(knex: Knex): Promise<void> {
	if (await hasTable(knex, OUTBOX_TABLE)) {
		await knex.raw(`DROP TABLE \`${OUTBOX_TABLE}\``);
	}

	if (await hasTable(knex, TICKETS_TABLE)) {
		if (await hasIndex(knex, TICKETS_TABLE, DEPARTMENT_INDEX)) {
			await knex.raw(
				`ALTER TABLE \`${TICKETS_TABLE}\`
				 DROP INDEX \`${DEPARTMENT_INDEX}\``
			);
		}
		if (await hasColumn(knex, TICKETS_TABLE, DEPARTMENT_COLUMN)) {
			await knex.raw(
				`ALTER TABLE \`${TICKETS_TABLE}\`
				 DROP COLUMN \`${DEPARTMENT_COLUMN}\``
			);
		}
		if (await hasColumn(knex, TICKETS_TABLE, ASSIGNMENT_VERSION_COLUMN)) {
			await knex.raw(
				`ALTER TABLE \`${TICKETS_TABLE}\`
				 DROP COLUMN \`${ASSIGNMENT_VERSION_COLUMN}\``
			);
		}
	}

	if (await hasTable(knex, DEPARTMENTS_TABLE)) {
		await knex.raw(`DROP TABLE \`${DEPARTMENTS_TABLE}\``);
	}
}
