# Salary Profiles workspace design

Status: approved by the user on 2026-11-15. Not implemented.

## Job and scope

Payroll and HR operators create Salary Profiles, correct newly entered mistakes, and record genuine salary changes. The workspace covers Payroll and Contract pay streams, one Employee at a time. Employee master data stays in the employee directory.

Confirmed decisions:

- Provide a dedicated page under Payroll.
- Use a searchable employee list followed by a full-page editor, not a modal or drawer.
- Include Employees who have no Salary Profile.
- Replace employee-page salary editors with authorized summaries and links to the shared workspace.
- Select the pay stream using Salary Type, not Employee Type.
- Use explicit monthly CTC as the main agreed pay input for both streams.
- Preserve the current payroll calculation. No bulk editing or spreadsheet import.

## Salary Revision and Salary Correction

A genuine agreement change uses **New Salary Revision**. A mistaken value in a newly saved, unused agreement uses **Edit** and keeps the same agreement. Once payroll uses an agreement, ordinary editing stops. Previous, superseded agreements remain read-only.

A correction retains an audit trail. It must not require deleting the incorrect agreement or making another visible Salary Profile. A used agreement is not silently corrected through a new API shape or another editing location.

## Dates and historical behavior

- Established-employee revisions use monthly effective dates.
- A hike may start in the current month only if payroll has not used the agreement. Backdated hikes into earlier months are blocked.
- Initial setup may use the joining date, including a mid-month joining date.
- Future monthly revisions may be scheduled.
- The preceding agreement ends automatically before its successor starts. Operators do not manage overlapping end dates manually.
- Salary changes leave existing Payroll Slip amounts unchanged, including draft slips. They never trigger automatic regeneration.
- Historical reports use the salary agreement valid for their period. They never fill a missing historical agreement with today's salary.
- Unclosed reports can still reflect corrected hours or other non-salary inputs.

## Approved interaction details

These details were approved with the final design brief:

- List: employee search, Payroll/Contract filters, and a distinct Missing Profile filter. Employees without agreements remain discoverable.
- Editor: employee identity, agreement dates, monthly CTC, standard hours, grouped supported earnings/deduction settings, and a clearly labelled estimate.
- Preview: explain the CTC, Basis Hours and Logged Hours relationship. Never label a stored daily/hourly amount as the rate payroll actually uses.
- Keep supported existing pay settings. Show live leave usage as read-only information rather than saving today's usage into an older agreement.
- History: show Current, Scheduled and Previous agreements, effective ranges, and payroll-use status.
- Edit an unused agreement without creating another visible agreement. Review before/after values when saving a change.
- Schedule a revision from the selected agreement, review the changed terms and start month, then save.
- Allow cancellation of an unused scheduled revision through an explicit recorded action, not a hard delete. Keep the predecessor's coverage consistent.
- Preserve existing payroll permissions. Read-only users do not see write controls, and employee access alone does not grant salary access.
- Desktop: grouped editor sections and a readable preview/history area. Mobile: the same content in reading order without an oversized dialog.
- Preserve unsaved input on errors, warn before discarding changes, prevent duplicate submissions, and reject stale saves rather than overwriting another operator's changes.

## Required reader and data work

The current API can overwrite same-date entries and hard-delete salary agreements. Historical reports can fall back to the latest profile. Slip, PDF and export queries can join multiple active profiles and duplicate a slip. These paths must obey the new rules end to end.

Existing ambiguous or overlapping agreements require review; do not silently close periods or manufacture old salary values. A historical period with no confirmed agreement stays explicitly unavailable. Preserve supported legacy Salary Types without silently converting existing agreements.

## Boundaries and proof

Do not change ADR-0010's pay formula, automatically regenerate slips, grant permissions, add arrears calculation, or invent unsupported company-grid values.

Implementation proof must cover unused correction, editing refusal after payroll use, scheduled hikes, non-overlapping periods, date restrictions, historical salary selection, missing historical data, unchanged saved slip amounts, and single-row slip/PDF/export behavior. Verify the actual editor on desktop and mobile.

[ADR-0036](../../adr/0036-effective-dated-salary-revisions.md) records the domain trade-off and the change to ADR-0030's pay-editor placement.

The [implementation specification](salary-profiles-spec.md) expands this approved brief into user stories, command contracts, rollout safeguards and testing decisions.
