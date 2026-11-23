# Claude Code verification practices in Accent

Recorded 2026-11-21. Source: [How the Claude Code team thinks about verification](https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/) by Addy Osmani, published 2026-11-16.

This note compares that article with Accent's checks. It records existing proof, what this change adopts, and what it deliberately does not copy. The article describes Anthropic's scale; Accent keeps its own tools, CI, and constraints.

## 1. Existing proof

| Practice              | Accent evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| End-to-end            | Three Playwright specs and eight tests. [`payroll-review.spec.ts`](../../e2e/specs/payroll-review.spec.ts) signs in a real admin and checks UI, API projection, and stored rows. [`salary-profiles.spec.ts`](../../e2e/specs/salary-profiles.spec.ts) covers agreement creation through use protection. [`salary-contention.spec.ts`](../../e2e/specs/salary-contention.spec.ts) proves lock order on real MariaDB. CI keeps traces, screenshots, and video for failures. |
| Property              | Four `fast-check` suites: [`money`](../../src/lib/money.property.test.ts), [`salary-ctc`](../../src/lib/salary-ctc.property.test.ts), [`weekly-off`](../../src/utils/weekly-off.property.test.ts), and [`sandwich`](../../src/utils/sandwich.property.test.ts). Oracles come from policy or store invariants; a failing seed must be kept.                                                                                                                                |
| Differential          | [`proposal-canonical-differential.ts`](../../scripts/leads-integration/scenarios/proposal-canonical-differential.ts) evaluates the canonical Proposal contract after a real HTTP delete. Prior author choice identity, single-live-canonical selection, the conflict flag, soft delete, and untouched rows are checked against an independently written rule over seeded rows. The rule is independent of the stored rows, so the fixture cannot decide the answer.       |
| Real-app loop         | The [Leads harness](../app/leads/integration.md) runs the real Next server, HTTP login, disposable MariaDB, and an independent row reader. The [browser harness](../../CODING_STANDARDS.md#owned-browser-runtime) owns its database, migrations, loopback app, and cleanup.                                                                                                                                                                                               |
| Diff-triggered checks | Ten [reliability rows](../agents/reliability-checks.md) pair a diff trigger with a check and evidence. A reviewer runs only matching rows, usually three to ten.                                                                                                                                                                                                                                                                                                          |
| Base-owned checks     | [`test-integrity.yml`](../../.github/workflows/test-integrity.yml) runs on `pull_request_target` with the workflow from the base branch, reads the PR through the API, compares base and head `package.json` scripts, and requires a human `test-change` label. The CI scope classifier runs from the base SHA.                                                                                                                                                           |
| Cheap first           | `changes` → lint and unit → production build and `e2e`. The always-running `verify` job aggregates results. The integration owner runs `npm run verify` before pushing.                                                                                                                                                                                                                                                                                                   |
| Observe and stamp     | `TEST_INTEGRITY_OBSERVE=true` logs what a new gate would block. A commit records `Verified: <command>` or `Verified: none`.                                                                                                                                                                                                                                                                                                                                               |

The [verification map](../agents/verification-map.md) indexes one row per observable outcome: selector, expected result, and owning layer. It marks proposed browser gaps as proposed. Use it instead of restating coverage here. The table above summarizes the same layer split; the map is authoritative for selectors and expected results.

## 2. What this change adopts

- **Updated guidance.** [Testing and verification](../../CODING_STANDARDS.md#testing-and-verification) now asks for observable success before editing, a real-path check at browser/HTTP/database boundaries, a three-round stop, one reviewer across rounds, property and differential rules, and the evidence stamp.
- **The `/verify` skill.** [`.claude/skills/verify/SKILL.md`](../../.claude/skills/verify/SKILL.md) is a six-step procedure. It reads the diff, names success, reuses existing proof, runs the smallest failing check, stops on missing evidence, and records the stamp. It is a checklist, not a required GitHub check.
- **The verification map.** [docs/agents/verification-map.md](../agents/verification-map.md) connects an outcome to maintained proof and its owning layer. It is an index, not a gate.
- **Routing and ownership.** [AGENTS.md](../../AGENTS.md) sends verifiers to the skill. The owner of a changed path maintains its proof, reliability row, and verification changes. The guidance points to existing standards rather than replacing them.

## 3. Controls and limits

- **Failure handling.** After three fix-and-rerun rounds, stop and report the command, first error, and what changed. The configured CI retry is not a substitute for diagnosis.
- **Evidence reuse.** A passing check stays valid only while its checked inputs are unchanged. Rerun affected checks after a fix; do not repeat an unchanged gate for a handoff.
- **Review rounds.** Review one fixed commit under the base branch's rules. Later rounds revisit earlier findings and changed inputs. Label findings as blockers, pre-existing issues, or suggestions. Do not add a second reviewer layer or a `REVIEW.md` clone.
- **Checks outside the change.** Workflow and scope logic come from the base; PR code is not executed by the integrity gate. These controls do not prove merge blocking: required checks are repository settings, not workflow YAML.
- **New gates.** Observe first. Replay the triggering incident and a similar accepted change, record misses and false alarms, then ask a maintainer to enable blocking. No new hook or gate is added here.
- **Review evaluation.** The article tracks reverts, rejected changes, clean controls, and a fixed evaluation set. This change does not create a reviewer-evaluation program; that needs its own dataset, ownership, and decision rules.
- **Misses into rules.** Add evidence to an existing reliability row before creating a new one. The owner approves or prunes the rule. Keep the list small.

A human reviews any change to a test, harness, lint rule, or workflow before the `test-change` label is added.

## 4. Deliberate non-copies

- **No new services or tooling.** No Chrome extension, CDP server, MCP device, computer-use runner, remote cache, test-result service, or paid capacity.
- **No mandatory local browser.** GitHub Actions runs routine E2E and integration. Local browser use is an explicit user-authorized debugging exception and requires `--local-run-reason`.
- **No merge-protection claim.** The YAML defines jobs; repository required-check settings decide enforcement. This change does not touch branch settings.
- **No commit hook or enforcement gate.** `/verify`, `/code-review`, and the evidence stamp are procedures, not blocking hooks. The existing observe mode is the model for any future gate.
- **No reviewer metrics program.** Revert rate, rejection rate, clean controls, and a fixed evaluation set are not introduced.
- **No production-traffic differential testing.** Cases use seeded synthetic data and a reviewed case list. No `REVIEW.md`, no 39-row checklist clone. The article's scale techniques are not prerequisites for Accent's verification.

## 5. Preserved constraints and scope

- GitHub Actions owns routine Playwright and integration runs. The CI `e2e` job uses one MariaDB 10.11 service; each harness still owns its database, app process, and cleanup.
- The Leads integration can be run locally as an opt-in debugging step against a loopback, disposable MariaDB target. Local runs never use development, staging, production, or `.env`.
- CI and local runs use Node 24 on standard `ubuntu-latest` runners, targeting zero paid Actions usage.
- Local browser runs stay loopback-only, disposable, and reason-bearing.
- This is a documentation and skill change. It ran no build, database, unit test, or browser check, so it provides no runtime evidence that any check passes.
