# Repository Guidelines

## Project Overview

Accent CRM is an enterprise ERP/CRM platform built with **Next.js 15 (App Router)**, **React 19**, and **MySQL**. It coordinates the end-to-end business lifecycle: lead tracking, proposal authoring, project delivery and daily activity logging, employee management, attendance and payroll calculations, sale invoices, purchase orders, expenses, support tickets, and management reporting.

- **Runtime**: Node 24.x with pure ES Modules (`"type": "module"`)
- **Database**: MySQL via `mysql2/promise` connection pool + Knex migrations (1 baseline + 17 incremental)
- **Authentication**: Opaque 256-bit server-side session tokens in a single HttpOnly `session` cookie, validated against the `sessions` table in Node.js (Edge middleware handles presence and rate limiting)
- **Styling**: Tailwind CSS v4 (CSS-first configuration via `@import 'tailwindcss'`)
- **Language**: Mixed codebase (legacy `.js`/`.jsx` and modern `.ts`/`.tsx`). **Strict TypeScript is required for all new files.**

---

## Architecture & Data Flow

```
Browser Request
  │
  ▼
middleware.ts (Edge)          ← Cookie presence check, sliding-window rate limiter, public route allowlist
  │
  ▼
Next.js App Router
  ├─ Root Layout (RSC)        ← Geist fonts, QueryProvider, SessionProvider, Sidebar, Toaster
  ├─ Admin Layout (RSC)       ← force-dynamic, getServerAuth() role guard (super_admin / admin)
  ├─ Client Pages ('use client') ← TanStack Query, SessionContext (useSession / can), TanStack Form
  │
  ▼
API Routes (/api/**/route.ts)
  ├─ ensurePermission()       ← RBAC guard (getCurrentUser parses session token, validates DB, caches 5m)
  ├─ query() / withDb()       ← MySQL connection pool (globalThis.__dbPool singleton, connectionLimit: 5)
  └─ logActivity()            ← Non-blocking audit logger, delta-based screen-time, presence upserts
  │
  ▼
MySQL Database (110+ tables)  ← Soft-delete (isDelete = 0), DECIMAL money fields, generated unique columns
```

### 1. Authentication & Session Lifecycle

1. **Login (`/api/login`)**: Verifies password against bcrypt hash (auto-upgrading legacy plaintext passwords via `verifyPassword`/`needsRehash`). Generates a 256-bit cryptographic token (`crypto.randomBytes(32)`), computes `token_hash = sha256(token)`, and inserts a row into `sessions` with `expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY)`. Sets an HttpOnly `session` cookie (`SameSite=Lax`, `Secure` in production, `Max-Age=30 days`, `priority='high'`). Legacy cookies (`auth`, `user_id`, `is_super_admin`, `session_permissions`) are cleared with `maxAge: 0`.
2. **Edge Middleware (`middleware.ts`)**: Routing-level presence check only (`req.cookies.get('session')?.value`). Rate limits via an in-memory sliding window across 5 categories (`auth`: 10 req/15m; `session`: 120/m; `dashboard`: 60/m; `api`: 120/m; `heavy`: 10/m). Unauthenticated page requests redirect to `/signin?from=<path>`; unauthenticated API requests receive `401 Unauthorized`.
3. **Node Session Validation (`src/utils/api-permissions.js`)**: Real cryptographic authentication happens in `getCurrentUser(request)` (or `getServerAuth()` in server components). The session cookie token is hashed (`SHA-256`) and queried against `sessions JOIN users LEFT JOIN roles_master LEFT JOIN employees` where `expires_at > NOW()` and `u.isDelete = 0`.
4. **Caching & Concurrency**: Validated user profiles are cached for 5 minutes in an in-memory `userCache` map. Concurrent requests for the same token are deduplicated via `pendingUserFetches` to prevent DB connection spikes. Cache is invalidated via `invalidateUserCache(userId)` on permission/role changes.
5. **Revocation & Multi-Session**: Each login creates an independent session row. `revokeSession(db, token)` deletes the active session on logout. `revokeAllUserSessions(db, userId)` deletes all user sessions on password change or reset.

