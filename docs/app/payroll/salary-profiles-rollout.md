# Salary Profiles migration and rollout

**Status (2026-11-16):** the schema, commands and workspace are implemented on
`integration/434-salary-profiles`. PR #454 is open and unmerged for human
review. No production migration, deployment or production database operation
has been performed or is authorized by this documentation. This guide records
the procedure an authorized operator must follow; it is not evidence that the
procedure has run against production.

The operator-facing workflow is in the
[Payroll operator guide](operator-guide.md#salary-profiles-workspace). This
guide covers the part that changes a real database: what the migration writes,
how to review legacy salary-use evidence, the safe cutover order, and the
rollback limits.

## What the rollout establishes

The shipped model needs four durable facts that the old salary workflow did not
provide:

1. A dated agreement history that preserves earlier terms and retained
   cancellations.
2. A per-Employee salary-timeline version for optimistic, serialized writes.
3. Per-Employee/agreement/month payroll-use evidence that survives deleting a
   draft Payroll Slip or reopening a finalized run.
4. Recorded agreement provenance and Salary Type on new Payroll Slips, plus
   audit actions that distinguish correction, revision and cancellation.

The migration never rewrites an existing agreement, slip, roster or salary
audit row. It adds schema and writes only the new use evidence and timeline
version rows. Ambiguous legacy payroll history stays visible as ambiguity; it is
never converted into a guessed agreement link.

## Schema migration

The live Drizzle migration is `drizzle/history/20261115140000_salary_profile_revisions.ts`.

The original filename, including its `.ts` suffix, remains the stable migration
ID in `drizzle/history/manifest.json`. The historical callbacks use the Drizzle
migration runtime; there is no active Knex migration command. On a fresh
database, `npm run migrate` executes the translated callbacks in manifest
order. On an existing database, it verifies and imports the exact applied
`knex_migrations` prefix and records Drizzle hashes without replaying those
migrations. Unknown or untracked database state fails closed. Preserve the
existing Knex history tables for audit.

Drizzle owns all future migrations. Generate a change with
`npm run migrate:make -- --name descriptive_name`, which creates an empty SQL
file. Write and review the forward MariaDB SQL, then commit it with its
journal metadata. The partial Drizzle schema is not a generation source. Do
not use schema push or batch down; correct with a forward migration and
recover from verified MariaDB backups.

It remains idempotent on MariaDB: tables, columns and indexes are checked
through `information_schema` before each change, so a partially applied target
can be re-run. It is not a substitute for a backup.

What it adds or changes:

- **Retained cancellation** — `employee_salary_profile.cancelled_at`,
  `cancelled_by`, `cancelled_reason`.
- **CTC-first agreements** — `gross` and `gross_salary` become nullable so a
  new agreement can leave legacy amounts genuinely unset. Existing recorded
  values, including zeros, are preserved.
- **Eligible start uniqueness** — a generated `eligible_start_date` plus
  `uq_employee_salary_profile_eligible_start` on
  (`employee_id`, `eligible_start_date`). Cancelled or inactive rows generate
  NULL and therefore do not block a later valid agreement from reusing a month.
  The old `unique_active_employee` index is removed.
- **Timeline lookup** — `idx_employee_salary_profile_timeline`.
- **Timeline versions** — `employee_salary_timelines`.
- **Use evidence** — `employee_salary_payroll_use`, unique per Employee,
  payroll month and source-qualified agreement. A NULL month is reserved for
  unknown-month ambiguity.
- **Slip provenance** — `payroll_slips.salary_profile_id`,
  `salary_profile_source`, `salary_type`, plus a salary-profile index.
- **Audit vocabulary** — `payroll_audit_logs.action` gains `correct`, `revise`
  and `cancel` while retaining the existing actions.

The CLI's disposable-name guard does not cover the migration commands; they
use whatever target the environment configuration selects. Confirm the host
and database identity, the backup and the migration version before running.
Never rely on a database name alone to identify a production target.

Before the window, check the target for data that would make the new unique
index fail. On the pre-migration schema:

```sql
SELECT employee_id, effective_from, COUNT(*) AS active_rows
  FROM employee_salary_profile
 WHERE COALESCE(is_active, 1) = 1
 GROUP BY employee_id, effective_from
HAVING COUNT(*) > 1;
```

A non-empty result needs payroll-owner review; the migration does not resolve
it by deleting or rewriting rows. Check `payroll_audit_logs` for action values
outside the supported enum, and size the backfill against the volume of
`payroll_slips`, `payroll_run_rosters` and `payroll_audit_logs`. Review existing
overlapping or malformed salary periods rather than fitting them into a new
shape.

## Conservative backfill

The migration backfills use evidence from recorded payroll sources only:

- `payroll_slips` with `salary_profile_id` / `salary_profile_source`
  (`legacy_slip`);
- frozen `payroll_run_rosters.members[].profile_id` / `profile_source` from
  non-deleted roster versions (`legacy_roster`);
- `payroll_audit_logs` rows whose `entity_type = 'payroll_slip'`, including
  deleted-slip audit rows, with identity read only from `old_values` /
  `new_values` (`legacy_audit`).

An exact record requires one source-qualified agreement identity that is
consistent across the sources that carry an identity for that Employee/month.
Two identities in one source, or different identities between sources, produce
an **ambiguous** row with a NULL agreement and candidate ids in
`evidence_context`. A slip or Payroll Slip audit row with a provable month but
no identity also produces an ambiguous row. Audit evidence whose month cannot be
proved is not assigned one by the migration; the CLI reports it as an
unknown-month ambiguity during review. `first_used_at` is the earliest available
evidence timestamp, falling back to the migration time.

`payroll_audit_logs` rows for `entity_type` `salary_profile` or
`salary_structure` are salary mutations, not payroll use. They are never
evidence that a month was paid.

## Reviewing a copy with the #452 CLI

The audit/backfill CLI is `scripts/payroll/salary-use-backfill.ts`. It requires
Node 24 and the migrated schema (`employee_salary_profile`,
`employee_salary_payroll_use`, `employee_salary_timelines`, `payroll_slips`,
`payroll_audit_logs`). It refuses to run against an unmigrated database.

Run it only against an approved disposable loopback copy. Set the environment
in the shell, never in `.env`:

```powershell
$env:INTEGRATION_DB_HOST = '127.0.0.1'
$env:INTEGRATION_DB_PORT = '33369'
$env:INTEGRATION_DB_NAME = 'accent_434_rollout_integration'
$env:INTEGRATION_DB_USER = 'root'
$env:INTEGRATION_DB_PASSWORD = ''

# Read-only review (default); no writes.
node --experimental-strip-types scripts/payroll/salary-use-backfill.ts

# Optional focus; repeatable.
node --experimental-strip-types scripts/payroll/salary-use-backfill.ts `
  --employee 45201 --employee 45203
```

The target resolver refuses non-loopback hosts, names that do not contain
`integration`, unsafe name patterns, and a name equal to configured
`DEV_DB_NAME`, `STAGING_DB_NAME` or `PROD_DB_NAME`. No target is defaulted and
the CLI never creates or drops a database.

**Disposable-target limitation.** This CLI cannot audit production in place.
Its safety guard rejects production, staging and remote targets by design. If
production data must be reviewed before cutover, an authorized operator must
create an approved disposable copy on loopback and run the CLI there. Do not
weaken the resolver or edit the script to accept an operational database.
`--apply` is likewise a disposable-copy proof, not a production migration step;
the production schema migration performs its own conservative backfill.

The default run opens a read-only transaction and reports `mode: "dry-run"` with
`apply: null`. `--apply` records only durable use evidence through the shared
store helpers; it never edits agreement terms, deletes history or invents an
exact link. Use `--apply` on the disposable copy first, then repeat it. The
second run must report zero newly recorded rows and must not advance timeline
versions.

Interpreting the JSON report:

- `audit.agreements.overlaps` — active overlapping periods for review.
- `audit.agreements.missing_canonical_ctc` and
  `invalid_canonical_ctc` — agreements that cannot supply a usable explicit
  CTC, with any positive legacy fallback disclosed.
- `audit.agreements.zero_ctc_with_positive_legacy_gross` — explicit zero CTC
  beside a positive legacy gross. This is a review contrast; neither value is
  rewritten.
- `audit.evidence.source_counts` — slip, roster, Payroll Slip audit,
  deleted-slip audit and unattributed counts, plus ignored salary-mutation
  audits.
- `audit.evidence.units` — exact and ambiguous units. Ambiguous reasons include
  `unproven_legacy_provenance`, `conflicting_legacy_provenance` and
  `unproven_legacy_month`; an exact unit also carries `ambiguous_prior` when
  another ambiguity covers the same Employee. A NULL month blocks every month
  for that Employee until reviewed.
- `audit.summary` — exact, ambiguous, unknown-month, already-protected and
  ambiguous-prior counts.
- `apply.summary` — attempted, recorded, already-recorded and timeline-advance
  counts.

The ledger's unique key makes replay idempotent: duplicate evidence is a no-op,
the first row is immutable, and the timeline version advances only when a new
row is created. The migration preserves the earliest recorded evidence
timestamp. Evidence created by the CLI uses the apply time as the ledger's
`first_used_at` and keeps the source timestamps in `evidence_context`; this is a
current CLI limitation, not a reason to hand-edit history.

## Cutover order

Application deployment and database migration are separate operations. A build
or Vercel deployment must never apply a production migration.

1. **Close the write window.** Stop every old salary writer: Salary Profile
   edits, payroll generation and finalization, and any script or integration
   that writes salary agreements. A read-only application may stay up for
   viewing. Old writers must not run while the unique-index and audit-enum
   changes are applied.
2. **Back up the target** and record the migration version. Test the backup
   restore path before touching schema.
3. **Review on a disposable copy.** Restore or copy the target into an approved
   loopback database, apply migrations there first, run the CLI dry-run, review
   every overlap, CTC finding and ambiguity, then exercise `--apply` and repeat
   it. Keep this copy isolated with disposable credentials.
4. **Apply the reviewed migrations to the authorized target** with
   `npm run migrate:prod` and its configured production environment, only
   after the operator has explicitly selected that target. To stop at this
   rollout's reviewed historical migration, use its original filename as the
   stable `--through` ID:

   ```sh
   npm run migrate:prod -- --through 20261115140000_salary_profile_revisions.ts
   ```

   The runner verifies and imports the exact applied Knex prefix without
   replaying it, then applies pending Drizzle history through that ID. Do not
   combine migration with a build.

5. **Verify schema and migration status** before deploying dependent code:
   `npm run migrate:prod:status`, the new columns/tables/indexes, and the
   conservative evidence counts. Confirm existing agreement, slip, roster and
   audit rows were not rewritten.
6. **Deploy the application code that reads and writes the new schema.** The
   new code must not run before its columns and tables exist.
7. **Smoke read paths with a payroll-authorization identity**: directory,
   editor history, an unavailable historical period, an ambiguous row and a
   legacy fallback disclosure. Confirm an `employees:read`-only identity cannot
   open the workspace.
8. **Resume salary writes.** Then prove one create/correct/revise/cancel
   journey and one payroll generation against the new schema. A preview alone
   does not record use. Run the first real generation/finalization only after
   the reviewed maintenance window closes.

If step 4 fails, do not deploy the application code and do not attempt to
"fix" salary history in place. Restore from the verified backup and correct
the cause in a new forward migration rather than editing applied SQL or
attempting a batch down.

## Salary-write isolation

The earlier salary-write protocol used REPEATABLE READ. Concurrent inserts for
different Employees gap-locked the shared supremum of the eligible-start unique
index (and the use-ledger unique index), producing a real cross-Employee
deadlock. The integrated correction is an explicit READ COMMITTED transaction
for salary writes only; READ COMMITTED removes those gap locks without
weakening uniqueness or transaction atomicity.

The shared helper is `src/lib/salary-write-isolation.ts`; it exposes
`SALARY_WRITE_ISOLATION`, `SALARY_WRITE_ISOLATION_SQL` and
`beginSalaryWriteTransaction`, and `withTransaction` accepts
`{ isolation: SALARY_WRITE_ISOLATION }`. Every salary-write caller opts in
explicitly:

- `POST /api/payroll/salary-profile` (create, correct, revise and cancel);
- payroll generation;
- payroll finalization;
- the standalone payroll-run write lock;
- the salary-use backfill CLI's `--apply` path;
- the owned real-contention proof.

Unrelated `withTransaction` readers keep the default isolation. The protocol
keeps the per-Employee mutex, `FOR UPDATE` current reads, expected-version
conflicts and atomic audit/use writes. It deliberately adds no retry or backoff,
no global or session-wide isolation change, no worker serialization and no
queue.

**Isolation consequence:** reverting the helper or a caller's opt-in reintroduces
the eligible-start/use-index gap locks and the cross-Employee deadlock. Partial
rollback is worse than leaving the isolation explicit: every salary writer must
use the same protocol. Do not switch the database or session default as a
substitute.

**Verification status:** the protocol is implemented and integrated, with the
isolated caller set above, and proven by the owned real-contention run: on the
disposable MariaDB 10.11.15 target all six scenarios passed in 1.4 s. Each
scenario proves the loser is blocked on the Employee mutex from InnoDB's own
monitor (`LOCK WAIT` plus the blocked `SELECT ... FROM employees ... FOR
UPDATE`); MariaDB 10.11.15 does not list a first-locking-read waiter in
`INNODB_TRX`, so the isolation assertion runs whenever that row is exposed and
the post-write assertion is the operative READ COMMITTED check. The earlier
six-worker evidence remains the REPEATABLE READ deadlock that motivated the
change.

## Rollback limits

`drizzle/history/20261115140000_salary_profile_revisions.ts` has no supported
batch-down path in the Drizzle runner. The original Knex `down()` behavior
remains historical evidence, not a recovery procedure. After the feature has
been used, that rollback would:

- It would drop `employee_salary_payroll_use` and `employee_salary_timelines`,
  removing the durable use and cancellation protections.
- It would drop slip provenance columns and restore the older audit-action enum,
  losing the new provenance and audit vocabulary.
- It would restore `gross_salary` to `NOT NULL DEFAULT 0.00`, converting NULL
  gross amounts created by CTC-first agreements to `0`. That destroys the
  distinction between an unset legacy amount and an explicit zero.
- It could not reconstruct prior unique-index behavior for data written under
  the new model without review.
- Reverting the salary-write isolation helper or any caller's opt-in reintroduces
  the REPEATABLE READ gap-lock deadlock. Keep every salary writer on the explicit
  READ COMMITTED protocol if the schema is retained.

Recovery requires a verified backup that predates the change. Never use a down
migration, deletion or mass normalization to clear an ambiguity you have not
resolved.

## Verification state

Recorded verification, not a production claim:

- Parent-run source proof: the full workspace source run passed 19 cases, the
  employee/nav cutover 35, the report screens 7, the attendance/project tab 5,
  and a temporary real `EditProjectForm` smoke 4 (deleted after proof). Project
  TypeScript passed for those workspace and cutover slices; scoped lint passed
  after the recorded fixes.
- Targeted route/reader suites passed for roster/readiness/finalize (84 cases),
  slip/PDF/export (57) and directory/batch/resolve (42), with scoped lint. A
  native MariaDB 10.11.15 proof on disposable databases exercised the actual
  shared readers, command contracts, generation/finalization provenance and the
  rollout CLI. The CLI dry-run wrote nothing; a real slip, frozen roster and
  deleted-slip audit produced five units; the first apply recorded five and an
  identical second apply recorded zero with ledger and timeline versions
  unchanged.
- The #455 duplicate-replay correction is integrated; 40 store/timeline cases
  and a native duplicate-apply check passed, with the first evidence row and
  timeline version unchanged on replay.
- The Employee Utilization range view now composes salary evidence across its
  months. A range whose unpriced months disagree reads **Mixed salary causes**,
  is counted incomplete/unpriced, and is excluded from priced totals; a single
  month never reads mixed and no cause is rendered as zero.
- The owned real-contention proof (#446) is complete: six scenarios passed in
  1.4 s on the disposable MariaDB 10.11.15 target. The earlier six-worker run
  exposed a real cross-Employee supremum-gap deadlock on the eligible-start
  index under REPEATABLE READ; the explicit READ COMMITTED protocol removed it
  and the proof now observes the real `LOCK WAIT` in InnoDB's monitor.
- The owned real-auth browser journey (#447) passed in Chromium on the same
  disposable database: directory search and filters, missing versus explicit
  zero, create, same-identity correction with stale-version retention, single-
  employee generation, used protection, revision, cancellation, recorded slip
  read and the dirty browser-Back `Stay` prompt, with independent database
  readback and desktop 1440 / mobile 390 screenshots. The browser-Back guard
  (#458) is integrated and covered there. The journey refreshes its session
  between phases because the API budget is per session and the automated run is
  denser than a human session.
- No production migration, deployment, merge or production database operation
  has been performed. PR #454 remains open and unmerged.

## Escalation and unknowns

- **Ambiguous legacy identity** cannot be turned into an exact link without
  payroll evidence. Keep the ambiguity, identify the candidate rows from
  `evidence_context`, and escalate to the payroll owner and DBA. Affected
  Employee months reject timeline writes until reviewed; that refusal is the
  safeguard, not a bug to work around.
- **Unknown-month evidence** blocks every timeline write for that Employee.
  Do not guess the month from a neighboring slip or audit row.
- **Legacy-only Employees** can receive a prospective canonical agreement from
  a month boundary when the month is unused. The joining-date backdate
  exception does not apply once legacy or recorded payroll history exists.
- **Unsupported stored Salary Types** remain readable and are shown as stored
  values. A save must choose a supported type, so converting one is a deliberate
  operator decision, not a silent rewrite.
- **Production review without a disposable copy** is not supported by the #452
  CLI. Treat that as a missing capability to raise before cutover, not as
  permission to point the CLI at production.

The operator workflow, permissions and day-to-day conflict behavior are in the
[Payroll operator guide](operator-guide.md#salary-profiles-workspace). The
accepted decision is [ADR-0036](../../adr/0036-effective-dated-salary-revisions.md).
