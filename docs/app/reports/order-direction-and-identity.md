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
