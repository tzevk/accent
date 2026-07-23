# Poor Practices Audit — Accent CRM

> Generated 2026-07-23 from automated scout analysis + targeted research across `src/`.

Each finding includes concrete file:line references, severity, and a recommended fix. Findings already tracked in other docs (inline DDL, soft-delete gaps, responsive issues) are cross-referenced, not duplicated.

---

## 1. Critical Security Issues

### 1.1 Plaintext Password Storage ✅ FIXED

**Severity:** ~~🔴 Critical — data breach risk~~ → **Resolved 2026-07-23**

Passwords were stored and compared as **raw strings**. Fixed with bcrypt hashing.

| File                                        | Fix                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/utils/password.ts`                     | New — `hashPassword()`, `verifyPassword()`, `needsRehash()` using bcrypt                           |
| `src/app/api/login/route.js`                | Now: `verifyPassword()` then auto-upgrades legacy plaintext to bcrypt                              |
| `src/app/api/auth/login/route.js`           | Full rewrite — `verifyPassword()` with bcrypt                                                      |
| `src/app/api/settings/password/route.js`    | `verifyPassword()` for current, `hashPassword()` before save; also fixed `db.end()`→`db.release()` |
| `src/app/api/users/route.js`                | POST handler: `hashPassword()` before INSERT                                                       |
| `src/app/api/users/reset-password/route.js` | `hashPassword()` before UPDATE; removed plaintext comment; fixed `db.end()`→`db.release()`         |

**Legacy migration path:** `verifyPassword()` detects plaintext (no `$2` prefix) and does direct comparison. On successful login, `needsRehash()` triggers an auto-upgrade to bcrypt — no manual migration needed.

### 1.2 API Endpoints With No Authentication ✅ FIXED

**Severity:** ~~🔴 Critical — unauthenticated access to internal resources~~ → **Resolved 2026-07-23**

| File                                                         | Fix                                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/app/api/admin/payment-entries/get-receipt-pdf/route.ts` | Added `ensurePermission(request, RESOURCES.ADMIN, PERMISSIONS.READ)` guard                |
| `src/app/api/admin/material-requisitions/download/route.js`  | Added `ensurePermission(request, RESOURCES.MATERIAL_REQUISITION, PERMISSIONS.READ)` guard |

Tests: `src/__tests__/api/admin/material-requisitions/download/route.test.ts` — 7 tests covering auth rejection (401/403), missing ID, not found, and HTML response content.

### 1.3 Wrong Permission Checks on Protected Routes ✅ FIXED

**Severity:** ~~🟠 High — users can access resources they shouldn't~~ → **Resolved 2026-07-23**

| File                                                              | Fix                                                                    |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/app/api/admin/outgoing-purchase-orders/route.ts:14,78,195`   | `RESOURCES.PROPOSALS` → `RESOURCES.PURCHASE_ORDERS` in GET/POST/DELETE |
| `src/app/api/admin/outgoing-purchase-orders/download/route.ts:33` | `RESOURCES.PROPOSALS` → `RESOURCES.PURCHASE_ORDERS` in GET             |
| `src/app/api/admin/accounts/download/route.js:14`                 | `RESOURCES.PROPOSALS` → `RESOURCES.ACCOUNTS` in GET                    |

### 1.4 Permission-Only (No RBAC) on Sensitive Routes ✅ FIXED

**Severity:** ~~🟠 High — any authenticated user can access~~ → **Resolved 2026-07-23**

| File                                                   | Fix                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `src/app/api/admin/cash-vouchers/download/route.js:14` | Replaced `getCurrentUser()` with `ensurePermission(request, RESOURCES.CASH_VOUCHER, PERMISSIONS.READ)` |

### 1.5 Mock/Dead Code With Hardcoded Admin ✅ FIXED

**Severity:** ~~🟠 High — if ever wired into a production path, grants universal admin~~ → **Resolved 2026-07-23**

| File                           | Fix                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/utils/rbac-middleware.js` | Deleted — zero imports/references in `src/`. Contained hardcoded admin mock + unused `withRBAC` wrapper. |

### 1.6 Rate Limiter Won't Survive Serverless

**Severity:** 🟡 Medium

`middleware.ts:35` uses an in-memory `Map` for rate limiting. On Vercel or any multi-instance deployment, each instance has its own store — rate limits are per-instance, not per-user.

**Fix:** Use an external store (Upstash Redis, Vercel KV) or a database-backed rate limiter.

