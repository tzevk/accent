# Accent CRM — Agent Guide

- Follow YAGNI and DRY.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Communicating with the user

Applies whenever you write to the user: status updates, summaries, explanations, and questions.

### Writing style

Use simplified technical English, about 80% of ASD-STE100.

- One idea per sentence. Keep sentences under 20 words.
- Use active voice and present tense.
- Use one word for one meaning. Do not swap synonyms for variety.
- Use plain, common words. Keep articles (a, the).
- Define a technical term the first time you use it.
- Keep paragraphs to 6 sentences or fewer.
- Put the most important information first.

### Asking questions

- Ask only when you cannot proceed safely or correctly without the answer.
  Otherwise, make a reasonable assumption and state it.
- Ask one question at a time. Make it specific and answerable in a few words.
- Give 2-3 concrete options and say which one you recommend and why.
- State what you already tried or checked, so the user does not repeat it.
- Say what changes depending on the answer.

### Reporting results

- Say what you did, why, and what you are unsure about.
- Do not only report that the task is done.

> Next.js 16 App Router (Turbopack default) + React 19 + MySQL. Keep this file compact — every line should be something an agent would miss without help.

## Stack & Runtime

- Node `24.x` declared in `engines` (not engine-enforced); `npm` + `package-lock.json` v3; pure ESM (`"type": "module"` — all migrations too).
- MySQL via a `mysql2/promise` pool (`src/utils/database.js`) + Knex migrations (`migrations/`, 31 files: 1 baseline + 30 incremental).
- Tailwind CSS v4 CSS-first (`@import 'tailwindcss'` in `src/app/globals.css`); no `tailwind.config.js` — `postcss.config.mjs` is just `['@tailwindcss/postcss']`. Use `cn()` from `src/lib/cn.js`.
- Mixed JS/TS codebase; **strict TypeScript (`strict: true`) required for all new files** (`allowJs: true`, `noImplicitAny: false`, `@/*` → `src/*`, target `ES2017`, `moduleResolution: bundler`).

## Commands

- Dev: `npm run dev` (Turbopack default). Build/Start: `npm run build` (strict) then `npm run start`.
- Lint: `npm run lint` (ESLint 9 flat, `src` + `scripts` only). Format: `npm run format` (Prettier: tabs, width 2, single-quote); pre-commit runs `lint-staged: prettier --write` via Husky v9.
- Typecheck: `npx tsc --noEmit` (no npm script).
- Test (watch) `npm test`; Test (once) `npm run test:run`; Coverage `npm run test:coverage`; single file `npx vitest run src/lib/money.test.ts`; single name `npx vitest run -t "ensurePermission"`. `npm run verify` = `lint` + `tsc --noEmit` + `test:run` — the one command a subagent runs.
- Migrations: `npm run migrate` / `migrate:status` / `migrate:rollback` / `migrate:make -- <name>` — prod DB: `migrate:prod` (+ `:status` / `:rollback`); plain `npm run migrate` targets **dev** only.
- Order that matters: `npm run verify` before pushing; `npm run build:prod` is the final gate (plain `npm run build` inherits `NODE_ENV=development` from `.env` and fails static prerendering).

## Architecture Gotchas

- **Auth split**: `src/proxy.ts` (Next 16 renamed `middleware`; runs on the Node.js runtime) validates the `session` cookie against MySQL before routing — SHA-256 token hash → `sessions JOIN users`, active + `isDelete = 0`, via `src/utils/session-probe.ts`; own proxy-local pool, 60 s per-instance cache, DB error → cached-if-fresh else deny — and rate-limits. Handlers still authorize every request via `getCurrentUser(request)` / `getServerAuth()` / `ensurePermission()`: `getCurrentUser` and `ensurePermission` live in `src/utils/api-permissions.js` and hash the token with SHA-256, querying `sessions JOIN users LEFT JOIN roles_master LEFT JOIN employees` where `expires_at > NOW()` and `u.isDelete = 0`; cached 60 s (`userCache` + `pendingUserFetches` dedup), invalidated via `invalidateUserCache(userId)`. `getServerAuth` lives in `src/utils/server-auth.js`.
  - Login (`/api/login`) creates a 256-bit token (`crypto.randomBytes(32)`), stores `token_hash`, 30-day expiry, HttpOnly `SameSite=Lax` cookie. Logout calls `revokeSession`; password change calls `revokeAllUserSessions`.
  - Public endpoints are an exact-match allowlist (ADR-0014): `/signin`, `/api/login`, `/api/logout`, `/api/session`, `/api/attendance/webhook` (Bearer auth inside handler), `/api/health` (`{status:'ok'}` only) + static assets; prefix matching applies to assets only; adding an endpoint requires an ADR-0014 line + the CI route guard's allowlist.
