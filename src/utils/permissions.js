/**
 * Centralized Permission Check Utility
 * 
 * Single reusable function for checking permissions across the app.
 * Works with both user objects and session data.
 * 
 * Usage:
 *   Server-side: const allowed = checkPermission(user, 'leads', 'read');
 *   Client-side: const allowed = checkPermission(user, RESOURCES.LEADS, PERMISSIONS.READ);
 *   With session: const allowed = checkPermissionFromSession(sessionData, 'leads', 'read');
 */

import { RESOURCES, PERMISSIONS } from './rbac';

// Re-export for convenience
export { RESOURCES, PERMISSIONS };

/**
 * Generate a permission key
 * @param {string} resource - Resource name
 * @param {string} permission - Permission type
 * @returns {string} Permission key like "leads:read"
 */
export function permissionKey(resource, permission) {
  return `${resource}:${permission}`;
}

/**
 * CENTRALIZED PERMISSION CHECK
 * 
 * Single function to check if a user has a specific permission.
 * Handles all permission sources: user permissions, role permissions, merged permissions.
 * 
 * @param {Object} user - User object (from session or DB)
 * @param {string} resource - Resource being accessed (e.g., 'leads', 'projects')
 * @param {string} permission - Permission required (e.g., 'read', 'create', 'update', 'delete')
 * @returns {boolean} True if user has the permission
 * 
 * @example
 * // Check if user can read leads
 * if (checkPermission(user, 'leads', 'read')) {
 *   // Show leads
 * }
 * 
 * // Using constants
 * if (checkPermission(user, RESOURCES.PROJECTS, PERMISSIONS.CREATE)) {
 *   // Show create button
 * }
 */
