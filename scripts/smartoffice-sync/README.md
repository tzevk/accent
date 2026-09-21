# smartoffice-sync

Polls the SmartOffice biometric system's SQL Server database for raw punches
and pushes them to the Accent CRM attendance webhook. Bridges the office LAN
(where alone `SmartOfficedb` is reachable) to the CRM.

```
[biometric devices]──push──> SmartOfficeDb (MSSQL, 172.16.1.40\SQLEXPRESS)
                                     │
                              office LAN only
                                     │
                    this poller (always-on Windows box)
                     │  SELECT DeviceLogs_M_YYYY  every POLL_SECONDS
                     ▼
        POST /api/attendance/webhook  (Bearer auth)
                     │  upsert into attendance_logs
                     ▼
        Accent CRM → Reports > Attendance Report
```

## Files

| File             | Purpose                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `sync.mjs`       | the poller (only runtime dep: `mssql`)                                                     |
| `setup-task.bat` | one-shot Task Scheduler setup: registers the task, then runs it once and prints the result |
| `task.xml`       | Task Scheduler task definition template that `setup-task.bat` fills in (`__TOKENS__`)      |
| `.env.example`   | settings template — copy it to `.env`                                                      |

## Setup (office machine)

1. Install Node.js 18+ (LTS).
2. Copy this folder to e.g. `C:\smartoffice-sync`, then:

   ```bat
   cd C:\smartoffice-sync
   npm install
   copy .env.example .env
   notepad .env   # fill in values — see table below
   ```

3. Smoke test (no data is pushed):

   ```bat
   node sync.mjs --once --dry-run --backfill-days=30
   ```

   Expect `Resolved SQLEXPRESS on 172.16.1.40:<port> via SQL Browser`,
   a punch count, and a sample payload.

4. Live single pass (real push; webhook upserts, so safe to repeat):

   ```bat
   node sync.mjs --once
   ```

5. Schedule it — one command, from an **elevated Command Prompt**
   (`Run as administrator`) in the deployed folder. cmd only, no PowerShell:

   ```bat
   setup-task.bat
   ```

   The script resolves `node.exe`, runs `npm install` if `node_modules\mssql` is
   missing, refuses to continue if `.env` is missing, fills `task.xml` in with
   the real paths and folder, registers the task **"SmartOffice Attendance
   Sync"** (`/F`, so re-running replaces it), then fires one real pass and prints
   the task's `Last Result` plus the tail of `sync.log`. Without admin rights,
   `setup-task.bat /user` registers it as the signed-in user instead — that
   variant only runs while that user is signed in.

   Why a generated XML instead of `schtasks /Create /SC MINUTE`: that form has
   **no switches** for power/logon behaviour, and its defaults are the ones that
   silently break unattended runs:
   - such a task reports `Power Management: Stop On Battery Mode, No Start On
Batteries` and `Logon Mode: Interactive only`
     (`schtasks /Query /TN <name> /V`);
   - on a box that is on battery, or logged off, such a task stays `Queued`
     with `Last Result: 0` and writes nothing at all — while the identical
     `node sync.mjs --once` run by hand works. (Reproduced 2026-09-21 on a
     laptop: `Status: Queued`, no log file; the same task ran fine once the two
     battery flags were turned off.)

   `task.xml` (the template — its `__TOKENS__` are filled in by the script)
   sets `DisallowStartIfOnBatteries=false`, `StopIfGoingOnBatteries=false`,
   `StartWhenAvailable=true`, `MultipleInstancesPolicy=IgnoreNew`, an
   `ExecutionTimeLimit` of 1 hour (so a hung pass cannot hold the task
   "Running" and block every later trigger) and a 5-minute repetition. The
   default principal is LOCAL SYSTEM (`S-1-5-18`, with **no** `<LogonType>`
   element — schtasks rejects `ServiceAccount`), so nobody needs to be signed
   in. `/user` instead uses `DOMAIN\user` + `InteractiveToken`.

   The filled-in XML is written to `%TEMP%\smartoffice-attendance-task.xml` and
   printed, so it can be inspected, edited or registered by hand:

   ```bat
   schtasks /Create /TN "SmartOffice Attendance Sync" /XML %TEMP%\smartoffice-attendance-task.xml /F
   ```

   Keep the first line of the XML as `<?xml version="1.0"?>` — with an explicit
   `encoding="UTF-8"` attribute, `schtasks /Create /XML` fails with
   `(1,40)::ERROR: unable to switch the encoding`. Also note that XML comments
   (and any `!` in the file) do not survive the template substitution, which is
   why `task.xml` carries no comment block.

