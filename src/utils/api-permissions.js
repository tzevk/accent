import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { mergePermissions } from '@/utils/rbac';
import { checkPermission, RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hashSessionToken } from '@/utils/session';

// Safely parse JSON fields stored in MySQL JSON columns
function safeParse(json, fallback = []) {
	try {
		if (!json) return fallback;
		if (typeof json === 'object') return json;
		return JSON.parse(json);
	} catch {
		return fallback;
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// In-memory user cache to reduce DB queries (short TTL for freshness)
// ═══════════════════════════════════════════════════════════════════════════
const userCache = new Map();
const USER_CACHE_TTL = 5 * 60 * 1000; // 5 min — reduces DB hits from high-frequency polling
const MAX_CACHE_SIZE = 500;
// In-flight dedup: if two requests arrive for the same cold-cache user simultaneously,
// share the single pending DB promise instead of both creating a connection.
const pendingUserFetches = new Map();

function getCachedUser(tokenHash, allowExpired = false) {
	const entry = userCache.get(tokenHash);
	if (!entry) return null;
	if (Date.now() - entry.timestamp > USER_CACHE_TTL) {
		if (allowExpired) return entry.user; // stale data is better than "Unauthorized"
		userCache.delete(tokenHash);
		return null;
	}
	return entry.user;
}

function setCachedUser(tokenHash, user, userId) {
	// Prevent unbounded growth
	if (userCache.size >= MAX_CACHE_SIZE) {
		// Remove oldest entries
		const entries = Array.from(userCache.entries());
		entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
		entries.slice(0, 100).forEach(([key]) => userCache.delete(key));
	}
	userCache.set(tokenHash, { user, userId, timestamp: Date.now() });
}

function invalidateUserCache(userId) {
	if (userId) {
		const numericId = Number(userId);
		for (const [key, entry] of userCache.entries()) {
			if (entry.userId === numericId) userCache.delete(key);
		}
	} else {
		userCache.clear();
	}
}

// Export for use elsewhere (e.g., after permission updates)
export { invalidateUserCache };

// Load current user from cookie and DB (includes role permissions)
// Uses in-memory cache + in-flight deduplication to minimise DB connections.
export async function getCurrentUser(request, options = {}) {
	const token = request?.cookies?.get?.('session')?.value;
	if (!token) return null;

	const tokenHash = hashSessionToken(token);

	if (!options.skipCache) {
		const cached = getCachedUser(tokenHash);
		if (cached) return cached;

		// If another concurrent request is already fetching this user, share its promise
		// instead of opening a second DB connection for the same data.
		if (pendingUserFetches.has(tokenHash)) {
			return pendingUserFetches.get(tokenHash);
		}
	}

	const promise = _fetchUserFromDb(tokenHash);

	if (!options.skipCache) {
		pendingUserFetches.set(tokenHash, promise);
		promise.finally(() => pendingUserFetches.delete(tokenHash));
	}
	return promise;
}

/**
 * Strip disabled modules from field_permissions.
 * Reduces in-memory cache and API response sizes by dropping modules
 * with `enabled: false`. All consumers use optional chaining — absence
 * of a key is already treated identically to `enabled: false`.
 */
function stripDisabledModules(fp) {
	if (!fp?.modules) return fp;
	const enabled = {};
	for (const [key, mod] of Object.entries(fp.modules)) {
		if (mod?.enabled) enabled[key] = mod;
	}
	return Object.keys(enabled).length > 0 ? { modules: enabled } : {};
}

async function _fetchUserFromDb(tokenHash) {
	let db;
	try {
		db = await dbConnect();
		const [rows] = await db.execute(
			`SELECT 
          u.id,
          u.username,
          u.full_name,
          u.email,
          u.department,
          u.employee_id AS linked_employee_id,
          u.role_id,
          u.permissions AS user_permissions,
          u.field_permissions AS user_field_permissions,
          u.is_super_admin,
          u.is_active,
          u.status,
          u.last_login,
          u.last_password_change,
          r.permissions AS role_permissions,
          r.role_hierarchy,
          r.role_name,
          r.role_code,
          e.id AS employee_record_id,
          e.first_name,
          e.last_name,
          e.phone,
          e.mobile,
          e.personal_email,
          e.department AS employee_department,
          e.position,
          e.present_address,
          e.city,
          e.state,
          e.country,
          e.profile_photo_url,
          e.emergency_contact_name,
          e.emergency_contact_phone
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN roles_master r ON u.role_id = r.id
       LEFT JOIN employees e ON u.employee_id = e.id
       WHERE s.token_hash = ?
         AND s.expires_at > NOW()
         AND u.isDelete = 0
         AND (u.is_active = 1 OR u.is_active IS NULL)
         AND (u.status = 'active' OR u.status IS NULL)
       LIMIT 1`,
			[tokenHash]
		);

		if (!rows || rows.length === 0) return null;

		const row = rows[0];
		const isActive =
			(row.is_active === null ||
				row.is_active === 1 ||
				row.is_active === true) &&
			(row.status === 'active' || !row.status);
		if (!isActive) return null;
		const userPermissions = safeParse(row.user_permissions, []);
		const fieldPermissions = stripDisabledModules(
			safeParse(row.user_field_permissions, {})
		);
		let rolePermissions = safeParse(row.role_permissions, []);
		// Do not auto-derive default permissions from hierarchy.
		// Visibility/access should reflect explicitly assigned permissions only.

		const mergedPermissions = mergePermissions(
			rolePermissions,
			userPermissions
		);
		const employee = row.employee_record_id
			? {
					id: row.employee_record_id,
					first_name: row.first_name,
					last_name: row.last_name,
					phone: row.phone,
					mobile: row.mobile,
					personal_email: row.personal_email,
					department: row.employee_department,
					position: row.position,
					present_address: row.present_address,
					city: row.city,
					state: row.state,
					country: row.country,
					profile_photo_url: row.profile_photo_url,
					emergency_contact_name: row.emergency_contact_name,
					emergency_contact_phone: row.emergency_contact_phone,
				}
			: null;

		const user = {
			id: row.id,
			username: row.username,
			full_name: row.full_name,
			email: row.email,
			department: row.department || employee?.department || null,
			employee_id: row.linked_employee_id,
			role_id: row.role_id,
			role: row.role_id
				? {
						id: row.role_id,
						name: row.role_name,
						code: row.role_code,
						hierarchy: row.role_hierarchy,
					}
				: null,
			is_super_admin: !!row.is_super_admin,
			is_active: row.is_active === null ? true : !!row.is_active,
			status: row.status,
			last_login: row.last_login,
			last_password_change: row.last_password_change,
			permissions: userPermissions,
			field_permissions: fieldPermissions, // Nested permission structure
			role_permissions: rolePermissions,
			merged_permissions: mergedPermissions,
			employee,
		};

		// Cache the user for subsequent requests
		setCachedUser(tokenHash, user, row.id);

		return user;
	} catch (error) {
		console.error('[getCurrentUser]', error.message);
		// On DB pool exhaustion, try returning a stale cached user rather than null
		// which would cascade into "Unauthorized" everywhere.
		const stale = getCachedUser(tokenHash, true);
		if (stale) {
			console.warn(
				'[getCurrentUser] Returning stale cached user due to DB error'
			);
			return stale;
		}
		return null;
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch {
				/* ignore */
			}
		}
	}
}

// Assert a specific permission for a resource; returns {authorized, user} or a NextResponse
export async function ensurePermission(request, resource, permission) {
	// Fall back to DB lookup (uses cache)
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	// Super admin bypass or exact permission match
	if (user.is_super_admin || checkPermission(user, resource, permission)) {
		return { authorized: true, user };
	}

	// Only log denials in development
	if (process.env.NODE_ENV === 'development') {
		console.log(
			`[RBAC] DENIED: ${user.email || user.username} does not have ${resource}:${permission}`
		);
	}
	return NextResponse.json(
		{ success: false, error: 'Forbidden: missing permission' },
		{ status: 403 }
	);
}

/**
 * Lightweight permission check that doesn't need the full user object
 * Returns true/false without fetching user data when possible
 */
export async function hasPermission(request, resource, permission) {
	// Cached user lookup
	const user = await getCurrentUser(request);
	if (!user) return false;

	return user.is_super_admin || checkPermission(user, resource, permission);
}
/**
 * Validate that the caller has sufficient privileges to modify or delete a target user.
 * - Super admins can modify any user.
 * - Non-super-admins cannot modify or delete super admins.
 * - Non-super-admins cannot modify or delete users with equal or higher role hierarchy.
 */
export function canModifyTargetUser(caller, targetUser) {
	if (!caller) {
		return {
			allowed: false,
			reason: 'Unauthorized',
		};
	}

	if (caller.is_super_admin) return { allowed: true };

	if (targetUser?.is_super_admin) {
		return {
			allowed: false,
			reason: 'Forbidden: Cannot modify or delete a super admin user',
		};
	}

	const callerHierarchy = Number(
		caller.role?.hierarchy ?? caller.role_hierarchy ?? 0
	);
	const targetHierarchy = Number(
		targetUser?.role_hierarchy ?? targetUser?.role?.hierarchy ?? 0
	);

	if (
		Number(targetUser?.id) !== Number(caller.id) &&
		targetHierarchy >= callerHierarchy
	) {
		return {
			allowed: false,
			reason:
				'Forbidden: Cannot modify or delete a user with equal or higher role hierarchy',
		};
	}

	return { allowed: true };
}

/**
 * Validate roles, permissions, field_permissions, and super_admin grants.
 * Prevents non-super-admins from escalating privileges or assigning roles/permissions beyond their own.
 */
export async function validateUserGrants(caller, data, db, options = {}) {
	if (!caller) {
		return {
			allowed: false,
			reason: 'Unauthorized',
		};
	}

	if (caller.is_super_admin) return { allowed: true };

	const isSelfUpdate = options.targetIsSelf || false;

	// Non-super-admins cannot grant super admin
	if (data?.is_super_admin) {
		return {
			allowed: false,
			reason: 'Forbidden: Only super admins can grant super admin privileges',
		};
	}

	// Non-super-admins cannot modify their own role or permissions
	if (
		isSelfUpdate &&
		(data?.role_id !== undefined ||
			data?.permissions !== undefined ||
			data?.field_permissions !== undefined)
	) {
		return {
			allowed: false,
			reason:
				'Forbidden: Only super admins can modify your own role or permissions',
		};
	}

	const callerHierarchy = Number(
		caller.role?.hierarchy ?? caller.role_hierarchy ?? 0
	);

	// Check role hierarchy for assigned role_id
	if (
		data?.role_id !== undefined &&
		data?.role_id !== null &&
		data?.role_id !== ''
	) {
		if (db) {
			const [roles] = await db.execute(
				'SELECT id, role_hierarchy FROM roles_master WHERE id = ? AND status = "active" LIMIT 1',
				[data.role_id]
			);
			if (!roles || roles.length === 0) {
				return {
					allowed: false,
					reason: 'Invalid role selected',
				};
			}
			const assignedHierarchy = Number(roles[0].role_hierarchy ?? 0);
			if (assignedHierarchy >= callerHierarchy) {
				return {
					allowed: false,
					reason:
						'Forbidden: Cannot assign a role with equal or higher hierarchy than your own',
				};
			}
		}
	}

	// Check custom permissions subset
	if (data?.permissions !== undefined && data?.permissions !== null) {
		const rawPerms = Array.isArray(data.permissions)
			? data.permissions
			: safeParse(data.permissions, []);

		if (Array.isArray(rawPerms) && rawPerms.length > 0) {
			const callerPerms = new Set(
				caller.merged_permissions || caller.permissions || []
			);
			for (const p of rawPerms) {
				if (!callerPerms.has(p)) {
					return {
						allowed: false,
						reason: `Forbidden: Cannot grant permission "${p}" that you do not possess`,
					};
				}
			}
		}
	}

	// Check field_permissions modules
	if (
		data?.field_permissions !== undefined &&
		data?.field_permissions !== null
	) {
		const fp =
			typeof data.field_permissions === 'object'
				? data.field_permissions
				: safeParse(data.field_permissions, {});

		if (fp?.modules) {
			const callerFpModules = caller.field_permissions?.modules || {};
			const callerPerms = new Set(
				caller.merged_permissions || caller.permissions || []
			);

			for (const [modKey, modVal] of Object.entries(fp.modules)) {
				if (modVal?.enabled) {
					const callerHasModuleInFp = !!callerFpModules[modKey]?.enabled;
					const callerHasModuleInPerms = Array.from(callerPerms).some((p) =>
						p.startsWith(`${modKey}:`)
					);
					if (!callerHasModuleInFp && !callerHasModuleInPerms) {
						return {
							allowed: false,
							reason: `Forbidden: Cannot grant field permissions for module "${modKey}" that you do not possess`,
						};
					}
				}
			}
		}
	}

	return { allowed: true };
}

export { RESOURCES, PERMISSIONS };
