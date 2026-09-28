/**
 * Rate-limit buckets shared across app instances (ADR-0013).
 *
 * The in-memory limiter lives per instance, so an attacker could hop instances
 * to reset the budget on the two brute-forceable categories (`auth`, `heavy`).
 * Those two now count here as fixed windows: one row per
 * (bucket_key, window_start), the limiter upserts `count = count + 1`, and the
 * proxy's existing cleanup sweep deletes rows older than 2x the largest window.
 *
 * Operational table, not domain data — no isDelete column and no readers other
 * than the proxy pool (src/utils/rate-limit-store.js).
 */

export async function up(knex) {
	await knex.raw(`
    CREATE TABLE \`rate_limit_buckets\` (
      \`bucket_key\` VARCHAR(191) NOT NULL COMMENT 'clientIp:sha256(session token)|anon:category',
      \`window_start\` BIGINT NOT NULL COMMENT 'Window start in epoch ms, aligned to the window size',
      \`count\` INT NOT NULL DEFAULT 0,
      \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`uq_rate_limit_bucket\` (\`bucket_key\`, \`window_start\`),
      KEY \`idx_rate_limit_window_start\` (\`window_start\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function down(knex) {
	await knex.raw('DROP TABLE IF EXISTS `rate_limit_buckets`');
}
