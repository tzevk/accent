## Problem Statement

Management and auditing staff need one reliable report for Lead demand, execution, progress, and accountability.
They need to understand how many Leads entered Accent, what work happened, and which Leads need attention.
They also need evidence behind ownership changes, qualification decisions, corrections, and Proposal handoffs.

The operational Lead workspace already stores much of this evidence, but no dedicated Lead report exists.
Its queues show current work, not a historical management reconciliation.
Readers cannot safely equate system entry with actual enquiry arrival, completed activities with contact, or conversion with a sale.

Legacy records contain missing dates, actors, outcomes, and stage history.
Task dates and statuses change without complete event history.
Corrections update current facts, so earlier-period figures can change.
A professional report must expose these limits instead of inventing historical certainty.

## Solution

Provide an internal **Lead Audit and Performance** report at `/reports/lead-audit`, within the existing Reports navigation.

Organize the report into five views:

- **Overview:** selected-period intake, work, cohort outcomes, and separately labelled current operational risks.
- **Intake and sources:** system-entry trends, separate Enquiry Date trends, source breakdowns, and the Lead register.
- **Work and accountability:** completed activities, outreach outcomes, activity authorship, and separate current-owner workload.
- **Audit evidence:** available activities, decisions, ownership changes, corrections, legacy reviews, and conversion evidence.
- **Data coverage:** unknown facts, missing dates, incomplete histories, unresolved links, and metric exclusions.

Keep Lead operations as the main subject.
Show permission-controlled Proposal and Project context without treating Lead Conversion as a sale won.

Provide an interactive report, a complete Excel workbook, and a print-ready management summary.
Use live corrected facts, with clear generation times, date bases, applied filters, definitions, and coverage disclosures.
Keep retained deleted-record evidence separate from operational totals.

## User Stories

