# Security Remediation Plan — Accent CRM

> Created 2026-09-28. Inputs: `docs/SECURITY_AUDIT.md` (SEC-01…SEC-25, re-verified against HEAD `ff7440a`) and the piolium deep audit (`piolium/final-audit-report.md`, 2026-09-02, commit `f00d6ad`): **C1** forged-session master-data access, **C2** active-users cookie forgery (already fixed in code — `active-users/route.js` now uses `getCurrentUser` + `r.role_name`), **H1** regex-sanitizer stored XSS.
>
> Scope: every open item from both audits, the same-class sweeps they imply, the unguarded-handler inventory, the RBAC defects that surfaced during mapping, and the two concurrency defects that touch money. Decisions live in ADR-0011…ADR-0014; `CONTEXT.md` gains Session / Public endpoint vocabulary. **No code changes in this document** — it is the plan the implementation and the ticket split follow.
>
> Standing assumptions (confirmed in review): HTML print documents stay inline (escaping, not `Content-Disposition: attachment`); messages keep the rich-text pipeline even though today's composer is a plain `textarea`; Vercel's ephemeral filesystem for `private/` is a known product risk and **out of scope** (risk register).

## Decisions already made

| Topic                       | Decision                                                                                                                                                                                         | Record   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Session validation layers   | proxy.ts validates the session against MySQL (own pool, 60 s per-instance cache); every handler authorizes via `ensurePermission`; a CI guard fails any handler lacking an auth reference        | ADR-0011 |
| Rich-text trust boundary    | allowlist sanitizer on write (`sanitize-html`), render-time `DOMPurify` (server prerender falls back to `sanitize-html`), one-off scrub of stored rows                                           | ADR-0012 |
| Rate-limit identity + store | trusted platform header (verified, not client `x-forwarded-for` first-hop); DB-backed fixed-window buckets for `auth`/`heavy`; in-memory for light categories; supersedes roadmap P0.4           | ADR-0013 |
| Unauthenticated allowlist   | exact-match list only: `/api/login`, `/api/logout`, `/api/session`, `/api/attendance/webhook`, `/api/health` (+ static assets); `/api/auth/*` prefix rule and the legacy login route are deleted | ADR-0014 |
| Verification                | E2E specs in `e2e/` with `e2e/artifacts/*.json` + a re-run of the three piolium PoCs; test-first only for the sanitizer's bypass suite                                                           | this doc |
| Shipping                    | one security branch; workstreams ordered A → G, each independently verifiable                                                                                                                    | this doc |

## Workstream A — Authorization sweep (Critical)

Goal: no handler under `src/app/api/**` is reachable without a live session, and every handler authorizes the resource it serves. Root cause of C1: the "proxy presence-check, Node validates" invariant was unenforced by any tool.

### A1. proxy.ts validates the session

