## Problem Statement

The client needs to control monthly expenditure across project-based work. They need to identify expensive Projects, explain monthly increases, and understand money already committed to suppliers.

The current Employee Utilization report answers workforce questions. The Employee Project Monthly Cost report estimates employee cost from Salary Profiles and Logged Hours. Neither establishes complete company expenditure. Supplier costs, other expenses, Company Overhead, missing project allocations, and financial period controls are not reconciled together.

Summing orders, invoices, expenses, and payments would count the same cost repeatedly. Client order value can also be mistaken for supplier cost. Missing records currently risk appearing as zero expenditure.

The accepted design requires one monthly Company Incurred Cost reconciliation, with a Project breakdown. It must distinguish recorded cost, estimates, commitments, cash paid, and incomplete evidence.

## Solution

Provide a monthly company and project expenditure report backed by reliable cost-entry workflows and controlled financial periods.

Lead with Company Incurred Cost. Reconcile it to direct Incurred Project Cost, Company Overhead, and Unallocated Cost, with each underlying cost counted once. Keep Outstanding Supplier Commitment, cash paid, and client order value separate.

Open on the current month with estimates clearly identified. Rank Projects by monthly cost and monthly increases. Explain changes through employee, supplier, and other expense details. Preserve closed figures and record corrections as explicit revisions.

Keep Employee Utilization as a workforce report. Expand the employee-project cost reporting capability into this financial view. Do not present a visual redesign without the source classification, document links, and monthly-close controls needed for reliable totals.

## User Stories

