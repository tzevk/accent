import type { Knex } from 'knex';

const IDENTIFIER_COLUMNS = [
	['financial_cost_links', 'cost_uid'],
	['financial_cost_links', 'source_id'],
	['financial_cost_events', 'cost_uid'],
	['expense_period_charges', 'source_cost_uid'],
] as const;

async function setIdentifierCollation(
	knex: Knex,
	collation: 'utf8mb4_general_ci' | 'utf8mb4_unicode_ci'
): Promise<void> {
	// Native source keys use general_ci. Shared references must use the same
	// collation so column-to-column joins work without query-specific coercion.
	for (const [table, column] of IDENTIFIER_COLUMNS) {
		await knex.raw(
			`ALTER TABLE ?? MODIFY ?? VARCHAR(64) CHARACTER SET utf8mb4 COLLATE ${collation} NOT NULL`,
			[table, column]
		);
	}
}

export async function up(knex: Knex): Promise<void> {
	await setIdentifierCollation(knex, 'utf8mb4_general_ci');
}

export async function down(knex: Knex): Promise<void> {
	await setIdentifierCollation(knex, 'utf8mb4_unicode_ci');
}
