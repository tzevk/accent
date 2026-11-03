# Lead Audit and Performance — Time to first outreach (#403)

## Overview

**Time to first outreach** measures how long a Lead Intake Cohort waited for
its earliest evidenced Lead Outreach. It is an observed elapsed time, not a
service target and not client response time.

**Reads:**

- `GET /api/reports/lead-audit/timing` — the timing figure, coverage, and
  applied/ignored filter scope for the selected cohort.
- `GET /api/reports/lead-audit/timing/evidence` — one page of the cohort
  evidence behind a selected figure (`metric=all|sampled|no_outreach|
  missing_timestamp|incomplete_earlier|negative`).
- The composed report (`GET /api/reports/lead-audit`) carries the same
  section under `data.timing`.

Both routes require `reports:read` and `leads:read`, or the established
super-admin bypass. Anonymous requests receive `401`; a missing grant
receives `403`. No downstream Proposal or Project grant is involved.

## Definition

- **Cohort:** distinct non-deleted Leads whose `leads.created_at` falls
  inside the selected reporting period, under the applied owner, source,
  stage, priority, and search filters. This is the Lead Intake Cohort.
- **Start:** the Lead's system-entry timestamp, `leads.created_at`. The
  editable Enquiry Date is never the clock.
- **End:** the earliest **completed** Call, Email, or Meeting occurrence
  (`lead_activities.status = 'Completed'`, `occurred_at` known, activity not
  soft-deleted). Notes, scheduled work, and cancelled work are not outreach.
- **Interval:** `TIMESTAMPDIFF(SECOND, l.created_at, earliest.occurred_at)`.
  The database computes the elapsed time; the browser and Node time zones do
  not enter the calculation.
- **Observation:** outreach evidenced up to the report generation time. The
  cohort stays fixed to the intake period even when outreach happens later.

## Statistics

- **Valid sample count:** cohort Leads with a known, non-negative interval.
- **Median:** for an odd sample, the middle observed duration; for an even
  sample, the mean of the two middle observed durations.
- **90th percentile:** nearest-rank — the ordered observation at the
  rounded-up rank, `ceil(0.9 × n)`. A one-item sample is both its median and
  its 90th percentile.
- **Without evidenced outreach:** cohort Leads with no completed Call,
  Email, or Meeting. Their count and share of the cohort are shown beside
  the durations, so timing samples never hide unworked Leads.
- **Empty or unsampled cohorts:** `available = false`, `median_seconds` and
  `p90_seconds` are `null`, and the coverage explanation is returned. The
  metric is unavailable, never a zero duration.

## Exclusions

Each cohort Lead receives exactly one status. The precedence is fixed so a
Lead is never counted twice:

| Status               | Meaning                                                                                      | In durations |
| -------------------- | -------------------------------------------------------------------------------------------- | ------------ |
| `sampled`            | Known earliest outreach at or after system entry                                             | Yes          |
| `no_outreach`        | No completed Call, Email, or Meeting                                                         | No           |
| `missing_timestamp`  | Completed outreach exists, but no occurrence time is recorded                                | No           |
| `negative`           | Earliest evidenced outreach precedes system entry (usually imported prehistory)               | No           |
| `incomplete_earlier` | A known outreach time is accompanied by an unknown-occurrence outreach row that may be earlier | No         |

- Missing timestamps are never replaced by the recording, creation, or edit
  time.
- Negative intervals are returned as measured negative values in the
  evidence and excluded from the statistics. They are never clamped to zero.
- Incomplete earlier evidence is excluded rather than overstating the
  interval with the earliest _known_ row.
- Soft-deleted Leads and soft-deleted activities are excluded from the
  cohort and its outreach. Correcting an activity updates the current row,
  so corrected facts are used once and do not add another activity.
- The report discloses that pre-import history is unknowable; it does not
  claim complete client-response history. No service deadline,
  business-hours calendar, holiday rule, breach score, or employee ranking
  is introduced.

## Filter scope

The period, owner, source, stage, priority, and search filters define the
cohort and are retained by every evidence read and by the Excel detail.

`actor`, `activity_type`, `outcome`, `event_type`, and `undated` belong to the
Work and Audit evidence. They do **not** narrow this metric, because the
measure is each cohort Lead's earliest completed outreach across all three
outreach kinds. The response states them in `filter_scope.ignored` with a
reason instead of silently treating them as effective.

## Module shape

| File                                    | Responsibility                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `src/server/reports/lead-audit/timing.ts` | Cohort query, classification, median/nearest-rank percentile, section and evidence reads, complete detail for Excel |
| `src/server/reports/lead-audit/timing-types.ts` | Section, evidence, row, status, filter-scope, and population vocabulary |
| `src/app/api/reports/lead-audit/timing/route.ts` | Authenticated section read |
| `src/app/api/reports/lead-audit/timing/evidence/route.ts` | Authenticated, paginated evidence read |
| `src/app/reports/lead-audit/views/timing-view.tsx` | Summary, coverage, disclosures, and drill-down evidence table |

The readers accept `(db, filters, clock, …)` and never open their own
connection or transaction. `readLeadAuditTimingDetail` returns every cohort
row on the caller's connection for a complete workbook export, so exports do
not paginate through HTTP. Reads are SELECT-only and leave Leads, activities,
corrections, and stored source labels unchanged.

## Verification scenario

`scripts/leads-integration/scenarios/report-timing.ts`, exported as
`leadAuditTimingScenario`, proves the slice through authenticated HTTP against
the disposable MariaDB harness. Fixtures and their expected durations are
literal and independent of the report's aggregates. It covers:

- odd, even, one-item, and empty samples, including the even-sample average
  and nearest-rank 90th percentile;
- a cohort with Leads but no valid sample, reported unavailable with its
  coverage rather than as zero duration;
- contiguous March, April, May, June, July, September, and November cohorts;
- inclusive period boundaries and excluded adjacent days, including
  outreach that occurs after the intake period;
- notes, scheduled, cancelled, and deleted activities staying outside
  outreach, and a deleted Lead staying outside the cohort;
- unknown occurrence times, incomplete earlier evidence, imported prehistory
  with a negative interval, and a same-instant zero interval;
- a corrected activity contributing one interval and one activity row;
- duplicate outreach rows at the same occurrence time resolving to the
  earliest row deterministically;
- retained owner, stage, and exact-source filters across the evidence
  drill-down, full-result pagination totals, and deterministic ordering;
- disclosed ignored activity filters that leave the metric unchanged;
- `401`, `403`, super-admin bypass, and `422` named validation codes;
- the composed `data.timing` values matching the dedicated section read;
- unchanged fixture Leads, activities, and source labels after the reads.
