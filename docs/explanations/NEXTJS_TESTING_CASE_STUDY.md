# Next.js testing case study: local focus, CI breadth

Research date: 2026-11-16. Source snapshot: `vercel/next.js` at commit
[`0a520df5f6d33909d7f8dcfae380d7fbfb436b42`](https://github.com/vercel/next.js/tree/0a520df5f6d33909d7f8dcfae380d7fbfb436b42)
on `canary`. Repository claims use pinned source files; execution evidence comes
from GitHub's historical run metadata. We launched no workflows and measured no
test durations.

## Why this repository

Next.js is Accent's framework, so its repository shows how a professionally
maintained project divides local feedback from CI. The scale differs: Next.js
spans bundlers, React channels, operating systems, browsers, and Vercel;
Accent has one Chromium journey. The lesson is that division.

## Local testing is selective and explicitly supported

The guide first requires a project build, then recommends running one directory:

```sh
pnpm build
pnpm test-start test/e2e/app-dir/app/   # production mode
pnpm test-dev   test/e2e/app-dir/app/   # development mode
```

These are **Next.js-repo commands, not runnable Accent commands**. The guide
says: "We recommend running the tests in a specific directory pattern." It also
documents `pnpm testonly-start test/e2e/app-dir/app/`: normal `test-*` scripts
run headless, while `testonly-*` opens a visible browser. E2E runs install a
local build in a temp directory, start a server on a random port, and clean up
afterwards
([testing guide](https://github.com/vercel/next.js/blob/0a520df5f6d33909d7f8dcfae380d7fbfb436b42/contributing/core/testing.md)).

The runner is **Jest**, not Vitest or Playwright Test. The `test-dev`/`test-start`
scripts add `--headless`; `run-jest.sh` ends with `exec jest --runInBand`
([`run-jest.sh`](https://github.com/vercel/next.js/blob/0a520df5f6d33909d7f8dcfae380d7fbfb436b42/scripts/run-jest.sh)).
Playwright provides browser automation: the helper imports
`{ chromium, firefox, webkit }` from `playwright`; a direct Jest run launches
its own browser, while CI shares one
([`launch.js`](https://github.com/vercel/next.js/blob/0a520df5f6d33909d7f8dcfae380d7fbfb436b42/test/lib/browsers/launch.js)).
Accent instead uses the Playwright Test CLI.

This contradicts the claim that professionals never run E2E locally: Next.js
documents scoped runs, a visible-browser mode, `NEXT_TEST_SKIP_CLEANUP`, and
`pnpm debug`.

## What CI actually does

The main [build-and-test workflow](https://github.com/vercel/next.js/blob/0a520df5f6d33909d7f8dcfae380d7fbfb436b42/.github/workflows/build_and_test.yml)
runs on pushes to `canary`/`releases/**`, PR opens, and PR updates. Its
concurrency group is per PR with `cancel-in-progress: true`; push runs are
grouped by SHA, so distinct commits can run concurrently. GitHub showed a
successful `build-and-test` push run for this SHA
([run 43875174262](https://github.com/vercel/next.js/actions/runs/43875174262));
an observed run, not a timing or coverage measure.

1. `changes` classifies docs, Turbopack, release, and Rspack changes.
2. `build-next`, native builds, and `fetch-test-timings` prepare outputs.
3. The dev and prod suites each run in ten timing-balanced groups:
   `group: [1/10 … 10/10]`, then
   `node run-tests.js --timings --require-timings -g ${{ matrix.group }}`.
   React 18 is excluded on PRs
   unless labelled.
4. Other jobs cover unit, Rust, Windows, Firefox/WebKit
   (`browser: 'firefox webkit'`), Turbopack, cache components, and Vercel
   deploy tests for changed tests.
5. `tests-pass` aggregates required jobs; a comment says merging is blocked by
   a "require status checks to pass" rule on `canary`.

The reusable [build workflow](https://github.com/vercel/next.js/blob/0a520df5f6d33909d7f8dcfae380d7fbfb436b42/.github/workflows/build_reusable.yml)
defaults to Chromium, installs it, and uploads `test/traces`. Timing artifacts
keep shard assignments consistent between attempts.

Crucially, its **passed-tests cache** restores the list of green test files on
later attempts of the **same workflow run**, keyed by job and run ID. Failed
files still rerun, and job setup can repeat. This is not resuming a failed test
at its last browser action
([same-run result cache](https://github.com/vercel/next.js/blob/0a520df5f6d33909d7f8dcfae380d7fbfb436b42/.github/workflows/build_reusable.yml)).
[`retry_test.yml`](https://github.com/vercel/next.js/blob/0a520df5f6d33909d7f8dcfae380d7fbfb436b42/.github/workflows/retry_test.yml)
retries a failed `canary` run up to twice, only when the aggregate job did not
succeed.

## Observed execution

The pinned commit's successful `build-and-test` run contained **113 jobs**,
according to GitHub's jobs API. That count includes different kinds of work,
not 113 browser tests. It demonstrates framework-scale CI, not a sensible
target for Accent
([observed run](https://github.com/vercel/next.js/actions/runs/43875174262)).

## What is and is not transferable to Accent

Accent's [checks workflow](../../.github/workflows/checks.yml) separates change
selection, route authorization, lint, unit tests, production build, MariaDB
integration, and browser smoke, with an always-running `verify` aggregate.
Local `npm run verify` remains the authorization → lint → unit → build chain.
Accent's [local invocation guard](../../scripts/e2e/invocation.ts) requires
`--local-run-reason` outside GitHub Actions; `CI=true` alone does not bypass it.
Routine browser coverage belongs to CI; authorized local debugging remains valid.

Keep or adapt these practices:

- Keep focused Vitest as the local loop.
- Keep Playwright traces and failure artifacts; Next.js uses them for CI
  failure diagnosis.
- Add changed-test flake detection when the suite justifies it, as Next.js does
  with `test-new-tests-* --flake-detection`.
- Shard only by measured timings once tests are isolation-safe; one journey
  should not be split artificially.
- Enforce required CI checks through repository settings, separately from workflow configuration.

Not transferable: ten-way matrices, React channels, ARM runners, Rust/SWC
builds, Vercel tarballs, and deploy-mode tests. Next.js also depends on Vercel
deployments, so this is not a pure "all browser tests on standard GitHub
runners" model.

## Limits

- We launched no Next.js workflows and measured no durations, flake rates, or
  costs. We inspected configuration and observed one completed historical run.
- The `tests-pass` comment describes a rule; actual branch-protection and
  administrator-bypass settings were not inspected.
- Accent's changed checks have not run in Actions; the merge gate is unverified
  and unenforceable with the current non-admin account.
- Local E2E remains legitimate: the guide recommends scoped runs and
  visible-browser debugging, evidence against the claim that professionals
  never run it.
- No timing improvement is claimed; this is about where work runs and how
  failures surface.
