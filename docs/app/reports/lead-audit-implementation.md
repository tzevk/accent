# Lead Audit and Performance — Intake implementation (#399)

## Overview

`/reports/lead-audit` is the first usable slice of the Lead Audit and
Performance report: **Overview** and **Intake and sources**. It reports what
entered the system, separately from the Enquiry Dates recorded on those
Leads, and provides the filtered Lead register behind each intake figure.

The report is live and correction-sensitive. It is not an immutable issued
report; every read states its generation time, reporting time zone, date
basis, applied filters, and the coverage limits of this slice.

**Route:** `src/app/reports/lead-audit/`
**APIs:**

- `GET /api/reports/lead-audit` — overview, intake trends, source volumes,
  filter options, and coverage disclosures.
- `GET /api/reports/lead-audit/register` — one page of Lead evidence for the
  selected metric, retaining every applied filter.

**Navigation:** a Reports menu item that requires both `reports:read` and
`leads:read`. `src/app/reports/page.jsx` (payroll slips) is unchanged.

Later sections (work and accountability, operational risks, conversion and
timing, audit evidence and data coverage, Excel export and print) are not
exposed by this slice. `available_views` in the response is the explicit list
of implemented views, so an unimplemented view cannot appear as an empty tab.

## Authorization

| Reader                                                    | Result                           |
| --------------------------------------------------------- | -------------------------------- |
| Anonymous                                                 | `401 Unauthorized`               |
| `reports:read` only                                       | `403`                            |
| `leads:read` only                                         | `403`                            |
| `reports:read` + `leads:read`                             | `200`                            |
| Unrelated project-activities report field grant only      | `403`                            |
| Super admin, regardless of individual grants              | `200` (existing bypass)          |

The page applies the same conjunction in the client before loading data. The
server is authoritative: the page gate is not an access control. Both API
routes call `getCurrentUser` directly, then `canReadLeadAudit` from the report
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
Source labels are not a closed vocabulary: an unfamiliar stored label is a
valid exact filter.

Apply is the primary action; Reset restores the current month and all-record
scope. Draft filters do not affect the report until Apply.

## Metric contract in this slice

| Figure                    | Population                                                                 | Date basis                        | Disclosure                                                       |
| ------------------------- | -------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| Leads recorded            | Distinct non-deleted Leads                                                 | `created_at` inside the period    | System entry, including imports; not verified enquiry arrival      |
| Enquiries dated in period | Distinct non-deleted Leads                                                 | stated `enquiry_date` in period   | Editable stated date; a separate population from system entry      |
| Missing Enquiry Dates     | Distinct non-deleted Leads recorded in the period with `enquiry_date` null | `created_at` inside the period    | Excluded from Enquiry Date figures; creation time is not substituted |
| Source volume             | Distinct non-deleted Leads recorded in the period, grouped by stored label | `created_at` inside the period    | Labels preserved exactly; missing labels grouped as Unknown source |

All totals are distinct Lead counts. The intake reads never join child tables,
so activities or Proposals cannot multiply a Lead. Soft-deleted Leads are
excluded from every operational figure, trend, source group, and register row.
Retained deleted-record evidence is out of scope for this slice.

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

| File            | Responsibility                                                              |
| --------------- | --------------------------------------------------------------------------- |
| `index.ts`      | Public read interface: `readLeadAuditReport`, `readLeadAuditRegister`, shared section readers and types |
| `access.ts`     | `canReadLeadAudit` — the two-grant conjunction and super-admin bypass        |
| `filters.ts`    | One parser for periods, filters, pagination, and the evidence metric         |
| `period.ts`     | Calendar-only date arithmetic and preset resolution                          |
| `clock.ts`      | Database observation time and actual reporting time zone                     |
| `sql.ts`        | Shared Lead predicates and the inclusive/exclusive date bounds               |
| `scope.ts`      | Effective-filter labels, scope, and metadata                                 |
| `source.ts`     | The single missing-label boundary for stored source values                   |
| `disclosures.ts`| Coverage disclosures shared by the view and the evidence                     |
| `intake.ts`     | Overview/intake section: summary, trends, sources, filter options            |
| `register.ts`   | Paginated Lead evidence for one metric                                       |
| `connection.ts` | One shared-pool connection per observation                                   |

Section readers accept `(db, filters, clock)`. A later workbook export can
open one `withLeadAuditConnection` observation, read every section on that
connection, and use one generation time without introducing a report-specific
pool. Later slices add their own section files and compose them into the
report response and `available_views`; they do not need to change the filter,
date, authorization, or connection contract.

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

## Out of scope for this slice

The following parent scope remains unimplemented and unexposed: work and
accountability, successful contact, current-owner workload, current
operational risks, cohort conversion and dated handoffs, time to first
outreach, audit evidence and legacy reviews, retained deleted-record review,
full data-coverage view, Excel export, print layout, and the `reports:export`
gate.

## Verification

The authenticated HTTP scenario is
`scripts/leads-integration/scenarios/report-intake.ts`, registered as
`lead-audit-intake` in the existing disposable MariaDB harness. It seeds Leads
with explicit record times independently of the report and asserts:

- default current month through today, presets, generation time, time zone,
  date basis, and the two implemented views;
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
- **2026-11-03 — green:** pending the orchestrator's integrated run after the
  implementation merge. This document records the actual result when that run
  completes; no pass is claimed here.
