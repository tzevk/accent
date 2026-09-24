# Accent

Accent is a CRM and HR platform for leads, projects, and monthly payroll for payroll and contract staff.

## Language

**Employee**:
A person employed by the company, stored in `employees`. Linked to a `users` account via `employee_id` when they need system access.
_Avoid_: User, Staff, Resource

**Employee Type**:
The employment category: `Payroll` (monthly gross-based salary) or `Contract` (contract/hourly/daily/lumpsum). Determines which payroll path and tabs apply.
_Avoid_: Employment status, Worker type

**Salary Profile**:
The employee's current pay agreement — gross, derived allowances (basic/da/hra/conveyance/call allowance), applicability flags (PF/ESIC/PT/MLWF/retention/bonus/incentive/insurance), and PL/loan/advance. The input to payroll. Canonical table is `employee_salary_profile`.
_Avoid_: Salary Structure, Compensation, Package

**Salary Structure** (legacy):
An earlier 25-column pay agreement in `salary_structures` (+ `salary_structure_components`). Superseded by Salary Profile; kept as read-only fallback until migration. Do not write new rows from payroll UI.
_Avoid_: Salary Profile (when meaning the legacy table)

**Payroll Slip**:
A computed monthly instance for one employee and month (YYYY-MM-01) — earnings, deductions, net pay, employer cost, attendance snapshot. Stored in `payroll_slips` (UNIQUE month+employee), produced by `computePayroll`/`generatePayrollSlip`. The employee's own view of them is "My Payroll Slips".
_Avoid_: Payslip, Salary Slip, Payroll Record — the self-service path segment `/api/me/payslips` is a kept exception (a URL, not a name for the entity)

**Payroll Run**:
The month-level lifecycle record for one pay period (month/year) — starts `draft`, becomes `finalized`, which locks its slips against regeneration; only a super-admin can reopen a finalized run, and only while no slip in the month is `paid`. Payment is tracked per-slip, not on the run: the run's `paid` state is derived (every slip of the month paid), never a stored transition. Canonical table `payroll_runs`.
_Avoid_: Month (ambiguous), Pay cycle, Batch

**Component Rate** (was "Payroll Schedule"):
The versioned rate for a statutory or allowance component (DA, PT, MLWF, bonus, incentive, insurance) with `component_type`, `value`/`value_type`, and `effective_from`/`effective_to`. Canonical table is `payroll_schedules` — the single source for ALL component rates, incl. DA (legacy `da_schedule` retired). Served under `/admin/payroll/rates`.
_Avoid_: Payroll Schedule (collides with pay-period cadence), Config, Slab

**DA** (Dearness Allowance):
The inflation-linked component of Basic+DA, read from `payroll_schedules` (component*type `da`) everywhere.
\_Avoid*: Allowance without qualifier

**Gross**:
Total earnings for the month before deductions (basic+da+hra+conveyance+call*allowance+other_allowances+bonus+incentive+ot). Never use CTC as the base for payroll math.
\_Avoid*: CTC, Basic, Salary (ambiguous)

**CTC**:
Cost to company — Gross plus employer contributions (PF employer, ESIC employer, bonus, insurance, gratuity, etc.). Display-only; not an input to `computePayroll`.
_Avoid_: Gross, Package

**Leave Application**:
An employee's request for time off with a start date, end date, type, reason, and status (`pending`, `approved`, or `rejected`). One employee can never hold two intersecting `pending`/`approved` applications — the server rejects that as its own overlap.
_Avoid_: Leave (ambiguous), Overlapping leaves (when meaning one person's own collision)

**Leave Overlap**:
Two or more _different_ employees whose `pending` or `approved` applications intersect on at least one calendar date. `rejected` applications never count toward an overlap.
_Avoid_: Concurrent Leave

**Capacity**:
Net available working hours for an Employee in a period — 8h per working day (excluding Sundays, 2nd/4th Saturdays, and active `holiday_master` dates), minus approved leave (8h per full day, 4h per half-day).
_Avoid_: Expected hours, Standard hours (ambiguous), Bandwidth

**Logged Hours**:
Sum of `user_activity_assignments.daily_entries.hours` (`actual_hours`) entered via Project Activity Assignments, including overtime. The billed-effort truth for utilization; never `planned_hours`/`estimated_hours`.
_Avoid_: Manhours (ambiguous), Planned hours, Assigned hours

**Utilization**:
`total_logged / capacity × 100` per employee per month. Under <80%, healthy 80–100%, over >100%. Answers whether an Employee is underworked or overworked.
_Avoid_: Attendance %, Allocation %, Productivity

**Monthly Cost**:
CTC-based monthly price of an Employee — `employee_salary_profile.employer_cost` (stored CTC), falling back to `gross_salary` then `gross`. Profile picked by `pickActiveProfile` (effective-range cover, else latest active).
_Avoid_: Gross, Salary (ambiguous), Hourly rate

**Bench Cost**:
`monthly_cost − ctc_rate × logged_hours`, where `ctc_rate` is Monthly Cost apportioned over `std_working_days` (default 26) × `std_hours_per_day` (default 8); hourly/daily/custom types use their direct rate. Rows without a covering profile show blank cost, never zero.
_Avoid_: Fractional cost, Loss, Waste

**Weekly Off**:
A scheduled non-working day — every Sunday plus the 2nd and 4th Saturdays of the month. Stored as attendance status `WO`.
_Avoid_: Weekend, Holiday, Sunday-off

**Sandwich**:
A Weekly Off or Holiday run bracketed by leave on both sides inside one continuous absence — each bracketed day is deducted as leave. Canonical: Sat leave + Sun WO + Mon leave → Sun deducted.
_Avoid_: Sandwich holiday, Bridge leave

**Punch**:
A single biometric check-in/out event captured by a Smart Office device, stored in `attendance_logs` under the device's employee code. Direction may be inferred when the device doesn't report one.
_Avoid_: Attendance log (ambiguous), Log entry, Scan

**Attendance Record**:
The human-authored daily attendance cell for one Employee — status (`P`/`HD`/leave codes/`WO`/`H`), in/out times, and OT — stored in `employee_attendance`. Status is authoritative over Punch evidence; times on a punch day follow the device (ADR-0007).
_Avoid_: Attendance (ambiguous), Attendance log (when meaning the cell), Punch (when meaning the day)

**Payable Day**:
Attendance credit toward salary — `P` = 1, `HD` = 0.5, paid leave (`PL`/`CL`/`SL`/`EL`) = 1; `WO`/`H`/`A`/`LWP`/`UL` = 0.
_Avoid_: Present day, Working day

**Payable OT**:
Overtime that clears the payability gate — daily excess over 8h only when it exceeds 2h. Coexists with worked-hours OT in the timesheet report, which counts every minute past 8.
_Avoid_: OT (ambiguous), Overtime (ambiguous)