- **Rate limits** (`src/proxy.ts`): `auth` 10/15m and `heavy` (download/export/bulk) 10/m count in MySQL fixed windows (`rate_limit_buckets`, shared across instances, `Retry-After` = window end); `session` 120/m, `dashboard` 60/m, `api` 120/m stay in-memory. Identity is the platform-set IP header (`x-vercel-forwarded-for`; never client `x-forwarded-for`) + validated-session token hash, per category.
- **Route auth invariant**: `npm run check:route-auth` (CI `checks.yml`) fails any exported handler in `src/app/api/**/route.{js,ts}` without `getCurrentUser|getServerAuth|ensurePermission` or a reasoned allowlist entry (public-by-design, delegating forwarders).
- **RBAC** (`src/utils/permissions.js`, `src/utils/rbac.js`): two structures merged via `mergePermissions` (set union). Flat `resource:action` strings in `roles_master.permissions` + `users.permissions` → `user.merged_permissions`; field-level `users.field_permissions.modules[resource].crud[action]` (`'hidden'|'view'|'edit'`) is pruned by `stripDisabledModules()`. A truthy `is_super_admin` bypasses all checks. Hierarchy guard `canModifyTargetUser` prevents non-super-admin from touching a super-admin or equal/higher `role_hierarchy`. API guard pattern: `const auth = await ensurePermission(req, RESOURCES.PROJECTS, PERMISSIONS.READ); if (auth instanceof Response) return auth;`
- **DB pool** (`src/utils/database.js`): `globalThis.__dbPool` singleton, `connectionLimit: 5` (`queueLimit: 200`, `maxIdle: 2`, `dateStrings: true`). Use `query()` (single), `withDb(cb)` (multi/transaction), or `dbConnect()` + `finally release()`. Never `mysql.createConnection` in routes. Never `CREATE/ALTER/SHOW` in routes — use Knex migrations or `hasColumn(db, table, col)` from `src/utils/schema-cache.js` (10 m TTL).
- **Soft-delete**: `isDelete TINYINT(1) DEFAULT 0` on operational tables — some tables are excluded (see `docs/explanations/DDL_AND_SOFT_DELETE_AUDIT.md`). Every `SELECT/JOIN/UPDATE` must include `WHERE isDelete = 0`. Invoice/document/expense/voucher numbers use a generated column `IF(isDelete=0, col, NULL) STORED` + unique index on it; `outgoing_quotations` numbers instead use composite `UNIQUE(quotation_number, isDelete)`.
- **Money** (`src/lib/money.ts`): never `parseFloat`/`+`/`-`/`*`/`/` for billing/salary. Use `R`, `add`, `sub`, `mul`, `div`, `pctOf`, `roundR`, `gte`, `gt`, `isZero`, `toNumber` (Decimal.js, precision 20, `ROUND_HALF_UP`). Convert to number only at the DB/JSON boundary.
- **Payroll pay formula** (ADR-0010): Gross = **Hourly Rate × Logged Hours**. Hourly Rate = CTC ÷ **Basis Hours**, with CTC from `employee_salary_profile` as `employer_cost` → `gross_salary` → `gross`; Basis Hours = month's working days from `getWorkingDaysForMonth` × profile `std_hours_per_day`; Logged Hours = the month's `user_activity_assignments.daily_entries` hours. Hours alone decide pay — attendance OT and LOP never add or subtract money, and no reader re-prorates a slip for absences. HR/admin flow: `docs/app/payroll/operator-guide.md`.

