# Lead Audit and Performance implementation

## Overview

`/reports/lead-audit` combines Overview, Intake and sources, Work and
accountability, Audit evidence, and Data coverage. System entry, stated
Enquiry Dates, completed work, cohort progress, and current risks remain
separate populations.

The report is live and correction-sensitive. It is not an immutable issued
report; every read states its generation time, reporting time zone, date
basis, applied filters, and the coverage limits of this slice.

**Route:** `src/app/reports/lead-audit/`
**APIs:**

- `GET /api/reports/lead-audit?view=overview|intake|work|audit|coverage` —
  shared management figures, filter options, and coverage. The default is
  Overview. Audit evidence loads only for `view=audit`; other views return
  `audit: null`, not fabricated empty audit counts.
- `GET /api/reports/lead-audit/register` — one page of Lead evidence for the
  selected metric, retaining every applied filter.
- `GET /api/reports/lead-audit/download` — the complete Excel evidence copy
  for the applied scope. It requires `reports:export` in addition to both read
  grants (super-admin bypass excepted), always covers the whole applied result
  rather than the visible page, and reads every section on one observation.
  Detailed narrative is opt-in with `include_narrative=1`; the default
  workbook carries structured evidence only. See
  [Lead Audit Excel export](lead-audit-export.md) for the sheet inventory,
  reconciliation and privacy rules, and the live-copy limitation.

**Navigation:** a Reports menu item that requires both `reports:read` and
`leads:read`. `src/app/reports/page.jsx` (payroll slips) is unchanged.

Section definitions and evidence contracts:

- [Completed work and authorship](lead-audit-work.md)
- [Current-owner workload and risks](lead-audit-current-state.md)
- [Cohort conversion and downstream context](lead-audit-conversion.md)
- [Time to first outreach](lead-audit-timing.md)
- [Audit, deleted evidence, and coverage](lead-audit-audit-and-coverage.md)
- [Printing the management summary](lead-audit-print.md)

## Authorization

| Reader                                               | Result                  |
| ---------------------------------------------------- | ----------------------- |
| Anonymous                                            | `401 Unauthorized`      |
| `reports:read` only                                  | `403`                   |
| `leads:read` only                                    | `403`                   |
| `reports:read` + `leads:read`                        | `200`                   |
| Unrelated project-activities report field grant only | `403`                   |
| Super admin, regardless of individual grants         | `200` (existing bypass) |

The page applies the same conjunction in the client before loading data. The
server is authoritative: the page gate is not an access control. Every report
API calls `getCurrentUser` directly, then `canReadLeadAudit` from the report
module. No automatic grants or ownership-based restrictions are added.

## Filters and date policy

Supported filters:

- Period: `today`, `current_month`, `previous_month`, `last_7_days`,
  `last_30_days`, `current_quarter`, `current_year`, or `custom` with
  `from_date` and `to_date`. Default: current calendar month through today.
- Current owner: a user id, `unassigned`, or all.
- Source: the exact stored label, or `source_missing=1` for the missing label.
- Current stage: a canonical Lead Stage, or `unresolved` for legacy records
  with no resolved stage.
- Priority: `Low`, `Medium`, or `High`.
- Search: Lead id, company, contact, contact email, or project description.
- Register: `metric=recorded|enquired|missing_enquiry_date`, `page`, `limit`
  (1–100, default 25).

The calendar comes from the database, not the browser: `CURDATE()` resolves
presets and the default period, and the response discloses the database's
session/system time zone and UTC offset. Both selected calendar dates are
included. Timestamp queries use an inclusive start and an exclusive next-day
upper bound (`>= from 00:00:00`, `< next day 00:00:00`). Enquiry Date uses the
same next-day bound.

Invalid calendar dates, incomplete or reversed custom ranges, unknown
presets, unknown stages, unknown priorities, malformed owner ids, conflicting
source filters, and unknown register metrics return `422` with a named `code`.
Source labels are not a closed vocabulary. Every non-empty label is an exact
filter, including literal `all` and `__missing__`. Omit `source` to select
all labels; use `source_missing=1` to select missing labels.

Apply is the primary action; Reset restores the current month and all-record
scope. Draft filters do not affect the report until Apply.

Each view validates its relevant evidence-filter combinations. An incompatible
audit combination returns `422` in the Audit view without rejecting valid
Overview or Work figures. The view buttons remain available during errors,
so readers can return to another population without discarding applied filters.

## Metric contract in this slice

