# Accent CRM — Agent Guide

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Communicating with the user

Use simplified technical English: one idea per sentence, active voice, plain words, and sentences under 20 words. Define technical terms once.

Ask only when blocked on a safe or correct choice. Otherwise proceed with a stated assumption. Report changes and material uncertainty.

## Task references

- **Implement, fix, refactor, or delegate code:** read [new files and implementation](CODING_STANDARDS.md#new-files-and-implementation) and the [development loop](CODING_STANDARDS.md#development-loop).
- **Format values, style UI, fetch client data, or build forms:** read [formatting and presentation](CODING_STANDARDS.md#formatting-and-presentation) and [client data and forms](CODING_STANDARDS.md#client-data-and-forms).
- **Change authentication, security, API routes, authorization, rate limits, or uploads:** read [authentication and security](CODING_STANDARDS.md#authentication-and-security).
- **Change queries, migrations, schemas, pools, or database-backed behavior:** read [database and data invariants](CODING_STANDARDS.md#database-and-data-invariants).
- **Change billing, salary, payroll, timesheets, or employee costs:** read [money and payroll](CODING_STANDARDS.md#money-and-payroll).
- **Review code, choose checks, add tests, or change build/deployment automation:** read [testing and verification](CODING_STANDARDS.md#testing-and-verification).
- **Review a diff or verify a change:** read [reliability checks](docs/agents/reliability-checks.md) and run only the rows whose trigger matches.
- **Run local MariaDB, integration tests, or browser tests:** read [local database operations](docs/agents/local-database.md).
- **Verify a browser journey or investigate an E2E failure:** follow [CI-owned browser verification](CODING_STANDARDS.md#owned-browser-runtime).
- **Change domain terms or ADRs:** follow [the domain documentation workflow](docs/agents/domain.md).
- **Work on GitHub issues:** follow [the issue tracker workflow](docs/agents/issue-tracker.md).
- **Triage labels:** follow [the triage-label workflow](docs/agents/triage-labels.md).