---

## 2. Error Handling Anti-Patterns

### 2.1 Three Incompatible Error Response Shapes

**Severity:** 🔴 Critical — clients can't reliably parse errors

The API surface uses **three mutually incompatible** error shapes:

1. **`{ error: string }`** — no `success` field. Used in: `attendance/monthly`, `employees/import`, `payroll/salary-profile/batch`. Clients checking `response.success === false` get `undefined`.
2. **`{ success: false, error: string }`** — most common (~30+ modules). Some add `details: error.message`.
3. **`{ success: false, message: string }`** — used in `login`, `invoices/[id]`, `accounts`. Some add `error` as a second key alongside `message`.

In `src/app/api/admin/invoices/[id]/route.js`, a **single file** uses all three shapes:

- `{ success: false, message }` — auth/not-found (lines 16, 31, 73)
- `{ success: false, message, errors }` — validation (lines 128, 167, 199)
- `{ success: false, message, error }` — server errors (lines 443, 504)

**Fix:** Standardize on `{ success: false, error: string, code?: string }` across all routes. Create a shared `apiError(message, status, code?)` helper.

### 2.2 Raw Error Messages Leaked to Clients

**Severity:** 🟠 High — information disclosure

~100+ locations pass raw `error.message` to API consumers, exposing table names, column names, query structure, and internal schema details. Examples:

- `src/app/api/activities/route.js:79` — `details: error.message`
- `src/app/api/admin/expenses/route.js:103` — `error: error.message`
- `src/app/api/attendance/monthly/route.js:61` — `error: err.message`

**Fix:** Log the real error server-side; return a sanitized message to clients.

### 2.3 Empty Catch Blocks Silently Swallowing Errors

**Severity:** 🟠 High

14+ locations use `catch {}` (empty body) for non-trivial operations:

| File                                    | Line               | What's Swallowed                                                         |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| `src/app/api/activity-master/route.js`  | 239                | `DELETE FROM activities_master` failure — partial delete proceeds anyway |
| `src/app/api/software/route.js`         | 156                | Version deletion failure — software still marked as deleted              |
| `src/app/api/software-master/route.js`  | 207                | Category children deletion failure                                       |
| `src/app/api/settings/profile/route.js` | 116                | Employee auto-creation failure                                           |
| `src/app/api/employees/route.js`        | 125, 157, 308, 667 | Multiple: connection release, JSON validation, column mismatch           |

**Fix:** At minimum, log the error. Where the catch is around cleanup (`db.release()`), the release itself is safe (double-release protected) — remove the try/catch entirely.

### 2.4 Fire-and-Forget Promises With `.catch(console.error)`

**Severity:** 🟡 Medium

12+ locations fire async operations without awaiting and catch with only `console.error`:

| File                                         | Line     | Operation                                                                                    |
| -------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `src/app/api/logout/route.js`                | 19, 22   | `logActivity()` and `endUserSession()` — logout appears successful even if audit trail fails |
| `src/app/api/login/route.js`                 | 99, 115  | `logActivity()` — login audit silently dropped                                               |
| `src/app/api/admin/purchase-orders/route.js` | 306, 531 | `logActivity()` on create/update                                                             |
| `src/app/api/leads/route.js`                 | 369      | `logActivity()` on create                                                                    |
| `src/utils/activity-logger.js`               | 69       | `updateWorkSession()` — work session tracking silently lost                                  |

**Fix:** `await` the activity log or use a background queue. If fire-and-forget is intentional, use a structured logger with alerting, not `console.error`.

### 2.5 Use-After-Release Bug

**Severity:** 🔴 Critical — guaranteed runtime failure

`src/app/api/activity-master/route.js:237–245` — DELETE handler:

```js
try {
	await db.execute('DELETE FROM activities_master WHERE function_id = ?', [id]);
} catch {} // <-- swallows error
await db.execute('DELETE FROM functions_master WHERE id = ?', [id]); // <-- uses released db
```

The inner `try` has a `finally` that releases `db`, but the outer block continues using it. The empty catch swallows the error, making the bug invisible.

### 2.6 `db.release()` Before `return` (Not in Finally)

**Severity:** 🟡 Medium — connection leak on exception

`src/app/api/admin/material-requisitions/route.js:55,123` calls `db.release()` before `return NextResponse.json(...)`. If `NextResponse.json()` throws, the connection leaks.

