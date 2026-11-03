# Lead Audit — Audit evidence and Data coverage (#404)

## Purpose

These two views answer the evidence questions behind the Lead report:

- **Audit evidence** shows the activities, stage and lifecycle decisions,
  owner changes, activity corrections, legacy reviews, and conversions the
  system actually stores. It identifies each row by evidence type, Lead,
  source reference, known actor, occurrence time where supported, and
  recording time.
- **Data coverage** states what the stored evidence cannot establish:
  unknown current facts, missing authors, outcomes, occurrence times and
  histories, unresolved links, retained deleted evidence, and the metric
  exclusions those gaps create.

Both views read the same report database connection and observation clock as
the rest of the report. They never write.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/reports/lead-audit/audit` | One page of audit evidence, full-result totals, the first page of retained deleted evidence, and evidence filter options. |
| `GET /api/reports/lead-audit/audit/deleted` | Separately paginated retained deleted-record evidence. |
| `GET /api/reports/lead-audit/audit/narrative?type=<type>&id=<id>` | On-demand narrative evidence for one row. |
| `GET /api/reports/lead-audit/coverage` | Data coverage, exclusions, and history limits. |

Access requires `reports:read` and `leads:read`, or the established
super-admin bypass. An unrelated Project Activities report field grant is
insufficient. Proposal details additionally require `proposals:read`; Project
details require `projects:read`. A denied downstream grant returns a
`restricted` state with no Proposal title, status, progress, or Project
fields. A Project is only read through a readable Proposal.

## Recording time is the audit date basis

The selected period filters audit evidence by the moment it was recorded:

| Evidence | Recording time | Occurrence time |
| --- | --- | --- |
| Activity | `COALESCE(recorded_at, created_at)` | `occurred_at` (may be unknown) |
| Stage or lifecycle decision | `COALESCE(recorded_at, created_at)` | Same recorded decision moment |
| Owner change | `created_at` | Same recorded change moment |
| Activity correction | `corrected_at` | Same correction moment |
| Legacy review | `resolved_at` | Same review moment |
| Conversion | `COALESCE(created_at, converted_at)` | `converted_at` |

Occurrence time is shown beside recording time and never selects the audit
row. A late-recorded activity whose occurrence falls inside the period is
absent from that period's audit list and present in its occurrence period's
work metrics; the audit list for the later recording period shows the same
occurrence date. This is why audit changes and period work are separate
populations.

Activity evidence with no occurrence time remains inspectable through
`undated=1` and is marked `occurrence_known: false`. It never enters
occurrence-dated work totals.

## Ordering and pagination

The six evidence tables are normalized into one union and ordered by:

1. recording time descending;
2. evidence type ascending;
3. evidence id ascending.

The order is deterministic across pages, including ties between different
evidence types. `pagination.total` and `total_pages` describe the full
filtered result, not the visible page.

## Evidence filters

The shared evidence parser (`evidence-filters.ts`, owned by the Work
section) accepts:

- `actor=<user id>|unknown|all`
- `activity_type=Call|Email|Meeting|Note|unknown|all`
- `outcome=Connected|No Answer|Busy|Voicemail|Wrong Number|email_replied|email_sent|unknown|all`
- `event_type=activity|stage_change|owner_change|correction|legacy_review|conversion|all`
- `undated=1|true`

`email_replied` means `Email` with `reply_confirmed = 1`. `email_sent` means
`Email` with an unconfirmed reply (`NULL` or `0`). `unknown` outcome means a
`Call` with no canonical stored outcome. An activity type or outcome filter
applies to activity evidence only; when either is set, other evidence types
are excluded and the response says so in `evidence_filters.ignored`. A
non-activity `event_type` combined with an activity/outcome filter returns
`422 incompatible_filters`.

`event_type=deleted_record` and `event_type=unknown` are refused by the
audit list (`422 invalid_event_type`): retained deleted records have their
own population and route, and there is no unknown evidence type. Unknown
actors, activity types, and outcomes are literal choices, never wildcards.

The Lead population filters (current owner, source, current stage, priority,
search) apply to the current stored Lead row. They are not historical
assignments or stages; the audit response labels that limitation in
`evidence_filters.ignored`.

## Actor facts

The recorded actor is the activity author, stage/ownership actor, correction
actor, legacy reviewer, or conversion actor. An absent reference remains
`Unknown actor` (`actor.is_unknown = true`). The current Lead owner and the
latest editor are never substituted. A legacy reviewer snapshot name may be
shown without a user id; it is the recorded evidence, not an inferred
account. Automatic legacy cutover decisions have no reviewer and stay
explicitly unknown.

## Correction evidence

A correction is its own audit row and never a second completed activity. The
list carries the names of the changed fields only. The narrative route
returns the correction reason, the correcting actor, the correction time, and
explicit before/after values for each changed field. Free text is never
returned as raw nested JSON.

Corrections update current activity facts, so a corrected metric can change
between two observations. The report is live and correction-sensitive; it is
not an immutable issued version.

## Retained deleted evidence

Soft-deleted Leads and deleted activity rows are a separate labelled
population, readable inside the report without an operational detail page.
They never enter operational intake, work, cohort, risk, or owner totals.

Deletion flags record neither an actor nor a time. The deleted evidence
response always states:

- `deletion.known = false`
- `deletion.actor = null`
- `deletion.at = null`

No deletion fact is derived from `updated_at`; the readers do not select it
for deleted evidence. The selected period does not apply to the deleted
population because deletion time is unknown. Current Lead filters, search,
actor, evidence type, activity type, outcome, and undated still apply.

## Narration and exports

Narrative is read on demand and rendered as plain text. It is never
interpreted as HTML.

Exports use `evidence-privacy.ts`, shared by this section and the workbook
export:

- `projectEvidenceForExport` returns an explicit whitelist of structured
  fields and never spreads the source row.
- `projectDeletedEvidenceForExport` adds the explicit unknown deletion facts.
- `projectAuditNarrativeForExport` returns explicit narrative fields and
  correction before/after strings, and returns empty arrays when narrative is
  not requested.
- `parseIncludeDetailedEvidence` reads `include_narrative=1|true` (or
  `include_detailed_evidence`).

The default export carries no notes, reasons, or original/corrected free
text, including text nested inside correction values. Detailed export is an
explicit choice after the same source permission checks. Use
`readLeadAuditEvidenceDetail` and `readLeadAuditDeletedEvidenceDetail` on the
report connection to export the complete filtered result, not just the
visible page.

## Coverage and declared exclusions

Data coverage counts:

- active Leads with no resolved stage;
- stored legacy stage labels awaiting review;
- missing Enquiry Dates, missing source labels, and unowned Leads;
- unresolved legacy owner names and canonical Proposal conflicts;
- Converted Leads without an authoritative conversion date or conversion
  evidence;
- evidence recorded in the period, by type;
- undated activity evidence, unknown activity authors, unknown activity
  types, unknown call outcomes, and unreplied email flags;
- automatic legacy reviews with no human reviewer;
- retained deleted Leads and activity rows.

Declared exclusions state the count kept out of each metric:

- period work excludes activities with no occurrence time;
- successful contact excludes calls with no outcome and emails without a
  confirmed reply;
- dated handoffs exclude Converted Leads with no authoritative conversion
  date;
- cohort conversion excludes unresolved canonical links from being counted
  as confirmed handoffs or failures;
- operational totals exclude retained deleted records;
- occurrence-dated evidence totals exclude undated evidence.

The history limits state the missing generic enquiry edits, task
rescheduling, incomplete stage history, unknown authors/outcomes/occurrence
times, live corrections, unknown deletion facts, and the fact that this is
not a compliance-grade change log. Work, timing, and conversion sections add
their own coverage to the combined report.

## Verification

The authenticated HTTP scenario is `scripts/leads-integration/scenarios/report-audit.ts`,
exported as `reportAuditScenario` and intended for registration as
`lead-audit-audit`. It uses the disposable MariaDB harness and real logins,
seeds explicit evidence times and permission combinations, and asserts:

- recording-time selection independent of occurrence time;
- mixed-type tie ordering and stable complete pagination;
- actor, activity-type, outcome, event-type, and undated filters;
- incompatible and invalid filter responses;
- correction narratives with original and corrected values, actor, reason,
  and time;
- legacy uncertainty and unknown actors;
- retained deleted evidence separated from operational rows, with unknown
  deletion facts and no update-timestamp leakage;
- denied Proposal/Project fields absent from payloads and restricted on
  demand, while a privileged reader sees them;
- coverage counts, exclusions, and history limits;
- 401 anonymous, 403 missing-grant, and super-admin bypass access;
- report reads leaving every source row unchanged.
