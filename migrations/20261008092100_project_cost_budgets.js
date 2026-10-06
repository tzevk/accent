/**
 * Approved Project cost budgets (#321).
 *
 * A cost budget is its own record with its own identity and version history:
 * no Project commercial field (`projects.project_value`, `projects.cost_to_company`,
 * `projects.budget`, a quotation, or a purchase order) is read as a budget, and
 * no cost table gains a budget column. The comparison in the report joins the
 * approved budget to Incurred Project Cost only when Project, currency, scope,
 * and period all match.
 *
 * Column roles:
 *   budget_uid             stable identity of the budget, shared with its
 *                          append-only event history.
 *   project_id             the Project the approved cost budget belongs to.
 *   currency               the currency the amount is stated in. A budget is
 *                          never converted into another currency to force a
 *                          comparison.
 *   amount                 the approved cost budget, on the same basis as
 *                          Incurred Project Cost (non-recoverable tax included,
 *                          evidenced recoverable tax excluded).
 *   scope                  what the approved amount is a budget *of*.
 *                          `project_incurred_cost` is comparable with Incurred
 *                          Project Cost; `commercial_value` is recorded for
 *                          context and is never compared as a cost budget.
 *   period_start/_end      the period the approval covers. A budget only
 *                          compares with a month inside this period.
 *   state                  draft | submitted | approved | superseded |
 *                          withdrawn. Only `approved` is an approved budget;
 *                          approving a later overlapping budget supersedes the
 *                          earlier row without erasing it.
 *   approval_evidence_reference  the evidence the approval rests on. Approving
 *                          without evidence is refused, so an approved row
 *                          always carries one.
 *   financial_version      the version the next command must present. Every
 *                          change appends exactly one event.
 *
 * `project_cost_budget_events` is the append-only journal: one immutable row
 * per accepted command, keyed (budget_uid, version), carrying the actor,
 * reason, evidence reference, and the snapshot the command produced.
 *
 * Idempotent: both steps check for the table first, so a re-run is a no-op.
 */

const BUDGETS_TABLE = 'project_cost_budgets';
const EVENTS_TABLE = 'project_cost_budget_events';

export async function up(knex) {
	if (!(await knex.schema.hasTable(BUDGETS_TABLE))) {
		await knex.raw(`
      CREATE TABLE \`${BUDGETS_TABLE}\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`budget_uid\` varchar(64) NOT NULL,
        \`project_id\` int(11) NOT NULL,
        \`currency\` varchar(10) NOT NULL,
        \`amount\` decimal(15,2) NOT NULL,
        \`scope\` enum('project_incurred_cost','commercial_value') NOT NULL,
        \`period_start\` date NOT NULL,
        \`period_end\` date NOT NULL,
        \`basis_note\` varchar(500) DEFAULT NULL,
        \`state\` enum('draft','submitted','approved','superseded','withdrawn') NOT NULL DEFAULT 'draft',
        \`approval_evidence_reference\` varchar(500) DEFAULT NULL,
        \`approved_by\` int(11) DEFAULT NULL,
        \`approved_at\` datetime DEFAULT NULL,
        \`financial_version\` int(11) NOT NULL DEFAULT 1,
        \`created_by\` int(11) DEFAULT NULL,
        \`created_at\` datetime NOT NULL DEFAULT current_timestamp(),
        \`updated_at\` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        \`isDelete\` tinyint(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_project_cost_budgets_uid\` (\`budget_uid\`),
        KEY \`idx_project_cost_budgets_project\` (\`project_id\`, \`state\`, \`isDelete\`),
        KEY \`idx_project_cost_budgets_period\` (\`period_start\`, \`period_end\`),
        KEY \`idx_project_cost_budgets_state\` (\`state\`, \`isDelete\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
	}

	if (!(await knex.schema.hasTable(EVENTS_TABLE))) {
		await knex.raw(`
      CREATE TABLE \`${EVENTS_TABLE}\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`budget_uid\` varchar(64) NOT NULL,
        \`source_table\` varchar(64) NOT NULL DEFAULT 'project_cost_budgets',
        \`source_id\` int(11) NOT NULL,
        \`version\` int(11) NOT NULL,
        \`command\` enum('recorded','updated','submitted','approved','withdrawn','superseded') NOT NULL,
        \`actor_user_id\` int(11) DEFAULT NULL,
        \`reason\` varchar(500) DEFAULT NULL,
        \`evidence_reference\` varchar(500) DEFAULT NULL,
        \`snapshot\` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(\`snapshot\`)),
        \`created_at\` datetime NOT NULL DEFAULT current_timestamp(),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_project_cost_budget_events_version\` (\`budget_uid\`, \`version\`),
        KEY \`idx_project_cost_budget_events_source\` (\`source_table\`, \`source_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
	}
}

export async function down(knex) {
	await knex.raw(`DROP TABLE IF EXISTS \`${EVENTS_TABLE}\``);
	await knex.raw(`DROP TABLE IF EXISTS \`${BUDGETS_TABLE}\``);
}
