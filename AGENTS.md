# Accent CRM — Agent Guide

YAGNI, DRY, best practices. **E2E is the verification mechanism**: never write unit tests after writing code; to test a system in isolation, enumerate its failure modes first, then code. Every E2E run leaves a repeatable artifact.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

> Next.js 16 App Router (Turbopack default) + React 19 + MySQL. Keep this file compact — every line should be something an agent would miss without help.

## Stack & Runtime

- Node `24.x` (`engines`), `npm` + lockfile v3, pure ESM (`"type": "module"` — migrations too).
- MySQL via `mysql2/promise` pool (`src/utils/database.js`); Knex migrations in `migrations/`.
- Tailwind v4 CSS-first (`@import 'tailwindcss'` in `src/app/globals.css`), no config file. Class merging: `cn()` from `src/lib/cn.js`.
- Mixed JS/TS; **new files must be strict TS** (`strict: true`, `@/*` → `src/*`, target `ES2017`, `moduleResolution: bundler`).

## Commands

| Task          | Command                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev           | `npm run dev`                                                                                                                                  |
| Build / Start | `npm run build` (strict) then `npm run start`                                                                                                  |
| Lint          | `npm run lint` (ESLint 9 flat, `src` + `scripts`)                                                                                              |
| Format        | `npm run format` (Prettier: tabs, width 2, single-quote) — pre-commit via lint-staged/Husky                                                    |
| Typecheck     | `npx tsc --noEmit` (no npm script)                                                                                                             |
| Tests         | `npm test` (watch) · `npm run test:run` · `npm run test:coverage` · `npx vitest run <file>` · `npx vitest run -t "<name>"`                     |
| E2E           | `npm run e2e` (bootstraps DB, prod build, Playwright; artifacts in `e2e/artifacts/`) · `e2e:test` reuses the last build · `e2e:ui` interactive |
| Migrations    | `npm run migrate` / `:status` / `:rollback` / `migrate:make -- <name>`; `migrate:prod` for prod                                                |

Push order: `lint` → `npx tsc --noEmit` → `npm run test:run`, then `npm run build:e2e` as the final gate (plain `build` inherits `NODE_ENV=development` from `.env` and fails static prerendering).

## Architecture Gotchas

