# Company Project Expenditure — Implementation (tickets #306, #317, #321)

## Overview

The report at `/reports/employee-project-monthly-cost` now leads with **Company
Incurred Cost** for a month, reconciled to **Incurred Project Cost**, **Company
Overhead**, and **Unallocated Cost**. Each underlying direct cost is counted
once. The employee-cost Monthly and Financial Year views read the same shared
interpretation: recorded employer-cost allocation where the month was
finalized, the corrected payroll calculation's estimate otherwise.

Ticket #306 delivers the first complete slice: capture a direct expense with a
durable identity, recognize it into a month, reconcile it, and drill from a
Project into its source records. Everything else the parent specification
describes is named as coverage, not faked.

Ticket #307 adds **recorded employer cost** (ADR-0016): each Payroll Slip's
employer cost is allocated across the Employee's monthly Logged Hours into
deterministic cent shares that reconcile exactly to the slip, hours without a
Project stay in the denominator as Unallocated Employee Cost, and Payroll
Finalize freezes the shares with the run lock in one transaction. The
expenditure view, its employee drilldown, and the employee-cost views all read
that one interpretation.

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
  ├─ GET  /api/reports/employee-project-monthly-cost/payroll?month=[&employee_id=]
  ├─ POST /api/admin/expenses                        (record a cost)
  ├─ POST /api/admin/expenses/{id}/commands          (submit | recognize | reject | cancel | update)
  ├─ GET  /api/admin/cost-budgets?project_id=        (budget versions of one Project)
  ├─ GET  /api/admin/cost-budgets/{id}               (one budget + its approval journal)
  ├─ POST /api/admin/cost-budgets                    (record a draft budget)
  ├─ POST /api/admin/cost-budgets/{id}/commands      (update | submit | approve | withdraw)
  └─ POST /api/payroll/runs/finalize                 (locks the month and freezes allocations)
            │
            ▼
  src/lib/company-expenditure  (the shared financial module)
    index.ts             public interface
    recognition.ts       pure rules: period, tax, recognition blockers, transitions
    reconciliation.ts    pure builder: groups, currencies, projects, evidence, coverage, payroll
    records.ts           reads: month records, project cost, options, months, journal, drilldown
    commands.ts          the single write path: recordCost, executeCommand, journal
    payroll.ts           recorded employer-cost allocation: shares, freeze, estimates, drilldown
    budget-records.ts    reads: budget rows, covering budgets, journal
    budget-commands.ts   the budget write path: recordCostBudget, executeBudgetCommand
    budget-comparison.ts pure builder: the isolated budget section
    coverage.ts          which sources feed the module and which do not
            │
            ▼
  expenses (+ cost_uid, recognition_*, financial_version)
  financial_cost_events (append-only command journal)
  payroll_employee_allocations (+ shares, payroll_allocation_events)
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

## Recorded employee cost allocation (#307)

