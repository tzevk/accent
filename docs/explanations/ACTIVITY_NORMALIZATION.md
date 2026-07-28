# Activity Assignment Normalization — 2026-07-28

## What changed

User activity assignment data was migrated out of `projects.project_activities_list` (a shared JSON blob) into the existing `user_activity_assignments` table. The `project_activities_list` JSON blob remains as the source of truth for activity _definitions_ (used by `EditProjectForm.jsx`); only per-user assignment data moved to the normalized table.

### Migration (checklist)

- [x] **Column migration** (`20260728050449`): Added `sub_activity_name`, `remarks`, `default_manhours` columns + `UNIQUE KEY idx_user_project_activity (user_id, project_id, activity_id)`.
- [x] **Data migration** (`scripts/migrate-activity-assignments.js`): UPSERTs all user assignment data from JSON blobs into the normalized table. Idempotent — safe to re-run.
- [x] **API rewrite** (`src/app/api/users/[id]/activity-assignments/route.js`): All four handlers (GET/PUT/PATCH/POST) now read/write `user_activity_assignments` directly instead of the JSON blob.
- [x] **Report routes** (`src/app/api/reports/project-activities/`, `src/app/api/reports/employee-report/`): Now query `user_activity_assignments` instead of parsing JSON blobs.
- [x] **Project sync** (`src/app/api/projects/[id]/route.js`): Changed from DELETE-all + INSERT-all to per-row UPSERT, preserving `daily_entries` and user-entered data across project saves.
- [x] **Frontend**: No changes required — response shapes are preserved.

### Column mapping (JSON blob → normalized table)

| JSON blob field (per-user) | Normalized column     | Notes                                             |
| -------------------------- | --------------------- | ------------------------------------------------- |
| `user_id`                  | `user_id`             |                                                   |
| `qty_assigned`             | `qty_assigned`        |                                                   |
| `qty_completed`            | `qty_completed`       | Also derived from `daily_entries` at read time    |
| `planned_hours`            | `estimated_hours`     |                                                   |
| `actual_hours`             | `actual_hours`        | Also derived from `daily_entries` at read time    |
| `status`                   | `status`              |                                                   |
| `due_date`                 | `due_date`            |                                                   |
| `remarks`                  | `remarks`             | New column in this migration                      |
| `notes`                    | `notes`               |                                                   |
| `description`              | `description`         |                                                   |
| `start_date`               | `start_date`          |                                                   |
| `progress_percentage`      | `progress_percentage` |                                                   |
| `daily_entries`            | `daily_entries`       | JSON string (see known issues below)              |
| N/A (activity-level)       | `sub_activity_name`   | New column; denormalized from activity definition |
| N/A (activity-level)       | `default_manhours`    | New column; denormalized from activity definition |
| N/A (activity-level)       | `discipline_name`     | Already existed                                   |
| N/A (activity-level)       | `activity_name`       | Already existed                                   |
| N/A (activity-level)       | `activity_id`         | Already existed                                   |

---

## Known issues / future work

### 1. Redundancy between `daily_entries` and `qty_completed`/`actual_hours`

`qty_completed` and `actual_hours` are stored as standalone columns but should be derived aggregates of `daily_entries`. The GET handler already computes them at read time:

```js
// route.js GET handler lines ~189-196
const derivedQty = dailyEntries.reduce(
	(s, e) => s + (parseFloat(e.qty_done) || 0),
	0
);
const derivedHours = dailyEntries.reduce(
	(s, e) => s + (parseFloat(e.hours) || 0),
	0
);
```

The stored column values can drift from the `daily_entries` ground truth because:

- The project sync writes `qty_completed`/`actual_hours` from the JSON blob (which may be stale).
- The user dashboard PUT handler doesn't update them when `daily_entries` changes.
- Nothing enforces consistency between the two.

**Fix:** Drop `qty_completed` and `actual_hours` columns, or replace them with generated/computed columns. Until then, treat `daily_entries` as the authoritative source for completed quantities and hours. The stored columns are vestigial for the dashboard path but still used by project sync and some report queries.

### 2. `daily_entries` JSON blob column

`daily_entries` is stored as a JSON string inside what is otherwise a normalized table — the same anti-pattern that was eliminated for `project_activities_list`. Every consumer does `JSON.parse` → iterate → `reduce` → `JSON.stringify`.

**Current scale:** 573 rows × ~10 entries average = ~500 KB of JSON. Manageable.

**Scaling concern:** The employee report loads **every row** with no date filter, parses **every JSON blob**, and builds per-user arrays in memory. At 10× scale (5,000 rows × 100 entries) that's ~50 MB parsed per request.

**Fix:** Normalize into a `user_activity_daily_entries` table (see `POOR_PRACTICES_AUDIT.md` §3.7 for schema). This enables date-range queries (`WHERE date BETWEEN`), per-row UPSERT instead of full-array read-modify-write, and SQL aggregation (`SUM(hours) GROUP BY date`).

**Effort:** ~1 sprint (5+ frontend components assume `daily_entries` arrives as an inline array). Track as tech debt; tackle when reports get slow or a date-filtered query becomes necessary.

### 3. `default_manhours` denormalization

`default_manhours` is an activity-level field stored on every assignment row. If the project edit form changes an activity's `default_manhours`, existing rows won't auto-update. This matches the old JSON blob behavior (same denormalization). If this becomes a problem, drop the column and JOIN to the project's JSON blob in the GET handler.

### 4. Row count at scale

573 rows today. The table can easily handle 100K+ rows with the existing indexes. The unique index on `(user_id, project_id, activity_id)` prevents duplicate assignments. No pagination is needed on the GET handler because it already filters by `WHERE user_id = ?` — a single user's assignments will always be bounded (typically < 100 rows).

The concern is not row count but JSON bloat inside each row (see §2 above).

---

## Re-running the data migration

```bash
# Dev
node scripts/migrate-activity-assignments.js

# Production
NODE_ENV=production node scripts/migrate-activity-assignments.js
```

Idempotent — uses `ON DUPLICATE KEY UPDATE`. Safe to run multiple times. Production has been run twice (2026-07-28) with 0 errors both times.

## Rollback

The `project_activities_list` JSON blob is still maintained by the PATCH handler and project sync. If the normalized table is lost or corrupted:

1. Re-run the column migration to recreate the table structure.
2. Re-run the data migration script to repopulate from JSON blobs.
3. The API routes will work immediately — they read the same table.

No data loss risk as long as `project_activities_list` JSON blobs are intact.