### 2. Role-Based Access Control (RBAC)

Two permission structures coexist and are evaluated by `checkPermission` (`src/utils/permissions.js`):

- **Flat Permissions (`resource:action`)**: Stored in `roles_master.permissions` and `users.permissions` as JSON arrays (e.g. `projects:read`, `leads:create`, `invoices:delete`). Merged into `user.merged_permissions` via set union (`mergePermissions`).
- **Field-Level Permissions (`field_permissions`)**: Stored in `users.field_permissions` as nested JSON defining module enablement, CRUD permissions, and field visibility (`'hidden' | 'view' | 'edit'`). Dropped modules are pruned on load via `stripDisabledModules()`.
- **Evaluation Order**:
  1. Super Admin (`user.is_super_admin === 1`) bypasses all checks and has universal access.
  2. Flat permissions checked via `user.merged_permissions.includes('resource:action')`.
  3. Field permissions checked via `field_permissions.modules[resource].crud[action]`.
- **API Guard (`ensurePermission`)**:
  ```ts
  const auth = await ensurePermission(request, RESOURCES.PROJECTS, PERMISSIONS.READ);
  if (auth instanceof Response) return auth; // Returns 401 or 403 NextResponse
  const user = auth.user;
  ```
- **Hierarchy Protection (`canModifyTargetUser`)**: Non-super admins cannot create, edit, or delete super admins or users with equal/higher role rank.

### 3. Activity Logging & Presence Monitoring

- **Audit Trail (`logActivity`)**: Fire-and-forget helper in `src/utils/activity-logger.ts` recording actions into `user_activity_logs`. Swallows internal errors so tracking never breaks user mutations.
- **Delta Screen Time (`updateScreenTime`)**: Client heartbeat (`useActivityTracker.js`) sends time deltas (`activeDeltaMs`, `idleDeltaMs`) every 120s (or on `beforeunload` via `navigator.sendBeacon`). Server accumulates seconds into `user_screen_time` via `ON DUPLICATE KEY UPDATE`.
- **Presence (`updateUserPresence`)**: Upserts into `user_presence` with `last_seen = CURRENT_TIMESTAMP`. Online/idle status queries compute age SQL-side (`TIMESTAMPDIFF(SECOND, p.last_seen, NOW())`) to eliminate client/server clock-skew bugs.

---

## Key Directories

| Directory | Purpose |
| :--- | :--- |
| `src/app/` | Next.js App Router pages, layouts, and route handlers. Modern sections (`admin/`, `reports/`, `masters/deliverables/`) are `.tsx`; legacy modules remain `.jsx`. |
| `src/app/api/` | ~60 API route directories handling CRUD, reports, auth, file uploads, payroll, and webhooks. |
| `src/components/` | Reusable React components. `src/components/ui/` contains design primitives (`Button`, `Modal`, `Table`, `FormFields`, `SearchableSelect`). `src/components/admin/` contains `ResourceFormModal.tsx`. |
| `src/components/providers/` | Client context providers: `QueryProvider.tsx` (TanStack Query client configuration). |
| `src/context/` | React contexts: `SessionContext.jsx` (exposes `useSession()`, `can()`, and user state to client). |
| `src/hooks/` | Custom hooks: `useActivityTracker.js`, `useIdleMonitor.js`, `useSpellCheck.js`. |
| `src/utils/` | Server utilities: `database.js` (pool), `api-permissions.js` (auth guard), `permissions.js`/`rbac.js` (RBAC), `session.ts`, `activity-logger.ts`, `password.ts`, `server-auth.js`, `schema-cache.js`, `payroll-calculator.js`. |
| `src/lib/` | Shared libraries: `money.ts` (Decimal.js arithmetic), `format.js` (INR formatters), `api-client.js` (typed fetch wrappers), `cn.js` (Tailwind class merging). |
| `src/__tests__/` | 78 Vitest test suites mirroring the `src/` tree (`api/`, `projects/[id]/`, `utils/`, `reports/`, `masters/`, `components/`, `admin/`). |
| `migrations/` | 18 Knex database migrations: baseline schema (`20260722080106_baseline_schema.js`) + 17 incremental migrations. |
| `scripts/` | Standalone CLI scripts for database seeding, salary sheet import, payroll diagnostics, and activity data normalization. |
| `docs/` | Internal technical specs: `SECURITY_AUDIT.md` (25 vulnerability findings/status), `explanations/` (RBAC, soft-delete, activity normalization), `todo/` (architecture audits), `app/` (reports & projects implementation notes). |

