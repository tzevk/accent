# Company Monthly Cost: ERP Reporting Research

Research note (2026-10-23). Research only; no application code changed.
Question: how do established ERP systems structure company/monthly cost
reporting — actual vs budget variance, cost-center/project dimensions,
drill-down to evidence, accrual vs cash, commitments, allocations, period
close, and exceptions — and what should Accent's
`src/app/reports/company-monthly-cost/` borrow?

Prior Accent audit context:
[monthly-expense-business-decisions.md](../app/reports/monthly-expense-business-decisions.md)
already covers local gaps and accounting; this note adds the vendor
benchmark and does not repeat that audit. Its line references are stale;
the current-source observations below (parent-supplied, spot-verified)
supersede it where they differ. The standing accounting rule from
[project-expenditure-accounting.md](../app/reports/project-expenditure-accounting.md)
still holds: never conflate cash, commitments, or client orders with
incurred cost.

## TL;DR

- Recommendation: keep **budget**, **open commitments**, **incurred cost**,
  **cash paid**, and **forecast** distinct. The product terminology differs:
  Odoo's Committed already includes Achieved. Do not copy labels without
  copying their definitions. Accent's inspected code already separates
  several of these concepts; a complete forecast capability was not audited.
- The professional row shape is **Budget | Actual | Variance | Variance %**
  per cost object per period, with drill-down to the source documents
  behind Actual. Accent's project table has cost/change/cost-to-date but
  keeps budget and commitments in separate panels — combine the existing
  data into one comparable row set.
- SAP documents commitment relief when goods arrive. D365 documents a
  configurable available-funds formula. Odoo's Committed includes actuals
  plus unbilled orders; subtracting both Committed and Achieved would
  double-count actuals. See the product sections and sources below.
  Accent must not subtract lifetime commitments from a monthly budget.
- Recommendation: match object, period, currency, and cost scope before
  calculating variance. Accent already enforces these checks.
- History-preserving revisions are useful references, not universal mandates:
  ERPNext retains amended budgets; D365 requires new entries after completion;
  Odoo offers both Revise and Reset to Draft. Accent should preserve its
  existing financial revision discipline.
- Exceptions are first-class: D365's over/under-budget workspace tabs, SAP
  tolerance warnings/errors, Odoo's red PO lines, Oracle's exception
  reports. Accent's next increment should be a decision-first summary plus
  actionable exceptions, built from data it already has.

## Vocabulary (do not conflate)

| Term       | Means                                                            | Decided by                           |
| ---------- | ---------------------------------------------------------------- | ------------------------------------ |
| Budget     | Approved plan for an object + account + period; no ledger effect | Approval action                      |
| Commitment | Ordered/requested value expected to become cost later            | PO / requisition / funds reservation |
| Actual     | Incurred cost posted to the object and period                    | Confirmed source records             |
| Cash       | Dated outward payment                                            | Settlement record                    |
| Forecast   | Estimate to complete / at completion for remaining work          | Named owner + stated scope           |
| Variance   | Budget minus actual (sign convention must be stated)             | Arithmetic on matched scope          |
| Remaining  | Budget minus confirmed actual (never profit, never forecast)     | Arithmetic on matched scope          |

Odoo makes the commitment/actual split mechanical: Committed equals
Achieved plus confirmed unbilled purchase orders (citation below). SAP
Learning states it as doctrine: commitments are "not costs, but budget
consumption, which is expected to later become costs" (citation below).

## SAP S/4HANA: cost-center actual/plan/commitment (primary reference)

SAP is the deepest reference for cost-center reporting semantics.

- The legacy SAP BW-content cost-center query lists, per cost center by cost element:
  Actual, Plan, absolute Variance, and Variance (%) for a chosen fiscal
  period or period range, with the responsible person as a display
  attribute.
  Source: <https://help.sap.com/saphelp_scm700_ehp02/helpdata/en/9d/038653aa9a6159e10000000a174cb4/content.htm?no_cache=true>
- Commitments are the cost of requested or ordered materials/services;
  they tie up funds that become costs later. They arise from purchase
  requisitions, purchase orders, and funds commitments, and are
  pre-assigned to an order, a cost center, or a project/WBS element.
  Source: <https://learning.sap.com/courses/cost-center-and-internal-order-accounting-in-sap-s-4hana/configuring-the-new-commitment-management-solution>
