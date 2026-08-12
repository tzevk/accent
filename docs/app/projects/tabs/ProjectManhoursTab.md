# Project Manhours Tab — Implementation

## Overview

`src/app/projects/[id]/edit/tabs/ProjectManhoursTab.jsx` — the **Project Manhours** tab in the project edit form. Per-team-member monthly manhours and cost tracking for the project: a row per team member with a rate (company / accent), twelve monthly-hour cells, and derived Total Hrs / Company Cost / Accent Cost / P&L columns. Rows are stored on the project as `project_manhours_list` (JSON).

Parent: `src/app/projects/[id]/edit/EditProjectForm.jsx` (state owner + save path).

---

## Data model

Each row in `projectManhours` state (annual shape, written verbatim to `project_manhours_list`):

| Field                | Type                                         | Meaning                                                                         |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| `id`                 | number                                       | Local row id (`Date.now()` on Add Row)                                          |
| `employee_id`        | string                                       | Option id — employee PK string, or `team:<member.id>` for external team members |
| `employee_name`      | string                                       | Display name                                                                    |
| `source_employee_id` | string \| ''                                 | Employee PK (empty for external members)                                        |
| `salary_type`        | `monthly` \| `hourly` \| `daily` \| `custom` | Rate type; `monthly` rows auto-fetch attendance hours                           |
| `rate_company`       | string \| number                             | RT/HR (Company) — the cost rate                                                 |
| `rate_accent`        | string \| number                             | RT/HR (Accent) — the billed/reckoned rate                                       |
| `monthly_hours`      | `{ jan…dec: string \| number }`              | Month-keyed hours (lowercase 3-letter keys, calendar order)                     |
| `legacy_data`        | object (optional)                            | Preserved pre-column legacy row (engineering/designer/drafting/…)               |

## Sources of team members

`teamManhourPeople = teamEmployees + externalTeamMembers`:

- **teamEmployees** — `employeesWithRates` (salary profiles) filtered to people matched to `projectTeamMembers` by employee id / code / email / name.
- **externalTeamMembers** — `projectTeamMembers` with no employee-profile match (vendors via `account_type === 'vendor'` / `vendor_id`, or unmatched members), given `rate: 0`, `salary_type: 'custom'`, flagged `is_external_team_member`.

## Attendance auto-fill

On selecting a `monthly`-salary employee, `fetchAttendanceHours(employeeId)` (`EditProjectForm.jsx`) calls `GET /api/attendance?employee_id=&year=` and builds a `monthly_hours` map keyed `jan…dec` (calendar keys — independent of the display order). `P`/`HD`/`OT` records count; 8h default, in/out-time delta when present, half-day halved. The map replaces the row's `monthly_hours` (still user-editable).

## Load normalization (`EditProjectForm.jsx`, ~line 1566)

`project_manhours_list` may arrive in three shapes; all are normalized to the annual-row shape on load:

1. **Annual rows** (current) — used as-is.
2. **Month-grouped rows** `[{ id, month, entries: [{ employee_id, employee_name, salary_type, rate, hours }] }]` — flattened per employee into `monthly_hours[monthKey]`; `rate_company` = entry `rate`, `rate_accent` left blank.
3. **Legacy flat rows** (`name_of_engineer_designer`, `engineering`, …, `remarks`) — kept under `legacy_data` (not month-mapped).

Save always writes the annual-row shape: `project_manhours_list: JSON.stringify(projectManhours || [])`.

---

## Columns

`Team Member | Salary Type | RT/HR (Company) | RT/HR (Accent) | <Apr … Mar> | Total Hrs | Company Cost | Accent Cost | P&L | Actions`

- **Month columns are FY-ordered (Apr → Mar)** — display order only; `monthly_hours` keys stay `jan…dec` calendar, so attendance auto-fill, month totals, and the save payload all map by key regardless of column order. Shared constants `fyMonths` / `fyMonthKeys` drive the header, row inputs, and totals row so the three stay in sync.
- **Total Hrs** = Σ `monthly_hours`.
- **Company Cost** = Total Hrs × `rate_company`; **Accent Cost** = Total Hrs × `rate_accent`.
- **P&L** = Accent Cost − Company Cost (profit positive, loss negative). Header carries the tooltip "Profit & Loss (Accent Cost − Company Cost)". Cell color: green profit, red loss, gray at zero.
- **Grand total row** sums hours and both costs across rows; per-month totals render `–` for zero months.

## Money arithmetic

All cost math uses `@/lib/money` (decimal.js) — raw `parseFloat` + JS operators on money are banned (AGENTS.md):

- `totalHrs = add(...Object.values(monthly_hours))`
- `companyCost = mul(rate_company, totalHrs)`, `accentCost = mul(rate_accent, totalHrs)`
- `pl = sub(accentCost, companyCost)`; comparisons via `gt(0)` / `lt(0)`
- Shared `totals` reducer (one computation for row + grand total): `add` / `mul` accumulators
- Display boundary: `toNumber()` → `toLocaleString('en-IN', { min 2, max 2 })` via a single `inrFormat` helper

## Excel export

The project workbook export (`edit/excel/export/buildPayloads.js`) does **not** include manhours — the tab is screen-only.

---

## Verification

- `next lint` — clean; `prettier --check` — clean.
- Browser end-to-end (super-admin session, Project Manhours tab): headers read `Apr … Mar … Total Hrs, Company Cost, Accent Cost, P&L, Actions`; with `rate_company = 100`, `rate_accent = 150`, Apr = 10h, row and grand total both render `10.0 / ₹1,000.00 / ₹1,500.00 / ₹500.00` — same values before and after the money.ts conversion, confirming the decimal path preserves results.

## Files

| File                                                     | Role                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/app/projects/[id]/edit/tabs/ProjectManhoursTab.jsx` | Tab UI + per-row/grand-total computation (FY months, P&L, money.ts) |
| `src/app/projects/[id]/edit/EditProjectForm.jsx`         | State owner, load normalization, attendance fetch, save payload     |

## Notes / dead code

- `addMonthSections` / `generateMonthRange` / `monthRangeStart` / `monthRangeEnd` (month-grouped-entry creation) are defined in `EditProjectForm.jsx` but unreachable — no UI calls them. The load migration still supports the month-grouped format for legacy data.
