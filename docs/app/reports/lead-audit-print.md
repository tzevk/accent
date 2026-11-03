# Lead Audit and Performance: printing the management summary

The Lead Audit and Performance report provides a printable management
summary for meetings and audit packs. Printing uses the browser's own print
dialog; the report does not generate a server-side PDF.

**UI:**

- `src/app/reports/lead-audit/print-summary.tsx` — the printable summary
  document, rendered from the already-authorized report body.
- `src/app/reports/lead-audit/print-action.tsx` — the secondary Print action.
- `src/app/reports/lead-audit/print-styles.ts` — the print-only stylesheet,
  exported as the `leadAuditPrintStyles` string.
- `src/app/reports/lead-audit/figures.ts` — shared count, rate, share, and
  elapsed-duration formatting used by the summary and the timing and
  conversion views.

## Print action

`PrintAction` renders one secondary button labelled **Print summary**. It
calls `window.print()` and nothing else: no popup window, no PDF service, no
download endpoint, and no `reports:export` requirement. It is disabled while
the report is loading, has failed, or has returned no body, so an incomplete
report cannot be printed as if it were the management summary.

## What is printed

The summary is a document, not a screenshot of the interactive report. It
carries:

- generation time, reporting time zone and UTC offset, and the live-data
  warning;
- the reporting period, date basis, and every applied filter, including the
  evidence filters the page holds;
- intake: Leads recorded by system entry, separately dated Enquiry counts,
  missing Enquiry Dates, and distinct stored source labels, each with its own
  date basis;
- completed work by activity type, Lead Outreach, successful contact, call
  and email outcomes, and corrected activity counts;
- work coverage and exclusions: unknown occurrence dates, unknown or inactive
  authors, missing outcomes, cancelled work, and excluded deleted activity
  rows;
- cohort outcomes: the full cohort denominator, evidenced handoffs, the Lead
  Cohort Conversion Rate, dated period handoffs, undated canonical links,
  unresolved links, Converted labels without evidence, and no-handoff Leads;
- downstream permission states only: available, restricted, unresolved, and
  no downstream record. No Proposal or Project title, status, or progress is
  printed;
- time to first outreach: median, nearest-rank 90th percentile, valid
  samples, cohort size, Lead count without evidenced outreach and its share,
  and every exclusion count;
- current-owner workload, labelled as present responsibility rather than
  activity authorship;
- current operational risks, labelled as current state at observation time
  and explicitly not a period-end backlog. The selected reporting period is
  named as not applied;
- essential definitions, material exclusions, retained deleted-record counts,
  history limits, recent-cohort maturity, and the live-correction warning.

The summary prints no navigation, filter controls, action buttons, evidence
tables, paginated registers, or narrative notes. Table headings live in
`thead`, so browsers repeat them when a table spans pages. Figures use
semantic text and percentage widths, so nothing clips at narrow widths or
increased zoom.

## Wrapper contract

The page mounts the summary component once, inside the report layout:

```tsx
<PrintSummary report={report} applied={applied} />
```

`PrintSummary` renders its own `lead-audit-print-root` wrapper and injects the
print stylesheet itself, so no other print plumbing is required. The print
rules remove every element outside that wrapper and its ancestor chain. Its
props are:

- `report: LeadAuditReport` — the same report body the page already loaded
  and authorized;
- `applied: LeadAuditFilterDraft` — the applied toolbar draft, including the
  evidence filters, so the printed effective filters match the screen.

`PrintAction` props are `disabled?: boolean` and `disabledReason?: string`.
Pass `disabled` while the report query is loading, failed, or returns no body.

## Permissions

Printing needs the same grants as viewing the report: `reports:read` and
`leads:read`, or the existing super-admin bypass. It does **not** need
`reports:export`. Proposal values still need `proposals:read` and Project
values still need `projects:read`; denied downstream context prints as
Restricted, never as an absent record. The summary never renders a restricted
Proposal or Project value, because the server removes those fields before the
page receives them and the summary prints only aggregate permission states.

Browser printing cannot prevent copying, screenshots, or re-sharing of
authorized visible figures. It is a presentation convenience, not a
disclosure control. `reports:export` governs the Excel workbook, not the
browser print dialog.

## Limitations

- The printed page is one observation at its generation time. The report is
  live and correction-sensitive, so a later print or Excel download can
  legitimately differ; no frozen issued figures are implied.
- Current risks describe live state at the observation time. A historical
  period selection never reconstructs a historical backlog or historical
  overdue rate.
- Browser print output, page breaks, repeated table headings, and browser PDF
  saving must be checked manually in a real browser by the parent integration
  owner at 320-pixel width, at 200 % zoom, and with both a populated report and
  an empty or incomplete-coverage report. This document records the intended
  print surface and limitations; it claims no executed print or PDF checks.

## Automated coverage

`scripts/leads-integration/scenarios/report-print.ts` exports
`leadAuditPrintScenario`. It uses the existing authenticated HTTP harness and
disposable MariaDB to prove the summary populations the printout depends on:
intake and Enquiry Date counts, period work and contact separation, cohort
denominator with unresolved and undated counts, timing coverage, current-risk
queue rules under a historical period, and that a reader without
`proposals:read` or `projects:read` receives Restricted rather than any
downstream value. It adds no browser test.
