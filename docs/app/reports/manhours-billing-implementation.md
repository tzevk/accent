# Manhours Billing Report — Implementation

## Overview

`/reports/manhours-billing` — a per-client-project billing report with two views:

- **Monthly** — a monthly billing statement: every employee who logged manhours on the selected project during the selected month appears as a row with their per-hour company charge, the billed amount, TDS + net payable, the per-hour Accent rate billed to the client and its amount, and the P&L columns. The layout mirrors the company's Excel manhours billing template (Client Name / Project Name-Number / Month-Year header block above a `Sr. No. | Employee Name | Designation | Total Manhours | Employee Charges | Amount | TDS | Net Payable | Accent Charges | Amount | P&L (After Deductions | TDS)` grid with section tints).
- **Annual FY Matrix** — the same project's whole financial year (Apr–Mar) from the Project Manhours tab: one row per deputation member with the employee/client rates, twelve month-hour cells, Total Hrs, Employee Cost, Company Billing and P&L (mirrors the "Deputation Summary" workbook).

**Route:** `src/app/api/reports/manhours-billing/route.ts` (+ `download/route.ts` for Excel)  
**Page:** `src/app/reports/manhours-billing/page.tsx`  
**Data:** `src/app/reports/manhours-billing/data-source.ts`  
**Excel:** `src/app/reports/manhours-billing/excel-template.ts`  
**Nav:** Navbar Reports dropdown + Sidebar Reports section (`reports:read` or `project_activities` field permission)

---

## Architecture

### Data flow

```
Browser (filters: client → project → month | financial year)
  │  GET /api/reports/manhours-billing                (meta: clients, projects, months, FYs)
  │  GET /api/reports/manhours-billing?project_id=&month=            (monthly rows)
  │  GET /api/reports/manhours-billing?project_id=&fy=&view=annual   (FY matrix)
  ▼
data-source.ts
  ├─ fetchBillingMeta()        → clients, projects, months and FYs with data
  ├─ fetchBillingData()        → project header + monthly employee billing rows
  │    ├─ project_manhours_list      (tab hours + rates for the month)
  │    ├─ user_activity_assignments  (daily_entries fallback hours)
  │    ├─ users / employees          (employee resolution)
  │    └─ employee_salary_profile    (monthly salary + hourly rate fallback)
  └─ fetchAnnualBillingData()  → FY matrix (Apr–Mar) per tab member, with the
                                 same assignment fallback per month and rates
```

### Data sources

