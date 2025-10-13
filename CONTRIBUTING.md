# Contributing

Thanks for your interest in contributing! This project uses a PR-first workflow on top of `main` and a straightforward branching + review process.

This is a Next.js (App Router) + React 19 app with Tailwind CSS v4 and a MySQL backend (via `mysql2`). Image processing is handled with `sharp` on the server. Keep these in mind when proposing changes.

## Quick start

1) Install dependencies

```bash
npm install
```

2) Development server

```bash
npm run dev
```

3) Lint and build locally before opening a PR

```bash
npm run lint
npm run build
```

Optional backend setup helpers exist in the repo (e.g., `setup-backend.js`, `setup-database.js`). Configure your local `.env.local` appropriately and avoid committing secrets.

## Branching

Create short-lived branches off `main` using these prefixes:

- `feat/<topic>` for features
- `fix/<bug>` for bugfixes
- `chore/<what>` for chores/refactors

Examples:

- `feat/sidebar-hover`
- `fix/upload-timeout`
- `chore/update-readme`

## Commit messages (Conventional Commits)

Use conventional-style messages to help reviewers and future you:

- `feat(ui): hover-expandable sidebar`
- `fix(api): handle null salary structure`
- `chore(docs): add PR template`
- `refactor(db): consolidate connection pooling`

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`.

## Pull Requests

1. Push your branch to origin
2. Open a PR to `main` (a template will prefill details)
3. Fill out the checklist, add screenshots/Loom for UI changes
4. CODEOWNERS will auto-request reviewers
5. Ensure checks pass (lint/build) and address feedback
6. Prefer "Squash and merge" for a tidy history

### PR quality checklist

- Scope: one focused change per PR (easy to review, easy to revert)
- Build: `npm run build` passes locally
- Lint: `npm run lint` passes; no new warnings where practical
- UI: include before/after screenshots for visual changes
- API/DB: call out any contract or schema changes (see Migrations)

## Code style and architecture

- Tailwind CSS v4 utilities for layout/styling; keep class lists readable and consistent
- Next.js App Router: prefer server components where possible; use `"use client"` only when needed
- Avoid hook-order violations (always call hooks unconditionally)
- Prevent hydration mismatches (don’t rely on browser-only APIs during SSR)
- Image uploads: server validates and normalizes images using `sharp` (PNG conversion, orientation, size); don’t bypass the existing upload API
- API routes live under `src/app/api/*`; keep handlers small, validate inputs, and handle timeouts gracefully
- Database access via `src/utils/database.js` (pooled connections, timeouts). Don’t block the event loop; prefer async/await with proper error handling

## Migrations and schema changes

When altering the database schema, add a migration script under `src/utils/migrations/` and note it in your PR description. Keep migrations idempotent when possible.

## Testing

At minimum, manually verify your change touches the expected flows. If you add a new API or complex logic, include a tiny test or a repro script under `scripts/` and document how to run it in the PR.

## Security & secrets

- Never commit secrets. Use `.env.local` for local dev
- Sanitize and validate all inputs in API routes
- Treat uploaded files as untrusted; keep validation in place

## Review & merge policy

- Two approvals (if available) or one owner approval via CODEOWNERS
- Squash merge to `main`
- Resolve all review comments or create follow-ups before merge

## Reporting issues

Open a GitHub issue with a concise title, steps to reproduce, expected vs actual, and environment details. Include logs and screenshots where relevant.