1. As a business owner, I want monthly Company Incurred Cost, so that I can control company expenditure.
2. As a business owner, I want direct Project costs, Company Overhead, and Unallocated Cost separated, so that totals reconcile.
3. As a business owner, I want the current month opened by default, so that I see current cost growth.
4. As a business owner, I want estimates distinguished from recorded amounts, so that I understand their certainty.
5. As a business owner, I want closed months available, so that I can inspect stable historical costs.
6. As a business owner, I want Projects ranked by monthly cost, so that I can identify the largest costs.
7. As a business owner, I want Projects ranked by monthly increases, so that I can investigate rising costs.
8. As a Project manager, I want employee, supplier, and other direct costs separated, so that I can explain expenditure.
9. As a Project manager, I want monthly employee hours beside employee cost, so that I can explain effort changes.
10. As a Project manager, I want employee-level cost details, so that I can identify staffing cost drivers.
11. As a Project manager, I want source expense details, so that I can explain non-employee cost changes.
12. As a Project manager, I want cost to date, so that I can understand cumulative Project consumption.
13. As a Project manager, I want Outstanding Supplier Commitment, so that I can see ordered work not yet consumed.
14. As a business owner, I want client order value shown separately, so that I do not mistake sales context for cost.
15. As a business owner, I want cash paid shown separately, so that payment timing does not distort cost comparisons.
16. As a finance operator, I want both payroll and contract pay streams included, so that employee cost coverage is complete.
17. As a finance operator, I want recorded Payroll Slip employer cost allocated, so that Project costs reconcile with payroll.
18. As a finance operator, I want earnings and employer contributions included once, so that payroll cost is correct.
19. As a finance operator, I want Project shares based on each Employee's Logged Hours, so that attribution is traceable.
20. As a finance operator, I want hours without a Project disclosed, so that their cost remains visible.
21. As a finance operator, I want payroll cost without Logged Hours disclosed, so that missing evidence does not inflate Projects.
22. As a finance operator, I want missing payroll or pricing data identified, so that unknown cost never appears as zero.
23. As a finance operator, I want employee allocations frozen at payroll finalization, so that later timesheets cannot change history silently.
24. As a finance operator, I want Project Cost Allocation Revisions, so that I can correct attribution without changing payroll cost.
25. As a reviewer, I want prior allocations and correction reasons preserved, so that changes remain auditable.
26. As a finance operator, I want historical allocations reconstructed once, so that older Payroll Slips can support Project history.
27. As a reviewer, I want reconstructed allocations labelled and reviewed, so that they are not mistaken for original snapshots.
28. As a cost-entry operator, I want Project, Company Overhead, or unresolved classification, so that every expense has an explicit destination.
29. As a cost-entry operator, I want a recognition period, so that cost appears when work or services are received.
30. As a finance operator, I want invoice date used only as a disclosed fallback, so that uncertain service periods remain visible.
31. As a finance operator, I want evidenced Cost Accruals for received work, so that uninvoiced cost is included.
32. As a finance operator, I want an invoice linked to its Cost Accrual, so that the estimate is replaced without duplication.
33. As a finance operator, I want drafts and pending evidence separated, so that they do not become confirmed cost.
34. As a finance operator, I want rejected and cancelled records excluded from active cost, so that invalid costs do not inflate totals.
35. As a finance operator, I want closed-period corrections preserved, so that cancellation cannot erase historical evidence.
36. As a procurement operator, I want client and supplier orders classified explicitly, so that order direction is reliable.
37. As a procurement operator, I want ambiguous historical orders queued for review, so that guesses cannot create commitments.
38. As a procurement operator, I want one authoritative identity per supplier order, so that duplicate stores do not inflate commitments.
39. As a procurement operator, I want recognized consumption linked to supplier orders, so that remaining commitments are accurate.
40. As a finance operator, I want supplier invoices and payable follow-ups linked, so that one liability creates one cost.
41. As a finance operator, I want expense receipts linked to their underlying cost, so that repeated entries do not duplicate expenditure.
42. As a petty-cash operator, I want funding separated from actual spending, so that vouchers are not mistaken for expenses.
43. As a finance operator, I want voucher funding and mirrored credits counted once, so that cash movement is not duplicated.
44. As a finance operator, I want client receipts excluded from expenditure, so that incoming cash cannot become cost.
45. As a finance operator, I want dated outward payments linked to liabilities or advances, so that monthly cash paid is supported.
46. As a finance operator, I want recoverable GST identified with evidence, so that eligible tax is excluded from cost.
47. As a finance operator, I want non-recoverable tax included appropriately, so that expense or asset cost is not understated.
48. As a finance operator, I want tax withholding separate from cost, so that deductions do not reduce underlying expenditure.
49. As a finance operator, I want capital purchases, advances, deposits, and prepayments classified separately, so that cash outflow is not expensed automatically.
50. As a finance operator, I want period consumption or depreciation captured where applicable, so that operating cost reflects the correct period.
51. As a finance operator, I want transaction currency and conversion evidence, so that different currencies are not added incorrectly.
52. As a business owner, I want equivalent elapsed-period comparisons, so that an unfinished month does not appear artificially cheaper.
53. As a business owner, I want late entries and coverage differences disclosed, so that comparisons do not hide incomplete evidence.
54. As a business owner, I want missing source coverage identified, so that empty records do not imply no expenditure.
55. As a finance operator, I want Company Overhead separate from unknown allocation, so that unresolved costs are not classified by guesswork.
56. As a finance operator, I want company totals unaffected by Project filters, so that filtered details do not replace the company reconciliation.
57. As a finance operator, I want a controlled financial close, so that reviewed monthly totals remain stable.
58. As a reviewer, I want close blockers and acknowledged coverage gaps, so that incomplete months cannot be called complete.
59. As a reviewer, I want explicit financial revisions, so that corrections preserve actor, reason, evidence, and prior figures.
60. As a finance operator, I want payroll finalization distinct from financial close, so that supplier costs and accruals are reviewed separately.
61. As an authorized report reader, I want Excel output to match the selected report view, so that exported decisions use the same figures.
62. As an authorized report reader, I want evidence state and revision information in exports, so that downloaded figures remain understandable.
63. As an administrator, I want financial access enforced on screens and requests, so that sensitive costs are not exposed by Project access alone.
64. As a business owner, I want direct source documents behind report totals, so that I can investigate a cost without another reconciliation.
65. As a business owner, I want budgets compared only on matching scope and currency, so that commercial values do not masquerade as cost budgets.
66. As a business owner, I want order value excluded from profit claims, so that the report does not invent recognized revenue.
67. As a finance operator, I want fixture records excluded from business totals, so that test data does not affect financial decisions.
68. As a reviewer, I want repeatable end-to-end evidence, so that I can verify cost recognition and financial controls independently.

## Implementation Decisions

### Financial model and module interface