1. As a manager, I want one Lead report, so that I can review demand, execution, progress, and accountability.
2. As a manager, I want a concise overview, so that I can identify issues before opening detailed evidence.
3. As a manager, I want the current month selected initially, so that I can review current operations immediately.
4. As a manager, I want period presets and custom dates, so that I can review relevant reporting windows.
5. As a manager, I want applied filters visible, so that I understand the population behind each figure.
6. As a manager, I want generation time and time zone, so that I understand the observation time.
7. As a manager, I want separate system-entry counts, so that recording does not imply actual enquiry arrival.
8. As a manager, I want separate Enquiry Date counts, so that stated dates do not distort intake trends.
9. As an auditor, I want missing Enquiry Dates disclosed, so that incomplete arrival evidence remains visible.
10. As a manager, I want imports counted when recorded, so that system-entry totals match their stated definition.
11. As a manager, I want separate intake and work views, so that work on older Leads remains visible.
12. As a manager, I want intake trends, so that I can understand changes in recorded demand.
13. As a manager, I want source breakdowns, so that I can identify where recorded Leads originate.
14. As an auditor, I want original source labels preserved, so that reporting does not silently rewrite classifications.
15. As a manager, I want Unknown source grouped explicitly, so that missing classifications remain visible.
16. As a manager, I want distinct Lead counts, so that multiple activities or Proposals do not inflate demand.
17. As a manager, I want a filtered Lead register, so that I can inspect intake evidence.
18. As a manager, I want current owner filters, so that I can review present responsibility.
19. As a manager, I want current stage filters, so that I can inspect present qualification progress.
20. As an auditor, I want current-state filters labelled, so that I do not mistake them for historical assignments.
21. As a manager, I want source, priority, and search filters, so that I can narrow relevant Lead populations.
22. As a manager, I want completed calls, emails, meetings, and notes separated, so that different work remains distinguishable.
23. As a manager, I want plans excluded from completed totals, so that scheduled work cannot appear accomplished.
24. As a manager, I want distinct Leads with outreach, so that repeated attempts do not inflate Lead coverage.
25. As a manager, I want outreach separated from successful contact, so that activity volume does not imply engagement.
26. As a manager, I want unsuccessful calls retained as completed work, so that genuine attempts remain visible.
27. As a manager, I want confirmed email replies distinguished from sent emails, so that successful contact requires evidence.
28. As a manager, I want notes separated from outreach, so that documentation alone does not imply contact attempts.
29. As a manager, I want work grouped by recorded author, so that recording responsibility remains attributable.
30. As an auditor, I want Unknown author retained, so that missing provenance does not become guessed responsibility.
31. As a manager, I want current-owner workload separately, so that accountability does not overwrite activity authorship.
32. As a manager, I want unassigned Leads visible, so that intake responsibility gaps can be addressed.
33. As an auditor, I want inactive user references preserved, so that account changes cannot erase recorded responsibility.
34. As a manager, I want actor, activity-type, and outcome filters, so that I can investigate relevant work.
35. As a manager, I want current untouched Leads visible, so that missing outreach can receive attention.
36. As a manager, I want current overdue and due-today work visible, so that I can address follow-up risks.
37. As a manager, I want current No Next Action exceptions, so that I can address missing next steps.
38. As an auditor, I want current risks timestamped, so that they cannot imply historical backlog.
39. As a manager, I want current stage distribution, so that I can understand the present Lead pipeline.
40. As an auditor, I want stage counts separated from funnels, so that missing transitions remain unknown.
41. As a manager, I want Lead Intake Cohorts, so that later progress relates to consistent intake groups.
42. As a manager, I want Lead Cohort Conversion Rate, so that handoff progress uses a consistent population.
43. As a manager, I want separate period handoff counts, so that older-Lead conversions cannot distort cohort rates.
44. As an auditor, I want conversion evidence requirements stated, so that stage labels alone cannot manufacture handoffs.
45. As an auditor, I want undated canonical links disclosed separately, so that they cannot become invented period conversions.
46. As an auditor, I want conversion evidence retained, so that downstream link changes cannot erase recorded handoffs.
47. As a manager, I want unresolved links disclosed, so that incomplete evidence is not presented as confirmed failure.
48. As a manager, I want cohort-maturity warnings, so that I can interpret differing observation windows.
49. As a manager, I want empty rates labelled Not applicable, so that absent populations cannot imply failure.
50. As a manager, I want Proposal status and progress when permitted, so that I can understand downstream context.
51. As a manager, I want linked Project context when permitted, so that I can follow the subsequent work.
52. As an auditor, I want restricted context labelled Restricted, so that denied access cannot imply absent data.
53. As a manager, I want time to first outreach, so that I can understand observed follow-up speed.
54. As a manager, I want median and 90th-percentile outreach times, so that typical and slower cases remain distinguishable.
55. As an auditor, I want timing coverage counts, so that incomplete timestamps cannot create false precision.
56. As a manager, I want missing-outreach counts beside durations, so that timing summaries cannot hide untouched Leads.
57. As an auditor, I want negative intervals disclosed, so that imported prehistory does not become zero-duration outreach.
58. As a manager, I want elapsed times without targets, so that the report cannot invent performance rules.
59. As an auditor, I want activities separated from decisions, so that work remains distinguishable from administrative changes.
60. As an auditor, I want known occurrence and recording times separately, so that late entry remains understandable.
61. As an auditor, I want event-type filters, so that I can inspect relevant decisions and corrections.
62. As an auditor, I want lifecycle reasons and actors, so that I can examine qualification and disqualification decisions.
63. As an auditor, I want ownership changes and their actors, so that responsibility changes remain traceable.
64. As an auditor, I want legacy review evidence, so that resolved uncertainty remains explainable.
65. As an auditor, I want original and corrected values, so that I can understand how recorded facts changed.
66. As an auditor, I want correction reasons, actors, and times, so that repairs remain accountable.
67. As a manager, I want corrected activities counted once, so that corrections do not inflate recorded work.
68. As an auditor, I want missing historical facts marked unknown, so that dates or people are never invented.
69. As an auditor, I want evidence references, so that every reported decision can be traced to its source.
70. As a manager, I want metric drill-downs to retain filters, so that detail explains the selected figure.
71. As an auditor, I want separate deleted-record evidence, so that deletion cannot hide records or inflate operational totals.
72. As an auditor, I want deleted evidence readable here, so that unavailable operational pages cannot block review.
73. As an auditor, I want unknown deletion facts disclosed, so that edit timestamps cannot imply deletion evidence.
74. As an auditor, I want history limits explained, so that available evidence cannot imply complete compliance auditing.
75. As a reader, I want loading, empty, and error states, so that failed requests cannot imply zero activity.
76. As a reader, I want usable narrow-screen and zoomed layouts, so that filters and essential actions remain accessible.
77. As a reader, I want readable scrolling tables, so that Lead identities and column meanings remain understandable.
78. As an authorized reader, I want consistent permissions, so that report data and drill-downs share access rules.
79. As an auditor, I want downstream fields removed server-side when restricted, so that hidden markup cannot disclose them.
80. As an administrator, I want no automatic grants, so that existing access decisions remain under administrative control.
81. As an authorized exporter, I want complete workbooks, so that auditing extends beyond the visible page.
82. As an auditor, I want workbook summaries reconciled with details, so that exports provide internally consistent evidence.
83. As an auditor, I want definitions and coverage inside Excel, so that shared files retain their interpretation.
84. As an exporter, I want narrative evidence excluded initially, so that routine sharing avoids unnecessary disclosure.
85. As an authorized exporter, I want optional narrative evidence, so that notes and reasons support deliberate audits.
86. As an auditor, I want consistent narrative redaction, so that nested correction data cannot bypass export privacy.
87. As an administrator, I want separate Excel permission, so that report viewing cannot authorize workbook downloads.
88. As an exporter, I want user text preserved as text, so that spreadsheet content cannot become executable formulas.
89. As a manager, I want a print-ready summary, so that I can present findings or save PDFs.
90. As an auditor, I want printed filters, definitions, and coverage, so that the printed summary remains interpretable.
91. As a reader, I want live-data warnings, so that corrected figures cannot imply broken frozen-report guarantees.
92. As an exporter, I want export generation times, so that later downloads can legitimately differ from screen results.

