# Repository Guidelines

## Project Overview

Accent CRM is an internal ERP/CRM platform built with **Next.js 15 App Router** and **MySQL**. It manages the full business lifecycle: leads → proposals → projects, employees/payroll, invoicing, purchase orders, support tickets, activity tracking, and financial documents.

- **Runtime**: Node 24.x, ESM (`"type": "module"`)
- **DB**: MySQL via `mysql2/promise` connection pool + Knex migrations
- **Auth**: Cookie-based (`auth`, `user_id`, `is_super_admin`) enforced by Edge middleware
- **Styling**: Tailwind CSS v4 (CSS-first, no `tailwind.config.js`)
- **Language mix**: Legacy JS/JSX (dominant), newer code in TS/TSX. Migration is gradual — new files SHOULD be TypeScript.

## Architecture & Data Flow

```
Browser
  │
  ▼
middleware.ts (Edge)          ← auth check, rate limiting, public-path allowlist
  │
  ▼
Next.js App Router            ← pages (RSC + 'use client'), API routes
  │
  ├─ SessionContext           ← fetches /api/session, provides user + permissions to client
  ├─ QueryProvider            ← TanStack Query v5 (staleTime: 30s, retry: 1)
  └─ Sidebar / Navbar         ← permission-gated navigation
  │
  ▼
API Routes (route.js/route.ts)
  │
  ├─ ensurePermission()       ← server-side RBAC guard (cached via session_permissions cookie)
  ├─ dbConnect() / withDb()   ← MySQL connection pool (singleton, HMR-safe via globalThis)
  └─ logActivity()            ← audit trail for mutations
  │
  ▼
MySQL                         ← DECIMAL for money, soft-delete (isDelete), 110+ tables
```

### Auth Flow

1. `middleware.ts` checks `auth` + `user_id` cookies on every non-public request
2. `/api/login` verifies bcrypt hash → sets cookies → returns merged permissions
3. `SessionContext` hydrates from `sessionStorage` on mount, polls `/api/session` on route/visibility change
4. Client checks permissions via `useSession().can(resource, action)` or legacy `useSessionRBAC()`
5. Server API routes use `ensurePermission(request, RESOURCE, ACTION)` — returns 401/403 `NextResponse` if unauthorized

### Permissions (RBAC)

Two systems coexist:

- **Flat permissions** (legacy): `"resource:action"` arrays (e.g. `"leads:read"`), merged from role + user overrides
- **Field permissions** (newer): nested JSON `{ modules: { leads: { enabled: true, crud: { read: true } } } }`

Super admin (`is_super_admin: '1'`) bypasses all checks. ~30 resources × 10 actions with 4-tier templates (VIEWER/EDITOR/MANAGER/ADMIN).

## Key Directories

