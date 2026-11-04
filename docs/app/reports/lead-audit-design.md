# Lead Audit and Performance report

Status: design approved on 2026-11-03. Implemented in issue #398 and merged in PR #407.

## Purpose and audience

Management and auditing staff need to review Lead demand, execution, progress, and accountability.
The report lives at `/reports/lead-audit`, under `src/app/reports/lead-audit/`.
It covers Lead operations and shows permission-controlled downstream Proposal and Project context.
Lead Conversion means Proposal handoff, not a sale won.

The report uses current corrected facts, including when reviewing earlier periods.
It does not provide immutable issued versions or exact historical reconstruction.
Every surface states the observation time, applied filters, date basis, and relevant coverage limits.

## Agreed decisions

- Separate Lead Intake from work performed during the selected period.
- Show system-entry counts and enquiry-date counts separately.
- Keep unknown dates, authors, outcomes, and histories explicitly unknown.
- Separate completed work, outreach, and successful contact.
- Separate current ownership from activity authorship.
- Show cohort conversion rates and period handoff counts with different denominators.
- Measure elapsed time to first outreach without a service-level target.
- Keep deleted-record evidence outside operational totals.
- Provide interactive review, Excel export, and a print-ready summary.
- Make free-text export evidence optional and off by default.
- Require report and source read permissions, plus export permission for Excel.

## Information structure

The page has a shared filter toolbar and five views.
Use existing report components, styling, data-fetching conventions, and navigation patterns.
Do not repurpose `src/app/reports/page.jsx`; it currently serves payroll slips.
Add the report to the existing Reports navigation.

| View                    | Main question                                     | Contents                                                                                                                                     |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                | What needs management attention?                  | Clearly grouped intake, period work, cohort outcomes, and current operational risks                                                          |
| Intake and sources      | What entered the system, and from where?          | Intake trend, separate enquiry-date trend, source breakdown, cohort progression, Lead register                                               |
| Work and accountability | What work happened, and who recorded it?          | Completed activities by type, outreach outcomes, distinct Leads worked, author breakdown, separate current-owner workload                    |
| Audit evidence          | What evidence supports the figures and decisions? | Activity evidence, lifecycle decisions, ownership changes, corrections, legacy reviews, conversion records, separate deleted-record evidence |
| Data coverage           | What can these figures establish?                 | Unknown dates and authors, unresolved values, incomplete histories, invalid intervals, missing source labels, metric exclusions              |

Overview shows a short management view, not every available metric.
Keep Lead identity first in detail rows, followed by facts, dates, and actions.
Use separate groups for selected-period facts and current-state risks.
Do not draw a sequential funnel from current stage counts.

Selecting a metric opens the matching evidence without losing filters.
Selecting an active Lead can open its existing operational detail.
Deleted-record evidence stays readable within the report; do not link it to an unavailable operational detail page.

The toolbar contains period presets, custom dates, current owner, source, current stage, priority, and search.
The work and audit views also support actor, activity type, outcome, and event-type filters where applicable.
Label current-owner and current-stage filters explicitly; they are not historical assignments or stages.
Show which filters apply to each section, rather than silently ignoring incompatible filters.

Default period: current calendar month through today.
Default owner, source, stage, and actor scope: all permitted records.
Use the application's existing database-calendar policy and disclose the actual date/time zone used.
Date ranges include both selected calendar dates; timestamp queries use an exclusive next-day upper bound.

Use Apply as the primary toolbar action, with Reset, Export Excel, and Print as secondary actions.
Show applied filters and generation time beside the report title.
Keep table headers and filter labels visible when tables scroll.
At narrow widths, stack controls and summary groups before placing detail tables in labelled horizontal scroll regions.
Keep critical actions in normal flow and preserve source reading order.
Print layout removes navigation and interactive controls, repeats table headings, and preserves report metadata.

## Metric contract

### Dates and populations

Operational totals exclude soft-deleted Leads and applicable soft-deleted child records.
Deleted-record audit evidence is a separate population and never silently changes operational totals.
Use distinct Lead identities for Lead counts, not joined activity or Proposal rows.

| Measure                          | Population and date basis                                                                              | Important disclosure                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Leads recorded                   | Non-deleted Leads with `created_at` in the period                                                      | System entry, including imports; not verified arrival          |
| Enquiries dated in period        | Non-deleted Leads with `enquiry_date` in the period                                                    | Editable stated date; not an alternative name for system entry |
| Intake cohort                    | Non-deleted Leads first recorded in the period                                                         | Later progress is observed as of generation time               |
| Completed work in period         | Completed Lead activities with known `occurred_at` in the period                                       | Includes work on Leads created earlier; show types separately  |
| Audit changes recorded in period | Supported decision, ownership, review, conversion, and correction events by their recording timestamps | Not interchangeable with when underlying work occurred         |
| Current risks                    | Live Lead and scheduled-work state at generation time                                                  | Not the backlog at the selected period's end                   |