- In classic commitment management, commitments use transaction currency,
  with conversions to controlling-area, company-code, and object currencies.
  Goods receipts reduce commitments as actual costs arise. Classic management
  supports year-end carry-forward; the new extension-ledger solution explicitly
  does not support commitment carry-forward.
  Source: <https://learning.sap.com/courses/cost-center-and-internal-order-accounting-in-sap-s-4hana/configuring-the-new-commitment-management-solution>
- The new S/4HANA commitment solution posts commitments as predictive
  documents in an extension ledger of the Universal Journal (ACDOCA),
  structurally identical to actuals but in a separate ledger so they
  never mix with legal postings; goods receipt reverses the forecast and
  posts the actual in the leading ledger.
  Source: <https://learning.sap.com/courses/cost-center-and-internal-order-accounting-in-sap-s-4hana/configuring-the-new-commitment-management-solution>
- The Cost Center Budget Report app shows budget, plan data, actual
  costs, commitments, and available budget for budget-bearing cost
  centers, with navigation to actual-cost and commitment line items;
  availability control raises a warning at one tolerance and an error at
  another when a requisition or order would exceed budget.
  Source: <https://learning.sap.com/courses/cost-center-and-internal-order-accounting-in-sap-s-4hana/configuring-the-new-commitment-management-solution>
- The Commitment by Cost Center app analyzes commitments per period,
  cost center, and cost type, compares them with actual, planned, and
  assigned expenses, and drills down to the originating requisitions and
  orders.
  Source: <https://learning.sap.com/courses/cost-center-and-internal-order-accounting-in-sap-s-4hana/configuring-the-new-commitment-management-solution>
- Plan data lives in its own table (ACDOCP) with plan categories
  (versions in older releases); actuals live in ACDOCA. Plan and actual
  share granularity but never share storage.
  Source: <https://learning.sap.com/courses/cost-center-and-internal-order-accounting-in-sap-s-4hana/planning-on-cost-centers-and-internal-orders>
- Unavailable evidence: the S/4HANA on-premise "Cost Center Budget
  Report" help page (<https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/5e23dc8fe9be4fd496f8ab556667ea05/47ef8703e5ab4a83b9b833315f745290.html>)
  and the actual/plan/commitment report page
  (<https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/5e23dc8fe9be4fd496f8ab556667ea05/e90ed553088f4308e10000000a174cb4.html>)
  return a JavaScript shell to a static reader; their bodies were not
  read and no claim here rests on them. Search snippets suggest they
  cover budget/plan/actual/commitments, consistent with the readable SAP
  Learning lesson above. The Fiori apps library classic URL similarly
  redirects without readable app detail.

## Microsoft Dynamics 365 Finance: budget control + cost control workspace

D365 is the strongest reference for exception-first UX and for the
mechanics of "available funds".

- Approved budgets are held in budget register entries; once balances
  are updated the entry is Completed and can never be reopened —
  adjustments require a new entry. Budget codes (original, transfer,
  revision, encumbrance, preencumbrance, carry-forward) provide the audit
  trail of modifications.
  Source: <https://learn.microsoft.com/en-us/dynamics365/finance/budgeting/basic-budgeting-overview-configuration>
- The Ledger budgets and forecasts workspace gives the budget manager
  Expense-over-budget and Revenue-under-budget tabs — exceptions first —
  with per-workspace threshold configuration and drill to the
  Budget-vs-actuals inquiry.
  Source: <https://learn.microsoft.com/en-us/dynamics365/finance/budgeting/basic-budgeting-overview-configuration>
- The Actual-vs-budget inquiry drills both directions: budget account
  entries lead back to the budget register entries, and the Actuals
  amount opens the general journal (ledger) transactions behind it.
  Source: <https://learn.microsoft.com/en-us/dynamics365/finance/budgeting/basic-budgeting-overview-configuration>
- The cost control workspace defines variance as Budget balance minus
  Actual balance, variance % as that difference over Budget balance, and
  highlights lines red when period, yearly, or percentage thresholds are
  exceeded. Columns cover current period, previous period, year-to-date,
  and YTD average; detail drill-down reaches cost entries and the
  allocation base behind them.
  Source: <https://learn.microsoft.com/en-us/dynamics365/finance/cost-accounting/cost-control-workspace>
