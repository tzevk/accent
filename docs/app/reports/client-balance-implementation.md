# Client Balance Sheet — Implementation

## Overview

`/reports/client-balance` — a client-wise financial balance sheet aggregating data from four independent sources into a single per-entity view, with client names normalized against the `companies` and `vendors` master tables.

**Route:** `src/app/api/reports/client-balance/route.ts`  
**Page:** `src/app/reports/client-balance/page.tsx`  
**Nav:** Navbar Reports dropdown + Sidebar Reports section (`reports:read` or `project_activities` field permission)

---

## Architecture

### Data sources

The report pulls from four tables, each serving a distinct role in the client financial lifecycle:

| Source      | Table                 | Role                                     | Key columns used                                                                         |
| ----------- | --------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Billing     | `invoices`            | Sale invoices raised to clients          | `client_name`, `net_amount`, `amount_paid`, `balance_due`, `invoice_date`, `status`      |
| Receipts    | `payment_entries`     | Individual payments received             | `company_name`, `net_amount`, `amount`, `tds_amount`, `gst_amount`, `payment_date`       |
| Pipeline    | `quotations`          | Quotes sent/approved (potential revenue) | `client_name`, `net_amount`, `total`, `status`                                           |
| AR Tracking | `payment_receivables` | Overdue tracking, follow-up status       | `client_name`, `invoice_amount`, `paid_amount`, `balance_due`, `status`, `received_date` |

### Why these four

The four tables represent the complete lifecycle of client financial activity:

```
quotation → invoice → payment_entry
                ↘
          payment_receivables (AR management overlay)
```

- **Quotations** are the pipeline — potential revenue before billing. Converts to invoices when won.
- **Invoices** are the billing system — what was actually billed. The authoritative source for "amount invoiced."
- **Payment entries** are the receipt system — what was actually collected. The authoritative source for "amount received."
- **Payment receivables** is the AR management layer — tracks overdue status, follow-up dates, and payment mode. Linked to invoices via `invoice_id`.

Using all four gives a complete picture: pipeline value, billed revenue, collected revenue, and overdue risk — all per client.

### Why not `purchase_invoices` or vendor-side tables

`purchase_invoices`, `payment_payables`, and `outgoing_quotations` track **vendor** (AP) activity — money the business owes to vendors. A client balance sheet tracks **receivable** (AR) activity — money clients owe the business. These are different chart-of-accounts domains.

The vendor tables use `vendor_name` (not `client_name`), confirming they model a different entity type. For a vendor/payable balance sheet, a separate report would query those tables.

---

## Name normalization

### Problem

All four financial tables use **denormalized free-text** name columns:

- `invoices.client_name` (varchar)
- `payment_entries.company_name` (varchar)
- `quotations.client_name` (varchar)
- `payment_receivables.client_name` (varchar)

There are no foreign keys to `companies.id`. The same client can appear as "Acme Corp" in one table and "ACME Corporation" in another, creating duplicate rows in any aggregation.

### Solution

**Step 0** queries the master tables to build a canonical name map:

```
companies (isDelete = 0) → { normalizedKey → canonicalName }
vendors   (isDelete = 0) → { normalizedKey → canonicalName }  (only if not already in companies)
```

Normalization: `(name || '').trim().toLowerCase()` — case-insensitive, whitespace-collapsed matching.

**Every financial row's name** is resolved through this map before aggregation. If "acme corp" is in the map → canonical name "Acme Corporation" is used. If unmatched, the raw name is kept as-is (legacy data with no master entry).

**Pre-population:** The result set starts with every company and vendor from the master tables (all 235 entities), each with zeroed financial data. Financial rows then accumulate into these pre-seeded entries via `+=`. This ensures:

1. All master entities appear, even with zero transactions
2. Names are always canonical
3. Multiple denormalized variants of the same entity merge into one row

---

## Period / date-range logic

When `from_date` and `to_date` are both provided:

| Computation         | Source                                                         | SQL logic                                                                                           |
| ------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Opening balance** | `invoices` (before period) − `payment_entries` (before period) | `SUM(net_amount WHERE invoice_date < from_date)` − `SUM(net_amount WHERE payment_date < from_date)` |
| **Period invoiced** | `invoices`                                                     | `SUM(net_amount WHERE invoice_date BETWEEN from_date AND to_date)`                                  |
| **Period received** | `payment_entries`                                              | `SUM(net_amount WHERE payment_date BETWEEN from_date AND to_date)`                                  |
| **Closing balance** | Computed in JS                                                 | `opening + period_invoiced − period_received`                                                       |

Without date range: period fields are omitted from the response.

### Why invoices + payment_entries for period, not payment_receivables

`payment_receivables` tracks the AR position but may not have accurate `invoice_date`/`received_date` for every row (they can be NULL). `invoices` and `payment_entries` are the transactional source of truth — every invoice and payment has a date. Using them for period computations ensures accuracy.

---

## Auth

