# AGENTS.md — Accent CRM

## Project overview

Internal ERP/CRM (Next.js 15 App Router + MySQL) managing leads → proposals → projects, employees/payroll, financial documents, support tickets, and activity tracking.

## Commands

| Command                 | Purpose                       |
| ----------------------- | ----------------------------- |
| `npm run dev`           | Dev server                    |
| `npm run dev:turbo`     | Dev server with Turbopack     |
| `npm run build`         | Production build              |
| `npm run lint`          | ESLint on `src` and `scripts` |
| `npm run format`        | Prettier all files            |
| `npm test`              | Vitest (watch)                |
| `npm run test:run`      | Vitest (run once)             |
| `npm run test:ui`       | Vitest with UI                |
| `npm run test:coverage` | Vitest + coverage             |

**Single test / focused run:** `npx vitest run <path>` — paths use the `src/__tests__/**` pattern (see below). Example: `npx vitest run src/__tests__/projects/[id]/edit/tabs/ScopeTab.test.tsx`.

Pre-commit runs prettier via lint-staged (`.husky/pre-commit` → `npx lint-staged`). There is **no `typecheck` script** — TypeScript is used but not checked at build time. Run `npx tsc --noEmit` manually if you need type checking.

### Stale `package.json` scripts (do not run)

`migrate:add-enquiry-no`, `migrate:add-project-lists`, `clear-leads`, `update-dates`, `db:check`, `db:kill`, and `setup` reference files that no longer exist on disk. Running them fails with `Cannot find module`.

## Knex migrations (primary schema management)

**Knex is now the single source of truth for schema.** The old `schema-init.js` and inline `CREATE TABLE IF NOT EXISTS` in API routes are legacy — do NOT add new inline DDL.

| Command                    | Purpose                                           |
| -------------------------- | ------------------------------------------------- |
| `npm run migrate`          | Run pending migrations (`knex migrate:latest`)    |
| `npm run migrate:status`   | Show migration status                             |
| `npm run migrate:make`     | Create a new migration file (provide `-- <name>`) |
| `npm run migrate:rollback` | Roll back the last batch                          |

- **Knex envs**: `development`, `staging`, `production` (configured in `knexfile.js`). Set `NODE_ENV` to match (defaults to `development`).
- **Migrations directory**: `./migrations/`
- **Baseline migration**: `20260722080106_baseline_schema.js` covers all 110 tables from an actual prod dump. Marked as already-applied on prod — never executes there. It only runs on fresh/staging DBs.
- **Environment variable mapping**: Both `knexfile.js` and `src/utils/database.js` use `NODE_ENV` to switch between `DEV_DB_*`, `STAGING_DB_*`, and `PROD_DB_*` credentials. See `.env` for values.

**To create a new migration:**

```bash
npm run migrate:make -- descriptive_name
```

This generates `migrations/<timestamp>_descriptive_name.js` with `up(knex)` and `down(knex)` exports. Use `knex.schema` builder methods or `knex.raw()` for DDL.

**`src/instrumentation.js` is now a no-op** — schema init via startup hook has been removed. Do not re-add schema init there.

## Tech stack notes

- **Tailwind v4** via `@tailwindcss/postcss` (postcss.config.mjs). No `tailwind.config.js`.
- **ESM project** (`"type": "module"`) but most files are plain `.js` / `.jsx` — TypeScript files coexist.
- **`serverExternalPackages`** in next.config.ts lists large server-only deps (mysql2, sharp, exceljs, jspdf, etc.). Do not remove entries without checking server bundle size.
- `@/` → `./src/*` (tsconfig.json + vitest.config.ts).
- **`.env` is committed** despite `.gitignore` excluding it, and contains real DB credentials. For local secrets create `.env.local`; `scripts/setup-super-admin.js` and similar load it first.

## Auth, rate limiting & middleware

**`middleware.ts` is the single source of truth for auth AND API rate limiting.** Do not duplicate this logic in routes.

- Public paths: `/signin`, `/api/login`, `/api/logout`, `/api/auth`, `/api/session`, `/_next`, `/uploads`, static assets.
- Auth cookies: `auth` (JWT), `user_id`, `is_super_admin` (`'1'` = admin).
- `/admin/*` is blocked for non-admins (redirects to `/user/dashboard`).
- Unauthenticated API requests get `401` JSON; page requests redirect to `/signin?from=...`.
- Authenticated users hitting `/signin` are redirected to their dashboard.
- Per-IP+user rate limits on `/api/*` with categories: `auth` (10/15min, 30min block), `session` (120/min), `dashboard`/`analytics` (60/min), `heavy` export/report/bulk (10/min, 2min block), default `api` (120/min). Returns `429` with `Retry-After` / `X-RateLimit-*` headers. In-memory store is Edge-runtime only.
- The `AuthGate` component in the layout is a **no-op** — auth is handled by middleware.

## Database patterns (MySQL via mysql2/promise)

Use one of three patterns, in order of preference:

1. **`query(sql, params)`** — safest for simple queries. Runs on pool directly, no release needed.

   ```js
   import { query } from '@/utils/database';
   const [rows] = await query('SELECT * FROM users WHERE id = ?', [userId]);
   ```

2. **`withDb(async (db) => { ... })`** — guaranteed release. Use when you need multiple queries on the same connection.

   ```js
   import { withDb } from '@/utils/database';
   const rows = await withDb(async (db) => {
   	const [r] = await db.execute('SELECT ...');
   	return r;
   });
   ```