- **Auth is two layers.** `src/proxy.ts` (Next 16's renamed `middleware`, Node runtime) validates the `session` cookie before routing — SHA-256 token hash → `sessions JOIN users` (active, `isDelete = 0`) via `src/utils/session-probe.js`; own pool, 60 s per-instance cache, DB error → cached-if-fresh else deny. Every handler still authorizes itself via `getCurrentUser(request)` / `getServerAuth()` / `ensurePermission()` (`src/utils/api-permissions.js`), also 60 s-cached; invalidate with `invalidateUserCache(userId)`.
- Login (`/api/login`) mints a 256-bit `crypto.randomBytes(32)` token, stores `token_hash` with a 30-day expiry in an HttpOnly `SameSite=Lax` cookie. Logout → `revokeSession`; password change → `revokeAllUserSessions`.
- Public endpoints are an **exact-match** allowlist (ADR-0014): `/signin`, `/api/login`, `/api/logout`, `/api/session`, `/api/attendance/webhook` (Bearer auth inside the handler), `/api/health` (`{status:'ok'}` only), plus static assets. Only assets match by prefix; a new public endpoint needs an ADR-0014 line **and** an entry in the CI route guard's allowlist.
- **Rate limits** (`src/proxy.ts`): `auth` 10/15m and `heavy` (download/export/bulk) 10/m persist in MySQL fixed windows (`rate_limit_buckets`, shared across instances, `Retry-After` = window end); `session` 120/m, `dashboard` 60/m, `api` 120/m are in-memory. Identity = platform-set IP header (`x-vercel-forwarded-for`, never the client's `x-forwarded-for`) + validated token hash, per category.
- `npm run check:route-auth` (CI `checks.yml`) fails any exported `src/app/api/**/route.{js,ts}` handler lacking `getCurrentUser|getServerAuth|ensurePermission`, unless allowlisted with a reason (public-by-design, delegating forwarder).
- **RBAC** (`src/utils/permissions.js`, `src/utils/rbac.js`) merges two structures via `mergePermissions` (set union):
  - Flat `resource:action` strings in `roles_master.permissions` + `users.permissions` → `user.merged_permissions`.
  - Field-level `users.field_permissions.modules[resource].crud[action]` (`'hidden'|'view'|'edit'`), pruned by `stripDisabledModules()`.
  - `super_admin === 1` bypasses everything; `canModifyTargetUser` blocks non-super-admins from touching super-admins or equal/higher `role_hierarchy`.
  - Guard pattern: `const auth = await ensurePermission(req, RESOURCES.PROJECTS, PERMISSIONS.READ); if (auth instanceof Response) return auth;`
- **DB pool** (`src/utils/database.js:1`): `globalThis.__dbPool` singleton, `connectionLimit: 5`, `dateStrings: true`. Use `query()` (single) / `withDb(cb)` (multi or transaction) / `dbConnect()` + `finally release()` — never `mysql.createConnection` in routes. Never `CREATE/ALTER/SHOW` in routes either: Knex migrations, or `hasColumn(db, table, col)` from `src/utils/schema-cache.js` (10 m TTL).
- **Soft delete**: `isDelete TINYINT(1) DEFAULT 0` on all operational tables; every `SELECT/JOIN/UPDATE` needs `WHERE isDelete = 0`. Unique numbers (invoice/quotation) use a stored generated column `IF(isDelete=0, col, NULL)` plus a unique index on it.
- **Money** (`src/lib/money.ts`): never `parseFloat`/`+`/`-`/`*`/`/` on billing or salary figures. Use `R`, `add`, `sub`, `mul`, `div`, `pctOf`, `roundR`, `gte`, `isZero`, `toNumber` (Decimal.js, precision 20, `ROUND_HALF_UP`); convert to number only at the DB/JSON boundary.
- **Payroll formula** (ADR-0010): Gross = **Hourly Rate × Logged Hours**. Hourly Rate = CTC (`employee_salary_profile.employer_cost`) ÷ Basis Hours (month's working days from `getWorkingDaysForMonth` × `std_hours_per_day`); Logged Hours = that month's `user_activity_assignments.daily_entries` hours. Hours alone decide pay — attendance OT and LOP never move money and no reader re-prorates a slip for absences. Flow: `docs/app/payroll/operator-guide.md`.

## Conventions That Break If Guessed

- Formatting (`src/lib/format.js`): `formatCurrency`/`formatNumber`/`formatDate`/`formatDateTime`/`formatDateInput`, `en-IN`, `"—"` on null/NaN. Don't hand-roll formatters.
- Data fetching: TanStack Query (`QueryProvider` `staleTime:30s retry:1 refetchOnWindowFocus:false`) + `apiGet/apiPost/apiPut/apiDelete` from `src/lib/api-client.js`; admin forms via `src/components/admin/ResourceFormModal.tsx` (TanStack Form + Zod).
- Tokens: sidebar `bg-[#4d025b]` / `var(--sidebar-bg)`, primary button `bg-[#64126D]` `hover:bg-[#52105a]`, accent `#7F2487`/`#86288F`. Badges: `draft` slate, `pending` amber, `approved/paid/completed` green, `rejected/overdue` red, `active/sent` blue, `on hold` orange. `globals.css:316` forces `input,textarea,select { color:#000 !important }` — don't make them gray.
- No `tailwind.config.js`; `postcss.config.mjs` is just `['@tailwindcss/postcss']`.
- Uploads (`next.config.ts:38`): `/uploads/*` served with `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment`; content is server-rasterized PNGs.
- `serverExternalPackages` (`next.config.ts:14`): `mysql2`, `sharp`, `exceljs`, `jspdf`, `@react-pdf/renderer`, `html2canvas`, `docxtemplater`, `pizzip`.
- Env: `.env` is gitignored; `knexfile.js` branches on `NODE_ENV` → `DEV_DB_*` / `STAGING_DB_*` / `PROD_DB_*` (+ `DB_HOST`/`DB_PORT`), and migrations are ESM `up(knex)/down(knex)`. `src/utils/database.js:1` runs `dotenv.config()` for scripts; prod keeps `connectionLimit: 5` (below `max_user_connections`).

## Project Layout (where to look)

- `src/app/` — App Router; modern `.tsx` in `admin/`, `reports/`, `masters/deliverables/`; legacy `.jsx` elsewhere. `src/app/api/` holds the route handlers.
- `src/utils/` — `database.js`, `api-permissions.js`, `permissions.js`/`rbac.js`, `session.ts`, `activity-logger.ts`, `schema-cache.js`, `payroll-calculator.js`.
- `src/lib/` — `money.ts`, `format.js`, `api-client.js`, `cn.js`. `src/context/SessionContext.jsx` (`useSession()`/`can()`); `src/hooks/useActivityTracker.js` (120 s delta heartbeat → `user_screen_time`).
- Tests are colocated (`<module>.test.*` beside what it covers, `src/**/*.test.*`); `e2e/` is the Playwright harness, `migrations/` knex ESM, `scripts/` seeding/diagnostics, `docs/SECURITY_AUDIT.md`.

## Testing

- **E2E is the default verification.** `e2e/` bootstraps the DB, builds, boots `next start` against a real database and drives browser + API flows; every spec writes `e2e/artifacts/<flow>.json` (CI uploads them plus the HTML report). Verify features here instead of adding unit tests.
- Specs assert both the API response **and** the rows that landed in the database (own `mysql2` client, `e2e/lib/db.ts`), so mocks can't hide a broken write.
- Fixtures are namespaced and reseeded each run (`e2e_*` users, `E2E-EMP-*` employees, `E2E Deliverable *`, pay month 2019-01) via `e2e/lib/fixtures.ts`; global setup refuses to run if that month's payroll run exists, so real payroll data is never touched. Uses the dev DB locally; set `E2E_DB_NAME` for a dedicated one (CI does).
- **Never add route-handler, page, or component tests** — mock-echo, render-smoke, source/route-tree pins and duplicated CRUD templates were purged on 2026-09-27. Add E2E coverage.
- The surviving unit suites are frozen pure-logic checks — money/Decimal, leave/date/sandwich/week-off math, payroll config & statutory math, RBAC/authz decisions (sec04/05/07), sanitization, report data-source aggregation. Keep them green; don't extend in kind. Config: Vitest `jsdom`, `globals: true`, `setupFiles: vitest.setup.ts`, alias `@` → `src` (`vitest.config.ts:1`).
- Surviving payroll API suites mock `@/utils/database` and dynamically `await import` the route (mock hoisting order matters; DB mocks return `[rows, fields]`); shared helpers in `src/app/api/payroll/{test-perms,audit-rows}.ts`.

## Agent skills

- Issues are GitHub issues (`gh`) — `docs/agents/issue-tracker.md`.
- Five canonical triage labels — `docs/agents/triage-labels.md`.
- Single-context domain docs (`CONTEXT.md` + `docs/adr/`) — `docs/agents/domain.md`.
