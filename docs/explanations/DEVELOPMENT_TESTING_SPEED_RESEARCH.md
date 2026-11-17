# Development testing speed: retrospective and research

Research date: 2026-11-16. Measurements describe the retrospective, not a new benchmark.

Operational update: routine E2E now belongs in GitHub Actions. Local browser debugging requires explicit user authorization and `--local-run-reason`. The one-shot Vitest command is `npm run test:unit` and the real-database command is `npm run test:integration`. Current requirements live in [testing and verification](../../CODING_STANDARDS.md#testing-and-verification). Historical observations and the configuration table below describe the inspected pre-guard, pre-migration configuration; their older command names are recorded as evidence, not current instructions.

## Recommendation

**Keep the tools and financial coverage. Change the iteration loop before adding infrastructure.**

The last session lost time to incorrect browser waits, repeated cold runs, and repeated production verification.
This was not simply a large test suite.
The currently inspected checkout has one browser journey.

Use focused Vitest checks while editing.
Run routine browser verification in GitHub Actions; reserve owned Playwright UI sessions for authorized local debugging.
Keep complete verification at the integration boundary and in CI.

The existing policy still requires `npm run verify` before pushing.
Changing that policy requires an explicit update, not silently skipping the gate.

## 1. What happened in the last session

Primary source: session `01a1defe-b9ac-758f-bf18-1760a060a1c2` and its nested agent transcripts.
A historical consultant read those records. The failing checks were not rerun for this report.

| Observed work                      | Count                                                   | Recorded cost or outcome                                                          |
| ---------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Salary browser journey, issue #447 | 12 harness invocations; 22 test attempts                | Summed command wall time: **25m48s**, including some chained setup and gates.     |
| Worst browser invocation           | Both attempts reached a 300-second timeout              | **653.28 seconds** for the command. A cache-blind response wait never completed.  |
| Passing salary browser test        | Initial green and post-review green                     | Playwright durations: **31.8–32.2 seconds**.                                      |
| Late complete verification         | Four complete runs                                      | **14m16s** combined. Each repeated lint, production build, and all Vitest tests.  |
| Salary database contention         | Eight harness invocations                               | First exposed a real deadlock. Final result: six tests passed in **1.4 seconds**. |
| Existing payroll browser smoke     | Two actual runs; another launch rejected before testing | Final result: one test passed in **9.3 seconds**.                                 |

**Do not add these figures into a session total.**
Command scopes include other checks; execution-interval overlap was not reconstructed.
Playwright test durations exclude some surrounding harness work.

The salary work used historical candidate worktrees for `integration/434-salary-profiles`.
Those counts do not describe today's checked-out browser suite.
Historical logs show retries, but retained evidence does not establish what enabled them.
The current configuration disables local retries.

Other obstacles included a reminder dialog, menu toggling, stale locators, API throttling, and generated-type failures.
Some assertions checked implementation details rather than visible behavior.
The historical consultant reports those defects were fixed.
They are lessons here, not claims of current unresolved bugs.

Agent investigations compounded the delay.
Recorded durations included 54m51s for browser authoring and 25m56s for observer diagnosis.
Those jobs overlapped; their durations are not additive.

The user's repeated questions about retries match the execution record.
The problem was real wasted feedback time.

### Evidence anchors

- `artifacts/browser-447-run3.log:87,149,156-175`.
- `browser-447-run11.log:349-351` and `browser-447-final.log:349-351`.
- `artifact://2212:399-418` and `contention-446-run7.log:42-51` in the historical runtime.
- Completed commands `bg_386`, `bg_408`, `bg_434`, and `bg_438`.
- Nested transcripts: `SalaryBrowserJourney447`, `SalaryJourneyDialogs447`, `ContentionLockWait457`, and `SalaryIntegrationReview`.

These reference the consulted historical record, not guaranteed files in today's checkout.
The present location and merge status of that historical candidate were not checked.

## 2. Improvements ranked by severity

P1 means first adoption priority, not an unresolved production incident.

| Priority | Environment improvement                                                                       | Why it matters                                                                                               |
| -------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| P1       | Give one integration owner the complete gate; use focused checks during implementation.       | Four late verifications repeated expensive builds. Keep the final gate and configured CI coverage.           |
| P1       | Move routine browser verification to CI; use owned UI sessions only for authorized debugging. | Separate local harness invocations recreate the database and server. No lifecycle refactor is needed.        |
| P1       | Correct cache-sensitive waits and bound failure time.                                         | Two five-minute waits exhausted the worst invocation. More retries cannot fix an impossible wait.            |
| P2       | Report phase timings and the first actionable error.                                          | Migration, startup, compilation, browser work, and cleanup currently contribute to enclosing command totals. |
| P2       | Bound agent investigations and avoid independent broad verification by every worker.          | Several narrow investigations consumed tens of minutes. Return a cause and smallest next check first.        |
| P2       | Preserve fast, real-database integration coverage outside the browser.                        | Contention testing caught a real deadlock. Mocked HTTP would not prove transaction behavior.                 |
| P2       | Reconcile testing guidance and stale navigation.                                              | Existing rules already favor lower layers, but subagent gate wording encourages broad checks.                |
| P3       | Benchmark test environments and remove redundant CI work.                                     | Global jsdom and overlapping push/PR triggers are candidates. Savings remain unmeasured.                     |

### Correct waits rather than extending them

TanStack Query can satisfy a screen from cache.
A successful UI action therefore does not always produce a new response.
Assert visible state with Playwright's locator assertions. [P5]

When an API contract needs direct proof, issue an explicit request and assert that response separately.
For mutations, arm the response wait before the action when that action guarantees a request.
Keep independent database assertions where persistence or financial integrity matters.

Separate startup budgets from interaction budgets.
A browser timeout should not conceal a known missing event for five minutes.
Reviewers should assess whether each wait matches product behavior.
A chosen literal timeout ceiling can receive a deterministic ESLint check instead of another prose-only prohibition.

Do not disable authentication or rate limits to make a journey pass.
Fix fixture assumptions, test behavior, or application defects according to the evidence.

### Preserve the useful failures

The historical tests exposed a real cross-Employee database deadlock.
Review also found correction-range corruption and misleading salary wording.
Keep the tests and review that caught them.
Reduce redundant browser work, not financial invariants.

## 3. Repository snapshot before migration

| Source                                                                          | Recorded pre-migration evidence                                                                                                                                 |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`package.json`](../../package.json), lines 18–23                               | `test` starts Vitest; `test:run` runs once. `verify` chains authorization, lint, production build, and all Vitest tests. Browser tests are separate.            |
| [`checks.yml`](../../.github/workflows/checks.yml), lines 8–109                 | Four configured jobs: route authorization, verification, leads integration, and financial browser smoke. Standard Ubuntu runners and npm caching already exist. |
| [`playwright.config.ts`](../../playwright.config.ts), lines 15–36               | Full parallelism is enabled. One Chromium project; zero local retries and one CI retry. Failure traces and videos are retained. No `maxFailures: 1`.            |
| [`scripts/e2e/environment.ts`](../../scripts/e2e/environment.ts), lines 508–539 | Each invocation creates a unique MariaDB database, migrates it, seeds fixtures, starts owned Next dev, and verifies database identity.                          |
| [`scripts/e2e/cli.ts`](../../scripts/e2e/cli.ts), lines 23–48 and 68–75         | Arguments reach Playwright. The CLI waits for the child to exit before stopping its owned runtime.                                                              |
| [`payroll-review.spec.ts`](../../e2e/specs/payroll-review.spec.ts), line 44     | One browser journey. It covers real sign-in, payroll review, and independent persisted-state checks.                                                            |
| [`payroll-review.ts`](../../e2e/fixtures/payroll-review.ts)                     | Direct database fixtures already avoid UI-driven data creation. Cleanup tracks owned records.                                                                   |
| [`vitest.config.ts`](../../vitest.config.ts), lines 8–14                        | All included suites use jsdom, including pure logic and harness tests. Environment overhead was not benchmarked.                                                |
| [`.husky/pre-commit`](../../.husky/pre-commit) and `package.json`, lines 40–44  | Pre-commit runs Prettier through lint-staged. It does not run ESLint or tests. CI supplies broader guardrails.                                                  |