## Implementation Decisions

### Module shape and integration

- Build one deep Lead reporting module behind a small, authenticated report interface.
- Keep query rules, metric populations, evidence selection, coverage, and authorization consistent across consumers.
- Let interactive views, evidence drill-downs, print, and Excel use the same reporting definitions.
- Reuse existing Lead vocabulary, queue definitions, source authorization, database access, and report conventions.
- Extend the existing Reports navigation rather than replacing its root surface, which currently serves payroll slips.
- Do not create a generic reporting framework, new event store, parallel Lead lifecycle, or source-cleaning subsystem.
- No new business tables or source-data migrations are required by this feature.
- Use the shared database pool and existing connection limits. Do not create a report-specific pool.
- Preserve existing operational write behavior. Report reads must not change Leads, work, ownership, or history.

### Interface and interaction contract

- Provide authenticated read operations for report views and paginated evidence, plus a separate authenticated Excel download operation.
- Accept selected calendar dates and the filters relevant to the requested view.
- Default to the current calendar month through today, with all permitted records selected.
- Provide current owner, source, current stage, priority, and search filters.
- Support actor, activity type, outcome, and event type on work and evidence views where relevant.
- Distinguish current-owner and current-stage filters from historical actor and decision facts.
- Display each section's applied scope. Do not silently treat incompatible filters as effective.
- Use Apply as the primary filter action. Provide Reset, Export Excel, and Print as secondary actions.
- Selecting a figure reveals its matching evidence while retaining applied filters.
- Active Leads may link to their existing operational detail. Deleted evidence must remain inspectable within the report.
- Keep ordering deterministic across pagination, including ties between different event types.
- Calculate full-dataset totals independently of the visible page. Preserve distinct Lead counts across one-to-many joins.
- Return observation time, actual time zone, applied scope, date basis, coverage, and metric definitions with report results.
- Use existing success and error response conventions. Anonymous requests return 401; missing required grants return 403.
- Reject invalid dates, reversed ranges, and unsupported closed-vocabulary filters with a clear validation response.
- Preserve stored free-text source labels. Do not reject unknown source labels merely because they lack a taxonomy.
- Represent unavailable values as unknown, restricted, or not applicable as appropriate, never fabricated zeroes.
- Avoid stale or failed requests masquerading as an empty successful report.

