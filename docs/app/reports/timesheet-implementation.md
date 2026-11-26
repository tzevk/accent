# Timesheet Report — Implementation

## Overview

`/reports/timesheet-report` — a per-employee monthly timesheet rendered in the same shape as the company's Excel monthly-timesheet template: a workbook header (employee code/name/designation/department, month/year), a day-column matrix with per-project hour rows, a "Daily Man Hours" (normal) row, an "Over Time Hours" row, and totals. Day-level status and attendance overtime come from `employee_attendance`; holiday names come from `holiday_master`. Project/activity hours come from the shared effective daily attribution: historical duration-only Daily Activity Entries plus elapsed slices of canonical Work Periods (#468, ADR-0038).

The reference workbook, `docs/extras/05-shantanu_sonawane_TIMESHEET_MAY_2026.xlsx`, is a gitignored local asset.
The published implementation is [excel-template.ts](../../../src/app/reports/timesheet-report/excel-template.ts).

**Route:** `src/app/api/reports/timesheet-report/route.ts` (+ `download/route.ts` for Excel)  
**Page:** `src/app/reports/timesheet-report/page.tsx`  
**Data:** `src/app/reports/timesheet-report/data-source.ts`  
**Excel:** `src/app/reports/timesheet-report/excel-template.ts`  
**Nav:** Navbar Reports dropdown + Sidebar Reports section (`reports:read` or `project_activities` field permission)

---

## Architecture

### Data flow

```
Browser (filters: employee → month)
  │  GET /api/reports/timesheet-report               (meta: employees, months)
  │  GET /api/reports/timesheet-report?employee_id=&month=   (full matrix)
  ▼
  ├─ fetchTimesheetMeta()  → active employees + months with effective daily entries
  └─ fetchTimesheetData()  → employee, day matrix, holidays, effective project rows,
  │                          summary, normal/OT hours
  ▼
page.tsx (grid) / excel-template.ts (export) — same transforms
```

### Data sources

| Section                     | Source table                  | How it is derived                                                                                                                    |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Employee header**         | `employees`                   | `CONCAT_WS(' ', first_name, last_name)`; designation = `position`/`designation`; `department`                                        |
| **Day matrix / statuses**   | `employee_attendance`         | `status` (P/HD/PL/WO/H/A/…), `overtime_hours`, `is_weekly_off`, `is_holiday` for the month                                           |
| **Holidays**                | `holiday_master`              | `is_active = 1` rows in the month; name + date                                                                                       |
| **Weekly-off policy**       | computed                      | Sundays + **2nd and 4th Saturdays** only (see below) when no attendance row exists                                                   |
| **Project/activity rows**   | `logged_activity_assignments` | Read-only view combining legacy `daily_entries` with the transactional `work_period_entries` projection as effective `daily_entries` |
| **Standard day / half day** | `attendance_settings`         | `standard_working_hours` (default 8), `half_day_hours` (default 4)                                                                   |

---

## Work Period attribution

Canonical Work Periods live in `work_periods`, separate from Project Activity
assignments and estimates. The report reads their daily projection through
`logged_activity_assignments`; it does not create a second duration-only record
when a period is saved.

- Split elapsed time at every IST midnight, including month boundaries. A period
  crossing midnight contributes only each date's share to the monthly grid.
- Keep one quantity on Date Completed and count it once. Quantity is not used to
  infer hours.
- Keep historical duration-only entries on their recorded dates. Never invent
  Start or End for them.
- Discover report months from effective daily entries, so a Work Period crossing
  a month boundary makes both affected months available.

My Timesheet, this report, and the Excel export use the same effective daily
attribution, so their daily and monthly Logged Hours reconcile.

## Day matrix

`buildDays(month, attendanceRows, holidays, settings)` produces one `TsDay` per calendar day:

- `status` comes from the attendance row (empty string → `null`); `hours` = `hoursForStatus(status, settings)` (8h for present, 4h for half-day, 0 for non-working).
- **Weekly-off rule** (`isScheduledWeeklyOff`, a thin alias over the shared `isWeeklyOff` in `src/utils/weekly-off.ts`, [ADR-0004](../../adr/0004-unified-weekly-off-rule.md)): Sundays plus the Saturday of the 2nd and 4th weeks (`ceil(day/7) ∈ {2, 4}`). When an attendance row exists, its `is_weekly_off` flag wins; without a row the rule applies. Mirrors the dashboard attendance card and the company's "alternate Saturday off" policy.
- `day_type` = `holiday` > `weekly_off` > `working` (holiday_master wins).
- `buildSummary` counts present/half-day/weekly-off/holiday/absent/leave days and sums standard + attendance-overtime hours for the summary strip.

## Monthly hours and overtime

`computeMonthlyHours(projects, days, settings)` resolves the two rows the matrix totals use:

