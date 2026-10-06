# RBAC & Permission System

> Current reference — last verified 2026-10-06 against the files in “Which file does what”.
> Part of the [documentation index](../README.md). Security background: ADR-0011 (session
> validation), ADR-0013 (rate-limit identity), ADR-0014 (public allowlist).

## Architecture overview

The system has **two coexisting permission formats** evaluated by a single central checker. Both are additive — a permission granted by either format is sufficient.

|                 | Flat (legacy)                                   | Nested `field_permissions` (newer)                      |
| --------------- | ----------------------------------------------- | ------------------------------------------------------- |
| **Format**      | `"resource:permission"` strings in arrays       | `{modules: {resource: {enabled, crud, sections}}}` JSON |
| **Stored in**   | `roles_master.permissions`, `users.permissions` | `users.field_permissions` (longtext, JSON-validated)    |
| **Granularity** | Resource × action                               | Module → section → individual field                     |
| **Field-level** | No                                              | `edit` / `view` / `hidden` per field                    |

---

## Permission vocabulary

### Resources (38 total — `rbac.js:7`)

| Category    | Resources                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **CRM**     | `leads`, `proposals`, `projects`, `followups`, `tickets`, `work_logs`, `todos`                                                  |
| **People**  | `employees`, `users`, `companies`, `vendors`                                                                                    |
| **Finance** | `quotations`, `purchase_orders`, `invoices`, `cash_voucher`, `material_requisition`, `other_expenses`, `petty_cash_expenses`    |
| **Masters** | `activities`, `software`, `documents`, `deliverables`, `roles`, `holidays`, `accounts`                                          |
| **Admin**   | `admin`, `admin_monitoring`, `admin_activity_logs`, `admin_audit_logs`, `admin_productivity`, `payroll`, `attendance`, `leaves` |
| **Other**   | `dashboard`, `reports`, `messages`, `profile`, `settings`                                                                       |

### Actions (10 — `rbac.js:55`)

`read` · `create` · `update` · `delete` · `close` · `export` · `import` · `approve` · `assign` · `convert`

Permission key format: `"<resource>:<action>"` — e.g. `"leads:read"`, `"projects:approve"`.

### Templates (`rbac.js:69`)

Predefined action sets for common roles — used in the admin UI to pre-populate checkboxes:

| Template  | Actions                                |
| --------- | -------------------------------------- |
| `VIEWER`  | `read`                                 |
| `EDITOR`  | `read`, `create`, `update`             |
| `MANAGER` | EDITOR + `delete`, `approve`           |
| `ADMIN`   | MANAGER + `export`, `import`, `assign` |

---

## Database schema

### `roles_master`

| Column           | Type        | Purpose                                                            |
| ---------------- | ----------- | ------------------------------------------------------------------ |
| `permissions`    | JSON array  | Flat permission keys assigned to the role                          |
| `role_hierarchy` | int (0–100) | Used by `getDefaultPermissionsForLevel()` to auto-generate presets |

### `users`

| Column              | Type                              | Purpose                                           |
| ------------------- | --------------------------------- | ------------------------------------------------- |
| `permissions`       | longtext (JSON array)             | Direct user overrides — augments role permissions |
| `field_permissions` | longtext (JSON, string or object) | Nested module/section/field structure             |
| `role_id`           | FK → `roles_master`               | User's assigned role                              |
| `is_super_admin`    | boolean                           | Hard bypass — `true` grants every permission      |

### Effective permissions at runtime

When `getCurrentUser()` fetches a user from the DB (`api-permissions.js:66`):

1. **Role permissions** parsed from `roles_master.permissions`
2. **User permissions** parsed from `users.permissions`
3. **Merged** via `mergePermissions()` into `merged_permissions` (set union)
4. **`field_permissions`** parsed and disabled modules stripped (`stripDisabledModules`); handles both string and object, since the column is longtext with a JSON validity check
5. **Role hierarchy defaults are NOT auto-applied** — only explicitly assigned permissions count (see the comment at `api-permissions.js:173-174`). Note the one exception: `POST /api/login` falls back to `getDefaultPermissionsForLevel(role_hierarchy)` when the role's permission array is empty (`src/app/api/login/route.js:180-190`). The admin UI also uses that function to pre-populate checkboxes.

The resulting user object has:

- `permissions` — direct user flat array
- `role_permissions` — flat array from role
- `merged_permissions` — union of both
- `field_permissions` — parsed nested object (disabled modules stripped)
- `is_super_admin` — boolean

