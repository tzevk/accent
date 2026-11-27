# Work Periods and historical `daily_entries` — Data Model Reference

> Domain reference for [#468](https://github.com/tzevk/accent/issues/468) and
> [ADR-0038](../adr/0038-timesheets-use-recorded-work-periods.md). The legacy
> `daily_entries` behavior was last verified 2026-10-06; the Work Period rules
> below describe the accepted #468 contract. Part of the
> [documentation index](../README.md).

## Two kinds of evidence, one effective read

| Record                                | Authoritative facts                                                                          | Identity and editing                                                               | Daily reporting                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Work Period**                       | Real Start and End, Employee, Project Activity assignment, quantity, Date Completed, remarks | One canonical `work_periods` row per continuous interval; duration is derived      | Split at IST midnight; the same period can contribute to several dates, weeks, or months |
| **Daily Activity Entry** (historical) | A recorded date and duration, with optional quantity and remarks                             | An item in the assignment's legacy `daily_entries` JSON; it has no clock endpoints | Stays on its recorded date with its recorded duration                                    |

A Work Period is not a duration-only Daily Activity Entry, an estimate, an
Attendance Record, a Work Session, or approval of Payable Hours. Several Work
Periods may reference the same Project Activity assignment. Editing or deleting
one changes only that period.

### Canonical storage: `work_periods`

| Column           | Type                                            | Meaning                                                       |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| `id`             | `varchar(36)`                                   | Stable Work Period identity                                   |
| `assignment_id`  | FK → `user_activity_assignments.id`, `RESTRICT` | Project Activity assignment; remains separate from the period |
| `employee_id`    | `INT` FK → `employees.id`, `RESTRICT`           | Employee who worked the period                                |
| `start_ms`       | `BIGINT`                                        | Authoritative start instant, stored as epoch milliseconds     |
| `end_ms`         | `BIGINT`                                        | Authoritative end instant, stored as epoch milliseconds       |
| `date_completed` | `DATE`                                          | Date that receives the period's quantity once                 |
| `quantity`       | `DECIMAL(10,2)`                                 | Completed quantity attached to the period                     |
| `remarks`        | `TEXT`                                          | Remarks attached to the period                                |

The API exposes Start and End as explicit IST local strings
(`YYYY-MM-DDTHH:mm`). Parsing and formatting use `Asia/Kolkata`, never the
browser, server, or database default zone. Duration is
`(end_ms - start_ms) / 1000`; users do not enter an hours total.

### Projection and view

`user_activity_assignments.work_period_entries` is a separate, transactionally
maintained projection of daily Work Period attribution. It is not a second
independently editable copy of a Work Period.

The read-only `logged_activity_assignments` view exposes all existing assignment
columns and the shared effective entries as `daily_entries`. Until the
projection exists, legacy `daily_entries` remain unchanged; no endpoints or
Employee links are inferred or backfilled.

## Effective daily attribution

The shared read combines two sources exactly once:

1. Historical Daily Activity Entries keep their recorded date, hours, quantity,
   and remarks.
2. Each Work Period is split at every IST midnight, including month boundaries.
   Each slice carries only the elapsed hours belonging to that date.

Quantity and remarks belong to the underlying Work Period. Quantity is credited
once, on Date Completed, which defaults to the period's IST end date and retains
the no-future-date rule. A Date Completed in another week attributes quantity
there without adding time to that week. Derived slices must never be presented
as independently editable legacy entries.

For example, Monday `2026-11-23T22:00` to Tuesday `2026-11-24T02:00` is one Work
Period with two effective entries: two hours on each date. A Sunday-to-Monday
period appears in both weekly views with the same identity and original
endpoints, but each week counts only its own elapsed share.

## Work Period API and writes

`/api/work-periods` is the canonical write surface:

| Method           | Scope                                                            | Contract                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`            | Self, Live Monitoring admin, or Project manager                  | `?week=YYYY-MM-DD` selects a Monday–Sunday week. Admins and super admins can use `userId` to view another User Account’s Work Periods, read-only. Project manager reads use `projectId` and require Project edit permission. |
| `POST`           | Self, or manager with `manager: true`                            | Self selects Project, Discipline, Activity, and Sub-activity; manager selects `projectId` and `assignmentId`. Both supply Start, End, quantity, Date Completed, and remarks.                                                 |
| `PUT` / `DELETE` | Self for an eligible own period, or manager with `manager: true` | The manager targets `{ id, projectId, ...periodFields }` in the authorized Project scope.                                                                                                                                    |

Successful mutations return `{ success: true, data: { id }, affected_rows: 1 }`.
Reads return `{ success: true, data: { canLog, today, weekStart, periods } }`.
Dashboard reads also return `readOnly: true` when an admin views another User
Account. These responses disable logging and editing.
`periods` contains Work Period rows with assignment labels, explicit IST
endpoints, duration, weekly hours and quantity, and editability.

`src/lib/work-periods.ts` owns the shared pure rules for exact IST parsing and
formatting, Monday week starts, two-day eligibility, daily attribution, and
week-second intersections.

### Validation and concurrency

- Require a direct User Account link to an existing, non-deleted Employee and
  validate Project membership and the Activity catalog selection on the server.
- Require both explicit endpoints, a positive interval, and an End that is not
  in the future. Reject malformed or impossible calendar dates. An earlier clock
  time is not an implicit next-day End. Activity status is not a completion
  requirement.
- **No sub-activity** is valid only when the selected Activity has no children.
- Compare half-open intervals `[Start, End)` across all of the Employee's Work
  Periods and Projects, excluding the period being corrected. Touching endpoints
  are allowed; historical duration-only entries do not participate.
- Lock the Employee row first, then check overlap and perform every mutation in
  the same transaction. This applies to self-service and manager writes, so two
  concurrent saves cannot both pass.

### Two-day self-service window

Self-service add, edit, and delete are limited to today and yesterday in IST:

- Add: both proposed endpoints must qualify.
- Edit: both saved endpoints and both replacement endpoints must qualify.
- Delete: both saved endpoints must qualify.

A Monday 22:00–Tuesday 02:00 period is editable on Tuesday, but not on
Wednesday. The server's current time and `Asia/Kolkata` decide eligibility.

### Entering a Work Period

In **My Project Activities**, select **Add** and fill the inline row. Open
**Start Period** and **End Period** to choose the work date and the time in IST.
For overnight work, select different dates explicitly. An earlier end clock
time does not change either date. **Date Completed** defaults to the End date
and can be set separately for quantity reporting.
Accent only accepts finished Work Periods. For a period that ends today, choose
an end time no later than the current time in IST.
When editing a period, the saved work dates stay the same unless you change
them. Changing **Date Completed** alone changes only quantity reporting.
**Activity Description** is required when employees add or edit a Work Period.
**Quantity** is optional.
Accent calculates **Manhours** from the saved times. **Default MH** shows the
catalog default, not the assignment's planned hours. Historical duration-only
rows are read-only and have no start or end times.
Hover over a column heading or focus it with the keyboard for a short explanation.

### Monday–Sunday weeks

My Project Activities opens the current IST Monday–Sunday week. Previous and
Next browse history without changing write eligibility. A period is visible in
every week its half-open interval overlaps, with one stable identity and its
original endpoints. Weekly seconds are the intersection with that week; a
period ending at Monday 00:00 contributes no time to the new week.

The date filters count only elapsed hours inside the selected dates. A period
also appears if its quantity belongs to the selected dates, even if none of
its hours do. Historical Daily Activity Entries appear on their recorded dates.
Project Activity assignments without recorded work do not appear as rows, but
their Projects remain available in **Add**.

### Manager corrections and protected Project saves

A manager with the existing Project edit permission can add, correct, and remove
older Work Periods in the Project editor. The manager bypasses only the
two-day window, not endpoint, future-time, catalog, or overlap validation.

General Project saves must not replace or delete Work Periods or overwrite their
projection, including saves from stale assignment snapshots. Work Period
corrections use their own API. The `RESTRICT` foreign keys also prevent generic
assignment or Employee deletion from silently removing canonical periods.
The assignment endpoint reports a conflict when recorded Work Periods prevent
deletion or an assignee change. Keep the original assignment for the recorded
work and create a separate assignment for the new assignee.

## Read paths

| Consumer                                  | Source                                             | Meaning                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **My Project Activities**                 | `/api/work-periods` plus legacy assignment history | One row per Work Period; historical duration-only logs remain visible without guessed Start or End                                               |
| **Activity assignments GET**              | Effective `daily_entries`                          | When merged for the reminder, raw historical JSON is returned separately as `legacy_daily_entries`; derived entries are never rendered as legacy |
| **Dashboard reminder**                    | Effective entry dated today in IST                 | A successful self-service Work Period save counts as activity evidence                                                                           |
| **My Timesheet**                          | Shared effective daily attribution                 | Credits overnight and month-crossing time to the dates worked                                                                                    |
| **Admin Timesheet and Excel export**      | Same effective attribution                         | Matching daily, monthly, normal, and overtime totals                                                                                             |
| **Employee and Project activity reports** | `logged_activity_assignments` / shared attribution | Mixed legacy and Work Period data without double counting                                                                                        |

Most server-side report readers continue to decode effective entries through
`src/lib/logged-hours.ts` (ADR-0010): `parseDailyEntries` for hours and
`parseDailyEntryRecords` when quantity or remarks are also needed. Add a reader
there rather than parsing JSON again.

### Two-hour activity log reminder

The assignments API returns `data.lastActivityLoggedAt` from authenticated
self-service save markers in `user_activity_logs`
(`resource_type='project_activity_save'`, successful create/update, actor
matching the requested user). A successful self-service Work Period save keeps
this evidence working. Failed writes, rejected overlaps, deletions, and manager
saves on another Employee's behalf do not reset the Employee's reminder.

Assignment `updated_at` is never used as a substitute. Old history without a
marker remains unknown and receives first-visit grace. The existing per-user/day
baseline, dismissal snooze, in-memory fallback, load-failure silence, and
missing-daily-entry reminder priority are unchanged.

## Legacy lock semantics

`isLocked` belongs to historical Daily Activity Entries. The Project editor set
it when adding an entry, the assignments API preserved unknown fields during
normalization, and My Activities treated an entry as locked when the flag was
true or its date was before today.

It does not control Work Period eligibility. Work Period editability comes from
the IST two-day window or an authorized manager correction.

## Legacy aggregate drift

The parent assignment's `qty_completed` and `actual_hours` columns can drift
from the sum of legacy `daily_entries`; see
[ACTIVITY_NORMALIZATION.md](./ACTIVITY_NORMALIZATION.md) §1. Effective Logged
Hours readers must not let a stale aggregate mask newly logged Work Period time.
Project estimate fields remain separate planned-effort inputs and are never
populated from elapsed time.

Attendance status and overtime remain separate inputs. Current payroll continues
to follow ADR-0010, and correcting a Work Period does not reprice a recorded
Payroll Slip.