- **Source = `project`** when the employee logged any project hours in the month (from effective `daily_entries`: legacy durations plus Work Period slices). The raw per-day total across all assignments is split:
  - `daily[date] = min(logged, standard_working_hours)` — the **Daily Man Hours** row credits at most a standard day;
  - `overtime_daily[date] = max(0, logged − standard)` — the excess goes to the **Over Time Hours** row.
- **Source = `attendance`** otherwise: `daily` = attendance status hours, `overtime_daily` = the attendance `overtime_hours` column.

`normal` = Σ daily (capped), `overtime` = Σ overtime_daily, `total` = normal + overtime. Everything reconciles: Σ logged = normal + overtime.

## Project rows (effective `daily_entries`)

`buildProjectRows(rawRows, month)` parses each assignment's effective
`daily_entries` (`[{ date, qty_done, hours, remarks }]`) from
`logged_activity_assignments`:

- Entries outside the month are dropped; entries with `hours <= 0` are ignored;
  duplicate dates within one assignment are summed.
- Each Project row carries `days` (per-day hours) and `total_hours` (monthly sum,
  2dp).
- The assignment query still matches the Employee via `uaa.employee_id`, or any
  linked login account (`users` email/username/employee_id match), excluding
  `status = 'Cancelled'`.
- A Work Period crossing a month boundary stays one canonical record but adds
  only its elapsed share to each month. A legacy duration remains on its
  recorded date and is not converted into guessed endpoints.

**The per-project cells and the "Monthly Man Hours" total column render hours
capped at the standard working day per day.** `capProjectDays` splits an over-8h
day across its Projects proportionally so the top section never sums above the
standard day; the daily excess is surfaced in the Over Time Hours row. The cap
preserves the raw log in the OT row and grand total.

Rows with zero hours still appear when their `start_date`/`due_date` falls in the
month. The report's display cap and normal/OT split are unchanged by Work Period
support.

## Inputs stay separate

- **Estimates:** Work Periods never write `planned_hours`, `estimated_hours`, or
  another Project estimate. Elapsed actual effort and planned effort retain
  separate editing paths.
- **Attendance:** Work Periods do not create Attendance Records, Punches, or
  Payable OT. Attendance status, attendance overtime, weekly-off and holiday
  policy, and the attendance fallback when no Project hours are logged remain
  unchanged.
- **Payroll:** Logged Hours remain the current payroll numerator under ADR-0010;
  the formula and recorded Payroll Slip snapshots are unchanged. A Work Period
  is evidence of work, not approval of Payable Hours.

---

## Auth

Three-tier, same as `client-balance`, `manhours-billing`, `employee-report`, and `project-activities`:

1. `is_super_admin === true` → full access
2. `hasPermission(user, 'reports', 'read')` → full access
3. `hasProjectActivitiesFieldPermission(user)` — `field_permissions.modules.reports.sections.report_access.fields.project_activities.permission` is `'view'` or `'edit'` (or legacy `project_reports`)

Unauthenticated → 401. No permission → 403. The `download` route applies the identical gate.

---

## API contract

### Meta (no params)

```typescript
interface TimesheetMeta {
	employees: TsEmployee[]; // { id, employee_id, name, department, position, designation }
	months: string[]; // YYYY-MM, newest first: attendance months ∪ daily_entries months ∪ current month
	latest_month: string | null;
}
```

### Data (`?employee_id=&month=`)

```typescript
interface TimesheetData {
	employee: TsEmployee | null;
	month: string; // YYYY-MM
	year: number;
	month_label: string; // e.g. "August 2026"
	days: TsDay[]; // one per calendar day (date, day, weekday, status, hours, day_type, …)
	holidays: { name: string; date: string }[];
	projects: TsProject[]; // per-assignment rows with per-day hours
	summary: TsSummary; // present/half/wo/holiday/absent/leave counts + hours
	hours: TsMonthlyHours; // daily (normal, capped), overtime_daily, normal, overtime, total, source
	settings: { standard_working_hours: number; half_day_hours: number };
}
```

Validation: `employee_id` must be a positive integer, `month` must match `^\d{4}-\d{2}$`.

---

## Page design

### Filters (print-hidden)

Two `SearchableSelect` dropdowns: **Employee** (name + employee code, searchable) and **Month/Year**, plus Refresh and Export Excel buttons. Defaults applied once when meta arrives (first employee, `latest_month`).

The report uses the same page gutters and panel height as Projects. Filters wrap inside the panel. The workbook grid keeps its fixed column layout; only the grid scrolls horizontally.

### Sheet

An Arial `text-[10px]` bordered grid (`border-black`, `min-w-[1950px]`):

