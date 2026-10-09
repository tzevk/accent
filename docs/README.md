# Documentation

Start with the guide for the task. Use decision records to understand the rules behind it.
Audit findings and plans describe a recorded state, not proof of current behavior.

## Application guides

| Task                                            | Guide                                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Operate payroll and check employee entry points | [Payroll operator guide](app/payroll/operator-guide.md)                                         |
| Understand project view and edit screens        | [Project view/edit conformity](app/projects/view-edit-conformity.md)                            |
| Understand project manhours                     | [Project Manhours tab](app/projects/tabs/ProjectManhoursTab.md)                                 |
| Understand the Timesheet report                 | [Timesheet implementation](app/reports/timesheet-implementation.md)                             |
| Understand Manhours Billing                     | [Manhours Billing implementation](app/reports/manhours-billing-implementation.md)               |
| Understand Client Balance                       | [Client Balance implementation](app/reports/client-balance-implementation.md)                   |
| Understand project expenditure accounting       | [Project expenditure accounting (research note)](app/reports/project-expenditure-accounting.md) |

## System explanations

- [Daily activity entries](explanations/activity-daily-entries.md)
- [Activity normalization](explanations/ACTIVITY_NORMALIZATION.md)
- [SmartOffice attendance pipeline](explanations/SMARTOFFICE_ATTENDANCE_PIPELINE.md)
- [Role-based access control (RBAC)](explanations/RBAC_PERMISSIONS_SYSTEM.md)
- [Ticket system](explanations/TICKET_SYSTEM.md)
- [Super-admin setup](explanations/SUPER_ADMIN_SETUP.md)

## Decisions and terminology

[The glossary](../GLOSSARY.md) defines domain terms.
Architecture decision records (ADRs) explain accepted choices and their tradeoffs.
Read the relevant record before changing its behavior.

| Area                 | Decision records                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payroll              | [Salary profiles](adr/0001-payroll-salary-profile-canonical.md), [run locking and routes](adr/0008-payroll-run-lock-and-route-tree.md), [slip snapshots](adr/0009-payroll-slip-figures-are-the-snapshot.md), [logged-hours pay basis](adr/0010-hours-logged-pay-basis.md)                                                                                                                                        |
| Attendance and leave | [Leave overlaps](adr/0002-leave-overlaps-client-computed-report.md), [weekly off](adr/0004-unified-weekly-off-rule.md), [sandwich leave](adr/0005-sandwich-leave-warn-then-deduct.md), [payable overtime](adr/0006-payable-ot-gate-coexists-with-timesheet.md), [device punches](adr/0007-device-punches-override-stored-times.md), [two Punch Span implementations](adr/0015-two-punch-span-implementations.md) |
| Reporting            | [Employee Utilization](adr/0003-employee-utilization-formula-and-source.md), [Project Employee Cost](adr/0016-project-employee-cost-from-recorded-payroll.md), [Incurred cost and commitments](adr/0017-project-incurred-cost-and-commitments-are-separate.md)                                                                                                                                                   |
| Security             | [Session validation](adr/0011-session-validation-in-proxy-and-handlers.md), [rich-text trust boundary](adr/0012-rich-text-trust-boundary.md), [rate limits](adr/0013-rate-limit-identity-and-store.md), [public endpoint allowlist](adr/0014-unauthenticated-endpoint-allowlist.md)                                                                                                                              |

## Audit records and change history

These records preserve findings at the time of review. Check their dates and status notes.
Verify a finding against current code before treating it as open or resolved.

- [Security audit](SECURITY_AUDIT.md)
- [Poor-practices audit](todo/POOR_PRACTICES_AUDIT.md)
- [DDL and soft-delete audit](explanations/DDL_AND_SOFT_DELETE_AUDIT.md)
- [Responsive audit](explanations/RESPONSIVE_AUDIT.md)
- [Changes summary](explanations/CHANGES_SUMMARY.md)

## Plans and follow-ups

These documents record proposals and follow-up work. A listed item does not prove implementation.
Use the [issue tracker workflow](agents/issue-tracker.md) to check current task status.

- [Security remediation plan](todo/SECURITY_REMEDIATION_PLAN.md)
- [Engineering challenges](todo/ENGINEERING_CHALLENGES.md)
- [App health roadmap](todo/APP_HEALTH_ROADMAP.md)
- [Attendance next steps](todo/ATTENDANCE_NEXT_STEPS.md)
- [Next.js 16 upgrade follow-ups](todo/NEXT16_UPGRADE_FOLLOWUPS.md)
- [Live monitoring presence](todo/LIVE_MONITORING_PRESENCE.md)
- [Resource page decoupling](todo/RESOURCE_PAGE_DECOUPLING.md)
- [E2E dev-loop research](todo/E2E_DEV_LOOP_RESEARCH.md)
- [Monthly company and project expenditure design](app/reports/project-expenditure-design.md)
- [Monthly company and project expenditure specification](app/reports/project-expenditure-spec.md) — [implementation issue #304](https://github.com/tzevk/accent/issues/304)

## Contributor workflows

- [Domain documentation](agents/domain.md)
- [GitHub issue tracker](agents/issue-tracker.md)
- [Triage labels](agents/triage-labels.md)

## Reference assets

`extras/` holds supporting spreadsheets, images, and attendance data.
Treat these files as reference material, not current application rules.
Local `notes.md` files are gitignored scratch records; published guides do not depend on them.

## Maintenance

- Keep each operational rule in one guide. Link to it from other documents.
- Verify routes, source paths, and commands against the repository before changing claims.
- Keep audit evidence and decision history distinct from current operating instructions.
- Record temporary feature visibility in the affected guide, with a date and change reference.
- Update this index when a published guide is added or moved.