---

## Development Commands

| Command | Description | Notes |
| :--- | :--- | :--- |
| `npm run dev` | Starts Next.js development server | Standard dev server |
| `npm run dev:turbo` | Starts Next.js dev server with Turbopack | Faster rebuilds |
| `npm run build` | Builds production application | Strict Next.js build verification |
| `npm run start` | Runs production server | Requires prior `npm run build` |
| `npm run lint` | Runs ESLint 9 Flat Config | Lints `src/` and `scripts/` |
| `npm run format` | Formats all files via Prettier | Tabs, 2-width, single quotes |
| `npm test` | Runs Vitest in interactive watch mode | Default test command |
| `npm run test:run` | Runs all Vitest test suites once | CI/CD single execution |
| `npm run test:ui` | Opens interactive Vitest browser UI | Visual debugging |
| `npm run test:coverage` | Runs Vitest with coverage report | Requires `@vitest/coverage-v8` |
| `npm run migrate` | Executes pending Knex migrations | Runs `knex migrate:latest` |
| `npm run migrate:status` | Shows migration status | Inspects applied vs pending |
| `npm run migrate:make -- <name>` | Scaffolds a new migration file | Creates `migrations/<timestamp>_<name>.js` |
| `npm run migrate:rollback` | Rolls back last migration batch | Knex rollback |

### Single Test Execution
```bash
# Run a specific test file
npx vitest run src/__tests__/utils/money.test.ts

# Run tests matching a name pattern
npx vitest run -t "ensurePermission"

# Run tests in watch mode
npx vitest src/__tests__/api/admin/invoices/route.test.tsx
```

### Stale Scripts (Do Not Run)
The following `package.json` scripts target deleted files and will fail: `migrate:add-enquiry-no`, `migrate:add-project-lists`, `clear-leads`, `setup`, `update-dates`, `db:check`, and `db:kill`.

---

## Code Conventions & Common Patterns

### 1. Database Access Patterns (`src/utils/database.js`)

Always use one of the three established patterns. Never instantiate unpooled `mysql.createConnection` inside route handlers.

```ts
// Pattern 1: query() — Best for single queries (auto-acquired & released)
import { query } from '@/utils/database';
const [rows] = await query('SELECT * FROM users WHERE id = ? AND isDelete = 0', [userId]);

// Pattern 2: withDb() — Best for multi-query blocks and transactions (guaranteed release)
import { withDb } from '@/utils/database';
const result = await withDb(async (db) => {
  const [rows] = await db.execute('SELECT * FROM projects WHERE id = ?', [projectId]);
  await db.execute('UPDATE projects SET status = ? WHERE id = ?', ['active', projectId]);
  return rows;
});

// Pattern 3: dbConnect() — Manual connection; MUST release in finally
import { dbConnect } from '@/utils/database';
let db;
try {
  db = await dbConnect();
  const [rows] = await db.execute('SELECT * FROM leads WHERE isDelete = 0');
} finally {
  if (db) await db.release();
}
```

- **Pool Constraints**: Bounded to `connectionLimit: 5` (`queueLimit: 200`, `maxIdle: 2`, `dateStrings: true`) to stay safely below MySQL's `max_user_connections`. Retries transient connection spikes automatically.
- **HMR Preservation**: The pool is preserved on `globalThis.__dbPool` during Fast Refresh.
- **No Per-Request DDL**: Never execute `CREATE TABLE`, `ALTER TABLE`, or `SHOW TABLES` in API routes. Use Knex migrations for schema changes and `hasColumn(db, table, column)` from `src/utils/schema-cache.js` for column inspection.

