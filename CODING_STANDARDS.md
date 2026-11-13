# Coding standards

This file owns coding, security, data, and testing requirements. Read only sections triggered by the task.

## New files and implementation

**Trigger: adding or changing application code.**

- Write every new code file in strict TypeScript. Follow `strict: true`, even though the repository also contains JavaScript.
- Read the relevant ADR before changing behavior governed by an accepted decision; consult the glossary for domain terms.

## Formatting and presentation

**Trigger: formatting values or changing UI styles.**

- Use `formatCurrency`, `formatNumber`, `formatDate`, `formatDateTime`, `formatDateInput`, `formatDateNumeric`, and `formatMonth` from `src/lib/format.js`. They use `en-IN` conventions.
- Formatting helpers return `"—"` for null or NaN, except `formatDateInput`, which returns `''` for falsy or invalid input.
- Use `cn()` from `src/lib/cn.js` to combine conditional classes.
- Use the existing palette and status conventions. The sidebar uses `var(--sidebar-bg)`; primary buttons use `bg-[#64126D]` and `hover:bg-[#52105a]`; accents include `#7F2487` and `#86288F`.
- Check the canonical badge map in `src/components/EmployeeHub.tsx` before adding status colors. Individual pages may intentionally vary.
- `src/app/globals.css` forces black text on `input`, `textarea`, and `select`; do not override it with gray text.
- The root layout wraps every page in `.content-with-sidebar`, which already reserves the 64px band for the fixed navigation bar. Do not render a second `Sidebar` or a nested `.content-with-sidebar` in a page, and do not add an 80–96px top offset. Start page content with `pt-6` — the 24px offset used by the Projects and Leads pages — so the title sits directly under the navigation bar.

## Client data and forms

**Trigger: fetching client data or building admin forms.**

- Use TanStack Query with shared provider settings (`staleTime: 30s`, `retry: 1`, `refetchOnWindowFocus: false`).
- Use `apiGet`, `apiPost`, `apiPut`, or `apiDelete` from `src/lib/api-client.js` for API requests; these wrap `apiSend`.
- Use `ResourceFormModal.tsx` for admin resource forms. It uses TanStack Form, manual Zod `safeParse`, and `apiPost`/`apiPut`.

## Authentication and security

**Trigger: changing sessions, API routes, authorization, rate limits, or uploaded content.**

- `src/proxy.ts` validates the session cookie before routing. It hashes the token with SHA-256, checks the session and active user, and uses a proxy-local pool and 60-second per-instance cache. On DB errors, it allows a still-fresh cached result; otherwise it denies access.
- Route handlers still authorize each request with `getCurrentUser(request)`, `getServerAuth()`, or `ensurePermission()`. Proxy validation is not handler authorization.
- Handler authorization caches users for 60 seconds. Call `invalidateUserCache(userId)` after changes that affect cached authorization.
- Login creates a random 256-bit token, stores only its hash, and sets an HttpOnly, `SameSite=Lax` cookie with a 30-day expiry. Logout revokes its session; password change revokes all user sessions.
- Public endpoints use the exact allowlist in ADR-0014 and the route-auth guard. Adding one requires updating both. Do not broaden public access with prefix matching; that applies only to static assets.
- Rate limits use platform-set `x-vercel-forwarded-for`, never client-supplied `x-forwarded-for`, together with the validated session token hash. Auth and heavy categories use shared MySQL fixed windows; other categories remain in memory. Preserve limits and storage semantics in `src/proxy.ts`.
- Every exported API route handler must authorize with `getCurrentUser`, `getServerAuth`, or `ensurePermission`, unless a reasoned public-by-design or delegating-forwarder exception is recorded. `npm run check:route-auth` enforces this.
- RBAC merges role and user `resource:action` permissions by set union. Field permissions use `users.field_permissions.modules[resource].crud[action]` values `hidden`, `view`, or `edit`, then `stripDisabledModules()` prunes disabled modules. A truthy `is_super_admin` bypasses checks. `canModifyTargetUser` prevents non-super-admins from changing a super-admin or a user at an equal or higher `role_hierarchy`.
- Preserve the upload boundary: `/uploads/*` responses set `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`; uploaded content is server-rasterized to PNG by `src/app/api/uploads/route.js`.