---

## `checkPermission(user, resource, permission)` — the central checker

`src/utils/permissions.js:50` — the central checker that client components and `ensurePermission()` call.

### Evaluation order

```
1. !user                          → false   (no user = no permissions)
2. user.is_super_admin            → true    (hard bypass)
3. user.merged_permissions        → check flat array for "resource:permission"
4. user.field_permissions         → parse if string; check modules.<resource>.enabled && modules.<resource>.crud.<permission>
5. Fall through                   → false
```

Step 3 reads only `merged_permissions` (the union of role + user flat arrays built by `getCurrentUser()`), not `user.permissions` / `user.role_permissions` separately.

Step 4 handles `field_permissions` that may be stored as a **JSON string** — it `JSON.parse`s transparently. The check is: module must be `enabled: true` AND have the specific action in `crud`. Disabled modules are stripped from the user object before it reaches this function.

### Related utility functions (same file)

| Function                                                  | Purpose                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `checkPermissionFromSession(sessionData, resource, perm)` | Same logic against a session-data snapshot (`{permissions, is_super_admin}`); currently exported but unused |
| `hasAnyAccess(user, resource)`                            | True if user has ANY flat permission for the resource                                                       |
| `getPermissionsFor(user, resource)`                       | Returns all actions the user has for a resource                                                             |
| `checkAllPermissions(user, checks)`                       | All of `[{resource, permission}, ...]` must pass                                                            |
| `checkAnyPermission(user, checks)`                        | At least one of `[{resource, permission}, ...]` must pass                                                   |
| `createPermissionChecker(user)`                           | Returns `(resource, perm) => bool` bound to user                                                            |

### Nested-structure helpers

| Function                                                    | What it checks                                            |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `isModuleEnabled(fieldPermissions, moduleKey)`              | Module is `enabled: true`?                                |
| `isSectionEnabled(fieldPermissions, moduleKey, sectionKey)` | Section is `enabled: true`?                               |
| `getFieldPermission(fp, module, section, field)`            | Returns `'hidden'`, `'view'`, or `'edit'`                 |
| `canViewField(fp, module, section, field)`                  | Permission is `view` or `edit`?                           |
| `canEditField(fp, module, section, field)`                  | Permission is `edit`?                                     |
| `getEnabledModules(fieldPermissions)`                       | List of enabled module keys                               |
| `getModuleCRUD(fieldPermissions, moduleKey)`                | `{read, create, update, delete, export, import}` booleans |
| `checkModulePermission(user, moduleKey, permission)`        | Checks flat arrays first, then nested structure           |

---

## Server-side authorization flow

### `session` cookie + `getCurrentUser(request)`

There is no separate permission cookie. `getCurrentUser(request)` (`api-permissions.js:66`) reads the opaque `session` cookie, hashes it (`hashSessionToken`), and validates it against `sessions JOIN users` — token hash match, `expires_at > NOW()`, active, not soft-deleted (ADR-0011). It then parses role/user permissions and builds the user object described above.

### `ensurePermission(request, resource, permission)` — the route guard

`api-permissions.js:256` — the primary function for protecting API routes.

```
1. getCurrentUser(request)   (in-memory cached; DB on cache miss)
   ├─ No user? → 401 {error: "Unauthorized"}
   ├─ Super admin OR checkPermission() passes? → {authorized: true, user}
   └─ Neither? → 403 {error: "Forbidden: missing permission"}
       (denial logged to console in development only)
```

### `getCurrentUser(request)` — caching

`api-permissions.js:66` — fetches `sessions JOIN users JOIN roles_master LEFT JOIN employees`.

| Layer                                            | TTL         | Purpose                                                             |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------- |
| In-memory `userCache` (Map, keyed by token hash) | 60 s        | Avoid DB for repeated requests within the window (ADR-0013)         |
| In-flight dedup (`pendingUserFetches` Map)       | Per-request | Two concurrent cold-cache requests share one DB promise             |
| Stale-on-failure                                 | N/A         | If the DB errors, returns an expired cached user rather than `null` |

The cache is bounded (`MAX_CACHE_SIZE = 500`; oldest 100 evicted on overflow). Stale-on-failure prevents cascading "Unauthorized" errors when the DB pool is exhausted; the 60-second TTL bounds how long a revoked permission or deactivated user stays usable (ADR-0013).

