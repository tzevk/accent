import type { Knex } from 'knex';

/**
 * Ticket #369 — accountable Lead ownership and one canonical stage vocabulary.
 *
 * Schema:
 * - `leads.owner_user_id` NULL — stable owner reference (NULL = unassigned
 *   intake). No FK: user rows may be soft-deleted and the reference must stay
 *   readable; writers validate the target against active users instead.
 * - `leads.legacy_owner_name` / `leads.legacy_stage` — ORIGINAL RAW
 *   pre-migration values of `assigned_to` / `enquiry_status`, verbatim on
 *   every legacy row whether or not it resolved (empty becomes NULL).
 * - `leads.legacy_review_required` — true when the stage did not match the
 *   canonical vocabulary exactly or the owner name could not be resolved to
 *   exactly one active user. New rows default to false.
 * - `lead_ownership_history` — assignment audit (lead, prior owner, new owner,
 *   actor, time). All FKs are RESTRICT so history is never cascaded away or
 *   nulled out; leads/users soft-delete in normal operation. Migration writes
 *   NO rows: the historical actor/time is unknown and must not be fabricated.
 * Backfill (in order):
 * 1. Preserve evidence: copy RAW `assigned_to`/`enquiry_status` verbatim into
 *    the legacy columns (empty becomes NULL).
 * 2. Map owner_user_id only on unique exact full_name evidence: the trimmed
 *    name must match exactly one user eligible under the authentication
 *    active policy (is_active 1/NULL, status active/NULL, isDelete 0).
 *    Ambiguous ties and unknown names stay NULL with review flagged.
 * 3. Keep canonical stages exactly as stored; any other non-empty status
 *    becomes NULL (original kept in `legacy_stage` with review flagged).
 *    Known ambiguous rows ('Converted to Proposal', 'Awarded', 'Regretted',
 *    'Awaiting', 'Close', ...) are deliberately NOT mapped — in particular
 *    nothing is equated with Converted, and no canonical Proposal is chosen.
 *
 * Identities, related records, and soft-delete flags are untouched.
 * Idempotent: every step checks information_schema first, and steps 1–3 are
 * pure functions of the pre-migration columns so a re-run reproduces them.
 */

const CANONICAL_STAGES = [
	'New',
	'Attempting Contact',
	'Connected',
	'Qualified',
	'Nurture',
	'Disqualified',
	'Converted',
] as const;

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

