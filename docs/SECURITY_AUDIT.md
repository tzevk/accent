# Security Audit — Accent CRM

> Generated 2026-08-06. Three parallel read-only security reviews (authentication/authorization, injection/code execution, data handling/uploads/dependencies) plus manual verification of every Critical/High finding against source.
>
> Coverage: ~180 API route files under `src/app/api/`, `middleware.ts`, `src/utils/api-permissions.js`, `src/utils/permissions.js`, `src/utils/password.ts`, upload/serving paths, `next.config.ts`, `package.json`/`package-lock.json`, `.env`, `scripts/`. Prior findings in `docs/todo/POOR_PRACTICES_AUDIT.md` (plaintext passwords, missing auth on download routes, wrong permission resources, in-memory rate-limiter §1.6, error-message leakage §2.2) were cross-referenced and are **not** re-reported.
>
> Cross-slice duplicates (session cookie forgery, document-upload, X-Forwarded-For rate-limit bypass) were merged into single findings.

---

## Executive Summary

**25 findings: 2 Critical, 8 High, 11 Medium, 3 Low, 1 Informational.**

The app's authentication model is the dominant risk: **authentication is cookie-presence-only** (`auth='1'` constant value, no server-side session, no signature), and the `session_permissions` cookie is **unsigned base64 claims that GRANT super-admin**. Any primitive that can plant a cookie for the app origin (the stored SVG XSS, cookie injection, subdomain cookie tossing) escalates to full account takeover and super-admin. Every other finding chains into this core weakness.

Second-order risks: stored XSS in messaging and HTML download endpoints (no HTML sanitizer exists anywhere in `src/`), uploaded files served from `public/` with no auth/headers, `password_hash` and bank/PAN/Aadhaar PII returned verbatim by API responses, and arbitrary file write/unlink via unsanitized `entity_id` in upload filenames.

| Severity         | Count | IDs             |
| ---------------- | ----- | --------------- |
| 🔴 Critical      | 2     | SEC-01, SEC-02  |
| 🟠 High          | 8     | SEC-03 … SEC-10 |
| 🟡 Medium        | 11    | SEC-11 … SEC-21 |
| 🔵 Low           | 3     | SEC-22 … SEC-24 |
| ⚪ Informational | 1     | SEC-25          |

---

## Findings