### Other server-side functions

| Function                                 | Use case                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `hasPermission(request, resource, perm)` | Boolean only — no user object returned                                                                            |
| `invalidateUserCache(userId)`            | Purge a user (or the whole map when no id) from the in-memory cache                                               |
| `canModifyTargetUser(caller, target)`    | User-management guard: only super admins may edit/delete super admins; no edits to equal/higher hierarchy         |
| `validateUserGrants(caller, data, db)`   | Prevents privilege escalation when creating/updating users (role, permissions, field_permissions, is_super_admin) |

---

## Client-side authorization flow

### Data flow

```
Component calls session.can("leads", "read")
  → useSession().can  (SessionContext.jsx:139)
    → checkPermission(user, resource, permission)  (permissions.js:50)
      → checks against the user object in React state
```

### SessionContext lifecycle (`src/context/SessionContext.jsx`)

1. **Provider mount:** starts with `loading: true` to prevent hydration mismatches with SSR, then calls `fetchSession()` → `GET /api/session` → `{authenticated, user}`
2. **No client-side cache:** every fetch hits the server; a `fetchingRef` guard prevents concurrent fetches
3. **Re-fetch triggers:** SPA route changes (`usePathname`) and tab visibility changes (`visibilitychange`) — permission changes made in another tab land without a manual reload
4. **Error handling:** `401` clears the user (logged out); other errors keep the current state
5. **`can()` is memoized** on the `user` object — it only re-evaluates when the user changes
6. **Helpers:** `refreshSession()` forces a re-fetch; `clearSessionCache()` / `setSessionData()` are exported for the login/logout flows (`src/app/signin/page.jsx`, `src/components/Navbar.jsx`)

(A separate `AutoRefresh` watchdog in `src/app/layout.jsx` reloads a page that fails to finish loading within 30 s — it is not a session poller.)

### `useSessionRBAC()` (`src/utils/client-rbac.js`)

Thin wrapper over `useSession()`. Re-exports `can`, `user`, `loading`, `RESOURCES`, `PERMISSIONS`. Exists for backward compatibility — new code should use `useSession()` directly.

### Usage in components

```jsx
const { can, RESOURCES, PERMISSIONS } = useSession();

// Gate a section
{
	can(RESOURCES.LEADS, PERMISSIONS.READ) && <LeadsSection />;
}

// Gate an action button
{
	can(RESOURCES.PROJECTS, PERMISSIONS.CREATE) && <CreateProjectButton />;
}
```

---

## Proxy layer (`src/proxy.ts`)

The Next 16 proxy (renamed from `middleware.ts`, Node.js runtime) handles **authentication** (not authorization) and **rate limiting**:

- **Public endpoints** are an exact-match allowlist (ADR-0014): `/signin`, `/api/login`, `/api/logout`, `/api/session`, `/api/attendance/webhook`, `/api/health`, plus static assets (`/_next`, `/public`, `/uploads`, `favicon.ico`, …). No prefix matching except those asset trees.
- **Auth check:** SHA-256 the `session` cookie and verify it against `sessions JOIN users` (unexpired, active, not soft-deleted). Invalid → redirect to `/signin` (pages) or `401` JSON (API). A forged cookie value is worthless.
- **Rate limiting:** identity is the platform-set IP header (`x-vercel-forwarded-for`) plus the validated session token hash, tiered by endpoint category — `auth` (10/15 min) and `heavy` download/export/bulk (10/min) count in MySQL fixed windows shared across instances; `session` (120/min), `dashboard` (60/min) and default `api` (120/min) stay in-process. Returns `429` with `Retry-After` / `X-RateLimit-*` headers.

The proxy does **not** check resource-level permissions — API routes authorize through `ensurePermission()` (the dominant pattern), with a few owner-scoped routes (tickets, `admin/invoices/[id]`) using `getServerAuth()`. `npm run check:route-auth` fails CI when a handler lacks an auth reference.

---

## Permission management UI

### User listing: `/masters/users`

- Gated by `users:read`
- Shows employee linkage, permission count, status per user
- "Permissions" button navigates to per-user editor

### Permission editor: `/masters/users/[id]/permissions`

- **Left sidebar:** modules grouped by category (Main Modules, Masters, Financial Documents, Admin) with checkboxes
- **Right panel** (when a module is selected):
  - Module-level CRUD toggles (read/create/update/delete/export/import + special: convert/approve/assign/close)
  - Section toggles (e.g. "Basic Information", "Enquiry Details")
  - Per-field level selectors: `edit` / `view` / `hidden`