export async function up(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, 'leads'))) return;

	if (!(await hasColumn(knex, 'leads', 'owner_user_id'))) {
		await knex.raw(
			`ALTER TABLE leads
        ADD COLUMN owner_user_id INT NULL DEFAULT NULL AFTER assigned_to`
		);
	}
	if (!(await hasColumn(knex, 'leads', 'legacy_owner_name'))) {
		await knex.raw(
			`ALTER TABLE leads
        ADD COLUMN legacy_owner_name TEXT NULL DEFAULT NULL AFTER owner_user_id`
		);
	}
	if (!(await hasColumn(knex, 'leads', 'legacy_stage'))) {
		await knex.raw(
			`ALTER TABLE leads
        ADD COLUMN legacy_stage TEXT NULL DEFAULT NULL AFTER legacy_owner_name`
		);
	}
	if (!(await hasColumn(knex, 'leads', 'legacy_review_required'))) {
		await knex.raw(
			`ALTER TABLE leads
        ADD COLUMN legacy_review_required TINYINT(1) NOT NULL DEFAULT 0 AFTER legacy_stage`
		);
	}
	if (!(await hasTable(knex, 'lead_ownership_history'))) {
		// Audit evidence: every FK is RESTRICT so deletes never cascade away
		// or null out assignment history. Leads and users soft-delete in
		// normal operation; hard deletes must resolve history explicitly.
		await knex.raw(`
      CREATE TABLE lead_ownership_history (
        id INT NOT NULL AUTO_INCREMENT,
        lead_id INT NOT NULL,
        prior_owner_user_id INT NULL DEFAULT NULL,
        owner_user_id INT NULL DEFAULT NULL,
        actor_user_id INT NULL DEFAULT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_lead_ownership_lead (lead_id),
        KEY idx_lead_ownership_owner (owner_user_id),
        CONSTRAINT fk_lead_ownership_lead FOREIGN KEY (lead_id)
          REFERENCES leads (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_lead_ownership_owner FOREIGN KEY (owner_user_id)
          REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_lead_ownership_prior FOREIGN KEY (prior_owner_user_id)
          REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_lead_ownership_actor FOREIGN KEY (actor_user_id)
          REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
	}
	// Index the owner reference for queue filters (idempotent: named check).
	const [indexRows] = (await knex.raw(
		`SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'leads'
        AND index_name = 'idx_leads_owner_user_id'
      LIMIT 1`
	)) as unknown as [unknown[], unknown];
	if ((indexRows as unknown[]).length === 0) {
		await knex.raw(
			`ALTER TABLE leads ADD INDEX idx_leads_owner_user_id (owner_user_id)`
		);
	}
	// Evidence preservation first: ORIGINAL RAW values, verbatim. TRIM is used
	// only to detect empty evidence (stored as NULL). The NULL guard keeps a
	// re-run from overwriting writers' later values.
	await knex.raw(`
    UPDATE leads
    SET legacy_owner_name = CASE
          WHEN assigned_to IS NULL OR TRIM(assigned_to) = '' THEN NULL
          ELSE assigned_to
        END,
        legacy_stage = CASE
          WHEN enquiry_status IS NULL OR TRIM(enquiry_status) = '' THEN NULL
          ELSE enquiry_status
        END
    WHERE legacy_owner_name IS NULL AND legacy_stage IS NULL
  `);
	// Unique exact active full-name match only (BINARY: even case must match).
	// Eligibility matches the authentication active policy: is_active 1/NULL,
	// status active/NULL, isDelete 0. Rows already carrying an owner (e.g.
	// migration re-run after writers were live) are left untouched.
	await knex.raw(`
    UPDATE leads l
    LEFT JOIN (
      SELECT full_name, MIN(id) AS user_id, COUNT(*) AS matches
      FROM users
      WHERE full_name IS NOT NULL
        AND TRIM(full_name) <> ''
        AND (is_active = 1 OR is_active IS NULL)
        AND (status = 'active' OR status IS NULL)
        AND isDelete = 0
      GROUP BY full_name
    ) u ON BINARY u.full_name = BINARY TRIM(l.assigned_to)
    SET l.owner_user_id = IF(u.matches = 1, u.user_id, NULL)
    WHERE l.owner_user_id IS NULL
      AND l.assigned_to IS NOT NULL
      AND TRIM(l.assigned_to) <> ''
  `);
	// Canonical stages stay exactly (BINARY: case must match); anything else
	// becomes unresolved while the original remains in legacy_stage. Empty
	// statuses resolve to NULL with no legacy evidence. Never guess a
	// conversion.
	await knex.raw(
		`UPDATE leads SET enquiry_status = NULL
      WHERE enquiry_status IS NOT NULL
        AND (
          TRIM(enquiry_status) = ''
          OR BINARY enquiry_status NOT IN (?, ?, ?, ?, ?, ?, ?)
        )`,
		[...CANONICAL_STAGES]
	);
	// Review flag: stage unresolved (but original evidence existed) OR owner
	// name evidence existed that did not resolve to exactly one active user.
	// Empty evidence means clean intake, not ambiguity — no review flag.
	await knex.raw(`
    UPDATE leads
    SET legacy_review_required = CASE
      WHEN legacy_stage IS NOT NULL AND enquiry_status IS NULL THEN 1
      WHEN legacy_owner_name IS NOT NULL AND owner_user_id IS NULL THEN 1
      ELSE 0
    END
  `);
}

export async function down(knex: Knex): Promise<void> {
	if (await hasTable(knex, 'lead_ownership_history')) {
		await knex.raw(`DROP TABLE lead_ownership_history`);
	}
	if (!(await hasTable(knex, 'leads'))) return;
	// Rollback restores unresolved stages from the ORIGINAL evidence before
	// dropping the evidence columns. Rows whose stage is still NULL and carry
	// legacy_stage get their original value back; rows edited to a canonical
	// stage since (or created new) are preserved untouched. Identities and
	// soft-delete flags are never touched by the restore.
	// enquiry_status is VARCHAR(50) while evidence is TEXT: rows whose raw
	// evidence cannot fit refuse the rollback with an actionable error rather
	// than silently truncating. The operator must export/resolve that evidence
	// first (e.g. shorten or clear the over-long legacy_stage values), then
	// re-run the rollback.
	if (
		(await hasColumn(knex, 'leads', 'enquiry_status')) &&
		(await hasColumn(knex, 'leads', 'legacy_stage'))
	) {
		const [oversize] = (await knex.raw(
			`SELECT COUNT(*) AS total FROM leads
        WHERE enquiry_status IS NULL
          AND legacy_stage IS NOT NULL
          AND CHAR_LENGTH(legacy_stage) > 50`
		)) as unknown as [{ total: number }[], unknown];
		if (Number(oversize[0]?.total ?? 0) > 0) {
			throw new Error(
				`Refusing migration rollback: ${String(oversize[0]?.total)} lead row(s) carry unresolved legacy_stage evidence longer than enquiry_status VARCHAR(50) can hold. Export or resolve the over-long evidence first, then re-run the rollback.`
			);
		}
		await knex.raw(`
      UPDATE leads
      SET enquiry_status = legacy_stage
      WHERE enquiry_status IS NULL AND legacy_stage IS NOT NULL
    `);
	}
	if (await hasColumn(knex, 'leads', 'legacy_review_required')) {
		await knex.raw(`ALTER TABLE leads DROP COLUMN legacy_review_required`);
	}
	if (await hasColumn(knex, 'leads', 'legacy_stage')) {
		await knex.raw(`ALTER TABLE leads DROP COLUMN legacy_stage`);
	}
	if (await hasColumn(knex, 'leads', 'legacy_owner_name')) {
		await knex.raw(`ALTER TABLE leads DROP COLUMN legacy_owner_name`);
	}
	if (await hasColumn(knex, 'leads', 'owner_user_id')) {
		const [indexRows] = (await knex.raw(
			`SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'leads'
          AND index_name = 'idx_leads_owner_user_id'
        LIMIT 1`
		)) as unknown as [unknown[], unknown];
		if ((indexRows as unknown[]).length > 0) {
			await knex.raw(`ALTER TABLE leads DROP INDEX idx_leads_owner_user_id`);
		}
		await knex.raw(`ALTER TABLE leads DROP COLUMN owner_user_id`);
	}
}