- Available funds is a configurable formula that may include
  preencumbrances (requisitions) and encumbrances (orders) alongside
  actuals; over-budget behavior is configurable per rule as
  warn-and-allow (permission group), block past a tolerance threshold, or
  strictly block. Configuration requires matching the chosen documents
  to the balances in the formula.
  Source: <https://learn.microsoft.com/en-us/dynamics365/finance/budgeting/budget-control-overview-configuration>
- The project actuals-vs-budget pattern prescribes comparing at project
  start, at regular intervals, at milestones, and at close; it warns the
  pattern needs categorized transactions and enough data to be
  meaningful, and excludes fixed-price and trivial-expense cases.
  Source: <https://learn.microsoft.com/en-us/dynamics365/guidance/business-processes/project-to-profit-pattern-analyze-actual-versus-budget>
- Business Central's G/L Balance/Budget view shows actual and budgeted
  debits/credits per account plus the proportional actual-to-budget
  relationship, with Net Change vs Balance-at-Date modes and period
  navigation — the minimal shape of the same report.
  Source: <https://learn.microsoft.com/en-us/dynamics365/business-central/bi-how-analyze-actual-versus-budget>

## ERPNext: budget variance report + revision discipline

ERPNext is the closest open-source analogue and the clearest statement of
variance-report mechanics.

- The Budget Variance Report places the approved Budget beside actual
  expenses per period with Budget, Actual, Variance, and optional
  cumulative columns; monthly values show one period, cumulative values
  show plan-vs-actual overall despite timing differences.
  Source: <https://docs.frappe.io/erpnext/budget-variance-report>
- Actuals come only from submitted transactions posting to the same
  account, company, period, and segment; the report is budget-driven, so
  actual expenses alone do not create rows. Suspect variances are checked
  against the General Ledger with identical filters.
  Source: <https://docs.frappe.io/erpnext/budget-variance-report>
- A Budget controls Warn/Stop/Ignore at four stages — material request,
  purchase order (commitment), actual expense, cumulative expense — with
  separate annual and periodic checks. The Budget itself creates no GL,
  payable, or bank entry.
  Source: <https://docs.frappe.io/erpnext/budget>
- Revisions preserve history: revising creates a connected replacement,
  cancels and retains the earlier Budget (traceable via an amended-from
  link), leaves posted transactions untouched, and switches checks and
  reports to the revised amount.
  Source: <https://docs.frappe.io/erpnext/budget-revision>
- Cost Center design guidance: keep a stable hierarchy reflecting
  management responsibility; do not create a cost center per short
  project or customer — use Project or another accounting dimension for
  that. Group cost centers roll up descendants for reporting.
  Source: <https://docs.frappe.io/erpnext/cost-center>

## Odoo: analytic budgets with committed + theoretical amounts

Odoo contributes two ideas the other references lack: an explicit
Committed column on the budget line and a Theoretical (time-prorated)
expectation.

- Analytic budgets track income/expense by project, department, or
  transaction group via analytic plans and accounts; financial budgets
  instead sit on P&L ledger accounts for compliance reporting. The two
  serve different purposes and are kept distinct.
  Source: <https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/budget.html>
- Once a budget is Open, each line shows Budgeted, Committed, and
  Achieved. Achieved reflects confirmed journal items; Committed is the
  full Achieved value plus confirmed unbilled purchase orders. A
  Theoretical amount shows what should have been spent/received given
  the current date within the budget period.
  Source: <https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/budget.html>
- Overrunning PO lines are highlighted red; Revising an open budget
  creates a new budget with a Rev reference while the original becomes
  Revised; the budget report supports filtering, grouping, drill-down to
  actual transactions, and export.
  Source: <https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/budget.html>
- The same documentation also permits Reset to Draft to overwrite and reopen
  an Open budget. Revise is therefore a supported history-preserving option,
  not the only permitted editing path.
  Source: <https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/budget.html>
- Analytic distribution splits one journal item across analytic accounts
  by percentage, can be made mandatory per plan, and can be automated
  with distribution models (e.g. utilities split 60/30/10 across
  departments by account prefix).
  Source: <https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/analytic_accounting.html>

## Oracle Fusion: funds availability + exception reporting

Oracle corroborates the available-funds model at enterprise scale.