| Figure                    | Population                                                                 | Date basis                      | Disclosure                                                           |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| Leads recorded            | Distinct non-deleted Leads                                                 | `created_at` inside the period  | System entry, including imports; not verified enquiry arrival        |
| Enquiries dated in period | Distinct non-deleted Leads                                                 | stated `enquiry_date` in period | Editable stated date; a separate population from system entry        |
| Missing Enquiry Dates     | Distinct non-deleted Leads recorded in the period with `enquiry_date` null | `created_at` inside the period  | Excluded from Enquiry Date figures; creation time is not substituted |
| Source volume             | Distinct non-deleted Leads recorded in the period, grouped by stored label | `created_at` inside the period  | Labels preserved exactly; missing labels grouped as Unknown source   |

All totals are distinct Lead counts. The intake reads never join child tables,
so activities or Proposals cannot multiply a Lead. Soft-deleted Leads are
excluded from every operational figure, trend, source group, and register row.
Retained deleted-record evidence appears separately in the Audit view.

Imports are counted at their recording time because the import writes
`created_at = NOW()`. An imported Lead whose Enquiry Date is outside the
period still counts in system entry and not in Enquiry Date figures.

Integer counts are literal results, not placeholders. A zero figure is shown
as zero because it is a measured population; an unavailable fact is shown as
Unknown, Unassigned, or Unresolved, never as a fabricated value.

## Source handling

`leads.lead_source` is free text. The report:

- groups by the exact stored value, preserving case and whitespace;
- groups `NULL` and the empty string as **Unknown source**;
- never trims, normalizes, merges, or rewrites a label;
- compares and groups under a byte-exact `BINARY` expression, because the
  column's default collation is case-insensitive and space-padding and would
  otherwise merge labels;
- offers the search-matching stored labels in the filter options;
- does not claim advertising efficiency or return.

## Lead register

Selecting a figure on Overview opens **Intake and sources** with the matching
register metric and the same applied filters. The register:

- is ordered deterministically: `created_at DESC, id DESC` for system entry
  and missing dates; `enquiry_date DESC, created_at DESC, id DESC` for dated
  Enquiries;
- returns `pagination.total` and `total_pages` over the full filtered result,
  independent of the visible page;
- links active Leads to `/leads/{id}`;
- shows Unknown source, Unknown Enquiry Date, Unassigned owner, and Unresolved
  stage where the stored fact is absent;
- keeps soft-deleted Leads out.

## Module shape

`src/server/reports/lead-audit/`

| File             | Responsibility                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `index.ts`       | Public read interface: `readLeadAuditReport`, `readLeadAuditRegister`, shared section readers and types |
| `access.ts`      | `canReadLeadAudit` — the two-grant conjunction and super-admin bypass                                   |
| `filters.ts`     | One parser for periods, filters, pagination, and the evidence metric                                    |
| `period.ts`      | Calendar-only date arithmetic and preset resolution                                                     |
| `clock.ts`       | Database observation time and actual reporting time zone                                                |
| `sql.ts`         | Shared Lead predicates and the inclusive/exclusive date bounds                                          |
| `scope.ts`       | Effective-filter labels, scope, and metadata                                                            |
| `source.ts`      | The single missing-label boundary for stored source values                                              |
| `disclosures.ts` | Coverage disclosures shared by the view and the evidence                                                |
| `intake.ts`      | Overview/intake section: summary, trends, sources, filter options                                       |
| `register.ts`    | Paginated Lead evidence for one metric                                                                  |
| `connection.ts`  | One shared-pool connection per observation                                                              |

Section readers accept `(db, filters, clock)`. `withLeadAuditConnection`
starts one read-only, repeatable-read snapshot on the shared pool.
Every section and complete export detail uses that snapshot and one generation
time. Success commits the read transaction; errors roll it back before release.
This keeps a concurrent correction from splitting summary and detail facts.
Later slices compose their own section readers without creating another pool.

UI sections are separate files:

- `src/app/reports/lead-audit/views/overview-view.tsx`
- `src/app/reports/lead-audit/views/intake-view.tsx`
- `src/app/reports/lead-audit/intake/lead-register.tsx`
- shared `filter-toolbar.tsx`, `report-header.tsx`, `filters.ts`, `types.ts`

## Presentation and accessibility

- Loading, empty, error, and partial-refresh states are distinct; a failed
  request never renders as a successful empty report.
- The toolbar uses labelled native controls. Apply and Reset stay in normal
  flow; presets resolve on the server.
- Applied filters, generation time, reporting time zone, date basis, and the
  live-data warning sit beside the title.
- Summary groups stack before detail tables. The register sits in a labelled
  horizontal scroll region with a minimum width, so 320-pixel viewports and
  200-percent zoom do not clip controls or Lead identities.
