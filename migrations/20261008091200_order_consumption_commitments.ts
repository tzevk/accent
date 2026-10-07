import type { Knex } from 'knex';

/**
 * Supplier commitment consumption (ticket #312) — the durable link from a
 * recognized supplier cost to the canonical supplier order it consumes.
 *
 * `order_consumptions` is keyed by `orders.order_uid` plus the cost's
 * `cost_uid` and the cost's Recognition Period; a text PO number is never
 * identity. One row is one consumed native slice:
 *   - `active_key` is a stored generated column (`1` while active, NULL when
 *     released) and `UNIQUE (cost_uid, recognized_period, active_key)` is the
 *     global active source-slice backstop: one native slice is consumed into
 *     exactly one order, so two competing orders can never consume the same
 *     slice, even partially or concurrently. A released row frees its slice
 *     for a later re-record (release + re-record is the only correction path;
 *     there is no in-place amount edit).
 *   - `source_version` records the authoritative source row's
 *     `financial_version` at record time; the command locks the order row and
 *     the source row and refuses a stale or no-longer-recognized source
 *     before any write.
 *   - `amount` is stated on the order's `tax_basis` (gross or net) and its
 *     `currency`; the native amount comes from the source's frozen slices,
 *     never from the request.
 *
 * `order_consumption_events` is the append-only per-row journal
 * (`recorded` / `released`), UNIQUE `(consumption_id, version)`. The shared
 * `financial_cost_events` journal is keyed `(cost_uid, version)` and a
 * consumption never mutates the cost row, so keying it there would misstate
 * the cost's own version sequence.
 *
 * Identifier columns carry the collation of the column each one joins,
 * decided per reference: `order_uid` columns use `utf8mb4_unicode_ci`
 * to match `orders.order_uid` (the `orders` table default, migration
 * 20261008091000), and `cost_uid` columns use `utf8mb4_general_ci`
 * to match the shared financial cost identity
 * (`financial_cost_links.cost_uid`, `financial_cost_events.cost_uid`,
 * migration 20261009000000). Column-to-column joins then need no
 * query-specific coercion.
 *
 * Idempotent: every step checks information_schema first.
 */

export async function up(knex: Knex): Promise<void> {
	const hasTable = async (table: string): Promise<boolean> => {
		const [rows] = (await knex.raw(
			`SELECT 1 FROM information_schema.tables
			  WHERE table_schema = DATABASE() AND table_name = ?
			  LIMIT 1`,
			[table]
		)) as unknown as [Array<Record<string, unknown>>, unknown];
		return rows.length > 0;
	};

	if (!(await hasTable('order_consumptions'))) {
		await knex.raw(`
CREATE TABLE \`order_consumptions\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`order_uid\` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  \`cost_uid\` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  \`cost_source\` varchar(32) NOT NULL,
  \`source\` enum('invoice','accrual') NOT NULL DEFAULT 'invoice',
  \`amount\` decimal(15,2) NOT NULL,
  \`tax_basis\` enum('gross','net') NOT NULL,
  \`currency\` char(3) NOT NULL,
  \`recognized_period\` date NOT NULL COMMENT 'First day of the consumed month',
  \`source_version\` int(11) NOT NULL COMMENT 'Source financial_version at record time',
  \`state\` enum('active','released') NOT NULL DEFAULT 'active',
  \`version\` int(11) NOT NULL DEFAULT 1,
  \`actor_id\` int(11) DEFAULT NULL,
  \`reason\` varchar(500) DEFAULT NULL,
  \`evidence_reference\` varchar(500) DEFAULT NULL,
  \`released_at\` timestamp NULL DEFAULT NULL,
  \`released_by\` int(11) DEFAULT NULL,
  \`release_reason\` varchar(500) DEFAULT NULL,
  \`release_evidence_reference\` varchar(500) DEFAULT NULL,
  \`created_at\` timestamp NULL DEFAULT current_timestamp(),
  \`updated_at\` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  \`active_key\` tinyint(4) GENERATED ALWAYS AS (if((\`state\` = 'active'),1,NULL)) STORED,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`unique_consumption_slice_active\` (\`cost_uid\`,\`recognized_period\`,\`active_key\`),
  KEY \`idx_consumption_order\` (\`order_uid\`),
  KEY \`idx_consumption_cost\` (\`cost_uid\`),
  KEY \`idx_consumption_period\` (\`recognized_period\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`);
	}

	if (!(await hasTable('order_consumption_events'))) {
		await knex.raw(`
CREATE TABLE \`order_consumption_events\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`consumption_id\` int(11) NOT NULL,
  \`order_uid\` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  \`cost_uid\` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  \`event\` enum('recorded','released') NOT NULL,
  \`version\` int(11) NOT NULL,
  \`amount\` decimal(15,2) NOT NULL,
  \`tax_basis\` enum('gross','net') NOT NULL,
  \`currency\` char(3) NOT NULL,
  \`recognized_period\` date NOT NULL,
  \`actor_user_id\` int(11) DEFAULT NULL,
  \`reason\` varchar(500) DEFAULT NULL,
  \`evidence_reference\` varchar(500) DEFAULT NULL,
  \`snapshot\` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(\`snapshot\`)),
  \`created_at\` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`unique_consumption_event_version\` (\`consumption_id\`,\`version\`),
  KEY \`idx_consumption_event_order\` (\`order_uid\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`);
	}
}

export async function down(knex: Knex): Promise<void> {
	await knex.raw('DROP TABLE IF EXISTS `order_consumption_events`');
	await knex.raw('DROP TABLE IF EXISTS `order_consumptions`');
}
