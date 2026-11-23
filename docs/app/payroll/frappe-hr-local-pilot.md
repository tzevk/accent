# Frappe HR local bench: hands-on findings

**Status: research note, not a decision. Observed 2026-11-20.** Method: a live WSL2 Frappe bench, its REST API, and the exact installed source. No filing was submitted, no real employee data was used, and no production system was changed. All pilot records created for these checks were deleted afterwards.

Companion to [frappe-hr-deep-dive.md](frappe-hr-deep-dive.md) (source-level research), [open-source-options.md](open-source-options.md) (comparison) and [salary-system-recovery-plan.md](salary-system-recovery-plan.md) (cutover proposal). This note records what the running instance actually did.

## 1. Environment verified

| Item          | Observed                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Host          | WSL2 Ubuntu, user `accent`, bench at `~/hr-bench`, bench CLI 5.31.1                              |
| Site          | `hr.localhost`, MariaDB, developer mode on, web server on port 8000 (HTTP 200)                   |
| Apps          | `frappe 16.60.1`, `erpnext 16.60.0`, `hrms 16.60.0`, `india_payroll 16.2.0`, all on `version-16` |
| Pinned source | hrms `1b2d7e0`, india_payroll `a991850`, erpnext `886ab6a` (from `sites/apps.json`)              |
| Starting data | No Employee, Salary Structure, Salary Slip, Payroll Entry, Timesheet or Attendance rows          |

The installed India Payroll version is newer than the one described in the earlier comparison note (16.1.0); re-check its release notes before quoting maturity figures.

## 2. Payroll model on this version

Live DocType metadata showed the fields that matter for an integration:

- **Salary Structure**: `company`, `currency`, `salary_slip_based_on_timesheet` (Check), `hour_rate`, `salary_component`, child tables `earnings`, `deductions`, `employer_contributions`, `employee_benefits`.
- **Salary Slip**: `salary_structure`, `salary_slip_based_on_timesheet`, child table `timesheets` (`Salary Slip Timesheet`), `total_working_hours`, `hour_rate`, `earnings`, `deductions`, `gross_pay`, `net_pay`, `ctc`.
- **Payroll Entry**: `start_date`/`end_date`, `payroll_frequency`, `salary_slip_based_on_timesheet`, `employees` child table, `validate_attendance`, `salary_slips_created`, `salary_slips_submitted`, and status `Draft/Submitted/Cancelled/Queued/Failed`.
- Supporting DocTypes: `Salary Structure Assignment`, `Salary Detail`, `Timesheet` (Projects), `Attendance` (HR), `Payroll Period`.
- India Payroll adds: `India Payroll Company Setting`, `TDS Return`, `TDS Challan`, `TDS Return Deductee`, `TDS Return Action`, `Form 16`, `India Payroll Telemetry Milestone`.

