# Timesheets use recorded Work Periods

**Status: accepted design; not implemented.**

Accent currently records a work date and duration. ERPNext Timesheets need actual start and end times. We chose to collect real Work Periods in My Project Activities and derive Logged Hours from them. Keep historical duration-only logs visible as recorded. Neither infer their times nor use project estimates as Logged Hours.

## Recording and corrections

- One row is one Work Period. Add requires a Project, Activity, Sub-activity, Start, and End. Offer **No sub-activity** only if the selected Activity has none.
- Employees can log the same Project Activity again in a separate row. They record work after the period ends, even if the Activity is still In Progress. Accent calculates duration from the endpoints.
- Require a User Account linked to an Employee. Reject overlapping Work Periods for that Employee across all Projects, even when two saves arrive together. Allow periods that touch at an endpoint. Older duration-only logs have no endpoints to check.
- Use India Standard Time (`Asia/Kolkata`). Employees can add, edit, or delete their own Work Periods only when both endpoints fall on today or yesterday. For edits, the saved and replacement endpoints must both qualify. Reject a future end time.
- Managers with Project edit permission handle older entries and corrections in the project editor. The same overlap rule applies. Saving an unrelated change from a stale project form must not erase a Work Period.

## Dates and totals

- Open the current Monday–Sunday week by default. Previous and Next let Employees browse earlier weeks, including weeks whose logs they can no longer change.
- An overnight period stays one editable row. Credit elapsed time to each date it covers. For example, Monday 22:00–Tuesday 02:00 gives each day two hours.
- Show the same row in both weeks when it crosses a week boundary. Each week totals only the time within that week. Keep one quantity on Date Completed, which defaults to the period's end date. Count quantity only in the week of Date Completed.
- Keep estimates separate. [ADR-0010](0010-hours-logged-pay-basis.md) still governs current Accent payroll. This decision does not rewrite recorded Payroll Slips or decide the Frappe payroll handoff, ID mapping, or sync.