### Date bases and populations

- Operational populations exclude soft-deleted Leads and applicable soft-deleted child evidence.
- Keep deleted-record evidence as an explicitly separate audit population.
- Leads recorded means Lead creation timestamps within the selected period, including imports recorded then.
- Enquiries dated in period means the stated Enquiry Date falls within the selected period.
- These are different measures. Do not rename system entry as actual receipt or substitute one date for the other.
- The Lead Intake Cohort contains distinct non-deleted Leads first recorded during the selected period.
- Period work uses known activity occurrence times, including work on Leads recorded before the selected period.
- Audit changes use their supported recording timestamps, independently of underlying work occurrence times.
- Current operational risks use live state at observation time, not the selected period's end.
- Use the application's existing database-calendar policy. Include both selected calendar dates.
- Timestamp queries use an inclusive start and exclusive next-day end to preserve calendar boundaries.
- Never substitute record creation, editing, or recording timestamps for unknown enquiry, occurrence, stage-entry, or conversion dates.
- Undated evidence remains inspectable. Date-based metrics disclose applicable exclusions and coverage.

### Work, contact, and accountability

- Completed work includes completed calls, emails, meetings, and notes, reported separately by type.
- Scheduled and cancelled rows are not completed work. Unknown activity types remain explicitly unknown.
- Lead Outreach includes completed calls, emails, and meetings, not notes or future actions.
- Distinct Leads with outreach count each matching Lead once within the work period.
- Successful contact follows existing rules: Connected calls and confirmed email replies only.
- Failed calls remain completed work and outreach without becoming successful contact.
- A meeting remains outreach without automatically satisfying the existing successful-contact definition.
- Keep scheduled work transferred to a Proposal out of outstanding Lead work after handoff.
- Group recorded work by its author. Preserve unknown authors and retained references to inactive accounts.
- Do not assume that an activity author necessarily performed work on another person's behalf.
- Show current-owner workload separately. Owner reassignment must not reattribute historical activity authorship.
- Corrections are audit events, not additional completed activities. Use corrected current facts in live metrics.
- Do not calculate employee rankings or a composite productivity score.

### Progress and conversion

- Current stage distribution describes present state, not a sequential qualification funnel.
- Use known stage decisions as recorded evidence, without manufacturing missing stage-entry timestamps.
- Lead Cohort Conversion Rate divides distinct cohort Leads with evidenced handoffs by all distinct Leads in that cohort.
- Evaluate cohort progress at the displayed observation time, including handoffs after the intake period.
- Handoff evidence is a recorded conversion event or an evidence-backed, resolved canonical Proposal link.
- A Converted stage label alone is insufficient evidence.
- Retained conversion events remain handoff evidence when downstream links later change.
- Disclose unresolved legacy links. They are evidence gaps, not confirmed failures or guessed handoffs.
- Keep the full cohort denominator visible alongside unresolved-evidence counts.
- An empty cohort yields Not applicable, not zero percent.
- Warn that recent cohorts have had less time to progress.
- Period handoff counts include distinct Leads with authoritative conversion dates inside the selected period.
- An undated canonical link can support cohort handoff evidence but cannot become a dated period conversion.
- Do not infer handoff dates from Proposal creation or Lead editing timestamps.
- Do not divide period handoffs by period intake and describe the result as a conversion rate.
- Show current canonical Proposal status, progress, and Project links only when permitted.
- Do not infer sales wins from conversion, Proposal existence, or Project existence.

### Time to first outreach

- Measure elapsed calendar time from system entry to the earliest evidenced completed outreach occurrence for each cohort Lead.
- Label this Time to first outreach, not Client response time.
- Show the median, nearest-rank 90th percentile, and valid sample count.
- For an even sample, the median is the mean of the two middle observed durations.
- The nearest-rank percentile selects the ordered sample at the rounded-up percentile rank.
- Show cohort count and share without evidenced outreach alongside timing results.
- Disclose missing timestamps, incomplete earlier evidence, and invalid negative intervals.
- Do not replace missing timestamps, clamp negative intervals to zero, or claim complete pre-import history.
- With no valid timing samples, show an unavailable metric and its coverage explanation, not zero duration.
- No service target, business-hours rule, breach score, or employee ranking is introduced.

