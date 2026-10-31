# Documentation

Start with the guide for the task. Use decision records to understand the rules behind it.
Audit findings and plans describe a recorded state, not proof of current behavior.

## Application guides

| Task                                              | Guide                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Operate payroll and check employee entry points   | [Payroll operator guide](app/payroll/operator-guide.md)                                         |
| Work Leads, ownership, and the legacy review flow | [Lead operator guide](app/leads/operator-guide.md)                                              |
| Understand project view and edit screens          | [Project view/edit conformity](app/projects/view-edit-conformity.md)                            |
| Understand project manhours                       | [Project Manhours tab](app/projects/tabs/ProjectManhoursTab.md)                                 |
| Understand the Timesheet report                   | [Timesheet implementation](app/reports/timesheet-implementation.md)                             |
| Understand Manhours Billing                       | [Manhours Billing implementation](app/reports/manhours-billing-implementation.md)               |
| Understand Client Balance                         | [Client Balance implementation](app/reports/client-balance-implementation.md)                   |
| Understand project expenditure accounting         | [Project expenditure accounting (research note)](app/reports/project-expenditure-accounting.md) |

## Cash vouchers

- Create vouchers at `/admin/cash-voucher/new`.
- Edit vouchers at `/admin/cash-voucher/edit/[id]`.
- Voucher number is editable on new. It is read-only on edit.
- Set voucher date, paid-to, and project number.
- Each line has bill date, bill number, and account head.
- Each line has a rupees input. It allows decimals.
- Each line has a paise input. It takes whole numbers 0-99.
- Each line has a description from the list.
- Choose cash or cheque. Total and words fill in by themselves.
- Sign-off has prepared, checked, approved, and receiver fields.
- Print opens the voucher in a new tab. It starts printing.
- Use Print or Save as PDF in the print window.
- The sheet is A4. CSS margins are 12mm, 10mm, and 14mm.
- Long vouchers run across pages. Table headers repeat.
- Each printed line shows one amount. It merges rupees and paise.
- The sheet keeps the total, words, and four signatures.
- The sheet uses the real Accent logo.
- Layout ideas follow Stripe invoice branding: https://docs.stripe.com/invoicing/customize.

## System explanations

- [Daily activity entries](explanations/activity-daily-entries.md)
- [Activity normalization](explanations/ACTIVITY_NORMALIZATION.md)
- [SmartOffice attendance pipeline](explanations/SMARTOFFICE_ATTENDANCE_PIPELINE.md)
- [Role-based access control (RBAC)](explanations/RBAC_PERMISSIONS_SYSTEM.md)
- [Ticket system](explanations/TICKET_SYSTEM.md)
- [Super-admin setup](explanations/SUPER_ADMIN_SETUP.md)
- [Live monitoring open-source research](explanations/LIVE_MONITORING_OPEN_SOURCE_RESEARCH.md)

## Decisions and terminology

[The glossary](../GLOSSARY.md) defines domain terms.
Architecture decision records (ADRs) explain accepted choices and their tradeoffs.
Read the relevant record before changing its behavior.

| Area                 | Decision records                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Payroll              | [Salary profiles](adr/0001-payroll-salary-profile-canonical.md), [run locking and routes](adr/0008-payroll-run-lock-and-route-tree.md), [slip snapshots](adr/0009-payroll-slip-figures-are-the-snapshot.md), [logged-hours pay basis](adr/0010-hours-logged-pay-basis.md)                                                                                                                                                                                                                                                |
| Attendance and leave | [Leave overlaps](adr/0002-leave-overlaps-client-computed-report.md), [weekly off](adr/0004-unified-weekly-off-rule.md), [sandwich leave](adr/0005-sandwich-leave-warn-then-deduct.md), [payable overtime](adr/0006-payable-ot-gate-coexists-with-timesheet.md), [device punches](adr/0007-device-punches-override-stored-times.md), [two Punch Span implementations](adr/0015-two-punch-span-implementations.md), [presence silence from activity evidence](adr/0033-presence-silence-counted-from-activity-evidence.md) |
| Reporting            | [Employee Utilization](adr/0003-employee-utilization-formula-and-source.md), [Project Employee Cost](adr/0016-project-employee-cost-from-recorded-payroll.md), [Incurred cost and commitments](adr/0017-project-incurred-cost-and-commitments-are-separate.md)                                                                                                                                                                                                                                                           |
| Security             | [Session validation](adr/0011-session-validation-in-proxy-and-handlers.md), [rich-text trust boundary](adr/0012-rich-text-trust-boundary.md), [rate limits](adr/0013-rate-limit-identity-and-store.md), [public endpoint allowlist](adr/0014-unauthenticated-endpoint-allowlist.md)                                                                                                                                                                                                                                      |
| Leads                | [Legacy Lead review and the canonical Proposal](adr/0031-legacy-lead-review-and-canonical-proposal.md), [the Lead activity log and the conversion handoff](adr/0032-lead-activity-log-and-conversion-handoff.md)                                                                                                                                                                                                                                                                                                         |

## Audit records and change history

These records preserve findings at the time of review. Check their dates and status notes.
Verify a finding against current code before treating it as open or resolved.

- [Security audit](SECURITY_AUDIT.md)
- [Poor-practices audit](todo/POOR_PRACTICES_AUDIT.md)
- [DDL and soft-delete audit](explanations/DDL_AND_SOFT_DELETE_AUDIT.md)
- [Responsive audit](explanations/RESPONSIVE_AUDIT.md)
- [Changes summary](explanations/CHANGES_SUMMARY.md)
- [E2E harness removal](explanations/E2E_HARNESS_REMOVAL.md)

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
- [Monthly company and project expenditure design](app/reports/project-expenditure-design.md)
- [Monthly company and project expenditure specification](app/reports/project-expenditure-spec.md) — [implementation issue #304](https://github.com/tzevk/accent/issues/304)

## Contributor workflows

- [Coding standards](../CODING_STANDARDS.md) — task-triggered implementation, security, data, and testing rules.
- [Local database operations](agents/local-database.md) — local MariaDB and disposable leads integration setup.
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
