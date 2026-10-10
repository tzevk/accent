# E2E harness removal

Date: 2026-10-10.

The Playwright harness (`e2e/`, `playwright.config.ts`, `scripts/e2e-db.mjs`,
`.github/workflows/e2e.yml`) and the `@playwright/test` dependency are removed.
Tag `e2e-v1` holds the deleted tree if any of it is ever needed again.

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
  harness.

## Open gap

Route and page behaviour has no committed automated proof. The old doctrine made
E2E the sole verification mechanism and forbade route, page, and component
tests; both rules are gone. Until a policy is agreed, verify flows by driving the
running app and record the observation in the ticket. Do not fill the gap with
mock tests.

## Reading older documents

Docs written before this date cite `e2e/specs/...` paths and `e2e/artifacts/...`
file names as evidence — for example `docs/SECURITY_AUDIT.md`,
`docs/todo/SECURITY_REMEDIATION_PLAN.md`, and
`docs/app/reports/company-expenditure-implementation.md`. Those citations record
what a run asserted at the time. The specs and artifacts are no longer in the
tree; the tag is the record.