### Operational risks and source analysis

- Reuse existing definitions for unassigned, untouched, overdue, due today, and No Next Action queues.
- Explicitly label their current-state observation time and effective filters.
- Do not reconstruct historical backlog, historical overdue rates, or time in stage from mutable current records.
- Show source intake volume and evidenced cohort conversion using documented populations.
- Preserve existing source labels without silent normalization or merging. Show missing labels as Unknown source.
- Do not imply advertising efficiency or return without spend evidence.

### Audit evidence and deleted records

- Include available activity, lifecycle, stage, ownership, correction, legacy-review, and conversion evidence.
- Identify evidence type, Lead, source reference, known actor, occurrence time where supported, and recording time.
- Present lifecycle reasons and narrative evidence on demand to authorized readers.
- Expose original and corrected values, correction reasons, correcting actors, and correction times.
- Preserve unknown historical authors, call outcomes, stage-entry times, and assignment facts.
- Do not replace missing historical actors with current owners or the latest editing user.
- Label retained deleted-record evidence clearly. Keep it outside operational cards and performance breakdowns.
- Deletion flags are not reliable deletion events. Do not invent deletion dates or actors from update timestamps.
- Explain that generic enquiry edits, rescheduling, and some historical stage changes lack complete event history.
- This report exposes available evidence; it is not a complete compliance-grade change log.

### Authorization and privacy

- Require both reports:read and leads:read for report access, except for the existing super-admin bypass.
- An unrelated Project Activities report grant is insufficient.
- Require proposals:read for Proposal details and projects:read for Project details.
- Return Restricted when downstream facts are denied, not No Proposal or No Project.
- Lead-side handoff metrics may use Lead evidence without exposing protected downstream fields.
- Enforce permissions server-side on report data, evidence, and download operations.
- Restricted fields must be absent from payloads, hidden markup, tooltips, print content, and exports.
- Excel additionally requires reports:export, except for the existing super-admin bypass.
- Add no automatic permission grants and no new ownership-based access restriction.
- Default Excel excludes notes and narrative reasons, including those embedded in correction history.
- An explicit Include detailed evidence option adds narratives only after the same source and export permission checks.
- Apply the narrative choice consistently to previous and corrected values. Do not export raw nested history objects blindly.
- Render user content as text in the interface and workbook. Do not interpret it as HTML or spreadsheet formulas.
- Do not imply that export permission can prevent browser printing, copying, or screenshots of authorized visible data.

### Excel, print, and presentation

- Export the complete applied result rather than only the current page.
- Include summary and methodology, intake register, source breakdown, completed work, and author breakdown.
- Include current-owner workload and current operational exceptions with explicit observation labels.
- Include structured audit events, correction references, and separate retained deleted-record evidence.
- Add detailed narrative evidence only when explicitly requested.
- Include generation time, time zone, applied filters, definitions, coverage, exclusions, and the live-data warning.
- Reconcile workbook summaries with their detailed populations under a consistent data observation.
- Give each export its own generation time. Do not promise equality with an earlier screen observation.
- Use existing authenticated download and Excel-generation conventions rather than adding public download links.
- Print a management summary with metadata, definitions, and material coverage limits.
- Remove navigation and interactive controls from print, and repeat table headings when tables span pages.
- Let users save PDF through browser printing. Do not add server-side PDF generation.
- Preserve reading order and shared alignment. Lead identity leads detail rows; metadata and actions follow.
- Stack toolbar controls and summary groups at narrow widths before placing wide tables in labelled scroll regions.
- Keep critical controls reachable, preserve table context, and avoid clipping at narrow widths or increased zoom.

## Testing Decisions

### Confirmed seam

The user confirmed one primary automated seam: the authenticated report HTTP interface against disposable MariaDB.
Exercise report data, evidence drill-downs, permission decisions, and Excel downloads through that interface.
Reuse the existing Lead authenticated HTTP integration harness and its real-session setup.
Do not add test-only routes, authentication bypasses, or a parallel integration framework.

