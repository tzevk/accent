# Leads authenticated HTTP integration (issue #368)

Repeatable proof for the Lead workspace, the activity log, the corrections,
the lifecycle decisions, the queues, and the legacy review flow. The command
runs the real Next server against a disposable migrated MariaDB database, logs
in over real HTTP, and verifies persistence with an independent database
reader. No test-only routes, no bypasses, no mocked database proof.

**Production is MariaDB 10.11.15.** Run the harness against MariaDB, because
MySQL accepts and rejects different SQL. The local instance and its start and
stop commands are documented in `AGENTS.md` under "Local MariaDB for testing".

## Command

```sh
export INTEGRATION_DB_HOST=127.0.0.1
export INTEGRATION_DB_PORT=33369
export INTEGRATION_DB_NAME=accent_integration_369
export INTEGRATION_DB_USER=root
export INTEGRATION_DB_PASSWORD=
npm run test:integration:leads
```

The database name must contain `integration` and match `^[A-Za-z0-9_]+$`. The
host must be loopback (`127.0.0.1`, `::1`, or `localhost`) — a remote database
is always refused. The harness also refuses targets that look like development,
staging, or production, or that match any configured branch database. Set the
variables in your shell only; never add them to `.env`. See the
`INTEGRATION_DB_*` block in `.env.example`.

Expect the first run to build the full schema from the baseline migration, then
start the server and run seventy-one scenarios. On MariaDB 10.11 the whole run
takes a few minutes.

## What the run does

1. Validates the disposable target (fails closed on any unsafe name or host).
2. Creates the database with plain `CREATE DATABASE` — an existing database
   with the same name aborts the run; nothing is ever reused.
3. Migrates everything before the explicit ticket-369 lead migration.
4. Seeds run-namespaced users (`lit369-<timestamp>-creator`, `-assignee`,
   `-readonly`, `-noassign`, and `-proposer`, password `Lit369-pass!`), a
   duplicate-name tie pair, and four representative pre-migration Lead rows.
5. Applies the real ticket-369 lead migration over that evidence.
6. Seeds the legacy Proposals that link to two of those Leads: two on one
   enquiry (the duplicate case) and one on another (the evidence-backed
   case).
7. Applies the real ticket-370 legacy review migration over the seeded
   Proposals, then any later migrations.
8. Starts `next dev` on `LEADS_INTEGRATION_PORT` (default 31369) with all
   database branches pinned to the disposable database.
9. Logs each fixture user in through `POST /api/login` and keeps the real
   session cookies.
10. Runs seventy-one scenarios.

## Cleanup contract

Every non-keep run stops the server and drops the disposable database, on
success and on failure. A failed `DROP DATABASE` fails the run rather than
reporting PASS with data left behind. On Windows the whole dev-server process
tree is terminated (`taskkill /PID <pid> /T /F`) so no orphan keeps the port
or the `.next/dev` lock. `--keep` retains the server and database only after
a full pass, for manual browser follow-up.

## Scenarios

