# Contributing

Thanks for your interest in contributing! This repo follows a simple PR-first workflow.

## Branching

- Create a branch from `main`:
  - `feat/<short-topic>` for features
  - `fix/<short-bug>` for bugfixes
  - `chore/<what>` for chores/refactors

Examples: `feat/sidebar-hover`, `fix/upload-timeout`, `chore/update-readme`

## Commits

- Write clear, imperative commit messages:
  - `fix: handle null salary structure`
  - `feat: thumbnail generation for uploads`

## Pull Requests

1. Push your branch to origin
2. Open a PR to `main`
3. Fill out the PR template
4. Request review (use CODEOWNERS)
5. Address feedback and merge via squash (preferred)

## Code style

- Run `npm run lint` before pushing.
- Keep UI changes scoped and consistent with Tailwind utilities.

## Tests

- Prefer minimal tests for new features and at least one happy-path.