### 2. Soft-Delete & Unique Index Pattern

- All operational tables use `isDelete TINYINT(1) NOT NULL DEFAULT 0`.
- All `SELECT`, `UPDATE`, and `JOIN` queries **must** include `WHERE isDelete = 0` (or `table.isDelete = 0`).
- Upgraded tables track `deleted_at TIMESTAMP NULL` and `deleted_by INT NULL`.
- **Soft-Delete Safe Unique Constraints**: To allow reusing numbers (e.g. invoice/quotation numbers) after soft deletion, tables use a stored generated column:
  ```sql
  active_invoice_number VARCHAR(191) GENERATED ALWAYS AS (IF(isDelete = 0, invoice_number, NULL)) STORED,
  UNIQUE KEY unique_active_invoice (active_invoice_number)
  ```

### 3. Financial & Money Arithmetic (`src/lib/money.ts`)

**Strict Rule**: Never use raw `parseFloat`, `Number(...)`, or native JS arithmetic (`+`, `-`, `*`, `/`) for money, billing, or salary values. Binary floating-point math causes precision loss.

```ts
import { R, add, sub, mul, div, pctOf, roundR, gte, gt, isZero, toNumber } from '@/lib/money';

const gross = R(invoice.gross_amount);
const gstRate = 18;
const tax = pctOf(gross, gstRate); // Exactly gross * 18 / 100
const net = add(gross, tax);

if (gte(paymentTotal, net)) {
  status = 'paid';
}

// Convert back to JS number ONLY at DB insertion or JSON response boundaries
await db.execute('INSERT INTO invoices (amount) VALUES (?)', [toNumber(net)]);
```

### 4. Locale-Aware Formatting (`src/lib/format.js`)

Never create local `formatCurrency` or `formatDate` helper functions. Import from `@/lib/format`:

```ts
import { formatCurrency, formatNumber, formatDate, formatDateTime, formatDateInput } from '@/lib/format';

formatCurrency(123456.78);   // "₹1,23,456.78" (gracefully returns "—" on null/NaN)
formatNumber(123456.78);     // "1,23,456.78"
formatDate('2026-08-16');    // "16 Aug 2026"
formatDateTime(new Date());  // "16 Aug 2026, 14:30"
formatDateInput(new Date()); // "2026-08-16" (for <input type="date" />)
```

### 5. Styling, Color Palette & UI Tokens

- **Tailwind CSS v4**: CSS-first styling in `src/app/globals.css`. Do not add a `tailwind.config.js`.
- **Class Merging**: Always use `cn(...)` from `@/lib/cn` (`clsx` + `tailwind-merge`).
- **Brand Purple Scale**:
  - Fixed Sidebar Base: `#4d025b` (`bg-[#4d025b]`, `var(--sidebar-bg)`)
  - Primary Action / Buttons: `#64126D` (`bg-[#64126D]`, `hover:bg-[#52105a]`, `focus:ring-[#64126D]`)
  - Accent / Highlights: `#7F2487` / `#86288F`
  - Focus Ring Standard: `focus:ring-2 focus:ring-purple-500` (legacy) or `focus:ring-[#64126D]` (modern)
- **Standard Semantic Badges**:
  | Status | Classes |
  | :--- | :--- |
  | `draft` | `bg-slate-100 text-slate-700` |
  | `submitted` / `pending` | `bg-amber-100 text-amber-700` or `bg-yellow-100 text-yellow-700` |
  | `approved` / `completed` / `paid` | `bg-green-100 text-green-700` |
  | `rejected` / `overdue` / `cancelled` | `bg-red-100 text-red-700` |
  | `in progress` / `sent` / `active` | `bg-blue-100 text-blue-700` |
  | `on hold` / `paused` | `bg-orange-100 text-orange-700` |