| Field                                  | Source table                                                  | How it is derived                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Total Manhours**                     | `projects.project_manhours_list`, `user_activity_assignments` | The Project Manhours tab's `monthly_hours[<calendar month>]` wins; when that is 0/absent, the month's `daily_entries` hours are summed instead (`status <> 'Cancelled'`). Employees still at 0 are dropped in the monthly view |
| **Employee Name / Designation / Code** | `employees`                                                   | `CONCAT_WS(' ', first_name, last_name)`; designation = `position`, falling back to `designation`                                                                                                                               |
| **Employee Charges**                   | `projects.project_manhours_list`                              | Project Manhours tab's `rate_employee` (RT/HR Employee); falls back to the month's project config rate, then to the salary-profile-derived hourly rate when unset                                                              |
| **Amount**                             | computed                                                      | Employee Charges × manhours (unrounded rate), 2dp, decimal.js (`@/lib/money`)                                                                                                                                                  |
| **TDS**                                | computed                                                      | Amount × `tds_percentage` from the salary profile in force for the month (default **10%**, payroll's convention)                                                                                                               |
| **Net Payable**                        | computed                                                      | Amount − TDS                                                                                                                                                                                                                   |
| **Accent Charges**                     | `projects.project_manhours_list`                              | Project Manhours tab's `rate_client` (RT/HR Company); 0 when unset                                                                                                                                                             |
| **Accent Amount**                      | computed                                                      | Accent Charges × manhours, 2dp                                                                                                                                                                                                 |
| **P&L After Deductions**               | computed                                                      | Accent Amount − Net Payable — profit after the employee's deductions                                                                                                                                                           |
| **P&L TDS**                            | computed                                                      | Accent Amount − Amount — gross margin before the employee's TDS (equivalently P&L After Deductions − TDS)                                                                                                                      |
| **Client / Project**                   | `projects`                                                    | `client_name`, `project_code`, `project_title`/`name` on `isDelete = 0` rows with a client name                                                                                                                                |

The tab rate keys were renamed from `rate_company`/`rate_accent` (the old pair was semantically inverted). `normalizeManhourEntry` in `data-source.ts` maps legacy rows to `rate_employee`/`rate_client` on read, so only the new keys are ever resolved.

---

## Where the rates come from

### Employee Charges / Accent Charges

Both rates come from the **Project Manhours tab** (`projects.project_manhours_list` JSON, annual format rows):

```json
[
	{
		"id": 1,
		"employee_id": "3",
		"source_employee_id": 3,
		"salary_type": "monthly",
		"rate_employee": 430,
		"rate_client": 480,
		"monthly_hours": { "jan": 10 }
	}
]
```

Rows are keyed by `employees.id` via `source_employee_id`, falling back to `employee_id` (the tab stores `String(employees.id)` for internal members). The **employee rate** (`rate_employee`, RT/HR Employee — what we pay) falls back to the month's project-config rate, then to the salary-profile-derived hourly rate (the tab auto-fills the field from there when an employee is added). The **client rate** (`rate_client`, RT/HR Company — what the client is billed) is manual — 0 when unset, which yields a negative P&L (the company pays the salary without billing the client).

### Monthly salary fallback and hourly rate

When no project rate is configured for the employee, the hourly rate comes from **`employee_salary_profile`** (the same table the payroll and project manhours flows use), never from the `salary_master` template table.

Selection is **date-aware** and mirrors payroll conventions:

1. Only profiles with `is_active = 1`.
2. Prefer the profile whose effective range covers the selected month: `effective_from <= month-end` AND (`effective_to IS NULL` OR `effective_to >= month-start`).
3. If no profile covers the month, fall back to the **latest** active profile (`effective_from DESC`).
4. Salary value precedence: `gross_salary` → `gross` → `employer_cost`.

| `salary_type`       | Hourly rate used                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `hourly`            | the profile's stored `hourly_rate` column                                                   |
| `daily`             | the profile's stored `daily_rate` column                                                    |
| `custom`            | the profile's stored `hourly_rate` column                                                   |
| `monthly` (default) | `gross_salary ÷ (std_working_days × std_hours_per_day)`, defaults **26 days × 8 h = 208 h** |

The displayed rate is rounded to 2dp (`resolveHourlyRate`).

### TDS

`tds_percentage` from the salary profile in force for the month, defaulting to **10** when unset (`profile.tds_percentage || 10` — the same convention payroll uses). TDS amount = amount × rate / 100, 2dp.

### Why the Amount can differ from rate × manhours at face value

The **billing amount uses the unrounded rate** (`computeRawHourlyRate`), while the grid displays the rounded rate. This matches the company's Excel template: a ₹20,000 salary at 240 standard hours displays **83.33** yet bills **16,666.67** (= 83.333… × 200 h), not 16,666.00. When a project `rate_employee` is set, it is a plain decimal and bills exactly.

```
resolveHourlyRate(p)      = round2(computeRawHourlyRate(p))   // display
amount                    = round2(rate × manhours)   // billing
```

Money arithmetic goes through `@/lib/money` (`mul`, `sub`, `pctOf`, `toNumber`) — no raw float operators on currency.

### Template numbers (mock row)

| Inputs                     | Values |
| -------------------------- | ------ |
| Total Manhours             | 176    |
| Employee Charges (company) | 430.00 |
| Accent Charges (client)    | 480.00 |
| TDS rate                   | 10%    |

| Output               | Value     | Derivation      |
| -------------------- | --------- | --------------- |
| Amount               | 75,680.00 | 176 × 430       |
| TDS                  | 7,568.00  | 10% × 75,680    |
| Net Payable          | 68,112.00 | 75,680 − 7,568  |
| Accent Amount        | 84,480.00 | 176 × 480       |
| P&L After Deductions | 16,368.00 | 84,480 − 68,112 |
| P&L TDS              | 8,800.00  | 84,480 − 75,680 |

---

## Manhours source and employee resolution

Manhours come from the Project Manhours tab first — `project_manhours_list[].monthly_hours[<calendar month key>]` — and from **`user_activity_assignments.daily_entries`** (the actual daily time log employees fill in, same source as the Timesheet report and the Project Status person×day matrix) when the tab has no hours for that employee and month. `daily_entries` is a JSON array:

```json
[
	{
		"date": "2026-04-13",
		"qty_done": 0,
		"hours": 8,
		"remarks": "pid rev updation"
	}
]
```

Query: `WHERE project_id = ? AND status <> 'Cancelled'`.

Assignments are keyed by `user_id`, so each assignment is resolved to an employee via a 3-step chain:

1. `uaa.employee_id` (explicit column, when set)
2. `users.employee_id` (login account's FK to `employees`)
3. email/username match (`users.email`/`users.username` ↔ `employees.email`/`employees.username`) for legacy data

In the monthly view, employees with **zero hours in the month are dropped** — a billing statement only charges worked time. The annual view keeps every Project Manhours tab row (even all-zero months) and also adds internal employees who have assignment hours but no tab row.

---

## Auth

Three-tier, same as `client-balance`, `employee-report`, and `project-activities`:

1. `is_super_admin === true` → full access
2. `hasPermission(user, 'reports', 'read')` → full access
3. `hasProjectActivitiesFieldPermission(user)` — `field_permissions.modules.reports.sections.report_access.fields.project_activities.permission` is `'view'` or `'edit'` (or legacy `project_reports`)

Unauthenticated → 401. No permission → 403. The `download` route applies the identical gate.

---

## API contract

### Meta (no params)

```typescript
interface BillingMeta {
	clients: string[]; // distinct projects.client_name, sorted
	projects: BillingProject[]; // { project_id, project_code, project_name, client_name }
	months: string[]; // YYYY-MM, newest first: attendance months ∪ daily_entries months ∪ manhours-tab months ∪ current month
	latest_month: string | null;
	financial_years: { year: number; label: string }[]; // newest first, e.g. "FY 2026-27"
	current_fy: number;
}
```

### Data (`?project_id=&month=`)

```typescript
interface BillingData {
	client_name: string;
	project: { project_id: number; project_code: string; project_name: string };
	month: string; // YYYY-MM
	month_label: string; // e.g. "July 2026"
	year: number;
	rows: BillingEmployeeRow[];
	totals: {
		total_manhours: number;
		total_amount: number;
		total_tds: number;
		total_net_payable: number;
		total_accent_amount: number;
		total_pnl_after_deductions: number;
		total_pnl_tds: number;
	};
}

interface BillingEmployeeRow {
	sr_no: number; // 1-based, after sorting by employee name
	employee_id: number | null;
	employee_code: string;
	employee_name: string;
	designation: string;
	employee_charges: number; // RT/HR Employee (project config) or salary-derived, 2dp
	total_manhours: number; // 2dp
	amount: number; // charges × manhours, 2dp
	tds_rate: number; // profile tds_percentage, default 10
	tds: number; // amount × tds_rate / 100, 2dp
	net_payable: number; // amount − tds, 2dp
	accent_charges: number; // RT/HR Company (project config), 2dp
	accent_amount: number; // accent_charges × manhours, 2dp
	pnl_after_deductions: number; // accent_amount − net_payable, 2dp
	pnl_tds: number; // accent_amount − amount, 2dp
}
```

### Annual data (`?project_id=&fy=YYYY&view=annual`, or no `month` with `fy`)

```typescript
interface AnnualBillingData {
	client_name: string;
	project: { project_id: number; project_code: string; project_name: string };
	fy_label: string; // e.g. "FY 2026-27"
	fy_year: number; // start year (April)
	months: string[]; // Apr … Mar (display labels)
	month_keys: string[]; // apr … mar (payload keys)
	rows: AnnualEmployeeRow[];
	totals: {
		monthly_hours: Record<string, number>; // apr … mar, 2dp
		total_hours: number;
		total_company_cost: number;
		total_accent_cost: number;
		total_pnl: number;
	};
}

interface AnnualEmployeeRow {
	sr_no: number;
	id: string | number;
	employee_id: number | null;
	employee_code: string;
	employee_name: string;
	designation: string;
	salary_type: string;
	rate_employee: number;
	rate_client: number;
	monthly_hours: Record<string, number>; // apr … mar, 2dp
	total_hours: number;
	company_cost: number; // rate_employee × total_hours, 2dp
	accent_cost: number; // rate_client × total_hours, 2dp
	pnl: number; // accent_cost − company_cost, 2dp
}
```

Validation: `project_id` must be a positive integer; monthly `month` must match `^\d{4}-\d{2}$`; annual `fy` must be an integer 2000–2100. Unknown project → 404, bad params → 400.

---

## Page design

### Filters (print-hidden)

A **Monthly | Annual FY Matrix** view toggle sits above the dropdowns; Monthly is the default.

Monthly mode — three dependent `SearchableSelect` dropdowns (`src/components/ui/searchable-select.jsx`):

1. **Client Name** → sets client; resets project to that client's first project
2. **Project Name/Number** → filtered by client; label is `project_code - project_name`
3. **Month/Year** → defaults to `meta.latest_month`

Annual mode — the same Client and Project selects plus a **Financial Year** select built from `meta.financial_years`, defaulting to `meta.current_fy` (April–March).

Plus Refresh, Print (`window.print()`), and Export Excel buttons. Defaults are applied once when meta arrives (first client, its first project, latest month / current FY).

### Sheet (Monthly)

An Arial `text-[10px]` bordered grid (`border-black`, like the Timesheet report) with:

- Header block: `Client Name :` / `Project Name/Number :` / `Month/Year :` label-value rows
- Table with a **two-row header**: the ten plain labels vertically merged (`rowSpan=2`), and `P&L` merged across the last two columns with `After Deductions` (pink) and `TDS` (bright yellow) beneath. Section tints repeat in the data and totals rows:
  - `Sr. No. | Employee Name | Designation` — light yellow
  - `Total Manhours | Employee Charges | Amount | TDS | Net Payable` — light blue
  - `Accent Charges | Amount` — light green
  - `P&L` header + `TDS` sub-column — bright yellow; `After Deductions` — pink
- Total row: total manhours + employee amount + TDS + net payable + accent amount + both P&L totals
- Empty state: "No manhours logged on this project in {month}."

Money renders via `formatNumber` (en-IN, fixed 2dp, no currency symbol — matching the template); manhours via trimmed `toFixed(2)` (`176`, not `176.00`). The sheet sets `print-color-adjust: exact` so the tints survive printing.

### Sheet (Annual FY Matrix)

The same bordered-grid language, laid out like the "Deputation Summary" workbook:

- Header block: `Client Name :` / `Project Name/Number :` / `Period / Financial Year :` (`FY 2026-27`, April {fy_year} – March {fy_year + 1})
- Five summary cards above the table: **FY Total Manhours**, **{n} resources on deputation**, **Accent revenue**, **Total Employee Cost**, **Annual Net P&L** (with a % margin when accent revenue is positive)
- Table columns: `Sr. | Team Member | Salary Type | RT/HR (Emp) | RT/HR (Co) | Apr … Mar | Total Hrs | Employee Cost | Company Billing | P&L`, with a grand-total row summing all twelve months and the three money columns
- Empty state: "No deputation manhours recorded for this project in {FY}."

### Print

`Print` outputs an A4 landscape letterhead document (scoped `@media print` styles in the page): the Navbar and the Excel-mirror header block are hidden; a print-only header (ACCENT brand, "Manhours Billing Report" title, period, client/project/meta strip, generated timestamp) sits above the table; the two-row table header repeats on page breaks, rows keep together, and a fixed footer (purple rule + report/client/timestamp) repeats per page. Firefox additionally shows `Page X of Y` via the `@page @bottom-center` margin box. The Excel export sets the same landscape A4 fit-to-width page setup.

### Auth states

Loading (spinner + Navbar), Access Denied (red X panel), error (red panel + Retry), and the empty/sheet states above.

---

## Excel export

`GET /api/reports/manhours-billing/download?project_id=&month=` returns an `.xlsx` (exceljs) that mirrors the template exactly:

- Rows 1–3: `Client Name :`, `Project Name/Number :`, `Month/Year :` label + merged value cells
- Rows 5–6: two-row header — `A5:J5` vertically merged with row 6, `K5:L5` merged `P&L`, `K6` `After Deductions` (pink), `L6` `TDS` (bright yellow); section tints sampled from the template (`FFFFE598` / `FFDCE2F2` / `FFC6DFB4` / `FFF8CBAB` / `FFFFFF00`)
- Data rows (money `#,##0.00`, manhours `0.##`, right-aligned, tinted per section)
- Total row (all seven totals bold)

Filename: `Manhours_Billing_<CLIENT>_<PROJECTCODE>_<MONTH>.xlsx`.

The annual view exports the same way (`?project_id=&fy=&view=annual`): a `Deputation Summary` worksheet with rows 1–3 header (Client Name / Project Name-Number / Period–Financial Year), a single header row (`Sr. | Team Member | Salary Type | RT/HR (Emp) | RT/HR (Co) | Apr … Mar | Total Hrs | Employee Cost | Company Billing | P&L`), tinted data rows, a totals row, and the same landscape A4 fit-to-width setup. Filename: `Deputation_Summary_<CLIENT>_<PROJECTCODE>_<FY_LABEL>.xlsx`.

---

## Files changed

| File                                                     | Change                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/app/reports/manhours-billing/data-source.ts`        | **Created** — types, pure transforms (unit-tested), server fetchers                    |
| `src/app/reports/manhours-billing/page.tsx`              | **Created** — filter bar + print-styled sheet + Excel export button                    |
| `src/app/reports/manhours-billing/excel-template.ts`     | **Created** — ExcelJS workbook builder                                                 |
| `src/app/api/reports/manhours-billing/route.ts`          | **Created** — meta/data JSON API with RBAC                                             |
| `src/app/api/reports/manhours-billing/download/route.ts` | **Created** — Excel download with RBAC                                                 |
| `src/app/reports/manhours-billing/data-source.test.ts`   | **Created** — unit tests (parsing, rate math, profile selection, row building, totals) |
| `src/components/Navbar.jsx`                              | Added "Manhours Billing" entry to `reportsMenuConfig` (`ReceiptPercentIcon`)           |
| `src/components/Sidebar.jsx`                             | Added `NavRow` "Manhours Billing" in Reports section (`BanknotesIcon`)                 |
