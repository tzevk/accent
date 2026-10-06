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

| Column                                                                  | Meaning                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `cost_uid`                                                              | Stable identity of the underlying cost, minted once at capture              |
| `cost_classification`                                                   | `project` / `company_overhead` / `unallocated`; NULL = not yet classified   |
| `recognition_state`                                                     | `draft` / `pending_evidence` / `recognized` / `rejected` / `cancelled`      |
| `recognition_period`, `period_basis`                                    | The recognised month and how it was established                             |
| `service_period_start`, `service_period_end`                            | Received-work period evidence                                               |
| `tax_treatment`, `tax_evidence_reference`                               | none / recoverable / non_recoverable / unresolved, with its evidence        |
| `recognized_amount`                                                     | Cost after evidenced recoverable tax; NULL means no confirmed cost          |
| `source_reference`, `evidence_reference`                                | Original document and supporting evidence                                   |
| `financial_version`                                                     | Version the next command must present                                       |
| `recognized_by`, `recognized_at`                                        | Who confirmed the cost and when                                             |
| `amount`, `tax_amount`, `total_amount`                                  | Base, tax, and gross liability — now NULLable, so missing is not zero       |

`status` keeps its register meaning and is **not** the recognition state: a row
approved in the expense register is not confirmed cost until it is recognized.

`financial_cost_events` is append-only: one row per accepted command, keyed
`(cost_uid, version)`, with actor, reason, evidence reference, and the financial
snapshot the command produced. It is the audit trail the drilldown and the
later revision slice read.

## Recognition rules (pure, `recognition.ts`)

- **Period**: service period start → its month (`service_period`); else the bill
  date → its month (`bill_date_fallback`); else no period, and the cost cannot be
  recognized. Order and payment dates never set the period. A service period that
  spans months is attributed to the month it starts in and reported with a
  `service_period_spans_months` notice until period splitting lands.
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

| Outcome               | Status | Code                                                     |
| --------------------- | ------ | -------------------------------------------------------- |
| Applied               | 200    | `{ data: { recognition_state, financial_version, … } }`   |
| Stale version         | 409    | `version_conflict` (with `current_version`)               |
| State forbids command | 422    | `command_not_allowed`                                     |
| Not ready to recognize| 422    | `not_ready_for_recognition` (with `missing: [...]`)       |
| Reject/cancel without a reason | 422 | `reason_required`                                 |
| Missing privilege     | 403    | —                                                         |
| Not found             | 404    | `not_found`                                               |

Recognize, reject, and cancel need `other_expenses:approve`; submit and update
need `other_expenses:update`. Editing or soft-deleting a recognized row through
the register is refused with `409 cost_recognized`.

## Report contract

`GET /api/reports/employee-project-monthly-cost?view=expenditure&month=YYYY-MM[&project_id=]`
returns `company` (currency, incurred cost, per-currency subtotals, the three
groups, gross liability, recoverable tax, unresolved tax, known zeros), the
Project breakdown with change against the previous month, the evidence summary,
the coverage notices, the Project options for the entry control, and the months
that carry cost. The Project filter narrows `projects`, never `company`.

`GET …/expenses?month=&state=&classification=&project_id=&limit=&offset=`
returns the records behind those figures with identity, period, currency, tax
treatment, `recognized_amount`, `financial_version`, and the exception codes
that explain any non-clean amount.

The Excel download keeps exporting the employee-cost views; the reconciliation
export belongs to the export slice, and the view therefore offers no download
button yet.

## Coverage: what the total does not include

`SOURCE_COVERAGE` declares each source and its state; the not-incorporated
entries become coverage notices on every reconciliation:

- recorded payroll employer cost — a later slice (#307);
- supplier invoices, orders, and Outstanding Supplier Commitment;
- evidenced Cost Accruals;
- dated settlements and petty cash.

Month-specific notices add: no recognized cost, mixed currencies without
conversion, records awaiting recognition, missing amounts, unresolved
classification, unresolved tax, tax evidence missing, and service periods that
span months. An empty month is a coverage warning, never a zero company cost.

## Authorization

| Surface                                        | Privilege                |
| ---------------------------------------------- | ------------------------ |
| Reconciliation, drilldown, meta                | `reports:read` (or super admin) |
| Record a cost (report control and admin route) | `other_expenses:create`  |
| Submit / update a cost                         | `other_expenses:update`  |
| Recognize, reject, cancel                      | `other_expenses:approve` |
| Excel export (employee-cost views)             | `reports:read`           |

The Project Activity field grant no longer opens this report, the export, or the
navigation entry. Employee Utilization is untouched.

## End-to-end evidence

`e2e/specs/expense-reconciliation.spec.ts` drives the real app and writes
`e2e/artifacts/expense-reconciliation.json`. It seeds two Projects and fifteen
direct costs in `E2E-EXP-P*` / `E2E-EXP-*` (fixtures in
`e2e/lib/expenditure-fixtures.ts`, purged and reseeded by `e2e/global-setup.ts`),
then asserts, from hand-computed fixture amounts:

- every recognized cost appears once in its group and the groups equal the
  company total;
- drafts, pending evidence, rejected, cancelled, unresolved, and missing amounts
  stay out of confirmed cost, while a known zero is recorded as zero;
- the Project filter narrows detail but not the company reconciliation;
- currencies stay separate with no combined total;
- coverage names the sources and evidence gaps;
- a cost recorded and recognized through the API, and another through the
  browser form and the recognition queue, land in their service month once, with
  version 2 in the row and two journal entries;
- a stale version is refused and changes nothing;
- an unauthorized session gets 403 on reads and writes, and the browser shows
  the access panel.

Run it with `E2E_DB_NAME=accent_crm_dev_muse_e2e_expenditure npm run e2e`
(dedicated database), or `npm run e2e` against the dev database, where fixture
isolation keeps every row out of business totals.

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
- `src/lib/company-expenditure/{index,types,recognition,reconciliation,records,commands,coverage}.ts`
- `src/app/api/reports/employee-project-monthly-cost/route.ts` (expenditure view, meta months, tightened gate)
- `src/app/api/reports/employee-project-monthly-cost/expenses/route.ts`
- `src/app/api/reports/employee-project-monthly-cost/download/route.ts` (tightened gate)
- `src/app/api/admin/expenses/route.js` (entry through the module)
- `src/app/api/admin/expenses/[id]/commands/route.ts`
- `src/app/api/admin/expenses/[id]/route.js` (recognized cost is frozen here)
- `src/app/reports/employee-project-monthly-cost/{page,expenditure-view}.tsx`
- `src/lib/format.js` (`formatCurrencyIn`)
- `src/components/Navbar.jsx` (financial gate)
- `docs/adr/0018-direct-cost-recognition-and-versioned-commands.md`
- `e2e/lib/expenditure-fixtures.ts`, `e2e/specs/expense-reconciliation.spec.ts`, `e2e/global-setup.ts`
