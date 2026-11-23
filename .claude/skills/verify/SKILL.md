---
name: verify
description: Prove a change works before commit — observable success, matching incident rows, real-behavior evidence, and the verification stamp.
disable-model-invocation: true
argument-hint: '[base revision, commit, or changed scope]'
---

# Verify

Prove the change produces the result a person or caller observes. Verification
runs the change on the real system and records evidence; a green check that
cannot see the change proves nothing.

Use this before committing, or when asked to verify a commit or branch. Run the
pre-push local gates before pushing. When proof needs CI or a browser, push and
report that evidence as pending until its artifact exists.

## 1. Read the diff

Read the full diff for the scope in `$ARGUMENTS` against its base. Identify each
changed behavior and the surface it reaches: pure logic, component, API route,
database, browser journey, CI, or a test itself.

**Done when:** you can name the behavior that changed and every surface it
touches. File names alone are not enough.

## 2. Name observable success

Before running anything, write the expected result as a pass/fail sentence:
the request and status, the visible UI state after the action, the persisted
row, or the job result. Add the observation that would show the opposite.

For a bug fix, start from the incident or reproduction and state the result
that changes.

**Done when:** the expected and the failure observation are both specific
enough that a wrong result cannot pass as right.

## 3. Select proof from existing evidence

Open the [verification map](../../../docs/agents/verification-map.md) and find
the rows matching the changed feature. Reuse the suites, scenarios, and
artifacts it names instead of inventing parallel checks.

Then read [reliability checks](../../../docs/agents/reliability-checks.md) and
take only the rows whose trigger appears in the diff, usually three to ten.
Prefer the lowest layer that can prove the behavior:

- **Pure logic:** unit or property tests, with no DB, network, or `fetch`.
- **Component:** render the real component with realistic payloads and assert
  observable accessibility or behavior.
- **HTTP contract:** route tests for status, authorization, and payloads.
- **SQL, constraints, migrations, transactions:** real MariaDB 10.11
  integration.
- **Critical journey across browser, HTTP, and database:** a browser spec, run
  in CI as described in step 4.
- **Rewrite that must preserve behavior:** differential test with the old
  system as the oracle and a list of approved differences.

Property tests cover invariants and edge cases the author did not imagine.
Differential tests cover migrations where the old system is the oracle.

For a documentation-only change, check affected links, anchors, and
formatting. Skip the app build, database, and browser run unless the task
needs runtime proof.

**Done when:** each planned check has a reason tied to a changed surface, and
any surface with no matching existing evidence is named as a gap.

## 4. Prove real behavior

Run the smallest check that can fail on the changed behavior. When the change
crosses the browser, HTTP, or database boundary, exercise the real path and
inspect the result — not startup, a passing build, or a log line.

- Use the test layers and development loop in
  [testing and verification](../../../CODING_STANDARDS.md#testing-and-verification).
  The environment and command definitions there are the source of truth.
- Before every push, run the local gates it requires. A local pass is not
  browser proof.
- Routine browser verification runs in the GitHub Actions `e2e` job. Reuse its
  failure artifacts. A local browser run requires explicit user authorization
  for debugging; follow
  [owned browser runtime](../../../CODING_STANDARDS.md#owned-browser-runtime)
  and read [local database operations](../../../docs/agents/local-database.md)
  first. Never start a local suite as a completion gate or to replace CI.
- Push when CI-only evidence is required, then report the job and artifact as
  pending. Continue only with local proof while it runs.
- Use Node 24 and a disposable loopback MariaDB owned by the harness. Never
  edit `.env`, reuse an existing database, or attach to an unowned server.
- Capture what the run proved: command or CI run, selected scope, tested
  revision, expected result, observed result, and the trace, screenshot, or
  row that shows it.

**Done when:** the observed result matches step 2 and its evidence location is
recorded, or the remaining proof is a named pending CI run or a precise gap.

## 5. Stop on these conditions

- **Missing evidence.** Stop and report the gap. A bare claim, passing build,
  startup log, or green check that cannot observe the change is not proof.
  Concrete evidence another agent recorded is reusable while its inputs are
  unchanged; cite it instead of rerunning.
- **Unchanged evidence.** Stop rerunning a successful check while its inputs
  are unchanged. After a fix, rerun the affected focused check, then the shared
  gate against the final candidate.
- **Unchanged test.** A test the diff did not touch and that cannot go red on
  the changed behavior is not evidence. Select the check that observes the new
  behavior instead.
- **Repeated failure.** After three fix-and-rerun rounds, stop and report the
  command, the first actionable error, and what changed on each attempt. A
  human decides the next step. Do not retry blindly or weaken the check.

Never edit a test, harness, assertion, or CI workflow to obtain a green result.
A verification change needs human review before the `test-change` label.
Preserve first-failure evidence.

## 6. Stamp the commit

Stamp the final commit with the verification that actually ran, using the exact
form owned by
[testing and verification](../../../CODING_STANDARDS.md#testing-and-verification):
`Verified: <command or CI job>` or `Verified: none`. Use `none` when no
runtime check ran, including documentation-only changes, and state the gap.
Pending CI stays a reported gap until its artifact exists.

The stamp reports evidence; it does not replace the expected and observed
result from step 4.
