# `daily_entries` — Data Model Reference

## Schema (stored in `user_activity_assignments.daily_entries`)

A JSON array of per-day work logs. Each entry:

```json
{
	"date": "2026-07-28",
	"qty_done": 5,
	"hours": 8,
	"remarks": "Completed piping isometrics",
	"isLocked": true
}
```

| Field      | Type                | Required | Notes                                                                     |
| ---------- | ------------------- | -------- | ------------------------------------------------------------------------- |
| `date`     | string (YYYY-MM-DD) | —        | Day the work was performed                                                |
| `qty_done` | number              | —        | Quantity completed that day                                               |
| `hours`    | number              | —        | Hours worked that day                                                     |
| `remarks`  | string              | —        | Free-text note                                                            |
| `isLocked` | boolean             | —        | UI-only; **not persisted to DB**. Set by `EditProjectForm.jsx` in memory. |

`daily_entries` is the **ground truth** for work tracking — it records what actually happened day by day. The parent row columns `qty_completed` and `actual_hours` are supposed to be aggregates but are stored independently and can drift (see `docs/explanations/ACTIVITY_NORMALIZATION.md` §1).

---

## Write paths (who creates/updates daily_entries)

### 1. Project edit form — admin/PM adds a day entry

**File:** `src/app/projects/[id]/edit/EditProjectForm.jsx`

- **`addDailyEntry(activityId, userId)`** (line 3813): Locks all previous entries (`isLocked: true`), appends new unlocked entry. Saved when the project form submits → flows through `projects/[id]/route.js` sync.
- **`updateDailyEntry(activityId, userId, entryIndex, field, value)`** (line 3857): Edits a single entry field in-place.
- **`removeDailyEntry(activityId, userId, entryIndex)`** (line 3883): Removes an entry.

All mutate the in-memory `project_activities_list` state. Persisted on project save.

### 2. Project activities report — admin edits/deletes entries

**File:** `src/app/reports/project-activities/page.jsx`

- **`saveEdited(pId, aId, uId, member)`** (line 282): Edits one entry, recomputes totals, calls `PUT /api/users/[id]/activity-assignments` with `{daily_entries, qty_completed, actual_hours}`.
- **`deleteEntry(pId, aId, uId, member, idx)`** (line 232): Removes one entry, recomputes totals, calls PUT.

### 3. User self-service add

**File:** `src/app/api/users/[id]/activity-assignments/route.js` — PATCH handler (~line 806)

Creates a default entry when a user adds themselves to a project activity:

```js
daily_entries: [
	{
		date: due_date || today,
		qty_done: qty_completed || 0,
		hours: manhours_assigned || 0,
		remarks: '',
	},
];
```

### 4. User dashboard edit

**File:** `src/app/api/users/[id]/activity-assignments/route.js` — PUT handler (~line 474)

Accepts `daily_entries` from request body, normalizes each entry to `{date, qty_done, hours, remarks}`, stores as JSON string.

### 5. Project save sync

**File:** `src/app/api/projects/[id]/route.js` (~line 1198)

Copies `daily_entries` from the `project_activities_list` JSON blob into `user_activity_assignments`. Uses UPSERT — won't overwrite entries created via other paths if the row already exists.

---

## Read paths (who consumes daily_entries)

| Consumer                          | File                                                           | What it does                                                                             |
| --------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Dashboard reminder**            | `src/app/dashboard/user-dashboard.jsx:435`                     | Checks if today's entry is locked — if not, shows a "pending activities" reminder banner |
| **My Activities tab**             | `src/app/projects/[id]/edit/tabs/MyActivitiesTab.jsx:276-286`  | Renders per-day rows with running balance (`qtyAssigned - doneSoFar`)                    |
| **Project activities report**     | `src/app/reports/project-activities/page.jsx`                  | Renders entries in admin report with inline edit/delete                                  |
| **Employee report API**           | `src/app/api/reports/employee-report/route.ts:260-296`         | Parses entries, explodes into per-day rows per user                                      |
| **Project activities report API** | `src/app/api/reports/project-activities/route.js:176-202`      | Parses entries, computes per-user totals                                                 |
| **Activity assignments GET**      | `src/app/api/users/[id]/activity-assignments/route.js:175-196` | Parses entries, computes derived `qty_completed`/`actual_hours`, returns as array        |

---

## Known issue: `isLocked` is ephemeral

`isLocked` is set in memory by `EditProjectForm.jsx:3834` but the `PUT` and `PATCH` handlers in the API strip it when normalizing entries to `{date, qty_done, hours, remarks}`. The column only stores those four fields.

Two consequences:

1. The **dashboard reminder** (`user-dashboard.jsx:436`) checks `e.isLocked` — but after a page reload, all entries are "unlocked." A user who closes the dashboard and reopens it won't see locked entries from a previous session. The reminder fires on false negatives.

2. The **MyActivitiesTab** re-derives locking from the date comparison (`entryDate < today` at line 464) as a fallback — this is the actual lock detection for the project edit form.

The `isLocked` field in the JSON is effectively dead weight on read. Only the date-based fallback matters.

---

## Known issue: redundant with `qty_completed` / `actual_hours`

The parent row has `qty_completed` and `actual_hours` columns that should equal `SUM(daily_entries.qty_done)` and `SUM(daily_entries.hours)`. The GET handler recomputes from `daily_entries` anyway. The stored columns can drift — see `docs/explanations/ACTIVITY_NORMALIZATION.md` §1 for details.
