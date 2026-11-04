# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Sales and BD staff and managers, who qualify Leads, record work, and follow up in the daily pipeline.
- Management and auditors, who reconcile Lead demand, execution, handoffs, and coverage.
- Payroll and HR staff, who run monthly payroll, attendance, leave, and contract-staff records.
- Project and delivery staff, who track Proposals, Projects, timesheets, and tickets.
- Administrators, who manage users, permissions, rates, and configuration.

## Product Purpose

Accent is an internal CRM and HR platform. It records Leads and the work done on them, hands evidenced Leads to Proposals, carries work into Projects, and runs monthly payroll for payroll and contract staff in the same system. Success means staff do daily work in one place, and management can reconcile demand, execution, handoff evidence, and cost from the same records.

## Positioning

The same platform carries a Lead from intake through evidenced Proposal handoff into Projects, while running monthly payroll for payroll and contract staff.

## Operating Context

- Internal staff use Accent in a browser; MariaDB is the operational database.
- Lead work is recorded as activities with occurrence and recording times. Corrections update current facts, so a report can change between observations.
- Payroll runs monthly with component rates, payroll slips, attendance, leave, salary components, and DA. Payroll and contract staff are distinct from User Accounts.
- Reports, Excel workbooks, and printed summaries are evidence copies, not immutable issued records.

## Capabilities and Constraints

- Lead management: intake, owners, activities and corrections, legacy review, and Proposal handoff.
- Proposals, Projects, timesheets, tickets, and documents.
- Reports: Lead Audit and Performance, Attendance, Employee Utilization, Company Monthly Cost, Project Activities, Project Status, Manhours and Billing, Sales Register, Timesheet, Leave Overlaps, and Client Balance.
- Payroll: monthly runs, payroll slips, component rates and DA, and month-paid marking.
- RBAC: resource and permission grants per role and user, with the established super-admin bypass. No automatic grants.
- Canonical domain vocabulary lives in `GLOSSARY.md` and applies across UI, reports, and exports.
- Reports read through the shared database pool and the existing connection limits. No report-specific pool, event store, or parallel dataset.
- Not yet recorded as product decisions: a formal accessibility standard and a brand voice guide.

## Brand Commitments

Product name: Accent. No voice, tone, logo, or identity guide is established in the repository.

## Evidence on Hand

- Operational data in MariaDB: Leads, activities, corrections, Proposals, Projects, payroll, attendance, and leave.
- No marketing testimonials, customer logos, product pricing, benchmarks, or press assets exist in the repository. Future work must not fabricate them.

## Product Principles

1. One record chain: Lead → evidenced Proposal handoff → Project, with payroll in the same system.
2. Permissions are explicit and server-authoritative; no automatic grants.
3. Domain terms stay canonical across UI, reports, and exports.
4. Reports read the operational database, not a report-specific copy.