| #   | Scenario                                  | Proves                                                                                                                                                                                 |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | creator-assignment                        | Manual create defaults owner to creator, starts at New                                                                                                                                 |
| 2   | permitted-assignment                      | `leads:assign` reassignment records actor/time/prior owner                                                                                                                             |
| 3   | denied-assignment-no-mutation             | Missing grant yields 403 and persists nothing; anonymous yields 401                                                                                                                    |
| 4   | unassigned-import                         | Unknown-status CSV enters intake with review flag                                                                                                                                      |
| 5   | owner-selected-import                     | CSV with `owner_user_id` assigns that owner                                                                                                                                            |
| 6   | import-owner-evidence-never-resolves      | CSV owner column stays evidence; never auto-resolves                                                                                                                                   |
| 7   | separate-enquiries                        | Same company, distinct needs stay separate Leads                                                                                                                                       |
| 8   | duplicate-review                          | Same company + need surfaces candidates, never merges                                                                                                                                  |
| 9   | durable-reads                             | A permitted non-owner edits; read-only users see durable values and consistent filters                                                                                                 |
| 10  | legacy-evidence                           | Unique name maps; unknown/duplicate names and odd stages keep originals with review                                                                                                    |
| 11  | raw-import-evidence                       | Long legacy values and surrounding whitespace survive HTTP and database reads                                                                                                          |
| 12  | invalid-import-owner                      | Malformed owner identifiers fail without saving any Lead                                                                                                                               |
| 13  | active-import-requirements                | Active stages cannot bypass owner and next-action requirements                                                                                                                         |
| 14  | legacy-review-queue                       | Unresolved stage, owner, and duplicate Proposal links stay visible with their evidence                                                                                                 |
| 15  | legacy-review-denied                      | Missing grants yield 403 and anonymous yields 401; no decision is written                                                                                                              |
| 16  | legacy-review-invalid                     | An active stage without an owner, a foreign Proposal, and a missing reason are refused                                                                                                 |
| 17  | legacy-review-resolution                  | A permitted reviewer resolves owner, stage, and canonical Proposal with a reason                                                                                                       |
| 18  | proposal-link-guard                       | A second Proposal link to one enquiry is refused; existing links stay untouched                                                                                                        |
| 19  | proposal-link-edit                        | A link move is guarded, an unrelated edit keeps the link, and a delete clears the pointer                                                                                              |
| 20  | outreach-outcomes                         | No Answer then Connected: the first outreach moves New to Attempting Contact, a connected call moves it to Connected, and only the connected call advances the last successful contact |
| 21  | email-reply-versus-sent                   | A sent email is an attempt, a confirmed reply is contact, and the two move the Lead differently                                                                                        |
| 22  | note-only-logging                         | A note persists with its author and never moves the stage or writes stage history                                                                                                      |
| 23  | owner-and-date-refusals                   | Outreach without an owner and a first outreach without a dated next action are refused, and the refusals persist nothing                                                               |
| 24  | last-open-task-close                      | Closing the last scheduled action needs its replacement; a task of another Lead is not found and a closed task cannot be closed twice                                                  |
| 25  | no-regression                             | Routine logging keeps Qualified, Disqualified, and Converted as they are, and editing the dated next action moves the scheduled row                                                    |
| 26  | timeline-persistence                      | The timeline is chronological, separates completed from scheduled work, and survives a reload                                                                                          |
| 27  | lead-work-queue                           | The cross-Lead work queue lists the outstanding scheduled work, soonest first                                                                                                          |
| 28  | scheduled-task-completion                 | A scheduled note and a scheduled call close with their own evidence; a call still needs its outcome, and a missing reply flag is missing evidence, not a no                            |
| 29  | legacy-activity-evidence                  | The legacy dated next action became scheduled work with an unknown author and kind, and the timeline says so                                                                           |
| 30  | activity-correction                       | A correction keeps the previous values, the reason, the correcting user from the session, and the moment; the corrected activity counts once and the Lead keeps its stage              |
| 31  | denied-correction                         | A user without the Lead update right may not correct an activity (403); the refusal writes nothing                                                                                     |
| 32  | missing-reason-correction                 | A correction without a reason is refused with `reason_required`; an activity of another Lead is `activity_not_found`                                                                   |
| 33  | stale-version-correction                  | A correction of an activity that moved on is refused with `correction_conflict`; the accepted correction and every intermediate version are kept                                       |
| 34  | unowned-correction-refusal                | A correction may not turn a record into outreach on a Lead nobody owns; nothing is written                                                                                             |
| 35  | legacy-correction-provenance              | Correcting a legacy row keeps its unknown author and unknown outcome; the correction row names the person who corrected it                                                             |
| 36  | no-destructive-activity-path              | No route deletes a Lead activity, and cancelling the outstanding work keeps the activity and its correction history                                                                    |
| 37  | qualification-missing-fields              | Each missing qualification field is refused with its own code, and nothing is written                                                                                                  |
| 38  | qualification-without-budget-or-timing    | A Lead with a contact, usable contact details, and a project need qualifies without budget or timing                                                                                   |
| 39  | nurture-with-next-action                  | Nurture needs a dated next action and records an explicit stage change                                                                                                                 |
| 40  | nurture-without-next-action               | Nurture without a dated next action is refused and writes nothing                                                                                                                      |
| 41  | disqualify-without-reason                 | A disqualification without a reason is refused and writes nothing                                                                                                                      |
| 42  | disqualify-cancels-outstanding-work       | A disqualification cancels the outstanding work explicitly, keeps the recorded evidence, and leaves the work queue                                                                     |
| 43  | reopen-with-required-fields               | A reopening with a reason, an owner, and a dated next action succeeds, and the earlier disqualification stays in the timeline                                                          |
| 44  | reopen-missing-fields                     | A reopening without its reason, owner, or dated next action is refused, one field at a time                                                                                            |
| 45  | converted-lead-takes-no-decision          | A converted Lead takes no lifecycle decision                                                                                                                                           |
| 46  | generic-paths-cannot-decide-the-lifecycle | A generic edit and a CSV import cannot express a conversion or a disqualification                                                                                                      |
| 47  | lifecycle-unauthorized                    | A missing grant yields 403 and anonymous yields 401; no decision is written                                                                                                            |
| 48  | my-leads-queue                            | My Leads resolves to the authenticated owner; a client-supplied owner id never selects another person's queue                                                                          |
| 49  | unassigned-queue                          | Unassigned holds the Leads without a resolved owner, including the legacy records whose owner name could not be resolved                                                               |
| 50  | due-queue                                 | Due Today and Overdue read the outstanding scheduled work; completed and cancelled work is not outstanding; the date boundaries are the calendar days around today                     |
| 51  | untouched-queue                           | A completed note is not outreach; a completed call is                                                                                                                                  |
| 52  | no-next-action-queue                      | The active stages without a dated next action are queued, including the preserved legacy exceptions                                                                                    |
| 53  | queue-counters                            | The counters cover the whole filtered dataset on every page and match the database                                                                                                     |
| 54  | empty-queue                               | An empty queue is an empty list, not an error                                                                                                                                          |
| 55  | queue-filters                             | The owner, stage, and due-date filters work; both list routes read the same query; an unknown view is refused                                                                          |
| 56  | deleted-leads-leave-the-queue             | A deleted Lead leaves the rows and the counters                                                                                                                                        |
| 57  | conversion-permissions                    | Every missing grant is refused with 403, an anonymous request with 401, and nothing is written                                                                                         |
| 58  | conversion-qualification                  | A missing contact, contact detail, project need, or owner is refused with its own code                                                                                                 |
| 59  | conversion-stage-required                 | A Lead that is not Qualified is refused with 409 and the required stage named                                                                                                          |
| 60  | conversion-handoff                        | One canonical Proposal, the Lead marked Converted, the evidence, the stage history, and the transferred work with a link in both directions                                            |
| 61  | conversion-repeat                         | A repeated handoff returns the same Proposal and writes nothing a second time                                                                                                          |
| 62  | conversion-concurrent                     | Two simultaneous handoffs produce one Proposal, one evidence row, and one destination task                                                                                             |
| 63  | conversion-legacy-conflict                | An unresolved canonical Proposal is refused with a review conflict, and the alternatives stay                                                                                          |
| 64  | conversion-rollback                       | A database failure during the handoff rolls the Lead, the Proposal, the task, and the history back; the retry creates nothing twice                                                    |
| 65  | conversion-read-and-queue                 | The Lead reads as Converted, the transferred work left the Lead work queue, and the conversion is on the timeline                                                                      |
| 66  | proposal-progress-missing                 | An enquiry without a Proposal reports no downstream details, and the Lead itself stays readable                                                                                        |
| 67  | proposal-progress-unresolved              | An enquiry with several linked Proposals and no canonical choice stays unresolved; no Proposal is guessed and the alternatives stay                                                    |
| 68  | proposal-progress-current-state           | The current Proposal status, progress, and value reach the Lead detail read, the next action is the Proposal's, and the completed Lead history stays visible                           |
| 69  | proposal-progress-project-link            | The later Project link resolves through the canonical link, and the Proposal and the Project name each other in the database                                                           |
| 70  | proposal-progress-restricted              | A reader with only `leads:read` gets the Lead, its history, and the restricted marker, and no Proposal title, status, value, or Project information                                    |
| 71  | proposal-progress-work-on-proposal        | The Lead refuses new Lead-side sales work, and the transferred task is Proposal work with the link in both directions                                                                  |

