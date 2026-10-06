# Company Project Expenditure — Implementation (tickets #306, #317, #321)

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

`GET /api/reports/employee-project-monthly-cost?view=expenditure&month=YYYY-MM[&project_id=][&as_of=YYYY-MM-DD]`
returns `company` (currency, incurred cost, per-currency subtotals — each with
its own incurred cost, gross liability, recoverable tax, and unresolved-tax
gross — the three groups, gross liability, recoverable tax, unresolved tax,
known zeros), the Project breakdown with its comparable-period comparison, the
evidence summary, the coverage notices, the Project options for the entry
control, and the months that carry cost. The Project filter narrows `projects`,
never `company`.

`as_of` identifies the comparable period: the date inside the reported month
the month is measured to. It defaults to today, so a past month is compared in
full and the current month over its elapsed days. A date that is not a real
calendar date is `400 invalid_as_of`; one outside the reported month is
`400 as_of_outside_month`.

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

## Comparable period, ranking, and cost to date (ticket #320)

`src/lib/company-expenditure/ranking.ts` is the pure interpretation behind the
report's period navigation, both orderings, and the cost-to-date column; the
route, the drilldown, and the export must read it rather than re-deriving it.

- **Window.** `comparisonWindow(month, asOf)` decides how much of the reported
  month has elapsed. A month measured before its last day is unfinished: both
  periods are then compared over their first `currentDays` days, the prior
  window is clamped to the prior month's own length, and a clamped window is
  disclosed as `unequal_window_length`. A month measured after its last day is
  compared whole (`full_month_comparison`): the prior window is the whole prior
  month however many days it holds, so June (30 days) against May (31 days)
  includes 31 May.
- **Day rule.** A cost sits in the window when the day of its received-work
  evidence starts on or before the window's last day (`service_period_start`,
  else `service_period_end`, else the disclosed bill date). A confirmed cost
  with no day at all is only covered by a full month, and the window counts it
  as `undated_records` / `undated_period_evidence` instead of spreading it.
- **Categories.** Each currency's window carries `groups` — Incurred Project
  Cost, Company Overhead, Unallocated Cost — counted once from the window's own
  records, so the reader sees which direct-cost category moved the comparison;
  the three group amounts sum to the window's company figure.
- **Change.** Rows and the company carry the absolute change, a percentage
  stated only for a known non-zero prior amount, and a state: a recorded zero
  prior is `new` (absolute change, no percentage), and a Project with no prior
  record at all is `no_prior` with both figures `null` — absence of records is
  never read as zero cost.
- **Ranking.** `ranking.by_cost` and `ranking.by_increase` order the same rows
  inside one currency; ties share a position, and a row whose comparison amount
  is unknown is listed in `ranking.increase_unranked` with its reason instead
  of being placed by a guess.
- **Cost to date.** `cost_to_date` accumulates confirmed cost of every month
  before the reported one plus the reported window, so it is stated through
  `comparison.cost_to_date_through`. A `null` means a contributing amount was
  unknown, not zero.
- **Evidence.** Every row carries `evidence` (state plus findings):
  `recorded`, `estimated` (cost recorded but not confirmed), `reconstructed`
  (a source module marked it so; none does yet), or `incomplete` (an unknown
  amount, an unresolved tax treatment, or a period that is only a bill date or
  a period end).
- **Filtering.** `filtered_subtotal` is the filtered Project detail's own
  subtotal. `company`, `comparison`, and `ranking` are company-wide and are
  never narrowed by `project_id`.

