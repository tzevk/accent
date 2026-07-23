# RBAC & Permission System

## Architecture overview

The system has **two coexisting permission formats** evaluated by a single central checker. Both are additive — a permission granted by either format is sufficient.

|                 | Flat (legacy)                                   | Nested `field_permissions` (newer)                      |
| --------------- | ----------------------------------------------- | ------------------------------------------------------- |
| **Format**      | `"resource:permission"` strings in arrays       | `{modules: {resource: {enabled, crud, sections}}}` JSON |
| **Stored in**   | `roles_master.permissions`, `users.permissions` | `users.field_permissions` (MySQL JSON column)           |
| **Granularity** | Resource × action                               | Module → section → individual field                     |
| **Field-level** | No                                              | `edit` / `view` / `hidden` per field                    |

---

## Permission vocabulary

### Resources (45 total — `rbac.js:7`)

| Category    | Resources                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **CRM**     | `leads`, `proposals`, `projects`, `followups`, `tickets`, `work_logs`, `todos`                                                           |
| **People**  | `employees`, `users`, `companies`, `vendors`                                                                                             |
| **Finance** | `quotations`, `purchase_orders`, `invoices`, `accounts`, `cash_voucher`, `material_requisition`, `other_expenses`, `petty_cash_expenses` |
| **Masters** | `activities`, `software`, `documents`, `roles`, `holidays`                                                                               |
| **Admin**   | `admin`, `admin_monitoring`, `admin_activity_logs`, `admin_audit_logs`, `admin_productivity`, `payroll`, `attendance`, `da_schedule`     |
| **Other**   | `dashboard`, `reports`, `messages`, `profile`, `settings`                                                                                |

### Actions (10 — `rbac.js:54`)

`read` · `create` · `update` · `delete` · `close` · `export` · `import` · `approve` · `assign` · `convert`

Permission key format: `"<resource>:<action>"` — e.g. `"leads:read"`, `"projects:approve"`.

### Templates (`rbac.js:68`)

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

| Column              | Type                    | Purpose                                           |
| ------------------- | ----------------------- | ------------------------------------------------- |
| `permissions`       | JSON array              | Direct user overrides — augments role permissions |
| `field_permissions` | JSON (string or object) | Nested module/section/field structure             |
| `role_id`           | FK → `roles_master`     | User's assigned role                              |
| `is_super_admin`    | boolean                 | Hard bypass — `true` grants every permission      |

### Effective permissions at runtime

When `getCurrentUser()` fetches a user from the DB:

1. **Role permissions** parsed from `roles_master.permissions`
2. **User permissions** parsed from `users.permissions`
3. **Merged** via `mergePermissions()` into `merged_permissions` (set union)
4. **`field_permissions`** parsed (handles both string and object; MySQL may return JSON columns as strings)
5. **Role hierarchy defaults are NOT auto-applied** — only explicitly assigned permissions count (`api-permissions.js:208`). The `getDefaultPermissionsForLevel()` function exists solely for the admin UI to pre-populate checkboxes when creating/editing roles.

The resulting user object has:

- `permissions` — direct user flat array
- `role_permissions` — flat array from role
- `merged_permissions` — union of both
- `field_permissions` — parsed nested object
- `is_super_admin` — boolean

---

## `checkPermission(user, resource, permission)` — the central checker

`src/utils/permissions.js:50` — every client and server check lands here.

### Evaluation order

```
1. !user                          → false   (no user = no permissions)
2. user.is_super_admin            → true    (hard bypass)
3. user.merged_permissions        → check flat array for "resource:permission"
4. user.permissions               → check direct user flat array (fallback)
5. user.role_permissions          → check role flat array (fallback)
6. user.field_permissions         → parse if string; check modules.<resource>.enabled && modules.<resource>.crud.<permission>
7. Fall through                   → false
```

Steps 3–5 are partially redundant — `merged_permissions` is the union of steps 4+5 so step 3 almost always covers them. The fallbacks protect against a stale or incomplete merge.

Step 6 handles `field_permissions` that may be stored as a **JSON string** in MySQL — it `JSON.parse`s transparently. The check is: module must be `enabled: true` AND have the specific action in `crud`.

### Related utility functions (same file)

