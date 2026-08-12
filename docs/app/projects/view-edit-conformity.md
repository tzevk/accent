# Project View — Edit Conformity

## Overview

`src/app/projects/[id]/page.jsx` (project **view** mode) previously used a different design language from `src/app/projects/[id]/edit/EditProjectForm.jsx` (project **edit** mode): a decorative hero card with uppercase chips and a purple-filled active tab, versus the edit page's compact sticky header, token-purple panel headers, and gray tab track with a white active pill. Both are the same screen in different modes, so the view was restyled to the edit's chrome and panel language. The edit form was left untouched and used as the reference.

**Page:** `src/app/projects/[id]/page.jsx` (only file changed)

---

## What changed

### Chrome

| Area           | Before (view)                                                                                                 | After (matches edit)                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page container | `h-screen` + inner `overflow-y-auto` scroller (also clipped the bottom 64px inside the navbar-padded wrapper) | `min-h-screen` normal document flow, `max-w-[1800px] px-4 sm:px-6 lg:px-8 xl:px-10` gutters                                                                                                                                    |
| Header         | Hero card (`rounded-2xl`, blur blob, "PROJECT OVERVIEW" chip, 3xl title, description)                         | Edit's sticky compact header: circular back-arrow button (→ `/projects`, or `/user/dashboard` for employees), "Project Overview" h1 + purple name pill, meta row (Code · client · blue status pill), description line, actions |
| Header actions | "Edit Project" outlined + "Configure Activity Library" solid hex-purple                                       | "Edit Project" primary `bg-purple-600`; "Configure Activity Library" demoted to neutral bordered secondary (one primary per view, per color rules)                                                                             |
| Tab bar        | White container, chevron scroll buttons, purple-filled active tab, wheel-hijack listener                      | Edit's gray track (`bg-gray-50 p-1` track, white active pill `bg-white text-purple-700 ring-1 ring-gray-200`); chevrons and the wheel listener removed (it blocked vertical page scroll over the strip)                        |
| Tab semantics  | WAI-ARIA tabs (roving tabindex, arrow keys)                                                                   | **Kept** — the edit's `aria-pressed` buttons are weaker; visuals match, semantics stay                                                                                                                                         |

### Panels

- Every live section header converted to the edit `ProjectDetailsTab` pattern: icon tile (`rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100`), `h-4 w-4 text-purple-600` icon, `text-base font-semibold tracking-tight` title, `text-xs text-gray-500` subtitle.
- Subtitles copied verbatim from the edit tabs where they exist: "Core project details and metadata" (Project Details), "Track deliverables issued to client" (Deliverables), "Log project queries and responses" (Query Log), "Record project assumptions and rationale" (Assumption), "Capture learning from the project" (Lessons Learnt), "Record documents received with details" (Documents Received).
- Scope keeps its gradient header — byte-identical to the edit's `ScopeTab`.
- Removed `hover:shadow-md hover:border-[#7F2487]/30` from 17 read-only cards (false affordance on non-interactive content).
- `text-black` → `text-gray-900` (26×); hardcoded `#7F2487` → Tailwind purple tokens in all live paths (per AGENTS.md color rules).

### Tabs

- Labels aligned to the edit: `Meetings` → `Meeting`, `Project Schedule` → `Schedule`, `List of Deliverables` → `Deliverables`, `Project Handover` → `Progress Measurement`.
- Order reordered to the edit's sequence (Details, Scope, Activity, Schedule, Documents Received, Deliverables, Meeting, Progress Measurement, Manhours, Query Log, Assumption, Lessons Learnt, Upload Documents).
- `List of Documents Received` **kept** — it renders `documents_received_list`, which the edit's visible "Input Document" tab does not (`input_documents_list` is a different dataset); renaming would mislabel.

---

## Behavior fixes found during verification

1. **Meeting tab rendered a blank panel.** The tab existed in `TAB_CONFIG` but no panel was rendered for it. Added a read-only panel (Project Meetings — kickoff + internal meetings from `kickoff_meetings_list` / `internal_meetings_list`) using the same card language as the sibling panels.
2. **Admins landed on the Scope tab.** Pre-existing session-race: before `/api/session` resolves, `can()` returns false → `isEmployeeWorkspace` is true → the tab-default effect picked `scope` (first employee tab); after the session flips the workspace, the admin list still contains `scope`, so the default was never reset. Added a workspace-flip reset (`isEmployeeRef`) — admins now land on Project Details like the edit; employees still land on Scope.
3. **Error state crashed on non-string errors.** `{error || 'Project not found'}` rendered a thrown `Error` object as a React child when `/api/projects/[id]` failed (401/network). Hardened to `error?.message || error || 'Project not found'`.
4. Removed the dead `scopeSummary` memo (lint warning).

---

## Verification

- `next lint --file src/app/projects/[id]/page.jsx` — clean.
- `tsc --noEmit` — 0 errors in this file (114 pre-existing errors elsewhere, untouched).
- `prettier --check` — clean.
- `npx vitest run src/__tests__/projects/[id]/page.test.tsx` — 2/2 pass.
- Browser (dev server, super-admin session, 1440×900):
  - Admin default lands on Project Details → "General Project Information" panel; all 13 tabs render their panels.
  - Employee workspace renders its 9 tabs, defaults to Scope, back button → `/user/dashboard`.
  - Side-by-side comparison of view vs edit confirms identical header / tab-bar / panel-header structure (mode titles differ: "Project Overview" / "Edit Project").
  - Error path (bad project id) shows the message instead of crashing.

---

## Files changed

| File                             | Change                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/projects/[id]/page.jsx` | Chrome and panel restyle, tab config realignment, read-only Meeting panel, workspace-flip tab default fix, error-state hardening, dead-code removal (scroll machinery, `scopeSummary`) |

---

## Known follow-ups (deliberately not done)

- **Inert `sticky top-0` on both pages.** An `overflow-x-hidden` ancestor becomes the sticky scroll container, so the edit page's sticky header scrolls away (verified: `stickyTop = -121` at max scroll). The view behaves identically, so it is conformant. To restore true stickiness on both: change the outer `overflow-x-hidden` to `overflow-x-clip` (does not create a scroll container) on `page.jsx` and `edit/EditProjectForm.jsx`.
- **Unreachable panels.** Both files carry dead `hidden=` sections (`commercial`, `activities`, admin `team`, `procurement`, `construction`, `risk`, `closeout`) whose tab ids are in neither `TAB_CONFIG` nor the edit `TABS`. Left intact to keep the files symmetric; candidates for removal if the tab configs are ever pruned.
- **`documents_received_list` vs `input_documents_list`.** The view shows the former; the edit's visible "Input Document" tab edits the latter. If the legacy list is meant to be retired, the view's Documents Received panel should read `input_documents_list` instead.
