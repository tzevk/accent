# Client Balance Sheet — Implementation

## Overview

`/reports/client-balance` — a client-wise financial balance sheet aggregating five transactional sources into a single per-entity view, with client names normalized against the `companies` and `vendors` master tables. Each client name links to a per-client drill-down of its transactions.

**Route:** `src/app/api/reports/client-balance/route.ts` (+ `detail/route.ts` for the drill-down)  
**Page:** `src/app/reports/client-balance/page.tsx` (+ `[client]/page.tsx` drill-down)  
**Nav:** **Temporarily hidden** — the entry is commented out of the Navbar Reports dropdown and the Sidebar Reports section (TEMP-HIDDEN, 2026-08-03, `e276920`); the route still works when opened directly (`reports:read` or `project_activities` field permission)

---

## Architecture

### Data sources

The report pulls from five tables, each serving a distinct role in the client financial lifecycle:

| Source      | Table                 | Role                                     | Key columns used                                                                           |
| ----------- | --------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Billing     | `invoices`            | Sale invoices raised to clients          | `client_name`, `net_amount`, `amount_paid`, `balance_due`, `invoice_date`, `status`        |
| Receipts    | `payment_entries`     | Individual payments received             | `company_name`, `net_amount`, `amount`, `tds_amount`, `gst_amount`, `payment_date`         |
| Issued      | `payment_issues`      | Payments issued to a client              | `payee_name`, `net_amount`, `amount`, `deduction`, `issue_date` (`payee_type = 'company'`) |
| Pipeline    | `quotations`          | Quotes sent/approved (potential revenue) | `client_name`, `net_amount`, `total`, `status`                                             |
| AR Tracking | `payment_receivables` | Overdue tracking, follow-up status       | `client_name`, `invoice_amount`, `paid_amount`, `balance_due`, `status`, `received_date`   |

The `payment_issues` reads are wrapped in a try/catch — an environment without that table still renders the report, with issued figures at 0.

### Why these five

The five tables represent the complete lifecycle of client financial activity:

```
quotation → invoice → payment_entry
                ↘         payment_issue (money issued to the client)
          payment_receivables (AR management overlay)
```

- **Quotations** are the pipeline — potential revenue before billing. Converts to invoices when won.
- **Invoices** are the billing system — what was actually billed. The authoritative source for "amount invoiced."
- **Payment entries** are the receipt system — what was actually collected. The authoritative source for "amount received."
- **Payment issues** are money issued to (or on behalf of) a client; they add to the client's net position and are included in the period movement.
- **Payment receivables** is the AR management layer — tracks overdue status, follow-up dates, and payment mode. Linked to invoices via `invoice_id`.

Using all five gives a complete picture: pipeline value, billed revenue, collected revenue, issued amounts and overdue risk — all per client. The report's net figure is `net_balance = total_invoiced − total_received + total_issued`.

### Why not `purchase_invoices` or vendor-side tables

`purchase_invoices`, `payment_payables`, and `outgoing_quotations` track **vendor** (AP) activity — money the business owes to vendors. A client balance sheet tracks **receivable** (AR) activity — money clients owe the business. These are different chart-of-accounts domains.

The vendor tables use `vendor_name` (not `client_name`), confirming they model a different entity type. For a vendor/payable balance sheet, a separate report would query those tables.

---

## Name normalization

### Problem

All five financial tables use **denormalized free-text** name columns:

- `invoices.client_name` (varchar)
- `payment_entries.company_name` (varchar)
- `payment_issues.payee_name` (varchar, `payee_type = 'company'` rows)
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

**Pre-population:** The result set starts with every company and vendor from the master tables (235 rows at the time of writing, July 2026 — it follows whatever the masters hold), each with zeroed financial data. Financial rows then accumulate into these pre-seeded entries via `+=`. This ensures:

1. All master entities appear, even with zero transactions
2. Names are always canonical
3. Multiple denormalized variants of the same entity merge into one row

---

## Period / date-range logic

When `from_date` and `to_date` are both provided:

| Computation         | Source                                                                         | SQL logic                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opening balance** | `invoices` − `payment_entries` + `payment_issues`, all dated before the period | `SUM(net_amount WHERE invoice_date < from_date)` − `SUM(net_amount WHERE payment_date < from_date)` + `SUM(net_amount WHERE issue_date < from_date)` |
| **Period invoiced** | `invoices`                                                                     | `SUM(net_amount WHERE invoice_date BETWEEN from_date AND to_date)`                                                                                   |
| **Period received** | `payment_entries`                                                              | `SUM(net_amount WHERE payment_date BETWEEN from_date AND to_date)`                                                                                   |
| **Period issued**   | `payment_issues`                                                               | `SUM(net_amount WHERE issue_date BETWEEN from_date AND to_date)`                                                                                     |
| **Closing balance** | Computed in JS                                                                 | `opening + period_invoiced − period_received + period_issued`                                                                                        |

