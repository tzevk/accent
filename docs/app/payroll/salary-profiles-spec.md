> **Status (2026-11-16):** implemented in issue #434 on
> `integration/434-salary-profiles`. PR #454 is open and unmerged for review;
> no production migration or deployment has been performed. The problem
> statement below records the pre-implementation gap, not current behavior.
> Shipped operation is in the [Payroll operator guide](operator-guide.md#salary-profiles-workspace)
> and rollout is in [Salary Profiles migration and rollout](salary-profiles-rollout.md).

## Problem Statement

Payroll operators must open employee records to create or update Salary Profiles. Payroll and Contract use separate editors. Employee Type controls the editor, although Salary Type controls the actual pay stream.

Operators cannot clearly distinguish a genuine salary change from a mistaken entry. Saving can overwrite an existing agreement, and deleting can remove it permanently. Effective dates can overlap without warning. Contract operators cannot enter revision dates through the current form.

Historical calculations are also exposed. Some reports choose the latest salary when no historical agreement exists. Some slip readers join multiple agreements, duplicating slips or using newer salary values in older displays.

Operators need one clear workspace. It must support ordinary corrections before payroll use and dated salary changes afterward. Previous agreements and recorded Payroll Slip amounts must remain intact.

## Solution

Provide a dedicated Salary Profiles workspace under Payroll. Operators search an employee list, including Employees without profiles, and open a full-page editor.

The editor supports Payroll and Contract agreements. Monthly CTC is the explicit main input. Existing supported pay settings remain available. A clearly labelled estimate explains the existing CTC, Basis Hours and Logged Hours calculation.

Use two distinct actions:

- **Edit:** correct mistaken values in a newly saved, unused agreement. Keep the same Salary Profile agreement and record the correction.
- **New Salary Revision:** record a genuine change to agreed pay. Preserve the previous agreement and apply the successor from its effective month.

Show Current, Scheduled and Previous agreements. Allow future monthly revisions. Manage adjoining effective periods automatically. Ordinary editing stops once payroll uses an agreement.

Salary writes must never automatically regenerate Payroll Slips. Historical reports use the agreement valid for the relevant period, not today's salary. Employee pages retain authorized summaries and links, not separate salary editors.

## User Stories

1. As a payroll operator, I want a Salary Profiles workspace, so that salary setup belongs beside monthly payroll.
2. As a payroll operator, I want to search Employees, so that I can quickly find the correct person.
3. As a payroll operator, I want employee identity clearly displayed, so that I avoid changing another person's salary.
4. As a payroll operator, I want Payroll and Contract filters, so that I can focus on one pay stream.
5. As a payroll operator, I want a Missing Profile filter, so that I can identify incomplete salary setup.
6. As a payroll operator, I want Employees without agreements listed, so that missing profiles do not hide their owners.
7. As a payroll operator, I want salary setup independent of Employee Type, so that directory categories do not block pay management.
8. As a payroll operator, I want a full-page editor, so that complex salary settings remain readable.
9. As a payroll operator, I want grouped fields, so that earnings and deductions are easy to distinguish.
10. As a payroll operator, I want to create a Payroll agreement, so that an Employee can enter that pay stream.
11. As a payroll operator, I want to create a Contract agreement, so that contractual pay uses the same workspace.
12. As a payroll operator, I want an explicit monthly CTC input, so that I understand payroll's agreed pay base.
13. As a payroll operator, I want standard daily hours visible, so that the Basis Hours calculation is understandable.
14. As a payroll operator, I want supported earnings settings available, so that existing agreements retain their detail.
15. As a payroll operator, I want supported deduction settings available, so that applicable deductions remain configurable.
16. As a payroll operator, I want Contract settings clearly grouped, so that I understand their effect without opening another editor.
17. As a payroll operator, I want existing legacy Salary Types preserved, so that the new workspace does not silently convert agreements.
18. As a payroll operator, I want an estimated earnings breakdown, so that I can review entered terms before saving.
19. As a payroll operator, I want estimates clearly labelled, so that I do not mistake them for generated Payroll Slips.
20. As a payroll operator, I want CTC, Basis Hours and Logged Hours explained, so that I understand actual payroll pricing.
21. As a payroll operator, I want irrelevant stored rate fields distinguished, so that I do not mistake them for operative payroll rates.
22. As a payroll operator, I want date-effective Component Rates respected, so that profile previews follow the existing calculation.
23. As a payroll operator, I want missing values distinguished from zero, so that incomplete data is not presented as confirmed pay.
24. As a payroll operator, I want live leave usage read-only, so that saving salary terms cannot rewrite attendance-derived balances.
25. As a payroll operator, I want to edit a newly saved mistake, so that I need not delete the agreement.
26. As a payroll operator, I want corrections to retain the agreement's identity, so that a typo does not create another profile.
27. As a payroll operator, I want a before-and-after review, so that I can catch accidental changes before saving.
28. As an auditor, I want correction history, so that the original and corrected values remain traceable.
29. As a payroll operator, I want editing blocked after payroll use, so that agreed values supporting recorded payroll stay protected.
30. As a payroll operator, I want a clear explanation when editing is blocked, so that I know why the profile is protected.
31. As a payroll operator, I want New Salary Revision separate from Edit, so that a hike is not recorded as a correction.
32. As a payroll operator, I want previous terms available when preparing a revision, so that unchanged settings need not be re-entered.
33. As a payroll operator, I want monthly effective dates, so that established-employee hikes match payroll's month-based pricing.
34. As a payroll operator, I want current-month changes restricted to unused periods, so that processed payroll cannot be silently repriced.
35. As a payroll operator, I want earlier-month hikes rejected, so that a new agreement cannot rewrite historical salary assumptions.
36. As a payroll operator, I want initial setup to support joining dates, so that mid-month joiners can receive valid agreements.
37. As a payroll operator, I want future hikes scheduled, so that I can enter approved changes before their start month.
38. As a payroll operator, I want Current and Scheduled agreements distinguished, so that future salaries are not mistaken for today's terms.
39. As a payroll operator, I want Previous agreements readable, so that I can inspect salary history without changing it.
40. As a payroll operator, I want adjacent agreement periods maintained automatically, so that I do not manage end dates manually.
41. As a payroll operator, I want overlapping periods rejected, so that one period cannot resolve to competing salaries.
42. As a payroll operator, I want unused scheduled entries correctable, so that a future-entry mistake does not require another agreement.
43. As a payroll operator, I want scheduled revisions cancellable explicitly, so that an abandoned hike does not take effect.
44. As an auditor, I want cancelled schedules retained, so that cancellation does not erase evidence.
45. As a payroll operator, I want predecessor coverage restored after cancellation, so that cancelling a hike does not create a salary gap.
46. As a payroll operator, I want scheduled revisions to become effective by date, so that activation does not depend on opening the page.
47. As a payroll operator, I want multiple scheduled agreements ordered clearly, so that later changes remain understandable.
48. As a payroll operator, I want salary saves to leave draft slips unchanged, so that existing calculations are not silently regenerated.
49. As a payroll operator, I want finalized and paid slips unchanged, so that later hikes cannot alter recorded pay.
50. As an Employee, I want older slip documents unchanged by salary revisions, so that my recorded pay remains reliable.
51. As a payroll operator, I want one listing row per Payroll Slip, so that multiple agreements cannot duplicate employees or totals.
52. As a payroll operator, I want historical slip streams resolved consistently, so that later Payroll/Contract changes do not move earlier slips.
53. As a payroll operator, I want PDFs and exports to match recorded slips, so that downloaded evidence agrees with the screen.
54. As a report reader, I want the salary valid for each historical period, so that later hikes do not reprice earlier estimates.
55. As a report reader, I want unavailable historical salary disclosed, so that today's salary is not invented as historical evidence.
56. As a report reader, I want ambiguous agreement history flagged, so that contradictory records are not resolved silently.
57. As a report reader, I want corrected hours reflected in unclosed reports, so that salary history does not freeze unrelated inputs.
58. As a payroll operator, I want employee-page links to the shared editor, so that there is only one salary-writing workflow.
59. As an employee administrator, I want payroll permissions respected, so that employee access does not expose salary data.
60. As a payroll reader, I want read-only history, so that denied write actions are not presented as usable controls.
61. As an authorized payroll operator, I want consistent server checks, so that another caller cannot bypass editing restrictions.
62. As a payroll operator, I want conflicting saves rejected, so that another operator's changes are not overwritten.
63. As a payroll operator, I want duplicate submissions handled safely, so that one action cannot create overlapping agreements.
64. As a payroll operator, I want failed saves to preserve input, so that a temporary failure does not lose my work.
65. As a payroll operator, I want unsaved-change warnings, so that navigation does not discard salary edits accidentally.
66. As a payroll operator, I want clear loading, empty and error states, so that incomplete responses are not mistaken for missing salary.
67. As a keyboard user, I want labelled fields and predictable focus, so that I can complete salary setup without a pointer.
68. As a mobile operator, I want readable stacked sections, so that the full workflow remains usable on a narrow screen.
69. As an auditor, I want recorded actors and timestamps, so that salary changes and corrections are attributable.
70. As a payroll owner, I want existing agreements reviewed without invented backfills, so that rollout preserves trustworthy history.

## Implementation Decisions

### Workspace and ownership

- Extend the established application interface rather than introducing another visual system. Use a searchable list followed by a full-page editor. Provide Payroll, Contract and Missing Profile views.
- Salary Type selects the pay stream. Contract selects Contract; other supported types select Payroll. Employee Type remains a separate directory category. An Employee without a covering agreement remains discoverable.
- Replace employee-page salary editors with authorized summaries and links. Migrate every navigation entry and write caller. Remove duplicate editor implementations and obsolete write contracts rather than retaining parallel conventions.
- Keep one employee directory as the employment source. The salary workspace is a payroll-authorized projection, not another employee-master write surface. Return only the employee information needed for payroll tasks. Reuse and correct the existing payroll-authorized employee/profile list and batch readers: exclude soft-deleted Employees, support search and Missing Profile, and resolve the requested date rather than the newest future row. Do not grant employee permissions to populate the workspace.
- Preserve existing payroll authorization. Salary reads require payroll read access. Initial creation, correction and revision retain the current payroll update permission. Scheduled cancellation replaces destructive deletion and requires the existing payroll delete permission. Preserve shell access rules and the super-admin bypass; grant no new privileges automatically.
- Show controls according to effective permissions, but enforce all permissions and state restrictions on the server.

### Agreement lifecycle and command Interface

- Keep the canonical Salary Profile agreement as the stored pay agreement. A Salary Correction updates the same unused agreement; a Salary Revision creates a successor agreement. A correction must not create another visible profile.
- Expose distinct create-initial, correct-unused, create-revision and cancel-unused-schedule operations. Remove silent same-date upserts and hard deletion. Reject creation on an existing non-cancelled start date rather than interpreting it as a correction. A retained cancellation does not prevent a later valid agreement using that month; retain both identities and their audit history.
- Read operations return agreement identity, Salary Type, effective range, current/scheduled/previous/cancelled classification, payroll-use state, and the Employee's salary-timeline version. Return the relevant permitted actions or enough authoritative state to explain unavailable actions.
- Writes carry the expected Employee salary-timeline version. Validate identity, ownership, permissions, dates, required pay settings and that version within the transaction. A missing agreement is not a successful update. Conflicting dates, stale versions and invalid lifecycle actions produce explicit conflict responses; invalid input produces a validation response. Never return success for zero affected agreements.
- Treat payroll-use protection as permanent. Retain durable use evidence by Employee, agreement and payroll month, in addition to a first-use marker and agreement identity on new slips. Deleting a draft slip, reopening a run or cancelling another agreement must not unlock used terms or make an already-used month eligible for a new current-month revision.
- A profile becomes used when committed payroll generation first records a slip from it, or when committed finalization records its agreement provenance. Previews and failed or rolled-back payroll attempts do not mark it used. Existing recorded payroll and frozen provenance establish protection during rollout.
- Generation/finalization and salary writes must coordinate within transactions, using the same per-Employee serialization rule. A correction racing payroll must either complete before payroll reads the agreement or fail after payroll marks it used. A save must not pass an unlocked pre-check while payroll records different terms.
- Serialize timeline-changing writes per Employee. Atomically validate the timeline, insert/update/cancel the agreement, adjust adjoining effective periods, advance the salary-timeline version and record the audit event. Advance that version when payroll first marks an agreement used, so a previously opened editor cannot overwrite the newly protected state. No partial period closure or orphaned schedule is acceptable.
- Keep an audit record for creation, correction, revision and cancellation, including actor, timestamp, agreement identity and before/after terms. Do not log authentication secrets or expose unauthorized salary data.

### Effective dates and history

- A genuine revision for an established Employee starts on the first day of a month. Do not silently round a selected mid-month date.
- A revision may start in the current month only when the durable use evidence shows no payroll use for that Employee in that month. Consult that evidence even when the month's draft slip was later deleted. Earlier-month use locks older agreed values, but does not prevent a prospective successor in an unused month.
- Reject genuine revisions into earlier months. The initial-agreement exception may use a verified joining date, including mid-month joining. It does not authorize rewriting existing canonical, legacy or recorded payroll history.
- Preserve the existing payroll anchor: month start for established Employees; joining date when later than month start for a new joiner. Validate dates in the payroll calendar, independent of browser or server timezone.
- Scheduled agreements take effect through date-based selection, without a cron, activation write, or page visit. Support more than one scheduled month with one non-overlapping chronological timeline.
- Automatically end the predecessor on the day before its successor. This effective-range maintenance is allowed for used agreements only when it preserves all earlier periods and substantive agreed values. Operators do not manually edit end dates to create overlaps or bypass use protection.
- Only unused Current or Scheduled agreements permit corrections. Previous and cancelled agreements are read-only, even when they have no use marker. An unused Scheduled agreement may move to another future monthly start, or to the current month's start only while that Employee/month is unused. Reject earlier-month and established-employee mid-month dates. Reconnect both neighboring periods atomically and never move the agreement across protected payroll use.
- Cancelling an unused future revision retains its evidence and removes it from effective selection. Atomically reconnect predecessor/successor coverage. An agreement that has become current is not eligible for the future-schedule cancellation action.
- Current, Scheduled and Previous are date-derived classifications, not instructions to deactivate every older row. Preserve older valid agreements for historical selection. Cancelled records remain inspectable but cannot price payroll or reports.
- An unused correction repairs entered terms within the same agreement. A genuine later revision preserves its predecessor. Do not implement these actions as interchangeable writes.

### Pay input and previews

- The command's required monthly CTC maps directly to the canonical employer_cost value. Reject missing, non-finite, negative or out-of-range amounts; an explicitly entered zero remains a valid zero, not a request for fallback. Standard daily hours must be finite and positive. Never replace entered CTC with preview-derived employer cost or add employer contributions again.
- Remove gross_salary as a required input of the new command Interface. Existing gross_salary and gross retain their historical agreed-gross meanings; contract_amount retains its historical Contract amount/duration meaning. They are not alternative inputs to the CTC-first editor. Preserve these recorded values on existing agreements, label them as legacy references when shown, and do not convert them to CTC or silently synchronize them during corrections. New CTC-first agreements leave these legacy amount fields unset; make the legacy gross field nullable through a non-destructive migration where needed.
- All new writes require explicit CTC, and loading then saving an agreement must preserve that amount exactly. Existing legacy agreements without stored CTC may still expose the established read-only fallback with its source disclosed. Do not persist that fallback as an agreed CTC until an authorized operator explicitly confirms the value. Presence-based reads must preserve explicit zero CTC rather than falling through to a different legacy amount. Preview totals are derived estimates, not replacement agreement amounts.
- Retain the existing payroll formula: Hourly Rate equals CTC divided by Basis Hours; hours-based Gross equals that rate times Logged Hours. Preserve existing allowance, deduction and rounding rules. Attendance overtime and absence do not add a second pay adjustment.
- Reuse the existing calculation Interface and Decimal-based money helpers. Extend the existing preview Interface to accept explicit CTC when legacy gross inputs are absent; its current gross-only eligibility check must not suppress a valid CTC-only or explicit-zero preview. Do not manufacture a legacy gross amount merely to pass that guard. Do not implement salary arithmetic inside the page or create an independent preview calculator.
- Retain supported earnings, deduction, applicability, loan/advance and Contract settings. Distinguish agreed instructions from computed amounts. Existing legacy Salary Types must remain readable and correctable where otherwise permitted; do not silently convert their types.
- Show operative CTC and standard daily hours prominently. Explain how the selected month supplies Basis Hours. Label full-period or assumed-hours previews as estimates and display their assumptions. Do not describe stored daily/hourly rates as the rates payroll actually uses.
- Preserve existing Component Rate ownership and effective-date rules. The Salary Profile workspace does not replace the Component Rates editors or change the calculation's DA policy.
- Display attendance-derived leave usage read-only. Salary saves must not write today's calculated usage into a dated agreement. Preserve supported contractual terms and leave entitlements separately from that live display.
- Do not invent additional meanings for unsupported company-grid fields. Show missing values distinctly from genuine zero values.

### Historical readers and recorded evidence

- Centralize agreement selection and CTC resolution behind narrow shared Interfaces used by payroll and salary-dependent reports. Reuse the existing month/joining anchor and covering-agreement behavior. A future agreement must never satisfy a historical gap. Every consumer must prefer present canonical CTC, including zero, before considering the established legacy gross fallback; remove report-specific gross-first precedence.
- Use the same deterministic selection rule across utilization, manhours and live employee-cost estimates. Remove latest-salary fallback when no agreement covers the requested historical period. Return an explicit unavailable state instead of zero or a guessed salary. Employee/profile batch reads and profile previews must follow the same agreement and CTC rules.
- Valid new writes must prevent overlapping periods. Existing ambiguous legacy periods require a visible conflict state and review, not an arbitrary first row. Do not silently rewrite old terms during migration or page load. Reject writes whose required predecessor or affected range is ambiguous.
- Salary creation, correction, revision and cancellation never automatically regenerate or reprice existing Payroll Slips, including drafts. Preserve the existing explicit payroll regeneration and run-lock workflow; salary saves do not invoke it.
- For newly recorded payroll, retain the selected agreement identity and sufficient recorded salary context to resolve later readers without today's agreement. Keep money and other printed calculation inputs on the slip snapshot, not as live Salary Profile lookups.
- Update slip listings, summaries, individual and bulk PDFs, self-service views, exports and stream filters together. Multiple agreements must not multiply slip rows, totals or documents. Later Salary Type changes must not move earlier slips between streams.
- Preserve recorded slip figures. Any legacy repair requiring salary context must use confirmed period-effective or recorded context, never a later salary. If history cannot establish a value, disclose that limitation rather than fabricating it.
- Preserve recorded allocations and closed financial evidence. Unclosed estimates remain responsive to corrected non-salary inputs, including Logged Hours. This feature is not a complete immutable snapshot of every historical report.

### Persistence, rollout and interaction safeguards

- Use non-destructive migrations for durable per-month payroll-use evidence, agreement provenance, a per-Employee salary-timeline version and retained cancellation state. Preserve existing data while allowing the legacy gross field to be absent on CTC-first agreements. Enforce unique eligible start dates in a MariaDB-compatible way while allowing retained cancelled entries. Reuse the existing audit facility. Do not create a second salary agreement store or a generic event-sourcing framework.
- Review historical data before enabling revision writes. Establish durable Employee/month use protection from recorded slips, audit evidence and frozen-roster provenance wherever reliable. Preserve that evidence independently of future slip deletion. When a legacy slip lacks reliable agreement provenance, preserve the slip and conservatively protect candidate historical agreements; report ambiguity instead of inventing an exact link. Flag known prior use whose month or agreement cannot be established; reject affected writes rather than claiming that period is unused.
- Preserve the canonical-profile/read-only legacy fallback rule. For a legacy-only Employee, permit prospective first-canonical setup as a new agreement from a future monthly boundary, or the current month's start when durable use evidence permits it. Keep period-effective legacy fallback before that start. Do not apply the joining-date backdating exception merely because there is no canonical row: existing legacy terms or payroll history disqualify that exception. Legacy rows remain read-only; never erase them or silently convert their terms into invented canonical history.
- Apply required production migrations before deploying readers or writers that depend on them. Verify schema and migration status separately from Vercel deployment. Do not put production database changes inside a build.
- Provide permission-denied, loading, missing-profile, empty, validation, conflict and save-failure states. Retain entered values after recoverable failures. Prevent accidental duplicate submissions and warn before discarding changes.
- Review before/after terms and affected dates before saving changes. Keep current and future amounts visually distinct. Provide readable history and explanations for protected or ambiguous entries.
- Support keyboard operation, labelled fields, predictable focus and error association. Use the existing application's layout, forms and client-data conventions. Stack the full workflow coherently on narrow screens without an oversized drawer.

## Testing Decisions

- The user approved the existing real-sign-in financial browser journey as the primary end-to-end seam. Reuse its disposable MariaDB runtime, tracked fixtures and independent database reader. Do not introduce a second browser harness or authentication bypass.
- The browser is needed to prove the actual page, permission-gated controls, create/correct workflow and salary-change journey through real handlers and persistence. Extend the existing financial journey rather than adding a broad parallel E2E suite.
- Preserve the current read-only browser fixture and its permission assertions. Add a separate namespaced editor role/user with only the permissions exercised by the write journey, including salary update and payroll generation. Do not reuse or broaden the existing read-only admin role, seed a super-admin, or grant employee access as a shortcut. Add tracked no-profile, unused, used and scheduled agreement states and independent agreement/use-evidence readback; the existing run/slip readback alone is insufficient.
- The existing payroll-write guard rejects every non-GET payroll request. Use it only around read-only unchanged-slip verification, not around intentional profile or payroll writes. Retain its original read-only protection. Follow the owned fixture cleanup lifecycle and keep added browser-spec behavior within the repository's size limit by moving case combinations below the browser seam.
- Exercise initial creation, correction of an unused entry without another visible profile, payroll generation, editing refusal after use, scheduled revision and unchanged earlier slip display. Independently verify the corrected agreement identity, retained previous terms and recorded slip amounts in the database.
- Keep browser coverage focused. Put combinations and failure cases at the lowest existing seam that can prove their external behavior. Do not move the whole feature's date matrix into the browser.
- Update the existing salary-profile route contract tests. Prior art includes permission helpers, audit assertions, dynamically imported handlers and mocked database responses. Rewrite tests that currently require same-date overwrite and audited hard deletion to assert the new correction/revision/cancellation contracts. Add missing read/date/overlap/use cases; do not merely append tests while retaining contradictory old expectations.
- Cover unauthorized reads and writes; invalid ownership; missing agreements; same-date conflicts; edits after use; stale versions; duplicate saves; invalid dates; earlier-month hikes; current-month payroll use; mid-month initial joining; cancellation restrictions; and atomic rollback when a timeline write fails. Verify Previous agreements stay read-only without use markers, scheduled date corrections obey revision limits, and legacy-only onboarding cannot invoke historical initial-setup backdating.
- Use a focused disposable-database scenario for correction/generation races and concurrent timeline writes through their real command Interfaces. Use deterministic transaction coordination, not sleeps or merely simultaneous promises, to establish contention. Exercise both winner orders: a committed correction must be the terms payroll records; a committed payroll use must make the competing correction conflict. For two different timeline mutations carrying one expected version, exactly one succeeds and the other conflicts, with no partial period, audit or agreement changes. Assert committed results with an independent reader.
- Extend the existing payroll roster and report data-source tests for current, future, previous, gap, cancelled and ambiguous agreements. Include an established Employee and a mid-month joiner. Rewrite the current report regression that explicitly requires latest-profile fallback. A missing-history test must supply an actual future/latest agreement outside the requested period, not only an empty profile list. No report may use that agreement to price the uncovered past month.
- Extend existing payroll generation/finalization tests for durable monthly-use recording and rollback. Protection must persist after draft-slip deletion or reopening. Include an agreement used in an earlier month and reused in the current month: deleting its current-month draft must not permit a current-month revision. Rolled-back generation must not mark an unused agreement used.
- Extend existing slip listing, figure, PDF and export contract tests. Verify one slip/document per recorded identity, stable historical Salary Type, unchanged saved amounts and no repair from a later salary. Existing single-row figure tests do not prove join cardinality: seed multiple agreements for the same Employee and explicitly assert one listing/export/PDF record per slip, including self-service reads whose current limit can hide duplication. Include zero/missing legacy component values where current readers consult profiles.
- Reuse existing calculation tests to prove explicit CTC reaches the unchanged formula once. Check Payroll and Contract cases, Decimal rounding and preview assumptions. Include deliberately different stored CTC, legacy gross and Contract amounts; edit-load-save and preview must retain the explicit CTC. Test explicit zero separately from missing CTC, and verify invalid CTC and nonpositive hours are rejected. Do not test a second page-specific calculator.
- Use existing real-component rendering patterns for accessible labels, read-only controls, unsaved-input handling and error recovery. Update navigation and employee-hub regressions that currently expect Employee Type-filtered salary links or embedded salary editor tabs; assert the new shared-workspace entry points and permission separation instead. Query by roles and labels rather than source text, CSS classes or internal state.
- Good tests assert consumer-visible results through the same Interfaces callers use. Do not assert wiring, private call order, implementation structure, arbitrary defaults, or that a mock merely returned its configured response. Keep tests deterministic, isolated and full-suite-safe.
- Test month/date behavior in isolated processes with explicit timezones. Include UTC, Asia/Kolkata and America/Los_Angeles. Fixture records must be uniquely namespaced, tracked and cleaned up; never use operational Employee records.
- During implementation, run repository verification and the owned financial browser command. Inspect the actual desktop and mobile editor. Retain public-repository CI on standard free runners; block execution rather than introducing paid usage.
- This issue publishes a specification only. No runtime or application tests are claimed as executed for the specification itself.

## Out of Scope

- Changing the payroll formula, introducing direct hourly/daily pricing, mid-month hike splitting, or adding attendance-based pay adjustments.
- Backdated hikes into earlier months, retroactive salary corrections after use, automatic arrears, and a new financial-correction workflow.
- Editing or deleting used or superseded agreed values, automatic slip regeneration, or changing finalized/paid run permissions.
- Freezing every unclosed report against changes to hours or other non-salary inputs.
- Bulk salary writes, spreadsheet import, employee-master redesign, or a second employee directory.
- A replacement Component Rates or DA management system, or unrelated changes to their effective-rate policies.
- Inventing unsupported company-grid mappings, separate loan/advance slip columns, or unrelated export redesign.
- Automatically granting permissions, redesigning the admin shell, or introducing another UI or testing framework.
- Automatic reconstruction of unknown historical agreements, or destructive cleanup of ambiguous legacy data.
- Paid GitHub Actions features or changes to account billing controls.

## Further Notes

- The user approved the Salary Profiles workspace design and ADR-0036 on 2026-11-15. That decision changes ADR-0030's employee-embedded salary-editor placement while retaining employee/payroll access separation.
- Use the glossary terms Salary Profile, Salary Revision, Salary Correction, Salary Type, Employee Type, Component Rate, CTC, Basis Hours, Logged Hours and Payroll Slip consistently. A correction is not a hike.
- The approved design and glossary are already recorded locally. This issue must be self-contained; implementation must not depend on those uncommitted documents being available on the default branch.
- Existing gaps are observed current behavior, not desired contracts: silent same-date overwrites, hard deletion, overlapping agreements, inconsistent historical selection and active-profile joins that duplicate slips.
- Read the repository's installed Next.js documentation before implementation. Its APIs may differ from familiar versions.
- Completion requires the workspace, the one-editor cutover, persistence safeguards and every affected historical reader. Shipping the page while leaving unsafe write or read paths unchanged does not satisfy this specification.

- Published implementation issue: [#434](https://github.com/tzevk/accent/issues/434), labelled `ready-for-agent`.
