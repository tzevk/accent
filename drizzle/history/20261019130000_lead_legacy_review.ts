import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

/**
 * Ticket #370 — reviewable legacy Lead records: stages, owners, and
 * duplicate Proposal links.
 *
 * Schema:
 * - `leads.canonical_proposal_id` NULL — the one authoritative Proposal of the
 *   enquiry. Set by the cutover only when exactly one Proposal links to the
 *   Lead (evidence-backed), and by a reviewer when several link.
 * - `leads.legacy_proposal_conflict` — true when several Proposals link to
 *   the enquiry. The duplicates and their references stay in place; the flag
 *   only records that the situation needs a human decision.
 * - `leads.legacy_stage_reviewed` / `legacy_owner_reviewed` /
 *   `legacy_proposal_reviewed` — per-dimension review state. A reviewer may
 *   decide "no owner" without a user, so the state cannot be derived from
 *   the value columns alone.
 * - `lead_legacy_reviews` — append-only decision history. One row per
 *   decision: the original evidence, the selected resolution, the reason,
 *   the reviewer and the time. Automatic cutover decisions are recorded with
 *   `resolution_source = 'automatic'` and no reviewer.
 * - `lead_legacy_inventory` — what was actually stored before mapping, one
 *   row per distinct legacy value: how many Leads carry it and how it was
 *   classified (`auto_resolved`, `ambiguous`, `unresolved`).
 *
 * Cutover behaviour:
 * 1. Inventory the stored stage labels and owner names verbatim, together
 *   with their occurrence counts.
 * 2. Auto-resolve only what the evidence supports: a stage label that is
 *   already a canonical stage, an owner name that matches exactly one active
 *   user, and a Lead with exactly one linked Proposal. Everything else stays
 *   visibly unresolved.
 * 3. Never guess a canonical Proposal between duplicates, never map a label
 *   to Converted, and never delete or relink a historical Proposal.
 *
 * Identities, Proposal references, and soft-delete flags are untouched.
 * Idempotent: every step checks information_schema first, and the data steps
 * are pure functions of the current columns, so a re-run reproduces them
 * without overwriting a reviewer's decision.
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

async function hasTable(db: MigrationDb, table: string): Promise<boolean> {
	const [rows] = await executeMigrationSql(
		db,
		`SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?
      LIMIT 1`,
		[table]
	);
	return rows.length > 0;
}

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

export async function up(db: MigrationDb): Promise<void> {
	if (!(await hasTable(db, 'leads'))) return;

	if (!(await hasColumn(db, 'leads', 'canonical_proposal_id'))) {
		await executeMigrationSql(
			db,
			`ALTER TABLE leads
        ADD COLUMN canonical_proposal_id INT NULL DEFAULT NULL AFTER owner_user_id`
		);
	}
	if (!(await hasColumn(db, 'leads', 'legacy_proposal_conflict'))) {
		await executeMigrationSql(
			db,
			`ALTER TABLE leads
        ADD COLUMN legacy_proposal_conflict TINYINT(1) NOT NULL DEFAULT 0 AFTER legacy_review_required`
		);
	}
	if (!(await hasColumn(db, 'leads', 'legacy_stage_reviewed'))) {
		await executeMigrationSql(
			db,
			`ALTER TABLE leads
        ADD COLUMN legacy_stage_reviewed TINYINT(1) NOT NULL DEFAULT 0 AFTER legacy_proposal_conflict`
		);
	}
	if (!(await hasColumn(db, 'leads', 'legacy_owner_reviewed'))) {
		await executeMigrationSql(
			db,
			`ALTER TABLE leads
        ADD COLUMN legacy_owner_reviewed TINYINT(1) NOT NULL DEFAULT 0 AFTER legacy_stage_reviewed`
		);
	}
	if (!(await hasColumn(db, 'leads', 'legacy_proposal_reviewed'))) {
		await executeMigrationSql(
			db,
			`ALTER TABLE leads
        ADD COLUMN legacy_proposal_reviewed TINYINT(1) NOT NULL DEFAULT 0 AFTER legacy_owner_reviewed`
		);
	}
	if (!(await hasIndex(db, 'leads', 'idx_leads_canonical_proposal_id'))) {
		await executeMigrationSql(
			db,
			`ALTER TABLE leads ADD INDEX idx_leads_canonical_proposal_id (canonical_proposal_id)`
		);
	}

	if (!(await hasTable(db, 'lead_legacy_reviews'))) {
		// Decision history. Append-only: a later decision never rewrites an
		// earlier one. Every FK is RESTRICT so history is never cascaded away.
		await executeMigrationSql(
			db,
			`
      CREATE TABLE lead_legacy_reviews (
        id INT NOT NULL AUTO_INCREMENT,
        lead_id INT NOT NULL,
        review_type VARCHAR(32) NOT NULL,
        original_value TEXT NULL DEFAULT NULL,
        original_reference INT NULL DEFAULT NULL,
        resolved_value VARCHAR(255) NULL DEFAULT NULL,
        resolved_reference INT NULL DEFAULT NULL,
        reason TEXT NOT NULL,
        resolution_source VARCHAR(16) NOT NULL DEFAULT 'reviewer',
        reviewer_user_id INT NULL DEFAULT NULL,
        reviewer_name VARCHAR(255) NULL DEFAULT NULL,
        resolved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_lead_legacy_reviews_lead (lead_id),
        KEY idx_lead_legacy_reviews_type (lead_id, review_type),
        CONSTRAINT fk_lead_legacy_reviews_lead FOREIGN KEY (lead_id)
          REFERENCES leads (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_lead_legacy_reviews_reviewer FOREIGN KEY (reviewer_user_id)
          REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `
		);
	}

	if (!(await hasTable(db, 'lead_legacy_inventory'))) {
		// The stored-value inventory taken before mapping. value_key is a
		// digest of the verbatim value so arbitrarily long legacy text can
		// still carry a unique key.
		await executeMigrationSql(
			db,
			`
      CREATE TABLE lead_legacy_inventory (
        id INT NOT NULL AUTO_INCREMENT,
        value_kind VARCHAR(16) NOT NULL,
        value_key CHAR(32) NOT NULL,
        value_text TEXT NULL DEFAULT NULL,
        occurrence_count INT NOT NULL DEFAULT 0,
        resolution_state VARCHAR(24) NOT NULL,
        resolved_user_id INT NULL DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_lead_legacy_inventory_value (value_key),
        KEY idx_lead_legacy_inventory_kind (value_kind)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `
		);
	}

	// ---------------------------------------------------------------------
	// 1. Inventory the stored stage labels.
	// ---------------------------------------------------------------------
	await executeMigrationSql(
		db,
		`INSERT INTO lead_legacy_inventory
        (value_kind, value_key, value_text, occurrence_count, resolution_state)
      SELECT 'stage',
             MD5(CONCAT('stage:', legacy_stage)),
             legacy_stage,
             COUNT(*),
             CASE
               WHEN BINARY legacy_stage IN (?, ?, ?, ?, ?, ?, ?) THEN 'auto_resolved'
               ELSE 'unresolved'
             END
      FROM leads
      WHERE legacy_stage IS NOT NULL
      GROUP BY legacy_stage
      ON DUPLICATE KEY UPDATE
        value_text = VALUES(value_text),
        occurrence_count = VALUES(occurrence_count),
        resolution_state = VALUES(resolution_state)`,
		[...CANONICAL_STAGES]
	);

	// ---------------------------------------------------------------------
	// 2. Inventory the stored owner names. A name resolves only when it
	//    matches exactly one active user; a tie stays ambiguous and an
	//    unknown name stays unresolved. The name is never coerced.
	// ---------------------------------------------------------------------
	await executeMigrationSql(
		db,
		`
    INSERT INTO lead_legacy_inventory
      (value_kind, value_key, value_text, occurrence_count, resolution_state, resolved_user_id)
    SELECT 'owner',
           MD5(CONCAT('owner:', l.legacy_owner_name)),
           l.legacy_owner_name,
           COUNT(*),
           CASE
             WHEN u.matches = 1 THEN 'auto_resolved'
             WHEN u.matches > 1 THEN 'ambiguous'
             ELSE 'unresolved'
           END,
           CASE WHEN u.matches = 1 THEN u.user_id ELSE NULL END
    FROM leads l
    LEFT JOIN (
      SELECT full_name, MIN(id) AS user_id, COUNT(*) AS matches
      FROM users
      WHERE full_name IS NOT NULL
        AND TRIM(full_name) <> ''
        AND (is_active = 1 OR is_active IS NULL)
        AND (status = 'active' OR status IS NULL)
        AND isDelete = 0
      GROUP BY full_name
    ) u ON BINARY u.full_name = BINARY TRIM(l.legacy_owner_name)
    WHERE l.legacy_owner_name IS NOT NULL
    GROUP BY l.legacy_owner_name
    ON DUPLICATE KEY UPDATE
      value_text = VALUES(value_text),
      occurrence_count = VALUES(occurrence_count),
      resolution_state = VALUES(resolution_state),
      resolved_user_id = VALUES(resolved_user_id)
  `
	);

	// ---------------------------------------------------------------------
	// 3. Proposal link inventory. Exactly one linked Proposal is
	//    evidence-backed and becomes the canonical one. Several Proposals
	//    stay linked and stay flagged: the duplicates and their references
	//    are preserved, and the choice is left to a reviewer.
	// ---------------------------------------------------------------------
	if (await hasTable(db, 'proposals')) {
		await executeMigrationSql(
			db,
			`
      UPDATE leads l
      SET l.legacy_proposal_conflict = 1
      WHERE l.legacy_proposal_conflict = 0
        AND (
          SELECT COUNT(*)
          FROM proposals p
          WHERE p.lead_id = l.id
            AND (p.isDelete = 0 OR p.isDelete IS NULL)
        ) > 1
    `
		);
		await executeMigrationSql(
			db,
			`
      UPDATE leads l
      SET l.canonical_proposal_id = (
        SELECT MIN(p.id)
        FROM proposals p
        WHERE p.lead_id = l.id
          AND (p.isDelete = 0 OR p.isDelete IS NULL)
      )
      WHERE l.canonical_proposal_id IS NULL
        AND (
          SELECT COUNT(*)
          FROM proposals p
          WHERE p.lead_id = l.id
            AND (p.isDelete = 0 OR p.isDelete IS NULL)
        ) = 1
    `
		);
		// Record the automatic decision so the cutover is auditable. The
		// Proposal and its reference stay exactly as they are.
		await executeMigrationSql(
			db,
			`
      INSERT INTO lead_legacy_reviews
        (lead_id, review_type, original_value, resolved_value, resolved_reference,
         reason, resolution_source, reviewer_user_id, resolved_at)
      SELECT l.id,
             'proposal_link',
             CAST((
               SELECT GROUP_CONCAT(p.id ORDER BY p.id SEPARATOR ', ')
               FROM proposals p
               WHERE p.lead_id = l.id
                 AND (p.isDelete = 0 OR p.isDelete IS NULL)
             ) AS CHAR),
             CAST(l.canonical_proposal_id AS CHAR),
             l.canonical_proposal_id,
             'Automatic cutover resolution: exactly one Proposal linked this enquiry.',
             'automatic',
             NULL,
             NOW()
      FROM leads l
      WHERE l.canonical_proposal_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM lead_legacy_reviews r
          WHERE r.lead_id = l.id
            AND r.review_type = 'proposal_link'
        )
    `
		);
	}

	// ---------------------------------------------------------------------
	// 4. Recompute the aggregate review flag from the current facts. A
	//    dimension is open while the legacy evidence exists, the Lead has no
	//    value for it, and no reviewer decided it.
	// ---------------------------------------------------------------------
	await executeMigrationSql(
		db,
		`
    UPDATE leads
    SET legacy_review_required = CASE
      WHEN (
        (legacy_stage IS NOT NULL AND enquiry_status IS NULL AND legacy_stage_reviewed = 0)
        OR (legacy_owner_name IS NOT NULL AND owner_user_id IS NULL AND legacy_owner_reviewed = 0)
        OR (legacy_proposal_conflict = 1 AND canonical_proposal_id IS NULL AND legacy_proposal_reviewed = 0)
      ) THEN 1
      ELSE 0
    END
  `
	);
}
