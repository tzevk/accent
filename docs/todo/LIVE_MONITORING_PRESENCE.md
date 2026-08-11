# Live-Monitoring Presence Rework — DONE

**Status:** ✅ Complete (2026-08-10). Presence now lives in `user_presence` (one row per user, upserted by the activity tracker), and status derives from `last_seen` + client-reported `is_idle` — never from aggregating `user_activity_logs`. All 4 consumers of `/api/user-status` unchanged. Full suite green (437 tests).

> **Why this exists:** the current "online" status is a heuristic bolted onto an audit table. `src/app/admin/live-monitoring/page.jsx` polls `GET /api/user-status` every 10s; the route derives `last_activity = MAX(user_activity_logs.created_at)` via a `GROUP BY` over a 216k+ row audit table plus a correlated subquery for `current_page`, then classifies by recency windows (`<120s` online, `<600s` idle, else offline). Four concrete failures:
>
> 1. **"Online" ≠ user present.** Status is "a heartbeat row landed in the last 2 min" = "the tab's timers are running." The client already computes real presence (`isIdleRef` in `src/hooks/useActivityTracker.js`, sent as `details.isIdle` in every heartbeat) but the server **ignores it** — so a user reading a doc for 20 min shows online, while a user who switched to another app (tab hidden → Chrome intensive-throttles timers after ~5 min → heartbeats stop) decays to idle/offline regardless of whether they're at their desk.
> 2. **Boundary flicker by construction.** `HEARTBEAT_INTERVAL = 120_000` (`useActivityTracker.js`) equals the online window (`<120s`) — the heartbeat is the thing that makes you online, and it fires exactly at the moment you'd otherwise be offline. Any jitter/dropped packet tips an active user to idle.
> 3. **Expensive hot path.** Every 10s poll runs a `GROUP BY` over `user_activity_logs` + per-row correlated subqueries + `getUserTodayStats` (3 queries per user, `Promise.all` N+1) × every admin viewer. Nothing cached.
> 4. **Logic duplicated, already diverged.** `getStatusFromActivity` + status queries exist twice: inline in `src/app/api/user-status/route.js` and as `getUserCurrentStatus`/`getAllUsersStatus` in `src/utils/activity-logger.ts` (which join `roles` while the route joins `roles_master`; both tables exist in the baseline).

---

## Plan

### Phase 1 — Migration: `user_presence` table

Small presence store separate from the audit log. One row per user, PK lookup — no aggregation ever.

```sql
CREATE TABLE user_presence (
  user_id INT NOT NULL PRIMARY KEY,
  last_seen TIMESTAMP NULL DEFAULT NULL,
  is_idle TINYINT(1) NOT NULL DEFAULT 0,
  current_page VARCHAR(255) DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_presence_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- `npm run migrate:make -- add-user-presence`, use the knex builder (match `20260805100000_create_deliverable_categories.js` style).
- Seed: `INSERT INTO user_presence (user_id) SELECT id FROM users WHERE is_active = TRUE` — or just backfill lazily on first heartbeat; upsert handles missing rows either way. Prefer lazy (no write at deploy).

### Phase 2 — Write path: presence upsert in `track-activity`

`src/app/api/activity-logs/track-activity/route.js` → `processActivity()` currently calls `logActivity()` then `updateScreenTime()` for heartbeats. Add a third call:

- New export in `src/utils/activity-logger.ts`: `updateUserPresence(userId, { isIdle?, currentPage? })` — `INSERT … ON DUPLICATE KEY UPDATE last_seen = NOW(), is_idle = ?, current_page = ?` (COALESCE semantics: only overwrite `current_page` when a value is supplied).
- Mapping rules:
  - Any processed event refreshes `last_seen` (any event = browser is alive).
  - `heartbeat` events: `is_idle = details.isIdle === true`; `current_page = details.currentPage` (fallback).
  - `status_change` events: `details.status === 'idle'` → `is_idle = 1`; `'active'` → `is_idle = 0`.
  - `view_page` events: `current_page = details.page`.
- **No client changes needed** — the hook already sends `isIdle` in heartbeat details and queues `status_change` on idle transitions and wake-up. The signal exists; the server just never consumed it.
- **Keep** the audit-log heartbeat row: `updateScreenTime` buckets deltas from it, and it's the audit trail. Presence writes are a tiny extra indexed row; don't merge the two concerns.
- Delete the dead duplicate status queries from `activity-logger.ts`: `getUserCurrentStatus` and `getAllUsersStatus` have **zero consumers** outside the file (verified 2026-08-10). Keep `getUserActivityLogs` (used by `src/app/api/activity-logs/route.js`).

### Phase 3 — Read path: rewrite `GET /api/user-status`

Single shared status helper, moved into `activity-logger.ts` and imported by the route (one implementation from here on):

```ts
function getStatusFromActivity(lastSeen, isIdle) {
	if (!lastSeen) return 'offline';
	const seconds = Math.floor(
		(Date.now() - new Date(lastSeen).getTime()) / 1000
	);
	if (isIdle) return seconds < 600 ? 'idle' : 'offline';
	if (seconds < 180) return 'online'; // widened: 3 min
	if (seconds < 600) return 'idle';
	return 'offline';
}
```

All-users branch (the live-monitoring poll) becomes one query — no `GROUP BY`, no correlated subqueries:

```sql
SELECT u.id AS user_id, u.username, u.full_name, u.email, r.role_name,
       p.last_seen AS last_activity, p.is_idle, p.current_page