- Respect ADR-0016, ADR-0017, the existing Payroll Slip snapshot rule, and the documented payroll pay formula. Use the domain glossary terms throughout screens, payloads, exports, and documentation.
- Use one deep financial reporting module for monthly reconciliation, Project breakdown, evidence state, financial close, and revisions. Existing cost-entry and payroll modules feed this module; screens and Excel output consume the same financial interpretation.
- Reuse the existing database pool, Decimal money operations, formatters, authenticated request handling, and report/export conventions. Do not create parallel salary, currency, or date calculations.
- Company Incurred Cost equals direct Incurred Project Cost plus Company Overhead plus Unallocated Cost, counted once. Project filters narrow Project detail and its subtotal, not the unfiltered company reconciliation.
- An Employee's recorded employer cost is allocated using each Project's share of all eligible monthly Logged Hours. Hours without a reliable Project remain in the denominator and their share remains Unallocated Employee Cost. No Logged Hours means the full recorded cost stays unallocated, not redistributed to Projects.
- Include both payroll and contract pay streams regardless of Employee Type. Do not inherit the Utilization report's narrower Payroll Roster as the financial scope.
- Preserve monetary precision until the output boundary. Persist a deterministic cent-level allocation whose Project and unallocated amounts sum exactly to each Payroll Slip employer cost. Keep the rounding adjustment attributable and reproducible.
- A missing amount is unknown, not zero. Distinguish known zero, absent evidence, provisional estimate, reconstructed allocation, and recorded closed amount. Show supported subtotals with coverage warnings rather than inventing a complete grand total.

### Cost capture and recognition

- Extend all relevant expense-entry workflows, including supplier invoices, other expenses, petty-cash spending, and payroll attribution. Capture Project or deliberate Company Overhead classification; retain an explicit unresolved state where evidence is missing.
- Store the recognition period, source identity, approval/recognition state, source amount, tax treatment, original currency, and evidence references. Supplier work spanning periods must support period-specific cost recognition without counting the full invoice in each period.
- Recognize operating cost when goods, work, or services are received. Invoice or bill date is a disclosed fallback only when the service period is unavailable. PO date and payment date do not determine operating expense recognition.
- Add evidenced Cost Accrual capture and links to replacement invoices. A replacement reverses or supersedes the corresponding accrual amount in the same cost chain; partial replacement leaves the unmatched accrual visible. Never count the accrual and replacement invoice in full together.
- Drafts and pending evidence are not confirmed incurred cost. Approval must establish the recognition state explicitly. Rejected, cancelled, or deleted source records cannot silently create active cost.
- Keep deliberate Company Overhead separate from Unallocated Cost. Do not automatically spread either across Projects. Project-level overhead allocation requires an independently approved policy and is not introduced by this specification.
- Review the observed payroll bonus composition issue before publishing current-month employer-cost estimates. The same bonus must not increase both employee earnings and employer contributions. Correct the payroll composition through its existing module; do not patch the report or silently rewrite historical Payroll Slips. Preserve ADR-0010's pay formula.

### Source identity, order direction, and payments