Without date range: period fields are omitted from the response.

### Why invoices + payment_entries + payment_issues for period, not payment_receivables

`payment_receivables` tracks the AR position but may not have accurate `invoice_date`/`received_date` for every row (they can be NULL). `invoices`, `payment_entries` and `payment_issues` are the transactional source of truth — every invoice, payment and issue has a date. Using them for period computations ensures accuracy.

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

### Why it reads empty

Quotations with status `draft` or `rejected` are excluded — they're not active pipeline. At the time of writing (July 2026) the database held 4 quotations across 3 clients, all in `draft` status, so this column read ₹0; it stays ₹0 for as long as no quote is `sent` or `approved`.

Once quotes are promoted to `sent` or `approved` status in `/admin/quotation`, the pipeline column populates automatically. No code change needed.

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

	// From payment_issues (issued to client)
	total_issued: number; // SUM(net_amount)
	total_issued_gross: number; // SUM(amount)
	total_issued_deduction: number; // SUM(deduction)
	issue_count: number;

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
	net_balance: number; // total_invoiced − total_received + total_issued

	// Period fields (only when date range provided)
	opening_balance?: number;
	period_invoiced?: number;
	period_received?: number;
	period_issued?: number;
	closing_balance?: number;
}

// Meta
interface ReportMeta {
	total_clients: number;
	total_invoiced: number;
	total_received: number;
	total_issued: number;
	total_outstanding: number; // SUM(net_balance)
	total_pipeline: number;
	from_date?: string;
	to_date?: string;
}
```

---

## Page design

### Stats cards

Five default cards: Clients, Invoiced, Received, Outstanding, Pipeline, plus **Issued** (red) rendered only while `total_issued > 0`.  
Five period cards (when date range active): Opening, Period Inv, Period Recv, Period Iss, Closing.

Colors: blue = invoiced, green = received, orange = outstanding, indigo = pipeline, red = issued. Negative balances shown in red.

### Table

Two header rows:

1. **Main columns:** #, Client, Invoiced, Received, Issued, Balance, Pipeline, [Opening, Per Inv, Per Recv, Closing], Invoice Status (spans 4), Overdue AR
2. **Invoice status sub-headers:** Paid (green), Partial (blue), Unbilled (gray), Overdue (red)

Sortable by any numeric column (client-side, `useState` on sort key + direction).  
Client names link to the per-client drill-down.  
Footer row with column totals.  
Colored status badges for invoice states.  
`—` (em dash) for zero/null values instead of "0".

### Client drill-down

Clicking a client opens `/reports/client-balance/[client]`, fed by `GET /api/reports/client-balance/detail?client_name=&from_date=&to_date=` (same three-tier auth). It renders the same five figures for that client plus five transaction lists: Invoices, Payments Received, Payments Issued, Quotations and Receivables, with the date range carried through from the main report.

### Filters

- **Search:** filters `client_name` (client-side)
- **Date range:** `from_date`/`to_date` — defaults to first of current month → today
- **Clear:** resets search + dates to defaults
- **Show All / Hide Zero:** clients whose figures are all zero are hidden by default; the counter reads `{n} of {m} clients · {k} zero-value hidden`, and **Show All** reveals them

### Auth states

- Loading: centered spinner with Navbar
- Denied: red X icon + "Access Denied" message
- Error: red panel with retry button
- Empty (no clients match search): gray panel with "No matching clients."
- Empty (all clients zeroed for the period): "All clients have zero balance for this period." with a **Show All Clients** button
- Empty (no data at all): gray panel with "No client data found."

---

## Files changed

| File                                          | Change                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `src/app/api/reports/client-balance/route.ts` | **Created** — multi-table aggregation API with name normalization        |
| `src/app/reports/client-balance/page.tsx`     | **Created** — client-side report page with React Query                   |
| `src/components/Navbar.jsx`                   | Added `ScaleIcon` import + "Client Balance" entry in `reportsMenuConfig` |
| `src/components/Sidebar.jsx`                  | Added `ScaleIcon` import + `NavRow` in Reports section                   |

Both nav entries were TEMP-HIDDEN on 2026-08-03 (commented out, restorable). After the initial build the report gained the `payment_issues` source, the period `issued` figures, the client drill-down (`[client]/page.tsx` + `detail/route.ts`) and `@/lib/money` arithmetic for the totals.
