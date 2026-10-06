# Company Project Expenditure — Implementation (tickets #306, #316)

## Overview

The report at `/reports/employee-project-monthly-cost` now leads with **Company
Incurred Cost** for a month, reconciled to **Incurred Project Cost**, **Company
Overhead**, and **Unallocated Cost**. Each underlying direct cost is counted
once. The employee-cost Monthly and Financial Year views stay available beside
it until recorded payroll replaces their estimate (#307).

Ticket #306 delivers the first complete slice: capture a direct expense with a
durable identity, recognize it into a month, reconcile it, and drill from a
Project into its source records. Everything else the parent specification
describes is named as coverage, not faked.

Ticket #321 adds the **approved Project cost budget** beside that
reconciliation: an authorized workflow records, submits, approves, supersedes,
and withdraws a Project cost budget, and the report compares it with Incurred
Project Cost only when Project, currency, scope, and period match. A budget is
never a cost: it appears in its own section and never changes Company Incurred
Cost, the Project breakdown, or the evidence summary.

## Architecture

```
Expenditure view (page.tsx → expenditure-view.tsx → budget-section.tsx)
  ├─ GET  /api/reports/employee-project-monthly-cost?view=expenditure&month=YYYY-MM[&project_id=]
  ├─ GET  /api/reports/employee-project-monthly-cost/expenses?month=&state=&classification=&project_id=
  ├─ POST /api/admin/expenses                        (record a cost)
  ├─ POST /api/admin/expenses/{id}/commands          (submit | recognize | reject | cancel | update)
  ├─ GET  /api/admin/cost-budgets?project_id=        (budget versions of one Project)
  ├─ GET  /api/admin/cost-budgets/{id}               (one budget + its approval journal)
  ├─ POST /api/admin/cost-budgets                    (record a draft budget)
  └─ POST /api/admin/cost-budgets/{id}/commands      (update | submit | approve | withdraw)
            │
            ▼
  src/lib/company-expenditure  (the shared financial module)
    index.ts             public interface
    recognition.ts       pure rules: period, tax, recognition blockers, transitions
    reconciliation.ts    pure builder: groups, currencies, projects, evidence, coverage
    records.ts           reads: month records, project cost, options, months, journal, drilldown
    commands.ts          the single write path: recordCost, executeCommand, journal
    budget-records.ts    reads: budget rows, covering budgets, journal
    budget-commands.ts   the budget write path: recordCostBudget, executeBudgetCommand
    budget-comparison.ts pure builder: the isolated budget section
    coverage.ts          which sources feed the module and which do not
            │
            ▼
  expenses (+ cost_uid, recognition_*, financial_version)
  financial_cost_events (append-only command journal)
  project_cost_budgets (+ scope, period, state, approval evidence, financial_version)
  project_cost_budget_events (append-only approval journal)
```

The module is the only place that reads or writes recognized cost or an
approved budget. Screens, routes, and (later) the Excel export call its public
interface; none of them reimplements a period, tax, currency, or budget rule.

## Data model

`expenses` (extended by `migrations/20261006120000_expense_cost_recognition.js`):

| Column                                       | Meaning                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `cost_uid`                                   | Stable identity of the underlying cost, minted once at capture            |
| `cost_classification`                        | `project` / `company_overhead` / `unallocated`; NULL = not yet classified |
| `recognition_state`                          | `draft` / `pending_evidence` / `recognized` / `rejected` / `cancelled`    |
| `recognition_period`, `period_basis`         | The recognised month and how it was established                           |
| `service_period_start`, `service_period_end` | Received-work period evidence                                             |
| `tax_treatment`, `tax_evidence_reference`    | none / recoverable / non_recoverable / unresolved, with its evidence      |
| `recognized_amount`                          | Cost after evidenced recoverable tax; NULL means no confirmed cost        |
| `source_reference`, `evidence_reference`     | Original document and supporting evidence                                 |
| `financial_version`                          | Version the next command must present                                     |
| `recognized_by`, `recognized_at`             | Who confirmed the cost and when                                           |
| `amount`, `tax_amount`, `total_amount`       | Base, tax, and gross liability — now NULLable, so missing is not zero     |

`status` keeps its register meaning and is **not** the recognition state: a row
approved in the expense register is not confirmed cost until it is recognized.

`financial_cost_events` is append-only: one row per accepted command, keyed
`(cost_uid, version)`, with actor, reason, evidence reference, and the financial
snapshot the command produced. It is the audit trail the drilldown and the
later revision slice read.

## Recognition rules (pure, `recognition.ts`)

- **Period**: service period start → its month (`service_period`); an end
  recorded without a start → the end month (`service_period_end`, disclosed by
  the basis, the `service_period_start_missing` exception, and a coverage
  notice); else the bill date → its month (`bill_date_fallback`); else no
  period, and the cost cannot be recognized. Order and payment dates never set
  the period. A service period that spans months is attributed to the month it
  starts in and reported with a `service_period_spans_months` notice until
  period splitting lands.
- **Amount**: NULL gross is missing, not zero. A missing amount blocks
  recognition; a recorded `0.00` is a known zero and does count, as zero.
- **Tax**: recoverable tax is deducted only with a recorded evidence reference;
  a recoverable claim without evidence stays at gross and raises
  `tax_evidence_missing`. `unresolved` keeps the gross liability as cost and is
  published as unresolved tax. `non_recoverable` stays in cost. Gross liability
  is always preserved in `total_amount`.
- **Recognition blockers**: gross amount, classification, project (for a Project
  classification), recognition period, and currency. The command reports exactly
  which are missing.

## Command contract

```
POST /api/admin/expenses/{id}/commands
{ "command": "submit|recognize|reject|cancel|update",
  "expected_version": 3,
  "reason": "…", "evidence_reference": "…", "patch": { … } }
```

| Outcome                        | Status | Code                                                    |
| ------------------------------ | ------ | ------------------------------------------------------- |
| Applied                        | 200    | `{ data: { recognition_state, financial_version, … } }` |
| Stale version                  | 409    | `version_conflict` (with `current_version`)             |
| State forbids command          | 422    | `command_not_allowed`                                   |
| Not ready to recognize         | 422    | `not_ready_for_recognition` (with `missing: [...]`)     |
| Reject/cancel without a reason | 422    | `reason_required`                                       |
| Missing privilege              | 403    | —                                                       |
| Not found                      | 404    | `not_found`                                             |

Recognize, reject, and cancel need `other_expenses:approve`; submit and update
need `other_expenses:update`. Editing or soft-deleting a recognized row through
the register is refused with `409 cost_recognized`, and the register edit path
refuses the versioned financial fields (`expense_date`, `amount`, `tax_amount`,
`total_amount`, `currency`, `project_id`) with `422
financial_fields_versioned` for every state: those fields change only through
the `update` command, with the version and journal entry it carries. The
register stays the place for operational fields (vendor, payment, description,
notes, category, its own `status`).

The command names are the imperative API vocabulary (`update`, `submit`,
`recognize`, `reject`, `cancel`); `financial_cost_events.command` is an ENUM of
the past-tense journal vocabulary (`recorded`, `updated`, `submitted`,
`recognized`, `rejected`, `cancelled`). `writeJournal` is the one place that
translates between them — writing the raw command name would be truncated
under `STRICT_TRANS_TABLES` and roll the transaction back.

The report's recognition queue carries the correction control for open cost:
`Edit` opens the cost's financial fields and saves an `update` command with the
version the queue read, so a pending-evidence record with an unknown amount can
be completed (amount, destination, period, tax, evidence) and then recognized
instead of being cancelled and re-recorded.

## Report contract

`GET /api/reports/employee-project-monthly-cost?view=expenditure&month=YYYY-MM[&project_id=]`
returns `company` (currency, incurred cost, per-currency subtotals — each with
its own incurred cost, gross liability, recoverable tax, and unresolved-tax
gross — the three groups, gross liability, recoverable tax, unresolved tax,
known zeros), the Project breakdown with change against the previous month, the
evidence summary, the coverage notices, the Project options for the entry
control, and the months that carry cost. The Project filter narrows `projects`,
never `company`.

Currency rules are absolute, including the breakdown a reader uses to explain
the month: a Project with cost in two currencies gets one row per currency
(`currency` on the row), and its prior-month comparison is same-currency only.
In a month holding more than one currency `company.incurred_cost`,
`company.gross_liability`, `company.recoverable_tax`, and
`company.unresolved_tax.gross_amount` are `null` — the per-currency
`currency_totals` carry the figures — and an evidence-state subtotal
(`evidence.*.amount`, `evidence.unresolved_classification.gross_amount`) is
`null` when its records span currencies. A subtotal is also `null` whenever a
contributing record's amount is unknown: `null` means "not stated", never a
zero substituted for an unknown, and `evidence.missing_amount.count` still
discloses how many records that is.

`GET …/expenses?month=&state=&classification=&project_id=&limit=&offset=`
returns the records behind those figures with identity, period, currency, tax
treatment, `recognized_amount`, `financial_version`, and the exception codes
that explain any non-clean amount. `limit` (1–200) and `offset` (≥0) are
validated like the other query parameters — a malformed value is a `400`, never
a `500` from the SQL layer — and `totals.confirmed_amount` is `null` when the
filtered confirmed records are unknown or span currencies (`totals.currency`
names the single currency when there is one).

The Excel download keeps exporting the employee-cost views; the reconciliation
export belongs to the export slice, and the view therefore offers no download
button yet.

## Approved cost budget (#321)

`project_cost_budgets` (`migrations/20261008092100_project_cost_budgets.js`) is
its own record; no Project commercial field is ever read as a budget:

| Column                          | Meaning                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `budget_uid`                    | Stable identity, shared with the approval journal                              |
| `project_id`                    | The Project the approved cost budget belongs to                                 |
| `currency`                      | The currency the amount is stated in — never converted for a comparison        |
| `amount`                        | The approved amount, on the same basis as Incurred Project Cost                |
| `scope`                         | `project_incurred_cost` (comparable) or `commercial_value` (context, never compared) |
| `period_start`, `period_end`    | The period the approval covers                                                  |
| `state`                         | `draft` / `submitted` / `approved` / `superseded` / `withdrawn`                |
| `approval_evidence_reference`   | The evidence the approval rests on; approval without it is refused              |
| `approved_by`, `approved_at`    | Who approved the version and when                                              |
| `financial_version`             | Version the next command must present                                          |

`projects.project_value`, `projects.cost_to_company`, `projects.budget`,
quotations, and purchase orders are commercial context: none of them becomes a
cost budget, and a Project with no recorded budget reports `missing` instead of
a guessed figure.

**Comparison rules.** `budget-comparison.ts` builds `budgets` inside the
reconciliation payload. A row is `compared` (with `variance` = approved budget
− confirmed Incurred Project Cost) only when one approved budget matches the
Project, the row's currency, the `project_incurred_cost` scope, and the month
inside its period. Everything else is stated explicitly, never guessed:

| Outcome                     | The reader is told                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `missing`                   | No budget recorded for this Project and currency                                    |
| `unapproved`                | A covering budget exists but is not approved yet                                    |
| `incompatible_currency`     | Only an approved budget in another currency exists — no conversion is invented       |
| `incompatible_scope`        | The approved record declares a commercial value, not a cost budget                   |
| `incompatible_period`       | The approved budget covers another period                                            |
| `ambiguous`                 | More than one approved matching budget — none is picked                              |
| `unsupported_incurred_cost` | An approved budget matches but no confirmed cost is recorded yet                     |
| `no_incurred_cost`          | An approved covering budget exists with no Project cost row in the month             |

The candidate closest to comparable is chosen by a fixed precedence (covers the
month, then scope, then currency, then approval), so a covering draft is stated
as `unapproved` rather than hidden behind an approved budget for another
period. `budgets.notices` summarises every outcome, and the
`budget_variance_not_profit` notice states that remaining budget is not profit,
recognized revenue, or a forecast of uncommitted work.

**Workflow and history.** Recording a budget stores a `draft` (version 1) and
appends `recorded`. `update` (draft/submitted only), `submit`, `approve`, and
`withdraw` are versioned commands: a stale version is refused `409
stale_version`, a disallowed transition `409 invalid_transition`, an approval
without evidence `422 approval_evidence_required`, and a withdrawal without a
reason `422 reason_required`. Approving a later budget that overlaps an earlier
approved budget of the same Project, currency, and scope marks the earlier row
`superseded` and appends `superseded` — its amount, approval evidence, version,
and journal stay readable, which is what a later closed-period review reads.
Both tables follow the same rules as the cost tables: no deletes through the
API, one journal row per accepted command, and commands join the caller's
transaction when a connection is supplied.

## Coverage: what the total does not include

`SOURCE_COVERAGE` declares each source and its state; the not-incorporated
entries become coverage notices on every reconciliation:

- recorded payroll employer cost — a later slice (#307);
- supplier invoices, orders, and Outstanding Supplier Commitment;
- evidenced Cost Accruals;
- dated outward settlements and advances — petty-cash funding and spending are
  incorporated separately (below).

Month-specific notices add: no recognized cost, mixed currencies without
conversion, records awaiting recognition, missing amounts, unresolved
classification, unresolved tax, tax evidence missing, service periods that
span months, service periods whose start is not recorded, petty-cash spending
overspent against its funding, petty-cash spending awaiting recognition,
petty-cash spending with no voucher linkage, and receipts linked to a cost that
is not recognized. An empty month is a coverage warning, never a zero company
cost.

## Petty cash funding and spending (ticket #316)

`petty_cash_expenses` holds two kinds of row, split by `entry_kind`:

| Row                | Meaning                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `funding`          | Cash into the float: one cash voucher and its mirrored credit, one funding event            |
| `spend`            | Actual spending: one cost-bearing row with identity, period, approval, and destination      |

Financial columns added by
`migrations/20261008091600_petty_cash_funding_spending.js`: `entry_kind`,
`cost_uid` (a cost identity for spending, a funding-event identity for the
mirror), `numeric_id` (the journal's source key), `cost_classification`,
`project_id`, `recognition_state`, `recognition_period`, `period_basis`,
`service_period_start/end`, `currency`, `tax_amount`, `tax_treatment`,
`tax_evidence_reference`, `recognized_amount`, `recognized_by/at`,
`source_reference`, `evidence_reference`, `linked_cost_uid`,
`financial_version`, and the conversion evidence
(`reporting_currency`, `conversion_rate`, `conversion_date`,
`conversion_evidence_reference`, `converted_amount`) — the same vocabulary as
`expenses`, so one set of recognition rules serves both.

Rules:

- **Funding is one event and never cost.** `ensureFundingMirror` inserts the
  mirrored credit with the voucher, and updating the voucher updates that same
  row (`fund-<voucherId>`, unique) instead of adding another. Both rows carry
  `role='funding'` / `role='mirror'` links in `financial_cost_links` and are
  never registered as a cost. An empty voucher total creates no funding event.
- **Spending is captured with reliable references.** A voucher reference must
  exist; a Project is a real `project_id` (classification `project` requires
  it, Company Overhead and Unallocated must not carry one); the Recognition
  Period follows the service period, else the bill date as a disclosed
  fallback; the voucher's free-text `project_number` is never read as
  identity. A spend with no classification stays unresolved and cannot be
  recognized.
- **A receipt linked to another cost settles it.** `linked_cost_uid` is
  resolved through `resolveCostReference` (#311 contract) at capture and at
  every command; an unresolvable link is refused and a resolvable one is
  registered as `role='settlement'`, counts no new cost, and never registers
  its own cost identity.
- **Controlled lifecycle.** `POST /api/admin/petty-cash-expenses/{id}/commands`
  carries `expected_version` (`update | submit | recognize | reject | cancel`),
  increments `financial_version`, and appends one `financial_cost_events` row
  (`source_table='petty_cash_expenses'`). Recognize needs
  `petty_cash_expenses:approve`, submit/update need `petty_cash_expenses:update`.
  Confirmed spending is refused `409 cost_recognized` for register edits and
  deletes; financial fields are refused `422 financial_fields_versioned`;
  funding rows refuse edits with `409 funding_event_managed_by_voucher`; a
  voucher cannot be reduced below the spending drawn from it
  (`409 funding_below_spend`) or deleted while it funds spending
  (`409 voucher_has_spending`). A cancelled spend keeps its row, journal, and
  recognized amount as history.
- **The report states the four figures separately.** Every reconciliation
  gains `petty_cash`: funding, spending, settled spending, unconfirmed
  spending, remaining supported funding, and recognized cost, per currency
  (combined only in a single-currency month). Recognized petty-cash cost flows
  into the company groups and Project rows like any other cost source; funding
  and remaining funding never do. The petty-cash register page
  (`/admin/petty-cash-expenses`) shows the same four figures and drives the
  entry, approval, and command controls.
- **Conversion evidence follows the shared contract (#319).** Spending captures
  `reporting_currency`, `conversion_rate`, `conversion_date`, and
  `conversion_evidence_reference` through the same `resolveConversion`
  validation (full triple or none; a partial triple is
  `422 conversion_evidence_incomplete`, an invalid rate
  `422 invalid_conversion_rate`), and the module recomputes `converted_amount`
  from the recognized amount on every financial write through
  `convertToReporting` — one conversion site, no source-side rounding. The
  register PUT refuses the fields; only the versioned `update` command changes
  them. A NULL original currency is unknown, never INR: such rows are excluded
  from every currency subtotal and disclosed as
  `petty_cash.unknown_currency.count`.

## Authorization

| Surface                                        | Privilege                                                     |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Reconciliation, drilldown, expenditure months  | `reports:read` **and** `other_expenses:read` (or super admin) |
| Employee-cost views and their export           | `reports:read`                                                |
| Record a cost (report control and admin route) | `other_expenses:create`                                       |
| Submit / update a cost                         | `other_expenses:update`                                       |
| Recognize, reject, cancel                      | `other_expenses:approve`                                      |
| Petty-cash register: read                      | `petty_cash_expenses:read`                                    |
| Record / edit petty-cash spending              | `petty_cash_expenses:create` / `:update`                      |
| Recognize, reject, cancel petty-cash spending  | `petty_cash_expenses:approve`                                 |
| Delete draft petty-cash spending               | `petty_cash_expenses:delete`                                  |
| Cash vouchers (funding)                        | super admin or `admin` role (unchanged)                       |
| Read cost budgets and their journals           | `other_expenses:read`                                         |
| Record, edit, submit, withdraw a cost budget   | `other_expenses:update`                                       |
| Approve a cost budget                          | `other_expenses:approve`                                      |

The direct-expense ledger is the source of the expenditure reconciliation, so
report access alone does not open it: the expenditure view, the drilldown, and
the `expenditure_months` list in the meta payload require the ledger's read
privilege as well (parent spec §149 — existing source authorization and
financial privileges). A `reports:read` reader without it keeps the
employee-cost views and is refused `403` with no source rows or aggregates. The
Project Activity field grant opens none of this, and Employee Utilization is
untouched.

## End-to-end evidence

`e2e/specs/expense-reconciliation.spec.ts` drives the real app and writes
`e2e/artifacts/expense-reconciliation.json`. It seeds two Projects and sixteen
direct costs in `E2E-EXP-P*` / `E2E-EXP-*` (fixtures in
`e2e/lib/expenditure-fixtures.ts`, purged and reseeded by `e2e/global-setup.ts`),
plus a real `reports:read`-only reader identity, then asserts, from hand-computed
fixture amounts:
- every recognized cost appears once in its group and the groups equal the
  company total;
- drafts, pending evidence, rejected, cancelled, unresolved, and missing amounts
  stay out of confirmed cost, while a known zero is recorded as zero; an
  evidence-state subtotal with an unknown amount is `null`, not the known total;
- the Project filter narrows detail but not the company reconciliation;
- currencies stay separate with no combined total anywhere: a Project costing in
  two currencies gets one row per currency with a same-currency prior-month
  comparison, gross liability and recoverable tax are per-currency subtotals,
  and the company-level figures are null;
- coverage names the sources and evidence gaps;
- a cost recorded and recognized through the API, and another through the
  browser form and the recognition queue, land in their service month once, with
  version 2 in the row and two journal entries, the second named in the journal
  vocabulary (`recognized`);
- a service period with only its end recorded uses that end month with
  `service_period_end` and the `service_period_start_missing` disclosure;
- a pending cost with no amount is corrected through the report's edit control
  (one `updated` journal entry), then recognized (version 3), while a register
  PUT carrying financial fields is refused `422 financial_fields_versioned` and
  changes nothing;
- malformed `limit`/`offset` are `400`s, not SQL failures;
- a stale version is refused and changes nothing;
- an unauthorized session gets 403 on reads and writes, and a `reports:read`
  reader with no expense-source read gets 403 on the expenditure reconciliation
  and drilldown with no sensitive payload and no `expenditure_months`, while the
  employee-cost views still answer;
- the browser shows the access panel to an employee session.

`e2e/specs/petty-cash-funding.spec.ts` drives the petty-cash slice and writes
`e2e/artifacts/petty-cash-funding.json` (fixtures in
`e2e/lib/petty-cash-fixtures.ts`, namespace `E2E-EXP-316-*`, months 2019-06 and
2019-08). From hand-computed fixture amounts it asserts:

- a voucher and its mirrored credit are one funding event: exactly one mirror
  row, the funding-event identity, `funding`/`mirror` links and **no** cost
  link, no new expense row, and `funding` stated separately from a company cost
  that does not move; a repeated voucher write updates the same mirror;
- spending recorded through the register controls carries its identity,
  evidence, recognition period, Project reference, and voucher link; the
  register's Recognize control moves it to recognized cost once (version 2,
  journal `recorded` → `recognized`) and the register and report state funding,
  spending, remaining funding, and recognized cost separately;
- missing linkage stays unresolved: a spend with no classification cannot be
  recognized (`422 not_ready_for_recognition`), an unallocated but voucher-less
  spend is still cost, the voucher's free-text project number never becomes a
  Project attribution, and the coverage notices say so;
- a receipt linked to an existing recognized cost settles it: a
  `role='settlement'` link and no cost identity of its own, no second expense,
  an unchanged company total, zero unresolved settlements, and a refused
  `422 unknown_source_reference` for a link that does not resolve;
- a later-month spend lands only in its own period; a register PUT of
  financial fields is `422 financial_fields_versioned`; a draft delete is a
  soft delete; confirmed spending is frozen (`409 cost_recognized`); a voucher
  edit updates the one funding row and never spending; funding below spending
  is `409 funding_below_spend`; a voucher with spending is `409
  voucher_has_spending`; a voucher with no spending deletes with its mirror;
- stale commands are `409 version_conflict`, reject/cancel demand a reason, and
  a cancelled spend keeps its row, recognized amount, and journal history;
- the petty-cash clerk can record but is refused recognition (`403`), and a
  user with no petty-cash privilege is refused `403` for reads and writes with
  nothing persisted.
`e2e/specs/project-cost-budgets.spec.ts` (#321) drives the same real app and
writes `e2e/artifacts/project-cost-budgets.json`. It extends the same fixture
module (budget namespace `e2e-budget-*`, a third Project `E2E-EXP-P3`, four
May-2019 costs, seven seeded budgets) and asserts, from the fixture literals:

- an approved budget covering January compares with alpha's 3,500 INR as
  `compared` (5,000 − 3,500 = 1,500 remaining), while a Project with no budget
  is `missing`;
- currency, scope, period, ambiguity, and un-supported-cost outcomes are each
  stated explicitly — a February USD budget compares only with the USD row, a
  commercial-value record never becomes a cost budget, an approved budget for an
  earlier period does not compare with May, a pending-only cost states
  `unsupported_incurred_cost` instead of comparing with a guessed zero, and two
  matching approved budgets state `ambiguous`;
- the browser records, submits, and approves a budget through the report's own
  controls, with the approval evidence the control requires, and the report then
  compares it (5,000 − 1,200 = 3,800) with version 3 and three journal entries in
  the row and in MySQL;
- a stale version is refused `409 stale_version` and changes nothing; approving a
  superseding version marks the earlier row `superseded` (version 4, evidence
  preserved, `superseded` journal entry naming the replacement) while both
  versions stay readable;
- an employee session and a `reports:read` reader without the ledger's read
  privilege get `403` on budget reads and writes and no sensitive payload, and no
  row or version changes;
- January still reconciles to the expense fixtures' own arithmetic after every
  budget mutation: a budget never moves Company Incurred Cost.

Use an isolated database for repeatable verification:

```powershell
npx cross-env E2E_DB_NAME=accent_crm_dev_muse_e2e_expenditure npm run e2e
```

For the ticket slices, select `expense-reconciliation.spec.ts`,
`payroll-bonus.spec.ts`, and `petty-cash-funding.spec.ts` after the production
build. Fixture cleanup derives SQL
placeholders from its owned Employee codes, so added Employees remain rerun-safe.
The payroll snapshot evidence includes the stored month and money columns.
Namespaced fixtures identify test records; names alone do not exclude them from
the current report. Keep this verification database separate from business data.

## Currency conversion (ticket #319)

Implemented in `currency.ts`; the full consumer contract is published outside
the repo at `C:/Files/OCDSE/Work/expenditure-currency-contract.md`.

- The report read states its basis: `reporting_currency` on the HTTP request
  (default INR), echoed as `company.reporting_currency`. Only matching stored
  evidence is used — the original currency equals the requested basis, or the
  stored target equals it and the full rate triple exists; no inverse or
  cross-rate is derived.
- `expenses.reporting_currency`, `conversion_rate`, `conversion_date`,
  `conversion_evidence_reference`, and `converted_amount` come from
  `migrations/20261008091900_expense_cost_currency_conversion.js`. The rate is
  kept as its decimal string (DECIMAL(20,10) exceeds a JS number); conversion
  runs per record, round-half-up to cents, in a high-precision Decimal clone.
- A NULL `expenses.currency` is unknown — never INR — and is excluded from
  every currency subtotal as `original_currency_missing`. Missing or partial
  evidence is `conversion_evidence_missing` / `conversion_rate_invalid`.
- `company.currency` / `incurred_cost` / `groups` state one complete total
  (reporting currency once every confirmed record is supported; the single
  original currency when it has no conversion evidence), and `null` when
  currencies cannot be combined. Slice, project, and journal figures carry the
  same interpretation; `converted_amount` and the journal snapshot preserve the
  rate and converted figure for a later close snapshot.
- Entry captures the triple through the report's Record cost form; afterwards
  only the versioned `update` command may change it, and that patch requires
  `other_expenses:approve`. The register PUT refuses the fields.

## Public interface for later slices

`src/lib/company-expenditure/index.ts` is the contract later tickets extend:

- **#307 recorded payroll**: add `payroll_slips` + allocation as a source
  adapter that produces `CostRecord`s into the same `buildReconciliation`; the
  employee-cost views then become consumers of recorded cost.
- **Supplier cost and commitments**: one adapter per store, `cost_uid` mapped
  through the source-identity table, commitment consumption as its own section.
- **Cost Accruals**: the accrual is another cost identity whose replacement
  invoice supersedes it in the same chain; the journal already carries versions.
- **Financial close and revisions**: period state hangs off `recognition_period`
  and `financial_version`; commands already accept the caller's transaction, so
  a close check commits with the change.
- **Currency**: implemented by #319 (`currency.ts`, `reporting_currency` +
  `conversion_rate`/`conversion_date`/`conversion_evidence_reference`, per-record
  rounding, requested-basis report input).
- **Export**: consume `fetchCompanyReconciliation` and `fetchCostDrilldown`, so
  the download cannot disagree with the screen.

## Files

- `migrations/20261006120000_expense_cost_recognition.js`
- `migrations/20261007120000_expense_cost_period_basis_service_period_end.js`
  (extends `period_basis` for the disclosed partial service period)
- `migrations/20261008091100_expense_supplier_invoice_recognition.js`
  (shared cost identity/link seam, #311 dependency)
- `migrations/20261008091600_petty_cash_funding_spending.js` (petty-cash
  funding/spending split and financial columns, #316)
- `src/lib/company-expenditure/{index,types,recognition,reconciliation,records,commands,coverage,errors,fields,journal,sources}.ts`
- `src/lib/company-expenditure/petty-cash.ts` (petty-cash source: funding
  mirror, spending capture, versioned commands, summary)
- `migrations/20261008091900_expense_cost_currency_conversion.js`
  (reporting target + conversion evidence + converted snapshot, #319)
- `migrations/20261008092100_project_cost_budgets.js` (#321: budgets + approval journal)
- `src/lib/company-expenditure/{index,types,currency,recognition,reconciliation,records,commands,coverage,budget-records,budget-commands,budget-comparison}.ts`
- `src/app/api/reports/employee-project-monthly-cost/route.ts` (expenditure view, meta months, tightened gate)
- `src/app/api/reports/employee-project-monthly-cost/expenses/route.ts`
- `src/app/api/reports/employee-project-monthly-cost/download/route.ts` (tightened gate)
- `src/app/api/admin/expenses/route.js` (entry through the module)
- `src/app/api/admin/expenses/[id]/commands/route.ts`
- `src/app/api/admin/expenses/[id]/route.js` (recognized cost frozen; versioned financial fields refused)
- `src/app/api/admin/petty-cash-expenses/route.ts` (spending entry through the
  module; funding/spending/remaining/recognized summary)
- `src/app/api/admin/petty-cash-expenses/[id]/route.ts` (funding rows and
  confirmed spending frozen; versioned financial fields refused)
- `src/app/api/admin/petty-cash-expenses/[id]/commands/route.ts` (versioned
  petty-cash commands)
- `src/app/api/admin/cash-vouchers/{route.js,[id]/route.js}` (one funding
  mirror per voucher; funding floor; delete guards)
- `src/app/reports/employee-project-monthly-cost/{page,expenditure-view}.tsx`
- `src/app/admin/petty-cash-expenses/page.tsx` (register controls)
- `src/lib/format.js` (`formatCurrencyIn`)
- `src/components/Navbar.jsx` (financial gate)
- `docs/adr/0018-direct-cost-recognition-and-versioned-commands.md`
- `e2e/lib/expenditure-fixtures.ts`, `e2e/specs/expense-reconciliation.spec.ts`, `e2e/global-setup.ts`
- `e2e/lib/petty-cash-fixtures.ts`, `e2e/specs/petty-cash-funding.spec.ts`
- `src/app/api/admin/cost-budgets/route.ts`, `.../[id]/route.ts`, `.../[id]/commands/route.ts` (#321)
- `src/app/reports/employee-project-monthly-cost/{page,expenditure-view,budget-section}.tsx`
- `src/lib/format.js` (`formatCurrencyIn`)
- `src/components/Navbar.jsx` (financial gate)
- `docs/adr/0018-direct-cost-recognition-and-versioned-commands.md`
- `docs/adr/0019-approved-cost-budgets.md` (#321)
- `docs/adr/0020-petty-cash-funding-and-spending.md` (#316)
- `e2e/lib/expenditure-fixtures.ts`, `e2e/specs/expense-reconciliation.spec.ts`, `e2e/specs/project-cost-budgets.spec.ts`, `e2e/global-setup.ts`
- `e2e/lib/expenditure-currency-fixtures.ts`, `e2e/specs/expenditure-currency.spec.ts` (#319)
