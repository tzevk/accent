# AGENTS.md — Accent CRM

## Project overview

Internal ERP/CRM (Next.js 15 App Router + MySQL) managing leads → proposals → projects, employees/payroll, financial documents, support tickets, and activity tracking.

## Commands

| Command                 | Purpose                       |
| ----------------------- | ----------------------------- |
| `npm run dev`           | Dev server                    |
| `npm run build`         | Production build              |
| `npm run lint`          | ESLint on `src` and `scripts` |
| `npm run format`        | Prettier all files            |
| `npm test`              | Vitest (watch)                |
| `npm run test:run`      | Vitest (run once)             |
| `npm run test:coverage` | Vitest + coverage             |

Pre-commit runs prettier via lint-staged. There is **no `typecheck` command** in the pipeline — TypeScript is used but not checked at build time.

## Tech stack notes

- **Tailwind v4** via `@tailwindcss/postcss` (postcss.config.mjs). Not v3 — no `tailwind.config.js`.
- **ESM project** (`"type": "module"` in package.json), but most files are plain `.js` / `.jsx` (not `.mjs`). TypeScript files (`.ts`/`.tsx`) exist alongside JS files.
- **`serverExternalPackages`** in next.config.ts lists large server-only deps (mysql2, sharp, exceljs, jspdf, etc.) — do not remove entries without testing server bundle size.
- `@/` path alias resolves to `./src/*` (tsconfig.json).
- The `.env` file is committed (despite `.gitignore` exclusion) and contains real DB credentials.

## Auth & middleware

**`middleware.ts` is the single source of truth for auth enforcement.** Do not duplicate auth logic elsewhere:

- Public paths: `/signin`, `/api/login`, `/api/logout`, `/api/auth`, `/api/session`, and static paths (`/_next`, `/uploads`, etc.).
- Three cookies control auth: `auth` (JWT), `user_id`, `is_super_admin`.
- `/admin/*` is blocked for non-admin users (middleware checks `is_super_admin` cookie).
- Authenticated users hitting `/signin` are redirected to their dashboard.
- API routes without auth cookies get 401 JSON, pages get redirected to `/signin`.
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

3. **`const db = await dbConnect()` + `db.release()`** — only when you need the raw connection object. Always release in a `finally` block. Connection auto-force-releases after 8s as a safety net.

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

- API routes: `src/app/api/**/route.js` (mostly `.js`, rarely `.ts`)
- Pages: `src/app/**/page.jsx`
- Shared components: `src/components/`
- Utilities: `src/utils/` (`.js` files)
- Tests: `src/__tests__/**/*.test.{js,jsx,ts,tsx}`

Prettier config: tabs (width 2), single quotes, semicolons, es5 trailing commas, 80 char print width.

## Architecture notes

- Schema init runs via `src/instrumentation.js` at server startup (Next.js instrumentation hook). If it fails, API routes have inline DDL as fallback (gated to first call).
- `SessionContext` (client) hydrates from `sessionStorage` on mount and polls `/api/session`. It always starts with `loading: true` to avoid hydration mismatch.
- `Sidebar.jsx` is permission-aware — renders nav items based on user's `can()` check.
- User activity tracking is pervasive: `ActivityTracker` component sends heartbeat, `logActivity()` records DB mutations, `updateScreenTime()` handles screen-time data from client heartbeat.
- Live monitoring (`/admin/live-monitoring`) uses the `user_screen_time`, `user_work_sessions`, and `user_daily_summary` tables populated by the activity logger.
