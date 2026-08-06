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
| `src/components/` | Shared React components — `ui/` (primitives: Button, Table, Modal, FormFields), `admin/ResourceFormModal.tsx` (shared form renderer), `Sidebar`, `Navbar`, `AuthGate` (no-op)          |
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

### Color Scheme

Accent uses a **purple** brand with conventional semantic colors. New code MUST follow these mappings — do not invent a second accent color, do not substitute Tailwind hues for established ones, and do not reach for `purple-25` (non-standard; use `purple-50` or `bg-purple-50/50`).

#### Brand purple (primary action + brand identity)

| Token              | Hex       | Tailwind class       | Used for                                                                                                                 |
| ------------------ | --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Sidebar background | `#4d025b` | `bg-[#4d025b]`       | Fixed sidebar (`var(--sidebar-bg)` in `globals.css`)                                                                     |
| Brand deep         | `#64126D` | `bg-[#64126D]`       | Active nav item, sidebar accents, sign-in gradient anchor                                                                |
| Brand primary      | `#7F2487` | `bg-[#7F2487]`       | Active row borders, icon accents, CTA when Tailwind tokens aren't enough                                                 |
| Brand mid          | `#86288F` | `bg-[#86288F]`       | Gradient stop paired with `#64126D`                                                                                      |
| Hover on `#7F2487` | `#6a1f72` | `hover:bg-[#6a1f72]` | Primary button hover (with `disabled:opacity-50 disabled:cursor-not-allowed`)                                            |
| Brand via Tailwind | —         | `purple-50`/`100`    | **Backgrounds**: chip tints, hover states, soft containers                                                               |
|                    | —         | `purple-200`         | **Borders** on purple-tinted cards; default sidebar border                                                               |
|                    | —         | `purple-500`         | **Focus ring** (dominant — 326 uses; see Focus below)                                                                    |
|                    | —         | `purple-600`         | **Primary buttons**: `bg-purple-600 text-white hover:bg-purple-700`; **icons** (`text-purple-600` on neutral icon tiles) |
|                    | —         | `purple-700`         | **Text** on purple-50/100 backgrounds; **borders** for active tabs; **dark hover** on primary icons                      |
|                    | —         | `purple-800`         | High-contrast text on `purple-100` chips (e.g. `view_page` action badge)                                                 |

Use the **hex form** (`bg-[#7F2487]`) only when the exact brand swatch is required (active border, sign-in gradient, icon accent) — for everything else, use the Tailwind token so utilities like `hover:bg-purple-700` work.

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

> **Why gray, not slate**: `text-gray-*`/`bg-gray-*` is the dominant neutral (3,696 + 2,010 = 5,700+ uses); `slate` is reserved for specific status cases (e.g. `draft` in `expenses/page.jsx`). New code should default to `gray`.

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

`focus:ring-purple-500` is the standard (326 uses). Other rings, in order of frequency:
`focus:ring-blue-500` (form inputs, generic), `focus:ring-green-500` / `600`, `focus:ring-red-500`, `focus:ring-purple-300` (lighter on tinted backgrounds). Always pair with `focus:ring-2` and `focus:border-transparent` for inputs.

#### Form text (global)

`globals.css` forces all form field text to **black** to keep data legible on a busy background:

```css
input,
textarea,
select {
	color: #000;
}
```

Don't override this for "design consistency" — gray form text is a known readability problem on the Employees screen and is explicitly overridden back to black via `.employees-screen` (see `globals.css:599`). If a screen needs higher contrast on neutral labels, prefer `text-gray-900` over `text-gray-500`/`600`.

#### Dark mode

`globals.css` declares dark-mode CSS variables (`@media (prefers-color-scheme: dark)`), but **no Tailwind `dark:` variants are used anywhere in the codebase** — every screen is light-only in practice. Don't introduce `dark:` classes; if dark mode is ever needed, it requires a separate design pass and a global audit.

#### Don'ts

- **`bg-purple-25` / `text-purple-25`** — not in the default Tailwind scale. Use `bg-purple-50` or `bg-purple-50/50`. (Pre-existing 11 uses should be migrated when touching the file.)
- **Two accent colors in one view** — the sidebar/header is purple, body CTAs are purple, but a single component should fill only its **own** primary action; secondaries stay neutral. Don't paint every button.
- **Color for non-semantic emphasis** — reach for `text-gray-900` (bolder weight via color) before reaching for `text-purple-700` on body copy.
- **`slate-*` outside the `draft`/specific-status exceptions** — gray is the neutral; introducing slate creates two "off-whites."
- **Hardcoded hex where a Tailwind token exists** — `bg-purple-600` over `bg-[#7F2487]` unless the exact brand swatch is required.

### New Code Standards

For all **new files**, follow these rules:

- **TypeScript only**: `.ts` for utilities, `.tsx` for components/pages, `route.ts` for API routes
- **Data fetching → TanStack Query**: `useQuery`/`useMutation` via existing `QueryProvider`
- **Forms → TanStack Form**: `useForm` from `@tanstack/react-form`
- **Tables → TanStack Table**: for new data tables
- **Components**: Radix UI primitives + `lucide-react` icons + `class-variance-authority`. Reuse `src/components/ui/` components.

## Important Files

| File                                         | Role                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `middleware.ts`                              | **Single source of auth truth** — public path allowlist, auth enforcement, admin gating, rate limiting (5 categories) |
| `src/utils/database.js`                      | MySQL pool manager — `dbConnect()`, `withDb()`, `query()`, `closePool()`                                              |
| `src/utils/permissions.js`                   | Central RBAC — `checkPermission()`, `hasAnyAccess()`, 30+ resources                                                   |
| `src/utils/api-permissions.js`               | Server-side auth — `ensurePermission()`, `getCurrentUser()`, `checkPermissionFast()`                                  |
| `src/context/SessionContext.jsx`             | Client auth — `useSession()`, `can(resource, action)`                                                                 |
| `src/lib/money.ts`                           | Decimal.js money arithmetic — `R()`, `add`, `sub`, `pctOf`, `gte`, `toNumber`                                         |
| `src/lib/format.js`                          | Shared formatting — `formatCurrency`, `formatDate`, `formatNumber`                                                    |
| `src/utils/activity-logger.js`               | Audit trail — `logActivity()` for all mutations                                                                       |
| `src/components/admin/ResourceFormModal.tsx` | Shared form renderer consumed by decoupled admin pages                                                                |
| `knexfile.js`                                | Knex config — dev/staging/prod environments, `./migrations/` directory                                                |
| `next.config.ts`                             | Next.js config — `serverExternalPackages`, image optimization, compression                                            |
| `tsconfig.json`                              | TypeScript config — strict mode, `@/*` → `./src/*`, `allowJs: true`                                                   |
| `vitest.config.ts`                           | Test config — jsdom, globals, `@/` alias                                                                              |

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