3. **`const db = await dbConnect()` + `db.release()`** — only when you need the raw connection object. Always release in a `finally` block.

**Critical**: The pool is persisted on `globalThis` to survive HMR reloads during dev. Connection limit is 5, queue limit 200. Schema info is cached via `schema-cache.js` (10-min TTL) — API routes use `hasColumn(db, table, column)` to check for columns instead of running DDL on every request.

The **`db.end()` function has been aliased to `db.release()`** in the connection wrapper — calling `db.end()` in API routes does NOT close the connection, it releases it back to the pool.

## RBAC & permissions

Two permission systems coexist:

### Flat permissions (legacy)

- Format: `"resource:permission"` (e.g., `"leads:read"`)
- Defined in `src/utils/rbac.js` (RESOURCES, PERMISSIONS, templates)
- Users have: `permissions` (direct), `role_permissions` (from role), `merged_permissions` (union)
- Super admin (`is_super_admin: true`) bypasses all checks

### Nested field_permissions (newer)

- JSON structure: `{ modules: { leads: { enabled: true, crud: { read: true }, sections: { ... } } } }`
- Stored in `field_permissions` column on users table
- Can be a JSON string — `checkPermission()` handles both string and object

### Where to use

- **Primary checker**: `src/utils/permissions.js` — `checkPermission(user, resource, permission)`, `hasAnyAccess()`, `createPermissionChecker()`
- **Server API routes**: `src/utils/api-permissions.js` — `getCurrentUser(request)`, `ensurePermission(request, resource, permission)`, `checkPermissionFast(request, resource, permission)`
- **Client components**: `useSession()` from `@/context/SessionContext` → `session.can('leads', 'read')`
- **Legacy**: `src/utils/client-rbac.js` — thin wrapper over `useSession()`, use the new API instead

### Session permissions cache

A `session_permissions` cookie (base64-encoded JSON) caches permissions for 24h to avoid DB lookups. `ensurePermission()` checks this first, falls back to DB. After updating user permissions, call `setPermissionsCookieOnResponse()`.

## Adding new API routes

Follow the existing pattern:

```js
import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

export async function GET(request) {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.READ
	);
	if (!auth.authorized) return auth; // returns NextResponse(403/401)

	const db = await dbConnect();
	try {
		const [rows] = await db.execute('SELECT ...');
		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		db.release();
	}
}
```

Always call `logActivity()` for mutations (create/update/delete). Always release connections.

## File conventions

- API routes: `src/app/api/**/route.ts`
- Pages: `src/app/**/page.tsx`
- Shared components: `src/components/**/*.tsx`
- Utilities: `src/utils/**/*.ts` (use `.ts` for new utils, even alongside existing `.js`)
- Tests: `src/__tests__/**/*.test.{ts,tsx}`

Prettier config: tabs (width 2), single quotes, semicolons, es5 trailing commas, 80 char print width.

## New code conventions (effective now)

The legacy codebase is mostly `.js`/`.jsx` (do not rewrite it unless asked). For **all new files** agents create, follow these rules:

- **TypeScript only** — use `.ts` for utilities, `.tsx` for components/pages, `route.ts` for API routes, `.test.ts`/`.test.tsx` for tests. `allowJs: true` is on so old `.js` keeps type-checking, but new code must be TS.
- **Data fetching → TanStack Query** (`@tanstack/react-query`). Use `useQuery` / `useMutation` with the existing `QueryClient` in `src/components/providers/QueryProvider.jsx`. Avoid raw `fetch`/SWR in new code. See `src/components/admin/ResourcePage.jsx:66` for the pattern.
- **Forms → TanStack Form** (`@tanstack/react-form`). Use `useForm` from `@tanstack/react-form` (already used at `src/components/admin/ResourcePage.jsx:282`). Do not introduce new form libraries.
- **Tables → TanStack Table** (`@tanstack/react-table`) for any new data tables. The `Table` primitive from shadcn (when present) is built on it.
- **Components** — Radix UI primitives + `lucide-react` icons + `class-variance-authority` + `tailwind-merge` (cn helper). Reuse the shadcn-style components under `src/components/ui/` rather than building parallel ones. Use `clsx`/`tailwind-merge` (not string concatenation) for conditional classes.
- **API routes** — still follow the pattern in "Adding new API routes" below, but write them as `.ts` with typed request/response shapes (Zod schemas in `src/utils/` are encouraged for validation).

## Architecture notes

- `SessionContext` (client) hydrates from `sessionStorage` on mount and polls `/api/session`. It always starts with `loading: true` to avoid hydration mismatch.
- `Sidebar.jsx` is permission-aware — renders nav items based on user's `can()` check.
- User activity tracking is pervasive: `ActivityTracker` component sends heartbeat, `logActivity()` records DB mutations, `updateScreenTime()` handles screen-time data from client heartbeat.
- Live monitoring (`/admin/live-monitoring`) uses the `user_screen_time`, `user_work_sessions`, and `user_daily_summary` tables populated by the activity logger.
- `private/` at repo root is internal-only (e.g. message attachments) and excluded from Vercel deploys via `.vercelignore`. `.claude/settings.json` holds repo-local Claude config; `.agents/skills/` holds custom OpenCode skills.
