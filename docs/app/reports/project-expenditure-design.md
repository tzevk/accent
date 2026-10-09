# Monthly company and project expenditure — accepted design

Status: design confirmed by the user on 2026-10-06. Confirmation covers the cost model and required controls, not implementation authorization. No reporting implementation or database mutation is part of this research.

## Conclusion

Use one monthly cost reconciliation, with a project breakdown. Do not build company expenditure by summing project totals alone. Some legitimate costs are company overhead; other costs lack a reliable project allocation.

Lead with incurred cost. Show cash paid, outstanding supplier commitments, and client order value separately. These measures overlap or have different meanings; adding them produces a false expenditure total.

Keep Employee Utilization as a workforce report. Refine the project-cost report into a project expenditure view, rather than presenting employee utilization as complete financial expenditure.

## Connected data checked

Read-only aggregate queries on 2026-10-06 inspected `accent_crm_dev_muse`. This is the connected development database, not verified production coverage. Queries returned no employee names, individual pay, bank details, or document numbers. E2E fixtures exist and must be excluded from business reporting.

| Stored source        | Live records | Observation                                                                                                                       |
| -------------------- | -----------: | --------------------------------------------------------------------------------------------------------------------------------- |
| Projects             |            6 | Project identity is available.                                                                                                    |
| Employees            |           27 | Includes 2 namespaced E2E employees.                                                                                              |
| Payroll Slips        |            5 | One slip in each month June–October 2026. June–September runs are finalized and the slips paid. October is draft.                 |
| Activity assignments |           32 | 13 assignment rows carry a project id. Entries need month-level profiling; row counts do not measure monthly allocation coverage. |
| Expenses             |            0 | No live recorded expense cost in this connection.                                                                                 |
| Purchase invoices    |            0 | No live recorded supplier invoice cost.                                                                                           |
| Payment payables     |            0 | No live payable records.                                                                                                          |
| Other expenses       |            0 | No live records; schema has no project link.                                                                                      |
| Petty-cash expenses  |            0 | No live records; project can only be inherited through a linked voucher today.                                                    |
| Cash vouchers        |            0 | No live records.                                                                                                                  |
| Payment issues       |            0 | No live outward-payment records.                                                                                                  |

September 2026 has 2,930 positive Logged Hours from 379 entries. Only 8 hours match a live Project; 2,922 do not. The employee resolution used the direct Employee link or linked User's Employee link, and resolved 19 live Employees. These September hours contain no namespaced E2E Employee hours. The 104 hours in January 2019 belong to an E2E Employee and are not business history.

The four finalized slips have no stored CTC/Basis Hours/Logged Hours inputs. The October draft slip has those inputs. Existing snapshots can support recorded employee totals, but historical project shares require the reconstruction, review, and freeze process in ADR-0016. One slip per month does not prove that the company's whole payroll is captured.

An empty source means no recorded evidence here, not proof that the company incurred no cost. Show coverage warnings until finance confirms completeness.

## Recommended cost model

Monthly company incurred cost equals:

- Project-attributed employee cost.
- Project-attributed supplier and other direct expense cost.
- Deliberately classified company overhead.
- Recognized cost awaiting project or overhead classification.

Each cost belongs to exactly one of these groups. Unallocated cost is not automatically overhead or Bench Cost.

For each Project, show direct employee cost plus recognized direct non-employee cost. Keep optional overhead allocation separate from direct cost. If finance later approves an allocation driver, show the driver and amount; do not redistribute shared or unknown costs silently.

### Recognition

Recognize operating cost when work, services, or consumable benefits are received, not when a PO is issued or money is paid. Record a service/expense period explicitly. An invoice or bill date may be a disclosed fallback when the service period is unavailable; it is not proof of the true service month.

Employee cost uses the recorded payroll employer-cost component and frozen monthly project shares from ADR-0016. Current-month employee cost is provisional and uses the payroll calculation, not the client billing rate.

Show uninvoiced work already received as an estimated accrual when finance provides evidence. Link the later invoice to the accrual and replace or reverse it, so both never remain in cost. Do not invent accruals from unused PO balances.

Draft and pending records belong in a review queue, not confirmed cost. Recognized cost needs an explicit approval/recognition state. Rejected, cancelled, and soft-deleted records do not become active cost merely because a payment field is populated. Closed-period reversals must preserve history.

### Tax, assets, and currency

Exclude confirmed recoverable GST from incurred cost. Include non-recoverable tax in the applicable expense or asset cost. Track tax eligibility rather than assuming every recorded GST amount is recoverable. Keep gross invoice liability and tax separate for cash planning.

Do not deduct TDS or employee deductions from incurred cost. They change settlement destinations, not the underlying employee or supplier cost.

Capital purchases, advances, deposits, and prepayments are not automatically operating expenses in their payment month. Track cash movement separately. Recognize depreciation, consumption, or the covered service period where applicable.