| Function                                                  | Purpose                                                   |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `checkPermissionFromSession(sessionData, resource, perm)` | Same logic against the session cookie snapshot            |
| `hasAnyAccess(user, resource)`                            | True if user has ANY flat permission for the resource     |
| `getPermissionsFor(user, resource)`                       | Returns all actions the user has for a resource           |
| `checkAllPermissions(user, checks)`                       | All of `[{resource, permission}, ...]` must pass          |
| `checkAnyPermission(user, checks)`                        | At least one of `[{resource, permission}, ...]` must pass |
| `createPermissionChecker(user)`                           | Returns `(resource, perm) => bool` bound to user          |

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

### `session_permissions` cookie — the fast path

**Format:** `base64({ p: ["leads:read", ...], sa: true|false, ts: timestamp })`

This 24h cookie (controlled by `PERMISSIONS_CACHE_TTL` at `api-permissions.js:23`) avoids DB queries for every API call. It is set via `setPermissionsCookieOnResponse()` after login or permission changes, and created by `createSessionPermissionsCookie()`.

### `getSessionPermissions(request)` → `{permissions, is_super_admin, timestamp} | null`

`api-permissions.js:72` — decodes the cookie. Returns `null` if:

- Cookie is missing
- JSON is malformed
- Timestamp is older than 24h (expired)

### `ensurePermission(request, resource, permission)` — the route guard

`api-permissions.js:293` — the primary function for protecting API routes.

```
1. Try session_permissions cookie
   ├─ Super admin in cookie?   → fetch user (cached) → grant
   ├─ Has exact permission key? → fetch user (cached) → grant
   └─ Cookie lacks permission?  → fall through (cookie may be stale)

2. DB lookup: getCurrentUser(request)
   ├─ No user? → 401 {error: "Unauthorized"}
   ├─ Super admin OR checkPermission() passes? → grant
   └─ Neither? → 403 {error: "Forbidden: missing permission"}
       (denial logged to console in development only)
```

**Critical design decision:** The session cookie is only trusted for **granting** access, never for denying it. If the cookie lacks a permission, the system falls through to a full DB lookup — the cookie might be stale from a recent permission revocation.

### `getCurrentUser(request)` — full user fetch with caching

`api-permissions.js:130` — fetches `users JOIN roles_master JOIN employees`.

**Cache layers:**

| Layer                                      | TTL         | Purpose                                                      |
| ------------------------------------------ | ----------- | ------------------------------------------------------------ |
| `session_permissions` cookie               | 24h         | Avoid DB entirely for most requests                          |
| In-memory `userCache` (Map)                | 5 min       | Avoid DB for repeated requests within cache window           |
| In-flight dedup (`pendingUserFetches` Map) | Per-request | Two concurrent cold-cache requests share one DB promise      |
| Stale-on-failure                           | N/A         | If DB errors, returns expired cached user rather than `null` |

The stale-on-failure strategy prevents cascading "Unauthorized" errors when the DB pool is exhausted.

### Other server-side functions

| Function                                                        | Use case                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------- | ---------- | -------- |
| `checkPermissionFast(request, resource, perm)`                  | Lightweight check — returns `{authorized, source: "session" | "database" | "none"}` |
| `hasPermission(request, resource, perm)`                        | Boolean only — no user object needed                        |
| `setPermissionsCookieOnResponse(response, perms, isSuperAdmin)` | Refresh the session cookie after a permission update        |
| `invalidateUserCache(userId)`                                   | Purge a user from the in-memory cache                       |

---

## Client-side authorization flow

### Data flow

```
Component calls session.can("leads", "read")
  → useSession().can  (SessionContext.jsx:286)
    → checkPermission(user, resource, permission)  (permissions.js:50)
      → checks against the user object in React state
```

### SessionContext lifecycle (`src/context/SessionContext.jsx`)

1. **Module load:** `hydrateFromStorage()` restores the last session from `sessionStorage` into an in-memory cache (survives page refresh)
2. **Provider mount:** calls `fetchSession()` → `GET /api/session` → receives `{authenticated, user}`
3. **In‑memory cache:** 30-second TTL — subsequent `fetchSession()` calls within the window return cached data
4. **Polling:** `AutoRefresh` component (`src/components/AutoRefresh.jsx`) triggers re-fetches every 30s
5. **`can()` is memoized** on the `user` object — it only re-evaluates when the user changes
6. **Starts with `loading: true`** to prevent hydration mismatches with SSR

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

