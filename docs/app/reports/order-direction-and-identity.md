# Order direction and canonical order identity (ticket #310)

## Overview

Orders are now recorded once, in one store, with an explicit direction:

| Where                    | What                                                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders`                 | Canonical order identity (`order_uid`), direction (`client` / `supplier`), counterparty, Project, currency, tax/amount basis, gross/tax/net amounts, order date, source document, status, firm/cancellable evidence, `financial_version`, and the client-invoice rollup |
| `order_legacy_mappings`  | One row per pre-canonical order copy, queued for document-backed review                                                                                                                                                                                                 |
| `order_review_decisions` | Append-only review journal (classify / link / duplicate / insufficient), keyed `(mapping_id, version)`                                                                                                                                                                  |
| `order_events`           | Append-only canonical order journal (`created`, `updated`, `client_invoiced`)                                                                                                                                                                                           |

A supplier order value is an **Outstanding Supplier Commitment**, never incurred
cost. Client order value is **commercial context**: not income, not cost, and not
a budget. Neither figure is ever produced from the other.

Money is stored to the cent (`decimal(15,2)`) with the module's shared Decimal
helpers: a stated `250000.75` stays `250000.75`, a rollup of two `33333.33`
client invoices is `66666.66`, and the remaining value is stated value minus
that rollup. A missing amount is NULL, never zero. A supplied Project or company
reference that is not a positive integer (a code, typo, negative or fractional
value) is refused (`invalid_project` / `invalid_company`) instead of being
dropped to NULL; an explicit null/blank still means unknown, and a filter that
is not a positive integer is refused on the read path. A currency longer than
ISO 4217 (`USDT`) is refused, never truncated into a different valid code.

## Module interface

`src/lib/company-expenditure/orders.ts`, re-exported through
`@/lib/company-expenditure`:

- `createOrder(input, actor, { connection? })` — one canonical order; direction,
  order number, counterparty and firmness evidence are validated, and a
  firm/cancellable claim without its evidence reference is refused.
- `updateOrder({ orderUid, expectedVersion, patch }, actor, { connection? })` —
  versioned; a stale or replayed update changes nothing.
- `fetchOrders(query, { connection? })` — orders plus supported
  per-currency/per-basis subtotals and the unknown-value count.
- `fetchOrder(orderUid, { connection? })` — one order with its journal.
- `fetchOrderReviewQueue(query?, { connection? })` — legacy copies with their
  collision candidates, plus the targets a `link` or `duplicate` decision needs.
- `resolveLegacyOrder(input, actor, { connection? })` — versioned, reasoned,
  evidence-backed decision. The legacy rows are never merged or deleted.
- `linkClientInvoice(input, connection)` — moves a client order's invoiced
  rollup inside the caller's transaction; a supplier order is refused.

Reads accept a caller connection, and every write joins the caller's
transaction when one is supplied, so a later financial close can take one
coherent snapshot across sources.

## HTTP

| Route                                           | Purpose                                                 |
| ----------------------------------------------- | ------------------------------------------------------- |
| `GET/POST /api/admin/orders`                    | List (direction/Project filters, pagination) and create |
| `GET/PUT /api/admin/orders/{uid}`               | One order + journal, and a versioned update             |
| `GET/POST /api/admin/orders/review`             | Legacy review queue and decisions                       |
| `GET/PUT /api/projects/{id}/purchase-order`     | Project-scoped canonical orders                         |
| `GET /api/admin/invoices/po-balance?order_uid=` | A client order's remaining value for the invoice screen |

Permissions: reads use `purchase_orders:read`; creation uses
`purchase_orders:create`; updates and review decisions use
`purchase_orders:update`.

## What the cutover changed

- **Order entry** (`/admin/orders`) captures direction, counterparty, Project,
  currency, tax/amount basis, order date, source document, status, and
  firm/cancellable evidence. The four legacy screens
  (`/admin/purchase-order`, its edit/view pages, and
  `/admin/outgoing-purchase-order`) redirect there; their endpoints no longer
  write.
- **Project tabs** show the Project's canonical orders (client value and
  supplier order values side by side). The Project edit form no longer
  double-writes `project_purchase_orders` + `purchase_orders`, and the
  `project_invoices.tab_type = 'purchase_order'` write is refused.
- **Documents** attach to a canonical order (`entity_documents.entity_type =
'order'`), so the source document lives beside the identity it supports.
- **Invoice references** are a relational `invoices.order_uid`. The client
  invoice screens select a client order; the old free-text `po_number` match
  into `purchase_orders` (including its row fabrication and balance write) is
  gone. A supplier order cannot be linked to a client invoice.

## Legacy review

Every active row of `purchase_orders`, `outgoing_purchase_orders`,
`project_purchase_orders`, and `project_invoices` with
`tab_type = 'purchase_order'` is queued in `order_legacy_mappings`. Nothing
classifies it automatically: table names, counterparty text, client-invoice
links, and a shared document number are all insufficient evidence. The review
queue shows collision candidates (other copies carrying the same number) and a
reviewer decides, with a reason and an evidence reference:

- **classify** — create the canonical order for the copy (direction + stated
  fields come from the reviewer and the document).
- **link** — the copy is the same order as an existing canonical order.
- **duplicate** — the copy duplicates another reviewed copy; both legacy rows
  stay intact and the canonical order is counted once.
- **insufficient** — needs more evidence; the copy stays unresolved.

Each decision is versioned (`expected_version`), so a replayed or concurrent
review changes nothing and duplicates nothing.

## Supplier commitment consumption (#312)

Recognized goods or services consume the corresponding supplier order, by
`orders.order_uid` plus the recognized cost's `cost_uid` and its native
Recognition Period — never by a text PO number. A client order and a client
invoice link never reduce a supplier commitment, and a payment never defines
consumption.

| Where                      | What                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order_consumptions`       | One consumed native slice: `order_uid`, `cost_uid`, amount on the order's tax basis and currency, Recognition Period, `source_version`, `state`, `version`, actor/reason/evidence, release evidence |
| `order_consumption_events` | Append-only per-row journal (`recorded` / `released`), keyed `(consumption_id, version)`                                                                                                            |