Keep source currency and reporting currency. Do not sum currencies without recorded conversion rates. The current project and cost schemas use inconsistent currency coverage; a default currency does not prove transaction currency.

### Orders, invoices, expenses, and payments

- Client PO/order value is sales context, not cost or recognized revenue.
- Verified supplier orders are commitments, not incurred cost until the work or goods are received.
- Remaining supplier commitment uses the same amount and currency basis as its recognized consumption.
- Supplier invoice cost and its payable follow-up represent one underlying cost, not two.
- A cash voucher funding petty cash and its mirrored petty-cash credit are one funding event, not two expenses.
- An actual petty-cash spend is separate from its funding. Count its underlying expense once, even if its receipt is also recorded elsewhere.
- Client payment entries are receipts, not expenditure.
- Outward payment records settle liabilities or fund advances; they do not create another expense.

Do not infer order direction from table names, amount signs, or a client/vendor name match alone. Existing order stores have contradictory labels and duplicate representations. Verify direction and designate one source record per order. Until resolved, show ambiguous orders in a data-quality queue, not a fabricated supplier commitment total.

## Report output

Open on the current month and clearly distinguish provisional amounts from recorded closed-period costs.

Company summary:

- Recorded incurred cost and estimated additions, shown separately.
- Project-attributed cost, company overhead, and unallocated cost.
- Outstanding supplier commitments, shown separately.
- Cash paid only where dated, linked payment evidence supports the measure.
- Missing payroll, unresolved project links, ambiguous orders, pending cost records, and incomplete source coverage.

Project table:

- Project and client.
- Employee cost, supplier/subcontract cost, and other direct expense cost.
- Total incurred direct cost and month-to-month change.
- Employee hours and non-employee source details explaining the change.
- Cost to date and outstanding supplier commitment, with clear period/as-of labels.
- Client order value as commercial context, not another cost column.
- Evidence state: recorded, estimated, reconstructed, or incomplete.

Rank by the largest monthly costs and largest increases. Drill down from a Project to Employees and underlying documents. A finalized invoice received after the work month may restate cost, not imply a sudden rise in work performed.

For an unfinished month, compare equivalent elapsed service periods. Also disclose late invoices or backdated entries; equal calendar cutoffs alone do not establish equivalent data completeness. Do not show a favorable percentage against a full previous month.

Do not call client order value minus cost "profit". Order value is not recognized revenue, and incurred cost plus supplier commitments excludes future uncommitted work. Budget variance requires an approved cost budget on the same currency and scope, not an unchecked project value field.

## Required data improvements

These are prerequisites for complete, reliable reporting, not optional visual polish:

1. Capture a Project or explicit company-overhead classification in every cost entry workflow. Preserve legitimate shared costs and unresolved allocations separately.
2. Capture recognition period, approval state, original currency, tax eligibility, and unique source identity.
3. Classify supplier versus client orders, replace duplicate stores with canonical references, and link supplier invoices or accruals to the right supplier order.
4. Link payments to liabilities or advances, and receipts to their underlying expense, so they cannot create duplicate cost.
5. Add controlled monthly financial close. Payroll finalization freezes employee allocation; it does not close supplier costs, accruals, or the company's whole month.
6. Preserve closed totals and explicit revisions. Existing financial UPDATEs and activity descriptions do not reconstruct prior versions.
7. Require coverage reconciliation before calling a month complete: recorded company cost equals project cost plus overhead plus unallocated recognized cost.

## Payroll calculation risk observed

A throwaway runtime scenario exercised `calculatePayroll` through Vite's server module loader without database writes. With employee and hours unchanged, increasing bonus from 0 to 1,000 increased total earnings by 1,000, employer contributions by 1,000, and employer cost by 2,000. Bonus appears in both sums (`src/utils/payroll-calculation.js:509-519,741-753`).

The five stored slips have zero bonus, so this specific issue is not present in those records. Do not silently rewrite historical payroll cost in a report. Review and correct payroll composition through the payroll process before treating new employer-cost calculations as authoritative.

## Evidence and references

- Agreed employee-cost behavior: `docs/adr/0016-project-employee-cost-from-recorded-payroll.md`.
- Agreed cost/commitment boundary: `docs/adr/0017-project-incurred-cost-and-commitments-are-separate.md`.
- Accounting principles and official references: `project-expenditure-accounting.md`.
- Payroll snapshot input columns: `migrations/20260925120000_add_slip_hours_basis_columns.js:13-20`.
- Supplier invoice project/order fields: `src/app/api/admin/purchase-invoices/route.js:186-224`.
- Expense project field: `src/app/api/admin/expenses/route.js:159-186`.
- Voucher-to-petty-cash funding: `src/app/api/admin/cash-vouchers/route.js:237-256`.
- In-place supplier invoice updates: `src/app/api/admin/purchase-invoices/[id]/route.js:95-124`.

### Reproducible connected-data checks

