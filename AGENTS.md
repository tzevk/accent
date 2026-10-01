# Accent CRM — Agent Guide

- Follow YAGNI rules, DRY use best principles.
- NEVER write unit tests after you write code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, FIRST write all the ways it could fail, THEN write the code.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

> Next.js 16 App Router (Turbopack default) + React 19 + MySQL. Keep this file compact — every line should be something an agent would miss without help.

## Stack & Runtime

- Node `24.x` (enforced via `engines`), `npm` + `package-lock.json` v3, pure ESM (`"type": "module"` — all migrations too).
- MySQL via `mysql2/promise` pool (`src/utils/database.js`) + Knex migrations (`migrations/`, 1 baseline + 17 incremental).
- Tailwind CSS v4 CSS-first (`@import 'tailwindcss'` in `src/app/globals.css`) — no `tailwind.config.js`. Use `cn()` from `src/lib/cn.js`.
- Mixed JS/TS codebase; **strict TypeScript (`strict: true`) required for all new files** (`allowJs: true`, `noImplicitAny: false`, `@/*` → `src/*`, target `ES2017`, `moduleResolution: bundler`).

## Commands

| Task          | Command                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev           | `npm run dev` (Turbopack is the default bundler in Next 16)                                                                                                                              |
| Build / Start | `npm run build` (strict) then `npm run start`                                                                                                                                            |
| Lint          | `npm run lint` (ESLint 9 flat, `src` + `scripts` only)                                                                                                                                   |
| Format        | `npm run format` (Prettier: tabs, width 2, single-quote) — pre-commit runs `lint-staged: prettier --write` via Husky v9                                                                  |
| Typecheck     | `npx tsc --noEmit` (no npm script)                                                                                                                                                       |
| Test (watch)  | `npm test`                                                                                                                                                                               |
| Test (once)   | `npm run test:run`                                                                                                                                                                       |
| Coverage      | `npm run test:coverage`                                                                                                                                                                  |
| Single file   | `npx vitest run src/lib/money.test.ts`                                                                                                                                                   |
| Single name   | `npx vitest run -t "ensurePermission"`                                                                                                                                                   |
| E2E (full)    | `npm run e2e` — bootstraps the E2E DB, production build, then Playwright; artifacts land in `e2e/artifacts/`                                                                             |
| E2E (tests)   | `npm run e2e:test` (reuses the last build; needs `npm run build:e2e` at least once); `npm run e2e:ui` for the interactive runner                                                         |
| Migrations    | `npm run migrate` / `migrate:status` / `migrate:rollback` / `migrate:make -- <name>` — prod DB: `migrate:prod` (+ `:status` / `:rollback`); plain `npm run migrate` targets **dev** only |

Order that matters: `lint` → `npx tsc --noEmit` → `npm run test:run` before pushing; `npm run build:e2e` is the final gate (plain `npm run build` inherits `NODE_ENV=development` from `.env` and fails static prerendering).

## Architecture Gotchas

- **Auth split**: `src/proxy.ts` (Next 16 renamed `middleware`; runs on Node.js runtime) validates the `session` cookie against MySQL before routing (SHA-256 token hash → `sessions JOIN users`, active + `isDelete = 0`, via `src/utils/session-probe.js`; own proxy-local pool, 60 s per-instance cache, DB error → cached-if-fresh else deny) and rate-limits. Handlers still authorize every request via `getCurrentUser(request)` / `getServerAuth()` / `ensurePermission()` in `src/utils/api-permissions.js` — hashes token with SHA-256 and queries `sessions JOIN users LEFT JOIN roles_master LEFT JOIN employees` where `expires_at > NOW()` and `u.isDelete = 0`. Cached 60 s (`userCache` + `pendingUserFetches` dedup); invalidate via `invalidateUserCache(userId)`.
  - Login (`/api/login`) creates 256-bit token (`crypto.randomBytes(32)`), stores `token_hash`, 30-day expiry, HttpOnly `SameSite=Lax` cookie. Logout calls `revokeSession`; password change calls `revokeAllUserSessions`.
  - Public endpoints are an exact-match allowlist (ADR-0014): `/signin`, `/api/login`, `/api/logout`, `/api/session`, `/api/attendance/webhook` (Bearer auth inside handler), `/api/health` (`{status:'ok'}` only) + static assets. Prefix matching applies to assets only; adding an endpoint requires an ADR-0014 line + the CI route guard's allowlist.

- **Rate limits** (`src/proxy.ts`): `auth` 10/15m and `heavy` (download/export/bulk) 10/m count in MySQL fixed windows (`rate_limit_buckets`, shared across instances, `Retry-After` = window end); `session` 120/m, `dashboard` 60/m, `api` 120/m stay in-memory. Identity is the platform-set IP header (`x-vercel-forwarded-for`; never client `x-forwarded-for`) + validated-session token hash, per category.

- **Route auth invariant**: `npm run check:route-auth` (CI `checks.yml`) fails any exported handler in `src/app/api/**/route.{js,ts}` without `getCurrentUser|getServerAuth|ensurePermission` or a reasoned allowlist entry (public-by-design, delegating forwarders).

