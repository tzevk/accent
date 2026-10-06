# Company Project Expenditure — Implementation (ticket #306)

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

## Architecture

```
Expenditure view (page.tsx → expenditure-view.tsx)
  ├─ GET  /api/reports/employee-project-monthly-cost?view=expenditure&month=YYYY-MM[&project_id=]
  ├─ GET  /api/reports/employee-project-monthly-cost/expenses?month=&state=&classification=&project_id=
  ├─ POST /api/admin/expenses                        (record a cost)
  └─ POST /api/admin/expenses/{id}/commands          (submit | recognize | reject | cancel | update)
            │
            ▼
  src/lib/company-expenditure  (the shared financial module)
    index.ts         public interface
    recognition.ts   pure rules: period, tax, recognition blockers, transitions
    reconciliation.ts pure builder: groups, currencies, projects, evidence, coverage
    records.ts       reads: month records, project cost, options, months, journal, drilldown
    commands.ts      the single write path: recordCost, executeCommand, journal
    coverage.ts      which sources feed the module and which do not
            │
            ▼
  expenses (+ cost_uid, recognition_*, financial_version)
  financial_cost_events (append-only command journal)
```

The module is the only place that reads or writes recognized cost. Screens,
routes, and (later) the Excel export call its public interface; none of them
reimplements a period, tax, or currency rule.

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
  compared whole (`full_month_comparison`).
- **Day rule.** A cost sits in the window when the day of its received-work
  evidence starts on or before the window's last day (`service_period_start`,
  else `service_period_end`, else the disclosed bill date). A confirmed cost
  with no day at all is only covered by a full month, and the window counts it
  as `undated_records` / `undated_period_evidence` instead of spreading it.
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
fixture block (Projects `E2E-EXP-P320A…E`, months 2022-05/2022-06, measured to
2022-06-15) and writes `e2e/artifacts/project-cost-ranking.json`: it asserts the
equal-period window, both orderings, the zero-prior and unknown-prior states,
cost to date, late/backdated/unequal-coverage disclosure, the unfiltered company
position behind a Project filter, the 400/403 refusals, and the browser flow
(month and financial-year navigation, ranking switch, drilldown into recognized
and unresolved evidence, and a cost entered, submitted, and recognized through
the real controls). The spec refuses to run against a month that holds any cost
outside its own namespace.

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

| Surface                                        | Privilege                                                     |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Reconciliation, drilldown, expenditure months  | `reports:read` **and** `other_expenses:read` (or super admin) |
| Employee-cost views and their export           | `reports:read`                                                |
| Record a cost (report control and admin route) | `other_expenses:create`                                       |
| Submit / update a cost                         | `other_expenses:update`                                       |
| Recognize, reject, cancel                      | `other_expenses:approve`                                      |

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

Use an isolated database for repeatable verification:

```powershell
npx cross-env E2E_DB_NAME=accent_crm_dev_muse_e2e_expenditure npm run e2e
```

For the two initial slices, select `expense-reconciliation.spec.ts` and
`payroll-bonus.spec.ts` after the production build. Fixture cleanup derives SQL
placeholders from its owned Employee codes, so added Employees remain rerun-safe.
The payroll snapshot evidence includes the stored month and money columns.
Namespaced fixtures identify test records; names alone do not exclude them from
the current report. Keep this verification database separate from business data.

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
- **Currency**: conversion evidence extends `CurrencyTotal`, replacing the
  `currency_conversion_missing` notice before any combined total appears.
- **Export**: consume `fetchCompanyReconciliation` and `fetchCostDrilldown`, so
  the download cannot disagree with the screen.

## Files

- `migrations/20261006120000_expense_cost_recognition.js`
- `migrations/20261007120000_expense_cost_period_basis_service_period_end.js`
  (extends `period_basis` for the disclosed partial service period)
- `src/lib/company-expenditure/{index,types,recognition,reconciliation,records,commands,coverage}.ts`
- `src/lib/company-expenditure/{ranking,totals}.ts` (comparable period, both
  orderings, cost to date, per-Project evidence; shared money subtotals)
- `src/app/api/reports/employee-project-monthly-cost/route.ts` (expenditure view, meta months, tightened gate)
- `src/app/api/reports/employee-project-monthly-cost/expenses/route.ts`
- `src/app/api/reports/employee-project-monthly-cost/download/route.ts` (tightened gate)
- `src/app/api/admin/expenses/route.js` (entry through the module)
- `src/app/api/admin/expenses/[id]/commands/route.ts`
- `src/app/api/admin/expenses/[id]/route.js` (recognized cost frozen; versioned financial fields refused)
- `src/app/reports/employee-project-monthly-cost/{page,expenditure-view}.tsx`
- `src/lib/format.js` (`formatCurrencyIn`)
- `src/components/Navbar.jsx` (financial gate)
- `docs/adr/0018-direct-cost-recognition-and-versioned-commands.md`
- `e2e/lib/expenditure-fixtures.ts`, `e2e/specs/expense-reconciliation.spec.ts`, `e2e/global-setup.ts`
- `e2e/specs/project-cost-ranking.spec.ts` (ranking, comparable period, cost to
  date; artifact `e2e/artifacts/project-cost-ranking.json`)
