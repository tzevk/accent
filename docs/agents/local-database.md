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
