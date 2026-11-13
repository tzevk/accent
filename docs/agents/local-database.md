# Local database operations

**Read this guide when starting, stopping, or configuring the local MariaDB instance, or running the leads integration harness.**

Production uses MariaDB 10.11.15. Test database-specific behavior against MariaDB; MySQL accepts and rejects different SQL.

## Local MariaDB instance

- MariaDB 10.11.15 listens on `127.0.0.1:33369`, user `root`, empty password, loopback only. Binaries are under `C:\Program Files\MariaDB 10.11`; data is under `%LOCALAPPDATA%\AccentMariaDB`.
- The instance runs as a background process owned by the current user, not a Windows service. Start and stop without administrator rights; nothing starts with the machine.
- Use `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-db.ps1 start|stop|status`. Start only when needed and stop it when the task ends; the helper shuts it down cleanly.
- Point the app at the local instance with explicit environment variables, never by editing `.env`: `DB_HOST=127.0.0.1 DB_PORT=33369 DEV_DB_NAME=<local db> DEV_DB_USER=root DEV_DB_PASSWORD=`.
- Never point tests at development, staging, or production databases.

## Leads integration harness

Before running the harness:

1. Select a loopback host and a disposable database name containing `integration`.
2. Keep tests away from development, staging, production, and configured branch databases.
3. Set `INTEGRATION_DB_HOST=127.0.0.1`, `INTEGRATION_DB_PORT=33369`, `INTEGRATION_DB_USER=root`, `INTEGRATION_DB_PASSWORD=`, and `INTEGRATION_DB_NAME` in the shell, not `.env`.
4. Run `npm run test:integration:leads`.

The harness creates and drops its database. It refuses unsafe targets and never reuses an existing database.
See the [leads integration guide](../app/leads/integration.md) for execution details.

## Playwright financial-smoke harness

`npm run test:e2e` runs the restored minimal browser harness. It owns the disposable database and the `next dev` process. Do not run `npx playwright test` directly, and do not point the command at a shared server.

GitHub Actions runs this harness on `ubuntu-latest` with Node 24 against a MariaDB 10.11 service. The commands below run the same harness on your machine. The [testing and verification rules](../../CODING_STANDARDS.md#testing-and-verification) are canonical.

### First-time setup

1. Use Node 24 (`package.json` engines is `24.x`).
2. Run `npm ci`.
3. Install Chromium once with `npm run test:e2e:install`. On Linux CI use `npx playwright install --with-deps chromium` so system libraries are installed too.
4. Use MariaDB 10.11.x. Production is 10.11.15; the harness refuses MySQL and other MariaDB lines.

### Run

Set the integration inputs in the shell, never in `.env`:

```powershell
$env:INTEGRATION_DB_HOST = '127.0.0.1'
$env:INTEGRATION_DB_PORT = '33369'
$env:INTEGRATION_DB_USER = 'root'
$env:INTEGRATION_DB_PASSWORD = ''
$env:INTEGRATION_DB_NAME = 'accent_integration_e2e'
npm run test:e2e
```

The harness derives a unique database name from `INTEGRATION_DB_NAME` for every invocation, so the name must contain `integration`. It refuses production, staging, development, and configured branch names, non-loopback hosts, existing databases, and unsupported database versions.

The app port is selected from an available loopback port. Set `E2E_PORT` only when diagnosing a conflict; an occupied port fails the run instead of attaching to the process that owns it. An existing `.next/dev/lock` or `.next/lock` also fails the run. Stop the process that owns the lock, confirm its PID is gone, then remove the stale lock before retrying.

Migrations receive the resolved database port directly. Every child process is pinned to `DEV_DB_*`, `STAGING_DB_*`, `PROD_DB_*`, `DB_HOST`, and `DB_PORT` for the disposable database. Setup proves the running app uses that database by authenticating a short-lived probe user created only in it.

Pass ordinary Playwright arguments after `--`, for example `npm run test:e2e -- --grep "payroll review"`. Reports, traces, and screenshots on failure are under ignored `e2e/artifacts/`; open the HTML report with `npm run test:e2e:report`.

### Fixture ownership and cleanup

The journey ticket owns `e2e/fixtures/hooks.ts`. It exports:

```ts
export async function seed(context): Promise<void>;
export async function cleanup(context): Promise<void>; // optional
```

The context provides `runtime` (base URL, run tag, disposable database), a harness-owned independent `reader`, and `namespace(workerIndex, suffix?)`. Fixture names use `E2E-<issue>-<run>-<worker>` and must be shortened with `fitIdentifier` for narrow columns such as `employees.employee_id` (20 characters). Tests should open their own reader through `e2e/support/runtime.ts`.

Cleanup runs after both success and failure and drops the database, closes connections, stops the owned app process tree on Windows and Linux, and removes only the dev lock that names the owned process. Setup failures still run cleanup; a cleanup failure fails the command.

### Failure diagnosis

- Missing `INTEGRATION_DB_*`: the command fails before creating anything. Export them in the shell, not `.env`.
- Unsupported database version: use MariaDB 10.11, matching production.
- `.next/dev/lock` or `.next/lock` exists: an unowned dev server or build may be running. Stop it first; never delete the lock while its PID is alive.
- Port already in use: another process owns `E2E_PORT`. Stop it or unset `E2E_PORT`.
- App-target verification failed: the probe login did not reach the disposable database. Check for inherited database settings and that `DB_HOST`/`DB_PORT` point at loopback MariaDB.
- Playwright reports no tests: the journey spec is not present in this tree yet. The harness is still restored, but the browser journey follows in its own ticket.
- Browser missing: run `npm run test:e2e:install`.

The historical 41-spec suite was removed on 2026-10-10 and is archived at tag `e2e-v1`. The current scope and rules are in [CODING_STANDARDS.md](../../CODING_STANDARDS.md#testing-and-verification).