`e2e/specs/project-cost-ranking.spec.ts` drives the real app over the `#320`
fixture block (Projects `E2E-EXP-P320A…F`, months 2022-05/2022-06 measured to
2022-06-15, plus boundary rows: a 31 May cost, a January 2026 cost, and a
2021-08/2021-09 pair that spans currencies) and writes
`e2e/artifacts/project-cost-ranking.json`: it asserts the equal-period window
and that a fully elapsed month keeps the prior month's last day in its rows,
its change figures, and its increase ordering, both orderings, the zero-prior
and unknown-prior states, cost to date, late/backdated/unequal-coverage
disclosure, the unfiltered company position and the published-row scope behind
a Project filter (including #321's budget section), the 400/403 refusals, and
the browser flow: month and financial-year navigation (into an empty month and
never into a future one), a currency-split comparison stated per currency
rather than as unknown, the ranking switch, drilldown into recognized and
unresolved evidence, and a cost entered, submitted, recognized, and re-ranked
through the real controls. The spec refuses to run against any of its months
holding cost outside its own namespace.

## Approved cost budget (#321)

`project_cost_budgets` (`migrations/20261008092100_project_cost_budgets.js`) is
its own record; no Project commercial field is ever read as a budget:

| Column                        | Meaning                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `budget_uid`                  | Stable identity, shared with the approval journal                                    |
| `project_id`                  | The Project the approved cost budget belongs to                                      |
| `currency`                    | The currency the amount is stated in — never converted for a comparison              |
| `amount`                      | The approved amount, on the same basis as Incurred Project Cost                      |
| `scope`                       | `project_incurred_cost` (comparable) or `commercial_value` (context, never compared) |
| `period_start`, `period_end`  | The period the approval covers                                                       |
| `state`                       | `draft` / `submitted` / `approved` / `superseded` / `withdrawn`                      |
| `approval_evidence_reference` | The evidence the approval rests on; approval without it is refused                   |
| `approved_by`, `approved_at`  | Who approved the version and when                                                    |
| `financial_version`           | Version the next command must present                                                |

`projects.project_value`, `projects.cost_to_company`, `projects.budget`,
quotations, and purchase orders are commercial context: none of them becomes a
cost budget, and a Project with no recorded budget reports `missing` instead of
a guessed figure.

**Comparison rules.** `budget-comparison.ts` builds `budgets` inside the
reconciliation payload. A row is `compared` (with `variance` = approved budget
− confirmed Incurred Project Cost) only when one approved budget matches the
Project, the row's currency, the `project_incurred_cost` scope, and the period —
**exactly the selected month**. A budget whose period is a year, a quarter, or a
mid-month span states another period's cost too, so it is disclosed as an
incompatible period and never allocated proportionally; a single month is the
only period whose whole approved amount is that month's cost. The month's cost
must also be supported: a confirmed operating record, a supported approved
period charge (`period_charge_count`, #317), or any other integrated source.
An unconfirmed month is never treated as a supported zero. Everything else is
stated explicitly, never guessed:

| Outcome                     | The reader is told                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `missing`                   | No budget recorded for this Project and currency                                    |
| `unapproved`                | A same-currency, same-scope budget for this month exists but is not approved yet    |
| `incompatible_currency`     | Only an approved budget in another currency exists — no conversion is invented      |
| `incompatible_scope`        | The approved record declares a commercial value, not a cost budget                  |
| `incompatible_period`       | The approved budget's period is not this month (annual or partial: no allocation)   |
| `ambiguous`                 | More than one approved budget matches — none is picked                              |
| `unsupported_incurred_cost` | An approved budget matches but no cost is confirmed yet (no direct cost, no charge) |
| `no_incurred_cost`          | An approved budget exists with no Project cost row in the month                     |

The candidate closest to comparable is chosen inside the row's own currency
first — a comparison exists only in one currency — and then by a fixed
precedence (exactly this month, then scope, then approval). A draft of this
month is therefore stated as `unapproved` rather than hidden behind an approved
budget for another period, a same-currency record with a commercial scope is
stated as `incompatible_scope`, and a foreign-currency budget is stated as
`incompatible_currency` only when nothing of the row's currency exists.
`budgets.notices` summarises every outcome, and the
`budget_variance_not_profit` notice states that remaining budget is not profit,
recognized revenue, or a forecast of uncommitted work.

**Workflow and history.** Recording a budget stores a `draft` (version 1) and
appends `recorded`. `update` (draft/submitted only), `submit`, `approve`, and
`withdraw` are versioned commands: a stale version is refused `409
stale_version`, a disallowed transition `409 invalid_transition`, an approval
without evidence `422 approval_evidence_required`, and a withdrawal without a
reason `422 reason_required`. Drafting, submitting, and withdrawing a draft or
submitted budget need `other_expenses:update`; approving needs
`other_expenses:approve`, and so does withdrawing an _approved_ budget, because
that removes the basis the report was comparing with (`403
approval_privilege_required`, refused inside the transaction under the row
lock). Every command takes the Project's row lock before the budget row, so two
approvals of overlapping periods serialize on the Project: the second supersedes
the first instead of both staying approved, and a repeated or stale command
still changes nothing. Approving a later budget that overlaps an earlier
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
- dated settlements and petty cash.

Month-specific notices add: no recognized cost, mixed currencies without
conversion, records awaiting recognition, missing amounts, unresolved
classification, unresolved tax, tax evidence missing, service periods that
span months, and service periods whose start is not recorded. An empty month is
a coverage warning, never a zero company cost.

## Authorization

| Surface                                            | Privilege                                                     |
| -------------------------------------------------- | ------------------------------------------------------------- |
| Reconciliation, drilldown, expenditure months      | `reports:read` **and** `other_expenses:read` (or super admin) |
| Employee-cost views and their export               | `reports:read`                                                |
| Record a cost (report control and admin route)     | `other_expenses:create`                                       |
| Submit / update a cost                             | `other_expenses:update`                                       |
| Recognize, reject, cancel                          | `other_expenses:approve`                                      |
| Read cost budgets and their journals               | `other_expenses:read`                                         |
| Record, edit, submit, withdraw a cost budget       | `other_expenses:update`                                       |
| Approve a cost budget, or withdraw an approved one | `other_expenses:approve`                                      |

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

`e2e/specs/project-cost-budgets.spec.ts` (#321) drives the same real app and
writes `e2e/artifacts/project-cost-budgets.json`. It extends the same fixture
module (budget namespace `e2e-budget-*`, a third and fourth Project
`E2E-EXP-P3`/`P4`, June-2019 costs, eleven seeded budgets, and the August
charge-only month owned by #317) and asserts, from the fixture literals:

- an approved budget whose period is exactly January compares with alpha's
  3,500 INR as `compared` (5,000 − 3,500 = 1,500 remaining), while a Project with
  no budget is `missing` and February's INR row states the January budget's
  period as `incompatible_period` instead of stretching it over another month;
- currency, scope, period, ambiguity, and unsupported-cost outcomes are each
  stated explicitly — a February USD budget compares only with the USD row, a
  commercial-value record never becomes a cost budget, an annual budget and a
  mid-May-to-mid-June budget stay visible as `incompatible_period` with a null
  variance and no proportional allocation, a pending-only cost states
  `unsupported_incurred_cost` instead of comparing with a guessed zero, a
  Project whose only approved budget is in another currency states
  `incompatible_currency`, and two matching approved budgets state `ambiguous`;
- an August month whose Project cost comes entirely from supported approved
  period charges (#317) compares with an exact August budget and publishes the
  over-budget variance — charge-only cost is confirmed cost, not an unconfirmed
  zero, and no annual budget is allocated to that month;
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

For the two initial slices, select `expense-reconciliation.spec.ts` and
`payroll-bonus.spec.ts` after the production build; `expense-non-operating.spec.ts`
adds the non-operating balances and their approved consumption (#317). Fixture cleanup derives SQL
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
- A rate is evidence for one currency pair: changing `currency` or
  `reporting_currency` never inherits the stored triple. The command needs the
  full fresh evidence for a new convertible pair (`conversion_evidence_required`)
  and the report's edit dialog clears the old evidence when the pair changes, so
  a stale rate cannot be re-associated with a new currency or silently reprice
  the figures. Pair changes are approval-gated like other conversion patches.
- The drilldown carries the same selected basis as the report
  (`reporting_currency` on the expenses route), and each record's
  `conversion_status` is computed in it; status, badge, and figures therefore
  always describe the same basis. The leading total names the basis it is
  actually stated in (the native single-currency total when no combined total
  exists).

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
- `migrations/20261008091900_expense_cost_currency_conversion.js`
  (reporting target + conversion evidence + converted snapshot, #319)
- `migrations/20261008092100_project_cost_budgets.js` (#321: budgets + approval journal)
- `src/lib/company-expenditure/{index,types,recognition,reconciliation,records,commands,coverage}.ts`
- `src/lib/company-expenditure/{ranking,totals}.ts` (comparable period, both
  orderings, cost to date, per-Project evidence; shared money subtotals)
- `src/lib/company-expenditure/{budget-records,budget-commands,budget-comparison}.ts` (#321)
- `src/lib/company-expenditure/currency.ts` (#319: reporting basis + conversion evidence)
- `src/app/api/reports/employee-project-monthly-cost/route.ts` (expenditure view, meta months, tightened gate)
- `src/app/api/reports/employee-project-monthly-cost/expenses/route.ts`
- `src/app/api/reports/employee-project-monthly-cost/download/route.ts` (tightened gate)
- `src/app/api/admin/expenses/route.js` (entry through the module)
- `src/app/api/admin/expenses/[id]/commands/route.ts`
- `src/app/api/admin/expenses/[id]/route.js` (recognized cost frozen; versioned financial fields refused)
- `src/app/api/admin/cost-budgets/route.ts`, `.../[id]/route.ts`, `.../[id]/commands/route.ts` (#321)
- `src/app/reports/employee-project-monthly-cost/{page,expenditure-view,budget-section}.tsx`
- `src/lib/format.js` (`formatCurrencyIn`)
- `src/components/Navbar.jsx` (financial gate)
- `docs/adr/0018-direct-cost-recognition-and-versioned-commands.md`
- `e2e/lib/expenditure-fixtures.ts`, `e2e/specs/expense-reconciliation.spec.ts`, `e2e/global-setup.ts`
- `e2e/specs/project-cost-ranking.spec.ts` (ranking, comparable period, cost to
  date; artifact `e2e/artifacts/project-cost-ranking.json`)
- `docs/adr/0019-approved-cost-budgets.md` (#321)
- `e2e/specs/project-cost-budgets.spec.ts` (#321)
- `e2e/lib/expenditure-currency-fixtures.ts`, `e2e/specs/expenditure-currency.spec.ts` (#319)

## Ticket #317 — non-operating items and approved period consumption

An advance, deposit, prepayment, or capital purchase is a **balance**, not an
expense: its payment or invoice must never enter Company Incurred Cost as the
full amount of the month it was paid. The spend is classified by its nature
(`expenses.cost_nature`), recorded with its own identity, amount,
currency/tax basis, and evidence, and only **approved period consumption,
depreciation, or amortization** becomes cost — in the charge's own month, with
the source's destination and currency. There is no fixed-asset register, no
statutory depreciation engine, and no automatic capitalization: an operator (or
an import) states each charge with evidence, and the module only accepts or
refuses it.

### Data model

| Object                         | Meaning                                                                                                                                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expenses.cost_nature`         | `operating` (default, and what every pre-#317 row was), `advance`, `deposit`, `prepayment`, `capital`, or `unresolved`. Independent of `cost_classification`.                                                                                      |
| `expense_period_charges`       | One approved (or cancelled) charge: `charge_uid`, `(source_table, source_id, source_cost_uid)`, `charge_period`, `basis`, `amount`, `currency`, `evidence_reference`, `state`, `financial_version`, `sequence`, approver/time, cancel reason/time. |
| `expense_period_charge_events` | Append-only approval journal, one row per accepted command, keyed `(charge_uid, version)`; `approved` then `cancelled`.                                                                                                                            |

`(source_cost_uid, charge_period, basis, sequence)` is unique: a month and basis
for one source holds one approved charge, and re-entry after a cancellation
takes the next sequence while both rows stay as history. Because a capture locks
its source row (`SELECT … FOR UPDATE`), two concurrent captures serialize and
the second is refused as a duplicate rather than double-writing.

### Rules (`non-operating.ts`, pure)

- A charge needs a supported balance: its source must already be **confirmed
  cost** (that act establishes the balance) and its nature must be
  `advance`/`deposit`/`prepayment`/`capital`.
- Amount, evidence reference, and the source's currency are required; a month
  that is not `YYYY-MM` is refused.
- One approved charge per source/month/basis (`duplicate_period_charge`), and
  the approved charges may never exceed the source's confirmed balance
  (`exceeds_source_balance`, with the remaining amount in the response).
- Cancelling is reasoned, versioned, and restores the balance; a cancelled
  charge is never counted and never reduces the remaining amount.
- A missing balance is unknown, not zero: an unconfirmed item states
  `remaining_amount: null`.

### Report and source detail

`CompanyReconciliation.non_operating` carries the section: per item its identity
(`cost_uid`, expense number, source/evidence reference), nature, destination,
state, currency, gross amount, supported balance, consumption this month and to
date, remaining amount, and its charges; plus `excluded_source_amount`,
`consumed_this_month`, `consumed_to_date`, `remaining_amount`,
`unapproved_count`, `unresolved_count`, `unresolved_source_amount`, and
`charges_from_prior_items` (charges of the month whose balance was recognized in
an earlier month). Only `operating` records are cost: a recognized non-operating
item is excluded from `company.incurred_cost` and appears in
`evidence.non_operating_recognized`; an `unresolved`-nature record is excluded
and appears in `evidence.unresolved_nature` with the
`nature_unresolved_treatment` notice. Approved charges are counted in
`currency_totals[].period_charge_amount` / `period_charge_count`, in
`projects[].period_charge_count`, and in `evidence.period_charges`. Coverage
notices add `non_operating_items_separate`, `period_charges_counted`,
`nature_unresolved_treatment`, `non_operating_item_not_approved`, and
`period_charge_source_not_recognized`.

`GET …/expenses` gains `nature=all|operating|non_operating|advance|deposit|prepayment|capital|unresolved`,
returns each expense with `cost_nature`, returns the month's
`period_charges` (approved and cancelled, so history stays visible), and
splits `totals` into `confirmed_amount` (operating cost only),
`non_operating_amount`, `nature_unresolved_amount`,
`period_charge_amount`, and `period_charge_records`.

A Project row's cost is confirmed cost for the budget comparison even when it
comes entirely from approved period charges: the comparison counts
`record_count + period_charge_count` (publishing `period_charges` per row), so
a charge-only month states a variance against a matching-month approved budget
instead of `unsupported_incurred_cost`; a month with neither still states
`unsupported_incurred_cost`, and an annual/partial budget stays
`incompatible_period`. A charge is stated in the reporting basis through its
source's conversion evidence (`source_reporting_currency`,
`source_conversion_rate`, `source_conversion_date`,
`source_conversion_evidence_reference` on the charge), never by converting
independently; `company.conversion` counts `converted_charges` /
`unsupported_charges` beside the record figures.

### Command contract

```
POST /api/admin/expenses/{id}/charges
{ "period": "2019-08", "basis": "consumption|depreciation|amortization",
  "amount": 20000, "evidence_reference": "…", "currency": "INR", "reason": "…" }

POST /api/admin/expenses/{id}/charges/{chargeUid}
{ "command": "cancel", "expected_version": 1, "reason": "…" }
```

| Outcome                          | Status | Code                                                 |
| -------------------------------- | ------ | ---------------------------------------------------- |
| Approved / cancelled             | 200    | `{ data: PeriodChargeJson }`                         |
| Source not confirmed cost        | 409    | `source_not_recognized`                              |
| Same month and basis approved    | 409    | `duplicate_period_charge`                            |
| Stale charge version             | 409    | `version_conflict` (with `current_version`)          |
| Operating nature                 | 422    | `nature_not_non_operating`                           |
| Charge over the remaining amount | 422    | `exceeds_source_balance` (with `remaining_amount`)   |
| Missing amount / evidence        | 422    | `invalid_charge_amount` / `charge_evidence_required` |
| Currency not the source's        | 422    | `charge_currency_mismatch`                           |
| Bad month / basis                | 422    | `invalid_charge_period` / `invalid_charge_basis`     |
| Missing privilege                | 403    | —                                                    |

Both routes need `other_expenses:approve`: a period charge is an approval.
`cost_nature` is a versioned financial field, so the register `PUT` refuses it
with `422 financial_fields_versioned` and it changes only through the `update`
command (`patch.nature`). The report's non-operating section carries the
controls: **Capture period charge** on each confirmed item (month, basis,
amount, evidence, note) and **Cancel charge** on each approved charge, with the
dialog surfacing the module's refusal verbatim.

### End-to-end evidence (#317)

`e2e/specs/expense-non-operating.spec.ts` drives the real app and writes
`e2e/artifacts/expense-non-operating.json`. Its fixtures extend
`e2e/lib/expenditure-fixtures.ts` in the same namespace — an advance, a deposit,
a prepayment (consumed across two periods), a capital item with evidenced
recoverable tax, an operating cost, an unresolved-treatment record, and an
unapproved advance, recognized in 2019-07 with charges in 2019-08/2019-09 and
ad-hoc charges in 2019-06 (never another spec's months). It asserts, from
hand-computed fixture amounts:

- the July balances are excluded from Company Incurred Cost and shown
  separately with identity, evidence, consumed, and remaining amounts;
- the August charges are cost in August alone (advance consumption, prepayment
  consumption, capital depreciation) and the July month stays at zero cost;
- the prepayment's second period charge lands in September and reduces its
  remaining balance to zero; a cancelled deposit charge counts nowhere;
- a duplicate month/basis, an oversized charge, an operating source, an
  unapproved source, missing evidence/amount, a foreign currency, and a bad
  month are all refused with their exact codes and change nothing; a cancelled
  charge's period can be re-entered, and both rows keep their journal;
- the browser captures a charge (balance falls, its own month gains the cost)
  and cancels it (balance returns, version 2, journal `approved` → `cancelled`),
  and a duplicate attempt through the same control surfaces the refusal;
- recording an advance through the report form and recognizing it leaves the
  incurred-cost KPI unchanged until its charge is captured; the register refuses
  to reclassify its nature;
- an unresolved treatment stays visible and excluded, an unapproved item has no
  balance to consume, and an employee session or a `reports:read`-only reader
  gets 403 on the charge routes and the reconciliation with no sensitive payload.

### Files (#317)

- `migrations/20261008091700_expense_non_operating_charges.js`
- `src/lib/company-expenditure/non-operating.ts` (rules + charge JSON mapper)
- `src/lib/company-expenditure/charges.ts` (`capturePeriodCharge`, `cancelPeriodCharge`)
- `src/app/api/admin/expenses/[id]/charges/route.ts`,
  `src/app/api/admin/expenses/[id]/charges/[chargeUid]/route.ts`
- `e2e/specs/expense-non-operating.spec.ts`
