# SmartOffice Biometric Attendance Pipeline

How biometric attendance gets from the door-side SmartOffice system into the
Accent CRM, what the source data actually looks like, and the operational
gotchas discovered while wiring it up (2026-08).

## System overview

```
Biometric devices (4 units, multiple sites)
        │  real-time push (IsRealTime=1)
        ▼
SmartOffice server  ──  ATS-PC-026\SQLEXPRESS (SQL Server 2019 Express)
SmartOfficedb                172.16.1.40, dynamic port (SQL Browser UDP 1434)
        │
        │  smartoffice-sync poller (office-LAN-only Windows box)
        │  scripts/smartoffice-sync/ — SELECT new punches, POST to webhook
        ▼
POST /api/attendance/webhook  (src/app/api/attendance/webhook/route.ts)
        │  Bearer SMARTOFFICE_WEBHOOK_SECRET, upsert into attendance_logs
        ▼
MySQL attendance_logs  →  Reports > Attendance Report
(src/app/reports/attendance-report/)
```

SmartOffice's own "Attendance Export" webhook (Utilities > Data Collector
Service) was the original ingestion path; the poller reproduces its payload
shape so both can coexist.

## Source database

- **Server**: `ATS-PC-026\SQLEXPRESS`, SQL Server 2019 Express (15.0.2000.5),
  `172.16.1.40` on the office LAN. Reachable only from the local Wi-Fi/LAN —
  remote machines cannot connect, hence the on-site poller.
- **Port**: SQLEXPRESS uses a **dynamic TCP port** (54996 as of 2026-08),
  announced by the SQL Browser service on **UDP 1434**. Plain 1433 is closed.
  DBeaver must be configured as `172.16.1.40` + port 54996 (or blank port +
  instance name with UDP 1434 open). The port can change when SQL Server
  restarts — the poller re-resolves it every run; the `smartoffice-db` MCP
  entry in `opencode.json` may need its `MSSQL_PORT` updated if it drifts.
- **Credentials**: `crm_reader` (read-only SQL login). Password lives in the
  user env var `SMARTOFFICE_MSSQL_PASSWORD` (referenced by `opencode.json`
  via `{env:...}`) and in `scripts/smartoffice-sync/.env`. Never commit it.
- **Scale**: ~500 tables (full HRMS suite: payroll, leave, onboarding…).
  Attendance-relevant subset below.

## Schema that matters