A good test proves an externally observable business rule using independent expected values.
Tests should survive changes to query structure, internal helper names, or rendering organization.
Do not assert SQL text, implementation call order, source strings, copied defaults, or mocked response echoes.
Do not duplicate the aggregation algorithm inside assertions.

### Modules and prior art

- Test the Lead reporting module through its report read, evidence read, and Excel download operations.
- Exercise the authorization and narrative-redaction behavior through real authenticated requests.
- Parse returned workbooks and inspect actual cells, data populations, and reconciliation results.
- Use the existing Lead integration harness for disposable MariaDB, migrated fixtures, real login, and scenario isolation.
- Its existing outreach, correction, queue, legacy-review, conversion, and restricted-progress scenarios are relevant prior art.
- Existing Attendance report aggregation tests illustrate literal expected results for distinct populations.
- Existing Employee Report route tests illustrate externally visible authorization responses, not a requirement to mock report data.
- Use independent fixture setup or database reading to establish source evidence and prove report reads do not mutate it.
- Do not use application-generated aggregate queries as the oracle for their own correctness.
- Keep fixtures run-namespaced and isolated. Preserve the harness's safe-target rejection and cleanup behavior.

### Required automated scenarios

1. Work on an older Lead appears in period work without increasing period Lead Intake.
2. System-entry and Enquiry Date counts differ correctly, including missing dates and imports.
3. Boundary timestamps include the selected start and end days but exclude the next calendar day.
4. Multiple activities and downstream links do not multiply distinct Lead counts.
5. No Answer calls count as completed work and outreach, but not successful contact.
6. Sent emails without confirmed replies do not count as successful contact.
7. Notes-only Leads remain untouched under existing queue rules.
8. Scheduled, cancelled, and transferred work obey their respective completed-work and outstanding-work definitions.
9. Correcting a call changes live contact outcomes while keeping the completed activity count unchanged.
10. Occurrence-date work filters and recording-date audit filters produce their separately defined populations.
11. Unknown legacy actors, outcomes, occurrence dates, and stage histories remain unknown and appear in coverage.
12. Reassigning an owner changes current workload without changing activity authorship.
13. Inactive users and unknown authors remain represented rather than disappearing from totals.
14. A cohort handoff after its intake period affects cohort progress but not that period's dated handoff count.
15. A resolved canonical link without a conversion date supports cohort evidence without fabricating a period event.
16. Unresolved links and stage labels alone do not manufacture conversion evidence.
17. Retained conversion events remain evidence when a downstream link changes.
18. Empty cohorts show Not applicable, and timing metrics without valid samples do not show zero duration.
19. Median and nearest-rank percentile behavior uses known literal durations, including even and small samples.
20. Missing and negative outreach intervals produce exclusions rather than guessed or clamped durations.
21. Current risks follow existing queue rules even when the selected reporting period is historical.
22. Source label differences are preserved, and absent labels remain Unknown source.
23. Deleted Leads and their work stay outside operational totals while retained evidence remains inspectable.
24. Missing deletion actor or time stays unknown rather than borrowing update metadata.
25. Anonymous readers receive 401. Missing either required read grant produces 403.
26. An unrelated Project Activities grant does not authorize report access.
27. Independently missing Proposal or Project grants remove the corresponding fields from every output.
28. Restricted downstream context remains distinguishable from no linked downstream record.
29. A report reader without reports:export cannot call the Excel operation directly.
30. The existing super-admin bypass remains valid without individual grants.
31. Default workbooks contain no narrative notes or reasons, including nested original and corrected values.
32. Detailed evidence appears only after explicit selection and valid read/export permissions.
33. User text resembling spreadsheet formulas remains text in the generated workbook.
34. Workbook totals reconcile with exported details across multiple result pages and filtered scopes.
35. Evidence drill-downs retain the populations and filters that produced their selected figures.
36. Invalid filter requests produce explicit errors, not silent empty results or silently ignored closed-vocabulary values.
37. Report and export operations leave operational records and histories unchanged.