## Conventions That Break If Guessed

- **Formatting** (`src/lib/format.js`): use `formatCurrency`/`formatNumber`/`formatDate`/`formatDateTime`/`formatDateInput` (plus `formatDateNumeric`/`formatMonth`) — `en-IN`; returns `"—"` on null/NaN, except `formatDateInput` (returns `''` on falsy/invalid). Never write local formatters.
- **Styling tokens**: sidebar `var(--sidebar-bg)` (`globals.css:67`, `#4d025b`), primary button `bg-[#64126D]` `hover:bg-[#52105a]`, accent `#7F2487`/`#86288F`. Badges: canonical map in `src/components/EmployeeHub.tsx` (`draft` slate, `pending` amber/yellow, `approved/paid/completed` green, `rejected/overdue` red, `active/sent` blue, `on hold` orange) — per-page tones vary (expenses pages use sky/emerald/rose). `globals.css:316-319` forces `input,textarea,select { color:#000 !important }` — don't override to gray.
- **Data fetching**: TanStack Query (`QueryProvider` `staleTime:30s retry:1 refetchOnWindowFocus:false`) + `apiGet`/`apiPost`/`apiPut`/`apiDelete` (wrapping `apiSend`) from `src/lib/api-client.js`. Admin forms via `ResourceFormModal.tsx` (TanStack Form + manual Zod `safeParse`; submits via `apiPost`/`apiPut`).
- **Uploads** (`next.config.ts:114-117`): `/uploads/*` served with `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment`; content is server-rasterized PNGs (`src/app/api/uploads/route.js`).
- **Heavy packages** excluded from bundling (`next.config.ts:14` `serverExternalPackages`: `mysql2`, `sharp`, `exceljs`, `jspdf`, `@react-pdf/renderer`, `html2canvas`, `docxtemplater`, `pizzip`).

## Project Layout (where to look)

- `src/app/` — App Router; mixed `.tsx`/`.jsx` — modern `.tsx` under `reports/`, `masters/deliverables/`, `user/payslips`, `user/leaves`, `employees/leaves`, `projects/[id]/edit/tabs/`; legacy `.jsx` elsewhere (`admin/` is majority `.jsx`).
- `src/app/api/` — 47 top-level route dirs, 200+ route files; `src/components/ui/` primitives, `src/components/admin/ResourceFormModal.tsx`.
- `src/utils/` — `database.js`, `api-permissions.js`, `permissions.js`/`rbac.js`, `session.ts`, `activity-logger.ts`, `schema-cache.js`, `payroll-calculator.js`.
- `src/lib/` — `money.ts`, `format.js`, `api-client.js`, `cn.js`.
- `src/context/SessionContext.jsx` (`useSession()/can()`), `src/hooks/` (`useActivityTracker.js` delta heartbeat every 120s → `user_screen_time`).
- Tests are colocated: `<module>.test.*` sits beside the module/route/page it covers (`src/**/*.test.*`) — there is no central test tree. `migrations/` (knex ESM); `scripts/` (ops + diagnostics: `check-route-auth`, `security:preflight`, `security:poc-reruns`, `security:scrub`, seeding); `docs/SECURITY_AUDIT.md`.

## Testing Notes

### Layers, cheapest first

- **Pure logic** (27 suites) — no DB, no network, no `fetch`. Write them _before_ the implementation, and only after enumerating the failure modes.
- **Component render tests** (9 suites, React Testing Library over jsdom) — the default for dashboard and UI behaviour. Render the real component with real payload shapes, query by role or label, assert the accessible name, the focus stop, the empty state. No route handler is faked and no source is pinned: the rendered DOM is the evidence.
- **Route tests** (38 suites, mock `@/utils/database`) — API contract, status codes, authorization decisions.
- **E2E (Playwright)** — **critical user journeys only**: sign-in, one representative CRUD flow, one financial flow. Runs on GitHub Actions. A ticket that touches no critical journey ships with no E2E spec.