- **Form Input Contrast**: `globals.css` enforces `input, textarea, select { color: #000 !important; caret-color: #000; }`. Never override input text to light gray.

### 6. Client Data Fetching & Forms

- **Data Fetching**: Use TanStack Query (`useQuery` / `useMutation`) wrapped by `QueryProvider` (`staleTime: 30s`, `retry: 1`, `refetchOnWindowFocus: false`).
- **HTTP Client**: Use `apiGet`, `apiPost`, `apiPut`, `apiDelete` from `@/lib/api-client` (handles credentials, error parsing, and query strings).
- **Admin Forms**: Use `ResourceFormModal.tsx` powered by `@tanstack/react-form` and Zod validation schemas.

---

## Important Files

| File | Role |
| :--- | :--- |
| `middleware.ts` | Edge routing gate: cookie presence check, rate limiting, and public path whitelist. |
| `src/app/layout.jsx` | Root application layout wiring fonts, `QueryProvider`, `SessionProvider`, global sidebar, and toasts. |
| `src/app/admin/layout.tsx` | Admin route gate enforcing `force-dynamic` and role validation via `getServerAuth()`. |
| `src/utils/database.js` | MySQL pool manager: `query()`, `withDb()`, `dbConnect()`, and HMR pool persistence. |
| `src/utils/api-permissions.js` | Server-side auth boundary: `ensurePermission()`, `getCurrentUser()`, user cache, and token hashing. |
| `src/utils/permissions.js` | RBAC engine resolving flat and field-level permissions. |
| `src/utils/rbac.js` | Resource and permission constants (`RESOURCES`, `PERMISSIONS`). |
| `src/utils/session.ts` | Cryptographic session tokens, DB hashing (`SHA-256`), creation, and multi-session revocation. |
| `src/utils/activity-logger.ts` | Non-blocking activity audit logging, presence updates, and screen time accumulation. |
| `src/utils/schema-cache.js` | In-memory column and primary-key metadata cache (10m TTL) preventing runtime DDL queries. |
| `src/lib/money.ts` | Centralized `Decimal.js` monetary arithmetic library. |
| `src/lib/format.js` | Centralized `en-IN` currency, number, and date formatters. |
| `src/lib/api-client.js` | Typed client HTTP wrapper for standard API requests. |
| `src/context/SessionContext.jsx` | Client auth provider hydrating from `/api/session` and providing the `can()` helper. |
| `src/components/providers/QueryProvider.tsx` | Global TanStack Query client configuration. |
| `src/components/admin/ResourceFormModal.tsx` | Dynamic form modal component built with TanStack Form and Zod. |
| `knexfile.js` | Knex database connection configuration across dev, staging, and prod environments. |
| `next.config.ts` | Next.js configuration declaring `serverExternalPackages`, upload headers, and optimization rules. |
| `tsconfig.json` | TypeScript compiler settings (`strict: true`, `allowJs: true`, `noImplicitAny: false`, `@/*` alias). |
| `vitest.config.ts` | Vitest test runner configuration with `jsdom` and `@/` path alias. |
| `docs/SECURITY_AUDIT.md` | Security vulnerability tracker with finding IDs and fix status. |

---

## Runtime & Tooling Preferences

- **Node Engine**: Node `24.x` (enforced via `package.json` `engines`).
- **Package Manager**: `npm` with `package-lock.json` (`lockfileVersion: 3`).
- **Module System**: Pure ES Modules (`"type": "module"`). All project files and Knex migrations use ESM exports.
- **Server External Packages**: Heavy/binary server libraries are excluded from Next.js bundling in `next.config.ts` (`serverExternalPackages: ['mysql2', 'sharp', 'exceljs', 'jspdf', '@react-pdf/renderer', 'html2canvas', 'docxtemplater', 'pizzip']`).
- **TypeScript Configuration**:
  - Target `ES2017`, module resolution `bundler`, incremental builds enabled.
  - Path alias: `@/*` maps to `./src/*`.
  - Type checking options: `strict: true`, `allowJs: true`, `noImplicitAny: false`. Run check via `npx tsc --noEmit`.
