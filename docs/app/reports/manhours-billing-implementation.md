# Manhours Billing Report — Implementation

## Overview

`/reports/manhours-billing` — a per-client-project monthly billing statement: every employee who logged manhours on the selected project during the selected month appears as a row with their monthly salary CTC, the derived hourly rate CTC, the total manhours logged, and the billing amount (hourly rate × manhours). The layout mirrors the company's Excel manhours billing template (Client Name / Project Name-Number / Month-Year header block above a `Sr. No. | Employee Name | Designation | Monthly Salary CTC | Hourly Rate CTC | Total Manhours | Amount` grid).

**Route:** `src/app/api/reports/manhours-billing/route.ts` (+ `download/route.ts` for Excel)  
**Page:** `src/app/reports/manhours-billing/page.tsx`  
**Data:** `src/app/reports/manhours-billing/data-source.ts`  
**Excel:** `src/app/reports/manhours-billing/excel-template.ts`  
**Nav:** Navbar Reports dropdown + Sidebar Reports section (`reports:read` or `project_activities` field permission)

---

## Architecture

### Data flow

```
Browser (filters: client → project → month)
  │  GET /api/reports/manhours-billing            (meta: clients, projects, months)
  │  GET /api/reports/manhours-billing?project_id=&month=   (billing rows)
  ▼
data-source.ts
  ├─ fetchBillingMeta()    → clients, projects, months with data
  └─ fetchBillingData()    → project header + employee billing rows
       ├─ user_activity_assignments (manhours: daily_entries)
       ├─ users / employees         (employee resolution)
       └─ employee_salary_profile   (monthly salary + hourly rate)
```

### Data sources

| Field                                  | Source table                | How it is derived                                                                                                                                                    |
| -------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------- |
| **Total Manhours**                     | `user_activity_assignments` | Sum of `hours` in the assignment's `daily_entries` JSON array where `date` falls in the selected month; summed across every non-cancelled assignment for the project |
| **Employee Name / Designation / Code** | `employees`                 | `CONCAT_WS(' ', first_name, last_name)`; designation = `position`                                                                                                    |     | `designation` |
| **Monthly Salary CTC**                 | `employee_salary_profile`   | `gross_salary` → fallback `gross` → fallback `employer_cost` on the active profile in force for the month                                                            |
| **Hourly Rate CTC**                    | computed (see below)        | Derived from the same salary profile; mirrors `EditProjectForm`'s rate lookup                                                                                        |
| **Amount**                             | computed                    | Unrounded hourly rate × manhours, 2dp, decimal.js (`@/lib/money`)                                                                                                    |
| **Client / Project**                   | `projects`                  | `client_name`, `project_code`, `project_title`/`name` on `isDelete = 0` rows with a client name                                                                      |

---

## Where the monthly and hourly rates come from

### Monthly Salary CTC

Pulled from **`employee_salary_profile`** (the same table the payroll and project manhours flows use), never from the `salary_master` template table.

Selection is **date-aware** and mirrors payroll conventions:

1. Only profiles with `is_active = 1`.
2. Prefer the profile whose effective range covers the selected month: `effective_from <= month-end` AND (`effective_to IS NULL` OR `effective_to >= month-start`).
3. If no profile covers the month, fall back to the **latest** active profile (`effective_from DESC`).
4. Salary value precedence: `gross_salary` → `gross` → `employer_cost`.

### Hourly Rate CTC

Derived from the **same salary profile** that supplied the monthly salary. The computation mirrors `EditProjectForm.jsx` (Project → Edit → Project Manhours → "RT/HR (Company)" auto-fill), so the report always agrees with the project-cost screen:

| `salary_type`       | Hourly rate used                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `hourly`            | the profile's stored `hourly_rate` column                                                   |
| `daily`             | the profile's stored `daily_rate` column                                                    |
| `custom`            | the profile's stored `hourly_rate` column                                                   |
| `monthly` (default) | `gross_salary ÷ (std_working_days × std_hours_per_day)`, defaults **26 days × 8 h = 208 h** |

The displayed rate is rounded to 2dp (`resolveHourlyRate`).

### Why the Amount can differ from rate × manhours at face value

The **billing amount uses the unrounded rate** (`computeRawHourlyRate`), while the grid displays the rounded rate. This matches the company's Excel template: a ₹20,000 salary at 240 standard hours displays **83.33** yet bills **16,666.67** (= 83.333… × 200 h), not 16,666.00.

