# Pay is the month's CTC over its hours, paid at the hours logged

Every slip priced Gross from the Salary Profile's agreed `gross_salary`, and the
one work-truth the rest of the system has — `user_activity_assignments.daily_entries`,
the Logged Hours behind the timesheet, utilization and project-cost reports —
never reached a Payroll Slip. Attendance could only subtract through a manual
`lop_deduction` nothing computed, and the glossary called CTC display-only. A
month could therefore be signed off with pay that had no traceable relationship
to the hours anyone worked.

We decided the month's Gross is **Hourly Rate × Logged Hours**:

- **Hourly Rate** = CTC ÷ **Basis Hours**.
- **CTC** is `employee_salary_profile.employer_cost`, falling back to
  `gross_salary` then `gross` — the Monthly Cost chain the cost and utilization
  reports already read.
- **Basis Hours** = the payroll month's working days (Sundays and active
  `holiday_master` dates excluded, `getWorkingDaysForMonth`) × the profile's
  `std_hours_per_day` (default 8). It is stored on the slip.
- **Logged Hours** = the month's `daily_entries.hours` summed per employee
  (overtime counts, uncapped — GLOSSARY.md: Logged Hours). Assignment rows
  resolve by `employee_id`, else the linked user's `employee_id`, else an
  email/username match, the resolution the company-wide cost report
  established. A month with no logged rows pays 0.
- The rule is the same for every Employee Type; the slip stores its four inputs
  (`ctc_used`, `basis_hours`, `hourly_rate`, `logged_hours`) so the arithmetic
  survives a later Salary Profile or timesheet change (ADR-0009).

Attendance no longer reduces money a second time: the export salary sheet's
absence pro-rata is gone, so no reader re-prices a slip. Attendance OT no longer
earns its own premium (`ot_rate` is stored 0) because the logged hours already
carry every hour worked at the rate; `overtime_hours` remains a snapshot figure.

Considered: (a) apportion over the profile's `std_working_days` (26, the
utilization report's denominator) — rejected, the month's own working calendar
is the attendance truth the request named; (b) apportion over the hours actually
attended (`employee_attendance` in/out times) — rejected, fewer attended hours
would _raise_ the rate; (c) cap pay at attended payable hours — rejected, hours
alone decide; (d) keep the attendance OT premium on top — rejected, it double
counts hours already in the numerator; (e) apply the rule only to hourly/daily
salary types — rejected, one rule for all.

Consequences: a fully logged month pays exactly the CTC (money math uses the
unrounded rate; `hourly_rate` stores the two-decimal display rate, as the
utilization report's CTC rate does); CTC becomes a payroll input, inverting the
previous glossary rule; hourly/daily/custom profiles' direct
`hourly_rate`/`daily_rate` no longer price payroll; a month whose timesheet was
not maintained now pays 0, which Generate shows before Finalize locks it; the
utilization report's Bench Cost keeps its own 26 × 8 CTC rate — the two rates
diverge by month and are a follow-up unification, not a hidden constant (note,
2026-10-05: ADR-0003's utilization-v2 amendment closes this — the utilization
report now prices at CTC ÷ Basis Hours); the Payroll Slip document, both PDFs
and the run dashboard print CTC / Month Hours / Hours Logged / Rate; the Excel
salary sheet reports the slip's own figures.

Operator-facing walkthrough of this decision: [`docs/app/payroll/operator-guide.md`](../app/payroll/operator-guide.md).
