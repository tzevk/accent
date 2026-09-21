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

## Setup (office machine)

1. Install Node.js 18+ (LTS).
2. Copy this folder to e.g. `C:\smartoffice-sync`, then:

   ```powershell
   cd C:\smartoffice-sync
   npm install
   Copy-Item .env.example .env
   notepad .env   # fill in values — see table below
   ```

3. Smoke test (no data is pushed):

   ```powershell
   node sync.mjs --once --dry-run --backfill-days=30
   ```

   Expect `Resolved SQLEXPRESS on 172.16.1.40:<port> via SQL Browser`,
   a punch count, and a sample payload.

4. Live single pass (real push; webhook upserts, so safe to repeat):

   ```powershell
   node sync.mjs --once
   ```

5. Schedule it — Task Scheduler, every 5 minutes. Run this in an **elevated**
   PowerShell:

   ```powershell
   $dir = 'C:\smartoffice-sync'
   $action  = New-ScheduledTaskAction -Execute (Get-Command node).Source `
     -Argument "$dir\sync.mjs --once" -WorkingDirectory $dir
   $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
     -RepetitionInterval (New-TimeSpan -Minutes 5)
   $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
     -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
   $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' `
     -LogonType ServiceAccount -RunLevel Highest
   Register-ScheduledTask -TaskName 'SmartOffice Attendance Sync' `
     -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
   ```

   Do **not** register it with the bare `schtasks /Create /SC MINUTE ...` form.
   Its defaults set `DisallowStartIfOnBatteries` + `StopIfGoingOnBatteries` and
   bind the task to the interactive logon, so on a box that is on battery or
   logged off the task stays `Queued` and silently pushes nothing — the
   identical command works when run by hand. (Reproduced 2026-09-21: a task
   created that way showed `Status: Queued`, `Last Result: 0`, and no log file
   while the machine was on battery.) Absolute `node.exe` + `SYSTEM` also
   removes the other two silent killers: `node` missing from the task account's
   `PATH`, and nobody being logged on.

   Already created the task the old way? Keep the trigger, fix the rest:

   ```powershell
   $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
     -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
   Set-ScheduledTask -TaskName 'SmartOffice Attendance Sync' -Settings $s
   Set-ScheduledTask -TaskName 'SmartOffice Attendance Sync' -Principal `
     (New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest)
   ```

6. Verify the scheduled run (don't wait for the 5-minute trigger; same elevated
   PowerShell, since the task runs as SYSTEM):

   ```powershell
   schtasks /Run /TN "SmartOffice Attendance Sync"
   Get-ScheduledTaskInfo -TaskName "SmartOffice Attendance Sync" |
     Format-List LastRunTime, LastTaskResult, NextRunTime, NumberOfMissedRuns
   Get-Content C:\smartoffice-sync\sync.log -Tail 20
   ```

   `LastTaskResult` is the process exit code: `0` = pass accepted, `1` = the
   pass failed (reason is in `sync.log`), `2` = bad argument in the action,
   `0x41303` = has not run yet. Every run appends a header line naming the
   account, `args`, working directory, script directory and resolved config, so
   a scheduled pass can be compared line-for-line with a hand run.
   **No new `sync.log` line after `/Run`** means the process never started —
   wrong path/account in the action, or the task is gated (see step 5).

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