- Counts remain readable as text; trend bars are decorative and the table
  carries the value.
- The [printable management summary](lead-audit-print.md) prints only its own
  document-shaped figures: intake, work and contact, cohort outcomes, timing,
  current-owner workload, and current risks, with the generation time, time
  zone, applied filters, definitions, coverage, and exclusions. Printing uses
  the browser dialog and needs no `reports:export`; navigation, controls,
  evidence tables, narratives, and Proposal or Project values never reach the
  printed page. Table headings repeat across pages, and print styles remove
  every element outside the summary wrapper.

## Shared section scopes

Lead filters apply to every operational section. Actor, activity type, and
outcome narrow period work and matching audit evidence, not intake or current
ownership. Event type and the undated toggle apply only to audit evidence.
Each section discloses its effective and ignored filters.

Drill-downs retain the observed calendar dates and applied filters.
Current-state evidence identifies distinct Leads separately from individual
scheduled work items. Deleted evidence never contributes to operational totals.

## Verification

The authenticated HTTP scenario is
`scripts/leads-integration/scenarios/report-intake.ts`, registered as
`lead-audit-intake` in the existing disposable MariaDB harness. It seeds Leads
with explicit record times independently of the report and asserts:

- default current month through today, presets, generation time, time zone,
  date basis, and applied scope;
- system-entry and Enquiry Date counts with different populations, including
  an earlier-recorded Lead whose Enquiry Date is inside the period;
- inclusive start/end boundaries and exclusive next-day bounds;
- missing Enquiry Dates disclosed and never substituted;
- exact source labels (case and whitespace variants), Unknown source, and
  deleted-Lead exclusion;
- owner, source, missing-source, stage, unresolved-stage, priority, search,
  and combined filters;
- invalid dates, reversed ranges, unknown presets, stages, priorities,
  owners, and metrics (422 with codes);
- 401 anonymous, 403 leads-only, reports-only, and unrelated project-activities
  grant, and the super-admin bypass;
- deterministic pagination, unique Leads across pages, full-result totals,
  empty pages beyond the end, and filter retention on the register;
- imports counted at entry, not by their Enquiry Date;
- report reads leaving fixture records unchanged.

Verification record:

- **2026-11-03 — red:** the existing harness passed its 83 prior scenarios;
  `lead-audit-intake` failed at the first report read with `404 !== 200`,
  proving the endpoint was absent before implementation. Disposable database
  `accent_integration_399_red` was dropped after the run.
- **2026-11-03 — green:** all 84 authenticated HTTP scenarios passed against
  disposable MariaDB 10.11.15, including `lead-audit-intake`.
  `npm run verify` passed: production build, 122 test files, and 1,421 tests.
- **2026-11-03 — browser:** exercised Apply/Reset, filtered metric drill-downs,
  source labels, loading, empty and failed-request states, and denied page access.
  The May fixture showed eight recorded Leads, seven dated enquiries, and one
  missing Enquiry Date. At 320 pixels, document width remained 320 pixels;
  wide evidence tables used labelled scroll regions. At 200% CSS zoom, controls
  remained reachable without document overflow.
- **2026-11-03 — integrated sections:** the production build and all 122
  test files (1,421 tests) passed. Targeted authenticated current-state and
  timing scenarios passed. Work and conversion scenarios exposed population
  defects; their corrected integration runs are recorded separately below.
- **2026-11-03 — complete interactive-data run:** all 89 authenticated HTTP
  scenarios passed against MariaDB 10.11.15. This includes corrected work
  deletion guards, cohort aggregation, independent downstream grants, view
  validation, timing boundaries, audit narratives, and source non-mutation.
  Each scenario uses its own loopback client address, keeping production
  rate limits active without sharing one unrelated scenario's IP bucket.
- **2026-11-03 — browser, all views:** with real fixture data, the view
  buttons switched populations without discarding applied filters, work
  evidence paged under a selected metric, current-risk cards opened their
  matching Lead evidence, cohort handoff evidence loaded, and timing
  figures opened their sample evidence. An audit-only incompatible filter
  combination produced a named error while the view buttons stayed usable
  and returning to Overview kept the corrected figures. Audit narratives
  rendered live and retained deleted evidence, a correction detail showed
  its before/after values, and all wide audit and coverage tables became
  labelled focusable scroll regions. At 320 pixels the document width
  remained 320 pixels; at 200% zoom the header title wrapped instead of
  clipping. The header's decorative icon is hidden below the `sm`
  breakpoint, where it previously competed with the title.
