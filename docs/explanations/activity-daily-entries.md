# `daily_entries` — Data Model Reference

> Current reference — last verified 2026-10-06 against the source files linked below. Part of the
> [documentation index](../README.md). For the July 2026 normalization migration, see
> [ACTIVITY_NORMALIZATION.md](./ACTIVITY_NORMALIZATION.md).

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

| Field      | Type                | Required | Notes                                                                                                                       |
| ---------- | ------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `date`     | string (YYYY-MM-DD) | —        | Day the work was performed                                                                                                  |
| `qty_done` | number              | —        | Quantity completed that day                                                                                                 |
| `hours`    | number              | —        | Hours worked that day                                                                                                       |
| `remarks`  | string              | —        | Free-text note                                                                                                              |
| `isLocked` | boolean             | —        | Lock flag set by `EditProjectForm.jsx` when a new entry is added. Round-trips through the API (see “Lock semantics” below). |

`daily_entries` is the **ground truth** for work tracking — it records what actually happened day by day. The parent row columns `qty_completed` and `actual_hours` are supposed to be aggregates but are stored independently and can drift (see [ACTIVITY_NORMALIZATION.md](./ACTIVITY_NORMALIZATION.md) §1).

---

## Write paths (who creates/updates daily_entries)

### 1. Project edit form — admin/PM adds a day entry

**File:** `src/app/projects/[id]/edit/EditProjectForm.jsx`

- **`addDailyEntry(activityId, userId)`** (line 3815): Locks all previous entries (`isLocked: true`, lines 3843-3847), appends a new unlocked entry dated the day after the last entry (or today). Saved when the project form submits → flows through `projects/[id]/route.js` sync.
- **`updateDailyEntry(activityId, userId, entryIndex, field, value)`** (line 3849): Edits a single entry field in-place.
- **`removeDailyEntry(activityId, userId, entryIndex)`** (line 3877): Removes an entry.

All mutate the in-memory `project_activities_list` state. Persisted on project save.

### 2. Project activities report — read-only

The July 2026 "project activity redo" (commit `9c06a27`) removed the inline edit/delete handlers. `src/app/reports/project-activities/page.tsx` now exposes filters only, and data loading lives in `src/app/reports/project-activities/data-source.ts` (`fetchProjectActivitiesData`, which parses entries via `parseDailyEntryRecords` at line 152). Admin edits to daily entries happen through the project edit form (path 1).

### 3. User self-service add

**File:** `src/app/api/users/[id]/activity-assignments/route.js` — PATCH handler (line 726)

Creates a default entry when a user adds themselves to a project activity (lines 801-806):

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

**API:** `src/app/api/users/[id]/activity-assignments/route.js` — PUT handler (line 347)

Accepts `daily_entries` from the request body, normalizes each entry's `date`/`qty_done`/`hours`/`remarks`, and stores the array as a JSON string (lines 481-500). Unknown entry fields are preserved (`isLocked` survives the round-trip).

**UI:** `src/components/ProjectActivityAssignments.jsx` (PUT at lines 203/412, DELETE at line 448), rendered by `src/app/dashboard/user-dashboard.jsx` (~line 1253).

### 5. Project save sync

**File:** `src/app/api/projects/[id]/route.js` (~lines 1131-1315)

Copies `daily_entries` from the `project_activities_list` form payload into `user_activity_assignments`. Uses a per-row UPSERT keyed on `(user_id, project_id, activity_id)`: rows omitted from the payload are not deleted, but submitted fields — including `daily_entries` — are overwritten with the form's copy, so saving a stale form can clobber entries added elsewhere.

---

## Read paths (who consumes daily_entries)

| Consumer                          | File                                                                 | What it does                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Dashboard reminder**            | `src/app/dashboard/user-dashboard.jsx:441-454`                       | Shows the "pending activities" reminder when an assignment has no entry dated today (does not use `isLocked`) |
| **My Activities tab**             | `src/app/projects/[id]/edit/tabs/MyActivitiesTab.jsx:276-284`        | Renders per-day rows with running balance (`qtyAssigned - doneSoFar`); lock fallback at 463-465               |
| **Project activities report**     | `src/app/reports/project-activities/page.tsx` + `data-source.ts:152` | Read-only matrix; entries parsed via `parseDailyEntryRecords`                                                 |
| **Employee report API**           | `src/app/api/reports/employee-report/route.ts:229`                   | Parses entries via `parseDailyEntryRecords`, expands into per-day rows per user                               |
| **Project activities report API** | `src/app/api/reports/project-activities/route.js:47`                 | Delegates to `fetchProjectActivitiesData()` in `data-source.ts`                                               |
| **Activity assignments GET**      | `src/app/api/users/[id]/activity-assignments/route.js:144-168`       | Parses entries inline, derives totals as a fallback when stored columns are 0/absent                          |

Most server-side report readers decode the blob through one canonical module, `src/lib/logged-hours.ts` (ADR-0010): `parseDailyEntries` for logged hours, `parseDailyEntryRecords` where the reader also needs `qty_done` / `remarks`, and `sumLoggedHoursForMonth` / `hoursByDateForMonth` for the aggregates. Add a new reader there rather than parsing the JSON again. The activity-assignments API route (GET/PUT) still parses/normalizes inline.

---

## Lock semantics

`isLocked` is set by `EditProjectForm.jsx` when a day entry is added (previous entries are marked locked, new entry unlocked). It is **persisted**: the PUT handler keeps unknown entry fields during normalization (`route.js:481-500`), and project save stores the array as submitted. Entries created by the self-service PATCH path carry no `isLocked`.

Who reads it:

1. The **dashboard reminder** no longer consults `isLocked` — it fires when an assignment has no entry dated today (`user-dashboard.jsx:441-454`). An earlier version checked `e.isLocked` and fired false negatives; that was fixed.
2. The **MyActivitiesTab** treats an entry as locked when `entry.isLocked === true` OR the entry date is before today (`MyActivitiesTab.jsx:463-465`), so locking still works for rows saved before the flag was persisted.

---

## Known issue: redundant with `qty_completed` / `actual_hours`

The parent row has `qty_completed` and `actual_hours` columns that should equal `SUM(daily_entries.qty_done)` and `SUM(daily_entries.hours)`. The GET handler returns the stored column when non-zero and falls back to the derived sum otherwise (`route.js:182-184`). The stored columns can drift — see [ACTIVITY_NORMALIZATION.md](./ACTIVITY_NORMALIZATION.md) §1 for details.
