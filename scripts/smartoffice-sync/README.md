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

5. Schedule it — Task Scheduler, every 5 minutes:

   ```powershell
   schtasks /Create /TN "SmartOffice Attendance Sync" `
     /TR "cmd /c cd /d C:\smartoffice-sync && node sync.mjs --once" `
     /SC MINUTE /MO 5
   ```

   Alternatively run `npm start` (loop mode) under NSSM as a Windows service.

## Settings (`.env`)

| Key                       | Meaning                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSSQL_HOST/INSTANCE/...` | SmartOfficeDb login (`crm_reader`, read-only). Leave `MSSQL_PORT` empty to auto-resolve the SQLEXPRESS dynamic port via SQL Browser (UDP 1434). |
| `WEBHOOK_URL`             | Full URL of the CRM's `/api/attendance/webhook` as reachable from this machine.                                                                 |
| `WEBHOOK_SECRET`          | Must equal `SMARTOFFICE_WEBHOOK_SECRET` in the CRM `.env`.                                                                                      |
| `POLL_SECONDS`            | Loop-mode cadence (default 300).                                                                                                                |
| `LOOKBACK_MINUTES`        | Re-send window behind the saved position (default 120). Overlap is free — the webhook upserts.                                                  |
| `BACKFILL_DAYS`           | Where a first run (no `state.json`) starts from (default 3).                                                                                    |
| `BATCH_SIZE`              | Punches per POST (default 400).                                                                                                                 |

## Guarantees & behaviour

- **Idempotent** — webhook dedupes on `(employee_code, log_date, serial_number)`;
  the poller re-sends a lookback window every pass, so crashes/duplicates are harmless.
- **At-least-once** — `state.json` advances only after _every_ batch is accepted
  (HTTP 200 + `success:true`). A failed pass retries the same window next time.
- **Direction** — only `AttDirection` is forwarded (blank on all current devices);
  the CRM stores NULL and the Attendance Report infers in/out from punch order.
  The misleading `Direction` column (constant `'in'`) is never sent.
- **Virtual devices skipped** — SmartOffice's Leave/Special Off/Absent/System Entry
  pseudo-devices (blank or shared `12345678` serials) are filtered out.
- **Month shards** — queries this month's and last month's `DeviceLogs_M_YYYY`
  tables automatically; missing shards are skipped.

## Troubleshooting

| Symptom                  | Fix                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `SQL Browser timeout`    | UDP 1434 blocked → pin `MSSQL_PORT=54996` (check current port on the server or ask IT).                                             |
| Punches stop appearing   | Check `sync.log`, then device pings (`SELECT Name, LastPing FROM Devices` — devices ping even when log download is broken).         |
| `Unmatched codes` in log | Punch `UserId` not in CRM `employees.smartoffice_code` — map it; the punch is stored and back-fills automatically on the next push. |
| Wrong times              | Machine timezone must be IST (the DB stores wall-clock IST).                                                                        |
| Start from scratch       | Delete `state.json` (optionally set `--backfill-days=N` for one run).                                                               |