Three-tier, same as `employee-report` and `project-activities`:

1. `is_super_admin === true` → full access
2. `hasPermission(user, 'reports', 'read')` → full access
3. `hasProjectActivitiesFieldPermission(user)` — checks `field_permissions.modules.reports.sections.report_access.fields.project_activities.permission` is `'view'` or `'edit'` (or legacy `project_reports`)

Unauthenticated → 401. No permission → 403.

---

## Pipeline column

### What it is

`pipeline_value` = sum of `net_amount` (falling back to `total`) from `quotations` where `status IN ('sent', 'approved')`. Represents potential future revenue from active quotes.

### Why it's empty

Quotations with status `draft` or `rejected` are excluded — they're not active pipeline. The database currently has 4 quotations across 3 clients, all in `draft` status. No quotes have been marked `sent` or `approved`.

Once quotes are promoted to `sent` or `approved` status in `/admin/quotation`, the pipeline column will populate automatically. No code change needed.

### Columns shown for pipeline

| Column                 | Source                         | Meaning                           |
| ---------------------- | ------------------------------ | --------------------------------- |
| `pipeline_value`       | Quotation `net_amount`/`total` | ₹ value of active quotes          |
| `quotation_count`      | Count of all quotes            | Total quotes regardless of status |
| `approved_quote_count` | `status = 'approved'`          | Won/accepted quotes               |
| `sent_quote_count`     | `status = 'sent'`              | Quotes awaiting client response   |

---

## Response shape

```typescript
interface ClientBalanceItem {
	client_name: string;

	// From invoices (billing)
	total_invoiced: number; // SUM(net_amount)
	amount_received_via_invoice: number; // SUM(amount_paid) — per-invoice payments
	invoice_balance_due: number; // SUM(balance_due)
	invoice_count: number;
	unbilled_count: number; // status IN ('draft','sent')
	paid_count: number; // status IN ('paid','fully_paid')
	partial_count: number; // status = 'partially_paid'
	overdue_inv_count: number; // status = 'overdue'

	// From payment_entries (receipts)
	total_received: number; // SUM(net_amount)
	total_received_gross: number; // SUM(amount) — before TDS/GST
	total_tds: number; // SUM(tds_amount)
	total_gst: number; // SUM(gst_amount)
	receipt_count: number;

	// From quotations (pipeline)
	pipeline_value: number; // SUM(net_amount) WHERE status IN ('sent','approved')
	quotation_count: number;
	approved_quote_count: number;
	sent_quote_count: number;

	// From payment_receivables (AR tracking)
	ar_overdue_amount: number; // SUM(balance_due WHERE status = 'overdue')
	ar_overdue_count: number;
	ar_pending_count: number;
	ar_partial_count: number;
	ar_received_count: number;

	// Computed
	net_balance: number; // total_invoiced - total_received

	// Period fields (only when date range provided)
	opening_balance?: number;
	period_invoiced?: number;
	period_received?: number;
	closing_balance?: number;
}

// Meta
interface ReportMeta {
	total_clients: number;
	total_invoiced: number;
	total_received: number;
	total_outstanding: number; // SUM(net_balance)
	total_pipeline: number;
	from_date?: string;
	to_date?: string;
}
```

---

## Page design

### Stats cards

Five default cards: Clients, Invoiced, Received, Outstanding, Pipeline.  
Four period cards (when date range active): Opening, Period Invoiced, Period Received, Closing.

Colors: blue = invoiced, green = received, orange = outstanding, indigo = pipeline. Negative balances shown in red.

### Table

Two header rows:

1. **Main columns:** #, Client, Invoiced, Received, Balance, Pipeline, [Opening, Per Inv, Per Recv, Closing], Invoice Status (spans 4), Overdue AR
2. **Invoice status sub-headers:** Paid (green), Partial (blue), Unbilled (gray), Overdue (red)

Sortable by any numeric column (client-side, `useState` on sort key + direction).  
Footer row with column totals.  
Colored status badges for invoice states.  
`—` (em dash) for zero/null values instead of "0".

### Filters

- **Search:** filters `client_name` (client-side)
- **Date range:** `from_date`/`to_date` — defaults to first of current month → today
- **Clear:** resets search + dates to defaults

### Auth states

- Loading: centered spinner with Navbar
- Denied: red X icon + "Access Denied" message
- Error: red panel with retry button
- Empty (no clients match search): gray panel with "No matching clients"
- Empty (no data at all): gray panel with "No client data found"

---

## Files changed

| File                                          | Change                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `src/app/api/reports/client-balance/route.ts` | **Created** — multi-table aggregation API with name normalization        |
| `src/app/reports/client-balance/page.tsx`     | **Created** — client-side report page with React Query                   |
| `src/components/Navbar.jsx`                   | Added `ScaleIcon` import + "Client Balance" entry in `reportsMenuConfig` |
| `src/components/Sidebar.jsx`                  | Added `ScaleIcon` import + `NavRow` in Reports section                   |
