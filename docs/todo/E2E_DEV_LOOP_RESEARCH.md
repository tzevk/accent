# E2E Dev-Loop Research Brief

Status: OPEN research task. Problem observed during spec tzevk/accent#304 (Oct 2026).

## Problem

The mandated verification method — full Playwright suite against the real app + dedicated
MySQL DB on every fix — is too slow for development. Nine full verification runs were needed
(VERIFY1..VERIFY9), each ~7–12 min, because:

1. Serial specs stop at the first failure, hiding deeper failures in the same file. Each run
   exposes only one layer per spec; the next layer surfaces only after a fix + full rerun.
2. One shared verification DB and one server port serialize all runs. No parallel dev runs.
3. The full suite reruns ~250 tests even when a fix touches one spec.

## Constraints (must keep)

- Real app + real database proof. No mocks, no source-text pins (repo rule).
- JSON artifacts must reflect real outcomes (`ok:false` on failure).
- Deterministic namespaced fixtures; never touch real payroll data.

## Research questions

1. Per-spec targeted runs: can a developer run one spec file against a disposable DB clone
   (seed once, run, drop) instead of the full suite, with the full suite reserved for
   integration gates?
2. Fail-through mode: can serial specs continue past a first failure (soft asserts /
   per-test isolation with cleanup) so one run exposes all layers?
3. Sharding: can the suite split across workers/ports/DB schemas to cut wall time?
4. Layered gates: cheap static + unit + single-spec smoke first, full suite only on green?
5. Fixture scoping: smaller per-spec seed sets so setup/teardown stays under seconds?

## Success criteria

- A single-spec fix verifies in under 3 minutes end-to-end (seed + run + artifact).
- Full suite stays the merge gate but runs at most once per integration tip.
- No loss of proof strength: API + independent DB asserts + artifacts unchanged.