**Fix:** Always release in `finally`.

### 2.7 `db.end()` vs `db.release()` Inconsistency

**Severity:** 🟡 Medium

~50+ files use `db.end()` while ~100+ use `db.release()`. `dbConnect()` aliases `end` → `release`, so both work functionally, but some files call the **real** `connection.end()`:

| File                                           | Line | Issue                                                              |
| ---------------------------------------------- | ---- | ------------------------------------------------------------------ |
| `src/app/api/admin/accounts/route.js`          | 136  | Calls `connection.end()` — terminates pool connection, not release |
| `src/app/api/admin/invoices/download/route.js` | 581  | `await connection.end()` — same issue                              |

**Fix:** Standardize on `db.release()`. Search-replace `db.end()` → `db.release()`.

---

## 3. Database Anti-Patterns

### 3.1 Schema DDL on Every Request

**Severity:** 🔴 Critical — massive per-request overhead

Already documented in `docs/DDL_AND_SOFT_DELETE_AUDIT.md`. Worst offenders not yet addressed:

| File                                                   | Impact                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `src/app/api/payroll/salary-profile/route.js:125–260`  | 50+ ALTER TABLE attempts on **every POST**                            |
| `src/app/api/admin/outgoing-quotations/route.js:12–72` | CREATE TABLE + multiple ALTER + index DROP/ADD on every GET/POST      |
| `src/app/api/messages/route.js:397–465`                | SHOW TABLES + 5x CREATE TABLE IF NOT EXISTS + ALTER on every GET/POST |

(See `DDL_AND_SOFT_DELETE_AUDIT.md` for full migration plan.)

### 3.2 N+1 Query Patterns

**Severity:** 🔴 Critical — linear degradation with data growth

