# E2E harness removal

Date: 2026-10-10.

The Playwright harness (`e2e/`, `playwright.config.ts`, `scripts/e2e-db.mjs`,
`.github/workflows/e2e.yml`) and the `@playwright/test` dependency are removed.
Tag `e2e-v1` holds the deleted tree if any of it is ever needed again.

## Restoration status (2026-11-12)

Issue #426 restored a **minimal maintained Playwright harness**. It is not the
old 41-spec suite and does not restore the old sole-E2E policy.

- New scope: one Chromium project and one `npm run test:e2e` financial-review
  smoke journey. Orchestration lives in `scripts/e2e/`; the spec and hooks follow
  in `e2e/`.
- `npm run verify` remains the separate lint, `build:prod`, and Vitest gate.
  Browser smoke is a separate required check, not part of `verify`.
- The harness creates a unique disposable MariaDB database, pins every database
  branch environment variable, starts an owned loopback `next dev`, and cleans
  up after success or failure. It refuses operational targets, existing
  databases, unsupported MariaDB versions, unowned app ports, and Next locks.
- Fixtures use `E2E-<issue>-<run>-<worker>` namespaces and ordinary application
  authentication. There is no test-only authentication bypass.
- Tag `e2e-v1` remains the archive of the removed suite. The old specs,
  fixtures, bootstrap script, and workflow were **not** restored from it.

Current commands, target guards, fixture hooks, and failure diagnosis are in
[local database operations](../agents/local-database.md#playwright-financial-smoke-harness)
and [CODING_STANDARDS.md](../../CODING_STANDARDS.md#testing-and-verification).

## Local-only checks (2026-11-13)

The user directed on 2026-11-13 that repository checks and E2E run locally.
`e2e.yml` was removed on 2026-10-10 and `checks.yml` on 2026-11-13.
`npm run test:integration:leads` and `npm run test:e2e` run on your machine.
Vercel previews and deployment builds remain enabled.
The [testing and verification rules](../../CODING_STANDARDS.md#testing-and-verification) are canonical.
The dated sections above describe 2026-10-10 and 2026-11-12; they do not describe current CI.

## What was deleted

- 41 spec files (`e2e/specs/`, including `e2e/specs/security/`) and the fixture
  modules under `e2e/lib/` that seeded and purged their namespaced data.
- The global setup that reseeded every namespace on each run and refused to start
  when the payroll month already had a run.
- The three-jar auth setup, the MySQL bootstrap script, and the E2E workflow.

## What stays

- All vitest suites under `src/**/*.test.*`. `npm run test:run` is unchanged.
- `npm run build:prod` (renamed from `build:e2e`: the production build, which was
  the harness's build gate and is still the push gate).
- The ops scripts that wrote their evidence into `e2e/artifacts/`. They now write
  to `artifacts/` at the repository root, which is gitignored:
  `scripts/security-poc-reruns.mjs` (`artifacts/security-poc-reruns.json`),
  `scripts/predeploy-check.mjs` (`--artifact artifacts/predeploy-prod.json`), and
  `scripts/scrub-stored-html.mjs` (`--artifact
artifacts/security-scrub-dry-run.json`).
- `npm run check:route-auth` and `checks.yml`, which never depended on the
  harness. `checks.yml` was removed on 2026-11-13.

## Historical testing policy

At removal time, no browser harness was committed. The former policy made E2E
the sole verification mechanism and forbade route, page, and component tests.
The current browser-test scope and testing rules are in
[CODING_STANDARDS.md](../../CODING_STANDARDS.md#testing-and-verification).
This record documents the removed harness and the policy change; it does not
state that route or page behavior currently lacks automated coverage.

## Reading older documents

Docs written before this date cite `e2e/specs/...` paths and `e2e/artifacts/...`
file names as evidence — for example `docs/SECURITY_AUDIT.md`,
`docs/todo/SECURITY_REMEDIATION_PLAN.md`, and
`docs/app/reports/company-expenditure-implementation.md`. Those citations record
what a run asserted at the time. The specs and artifacts are no longer in the
tree; the tag is the record.
