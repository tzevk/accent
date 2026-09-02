# Salary Profile is canonical; Salary Structures is legacy fallback

`employee_salary_profile` (66 cols, salary_type-aware, written by the live payroll UI) is the canonical pay agreement. `salary_structures` (25 cols + child components) was an earlier clean attempt that never finished; payroll UI never writes it and `payroll-calculator` already overlays it on top of the profile, so a stale row silently wins.

We keep both tables with no schema change in this pass and make the reader treat `salary_structures` as read-only legacy fallback. The same for DA: `payroll_schedules` is canonical for component UI, `da_schedule` remains the calculator's legacy source until a follow-up migration. This avoids a risky data migration while fixing the finicky dual-brain in `EmployeesPageInner`.

Considered: (a) migrate `salary_structures` → `employee_salary_profile` now, (b) keep both writable, (c) delete `salary_structures` reads. Chose legacy fallback because (a) needs data audit + backfill, (b) preserves divergent writes, (c) could drop data if any employee still only has a `salary_structures` row.

Consequences: preview and slip generation must both delegate to `payroll-calculator`/`payroll-config`+`money.ts` (no component `parseFloat` math); component collapses 9 DA/PT/MLWF fetchers to one `payroll_schedules` read; future ADR will unify DA to `payroll_schedules` and drop `salary_structures`.
