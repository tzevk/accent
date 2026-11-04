# Lead Audit Excel export

The Lead Audit and Performance report offers a complete authenticated Excel
workbook for the applied scope. The workbook is a live evidence copy, not an
immutable issued report.

- **Endpoint:** `GET /api/reports/lead-audit/download`
- **Builder:** `src/server/reports/lead-audit/export.ts`
- **Interface:** the Export Excel action in `src/app/reports/lead-audit/export-action.tsx`

## Authorization

| Reader                                      | Result |
| ------------------------------------------- | ------ |
| Anonymous                                   | `401`  |
| Missing `reports:read` or `leads:read`      | `403`  |
| Both read grants but no `reports:export`    | `403`  |
| `reports:read`, `leads:read`, `reports:export` | `200` |
| Super admin                                 | `200` (existing bypass) |

The download re-checks access on the server; the button gate is not an access
control. A report reader without the export grant cannot call the endpoint
directly. Proposal details additionally need `proposals:read`, and Project
details need `projects:read`; denied facts are absent from the workbook and
their state reads `Restricted`.

## Workbook contents

One observation covers every sheet: a single read-only connection and one
database clock. Each sheet carries its own population note.

- **Summary and methodology:** generation time, actual reporting time zone,
  database calendar day, selected preset and inclusive dates, every date
  basis, applied filters, metric definitions, headline figures, a
  reconciliation table, coverage exclusions, and the live-data warning. It
  states that the workbook is an evidence copy and need not equal an earlier
  screen observation.
- **Lead intake register:** the complete applied population for Leads
  recorded, plus separate complete sheets for Enquiries dated in period and
  Missing Enquiry Dates.
- **Sources:** recorded Leads grouped by the exact stored source label,
  including `Unknown source`.
- **Completed work:** every completed activity row behind the period figure.
- **Work by recorded author:** completed work grouped by recorded author,
  with `Unknown author` and retained inactive accounts preserved.
- **Current-owner workload** and **Workload Leads:** present ownership at the
  observation time, one row per distinct Lead.
- **Current operational exceptions:** the five existing queue populations,
  labelled as current state at observation time rather than a period backlog.
- **Cohort conversion:** cohort and period conversion figures, downstream
  state counts, current stage distribution, and source cohorts.
- **Period handoffs:** the dated handoff rows behind the period count.
- **Downstream context:** permitted Proposal and Project fields; restricted
  context is stated as `Restricted`, never as absent or empty.
- **Time to first outreach:** median, nearest-rank 90th percentile, coverage
  counts, exclusions, and one row per cohort Lead.
- **Audit evidence:** structured evidence selected by recording time, with
  occurrence time, actor, and permission-controlled downstream state.
- **Corrections:** correction references and changed fields, plus values only
  in a detailed export.
- **Deleted evidence:** retained deleted-record evidence, separately labelled
  and outside every operational total. Deletion actor and time stay `Unknown`.
- **Coverage and exclusions:** unknown-fact counts, metric exclusions, history
  limits, and disclosures.

## Reconciliation

Every summary figure is read from the same section reader that produced its
detail rows. The workbook never re-aggregates with independent SQL, so a
one-to-many activity or Proposal join cannot inflate a distinct-Lead total.
The Summary sheet compares each reported figure with the number of detail rows
exported under the same observation, for example:

- Leads recorded against intake register rows;
- completed work against completed activity rows and author totals;
- workload total against workload Lead rows;
- each queue count against distinct detail Leads;
- cohort handoffs against cohort rows with evidenced handoffs;
- period handoffs against dated handoff rows;
- audit evidence against audit rows;
- deleted evidence against retained deleted rows.

Each comparison states whether it reconciles.

## Narrative privacy

Detailed evidence is off by default. `include_narrative=1` (or
`include_detailed_evidence=1`) adds it, and only after the same read and
export checks. With the choice off, every sheet excludes:

- activity notes and next actions;
- lifecycle and legacy-review reasons;
- correction reasons and both previous and corrected values, including those
  nested in correction history;
- any other free-text audit narrative.

The workbook projects rows through `evidence-privacy.ts`, which is the only
module that turns a narrative read into export fields. A row still reports
whether narrative exists and whether it was withheld; the text itself is
absent. User text is always written as a text cell, so a value such as
`=1+1` stays literal text and never becomes an executable formula.

## Limits

- The export is a copy of live corrected facts at its own generation time.
  It does not promise equality with an earlier screen observation, and two
  downloads can legitimately differ.
- It exposes the evidence the system stores. Generic enquiry edits,
  rescheduling, and some historical stage changes lack a complete change log,
  so it is not a compliance-grade audit trail.
- There are no public links, automatic email delivery, server-generated PDFs,
  or retained report snapshots. Users can print the interactive report and
  save a PDF through the browser.