6. Re-check at any time (elevated cmd, since the task runs as SYSTEM):

   ```bat
   schtasks /Run /TN "SmartOffice Attendance Sync"
   ping -n 26 127.0.0.1 >nul
   schtasks /Query /TN "SmartOffice Attendance Sync" /V /FO LIST | findstr /I "Status Logon Power Last Run Time Last Result Task To Run Start In"
   type C:\smartoffice-sync\sync.log
   ```

   Read it as:
   - `Last Result`: `0` = pass accepted, `1` = the pass failed (reason is in
     `sync.log`), `2` = bad argument in the action, `267011` (`0x41303`) = has
     not run yet, `267009` (`0x41301`) = a pass is still running,
     `-2147024894` (`0x80070002`) = "program not found" — the `node.exe` path in
     the task does not exist;
   - `Power Management` must be **empty** — any text there means the task is
     still gated (battery/logon conditions);
   - `Task To Run` / `Start In` must be the real `node.exe` and folder;
   - every run appends a header line naming the account, `args`, working
     directory, script directory and resolved config, so a scheduled pass can be
     compared line-for-line with a hand run;
   - **no new `sync.log` line** means the process never started — wrong
     path/account in the action, or the task is gated.

   Alternatively run `npm start` (loop mode) under NSSM as a Windows service.

## Settings (`.env`)

| Key                       | Meaning                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSSQL_HOST/INSTANCE/...` | SmartOfficeDb login (`crm_reader`, read-only). Leave `MSSQL_PORT` empty to auto-resolve the SQLEXPRESS dynamic port via SQL Browser (UDP 1434).                                                    |
| `WEBHOOK_URL`             | Full URL of the CRM's `/api/attendance/webhook` as reachable from this machine.                                                                                                                    |
| `WEBHOOK_SECRET`          | Must equal `SMARTOFFICE_WEBHOOK_SECRET` in the CRM `.env`.                                                                                                                                         |
| `POLL_SECONDS`            | Loop-mode cadence (default 300).                                                                                                                                                                   |
| `BACKFILL_DAYS`           | Where a first run (no `state.json`) starts from (default 3). The `--backfill-days=N` flag always overrides `state.json`.                                                                           |
| `BATCH_SIZE`              | Punches per POST (default 400).                                                                                                                                                                    |
| `DEVICE_SERIALS`          | Optional allowlist, comma-separated (e.g. `84E0F4293A531501` for ATS head office only). Empty = all real devices.                                                                                  |
| `LOG_FILE`                | Run log, default `sync.log` next to the script (relative paths resolve against the script directory, not the working directory). A scheduled pass has no console, so this file is the only record. |

## Guarantees & behaviour

- **Idempotent** — webhook dedupes on `(employee_code, log_date, serial_number)`;
  the poller re-sends a lookback window every pass, so crashes/duplicates are harmless.
- **At-least-once** — `state.json` advances only after _every_ batch is accepted
  (HTTP 200 + `success:true`). A failed pass retries the same window next time.
- **Observable** — every run appends a header (account, arguments, working
  directory, script directory, resolved config) and the pass outcome to
  `LOG_FILE`, and a `--once` pass that fails exits `1` — Task Scheduler's
  _Last Result_ is never a false green. Unknown arguments (e.g. `--run-once`
  instead of `--once`) abort with exit code `2` rather than silently starting
  loop mode, which `IgnoreNew` would then keep in place forever.
- **Direction** — only `AttDirection` is forwarded (blank on all current devices);
  the CRM stores NULL and the Attendance Report infers in/out from punch order.
  The misleading `Direction` column (constant `'in'`) is never sent.
- **Virtual devices skipped** — SmartOffice's Leave/Special Off/Absent/System Entry
  pseudo-devices (blank or shared `12345678` serials) are filtered out.
- **Month shards** — queries this month's and last month's `DeviceLogs_M_YYYY`
  tables automatically; missing shards are skipped.

## Troubleshooting

| Symptom                                                    | Fix                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQL Browser timeout`                                      | UDP 1434 blocked → pin `MSSQL_PORT=54996` (check current port on the server or ask IT).                                                                                                                                                                                                                                                                                                                 |
| Scheduled task pushes nothing, `sync.log` gets no new line | The pass never started. `schtasks` defaults gate on power and logon: `DisallowStartIfOnBatteries` leaves the task `Queued` forever on battery, and interactive logon means no runs while nobody is signed in — both silent (`Last Result: 0`). A `node` missing from the task account's `PATH` fails instantly. Recreate/fix the task per setup step 5, then compare the logged header with a hand run. |
| `Last Result: 1`                                           | The pass ran and failed — `sync.log` names the cause (`Pass failed: …`, with the HTTP status and webhook body for rejected batches, e.g. a `WEBHOOK_SECRET` mismatch). State is untouched, so the next trigger retries the same window.                                                                                                                                                                 |
| `--backfill-days=N` did nothing                            | On older builds it applied only when `state.json` was absent. It now forces the window regardless — confirm with the `Pass starting (since … — --backfill-days=N)` line; there is no need to delete `state.json` first.                                                                                                                                                                                 |
| Punches stop appearing                                     | Check `sync.log`, then device pings (`SELECT DeviceFName, LastPing FROM Devices` — devices ping even when log download is broken).                                                                                                                                                                                                                                                                      |
| `Unmatched codes` in log                                   | Punch `UserId` not in CRM `employees.smartoffice_code` — map it; the punch is stored and back-fills automatically on the next push.                                                                                                                                                                                                                                                                     |
| Wrong times                                                | Box timezone no longer matters (`fmtLocal` uses UTC getters over tedious' UTC-interpreted wall time). Rows written before the fix are +5:30 off — wipe `attendance_logs` and re-push with `--backfill-days=N` (no need to delete `state.json`; the flag forces the window).                                                                                                                             |
