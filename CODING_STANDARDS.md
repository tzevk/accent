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
- After logout succeeds, replace the browser document with `/signin` to discard the previous session's client state.
- Public endpoints use the exact allowlist in ADR-0014 and per-method entries in `scripts/route-auth-allowlist.json`. Adding one requires updating both. Do not broaden public access with prefix matching; that applies only to static assets.
- Rate limits use platform-set `x-vercel-forwarded-for`, never client-supplied `x-forwarded-for`, together with the validated session token hash. Auth and heavy categories use shared MySQL fixed windows; other categories remain in memory. Preserve limits and storage semantics in `src/proxy.ts`.
- Every exported API route handler must authorize with `getCurrentUser`, `getServerAuth`, or `ensurePermission`, unless a reasoned public-by-design or delegating-forwarder exception is recorded for that HTTP method. The local ESLint rule `accent/require-route-auth`, run by `npm run lint`, enforces this over `src/app/api/**/route.{js,ts}`. It inspects parsed syntax for each exported method, so a guarded `GET` does not clear an unguarded `DELETE`, and a comment, import, or unused guard reference does not satisfy it. It proves an approved guard call or permission wrapper exists on that method's reachable handler/helper path; it does not verify the deny branch. API tests own the `401`/`403` results and the unchanged-data assertion. The only supported exception is a nonblank-reason literal-method entry in `scripts/route-auth-allowlist.json`. Inline `eslint-disable` directives are policy-forbidden; the rule reports detectable named or unqualified directives, but a block directive can still suppress diagnostics, so this is policy, not a mechanical block.
- RBAC merges role and user `resource:action` permissions by set union. Field permissions use `users.field_permissions.modules[resource].crud[action]` values `hidden`, `view`, or `edit`, then `stripDisabledModules()` prunes disabled modules. A truthy `is_super_admin` bypasses checks. `canModifyTargetUser` prevents non-super-admins from changing a super-admin or a user at an equal or higher `role_hierarchy`.
- Preserve the upload boundary: `/uploads/*` responses set `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`; uploaded content is server-rasterized to PNG by `src/app/api/uploads/route.js`.

## Database and data invariants

**Trigger: changing queries, migrations, schemas, pools, or database-backed behavior.**

- Use shared `globalThis.__dbPool` from `src/utils/database.js`: `query()` for one query, `withDb(cb)` for multiple queries or transactions, or `dbConnect()` with `finally` to release a connection. Do not create route-local connections.
- Do not run `CREATE`, `ALTER`, or `SHOW` in route handlers. Use Knex migrations or `hasColumn(db, table, col)` from `src/utils/schema-cache.js` (10-minute cache).
- Keep production pool `connectionLimit` at 5, below MySQL `max_user_connections`.
- Keep each MySQL pool's `maxIdle` below its connection limit. Otherwise mysql2 does not run its idle timer.
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

**Trigger: implementing, reviewing, or verifying code; changing tests, checks, CI, or build automation.**

Before reviewing a diff or choosing checks, read [reliability checks](docs/agents/reliability-checks.md) and run only the rows whose trigger matches.

Use the [verification map](docs/agents/verification-map.md) to find existing proof for an Accent feature.

### Test layers

- `npm run test:unit` runs the existing Vitest logic, component, mocked route-contract, and harness suites. Pass a file or test-name filter for focused feedback. `npm test -- <test-file> --watch` remains the interactive loop.
- `npm run test:integration` runs the existing authenticated HTTP scenarios against an owned disposable MariaDB database. Use the [leads integration guide](docs/app/leads/integration.md) for scenario selection and cleanup.
- `npm run test:e2e` runs the maintained browser suites in GitHub Actions. Local execution remains an explicitly authorized debugging exception.
- These native layers adapt Twenty CRM's separation without Nx, Yarn, Jest migration, or a second application layout. Existing tests stay in place. Historical records may retain the former `test:run` and `test:integration:leads` names; they are not current commands.

