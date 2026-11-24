/**
 * Ticket #317 — non-operating cost natures and approved period charges.
 *
 * `expenses.cost_nature` records what the spend is (operating cost versus an
 * advance, deposit, prepayment, or capital item, or an explicitly unresolved
 * treatment), independent of where it belongs (`cost_classification`). Rows
 * recorded before this migration were direct operating cost: the register had
 * no other nature, so they keep `'operating'` and nothing is guessed as
 * capital.
 *
 * `expense_period_charges` carries approved, evidence-backed period
 * consumption, depreciation, or amortization against a non-operating source
 * balance. It is deliberately not a fixed-asset register and computes no
 * schedule: each row is an explicit, approved charge with its own evidence and
 * month, and the sum of approved charges may never exceed the source's
 * supported balance. `(source_cost_uid, charge_period, basis, sequence)` is
 * unique, so a month's consumption for one source and basis is entered once;
 * a cancelled charge frees the period for a corrected re-entry while both
 * rows stay as history.
 *
 * `expense_period_charge_events` is the append-only approval journal
 * (approved/cancelled, actor, reason, evidence, versioned snapshot).
 */

import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

const CHARGE_TABLE = 'expense_period_charges';
const EVENT_TABLE = 'expense_period_charge_events';

async function hasColumn(
	db: MigrationDb,
	tableName: string,
	columnName: string
): Promise<boolean> {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
     LIMIT 1`,
		[tableName, columnName]
	);
	return Array.isArray(rows) && rows.length > 0;
}

async function hasTable(db: MigrationDb, tableName: string): Promise<boolean> {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?
     LIMIT 1`,
		[tableName]
	);
	return Array.isArray(rows) && rows.length > 0;
}

export async function up(db: MigrationDb): Promise<void> {
	if (!(await hasColumn(db, 'expenses', 'cost_nature'))) {
		await executeMigrationSql(
			db,
			"alter table `expenses` add `cost_nature` enum('operating', 'advance', 'deposit', 'prepayment', 'capital', 'unresolved') not null default 'operating'"
		);
		await executeMigrationSql(
			db,
			'alter table `expenses` add index `idx_cost_nature`(`cost_nature`)'
		);
	}

	if (!(await hasTable(db, CHARGE_TABLE))) {
		await executeMigrationSql(
			db,
			"create table `expense_period_charges` (`id` int unsigned not null auto_increment primary key, `charge_uid` varchar(64) not null, `source_table` varchar(32) not null default 'expenses', `source_id` int unsigned not null, `source_cost_uid` varchar(64) not null, `charge_period` date not null, `basis` enum('consumption','depreciation','amortization') not null, `amount` decimal(15, 2) not null, `currency` varchar(3) not null, `evidence_reference` varchar(500) not null, `state` enum('approved','cancelled') not null default 'approved', `financial_version` int unsigned not null default '1', `sequence` int unsigned not null default '1', `approved_by` int unsigned null, `approved_at` datetime null, `cancelled_by` int unsigned null, `cancelled_at` datetime null, `cancel_reason` varchar(500) null, `created_at` timestamp not null default CURRENT_TIMESTAMP, `updated_at` timestamp not null default CURRENT_TIMESTAMP)"
		);
		await executeMigrationSql(
			db,
			'alter table `expense_period_charges` add unique `uq_period_charge_uid`(`charge_uid`)'
		);
		await executeMigrationSql(
			db,
			'alter table `expense_period_charges` add unique `uq_period_charge_period_basis`(`source_cost_uid`, `charge_period`, `basis`, `sequence`)'
		);
		await executeMigrationSql(
			db,
			'alter table `expense_period_charges` add index `idx_period_charge_month`(`charge_period`, `state`)'
		);
		await executeMigrationSql(
			db,
			'alter table `expense_period_charges` add index `idx_period_charge_source`(`source_id`)'
		);
	}

	if (!(await hasTable(db, EVENT_TABLE))) {
		await executeMigrationSql(
			db,
			"create table `expense_period_charge_events` (`id` int unsigned not null auto_increment primary key, `charge_uid` varchar(64) not null, `version` int unsigned not null, `command` enum('approved','cancelled') not null, `actor_user_id` int unsigned null, `reason` varchar(500) null, `evidence_reference` varchar(500) null, `snapshot` json null, `created_at` datetime not null default CURRENT_TIMESTAMP)"
		);
		await executeMigrationSql(
			db,
			'alter table `expense_period_charge_events` add unique `uq_period_charge_event`(`charge_uid`, `version`)'
		);
	}
}