Before writing a test at a higher layer, ask whether a lower one can hold the assertion. If it can, write it there. A spec file over 200 lines means the coverage belongs at a lower layer, and a second spec for the same feature area means it should move down.

### When a browser spec is written

- State the behaviour and why a browser is needed before writing any code.
- One behaviour per test. An omnibus test has many reasons to fail and hides which one broke.
- Select by `getByRole` / `getByLabel` / `data-testid`. A selector that breaks when the UI is restyled without a behaviour change is the wrong selector.
- Namespace data per run (`E2E-<issue>-` + a suffix) and clean it in `afterAll`.
- Assert what the API returns **and** what landed in the database with an independent client, so a mock cannot hide a broken write.

### Subagent and CI rules

- Subagents run `npm run verify`. They do **not** run `next build`, `tsc --noEmit` alone, `playwright test`, or `npm run e2e`. A failing `verify` is the subagent's only signal; E2E is never it.
- Subagents do **not** start a dev server. The orchestrator starts one shared server and exports `E2E_BASE_URL` if a browser run is ever genuinely required.
- **E2E runs on GitHub Actions only.** The full suite is a merge gate on the integration tip, not a per-ticket check. A PR carries at most the smoke spec.
- `git merge` is a shell command, not a delegated task. The orchestrator performs merges.

### Forbidden

- `test.describe.configure({ mode: 'serial' })` or `fullyParallel: false` — tests that must run in order are one test.
- `page.waitForTimeout(...)` — wait on a locator assertion or a response instead.
- Hardcoded or shared test data.
- A committed route, page, or component test that mocks its own dependencies and asserts the mock answered.

### Status

No browser harness is committed. The old 41 specs, the fixture modules, `playwright.config.ts`, the bootstrap script, and the E2E workflow were removed on 2026-10-10 and sit at tag `e2e-v1`; `docs/explanations/E2E_HARNESS_REMOVAL.md` records that. Route and page behaviour has no committed proof until a harness lands — an open gap, not licence for mock-echo tests.

- Automated coverage is the vitest suites beside the code: money/Decimal (`money`, payroll per ADR-0010), leave/date/sandwich/week-off math, payroll config & statutory math, RBAC/authz decisions (sec04/05/07), sanitization, Punch/Time-Present math, and report data-source aggregation. Keep them green; extend only in kind.
- Config: Vitest `jsdom`, `globals: true`, `setupFiles: vitest.setup.ts` (`@testing-library/jest-dom`), include `src/**/*.test.{js,jsx,ts,tsx}` (colocated), alias `@` → `src` (`vitest.config.ts`); run once with `npm run test:run`.
- The surviving payroll API suites mock `@/utils/database` + dynamic `await import` of the route (mock-hoisting order matters; DB mocks return `[rows, fields]`). Shared helpers: `src/app/api/payroll/{test-perms,audit-rows}.ts`.
- The Attendance report's page-decision suites (cell-status/roster/unmapped-codes) were deleted with #288 and are not to be recreated. Their behaviour used to be proven by `e2e/specs/attendance-report.spec.ts`, which no longer exists (tag `e2e-v1`).

## Env & Migrations

- `knexfile.js` branches on `NODE_ENV` → `DEV_DB_*` / `STAGING_DB_*` / `PROD_DB_*`, plus a shared `DB_HOST`; `DB_PORT` is read by the app/proxy pools and scripts, but not by `knexfile.js`. Migrations are ESM `up(knex)/down(knex)` in `migrations/`.
- `.env` is gitignored; `src/utils/database.js` runs `dotenv.config()` for scripts. Production `connectionLimit` stays `5` (below MySQL `max_user_connections`).

## Agent skills

- Issue tracker: GitHub issues via the `gh` CLI → `docs/agents/issue-tracker.md`.
- Triage labels: five canonical roles mapped 1:1 → `docs/agents/triage-labels.md`.
- Domain docs: single-context (`GLOSSARY.md` + `docs/adr/` at root) → `docs/agents/domain.md`.