### Worked population example

Use a run-isolated fixture with a selected calendar month and the following known evidence.
All named Leads are non-deleted unless stated otherwise.
Only the listed work occurs in that month.

- Lead A was recorded before the month. It has one No Answer call and a dated handoff during the month.
- Lead B was recorded during the month. It has one Connected call and a dated handoff during the month.
- Lead C was recorded during the month. It has one completed note and no handoff.
- Lead D was recorded during the month. It has a resolved canonical Proposal but no authoritative conversion date.
- Lead E was recorded during the month. It has no work or handoff evidence.
- Lead F was recorded during the month and then soft-deleted. It has retained work evidence.

Expected operational results are four Leads recorded, three completed activities, and two distinct Leads with outreach.
Successful contact reaches one Lead.
Two cohort Leads have evidenced handoffs, giving a 50 percent Lead Cohort Conversion Rate.
The dated period handoff count is two, because it includes A and B but excludes undated D.
F appears only in retained deleted-record evidence.
Correcting B's call to No Answer reduces successful-contact coverage to zero without increasing completed work.
These are fixture expectations, not claims of an executed test.

### Browser and delivery verification

- Do not introduce a permanent browser suite for this report.
- Smoke the actual report with real fixture data after implementation.
- Exercise filters, metric drill-downs, evidence narratives, denied access, Excel download, and the print summary.
- Check a narrow viewport, including 320 pixels, and 200 percent zoom for clipping and inaccessible controls.
- Check that printed output preserves metadata, definitions, and coverage while removing navigation and controls.
- Run the report's authenticated integration scenarios against a safe disposable MariaDB target.
- Run the repository verification gate before pushing implementation changes.
- Record actual outputs and coverage limits; unexecuted scenarios are not proof.

## Out of Scope

- Implementing the feature during this specification task.
- External customer portals, tenant isolation, customer-specific sharing, or public report links.
- New Lead intake, ownership, lifecycle, correction, or conversion workflows.
- Immutable issued reports, report-numbering workflows, retained report snapshots, or formal issuance controls.
- Exact reconstruction of what the system knew at any arbitrary historical time.
- Historical backlog, historical overdue rates, or time-in-stage metrics without complete supporting evidence.
- Backfilling missing actors, dates, outcomes, stage history, or deletion events through guesses.
- New actual-receipt capture rules or mandatory Enquiry Dates.
- Source taxonomy changes, automatic label merging, record normalization, or duplicate resolution.
- Service-level targets, business-hours timing, holiday calculations, response breach scores, or employee productivity rankings.
- Sales-win definitions, revenue attribution, invoicing, marketing return, or advertising efficiency calculations.
- A complete compliance-grade audit of every generic edit or task reschedule.
- New business tables, a new event store, a generic reporting framework, or a separate database pool.
- Server-generated PDFs, scheduled email delivery, public downloads, or attempts to prevent screenshots.
- A new permanent browser-testing framework or broad test-suite restructuring.

## Further Notes

The user approved the report design and then confirmed the authenticated HTTP integration seam.
This specification synthesizes those decisions without reopening the design interview.

The domain glossary defines Lead, Lead Conversion, Lead Owner, Lead Activity, Lead Correction, Lead Intake, and cohort terminology.
Respect ADR-0031 on legacy evidence and canonical Proposals, and ADR-0032 on the activity log and transactional handoff.
In particular, Lead Conversion is Proposal handoff, not Proposal acceptance or a Project start.

The approved design is recorded in [Lead Audit and Performance report design](https://github.com/tzevk/accent/blob/HEAD/docs/app/reports/lead-audit-design.md).
The repository copy of this specification is maintained alongside that design.
Local documentation changes must be committed before their GitHub file links become available.

The report remains live and correction-sensitive.
Excel files are evidence copies, not immutable issued system records.
Generation times do not guarantee identical values across separately observed screen and export results.

Repository research and seam confirmation are complete.
No feature code, schema changes, application runtime checks, integration runs, or browser checks are included in this specification task.
Publish this specification as a GitHub issue with ready-for-agent; no further triage is required.
