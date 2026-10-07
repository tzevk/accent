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

const CHARGE_TABLE = 'expense_period_charges';
const EVENT_TABLE = 'expense_period_charge_events';

const NATURES = [
	'operating',
	'advance',
	'deposit',
	'prepayment',
	'capital',
	'unresolved',
];

const BASES = ['consumption', 'depreciation', 'amortization'];

export async function up(knex) {
	if (!(await knex.schema.hasColumn('expenses', 'cost_nature'))) {
		await knex.schema.alterTable('expenses', (table) => {
			table.enu('cost_nature', NATURES).notNullable().defaultTo('operating');
			table.index(['cost_nature'], 'idx_cost_nature');
		});
	}

	if (!(await knex.schema.hasTable(CHARGE_TABLE))) {
		await knex.schema.createTable(CHARGE_TABLE, (table) => {
			table.increments('id').primary();
			table.string('charge_uid', 64).notNullable();
			// Source discriminator: charge identities are minted by this module
			// and resolve through the owning cost's identity, not a bare id.
			table.string('source_table', 32).notNullable().defaultTo('expenses');
			table.integer('source_id').unsigned().notNullable();
			table.string('source_cost_uid', 64).notNullable();
			table.date('charge_period').notNullable();
			table.enu('basis', BASES).notNullable();
			table.decimal('amount', 15, 2).notNullable();
			table.string('currency', 3).notNullable();
			table.string('evidence_reference', 500).notNullable();
			table
				.enu('state', ['approved', 'cancelled'])
				.notNullable()
				.defaultTo('approved');
			table.integer('financial_version').unsigned().notNullable().defaultTo(1);
			// Re-entry counter for a period/basis whose earlier charge was
			// cancelled: the unique key below keeps the pair race-proof.
			table.integer('sequence').unsigned().notNullable().defaultTo(1);
			table.integer('approved_by').unsigned().nullable();
			table.datetime('approved_at').nullable();
			table.integer('cancelled_by').unsigned().nullable();
			table.datetime('cancelled_at').nullable();
			table.string('cancel_reason', 500).nullable();
			table.timestamps(true, true);
			table.unique(['charge_uid'], { indexName: 'uq_period_charge_uid' });
			table.unique(
				['source_cost_uid', 'charge_period', 'basis', 'sequence'],
				{ indexName: 'uq_period_charge_period_basis' }
			);
			table.index(['charge_period', 'state'], 'idx_period_charge_month');
			table.index(['source_id'], 'idx_period_charge_source');
		});
	}

	if (!(await knex.schema.hasTable(EVENT_TABLE))) {
		await knex.schema.createTable(EVENT_TABLE, (table) => {
			table.increments('id').primary();
			table.string('charge_uid', 64).notNullable();
			table.integer('version').unsigned().notNullable();
			table.enu('command', ['approved', 'cancelled']).notNullable();
			table.integer('actor_user_id').unsigned().nullable();
			table.string('reason', 500).nullable();
			table.string('evidence_reference', 500).nullable();
			table.json('snapshot').nullable();
			table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
			table.unique(['charge_uid', 'version'], {
				indexName: 'uq_period_charge_event',
			});
		});
	}
}

export async function down(knex) {
	if (await knex.schema.hasTable(EVENT_TABLE)) {
		await knex.schema.dropTable(EVENT_TABLE);
	}
	if (await knex.schema.hasTable(CHARGE_TABLE)) {
		await knex.schema.dropTable(CHARGE_TABLE);
	}
	if (await knex.schema.hasColumn('expenses', 'cost_nature')) {
		await knex.schema.alterTable('expenses', (table) => {
			table.dropIndex(['cost_nature'], 'idx_cost_nature');
			table.dropColumn('cost_nature');
		});
	}
}
