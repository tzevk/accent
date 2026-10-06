# Company Project Expenditure — Implementation (tickets #306, #311)

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

For the two initial slices, select `expense-reconciliation.spec.ts` and
`payroll-bonus.spec.ts` after the production build. Fixture cleanup derives SQL
placeholders from its owned Employee codes, so added Employees remain rerun-safe.
The payroll snapshot evidence includes the stored month and money columns.
Namespaced fixtures identify test records; names alone do not exclude them from
the current report. Keep this verification database separate from business data.

## Supplier invoice recognition (#311)

One supplier liability is one `purchase_invoices` row carrying `cost_uid` and the
same recognition fields as a direct expense. The financial write path is
`src/lib/company-expenditure/supplier-invoices.ts`
(`initializeSupplierCost`, `executeSupplierCommand`); the register route inserts
the native row and calls `initializeSupplierCost` inside the same transaction,
so an invoice either exists with its cost identity or not at all. The register
`PUT`/`DELETE` refuse recognized cost (`409 cost_recognized`) and versioned
financial fields (`422 financial_fields_versioned`); those change only through
`POST /api/admin/purchase-invoices/{id}/commands` (update, submit, recognize,
reject, cancel) with `expected_version`.

- **Period slices** (`supplier_invoice_periods`): one invoice covering several
  service periods records one slice per period. Recognition requires the slice
  gross amounts to total the invoice exactly and the slice taxes to total the
  invoice tax (`not_ready_for_recognition` with `split_total_mismatch` /
  `split_tax_mismatch`). Each month counts only its own slice; the slice's
  `recognized_amount` is frozen at recognition. The drilldown publishes the
  slice (`split: { id, index, count }`) with the slice's own gross and cost.
- **Source links** (`financial_cost_links`, contract
  `C:/Files/OCDSE/Work/expenditure-source-contract.md`): a payable created with
  `purchase_invoice_id` migrates to the invoice's `cost_uid` (basis `explicit`,
  confirmed) and creates no cost; a payable whose `vendor_invoice_number` names
  the invoice is surfaced as a candidate on the invoice detail and resolved
  through `POST /api/admin/purchase-invoices/{id}/links` (confirm →
  basis `document`; reject → `review_state='rejected'`), never automatically.
  The payable `PUT` refuses link rewrites (`422 link_change_requires_review`).
- **Tax and withholding**: recoverable tax is excluded only with its evidence;
  withholding (TDS) is settlement information and never reduces cost.
- **Conversion evidence** (migration `20261008091101`, #319 contract): a
  foreign invoice stores its reporting target, rate, rate date, and evidence
  reference, validated by the shared `resolveConversion` (full triple or none);
  `converted_amount` is frozen at recognition. A pair change (currency or
  reporting target) never inherits the stored evidence: a convertible new pair
  requires the complete fresh triple in the same command
  (`422 conversion_evidence_required`), a same-currency pair clears it, the
  journal records `conversion_pair_changed`, `currency` is among the
  approve-gated patch fields, and the dialog clears its triple on a pair
  change. The drilldown takes `reporting_currency` and states each record's
  `conversion_status` in that basis. An invoice without matching evidence
  keeps its own currency total with `unsupported` status — no guessed or
  inverted rate, no mixed total. A split invoice also freezes each slice's
  converted amount (`supplier_invoice_periods.converted_amount`: per-slice
  rounding) and states its own converted amount as the sum of those slices, so
  the frozen figure and the report agree to the cent.
- **Authorization**: `purchase_orders:update` for the register and its
  commands, plus `other_expenses:approve` for recognize/reject/cancel and link
  decisions.
- **Report**: the reconciliation merges every source's records and publishes a
  per-source summary (`CompanyReconciliation.sources`); coverage flips the
  supplier source to wired. The same module serves the screen and the
  drilldown; `fetchCompanyReconciliation`, `fetchCostDrilldown`,
  `initializeSupplierCost`, `executeSupplierCommand`, `loadSupplierInvoiceDetail`,
  `decideSupplierLink`, `resolveCostReference`, `linkCostReference`,
  `registerCostIdentity`, and `registerCostSource` are the public interface.
- **Source identity on the screen**: ids are only unique within a store, so the
  report queue renders command controls for `direct_expense` rows alone;
  another source's queue row states where its recognition workflow lives (the
  admin Purchase Invoice register for supplier invoices), and list keys are
  source- and split-unique.

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
- **Supplier cost and commitments** (#311): the invoice source adapter and the
  shared `financial_cost_links` registry are in place; #312 adds supplier-order
  classification/consumption on top of `cost_uid` and publishes Outstanding
  Supplier Commitment as its own section. A receipt copy or settlement in any
  store references `cost_uid` and registers a link row.
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
- `src/lib/company-expenditure/{index,types,currency,recognition,reconciliation,records,commands,coverage,budget-records,budget-commands,budget-comparison}.ts`
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
- `migrations/20261008091100_expense_supplier_invoice_recognition.js` (#311;
  `purchase_invoices` financial columns, `supplier_invoice_periods`,
  `financial_cost_links`, `payment_payables.cost_uid`)
- `src/lib/company-expenditure/{sources,errors,supplier-invoices,drilldown}.ts` (#311)
- `src/app/api/admin/purchase-invoices/{options,[id]/commands,[id]/links}` (#311)
- `src/app/api/admin/purchase-invoices/route.js`, `[id]/route.js` (financial
  capture through the module; recognized cost and versioned fields refused)
- `src/app/api/admin/payment-payables/route.js`, `[id]/route.js` (explicit
  invoice link on create; link rewrites refused)
- `src/app/admin/purchase-invoice/page.tsx`, `SupplierRecognitionDialog.tsx`
- `docs/adr/0020-supplier-invoice-recognition-single-cost.md`
- `e2e/lib/supplier-invoice-fixtures.ts`, `e2e/specs/supplier-invoice-recognition.spec.ts` (#311)
- `docs/adr/0019-approved-cost-budgets.md` (#321)
- `e2e/specs/project-cost-budgets.spec.ts` (#321)
- `e2e/lib/expenditure-currency-fixtures.ts`, `e2e/specs/expenditure-currency.spec.ts` (#319)