Every scenario asserts both the HTTP response and the persisted row through
the independent reader (`mysql2` connection owned by the harness, never the
app pool).

## Keep mode (manual browser follow-up)

```sh
npm run test:integration:leads -- --keep
```

or `LEADS_INTEGRATION_KEEP=1`. After a full pass the server stays up and the
database is kept. The harness prints the fixture usernames and password. Stop
with Ctrl+C, then drop the database manually. The port stays 31369 unless
`LEADS_INTEGRATION_PORT` overrides it.

## CI

`checks.yml` runs the same command against a MariaDB 10.11 service, the
engine production uses. The service creates no database, because the harness
creates and drops its own. No secrets beyond the ephemeral service password,
which lives only in the workflow.

## Troubleshooting

- `missing required integration database variables`: export all five
  `INTEGRATION_DB_*` variables in your shell.
- `refusing target ...`: rename to a disposable database containing
  `integration`; never point the harness at a real branch database.
- Migration failures abort the run and the harness drops the half-migrated
  database automatically; fix the cause and rerun with a fresh name.
- `server ... never became healthy`: another process may hold 31369; set
  `LEADS_INTEGRATION_PORT` to a free port.
- `ticket-369 lead migration ... missing from migrations/`: the harness pins
  `migrations/20261019120000_lead_owner_stable_reference.ts` explicitly. If the
  backend replaces it, update `LEAD_MIGRATION_FILE` in
  `scripts/leads-integration/runner.ts`.
