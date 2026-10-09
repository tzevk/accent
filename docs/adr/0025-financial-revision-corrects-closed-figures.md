# Explicit revisions correct closed financial figures

Ticket #323 builds the correction path the closed month (#322, ADR-0024)
points refused writes at: ordinary edits, deletions, cancellations, and
reclassifications of a closed month stay refused (`409 month_closed`), and
only an explicit revision changes closed figures.

A revision is a versioned command, not an edit. It names its target (a
direct cost, supplier invoice, accrual, or dated settlement — by id or by
stable UID), the operation (`update` to correct, `cancel` to reverse), the
target's version the caller read, and the frozen closed version it
targets, with a mandatory reason, evidence reference, actor, and
timestamp. Every accepted revision increments `financial_version`,
appends exactly one row to the source's journal, and appends one
`financial_revision_events` header carrying the prior and new figures
(amount, currency, classification, period, state) with the Project and
source labels reconstructed at revision time. The frozen
`financial_close_snapshots` row never moves: the prior totals stay the
snapshot, the updated totals are the live reconciliation.

The correction runs through the source's own command path, so every
validation the ordinary path performs still runs — including the rule that
corrected confirmed cost must stay recognizable. A recognized cost is
corrected in place (recognized stays recognized); cancelling it keeps its
row and history, never erases them. Linked order consumptions follow in
the same transaction: an amount or period correction releases and
re-records each active consumption against the revised slices, and a
cancellation releases them, so the remaining commitment restates
coherently. A repeated revision key returns the existing result; a stale
version, a competing revision, and an unauthorized caller write nothing.

Two boundaries stay closed. Payroll attribution keeps its allocation
revision contract: this workflow refuses payroll targets
(`use_allocation_revision`) and never rewrites a Payroll Slip, and the
closed-period guard on that contract stays the authority for closed
months. Historical identity outlives the masters: revision figures and
the frozen snapshot keep the Project and source labels the month closed
with, while open operational reads keep their soft-delete filtering and a
correction never resurrects a soft-deleted Project.

The source lives in `src/lib/company-expenditure/revisions.ts`; the routes
are `GET`/`POST /api/admin/expenditure-revisions` under the source
privileges the command routes already enforce (no new RBAC resource).
#324 consumes the revision history alongside the close snapshot.