| File                                    | Line           | Pattern                                                                                                             |
| --------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/admin/quotations/route.js` | 72–88, 108–125 | For each quotation with `project_id`, a separate SELECT fetches project name. 50 quotations = 50 extra round-trips. |
| `src/app/api/activities/route.js`       | 267–271        | Loops over activities executing one DELETE per iteration                                                            |
| `src/app/api/attendance/route.js`       | 335            | Upserts employee attendance summaries one-by-one in `for...of`                                                      |
| `src/app/api/companies/import/route.js` | 85, 209        | Individual INSERT per row in import loops                                                                           |
| `src/app/api/employees/import/route.js` | ~380           | One-at-a-time employee inserts                                                                                      |
| `src/app/api/messages/route.js`         | 303            | Inserts message attachments one-by-one                                                                              |
| `src/app/api/permissions/route.js`      | ~480           | Invalidates user cache one-at-a-time in loop                                                                        |

**Fix:** Use `INSERT INTO ... VALUES (...), (...), (...)`, `DELETE ... WHERE id IN (...)`, `UPDATE ... WHERE id IN (...)`, or `JOIN` to resolve lookups in one query.

### 3.3 Hard Deletes on Master Data

**Severity:** 🟡 Medium

Already documented in `DDL_AND_SOFT_DELETE_AUDIT.md` §2. Many master/utility tables still use hard `DELETE FROM` — roles, todos, holidays, banks, accounts, documents, activities master, sub-activities, etc.

### 3.4 Missing Transaction Wrapping for Multi-Statement Mutations

**Severity:** 🟠 High — partial writes on failure

| File                                           | Issue                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `src/app/api/activity-master/route.js:237–245` | Two DELETEs (activities_master + functions_master) without transaction      |
| `src/app/api/activities/route.js:267–291`      | Loop DELETE sub-activities then DELETE activity — no transaction            |
| `src/app/api/companies/import/route.js`        | Row-by-row INSERT without transaction — partial import leaves orphaned rows |
| `src/app/api/employees/import/route.js`        | Same — no transaction on import                                             |

### 3.5 Raw Transaction Strings

**Severity:** 🟡 Medium

| File                                       | Line | Issue                                                                                                            |
| ------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------- |
| `src/app/api/admin/cash-vouchers/route.js` | 251  | Uses `db.execute('START TRANSACTION')` / `db.execute('COMMIT')` instead of `db.beginTransaction()`/`db.commit()` |
| `src/app/api/permissions/route.js`         | 473  | Calls `db.execute('COMMIT')` without a preceding `START TRANSACTION` — orphaned commit                           |

### 3.6 `isDelete` Convention Inconsistency

**Severity:** 🟡 Medium

`src/app/api/admin/cash-vouchers/route.js:64,91,181,331` uses `(isDelete IS NULL OR isDelete = 0)` while most other routes use simply `isDelete = 0`. Two conventions in the same codebase.

---

## 4. Missing or Broken Pagination

**Severity:** 🔴 Critical — will crash under production data volumes

10+ list endpoints return **all rows** with no `LIMIT`/`OFFSET`:

| File                                                        | Details                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| `src/app/api/proposals/route.js:22–24`                      | `SELECT * FROM proposals WHERE isDelete = 0` — no LIMIT |
| `src/app/api/projects/route.js:70–85`                       | Fetches ALL projects, filters in JS memory              |
| `src/app/api/companies/route.js:83–90`                      | `SELECT c.*` with LEFT JOINs, no LIMIT                  |
| `src/app/api/vendors/route.js:22–24`                        | `SELECT * FROM vendors` — no LIMIT                      |
| `src/app/api/followups/route.js:49–56`                      | Returns ALL follow_ups when no filter                   |
| `src/app/api/projects/list/route.js:90–92`                  | Labeled "Optimized endpoint" but no pagination          |
| `src/app/api/proposals/list/route.js:80–82`                 | Same — no LIMIT despite being `/list`                   |
| `src/app/api/admin/outgoing-purchase-orders/route.ts:48–50` | No LIMIT                                                |

**Fix:** Add `LIMIT ? OFFSET ?` to every list query. Return `{ data, total, page, pageSize }`.

---

## 5. Code Organization

### 5.1 Monolithic Files

**Severity:** 🟠 High

| File                                    | Lines  | Problem                                                                                                          |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `src/utils/schema-init.js`              | 2,817  | Single file with 35+ `initXxxTable` functions. Deprecated — delete it.                                           |
| `src/app/reports/page.jsx`              | 1,717  | 20+ useState hooks, inline 400-line HTML template, export logic, bonus modal, salary viewer all in one component |
| `src/app/admin/cash-voucher/page.jsx`   | 1,400+ | Monolithic cash voucher page                                                                                     |
| `src/components/admin/ResourcePage.tsx` | 1,001  | 22+ props — list, form, stats, pagination, search, delete, autofill all in one                                   |
| `src/utils/payroll-calculator.js`       | 1,623  | DA queries, holidays, attendance, salary, PF/ESIC/PT, bonus, PDF — all mixed                                     |
| `src/components/Navbar.jsx`             | 908    | 3 large navigation config arrays (~320 lines), inline sub-components, permission helpers                         |
| `src/components/Sidebar.jsx`            | 521    | 6 useState + 5 useEffect + unread polling + localStorage sync                                                    |

### 5.2 Duplicated Utility Functions

**Severity:** 🟠 High

`formatDate` is copy-pasted into **20+ page files**:

- `src/app/admin/invoice/page.jsx:123`
- `src/app/admin/accounts/page.jsx:141`
- `src/app/admin/audit-logs/page.jsx:126`
- `src/app/admin/cash-voucher/page.jsx:147`
- `src/app/admin/dashboard/page.jsx:699`
- `src/app/admin/material-requisition/page.jsx:147`
- `src/app/admin/outgoing-purchase-order/page.tsx:268`
- `src/app/admin/purchase-order/page.jsx:310`
- `src/app/admin/quotation/page.jsx:159`
- `src/app/admin/todos/page.jsx:119`
- ...and 10+ more

`MONTHS` array duplicated across `src/app/api/admin/invoices/route.js:124`, `src/app/api/admin/invoices/next-number/route.js:5`, `src/app/masters/holidays/page.jsx:69` — each with a slightly different format.

**Fix:** One `formatDate` in `src/utils/date.ts`. One `MONTHS` constant in `src/utils/constants.ts`.

### 5.3 Competing Permission Systems

**Severity:** 🟡 Medium

Three permission checkers with **different logic**:

1. `src/utils/rbac.js:210` — `hasPermission(user, resource, perm)` — checks flat arrays only
2. `src/utils/permissions.js:50` — `checkPermission(user, resource, perm)` — adds `field_permissions` check
3. `src/utils/api-permissions.js:293` — `ensurePermission(request, resource, perm)` — wraps both with caching

`permissions.js` imports from `rbac.js` then re-exports `RESOURCES`/`PERMISSIONS`. `api-permissions.js` imports from both. The chain is confusing and two modules do the same core thing with different function names.

Some API routes import from all three:

`src/app/api/reports/employee-report/route.ts` uses `getCurrentUser` from `api-permissions`, `hasPermission` from `rbac`, `RESOURCES`/`PERMISSIONS` from `permissions`.

**Fix:** Consolidate into a single permissions module. Delete `rbac.js`, migrate all callers to `permissions.js`.

### 5.4 Dead Code

| File                           | Details                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `src/components/StatsCard.jsx` | 0 bytes — empty file                                                |
| `src/utils/schema-init.js`     | 2,817 lines — superseded by Knex migrations                         |
| `src/utils/db-safe.js`         | Duplicate safe wrappers — `database.js` already provides `withDb()` |
| `src/utils/db-monitor.js`      | Monitoring utilities not used in routes                             |

### 5.5 Magic Strings Without Constants

**Severity:** 🟡 Medium

- Status strings (`'pending'`, `'paid'`, `'hold'`, `'processed'`) used directly across 39+ files
- `'ATSPL'` company identifier hardcoded across 15+ files (next-number generators, PDF templates, default form values)
- Payment types, ticket statuses, priority levels — all string literals

**Fix:** Centralize in `src/utils/constants.ts` as string enums or const objects.

### 5.6 Nested Ternaries in JSX

**Severity:** 🟡 Medium

`src/app/admin/salary-sheet/page.jsx:549–556` — 3-level nested ternary for payment status. Same pattern duplicated at `src/app/admin/salary-slip/page.jsx:333–340`.

`src/app/reports/page.jsx:566` — arithmetic expression (`parseFloat(...) - parseFloat(...)` with `.toFixed(1)`) inside a ternary inside JSX interpolation.

**Fix:** Extract to named helper functions or a status-to-component map.

### 5.7 Empty Helper Files

**Severity:** Low

`src/utils/db-safe.js` and `src/utils/db-monitor.js` provide wrappers that essentially duplicate `database.js` functionality but are unused by route code.

---

## 6. Performance Issues

### 6.1 Sequential DB Queries That Could Be Parallel

**Severity:** 🟡 Medium

| File                                                     | Details                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/app/api/admin/cash-vouchers/route.js:70–96`         | 3 sequential queries (vouchers, count, stats) — stats is independent |
| `src/app/api/admin/other-expenses/route.ts:71–95`        | Same pattern                                                         |
| `src/app/api/admin/material-requisitions/route.js:33–53` | Same pattern                                                         |
| `src/app/api/activity-master/route.js:54–73`             | 3 sequential queries; activities and sub-activities are independent  |
| `src/app/api/software-master/route.js:24–40`             | 3 sequential; software and versions are independent                  |