Identifier collation is per reference: the `order_uid` columns use
`utf8mb4_unicode_ci` to match `orders.order_uid`, and the `cost_uid`
columns use `utf8mb4_general_ci` to match the shared financial cost
identity (`financial_cost_links`, `financial_cost_events`). Each column
carries the collation of the column it joins, so the joins need no
query-level coercion.

Rules the module enforces:

- **Eligibility**: only a `direction = 'supplier'` order with an explicit
  `gross`/`net` basis, a stated value, and a valid currency enters the
  supported commitment; drafts, pending orders, unknown bases, missing values,
  and pending legacy copies stay explicit exceptions (never counted, never
  guessed).
- **Native amounts**: the amount is the frozen slice gross (gross-basis order)
  or gross minus tax (net-basis order); several same-month slices are summed,
  never `.find(first)`. A missing or non-positive native amount refuses.
- **One slice, one order**: `UNIQUE (cost_uid, recognized_period, active_key)`
  is the global active source-slice backstop, so two competing orders can
  never consume the same slice; the second attempt refuses
  `slice_already_consumed`.
- **Versioned and atomic**: a record locks the order row and the authoritative
  source row, checks `expected_order_version` and `expected_source_version`,
  and refuses a stale version, a cancelled order, or a cost that is no longer
  recognized before any write. A correction is release + re-record (reasoned,
  evidenced) — there is no in-place amount edit.
- **Rollforward**: opening, new commitment, consumption, cancellation, and
  closing are reconstructed per (currency, tax basis) pair as of each month
  from the recorded acts — a later cancellation never erases an earlier
  month's commitment, and the cancellation amount uses consumption through its
  effective month. A timing act that cannot be proved stays out of the month
  buckets and is disclosed as `unsupported_timing`; application `created_at`
  is never invented as a business date.

HTTP: `GET /api/admin/orders/{uid}/commitment` (order read plus
`other_expenses:read`), `POST /api/admin/orders/{uid}/consumption` and
`POST /api/admin/orders/{uid}/consumption/release` (order update plus
`other_expenses:approve`). The report's Outstanding Supplier Commitment section
reads the same rollforward through `fetchCompanyReconciliation`.

## Accrual consumption (#314)

Received work recognized through a Cost Accrual reduces the corresponding
outstanding commitment before its supplier invoice exists. The accrual carries
the link as `cost_accruals.order_uid` (a local register reference — the
double-store rule — never a second consumption path); `order_consumptions`
stays the single consumption store.

`src/lib/company-expenditure/accrual-consumption.ts` composes #312's
consumption commands with #313's accrual commands in one transaction — it
writes no consumption row itself and re-derives no amount:

- `executeAccrualCommandWithConsumption`: recognizing a linked accrual records
  its remaining slice (`source: 'accrual'`) in the same commit; cancelling one
  releases its active rows. An accrual without an order link takes the pure
  #313 path. A refusal (unknown order, currency or basis mismatch, slice
  already consumed, capacity exceeded) fails the command with its explicit
  code and zero partial writes.
- `executeAccrualReplacementWithConsumption`: a replacement releases the
  accrual's active rows and records the invoice's native slices in their own
  periods plus the partial remainder, atomically — the replaced portion moves
  exactly once and the remainder never silently returns to the commitment. A
  replacement invoice in another currency leaves the order while its leg is
  explicitly skipped (`invoice_currency_unconsumed`); its variance stays
  explained on the replacement row.
- `restoreAccrualConsumptionForReleasedReplacements`: cancelling a
  replacement invoice re-records the restored remainder in the cancel
  command's own transaction, so the received-work cost keeps consuming its
  order.

The procurement commitment detail and the report section show the resulting
chain (order, accrual, and invoice rows) with their source, amount, period,
and release evidence; every leg is a reasoned, evidenced consumption event.