- Budgetary Control gives visibility into budgets, actuals, and
  encumbrances together; budget managers monitor fund balances, review
  budget exceptions, and control the periods in which funds consumption
  can occur, with real-time inquiry into funds available and funds
  consumption analysis.
  Source: <https://docs.oracle.com/en/cloud/saas/financials/26b/faups/overview-of-budgetary-control-inquiry-and-reporting.html>
- Out-of-the-box reporting includes a Budgetary Control Analysis Report,
  a Results Report, and an Analysis Exception Report across chart of
  accounts, award, and project dimensions.
  Source: <https://docs.oracle.com/en/cloud/saas/financials/26b/faups/overview-of-budgetary-control-inquiry-and-reporting.html>

## Comparison

| Concern             | SAP S/4HANA                                    | D365 Finance                                | ERPNext                                    | Odoo                                      |
| ------------------- | ---------------------------------------------- | ------------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| Variance row shape  | Actual/Plan/abs/% per cost center × element    | Budget/Actual/variance/% + YTD columns      | Budget/Actual/Variance + cumulative        | Budgeted/Achieved/Committed + Theoretical |
| Variance definition | Actual vs Plan (absolute + %)                  | Budget − Actual; % over Budget              | Planned vs actual difference               | Achieved vs Budgeted; Theoretical prorata |
| Commitments         | Separate ledger; relieved by GR; carried fwd   | Encumbrance/preencumbrance in funds formula | PO-stage Warn/Stop control                 | Committed = Achieved + unbilled POs       |
| Drill-down          | To actual + commitment line items, source docs | To budget register entries and GL journals  | To General Ledger, identical filters       | To actual transactions; export            |
| Exceptions          | Tolerance warning/error at posting             | Over/under-budget workspace tabs; red lines | Warn/Stop at transaction                   | Red PO lines; exception reporting         |
| Revisions           | Plan categories/versions                       | Completed entries immutable; new entry      | Cancel-retain + amended-from link          | Rev reference; original marked Revised    |
| Plan/actual storage | ACDOCP vs ACDOCA                               | Budget register vs ledger                   | Budget record vs GL                        | Budget lines vs journal items             |
| Project dimension   | WBS element as account assignment              | Project module budgets vs Finance actuals   | Budget Against Project; separate dimension | Analytic plan/account per project         |

## Accent current-state observations (parent-supplied, spot-verified)

Source inspection only; app and database were not run. Verified items
were checked against the cited files; unverified items are
parent-supplied and marked [P].

- The expenditure view renders one long surface in this order:
  CompanyReconciliationPanel, ComparisonPanel, BalancesPanel,
  CommitmentsPanel, ClientOrdersPanel, ProjectBreakdown, PayrollSummary,
  RecognitionQueue, BudgetSection, CashSection, CloseSection,
  RevisionSection — verified at
  [expenditure-view.tsx](../../src/app/reports/company-monthly-cost/expenditure/expenditure-view.tsx)
  lines 593–705.
- The project table shows rank, project, client, employee cost, hours,
  incurred cost, this-month (or first-N-days), change, cost-to-date,
  reporting currency, not-confirmed, and evidence, with expandable
  source-record drill-down — verified at
  [project-breakdown.tsx](../../src/app/reports/company-monthly-cost/expenditure/project-breakdown.tsx)
  lines 90–135. Budget and commitments live in separate panels, not in
  this table (verified render order above). Projects without attributed
  monthly cost are excluded with an explicit empty message (lines
  139–143), so budget-only or commitment-only projects need a coverage
  check rather than an assumption of coverage.
- Budget comparison rules are strict and already vendor-grade: variance
  only for same project/currency/exact month; annual/partial budgets
  disclosed as incompatible, never apportioned; no commercial field ever
  read as budget; confirmed source required for a known zero; remaining
  equals approved minus confirmed and is explicitly not profit, revenue,
  or forecast — verified at
  [budget-comparison.ts](../../src/lib/company-expenditure/budget-comparison.ts)
  lines 5–22 and 74–83.
- [P] Real mode defaults to expenditure; Monthly/FY employee-cost views
  are separate; `sample=1` affects employee views
  ([page.tsx](../../src/app/reports/company-monthly-cost/page.tsx)
  lines 82–143).
