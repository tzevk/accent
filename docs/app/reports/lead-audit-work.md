# Lead Audit and Performance — Work and accountability implementation (#400)

## Overview

The **Work and accountability** view answers what work happened during the
selected period and who recorded it. It is built from one population of
recorded Lead Activity evidence, so completed work, Lead Outreach, successful
contact, and the author breakdown cannot disagree with each other.

This slice does not report current-owner workload or operational queues
(#401), cohort conversion or timing (#402/#403), audit events (#404), or the
Excel workbook (#405). The parent report response composes this section under
`data.work`.

**Module:** `src/server/reports/lead-audit/work.ts`
**Types:** `src/server/reports/lead-audit/work-types.ts`
**Shared evidence filters:** `src/server/reports/lead-audit/evidence-filters.ts`
**API:** `GET /api/reports/lead-audit/work/evidence`
**UI:** `src/app/reports/lead-audit/views/work-view.tsx`,
`src/app/reports/lead-audit/work/work-summary.tsx`,
`src/app/reports/lead-audit/work/work-evidence.tsx`

## Population and date basis

Period work is one row of `lead_activities` that is:

- `status = 'Completed'` **and** `source_activity_id IS NULL` — a transferred
  copy is the same work, never another completed activity;
- not soft-deleted (`isDelete = 0`), on a non-deleted Lead;
- dated by a known `occurred_at` inside the selected calendar days.

The period uses the same database calendar as intake: both selected dates are
inclusive and the query ends at the next day `00:00:00`. **Occurrence time is
never replaced** by `recorded_at`, `created_at`, `completed_at`, or
`scheduled_for`. A completed activity without `occurred_at` is undated
evidence: it is excluded from every dated figure and counted in coverage and
in the `undated` evidence metric.

Work on a Lead recorded before the period stays in the period when the work
occurred in it. Work on a Lead recorded in the period still has to occur in
the period to count.

## Metric definitions

| Figure | Definition | Not included |
| --- | --- | --- |
| Completed work | Completed activities with a known occurrence in the period | Scheduled, cancelled, transferred copies, soft-deleted rows |
| Completed calls | Completed `Call` rows | Scheduled or cancelled calls |
| Completed emails | Completed `Email` rows, replied or not | Unconfirmed emails are still completed emails |
| Completed meetings | Completed `Meeting` rows | Meetings never establish successful contact alone |
| Completed notes | Completed `Note` rows | Notes are not outreach |
| Unknown activity type | Completed rows whose stored type is missing or non-canonical | They are never guessed into a type |
| Lead Outreach | Completed `Call` + `Email` + `Meeting` activities | Notes, scheduled next actions |
| Distinct Leads with outreach | `COUNT(DISTINCT lead_id)` over outreach activities | Repeated attempts never inflate this count |
| Successful contact | Completed `Call` with `call_outcome = 'Connected'` plus completed `Email` with `reply_confirmed = 1` | `No Answer`, `Busy`, `Voicemail`, `Wrong Number`, unconfirmed or unevidenced emails, meetings |
| Failed calls | Completed calls with a canonical non-connected outcome | Calls with no usable outcome are *outcome unknown*, not failed |
| Unconfirmed sent emails | Completed emails with `reply_confirmed` null or `0` | They are completed work and outreach, not contact |
| Corrected activities | Completed rows whose `version > 1` | A correction is not another completed activity |

Reconciliation guarantees the figures follow from the population:

- `calls + emails + meetings + notes + unknown = completed_total`;
- `connected calls + failed calls + outcome-unknown calls = calls`;
- `confirmed replies + unconfirmed emails = emails`;
- `successful_contact = connected calls + confirmed replies`;
- each author group's totals sum to `completed_total`.

## Authorship

Activities are grouped by the recorded author (`lead_activities.created_by`),
never by the Lead's current owner:

- `created_by IS NULL` is **Unknown author**;
- a stored reference whose user record is missing is shown as
  `Unknown user #id`, preserving the reference;
- an inactive account keeps its name and is marked **Inactive**;
- the activity evidence shows the current owner as present-state context
  only. Reassigning a Lead changes no author figure.

A recorded author is not proof that the person performed the work on someone
else's behalf. The report adds no ranking, composite score, target, or
sales-win inference.

## Filters and visible scope

The Lead-level filters are shared with intake and narrow the Lead rows behind
the work: period, current owner, stored source, missing source, current stage,
priority, and search. These are current-state filters, not historical
assignments or stages.

The evidence filters are parsed once by `evidence-filters.ts` and apply to
work and audit evidence only:

- `actor` — a user id or `unknown` (which also accepts `all`);
- `activity_type` — `Call`, `Email`, `Meeting`, `Note`, or `unknown`;
- `outcome` — `Connected`, `No Answer`, `Busy`, `Voicemail`,
  `Wrong Number`, `email_replied`, `email_sent`, or `unknown`;
- `event_type` — the supported audit evidence events, or `unknown`.

Work honours `actor`, `activity_type`, and `outcome`. An outcome filter
applies to Call and Email rows only: a Meeting, a Note, and an unknown type
carry no outcome and are outside an outcome-filtered population. `event_type`
names audit evidence events, not activity rows, so the Work section accepts it
and **reports it as ignored** in `work_filters.applied` with a reason. The
shared `undated=1` toggle selects the audit evidence population; Work accepts
it, lists it as ignored, and keeps undated work in its own metric so it never
enters a dated figure.

Work filters never change unrelated intake figures: the intake section reads
the Lead population alone and its scope never carries an evidence filter.

Invalid actor, activity type, outcome, event type, or evidence metric values
are refused with `422` and a named `code` (`invalid_actor`,
`invalid_activity_type`, `invalid_outcome`, `invalid_event_type`,
`invalid_work_metric`), never read as an empty population.

## API contract

`readLeadAuditWorkSection(db, filters, clock, evidence)` returns the section
for one observation on the caller's shared connection. The default evidence
argument is all-record scope. The response uses snake_case:

```
scope, meta, work_date_basis,
summary { completed_total, by_type { call, email, meeting, note, unknown },
          outreach_total, distinct_leads_worked,
          distinct_leads_with_outreach, successful_contact,
          distinct_leads_with_successful_contact, calls_connected,
          calls_failed, calls_outcome_unknown, emails_confirmed_reply,
          emails_unconfirmed, corrected_activities }
coverage { unknown_occurrence_date, unknown_activity_type, unknown_author,
           inactive_author, missing_call_outcome,
           unrecognized_call_outcome, missing_email_reply_evidence,
           cancelled_in_period, deleted_activity_rows }
authors [ { author { id, name, is_unknown, is_inactive },
            completed_total, by_type, outreach_total,
            successful_contact, distinct_leads } ]
work_filters { effective, applied [ { key, label, value, display, state, reason } ],
               lead_filters }
filter_options { actors [ { id, name, is_active } ], activity_types, outcomes,
                 event_types }
disclosures
```

`GET /api/reports/lead-audit/work/evidence` returns one page of the evidence
behind one figure. Parameters: every applied Lead filter, `actor`,
`activity_type`, `outcome`, `event_type`, `metric`, `page`, and `limit`
(1–100). Metrics: `completed`, `outreach`, `successful_contact`, `call`,
`email`, `meeting`, `note`, `unknown_type`, `undated`, and `cancelled`.
Ordering is `occurred_at DESC, id DESC` (`recorded_at DESC` for `undated`).
`pagination.total` and `total_pages` cover the full filtered result, and the
applied filters are returned with every page.

Access requires `getCurrentUser` plus `canReadLeadAudit` — `reports:read` and
`leads:read`, or the super-admin bypass. Anonymous requests are `401`; a
reports-only, leads-only, or unrelated Project Activities report grant is
`403`. The evidence route applies the same gate as the report response.

For the workbook export, `readLeadAuditWorkEvidenceRows(db, filters, evidence,
metric)` returns **every** row on the same passed connection with no
pagination, so an export covers the complete applied result rather than the
visible page.

## Coverage and disclosed exclusions

Each figure below counts records inside the applied scope; zero is measured,
not missing:

- completed activities with no occurrence time (outside every dated total);
- completed activities with unknown stored types;
- completed activities with no recorded author, and those recorded by a
  now-inactive account;
- completed calls with no outcome and with an unrecognized outcome value;
- completed emails with no reply evidence at all;
- cancelled activities with a known occurrence in the period;
- soft-deleted activity rows in the period, excluded from operational totals.

Activities on soft-deleted Leads are excluded as well; retained deleted-record
evidence belongs to the audit evidence section. A cancelled row is evidence of
a change of plan and never becomes completed work. A scheduled row is current
planned work (owned by the current-state section) and is never counted here.

The section disclosures restate the date basis, the completed and outreach
definitions, the successful-contact rule, authorship limits, unknown facts,
undated exclusions, inactive authors, deleted rows, correction behaviour, and
the live-data warning.

## Presentation

- Summary groups stack before detail tables; tables sit in labelled horizontal
  scroll regions with a minimum width, so 320-pixel viewports and 200 percent
  zoom do not clip controls or Lead identities.
- Completed, outreach, and successful contact are labelled separately; figures
  are text, not colour-only decoration.
- Every figure opens the matching evidence metric; applied filters and pages
  are retained. Loading, empty, error, and background-refresh states are
  distinct, and a failed request never renders as a successful empty report.
- The Overview component (`WorkSummary`) shows completed work, outreach,
  successful contact, and unknown/undated counts, and opens the view with the
  selected metric.

## Verification

The authenticated HTTP scenario is
`scripts/leads-integration/scenarios/report-work.ts`, run by the parent as
`lead-audit-work` against the existing disposable MariaDB harness. It seeds
its own Leads and activity rows with explicit dates and asserts independent
literals for:

- completed work on a Lead recorded before the period, without inflating
  period intake;
- inclusive start and end occurrence boundaries and the exclusive next-day
  bound for work recorded inside another month;
- calls, emails, meetings, and notes reported separately, with unknown legacy
  types kept unknown;
- scheduled and cancelled work excluded, and soft-deleted activity rows and
  Leads excluded;
- outreach excluding notes and repeated attempts not inflating distinct Leads;
- successful contact from connected calls and confirmed replies only, with
  failed calls and unconfirmed emails disclosed and not counted;
- actor, activity type, outcome, and event-type filters, including the
  ignored-scope disclosure for `event_type` and unchanged intake figures;
- Unknown author, a missing user reference, and an inactive recorded author
  preserved instead of credited to the current owner;
- a real authenticated activity correction that changes current facts without
  adding a completed activity;
- a real ownership reassignment that reattributes no authorship;
- paginated evidence retaining filters, reconciling with the figures, and
  leaving every source row unchanged;
- `401` anonymous, `403` reports-only / unrelated-grant, `422` invalid filter
  values, and the super-admin bypass.

The parent runs the actual runtime, browser smoke checks, and the repository
gates; this document records the contract, not a verification result.
