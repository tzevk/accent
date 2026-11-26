# Verification map

Find existing proof for an Accent outcome before choosing a check. Each row
points at a maintained file, spec, or scenario selector and the observable
result it proves. Rows describe coverage, not a recorded run.

Canonical selection and ownership rules live in
[testing and verification](../../CODING_STANDARDS.md#testing-and-verification).
Read [reliability checks](reliability-checks.md) for diff-triggered checks and
[local database operations](local-database.md) before touching a database or
browser.

## Layers and ownership

| Layer          | Command                       | Owns                                                                                                                                                           |
| -------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/logic     | `npm run test:unit -- <file>` | Fast local proof of rules, calculations, and contracts. Add `-t "<name>"` to narrow within the file; use `npm test -- <file> --watch` for an interactive loop. |
| HTTP + MariaDB | `npm run test:integration`    | Real Next server, real HTTP, disposable MariaDB, independent row reads. See the [Leads guide](../app/leads/integration.md).                                    |
| Browser        | `npm run test:e2e`            | Critical journeys in GitHub Actions. Local runs are authorized debugging exceptions, not a completion gate.                                                    |

The integration harness refuses non-loopback hosts and unsafe database names,
creates its database, and drops it on exit. Never point it at development,
staging, or production. Browser runs use only the owned harness in
`scripts/e2e/`; do not call `npx playwright test` directly.

An authorized local browser focus consumes the harness option and then passes
Playwright arguments:

```sh
npm run test:e2e -- --local-run-reason "<why this journey needs a browser>" --grep "<test title>"
```

Only GitHub Actions receives reason-free execution. Keep the `INTEGRATION_DB_*`
values in the shell, never in `.env`, and stop the local MariaDB instance when
the authorized work ends.

## Payroll browser and runtime outcomes

The maintained Playwright specs live in [`e2e/specs/`](../../e2e/specs/). CI
selects the whole suite; the `--grep` values below narrow an authorized local
run. The salary contention spec uses the same owned database and server but
drives the exported salary seams over real connections, not a browser.

| User/domain outcome                                                                                                                                                                                                                             | Selector                                                                                                        | Expected result                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A payroll reader sees current attendance beside the recorded Payroll Slip money. Amounts are not repriced from attendance.                                                                                                                      | [`payroll-review.spec.ts`](../../e2e/specs/payroll-review.spec.ts) — `--grep "payroll review separates"`        | Test passes. Company sheet shows Total Days `31.00`, Days Present `5.50`, GROSS `₹44,000.00`, TOTAL DED `₹5,275.00`, NET SAL `₹38,725.00`; details show LWP `2.50`, MLWF `₹25.00`, other deductions `₹1,250.00`; the slip document opens. The stored rows and the no-payroll-write guard are unchanged.                                  |
| A payroll editor creates an agreement, corrects an unused one under a stale-version conflict, generates payroll, then meets use protection, a dated revision, cancellation, an explicit zero, read-only access, and the dirty-navigation guard. | [`salary-profiles.spec.ts`](../../e2e/specs/salary-profiles.spec.ts) — `--grep "salary profiles support"`       | Test passes. Each phase's database read matches its authored expectation; a payroll-used agreement blocks editing and offers a revision; the earlier slip and leave summaries stay unchanged; the zero agreement stays zero; a read-only user gets the view without edit controls; abandoning a dirty editor writes nothing.             |
| Concurrent salary writes serialize on the agreement, not on timing luck.                                                                                                                                                                        | [`salary-contention.spec.ts`](../../e2e/specs/salary-contention.spec.ts) — `--grep "salary profile contention"` | All spec cases pass using observed InnoDB lock waits: correction-vs-generation resolves to one committed agreement, one expected version accepts one different-month mutation, slip deletion and run reopen cannot unlock a used month, failed audit/use writes roll back, and legacy onboarding cannot backdate a historical agreement. |

The full harness run satisfies `npm run test:e2e` only when every selected test
reports passed and the owned cleanup exits cleanly. Failure artifacts belong in
ignored `e2e/artifacts/`; open them with `npm run test:e2e:report`.

## Work Period timesheet outcome (#468)

This row records the agreed #468 journey and its intended selector in the
existing CI-owned Employee time spec. It is not evidence of a completed run.

| User/domain outcome                                                                                                                                                 | Selector                                                                                                                           | Expected result                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An Employee logs one finished overnight Work Period and sees its hours on the dates worked in My Timesheet, while historical duration-only history stays unchanged. | [`employee-time.spec.ts`](../../e2e/specs/employee-time.spec.ts) — `--grep "work period reaches My Timesheet across IST midnight"` | After real sign-in and form save/reopen, fixed IST endpoints produce the authored daily and monthly totals across midnight. One row retains both endpoints and appears in both overlapped weeks with only each week's elapsed share; quantity is credited once on Date Completed, and the legacy duration is unchanged. |

## Money, salary, and calendar invariants

Property tests state the rule independently of the implementation. A failure
prints the `fast-check` seed and path, which must be kept with the fix.

| Domain outcome                                                                                                                                                   | Selector                                                                                                                                    | Expected result                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money arithmetic stays exact at the decimal boundary: rounding, addition, subtraction, percentages, and integer conversion.                                      | [`money.property.test.ts`](../../src/lib/money.property.test.ts) — `npm run test:unit -- src/lib/money.property.test.ts`                    | Properties pass: exact decimal round-trip, commutative and associative addition, subtraction reversed by addition, a 0–100% share never exceeds its amount, rupee rounding is idempotent and within half a rupee, and safe integers convert without loss. |
| CTC resolution prefers a valid canonical employer cost, never substitutes a legacy gross for an invalid canonical value, and treats an explicit zero as present. | [`salary-ctc.property.test.ts`](../../src/lib/salary-ctc.property.test.ts) — `npm run test:unit -- src/lib/salary-ctc.property.test.ts`     | Properties pass: canonical wins, invalid canonical is `invalid` with no fallback, legacy gross is used only when canonical CTC is absent, and every resolved amount stays inside the database range.                                                      |
| The company weekly-off calendar is every Sunday plus the 2nd and 4th Saturday, and nothing else.                                                                 | [`weekly-off.property.test.ts`](../../src/utils/weekly-off.property.test.ts) — `npm run test:unit -- src/utils/weekly-off.property.test.ts` | Properties pass across 2000–2035: the policy oracle matches every date, junk and impossible date keys are false, and the answer is deterministic.                                                                                                         |
| Weekly Off/Holiday days bracketed by leave convert to that leave code; the conversion is order-independent, idempotent, and limited to maximal bracketed runs.   | [`sandwich.property.test.ts`](../../src/utils/sandwich.property.test.ts) — `npm run test:unit -- src/utils/sandwich.property.test.ts`       | Properties pass: only off days convert to a leave code, insertion order does not matter, write-back is idempotent, a directly bracketed off day converts, only maximal bracketed runs convert, and converted days list in ascending order.                |

## Leads HTTP outcomes

The harness runs the real application against a disposable migrated MariaDB
database, logs in over HTTP, and checks both the response and persisted rows.
Set the five `INTEGRATION_DB_*` variables in the shell, then select one
scenario by name:

```sh
LEADS_INTEGRATION_SCENARIO=conversion-handoff npm run test:integration
```

A selected run migrates and seeds the same fixtures as a full run. It prints
`PASS <scenario>` and `PASS selected 1 scenarios`, then exits 0. The full run
prints `PASS` for every registered scenario and exits 0. The
[runner's scenario registration](../../scripts/leads-integration/runner.ts) is
authoritative for which scenarios exist; the
[guide's table](../app/leads/integration.md#scenarios) describes the intended
proof.

A scenario selector proves that one scenario. The full run covers the rest of
the outcome group. The expected results below summarize the group, not a claim
that one selected scenario proves every sentence in its row.

| User/domain outcome                                                                                                                                                                       | Representative selector                                      | Expected result                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imported and manually created Leads keep ownership, enquiry separation, duplicate review, and durable evidence.                                                                           | `LEADS_INTEGRATION_SCENARIO=creator-assignment`              | The row prints `PASS`; create, permitted/denied assignment, owner evidence, invalid owner, duplicate candidates, and read-only reads match the scenario's assertions.                          |
| Legacy Leads surface their unresolved stage, owner, and Proposal links; a permitted reviewer resolves them with a reason, and link guards never merge or guess.                           | `LEADS_INTEGRATION_SCENARIO=legacy-review-resolution`        | `PASS`; the decision, reviewer, time, and retained evidence are stored, while denied/invalid decisions write nothing.                                                                          |
| Outreach, notes, scheduled work, and their refusals keep the stage and timeline honest.                                                                                                   | `LEADS_INTEGRATION_SCENARIO=outreach-outcomes`               | `PASS`; a connected call and a confirmed reply move the Lead as specified, a sent email or note does not claim contact, and missing owner/date evidence is refused.                            |
| Corrections preserve prior values, reason, actor, and time; stale or unauthorized corrections write nothing, and no route deletes activity history.                                       | `LEADS_INTEGRATION_SCENARIO=stale-version-correction`        | `PASS`; the accepted correction and intermediate versions remain, the stale correction returns `correction_conflict`, and unauthorized attempts leave rows untouched.                          |
| Lifecycle decisions require their evidence: qualification, nurture, disqualification, reopening, conversion blocking, and permission denials.                                             | `LEADS_INTEGRATION_SCENARIO=nurture-with-next-action`        | `PASS`; each decision validates only through its allowed path, refusals persist nothing, and a converted Lead accepts no further lifecycle decision.                                           |
| Work queues resolve the authenticated owner, due dates, untouched work, counters, filters, and deleted-Lead removal on shared query paths.                                                | `LEADS_INTEGRATION_SCENARIO=queue-filters`                   | `PASS`; owner/stage/due filters return the same dataset as both list routes, unknown views are refused, and counters match the database.                                                       |
| A Qualified Lead converts once into one canonical Proposal with bidirectional links; repeat/concurrent/rollback paths stay single, and downstream Proposal progress respects permissions. | `LEADS_INTEGRATION_SCENARIO=conversion-handoff`              | `PASS`; one Proposal, conversion evidence, stage history, and transferred work exist with links both ways; repeat and concurrent calls add nothing; restricted readers see no Proposal detail. |
| A Proposal delete recomputes the stored canonical choice from live links, never guessing or merging.                                                                                      | `LEADS_INTEGRATION_SCENARIO=proposal-canonical-differential` | `PASS`; the stored canonical Proposal and conflict flag match an independent rule over the live linked rows.                                                                                   |
| Lead Audit intake, current state, conversion, timing, work, audit, print, and export report separate system-entry and Enquiry Date evidence with deterministic filters and pagination.    | `LEADS_INTEGRATION_SCENARIO=lead-audit-intake`               | `PASS`; the selected slice's counts, boundaries, labels, permissions, and register order match the scenario, and imports count at entry.                                                       |

## Other browser journeys

The suite now covers session, quotation, cash voucher, Lead conversion, salary,
sales, procurement, finance, attendance, leave, payroll, collaboration, access
management, and reporting outcomes. The maintained list, selectors, and the
documented UI boundaries live in [`e2e/README.md`](../../e2e/README.md).

Each spec asserts the result a person sees and, for persisted outcomes, reads
the stored rows independently. `npm run test:e2e` runs every registered spec in
its own disposable runtime group.

The former Quotation and Voucher gaps are closed:

| Outcome                                                                                   | Selector                                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A standalone quotation saves and reopens with the authored client, scope, and GST totals. | [`quotation.spec.ts`](../../e2e/specs/quotation.spec.ts)       |
| A cash voucher saves a payee and paise line, then reopens from the register.              | [`cash-voucher.spec.ts`](../../e2e/specs/cash-voucher.spec.ts) |

Unreachable UI is listed under Boundaries in `e2e/README.md`; do not claim those
journeys as covered until the application exposes them.

## Maintaining this map

- Keep one row per observable outcome. Split a row when its selector no longer
  maps to one result.
- Use a maintained command, spec, or test name. Remove a row when its file is
  deleted; do not keep historical counts as current coverage.
- Browser rows stay CI-owned. Local commands are marked as debugging aids, not
  routine verification.
- Add a row for every maintained browser spec with its user-visible result in
  `e2e/README.md`; this map only calls out payroll detail and cross-layer rules.