```sql
SELECT DATABASE() AS connected_database;

SELECT 'expenses' AS source, COUNT(*) AS live_rows FROM expenses WHERE isDelete = 0
UNION ALL SELECT 'purchase_invoices', COUNT(*) FROM purchase_invoices WHERE isDelete = 0
UNION ALL SELECT 'payment_payables', COUNT(*) FROM payment_payables WHERE isDelete = 0
UNION ALL SELECT 'other_expenses', COUNT(*) FROM other_expenses WHERE isDelete = 0
UNION ALL SELECT 'petty_cash_expenses', COUNT(*) FROM petty_cash_expenses WHERE isDelete = 0
UNION ALL SELECT 'cash_vouchers', COUNT(*) FROM cash_vouchers WHERE isDelete = 0
UNION ALL SELECT 'payment_issues', COUNT(*) FROM payment_issues WHERE isDelete = 0;

SELECT DATE_FORMAT(s.month, '%Y-%m') AS pay_month,
       COALESCE(r.status, 'no-run') AS run_status,
       COUNT(*) AS slip_count,
       SUM(s.logged_hours IS NOT NULL AND s.basis_hours IS NOT NULL
           AND s.ctc_used IS NOT NULL) AS slips_with_hours_basis
FROM payroll_slips s
LEFT JOIN payroll_runs r ON r.year = YEAR(s.month) AND r.month = MONTH(s.month)
GROUP BY DATE_FORMAT(s.month, '%Y-%m'), COALESCE(r.status, 'no-run')
ORDER BY pay_month;
```

The timesheet profiling expands each JSON payload up to its observed maximum of 23 entries, keeps positive numeric `hours`, groups by the date's `YYYY-MM`, and checks the live Project join. Its entry count and hour totals describe stored numeric evidence, not a full review of timesheet completeness or attribution accuracy.

### Stored order and commercial coverage

A separate read-only aggregate profile found one live `purchase_orders` record, in pending state, linked to a live Project and company. One draft client invoice references that PO; its invoice date is missing. The supplier master has no live records. `outgoing_purchase_orders`, `project_purchase_orders`, `project_invoices`, and `purchase_invoices` are empty.

The PO has conflicting client/supplier evidence. Do not treat it as a confirmed supplier commitment or subtract the client invoice from it to calculate supplier commitment. No reliable supplier-commitment total is established by these records.

All six live Projects store INR as their currency. Five have a populated project value; none has populated `cost_to_company` or `actual_profit_loss`. The project values are commercial context, not a substitute for cost. Currency-less financial records still need explicit transaction currency; matching the Project's current currency is not historical proof.

### Reproducible monthly hours profile

The executed query below covers 30 entries per payload. The inspected database's maximum was 23. Increase the index range before reusing this query if the maximum grows; never silently truncate a later dataset.

```sql
SELECT LEFT(x.entry_date, 7) AS log_month,
       COUNT(*) AS positive_hour_entries,
       SUM(x.hours) AS logged_hours,
       SUM(CASE WHEN x.live_project = 1 THEN x.hours ELSE 0 END) AS hours_with_live_project,
       SUM(CASE WHEN x.live_project = 0 THEN x.hours ELSE 0 END) AS hours_without_live_project,
       COUNT(DISTINCT x.employee_id) AS resolved_live_employees,
       SUM(CASE WHEN x.is_e2e = 1 THEN x.hours ELSE 0 END) AS e2e_employee_hours
FROM (
  SELECT JSON_UNQUOTE(JSON_EXTRACT(a.daily_entries,
             CONCAT('$[', d.n + 10 * t.n, '].date'))) AS entry_date,
         CAST(JSON_UNQUOTE(JSON_EXTRACT(a.daily_entries,
             CONCAT('$[', d.n + 10 * t.n, '].hours'))) AS DECIMAL(12,2)) AS hours,
         CASE WHEN p.project_id IS NOT NULL THEN 1 ELSE 0 END AS live_project,
         e.id AS employee_id,
         CASE WHEN e.employee_id LIKE 'E2E-EMP-%' THEN 1 ELSE 0 END AS is_e2e
  FROM user_activity_assignments a
  CROSS JOIN (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2
              UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
              UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
              UNION ALL SELECT 9) d
  CROSS JOIN (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2) t
  LEFT JOIN users u ON u.id = a.user_id AND u.isDelete = 0
  LEFT JOIN employees e ON e.id = COALESCE(NULLIF(a.employee_id, 0), u.employee_id)
                       AND e.isDelete = 0
  LEFT JOIN projects p ON p.project_id = a.project_id AND p.isDelete = 0
  WHERE JSON_VALID(a.daily_entries)
    AND d.n + 10 * t.n < JSON_LENGTH(a.daily_entries)
) x
WHERE x.hours > 0
  AND x.entry_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
GROUP BY LEFT(x.entry_date, 7)
ORDER BY log_month;
```
