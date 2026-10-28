import type { Knex } from 'knex';
import {
	auditAccountLinks,
	type AccountLinkAudit,
	type AccountLinkQueryExecutor,
} from '../src/utils/account-link-audit.ts';

const USER_TABLE = 'users';
const EMPLOYEE_TABLE = 'employees';
const LIVE_LINK_COLUMN = 'live_employee_id';
const LIVE_LINK_INDEX = 'uq_users_live_employee_id';
const EMPLOYEE_FK = 'fk_users_employee_id';
const REPAIR_TABLE = 'user_account_link_repairs';

async function hasTable(knex: Knex, table: string): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
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

async function hasForeignKey(knex: Knex, constraint: string): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.referential_constraints
		 WHERE constraint_schema = DATABASE() AND table_name = ?
		   AND constraint_name = ? LIMIT 1`,
		[USER_TABLE, constraint]
	);
	return rows.length > 0;
}

async function runAudit(knex: Knex): Promise<AccountLinkAudit> {
	const execute: AccountLinkQueryExecutor = async (sql, bindings = []) =>
		knex.raw(sql, [...bindings]);
	return auditAccountLinks(execute);
}

function migrationBlockerMessage(audit: AccountLinkAudit): string {
	return [
		'Account-link migration blocked by read-only preflight.',
		'No account records were changed. Review and explicitly repair the listed rows before retrying.',
		JSON.stringify(audit.blocking),
	].join(' ');
}

export async function up(knex: Knex): Promise<void> {
	// The full read-only audit must complete before the first DDL statement.
	const audit = await runAudit(knex);
	if (!audit.canMigrate) throw new Error(migrationBlockerMessage(audit));

	if (!(await hasColumn(knex, USER_TABLE, LIVE_LINK_COLUMN))) {
		await knex.raw(
			`ALTER TABLE \`${USER_TABLE}\`
			 ADD COLUMN \`${LIVE_LINK_COLUMN}\` INT
			 GENERATED ALWAYS AS (IF(isDelete = 0, employee_id, NULL)) STORED
			 AFTER employee_id`
		);
	}
	if (!(await hasIndex(knex, USER_TABLE, LIVE_LINK_INDEX))) {
		await knex.raw(
			`ALTER TABLE \`${USER_TABLE}\`
			 ADD UNIQUE INDEX \`${LIVE_LINK_INDEX}\` (\`${LIVE_LINK_COLUMN}\`)`
		);
	}
	if (!(await hasForeignKey(knex, EMPLOYEE_FK))) {
		await knex.raw(
			`ALTER TABLE \`${USER_TABLE}\`
			 ADD CONSTRAINT \`${EMPLOYEE_FK}\`
			 FOREIGN KEY (employee_id) REFERENCES \`${EMPLOYEE_TABLE}\` (id)
			 ON DELETE RESTRICT ON UPDATE RESTRICT`
		);
	}

	await knex.raw(`
		CREATE TABLE IF NOT EXISTS \`${REPAIR_TABLE}\` (
			id INT NOT NULL AUTO_INCREMENT,
			user_id INT NOT NULL,
			actor_user_id INT NOT NULL,
			previous_employee_id INT NULL,
			employee_id INT NULL,
			reason TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_user_account_link_repairs_user_created (user_id, created_at),
			KEY idx_user_account_link_repairs_actor_created (actor_user_id, created_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	// The shadow username is redundant only after the audit proves it agrees
	// with the canonical Employee/account connection or is empty.
	if (await hasColumn(knex, EMPLOYEE_TABLE, 'username')) {
		await knex.raw(`ALTER TABLE \`${EMPLOYEE_TABLE}\` DROP COLUMN username`);
	}
}

export async function down(knex: Knex): Promise<void> {
	if (await hasTable(knex, USER_TABLE)) {
		if (await hasForeignKey(knex, EMPLOYEE_FK)) {
			await knex.raw(
				`ALTER TABLE \`${USER_TABLE}\` DROP FOREIGN KEY \`${EMPLOYEE_FK}\``
			);
		}
		if (await hasIndex(knex, USER_TABLE, LIVE_LINK_INDEX)) {
			await knex.raw(
				`ALTER TABLE \`${USER_TABLE}\` DROP INDEX \`${LIVE_LINK_INDEX}\``
			);
		}
		if (await hasColumn(knex, USER_TABLE, LIVE_LINK_COLUMN)) {
			await knex.raw(
				`ALTER TABLE \`${USER_TABLE}\` DROP COLUMN \`${LIVE_LINK_COLUMN}\``
			);
		}
	}

	if (
		(await hasTable(knex, EMPLOYEE_TABLE)) &&
		!(await hasColumn(knex, EMPLOYEE_TABLE, 'username'))
	) {
		// Values are intentionally left NULL: reconstructing a shadow username
		// from current accounts could fabricate the pre-migration history.
		await knex.raw(
			`ALTER TABLE \`${EMPLOYEE_TABLE}\`
			 ADD COLUMN username VARCHAR(50) NULL,
			 ADD UNIQUE INDEX username (username)`
		);
	}

	// Keep the repair ledger on rollback; deleting audit history is not safe.
}
