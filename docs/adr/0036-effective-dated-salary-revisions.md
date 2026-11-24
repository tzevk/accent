---
status: accepted
---

# Salary changes preserve dated agreements; unused entries remain correctable

The old Salary Profile API overwrote or deleted agreements, while historical readers selected agreements inconsistently. The approved design separates a Salary Revision, which changes agreed pay, from a Salary Correction, which fixes a mistaken entry. The user confirmed this decision on 2026-11-15. It is implemented on `integration/434-salary-profiles`; PR #454 is open and unmerged for review, and no production migration or deployment has been performed.

A newly saved, unused agreement remains editable without creating another profile. Once payroll uses it, ordinary editing stops. Superseded agreements remain read-only, and a genuine salary change creates a new dated revision without deleting previous terms.

## Effective dates and recorded calculations

- Revisions start at monthly boundaries. A first agreement may start on the Employee's verified joining date, including mid-month, only while no canonical agreement, legacy structure or recorded payroll-use history exists.
- Legacy-only onboarding is prospective: a first canonical agreement starts on a future month boundary (or the current month when unused), while period-effective legacy terms remain the read-only history before it.
- A hike may start in the current month only while the target month remains unused by payroll. Earlier-month hikes are blocked.
- Future revisions may be scheduled, including more than one in chronological order. Validity periods must not overlap, and the preceding period ends automatically before the successor starts.
- An unused scheduled revision may be cancelled with retained evidence and its predecessor's coverage restored. A Current agreement is not eligible for the future-schedule cancellation action; correct it while unused or supersede it with a later revision.
- Payroll-use protection survives deleting a draft Payroll Slip, reopening a run and cancelling another agreement. Unknown-month evidence blocks every timeline write for that Employee; conflicting or ambiguous evidence blocks writes in the affected range until reviewed.
- Payroll Slips retain recorded amounts, including drafts. Salary writes never regenerate slips.
- Historical salary-based estimates use the agreement valid for that period. Missing historical agreements remain unavailable, not replaced by today's salary.
- Unclosed reports may still change when other inputs, such as Logged Hours, are corrected.
- Monthly CTC becomes the explicit main pay input for both streams. ADR-0010's pay formula remains unchanged.

## Workspace boundary

The dedicated Payroll workspace owns Salary Profile creation and editing. Employee pages retain authorized salary summaries and links to that workspace, not separate salary editors. This revises ADR-0030's pay-editor placement, while retaining its separation between employee access and payroll access. Salary Type, not Employee Type, selects the pay stream.

## Implementation (2026-11-16)

The shipped workspace is split into a payroll-authorized directory at
`/admin/payroll/salary-profiles` and a full-page editor at
`/admin/payroll/salary-profiles/[employeeId]`. The editor distinguishes
**Create Salary Profile**, **Edit agreement** (Correction), **New Salary
Revision** and **Cancel scheduled agreement**. Current, Scheduled and Previous
are date-derived classifications; Cancelled follows retained cancellation
state. Previous and Cancelled agreements are read-only.

The command surface exposes explicit `create-initial`, `correct`, `revise` and
`cancel` operations, each carrying an expected salary-timeline version. The
same-date upsert and hard delete are gone. Writes serialize per Employee,
validate the expected version, maintain adjoining effective periods, retain
cancellation evidence and advance the timeline version atomically with the
audit event. Salary-write transactions use explicit READ COMMITTED through the
shared `salary-write-isolation` helper rather than REPEATABLE READ, because
REPEATABLE READ gap-locked the eligible-start/use-index supremum and deadlocked
independent Employees; per-Employee serialization and `FOR UPDATE` current reads
remain. The owned contention proof is the verification gate.

A durable `employee_salary_payroll_use` ledger records committed generation and
finalization use per Employee, month and source-qualified agreement. It is not
removed by deleting a draft slip or reopening a run, and unknown-month ambiguity
blocks timeline writes until reviewed. New Payroll Slips record their agreement
identity and Salary Type; existing slips keep their snapshot.
`drizzle/history/20261115140000_salary_profile_revisions.ts` supplies this schema and
conservatively backfills evidence from recorded slips, frozen rosters and
Payroll Slip audit rows, leaving unprovable identities ambiguous.

Monthly CTC is the explicit `employer_cost` write input; a present zero is
valid. Only an absent canonical value may disclose the positive-only legacy
`gross_salary`/`gross` fallback, and that fallback is never persisted as agreed
CTC. Historical readers share one period-effective selection and return
unavailable or ambiguous rather than filling a gap with today's salary. See
[Salary Profiles migration and rollout](../app/payroll/salary-profiles-rollout.md)
for the cutover procedure and current verification gaps.

## Trade-off and consequences

Immutable-from-creation agreements would make simple entry errors require extra profiles or deletion. Unrestricted editing would rewrite salary history. Allowing correction only before payroll use preserves both a practical setup workflow and historical evidence.

The change must cover write commands, historical report selection, and slip/PDF/export readers, not only page layout. Multiple agreements must not duplicate slip rows or let later salaries change older slip displays. Existing ambiguous or overlapping agreements need explicit review; implementation must not invent historical terms.

See [the workspace design](../app/payroll/salary-profiles-design.md) for the approved behavior and interaction details.
