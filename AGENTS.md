# Repository Guidelines

## Project Overview

Accent CRM is an internal ERP/CRM platform built with **Next.js 15 App Router** and **MySQL**. It manages the full business lifecycle: leads → proposals → projects, employees/payroll, invoicing, purchase orders, support tickets, activity tracking, and financial documents.

- **Runtime**: Node 24.x, ESM (`"type": "module"`)
- **DB**: MySQL via `mysql2/promise` connection pool + Knex migrations (18 files: 1 baseline + 17 incremental)
- **Auth**: Opaque server-side session token in a single HttpOnly `session` cookie, validated against the `sessions` table on every API request (Edge middleware is presence-check only)
- **Styling**: Tailwind CSS v4 (CSS-first, no `tailwind.config.js`)
- **Language mix**: Legacy JS/JSX (dominant), newer code in TS/TSX. Migration is gradual — new files SHOULD be TypeScript.
- There is no `README.md`/`CONTRIBUTING.md` — this file is the de-facto repo guide.

## Architecture & Data Flow

```
Browser
  │
  ▼
middleware.ts (Edge)          ← session-cookie presence check, rate limiting, public-path allowlist
  │
  ▼
Next.js App Router            ← pages (RSC + 'use client'), API routes
  ├─ SessionContext           ← fetches /api/session, provides user + permissions to client
  ├─ QueryProvider            ← TanStack Query v5 (staleTime: 30s, retry: 1)
  └─ Sidebar / Navbar         ← permission-gated navigation
  │
  ▼
API Routes (route.js/route.ts)
  ├─ ensurePermission()       ← server-side RBAC guard (getCurrentUser validates the session token against the sessions table)
  ├─ dbConnect() / withDb()   ← MySQL connection pool (singleton, HMR-safe via globalThis)
  └─ logActivity()            ← audit trail for mutations
  │
  ▼
MySQL                         ← DECIMAL for money, soft-delete (isDelete), 110+ tables
```

### Auth Flow

1. `/api/login` verifies the bcrypt hash (legacy plaintext hashes auto-upgrade via `verifyPassword`/`needsRehash`), inserts a `sessions` row (`token_hash` = SHA-256 of a fresh 256-bit token, `expires_at` via `DATE_ADD(NOW(), INTERVAL 30 DAY)`), and sets one HttpOnly `session` cookie (`SameSite=Lax`, `Secure` in production, `priority: 'high'`, 30-day `Max-Age`). Legacy `auth`/`user_id`/`is_super_admin`/`session_permissions` cookies are cleared at login with `maxAge: 0` and have no readers anywhere.
2. `middleware.ts` (Edge) is routing-only: public-path allowlist (`/signin`, `/api/login`, `/api/logout`, `/api/auth`, `/api/session`, `/api/attendance/webhook`, `/_next`, static assets, `/public`, `/uploads`), session-cookie **presence** check, and Edge rate limiting (5 categories: `auth` 10 req/15 min → block 30 min; `session` 120/min; `dashboard` 60/min; `api` 120/min; `heavy` 10/min for `export|report|bulk` paths; keyed `${ip}:${sessionValue}:${category}`). Authenticated users on `/signin` → `/dashboard`; unauthenticated pages → `/signin?from=<path>`; protected pages get `Cache-Control: no-store`. A forged/planted cookie passes middleware but 401s at the Node boundary — real validation happens in `getCurrentUser`.
3. `getCurrentUser(request)` (in `src/utils/api-permissions.js`) — called by `ensurePermission` on every API route and by `getServerAuth()` in server layouts — hashes the cookie token and validates it in one round trip: `sessions JOIN users LEFT JOIN roles_master LEFT JOIN employees`, filtered by `expires_at > NOW()` and `u.isDelete = 0` LIMIT 1. Results are cached 5 minutes in an in-memory `Map` (TTL + in-flight dedup; DB failure falls back to stale cache). No DB row (missing, expired, or revoked) → `null` → 401.
4. Logout deletes the current token's row (`revokeSession`) plus `endUserSession` + `logActivity('logout')`; password change/reset deletes every row for the user (`revokeAllUserSessions`) plus a user-cache sweep. Multi-session is supported — one row per login, revocation = row deletion.
5. `SessionContext` hydrates from `/api/session` on mount and re-fetches on every SPA pathname change and on tab-visibility change (no polling interval). Client checks use `useSession().can(resource, action)` or legacy `useSessionRBAC()`.
6. Server API routes use `ensurePermission(request, RESOURCE, ACTION)` — returns `{ authorized: true, user }` or a 401/403 `NextResponse`; newer `route.ts` handlers check `if (authResult instanceof Response) return authResult;`. Admin pages are gated server-side in `src/app/admin/layout.tsx` (`force-dynamic` + `getServerAuth()` + `is_super_admin || role.code === 'admin'`).

Session helpers live in `src/utils/session.ts` (`createSession`, `revokeSession`, `revokeAllUserSessions`, `SESSION_TTL_SECONDS = 30 * 24 * 60 * 60`).

