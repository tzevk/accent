# Project incurred cost and supplier commitments stay separate

The client expands the report from employee-only cost to all project costs, including expenses and purchase order values. Lead with Incurred Project Cost. Show Outstanding Supplier Commitment and cash paid separately; neither is another incurred-cost category. ADR-0016 defines the employee-cost component.

Do not add a supplier order's full value to the cost recognized against that order. Recognized supplier work or goods consumes the corresponding commitment, including evidenced accruals before invoicing. A later invoice replaces the corresponding accrual; paying it does not create another cost. Client order value is sales context, not supplier cost.

This boundary favors meaningful monthly cost changes over a single sum of orders, invoices, expenses, and payments. The user confirms the management-reporting model in `../app/reports/project-expenditure-design.md`: service-period recognition, evidence-based recoverable-tax treatment, separate overhead and unallocated cost, controlled financial close, and single-count source records. Existing order direction, missing records, and duplicate identities still require evidence review; the report must disclose those gaps rather than infer totals.
