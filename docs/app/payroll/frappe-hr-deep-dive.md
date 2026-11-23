# Frappe HR + India Payroll: implementation deep dive

**Research note, not a decision.** Evidence read on **2026-11-20**, primary sources
only: `frappe/hrms` and `frappe/india-payroll` and `frappe/erpnext` and
`frappe/frappe` on `version-16` (HRMS reports `__version__ = "16.60.0"`; India
Payroll v16.2.0), plus the official docs at docs.frappe.io. No instance was
installed; no payroll was run; no statutory calculation or filing was validated;
no test suite was executed. Where shipped documentation and shipped code
disagree, this note says so.
A separate [local bench pilot](frappe-hr-local-pilot.md) records what the running v16 instance actually did. This note is source-level; that note is observation-level.

Baseline: [ADR-0010](../../adr/0010-hours-logged-pay-basis.md) (hourly rate = CTC
÷ basis hours), [ADR-0008](../../adr/0008-payroll-run-lock-and-route-tree.md) (one
run per month, both streams), [ADR-0009](../../adr/0009-payroll-slip-figures-are-the-snapshot.md)
(slip figures are the snapshot), and the [recovery plan](salary-system-recovery-plan.md)
(monthly-paid office staff with no project hours, hourly CAD engineers, visible
exceptions, approved-cost import).

## 1. Payroll data model