- **RBAC** (`src/utils/permissions.js`, `src/utils/rbac.js`): two structures merged via `mergePermissions` (set union).
  - Flat `resource:action` strings in `roles_master.permissions` + `users.permissions` → `user.merged_permissions`.
  - Field-level `users.field_permissions.modules[resource].crud[action]` (`'hidden'|'view'|'edit'`), pruned by `stripDisabledModules()`. `super_admin === 1` bypasses all. Hierarchy guard `canModifyTargetUser` prevents non-super-admin from touching super-admin or equal/higher `role_hierarchy`.
  - API guard pattern: `const auth = await ensurePermission(req, RESOURCES.PROJECTS, PERMISSIONS.READ); if (auth instanceof Response) return auth;`

- **DB pool** (`src/utils/database.js:1`): `globalThis.__dbPool` singleton, `connectionLimit: 5` (`queueLimit: 200`, `maxIdle: 2`, `dateStrings: true`). Use `query()` (single), `withDb(cb)` (multi/transaction), or `dbConnect()` + `finally release()`. Never `mysql.createConnection` in routes. Never `CREATE/ALTER/SHOW` in routes — use Knex migrations or `hasColumn(db, table, col)` from `src/utils/schema-cache.js` (10 m TTL).

- **Soft-delete**: `isDelete TINYINT(1) DEFAULT 0` on all operational tables. Every `SELECT/JOIN/UPDATE` must include `WHERE isDelete = 0`. Unique numbers (invoice/quotation) use generated column `IF(isDelete=0, col, NULL) STORED` + unique index on it.

- **Money** (`src/lib/money.ts`): never `parseFloat`/`+`/`-`/`*`/`/` for billing/salary. Use `R`, `add`, `sub`, `mul`, `div`, `pctOf`, `roundR`, `gte`, `isZero`, `toNumber` (Decimal.js, precision 20, `ROUND_HALF_UP`). Convert to number only at DB/JSON boundary.

- **Payroll pay formula** (ADR-0010): Gross = **Hourly Rate × Logged Hours**. Hourly Rate = CTC (`employee_salary_profile.employer_cost`) ÷ **Basis Hours** (month's working days from `getWorkingDaysForMonth` × profile `std_hours_per_day`); Logged Hours = the month's `user_activity_assignments.daily_entries` hours. Hours alone decide pay — attendance OT and LOP never add or subtract money, and no reader re-prorates a slip for absences. HR/admin flow: `docs/app/payroll/operator-guide.md`.

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
- Tests are colocated: `<module>.test.*` sits beside the module/route/page it covers (`src/**/*.test.*`) — there is no central test tree. `e2e/` — Playwright E2E harness (`npm run e2e`); `migrations/` (knex ESM); `scripts/` (seeding/diagnostics); `docs/SECURITY_AUDIT.md`.

## Testing Notes

- **Unit tests are the exception, not the default.** Only write them _before_ the code, for systems tested in isolation whose failure modes you enumerate first; NEVER write unit tests after the fact (verify with E2E instead).
- **Never add route-handler, page, or component tests.** Mock-echo tests (stubbed DB rows flowing back out, mocks-called assertions), render smoke, source/route-tree pins, and duplicated CRUD templates were purged on 2026-09-27 — do not recreate them; add E2E coverage instead.
- **E2E is the default verification**: drive the real app + DB and leave a rerunnable artifact. The committed harness is `e2e/` (Playwright): `npm run e2e` bootstraps the DB, builds, boots `next start` on the real database and drives browser + API flows; every spec writes `e2e/artifacts/<flow>.json` (CI uploads artifacts + the HTML report). Verify new features here — do not add unit tests instead.
- E2E data stays out of everyone's way: fixtures are namespaced (`e2e_*` users, `E2E-EMP-*` employees, `E2E Deliverable *`, pay month 2019-01) and purged/reseeded by `e2e/lib/fixtures.ts` on every run; global setup refuses to run if that month's payroll run already exists, so real payroll data is never touched. Locally it uses the dev DB; set `E2E_DB_NAME` to target a dedicated database (CI does).
- Specs assert what the API returns **and** what landed in the database (their own `mysql2` client in `e2e/lib/db.ts`), so mocks can't hide a broken write.
- The 73 surviving suites are frozen pure-logic checks: money/Decimal (`money`, payroll per ADR-0010), leave/date/sandwich/week-off math, payroll config & statutory math, RBAC/authz decisions (sec04/05/07), sanitization, and report data-source aggregation. Keep them green; don't extend in kind.
- Config: Vitest `jsdom`, `globals: true`, `setupFiles: vitest.setup.ts` (`@testing-library/jest-dom`), include `src/**/*.test.{js,jsx,ts,tsx}` (tests are colocated), alias `@` → `src` (`vitest.config.ts:1`); run once with `npm run test:run`.
- Surviving payroll API suites mock `@/utils/database` + dynamic `await import` of the route (mock-hoisting order matters; DB mocks return `[rows, fields]`). Shared helpers: `src/app/api/payroll/{test-perms,audit-rows}.ts`.

## Env & Migrations

- `knexfile.js` branches on `NODE_ENV` → `DEV_DB_*` / `STAGING_DB_*` / `PROD_DB_*` (plus `DB_HOST`/`DB_PORT`). Migrations are ESM `up(knex)/down(knex)` in `migrations/`.
- `.env` is gitignored; `src/utils/database.js:1` does `dotenv.config()` for scripts. Production `connectionLimit` stays `5` (below MySQL `max_user_connections`).

## Agent skills

### Issue tracker

Issues live as GitHub issues (gh CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles mapped 1:1. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context (CONTEXT.md + docs/adr/ at root). See `docs/agents/domain.md`.