- Workbook header: logo, "Monthly Time Sheet", employee code/name/designation/department, month/year.
- **Daily Man Hours** table: `Days | Project Code | Activity | Count | <day columns> | Monthly Man Hours`. Weekday header row + day-number row; non-working columns get the reference blue (`#0070C0`) with the day name spelled **vertically** down the column (`SUNDAY` / `SATURDAY` / `LEAVE` / holiday name).
- 20 fixed-height normal rows (empty rows preserve the Excel layout): project code, activity, Count (`qty_completed`), per-day cells via `formatClock(hours)` (`9.3h → 09:18`), total via `formatElapsed(hours)` (`174.5h → 174:30:00`).
- "Over Time Hours" row: daily OT values (`data.hours.overtime_daily`), blue text.
- "Daily Man Hours" row: capped normal hours per day.
- Totals: Sub-Total Of Normal Hours, Sub-Total Of Over Time Hours, Total Monthly Hours (bold).
- Signature strip: Prepared By / Checked By / Approved By.

### Auth states

Loading (spinner + Navbar), Access Denied (red X panel), error (red panel + Retry), and the empty/sheet states above.

---

## Excel export

`GET /api/reports/timesheet-report/download?employee_id=&month=` returns an `.xlsx` (exceljs, server-only) mirroring the on-screen sheet:

- Rows 1–4: brand-purple title + employee info block (code/name, designation/department, month/year)
- Row 5–6: weekday + day-number headers, blue on non-working columns
- Row 7: attendance statuses / vertical day labels on blue columns
- Project rows: same raw per-day hours, day cells stored as a fraction of a day with `hh:mm` number format, totals with `[h]:mm:ss`
- Daily Man Hours (project log), Overtime Hours, sub-totals, grand total, day-type summary strip, signature strip

Filename: `Timesheet_<EMPLOYEE_NAME>_<MONTH_LABEL>.xlsx` (e.g. `Timesheet_ROSHAN_MALIK_AUGUST_2026.xlsx`).

---

## Original Timesheet implementation files

| File                                                     | Change                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/app/reports/timesheet-report/data-source.ts`        | **Created** — types, pure transforms (unit-tested), server fetchers                 |
| `src/app/reports/timesheet-report/page.tsx`              | **Created** — filter bar + print-styled reference-grid sheet + Excel export button  |
| `src/app/reports/timesheet-report/excel-template.ts`     | **Created** — ExcelJS workbook builder (mirrors the on-screen grid)                 |
| `src/app/api/reports/timesheet-report/route.ts`          | **Created** — meta/data JSON API with RBAC                                          |
| `src/app/api/reports/timesheet-report/download/route.ts` | **Created** — Excel download with RBAC                                              |
| `src/app/reports/timesheet-report/data-source.test.ts`   | **Created** — unit tests (statuses, weekly-off rule, day matrix, parsing, hours/OT) |
| `src/lib/timesheet-cap.test.ts`                          | **Created** — 7 unit tests for `capProjectDays`                                     |
| `src/lib/timesheet-cap.ts`                               | **Created** — per-project per-day capping to the standard working day               |

> The per-project section intentionally caps at the standard working day (8h) — this matches the reference template and the "normal hours in the top section, everything above 8h as overtime" rule. The proportional split keeps every project visible on over-8h days.

---

## Removed: Active Hours (Screen Time) row

The informational **Active Hours (Screen Time)** row — a per-day display of `user_screen_time` heartbeat seconds, excluded from all totals — has been removed from the report.

**Removal logic** — every layer that touched screen time was deleted, not disabled, so no dead code or API surface remains:

| Layer                 | What changed                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data-source.ts`      | Deleted `TsScreenTime` interface, `buildScreenTime()` transform, the `screen_time` field on `TimesheetData`, and the `user_screen_time` fetch (linked-user resolution + month-bounded seconds query) in `fetchTimesheetData()`. The employee → login-account link (`employeeEmail`/`employeeUsername`) is still used by the project-assignments query. |
| `page.tsx`            | Deleted the `TsScreenTime` interface, `formatActiveSeconds()` helper, and the conditional "Active Hours (Screen Time)" grid row. The grid now goes straight from the Daily Man Hours row to the Sub-Total/Total rows.                                                                                                                                  |
| `excel-template.ts`   | Deleted the Active Hours export row block (day cells as day-fractions + emerald totals) and the screen-time sentence from the workbook note. Row indices for the totals/summary/signature strips recompute from the cursor as before.                                                                                                                  |
| `data-source.test.ts` | Deleted the `buildScreenTime` import and its 3 tests (per-day aggregation, no-active → not present, empty/malformed input).                                                                                                                                                                                                                            |

Screen-time data collection (`activity-logger.ts`, `/api/screen-time`, live-monitoring, productivity, user-status) is untouched — only the timesheet's presentation of it is gone. The on-screen sheet and the Excel export stay in sync because both read the same `TimesheetData` shape.
