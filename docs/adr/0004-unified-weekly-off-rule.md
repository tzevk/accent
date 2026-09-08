# Unified weekly-off rule (Sun + 2nd/4th Sat) shared by attendance, leaves, and reports

Leave-approval skipped only Sundays while reports treated 2nd/4th Saturdays (`ceil(day/7) ∈ {2,4}`) as weekly off, so a leave around a 2nd/4th Saturday was charged and attendance-written for that Saturday. We unify on one `isWeeklyOff(date)` helper used by attendance marking, leave-approval, and reports — matching the `Capacity` definition — and the Saturday-WO button fills empty cells only across all loaded employees (1st/3rd/5th Saturdays stay working, `H` wins on collision).

Considered: keeping approval Sunday-only. Rejected because it permanently breaks Saturday parity and payslips would contradict the timesheet.

Consequences: `is_holiday` starts being written on `H` saves (old rows fall back to status-derived); `EL` counts as paid leave and `UL` with `LWP` in summaries.