| Directory         | Purpose                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`        | Next.js App Router — pages (`page.jsx`/`page.tsx`), layouts, and API routes (`api/**/route.js`)                                                                                        |
| `src/components/` | Shared React components — `ui/` (primitives: Button, Table, Modal, FormFields), `admin/ResourcePage.tsx` (CRUD template), `Sidebar`, `Navbar`, `AuthGate` (no-op)                      |
| `src/utils/`      | Server utilities — `database.js` (pool), `permissions.js`/`rbac.js`/`api-permissions.js` (RBAC), `activity-logger.js`, `password.ts`, `invoice-validation.ts`, `payroll-calculator.js` |
| `src/lib/`        | Shared libraries — `money.ts` (decimal arithmetic), `format.js` (INR formatting), `api-client.js` (fetch wrapper), `cn.js` (Tailwind class merge)                                      |
| `src/context/`    | React contexts — `SessionContext.jsx` (auth state + `can()` helper)                                                                                                                    |
| `src/hooks/`      | Custom hooks — `useActivityTracker.js`, `useIdleMonitor.js`, `useSpellCheck.js`                                                                                                        |
| `src/__tests__/`  | Vitest tests — mirrors source tree structure                                                                                                                                           |
| `migrations/`     | Knex migrations (6 total: 1 baseline + 5 incremental)                                                                                                                                  |
| `scripts/`        | Operational scripts — seeding, data migration, salary import, diagnostics                                                                                                              |
| `docs/`           | Internal documentation — RBAC architecture, activity normalization, responsive audit, poor practices audit                                                                             |

## Development Commands

| Command                          | Purpose                                      |
| -------------------------------- | -------------------------------------------- |
| `npm run dev`                    | Dev server (Next.js)                         |
| `npm run dev:turbo`              | Dev server with Turbopack                    |
| `npm run build`                  | Production build                             |
| `npm run start`                  | Start production server                      |
| `npm run lint`                   | ESLint on `src` and `scripts`                |
| `npm run format`                 | Prettier all files                           |
| `npm test`                       | Vitest (watch mode)                          |
| `npm run test:run`               | Vitest (single run)                          |
| `npm run test:ui`                | Vitest with UI                               |
| `npm run test:coverage`          | Vitest + coverage (no thresholds configured) |
| `npm run migrate`                | Run pending Knex migrations                  |
| `npm run migrate:status`         | Show migration status                        |
| `npm run migrate:make -- <name>` | Create a new migration                       |
| `npm run migrate:rollback`       | Roll back last batch                         |

**Single test run:** `npx vitest run src/__tests__/path/to/test.test.ts`

**TypeScript check** (not in build pipeline): `npx tsc --noEmit`

### Stale scripts (do not run)

`migrate:add-enquiry-no`, `migrate:add-project-lists`, `clear-leads`, `update-dates`, `db:check`, `db:kill`, and `setup` reference files that no longer exist.

## Code Conventions & Common Patterns

### Formatting

- **Prettier**: tabs (width 2), single quotes, semicolons, trailing commas (es5), 80 char print width
- **ESLint**: Flat config v9 extending `next/core-web-vitals` + `next/typescript`
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

- **Connection pool** is persisted on `globalThis` for HMR safety. Connection limit: 5, queue limit: 200.
- `db.end()` is aliased to `db.release()` — it does NOT close the connection, just returns it to the pool.
- Schema info is cached via `schema-cache.js` (10-min TTL) — use `hasColumn(db, table, col)` instead of per-request DDL.

### API Route Pattern

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
	if (!auth.authorized) return auth; // returns 401/403 NextResponse

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

Always call `logActivity()` for mutations. Always release connections.

### Money Arithmetic (`src/lib/money.ts`)

All financial calculations MUST use the centralized `decimal.js` module. Raw `parseFloat` + JS operators on money values are banned.

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

// R() parses DB values (DECIMAL columns return as strings from mysql2)
const gross = R(grossAmount);
const gst = pctOf(gross, parseFloat(rate) || 0); // percentage
const net = add(gross, cgstAmount, sgstAmount, igstAmount); // exact sum
if (gte(totalPaid, netAmount)) status = 'paid'; // safe comparison

// toNumber() is the ONLY escape hatch — use at DB-write and JSON-response boundaries
await db.execute('INSERT INTO invoices (amount) VALUES (?)', [toNumber(net)]);
```

### Formatting (`src/lib/format.js`)

NEVER define local `formatCurrency`/`formatNumber`/`formatDate` helpers. Import the shared ones:

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

- **v4** via `@import 'tailwindcss'` in `globals.css` — no `tailwind.config.js`
- Class merging: `import { cn } from '@/lib/cn'` (wraps `clsx` + `tailwind-merge`)

### New Code Standards

For all **new files**, follow these rules:

- **TypeScript only**: `.ts` for utilities, `.tsx` for components/pages, `route.ts` for API routes
- **Data fetching → TanStack Query**: `useQuery`/`useMutation` via existing `QueryProvider`
- **Forms → TanStack Form**: `useForm` from `@tanstack/react-form`
- **Tables → TanStack Table**: for new data tables
- **Components**: Radix UI primitives + `lucide-react` icons + `class-variance-authority`. Reuse `src/components/ui/` components.

## Important Files

