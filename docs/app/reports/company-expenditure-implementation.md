# Company Project Expenditure — Implementation (tickets #306, #311, #316, #317, #319, #321)

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

| Table                                | Meaning                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payroll_employee_allocations`       | One frozen allocation per Payroll Slip and version: recorded employer cost, denominator hours, project/no-project hours, the total rounding cent, the snapshotted Employee identity and pay stream, who froze it |
| `payroll_employee_allocation_shares` | One row per destination: Project (with snapshotted code/name/client), `no_project`, or `no_logged_hours`, with hours, amount, and the applied cent                                                               |
| `payroll_allocation_events`          | Append-only freeze journal keyed `(allocation_uid, version)`, snapshot included                                                                                                                                  |

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
Gross-first billing-derived rate × hours path is no longer a consumer path;
their per-row `hourly_rate` is stated with the shared Decimal money rule
(ROUND_HALF_UP, e.g. 302.25 ÷ 30 h → 10.08), and FY rows carry it so the FY
table and workbook Rate/Hr column stay wired. Estimated rows keep the live
Project identity their shares carry; a frozen recorded share's snapshotted
identity is never overwritten by an estimate. Estimates price from the eligible
canonical Salary Profile whenever one covers the month, falling back to a
legacy `salary_structures` row only when none does — the same choice Payroll
Generate prices slips with.

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
- dated outward settlements and advances — petty-cash funding and spending are
  incorporated separately (below).

Recorded payroll employer cost is `wired` since #307 and no longer appears as a
not-incorporated notice; its own coverage notices (above) state the month's
payroll completeness.

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

| Row       | Meaning                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| `funding` | Cash into the float: one cash voucher and its mirrored credit, one funding event       |
| `spend`   | Actual spending: one cost-bearing row with identity, period, approval, and destination |

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
  its own cost identity. Petty cash registers its own source adapter
  (`petty_cash_expenses`), so a spending identity resolves for every consumer
  — including another petty-cash receipt. A versioned link transition moves the
  registry row with the meaning: becoming a settlement drops the `role='cost'`
  row, becoming cost again restores it — atomically, so nothing resolves a cost
  the report excludes or misses one it counts.
- **Voucher mutations and spending capture serialize on the voucher row.**
  Capture locks the named voucher `FOR UPDATE` before inserting, and the voucher
  update/delete guards (`loadVoucherGuard` + `voucherRegisterRefusal`, exported)
  lock the same row for the whole mutation. A delete can therefore never count
  zero spending, let a capture commit, and then erase the funding event; the
  guarded soft delete of a voucher plus its one funding mirror is one
  transaction.
- **Recognized history survives an ordinary delete.** Beyond confirmed cost,
  spending that was ever recognized (even after a reasoned cancellation) refuses
  a register delete with `409 cost_history_preserved`; the row and its
  `recorded` → `recognized` → `cancelled` journal stay readable. The guard hooks
  (`loadPettyCashGuardRow`, `pettyCashRegisterRefusal`, `loadVoucherGuard`,
  `voucherRegisterRefusal`) are exported so the #322 close/revision slice hangs
  its closed-period checks off the same decisions.
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
- **The source registry carries petty cash.** `PETTY_CASH_COST_SOURCE`
  (exported from the module barrel) declares the native store
  (`petty_cash_expenses`), the UUID a command addresses (`id`), the numeric
  journal key (`numeric_id`), the command endpoint
  (`/api/admin/petty-cash-expenses/{id}/commands`), and the cost predicate
  (`entry_kind='spend' AND linked_cost_uid IS NULL`), with the month-records,
  previous-month Project cost, months, and drilldown loaders the report reads
  consume. `fetchCostDrilldown` unions the direct-expense and petty-cash
  windows into one ordered page, so a report drilldown shows confirmed
  petty-cash cost exactly once (settlements, which are not cost, stay out).
- **Conversion evidence follows the shared contract (#319).** Spending captures
  `reporting_currency`, `conversion_rate`, `conversion_date`, and
  `conversion_evidence_reference` through the same `resolveConversion`
  validation (full triple or none; a partial triple is
  `422 conversion_evidence_incomplete`, an invalid rate
  `422 invalid_conversion_rate`), and the module recomputes `converted_amount`
  from the recognized amount on every financial write through
  `convertToReporting` — one conversion site, no source-side rounding. The
  register PUT refuses the fields; only the versioned `update` command changes
  them, and an `update` that touches any currency/conversion field requires
  `petty_cash_expenses:approve`. A rate is evidence for one currency pair: a
  currency change never inherits the stored rate (a same-currency pair clears
  the triple; a new convertible pair without the fresh triple is `422