### Permissions (RBAC)

Two systems coexist and are OR'd together by `checkPermission` (`src/utils/permissions.js`):

- **Flat permissions** (legacy/primary): `"resource:action"` arrays (e.g. `"leads:read"`), stored as JSON arrays in `users.permissions` + `roles_master.permissions`, merged via `mergePermissions(role, user)` (set union) into `user.merged_permissions`. Checked with `merged_permissions.includes(key)`.
- **Field permissions** (newer): nested JSON `{ modules: { leads: { enabled: true, crud: { read: true }, sections: { [section]: { enabled, fields: { [field]: { permission: 'hidden'|'view'|'edit' } } } } } } }`. `stripDisabledModules()` drops `enabled: false` modules at load; helpers: `isModuleEnabled`, `getFieldPermission`, `canViewField`, `canEditField`, `checkModulePermission`.

`src/utils/rbac.js` defines ~40 `RESOURCES` and 10 `PERMISSIONS` (read/create/update/delete/close/export/import/approve/assign/convert). `PERMISSION_TEMPLATES` (VIEWER/EDITOR/MANAGER/ADMIN) exist but have no usage site — treat as dead config. Super admin (`users.is_super_admin`, DB-backed) bypasses every check; `/admin/*` is gated server-side. `getCurrentUser` returns both `merged_permissions` and `field_permissions`.

## Key Directories

