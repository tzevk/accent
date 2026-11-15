---
status: accepted
---

# Salary changes preserve dated agreements; unused entries remain correctable

The current Salary Profile API overwrites or deletes agreements, while historical readers select agreements inconsistently. The approved design separates a Salary Revision, which changes agreed pay, from a Salary Correction, which fixes a mistaken entry. The user confirmed this decision on 2026-11-15; it is not implemented.

A newly saved, unused agreement remains editable without creating another profile. Once payroll uses it, ordinary editing stops. Superseded agreements remain read-only, and a genuine salary change creates a new dated revision without deleting previous terms.

## Effective dates and recorded calculations

- Revisions start at monthly boundaries. A first agreement may start on the Employee's joining date.
- A hike may start in the current month only while the agreement remains unused by payroll. Earlier-month hikes are blocked.
- Future revisions may be scheduled. Validity periods must not overlap, and the preceding period ends automatically before the successor starts.
- Payroll Slips retain recorded amounts, including drafts. Salary writes never regenerate slips.
- Historical salary-based estimates use the agreement valid for that period. Missing historical agreements remain unavailable, not replaced by today's salary.
- Unclosed reports may still change when other inputs, such as Logged Hours, are corrected.
- Monthly CTC becomes the explicit main pay input for both streams. ADR-0010's pay formula remains unchanged.

## Workspace boundary

The dedicated Payroll workspace owns Salary Profile creation and editing. Employee pages retain authorized salary summaries and links to that workspace, not separate salary editors. This revises ADR-0030's pay-editor placement, while retaining its separation between employee access and payroll access. Salary Type, not Employee Type, selects the pay stream.

## Trade-off and consequences

Immutable-from-creation agreements would make simple entry errors require extra profiles or deletion. Unrestricted editing would rewrite salary history. Allowing correction only before payroll use preserves both a practical setup workflow and historical evidence.

The change must cover write commands, historical report selection, and slip/PDF/export readers, not only page layout. Multiple agreements must not duplicate slip rows or let later salaries change older slip displays. Existing ambiguous or overlapping agreements need explicit review; implementation must not invent historical terms.

See [the workspace design](../app/payroll/salary-profiles-design.md) for the approved behavior and interaction details.
