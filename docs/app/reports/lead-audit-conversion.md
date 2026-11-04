# Lead Audit and Performance — cohort and conversion (#402)

## Scope

This slice adds cohort progress, source-level conversion, dated period
handoffs, the current stage distribution, and permission-controlled
downstream Proposal and Project context to the Lead Audit report.
Lead Conversion means Proposal handoff, never a sale won.

The main report response composes the section as `data.conversion`. The
The drill-down evidence is its own authenticated read at
`GET /api/reports/lead-audit/conversion/evidence`, and the section is also
available directly at `GET /api/reports/lead-audit/conversion`.

## Metric contract

| Figure | Population | Date basis | Disclosure |
| --- | --- | --- | --- |
| Cohort Leads | Distinct non-deleted Leads first recorded in the period under the applied filters | `created_at` inside the period | Observed at the generation time |
| Evidenced handoffs | Cohort Leads with a recorded conversion event or an evidence-backed, resolved canonical Proposal link | Handoff evidence is dated by the recorded event only | Handoffs after the intake period count |
| Lead Cohort Conversion Rate | Evidenced handoffs divided by the full cohort | Same observation time | `Not applicable` for an empty cohort; never zero percent as a substitute |
| Undated canonical links | Cohort Leads with a resolved canonical link and no recorded conversion time | No date | Cohort evidence only; never a period handoff |
| Unresolved links | Cohort Leads with live linked Proposals and no canonical choice | No date | Evidence gap, not a confirmed failure |
| Stage-label-only claims | Cohort Leads labelled Converted with no event and no resolved canonical link | No date | A label alone is not a handoff |
| Dated period handoffs | Distinct non-deleted Leads with an authoritative recorded conversion time in the period, including Leads recorded earlier | `lead_conversions.converted_at` inside the period | Never divided by period intake; undated links excluded |
| Source conversion | Cohort Leads grouped by the exact stored source label | `created_at` inside the period | Labels preserved byte for byte; missing labels are Unknown source |
| Current stage distribution | Cohort Leads grouped by their present `enquiry_status` | Present state at the generation time | Not a funnel and not proof of historical transitions |

Proposal creation and Lead editing times are never substituted for a
conversion date. A retained conversion event stays evidence when the
downstream link later changes.

## Evidence resolution

The section reads one derived Lead row per Lead: the earliest recorded
conversion time, an in-period handoff flag, the count of live linked
Proposals, and the resolved canonical Proposal id.

- The stored `leads.canonical_proposal_id` wins while that Proposal still
  links to the enquiry and is live.
- An enquiry with exactly one live linked Proposal is evidence-backed when
  no stored choice exists.
- An enquiry with several live linked Proposals and no stored choice is
  unresolved.
- A Proposal claimed as another enquiry's canonical Proposal does not resolve.

This is the same resolution the converted-Lead progress read uses, so the
report and the workspace cannot disagree about which Proposal is canonical.

The evidence states are mutually exclusive and partition the cohort:
`conversion_event`, `canonical_link`, `unresolved_link`, `stage_only`, and
`none`.

## Authorization and redaction

The evidence route requires `getCurrentUser`, both `reports:read` and
`leads:read`, or the established super-admin bypass. It then resolves two
independent downstream grants:

| Reader | Proposal | Project |
| --- | --- | --- |
| Report access only | Restricted | Restricted |
| `proposals:read` only | Available | Restricted |
| `projects:read` only | Restricted | Restricted |
| `proposals:read` + `projects:read` | Available | Available |
| Super admin | Available | Available |

Denied Proposal fields are absent from the response, not hidden markup: no
Proposal id, title, status, progress, or Project field crosses the boundary.
A restricted reader still receives the Lead-side handoff evidence and the
`Restricted` state. `Restricted` is never presented as "No Proposal" or
"No Project".

## Routes

`GET /api/reports/lead-audit/conversion` returns the section. Shared report
filters apply: `preset`, `from_date`, `to_date`, `owner`, `source`,
`source_missing`, `stage`, `priority`, `search`.

`GET /api/reports/lead-audit/conversion/evidence` returns the paginated
drill-down and accepts the same shared filters plus:

- `evidence`: `all` (default), `handoff`, `period`, `undated`, `unresolved`,
  `stage_only`. `undated=1` is accepted as an alias for `evidence=undated`
  when `evidence` is absent.