This is not an unguarded repository.
Do not add another full-suite pre-commit gate.
Branch-protection enforcement and account billing controls were not verified.

### Why the owned UI session matters

For authorized debugging, `npm run test:e2e -- --local-run-reason "browser-only failure investigation" --ui` keeps the harness alive while the UI child remains open.
The CLI forwards arguments, awaits child closure, and only then cleans up.
That preserves the disposable database and owned server across UI reruns.

This is **source-supported, not runtime-verified by this report**.
Validate two consecutive reruns and clean exit when establishing or changing that exception workflow, not during routine tasks.
No new session manager, shared server, or runtime ownership bypass is justified.

Restart the session when migrations, startup fixture hooks, or pinned environment values change.
Use per-test watch or manually rerun after app changes; UI Mode is not guaranteed general application-source watching. [P2]
Keep UI access on loopback because traces can expose sensitive data. [P2]

With one browser test, `--grep` and `--last-failed` provide little selection benefit.
They still pay cold startup when launched as new commands.
Increasing workers or adding shards cannot divide one dependent journey.
Cross-session authentication reuse also loses value when its database is dropped.

## 4. Commands you can use now

Prepare MariaDB using the [existing local database guide](../agents/local-database.md#playwright-financial-smoke-harness).
Keep environment values in the shell. Do not change `.env` or attach to an ordinary development server.

```powershell
# Watch one pure-logic suite in an interactive terminal.
npm test -- src/lib/money.test.ts --watch

# Run one real component suite once.
npm run test:unit -- src/components/payroll/PayrollCompanySheetGrid.test.tsx

# Run the payroll API suite once.
npm run test:unit -- src/app/api/payroll/slips/route.test.ts

# Select tests importing the changed source module.
npm test -- related src/lib/money.ts --run

# Select affected unit tests against an available local Git reference.
npm test -- --changed origin/main --run

# Only for explicit user-authorized local browser debugging.
npm run test:e2e -- --local-run-reason "browser-only failure investigation" --ui

# Inspect saved failure evidence instead of immediately rerunning.
npm run test:e2e:report

# Keep the existing complete local push gate.
npm run verify
```

Commands match repository scripts, existing test paths, and installed CLI help.
They were not executed as tests during this research.
Explicit watch avoids relying on interactive-terminal detection. [P7]
Refresh the Git baseline deliberately; changed-test selection is not complete system coverage.

## 5. Corrections to the pasted strategy

The useful principle is tiered feedback: small checks while editing, broader checks at integration.
The pasted timings are goals, not measured Accent performance or universal industry standards.

| Pasted advice                                                 | Evidence-based correction                                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Playwright UI reruns on save.                                 | It supports per-test watch. Setup projects do not run by default. General app-source invalidation is not guaranteed. [P2]                                                                                                |
| `--only-changed` selects tests affected by app changes.       | Partly correct. Installed 1.65.0 follows collected test dependencies, including imported helpers. It does not infer app dependencies reached only through HTTP. Do not use it alone to approve application changes. [P1] |
| `--last-failed` avoids another full run.                      | It selects failures from a prior-run record. Useful for larger local suites, not this one-test suite or a fresh CI checkout. [P1]                                                                                        |
| Vitest selection catches every affected test.                 | `related` follows static imports, not computed dynamic imports. Git selection cannot establish effects through HTTP, migrations, or runtime configuration. [P7]                                                          |
| Typecheck staged files.                                       | Passing filenames to `tsc` ignores `tsconfig.json`. Use project-wide incremental checking; keep the production bundling gate. [P11]                                                                                      |
| Turn off local fail-fast; enable it in CI.                    | Neither runner currently fails fast by default. Playwright `--debug` deliberately forces one worker and one failure. CI fail-fast is a tradeoff, not a universal rule. [P1][P7]                                          |
| Add shared authentication and API seeding immediately.        | Reused authentication helps multiple journeys; mutations need isolated accounts. This journey deliberately tests sign-in and already seeds directly through SQL. [P4]                                                    |
| Enable `fullyParallel`, increase workers, and shard 4–8 ways. | Parallelism is already enabled. More concurrent tests require isolated data. One browser journey gives shards nothing useful to divide. [P3]                                                                             |
| Use `reuseExistingServer: !CI`.                               | Generic reuse accepts an already responding server. It does not prove database identity or ownership. Preserve this harness's stronger checks. [P6]                                                                      |
| Switch traces to `on-first-retry`.                            | Local retries are zero, so that would remove local failure traces. `retain-on-failure` still records runs; retaining only failures does not eliminate recording overhead. [P5]                                           |
| Keep about 20–50 E2E tests.                                   | No checked primary source establishes that count. Size browser coverage by critical risk and failure isolation, not a quota. [P10]                                                                                       |
| MSW can replace most integration coverage.                    | Mock Service Worker intercepts HTTP. It cannot prove SQL constraints, migrations, transactions, or the historical deadlock fix. [P13]                                                                                    |
| Move all UI coverage to component tests.                      | Lower layers are preferred where adequate. Next.js documents that Vitest does not directly support async Server Components. [P9]                                                                                         |
| Quarantine anything passing on retry.                         | A retry can expose product races, not just flaky tests. Require an owner, deadline, tracked cause, and retained critical coverage.                                                                                       |
| Merge queues and remote caching are the next step.            | Neither addresses the observed bad waits. Queues have eligibility and trigger requirements; cached results need complete input keys. [P12]                                                                               |

Vitest's live documentation now includes features absent from installed 4.1.7.
Installed help does not list `doctor`, `--last-failed`, or `--since-last-run`.
Do not build the workflow around unavailable commands.

The installed Playwright source is more precise than its CLI help.
`node_modules/playwright/lib/runner/index.js:6501-6532` maps Git changes through `affectedTestFiles`.
`node_modules/playwright/lib/common/index.js:244-257` includes tests whose collected dependencies contain a changed file.
Thus, describing `--only-changed` as selecting only edited spec files would also be wrong.
That import graph still does not establish effects in a separately running Next server.

## 6. What modern large-scale practice contributes

Google's published guidance favors fast, reliable tests that isolate failures instead of an E2E-heavy strategy. [P10]
Its test-size limits classify infrastructure requirements; they are not app-specific feedback targets.

Meta reported strong predictive-selection results using historical changes, test outcomes, and flaky-test handling. [P14]
That is infrastructure built around a large dependency graph, not a free configuration flag.
Nx, Bazel, or machine-learning selection are not justified first moves for this single Next.js application.

Use the transferable ideas: explicit test layers, focused selection, independent fixtures, useful failure evidence, and measured latency.
Keep the current complete CI checks until a selection strategy proves equivalent coverage.
There is no demonstrated need to create a nightly all-browser matrix here.

### CI changes must remain free

Public repositories receive free standard GitHub-hosted runner execution; larger runners are billed. [P12]
This does not establish a hard spending cap for storage or other features.
Keep standard runners and current test coverage.
If free execution becomes unavailable, block instead of selecting paid capacity.

The workflow triggers on pull requests and some branch pushes.
An open PR on a matching branch can cause duplicate workflow runs.
Review event selection and cancellation of superseded runs.
Concurrency grouping must explicitly distinguish or combine PR and push events as intended.
Adding `cancel-in-progress` alone does not automatically deduplicate unrelated groups.

Route authorization also runs separately and inside `verify`.
Retain the required check contract if that duplication is removed.
Consider cheap test feedback before the production build, since `&&` currently suppresses later tests after an earlier failure.

The workflow already caches npm dependencies.
Dependency caching is not equivalent to caching trusted test results.
Cache keys must include relevant inputs, and partial restore keys can restore older matches. [P16]

GitHub documents merge queues for organization-owned public repositories and eligible private organization repositories. [P15]
They require the `merge_group` trigger.
Current eligibility was not verified; this workflow does not include that trigger.
A queue is not a guaranteed reduction in total verification work.

## 7. Agent environment and guidance

### Keep navigation small

The loaded AGENTS files already point to testing standards and local database operations.
Neither needs a new testing manifesto or another broad skill.
No evidence here supports adding global instructions or deleting a specific global rule as a no-op.

Correct two current-status statements:

- `docs/agents/local-database.md:81` suggests the journey may not exist.
- `docs/explanations/E2E_HARNESS_REMOVAL.md:15-16` says the spec and hooks follow later.

Both now exist. Preserve the dated history while correcting navigation.

### Assign responsibilities clearly

`CODING_STANDARDS.md:74-79` already prefers lower-layer assertions and a thin browser suite.
Line 91 assigns the broad verification gate to subagents.
Line 94 reserves runtime ownership and final browser verification for the orchestrator.

Clarify the intended boundary:

- **Implementation:** focused tests, changed-file lint, and the smallest reproducing scenario.
- **Review:** coverage placement, meaningful assertions, fixture isolation, and cross-file consistency.
- **Integration owner:** complete local push gate against the assembled candidate and final browser proof when relevant.
- **CI:** retain all configured repository, integration, and smoke checks.

This is a proposed guidance change, not a change made by the report.
Mechanical violations should receive deterministic checks in existing tooling.
Judgment about coverage placement belongs in review guidance.

### Improve access to failure evidence

The owned server uses inherited output at `scripts/e2e/environment.ts:285-293`.
The harness does not independently persist that stream.
Keep a redacted per-run server log with phase timings alongside existing failure artifacts.
Print its path and the first useful error.
Do not log credentials, session tokens, or operational Employee data.

Bound investigations around an explicit question and smallest next check.
Reuse the first failure's trace instead of launching another full diagnostic run without a changed hypothesis.
Separate product defects, fixture defects, and environment failures before deciding what to rerun.

## 8. Practical rollout and completion criteria

### Today

1. Use Node 24, matching repository engines and CI.
2. Use the focused commands above instead of complete verification after each edit.
3. Let GitHub Actions run browser verification; investigate its artifacts before requesting a local debugging exception.
4. Inspect failure evidence before repeating a command.
5. Keep the existing final push gate and CI jobs.

The research shell reported Node 26.2.0.
That mismatch is not established as a cause of the historical failures.

### This week

| Change                              | Completion criterion                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Validate the existing UI path.      | Two consecutive reruns use the same owned runtime; closing UI cleans up the database and server. Repeat only after lifecycle changes. |
| Clarify gate ownership.             | Workers report focused evidence; one integration owner runs the complete gate after assembly.                                         |
| Add phase measurements.             | Logs separate validation, migration/seed, readiness/probe, browser execution, and cleanup.                                            |
| Improve timeout and failure policy. | Interaction failures do not silently consume repeated five-minute waits; first actionable errors remain visible.                      |
| Correct documentation status.       | Guides describe the existing journey and owned UI command without changing historical records.                                        |
| Review CI duplication.              | Matching push/PR events avoid redundant work without removing required coverage or changing required check names unintentionally.     |

### Only after measuring

Benchmark Node environments for pure, server, and harness suites.
Keep jsdom for component tests that require browser APIs.
Check setup-file and import dependencies before switching any suite. [P8]
Do not remove test isolation merely to improve a timing number.

Record the next normal cold browser run and five normal warm reruns.
Do not run extra complete suites just to populate a dashboard.
Compare the same test, machine, Node version, and fixture conditions.
Track time to the first actionable failure, unnecessary restarts, and complete gate invocations per change.
Separate test duration from command wall time.

No speedup percentage is established by this report.
Set latency budgets from that baseline, not the pasted promises.
Defer sharding, remote execution, predictive selection, and new frameworks until measurements justify them.

## 9. Verification and limits

- Consulted the specified session and nested primary records.
- Inspected repository scripts, configs, fixtures, CI, hooks, and testing guidance.
- Checked installed CLI help: Vitest 4.1.7 and Playwright 1.65.0.
- Read the installed Next.js testing guides and official external sources below.
- Did not rerun E2E, migrations, servers, production builds, or application tests.
- Did not verify branch protection, current historical PR status, billing enforcement, or actual UI-session behavior.
- Deliverables are this report and its documentation-index link.

## Primary sources

[P1]: https://playwright.dev/docs/test-cli
[P2]: https://playwright.dev/docs/test-ui-mode
[P3]: https://playwright.dev/docs/test-parallel
[P4]: https://playwright.dev/docs/auth
[P5]: https://playwright.dev/docs/best-practices
[P6]: https://playwright.dev/docs/test-webserver
[P7]: https://vitest.dev/guide/cli
[P8]: https://vitest.dev/guide/environment
[P9]: https://nextjs.org/docs/app/guides/testing/vitest
[P10]: https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html
[P11]: https://www.typescriptlang.org/docs/handbook/compiler-options.html
[P12]: https://docs.github.com/en/billing/concepts/product-billing/github-actions
[P13]: https://mswjs.io/docs/
[P14]: https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/
[P15]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
[P16]: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching

- [Playwright CLI][P1], [UI Mode][P2], [parallelism][P3], and [sharding](https://playwright.dev/docs/test-sharding).
- [Authentication][P4], [best practices][P5], [recording options](https://playwright.dev/docs/test-use-options), and [web server reuse][P6].
- [Vitest CLI][P7], [affected tests](https://vitest.dev/guide/recipes/affected-tests), [environments][P8], and [performance](https://vitest.dev/guide/improving-performance).
- [Next.js Vitest limitations][P9] and [TypeScript compiler options][P11].
- [Google E2E guidance][P10] and [test-size definitions](https://testing.googleblog.com/2010/12/test-sizes.html).
- [GitHub Actions billing][P12], [merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue), [concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), and [caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
- [MSW's network boundary][P13] and [Meta's predictive-selection report][P14].