**Fix:** `await Promise.all([query1, query2, query3])`.

### 6.2 Synchronous File I/O in Request Handlers

**Severity:** 🟠 High — blocks the event loop

| File                                    | Line    | Operation                                  |
| --------------------------------------- | ------- | ------------------------------------------ |
| `src/app/api/proposals/export/route.js` | 76, 241 | `fs.readFileSync` in API handler           |
| `src/app/api/proposals/pdf/route.js`    | 326     | `fs.readFileSync`                          |
| `src/app/api/uploads/route.js`          | 33–67   | `existsSync`, `mkdirSync`, `writeFileSync` |

**Fix:** Use `fs.promises` (`await fs.readFile(...)`, `await fs.writeFile(...)`).

### 6.3 JSON.parse in Render Loops

**Severity:** 🟡 Medium

`src/app/admin/cash-voucher/page.jsx:70` — `JSON.parse(v.line_items)` inside `.map()` during render. Parses on every re-render. Same in `src/app/admin/material-requisition/page.jsx:324`.

**Fix:** Parse once in the data-fetching layer and store parsed objects.

### 6.4 Sequential Client-Side API Calls

**Severity:** 🟡 Medium

`src/app/proposals/[id]/page.js:770–772` — `await fetchVersions()` then `await fetchApprovals()` sequentially instead of `await Promise.all([...])`.

### 6.5 Large Un-Code-Split Components

**Severity:** 🟡 Medium

| File                                             | Lines |
| ------------------------------------------------ | ----- |
| `src/app/projects/[id]/edit/EditProjectForm.jsx` | 5,284 |
| `src/app/proposals/[id]/page.js`                 | 3,216 |
| `src/app/projects/page.jsx`                      | 1,811 |
| `src/app/employees/page.jsx`                     | 5,481 |