- **On save:** builds both formats — flat `permissions` array + nested `field_permissions` JSON — and sends both via `PUT /api/users`. Also logs to audit trail.

### Role defaults

`getDefaultPermissionsForLevel(hierarchyLevel)` (`rbac.js:284`) generates a preset permission set. It is used to pre-populate the permission editor when creating/editing roles, and as a login fallback when a role has no explicit permissions (`src/app/api/login/route.js:180-190`).

| Hierarchy | Auto-assigned permissions                                                                  |
| --------- | ------------------------------------------------------------------------------------------ |
| Any       | `read` on all resources (except employees/vendors)                                         |
| 40+       | create/update on leads/activities/documents + read employees/vendors + create/update users |
| 60+       | Create/update/approve projects/proposals + delete users                                    |
| 80+       | Full access to all resources and all actions                                               |

---

## Typical API route pattern

```js
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { dbConnect } from '@/utils/database';
import { logActivity } from '@/utils/activity-logger';

export async function GET(request) {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.READ
	);
	if (!auth.authorized) return auth; // 401 or 403 NextResponse

	const db = await dbConnect();
	try {
		const [rows] = await db.execute('SELECT ...');
		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		db.release();
	}
}
```

For mutations, always call `logActivity()` after the DB write.

---

## Which file does what

| File                                              | Role                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/rbac.js`                               | Defines RESOURCES, PERMISSIONS, templates, hierarchy-based defaults, `mergePermissions()`, `validatePermissions()`                  |
| `src/utils/permissions.js`                        | Central `checkPermission()` + `checkPermissionFromSession()` + field-level helpers + batch checkers                                 |
| `src/utils/api-permissions.js`                    | Server-side: `ensurePermission()`, `getCurrentUser()` (session-token cache, stale-on-failure), `hasPermission()`, escalation guards |
| `src/utils/session-probe.ts`                      | `hashSessionToken()` + `isSessionValid()` — used by the proxy for its auth check                                                    |
| `src/utils/client-rbac.js`                        | Thin `useSessionRBAC()` wrapper — backward compat only                                                                              |
| `src/context/SessionContext.jsx`                  | Client-side: fetches `/api/session`, memoized `can()`, re-fetch on route/visibility change (no client cache)                        |
| `src/proxy.ts`                                    | Auth gate (session validation), rate limiting — no resource-level checks                                                            |
| `src/app/api/session/route.js`                    | `GET /api/session` — returns `{authenticated, user}` via `getCurrentUser()`                                                         |
| `src/app/masters/users/[id]/permissions/page.jsx` | Full permission editor UI (modules + sections + fields)                                                                             |

---

## Design decisions & gotchas

1. **Grant speed comes from a short cache, not a permission cookie.** `getCurrentUser()` caches the fully-resolved user in memory for 60 s keyed by session-token hash (ADR-0013). A revoked permission or deactivated user stays usable for at most that window; on DB failure the handler returns the stale entry rather than cascading 401s.

2. **Super admin is a single boolean.** No permission enumeration needed — `is_super_admin` is checked before every other check (in `checkPermission()`, `ensurePermission()`, and `checkModulePermission()`).

3. **`field_permissions` may be a string.** The column is longtext with a JSON validity check, so both `checkPermission()` and `checkModulePermission()` `JSON.parse()` transparently. `getCurrentUser()` also strips modules with `enabled: false` before caching.

4. **Permissions are additive.** The flat system and nested system don't conflict — a permission granted by either format is sufficient. Both formats are updated together when saving from the admin UI.

5. **In-flight dedup prevents thundering herd.** Two concurrent requests for the same cold-cache user share a single DB promise rather than each opening a connection.

6. **One session cookie.** The opaque `session` cookie is both identity and permission source: the proxy validates it, and `getCurrentUser()` re-derives permissions from the DB (cached). There is no separate `auth`/`session_permissions` pair.

7. **Hierarchy defaults apply at login, not on every fetch.** `getCurrentUser()` deliberately does not auto-derive permissions from `role_hierarchy` (comment at `api-permissions.js:173-174`); `POST /api/login` applies `getDefaultPermissionsForLevel()` only when the role has no explicit permissions, and the admin UI uses it to pre-populate checkboxes.