| File                                    | Role                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `middleware.ts`                         | **Single source of auth truth** — public path allowlist, auth enforcement, admin gating, rate limiting (5 categories) |
| `src/utils/database.js`                 | MySQL pool manager — `dbConnect()`, `withDb()`, `query()`, `closePool()`                                              |
| `src/utils/permissions.js`              | Central RBAC — `checkPermission()`, `hasAnyAccess()`, 30+ resources                                                   |
| `src/utils/api-permissions.js`          | Server-side auth — `ensurePermission()`, `getCurrentUser()`, `checkPermissionFast()`                                  |
| `src/context/SessionContext.jsx`        | Client auth — `useSession()`, `can(resource, action)`                                                                 |
| `src/lib/money.ts`                      | Decimal.js money arithmetic — `R()`, `add`, `sub`, `pctOf`, `gte`, `toNumber`                                         |
| `src/lib/format.js`                     | Shared formatting — `formatCurrency`, `formatDate`, `formatNumber`                                                    |
| `src/utils/activity-logger.js`          | Audit trail — `logActivity()` for all mutations                                                                       |
| `src/components/admin/ResourcePage.tsx` | Reusable CRUD page template (TanStack Query + TanStack Form)                                                          |
| `knexfile.js`                           | Knex config — dev/staging/prod environments, `./migrations/` directory                                                |
| `next.config.ts`                        | Next.js config — `serverExternalPackages`, image optimization, compression                                            |
| `tsconfig.json`                         | TypeScript config — strict mode, `@/*` → `./src/*`, `allowJs: true`                                                   |
| `vitest.config.ts`                      | Test config — jsdom, globals, `@/` alias                                                                              |

## Runtime & Tooling

- **Runtime**: Node 24.x (specified in `package.json` `engines`)
- **Package manager**: npm
- **Module system**: ESM (`"type": "module"`)
- **Framework**: Next.js 15.5 (App Router), React 19.2
- **Styling**: Tailwind CSS v4 (PostCSS plugin), no config file
- **DB migrations**: Knex 3 — `npm run migrate:make -- name` creates `migrations/<timestamp>_name.js`
- **Server-only packages** (in `serverExternalPackages`): mysql2, sharp, exceljs, jspdf, @react-pdf/renderer, html2canvas, docxtemplater, pizzip — do not remove without checking bundle size
- **Migrations baseline**: `20260722080106_baseline_schema.js` (110 tables, 5,714 lines). Marked already-applied on prod — runs only on fresh/staging DBs

## Testing & QA

### Framework

- **Vitest 4** with `jsdom` environment, globals enabled
- **@testing-library/react** for component tests, **@testing-library/user-event** for interactions
- Setup: `vitest.setup.ts` imports `@testing-library/jest-dom` for DOM matchers

### Test Structure

Tests live in `src/__tests__/` and mirror the source tree:

```
src/__tests__/
├── api/           # API route tests (mirrors src/app/api/)
├── components/    # Component tests
├── utils/         # Pure utility tests (e.g. money.test.ts)
├── admin/         # Page-level tests
├── projects/      # Project page/tab tests
├── reports/       # Report page tests
└── masters/       # Master data page tests
```

### Test Patterns

**API route tests:**

```ts
// Mock DB + auth BEFORE dynamic imports (Vitest hoists mocks)
const mockExecute = vi.fn();
vi.mock('@/utils/database', () => ({
	dbConnect: vi
		.fn()
		.mockResolvedValue({ execute: mockExecute, release: vi.fn() }),
}));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi
		.fn()
		.mockResolvedValue({ authorized: true, user: { id: 1 } }),
	RESOURCES: { INVOICES: 'invoices' },
	PERMISSIONS: { READ: 'read', CREATE: 'create' },
}));

// Dynamic import loads route handlers after mocks
const { GET, POST, DELETE } =
	await import('@/app/api/admin/invoices/[id]/route');

// Test with mock Request objects
const req = new Request('http://localhost/api/admin/invoices/1');
const res = await GET(req, { params: Promise.resolve({ id: '1' }) });
expect(res.status).toBe(200);
```

**Component tests:**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock dependencies (router, auth, fetch) before render
vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));
vi.mock('@/utils/client-rbac', () => ({ useSessionRBAC: vi.fn() }));

render(<MyComponent />);
await userEvent.click(screen.getByText('Submit'));
```

**Utility tests** — pure functions, no mocking, test edge cases for precision and null safety.

### Coverage

No coverage thresholds configured. `npm run test:coverage` runs Vitest with `--coverage` flag (requires a coverage provider).

### Linting & Formatting

- ESLint runs on `src` and `scripts` directories
- Prettier formats all files on pre-commit via Husky + lint-staged
- No test runner in pre-commit hook