conversion_evidence_required`). A NULL original currency is unknown, never
  INR: such rows are excluded from every currency subtotal and disclosed as
  `petty_cash.unknown_currency.count`.

## Authorization

| Surface                                            | Privilege                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Reconciliation, drilldown, expenditure months      | `reports:read` **and** `other_expenses:read` **and** `payroll:read` (or super admin) |
| Employee-cost views and their export               | `reports:read`                                                                       |
| Employee-cost drilldown (`…/payroll`)              | `reports:read` **and** `other_expenses:read` **and** `payroll:read` (or super admin) |
| Record a cost (report control and admin route)     | `other_expenses:create`                                                              |
| Submit / update a cost                             | `other_expenses:update`                                                              |
| Recognize, reject, cancel                          | `other_expenses:approve`                                                             |
| Petty-cash register: read                          | `petty_cash_expenses:read`                                                           |
| Record / edit petty-cash spending                  | `petty_cash_expenses:create` / `:update`                                             |
| Recognize, reject, cancel petty-cash spending      | `petty_cash_expenses:approve`                                                        |
| Delete draft petty-cash spending                   | `petty_cash_expenses:delete`                                                         |
| Cash vouchers (funding)                            | super admin or `admin` role (unchanged)                                              |
| Read cost budgets and their journals               | `other_expenses:read`                                                                |
| Record, edit, submit, withdraw a cost budget       | `other_expenses:update`                                                              |
| Approve a cost budget, or withdraw an approved one | `other_expenses:approve`                                                             |
| Finalize a Payroll Run (freezes allocations)       | `payroll:update`                                                                     |

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

`e2e/specs/petty-cash-funding.spec.ts` drives the petty-cash slice and writes
`e2e/artifacts/petty-cash-funding.json` (fixtures in
`e2e/lib/petty-cash-fixtures.ts`, namespace `E2E-EXP-316-*`, months 2021-06 and
2021-08). From hand-computed fixture amounts it asserts:

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

`e2e/specs/expenditure-payroll-allocation.spec.ts` (#307) drives the same real
app and writes `e2e/artifacts/expenditure-payroll-allocation.json`. It owns the
months **2026-02** (finalized) and **2026-03** (estimates), Projects
`E2E-ALLOC-P1/P2`, Employees `E2E-ALLOC-01..09`, a fixture Bonus Component Rate,
and two reader identities (fixtures in
`e2e/lib/expenditure-allocation-fixtures.ts`, wired into `e2e/global-setup.ts`),
and asserts, from hand-computed fixture literals (employer cost = priced gross
plus the genuine employer contributions — e.g. ₹26,000 gross + ₹750 gratuity):

- Generate through the authenticated route writes the stated slip amounts
  (₹26,750 monthly, ₹10,289 contract, ₹500 bonus-only, and known zeros), and the
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
- the reconciliation states recorded ₹37,539.00 (P1 ₹15,057.79, P2 ₹13,836.04,
  unallocated ₹8,645.17, rounding ₹0.02, 384 Logged Hours; per-Project frozen
  hours 153 and 143, not the 296 month-wide total) with the two Projects'
  employee cost and hours, no payroll coverage warnings, and the drilldown shows
  both pay streams, the largest-remainder cent on the no-project/P2 shares, and
  No logged hours fully unallocated;
- 2026-03 states the payroll-based estimate (₹5,402 = 42h at the corrected
  calculation) separately, with `payroll_not_generated` and
  `payroll_pricing_missing` for the Employee who logged hours with no profile,
  and estimate-only Projects keep their live code/name/client identity in the
  reconciliation instead of an internal `#<id>`;