| Directory         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`        | Next.js App Router — pages (`page.jsx`/`page.tsx`), layouts, and API routes (`api/**/route.js`). Top-level: `admin/`, `api/`, `company/`, `dashboard/`, `employees/` (contract/payroll/attendance), `gate/`, `leads/`, `masters/`, `messages/`, `profile/`, `projects/`, `proposals/`, `reports/` (8 report pages), `signin/`, `tickets/`, `users/`, `vendors/`, `work-logs/`. Newer pages are `.tsx` (admin expenses/other-expenses/payment-entry/payment-issue/purchase-invoice/quotation-outgoing, masters deliverables, all reports); legacy finance pages remain `.jsx` |
| `src/app/api/`    | ~60 route dirs: auth (login/logout/session), masters, reports, projects, proposals, invoices, payroll, analytics, attendance, messages, uploads, health, seed                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/components/` | Shared React components — `ui/` primitives (Button, Modal, Table, FormFields, SearchableSelect — `.jsx` + `.d.ts` stubs), `admin/ResourceFormModal.tsx` (shared TanStack Form renderer), `providers/QueryProvider.tsx`, `Sidebar`, `Navbar`, `AuthGate` (no-op)                                                                                                                                                                                                                                                                                                              |
| `src/utils/`      | Server utilities — `database.js` (pool), `api-permissions.js` (ensurePermission + getCurrentUser), `permissions.js`/`rbac.js` (RBAC), `session.ts`, `activity-logger.ts`, `password.ts`, `server-auth.js` (getServerAuth), `schema-cache.js` (hasColumn), `payroll-calculator.js`, `invoice-validation.ts`                                                                                                                                                                                                                                                                   |
| `src/lib/`        | Shared libraries — `money.ts` (decimal arithmetic), `format.js` (INR formatting), `api-client.js` (fetch wrapper), `cn.js` (Tailwind class merge)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/context/`    | `SessionContext.jsx` (auth state + `can()` helper)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/hooks/`      | `useActivityTracker.js`, `useIdleMonitor.js`, `useSpellCheck.js` (SpellCheckProvider)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/__tests__/`  | Vitest tests — mirrors source tree (80 files: projects/[id] 31, api 28, utils 8, reports 6, masters 3, components 3, admin/invoice 1)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `migrations/`     | Knex migrations — 18 files: `20260722080106_baseline_schema.js` (110 tables, 5,713 lines, raw-SQL dump of prod) + 17 incremental (sessions, attendance_logs, user_presence, deliverables, soft-delete hardening, quotation/invoice indexes, activity normalization). Baseline is marked already-applied on prod — runs only on fresh/staging DBs                                                                                                                                                                                                                             |
| `scripts/`        | Operational one-off scripts (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/`           | Internal documentation (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Operational scripts (`scripts/`)

Standalone `mysql2/promise` scripts — they do NOT import `@/utils/database`. Env split: seed scripts read repo `.env`; salary/setup scripts load `.env.local`.

- **Seeders**: `seed-description-master.js`, `seed-account-head-master.js`, `seed-category-master.js`, `insert-holidays-2026.js` (SQL variant `insert-holidays-2026.sql`)
- **Data migration**: `migrate-activity-assignments.js` (idempotent UPSERT of `project_activities_list` JSON into `user_activity_assignments`; env selected by `NODE_ENV`)
- **Salary import**: `import-salary-sheet.cjs` (parses `Updated salary Sheet.xlsx` via ExcelJS; `--replace-existing-month` flag), `delete-slips.cjs` (destructive `DELETE FROM payroll_slips`)
- **Diagnostics**: `check-salary.cjs`, `check-salary2.cjs`, `analyze_leaks.py` (connection-leak scan)
- **Setup**: `setup-super-admin.js` — **hardcoded password `admin123`; change before use**; `create_super_admin.sql`

### Docs (`docs/`)

- Root: `SECURITY_AUDIT.md` — 25 findings (2 Critical / 8 High / 11 Medium / 3 Low / 1 Info) from 2026-08-06; SEC-01/03/12/14 FIXED, SEC-05/11 partial, rest open. Per-finding `**Status:**` lines.
- `app/` — feature implementation notes (reports, projects tabs)
- `todo/` — completed-change docs: `LIVE_MONITORING_PRESENCE.md`, `RESOURCE_PAGE_DECOUPLING.md` (defines the soft-delete convention + migration recipe), `POOR_PRACTICES_AUDIT.md` (sections 1.1–1.3 verified FIXED)
- `explanations/` — architecture/audits: `RBAC_PERMISSIONS_SYSTEM.md`, `DDL_AND_SOFT_DELETE_AUDIT.md` (0 inline DDL remains), `ACTIVITY_NORMALIZATION.md`, `RESPONSIVE_AUDIT.md` (open mobile issues), `SUPER_ADMIN_SETUP.md`, `TICKET_SYSTEM.md`, `activity-daily-entries.md`
- `extras/` — binary reference files (xlsx templates, screenshots)

## Development Commands

| Command                          | Purpose                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                    | Dev server (Next.js)                                                                                                   |
| `npm run dev:turbo`              | Dev server with Turbopack                                                                                              |
| `npm run build`                  | Production build                                                                                                       |
| `npm run start`                  | Start production server                                                                                                |
| `npm run lint`                   | ESLint on `src` and `scripts` (`eslint src scripts`)                                                                   |
| `npm run format`                 | Prettier all files (`prettier --write .`)                                                                              |
| `npm test`                       | Vitest (watch mode)                                                                                                    |
| `npm run test:run`               | Vitest (single run)                                                                                                    |
| `npm run test:ui`                | Vitest with UI                                                                                                         |
| `npm run test:coverage`          | Vitest + coverage — **broken**: `@vitest/coverage-v8` provider not installed; run `npm i -D @vitest/coverage-v8` first |
| `npm run migrate`                | Run pending Knex migrations                                                                                            |
| `npm run migrate:status`         | Show migration status                                                                                                  |
| `npm run migrate:make -- <name>` | Create a new migration                                                                                                 |
| `npm run migrate:rollback`       | Roll back last batch                                                                                                   |

**Single test run:** `npx vitest run src/__tests__/path/to/test.test.ts`

**TypeScript check** (not in build pipeline): `npx tsc --noEmit`

### Stale scripts (do not run)

These package.json scripts reference files that no longer exist: `migrate:add-enquiry-no`, `migrate:add-project-lists`, `clear-leads`, `update-dates`, `db:check`, `db:kill`, and `setup`. The lint-staged/pre-commit hook is Prettier-only (no eslint step).

## Code Conventions & Common Patterns

### Formatting

- **Prettier** (`.prettierrc`): tabs (`useTabs: true`, `tabWidth: 2`), single quotes, semicolons, trailing commas (es5), 80 char print width
- **ESLint**: Flat config v9 (`eslint.config.mjs`) extending `next/core-web-vitals` + `next/typescript` via `FlatCompat`; lints `src` and `scripts`
- **Pre-commit**: Husky v9 → `lint-staged` → `prettier --write` on staged `*.{js,jsx,ts,tsx,json,css,md}`

### Database Access (3 patterns, in preference order)

```js
// 1. query() — simplest, auto-managed pool access
import { query } from '@/utils/database';
const [rows] = await query('SELECT * FROM users WHERE id = ?', [userId]);

// 2. withDb() — multiple queries on same connection, guaranteed release
import { withDb } from '@/utils/database';
const rows = await withDb(async (db) => {
	const [r] = await db.execute('SELECT ...');
	return r;
});

// 3. dbConnect() — raw connection, MUST release in finally
import { dbConnect } from '@/utils/database';
const db = await dbConnect();
try {
	/* ... */
} finally {
	db.release();
}
```

- **Pool** persists on `globalThis.__dbPool` (HMR-safe). `connectionLimit: 5` (keep LOW — 5–8 — to stay under MySQL's `max_user_connections`), `queueLimit: 200`, `dateStrings: true`, `maxIdle: 2`. Creds switch by `NODE_ENV` (`DEV_DB_*`/`STAGING_DB_*`/`PROD_DB_*`). Retries transient + too-many-connections errors and auto-creates the database on `ER_BAD_DB_ERROR`.
- `db.end()` is aliased to `db.release()` — it does NOT close the connection, just returns it to the pool.
- Schema info is cached via `schema-cache.js` (10-min TTL) — use `hasColumn(db, table, col)` instead of per-request DDL.
- Always call `logActivity()` for mutations (from `@/utils/activity-logger`); it swallows errors so tracking never breaks the main flow.

### API Route Pattern

Newer canonical form (`src/app/api/masters/deliverable-categories/route.ts`):

```ts
import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'deliverable_categories';

export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.DELIVERABLES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult; // 401/403 NextResponse
	if (!authResult.authorized) return authResult.response;
	let db;
	try {
		db = await dbConnect();
		const [rows] = await db.execute(
			`SELECT id, category_name, created_at FROM ${TABLE} WHERE isDelete = 0 ORDER BY category_name ASC`
		);
		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
```

Legacy JS routes use `getCurrentUser(request)` + inline 401/403 + ownership checks (`wl.user_id = ?` vs `user.id`). `ensurePermission` returns a `Response` instance on deny — callers must handle `instanceof Response` (or the older `if (!auth.authorized) return auth;` shape). API responses are wrapped `{ success, data }` with `error` strings on failure.

### Money Arithmetic (`src/lib/money.ts`)

All financial calculations MUST use the centralized `decimal.js` module (`Decimal.set({ precision: 20, rounding: ROUND_HALF_UP })`). Raw `parseFloat` + JS operators on money values are banned.

```ts
import {
	R,
	add,
	sub,
	mul,
	div,
	pctOf,
	roundR,
	gte,
	gt,
	isZero,
	toNumber,
} from '@/lib/money';

// R() parses DB values (mysql2 returns DECIMAL columns as strings)
const gross = R(grossAmount);
const gst = pctOf(gross, parseFloat(rate) || 0); // percentage
const net = add(gross, cgstAmount, sgstAmount, igstAmount); // exact sum
if (gte(totalPaid, netAmount)) status = 'paid'; // safe comparison

// toNumber() is the ONLY escape hatch — use at DB-write and JSON-response boundaries
await db.execute('INSERT INTO invoices (amount) VALUES (?)', [toNumber(net)]);
```

Legacy violations of this rule still exist (cash-voucher, da-schedule, salary-sheet use `parseFloat` on money) — do NOT copy them; fix them when touching the file.

### Formatting (`src/lib/format.js`)

NEVER define local `formatCurrency`/`formatNumber`/`formatDate` helpers (≈27 legacy files do — don't follow that precedent). Import the shared ones:

```ts
import {
	formatCurrency,
	formatNumber,
	formatDate,
	formatDateTime,
	formatDateInput,
} from '@/lib/format';
```

`formatCurrency` handles `null`/`undefined`/`NaN`/`''` gracefully (returns `'—'`). Uses `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.

### Tailwind CSS

- **v4** via `@import 'tailwindcss'` in `globals.css` — no `tailwind.config.js`; PostCSS plugin `@tailwindcss/postcss` (`postcss.config.mjs`)
- Class merging: `import { cn } from '@/lib/cn'` (wraps `clsx` + `tailwind-merge`)

### Color Scheme

Accent uses a **purple** brand with conventional semantic colors. New code MUST follow these mappings — do not invent a second accent color, do not substitute Tailwind hues for established ones, and do not reach for `purple-25` (non-standard; use `purple-50` or `bg-purple-50/50`).

#### Brand purple (primary action + brand identity)

| Token              | Hex       | Tailwind class       | Used for                                                                                                                               |
| ------------------ | --------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar background | `#4d025b` | `bg-[#4d025b]`       | Fixed sidebar (`var(--sidebar-bg)` in `globals.css`)                                                                                   |
| Brand deep         | `#64126D` | `bg-[#64126D]`       | Active nav item, sidebar accents, sign-in gradient anchor; new `ui/Button` default (`hover:bg-[#52105a]`)                              |
| Brand primary      | `#7F2487` | `bg-[#7F2487]`       | Active row borders, icon accents, CTA when Tailwind tokens aren't enough                                                               |
| Brand mid          | `#86288F` | `bg-[#86288F]`       | Gradient stop paired with `#64126D`                                                                                                    |
| Hover on `#7F2487` | `#6a1f72` | `hover:bg-[#6a1f72]` | Primary button hover (with `disabled:opacity-50 disabled:cursor-not-allowed`)                                                          |
| Brand via Tailwind | —         | `purple-50`/`100`    | **Backgrounds**: chip tints, hover states, soft containers                                                                             |
|                    | —         | `purple-200`         | **Borders** on purple-tinted cards; default sidebar border                                                                             |
|                    | —         | `purple-500`         | **Focus ring** (dominant in legacy — 34+ files)                                                                                        |
|                    | —         | `purple-600`         | **Primary buttons** in legacy JSX: `bg-purple-600 text-white hover:bg-purple-700`; **icons** (`text-purple-600` on neutral icon tiles) |
|                    | —         | `purple-700`         | **Text** on purple-50/100 backgrounds; **borders** for active tabs; **dark hover** on primary icons                                    |
|                    | —         | `purple-800`         | High-contrast text on `purple-100` chips (e.g. `view_page` action badge)                                                               |

Use the **hex form** (`bg-[#7F2487]`) only when the exact brand swatch is required — for everything else use the Tailwind token so utilities like `hover:bg-purple-700` work. New `ui/` primitives use `focus:ring-purple-300` (Button) and `focus:ring-[#64126D]` (form fields).

#### Semantic palette

Map meaning to a single color. Never reuse one semantic color for a different meaning.

| Meaning                                  | Light chip / bg                   | Text / fg                             | Solid button                      | Example usages                                                                     |
| ---------------------------------------- | --------------------------------- | ------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| **Success / approved / paid / done**     | `bg-green-50` / `100`             | `text-green-600` / `700`              | `bg-green-600 hover:bg-green-700` | Approved, paid, completed, "Actual" manhours, positive deltas                      |
| **Danger / delete / rejected / overdue** | `bg-red-50` / `100`               | `text-red-500` / `600` / `700`        | `bg-red-600 hover:bg-red-700`     | Delete, reject, overdue, errors, previous-value diff, "Previous" cell in audit log |
| **Info / in-progress / "actual"**        | `bg-blue-50` / `100`              | `text-blue-500` / `600` / `700`       | `bg-blue-600 hover:bg-blue-700`   | In-progress status, "Sent" stat, focus rings on form inputs, loading spinners      |
| **Warning / pending / submitted**        | `bg-amber-100` or `bg-yellow-100` | `text-amber-700` or `text-yellow-700` | —                                 | Draft → submitted, pending approval, hold states                                   |
| **Hold / paused**                        | `bg-orange-100`                   | `text-orange-600` / `700`             | —                                 | On hold, paused, over-budget manhours (when actual > estimated)                    |
| **Neutral / muted**                      | `bg-gray-50` / `100`              | `text-gray-500` / `600` / `700`       | —                                 | Default badges, "logout" action, draft status, secondary text                      |

> **Why gray, not slate**: `text-gray-*`/`bg-gray-*` is the dominant neutral (legacy); `slate` is reserved for specific status cases (e.g. `draft` in newer expenses pages). New code should default to `gray`. Note: some newer TSX pages (`payment-issue/page.tsx`, expenses family) use `STATUS_BADGE` maps with `slate`/`sky`/`rose` hues — when editing those files, follow the page's existing map.

#### Standard status-to-color mapping (use verbatim)

When you need to colorize a status string, reuse this table — don't invent a new pairing.

| Status                                        | Classes                           |
| --------------------------------------------- | --------------------------------- |
| `draft`                                       | `bg-slate-100 text-slate-700`     |
| `submitted`                                   | `bg-amber-100 text-amber-700`     |
| `pending`                                     | `bg-yellow-100 text-yellow-700`   |
| `approved`                                    | `bg-green-100 text-green-700`     |
| `rejected`                                    | `bg-red-100 text-red-700`         |
| `completed` / `paid`                          | `bg-green-100 text-green-700`     |
| `in progress` / `sent` / `ongoing` / `active` | `bg-blue-100 text-blue-700`       |
| `on hold` / `paused`                          | `bg-orange-100 text-orange-700`   |
| `overdue` / `cancelled`                       | `bg-red-100 text-red-700`         |
| `fulfilled`                                   | `bg-blue-100 text-blue-700`       |
| `reimbursed`                                  | `bg-emerald-100 text-emerald-700` |
| `view_page` (audit)                           | `bg-purple-100 text-purple-800`   |
| `export` (audit)                              | `bg-yellow-100 text-yellow-800`   |
| `login` (audit)                               | `bg-cyan-100 text-cyan-800`       |
| `logout` (audit)                              | `bg-gray-100 text-gray-800`       |

#### Component patterns

**Status badge** (table rows, filter chips):

```jsx
<span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-{semantic}-100 text-{semantic}-700">
	{/* optional icon */}
	{label}
</span>
```

**Stat card** (dashboard tiles, page summaries — extremely common):

```jsx
<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
	<div className="text-lg font-bold text-{semantic}-600">{value}</div>
	<div className="text-xs text-gray-600">{label}</div>
</div>
```

**Alert / error banner**:

```jsx
<div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
	<ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
	<span className="text-red-700">{message}</span>
</div>
```

**Info / "how it works" panel**:

```jsx
<div className="bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm">
	<h3 className="text-sm font-semibold text-blue-900 mb-2">…</h3>
	<p className="text-sm text-blue-800">…</p>
</div>
```

**Row action icon button** (view / edit / delete):

```jsx
<button
	className="p-2 text-gray-500 hover:text-{semantic}-600 hover:bg-{semantic}-50 rounded-lg transition-colors"
	title="…"
>
	<Icon className="h-5 w-5" />
</button>
```

(`text-gray-500` resting state; semantic color only on hover. Blue=view, green=download, red=delete.)

#### Focus rings

`focus:ring-purple-500` is the legacy standard (34+ files). New `ui/` primitives: `focus:ring-purple-300` (Button) / `focus:ring-[#64126D]` (form fields). Always pair with `focus:ring-2` and `focus:border-transparent` for inputs.

#### Form text (global)

`globals.css` forces all form field text to **black** (`input, textarea, select { color: #000 !important; caret-color: #000; }`) to keep data legible on a busy background. Don't override this; gray form text is a known readability problem and is explicitly overridden back to black on the Employees screen. If a screen needs higher contrast on neutral labels, prefer `text-gray-900` over `text-gray-500`/`600`.

#### Dark mode

`globals.css` declares dark-mode CSS variables (`@media (prefers-color-scheme: dark)`), but `color-scheme: light` is forced and **no Tailwind `dark:` variants are used anywhere in the codebase** — every screen is light-only in practice. Don't introduce `dark:` classes; dark mode needs a separate design pass.

#### Don'ts

- **`bg-purple-25` / `text-purple-25`** — not in the default Tailwind scale (12+ pre-existing uses, mostly project tabs). Use `bg-purple-50` or `bg-purple-50/50`.
- **Two accent colors in one view** — the sidebar/header is purple, body CTAs are purple, but a single component should fill only its **own** primary action; secondaries stay neutral.
- **Color for non-semantic emphasis** — reach for `text-gray-900` (bolder weight via color) before `text-purple-700` on body copy.
- **`slate-*` outside the `draft`/specific-status exceptions** — gray is the neutral.
- **Hardcoded hex where a Tailwind token exists** — `bg-purple-600` over `bg-[#7F2487]` unless the exact brand swatch is required.

### New Code Standards

For all **new files**, follow these rules:

- **TypeScript only**: `.ts` for utilities, `.tsx` for components/pages, `route.ts` for API routes
- **Data fetching → TanStack Query**: `useQuery`/`useMutation` via existing `QueryProvider` (used in all new admin/report pages)
- **Forms → TanStack Form**: `useForm` from `@tanstack/react-form` (currently used in `ResourceFormModal.tsx`)
- **Tables → TanStack Table**: `@tanstack/react-table` is installed but unused — new data tables SHOULD adopt it
- **Components**: Radix UI primitives + `lucide-react` icons + `class-variance-authority`. Reuse `src/components/ui/` components.

## Important Files

| File                                         | Role                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `middleware.ts`                              | Edge routing guard — public path allowlist, `session`-cookie presence check, rate limiting (5 categories). NOT the auth boundary: real validation happens in Node (`getCurrentUser`) |
| `src/utils/database.js`                      | MySQL pool manager — `dbConnect()`, `withDb()`, `query()`, `closePool()`, `getPoolStats()`                                                                                           |
| `src/utils/api-permissions.js`               | Server-side auth — `ensurePermission()`, `getCurrentUser()` (5-min cache), `invalidateUserCache()`, re-exports `RESOURCES`/`PERMISSIONS`                                             |
| `src/utils/permissions.js`                   | Central RBAC — `checkPermission()` (flat + nested paths), `hasAnyAccess()`, field-permission helpers                                                                                 |
| `src/utils/rbac.js`                          | RBAC constants — `RESOURCES`, `PERMISSIONS`, `PERMISSION_TEMPLATES`, `mergePermissions`                                                                                              |
| `src/utils/session.ts`                       | Session tokens — `createSession()`, `revokeSession()`, `revokeAllUserSessions()`, `SESSION_TTL_SECONDS`                                                                              |
| `src/utils/activity-logger.ts`               | Audit trail — `logActivity()` for all mutations; `updateScreenTime`, `updateUserPresence`, `endUserSession`                                                                          |
| `src/utils/server-auth.js`                   | Server-component auth — `getServerAuth()`, `requireServerAuth()`                                                                                                                     |
| `src/utils/password.ts`                      | bcrypt hash/verify with legacy-plaintext fallback + auto-upgrade                                                                                                                     |
| `src/utils/schema-cache.js`                  | `INFORMATION_SCHEMA` column cache — `hasColumn()`, 10-min TTL                                                                                                                        |
| `src/context/SessionContext.jsx`             | Client auth — `useSession()`, `can(resource, action)`                                                                                                                                |
| `src/components/providers/QueryProvider.tsx` | TanStack Query client — `staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: false`                                                                                               |
| `src/lib/money.ts`                           | Decimal.js money arithmetic — `R()`, `add`, `sub`, `pctOf`, `gte`, `toNumber`                                                                                                        |
| `src/lib/format.js`                          | Shared formatting — `formatCurrency`, `formatDate`, `formatNumber`                                                                                                                   |
| `src/lib/api-client.js`                      | Fetch wrapper — `apiGet`/`apiPost`/`apiPut`/`apiDelete` with `credentials: 'include'`                                                                                                |
| `src/components/admin/ResourceFormModal.tsx` | Shared TanStack Form + zod CRUD modal renderer                                                                                                                                       |
| `knexfile.js`                                | Knex config — dev/staging/prod environments, `./migrations/` directory (prod uses `.mjs` stub)                                                                                       |
| `next.config.ts`                             | Next.js config — `serverExternalPackages`, image optimization, compression                                                                                                           |
| `tsconfig.json`                              | TypeScript config — strict + `noImplicitAny: false`, `allowJs: true`, `@/*` → `./src/*`                                                                                              |
| `vitest.config.ts`                           | Test config — jsdom, globals, `@/` alias, `src/__tests__/**/*.test.{js,jsx,ts,tsx}`                                                                                                  |

## Runtime & Tooling Preferences

- **Runtime**: Node 24.x (specified in `package.json` `engines`; no `.nvmrc`)
- **Package manager**: npm (`package-lock.json`, lockfileVersion 3)
- **Module system**: ESM (`"type": "module"`; knexfile/postcss/eslint/vitest configs are ESM; legacy `.cjs` salary scripts are the exception)
- **Framework**: Next.js 15.5 (App Router), React 19.2
- **Styling**: Tailwind CSS v4 (PostCSS plugin), no config file
- **DB migrations**: Knex 3 — `npm run migrate:make -- name` creates `migrations/<timestamp>_name.js` (dev/staging); production env uses `stub: './src/lib/migration.stub.mjs'`, `extension: 'mjs'`
- **Server-only packages** (in `next.config.ts` `serverExternalPackages`): mysql2, sharp, exceljs, jspdf, @react-pdf/renderer, html2canvas, docxtemplater, pizzip — do not remove without checking bundle size
- **Migrations baseline**: `20260722080106_baseline_schema.js` (110 tables, 5,713 lines, 443 KB — includes ~2,000 duplicated FK constraints in the `projects` DDL). Marked already-applied on prod — runs only on fresh/staging DBs
- **Env files**: `.env` (gitignored, dev creds), `.env.copy` is the working-tree template (gitignored; `.env.example` absent but allowed by gitignore), `.env.local` loaded by salary/setup scripts
- **No CI/CD**: no Dockerfile, no GitHub workflows, no `.editorconfig`. Deploy via Vercel (`.vercelignore` excludes `scripts/`, `*.md`, `*.csv`)
- **Version drift**: `puppeteer ^25.1.0` vs `puppeteer-core ^24.43.0`; `eslint-config-next` pinned 15.5.3 vs `next ^15.5.18`

## Testing & QA

### Framework

- **Vitest 4.1.7** with **jsdom 29** environment, globals enabled (though tests import `describe/it/expect/vi` explicitly — that's the convention)
- **@testing-library/react** 16 + **@testing-library/user-event** 14
- Setup: `vitest.setup.ts` imports `@testing-library/jest-dom` for DOM matchers

### Test Structure

Tests live in `src/__tests__/` and mirror the source tree 1:1 (80 files: `projects/[id]` 31 — 30 tab tests, `api/` 28, `utils/` 8, `reports/` 6, `masters/` 3, `components/` 3, `admin/invoice/` 1). No tests exist outside `src/__tests__`; no e2e framework (no Playwright/Cypress).

### API Route Tests

Mock DB + auth BEFORE the dynamic import (Vitest hoists `vi.mock`):

```ts
const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	release: vi.fn(),
	end: vi.fn(),
});
vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi
		.fn()
		.mockResolvedValue({ authorized: true, user: { id: 1 } }),
	RESOURCES: { SETTINGS: 'settings' },
	PERMISSIONS: { READ: 'read', UPDATE: 'update', DELETE: 'delete' },
	invalidateUserCache: vi.fn(),
}));

// Dynamic import loads route handlers after mocks
const { PUT, DELETE } = await import('@/app/api/roles/route');

// params is a Promise in Next 15
const res = await GET(req, { params: Promise.resolve({ id: '1' }) });
expect(res.status).toBe(200);
```

Conventions: real `Request` objects; `[rows, fields]` mysql2 tuples via ordered `mockResolvedValueOnce` chains; SQL asserted by **substring** (`sql.includes('INSERT INTO sessions')`), never exact text; 401/403/404/500 branches re-mocked per test.

### Component Tests

```tsx
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({ user: { id: 1 }, loading: false }),
}));
vi.mock('@/components/Navbar', () => ({ default: () => null }));

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockImplementation(/* returns { json: ... } */)
	);
});
afterEach(() => {
	vi.restoreAllMocks();
});

const user = userEvent.setup();
render(<InvoicePage />);
await screen.findByText('Sale Invoices');
await user.click(screen.getByText('Create Invoice'));
expect(mockPush).toHaveBeenCalledWith('/admin/invoice/create');
```

Async UI assertions always via `waitFor`/`findBy*` (debounced search is flake-prone if asserted synchronously). Assertions include accessibility state (`aria-invalid`, focus, live regions) and exact outgoing request bodies (`JSON.parse(options.body)`).

### Utility Tests

Pure functions, no mocking. `money.test.ts` covers precision (IEEE-754 traps: `add(0.1, 0.2) → 0.3`, large values, repeating decimals) and null-safety (`R(null)` → 0, falsy-as-0, `formatCurrency` em-dash fallbacks).

### Coverage

No thresholds configured in `vitest.config.ts`. `npm run test:coverage` currently **fails** — `@vitest/coverage-v8` is not installed (it's only an optional peer of vitest). Install `npm i -D @vitest/coverage-v8` before using.

## Agent Harness: omp Commands & Skills

This repo is developed inside the **omp** harness. All tools below are enabled at harness defaults — there is no `omp.json`, `.omp/settings.json`, or `.omp/agents.json`; behavior is driven by this file + skill frontmatter.

### omp agent commands

| Command                                     | Use for                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read` / `write` / `edit` / `glob` / `grep` | File operations; `read` on directories gives listings; `edit` with minimal unique strings                                                                                                  |
| `bash`                                      | One binary or short pipeline computing a fact — never for things a specialized tool does                                                                                                   |
| `eval`                                      | Persistent Python/JS kernel for computation/analysis across steps                                                                                                                          |
| `task` / `hub`                              | Parallel subagents (`scout` = read-only research; `task` = full work); IRC coordination, background jobs                                                                                   |
| `browser`                                   | Drive a real Chromium tab: `open` → `run`; `tab.observe()`/`ariaSnapshot()` for state; screenshots; use for JS execution, auth flows, interactive verification — `read` for static content |
| `debug`                                     | DAP debuggers: launch/attach, breakpoints, evaluate, stack traces                                                                                                                          |
| `lsp`                                       | Language-server ops — `diagnostics`, `references`, `rename` (applies by default), `rename_file`, `code_actions`. MUST use for cross-file renames instead of text edits                     |
| `ast_edit`                                  | AST-grep structural rewrites; matches are staged → finalize via `xd://resolve`/`xd://reject`                                                                                               |
| `inspect_image`                             | Vision-model analysis of screenshots/images (prefer over `read` for images)                                                                                                                |
| `web_search`                                | Current information beyond knowledge cutoff                                                                                                                                                |
| `ask` / `todo` / `goal`                     | Clarification, task tracking, goal mode                                                                                                                                                    |

Internal URLs: `skill://<name>` (skill instructions), `agent://<id>` (subagent output), `history://<id>` (transcripts), `artifact://<id>`, `local://<name>.md` (shared plan artifacts), `issue://<N>` / `pr://<N>` (GitHub).

Rules of thumb: matching skill → MUST read `skill://<name>` first; parallel research → fan out `task` scouts; never text-rename across files when `lsp rename` exists; UI verification → `browser`, not guessing.

### Skills (`.omp/skills/` and `.agents/skills/`)

Both directories hold **byte-identical copies** of 8 skills (from `jakubkrehel/skills`, tracked by `skills-lock.json` — 12 locked, 8 installed; the 4 locked-but-not-installed are `frontend-design`, `shadcn`, `vercel-react-best-practices`, `web-design-guidelines`). `.omp/skills/` serves the omp harness; `.agents/skills/` serves other agents (e.g. Claude via `.claude/`).

Auto-triggered by keywords (read the skill before acting):

- **better-accessibility** — a11y, WCAG, aria, focus-visible, keyboard nav, screen reader, hit areas, `prefers-reduced-motion`. Native elements first, `:focus-visible` rings, real `<label>`s, `aria-invalid` + `aria-describedby` on form errors.
- **better-colors** — oklch, palettes, contrast (APCA |Lc| ≥75 / WCAG 4.5:1), gamut, Tailwind v4 theming. Respect the repo's existing token system; don't re-notation just because the skill loaded.
- **better-layout** — layout, spacing, grouping, breakpoints, RTL/logical properties. Group with space not lines; 12px between bordered controls, 24px clearance; content-driven breakpoints.
- **better-typography** — fonts, type scale, line-height by role, truncation, measure. `.woff2` on the web; properties over raw tags; write fixes in the repo's idiom.
- **better-ui** — polish, hover states, shadows, borders, icons, motion restraint. Interruptible transitions; concentric radii; 10%-speed motion replay in the browser during reviews.
- **better-writing** — UX copy, button labels, error messages, empty states. One voice; verb-first buttons; sentence case default; link text describes destination.
- **better-interface** — cross-discipline review orchestrator. Routes a screen/flow to all six `better-*` domains, review order: accessibility → layout → writing → typography → colors → ui; consolidated ranked verdict, findings cite `file:line`; modes `quick` (cap 5) / `full` (cap 15).

User-invoked only (`disable-model-invocation: true`):

- **interface-review** — change-scoped review (uncommitted work, current branch, PR) via `/interface-review [quick] <target>`. Owns scope resolution + blast-radius expansion; hands findings to `better-interface`. With no target: ask, never invent scope. Read the `-` side of every hunk; exclude lockfiles/generated files; list every write to `.git` for auditability.