## Middleware layer (`middleware.ts`)

Middleware handles **authentication** (not authorization) and **rate limiting**:

- **Public paths** bypass auth: `/signin`, `/api/login`, `/api/logout`, `/api/auth`, `/api/session`, `/_next`, `/uploads`, static assets
- **Auth check:** reads `auth` + `user_id` cookies. Unauthenticated → redirect to `/signin` (pages) or `401` JSON (API)
- **Admin gate:** `/admin/*` paths redirect non-super-admins to `/user/dashboard`
- **Already-authenticated gate:** users with auth cookies hitting `/signin` are redirected to their dashboard
- **Rate limiting:** per-IP+user, tiered by endpoint category — `auth` (10/15min, 30min block), `session` (120/min), `heavy` export/bulk (10/min, 2min block), default `api` (120/min). Returns `429` with `Retry-After` / `X-RateLimit-*` headers

Middleware does **not** check resource-level permissions — that is handled by `ensurePermission()` inside each API route.

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

### Role defaults in the UI

`getDefaultPermissionsForLevel(hierarchyLevel)` (`rbac.js:269`) is used to pre-populate the permission editor when creating/editing roles:

| Hierarchy | Auto-assigned permissions                                                    |
| --------- | ---------------------------------------------------------------------------- |
| Any       | `read` on all resources (except employees/vendors)                           |
| 40+       | CRUD on leads/activities/docs + read employees/vendors + create/update users |
| 60+       | Create/update/approve projects/proposals + delete users                      |
| 80+       | Full access to all resources and all actions                                 |

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

| File                                              | Role                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/utils/rbac.js`                               | Defines RESOURCES, PERMISSIONS, templates, hierarchy-based defaults, `mergePermissions()`, `validatePermissions()`     |
| `src/utils/permissions.js`                        | Central `checkPermission()` + `checkPermissionFromSession()` + field-level helpers + batch checkers                    |
| `src/utils/api-permissions.js`                    | Server-side: `ensurePermission()`, `getCurrentUser()`, session cookie encode/decode, in-memory cache, stale-on-failure |
| `src/utils/client-rbac.js`                        | Thin `useSessionRBAC()` wrapper — backward compat only                                                                 |
| `src/context/SessionContext.jsx`                  | Client-side: fetches `/api/session`, memoized `can()`, sessionStorage persistence                                      |
| `middleware.ts`                                   | Auth gate (cookie check, admin routes), rate limiting — no resource-level checks                                       |
| `src/app/api/session/route.js`                    | `GET /api/session` — returns `{authenticated, user}` via `getCurrentUser()`                                            |
| `src/app/masters/users/[id]/permissions/page.jsx` | Full permission editor UI (modules + sections + fields)                                                                |

---

## Design decisions & gotchas

1. **Grant from cache, never deny.** The session cookie can grant access without DB, but a session-cookie miss always falls through to DB. A revoked permission takes effect on the next API call that performs a full user fetch.

2. **Super admin is a single boolean.** No permission enumeration needed — `is_super_admin` checked before every other check. The `is_super_admin` cookie value is `'1'` (string).

3. **`field_permissions` may be a string.** MySQL can return JSON columns as strings. Both `checkPermission()` and `checkModulePermission()` handle this with `JSON.parse()`.

4. **Permissions are additive.** The flat system and nested system don't conflict — a permission granted by either format is sufficient. Both formats are updated together when saving from the admin UI.

5. **In-flight dedup prevents thundering herd.** Two concurrent requests for the same cold-cache user share a single DB promise rather than each opening a connection.

6. **The `session_permissions` cookie is separate from the `auth` cookie.** The `auth` cookie (JWT) proves identity; `session_permissions` caches the authorization snapshot. Both are needed for the fast path to work.

7. **Role hierarchy defaults are UI-only.** `getDefaultPermissionsForLevel()` is not called at runtime — only explicitly assigned permissions from the `roles_master.permissions` column are loaded into the user object.
