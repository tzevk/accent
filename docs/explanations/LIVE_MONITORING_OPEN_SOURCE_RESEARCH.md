# Live Monitoring Open-Source Research

Research note (2026-10-19). Implementation scope remains unconfirmed:
CRM presence (recommended), work review, or device monitoring.

Prior work, not repeated here: `user_presence` one-row-per-user store,
SQL-computed recency (`TIMESTAMPDIFF`), route-aware `current_page`, widened
online window, and admin-gated `GET /api/user-status` are recorded in
[Live monitoring presence](../todo/LIVE_MONITORING_PRESENCE.md).

## TL;DR

- Least-complex fit for Next 16 + React 19 + MySQL + TanStack Query is:
  keep the existing `user_presence` write path and improve only the dashboard
  read path with TanStack Query polling/focus semantics already in the repo.
  No new service, no Redis, no hosted dependency.
- Borrow ideas from Zulip presence and ActivityWatch; do not install either
  system.
- Supabase Realtime and Liveblocks are heavier/hosted alternatives. They do
  not fit “MySQL, no new infra” unless the product explicitly wants realtime
  websockets or hosted collaboration.
- Browser presence measures “this CRM tab recently reported”, not attendance,
  logged hours, or productivity.

## What each term means

| Term                         | Measures                                                                   | Accent source of truth                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser presence             | A logged-in CRM tab recently sent a heartbeat and whether it reported idle | `user_presence.last_seen`, `is_idle`, `current_page`                                                                                             |
| Application interaction time | Active vs idle deltas inside the CRM tab                                   | Heartbeat `activeDeltaMs`/`idleDeltaMs`, screen-time bucketing                                                                                   |
| Attendance                   | Physical presence for the workday                                          | SmartOffice/device punches pipeline, not browser timers; see [SmartOffice attendance pipeline](SMARTOFFICE_ATTENDANCE_PIPELINE.md)               |
| Logged hours                 | Payable/work-review hours                                                  | Timesheets, daily entries, payroll basis; see [Daily activity entries](activity-daily-entries.md) and payroll ADRs in [docs index](../README.md) |
| Productivity                 | Value/outcome of work                                                      | No timer measures this; see below                                                                                                                |

Conflating these produces false management signals. A developer in a meeting,
reviewing paper, coding in an IDE, or on another device can be working while
CRM presence says idle/offline.

## Browser-only measurement limits

Browser presence can only observe the CRM tab that reports it:

- Hidden/background tabs are throttled; browser scheduling can delay
  heartbeat timers. Accent treats hidden tabs as idle and uses recency
  thresholds to expire stale presence.
- `visibilitychange`/focus tells “tab visible/focused”, not “human at desk”.
  TanStack Query’s default focus refetching is built on the same
  `visibilitychange` signal.
  Source: <https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching>
- No visibility into other apps, OS lock, phone work, paper work, meetings,
  second browser/device, or network loss.
- Multi-tab and clock issues remain: peer audit input flags last-writer `idle`
  risk and additive screen-time risk when several tabs report, plus a
  mixed-ID auth defect. This research does not fix them; proposed scope below
  carries them forward for triage.
- Zulip states the same limit directly: for an idle web user, “The Zulip
  server has no way of distinguishing” between idle-at-computer and
  left-desktop-on.
  Source: <https://zulip.com/api/update-presence>

## Why presence is not productivity

- ActivityWatch FAQ: tracking is an estimate; “what should be considered
  being ‘active’ is subjective”, and AFK detection misses engagement without
  mouse/keyboard input.
  Source: <https://docs.activitywatch.net/en/latest/faq.html>
- Zulip availability is “Active/Idle/Offline” for responsiveness expectations,
  not output. Active means Zulip open and in focus within the last 140
  seconds; idle means open but not active; offline means not open or invisible
  mode.
  Source: <https://zulip.com/help/status-and-availability>
- Presence answers “can this person plausibly see a CRM notification now?”
  It does not answer “did they work?”, “how long did they work?”, or “how
  well did they work?”

## Option 1 — ActivityWatch patterns, not the system

ActivityWatch is a local-first, personal time tracker: watchers collect OS,
window, browser, editor, and AFK events into buckets; a local server stores
them in SQLite; a web UI visualizes them.

Sources:

- Intro/data philosophy: <https://docs.activitywatch.net/en/latest/introduction.html>
- Architecture: <https://docs.activitywatch.net/en/latest/architecture.html>
- Buckets/events/heartbeats: <https://docs.activitywatch.net/en/latest/buckets-and-events.html>
- Watchers: <https://docs.activitywatch.net/en/latest/watchers.html>
- AFK/accuracy FAQ: <https://docs.activitywatch.net/en/latest/faq.html>
- Remote-server warning: <https://docs.activitywatch.net/en/latest/remote-server.html>