These are loaded eagerly. Only 2 files use `next/dynamic` for code splitting.

**Fix:** Use `next/dynamic(() => import(...))` with loading skeletons for heavy page sections.

### 6.6 Global CSS Causing Content Hidden on Mobile

**Severity:** 🔴 Critical — mobile content hidden behind navbar

Already documented in `RESPONSIVE_AUDIT.md` §1.1: `.content-with-sidebar` has no `padding-top` on mobile, so content renders behind the fixed Navbar.

---

## 7. TypeScript Migration Gaps

**Severity:** 🟡 Medium

- `src/utils/` has mixed JS/TS: `schema-init.js`, `permissions.js`, `rbac.js` alongside `buildReceiptHTML.ts`, `invoice-validation.ts`
- API routes are ~80% `.js` / 20% `.ts` with no clear migration plan
- `allowJs: true` is on, so old JS keeps type-checking — but new TypeScript files can't safely import JS modules without declaration files
- No `typecheck` script in `package.json` — type errors accumulate silently

---

## Priority Matrix

| Priority | Category | Impact | Effort |
| **P0 — Done ✅** | ~~Plaintext passwords (§1.1)~~ | BCrypt implemented, auto-upgrade path | ~~~2 days~~ → Done |
| **P0 — Done ✅** | ~~No-auth endpoints (§1.2)~~ | Auth guards added to both routes | ~~~1 hour~~ → Done |
| **P0 — Done ✅** | ~~Wrong permission checks (§1.3)~~ | 3 routes fixed (PROPOSALS→correct resource) | ~~~1 hour~~ → Done |
| **P0 — Done ✅** | ~~Permission-only routes (§1.4)~~ | Cash-vouchers download now uses ensurePermission | ~~~30 min~~ → Done |
| **P0 — Done ✅** | ~~Hardcoded admin mock (§1.5)~~ | Deleted rbac-middleware.js | ~~~5 min~~ → Done |
| **P0 — Immediate** | Use-after-release bug (§2.5) | Guaranteed runtime crash | ~5 min (remove empty catch + fix flow) |
| **P1 — This sprint** | N+1 queries (§3.2) | Linear perf degradation | ~1 day (batch queries) |
| **P1 — This sprint** | Missing pagination (§4) | Crash under production data | ~2 days (add LIMIT/OFFSET everywhere) |
| **P1 — This sprint** | Inline DDL — unguarded routes (§3.1) | 50+ ALTERs per request | ~2 hours (strip DDL) |
| **P2 — Next sprint** | Error shape standardization (§2.1) | Client reliability | ~1 day (shared error helper) |
| **P2 — Next sprint** | Error message sanitization (§2.2) | Information disclosure | ~1 day (audit + sanitize) |
| **P2 — Next sprint** | Empty catch blocks (§2.3) | Silent failures | ~2 hours (add logging or remove) |
| **P2 — Next sprint** | Duplicated utilities (§5.2) | Maintenance burden | ~1 day (extract shared utils) |
| **P3 — Backlog** | Monolithic component refactors (§5.1) | Developer velocity | Ongoing |
| **P3 — Backlog** | Permission system consolidation (§5.3) | Code clarity | ~2 days |
| **P3 — Backlog** | TypeScript migration (§7) | Type safety | Ongoing |
| **P3 — Backlog** | Sequential → parallel queries (§6.1) | Marginal perf gain | ~2 hours |
| **P3 — Backlog** | Rate limiter external store (§1.6) | Multi-instance safety | ~1 day |

## What's Already Well-Done

It's worth noting what the codebase does well:

- **Consistent parameterized queries** — SQL injection risk is low; `?` placeholders used pervasively
- **Double-release protection** — `dbConnect()` wraps `release()` to prevent double-release crashes
- **Connection pool with graceful shutdown** — `database.js` handles SIGTERM/SIGINT cleanly
- **Middleware as single auth gate** — authentication is enforced in one place, not scattered
- **Session permissions cache** — the `session_permissions` cookie avoids DB lookups for most requests
- **Stale-on-failure user cache** — prevents cascading 401s when DB pool is exhausted
- **Proper finally-block release** — ~90% of routes release connections correctly
- **Password hashing with bcrypt** — `src/utils/password.ts` with auto-upgrade of legacy plaintext on login