### Development loop

- Before editing, name the result a person or API caller must observe. Pick the fastest check that can fail when that result is wrong. Follow [verification ownership](#verification-ownership) before starting broad checks.
- Match the Node version declared in `package.json` and CI. Check installed CLI help before using unfamiliar test flags.
- While editing, run an explicit Vitest file or named test. Use `npm test -- <test-file> --watch` interactively, or `npm run test:unit -- <test-file>` for one-shot feedback. Run installed ESLint on changed source files rather than repeatedly linting the repository.
- Use `npm test -- related <source-file> --run` or `npm test -- --changed origin/main --run` as selection aids. Confirm the Git reference exists and is current. Import graphs do not prove effects through HTTP, migrations, computed imports, or runtime configuration; select those integration checks explicitly.
- Run ESLint on the changed route files, or `npm run lint` for the whole covered tree, for fast feedback while changing API routes or authorization rules. Authorization is part of lint, not a separate command.
- Run the changed path on the real app when a change crosses the browser, HTTP, or database boundary. Check the result, not just startup or a passing build. Use the owned test runtime. For browser journeys, follow [CI-owned browser verification](#owned-browser-runtime).
- Treat a test that passes only on retry as flaky. Preserve the first failure and investigate it. Do not add sleeps, skips, or retries to obtain a pass.
- After a failure, inspect the first actionable error, trace, and owned server output. Classify the cause as application, fixture, or environment before rerunning.
- If the same check fails after three fix-and-rerun rounds, stop and report the command, the first actionable error, and what changed on each attempt. Do not start a fourth blind attempt; a human decides the next step.
- Record the expected and observed result, command or CI run, tested revision, and gaps. For a browser failure, name the failed action and link its trace or screenshot when available.
- Stamp the final commit with the evidence, for example `Verified: npm run verify` or `Verified: npm run test:unit -- <file>`. Use `Verified: none` when no runtime check ran. Record why and name any missing runtime proof.

### Verification ownership

- **Implementation workers:** run focused checks for their changes. Do not independently run `npm run verify`, production builds, or unrelated suites during iteration. Browser execution requires explicit runtime ownership.
- **Reviewer:** use one review owner per change. Review a fixed revision against the base branch's verification rules. Cite the triggering diff and risk. Later rounds revisit earlier findings and changed inputs. Distinguish merge blockers from pre-existing issues and suggestions. A protected verification change needs human review before the `test-change` label.
- **Integration owner:** the main agent owns integration unless another agent is explicitly assigned. For code, test, or build/CI changes, run `npm run verify` against the final candidate before pushing. This is one shared gate, not one gate per worker or commit.
- Successful gate evidence remains valid only while its checked inputs remain unchanged. Rerun affected focused checks after fixes, then complete the required gate against the final candidate. Do not repeat a successful unchanged gate for handoffs or status reports.
- **Documentation-only changes:** check affected links, anchors, and formatting. Skip application builds, databases, and browser suites unless the task explicitly requires runtime proof.
- **CI:** keep lint (including the per-method API authorization rule), unit tests, production build, and the real-database `e2e` job enabled. That job runs the Leads authenticated HTTP integration and then the full Playwright suite against one MariaDB 10.11 service, but each step owns its own disposable database, app process, port, and cleanup. The browser step still runs when Leads fails; a final step then fails the job so a Leads failure cannot be masked. Local selection complements these checks; it does not replace them. Keep Vercel previews and deployment builds enabled. Keep the `test-integrity` job enabled: it requires the `test-change` label when a pull request changes verification code, tests, lint rules, or gate scripts.
- The merged browser job uses the id `e2e` and runs both the Leads HTTP integration and Playwright. Required merge checks are repository settings, not a property of workflow YAML, so after renaming a job or its display name verify enforcement separately; report missing administrator access instead of claiming merges or deployments are gated.
- CI uses native path selection, not an inferred Nx project graph. Only PRs changing known root documentation or `docs/` may skip runtime checks. Source, tests, scripts, CI, dependencies, migrations, mixed changes, empty results, or unavailable comparison data select all checks. Deletions and renames must retain the old runtime path when classifying scope.
- Lint (including route authorization) and unit checks give independent early feedback. Build and the `e2e` job start only after those checks pass. The `e2e` job runs the Leads integration first and then the browser suite even if Leads failed, and a final step fails the job when Leads did not pass. The always-running CI `verify` job fails on failed, cancelled, missing, or unexpectedly skipped results; only an explicitly classified documentation-only PR may skip runtime checks.
- Use standard GitHub-hosted Ubuntu runners for this public repository. Keep paid Actions usage at zero. If free execution is unavailable, block rather than select paid capacity. Workflow configuration alone does not prove a billing cap.
- Local `npm run verify` runs lint, `test:unit`, then `build:prod`; it excludes database and browser suites. CI runs those commands in separate jobs and uses `verify` as the aggregate status, not another execution of the local command. `build:prod` sets `NODE_ENV=production` because plain `npm run build` fails prerender with the repository's development environment. Keep its type and client-bundling checks; standalone `tsc --noEmit` is not a substitute. Passing staged filenames to `tsc` also ignores `tsconfig.json`.

### Coverage and assertions

- Use the lowest layer that can prove the behavior. Use E2E for critical outcomes that depend on layers working together. A passing unit test does not prove a user journey works.
- Component tests render the real component with realistic payloads. Query by accessible role or label and assert observable behavior, such as accessible names, focus, and empty states. Do not fake route handlers or pin source text as proof.
- Route tests cover API contracts, status codes, and authorization decisions. Existing route suites may mock the database. Use real MariaDB integration for SQL behavior, constraints, migrations, transactions, and contention; mocked HTTP or database responses cannot prove those invariants.
- Cover critical browser journeys with independent specs. Include real sign-in and verify the result a person sees. Run the maintained suite in CI on every runtime PR. Do not add a browser case for every rule or edge case.
- Before writing a browser test, state the behavior and why a browser is needed. Keep one behavior per test. Select by role, label, or `data-testid`, not styling-sensitive selectors. Namespace data per run (`E2E-<issue>-<run>-<worker>`), track fixture records by primary key, and clean owned records in teardown, including failure paths.
- Assert visible UI state even when TanStack Query serves cached data. Await a response only when the action guarantees a request; arm that wait before the action. Test API contracts through explicit requests and independently read persisted database state when asserting persistence or financial integrity.
- Keep cold-start readiness and interaction budgets separate. Diagnose missing events before increasing a timeout or retry count. Preserve first-failure evidence; do not disable authentication, rate limits, or financial assertions to obtain green results.
- Move rule combinations to lower layers. Split browser specs by independent outcomes, not by screens or a fixed count.
- Do not serialize browser tests or disable parallelism to enforce ordering; combine dependent steps into one test. Do not use `page.waitForTimeout`; wait for a locator assertion or a guaranteed response.
- Never use hardcoded or shared test data. Do not commit route, page, or component tests that mock their own dependencies and only assert that the mock answered.
- Use property tests for rules that must hold across many inputs. State the invariant independently of the implementation. Keep the failing seed and path from `fast-check` so a failure is reproducible.
- Use differential tests for rewrites that must preserve behavior. Give the baseline and replacement the same inputs. Normalize only irrelevant differences. List approved behavior changes and test their new results explicitly. Use synthetic or sanitized fixtures, not live operational records.

### Owned browser runtime

- GitHub Actions runs routine E2E. Use the `e2e` job for Leads HTTP and Playwright. Local browser runs require explicit authorization for debugging; do not use them as the routine completion gate.
- The maintained Playwright harness lives in `e2e/` with orchestration in `scripts/e2e/`. Use `npm run test:e2e`, not direct `npx playwright test`. The harness owns a unique disposable MariaDB database, migrations, fixture hooks, loopback `next dev`, database-target verification, and cleanup.
- For authorized local debugging, keep one owned runtime open with `npm run test:e2e -- --local-run-reason "browser-only failure investigation" --ui`. A test failure stops that attempt, not the UI session. Inspect the failure, fix the cause, and rerun the selected test inside that session. Use per-test watch or manual reruns after app changes; automatic app-source invalidation is not guaranteed.
- Restart only after migration, startup fixture-hook, or pinned environment changes, or an unusable owned server. Record the reason before restarting. Do not recreate the database and server merely because a browser assertion failed.
- All local invocations, including UI mode, require `--local-run-reason "<reason>"`. The CLI rejects unacknowledged local runs before harness startup. Only GitHub Actions receives reason-free CI execution; `CI=true` alone does not enable it. Do not spoof `CI` or `GITHUB_ACTIONS` locally. A supplied reason does not replace user authorization or justify blind retries.
- Keep interactive sessions on loopback. Before adopting or changing the UI lifecycle, verify two reruns and clean exit once. Do not repeat lifecycle verification for unrelated changes. Keep failure traces available with zero local retries; `on-first-retry` alone captures nothing in that configuration.
- `--grep` and `--last-failed` select tests but a fresh harness invocation still pays setup costs. Playwright `--only-changed` follows collected test dependencies, not application dependencies reached only through HTTP. None replaces complete CI coverage.
- Raise workers or add shards only after measuring browser execution separately from setup and proving data isolation. Do not shard a single dependent journey or reuse cross-session authentication against a newly created database.
- Only the integration owner or an explicitly assigned browser worker may start an authorized local harness. Other delegated work must not start dev servers. Final browser evidence comes from CI for the assembled candidate; reuse that evidence while its checked inputs remain unchanged.
- The runtime refuses non-loopback hosts, database names lacking `integration`, existing databases, operational branch names, MariaDB versions other than 10.11, an unowned app port, and an existing `.next/dev/lock` or `.next/lock`. It pins `DEV_DB_*`, `STAGING_DB_*`, `PROD_DB_*`, `DB_HOST`, and `DB_PORT` for every child process. It never edits `.env`, kills, or attaches to an unowned server.
- Journey fixtures are owned by `e2e/fixtures/hooks.ts`, which exports `seed(context)` and may export `cleanup(context)`. The context exposes the runtime, an independent reader, and the namespaced fixture helper. Fixtures use ordinary application authentication; do not add a test-only bypass, commit credentials, seed a super-admin, or grant `employees:read` to make a projection work.
- Playwright reports, traces, and screenshots go to ignored `e2e/artifacts/`. Capture them on failure and never log passwords, session tokens, or operational Employee data.
- Before local integration or browser execution, read [local database operations](docs/agents/local-database.md) for target safety, shell configuration, Chromium setup, fixture hooks, and instance cleanup.

### Existing suites and history

- Vitest suites live beside code under `src/**/*.test.*`. Harness contracts and safety helpers are tested under `scripts/e2e/**/*.test.ts`; native CI scope helpers live under `scripts/testing/**/*.test.ts`. Existing regression coverage includes money and payroll math, leave/date/week-off logic, statutory calculations, RBAC and authorization, sanitization, punch/time-present math, and report data aggregation. Extend coverage in kind; do not recreate deleted Attendance report page-decision suites from #288.
- Test local calendar boundaries in isolated processes with explicit `TZ`; developer machines and CI use different zones.
- Payroll API tests mock `@/utils/database` and dynamically import routes; mock-hoisting order matters, and DB mocks return `[rows, fields]`. Shared helpers live in `src/app/api/payroll/{test-perms,audit-rows}.ts`.
- The old 41-spec suite was removed on 2026-10-10 and is archived at tag `e2e-v1`; it is not the maintained suite's source of truth. [The removal and restoration record](docs/explanations/E2E_HARNESS_REMOVAL.md) explains that history. The restored minimal smoke harness does not restore the old sole-E2E policy.