## Database and data invariants

**Trigger: changing queries, migrations, schemas, pools, or database-backed behavior.**

- Use shared `globalThis.__dbPool` from `src/utils/database.js`: `query()` for one query, `withDb(cb)` for multiple queries or transactions, or `dbConnect()` with `finally` to release a connection. Do not create route-local connections.
- Do not run `CREATE`, `ALTER`, or `SHOW` in route handlers. Use Knex migrations or `hasColumn(db, table, col)` from `src/utils/schema-cache.js` (10-minute cache).
- Keep production pool `connectionLimit` at 5, below MySQL `max_user_connections`.
- Knex selects `DEV_DB_*`, `STAGING_DB_*`, or `PROD_DB_*` by `NODE_ENV` and shares `DB_HOST`. `knexfile.js` reads `DB_PORT` for every branch. The Playwright harness still passes its resolved port directly to the programmatic migration client.
- Operational tables generally use `isDelete TINYINT(1) DEFAULT 0`; exceptions are listed in `docs/explanations/DDL_AND_SOFT_DELETE_AUDIT.md`. Include `isDelete = 0` in every applicable `SELECT`, `JOIN`, and `UPDATE`.
- Invoice, document, expense, and voucher numbers use a generated column based on `IF(isDelete=0, col, NULL) STORED` with a unique index. `outgoing_quotations` instead uses `UNIQUE(quotation_number, isDelete)`.
- Production is MariaDB 10.11.15. Check database-specific SQL behavior against MariaDB, not only MySQL.
- For local runtime work, read [local database operations](docs/agents/local-database.md) before starting or configuring the instance or running the leads integration harness. Use loopback disposable targets only; supply environment variables in the shell and never edit `.env`.

## Money and payroll

**Trigger: changing billing, salary, payroll, timesheets, or employee-cost calculations.**

- Use `src/lib/money.ts` (`R`, `add`, `sub`, `mul`, `div`, `pctOf`, `roundR`, `gte`, `gt`, `isZero`, `toNumber`) for billing and salary. Do not use `parseFloat` or native arithmetic for money. Decimal.js uses precision 20 and `ROUND_HALF_UP`; convert to a number only at the database or JSON boundary.
- Follow ADR-0010: Gross pay = hourly rate × logged hours. Hourly rate = CTC ÷ basis hours. CTC comes from `employee_salary_profile` using `employer_cost`, then `gross_salary`, then `gross`. Basis hours equal the month's working days from `getWorkingDaysForMonth` times profile `std_hours_per_day`. Logged hours come from that month's `user_activity_assignments.daily_entries`.
- Attendance overtime and loss of pay never add or subtract money in this formula. Do not prorate a payslip again for absences. For HR/admin flows, read `docs/app/payroll/operator-guide.md`.

## Testing and verification

**Trigger: adding or changing tests, selecting checks, running a local integration harness, or changing build/test automation.**

