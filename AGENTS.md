# Accent CRM — Agent Guide

> Next.js 15 App Router + React 19 + MySQL. Keep this file compact — every line should be something an agent would miss without help.

## Stack & Runtime

- Node `24.x` (enforced via `engines`), `npm` + `package-lock.json` v3, pure ESM (`"type": "module"` — all migrations too).
- MySQL via `mysql2/promise` pool (`src/utils/database.js`) + Knex migrations (`migrations/`, 1 baseline + 17 incremental).
- Tailwind CSS v4 CSS-first (`@import 'tailwindcss'` in `src/app/globals.css`) — no `tailwind.config.js`. Use `cn()` from `src/lib/cn.js`.
- Mixed JS/TS codebase; **strict TypeScript (`strict: true`) required for all new files** (`allowJs: true`, `noImplicitAny: false`, `@/*` → `src/*`, target `ES2017`, `moduleResolution: bundler`).

## Commands

| Task          | Command                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Dev           | `npm run dev` / `npm run dev:turbo` (Turbopack)                                                                         |
| Build / Start | `npm run build` (strict) then `npm run start`                                                                           |
| Lint          | `npm run lint` (ESLint 9 flat, `src` + `scripts` only)                                                                  |
| Format        | `npm run format` (Prettier: tabs, width 2, single-quote) — pre-commit runs `lint-staged: prettier --write` via Husky v9 |
| Typecheck     | `npx tsc --noEmit` (no npm script)                                                                                      |
| Test (watch)  | `npm test`                                                                                                              |
| Test (once)   | `npm run test:run`                                                                                                      |
| Coverage      | `npm run test:coverage`                                                                                                 |
| Single file   | `npx vitest run src/__tests__/utils/money.test.ts`                                                                      |
| Single name   | `npx vitest run -t "ensurePermission"`                                                                                  |
| Migrations    | `npm run migrate` / `migrate:status` / `migrate:rollback` / `migrate:make -- <name>`                                    |

**Stale scripts — do not run** (deleted backing files, will fail): `migrate:add-enquiry-no`, `migrate:add-project-lists`, `clear-leads`, `setup`, `update-dates`, `db:check`, `db:kill`.

Order that matters: `lint` → `npx tsc --noEmit` → `npm run test:run` before pushing; `npm run build` is the final gate.

## Architecture Gotchas

- **Auth split**: `middleware.ts` (Edge) only checks `session` cookie presence + rate-limits. Real validation is `getCurrentUser(request)` / `getServerAuth()` in `src/utils/api-permissions.js` — hashes token with SHA-256 and queries `sessions JOIN users LEFT JOIN roles_master LEFT JOIN employees` where `expires_at > NOW()` and `u.isDelete = 0`. Cached 5 min (`userCache` + `pendingUserFetches` dedup); invalidate via `invalidateUserCache(userId)`.
  - Login (`/api/login`) creates 256-bit token (`crypto.randomBytes(32)`), stores `token_hash`, 30-day expiry, HttpOnly `SameSite=Lax` cookie. Logout calls `revokeSession`; password change calls `revokeAllUserSessions`.
  - Public paths in `middleware.ts:4` include `/signin`, `/api/login`, `/api/session`, `/api/attendance/webhook` (Bearer auth inside handler), `/_next`, `/uploads`.

- **Rate limits** (`middleware.ts:41`): `auth` 10/15m, `session` 120/m, `dashboard` 60/m, `api` 120/m, `heavy` (export/report/bulk) 10/m — in-memory `rateLimitStore`, per-IP+session key.

- **RBAC** (`src/utils/permissions.js`, `src/utils/rbac.js`): two structures merged via `mergePermissions` (set union).
  - Flat `resource:action` strings in `roles_master.permissions` + `users.permissions` → `user.merged_permissions`.
  - Field-level `users.field_permissions.modules[resource].crud[action]` (`'hidden'|'view'|'edit'`), pruned by `stripDisabledModules()`. `super_admin === 1` bypasses all. Hierarchy guard `canModifyTargetUser` prevents non-super-admin from touching super-admin or equal/higher `role_hierarchy`.
  - API guard pattern: `const auth = await ensurePermission(req, RESOURCES.PROJECTS, PERMISSIONS.READ); if (auth instanceof Response) return auth;`

- **DB pool** (`src/utils/database.js:1`): `globalThis.__dbPool` singleton, `connectionLimit: 5` (`queueLimit: 200`, `maxIdle: 2`, `dateStrings: true`). Use `query()` (single), `withDb(cb)` (multi/transaction), or `dbConnect()` + `finally release()`. Never `mysql.createConnection` in routes. Never `CREATE/ALTER/SHOW` in routes — use Knex migrations or `hasColumn(db, table, col)` from `src/utils/schema-cache.js` (10 m TTL).

