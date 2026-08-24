# App Health Roadmap — Accent CRM

> Generated 2026-08-19 from codebase audit of `src/app/projects`, `migrations/`, `src/utils/*`, `src/app/api/*`.
>
> Complements `POOR_PRACTICES_AUDIT.md` — does not duplicate fixed items there. Each item has `file:line`, impact, and concrete fix.

## What was fixed in this pass

| Area                                                                                                                                                    | Files                                                                                                                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project tabs drifted — `[id]` (view) vs `[id]/edit` used different tab IDs/labels and different JSON keys, so data saved in edit never appeared in view | `src/lib/project-tabs.js:30` (new canonical), `src/app/projects/[id]/page.jsx:65`, `src/app/projects/[id]/edit/EditProjectForm.jsx:160`                                                                                                                                                            | Single `PROJECT_TABS` + `TAB_ALIASES` + alias resolver; view now merges `documents_received_list` + legacy `input_documents_list`, employee `deliverables` → `documents_issued` alias                                                                                                  |
| Manhours read-only rendered `monthly_hours: [object Object]`                                                                                            | `src/app/projects/[id]/page.jsx:1804`                                                                                                                                                                                                                                                              | Replaced `Object.keys(m).join` dump with FY table `Apr→Mar`, `add/sub/mul/toNumber` from `src/lib/money.ts:15` — same totals as `src/app/projects/[id]/edit/tabs/ProjectManhoursTab.jsx:128`                                                                                           |
| `Unknown column 'id'` on `projects` — PK is `project_id`                                                                                                | `src/utils/document-helpers.js:56`, `src/app/api/project-docs/route.js:96`, `src/app/api/projects/route.js:326`, `src/app/api/projects/[id]/route.js:1401`, `src/app/api/proposals/convert/route.js:165`, `src/app/api/messages/[id]/route.js:277`, `src/app/api/users/[id]/projects/route.js:189` | All switched to `WHERE project_id = ?` / `SELECT project_id`                                                                                                                                                                                                                           |
| Empty DB — no users/projects                                                                                                                            | `migrations/20260819120000_seed_dummy_data.js:1`, `scripts/seed-dummy-data.js:1`                                                                                                                                                                                                                   | Idempotent seed: `admin/Admin@123` (`is_super_admin=1`) + `rahul.sharma/User@123`, 3 companies, 5 categories, 5 projects with full tab JSON                                                                                                                                            |
| **P0.1 XSS via `dangerouslySetInnerHTML`**                                                                                                              | `src/lib/sanitize.js:1` (new), `src/app/projects/[id]/page.jsx:14` + `:54`, `src/app/projects/[id]/edit/tabs/ScopeTab.jsx:7` + `:16`, `src/app/messages/page.jsx:6` + `:1487`, `src/app/proposals/[id]/edit/page.jsx:6` + `:2704`                                                                  | `isomorphic-dompurify` + `sanitizeHtml()` wrapper; all 4 `dangerouslySetInnerHTML` sites now sanitized; TipTap scope/content and message bodies strip `<script>`/`on*`/`javascript:`                                                                                                   |
| **P0.2 Missing transaction on multi-write project update**                                                                                              | `src/utils/database.js:252` (new `withTransaction`), `src/app/api/projects/[id]/route.js:1062` (PUT transaction), `src/app/api/proposals/convert/route.js:103` (convert transaction)                                                                                                               | `withTransaction()` helper + `beginTransaction`/`commit`/`rollback` — `PUT /api/projects/[id]` atomic `UPDATE`+`team`+`UPSERT`s, `POST /api/proposals/convert` atomic `INSERT project`+`INSERT scope`+`UPDATE proposal`; `affectedRows===0` triggers rollback; `finally` release guard |

Verification: `npm run lint` on touched files clean, `npx tsc --noEmit` pre-existing errors only, `npx vitest run` — 87 files / 615 tests, full suite green (refreshed 2026-08-24 after Employee Project Cost report).

---

## P0 — Ship-blockers (data loss / 500 / security)

### P0.1 `HtmlContent` XSS via `dangerouslySetInnerHTML` ✅ FIXED 2026-08-19

- **Where:** `src/app/projects/[id]/page.jsx:14` `HtmlContent:54`, `src/app/projects/[id]/edit/tabs/ScopeTab.jsx:7` `:16`, `src/app/messages/page.jsx:1487`, `src/app/proposals/[id]/edit/page.jsx:2704` — all `dangerouslySetInnerHTML` from DB/TipTap.
- **Impact:** Stored XSS if `scope_of_work`/`description`/`msg.body` contains `<script>` / `onerror` / `javascript:`.
- **Fix:** `npm i isomorphic-dompurify` + `src/lib/sanitize.js:1` `sanitizeHtml()` (`DOMPurify.sanitize`) — all 4 sites wrapped `{{ __html: sanitizeHtml(html) }}`. `isomorphic-dompurify` works both server (jsdom) and client. TipTap formatting (`p/h1/h2/ul/ol/blockquote/strong/em/a`) preserved, scripts/handlers stripped.

### P0.2 Missing transaction on multi-write project update ✅ FIXED 2026-08-19

- **Where:** `src/app/api/projects/[id]/route.js:1111` (UPSERT `user_activity_assignments` loop after `UPDATE projects`), `src/app/api/proposals/convert/route.js:130` (`INSERT projects` then `INSERT project_scope` then `UPDATE proposals`).
- **Impact:** Partial write on failure — orphan project without scope.
- **Fix:** `src/utils/database.js:252` `withTransaction()` helper + inline `await db.beginTransaction()` / `commit()` / `rollback()` — `PUT /api/projects/[id]` wraps `UPDATE projects` + direct `project_team` patch + `user_activity_assignments` UPSERTs in one transaction (with `affectedRows===0` rollback guard); `POST /api/proposals/convert` wraps `INSERT projects` / `INSERT project_scope` / `UPDATE proposals` in a transaction with `finally` release guard. `withTransaction()` added for future routes.

