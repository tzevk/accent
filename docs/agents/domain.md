# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **[`GLOSSARY.md`](../../GLOSSARY.md)** at the repo root: the canonical vocabulary for domain concepts.
- **[`docs/adr/`](../adr/)**: read the ADRs that touch the area you're about to work in.
- **[`docs/README.md`](../README.md)**: the index of published guides, audits, plans and decisions.

This repo is **single-context**: one root `GLOSSARY.md` plus `docs/adr/`. If a root `GLOSSARY-MAP.md` ever appears, it points at one `GLOSSARY.md` per context — read each one relevant to the topic, and check `src/<context>/docs/adr/` for context-scoped decisions.

If a file you expect doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates these lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0010 (logged-hours pay basis), but worth reopening because…_