Do not substitute `created_at`, `updated_at`, or `recorded_at` for missing occurrence, enquiry, stage-entry, or conversion dates.
Records without a usable date remain available as undated evidence, with explicit exclusion counts for date-based metrics.

### Work and contact

- Completed calls, emails, meetings, and notes appear separately.
- Scheduled and cancelled work do not count as completed work.
- Lead Outreach means completed Call, Email, or Meeting activity; notes do not count.
- Distinct Leads with outreach count each Lead once within the work period.
- Successful contact follows existing Lead rules: a Connected call or confirmed email reply.
- A failed call is completed work and outreach, but not successful contact.
- A meeting is outreach, but does not establish the existing successful-contact metric by itself.
- Corrections appear as audit events, not additional completed activities.
- Transferred scheduled work belongs to the Proposal after handoff and is not outstanding Lead work.
- Legacy work with unknown type, outcome, author, or occurrence time stays explicitly unknown.

Show activity totals by the recorded author, including an Unknown author group.
Do not claim the recorded author necessarily performed work on another person's behalf.
Show current-owner workload separately, including unassigned Leads and retained references to inactive users.
A Lead's current owner does not receive credit for every activity recorded on that Lead.
Do not create employee rankings or a composite productivity score.

### Progress and conversion

Current stage distribution is a present-state breakdown, not proof that every Lead passed through every stage.
Show known stage decisions as recorded events, with reasons and actors where available.
Do not derive historical stage-entry times from Lead creation or update timestamps.

Cohort conversion rate:

`distinct cohort Leads with evidenced Proposal handoff / distinct Leads in the intake cohort`

Observe that cohort at the displayed generation time.
Use a recorded conversion event or an evidence-backed, resolved canonical Proposal link as handoff evidence.
A Converted stage label alone is not enough.
A retained conversion event remains evidence of the handoff even if downstream linkage later changes.
Unresolved legacy links remain a disclosed evidence gap, not an invented handoff or a confirmed failure.
A zero-size cohort shows Not applicable, not zero percent.
Warn that recent cohorts have had less time to progress.

Period handoff count uses distinct Leads with authoritative recorded conversion dates inside the selected period.
Historical canonical links without conversion dates can support cohort handoff evidence, but not a dated period handoff.
Do not use a Proposal creation timestamp as an inferred conversion timestamp.
Do not divide period handoffs by period intake and call it a conversion rate.

Downstream context includes the canonical Proposal's current status, progress, and Project link when permitted.
Do not infer a sale won from a handoff, Proposal existence, or Project existence.
Do not add revenue attribution, invoicing, marketing return, or a new sales-win definition to this report.

### Time to first outreach

Measure elapsed calendar time from Lead system entry to its earliest evidenced completed outreach occurrence.
Use the intake cohort and show median, nearest-rank 90th percentile, and valid sample count.
Show the number and share of cohort Leads without evidenced outreach alongside timing metrics.
Show exclusion counts for missing timestamps and invalid negative intervals.
Do not replace missing timestamps, clamp negative intervals to zero, or claim complete pre-import history.
No service deadline, business-hours calculation, breach label, or employee score is implied.
Use the label Time to first outreach, not Client response time.

### Operational risks and source analysis

Reuse existing Lead queue definitions for unassigned, untouched, overdue, due today, and no next action.
Label them As of generation time, regardless of the selected reporting period.
Do not reconstruct prior backlog, time in stage, or historical overdue rates from current scheduled rows.
Any current-state risk filters must remain visible beside those figures.

Source values are existing free text.
Preserve stored labels; show missing values as Unknown source.
Do not silently merge labels, rewrite records, or introduce a source taxonomy.
Show source intake volume and evidenced cohort conversion with explicit populations.
Do not claim advertising efficiency without spend data.

## Audit evidence and privacy

Audit evidence includes available activity, stage, owner, correction, legacy-review, and conversion records.
Each row identifies its evidence type, Lead, relevant actor, known work time, recording time, and evidence reference.
Show unknown facts explicitly rather than using the current owner or editing user as a substitute.

An activity and its corrections remain one activity in work totals.
The audit view shows the original and corrected values, correction reason, actor, and correction time.
Free-text fields in both old and new values follow the same export privacy choice.
Do not include nested notes or reasons accidentally through unfiltered JSON exports.

The report is not a complete compliance-grade change log.
Generic enquiry edits, task rescheduling, and some historical stage changes lack complete event history.
State those limits within Data coverage and exported methodology.