- `ticket-370 legacy review migration ... missing from migrations/`: the
  harness pins `migrations/20261019130000_lead_legacy_review.ts` the same
  way. Update `LEGACY_REVIEW_MIGRATION_FILE` in
  `scripts/leads-integration/runner.ts`.
- `refusing to reuse existing database ...`: drop the named database manually
  (or pick a fresh `INTEGRATION_DB_NAME`); the harness never reuses one.

## Verification record — 2026-10-20

- Local environment: Windows, MariaDB 10.11.15 (matching production), Node 26.2.0. The CI job targets Node 24; CI execution is not claimed here.
- `npm run test:integration:leads`: all seventy-one scenarios pass against the real application and an independent database reader on MariaDB 10.11.
- `npm run verify`: lint and production build pass; the Vitest suites and tests of the Lead feature pass with the rest of the repository.
- `npm run check:route-auth`: every handler authorizes, with the existing allowlisted paths.
- The baseline migration applies unchanged on MariaDB 10.11, so no reordering of the production snapshot was needed.
- The ticket-370 migration runs over the seeded legacy Proposals: one enquiry with a single linked Proposal is auto-resolved and recorded, one with two stays a visible conflict with both Proposals and their links intact.
- The ticket-371 migration renames the legacy follow-up table to the activity log, keeps the legacy rows as evidence with an unknown author and outcome, and turns the legacy dated next actions into scheduled work.
- The ticket-371 migration is idempotent (a second `up()` over the migrated schema changes no row) and reversible (`down()` recreates the legacy table and copies the rows back).
- The scenarios spread their requests over the fixture sessions because the application rate-limits every session at 120 API requests a minute (ADR-0013).
- The conversion rollback is proven with a MariaDB `BEFORE INSERT` trigger on `proposal_followups` that the harness arms and removes inside the disposable database. It fails the second follow-up insert, so the rollback has to undo a task that the failed transaction had already written. The retry afterwards creates one Proposal, one evidence row, and two destination tasks — never a duplicate.
- The six downstream scenarios prove the current Proposal state and the later Project linkage through the canonical link, the completed Lead history, the restricted reader, and the Proposal work, against MariaDB 10.11.
- Browser smoke of the activity log: keyboard-driven activity entry, the call outcome, the scheduled next action, the automatic New → Attempting Contact movement, the visible "A call needs its outcome." refusal, the chronological timeline, and "Last successful contact" still empty after a No Answer.
- Browser smoke of the legacy review: resolving a legacy owner and stage in the review panel, and the retained original values, the decision, the reviewer, and the time afterwards.
- A read-only browser user sees no edit, delete, import, or assignment-directory controls.
- Independent SQL reads confirm the browser's owner, stage, edited city, original import values, ownership actors/times, and the recorded review decisions.
- The command rejects a remote database host before opening a connection.