Useful patterns to reuse:

- One bucket per watcher/host; events are `{timestamp UTC, duration, data}`.
- Heartbeat merging within `pulsetime`: identical adjacent events merge to
  save storage/IO. Accent already has an analogous heartbeat; the idea of
  “merge at write, interpret at analysis” is the reusable part.
- AFK as “seconds since last input” with a timeout (default 3 minutes),
  configurable via `aw-watcher-afk.toml`; media-audible can count as not-AFK.
- Zero-duration events are left ambiguous until analysis (`flood`/heuristics),
  not guessed at write time.

Why not install it:

- Explicitly local-first and user-owned; data stays on-device in SQLite.
- Remote/centralized employee monitoring is “not supported and strongly
  discouraged”: unauthenticated API by default, no HTTPS, not designed for
  central reporting, future updates may break remote setups, and the project
  asks not to use it for employee monitoring.
  Source: <https://docs.activitywatch.net/en/latest/remote-server.html>
- It would require desktop agents/extensions per employee, a second data
  estate, and privacy/security review. It does not answer CRM presence.

Facts:

- License: MPL-2.0. FAQ says “licensed under the MPL-2.0 license”;
  bundle license text is MPL-2.0.
  Sources: <https://docs.activitywatch.net/en/latest/faq.html>,
  <https://github.com/ActivityWatch/activitywatch/blob/master/LICENSE.txt>
- Maintenance: bundle releases `v0.14.0` on 2026-10-06 and `v0.14.1` on
  2026-10-10 (release feed observed 2026-10-19).
  Source: <https://github.com/ActivityWatch/activitywatch/releases>
- Popularity observed 2026-10-19 on repo page: 19.3k stars, 1.0k forks,
  131 watching. GitHub API returned HTTP 403, so feed/repo-page values were
  used instead of API metadata.
  Source: <https://github.com/ActivityWatch/activitywatch>

License constraint: MPL-2.0 is file-level copyleft for covered files. Reading
docs and reimplementing ideas in Accent’s own code is the safe pattern; copying
ActivityWatch source files into the repo would carry MPL obligations for those
files (preserve notices, provide source for covered files). No legal review
was done.

## Option 2 — Zulip presence patterns, not the server

Zulip presence is the closest “team product presence” model: browser/desktop/
mobile clients report active/idle; the server stores compact presence state
and serves all-users and single-user reads plus realtime events.

Primary API sources (use `zulip.com`, not readthedocs subsystem URLs):

- Report + poll: <https://zulip.com/api/update-presence>
- All users: <https://zulip.com/api/get-presence>
- One user (e.g. employee directory embed): <https://zulip.com/api/get-user-presence>
- Realtime queue/long-poll: <https://zulip.com/api/get-events>
- User-facing states/invisible mode: <https://zulip.com/help/status-and-availability>

Protocol facts:

- `POST /users/me/presence` both reports current-user status (`active`/`idle`)
  and optionally returns org presence via polling.
- Important request fields: `status` (required), `new_user_input` (interaction
  since last report, also feeds usage stats), `ping_only` (update without
  fetching org data), `last_update_id` (incremental fetch cursor),
  `history_limit_days` (default 14 days for initial fetch). `slim_presence`
  is deprecated in favor of `last_update_id`.
- Response cursor: `presence_last_update_id`; clients pass it back to avoid
  redundant fetches. Zulip warns presence is “one of the most expensive parts
  of any chat application (in terms of bandwidth and other resources)”.
- Modern presence fields are `active_timestamp` and `idle_timestamp`, plus
  `server_timestamp`. Legacy `website`/`aggregated` dictionaries are identical
  since Zulip 7.0 (feature level 178) because “the server no longer stores
  which client submitted presence updates”. Do not describe current Zulip as
  per-client rows.
- Realtime path: consume `presence` events from a registered event queue
  (`GET /events`, long-poll) for immediate online transitions, with polling
  as the fallback.
- Privacy: server implements invisible mode (always appear offline, frozen
  “last active”); clients still check `presence_enabled`.

Why not install Zulip:

- Zulip is a full team-chat server expecting a dedicated machine/VM, supported
  Ubuntu/Debian, PostgreSQL, Redis/RabbitMQ-class services, DNS, SMTP, and
  sole tenancy on the host.
  Source: <https://zulip.readthedocs.io/en/latest/production/requirements.html>