- **ESLint & Prettier**:
  - ESLint 9 Flat Config (`eslint.config.mjs`) extending `next/core-web-vitals` and `next/typescript`.
  - Prettier config: Tabs (`useTabs: true`, `tabWidth: 2`), single quotes, semicolons, trailing commas (`es5`), 80 print width.
  - Git pre-commit hook runs `lint-staged` with `prettier --write` via Husky v9.
- **Database Migrations (Knex)**:
  - Migrations reside in `migrations/` as ESM `.js` files exporting `up(knex)` and `down(knex)`.
  - Staging/Dev environments connect via `DEV_DB_*` / `STAGING_DB_*` / `PROD_DB_*` credentials.

---

## Testing & QA

### 1. Test Stack & Structure

- **Framework**: Vitest v4.1.7 with React plugin (`@vitejs/plugin-react`)
- **DOM Environment**: `jsdom` v29.1.1
- **Testing Libraries**: `@testing-library/react` v16.3.2, `@testing-library/jest-dom` v6.9.1, `@testing-library/user-event` v14.6.1
- **Layout**: 78 test files in `src/__tests__/` mirroring the application tree:
  - `src/__tests__/api/` (29 files): Route handlers, RBAC authorization, soft-delete verification, and security regressions.
  - `src/__tests__/projects/[id]/` (31 files): 30 project edit tab tests and view-only workspace permission tests.
  - `src/__tests__/utils/` (8 files): Unit tests for `money.ts`, `session.ts`, `payroll-calculator.ts`, and `api-permissions.ts`.
  - `src/__tests__/reports/` (6 files): Timesheet, manhours billing, attendance parity, and employee reports.
  - `src/__tests__/masters/` (3 files): Deliverables, descriptions, and categories admin pages.
  - `src/__tests__/components/` (3 files): Shared interactive UI components.
  - `src/__tests__/admin/` (1 file): Invoices management page.

### 2. Testing Conventions & Patterns

#### API Route Tests
Mocks must be defined before dynamically importing the route handler to ensure proper module hoisting:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
  execute: mockExecute,
  release: vi.fn(),
  end: vi.fn(),
});

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
  ensurePermission: vi.fn().mockResolvedValue({ authorized: true, user: { id: 1, is_super_admin: 0 } }),
  RESOURCES: { INVOICES: 'invoices' },
  PERMISSIONS: { READ: 'read', DELETE: 'delete' },
  invalidateUserCache: vi.fn(),
}));

// Dynamic import after mocks
const { GET, DELETE } = await import('@/app/api/admin/invoices/route');

describe('Invoices API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches invoices with soft-delete filter and unwraps Next 15 async params', async () => {
    // Return tuple [rows, fields]
    mockExecute.mockResolvedValueOnce([[{ id: 1, invoice_number: 'INV-001' }]]);

    const req = new Request('http://localhost:3000/api/admin/invoices');
    const res = await GET(req, { params: Promise.resolve({ id: '1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(mockExecute.mock.calls[0][0]).toContain('isDelete = 0');
  });
});
```

#### Component & Page Tests
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ id: '1' }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

it('handles user submission and updates DOM asynchronously', async () => {
  const user = userEvent.setup();
  render(<MyComponent />, { wrapper: createWrapper() });

  const button = screen.getByRole('button', { name: /save/i });
  await user.click(button);

  await waitFor(() => {
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();
  });
});
```

#### Utility Tests
Test pure mathematical calculations, invariants, and edge cases directly without mocking:
- **`money.test.ts`**: Validates Decimal precision (e.g. `add(0.1, 0.2)` is strictly `0.3`), string representations from MySQL, and safe division/rounding.
- **`payroll-calculator.test.ts`**: Verifies salary percentage splits (Basic+DA 60%, HRA 20%), 4.81% gratuity, and the balance invariant: `total_earnings - total_deductions === net_pay`.
