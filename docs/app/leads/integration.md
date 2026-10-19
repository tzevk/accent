# Leads authenticated HTTP integration (issue #369)

Repeatable proof for the create/import/assign/read slice. The command runs the
real Next server against a disposable migrated MariaDB database, logs in over
real HTTP, and verifies persistence with an independent database reader. No
test-only routes, no bypasses, no mocked database proof.

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
start the server and run thirteen scenarios. On MariaDB 10.11 the whole run
takes well under a minute.

## What the run does

1. Validates the disposable target (fails closed on any unsafe name or host).
2. Creates the database with plain `CREATE DATABASE` — an existing database
   with the same name aborts the run; nothing is ever reused.
3. Migrates everything before the explicit ticket-369 lead migration.
4. Seeds run-namespaced users (`lit369-<timestamp>-creator`, `-assignee`,
   `-readonly`, and `-noassign`, password `Lit369-pass!`), a duplicate-name
   tie pair, and four representative pre-migration Lead rows.
5. Applies the real ticket-369 lead migration over that evidence, then any
   later migrations.
6. Starts `next dev` on `LEADS_INTEGRATION_PORT` (default 31369) with all
   database branches pinned to the disposable database.
7. Logs each fixture user in through `POST /api/login` and keeps the real
   session cookies.
8. Runs thirteen scenarios.

## Cleanup contract

Every non-keep run stops the server and drops the disposable database, on
success and on failure. A failed `DROP DATABASE` fails the run rather than
reporting PASS with data left behind. On Windows the whole dev-server process
tree is terminated (`taskkill /PID <pid> /T /F`) so no orphan keeps the port
or the `.next/dev` lock. `--keep` retains the server and database only after
a full pass, for manual browser follow-up.

## Scenarios

| #   | Scenario                             | Proves                                                                                 |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| 1   | creator-assignment                   | Manual create defaults owner to creator, starts at New                                 |
| 2   | permitted-assignment                 | `leads:assign` reassignment records actor/time/prior owner                             |
| 3   | denied-assignment-no-mutation        | Missing grant yields 403 and persists nothing; anonymous yields 401                    |
| 4   | unassigned-import                    | Unknown-status CSV enters intake with review flag                                      |
| 5   | owner-selected-import                | CSV with `owner_user_id` assigns that owner                                            |
| 6   | import-owner-evidence-never-resolves | CSV owner column stays evidence; never auto-resolves                                   |
| 7   | separate-enquiries                   | Same company, distinct needs stay separate Leads                                       |
| 8   | duplicate-review                     | Same company + need surfaces candidates, never merges                                  |
| 9   | durable-reads                        | A permitted non-owner edits; read-only users see durable values and consistent filters |
| 10  | legacy-evidence                      | Unique name maps; unknown/duplicate names and odd stages keep originals with review    |
| 11  | raw-import-evidence                  | Long legacy values and surrounding whitespace survive HTTP and database reads          |
| 12  | invalid-import-owner                 | Malformed owner identifiers fail without saving any Lead                               |
| 13  | active-import-requirements           | Active stages cannot bypass owner and next-action requirements                         |

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
- `refusing to reuse existing database ...`: drop the named database manually
  (or pick a fresh `INTEGRATION_DB_NAME`); the harness never reuses one.

## Verification record — 2026-10-19

- Local environment: Windows, MariaDB 10.11.15 (matching production), Node 26.2.0. The CI job targets Node 24; CI execution is not claimed here.
- `npm run test:integration:leads`: all thirteen scenarios pass against the real application and an independent database reader on MariaDB 10.11.
- `npm run verify`: lint and production build pass; all 86 Vitest suites and 1,066 tests pass.
- `npm run check:route-auth`: all 449 handlers authorize, with the existing eight allowlisted paths.
- The baseline migration applies unchanged on MariaDB 10.11 in about five seconds, so no reordering of the production snapshot was needed.
- Browser smoke after the query cutover: keyboard creation, creator default, reassignment, history refresh, non-owner editing, next-action refusal, multipart import, intake filters, and original legacy detail.
- A read-only browser user sees no edit, delete, import, or assignment-directory controls.
- Independent SQL reads confirm the browser's owner, stage, edited city, original import values, and ownership actors/times.
- The command rejects a remote database host before opening a connection.