- Accent needs a CRM admin dashboard over MySQL, not chat. Installing Zulip
  would add a second user directory, auth system, database, and ops burden.

Patterns worth reusing:

- Split “interaction happened” (`new_user_input`) from “client in focus”
  (`status`). Accent already has an analogous `isIdle` signal; Zulip shows how
  to keep the two signals separate and documented.
- Split “ping” from “fetch all users” (`ping_only`). Accent’s heartbeat write
  and admin poll are already separate; keep that split.
- Add a cursor/etag-style incremental read (`last_update_id`,
  `presence_last_update_id`, `server_timestamp`) only if the 10s full poll
  becomes expensive. Do not add it preemptively.
- Offer one-user and all-users reads; one-user reads are useful for directory/
  profile embeds.
- Consider an explicit invisible/opt-out story before expanding visibility.

Facts:

- License: Apache-2.0.
  Source: <https://raw.githubusercontent.com/zulip/zulip/main/LICENSE>
- Maintenance: `12.3` on 2026-09-21, `12.2` on 2026-08-10, `12.1` on
  2026-06-26, `12.0` on 2026-04-27 (release feed observed 2026-10-19).
  Source: <https://github.com/zulip/zulip/releases>
- Popularity observed 2026-10-19 on repo page: 26.1k stars, 10.4k forks,
  362 watching.
  Source: <https://github.com/zulip/zulip>

License constraint: Apache-2.0 permits reuse with license/notice retention and
change notices for modified files. Again, prefer reimplementing the protocol
ideas; do not vendor Zulip server code.

## Option 3 — React + TanStack Query dashboard (recommended base)

This is not a presence server; it is the least-complex dashboard improvement
path because the dependency already exists:

- `package.json` pins `@tanstack/react-query@^5.101.2` alongside Next 16 and
  React 19. No new package or service is required for polling/caching wins.

Relevant primary docs:

- Polling: <https://tanstack.com/query/latest/docs/framework/react/guides/polling>
- Window-focus refetching: <https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching>
- Important defaults: <https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults>
- Background fetching indicators: <https://tanstack.com/query/latest/docs/framework/react/guides/background-fetching-indicators>

What it gives Accent without new infra:

- `refetchInterval` polling with function form (slow/stop polling by state),
  `refetchIntervalInBackground` for admin dashboards left in background tabs,
  and `networkMode` controls.
- Dedup semantics: observer timers are per-component, but concurrent in-flight
  fetches for the same key are deduped. Multiple admin cards on one key do not
  multiply network requests at the same instant.
- Freshness controls: default cached data is stale; `staleTime`, `refetchOnMount`,
  `refetchOnWindowFocus`, `refetchOnReconnect`, 5-minute inactive `gcTime`,
  3x exponential retries, structural sharing.
- UX affordances: `isFetching`/`useIsFetching` for “Refreshing…” states while
  keeping stale rows visible.

What it does not solve:

- It does not create presence truth; it only fetches/caches `GET /api/user-status`.
- It does not fix write-path defects (auth, multi-tab, idle last-writer,
  screen-time additivity) or clock skew. Those are API/hook scope, not Query
  config.

Facts:

- License: MIT.
  Source: <https://raw.githubusercontent.com/TanStack/query/main/LICENSE>
- Maintenance: release train active through 2026-10-17/18, including
  `@tanstack/*@5.104.4`/`6.3.4` patch batches (release feed observed
  2026-10-19).
  Source: <https://github.com/TanStack/query/releases>
- Popularity observed 2026-10-19: TanStack Query homepage showed 50,456 GitHub
  stars; repo page showed 50.5k stars, 4.3k forks, 262 watching.
  Sources: <https://tanstack.com/query/latest>,
  <https://github.com/TanStack/query>

## Option 4 — Supabase Realtime Presence (heavier alternative)

Supabase Presence shares slow-changing state (online/offline, active doc,
current page) over channels with `track(payload)`, `presenceState()`, and
`sync`/`join`/`leave` events.

Sources:

- Presence guide: <https://supabase.com/docs/guides/realtime/presence>
- Self-hosting realtime: <https://supabase.com/docs/reference/self-hosting-realtime>
- License: <https://raw.githubusercontent.com/supabase/realtime/main/LICENSE>

Why it is not the least-complex fit:

- It is a websocket realtime tier, not a MySQL query. Self-hosting is an
  Elixir/Phoenix Realtime server tied to Postgres logical replication
  (`wal2json`, WALRUS/RLS path), with its own DB connections and scaling
  story. Accent is MySQL + Next API routes.