export function checkPermission(user, resource, permission) {
  // No user = no permission
  if (!user) return false;
  
  // Super admin bypass - has all permissions
  if (user.is_super_admin) return true;
  
  const key = permissionKey(resource, permission);
  
  // Check merged permissions (role + user overrides) - most accurate
  if (Array.isArray(user.merged_permissions) && user.merged_permissions.includes(key)) {
    return true;
  }
  
  // Check direct user permissions
  if (Array.isArray(user.permissions) && user.permissions.includes(key)) {
    return true;
  }
  
  // Check role-based permissions
  if (Array.isArray(user.role_permissions) && user.role_permissions.includes(key)) {
    return true;
  }
  
  // Check nested field_permissions structure (new format)
  let fieldPerms = user.field_permissions;
  if (typeof fieldPerms === 'string') {
    try { fieldPerms = JSON.parse(fieldPerms); } catch { fieldPerms = null; }
  }
  
  if (fieldPerms?.modules?.[resource]) {
    const moduleData = fieldPerms.modules[resource];
    // Module must be enabled AND have the specific permission
    if (moduleData.enabled && moduleData.crud?.[permission]) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check permission from session cookie data
 * Useful for server-side checks without DB query
 * 
 * @param {Object} sessionData - Decoded session data {permissions: [], is_super_admin: boolean}
 * @param {string} resource - Resource being accessed
 * @param {string} permission - Permission required
 * @returns {boolean} True if permitted
 */
export function checkPermissionFromSession(sessionData, resource, permission) {
  if (!sessionData) return false;
  if (sessionData.is_super_admin || sessionData.sa) return true;
  
  const key = permissionKey(resource, permission);
  const permissions = sessionData.permissions || sessionData.p || [];
  
  return Array.isArray(permissions) && permissions.includes(key);
}

/**
 * Check if user has ANY permission for a resource
 * Useful for showing/hiding entire sections
 * 
 * @param {Object} user - User object
 * @param {string} resource - Resource to check
 * @returns {boolean} True if user has any permission for the resource
 */
export function hasAnyAccess(user, resource) {
  if (!user) return false;
  if (user.is_super_admin) return true;
  
  return Object.values(PERMISSIONS).some(perm => 
    checkPermission(user, resource, perm)
  );
}

/**
 * Get all permissions a user has for a resource
 * 
 * @param {Object} user - User object
 * @param {string} resource - Resource to check
 * @returns {string[]} Array of permissions (e.g., ['read', 'create'])
 */
export function getPermissionsFor(user, resource) {
  if (!user) return [];
  if (user.is_super_admin) return Object.values(PERMISSIONS);
  
  return Object.values(PERMISSIONS).filter(perm => 
    checkPermission(user, resource, perm)
  );
}

/**
 * Check multiple permissions at once
 * Returns true only if ALL permissions are granted
 * 
 * @param {Object} user - User object
 * @param {Array} checks - Array of [resource, permission] pairs
 * @returns {boolean} True if all permissions are granted
 * 
 * @example
 * const canManageLeads = checkAllPermissions(user, [
 *   ['leads', 'read'],
 *   ['leads', 'create'],
 *   ['leads', 'update']
 * ]);
 */
export function checkAllPermissions(user, checks) {
  if (!user) return false;
  if (user.is_super_admin) return true;
  
  return checks.every(([resource, permission]) => 
    checkPermission(user, resource, permission)
  );
}

/**
 * Check multiple permissions at once
 * Returns true if ANY permission is granted
 * 
 * @param {Object} user - User object
 * @param {Array} checks - Array of [resource, permission] pairs
 * @returns {boolean} True if any permission is granted
 * 
 * @example
 * const canAccessAdmin = checkAnyPermission(user, [
 *   ['admin_monitoring', 'read'],
 *   ['admin_activity_logs', 'read'],
 *   ['settings', 'read']
 * ]);
 */
export function checkAnyPermission(user, checks) {
  if (!user) return false;
  if (user.is_super_admin) return true;
  
  return checks.some(([resource, permission]) => 
    checkPermission(user, resource, permission)
  );
}

/**
 * Create a permission checker function bound to a user
 * Useful for passing to components
 * 
 * @param {Object} user - User object
 * @returns {Function} can(resource, permission) function
 * 
 * @example
 * const can = createPermissionChecker(user);
 * if (can('leads', 'create')) { ... }
 */
export function createPermissionChecker(user) {
  return (resource, permission) => checkPermission(user, resource, permission);
}
// ========================================
// NESTED PERMISSION STRUCTURE UTILITIES
// ========================================

/**
 * Check if a module is enabled in nested permissions
 * 
 * @param {Object} fieldPermissions - The nested field_permissions object from user
 * @param {string} moduleKey - Module key (e.g., 'leads', 'projects')
 * @returns {boolean} True if module is enabled
 */
export function isModuleEnabled(fieldPermissions, moduleKey) {
  if (!fieldPermissions?.modules) return false;
  return fieldPermissions.modules[moduleKey]?.enabled === true;
}

/**
 * Check if a section is enabled within a module
 * 
 * @param {Object} fieldPermissions - The nested field_permissions object
 * @param {string} moduleKey - Module key
 * @param {string} sectionKey - Section key
 * @returns {boolean} True if section is enabled
 */
export function isSectionEnabled(fieldPermissions, moduleKey, sectionKey) {
  if (!fieldPermissions?.modules?.[moduleKey]) return false;
  return fieldPermissions.modules[moduleKey].sections?.[sectionKey]?.enabled === true;
}

/**
 * Get field permission level from nested structure
 * 
 * @param {Object} fieldPermissions - The nested field_permissions object
 * @param {string} moduleKey - Module key
 * @param {string} sectionKey - Section key
 * @param {string} fieldKey - Field key
 * @returns {string} Permission level: 'hidden', 'view', or 'edit'
 */
export function getFieldPermission(fieldPermissions, moduleKey, sectionKey, fieldKey) {
  const section = fieldPermissions?.modules?.[moduleKey]?.sections?.[sectionKey];
  if (!section?.enabled) return 'hidden';
  return section.fields?.[fieldKey]?.permission || 'hidden';
}

/**
 * Check if user can view a specific field
 * 
 * @param {Object} fieldPermissions - The nested field_permissions object
 * @param {string} moduleKey - Module key
 * @param {string} sectionKey - Section key
 * @param {string} fieldKey - Field key
 * @returns {boolean} True if field is viewable (view or edit)
 */
export function canViewField(fieldPermissions, moduleKey, sectionKey, fieldKey) {
  const perm = getFieldPermission(fieldPermissions, moduleKey, sectionKey, fieldKey);
  return perm === 'view' || perm === 'edit';
}

/**
 * Check if user can edit a specific field
 * 
 * @param {Object} fieldPermissions - The nested field_permissions object
 * @param {string} moduleKey - Module key
 * @param {string} sectionKey - Section key
 * @param {string} fieldKey - Field key
 * @returns {boolean} True if field is editable
 */
export function canEditField(fieldPermissions, moduleKey, sectionKey, fieldKey) {
  return getFieldPermission(fieldPermissions, moduleKey, sectionKey, fieldKey) === 'edit';
}

/**
 * Get all enabled modules from nested permissions
 * 
 * @param {Object} fieldPermissions - The nested field_permissions object
 * @returns {string[]} Array of enabled module keys
 */
export function getEnabledModules(fieldPermissions) {
  if (!fieldPermissions?.modules) return [];
  return Object.keys(fieldPermissions.modules).filter(
    moduleKey => fieldPermissions.modules[moduleKey]?.enabled === true
  );
}

/**
 * Get CRUD permissions for a module from nested structure
 * 
 * @param {Object} fieldPermissions - The nested field_permissions object
 * @param {string} moduleKey - Module key
 * @returns {Object} CRUD object {read, create, update, delete, export, import}
 */
export function getModuleCRUD(fieldPermissions, moduleKey) {
  const moduleData = fieldPermissions?.modules?.[moduleKey];
  if (!moduleData?.enabled) {
    return { read: false, create: false, update: false, delete: false, export: false, import: false };
  }
  return {
    read: !!moduleData.crud?.read,
    create: !!moduleData.crud?.create,
    update: !!moduleData.crud?.update,
    delete: !!moduleData.crud?.delete,
    export: !!moduleData.crud?.export,
    import: !!moduleData.crud?.import
  };
}

/**
 * Check module-level permission from nested structure
 * This is the primary function to check if a user can access a module
 * 
 * @param {Object} user - User object with field_permissions
 * @param {string} moduleKey - Module key
 * @param {string} permission - Permission type (read, create, update, delete)
 * @returns {boolean} True if permitted
 */
export function checkModulePermission(user, moduleKey, permission) {
  if (!user) return false;
  if (user.is_super_admin) return true;
  
  // First check flat permissions array (backward compatibility)
  const key = permissionKey(moduleKey, permission);
  if (Array.isArray(user.permissions) && user.permissions.includes(key)) {
    return true;
  }
  if (Array.isArray(user.merged_permissions) && user.merged_permissions.includes(key)) {
    return true;
  }
  
  // Then check nested structure
  let fieldPerms = user.field_permissions;
  if (typeof fieldPerms === 'string') {
    try { fieldPerms = JSON.parse(fieldPerms); } catch { return false; }
  }
  
  if (fieldPerms?.modules?.[moduleKey]) {
    const moduleData = fieldPerms.modules[moduleKey];
    if (!moduleData.enabled) return false;
    return !!moduleData.crud?.[permission];
  }
  
  return false;
}