- `page`, `limit` (1–100, default 25).
- Unknown evidence kinds return `422` with code
  `invalid_conversion_evidence`. Shared filter validation codes are reused.

The evidence response returns `scope`, `meta`, the evidence descriptor,
rows, pagination, `downstream_options`, the section filter scope, and
disclosures. Ordering is deterministic: `created_at DESC, id DESC`, except
the period population, which orders by authoritative conversion time.

The activity and audit filters (`actor`, `activity_type`, `outcome`,
`event_type`) do not narrow conversion evidence; the section discloses them
as not applied. The section's effective filter list contains only the shared
filters that were actually applied.

## Server module

`src/server/reports/lead-audit/`

| File | Responsibility |
| --- | --- |
| `conversion.ts` | Section read, paginated evidence read, complete export read, downstream resolution, disclosures |
| `conversion-types.ts` | Section vocabulary, reusing the existing Proposal/Project link states |
| `conversion-filters.ts` | The closed `evidence` vocabulary and its named validation code |
| `../api/reports/lead-audit/conversion/route.ts` | Authenticated section read |
| `../api/reports/lead-audit/conversion/evidence/route.ts` | Authenticated evidence read |

Reads accept the caller's shared connection and clock:
`readLeadAuditConversionSection(db, filters, clock, options)` and
`readLeadAuditConversionEvidenceSection(db, filters, clock, evidence,
pagination, options)`. The complete export read is
`readLeadAuditConversionRows(db, filters, options)`; it returns all matching
evidence on the same passed connection and never forces an export through
HTTP pagination. The section uses four set-based reads (cohort aggregate,
source groups, stage groups, period aggregate) and never queries per Lead.

## Presentation

`src/app/reports/lead-audit/views/conversion-view.tsx` has two variants:

- `summary` for Overview: cohort cards, source conversion, current stages,
  downstream permission states, and the section disclosures.
- `detail` for Intake and sources: the same plus the paginated evidence table
  with the canonical Proposal and Project context, an explicit failed-read
  state, and a separate empty state.

The component holds no applied-filter state. Selecting a cohort figure calls
`onSelectEvidence(evidence)`, and the page keeps the applied query and
evidence page. Restricted Proposal and Project cells say so explicitly; the
Lead identity, source, stage, recorded date, evidence state, and conversion
date stay visible.

## Coverage limits

- The cohort is a live population observed at the generation time. Repeating
  the report later can change it when Lead facts, Proposal links, or
  conversion evidence change.
- Deleted Leads and their retained conversion evidence stay outside
  operational conversion figures and belong to the separate deleted-record
  audit population.
- Recent cohorts have had less time to progress; the report states the
  observation time and warns against comparing unequal maturity directly.
- Undated links are disclosed as evidence gaps. The report does not infer a
  conversion date from Proposal creation or Lead editing.
- Source labels remain free text. Labels are not normalized, merged, or
  rewritten, and missing labels remain Unknown source.
- The report introduces no revenue attribution, no sales-win definition, and
  no change to conversion workflows.

## Verification

The authenticated HTTP scenario is
`scripts/leads-integration/scenarios/report-conversion.ts`, exported as
`leadAuditConversionScenario` and run through the existing disposable
MariaDB harness. It seeds Leads, Proposals, Projects, and conversion evidence
directly with explicit times, then asserts through HTTP:

- cohort, handoff, undated, unresolved, stage-only, and no-evidence counts;
- after-period handoffs in cohort progress but not in the period count;
- an undated canonical link in cohort evidence but not in period handoffs;
- a retained conversion event after the canonical link changed;
- Proposal creation dates inside the period that do not become conversions;
- exact source labels, case and whitespace variants, and Unknown source;
- current stage distribution over the full cohort;
- empty cohorts with `Not applicable` and no fabricated rates;
- applied filters, ignored activity filters, deterministic pagination, and
  full-result totals;
- independent `proposals:read` and `projects:read` combinations, payload
  redaction, and the super-admin bypass;
- 401 anonymous and 403 without both report grants;
- unchanged Lead, Proposal, and conversion rows after every read.

The scenario reads every fixture figure independently; the report is never
its own oracle.