Source: live `frappe.get_meta()` calls on the bench; [Payroll Entry](https://github.com/frappe/hrms/blob/1b2d7e034e0de8e30a9e513541d7741710587ad5/hrms/payroll/doctype/payroll_entry/payroll_entry.json), [Salary Slip](https://github.com/frappe/hrms/blob/1b2d7e034e0de8e30a9e513541d7741710587ad5/hrms/payroll/doctype/salary_slip/salary_slip.json).

## 3. Mixed pay basis: actually exercised

Two throwaway employees, salary structures, assignments, a holiday list/assignment and one timesheet were created through REST, then deleted. Results:

| Case                  | Configuration                                                                                             | Observed slip                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Hourly engineer       | Structure `salary_slip_based_on_timesheet=1`, `hour_rate=500`; one **submitted** Timesheet with 7.5 hours | `total_working_hours=7.5`, one earning of 3,750, `gross_pay=3,750`, `net_pay=3,750` |
| Monthly office worker | Structure with a 30,000 monthly Basic earning, timesheet flag off, **no timesheet**                       | `total_working_hours=0`, earning 30,000, `gross_pay=30,000`, `net_pay=30,000`       |
| Draft timesheet       | Same hourly structure, Timesheet still draft                                                              | `total_working_hours=0`, earnings 0 — only submitted timesheets were counted        |

So one instance supports both pay bases, and the recovery plan's mixed-workforce requirement is feasible at the salary-slip level. **One Payroll Entry cannot mix them**: its `salary_slip_based_on_timesheet` flag selects eligible structures, so a mixed month needs two entries ([deep dive §2](frappe-hr-deep-dive.md#2-pay-basis-mechanics)). That conflicts with [ADR-0008](../../adr/0008-payroll-run-lock-and-route-tree.md) as written. The two slips above were generated directly, not through a Payroll Entry.

**ADR-0010 is not reproduced by configuration.** The hourly path is plain multiplication: `wages_amount = self.hour_rate * self.total_working_hours` ([salary_slip.py L435-441](https://github.com/frappe/hrms/blob/1b2d7e034e0de8e30a9e513541d7741710587ad5/hrms/payroll/doctype/salary_slip/salary_slip.py#L435-L441)). `hour_rate` is read from the linked Salary Structure by `get_timesheet_config()` ([salary_structure_assignment.py L261-277](https://github.com/frappe/hrms/blob/1b2d7e034e0de8e30a9e513541d7741710587ad5/hrms/payroll/doctype/salary_structure_assignment/salary_structure_assignment.py#L261-L277)). Accent's rate `CTC ÷ (working days × std hours)` is not computed anywhere in that path. It would need a custom structure/assignment rule, an external precomputed rate per period, or an explicit policy change. A static rate on a submitted structure is also a poor fit for a recomputed monthly rate: changing it means amending a submitted document.

## 4. India Payroll: installed is not the same as enabled

- All statute switches on `Payroll Settings` were **off** on this fresh site: `enable_professional_tax`, `enable_esic`, `enable_lwf`, `enable_epf`, `enable_tds_filing` = 0. This is why the two pilot slips had no statutory deductions even though the company country is India. `is_statutory_enabled()` requires the global toggle, plus a company row when multi-company payroll is on ([company_settings.py L53-69](https://github.com/frappe/india_payroll/blob/a9918501260e01e35138ae2d9af873b136ddc62e/india_payroll/india_payroll/company_settings.py#L53-L69)).
- Deductions are injected into salary-slip calculation by regional overrides, not by a separate filing job: PT, ESI, LWF, EPF in `apply_regional_deductions`; employer contributions in `apply_regional_employer_contributions` ([hooks.py L193-212, L278-285](https://github.com/frappe/india_payroll/blob/a9918501260e01e35138ae2d9af873b136ddc62e/india_payroll/india_payroll/hooks.py#L193-L212), [salary_slip.py](https://github.com/frappe/india_payroll/blob/a9918501260e01e35138ae2d9af873b136ddc62e/india_payroll/india_payroll/india_payroll/salary_slip.py)).
- PT slabs live in Python (`STATE_PT_CONFIG`), including Maharashtra's February ₹300 rule and the women's exemption from 1 April 2023 ([professional_tax.py](https://github.com/frappe/india_payroll/blob/a9918501260e01e35138ae2d9af873b136ddc62e/india_payroll/india_payroll/india_payroll/professional_tax.py)). Rate changes therefore follow code upgrades, not just configuration.
- EPF handles the ₹15,000 → ₹25,000 ceiling change effective 17 September 2026 with day-weighted splits inside a period ([epf.py L184-232](https://github.com/frappe/india_payroll/blob/a9918501260e01e35138ae2d9af873b136ddc62e/india_payroll/india_payroll/india_payroll/epf.py#L184-L232)). ESI wage identification is a **name heuristic** on Basic/DA/Retaining Allowance components; an unrecognised component is skipped with a warning ([esi.py L25-62](https://github.com/frappe/india_payroll/blob/a9918501260e01e35138ae2d9af873b136ddc62e/india_payroll/india_payroll/india_payroll/esi.py#L25-L62)). Both need accountant review of component naming.
- TDS filing is wired to an external **Sandbox** service through `tds/sandbox_client.py`; `tds/filing.py` orchestrates Form 24Q (the source calls it "Form 138 from TY 2026-27"), and `tds/form16.py` handles Form 16. No filing was attempted, so no output was validated.

## 5. REST integration: what worked

Session-cookie login at `POST /api/method/login`; CRUD at `/api/resource/<DocType>[/<name>]`; whitelisted method calls at `/api/method/<dotted.path>`.

| Action                | Endpoint used                                                                                                                             | Result                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Read metadata/lists   | `GET /api/resource/Salary Structure`, `GET /api/method/frappe.auth.get_logged_user`                                                       | worked                                                                                       |
| Create documents      | `POST /api/resource/<DocType>`                                                                                                            | worked for Employee, Salary Structure, SSA, Timesheet, Holiday List, Holiday List Assignment |
| Submit                | `POST /api/method/frappe.client.submit` with the **full** doc including `modified`                                                        | worked; a partial doc fails mandatory/timestamp checks                                       |
| Cancel                | `POST /api/method/frappe.client.cancel` with `doctype` and `name`                                                                         | worked                                                                                       |
| Generate hourly slip  | `POST /api/method/hrms.payroll.doctype.salary_slip.salary_slip.make_salary_slip_from_timesheet` with `source_name`                        | returned an unsaved, calculated Salary Slip                                                  |
| Generate monthly slip | `POST /api/method/hrms.payroll.doctype.salary_structure.salary_structure.make_salary_slip` with `source_name`, `employee`, `posting_date` | returned an unsaved, calculated Salary Slip                                                  |

Gotchas observed:

- Check fields are inconsistent on create: `is_active` accepted only `"Yes"`, while `salary_slip_based_on_timesheet` had to be integer `1`. `"Yes"` silently stored as `0` for the latter, and the timesheet slip generation then refused the structure. Use a pilot to pin down field encodings before writing an integration.
- Only whitelisted methods are callable: `frappe.desk.form.meta.get_meta` returned `PermissionError: not whitelisted`. A service integration needs a small whitelisted endpoint or Frappe's documented REST resources.
- Slip calculation needs a Holiday List **Assignment** for the employee, not only the Employee's `holiday_list` field. Without it, slip generation failed with "No Holiday List was found".
- Role/permission behaviour for a restricted service user was not tested; all calls above used Administrator.

## 6. Fit against Accent's requirements

| Requirement                             | Status on this bench          | Evidence / gap                                                                                                                                                                                                                             |
| --------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monthly staff with zero project hours   | **Verified**                  | 30,000 Basic produced gross 30,000 with zero hours                                                                                                                                                                                         |
| Hourly engineers from timesheets        | **Verified**                  | 500 × 7.5 = 3,750                                                                                                                                                                                                                          |
| Only reviewed hours are paid            | **Needs pilot**               | Draft Timesheets were excluded; review state and approval gate still need design                                                                                                                                                           |
| ADR-0010 monthly CTC-derived rate       | **Customization required**    | Hour Rate is a static field on Salary Structure; no CTC/working-days formula in the hourly path                                                                                                                                            |
| Effective-dated pay changes             | **Needs pilot**               | Salary Structure Assignment is dated and submitted; amendment behaviour for a period must be tested                                                                                                                                        |
| Indian statutory deductions             | **Needs pilot**               | All toggles off by default; PT slabs in code; component naming affects ESI/EPF                                                                                                                                                             |
| ECR / 24Q / Form 16                     | **Not established**           | Code paths and Sandbox integration exist; nothing was filed or validated                                                                                                                                                                   |
| Exception roster before close           | **Not established**           | Payroll Entry has an employee table and statuses, but readiness/exception workflow needs a pilot                                                                                                                                           |
| One run covering both streams           | **Not established**           | Payroll Entry selects one structure mode; two entries per month needed                                                                                                                                                                     |
| Accent single-writer and slip snapshots | **Integration design / risk** | Frappe owns its slips; Accent needs source-aware import of approved cost. Cancelling a Payroll Entry cancels **and deletes** its Salary Slips (`delete_linked_salary_slips`), which conflicts with ADR-0009 and the read-only archive rule |
| Operation by the owner                  | **Not tested**                | UI workflow needs a real representative month                                                                                                                                                                                              |

## 7. Questions a private pilot must answer

1. Approve the exact hourly agreement: is the rate fixed, or recomputed from CTC and month working days? If recomputed, who sets it before each month and how is history protected?
2. Can the accountant reproduce one approved month, including a joiner/leaver, zero hours, a salary revision, Maharashtra PT's February rule, and PF/ESI boundaries?
3. Which Frappe roles can a service user hold so Accent can read slips and drive Payroll Entry over REST without Administrator?
4. What external source identity/version will Accent store per imported slip, so reimports do not duplicate cost and reports do not re-price history?
5. Who owns statutory rate updates and Sandbox/TDS filing credentials if the platform is adopted?

## Evidence limits

Only this local bench and its installed source were inspected. No filing, bank export, or real payroll was run. The earlier comparison note's claim that no automatic `CTC ÷ (working days × std hours)` recomputation exists is now confirmed in source for this version; the broader statutory calculations remain vendor claims until an accountant checks them. The companion deep dive reports further source-level findings (two-entry constraint, role requirements, licence facts) not re-tested here, apart from the Payroll Entry slip-deletion check. Pilot records were deleted and the temporary `allow_tests` setting was returned to `false`; the bench itself was started and left running.