- **Soft-delete**: `isDelete TINYINT(1) DEFAULT 0` on all operational tables. Every `SELECT/JOIN/UPDATE` must include `WHERE isDelete = 0`. Unique numbers (invoice/quotation) use generated column `IF(isDelete=0, col, NULL) STORED` + unique index on it.

- **Money** (`src/lib/money.ts`): never `parseFloat`/`+`/`-`/`*`/`/` for billing/salary. Use `R`, `add`, `sub`, `mul`, `div`, `pctOf`, `roundR`, `gte`, `isZero`, `toNumber` (Decimal.js, precision 20, `ROUND_HALF_UP`). Convert to number only at DB/JSON boundary.

## Conventions That Break If Guessed

- **Formatting** (`src/lib/format.js`): `formatCurrency`/`formatNumber`/`formatDate`/`formatDateTime`/`formatDateInput` — `en-IN`, returns `"—"` on null/NaN. Don't write local formatters.
- **Styling tokens**: sidebar `bg-[#4d025b]` / `var(--sidebar-bg)`, primary button `bg-[#64126D]` `hover:bg-[#52105a]`, accent `#7F2487`/`#86288F`. Badges: `draft` slate, `pending` amber/yellow, `approved/paid/completed` green, `rejected/overdue` red, `active/sent` blue, `on hold` orange. `globals.css:316` forces `input,textarea,select { color:#000 !important }` — don't override to gray.
- **No `tailwind.config.js`**, `postcss.config.mjs` is just `['@tailwindcss/postcss']`.
- **Data fetching**: TanStack Query (`QueryProvider` `staleTime:30s retry:1 refetchOnWindowFocus:false`) + `apiGet/apiPost/apiPut/apiDelete` from `src/lib/api-client.js`. Admin forms via `ResourceFormModal.tsx` (TanStack Form + Zod).
- **Uploads** (`next.config.ts:38`): `/uploads/*` served with `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment`; content is server-rasterized PNGs.
- **Heavy packages** excluded from bundling (`next.config.ts:14` `serverExternalPackages`: `mysql2`, `sharp`, `exceljs`, `jspdf`, `@react-pdf/renderer`, `html2canvas`, `docxtemplater`, `pizzip`).

## Project Layout (where to look)

- `src/app/` — App Router; modern `.tsx` is `admin/`, `reports/`, `masters/deliverables/`, legacy `.jsx` elsewhere.
- `src/app/api/` — ~60 route directories; `src/components/ui/` primitives, `src/components/admin/ResourceFormModal.tsx`.
- `src/utils/` — `database.js`, `api-permissions.js`, `permissions.js`/`rbac.js`, `session.ts`, `activity-logger.ts`, `schema-cache.js`, `payroll-calculator.js`.
- `src/lib/` — `money.ts`, `format.js`, `api-client.js`, `cn.js`.
- `src/context/SessionContext.jsx` (`useSession()/can()`), `src/hooks/` (`useActivityTracker.js` delta heartbeat every 120s → `user_screen_time`).
- `src/__tests__/` — 85 Vitest suites mirroring `src/`; `migrations/` (knex ESM); `scripts/` (seeding/diagnostics); `docs/SECURITY_AUDIT.md`.

## Testing Notes

- Vitest `jsdom`, `globals: true`, `setupFiles: vitest.setup.ts` (`@testing-library/jest-dom`), include `src/__tests__/**/*.test.{js,jsx,ts,tsx}`, alias `@` → `src` (`vitest.config.ts:1`).
- **Mock hoisting**: `vi.mock('@/utils/database', ...)` and `vi.mock('@/utils/api-permissions', ...)` must be defined _before_ dynamic `await import('@/app/api/.../route')` in tests. DB mocks return tuple `[rows, fields]` via `mockExecute`; params wrapped as `Promise.resolve({ id: '1' })` for Next 15.
- Component tests wrap with `QueryClientProvider` (`retry:false gcTime:0`), mock `next/navigation` (`useRouter/useParams`).
- No integration DB needed — all API tests are mocked. `money.test.ts` checks `add(0.1,0.2) === 0.3`; payroll tests assert `total_earnings - total_deductions === net_pay`.

## Env & Migrations

- `knexfile.js` branches on `NODE_ENV` → `DEV_DB_*` / `STAGING_DB_*` / `PROD_DB_*` (plus `DB_HOST`/`DB_PORT`). Migrations are ESM `up(knex)/down(knex)` in `migrations/`.
- `.env` is gitignored; `src/utils/database.js:1` does `dotenv.config()` for scripts. Production `connectionLimit` stays `5` (below MySQL `max_user_connections`).