- `proxy.ts:247` — replace `isAuthenticated = !!cookies.get('session')?.value` with a real lookup: hash the token (SHA-256, same as `src/utils/api-permissions.js:66+`), `SELECT s.user_id, u.is_active, u.status FROM sessions s JOIN users u … WHERE s.expires_at > NOW() AND s.token_hash = ? AND u.isDelete = 0`.
- Own connection pool inside a small module (`src/utils/session-probe.js`): Next 16 proxy runs on the Node.js runtime (installed docs: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:221-223`) but the docs warn proxy must not rely on shared modules/globals — assume no sharing with route handlers. 60 s per-instance cache keyed by token hash; on DB error serve a cached entry if fresh-within-TTL, else deny.
- Non-public pages: redirect to `/signin` when the session is invalid; non-public `/api/*`: 401 JSON (keep the existing shape).
- Ops check: MySQL `max_user_connections` must cover proxy pool + app pool per Vercel instance (dev: `max_user_connections=0`, `max_connections=300` shared; prod unknown). Fallback if Vercel's Node proxy misbehaves with an extra pool: drop A1, keep A7's CI guard (documented escape hatch, not the default).

### A2. Per-route guards (was: zero auth)

Mapping evidence: guarded-sibling precedents are quoted beside each row; verify role data before cutover (below).

| Route                                                          | Methods     | New guard                                                                                                                       |
| -------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/health/route.js`                                  | GET         | public allowlist (ADR-0014); payload reduced to `{ status: 'ok' }` — no pool stats/version                                      |
| `src/app/api/masters/categories/route.js`                      | G/P/PU/D    | `SETTINGS` READ / UPDATE / UPDATE / DELETE (voucher metadata; precedent `/api/activities/route.js:12-16,67-71,128-132,209-213`) |
| `src/app/api/masters/descriptions/route.js`                    | G/P/PU/D    | `SETTINGS` (same shape)                                                                                                         |
| `src/app/api/masters/account-heads/route.js`                   | G/P/PU/D    | `ACCOUNTS` READ/CREATE/UPDATE/DELETE                                                                                            |
| `src/app/api/masters/accounts/route.js`                        | G/P/PU/D    | `ACCOUNTS` READ/CREATE/UPDATE/DELETE (only existing ACCOUNTS guard: `admin/accounts/download/route.js:13-17`)                   |
| `src/app/api/masters/banks/route.js`                           | G/P/PU/D    | `ACCOUNTS` READ/CREATE/UPDATE/DELETE                                                                                            |
| `src/app/api/activity-master/activities/route.js`              | G/P/PU/D    | `SETTINGS` READ / UPDATE / UPDATE / DELETE                                                                                      |
| `src/app/api/activity-master/subactivities/route.js`           | G/P/PU/D    | `SETTINGS` READ / UPDATE / UPDATE / DELETE                                                                                      |
| `src/app/api/activity-master/route.js`                         | PUT, DELETE | `SETTINGS` UPDATE / DELETE — **per-handler gap**: GET/POST are guarded, PUT/DELETE are not                                      |
| `src/app/api/admin/material-requisitions/route.js`             | G/P/D       | `MATERIAL_REQUISITION` READ/CREATE/DELETE                                                                                       |
| `src/app/api/admin/material-requisitions/next-number/route.js` | GET         | `MATERIAL_REQUISITION` CREATE                                                                                                   |
| `src/app/api/projects/[id]/invoice/route.js`                   | G/P/PU/D    | `INVOICES` READ/CREATE/UPDATE/DELETE (client already gates via `EditProjectForm.jsx:287-292`)                                   |
| `src/app/api/projects/[id]/purchase-order/route.js`            | G/P         | `PURCHASE_ORDERS` READ/CREATE                                                                                                   |
| `src/app/api/projects/[id]/quotation/route.js`                 | G/P         | `QUOTATIONS` READ/CREATE                                                                                                        |
| `src/app/api/admin/invoice-list/route.ts`                      | GET         | `INVOICES` READ                                                                                                                 |
| `src/app/api/admin/payee-list/route.js`                        | GET         | `ADMIN` READ (consumer `admin/payment-entries/route.js:14-20` guards `ADMIN`)                                                   |

- Remove `created_by`/`user_id` from request bodies where the column records provenance (`masters/categories/route.js:29,43`); derive `auth.user.id` server-side (mirror `masters/accounts/route.js:91-92`).
- Pre-cutover role-data check + migration: for every role that must keep access, confirm it holds the mapped `resource:action` (e.g. a finance role maintaining banks needs `accounts:*`); ship a seed/migration if not. E2E asserts both the 401/403 side and the legitimate-role side.

### A3. Delete the three caller-less routes

`employees/[id]/attendance`, `employees/[id]/salary-structure`, `employees/available-for-users` — zero callers (superseded by `/api/attendance/summary` and `/api/payroll/salary-profile`), currently unguarded salary/PII read-write surfaces. Delete; E2E asserts 404.

### A4. Public-path hygiene

- Delete `src/app/api/auth/login/route.js` (unused public credential oracle) and drop the `/api/auth` prefix entry from `proxy.ts:9` — `isPublicPath` stays prefix-based but every entry is an exact path (ADR-0014).
- `/api/health` and `/api/session` become explicit allowlist entries; legacy `/uploads` static serving stays (rasterized PNGs only, with the `/uploads/:path*` headers already in `next.config.ts:74-83`).

### A5. RBAC vocabulary defects

- `PERMISSIONS.WRITE` does not exist (`src/utils/rbac.js:55-66`): `admin/invoices/route.js:151-155` (POST) and `admin/purchase-orders/route.js:141-146,340-346` (POST/PUT) currently 403 for every non-super-admin. Replace with `INVOICES:CREATE`, `PURCHASE_ORDERS:CREATE/UPDATE`.
- Wrong resources on financial routes: `admin/invoices/route.js:18-22` (GET guards `PROPOSALS:READ` → `INVOICES:READ`), `admin/purchase-orders/route.js:478-484` (DELETE `PROPOSALS:DELETE` → `PURCHASE_ORDERS:DELETE`); audit `admin/purchase-invoices/route.js:26-30,109-112` and `admin/expenses/route.js:25-27,113-116` (both guard `PROPOSALS`) and re-map to their real resources.
- Correct `docs/explanations/RBAC_PERMISSIONS_SYSTEM.md`'s stale Masters row to the final vocabulary.

### A6. CI guard (the invariant becomes structural)

- New `scripts/check-route-auth.mjs`: for every `src/app/api/**/route.{js,ts}`, for **every exported HTTP handler** (not per file — the `activity-master` PUT/DELETE gap proves per-file checks miss things), require a reference to `getCurrentUser | getServerAuth | ensurePermission` or an entry in `scripts/route-auth-allowlist.json` with a reason (public-by-design paths; the three forwarder routes `documents`, `document-upload/download`, and their `src/utils/document-helpers.js` delegation).
- Wire as `npm run check:route-auth` and into CI (`.github/workflows/` — only `e2e.yml` exists today; add the check there or a sibling workflow).

## Workstream B — Stored XSS: sanitize on write, safe on render (Critical/High)

Class: the only neutralization today is the regex denylist `src/lib/sanitize.js:12-40`, applied client-side at four `dangerouslySetInnerHTML` sinks, while every write path stores verbatim. `<svg/onload=…>` (slash-delimited handlers) survives it.

- **B1 deps/allowlist** — add `sanitize-html` (server) + `dompurify` (browser); one shared allowlist (`src/lib/html-allowlist.js`): `p, br, strong, b, em, i, u, s, strike, h1, h2, h3, blockquote, ul, ol, li, code, pre, hr, a`; `a` may carry `href` (http/https/mailto only), `title`, `target`, `rel`. No events, no `style`, no `srcdoc`, no `formaction`, no `iframe/object/math/svg`.
- **B2 sanitize every HTML-bound write path** — `messages.body` (`src/app/api/messages/route.js:174,266-291`), `proposals.description` (`src/app/api/proposals/route.js:232,334`), projects `description`/`additional_scope`/`scope_of_work` + `discipline_descriptions` values (`src/app/api/projects/route.js:276+,286,303`; `src/app/api/projects/[id]/route.js:813,814,867,958`), quotation rich-text columns (`admin/quotations` POST/PUT, project quotation upsert, quotation annexure fields). Plain-text fields that merely land in HTML templates are **not** write-sanitized — they are escaped at the sink (workstream D).
- **B3 render safety net** — replace `sanitizeHtml`'s implementation with a DOMPurify-backed wrapper using the same allowlist; on the server (static prerender) fall back to `sanitize-html` (the `isomorphic-dompurify` ENOENT history is why the fallback is explicit, not isomorphic). Sinks: `messages/page.jsx:1488`, `projects/[id]/page.jsx:54`, `ScopeTab.jsx:17`, `proposals/[id]/edit/page.jsx:2705`.
- **B4 legacy scrub** — `scripts/scrub-stored-html.mjs`: dry-run counts → backup → idempotent UPDATE for the columns above (rich-text only). Run against dev, then prod as an ops step (G).
- **B5 messages** — composer is a plain `textarea` (`messages/page.jsx:1179`), so bodies are text: sanitizing on write strips accidental markup, and the render wrapper keeps parity.
- **B6 headers / CSP** (absorbs SEC-24) — static CSP via `next.config.ts headers()` for all routes: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests` + `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Rationale for `'unsafe-inline'` and rejection of nonce-CSP: ADR-0012.

## Workstream C — Upload validation (Medium)

- **C1 magic bytes** — validate content, not headers, in `src/app/api/document-upload/route.js:78-88` (now AND-logic but no inspection) and `src/app/api/messages/attachments/route.js:80` (still OR-logic: `!ALLOWED_TYPES[file.type] && !allowedExtensions.includes(fileExt)`). Reject HTML/JS/SVG signatures regardless of declared type; keep the rasterize-everything pipeline for `/api/uploads`.
- **C2 size cap** — `src/app/api/uploads/route.js:45-46`: `Content-Length` pre-check + decoded-buffer cap (≤ 20 MB, matching `MAX_FILE_SIZE`) → 413 before `Buffer.from(cleaned,'base64')`. Keep `limitInputPixels: 40_000_000`.

## Workstream D — Document/print sinks (High)

Every server-generated HTML/PDF/print document escapes interpolated DB text; rich-text columns are trusted only after B2/B4.

| Sink                                                                                 | Current                                  | Change                                                                                                                        |
| ------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `admin/material-requisitions/download/route.js:63-340`                               | 13 raw interpolations, `text/html`       | `escapeHtml` every field (reference: `admin/cash-vouchers/download/route.js:59-65`)                                           |
| `admin/purchase-orders/download/route.js:104-412`                                    | raw                                      | same                                                                                                                          |
| `admin/outgoing-purchase-orders/download/route.ts:56-305`                            | raw                                      | same                                                                                                                          |
| `admin/quotations/download/route.js:542-590`                                         | Puppeteer PDF, raw rich-text passthrough | escape plain fields; run rich-text through the server sanitizer; `page.setRequestInterception` blocking any non-local request |
| `admin/invoices/download/route.js:536+`                                              | Puppeteer PDF, raw                       | same                                                                                                                          |
| `utils/buildReceiptHTML.ts:34-65` + `payment-entries/get-receipt-pdf/route.ts:28,57` | raw, `page.setContent`                   | escape + request interception (SEC-21)                                                                                        |
| `reports/page.jsx:464-576`                                                           | `document.write` of raw fields           | build nodes with `textContent` (SEC-23)                                                                                       |
| `proposals/[id]/page.js:401,458,541`                                                 | client `innerHTML` builders              | escape or DOMPurify the generated HTML                                                                                        |

## Workstream E — Financial integrity (High)

- **E1 invoice POST** (`admin/invoices/route.js:298-325`): wrap PO read-modify-write in a transaction with `SELECT … FOR UPDATE` and a **relative** update (`remaining_balance = remaining_balance - ?`); same for the `[id]` PUT path (`admin/invoices/[id]/route.js:243-311` — transactional today but reads non-locking and writes absolute values, so concurrent PUTs lose updates). Mirror the relative-write pattern already at `:288-291`.
- **E2 number generators** (`NumberGenerators` inventory): every generator is a non-atomic `SELECT MAX/COUNT` → `INSERT`. Six columns have **no uniqueness guard**: `quotations.quotation_number`, `payment_entries.receipt_no`, `project_invoices`, `project_quotations`, `outgoing_purchase_orders.sr_no`, `leads.lead_id`. Add the repo's generated-column unique-index pattern (`IF(isDelete=0, col, NULL) STORED`) via migration, and serialize generation per resource (transaction + `FOR UPDATE`, or unique-violation retry) for: invoices `ATS/I`, purchase invoices `PI-`, cash vouchers `CV-`/`C-MM`, quotations `ATSPL/Q`, outgoing quotations `OQ-`, outgoing POs `sr_no`, material requisitions `ATSPL/PUR`, expenses `EXP-`, other expenses `OEX-`, petty cash `PCX-`. `cash-vouchers/route.js:175-208` generates _before_ opening its transaction — move the generation inside.

## Workstream F — Rate limiting, identity, session cache (Medium)

- **F1 trusted IP** — `proxy.ts:65-90` trusts `x-forwarded-for` first. On Vercel: derive from the platform-set header only (`x-vercel-forwarded-for` when present), never the client-supplied first XFF hop. Add a config constant so a future non-Vercel deployment sets its own header. Verify with a forged-header test: rotating `x-forwarded-for` must not mint a fresh `auth` budget.
- **F2 store** — DB-backed fixed-window buckets for `auth` (10/15 m) and `heavy` (10/m); keep the in-memory Map for `session`/`dashboard`/`api`. Table: unique `(bucket_key, window_start)`, `ON DUPLICATE KEY UPDATE count = count + 1`, `Retry-After` on 429. Cleanup piggybacks on the existing `cleanupRateLimitStore()` interval semantics. Supersedes roadmap P0.4's accepted risk (ADR-0013).
- **F3 cache TTL** — `USER_CACHE_TTL` 5 min → 60 s (stale-on-error retained); proxy cache 60 s. Documents the ≤60 s cross-instance revocation/deactivation window.

## Workstream G — Ops & infra checklist (owner: repo owner + infra)

1. Rotate the MySQL credentials in `.env`/Vercel env; never commit them; add `.env.example` with placeholders.
2. Firewall MySQL to the app's egress addresses; verify no public bind (`94.103.163.250:3306` reachable from the internet today — SEC-20).
3. Enable TLS end-to-end: `ssl: { rejectUnauthorized: true }` + CA in `src/utils/database.js:47-62` and `knexfile.js`; verify the server requires TLS.
4. Delete the dead `AUTH_SECRET`/`JWT_SECRET` values (nothing in `src/` reads them) or replace with strong randoms if a future use is planned; remove unused `jsonwebtoken` (SEC-25).
5. Purge tracked legacy files that ship in the deploy payload: `public/uploads/companies_export_*.xlsx`, `leads_emails_export_*.xlsx`, `vendors_export_*.xlsx` (unauthenticated data dumps), the `private/message-attachments/*.docx` files (committed customer data; `private/` is `.vercelignore`d but still in git), and the stale screenshots if not referenced. Verify with `curl` that the URLs 404 after deploy.
6. Run the B4 scrub on prod (dry-run counts first, backup before write) and record the artifact.
7. Verify the trusted-IP header behavior on the deployed stack; record which header Vercel sets and whether it strips client values.
8. Deploy order: B6 headers last-but-one so CSP violations surface in the browser console against the already-fixed sinks.

## Verification

- **E2E (committed, `e2e/specs/security/*.spec.ts`, artifacts `e2e/artifacts/*.json`)**:
  - auth: anonymous and forged-`session` requests to every A2 route → 401; legitimate role → 200; deleted routes → 404.
  - xss: store `<svg/onload=…>` + `<img src=x onerror=…>` via each write path → API returns sanitized text, page render contains no executable attribute, rows in DB are clean; scrub artifact for legacy rows.
  - headers: CSP/HSTS/X-Frame-Options/nosniff/Referrer-Policy present on `/` and `/api/*`.
  - rate limit: 429 + `Retry-After` on `auth`; rotated `x-forwarded-for` does not reset the bucket.
  - documents: DB-stored payload appears escaped in `text/html`/PDF responses.
- **piolium PoC re-runs** (`piolium/findings/*/poc.{py,js}`): static check must report 0 vulnerable routes; `poc.py` live re-run against the branch (live server + DB) must return 401/403 where it previously bypassed; `poc.js` must show 0/5 bypasses. Record results in `e2e/artifacts/security-poc-reruns.json`.
- **Test-first (only for the sanitizer)**: enumerate bypass payloads (slash-delimited handlers, `srcdoc`, `data:text/html`, `javascript:` variants, mXSS cases) **before** implementing B1–B3; assert both engines (server `sanitize-html`, browser DOMPurify) strip them and that the allowlist passes legitimate TipTap output.
- No new unit suites elsewhere (repo rule); route/page behavior is E2E-only.

## Risk register

| Risk                                                                                               | Status                                                                                                       |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Vercel ephemeral FS + `private/` excluded from deploy → uploaded documents don't survive redeploys | Accepted, out of scope; separate blob-storage project                                                        |
| MySQL TLS requires server-side support + CA distribution                                           | Ops blocker; until done SEC-20 stays open                                                                    |
| Proxy pool + app pool per instance vs MySQL connection budget                                      | Verify in G; fallback path documented in A1                                                                  |
| CSP `script-src 'unsafe-inline'` does not stop inline execution                                    | Containment via `connect-src`/`img-src` `'self'` + B2/B3; nonce-CSP rejected due to forced dynamic rendering |
| Cross-instance cache staleness (revocation/deactivation)                                           | Bounded at 60 s (F3)                                                                                         |
| PoC re-runs need a live server + seeded DB                                                         | Use the E2E bootstrap DB (`e2e/lib/fixtures.ts`)                                                             |
| Deleting routes/prefixes may break undiscovered consumers                                          | Grep + E2E 404 assertions; keep `/api/health` public                                                         |
| Scrub is destructive                                                                               | Dry-run + backup + idempotent script                                                                         |

## Sequencing (single security branch)

1. A6 CI guard (red on current tree) → A1–A5 → green.
2. B1–B4 + test-first bypass suite → green; B5; B6 headers.
3. D document sinks (escape + request interception).
4. C uploads.
5. E financial integrity.
6. F rate limiting + cache TTL.
7. G ops checklist + register/doc updates + PoC re-runs + E2E artifacts.

Deferred (explicitly): full 38-state-machine concurrency audit, blob storage, additional CSV hardening beyond the one dynamic exporter, MySQL external network audit (nmap/TLS probe), piolium's 30 rejected-FP drafts.