FROM users u
LEFT JOIN roles_master r ON u.role_id = r.id
LEFT JOIN user_presence p ON p.user_id = u.id
WHERE u.is_active = TRUE
ORDER BY COALESCE(p.last_seen, '1970-01-01') DESC
```

- **Response shape must stay byte-identical** — 4 consumers: `admin/live-monitoring/page.jsx` (all-users, 10s poll), `admin/live-monitoring/user/[id]/page.jsx` (single), `admin/activity-logs/page.jsx` (all-users status map), `users/[id]/activity/page.jsx` (single). Keep the key `last_activity` (now sourced from `p.last_seen`) so **zero page changes** are required.
- Single-user branch: keep the `user_work_sessions` subqueries (`session_start`, `session_duration`) — that's the work-session feature, separate from presence.
- Optional but cheap: batch `getUserTodayStats` — currently 3 queries/user in a `Promise.all` loop. Collapse to one query per table (`user_daily_summary`, `user_screen_time`, `user_work_sessions`) with `WHERE user_id IN (…) GROUP BY user_id`, then merge in JS.
- Keep the route's join on `roles_master` (matches what the UI displays). Note the util's dead code joined `roles` — another reason it had to go.

### Phase 4 — Semantics: what each state now means

| State     | Meaning                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| `online`  | Tab alive **and** user active in it (input within 5 min client-side; heartbeat `isIdle: false` within 3 min) |
| `idle`    | Tab alive but user not interacting (client idle ≥5 min / tab hidden) **or** heartbeats stopped 3–10 min ago  |
| `offline` | No heartbeat for >10 min (all tabs closed/suspended, or never active today)                                  |

- **Online window 120s → 180s, heartbeat stays at 120s.** One dropped/late heartbeat no longer flips status, and audit write frequency is unchanged (rejected the 60s-heartbeat alternative — it doubles audit writes for no gain).
- Client idle state now propagates: user reading a doc for 20 min → `is_idle: true` heartbeats → **idle** immediately, instead of staying "online".
- Hidden-tab behavior (accepted, desired): first ~5 min hidden → heartbeats carry `isIdle: true` → idle; beyond that Chrome intensive-throttling stops timers → decays to idle/offline by recency. That's the correct answer for "switched away from the app."
- Multi-tab: single row per user, any live tab refreshes `last_seen`; closing one tab changes nothing; all closed → staleness → offline. Accepted simplification — no session/tab bookkeeping, self-healing.

### Phase 5 — Security hardening + dead feature

- **`GET /api/user-status` leaks presence to any authenticated user** — it only calls `getCurrentUser()`. The pages gate on `is_super_admin || role.code === 'admin'`; the API must enforce the same (via `ensurePermission` or the role check). Note the shape mismatch to resolve at implementation: the page checks `user.role?.code === 'admin'`, the route's own POST compares `currentUser.role !== 'Admin'` — verify what `getCurrentUser` actually returns before writing the guard.
- **`POST /api/user-status` (manual status) is a write-only dead feature**: inserts `manual_status` into `user_activity_logs`, and nothing anywhere reads it back (verified — zero consumers of `manual_status`). Decide with product: surface it in the status pipeline or delete the endpoint + any UI. Recommend delete unless there's a consumer outside `src/`.

### Phase 6 — Tests

- **Unit** (`src/__tests__/utils/activity-logger.test.ts`, pure fn): boundary matrix for `getStatusFromActivity` — `null` → offline; 179s/180s; 599s/600s; `isIdle` + 30s → idle; `isIdle` + 700s → offline.
- **Route test** (`src/__tests__/api/user-status/route.test.ts`, follow the mocking recipe in `AGENTS.md`): admin guard 403 for non-admin; response shape unchanged (keys `status`, `last_activity`, `current_page` present); `user_presence` LEFT JOIN returns offline for users with no presence row.
- **Upsert test**: `updateUserPresence` inserts on first call, updates `is_idle`/`current_page` on subsequent calls (mock `db.execute`, assert the `ON DUPLICATE KEY UPDATE` SQL + params).

### Phase 7 — Verification

1. `npx tsc --noEmit` and `npm run test:run` (targeted files only).
2. Manual: dev server + two browser tabs as one user — tab A shows online; stop touching it, leave visible → flips to idle within ~30s (status_change batch) but never offline while open; close tab → offline after ~10 min. Open a second tab → stays online, single row.
3. Confirm `admin/activity-logs` and `users/[id]/activity` still render (shape unchanged).
4. Watch `user_presence` row count: one per active user, no growth per tab.

---

## Risks / notes

- **Shape is the contract.** Four consumers read `/api/user-status`; keep every existing key. Any rename (`last_activity` → `last_seen`) must be done across all four pages in the same change, or not at all (plan: not at all).
- **Screen-time depends on heartbeat audit rows** (`updateScreenTime` buckets `activeDeltaMs`/`idleDeltaMs`). Don't "optimize" by removing them; the audit table stays the write-side log, presence just stops being derived from it.
- **`isIdle` propagation lags up to 30s** (batch flush cadence) — acceptable for a 10s-polled admin screen.
- **Keep the 10s poll.** It's fine once each poll is a PK join; real-time (SSE/websocket) presence is out of scope unless the product wants sub-second updates.
- **Stale presence rows** (`user_id` FK `ON DELETE CASCADE`) clean themselves up; no retention job needed.
