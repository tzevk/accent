# Payroll runs lock the month; admin payroll consolidates under /admin/payroll/\*

Payroll integrity rested on nothing: `payroll_slips` are documented as immutable snapshots with `UNIQUE(month, employee_id)`, yet any admin could regenerate a month after some slips were already paid, and the schema's `payroll_runs` (status `draft→finalized`, with `payroll_audit_logs`) sat dead with zero code references. We decided to revive `payroll_runs` as a real lock: a month finalizes as ONE run covering both payroll and contract streams (no per-stream runs, no off-cycle `run_number>1` — arrears flow into the next month), reopen is super-admin-only, audit-logged, and blocked while any slip is paid, and run-level `paid` is derived from 100% per-slip `paid` rather than a manual transition that could drift. Finalize is blocked until every active employee has a slip. Payment stays per-slip (with a bulk mark-paid); audit logging covers every payroll mutation, not just run transitions. Historical slips (~3.2k in prod) get NO backfill runs — rows untouched; the self-service rule is "no run row → visible, run exists → visible when finalized."

Simultaneously the four scattered admin pages move under one `/admin/payroll/*` tree (dashboard merging the near-duplicate salary-sheet/salary-slip lists, `slips/[id]` detail, `rates/` with DA nested under it), with redirects from old URLs, one clean Navbar group, and run actions admin-only (`/employees/payroll` becomes master data only). Employees gain a first-ever My Payslips page served by a dedicated `/api/me/payslips` that forces `employee_id` to the session's own user.

Considered: (a) status quo per-slip locking only — rejected, regen after payment is the exact bug; (b) supplementary runs per month — rejected, requires redesigning the `UNIQUE(month, employee)` key; (c) label-only rename keeping old URLs — rejected because both list pages were merging anyway, making the move nearly free; (d) backfilling runs for history — rejected as unneeded migration writes (grandfather rule is one query branch).

Consequences: generate/reopen APIs must check run status by month (no FK from slips to runs); P1 structure → P2 run/audit → P3 self-service + DA unification to `payroll_schedules`; `salary_structures` retirement stays deferred per ADR-0001; dropping dead `employee_payroll`, `employee_payroll_components`, `statutory_payments` tables in the same migration.

## Monthly eligibility and saved run roster (2026-11-09)

Generate, Preview, Finalize, and draft employee-cost reporting use one monthly eligibility rule.
Joining Date takes precedence over Hire Date; Exit Date is inclusive.
Any employment overlap with the month qualifies, including a mid-month joiner or a leaver now marked inactive.
Record creation time is not an employment date.
Missing or inconsistent employment dates on payroll candidates require review rather than silent exclusion.
Employees paid through either stream remain eligible regardless of Employee Type.

Select the Salary Profile covering the later of the month's first day and the employment start.
This supports new joiners without changing the established hours-based formula or splitting an existing employee's mid-month rate change.
Missing profiles, missing slips, uncertain employment dates, and slips outside eligibility prevent finalization.
Existing slips alone never define the expected roster.

Finalize saves the validated roster and freezes allocations in the same transaction as the run transition.
Both are postconditions: any failure rolls back the entire finalization.
Generation and finalization serialize through the month's run lock.
Reopening preserves earlier roster versions; re-finalization appends a newly validated version.

Locked reporting reads the saved roster and recorded payroll evidence, not a newly computed current-employee population.
Later master-data changes cannot add salary estimates to a finalized month.
Real Logged Hours outside the saved roster remain visible with unknown cost and an explicit review notice.
Legacy locked runs without a saved roster disclose that limitation; no backfill pretends to recover the original validated set.