### P0.3 `priority` column drift (just caused migrate failure)

- **Where:** `src/app/api/projects/route.js:277` writes `priority`, but `migrations/20260722080106_baseline_schema.js:1979` `projects` has no `priority` column.
- **Impact:** `ER_BAD_FIELD_ERROR` on `POST /api/projects` and seed.
- **Fix:** Add migration `ADD COLUMN priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'` after `type`, backfill `UPDATE projects SET priority='MEDIUM' WHERE priority IS NULL`. Alternative: remove `priority` from API if not needed — decide.

### P0.4 Rate limiter + userCache won't scale

- **Where:** `proxy.ts:38` `rateLimitStore Map`, `src/utils/api-permissions.js:21` `userCache Map + pendingUserFetches`.
- **Impact:** Per-instance limits on Vercel/multi-pod; cache stale 5m can serve revoked user.
- **Fix:** Move `rateLimitStore` to Upstash Redis / Vercel KV; keep `userCache` but invalidate on `revokeSession` (`src/utils/session.ts` already does) — add `invalidateUserCache` call in `POST /api/logout`.

## P1 — High value (<1 day each)

### P1.1 List endpoints `SELECT *` + JS filtering, no pagination

- **Where:** `src/app/api/projects/list/route.js:91` `SELECT * FROM projects WHERE isDelete=0` then `filter(isUserInProjectTeam)` in JS, same in `src/app/api/projects/route.js:58`, `src/app/api/users/[id]/projects/route.js:77`.
- **Impact:** Loads all rows, leaks `project_team` JSON, O(n) per request.
- **Fix:** Server-side `WHERE isDelete=0 AND (is_super_admin OR JSON_SEARCH(project_team,'one',?,'$[*].id') IS NOT NULL)` + `LIMIT ? OFFSET ?` + `ORDER BY created_at DESC`. Return `{data,total,page,pageSize}`. Add index on `isDelete,created_at`.

### P1.2 `EditProjectForm.jsx` monolith (5231 lines, `// @ts-nocheck`)

- **Where:** `src/app/projects/[id]/edit/EditProjectForm.jsx:1` — 30+ `useState`, inline fetch, all tab wiring.
- **Impact:** Unreviewable, no code-split, slow HMR.
- **Fix:** Extract `useProjectForm(id)` hook (fetches `GET /api/projects/[id]/detail`, hydrates `form`/`projectActivities`/lists), and `useProjectTeam()` hook. Dynamic import heavy tabs `next/dynamic` with skeletons.

### P1.3 Duplicate `Object.keys` → `SUM` should be SQL

- **Where:** `src/app/api/users/[id]/activity-assignments/route.js:175` parses `daily_entries` JSON + `reduce` in 6 places (also noted in `POOR_PRACTICES_AUDIT.md:3.7`).
- **Impact:** Cannot query `hours WHERE date BETWEEN` without loading all rows.
- **Fix:** When touching reports next, normalize `user_activity_daily_entries` table per audit plan. No need to block other work.

### P1.4 Env mismatch

- **Where:** `knexfile.js:host:process.env.DB_HOST` vs `src/utils/database.js:pool` uses `DEV_DB_*`/`PROD_DB_*`. `.env` currently `DB_HOST=94.103.163.250` (hardcoded IP).
- **Fix:** Add `src/utils/env.ts` with `zod` validation, fail fast if `DEV_DB_NAME` missing; never commit `.env`.

## P2 — Polish / debt

- **Money vs format drift:** `src/lib/money.ts:15` (Decimal) vs `src/lib/format.js` (Intl on floats) — keep money math in Decimal, only `toNumber` at DB boundary (already done in manhours fix).
- **Shared `ProjectManhoursTable`:** View now duplicates edit FY table. Extract `src/components/projects/ProjectManhoursTable.tsx` with `readOnly` prop to avoid drift.
- **Typecheck script missing:** `package.json` has no `typecheck` — add `"typecheck": "tsc --noEmit"` and fix pre-existing 60+ errors in `src/__tests__/api/admin/invoices/*`.
- **Document upload coverage:** `src/app/api/document-upload/route.js` + `src/utils/document-helpers.js` had 0 tests before the `id` bug. Add `src/__tests__/api/document-upload/route.test.ts` mocking `query` for `project_id` path.

## How to verify each P0

1. `npx tsc --noEmit` — must be 0 new errors after XSS sanitizer + priority migration.
2. `npm run migrate && npm run migrate:status` — 19/19, no pending.
3. `npx vitest run src/__tests__/projects src/__tests__/api/document-upload` — green.
4. Manual: login as `admin/Admin@123` and `rahul.sharma/User@123`, open `PROJ-001` view vs edit — every tab shows same `documents_received`/`documents_issued`/`manhours` (no `[object Object]`), upload a PDF in view → appears in edit and vice versa, `project_team` filter hides `PROJ-001` from a third user not in team.

## Ownership

- DB / migrations: owner `src/utils/database.js` + `migrations/*`
- Projects tabs: owner `src/app/projects/[id]/*` + `src/lib/project-tabs.js`
- Documents: owner `src/app/api/document-upload/*` + `src/utils/document-helpers.js`