- Keep continuous integration (CI) in GitHub Actions for pull requests. Run repository verification and the focused end-to-end (E2E) journey there.
- Use standard GitHub-hosted Ubuntu runners for this public repository. Local commands complement CI; they do not replace it.
- Vercel previews and deployment builds complement CI and remain enabled.
- Prefer the lowest layer that can hold the assertion: pure logic, then component rendering, then route contracts, then browser journeys. Pure logic tests have no DB, network, or `fetch`; write them before implementation after listing failure modes.
- Component tests render the real component with realistic payloads. Query by accessible role or label and assert observable behavior, such as accessible names, focus, and empty states. Do not fake route handlers or pin source text as proof.
- Route tests cover API contracts, status codes, and authorization decisions. Existing route suites may mock the database where needed.
- Use browser tests only for critical journeys: real sign-in, one representative CRUD flow, and one financial flow. A ticket that does not touch a critical journey does not need an E2E spec.
- Before writing a browser test, state the behavior and why a browser is needed. Keep one behavior per test. Select by role, label, or `data-testid`, not styling-sensitive selectors. Namespace data per run (`E2E-<issue>-<run>-<worker>`), keep fixture records tracked by primary key, and clean them in `afterAll`. Assert both the API response and persisted database state using an independent client.
- Move coverage to a lower layer when a browser spec exceeds 200 lines or a feature needs a second spec.
- Do not serialize browser tests or disable parallelism to enforce ordering; combine dependent steps into one test. Do not use `page.waitForTimeout`; wait for a locator assertion or response.
- Never use hardcoded or shared test data. Do not commit route, page, or component tests that mock their own dependencies and only assert that the mock answered.
- The maintained Playwright harness lives in `e2e/` with orchestration in `scripts/e2e/`. It has one Chromium project and one `npm run test:e2e` command. The command creates a unique disposable MariaDB database, runs migrations with the resolved port, seeds through fixture hooks, starts an owned loopback `next dev`, verifies the app actually reads that database, runs the browser spec, and cleans up. Use `npm run test:e2e`; do not run `npx playwright test` directly because it refuses to start without the owned runtime.
- CI runs `npm run verify`, route authorization, leads integration, and `npm run test:e2e` as separate jobs. `npm run test:e2e` remains a separate local command; `npm run verify` intentionally does not run browser tests.
- The runtime refuses non-loopback hosts, database names lacking `integration`, existing databases, operational branch names, MariaDB versions other than 10.11, an unowned app port, and an existing `.next/dev/lock` or `.next/lock`. It pins `DEV_DB_*`, `STAGING_DB_*`, `PROD_DB_*`, `DB_HOST`, and `DB_PORT` for every child process. It never edits `.env`, kills, or attaches to an unowned server.
- Journey fixtures are owned by `e2e/fixtures/hooks.ts`, which exports `seed(context)` and may export `cleanup(context)`. The context exposes the runtime, an independent reader, and the namespaced fixture helper. Fixtures use ordinary application authentication; do not add a test-only bypass, commit credentials, seed a super-admin, or grant `employees:read` to make a projection work.
- Playwright reports, traces, and screenshots go to ignored `e2e/artifacts/`. Capture them on failure and never log passwords, session tokens, or operational Employee data.
- The old 41-spec suite was removed on 2026-10-10 and is archived at tag `e2e-v1`; it is not the new suite's source of truth. [The removal and restoration record](docs/explanations/E2E_HARNESS_REMOVAL.md) explains that history. This is a restored minimal smoke harness, not a return of the old full suite or the old sole-E2E policy.
- Vitest suites live beside code under `src/**/*.test.*`. Harness contracts and safety helpers are tested under `scripts/e2e/**/*.test.ts`. Existing regression coverage includes money and payroll math, leave/date/week-off logic, statutory calculations, RBAC and authorization, sanitization, punch/time-present math, and report data aggregation. Extend coverage in kind; do not recreate deleted Attendance report page-decision suites from #288.
- Payroll API tests mock `@/utils/database` and dynamically import routes; mock-hoisting order matters, and DB mocks return `[rows, fields]`. Shared helpers live in `src/app/api/payroll/{test-perms,audit-rows}.ts`.
- Run `npm run verify` before pushing. It includes route authorization, lint, `build:prod`, and `test:run`, and also runs in CI. Subagents use this gate instead of standalone build, typecheck, or E2E commands.
- Use `npm run check:route-auth` for fast feedback while changing API routes or authorization rules.
- `npm run build:prod` is the only working `next build` workaround: plain `npm run build` fails prerender because `.env` sets `NODE_ENV=development`. `build:prod` uses Turbopack and checks types and client bundling; `tsc --noEmit` misses client/server import-shape failures.
- Do not start a dev server for delegated work. Only the assigned harness ticket or the orchestrator runs `npm run test:e2e`; it starts and stops its own owned server. The orchestrator performs merges and the final browser verification.
- Before local integration or browser execution, read [local database operations](docs/agents/local-database.md) for target safety, shell configuration, Chromium setup, fixture hooks, and instance cleanup.