- the eligible canonical Salary Profile prices an Employee holding a newer
  legacy `salary_structures` row, matching Payroll Generate, while a legacy row
  with no canonical profile still prices its month;
- the monthly and FY views state every derived rate with the money rule: the
  fixture's 501.15 ÷ 10 h is exactly 50.115 and must read 50.12 (the naive float
  product reads 50.11), and the FY payload carries `hourly_rate` for the page
  table and workbook Rate/Hr column;
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

For the ticket slices, select `expense-reconciliation.spec.ts`,
`payroll-bonus.spec.ts`, and `petty-cash-funding.spec.ts` after the production
build; `expense-non-operating.spec.ts` adds the non-operating balances and their
approved consumption (#317), and the currency and budget specs cover #319/#321.
Fixture cleanup derives SQL
placeholders from its owned Employee codes, so added Employees remain rerun-safe.
The payroll snapshot evidence includes the stored month and money columns.
Namespaced fixtures identify test records; names alone do not exclude them from
the current report. Keep this verification database separate from business data.

Knex migrations use ESM `export async function up` and `down`; the bootstrap
imports each migration before applying it.
Financial report fixture readers need `reports:read`, `other_expenses:read`,
and `payroll:read`. The budget editor has these read privileges and
`other_expenses:update`, but no approval privilege.
Each feature uses distinct trusted-IP identities for login rate limits.
Supplier invoice fixtures use `198.18.0.71`–`.73`; payroll allocation fixtures
keep `198.18.0.31`–`.33`.

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

## Other expenses and receipt copies (ticket #315)

The other-expense register (`other_expenses`, `OEX-#####`) is a cost-bearing
source of the same module, not a second store:

- **Capture** (`POST /api/admin/other-expenses`) records the register's own
  fields plus classification (`project | company_overhead | unallocated`, or
  deliberately unresolved), the Recognition Period inputs (service period, bill
  date as the disclosed fallback), currency, tax treatment and its evidence
  reference, source/evidence references, a receipt/document link, and
  `submit` for the recognition queue. Number minting, the row, the canonical
  `cost_uid` (registered in `financial_cost_links`, role `cost`), and the
  version-1 journal row are one transaction.
- **Receipt copies**: a capture carrying `linked_cost_uid` links to an already
  recognized cost (`role='receipt'`, `basis='explicit'`, confirmed) and never
  becomes a cost. The register read (`linked` filter) and the review read show
  it as a copy; every command refuses it with `receipt_copy_not_cost`.
- **Duplicate review**: a standalone capture whose normalized vendor and gross
  amount match a recognized cost stores a **candidate** link
  (`basis='candidate'`, `review_state='pending_review'`). It never merges
  identity or totals, and `recognize` is refused with
  `duplicate_review_pending` until the reviewer decides. `POST
/api/admin/other-expenses/{id}/review` with `confirm_copy` links the entry as
  a receipt copy (a candidate becomes `basis='document'`), `reject_copy`
  rejects only the stored pending candidate — a different requested target is
  refused with `link_target_mismatch` rather than written over the preserved
  reference — and `unlink_copy` undoes a mistaken link. Each decision appends
  exactly one journal row and bumps `financial_version`.
- **Unresolved classification** is disclosed, never guessed: the review read
  lists open entries with the fields they are missing, and recognition refuses
  without a classification (existing `recognition_blockers`).
- **Commands and authorization**: `POST
/api/admin/other-expenses/{id}/commands` carries `update | submit |
recognize | reject | cancel` with `expected_version`; update/submit need
  `other_expenses:update`, recognize/reject/cancel need
  `other_expenses:approve`. Register `PUT` refuses the versioned financial
  fields (`financial_fields_versioned`) and a recognized row (`cost_recognized`);
  `DELETE` refuses recognized cost and any row with recognized history
  (`cost_history_preserved`), so ordinary deletion cannot bypass the versioned
  cancellation. The journal's `source_id` is INT, so an other-expense command
  journals the register's numeric `row_no`; the UUID stays the register's own
  key, the `financial_cost_links` reference key, and the command path's id —
  the UUID is never coerced into the journal. Unlinking a receipt copy
  registers the row's `role='cost'` identity again (idempotently), and
  recognition does the same, so an unlinked or backfilled row still resolves.
- **Reads**: `OTHER_EXPENSE_COST_SOURCE` projects this register into the
  module's canonical column vocabulary (including the conversion columns) and
  joins `COMPANY_COST_SOURCES`, so the reconciliation, previous-month
  comparison, month list, and drilldown count other expenses exactly once —
  receipt copies excluded once, in the source. The report queue marks
  non-direct-expense rows with a link to their register instead of sending the
  direct-expense commands at another store's id.
- **Currency and conversion**: capture states the original currency and may
  state the conversion evidence — reporting target, rate, effective date, and
  evidence reference — which the shared `currency.ts` helpers validate. An
  unknown original currency stays unknown (never read as INR), and it can never
  carry a rate: evidence with a blank currency is refused with
  `conversion_requires_currency`, alongside `conversion_evidence_incomplete`,
  `invalid_conversion_rate`, and `conversion_not_applicable`.
  `converted_amount` is recomputed by the module from the recognized amount at
  the stored rate; no inverse or cross-rate is ever derived, and a foreign
  amount without evidence stays in its own currency and is disclosed as
  unconverted. A rate is evidence for one currency pair: changing `currency` or
  `reporting_currency` never inherits the stored triple (a new convertible pair
  without fresh evidence is refused with `conversion_evidence_required`, a pair
  moved onto its reporting currency clears the triple). Afterwards only a
  versioned `update` carrying the whole evidence may change it, and that patch
  — like either side of the pair — needs `other_expenses:approve` (the register
  PUT refuses the fields, and the review dialog sends only the fields that
  actually changed, so an ordinary save is never approval-gated).
- **Coverage**: `SOURCE_COVERAGE` declares `other_expense_source` as wired.

End-to-end evidence: `e2e/lib/other-expense-fixtures.ts` +
`e2e/specs/other-expense-controls.spec.ts` (month `2019-04`, namespace
`E2E-EXP-315-*` / `E2E-315-*`), artifact `e2e/artifacts/other-expense-controls.json`.

## Public interface for later slices

`src/lib/company-expenditure/index.ts` is the contract later tickets extend:

- **#307 recorded payroll**: implemented (`payroll.ts`): recorded employer-cost
  allocation frozen with Payroll Finalize, estimates from the corrected payroll
  calculation, the payroll drilldown, and the employee-cost views as consumers
  of the same interpretation. The later allocation slices (#308/#309) extend it
  through `C:/Files/OCDSE/Work/expenditure-payroll-allocation-contract.md`.
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
- `docs/adr/0021-petty-cash-funding-and-spending.md` (#316)
- `e2e/lib/expenditure-fixtures.ts`, `e2e/specs/expense-reconciliation.spec.ts`, `e2e/specs/project-cost-budgets.spec.ts`, `e2e/global-setup.ts`
- `e2e/specs/project-cost-budgets.spec.ts` (#321)
- `e2e/lib/expenditure-currency-fixtures.ts`, `e2e/specs/expenditure-currency.spec.ts` (#319)
- `e2e/lib/expenditure-allocation-fixtures.ts`, `e2e/specs/expenditure-payroll-allocation.spec.ts` (#307)

Ticket #315 adds:

- `migrations/20261008091500_expense_other_expense_recognition.js`
- `src/lib/company-expenditure/other-expenses.ts` (capture, commands, copy
  review, review reads, source projection, source adapter)
- `src/app/admin/other-expenses/{page,other-expense-review}.tsx`
- `src/app/api/admin/other-expenses/route.ts`, `[id]/route.ts`,
  `[id]/commands/route.ts`, `[id]/review/route.ts`, `review/route.ts`
- `e2e/lib/other-expense-fixtures.ts`,
  `e2e/specs/other-expense-controls.spec.ts`, `e2e/global-setup.ts`

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
