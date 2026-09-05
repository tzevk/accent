# Leave Overlaps is a client-computed report reusing GET /api/leaves

`src/app/reports/leave-overlaps` renders 12 month-grids (Jan–Dec, auto-scroll to the current month) from one yearly `GET /api/leaves?from=Jan-01&to=Dec-31` fetch looped over pages (`limit=200`), intersected client-side on inclusive UTC `[start_date, end_date]` ranges. Only `pending`/`approved` rows count; `rejected` never does; half-day flags are ignored for the grid.

We reuse the existing leaves endpoint instead of adding `GET /api/leaves/overlaps` so there is no new API surface, no migration, and no extra heavy-rate-limit slot; the pure intersect/clip/merge logic lives in `data-source.ts` (same seam as `attendance-report`) with unit tests. A separate reports page (not an inline badge on `employees/leaves`) keeps the review queue's pagination and approve flow untouched, and the report is informational only — it never gates approval.

Considered: (a) dedicated overlaps endpoint, (b) inline overlap badges in the review table, (c) full calendar component. Chose reuse + report page because (a) adds surface for data the client can already derive, (b) computes over a 50-row page ordered by `created_at` so it silently misses page-2 collisions, (c) is a new component to maintain for the same signal.

Consequences: yearly fetch loops pages (capped at 10) and splits months client-side; month-spanning leaves clip per grid with per-month totals; overlap days are red `×N` badges with red cell outlines (`approved` solid peach, `pending` amber dashed). Add a server endpoint only if yearly volume measurably hurts.