- [P] Company reconciliation shows incurred company cost as
  project + overhead + unallocated with currency completeness, and
  whole-company totals are unaffected by the project-detail filter
  ([company-reconciliation.tsx](../../src/app/reports/company-monthly-cost/expenditure/company-reconciliation.tsx)
  lines 34–149).
- [P] The comparison panel already handles equal-elapsed-day month
  comparisons with prior amounts, deltas, and currencies
  ([comparison-panel.tsx](../../src/app/reports/company-monthly-cost/expenditure/comparison-panel.tsx)
  lines 43–145).
- [P] The budget section already has approved versioned project budgets
  with scope/period matching, variance, and over-budget states
  ([budget-section.tsx](../../src/app/reports/company-monthly-cost/expenditure/budget-section.tsx)
  lines 3–13, 44–75).
- [P] The close section already has financial-close state, frozen totals,
  blockers, and warnings
  ([close-section.tsx](../../src/app/reports/company-monthly-cost/expenditure/close-section.tsx)
  lines 87–185).
- None of the above are missing features; the recommendations below
  combine and surface existing data rather than building duplicate
  engines.

## Recommended report layout (recommendations, not product facts)

Decision-first, combining existing domain data. No new ledger, budget,
or commitment engine is proposed.

1. **Decision summary (top, new composition).** One strip answering:
   month status (open/closed), company incurred cost with
   month-over-month change, count of over-budget projects, count of
   projects with unconfirmed cost, count of blockers/warnings. Every
   figure links to its panel below. (Borrows D365's exception tabs and
   SAP's available-budget headline.)
2. **Project table (extend in place).** Add Budget, Variance, and
   Variance % columns to the existing project table from the data the
   budget section already computes — same project/currency/exact-month
   matching, incompatible periods shown as an explicit state, never
   apportioned. Keep incurred cost, change, cost-to-date, and evidence
   columns untouched.
3. **Two scopes, never mixed.** Show a Month scope (monthly budget vs
   monthly confirmed cost) and a Project-to-date scope (cumulative cost;
   cumulative or lifetime budget only where a matching-scope budget
   exists). Lifetime outstanding commitments must NOT sit beside a
   monthly budget as if subtractable: until commitments are time-phased,
   the combined "available" cell reads Missing with the reason stated.
   (This is the SAP/D365/Odoo funds-availability shape, honestly
   degraded.)
4. **Commitments stay a separate panel**, linked per project from the
   table, showing open value relieved-to-date where known. Do not merge
   into incurred cost or cash.
5. **Coverage row.** Explicitly list projects that have a budget or open
   commitments but no attributed monthly cost, so they are reviewable
   instead of invisible (the current table excludes them by design).
6. **Exceptions panel (new composition).** Over-budget projects,
   incompatible-period budgets, unconfirmed-cost projects, missing
   evidence, close blockers — each with owner action and deep link.
   (Borrows Oracle's exception report and D365's workspace queues.)
7. **Cash, close, and revisions stay separate sections** in the current
   order; cash is never a variance input, close freezes totals, revisions
   preserve prior figures (already the local rule; matches ERPNext
   cancel-retain and Odoo Rev semantics).

## Financial semantics to preserve (recommendations)

- Variance sign must be stated once and kept: recommend Budget − Actual
  (positive = under budget), matching D365, with ERPNext's caution that
  sign is only useful after the convention is confirmed.
- Remaining = approved − confirmed for Accent's matched scope; never profit,
  revenue, or forecast. Vendor definitions of remaining/available differ.
- For a proposed variance percentage, show unavailable when the budget is
  zero or missing. Keep the absolute variance when its inputs are supported.
- Scope matching before arithmetic: same project, same currency, same
  period — or an explicit incompatible/missing state. No cross-currency
  conversion inside a variance; reporting-currency translation stays a
  display column only.
- Commitments relieve on recognition: when a committed value becomes
  confirmed cost, the open commitment reduces. Report both the open and
  relieved figures where the data exists (SAP reduction, Odoo
  Committed/Achieved split).
- Cumulative columns are for plan pacing (ERPNext Show Cumulative, Odoo
  Theoretical), not for hiding a bad month: always keep the single-month
  column beside them.

## Phased priorities (recommendations)

- **Phase 1 — combine, don't build.** Decision summary strip; Budget /
  Variance / Variance % columns in the project table reusing the budget
  section's existing comparison; coverage row for budget-only and
  commitment-only projects; exceptions panel from existing states.
- **Phase 2 — time-phase commitments.** Attribute open commitments to
  expected months so a genuine per-month "available" figure becomes
  possible; until then keep the Missing cell honest.
- **Phase 3 — genuine forecasts only.** ETC/EAC with a named owner and
  stated scope per project, kept visibly separate from remaining budget;
  no forecast may be derived silently from remaining budget.

## Prerequisites and cautions (recommendations)

- Prerequisite: confirm the variance sign convention with finance before
  adding Variance % columns; a flipped sign is worse than no column.
- Prerequisite: verify the budget-only/commitment-only project coverage
  claim against live data before publishing the coverage row; the
  current table's exclusion is verified in source, the live extent is
  not.
- Caution: do not apportion annual budgets to months merely to fill cells.
  Accent's current rules forbid this. A future approved monthly budget profile
  would be a separate feature, not an inferred allocation.
- Caution: reuse existing budget and commitment engines. Phase 1 composes
  existing data; time-phased commitments and forecasts require additional
  domain data and rules.
- Caution: the SAP Help Portal S/4HANA pages and Fiori library entries
  could not be read statically; SAP claims here rest on the readable
  SAP Learning lessons and the static BW-content query document. Treat
  the two unread help URLs as leads, not evidence.

## Direct references

- SAP cost-center Actual/Plan/Variance query (strongest row-shape
  reference):
  <https://help.sap.com/saphelp_scm700_ehp02/helpdata/en/9d/038653aa9a6159e10000000a174cb4/content.htm?no_cache=true>
- SAP Learning, commitment management on cost centers (commitments as
  budget consumption, relief, carry-forward, budget report apps):
  <https://learning.sap.com/courses/cost-center-and-internal-order-accounting-in-sap-s-4hana/configuring-the-new-commitment-management-solution>
- SAP Learning, planning on cost centers (ACDOCP plan table, categories):
  <https://learning.sap.com/courses/cost-center-and-internal-order-accounting-in-sap-s-4hana/planning-on-cost-centers-and-internal-orders>
- D365 Finance budgeting overview (register entries, workspaces, inquiry
  drill-down):
  <https://learn.microsoft.com/en-us/dynamics365/finance/budgeting/basic-budgeting-overview-configuration>
- D365 Finance cost control workspace (variance formulas, thresholds,
  YTD columns, allocation drill-down):
  <https://learn.microsoft.com/en-us/dynamics365/finance/cost-accounting/cost-control-workspace>
- D365 Finance budget control (available-funds formula, warn/block
  rules):
  <https://learn.microsoft.com/en-us/dynamics365/finance/budgeting/budget-control-overview-configuration>
- D365 project actuals-vs-budget pattern (review cadence, scope limits):
  <https://learn.microsoft.com/en-us/dynamics365/guidance/business-processes/project-to-profit-pattern-analyze-actual-versus-budget>
- Business Central actual vs budget (minimal G/L Balance/Budget shape):
  <https://learn.microsoft.com/en-us/dynamics365/business-central/bi-how-analyze-actual-versus-budget>
- ERPNext Budget (Warn/Stop stages, annual + periodic checks, no GL
  effect):
  <https://docs.frappe.io/erpnext/budget>
- ERPNext Budget Variance Report (budget-driven rows, cumulative mode,
  GL reconciliation):
  <https://docs.frappe.io/erpnext/budget-variance-report>
- ERPNext Budget Revision (cancel-retain, amended-from traceability):
  <https://docs.frappe.io/erpnext/budget-revision>
- ERPNext Cost Center (stable hierarchy, Project dimension for
  projects):
  <https://docs.frappe.io/erpnext/cost-center>
- Odoo analytic budgets (Budgeted/Committed/Achieved/Theoretical,
  revise semantics):
  <https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/budget.html>
- Odoo analytic accounting (distribution, mandatory plans, models):
  <https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/analytic_accounting.html>
- Oracle Fusion budgetary control inquiry and reporting (funds
  available, exception reports):
  <https://docs.oracle.com/en/cloud/saas/financials/26b/faups/overview-of-budgetary-control-inquiry-and-reporting.html>