| DocType                               | Role                                       | Key fields and flags                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Employee**                          | Master                                     | `date_of_joining`, `relieving_date`, `status`, `company`, `holiday_list`, `salary_mode`, `bank_ac_no` ([employee.json](https://github.com/frappe/hrms/blob/version-16/hrms/hr/doctype/employee/employee.json))                                                                                                                                                                                                                                   |
| **Salary Component**                  | Reusable pay head                          | `type` = **Earning / Deduction / Employer Contribution**; `depends_on_payment_days`, `statistical_component`, `do_not_include_in_total`, `variable_based_on_taxable_salary`, `is_tax_applicable`, `exempted_from_income_tax`, `round_to_the_nearest_integer`, `remove_if_zero_valued`, `accrual_component` ([salary_component.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_component/salary_component.json)) |
| **Salary Structure**                  | Template, submittable                      | `payroll_frequency`, `salary_slip_based_on_timesheet`, `salary_component` (the timesheet wage head), `hour_rate`, `earnings` / `deductions` / `employer_contributions` tables ([salary_structure.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_structure/salary_structure.json))                                                                                                                              |
| **Salary Detail** (child)             | One row inside a structure                 | `salary_component`, `abbr`, `condition`, `amount_based_on_formula`, `formula`, `amount`, `default_amount`, `additional_amount`, `depends_on_payment_days`, `statistical_component`, `do_not_include_in_total`, `additional_salary` ([salary_detail.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_detail/salary_detail.json))                                                                                  |
| **Salary Structure Assignment (SSA)** | Per-employee, effective-dated, submittable | `employee`, `salary_structure`, `from_date`, `base`, `variable`, derived `annual_gross_earning` and `ctc`, `income_tax_slab`, `payroll_payable_account`, `payroll_cost_centers` ([salary_structure_assignment.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_structure_assignment/salary_structure_assignment.json))                                                                                           |
| **Salary Slip**                       | The transaction, submittable               | `employee`, `start_date`/`end_date`, `payroll_frequency`, `total_working_days`, `payment_days`, `leave_without_pay`, `timesheets` (child), `total_working_hours`, `hour_rate`, `earnings`/`deductions`/`employer_contributions`, `gross_pay`, `total_deduction`, `net_pay`, `journal_entry` ([salary_slip.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.json))                               |
| **Payroll Entry**                     | Batch run, submittable                     | `company`, `start_date`/`end_date`, `payroll_frequency`, `salary_slip_based_on_timesheet`, `validate_attendance`, `employees` (child), `payroll_payable_account`, `cost_center`, `status` (Draft/Submitted/Cancelled/Queued/Failed) ([payroll_entry.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_entry/payroll_entry.json))                                                                                 |
| **Timesheet** (ERPNext)               | Source of hours                            | `employee`, `time_logs` (child, required), `total_hours`, status derived; submitted slips only read `total_hours` ([timesheet.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/projects/doctype/timesheet/timesheet.json))                                                                                                                                                                                                        |
| **Attendance** (HRMS)                 | Optional days evidence                     | `employee`, `attendance_date`, `status`, `working_hours`, submittable ([attendance.json](https://github.com/frappe/hrms/blob/version-16/hrms/hr/doctype/attendance/attendance.json))                                                                                                                                                                                                                                                             |

Earnings vs deductions is a `Salary Component.type` property copied onto each
structure row, not a structure-level setting. A third type, **Employer
Contribution**, exists purely as cost: written to the slip's
`employer_contributions` table, folded into CTC, never into gross, deduction or
net ([salary_slip.py](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.py#L902),
[salary-component docs](https://docs.frappe.io/hr/salary-component)).

Two derived quantities matter:

- `total_working_days` = calendar days in the slip period **minus holidays** from
  the Holiday List; `payment_days` = the same range clipped to joining/relieving
  dates, minus leave-without-pay and absences
  ([`get_working_days_details`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.py#L462),
  [`get_payment_days`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.py#L677)).
  A five-day week is modelled by a Holiday List, not a working-days setting.
- Each earning row with `depends_on_payment_days` is prorated
  `default_amount × payment_days / total_working_days`
  ([`get_amount_based_on_payment_days`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.py#L2185)).

## 2. Pay-basis mechanics

### Both bases exist, but not in one Payroll Entry

Monthly-fixed and hourly-from-timesheets are both supported and can coexist in
one instance. They cannot coexist in one **Payroll Entry**: the entry's
`salary_slip_based_on_timesheet` checkbox selects which Salary Structures are
eligible (`payroll_frequency` applies only when the flag is 0), and slip
submission filters on the same field
([`get_salary_structure`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_entry/payroll_entry.py#L1446),
[`get_sal_slip_list`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_entry/payroll_entry.py#L311)).
A mixed workforce therefore needs **two Payroll Entries per month** — a direct
structural mismatch with [ADR-0008](../../adr/0008-payroll-run-lock-and-route-tree.md)'s
"one run covering both streams".

### (a) Monthly-fixed salary with zero project hours — works out of the box

A salaried employee on a non-timesheet structure receives the structure amounts,
prorated only by `payment_days`. No timesheet and no Attendance record is
required: `payroll_based_on` defaults to **Leave**
([payroll_settings.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_settings/payroll_settings.json)),
LWP comes from approved leave applications, and unmarked attendance counts as
present (`consider_unmarked_attendance_as or "Present"`). With no LWP,
`payment_days == total_working_days` and the month is paid in full — verified in
source, not yet in a running instance.

### (b) Hourly pay from timesheets — supported, with a per-rate structure

Setting **Salary Slip Based on Timesheet** makes three fields mandatory on the
structure: the timesheet wage `salary_component`, and `hour_rate`
([salary_structure.js](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_structure/salary_structure.js#L245),
[salary-structure docs](https://docs.frappe.io/hr/salary-structure)). On slip
creation the controller

1. collects every Submitted / Billed / Partially Billed Timesheet for the
   employee whose `start_date` falls in the slip period and copies each
   `total_hours` into the slip's `timesheets` child,
2. sets `hour_rate` **from the Salary Structure** and
   `total_working_hours = Σ timesheet hours`,
3. writes `hour_rate × total_working_hours` into the designated earning row,
   skipping formula evaluation for that row
   ([`set_time_sheet`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.py#L371),
   [`add_timesheet_earning_component`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.py#L435),
   [`add_structure_component`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.py#L1282)).

Consequences worth stating plainly:

- **The rate is a property of the Salary Structure, not of the employee.** A
  `grep` of the whole HRMS tree finds `hour_rate` only on Salary Structure and
  Salary Slip; the SSA merely reads it
  ([`get_timesheet_config`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_structure_assignment/salary_structure_assignment.py#L261)).
  Per-employee rates mean one Salary Structure per rate, or a small custom app.
  Editing `hour_rate` on a slip is overwritten the next time the slip is
  recalculated.
- Hours counted are **all** timesheet hours in the period, billable or not
  (`total_hours`), so non-project time logged in Timesheets also earns pay.
- Timesheet rows require `from_time`/`to_time`, an Activity Type, no overlaps,
  and `hours > 0`
  ([`validate_mandatory_fields`](https://github.com/frappe/erpnext/blob/version-16/erpnext/projects/doctype/timesheet/timesheet.py#L187)).
  Importing "approved monthly payable hours" means inventing timestamps and an
  activity type — a mapping decision, not a field copy.

### CTC ÷ (working days × std hours): not built in

Nothing in HRMS derives an hourly rate from CTC. There is no
`std_hours_per_day` / standard-hours field anywhere in the tree (searched
`hrms/`, no non-test hit), and `hour_rate` is a plain currency field with no
formula. Three routes remain, in increasing cost:

1. **Formula on a non-timesheet structure.** Formulas evaluate against a context
   merging the SSA (`base`, `variable`, annual `ctc`) with the slip's own fields
   (`payment_days`, `total_working_days`, `total_working_hours`, dates)
   ([`get_data_for_eval`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.py#L1363),
   [`get_component_eval_context`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/utils.py#L99)).
   `ctc / 12 / (total_working_days * 8) * total_working_hours` is expressible —
   note the literal 8, and that the slip drops its own tax-related `ctc` so the
   SSA's annual CTC stays in scope. But the timesheet wage row is _skipped_ by
   formula evaluation in timesheet mode, and in non-timesheet mode
   `total_working_hours` is whatever the caller wrote on the slip: no Timesheet
   linkage, no audit trail for the hours.
2. **Per-rate Salary Structures** on the supported timesheet path: correct
   mechanics, poor ownership ergonomics.
3. **Custom app** that sets `hour_rate` from an SSA field before calculation.
   Clean, but it is code Accent must own.

The definitional trap: Frappe's `ctc` is
`(gross + non-payout earnings + employer contributions) × periods`, computed
**upward** from `base` ([`calculate_ctc_and_gross`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_structure_assignment/salary_structure_assignment.py#L279),
[salary-component docs](https://docs.frappe.io/hr/salary-component)); ADR-0010's
"monthly CTC" is the _input_ gross is derived from. The direction is inverted.

## 3. India Payroll internals

A thin statutory layer, not a payroll engine: it registers regional overrides for
four Salary Slip hook points
([hooks.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/hooks.py#L278)),
injects named Salary Components on save, and ships reports. Configuration lives
on `Payroll Settings → India Payroll` (`enable_epf`, `enable_esic`, `enable_lwf`,
`enable_professional_tax`, optional multi-company table, registration numbers —
[custom fields](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/install.py#L158))
and on the SSA India tab (`employment_state`, `epf_applicable`,
`contribute_on_actual_pf_wage`, `vpf_*`, `lwf_exempted`,
`is_person_with_disability`).

| Statute                      | Calculated where                                                                                                                                                                           | Rates / ceilings in code                                                                                                                                                                                                                                                                                                          | Outputs beyond the slip                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EPF / EPS / EDLI / admin** | [`epf.py`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/epf.py)                                                                                     | 12% employee; employer 12% split EPS 8.33% / EDLI 0.5% / admin 0.5%. Ceiling **₹15,000 until 2026-09-16, ₹25,000 from 2026-09-17**, day-weighted across a straddling period (`EPF_WAGE_CEILING*`, [`get_epf_wage_ceilings`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/epf.py#L184))     | EPF Register + **ECR text file** (`#~#`-separated, 11 fields), [`get_ecr_file`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/report/employee_provident_fund_register/employee_provident_fund_register.py#L374) |
| **ESI**                      | [`esi.py`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/esi.py)                                                                                     | 0.75% employee / 3.25% employer; ceiling ₹21,000 (₹25,000 PwD); coverage judged on the full-cycle wage, contribution on the paid wage                                                                                                                                                                                             | ESIC Register                                                                                                                                                                                                                                         |
| **Professional Tax**         | [`professional_tax.py`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/professional_tax.py)                                                           | Hardcoded `STATE_PT_CONFIG` for 16 states; monthly, half-yearly (TN, Kerala) and yearly (Bihar); Maharashtra ₹300 in February and women's exemption ≤ ₹25,000; dated revisions (Odisha repealed 2026-04-01, West Bengal 2026-10-01)                                                                                               | PT Register                                                                                                                                                                                                                                           |
| **LWF**                      | [`lwf.py`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/lwf.py)                                                                                     | Flat state amounts, monthly / June+Dec / December, "as of May 2026" by comment                                                                                                                                                                                                                                                    | LWF Register                                                                                                                                                                                                                                          |
| **Income tax / TDS**         | Core HRMS slabs + [`income_tax_utils.py`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/income_tax_utils.py) surcharge-with-marginal-relief override | Slabs are **created on install** as Income Tax Slab records: "Old Tax Regime: 2019" and "New Tax Regime: 2024-2025"/"2025-2026" with standard deduction ₹50k/₹75k, 87A limits, surcharge tiers and 4% cess ([install.py `INDIA_TAX_SLABS`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/install.py#L95)) | —                                                                                                                                                                                                                                                     |
| **24Q filing**               | [`tds/`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/tds)                                                                                          | Reads tax deducted on submitted slips, reconciles against TDS Challans, then Validate → TXT → FVU → e-File through **Sandbox (sandbox.co.in)**, not directly to TRACES/NSDL                                                                                                                                                       | Filed return + receipt, FVU, Form 27A, CSI                                                                                                                                                                                                            |
| **Form 16**                  | [`form16.py`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/tds/form16.py)                                                                           | Part B rendered by Sandbox; Part A requested from TRACES after the Q4 return is filed                                                                                                                                                                                                                                             | Part A/B PDFs                                                                                                                                                                                                                                         |

Three details that change the risk picture:

- **TDS filing is a paid third-party dependency.** Auth is Sandbox's
  `x-api-key`/`x-api-secret` → JWT (`sandbox_client.py`); Frappe Cloud sites get
  provisioned credentials, other sites must supply their own
  ([tds-filing docs](https://docs.frappe.io/hr/india-payroll/tds-filing)) — the
  low-friction path is also a vendor dependency.
- **Form 24Q becomes Form 138 from FY 2026-27.** `FORM_CODES` maps
  `24Q→138, 26Q→140, 27Q→144, 27EQ→143` under the Income-tax Act 2025
  ([validators.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/tds/validators.py#L19)),
  and the workbook builder switches on the financial year
  ([sheet_json.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/tds/sheet_json.py#L47)).
- **PF wage is a name heuristic.** Only components whose _names_ match `basic`,
  `dearness`/`da`, `retaining`/`ra` count, and Additional Salary rows are
  excluded ([`is_pf_wage_component`](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/epf.py#L49)).
  A base named "Fixed Pay" contributes nothing to PF and only raises a warning.

### Version compatibility

| Component            | Declared dependency                                                                   | Source                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| India Payroll 16.2.0 | `frappe >=16.0.0,<17`, `erpnext >=16.0.0,<17`, `hrms >=16.0.0,<17`; Python `>=3.14`   | [pyproject.toml](https://github.com/frappe/india-payroll/blob/version-16/pyproject.toml)                                                                     |
| HRMS 16.60.0         | `frappe >=16.60.0,<17`, `erpnext >=16.50.0,<17`; `required_apps = ["frappe/erpnext"]` | [pyproject.toml](https://github.com/frappe/hrms/blob/version-16/pyproject.toml), [hooks.py](https://github.com/frappe/hrms/blob/version-16/hrms/hooks.py#L7) |

Only a `version-16` line was found in the repository's branch list; no v15
branch was observed
([branches](https://github.com/frappe/india-payroll/branches/all)). So the
statutory app is tied to Frappe v16, while the HRMS pin (`frappe >=16.60`) is
tighter than the India app's (`>=16.0`): install the newest v16 of all four apps,
not a mixed generation.

## 4. REST API

Auth is `Authorization: token <api_key>:<api_secret>`, checked against the User's
keys and then evaluated **with that user's roles**
([auth.py](https://github.com/frappe/frappe/blob/version-16/frappe/auth.py#L700),
[REST docs](https://docs.frappe.io/framework/user/en/api/rest)). Cookie sessions
also work; token auth is right for a Next.js server.

| Need                 | Call                                                                                                 | Notes                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List / filter        | `GET /api/resource/<DocType>?fields=[...]&filters=[[...]]&limit_start=&limit_page_length=&order_by=` | Response under `data`; default 20 rows ([v1 routes](https://github.com/frappe/frappe/blob/version-16/frappe/api/v1.py#L146))                                                                                           |
| Read one             | `GET /api/resource/<DocType>/<name>`                                                                 | Child tables inline as arrays                                                                                                                                                                                          |
| Create               | `POST /api/resource/<DocType>`                                                                       | JSON body; controller `validate` runs, so a Salary Slip with `employee`+dates calculates on insert ([`validate`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.py#L135)) |
| Update               | `PUT /api/resource/<DocType>/<name>`                                                                 | Partial body accepted; `save()` only, does not submit                                                                                                                                                                  |
| Submit               | `POST /api/method/frappe.client.submit` with `{"doc": {...}}`                                        | Whitelisted POST/PUT ([client.py](https://github.com/frappe/frappe/blob/version-16/frappe/client.py#L270))                                                                                                             |
| Cancel               | `POST /api/method/frappe.client.cancel` with `doctype`,`name`                                        | Whitelisted                                                                                                                                                                                                            |
| Document method      | `POST /api/v2/document/<DocType>/<name>/method/<method>`                                             | No optimistic-lock check; permission mapped POST→write ([v2](https://github.com/frappe/frappe/blob/version-16/frappe/api/v2.py#L222))                                                                                  |
| Document method (v1) | `POST /api/method/run_doc_method` with `docs` + `method`                                             | Desk's own `frm.call` path; `check_if_latest()` rejects a stale `modified` ([request.js](https://github.com/frappe/frappe/blob/version-16/frappe/public/js/frappe/request.js#L66))                                     |

Neither document-method route appears in the official REST docs; they exist in
the framework source and are what the Desk UI uses. That is a support-risk fact,
not a blocker.

**Can payroll be driven over REST?** Yes, in this order, with no UI:

1. `POST /api/resource/Salary Structure` (+`frappe.client.submit`),
   `POST /api/resource/Salary Structure Assignment` (+ submit).
2. `POST /api/resource/Payroll Entry` with company, dates, frequency,
   `payroll_payable_account`, and the timesheet flag.
3. `POST .../method/fill_employee_details` — whitelisted, returns the roster and
   unmarked-attendance list ([payroll_entry.py](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_entry/payroll_entry.py#L230)).
4. `POST .../method/create_salary_slips` — `methods=["POST"]`, creates draft slips
   ([L269](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_entry/payroll_entry.py#L269)).
5. `POST .../method/submit_salary_slips` — submits them, booking the accrual JV
   ([L332](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_entry/payroll_entry.py#L332)).
6. `POST .../method/make_bank_entry` for payment.

Two traps: above **30 employees** steps 4 and 5 are pushed to a background job
and return immediately with status `Queued`, so the caller must poll
`Payroll Entry.status`; and submitting the Payroll Entry document itself also
calls `create_salary_slips()`
([`on_submit`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_entry/payroll_entry.py#L80))
— pick one trigger, not both.

**Roles.** Payroll Entry is `HR Manager` only, with no `HR User` grant; Salary
Slip and Salary Structure allow `HR User` and `HR Manager`; SSA adds `System
Manager`; India's TDS Return / Challan / Form 16 need `Payroll Manager` or
`System Manager`
([payroll_entry.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_entry/payroll_entry.json),
[tds_return.json](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/doctype/tds_return/tds_return.json)).
The service user needs `HR Manager` (or a custom role with those grants) even
though it only reads.

Statutory exports are callable too: `get_ecr_file(filters)` is whitelisted, and
the reports run through the standard query-report endpoint.

## 5. Deployment and licence

| Item     | Verified requirement                                                                                           | Source                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| OS       | Linux (Debian 13+/Ubuntu 24.04+) or macOS; Windows via WSL. Not Windows-native                                 | [installation](https://docs.frappe.io/framework/user/en/installation)                                    |
| MariaDB  | 11.8 for v16 (PostgreSQL alternative supported)                                                                | same                                                                                                     |
| Python   | 3.14 (3.10–3.13 only for v15); India Payroll declares `>=3.14`                                                 | same, [pyproject](https://github.com/frappe/india-payroll/blob/version-16/pyproject.toml)                |
| Node     | 24, Yarn 1.22+, pip 25.3+                                                                                      | same                                                                                                     |
| Services | Redis/Valkey 6+, cron, Chromium for PDFs (`bench setup-chrome`)                                                | same                                                                                                     |
| Install  | `bench get-app` + `bench install-app india_payroll` on an existing bench                                       | [README](https://github.com/frappe/india-payroll)                                                        |
| Managed  | Frappe Cloud shared or dedicated benches, compute-based pricing, Mumbai region; HRMS listed in the marketplace | [frappe.io/cloud](https://frappe.io/cloud), [marketplace](https://cloud.frappe.io/marketplace/apps/hrms) |

A Frappe payroll service is therefore a second production system: its own
MariaDB, Redis, Python runtime, Node asset build, Chromium, scheduler, backups
and payroll PII — unavoidable for a separate engine, but a real operating cost.

**Licences (read from the files, not badges):** HRMS **GPL-3.0**
([license.txt](https://github.com/frappe/hrms/blob/version-16/license.txt),
`app_license = "GNU General Public License (v3)"`), India Payroll **GPL-3.0**
([license.txt](https://github.com/frappe/india-payroll/blob/version-16/license.txt),
`app_license = "gpl-3.0"`), ERPNext GPL-3.0, Frappe Framework MIT. India
Payroll's `pyproject.toml` declares no `license` field, so `license.txt` and the
hooks entry are the authoritative statements.

Not established, and not legal advice: whether a separately hosted GPL-3.0
application called over HTTP from Accent's proprietary Next.js server creates any
obligation, and whether Accent (no root `LICENSE`/`COPYING`) can distribute
anything derived from these files. Copyleft attaches to the covered program; the
boundary for network use and API clients is a counsel question.

## 6. Fit against Accent's requirements

| Accent requirement                                     | Frappe mechanism                                                                                                                                                                                                                                           | Status                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Monthly-paid office staff paid with zero project hours | Non-timesheet structure; `payment_days` proration; `payroll_based_on = Leave`; unmarked attendance treated as present                                                                                                                                      | **Needs pilot** — mechanism read in source, unproven on a real month                                               |
| Hourly CAD engineers paid from approved hours          | Timesheet-based structure; `hour_rate × Σ Timesheet.total_hours` for submitted timesheets in the period                                                                                                                                                    | **Needs pilot** — same                                                                                             |
| Hourly rate = CTC ÷ (working days × std hours)         | Not built in. No std-hours field; `hour_rate` is per structure; a formula can use SSA `ctc`/`base` and slip `total_working_days`, but the timesheet row is formula-skipped                                                                                 | **Customization required** — per-rate structures, custom field/app, or a formula path with manual hours            |
| One payroll run covering both streams (ADR-0008)       | Payroll Entry segregates timesheet vs non-timesheet structures; two entries per month                                                                                                                                                                      | **Not established** — contradicts the ADR as written; a decision, not configuration                                |
| Exception roster before calculation                    | Roster = employees with a **submitted SSA** matching payroll payable account and structure mode; employees without an SSA are silently absent; `validate_attendance` is opt-in                                                                             | **Customization required** for "nobody disappears"; partial via `fill_employee_details` + unmarked-attendance list |
| Approved employer cost exported into Accent reports    | Slip carries `gross_pay`, `total_deduction`, `net_pay`, `employer_contributions`; SSA carries `ctc`/`annual_gross_earning`; REST read + Frappe Webhook on doc events                                                                                       | **Verified** (read surface only); the import contract is Accent work                                               |
| Slip figures frozen (ADR-0009)                         | Submitted slips are docstatus-immutable, but cancelling a **Payroll Entry cancels and deletes its Salary Slips** ([`delete_linked_salary_slips`](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_entry/payroll_entry.py#L161)) | **Needs pilot** — reopen must never route through entry cancellation                                               |
| India statutory deductions                             | EPF/EPS/EDLI + ECR, ESI, 16-state PT, LWF, slabs + surcharge + cess, 24Q/138 filing, Form 16                                                                                                                                                               | **Needs pilot** with the accountant; code read, not computed                                                       |
| HR Manager / operator usability                        | Frappe Desk; India settings on Payroll Settings and the SSA India tab                                                                                                                                                                                      | **Needs pilot** with the father/accountant                                                                         |

### The five questions an implementer must answer on a private instance

1. **Which price is "CTC"?** Enter the same person twice — once with monthly
   gross as SSA `base` and employer contributions as structure rows, once with
   the current Accent `employer_cost` — and compare the resulting `ctc`,
   `annual_gross_earning` and slip gross against the approved register. Until
   this is settled, ADR-0010's rate is undefined in Frappe terms.
2. **How does an engineer get an individual hourly rate without one Salary
   Structure per person?** Prototype the per-rate structures, the formula route
   with a custom SSA field, and the small custom app; measure what the operator
   has to touch when a rate changes mid-year.
3. **What does a month look like with both populations, given two Payroll
   Entries?** Produce one closed month end-to-end (draft → slips → submit →
   accrual JV → bank entry) and write down how Accent's single-run lock maps onto
   two documents.
4. **Do the statutory numbers match the accountant's own computation?** Compare
   one month for a PF-covered employee below and above both ceilings, an ESI-
   covered employee, Maharashtra and one non-Maharashtra state, and a February.
   The app's own docs and code disagree on PF wage definition and PT slabs
   (below), so the code is the only thing worth testing.
5. **What is the read-back contract?** Enumerate exactly which fields Accent will
   pull per employee-month (gross, employer contributions, net, slip name,
   pay period, currency, source reference), verify them over the REST API on the
   pilot instance, and confirm a re-read cannot duplicate cost.

## Evidence limits

- **No runtime.** Nothing was installed, no payroll calculated, no filing
  submitted, no PDF generated. Every "works" statement is a source-code reading
  of `version-16` at v16.60.0 / v16.2.0, not observed behaviour.
- **The India app's docs lag its code materially.** The EPF page says PF wage is
  "the sum of every earning component" and states a ₹15,000 ceiling; the code
  counts only Basic/DA/Retaining by name and applies ₹25,000 from 2026-09-17
  ([docs](https://docs.frappe.io/hr/india-payroll/employee-provident-fund) vs
  [epf.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/epf.py#L29)).
  The PT page's slab tables (Assam, Gujarat, Karnataka, TN, Kerala, Bihar,
  Maharashtra women's threshold) do not match `STATE_PT_CONFIG`
  ([docs](https://docs.frappe.io/hr/india-payroll/professional-tax) vs
  [professional_tax.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/professional_tax.py#L24)).
  The README says ESI coverage uses "full monthly gross"; the code uses
  Basic/DA/RA wages.
- **Statutory correctness is not verified.** The EPF code assumes every member
  joined after 1 Sept 2014 (no EPS for wages above the ceiling). ESI coverage is
  decided per salary slip on the full-cycle wage; no contribution-period
  (Apr–Sep / Oct–Mar) continuity is modelled. ESI amounts are rounded to two
  decimals, not to whole rupees. PT rates are hardcoded per state and revised by
  code change. Tax slabs are seeded data, not derived from a filing. Confirm all
  of this with the accountant before relying on any figure.
- **TDS filing depends on Sandbox**, a commercial API. The end-to-end filing,
  FVU and Form 16 paths were read, not exercised; Sandbox's own behaviour is a
  vendor claim. Form 24Q→138 renaming under the Income-tax Act 2025 is visible in
  code and untested here.
- **India Payroll on Frappe Cloud is unconfirmed.** HRMS is listed in the
  marketplace; `cloud.frappe.io/marketplace/apps/india-payroll` returned 403 from
  this environment, so its listing status is unknown. The TDS docs' statement
  that Frappe Cloud provisions Sandbox credentials implies availability, not
  proof.
- **Licence conclusions are limited to what the files say.** No legal analysis of
  API use, hosting or distribution was performed.
- GitHub's REST API was rate-limited from this environment; releases, branches
  and file contents came from rendered pages, the Atom feed and raw file URLs.

## Sources

All read 2026-11-20 unless stated.

- HRMS: [repo](https://github.com/frappe/hrms) / [releases](https://github.com/frappe/hrms/releases) / [pyproject](https://github.com/frappe/hrms/blob/version-16/pyproject.toml) / [license](https://github.com/frappe/hrms/blob/version-16/license.txt) / [hooks](https://github.com/frappe/hrms/blob/version-16/hrms/hooks.py); payroll source [salary_structure.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_structure/salary_structure.json), [salary_slip.py](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_slip/salary_slip.py), [payroll_entry.py](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_entry/payroll_entry.py), [salary_structure_assignment.py](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_structure_assignment/salary_structure_assignment.py), [salary_detail.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_detail/salary_detail.json), [salary_component.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/salary_component/salary_component.json), [payroll_settings.json](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/doctype/payroll_settings/payroll_settings.json), [payroll/utils.py](https://github.com/frappe/hrms/blob/version-16/hrms/payroll/utils.py), [attendance.json](https://github.com/frappe/hrms/blob/version-16/hrms/hr/doctype/attendance/attendance.json)
- ERPNext: [timesheet.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/projects/doctype/timesheet/timesheet.json), [timesheet.py](https://github.com/frappe/erpnext/blob/version-16/erpnext/projects/doctype/timesheet/timesheet.py), [license](https://github.com/frappe/erpnext/blob/version-16/license.txt)
- Framework: [v1 routes](https://github.com/frappe/frappe/blob/version-16/frappe/api/v1.py), [v2 routes](https://github.com/frappe/frappe/blob/version-16/frappe/api/v2.py), [client.py](https://github.com/frappe/frappe/blob/version-16/frappe/client.py), [auth.py](https://github.com/frappe/frappe/blob/version-16/frappe/auth.py), [request.js](https://github.com/frappe/frappe/blob/version-16/frappe/public/js/frappe/request.js), [webhook.json](https://github.com/frappe/frappe/blob/version-16/frappe/integrations/doctype/webhook/webhook.json), [LICENSE (MIT)](https://github.com/frappe/frappe/blob/version-16/LICENSE)
- India Payroll: [repo + README](https://github.com/frappe/india-payroll) / [releases](https://github.com/frappe/india-payroll/releases) / [branches](https://github.com/frappe/india-payroll/branches/all) / [pyproject](https://github.com/frappe/india-payroll/blob/version-16/pyproject.toml) / [license](https://github.com/frappe/india-payroll/blob/version-16/license.txt) / [hooks](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/hooks.py) / [install.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/install.py)
- India Payroll statutory source: [epf.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/epf.py), [esi.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/esi.py), [professional_tax.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/professional_tax.py), [lwf.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/lwf.py), [income_tax_utils.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/income_tax_utils.py), [employer_contributions.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/employer_contributions.py), [tds/filing.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/tds/filing.py), [tds/sandbox_client.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/tds/sandbox_client.py), [tds/form16.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/tds/form16.py), [tds/sheet_json.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/tds/sheet_json.py), [tds/data_assembly.py](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/tds/data_assembly.py), [EPF register report](https://github.com/frappe/india-payroll/blob/version-16/india_payroll/india_payroll/report/employee_provident_fund_register/employee_provident_fund_register.py)
- Docs: [installation](https://docs.frappe.io/framework/user/en/installation), [REST API](https://docs.frappe.io/framework/user/en/api/rest), [salary structure](https://docs.frappe.io/hr/salary-structure), [salary component](https://docs.frappe.io/hr/salary-component), [salary structure assignment](https://docs.frappe.io/hr/salary-structure-assignment), [payroll entry](https://docs.frappe.io/hr/payroll-entry), [India Payroll intro](https://docs.frappe.io/hr/india-payroll/introduction), [EPF](https://docs.frappe.io/hr/india-payroll/employee-provident-fund), [ESI](https://docs.frappe.io/hr/india-payroll/employee-state-insurance), [professional tax](https://docs.frappe.io/hr/india-payroll/professional-tax), [LWF](https://docs.frappe.io/hr/india-payroll/labour-welfare-fund), [TDS filing](https://docs.frappe.io/hr/india-payroll/tds-filing)
- Hosting: [Frappe Cloud](https://frappe.io/cloud), [HRMS marketplace listing](https://cloud.frappe.io/marketplace/apps/hrms)
- Accent baseline: [ADR-0008](../../adr/0008-payroll-run-lock-and-route-tree.md), [ADR-0009](../../adr/0009-payroll-slip-figures-are-the-snapshot.md), [ADR-0010](../../adr/0010-hours-logged-pay-basis.md), [open-source comparison](open-source-options.md), [recovery plan](salary-system-recovery-plan.md)