| ID     | Severity    | Location                                                                                                                                                                                       | Issue                                                                                                                                |
| ------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-01 | 🔴 Critical | `middleware.ts:242`, `src/utils/api-permissions.js:128-150`, `src/app/api/login/route.js:206`                                                                                                  | Session auth is forgeable: static `auth='1'` cookie, `user_id` plain integer, presence-only validation, no server-side session store |
| SEC-02 | 🔴 Critical | `src/app/api/uploads/route.js:43-53`, `middleware.ts:17,297-308`                                                                                                                               | Stored XSS: raw SVG uploads persisted to `public/uploads/` and served inline, same-origin, no CSP/nosniff                            |
| SEC-03 | 🟠 High     | `src/utils/api-permissions.js:66-96,253-268,379-410`                                                                                                                                           | Unsigned, client-forgeable `session_permissions` cookie grants super-admin on the authorization fast path                            |
| SEC-04 | 🟠 High     | `src/app/api/users/route.js:293-325`, `src/app/api/users/[id]/route.js:110-165`                                                                                                                | Privilege escalation / account takeover: `password_hash` client-writable, unvalidated `permissions`/`role_id` grants                 |
| SEC-05 | 🟠 High     | `src/app/api/login/route.js:66-73,104-109`, `src/utils/api-permissions.js:215-218`                                                                                                             | Account deactivation is a no-op: disabled users log in, are auto-re-activated, keep API access                                       |
| SEC-06 | 🟠 High     | `src/app/api/document-upload/route.js:39-120,123-160,201-252`, `middleware.ts:5-16,300-310`                                                                                                    | IDOR + public exposure: any authenticated user lists/reads/deletes any entity's documents; files served from `public/` with no auth  |
| SEC-07 | 🟠 High     | `src/app/api/users/route.js:24-40,354-363`, `src/app/api/users/[id]/route.js:33-47,141-158`, `src/app/api/employees/route.js:83-88`, `src/app/api/employees/[id]/route.js:33-36`               | `password_hash` (all users) and bank/PAN/Aadhaar PII leaked via verbatim `SELECT *` responses                                        |
| SEC-08 | 🟠 High     | `src/app/messages/page.jsx:1487`, `src/app/api/messages/route.js:174,266-272`                                                                                                                  | Stored XSS in internal messaging: `dangerouslySetInnerHTML` on unsanitized message body, no sanitizer anywhere in `src/`             |
| SEC-09 | 🟠 High     | `src/app/api/admin/material-requisitions/download/route.js:67,249-258,275-278,305-321,337-340`                                                                                                 | Stored XSS: unescaped DB fields interpolated into `text/html` response served inline                                                 |
| SEC-10 | 🟠 High     | `src/app/api/document-upload/route.js:97-99,112-115,233-234`                                                                                                                                   | Path traversal: unsanitized `entity_id` embedded in filename → arbitrary file write + unlink                                         |
| SEC-11 | 🟡 Medium   | `middleware.ts:47-58,105-110`                                                                                                                                                                  | Rate-limit identity attacker-controlled (`X-Forwarded-For` + `user_id` cookie) → brute-force bypass                                  |
| SEC-12 | 🟡 Medium   | `src/app/api/login/route.js:198-207`, `src/app/api/logout/route.js:27-36`                                                                                                                      | Auth cookie `Secure` flag derived from client-forgeable `x-forwarded-proto`                                                          |
| SEC-13 | 🟡 Medium   | `src/app/api/admin/invoice-list/route.ts:11-30`, `src/app/api/admin/payee-list/route.js:10-24`, `src/app/api/masters/accounts/route.js:9-255`, `src/app/api/masters/banks/route.js:10-277`     | Sensitive financial/master endpoints gated only by `getCurrentUser` (any authenticated user)                                         |
| SEC-14 | 🟡 Medium   | `src/app/api/settings/password/route.js:83-91`, `src/app/api/users/reset-password/route.js:50-60`                                                                                              | Password change/reset does not invalidate existing sessions                                                                          |
| SEC-15 | 🟡 Medium   | `src/app/projects/[id]/page.jsx:45-54,212`, `src/app/projects/[id]/edit/tabs/ScopeTab.jsx:16-18`, `src/app/proposals/[id]/edit/page.jsx:2704-2706`                                             | Stored XSS via rich-text project/proposal fields (tag-presence check is not sanitization)                                            |
| SEC-16 | 🟡 Medium   | `src/app/api/payroll/export-sheet/route.js:16-18,647-655`, `src/app/api/employees/[id]/salary-structure/export/route.js:77-81`, `src/app/reports/project-activities/excel-template.ts:157-164` | Spreadsheet formula injection (CWE-1236) in Excel exports                                                                            |
| SEC-17 | 🟡 Medium   | `src/app/api/document-upload/route.js:73-83`, `src/app/api/messages/attachments/route.js:66-83`                                                                                                | Upload validation is MIME/extension-only with OR logic; content bytes never inspected                                                |
| SEC-18 | 🟡 Medium   | `src/app/api/uploads/route.js:21-36`                                                                                                                                                           | No size cap on base64 upload payload → memory-exhaustion DoS                                                                         |
| SEC-19 | 🟡 Medium   | `scripts/setup-super-admin.js:15-18,66-70`                                                                                                                                                     | Hardcoded default super-admin credentials (`crmadmin` / `admin123`) in committed script                                              |
| SEC-20 | 🟡 Medium   | `.env` (gitignored), `src/utils/database.js:16-28`                                                                                                                                             | Prod MySQL credentials in local `.env`; DB on public IP; predictable `AUTH_SECRET`/`JWT_SECRET` defaults                             |
| SEC-21 | 🟡 Medium   | `src/utils/buildReceiptHTML.ts:34-65`, `src/app/api/admin/payment-entries/get-receipt-pdf/route.ts:28,57-60`                                                                                   | HTML injection into server-side receipt PDF (headless Chrome) → limited SSRF / PDF injection                                         |
| SEC-22 | 🔵 Low      | `src/app/api/login/route.js:90-102`, `src/app/api/auth/login/route.js:17-30`                                                                                                                   | Login timing oracle for user enumeration; unused public `/api/auth/login` credential-check endpoint                                  |
| SEC-23 | 🔵 Low      | `src/app/reports/page.jsx:465-466,520-537`                                                                                                                                                     | `document.write` of unescaped payroll slip data into same-origin print window                                                        |
| SEC-24 | 🔵 Low      | `next.config.ts` (no `headers()`), `middleware.ts:266-273`                                                                                                                                     | No CSP, HSTS, X-Frame-Options, or X-Content-Type-Options anywhere                                                                    |
| SEC-25 | ⚪ Info     | `package.json:30-75`, `package-lock.json`                                                                                                                                                      | No confirmed active CVEs at installed versions; unused `jsonwebtoken`; puppeteer-core version skew                                   |

---

## 🔴 Critical

### SEC-01 — Session authentication is forgeable: static `auth='1'` cookie, no server-side session

**Severity:** Critical · **CWE-287, CWE-613**

**Location:** `middleware.ts:242` (`isAuthenticated = !!(auth && userId)`); `src/utils/api-permissions.js:128-150` (`getCurrentUser` trusts `user_id` cookie); `src/app/api/login/route.js:206` (sets `auth` to constant `'1'`); `src/app/api/logout/route.js:19-46` (logout only clears cookies).