- Establish one authoritative identity for each underlying cost and order. Retain reviewable mappings for legacy copies; migrate consumers to canonical references rather than retaining competing cost truth or deprecated write paths.
- Classify orders explicitly as client orders or supplier orders. Table names, counterparty text matches, or the existence of a client invoice link are insufficient historical direction evidence. Ambiguous orders remain exceptions until document-backed review resolves them.
- Use reliable relational references for Projects, orders, supplier invoices, Cost Accruals, receipts, and settlements. Do not use free-text PO number alone as identity across stores. Preserve document numbers as display and search attributes.
- Outstanding Supplier Commitment is supplier order value not yet consumed by recognized goods or services, including recognized accruals. Calculate opening commitment, new commitment, consumption, cancellation, and closing commitment on a consistent tax and currency basis.
- Client order value is separate commercial context. Do not include it in incurred cost, supplier commitments, or recognized revenue.
- A supplier invoice and its payable follow-up represent one underlying cost. An expense receipt recorded in another register must reference that same cost rather than create another cost automatically.
- Petty-cash funding is not expense recognition. The voucher and its mirrored funding credit represent one cash funding event. Actual spending creates or settles its underlying expense once.
- Client payment entries are receipts, not expenditure. Outward settlements and advances need dated evidence and links. Cumulative paid amounts without payment dates cannot establish monthly cash paid.
- Keep outward bank/cash movement separate from internal transfers, funding credits, and settlements of already recognized cost. Disclose incomplete payment coverage. Do not fabricate a monthly cash total from status flags or current balances.
- Dated outward cash paid (#318) is the month's recorded settlements plus native payroll payouts (mark-paid `payment_status='paid'` with a real `payment_date`) plus dated petty-cash spending, each counted once by canonical movement identity. A manual settlement never restates a native movement. Bank-into-float funding is one internal movement per voucher shown outside paid. Withholdings and deductions are settlement destinations against the same liability, never cost reductions. Client receipts, internal transfers, undated balances, and unlinked free-text rows are disclosed as legacy evidence, never counted.

### Tax, currency, assets, and completeness

- Track recoverable, non-recoverable, and unresolved tax treatment using evidence. Exclude confirmed recoverable GST from incurred cost; include non-recoverable tax in the relevant expense or asset. Show gross liability separately. Do not assume all stored tax is eligible for credit.
- Employee deductions and TDS affect settlement, not underlying incurred cost. Do not subtract them from cost or add their remittance as another expense.
- Capture advances, deposits, prepayments, and capital items separately from operating cost. Capture or import supported period consumption, depreciation, or amortization; do not expense their full payment automatically.
- Store transaction currency and reporting currency with effective conversion evidence. Do not infer historical currency from a Project's current default. Unconverted amounts stay in currency-specific subtotals with a coverage exception, not a mixed-currency total.
- Budget variance requires an approved cost budget with matching scope and currency. Do not infer a cost budget from client PO value, a quote, or a generic commercial value. A missing budget does not prevent cost reporting.
- Do not label client order value minus incurred cost as profit. Cost plus commitments also excludes uncommitted future work and is not a complete forecast.
- Make incomplete source coverage visible independently of record counts. Finance must review expected payroll, supplier costs, expenses, accruals, and cash evidence before declaring a month complete. Empty stores alone do not satisfy completeness.

### Schema, lifecycle, and API contracts

- Use migrations for durable cost identities, source mappings, recognition records, supplier-consumption links, accrual replacement links, dated settlements, financial periods, employee allocation snapshots, and revision history. Extend existing records where that preserves one source of truth; do not run DDL in request handlers.
- Save immutable closed figures with actor, timestamp, source references, amounts, classification, currency/tax basis, evidence state, and version. A mutable activity description alone is not a financial revision record.
- Payroll finalization atomically freezes employee allocation with the applicable Payroll Slips. A later timesheet or Salary Profile edit cannot silently change those allocations.
- Monthly financial periods have an explicit open/closed lifecycle. Financial close is separate from payroll finalization and requires reconciliation, evidence review, and coverage approval. Unresolved gaps remain visible; an incomplete month must not be labelled complete.
- Closing, allocation reconstruction, and revision commands are atomic and reject stale versions. Repeated successful requests must not duplicate allocations, cost recognition, accrual replacement, or settlements. Concurrent close or revision requests must preserve one coherent financial version.
- Corrections to closed periods use explicit, reasoned revisions preserving prior figures and source evidence. Ordinary edits, deletion, reclassification, or cancellation cannot bypass this control. Allocation revisions do not modify the Payroll Slip itself or bypass payroll reopening restrictions.
- For finalized historical payroll without allocation snapshots, reconstruct once using recorded employer cost and available timesheets. Record reconstruction time and evidence limitations, require review, then freeze. Missing historical evidence remains unresolved rather than invented.
- Historical financial totals retain their frozen Project and source identity even if a current master is renamed or soft-deleted. Open operational reads follow the existing soft-delete rules; removal of recognized closed cost requires an explicit revision or reversal.
- Report requests identify the month or comparable period, selected Project scope, reporting currency, and financial version where applicable. Responses expose company reconciliation, filtered Project details, recorded and estimated amounts, commitments, supported cash evidence, coverage exceptions, and close/revision metadata.
- Command requests identify the target source or period, intended operation, reason/evidence, and expected version. Validation, authorization, missing evidence, and version conflicts return explicit failures; no failed command leaves partial financial writes.
- Apply existing RBAC and session rules to reads, exports, recognition, financial close, reconstruction, and revisions. Use existing source authorization and financial privileges; Project Activity access alone must not authorize all supplier, payroll, or company expenditure data. Unauthorized users receive neither sensitive records nor aggregates, and failed commands change no data.
- The report, drilldown, and Excel output must use the same period, currency, scope, financial version, evidence states, and financial interpretation. Preserve the existing employee-cost report's useful month and financial-year navigation through the expanded financial model; migrate its consumers rather than leaving a competing legacy calculation.

### User interactions

- Open on the current month. Clearly show recorded cost and estimated additions, source coverage, Company Overhead, Unallocated Cost, Outstanding Supplier Commitment, and supported cash paid.
- Show Project/client identity, employee cost, supplier/subcontract cost, other direct expense cost, total monthly incurred cost, change from the comparable period, Logged Hours, cost to date, supplier commitment, and evidence state.
- Provide largest-cost and largest-increase ordering. Drill down to Employees and authoritative source documents, including unresolved allocations and pending evidence.
- Compare equivalent elapsed service periods for an unfinished month. Disclose late invoices, backdated recognition, missing source coverage, and differing evidence completeness. A prior zero cost has no meaningful percentage increase; show the absolute change and a clear new-cost state instead.
- Provide reviewed historical versions and revision details. Export the same company reconciliation and selected Project detail without dropping incomplete-data warnings or reconstruction labels.
- Maintain the existing Employee Utilization purpose, calculations, and access contract. It is not the complete expenditure report.

## Testing Decisions

- The user confirms the existing real-app Playwright and MySQL end-to-end seam. This is the sole primary feature verification seam. Exercise the authenticated application and its real request interfaces, then verify persisted financial evidence independently.
- Extend the established namespaced fixture approach and dedicated database safety checks. Do not alter real operational Projects, payroll months, supplier records, or financial closes. Cleanup and reruns must stay isolated and deterministic.
- Prior art is the Payroll Money flow for independent payroll calculations and persisted verification, Employee Utilization for report/drilldown/Excel behavior, Soft Delete for historical removal behavior, and security flows for authorization outcomes.
- Test the whole expenditure workflow: source capture, recognition, order consumption, allocation, reconciliation, financial close, revisions, report output, and Excel download. Do not add mocked route-handler, page, or component tests, source-text pins, or tests of forwarding/wiring.
- Expected values come from independently stated fixture amounts and business rules, not the report module's own aggregation functions. Verify numerical outcomes, period attribution, visible evidence states, failed-operation behavior, and stored immutable versions.
- Keep existing pure-logic tests green. They are not a replacement for end-to-end proof and do not need extension merely to mirror new implementation details.

Required end-to-end scenarios:

1. Reconcile a mixed month containing direct employee cost, supplier cost, other expense, Company Overhead, and Unallocated Cost. Verify every source contributes exactly once.
2. Allocate one Employee across two Projects and hours without a Project. Verify denominator handling, cent-level reconciliation, both pay streams, and Project filter behavior.
3. Keep nonzero recorded payroll cost without Logged Hours fully unallocated. Distinguish it from known zero cost and missing Payroll Slips or Salary Profiles.
4. Generate payroll with bonus enabled and prove that the bonus contributes once to employer cost. Verify stored historical slips remain unchanged by report generation.
5. Recognize received supplier work before invoicing, consume its supplier commitment, then replace the accrual with partial and final invoices. Verify unchanged underlying cost and no duplicate recognition.
6. Use a September service period, October invoice, and November payment. Verify September incurred cost, November cash movement, and no payment-created expense.
7. Represent a supplier invoice with a payable follow-up and another receipt reference. Verify a single cost and traceable source links.
8. Fund petty cash through a voucher and mirrored credit, then record spending. Verify funding is not operating cost and spending is counted once.
9. Keep client orders and receipts outside expenditure. Reject ambiguous PO classification from automatic commitment calculations; expose the unresolved evidence.
10. Reduce commitments through recognized consumption and cancellation on consistent tax/currency bases. Verify partial consumption, revisions, and zero outstanding balance without counting full PO plus invoice.
11. Verify confirmed recoverable tax, non-recoverable tax, unresolved tax, withholding, and dated settlement treatment without changing the underlying expense incorrectly.
12. Classify an advance, prepayment, deposit, and capital purchase. Verify payment is separate from supported period consumption or depreciation.
13. Verify mixed currencies with supported conversion and a missing conversion rate. No mixed-currency aggregate may appear complete.
14. Compare an unfinished month with equivalent prior elapsed service periods. Verify late-entry disclosure, missing coverage, zero prior-period handling, and correct cost ranking.
15. Freeze employee allocations at payroll finalization. Change current timesheets and Salary Profiles; verify recorded allocation stability and explicit revision history.
16. Reconstruct a historical allocation lacking saved shares. Verify review, reconstruction labels, missing-evidence handling, and subsequent freeze.
17. Close a reconciled financial month. Verify payroll finalization alone does not close it; incomplete coverage cannot be labelled complete.
18. Attempt ordinary edits, soft deletion, cancellation, and reclassification affecting closed costs. Verify preserved history and the required explicit correction workflow.
19. Exercise concurrent or repeated close, revision, accrual-replacement, and allocation commands. Verify atomic results, version conflicts, and no duplicated financial records.
20. Rename or soft-delete a Project/master after close. Verify historical identity and amounts remain available without reintroducing deleted rows into open operational totals.
21. Exercise unauthorized reads, exports, recognition, reconstruction, close, and revisions. Verify no sensitive values or writes escape authorization checks.
22. Compare the browser, report response, and Excel output for the same month, filters, currency, and revision. Verify numerical agreement and complete evidence disclosures.
23. Verify an empty cost store and missing expected payroll remain coverage warnings, not proof of zero company expenditure. Exclude fixture data from business scope.

Every flow writes a repeatable JSON evidence artifact containing fixture scope, expected and observed financial totals, recognition periods, allocation/commitment reconciliation, close/revision identifiers, and relevant failures. Re-running the committed end-to-end harness must regenerate the evidence. Browser verification must exercise the actual report and source-entry controls, not only request calls.

## Out of Scope

- A general ledger, bank-feed integration, or replacement accounting system. Reconciliation uses available control evidence; this feature does not certify the books.
- Audited financial statements, statutory compliance certification, tax filing, or automatic GST eligibility decisions without supporting evidence.
- A new revenue recognition or profitability engine. Client order value remains commercial context, not recognized revenue or profit.
- Automatic allocation of Company Overhead or unknown costs to Projects without an approved policy.
- Guessing supplier/client direction, duplicate identity, currency, missing invoices, or historical service periods from names and defaults.
- Automatic forecasts of uncommitted future work or treating incurred cost plus commitments as a complete Project forecast.
- A complete fixed-asset register or tax depreciation engine. Capture or import applicable approved period costs instead.
- Changing Employee Utilization's workforce scope or formulas, or changing the documented payroll pay formula.
- Silent historical Payroll Slip regeneration or rewriting paid payroll. The payroll bonus composition correction must preserve the existing snapshot and reopening rules.
- Destructive production cleanup or automatic merging of ambiguous historical documents. Historical review preserves source evidence and requires authorized decisions.

## Further Notes

- The user confirms the company-and-project cost model and the real-app end-to-end test seam. This issue specifies implementation; the preceding research itself changed no application code or database records.
- The data profile is dated 2026-10-06 and comes from the connected development database, not verified production coverage. It shows six live Projects, five Payroll Slips across June–October, and empty live non-employee cost stores.
- September has 2,930 Logged Hours, of which 2,922 have no Project ID. One pending PO has conflicting client/supplier evidence and a draft client invoice link. These are evidence gaps, not a complete financial baseline or production acceptance fixture.
- Four finalized Payroll Slips lack saved original hours inputs. Historical reconstruction cannot claim original finalization-time Project attribution.
- A runtime smoke scenario confirms that a 1,000 bonus currently increases employer cost by 2,000. The five inspected slips have zero bonus, so this specific issue does not affect those stored records. The implementation must correct the current calculation without silently repricing historical payroll.
- ADR-0016 governs recorded employer-cost allocation, both pay streams, unallocated employee cost, freeze/revisions, and reviewed reconstruction. ADR-0017 governs the separation of incurred cost, supplier commitments, cash paid, and client order value. Existing Payroll Slip snapshot and pay-basis decisions remain authoritative.
- The accounting research uses official ICAI Ind AS and accrual guidance. It supports management reporting, not a claim that every accounting standard applies wholesale to this company.
- Complete delivery includes reliable source capture, canonical references, backfill review, financial controls, report and Excel consumers, documentation, and rerunnable end-to-end evidence. A report showing plausible totals over incomplete or duplicated sources is not acceptance.