```
resolveHourlyRate(p)      = round2(computeRawHourlyRate(p))   // display
amount                    = round2(computeRawHourlyRate(p) × manhours)   // billing
```

Money arithmetic goes through `@/lib/money` (`mul`, `toNumber`) — no raw float operators on currency.

---

## Manhours source and employee resolution

Manhours come from **`user_activity_assignments.daily_entries`** — the actual daily time log employees fill in (same source as the Timesheet report and the Project Status person×day matrix). `daily_entries` is a JSON array:

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

Employees with **zero hours in the month are dropped** — a billing statement only charges worked time.

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
	months: string[]; // YYYY-MM, newest first: attendance months ∪ daily_entries months ∪ current month
	latest_month: string | null;
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
	totals: { total_manhours: number; total_amount: number };
}

interface BillingEmployeeRow {
	sr_no: number; // 1-based, after sorting by employee name
	employee_id: number | null;
	employee_code: string;
	employee_name: string;
	designation: string;
	monthly_salary_ctc: number;
	hourly_rate_ctc: number; // displayed, 2dp
	total_manhours: number; // 2dp
	amount: number; // unrounded rate × manhours, 2dp
}
```

Validation: `project_id` must be a positive integer, `month` must match `^\d{4}-\d{2}$`. Unknown project → 404.

---

## Page design

### Filters (print-hidden)

Three dependent `SearchableSelect` dropdowns (`src/components/ui/searchable-select.jsx`):

1. **Client Name** → sets client; resets project to that client's first project
2. **Project Name/Number** → filtered by client; label is `project_code - project_name`
3. **Month/Year** → defaults to `meta.latest_month`

Plus Refresh, Print (`window.print()`), and Export Excel buttons. Defaults are applied once when meta arrives (first client, its first project, latest month).

### Sheet

An Arial `text-[10px]` bordered grid (`border-black`, like the Timesheet report) with:

- Header block: `Client Name :` / `Project Name/Number :` / `Month/Year :` label-value rows
- Table: `Sr. No. | Employee Name | Designation | Monthly Salary CTC | Hourly Rate CTC | Total Manhours | Amount` (gray header band, right-aligned tabular-nums money/manhour columns)
- Total row: total manhours + total amount
- Empty state: "No manhours logged on this project in {month}."

Money renders via `formatCurrency` (en-IN INR); manhours via `toFixed(2)`.

### Auth states

Loading (spinner + Navbar), Access Denied (red X panel), error (red panel + Retry), and the empty/sheet states above.

---

## Excel export

`GET /api/reports/manhours-billing/download?project_id=&month=` returns an `.xlsx` (exceljs) that mirrors the template exactly:

- Rows 1–3: `Client Name :`, `Project Name/Number :`, `Month/Year :` label + merged value cells
- Row 5: brand-purple header row with the seven columns
- Data rows (salary/hourly/manhour/amount right-aligned, `#,##0.00`)
- Total row (manhours + amount bold)

Filename: `Manhours_Billing_<CLIENT>_<PROJECTCODE>_<MONTH>.xlsx`.

---

## Files changed

| File                                                         | Change                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/app/reports/manhours-billing/data-source.ts`            | **Created** — types, pure transforms (unit-tested), server fetchers                       |
| `src/app/reports/manhours-billing/page.tsx`                  | **Created** — filter bar + print-styled sheet + Excel export button                       |
| `src/app/reports/manhours-billing/excel-template.ts`         | **Created** — ExcelJS workbook builder                                                    |
| `src/app/api/reports/manhours-billing/route.ts`              | **Created** — meta/data JSON API with RBAC                                                |
| `src/app/api/reports/manhours-billing/download/route.ts`     | **Created** — Excel download with RBAC                                                    |
| `src/__tests__/reports/manhours-billing/data-source.test.ts` | **Created** — 24 unit tests (parsing, rate math, profile selection, row building, totals) |
| `src/components/Navbar.jsx`                                  | Added "Manhours Billing" entry to `reportsMenuConfig` (`ReceiptPercentIcon`)              |
| `src/components/Sidebar.jsx`                                 | Added `NavRow` "Manhours Billing" in Reports section (`BanknotesIcon`)                    |
