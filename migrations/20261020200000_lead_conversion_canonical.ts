import type { Knex } from 'knex';

/**
 * Ticket #375 — the canonical Lead-to-Proposal linkage and the conversion
 * evidence.
 *
 * Schema:
 * - `proposals.canonical_lead_id` names the enquiry a Proposal is the
 *   canonical Proposal of. The unique index over that column is the
 *   database-enforced canonical linkage: at most one Proposal is canonical
 *   for an enquiry, and one Proposal belongs to one enquiry. Legacy rows
 *   keep NULL, so historical duplicates stay exactly as they are and
 *   several NULLs remain allowed.
 * - `leads.converted_at` and `leads.converted_by` record the conversion on
 *   the enquiry itself.
 * - `lead_conversions` is the conversion evidence: one row per conversion,
 *   naming the Lead, the Proposal, the author, and the time.
 *
 * The backfill copies the canonical choice the legacy review already made:
 * a Proposal that is still the canonical Proposal of its enquiry gets the
 * canonical lead id. Nothing is deleted, merged, or relinked, and no
 * Proposal is chosen for an enquiry that has no canonical choice.
 *
 * Idempotent: every step checks information_schema first, and the backfill
 * only fills the rows that have no canonical lead id yet.
 */

const CONVERSION_TABLE = 'lead_conversions';

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

async function hasConstraint(
	knex: Knex,
	table: string,
	constraint: string
): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE() AND table_name = ?
        AND constraint_name = ?
      LIMIT 1`,
		[table, constraint]
	);
	return rows.length > 0;
}

export async function up(knex: Knex): Promise<void> {
	if (!(await hasTable(knex, 'leads'))) return;
	if (!(await hasTable(knex, 'proposals'))) return;

	// 1. The canonical link of a Proposal.
	if (!(await hasColumn(knex, 'proposals', 'canonical_lead_id'))) {
		await knex.raw(
			`ALTER TABLE \`proposals\`
        ADD COLUMN canonical_lead_id INT NULL DEFAULT NULL`
		);
	}
	if (!(await hasIndex(knex, 'proposals', 'uk_proposals_canonical_lead'))) {
		await knex.raw(
			`ALTER TABLE \`proposals\`
        ADD UNIQUE KEY uk_proposals_canonical_lead (canonical_lead_id)`
		);
	}

	// 2. The conversion marks on the enquiry.
	if (!(await hasColumn(knex, 'leads', 'converted_at'))) {
		await knex.raw(
			`ALTER TABLE \`leads\`
        ADD COLUMN converted_at DATETIME NULL DEFAULT NULL`
		);
	}
	if (!(await hasColumn(knex, 'leads', 'converted_by'))) {
		await knex.raw(
			`ALTER TABLE \`leads\`
        ADD COLUMN converted_by INT NULL DEFAULT NULL`
		);
	}

	// 3. The backfill: the canonical Proposal of an enquiry is the one the
	//    legacy review already chose. An enquiry without a canonical choice
	//    keeps its Proposals untouched and unnamed.
	await knex.raw(`
    UPDATE \`proposals\` p
    JOIN \`leads\` l
      ON l.canonical_proposal_id = p.id
     AND p.lead_id = l.id
    SET p.canonical_lead_id = l.id
    WHERE p.canonical_lead_id IS NULL
      AND l.canonical_proposal_id IS NOT NULL
      AND (p.isDelete = 0 OR p.isDelete IS NULL)
      AND (l.isDelete = 0 OR l.isDelete IS NULL)
  `);

	// 4. The conversion evidence.
	if (!(await hasTable(knex, CONVERSION_TABLE))) {
		await knex.raw(`
      CREATE TABLE lead_conversions (
        id INT NOT NULL AUTO_INCREMENT,
        lead_id INT NOT NULL,
        proposal_id INT NOT NULL,
        converted_by INT NULL DEFAULT NULL,
        converted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_lead_conversions_lead (lead_id),
        KEY idx_lead_conversions_proposal (proposal_id),
        CONSTRAINT fk_lead_conversions_lead FOREIGN KEY (lead_id)
          REFERENCES leads (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_lead_conversions_proposal FOREIGN KEY (proposal_id)
          REFERENCES proposals (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_lead_conversions_actor FOREIGN KEY (converted_by)
          REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
	} else {
		if (!(await hasColumn(knex, CONVERSION_TABLE, 'converted_at'))) {
			await knex.raw(
				`ALTER TABLE \`lead_conversions\`
          ADD COLUMN converted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
			);
		}
		if (!(await hasColumn(knex, CONVERSION_TABLE, 'created_at'))) {
			await knex.raw(
				`ALTER TABLE \`lead_conversions\`
          ADD COLUMN created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP`
			);
		}
		if (
			!(await hasConstraint(knex, CONVERSION_TABLE, 'fk_lead_conversions_lead'))
		) {
			await knex.raw(
				`ALTER TABLE \`lead_conversions\`
          ADD CONSTRAINT fk_lead_conversions_lead FOREIGN KEY (lead_id)
            REFERENCES leads (id) ON DELETE RESTRICT ON UPDATE RESTRICT`
			);
		}
		if (
			!(await hasConstraint(
				knex,
				CONVERSION_TABLE,
				'fk_lead_conversions_proposal'
			))
		) {
			await knex.raw(
				`ALTER TABLE \`lead_conversions\`
          ADD CONSTRAINT fk_lead_conversions_proposal FOREIGN KEY (proposal_id)
            REFERENCES proposals (id) ON DELETE RESTRICT ON UPDATE RESTRICT`
			);
		}
		if (
			!(await hasConstraint(
				knex,
				CONVERSION_TABLE,
				'fk_lead_conversions_actor'
			))
		) {
			await knex.raw(
				`ALTER TABLE \`lead_conversions\`
          ADD CONSTRAINT fk_lead_conversions_actor FOREIGN KEY (converted_by)
            REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT`
			);
		}
	}
}

export async function down(knex: Knex): Promise<void> {
	if (await hasTable(knex, CONVERSION_TABLE)) {
		await knex.raw(`DROP TABLE \`${CONVERSION_TABLE}\``);
	}
	if (await hasTable(knex, 'proposals')) {
		if (await hasIndex(knex, 'proposals', 'uk_proposals_canonical_lead')) {
			await knex.raw(
				`ALTER TABLE \`proposals\`
          DROP INDEX uk_proposals_canonical_lead`
			);
		}
		if (await hasColumn(knex, 'proposals', 'canonical_lead_id')) {
			await knex.raw(`ALTER TABLE \`proposals\` DROP COLUMN canonical_lead_id`);
		}
	}
	if (await hasTable(knex, 'leads')) {
		if (await hasColumn(knex, 'leads', 'converted_at')) {
			await knex.raw(`ALTER TABLE \`leads\` DROP COLUMN converted_at`);
		}
		if (await hasColumn(knex, 'leads', 'converted_by')) {
			await knex.raw(`ALTER TABLE \`leads\` DROP COLUMN converted_by`);
		}
	}
}
