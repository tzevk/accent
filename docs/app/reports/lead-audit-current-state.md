# Lead Audit and Performance — Current state (#401)

## Overview

The current-state section reports present Lead ownership and the five
existing operational queues: **Unassigned**, **Untouched**, **Overdue**,
**Due today**, and **No Next Action**. It is the section behind the Overview
“current operational risks” group and the Work and accountability
“current-owner workload” group.

These figures are live state at generation time. They are not the selected
period's backlog, they never reconstruct a historical queue, and a historical
range selection does not change them.

**Summary API:** `GET /api/reports/lead-audit/current-state`
**Evidence API:** `GET /api/reports/lead-audit/current-state/evidence`
**Section reader:** `readLeadAuditCurrentStateSection(db, filters, clock, options?)`
**Evidence reader:** `readLeadAuditCurrentStateEvidence(db, filters, clock, selection, pagination, options?)`

## Queue definitions and date basis

The counters and queue conditions reuse `src/server/leads/queues.ts`; the
report does not create a second queue vocabulary.

| Risk group    | Population                                                                                                                       | Counter unit   | Evidence unit                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------- |
| Unassigned    | Non-deleted Leads with `owner_user_id IS NULL`                                                                                    | distinct Leads | Lead                              |
| Untouched     | Non-deleted Leads with no completed Call, Email, or Meeting; a completed Note alone does not count as outreach                     | distinct Leads | Lead                              |
| Overdue       | Non-deleted Leads with outstanding scheduled work dated before the database calendar day                                          | distinct Leads | individual scheduled work item    |
| Due today     | Non-deleted Leads with outstanding scheduled work dated on the database calendar day                                               | distinct Leads | individual scheduled work item    |
| No Next Action | Non-deleted Leads in Attempting Contact, Connected, Qualified, or Nurture with no outstanding scheduled work                      | distinct Leads | Lead                              |

Outstanding scheduled work follows the existing queue rule: a row with
`status = 'Scheduled'`, no `transferred_followup_id`, a scheduled date, and no
soft-delete flag. Completed, cancelled, and Proposal-transferred work is not
outstanding. New, Disqualified, and Converted Leads do not require a next
action.

The calendar day is the database's: `CURDATE()` resolves due-today and overdue
boundaries, exactly as the Lead workspace queues and the rest of the report
do. Neither the browser nor the Node process supplies the observation day.
The response discloses the generated time, the database day, and the actual
reporting time zone.

## Counter units

Every current-state counter counts **distinct Leads**, including the Overdue
and Due today counters. Their evidence registers identify **individual
scheduled work items**, so one Lead with two overdue plans contributes one to
the counter and two rows to the register. Each evidence response therefore
returns both:

- `pagination.total` — rows in the full result (work items for the scheduled
  registers, Leads otherwise);
- `distinct_leads_total` — the full-result distinct-Lead count that
  reconciles with the queue counter, independent of the visible page.

## Current-owner workload

Workload groups non-deleted Leads by `leads.owner_user_id` under the applied
current-state filters. Each row is one distinct Lead.

- The current owner is the present `owner_user_id`, never the activity author.
  An activity recorded by another permitted user does not add that user to the
  workload.
- `NULL` owner appears as **Unassigned**.
- Inactive accounts retain their reference and display name, marked
  **Inactive**. A missing or soft-deleted user reference is preserved as an
  unknown user id, never dropped or reassigned.
- Soft-deleted Leads and their work are outside the workload and every risk
  group.
- Reassigning a Lead moves it between groups on the next observation. It does
  not change historical activity authorship.

## Filters

Current-state filters are parsed once by the shared report parser:

- **Effective:** current owner (`owner`, including `unassigned`), exact stored
  source (`source` or `source_missing=1`), current stage (`stage`, including
  `unresolved`), priority, and search.
- **Ignored:** the selected period (`preset`, `from_date`, `to_date`) is
  always listed with its resolved dates and a reason. Actor, activity type,
  outcome, and event type are listed as ignored when supplied; an activity
  author is never treated as historical ownership.
- Invalid dates, ranges, presets, owners, sources, stages, and priorities
  still return the shared `422` validation response.
- Evidence requests additionally accept `group=workload|risk`, `risk` for a
  risk group, and `page`/`limit` (1–100, default 25). Unknown groups and risks
  return `422` with `invalid_current_state_group` or
  `invalid_current_state_risk`.

## Evidence shapes

A Lead row carries the Lead identity, contact, stored source, priority,
current stage, current owner, Enquiry Date, and recorded time. A scheduled-work
row carries the same Lead facts plus the activity id, activity type, scheduled
date, and next-action text. Notes are not selected by these registers.

Ordering is deterministic:

- Lead registers: `created_at DESC, id DESC`.
- Scheduled-work registers: `scheduled_for ASC, id ASC` (oldest overdue work
  first; stable ties by id).

Selecting a workload owner row opens workload evidence with `owner` set to
that id or `unassigned`, retaining every other applied filter. Selecting a risk
opens `group=risk&risk=<key>` with the same filters.

## Authorization

Both current-state routes call `getCurrentUser` and then `canReadLeadAudit`:
the existing `reports:read` **and** `leads:read` conjunction, or the existing
super-admin bypass. There are no new grants, no ownership-based restrictions,
and no test-only routes. Anonymous requests return `401`; missing either grant
returns `403`.

## Read-only behavior

Every read uses the passed shared-pool connection and the passed clock. The
report opens no section-local connection or transaction, and reads leave
Leads, ownership, activities, and history unchanged.

## Files

- `src/server/reports/lead-audit/current-state.ts` — readers, selection
  parsing, and ignored/effective filter construction.
- `src/server/reports/lead-audit/current-state-types.ts` — section,
  evidence, owner, workload, and risk types plus the canonical risk
  definitions.
- `src/app/api/reports/lead-audit/current-state/route.ts` — summary API.
- `src/app/api/reports/lead-audit/current-state/evidence/route.ts` —
  paginated evidence API.
- `src/app/reports/lead-audit/views/current-state-view.tsx` — reusable
  Overview and Work section component.
- `scripts/leads-integration/scenarios/report-current-state.ts` — the
  authenticated HTTP regression scenario (registered by the parent as
  `lead-audit-current-state`).

## Presentation

The component shows the observation time, time zone, database date basis, the
effective current-state filter chips, and every ignored filter with its
reason. Risk cards are stamped **As of** the observation day and state their
counter and evidence units. The workload table marks Unassigned, Inactive, and
Unknown user references. Evidence buttons are rendered only when the page
supplies an `onSelectGroup` callback; the component keeps no private applied
filter state, so screen, Excel, and print share the page's query.
