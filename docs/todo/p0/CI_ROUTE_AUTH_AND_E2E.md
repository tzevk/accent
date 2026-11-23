# Consolidate route authorization into ESLint and merge the browser job

Status: cutover applied in the working tree. CI has not run on this change, so
no CI result is claimed here. Repository required-check settings still need an
administrator review.

## Baseline

- `checks.yml` ran `route-auth` on a separate runner with its own `npm ci`.
  The retired `scripts/check-route-auth.mjs` scanned each exported HTTP handler
  for a recognized guard name or an allowlist entry by text. A guard reference
  alone did not prove the right permission, and a file-level guard could mask
  an unguarded method.
- `leads-integration` and `e2e-financial-smoke` were separate jobs, each paying
  its own `npm ci`, MariaDB 10.11 service, and 30-minute timeout. The browser
  job's id and name described its original Payroll scope rather than how
  Playwright selects specs.

## Route authorization moved into ESLint

Applied:

- [x] Add the local ESLint rule `accent/require-route-auth` at error severity,
      scoped to `src/app/api/**/route.{js,ts}` and registered in
      `eslint.config.mjs`. It inspects parsed syntax per exported method rather
      than text-matching guard names, so a guarded `GET` does not clear an
      unguarded `DELETE`.
- [x] Accept an approved guard call or permission wrapper on each exported
      method's reachable handler/helper path. The rule does not prove the deny
      branch; API tests assert `401`/`403` and unchanged data. Record exceptions
      as nonblank-reason literal-method entries in
      `scripts/route-auth-allowlist.json`; no wildcard methods. Inline
      `eslint-disable` directives are policy-forbidden, and the rule reports
      detectable named or unqualified ones, but a block directive can still
      suppress diagnostics. The repository cannot enable scoped `noInlineConfig`
      while the existing `@typescript-eslint/no-explicit-any` directives remain,
      so hardening that gap is deferred.
- [x] Cover the rule with `scripts/testing/require-route-auth.test.ts`, run by
      Vitest and selected by `test-integrity` as a verification change.
- [x] Remove the standalone `route-auth` job, the `npm run check:route-auth`
      command, and `scripts/check-route-auth.mjs`. Update `verify` and job
      dependencies. `npm run lint` now carries the check.

Pending:

- [ ] CI must confirm the rule runs over every covered handler and that the
      existing allowlist entries still pass under the parsed per-method check.
- [ ] Check repository merge rules before relying on the removal of the
      separately required `route-auth` status. This needs administrator access;
      do not claim merges are gated from workflow YAML alone.

Keep API tests for permission behavior. They should check that an
unauthenticated request gets `401` and a signed-in User Account without
permission gets `403`. A denied write must leave data unchanged. The lint rule
cannot prove those results.

## Leads integration and Playwright in one job

Applied:

- [x] Replace `leads-integration` and `e2e-financial-smoke` with one job whose
      id is `e2e`, below the scope, lint, and unit jobs. It keeps one `npm ci`,
      one Chromium install, and one MariaDB 10.11 service, with a 60-minute
      timeout covering both former 30-minute jobs.
- [x] Run the Leads authenticated HTTP integration first
      (`npm run test:integration`, fixed port 31369, database
      `accent_integration_369`), then the full Playwright suite
      (`npm run test:e2e`, automatically selected loopback port, run-suffixed
      database).
- [x] Keep the lifecycles separate inside the job: each step creates and drops
      its own disposable database, starts and stops its own Next server, and
      must not attach to the other run. The shared MariaDB service creates no
      database.
- [x] Mark the Leads step `continue-on-error` so browser setup and the
      Playwright suite still run after a Leads failure, then fail the job in a
      final step when that outcome was `failure`. Neither suite can mask the
      other.
- [x] Keep the failure artifacts and the docs-only skip. Keep the
      `verify` aggregate and its expected job list aligned with
      `changes`, `lint`, `unit-tests`, `build`, and `e2e`.
- [x] Remove the obsolete checklist advice to keep the Leads run in a separate
      CI job.

Pending:

- [ ] Run the merged job once in CI and confirm both suites report
      independently and that a Leads failure still leaves browser results and
      artifacts. Until that run exists, do not describe the job as verified.

## Not in this change: new browser journeys

The consolidation runs the existing specs under
[`e2e/specs/`](../../../e2e/specs/). It does not add new journeys; these stay
proposed and need their own scoped change:

- [x] Add an independent spec for saving a quotation and reopening it, asserting
      the saved values on reopen, not just a success message. See
      [`e2e/specs/quotation.spec.ts`](../../../e2e/specs/quotation.spec.ts).
- [x] Add an independent spec for creating a voucher and reopening it, asserting
      the saved values on reopen. See
      [`e2e/specs/cash-voucher.spec.ts`](../../../e2e/specs/cash-voucher.spec.ts).

Keep rule combinations and database edge cases at lower test layers. The
browser job covers critical journeys only; it is not a second integration
suite. Measure setup and test time before adding shards. Use standard
GitHub-hosted runners without adding paid capacity.

See [testing and verification](../../../CODING_STANDARDS.md#testing-and-verification)
for test selection, fixture isolation, and CI ownership.
