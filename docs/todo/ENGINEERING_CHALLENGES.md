# Engineering Challenges — Accent CRM

> Captured 2026-09-09. Load-bearing work only — each item fixes a live weakness and teaches one hard skill. Sources: `docs/SECURITY_AUDIT.md`, `proxy.ts`, `src/utils/database.js`, `CONTEXT.md`, `docs/todo/`.

## 1. Distributed rate limiter — `proxy.ts:38-177`

- Problem: `rateLimitStore: Map` in-memory, per-instance. `getClientIP()` trusts `x-forwarded-for` first → rotate header = fresh `auth:10/15m` budget. SEC-11 still open.
- Work: trusted IP source only (`cf-connecting-ip` / `x-vercel-forwarded-for` after stripping spoofable), key on `SHA-256(session)` + IP, shared backing store (Redis/Upstash or table with `expires_at`). Keep `cleanupRateLimitStore()` semantics, add `Retry-After`.
- Skills: edge trust boundaries, distributed throttling, brute-force modeling.
- Verify: forged-header test still 429s; multi-instance test with shared store.

## 2. XSS kill chain — SEC-08/09/15/24 open

- Problem: no sanitizer anywhere in `src/`. Sinks: `src/app/messages/page.jsx:1487` (`dangerouslySetInnerHTML`), `src/app/projects/[id]/page.jsx:45-54` (tag-presence check is not sanitization), `src/app/api/admin/material-requisitions/download/route.js:249-340` (unescaped interpolation, `text/html`). No `headers()` in `next.config.ts`.
- Work: server-side allowlist sanitize on write (`sanitize-html` / DOMPurify) for messages + `scope_of_work` / proposal description; `escapeHtml()` every download template (copy `cash-vouchers/download` pattern); add `Content-Security-Policy: default-src 'self'`, `HSTS`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` + `Content-Disposition: attachment` on HTML responses.
- Skills: input vs output encoding, allowlists, CSP as second layer.
- Verify: `<img src=x onerror=...>` stored inert, rendered inert; header assertions.

## 3. Upload validation + DoS — SEC-17/18

- Problem: `src/app/api/document-upload/route.js:73-83` OR logic (`!ALLOWED_TYPES[file.type] && !ALLOWED_EXTENSIONS`) — both attacker-controlled, no magic bytes. `src/app/api/uploads/route.js:21-36` does `Buffer.from(cleaned, 'base64')` with no cap → heap exhaustion. Good pattern: `private/message-attachments` + authenticated download.
- Work: magic-byte check, reject HTML/JS/SVG signatures regardless of extension, `content-length` pre-check + decoded ≤20MB (match `MAX_FILE_SIZE`), `sharp({ limitInputPixels: 40M })` re-encode, pure UUID filenames, serve via `private/documents/` + `nosniff` + `attachment`.
- Skills: binary trust, decompression bombs, authenticated object serving.
- Verify: polyglot `.png`-named HTML rejected; 100MB base64 → 413 before `Buffer.from`.

## 4. Payroll correctness — `src/utils/payroll-calculator.js`, `src/lib/money.ts`

- Problem: dual truth per `CONTEXT.md`: `employee_salary_profile` vs legacy `salary_structures` (+ components), `payroll_schedules` vs `da_schedule`. Money must use `R` / `add` / `sub` / `mul` / `div` (Decimal 20, `ROUND_HALF_UP`), never `parseFloat`. `SELECT *` ×87 risks re-leaking `bank_account_no` / `pan` / `aadhar`.
- Work: unify one calc path via `computePayroll` / `generatePayrollSlip`, `withTransaction()` for slip insert, explicit column lists, invariant `total_earnings - total_deductions === net_pay`, idempotent `(employee_id, month)` with unique generated column `IF(isDelete = 0, ...)`.
- Skills: financial domain modeling, fixed-point math, idempotency under retry.
- Verify: `money.test.ts`-style boundary tests + slip regression; `EXPLAIN` on covering indexes via Knex migration.

## 5. DB under `connectionLimit: 5` — `src/utils/database.js:34`

- Problem: pool stays at 5 (under MySQL `max_user_connections`), `queueLimit: 200`. Missing `isDelete = 0` filters and unbounded `SELECT * ... ORDER BY created_at DESC` (e.g. `src/app/api/admin/outgoing-purchase-orders/route.ts:25`, `src/app/api/admin/payment-entries/route.js:53-62`) plus dashboard polling will queue-block.
- Work: pagination + covering indexes, prefer `query()` / `withDb()` over manual `dbConnect() + finally release()`, wire `getPoolStats()` + slow-query log. Never `CREATE/ALTER/SHOW` in routes — use `hasColumn()` (`src/utils/schema-cache.js`, 10m TTL) + Knex migrations.
- Skills: connection queuing, query planning, migration discipline.
- Verify: `migrate:status` clean; dashboard poll at 60/m without `too many connections`.

## 6. RBAC completion + spreadsheet injection — SEC-13/16

- Problem: `src/app/api/admin/invoice-list/route.ts:11-30`, `payee-list`, `masters/accounts|banks` gated only by `getCurrentUser` — any login reads/writes masters. Excel exports (`src/app/api/payroll/export-sheet/route.js:647-655`) write `full_name` / `position` / `uan` raw → `=HYPERLINK` executes in finance Excel.
- Work: `ensurePermission(req, RESOURCES.*, PERMISSIONS.*)` on every handler (`src/utils/api-permissions.js`, `src/utils/permissions.js` + `rbac.js` via `mergePermissions`); extend `sanitizeEmployeePII` pattern; prefix-neutralize `=+-@` in all ExcelJS cells (text type).
- Skills: least-privilege authz, output encoding for non-HTML sinks.
- Verify: roleless user → 403 on masters; `=cmd|` name exports as literal text.

## Suggested order

Start with 2 or 4 — self-contained, no infra, forced tests. Then 6, 3, 5, 1 (increasing infra/distributed scope).