Deleted-record evidence has a clear Deleted label and remains outside operational cards and performance tables.
Do not invent a deletion date or actor from `updated_at`.
Deleting a Lead currently sets a flag and retains related records, but provides no reliable deletion event.

Free text is visible on demand to source-authorized readers.
Default Excel output excludes notes and narrative reasons.
An explicit Include detailed evidence option adds these fields after the same server-side permission checks.
Render user-provided text as text, including spreadsheet cells; do not interpret it as HTML or formulas.

## Authorization and outputs

Read access requires `reports:read` and `leads:read`, with the existing super-admin bypass.
An unrelated Project Activities report grant must not authorize this report.
Proposal details require `proposals:read`; Project details require `projects:read`.
Restricted downstream data is labelled Restricted, not No Proposal or No Project.
Lead-side handoff evidence can remain a Lead metric without exposing restricted Proposal fields.
Do not embed restricted data in hidden UI, download payloads, tooltips, or print markup.

Excel additionally requires `reports:export`, except for the existing super-admin bypass.
Apply the same rules to pages, data endpoints, evidence drill-downs, and exports.
This design adds no automatic permission grants or ownership-based access restrictions.

The Excel workbook includes:

- Summary and methodology, including generation time, time zone, filters, definitions, coverage, and live-data warning.
- Intake register and source breakdown.
- Completed work and author breakdown.
- Current owner workload and operational exceptions, explicitly labelled current-state.
- Structured audit events and correction references.
- Separate retained deleted-record evidence.
- Optional detailed narrative evidence when explicitly requested.

Exports cover the complete applied result, not just the visible page.
Workbook summaries and detail rows use the same definitions and applied scope.
If data changes between screen review and export, show the export's own generation time.
Do not promise identical screen and export values without a common data observation.

Print produces a management summary with definitions, coverage, and applied filters.
Users can save it as PDF through their browser.
Do not add a server PDF renderer, public share links, scheduled email delivery, or immutable report storage.
Browser printing and screenshots cannot be prevented by the Excel export permission.

## Evidence reviewed

- `GLOSSARY.md`: Lead identity, conversion, activity, owner, correction, intake, outreach, and cohort definitions.
- `docs/adr/0031-legacy-lead-review-and-canonical-proposal.md`: unknown legacy facts and canonical Proposal resolution.
- `docs/adr/0032-lead-activity-log-and-conversion-handoff.md`: work, correction, and conversion semantics.
- `src/server/leads/workflow.ts`: Lead creation, import, soft deletion, active filters, and current work joins.
- `src/server/leads/activities.ts` and `activity-rows.ts`: work evidence and mutable scheduled actions.
- `src/server/leads/queues.ts`: operational queue definitions and database-calendar policy.
- `src/server/leads/corrections.ts`: corrected values and retained previous evidence.
- `src/server/leads/legacy-review.ts`: append-only review decisions and history limits.
- `src/server/leads/conversion.ts` and `progress.ts`: handoff evidence and permission-controlled downstream context.
- `src/components/Navbar.jsx`: Reports navigation.
- `src/utils/report-permissions.ts`: unrelated existing Project Activities gate, not sufficient here.

This is repository research and design, not runtime verification.
No application, database, browser, build, or test checks were run for this design.

## Implementation acceptance

These are required verification scenarios, not claims of completed checks.

1. Work on an older Lead appears in period work without inflating period intake.
2. Entry date and enquiry date give distinct counts; missing dates are disclosed.
3. A No Answer call counts as work and outreach, but not successful contact.
4. Notes-only Leads remain untouched under existing outreach rules.
5. A correction changes current facts without adding another completed activity.
6. Occurrence dates and audit recording dates filter their own views independently.
7. Unknown legacy facts remain unknown and appear in coverage counts.
8. Cohort conversion and dated period handoffs use different, documented populations.
9. Missing conversion dates never enter period counts through timestamp substitution.
10. Current risk counts never pretend to represent a historical period-end backlog.
11. Owner reassignment does not reattribute activity authorship.
12. Deleted-record evidence remains readable without entering operational totals.
13. Restricted Proposal and Project facts are absent from all payloads and outputs.
14. Read-only report access cannot call the Excel export endpoint without `reports:export`.
15. Default exports contain no notes or narrative reasons, including nested correction values.
16. Detailed exports require an explicit choice and preserve source permissions.
17. Excel totals reconcile with their exported detail and cover more than the visible page.
18. Empty cohorts show Not applicable; empty durations never appear as zero response time.
19. Invalid or unknown outreach intervals are disclosed, not fabricated.
20. Browser smoke checks exercise filters, drill-downs, denied access, Excel, print, narrow layouts, and zoom.