**Description:** Authentication is two cookies — `auth` (constant value `'1'`) and `user_id` (any integer) — and every layer validates only **presence**, never a session secret. There is no server-side session table/token; the only "session" data (`user_work_sessions`) is work-activity tracking and is never checked for auth. Cookies never expire server-side; logout only deletes them client-side.

**Exploit:** Anyone who can set cookies for the domain (any XSS, cookie injection, subdomain cookie tossing, or MITM when the `Secure` flag is disabled per SEC-12) impersonates **any user** by setting `user_id=<target>&auth=1`. A stolen cookie works indefinitely, even after the victim changes their password (SEC-14).

**Fix:** Issue an opaque random session token (`crypto.randomBytes`/`randomUUID`) at login; store it server-side (sessions table or Redis) keyed to the user; validate it in middleware/`getCurrentUser` on every request; revoke on logout and password change. This is the root fix for SEC-03, SEC-09 (session portion), SEC-14.

---

### SEC-02 — Stored XSS via raw SVG upload served from `public/uploads/`

**Severity:** Critical · **CWE-79, CWE-434**

**Location:** `src/app/api/uploads/route.js:43-53` (content-sniff `headUtf8.includes('<svg')` → `fs.writeFileSync(outPath, buf)` with `.svg` extension, raw attacker bytes); `middleware.ts:17` (`/uploads` in `publicPaths`); `middleware.ts:297-308` (matcher excludes `uploads` → no middleware, no headers on these files).

**Description:** `POST /api/uploads` detects SVG by string-sniffing the first 256 bytes and writes the **unmodified attacker payload** to `public/uploads/<ts>_<name>.svg`. Next.js serves it inline with `Content-Type: image/svg+xml`, no CSP, no `X-Content-Type-Options: nosniff`, no `Content-Disposition`. Browsers execute `<script>`/`onload` inside same-origin SVG.

**Exploit:** A user with `projects:update` uploads an SVG containing `<svg onload="fetch('/api/users/reset-password', …)">` or a script calling authenticated APIs (change own password → account takeover; read payroll/invoice data). Any employee who opens the shared link runs it under their session. The thumbnail `catch {}` (lines 50-56) does not protect the original. No CSP (SEC-24) contains it.