- The docs warn Presence notifies all subscribers on every change and should
  not be used for high-frequency updates (e.g. mouse moves); Broadcast is for
  that. Presence reconciliation can also emit simultaneous `join`+`leave`
  during `sync` without real movement.
- Hosted Supabase would add an external backend, second auth/project, data-
  residency review, and client keys. Self-hosted Supabase would add Postgres
  - Elixir ops.

Facts:

- `supabase/realtime` license is Apache-2.0 (verified raw LICENSE).
- Useful only if Accent later wants true push presence across many viewers and
  accepts a Postgres realtime sidecar or hosted project.

## Option 5 — Liveblocks (hosted alternative, uncertain)

Liveblocks provides hosted realtime collaboration infrastructure with
usage-based pricing. It is not a drop-in MySQL presence table.

Sources checked:

- Docs home: <https://liveblocks.io/docs>
- Pricing: <https://liveblocks.io/pricing>
- Repo license pointer: <https://github.com/liveblocks/liveblocks/blob/main/LICENSE>

Uncertainties (do not decide on Liveblocks from this note alone):

- The attempted presence URL `https://liveblocks.io/docs/realtime/presence`
  returned HTTP 404 during research; the current presence path was not
  verified.
- The root LICENSE file says each package’s own `LICENSE`/`package.json`
  specifies its license; per-package terms were not audited.
- Any use would add a hosted dependency, API keys, usage metering, and data-
  sharing review. That contradicts the current “no hosted services assumed”
  constraint unless product explicitly approves it.

## Reuse vs install

- Reuse protocol ideas: Zulip’s `status` vs `new_user_input`, ping-vs-fetch
  split, incremental cursor, server timestamp, invisible mode; ActivityWatch’s
  heartbeat/pulsetime merging, per-source buckets, and analysis-stage
  interpretation; TanStack Query’s polling/focus/GC semantics.
- Do not copy full systems: ActivityWatch desktop agents + local SQLite estate;
  Zulip chat server + Postgres/Redis/queue estate; Supabase Postgres+Elixir
  realtime estate; Liveblocks hosted estate.
- Prefer Accent-native changes: keep `user_presence` as the presence store,
  `user_activity_logs` as the audit trail, and screen-time/attendance/payroll
  as separate concerns with their own sources.

## Recommendation

If Q1 selects CRM presence:

1. Keep the write path (`ActivityTracker` → `track-activity` →
   `user_presence` upsert) and fix correctness before features.
2. Keep polling for the admin dashboard; adopt TanStack Query polling/focus
   options already available (`refetchInterval`, background polling only where
   wanted, `staleTime`, `isFetching` indicators) instead of hand-rolled
   timers.
3. Add Zulip-style read affordances only on measured need: single-user embed
   read already exists; incremental cursor/etag only if 10s full polls prove
   expensive.
4. Document that presence is “CRM tab recently reported”, with idle/offline
   windows, invisible/opt-out expectations, and retention. Do not label it
   attendance or productivity.

If Q1 selects work review or device monitoring, this recommendation does not
apply; those need different sources (timesheets/daily entries/attendance
devices/IDE or OS agents) and a separate privacy/security review. ActivityWatch
does not satisfy centralized device monitoring for the reasons above.

## Proposed scope (not decided implementation)

Proposed, gated on the Q1 decision and audit triage; no code changes are
authorized by this note:

- Triage peer-audit write-path risks first: mixed-ID auth defect, multi-tab
  additive screen-time, last-writer `is_idle`/`current_page` races.
- Define presence vocabulary in the glossary/ADR if CRM presence is chosen:
  online/idle/offline windows, what `is_idle` means, multi-tab precedence,
  retention, and who may view presence.
- Dashboard read-path hardening with existing TanStack Query: shared query
  key, sane `staleTime`, background-polling choice, error/empty states, and
  “last updated” affordance. No websocket/Redis/hosted service unless product
  asks for sub-poll latency.
- Only then consider Zulip-inspired incremental reads or Supabase/Liveblocks
  push, with explicit infra, cost, privacy, and license sign-off.

## Uncertainties

- GitHub star/fork/watcher counts are point-in-time repo-page observations on
  2026-10-19; GitHub API access returned HTTP 403, so API metadata could not
  be used.
- Liveblocks presence docs path and per-package licenses were not verified
  (404 + pointer-only root license).
- License notes are operational summaries from primary license texts, not
  legal advice.
- Supabase/Liveblocks pricing, residency, and self-host sizing were not
  evaluated beyond the cited docs because they fall outside the current
  Next/MySQL/no-new-infra constraint.
- Audit findings (mixed-ID auth, multi-tab effects) were relayed by the parent
  agent during research and were not independently re-verified here.
