# Next.js 16 Upgrade — Type & Lint Debt Follow-ups

> Generated 2026-08-24 after the Next.js **15.5.18 → 16.3.2** upgrade (`middleware.ts` → `proxy.ts`, Turbopack default, native ESLint flat configs).
> Complements `APP_HEALTH_ROADMAP.md` and `POOR_PRACTICES_AUDIT.md` — covers only the debt deliberately deferred during the upgrade to keep that diff reviewable. Nothing below blocks shipping; all gates were green at hand-off.

## Upgrade state at hand-off

| Gate               | Status                         | Caveat                                              |
| ------------------ | ------------------------------ | --------------------------------------------------- |
| `npm run lint`     | ✅ 0 errors                    | 397 warnings (see Item 3)                           |
| `npx tsc --noEmit` | ✅ clean                       | `src/__tests__` excluded from tsconfig (see Item 2) |
| `npm run test:run` | ✅ 86/86 suites, 604/604 tests | —                                                   |
| `npm run build`    | ✅ Turbopack production build  | Type-checks app code only, per tsconfig             |

Proven at upgrade time via a clean-HEAD worktree probe: all type errors below pre-date the upgrade (identical count at HEAD); the upgrade introduced zero regressions.

---

## Item 1 — Unused vars cleanup (194 warnings)

- **Where:** ~30 files, heaviest: `src/utils/payroll-calculator.js` (~15), `src/utils/schema-init.js` (6), `src/utils/database.js` (3), `src/lib/migration.stub.js`, `src/context/SessionContext.jsx`.
- **Impact:** Noise only — but it buries real signal from the compiler rules in Item 3, and some entries are genuine dead code (e.g. `jsonwebtoken` is installed and unused per `docs/SECURITY_AUDIT.md` §watch-items).
- **Fix:** Mechanical delete/rename/underscore-prefix per site. Where an unused param documents a callback shape, rename to `_name` rather than removing.
- **Effort:** ~1 hr. **Risk:** near zero.

## Item 2 — Test-file typing debt (124 errors) → re-include `src/__tests__`

- **Where:** `src/__tests__/api/**` route tests mostly. Distribution: 42× TS2322 (assigning fixtures to `never[]`/`null` mock params), 29× TS18048 (`mock.calls[0][x]` possibly undefined), 21× TS2339 (`.json` on literal request stubs, `.code/.errno/.sqlMessage` on `Error`), 10× TS2741 (missing ref props in tab tests), 9× TS2345, 6× TS2739, rest singletons.
- **Impact:** Tests are invisible to `tsc --noEmit` and to `next build` type-checking until this is fixed. Runtime is fully covered by the 604 vitest tests, so nothing is untested today — but future API-signature drift won't be caught by types in test files.
- **Fix:** Tighten `vi.fn<...>` generics, add non-null assertions or guards on `mock.calls`, extend request stubs, add missing props to rendered tab components. Then remove `"src/__tests__"` from `exclude` in `tsconfig.json` and confirm both gates stay green.
- **Effort:** ~half a day. **Risk:** low (type-only changes; suite must still pass).

**Live checklist:** temporarily remove the exclude and run `npx tsc --noEmit` — the full error list regenerates itself.

## Item 3 — React Compiler lint burn-down (186 warnings) → re-promote rules

These rules are new in `eslint-config-next@16` and were demoted to `warn` in `eslint.config.mjs` during the upgrade (see the comment block there). They flag render-correctness patterns, not style. Burn down one rule per PR; flip each back to `'error'` in `eslint.config.mjs` when it reaches zero.

| Rule                                      | Count | Typical sites                                                                                                | Real-world failure mode                                                                                              |
| ----------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `react-hooks/set-state-in-effect`         | 114   | `TodoList.jsx`, `SessionContext.jsx`, `dashboard/*`, `ui/searchable-select.jsx`, `use-searchable-select.ts`  | Cascading renders / fetch-on-mount loops; usually fix = derive state or move fetch out of effect body                |
| `react-hooks/immutability`                | 21    | `work-logs/page.jsx`, `admin/da-schedule`, `admin/tickets`                                                   | Use-before-declare inside callbacks (TDZ ordering); can break under compiler memoization                             |
| `react-hooks/static-components`           | 20    | `Navbar.jsx` (`NavRow` defined inline, ~18 usages)                                                           | Inline component identity changes every render → children remount, state resets. Fix = hoist component out of render |
| `react-hooks/purity`                      | 14    | `use-autofill.ts` (`Math.random` IDs), `useActivityTracker.js` / `useIdleMonitor.js` (`Date.now()` ref init) | Impure render → unstable output across re-renders. `Math.random` IDs should come from `useId()`                      |
| `react-hooks/refs`                        | 9     | `ProjectMemberDetails.tsx`, `useActivityTracker.js` (returns `isIdleRef.current`)                            | Reading refs during render → stale UI. Return state or read inside effects/handlers                                  |
| `react-hooks/preserve-manual-memoization` | 7     | `useActivityTracker.js`, `useIdleMonitor.js` (`[user?.id]` vs inferred `[user]`)                             | Compiler skips optimizing the hook; deps drift between intent and reality                                            |
| `react-hooks/incompatible-library`        | 1     | `EmployeeReportCard.tsx` (`useReactTable`)                                                                   | Known TanStack Table interop limitation — candidate for a documented disable, not a code change                      |

Guidance:

- **Not every warning deserves a code change.** A `useRef(Date.now())` initializer runs once per mount and is benign; for accepted patterns use `// eslint-disable-next-line react-hooks/purity -- <reason>` instead of contorting working code.
- **Start with `set-state-in-effect`:** it's 57% of the volume AND the most likely to hide real bugs.
- After each re-promotion: `npm run lint && npm run test:run && npm run build`, then manually smoke the touched screens (render behavior changed, not just syntax).
- `Navbar.jsx` alone clears most of `static-components`; `useActivityTracker.js` + `use-searchable-select.ts` clear most of three rules combined — good first targets.

## Item 4 — Misc pre-existing warnings (17)

- 12× `react-hooks/exhaustive-deps` (pre-existing rule) — review individually; missing dep `queueActivityData` already flagged in `useActivityTracker.js:301`.
- 4× `@next/next/no-img-element` — switch to `next/image` or disable per-site with reason (uploads-as-attachment flows may intentionally use `<img>`).
- 1× `@next/next/no-location-assign-relative-destination` — verify and fix or justify.

## Related non-lint follow-ups from the same hand-off

- `npm audit`: 13 vulnerabilities (1 critical, 10 high, 2 moderate) in dependency tree lines already tracked as watch items in `docs/SECURITY_AUDIT.md` §409 (exceljs, html2canvas, puppeteer-core duplication). Do **not** run `npm audit fix --force` blind — it force-bumps majors.
- Local dev machines may warn `EBADENGINE` (Node 26 present, `engines` pins `24.x`) — align either way deliberately.

Verification when items land: update this file's tables to zero and tick each rule back to `'error'` in `eslint.config.mjs`.