| Table                   | Rows         | Role                                                                                                                                                                                                                          |
| ----------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DeviceLogs_<M>_<YYYY>` | ~7–11k/month | **Raw punches**, shipped monthly (month unpadded: `DeviceLogs_8_2026`). Key columns: `UserId` (device employee code), `LogDate` (IST wall-clock datetime), `DeviceId`, `AttDirection`, `Direction`, `AttenndanceMarkingType`. |
| `Devices`               | 9            | Device master. `SerialNumber` → webhook `serialNumber`. Rows 1–5 are **virtual** (Leave/Special Off/Absent/System Entry/Manual Entry — blank or shared `12345678` serials, never real punches; must be excluded).             |
| `Employees`             | 1,674        | HR master. `EmployeeCodeInDevice` links device `UserId` → employee.                                                                                                                                                           |
| `EmployeesBio`          | 1,253        | Biometric enrollments per device (some `EmployeeName` values are just the numeric code — enrollment hygiene is imperfect).                                                                                                    |
| `AttendanceLogs`        | 1.2M+        | SmartOffice's _processed_ daily in/out + leave + shift status. **Not used** by the pipeline — the CRM prefers raw punches and does its own inference.                                                                         |

## Direction semantics (important)

- `Direction` is **always `'in'`** on every real punch (software-filled
  constant). Sending it to the CRM would mark every punch IN — poison.
- `AttDirection` (device-reported direction) is **blank** on all current
  "U Series" units.
- Therefore the poller forwards only `AttDirection` (trimmed, effectively
  always empty) → webhook stores NULL → the Attendance Report **infers**
  in/out from punch order (1st of day = IN, next = OUT). See
  `applyInferredDirections` in `src/app/reports/attendance-report/data-source.ts`.
- If a future device starts reporting real directions, `AttDirection` flows
  through automatically (`resolveDirection` accepts `in`/`out`).

## Device inventory (2026-08)

| DeviceId | Name              | SerialNumber       | IP            | Site (inferred)                     | Punches 30d |
| -------- | ----------------- | ------------------ | ------------- | ----------------------------------- | ----------- |
| 7        | ATS               | `84E0F4293A531501` | 172.16.1.198  | Head office (same subnet as server) | 634         |
| 8        | SIT               | `84E0F4293C491501` | 192.168.1.241 | SIT office (NAT'd LAN)              | 2,514       |
| 9        | ATS Malvan        | `84E0F42938231501` | 192.168.1.40  | Malvan office                       | 214         |
| 10       | SP (Suvidya Pune) | `E03C1CB5D3611801` | 192.168.1.27  | Pune                                | 40          |

Topology note: all units have `MasterDeviceId = 0` — there is **no
master/slave interlink** between devices in the data. Each unit independently
pushes real-time (`IsRealTime = 1`) to the central SmartOffice server over the
WAN; "interlinked" in practice just means they all land in the one
`SmartOfficedb`. All four ping the server within seconds of each other, so
site-level outages would be visible as per-device `LastPing` gaps.

## Data quality & volumes

- ~100–280 punches/day across ~130 distinct users (weekdays); ~7–11k/month.
- Employee mapping has **two layers**, and they must not be conflated:
  - _SmartOffice-internal_ (`UserId` → `Employees.EmployeeCodeInDevice`): 100%
    (209/209 Aug-2026 codes) — the HRMS knows who everyone is.
  - _Accent-side_ (`employees.smartoffice_code` in prod): only **18 of 316**
    distinct Jul+Aug-2026 punch codes were mapped as of 2026-08-26, so the
    report's "Unmapped" strip will dominate until the remaining codes are
    entered (data entry, not a code issue). Unmapped punches are still stored
    (`employee_id NULL`); entering a code self-heals — the next re-push
    back-fills `employee_id` on the stored rows.
- ⚠️ **Punch gap**: no punches at all between **2026-08-14 and 2026-08-26**
  (devices kept pinging throughout). Either a genuine all-sites break or the
  SmartOffice log-download service silently stopped on 08-13 — worth
  confirming with the office; the report will look empty until punches resume.

## Pipeline components

1. **Webhook** — `src/app/api/attendance/webhook/route.ts`. Accepts a single
   object or array of `{employeeCode, logDate ('YYYY-MM-DD HH:mm:ss'), serialNumber,
direction}`; Bearer auth (`SMARTOFFICE_WEBHOOK_SECRET`); upsert into
   `attendance_logs` keyed by `(employee_code, log_date, serial_number)`;
   unmatched codes stored with `employee_id = NULL`; idempotent on re-push.
2. **Poller** — `scripts/smartoffice-sync/sync.mjs` (own `package.json`,
   only dep `mssql`). Runs on an always-on office Windows machine via Task
   Scheduler (`--once` every 5 min) or as a service (loop mode). Auto-resolves
   the dynamic port, scans current+previous month shards, skips virtual
   devices, batches POSTs with retries, keeps a lookback overlap window, and
   advances `state.json` only after full success (at-least-once delivery).
   See its README for setup.
3. **Report** — `src/app/reports/attendance-report/` (page + data-source).
   Sanity view over `attendance_logs` with direction inference and an
   unmapped-codes strip.

## Local development access (smartoffice-db MCP)

A read-only MSSQL MCP server (`mssql-mcp-node`, 11 introspection/query tools)
is configured **user-globally** in `~/.config/opencode/opencode.jsonc` —
deliberately outside the repo, with the `crm_reader` credential inline:

```jsonc
"smartoffice-db": {
	"type": "local",
	"command": ["npx", "-y", "mssql-mcp-node"],
	"environment": { "MSSQL_SERVER": "172.16.1.40", "MSSQL_PORT": "54996", ... }
}
```

- Read-only by design: `execute_write_query` errors out unless
  `MSSQL_ENABLE_WRITES=true` (not set), and reads run in rollback-only
  transactions. Defense in depth: `crm_reader` itself is a read-only login.
- Requires the machine to be on the office network.
- If the SQLEXPRESS dynamic port drifts, update `MSSQL_PORT` there.
- Gotcha that shaped this design: `{env:VAR}` substitution in project
  `opencode.json` resolves **when the background service loads config**. A
  long-lived service started before `setx` keeps substituting empty —
  restarting the OpenCode client does _not_ restart the service. The
  global-config-with-inline-secret approach sidesteps env inheritance
  entirely; `SMARTOFFICE_MSSQL_PASSWORD` (set via `setx`) remains available
  for scripts that spawn fresh.

## Operational checklist

- [ ] Confirm/restore punch flow after the 2026-08-14 gap.
- [ ] Deploy `scripts/smartoffice-sync` on the office box + Task Scheduler.
- [ ] Point `WEBHOOK_URL` at the CRM deployment reachable from the office LAN.
- [ ] Optional: ask IT to pin SQLEXPRESS to a static TCP port (removes the
      SQL Browser dependency).
- [ ] If SmartOffice's own Attendance Export is ever configured, keep the
      secret identical so both paths dedupe into the same rows.
