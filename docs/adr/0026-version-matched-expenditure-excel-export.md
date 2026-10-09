# Version-matched expenditure evidence export

Ticket #324 implements the authorized Excel evidence export for company and project expenditure reconciliation.
The export matches the live and frozen reporting interfaces built across tickets #304 through #323.
It provides verifiable audit evidence across five structured worksheets.

The five sheets are Company Reconciliation, Project Detail, Budgets & Commitments, Cash Paid, and Revisions & Close.
The workbook uses the same domain calculations and models as the web report.
It does not invent alternate summaries or numbers.
Missing amounts display as "Missing / Unconverted" or "—".
They never appear as invented zeroes.

Project filters narrow project details only.
A project filter preserves the unfiltered company reconciliation totals.
The workbook includes a separate subtotal section for the selected project.
Commercial client orders appear with a prominent warning banner.
They provide context only and never represent revenue or profit.

The export endpoint requires the `canReadFinancialSources` permission check.
Super administrators and users with `reports:read`, `other_expenses:read`, and `payroll:read` can download it.
Unauthorized requests return a 403 Forbidden response without leaking data.
The implementation lives in `src/app/reports/employee-project-monthly-cost/excel-template.ts`.
The download route lives in `src/app/api/reports/employee-project-monthly-cost/download/route.ts`.