**Fix:** Never persist SVG verbatim — rasterize every upload to PNG via sharp (SVG input rendered by librsvg; keep only the PNG + thumbnail). Reject any input that is not a raster image. Serve remaining user content with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`; add a strict CSP; move uploads out of `public/` entirely.

---

## 🟠 High

### SEC-03 — Unsigned, client-forgeable `session_permissions` cookie grants super-admin

**Severity:** High · **CWE-565, CWE-290, CWE-345**

**Location:** `src/utils/api-permissions.js:66-96` (`getSessionPermissions`: plain base64 decode, `is_super_admin: !!data.sa`); `:253-268` (`ensurePermission` fast path grants `authorized: true` when cookie says super-admin); `:320-335` (`hasPermission` same trust); `:379-410` (`createSessionPermissionsCookie`: base64, no HMAC).

**Description:** Authorization grants access based on the `session_permissions` cookie — base64-encoded JSON `{p: [...], sa: true, ts: ...}` with **no signature/HMAC**. If the cookie contains `sa: true`, every `ensurePermission()` call returns authorized without consulting the DB. The cookie is never legitimately set server-side (`setPermissionsCookieOnResponse` has no callers), so any planted value is accepted as-is. `AUTH_SECRET`/`JWT_SECRET` exist in `.env` but nothing signs with them (`jsonwebtoken` is never imported).

**Exploit:** Any cookie-planting primitive (SEC-02, cookie injection, subdomain toss, MITM per SEC-12) sets `session_permissions=base64({"p":[],"sa":true,"ts":<now>})` → instant super-admin for all API calls, plus `is_super_admin=1` cookie for `/admin/*` pages.

**Fix:** HMAC-sign the payload with a server-side secret — or drop the cookie fast path entirely and always authorize from the DB. Never let client data assert super-admin. Use `__Host-` prefixed, always-`Secure` cookies. Fix together with SEC-01.

---

### SEC-04 — Privilege escalation / account takeover via `/api/users` PUT (`password_hash` writable) and unvalidated grants

**Severity:** High · **CWE-269, CWE-284**

**Location:** `src/app/api/users/route.js:293-325` (PUT: `allowed` whitelist includes `'password_hash'`, then `UPDATE users SET ${fields.join(', ')}` with the raw request value); `:82-89,155-165` (POST accepts arbitrary `permissions`/`role_id`); `src/app/api/users/[id]/route.js:110-165` (PUT allows `permissions`, `field_permissions`, `role_id`, `is_active`).

**Description:** Any user holding `users:update` can write `password_hash` directly — no verification that the caller is the account owner or super admin — setting any account's hash to one the attacker controls (bcrypt, or even plaintext, which `verifyPassword` accepts as legacy) and logging in as that user, **including the super admin**. The same routes accept arbitrary `permissions`/`field_permissions`/`role_id` with no check that granted permissions ⊆ caller's own grants and no role-hierarchy check.

**Fix:** Remove `password_hash` from writable fields (route through the reset-password flow with verification); require super admin for role/permission grants; validate granted permissions ⊆ caller's permissions; enforce role hierarchy (cannot modify equal/higher-ranked users).

---

### SEC-05 — Account deactivation is ineffective: disabled users log in, get re-activated, keep API access

**Severity:** High · **CWE-284, CWE-287**

**Location:** `src/app/api/login/route.js:66-73` (login `WHERE` filters only `isDelete = 0`, never `is_active`/`status`); `:104-109` (login runs `UPDATE users SET last_login=NOW(), is_active=TRUE, status='active'` — silently re-activates); `src/utils/api-permissions.js:215-218` (`is_active: row.is_active === null ? true : !!row.is_active || authenticated` — treats cookie presence as active).

**Description:** Deactivation/disable is a no-op control. A disabled user logs in normally and is re-activated; existing sessions of disabled users keep full API access because `getCurrentUser` ORs `is_active` with cookie presence.

**Fix:** Filter `is_active = TRUE AND status IN ('active', …)` in both the login query and `_fetchUserFromDb`; remove the `|| authenticated` fallback; drop the login-time auto-re-activation (or gate it behind an explicit admin action).

---

### SEC-06 — document-upload: IDOR + documents served from `public/` without authentication

**Severity:** High · **CWE-639, CWE-862, CWE-552, CWE-200**

**Location:** `src/app/api/document-upload/route.js:39-120` (POST: `getCurrentUser` only, arbitrary `entity_type`/`entity_id`); `:123-160` (GET lists docs for any entity); `:201-252` (DELETE deletes any document by id + unlinks file); `middleware.ts:5-16` (`/uploads` public); `middleware.ts:300-310` (matcher excludes `uploads`).

**Description:** All three handlers authenticate with `getCurrentUser` only — no `ensurePermission`, no entity membership check, no ownership check. Entity IDs are small sequential integers; document IDs are enumerable via GET. Files — including **purchase orders and invoices** — are written to `public/uploads/documents/` and served statically: no authentication, no rate limiting, no headers ever run for `/uploads/*`. (Contrast: message attachments are correctly stored under `private/` and served by an authenticated handler.)

**Exploit:** (a) The lowest-privilege authenticated user inventories every entity's documents and deletes them, destroying financial evidence; (b) anyone who obtains a URL (shared in messages, logs, referrer, or via the GET listing) downloads invoices/POs with **no login at all**.

**Fix:** Resolve `entity_type` → resource (`project` → `PROJECTS`, `purchase_order` → `PURCHASE_ORDERS`, `invoice` → `INVOICES`) and require `ensurePermission(request, resource, UPDATE)` on POST, `READ` on GET; on DELETE require entity permission + `uploaded_by === currentUser.id`. Store files under `private/` (as `private/message-attachments` demonstrates) and serve via an authenticated route with `Content-Disposition: attachment`. Remove `/uploads` from `publicPaths` and the matcher only after files move out of `public/`.

---

### SEC-07 — `password_hash` and bank/PAN/Aadhaar PII leaked via verbatim `SELECT *` responses

**Severity:** High · **CWE-522, CWE-200**

**Location:** `src/app/api/users/route.js:24-40` (GET list `SELECT u.*` returned as `data`), `:355-363` (PUT returns `rows[0]`); `src/app/api/users/[id]/route.js:33-47,141-158` (GET/PUT `SELECT *`); `src/app/api/employees/route.js:83-88` (`SELECT e.*`); `src/app/api/employees/[id]/route.js:33-36` (`SELECT *`).

**Description:** The users endpoints return every user's **bcrypt `password_hash`** in JSON. The employees endpoints return `bank_account_no`, `bank_ifsc`, `pan`, `aadhar` for the entire workforce. These are permission-gated (`users:read`/`users:update`/`employees:read`), but the UI advertises a "min 6 characters" password policy — hashes are trivially crackable offline, and the PII dump is a full identity-theft database.

**Fix:** Enumerate columns explicitly in every SELECT; never select or return `password_hash`, `bank_account_no`, `pan`, `aadhar` unless a dedicated, separately-authorized endpoint (e.g. HR salary export) needs them; strip sensitive fields before serialization. Enforce a stronger password policy (length + complexity) as defense-in-depth.

---

### SEC-08 — Stored XSS in internal messaging via `dangerouslySetInnerHTML` on unsanitized message body

**Severity:** High · **CWE-79**

**Location:** `src/app/messages/page.jsx:1487` (sink: `dangerouslySetInnerHTML={{ __html: msg.body }}` inside a `prose` container); `src/app/api/messages/route.js:174-178` (source: `messageBody` from request body), `:266-272` (stored verbatim via INSERT).

**Description:** Message bodies are stored raw from `POST /api/messages` and rendered as HTML on the recipient's Messages page. **No HTML sanitizer (DOMPurify/sanitize-html) exists anywhere in `src/`** — verified by grep. Any authenticated user can deliver a script payload to any other user that executes in the app origin under the victim's session.

**Exploit:** Send a message with `<img src=x onerror="fetch('/api/settings/password', …)">` → recipient's session used to change their password / exfiltrate data. Also chains into SEC-01/SEC-03 (cookie planting → forged session).

**Fix:** Sanitize message body server-side on write with an allowlist HTML sanitizer (sanitize-html / DOMPurify) or store and render as plain text; never use `dangerouslySetInnerHTML` for user content.

---

### SEC-09 — Stored XSS in Material Requisition download endpoint (unescaped DB fields in `text/html`)

**Severity:** High · **CWE-79**

**Location:** `src/app/api/admin/material-requisitions/download/route.js:67` (title interpolation), `:249-258` (`requisition_number`/`requested_by`/`department`), `:275-278` (line-item `description`/`purpose`), `:305-321` (signature fields), `:337-340` (served as `text/html`); source: `src/app/api/admin/material-requisitions/route.js:104-116` (POST stores fields verbatim).

**Description:** `GET /api/admin/material-requisitions/download?id=…` returns a full HTML document built by string interpolation of DB fields with **no escaping** — unlike `cash-vouchers/download`, which wraps every field in `escapeHtml()`. The response is served with `Content-Type: text/html` and renders inline at the app origin.

**Exploit:** Any authenticated employee creates a requisition with `<script>`/`<img onerror>` in `requested_by`/`department`/item description; an admin opening the print/download URL executes it with admin rights.

**Fix:** Escape every interpolated value with an `escapeHtml()` helper (pattern already present in `cash-vouchers/download`), or generate the document with a templating library; also set `Content-Disposition: attachment` and a CSP for HTML responses.

---

### SEC-10 — Path traversal in document-upload: unsanitized `entity_id` in filename → arbitrary file write and unlink

**Severity:** High · **CWE-22**

**Location:** `src/app/api/document-upload/route.js:97-99` (`uniqueFilename = \`${entityType}_${entityId}\_${uuidv4()}${extension}\``— only`entityType`is whitelisted),`:112-115` (`path.join(uploadDir, uniqueFilename)`+`writeFile`), `:233-234`(DELETE:`path.join(process.cwd(), 'public', docs[0].file_url)`+`unlink`).

**Description:** `entity_id` is arbitrary formData input. `path.join()` resolves `../` segments, so an authenticated user can write a file (extension constrained to the whitelist, e.g. `.pdf`) to any directory the process can write. The stored `file_url` records the same unsanitized name, and DELETE later `path.join()`s it for `unlink()`, giving an arbitrary-file-deletion primitive for attacker-chosen paths.

**Exploit:** `entity_id = ../../../../tmp/pwn` writes `/tmp/pwn_<uuid>.pdf`; DELETE on the returned doc id unlinks an attacker-chosen path (suffix `_<uuid>.<whitelisted-ext>`), e.g. deleting application files ending in a whitelisted extension.

**Fix:** Never embed user-supplied `entity_id` in the file name — use only the UUID + whitelisted extension (pattern already used by `messages/attachments`); reject any `entity_id` containing `/`, `\`, or `..`; sanitize with `path.basename()`.

---

## 🟡 Medium

### SEC-11 — Rate-limit identity is attacker-controlled (`X-Forwarded-For` + `user_id` cookie)

**Severity:** Medium · **CWE-307, CWE-799, CWE-290**

**Location:** `middleware.ts:47-58` (`getClientIP` reads client-supplied `x-forwarded-for` first), `:105-110` (rate-limit key = `${ip}:${userId}` where `userId` comes from the client cookie), `:41-45` (auth category: 10 req/15 min).

**Description:** For `/api/login` (no `user_id` cookie yet) the identity is purely the spoofable IP — rotating `X-Forwarded-For` per request mints a fresh 10-attempts/15-min budget every time → unlimited password guessing. Authenticated attackers rotate the `user_id` cookie to dodge per-user API limits. (The in-memory store limitation under serverless is separately documented in POOR_PRACTICES_AUDIT.md §1.6.)

**Fix:** Derive the client IP only from a trusted platform-provided value (Vercel/nginx-injected header after `X-Forwarded-For` is stripped); key on verified IP + server-side session user id; use a shared store.

---

### SEC-12 — Auth cookies' `Secure` flag derived from client-forgeable `x-forwarded-proto`

**Severity:** Medium · **CWE-614**

**Location:** `src/app/api/login/route.js:198-207` (and cookie sets at 209-226), `src/app/api/logout/route.js:27-36`.

**Description:** `isSecure` is computed from the `x-forwarded-proto` request header. If the app is reachable directly over HTTP or the terminating proxy passes the client header through, an attacker sends `x-forwarded-proto: http` and the server issues session cookies **without the `Secure` attribute** — enabling cookie capture over any plaintext path and cookie injection (chaining into SEC-01/SEC-03).

**Fix:** Set `Secure` unconditionally in production (config/env-driven), never from a client header.

---

### SEC-13 — Sensitive financial and master-data endpoints gated only by `getCurrentUser`

**Severity:** Medium · **CWE-862**

**Location:** `src/app/api/admin/invoice-list/route.ts:11-30` (all invoices incl. gross/net/tax amounts); `src/app/api/admin/payee-list/route.js:10-24` (all companies + vendors); `src/app/api/masters/accounts/route.js:9-27,68-90,147-165,236-255` (full CRUD on account heads); `src/app/api/masters/banks/route.js:10-30,159-180,257-277` (full CRUD on bank master data). Pattern-checked `admin/todos`, `employee-master/list`, `activity-master/options` are same-gate but lower sensitivity.

**Description:** A cluster of routes authorizes solely on "a user is logged in" — no resource/action check. Any authenticated account, including a basic vendor/employee login, can read financial lists and create/update/delete master data.

**Fix:** Replace `getCurrentUser`-only gating with `ensurePermission(request, RESOURCE, ACTION)` on every handler (e.g. `ACCOUNTS`/`BANKS` for masters, `INVOICES.READ` for invoice-list).

---

### SEC-14 — Password change/reset does not invalidate existing sessions

**Severity:** Medium · **CWE-613**

**Location:** `src/app/api/settings/password/route.js:83-91`; `src/app/api/users/reset-password/route.js:50-60`; `src/utils/api-permissions.js:224-228` (`last_password_change` fetched but never enforced).

**Description:** Password updates record `last_password_change` but nothing invalidates existing sessions — and because sessions are stateless cookies (SEC-01), there is nothing to revoke. A session cookie stolen before a password reset keeps working indefinitely after the victim resets.

**Fix:** Implement server-side sessions (SEC-01) and delete/revoke all of the user's sessions on password change and reset.

---

### SEC-15 — Stored XSS via rich-text project/proposal fields (tag-presence check is not sanitization)

**Severity:** Medium · **CWE-79**

**Location:** `src/app/projects/[id]/page.jsx:45-54` (`HtmlContent`: `/<[^>]+>/.test(html)` → `dangerouslySetInnerHTML`), `:212`; `src/app/projects/[id]/edit/tabs/ScopeTab.jsx:16-18` (same helper copy); `src/app/proposals/[id]/edit/page.jsx:2704-2706` (`proposalData.description` rendered raw).

**Description:** User-editable rich-text fields (`scope_of_work`, `additional_scope`, proposal description) are persisted as raw HTML and rendered via a helper that only checks whether tags are present — `<img src=x onerror=…>` passes and executes. Editors with project/proposal update rights can store a payload that executes for every viewer.

**Fix:** Sanitize rich-text content server-side on write (DOMPurify/sanitize-html with a strict allowlist) and/or render sanitized HTML client-side; never trust editor output.

---

### SEC-16 — Spreadsheet formula injection in Excel exports (CWE-1236)

**Severity:** Medium · **CWE-1236**

**Location:** `src/app/api/payroll/export-sheet/route.js:16-18` (`safeStr = (v) => v == null ? '' : String(v)` — no prefix neutralization), `:647-655` (employee `full_name`/`position`/`uan`/`pf_no` written to cells); `src/app/api/employees/[id]/salary-structure/export/route.js:77-81`; `src/app/reports/project-activities/excel-template.ts:157-164`.

**Description:** Employee-controlled strings are written raw into workbook cells. ExcelJS stores `=`-prefixed strings as formulas, so when finance opens the exported pay sheet, injected formulas (`=HYPERLINK(…)`, DDE, `cmd`) execute in their Excel session.

**Exploit:** An employee (name/position settable via HR entry or the bulk CSV import) uses `=HYPERLINK("http://evil/","x")` as their name; the payroll export then triggers network/process activity on the finance team's machines.

**Fix:** Neutralize leading `=`, `+`, `-`, `@` (prefix with `'` or set cell type to text) on all user-derived strings before writing to workbooks, across all three export paths.

---

### SEC-17 — Upload validation is MIME/extension-only with OR logic; content never inspected

**Severity:** Medium · **CWE-434, CWE-79**

**Location:** `src/app/api/document-upload/route.js:73-83`; `src/app/api/messages/attachments/route.js:66-83` (`if (!ALLOWED_TYPES[file.type] && !ALLOWED_EXTENSIONS.includes(fileExt))` — passes if either matches; both attacker-controlled).

**Description:** The `Content-Type` header is entirely attacker-controlled and file bytes are never validated (no magic-byte check, no re-encoding). A `.png`-named file containing an HTML page is stored as-is; with no `nosniff` header anywhere (SEC-24), content-sniffing browsers/embedded viewers render it as HTML on the app origin.

**Fix:** Validate by magic bytes (reject HTML/JS/SVG signatures regardless of declared type), re-encode or quarantine binary content, serve all user files with `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment`, run AV scanning for Office/PDF types.

---

### SEC-18 — No size limit on `POST /api/uploads` base64 payload (memory-exhaustion DoS)

**Severity:** Medium · **CWE-400**

**Location:** `src/app/api/uploads/route.js:21-36` (`Buffer.from(cleaned, 'base64')` with no byte-length cap, then sharp decode). `document-upload` enforces `MAX_FILE_SIZE = 20MB`; this route has no equivalent, and Next.js route handlers impose no default body limit.

**Exploit:** A multi-hundred-MB base64 body (or a decompression-bomb PNG) exhausts Node heap/event loop, degrading or crashing the shared instance. Requires `projects:update` (no ownership of any project needed).

**Fix:** Cap request body (`content-length` pre-check + parsed size guard) and decoded buffer (≤ 20MB, consistent with the other endpoint); set sharp `limitInputPixels`.

---

### SEC-19 — Hardcoded default super-admin credentials in committed setup script

**Severity:** Medium · **CWE-798, CWE-1188**

**Location:** `scripts/setup-super-admin.js:15-18` (`username: 'crmadmin'`, `email: 'crm@accent.com'`, `password: 'admin123'`), `:66-70` (unconditionally promotes any existing user with that username to super admin).

**Description:** The committed script (not gitignored) creates or promotes a super admin with fixed, guessable credentials. If it was ever run against the deployed environment, `crmadmin`/`admin123` is a known default super-admin login; there is no forced password change anywhere in the app.

**Fix:** Remove hardcoded credentials — require the operator to supply a password interactively or via env; never auto-promote an existing user without explicit confirmation; enforce password-change-on-first-login.

---

### SEC-20 — Production MySQL credentials and predictable auth secrets in local `.env`; DB on a public IP

**Severity:** Medium · **CWE-798, CWE-200**

**Location:** `.env` (repo root; gitignored per `.gitignore` lines ~31 and ~117-119); `src/utils/database.js:16-28` (uses `PROD_DB_*`).

**Description:** The on-disk `.env` contains production credentials (`PROD_DB_USER=accent_user`, `DB_NAME=crmaccent`) and `DB_HOST=94.103.163.250` — a routable public IP on port 3306. `AUTH_SECRET`/`JWT_SECRET` are predictable defaults (`accent-crm-dev-secret-key-2024-change-in-production`) that nothing in `src/` actually uses — any future code signing with them would use a publicly-known secret.

**Exploit:** If `.env` leaks (shared machine, backup, repomix-style export), the attacker connects directly to production MySQL over the internet — the database is reachable from outside, not just the app server.

**Fix:** Rotate all credentials immediately; restrict MySQL to the app host/VPC (no public binding); store secrets in a vault/secrets manager; remove the dead `AUTH_SECRET`/`JWT_SECRET` or replace with strong random values; add a `.env.example` with placeholders.

---

### SEC-21 — HTML injection into server-side receipt PDF generation (headless Chrome)

**Severity:** Medium · **CWE-94, CWE-918**

**Location:** `src/utils/buildReceiptHTML.ts:34,47-48,58-65` (unescaped interpolation of `receipt_no`, `company_name`, `amount_words`, `transaction_id`, …); `src/app/api/admin/payment-entries/get-receipt-pdf/route.ts:28` (`ReceiptData` straight from `req.json()`), `:57-60` (`page.setContent(html)`). Guarded by `ensurePermission(ADMIN, READ)`.

**Description:** Request-controlled fields are interpolated unescaped into HTML rendered in headless Chromium. The headless browser fetches embedded resources from the server's network — a limited SSRF / internal-network probe primitive — and the resulting PDF embeds attacker-chosen links/images.

**Fix:** HTML-escape every interpolated value (`&<>"'`) or build the document with DOM/text nodes; restrict network in the browser launch (`page.setRequestInterception` to block non-local resources).

---

## 🔵 Low

### SEC-22 — Login user enumeration via response timing; unused public `/api/auth/login` credential oracle

**Severity:** Low · **CWE-208, CWE-203**

**Location:** `src/app/api/login/route.js:90-102` (`verifyPassword` runs only when a matching row exists — nonexistent username returns 401 in ~1ms vs ~60-100ms bcrypt for existing); `src/app/api/auth/login/route.js:17-30` (public, covered by the `/api/auth` allowlist, never referenced by app code, returns `success: true` for valid credentials **without creating a session**).

**Description:** Timing deltas enable username enumeration (rate-limited at 10/15 min per IP, but bypassable per SEC-11). `/api/auth/login` is a standalone unauthenticated password checker.

**Fix:** Run a dummy bcrypt compare when the user is not found to equalize timing; delete or gate `/api/auth/login` behind real session creation.

---

### SEC-23 — `document.write` of unescaped payroll slip data into a same-origin print window

**Severity:** Low · **CWE-79**

**Location:** `src/app/reports/page.jsx:465-466` (print window + `document.write`), `:520-537` (`${selectedSlip?.employee_name}`, position, department interpolations).

**Description:** The salary-slip print handler builds a full HTML document interpolating employee fields without escaping. A name/designation containing markup (achievable via employee CSV import or HR entry) executes in a same-origin popup at print time.

**Fix:** Build the print DOM with `createElement`/`textContent` or escape all interpolated values before `document.write`.

---

### SEC-24 — Missing security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)

**Severity:** Low · **CWE-1021, CWE-693**

**Location:** `next.config.ts` (entire config — `poweredByHeader: false` but no `headers()`); `middleware.ts:266-273` (only `Cache-Control`/`Pragma`/rate-limit headers).

**Description:** No `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, or `Referrer-Policy` on any response. Amplifies SEC-02/SEC-17 (no CSP to block inline script; no nosniff to stop MIME sniffing) and enables clickjacking of admin pages and protocol-downgrade attacks.

**Fix:** Add a `headers()` block in `next.config.ts`: CSP (`default-src 'self'`; disallow inline script or use hashes), `Strict-Transport-Security: max-age=63072000`, `X-Frame-Options: DENY` (or `frame-ancestors` in CSP), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.

---

## ⚪ Informational

### SEC-25 — Dependency posture: no confirmed active CVEs; unmaintained packages and version skew

**Severity:** Informational · **CWE-1104**

**Location:** `package.json:30-75`, `package-lock.json` (resolved versions verified).

**Description:** Installed versions sit on patched lines for known CVEs: `next` 15.5.18 (CVE-2025-29927 middleware bypass fixed in 15.2.3; image-optimization DoS fixes in 15.4.1), `mysql2` 3.23.1 (CVE-2024-21507/21508/21512 fixed before 3.23.1), `exceljs` 4.4.0 (CVE-2024-6442 prototype pollution fixed in 4.4.0), `papaparse` 5.5.3 (ReDoS fixed in 5.4.x). Watch items: `jsonwebtoken` 9.0.2 (unmaintained since 2023 **and unused** — no imports in `src/`); `exceljs` 4.4.0 and `html2canvas` 1.4.1 effectively unmaintained; direct `puppeteer-core` 24.43.0 sits alongside `puppeteer` 25.1.0 which bundles its own core 25.1.0 — two browser-core versions in one tree; `@sparticuz/chromium` 148.0.0 must stay in lockstep.

**Fix:** Remove unused `jsonwebtoken`; align `puppeteer-core` with `puppeteer`'s internal version; schedule migration off `exceljs`/`html2canvas`/`papaparse`; run `npm audit`/`osv-scanner` in CI.

---

## Surfaces checked and found clean

| Surface           | Result                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL injection     | No findings. All dynamic identifiers (columns, ORDER BY, LIMIT/OFFSET) traced to hardcoded whitelists or `parseInt`-derived numerics; all values parameterized with `?` placeholders across ~90 API route files  |
| Command injection | No findings. No `child_process`/`exec`/`spawn` usage in `src/`                                                                                                                                                   |
| SSRF              | No findings. No server-side `fetch`/`axios`/`http` usage in API routes or utils (`http.js`/`api-client.js` are client-side); the only server-side network primitive is the receipt-PDF headless browser (SEC-21) |

## Remediation order

1. **SEC-01 + SEC-03 + SEC-14 (session model)** — opaque server-side session tokens; sign or drop the `session_permissions` cookie. This single workstream removes the root cause behind most account-takeover chains.
2. **SEC-02 + SEC-06 + SEC-10 (upload/storage model)** — rasterize uploads, move files out of `public/`, serve via authenticated routes, stop embedding `entity_id` in filenames.
3. **SEC-08 + SEC-09 + SEC-15 (XSS)** — add a sanitizer on write (sanitize-html/DOMPurify) for messages and rich-text; escape HTML download templates.
4. **SEC-04 + SEC-07 (user/PII endpoints)** — remove `password_hash` from writable/returned fields; explicit column lists.
5. **SEC-19 + SEC-20 (secrets)** — rotate DB credentials, remove hardcoded super-admin script creds, restrict MySQL to private network.
6. **SEC-11 + SEC-12 (transport/rate-limit)** — trusted IP source; unconditional `Secure` in prod.
7. **SEC-24 (headers)** — CSP/HSTS/nosniff/frame-denial as a quick global hardening step.
8. Remaining: SEC-05, SEC-13, SEC-16, SEC-17, SEC-18, SEC-21, SEC-22, SEC-23, SEC-25.
