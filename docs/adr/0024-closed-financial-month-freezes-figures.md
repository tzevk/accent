# A closed financial month freezes its figures

Ticket #322 closes the company expenditure report's loop: after every cost
source is wired and reconciled, a reviewed month's figures become immutable
and ordinary writes to that month stop. This record fixes the close model
that the revision history (#323) builds on, so corrections to closed figures
travel through explicit revisions instead of edits that rewrite history.

A month closes only after a review with no blockers. The review reads one
coherent snapshot across every source - direct cost, supplier invoices, other
expenses, accruals, petty cash, payroll allocations, commitments, and dated
cash - on the close transaction's own connection, so the frozen totals are
exactly what the report stated. Unwired sources, unresolved cost exceptions
(missing amount, missing currency, missing conversion evidence, open or
unclassified records, unsettled tax, unapproved non-operating items),
unsupported commitments, and an empty month block the close; pending payroll,
partial cash cover, and legacy cash gaps are disclosed warnings. Payroll
finalization stays separate: it freezes attribution but never closes
supplier cost, accruals, or the month.

The frozen row is `financial_close_snapshots` (one per month, `close-<uuid>`,
`financial_version` the next close presents, the full reconciliation as JSON,
actor, timestamp, reason, evidence). The close is version-checked and atomic:
the review, the version check, and the insert are one transaction, and the
unique month key makes competing closes produce one coherent version. Once
closed, every ordinary write to the month's costs, accruals, consumptions,
settlements, allocations, classifications, and register rows is refused
(`409 month_closed`) before any state check or journal append; the allocation
revision path consults the registered closed-month guard inside its own
transaction. New evidence in an open month - a later payment against a closed
cost, a new order - stays writable: it is that open month's evidence, and the
closed snapshot remains historically true.

The source lives in `src/lib/company-expenditure/close.ts`; the public
functions are exported from `index.ts` (`reviewClose`, `executeCloseCommand`,
`isMonthClosed`, `loadCloseSnapshot`, `assertMonthOpen`,
`closeRefusalForMonth`). No screen or route reimplements a review, version,
or guard rule. #323 consumes the snapshot table and the guard mechanism.
