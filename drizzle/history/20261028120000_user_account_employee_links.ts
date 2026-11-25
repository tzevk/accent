import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';
import {
	auditAccountLinks,
	type AccountLinkAudit,
	type AccountLinkQueryExecutor,
} from '../../src/utils/account-link-audit.ts';

const USER_TABLE = 'users';
const EMPLOYEE_TABLE = 'employees';
const LIVE_LINK_COLUMN = 'live_employee_id';
const LIVE_LINK_INDEX = 'uq_users_live_employee_id';
const EMPLOYEE_FK = 'fk_users_employee_id';
const REPAIR_TABLE = 'user_account_link_repairs';

async function hasColumn(
	db: MigrationDb,
	table: string,
	column: string
): Promise<boolean> {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.columns
		 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
		 LIMIT 1`,
		[table, column]
	);
	return rows.length > 0;
}

async function hasIndex(
	db: MigrationDb,
	table: string,
	index: string
): Promise<boolean> {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.statistics
		 WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
		 LIMIT 1`,
		[table, index]
	);
	return rows.length > 0;
}

async function hasForeignKey(
	db: MigrationDb,
	constraint: string
): Promise<boolean> {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.referential_constraints
		 WHERE constraint_schema = DATABASE() AND table_name = ?
		   AND constraint_name = ? LIMIT 1`,
		[USER_TABLE, constraint]
	);
	return rows.length > 0;
}

async function runAudit(db: MigrationDb): Promise<AccountLinkAudit> {
	const execute: AccountLinkQueryExecutor = async (sql, bindings = []) =>
		executeMigrationSql(db, sql, [...bindings]);
	return auditAccountLinks(execute);
}

function migrationBlockerMessage(audit: AccountLinkAudit): string {
	return [
		'Account-link migration blocked by read-only preflight.',
		'No account records were changed. Review and explicitly repair the listed rows before retrying.',
		JSON.stringify(audit.blocking),
	].join(' ');
}

export async function up(db: MigrationDb): Promise<void> {
	// The full read-only audit must complete before the first DDL statement.
	const audit = await runAudit(db);
	if (!audit.canMigrate) throw new Error(migrationBlockerMessage(audit));

	if (!(await hasColumn(db, USER_TABLE, LIVE_LINK_COLUMN))) {
		await executeMigrationSql(
			db,
			`ALTER TABLE \`${USER_TABLE}\`
			 ADD COLUMN \`${LIVE_LINK_COLUMN}\` INT
			 GENERATED ALWAYS AS (IF(isDelete = 0, employee_id, NULL)) STORED
			 AFTER employee_id`
		);
	}
	if (!(await hasIndex(db, USER_TABLE, LIVE_LINK_INDEX))) {
		await executeMigrationSql(
			db,
			`ALTER TABLE \`${USER_TABLE}\`
			 ADD UNIQUE INDEX \`${LIVE_LINK_INDEX}\` (\`${LIVE_LINK_COLUMN}\`)`
		);
	}
	if (!(await hasForeignKey(db, EMPLOYEE_FK))) {
		await executeMigrationSql(
			db,
			`ALTER TABLE \`${USER_TABLE}\`
			 ADD CONSTRAINT \`${EMPLOYEE_FK}\`
			 FOREIGN KEY (employee_id) REFERENCES \`${EMPLOYEE_TABLE}\` (id)
			 ON DELETE RESTRICT ON UPDATE RESTRICT`
		);
	}

	await executeMigrationSql(
		db,
		`
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
	`
	);

	// The shadow username is redundant only after the audit proves it agrees
	// with the canonical Employee/account connection or is empty.
	if (await hasColumn(db, EMPLOYEE_TABLE, 'username')) {
		await executeMigrationSql(
			db,
			`ALTER TABLE \`${EMPLOYEE_TABLE}\` DROP COLUMN username`
		);
	}
}
