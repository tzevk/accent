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
A computed monthly instance for one employee and month (YYYY-MM-01) — earnings, deductions, net pay, employer cost, attendance snapshot. Stored in `payroll_slips`, produced by `computePayroll`/`generatePayrollSlip`.
_Avoid_: Payslip, Salary Slip, Payroll Record

**Payroll Schedule**:
A versioned rate for a statutory or allowance component (DA, PT, MLWF, bonus, incentive, insurance) with `component_type`, `value`/`value_type`, and `effective_from`/`effective_to`. Canonical table is `payroll_schedules`.
_Avoid_: DA Schedule (when meaning the unified table), Config, Slab

**DA** (Dearness Allowance):
The inflation-linked component of Basic+DA, read from `payroll_schedules` (component*type `da`) for the component UI and from `da_schedule` (legacy) for the calculator until unification.
\_Avoid*: Allowance without qualifier

**Gross**:
Total earnings for the month before deductions (basic+da+hra+conveyance+call*allowance+other_allowances+bonus+incentive+ot). Never use CTC as the base for payroll math.
\_Avoid*: CTC, Basic, Salary (ambiguous)

**CTC**:
Cost to company — Gross plus employer contributions (PF employer, ESIC employer, bonus, insurance, gratuity, etc.). Display-only; not an input to `computePayroll`.
_Avoid_: Gross, Package