Implemented in `payroll.ts` (ADR-0016); the consumer contract for the later
allocation slices (#308/#309) is published outside the repo at
`C:/Files/OCDSE/Work/expenditure-payroll-allocation-contract.md`.

**The rule.** Each Payroll Slip's recorded `employer_cost` is allocated across
the Employee's eligible monthly Logged Hours — the same
`user_activity_assignments.daily_entries` source and the same canonical parser
the payroll calculator prices slips from, so the denominator cannot drift from
the hours the slip was paid at. Every destination's exact share is floored to
the cent and the remaining cents (fewer than the number of destinations) go one
each to the largest fractional remainders — ties broken by larger hours, then by
the canonical destination order. The result sums exactly to the slip; each share
persists the cent it received (`rounding_adjustment`) so the adjustment is
attributable, and the allocation records the slip id, Employee, month, and
version as its source identity.

**No project / No logged hours.** Hours without a reliable Project (no
`project_id`, or one whose Project row is gone) stay in the denominator and
their share is Unallocated Employee Cost, labelled `no_project`. With no Logged
Hours the whole recorded cost stays unallocated as `no_logged_hours` — it is
never spread over known Projects, and it is never Bench Cost.

**Freeze at Payroll Finalize.** `POST /api/payroll/runs/finalize` runs one
transaction: the `draft → finalized` transition (guarded by
`WHERE status = 'draft'`), its audit entry, and `freezeMonthAllocations` for
every Payroll Slip of the month. A concurrent finalize loses on the guard and
writes nothing; a repeated finalize is refused `409`; a later timesheet or
Salary Profile edit cannot move a frozen share. A re-finalization after an
authorized reopen appends the next version (`unique_slip_allocation_version`),
so history stays readable and duplicates are impossible.

| Table                                  | Meaning                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `payroll_employee_allocations`         | One frozen allocation per Payroll Slip and version: recorded employer cost, denominator hours, project/no-project hours, the total rounding cent, the snapshotted Employee identity and pay stream, who froze it |
| `payroll_employee_allocation_shares`   | One row per destination: Project (with snapshotted code/name/client), `no_project`, or `no_logged_hours`, with hours, amount, and the applied cent |
| `payroll_allocation_events`            | Append-only freeze journal keyed `(allocation_uid, version)`, snapshot included |

**Report contract.** The reconciliation payload gains
`payroll: { currency, recorded_total, estimated_total, allocated_total,
unallocated_total, total_logged_hours, project_hours, no_project_hours,
rounding_adjustment, recorded_count, known_zero_count, estimated_count,
missing_slip_count, missing_pricing_count, allocation_missing_count }`;
Project rows gain `employee_cost`, `estimated_employee_cost`, `logged_hours`,
and `employee_count`. Recorded employee cost joins the payroll-currency slice
(Project shares into Incurred Project Cost, unallocated shares into Unallocated
Cost) and the prior-month comparison, while estimates never enter a confirmed
total. `GET …/payroll?month=[&employee_id=]` is the employee drilldown: per
Employee status (`recorded` / `estimated` / `known_zero` / `unknown`), recorded
and estimated amounts, Logged Hours by Project, the source Payroll Slip and
allocation version, and shares with basis and rounding. The employee-cost
Monthly and Financial Year views read the same module, so the obsolete
Gross-first billing-derived rate × hours path is no longer a consumer path.

**Gaps are stated, not hidden.** Estimates are labelled and separate; a missing
Payroll Slip (`payroll_slip_missing`), missing pricing (`payroll_pricing_missing`
— hours with no covering Salary Profile, whose cost is unknown, not zero), a
finalized month without a frozen allocation (`payroll_allocation_missing`), and
an unfinalized or ungenerated month (`payroll_not_finalized` /
`payroll_not_generated`) are coverage notices; No project and No logged hours
amounts are disclosed as info notices. A finalized zero stays a known zero.

## Coverage: what the total does not include

`SOURCE_COVERAGE` declares each source and its state; the not-incorporated
entries become coverage notices on every reconciliation:

- supplier invoices, orders, and Outstanding Supplier Commitment;
- evidenced Cost Accruals;
- dated settlements and petty cash.

Recorded payroll employer cost is `wired` since #307 and no longer appears as a
not-incorporated notice; its own coverage notices (above) state the month's
payroll completeness.

Month-specific notices add: no recognized cost, mixed currencies without
conversion, records awaiting recognition, missing amounts, unresolved
classification, unresolved tax, tax evidence missing, service periods that
span months, and service periods whose start is not recorded. An empty month is
a coverage warning, never a zero company cost.

## Authorization

| Surface                                        | Privilege                                                     |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Reconciliation, drilldown, expenditure months  | `reports:read` **and** `other_expenses:read` **and** `payroll:read` (or super admin) |
| Employee-cost views and their export           | `reports:read`                                                |
| Employee-cost drilldown (`…/payroll`)          | `reports:read` **and** `other_expenses:read` **and** `payroll:read` (or super admin) |
| Record a cost (report control and admin route) | `other_expenses:create`                                       |
| Submit / update a cost                         | `other_expenses:update`                                       |
| Recognize, reject, cancel                      | `other_expenses:approve`                                      |
| Read cost budgets and their journals           | `other_expenses:read`                                         |
| Record, edit, submit, withdraw a cost budget   | `other_expenses:update`                                       |
| Approve a cost budget                          | `other_expenses:approve`                                      |
| Finalize a Payroll Run (freezes allocations)   | `payroll:update`                                              |

The direct-expense ledger is the source of the expenditure reconciliation, so
report access alone does not open it: the expenditure view, its drilldowns, and
the `expenditure_months` list in the meta payload require the ledger's read
privilege and — since the reconciliation carries recorded Payroll Slip employer
cost (#307) — the payroll source's read privilege as well (parent spec §149 —
existing source authorization and financial privileges). A `reports:read`
reader without them keeps the employee-cost views and is refused `403` with no
source rows or aggregates. The Project Activity field grant opens none of this,
and Employee Utilization is untouched.

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

`e2e/specs/expenditure-payroll-allocation.spec.ts` (#307) drives the same real
app and writes `e2e/artifacts/expenditure-payroll-allocation.json`. It owns the
months **2026-02** (finalized) and **2026-03** (estimates), Projects
`E2E-ALLOC-P1/P2`, Employees `E2E-ALLOC-01..06`, a fixture Bonus Component Rate,
and two reader identities (fixtures in
`e2e/lib/expenditure-allocation-fixtures.ts`, wired into `e2e/global-setup.ts`),
and asserts, from hand-computed fixture literals:

- Generate through the authenticated route writes the stated slip amounts
  (₹26,000 monthly, ₹10,000 contract, ₹500 bonus-only, and known zeros), and the
  month holds exactly three nonzero slips;
- before finalization the month states estimates only: no recorded total, no
  company incurred cost, `payroll_not_finalized` coverage, and the drilldown
  marks the Employee `estimated` with the slip as source;
- deleting one slip discloses `payroll_slip_missing` with the estimate intact,
  regenerating clears it, and a finalize attempt with a missing slip is refused
  `409` with no allocation written and the run still `draft`;
- finalization freezes one allocation per slip in the same transaction: every
  frozen allocation sums exactly to its slip's `employer_cost`, one journal row
  per slip, version 1 only, and a repeated finalize changes nothing;
- the reconciliation states recorded ₹36,500.00 (P1 ₹14,635.41, P2 ₹13,447.92,
  unallocated ₹8,416.67, rounding ₹0.02, 384 Logged Hours) with the two
  Projects' employee cost and hours, no payroll coverage warnings, and the
  drilldown shows both pay streams, the largest-remainder cent on the
  no-project/P2 shares, and No logged hours fully unallocated;
- 2026-03 states the payroll-based estimate (₹5,250 = 42h at the corrected
  calculation) separately, with `payroll_not_generated` and
  `payroll_pricing_missing` for the Employee who logged hours with no profile;
- the browser's expenditure view shows the payroll summary, the employee row,
  and the No project share from the real controls;
- reopen returns the month to estimates while the version-1 allocations remain
  readable, two concurrent finalizes yield exactly one `200` and one `409`, and
  version 2 is written once per slip and reconciles again;
- later timesheet and Salary Profile edits (through the fixture row and the real
  profile route) leave the frozen shares and the Payroll Slip unchanged, and a
  renamed Project keeps its frozen identity in the report;
- paid payroll cannot reopen (`409`) and the frozen allocation stays recorded;
- a `reports:read` reader and a `reports:read` + `other_expenses:read` reader
  are both refused `403` on the reconciliation and the payroll drilldown (the
  payroll source privilege is the missing one), while the employee-cost views
  keep their existing contract; malformed and unknown requests are `400`/`404`.

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

## Public interface for later slices

`src/lib/company-expenditure/index.ts` is the contract later tickets extend:

- **#307 recorded payroll**: implemented (`payroll.ts`): recorded employer-cost
  allocation frozen with Payroll Finalize, estimates from the corrected payroll
  calculation, the payroll drilldown, and the employee-cost views as consumers
  of the same interpretation. The later allocation slices (#308/#309) extend it
  through `C:/Files/OCDSE/Work/expenditure-payroll-allocation-contract.md`.
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
- `migrations/20261008090700_payroll_employee_cost_allocation.js`
  (#307: allocations, shares, allocation journal)
- `src/lib/company-expenditure/{index,types,currency,recognition,reconciliation,records,commands,payroll,coverage,budget-records,budget-commands,budget-comparison}.ts`
- `src/app/api/reports/employee-project-monthly-cost/route.ts` (expenditure view, meta months, tightened gate)
- `src/app/api/reports/employee-project-monthly-cost/expenses/route.ts`
- `src/app/api/reports/employee-project-monthly-cost/payroll/route.ts` (#307 drilldown)
- `src/app/api/reports/employee-project-monthly-cost/download/route.ts` (tightened gate)
- `src/app/api/payroll/runs/finalize/route.js` (one transaction: lock, audit, allocation freeze)
- `src/app/api/admin/expenses/route.js` (entry through the module)
- `src/app/api/admin/expenses/[id]/commands/route.ts`
- `src/app/api/admin/expenses/[id]/route.js` (recognized cost frozen; versioned financial fields refused)
- `src/app/api/admin/cost-budgets/route.ts`, `.../[id]/route.ts`, `.../[id]/commands/route.ts` (#321)
- `src/app/reports/employee-project-monthly-cost/{page,expenditure-view,budget-section}.tsx`
- `src/lib/format.js` (`formatCurrencyIn`)
- `src/components/Navbar.jsx` (financial gate)
- `docs/adr/0018-direct-cost-recognition-and-versioned-commands.md`
- `docs/adr/0019-approved-cost-budgets.md` (#321)
- `e2e/lib/expenditure-fixtures.ts`, `e2e/specs/expense-reconciliation.spec.ts`, `e2e/specs/project-cost-budgets.spec.ts`, `e2e/global-setup.ts`
- `e2e/lib/expenditure-currency-fixtures.ts`, `e2e/specs/expenditure-currency.spec.ts` (#319)
- `e2e/lib/expenditure-allocation-fixtures.ts`, `e2e/specs/expenditure-payroll-allocation.spec.ts` (#307)

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

| Object                                   | Meaning                                                                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expenses.cost_nature`                   | `operating` (default, and what every pre-#317 row was), `advance`, `deposit`, `prepayment`, `capital`, or `unresolved`. Independent of `cost_classification`.         |
| `expense_period_charges`                 | One approved (or cancelled) charge: `charge_uid`, `(source_table, source_id, source_cost_uid)`, `charge_period`, `basis`, `amount`, `currency`, `evidence_reference`, `state`, `financial_version`, `sequence`, approver/time, cancel reason/time. |
| `expense_period_charge_events`           | Append-only approval journal, one row per accepted command, keyed `(charge_uid, version)`; `approved` then `cancelled`.                                              |

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

| Outcome                          | Status | Code                                                  |
| -------------------------------- | ------ | ----------------------------------------------------- |
| Approved / cancelled             | 200    | `{ data: PeriodChargeJson }`                           |
| Source not confirmed cost        | 409    | `source_not_recognized`                                |
| Same month and basis approved    | 409    | `duplicate_period_charge`                              |
| Stale charge version             | 409    | `version_conflict` (with `current_version`)             |
| Operating nature                 | 422    | `nature_not_non_operating`                             |
| Charge over the remaining amount | 422    | `exceeds_source_balance` (with `remaining_amount`)      |
| Missing amount / evidence        | 422    | `invalid_charge_amount` / `charge_evidence_required`   |
| Currency not the source's        | 422    | `charge_currency_mismatch`                             |
| Bad month / basis                | 422    | `invalid_charge_period` / `invalid_charge_basis`        |
| Missing privilege                | 403    | —                                                      |

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
