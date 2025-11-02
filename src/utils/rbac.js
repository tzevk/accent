/**
 * Role-Based Access Control (RBAC) Utilities
 * Provides comprehensive permission management for the AccentCRM application
 */

// Define all available resources and their permissions
export const RESOURCES = {
  LEADS: 'leads',
  PROJECTS: 'projects', 
  EMPLOYEES: 'employees',
  USERS: 'users',
  COMPANIES: 'companies',
  VENDORS: 'vendors',
  PROPOSALS: 'proposals',
  ACTIVITIES: 'activities',
  DOCUMENTS: 'documents',
  ROLES: 'roles',
  DASHBOARD: 'dashboard',
  REPORTS: 'reports'
};

export const PERMISSIONS = {
  READ: 'read',
  CREATE: 'create', 
  UPDATE: 'update',
  DELETE: 'delete',
  EXPORT: 'export',
  IMPORT: 'import',
  APPROVE: 'approve',
  ASSIGN: 'assign'
};

// Predefined permission combinations for common roles
export const PERMISSION_TEMPLATES = {
  VIEWER: [PERMISSIONS.READ],
  EDITOR: [PERMISSIONS.READ, PERMISSIONS.CREATE, PERMISSIONS.UPDATE],
  MANAGER: [PERMISSIONS.READ, PERMISSIONS.CREATE, PERMISSIONS.UPDATE, PERMISSIONS.DELETE, PERMISSIONS.APPROVE],
  ADMIN: [PERMISSIONS.READ, PERMISSIONS.CREATE, PERMISSIONS.UPDATE, PERMISSIONS.DELETE, PERMISSIONS.EXPORT, PERMISSIONS.IMPORT, PERMISSIONS.APPROVE, PERMISSIONS.ASSIGN]
};

// Resource-specific permission descriptions
export const PERMISSION_DESCRIPTIONS = {
  [RESOURCES.LEADS]: {
    [PERMISSIONS.READ]: 'View lead information and details',
    [PERMISSIONS.CREATE]: 'Create new leads',
    [PERMISSIONS.UPDATE]: 'Edit existing lead information',
    [PERMISSIONS.DELETE]: 'Delete leads',
    [PERMISSIONS.EXPORT]: 'Export lead data',
    [PERMISSIONS.IMPORT]: 'Import leads from files',
    [PERMISSIONS.ASSIGN]: 'Assign leads to other users'
  },
  [RESOURCES.PROJECTS]: {
    [PERMISSIONS.READ]: 'View project information',
    [PERMISSIONS.CREATE]: 'Create new projects',
    [PERMISSIONS.UPDATE]: 'Edit project details and status',
    [PERMISSIONS.DELETE]: 'Delete projects',
    [PERMISSIONS.APPROVE]: 'Approve project proposals and changes',
    [PERMISSIONS.ASSIGN]: 'Assign project team members'
  },
  [RESOURCES.EMPLOYEES]: {
    [PERMISSIONS.READ]: 'View employee profiles',
    [PERMISSIONS.CREATE]: 'Add new employees',
    [PERMISSIONS.UPDATE]: 'Edit employee information',
    [PERMISSIONS.DELETE]: 'Remove employees',
    [PERMISSIONS.IMPORT]: 'Import employee data'
  },
  [RESOURCES.USERS]: {
    [PERMISSIONS.READ]: 'View user accounts',
    [PERMISSIONS.CREATE]: 'Create new user accounts',
    [PERMISSIONS.UPDATE]: 'Edit user permissions and details',
    [PERMISSIONS.DELETE]: 'Delete user accounts'
  },
  [RESOURCES.ROLES]: {
    [PERMISSIONS.READ]: 'View roles and permissions',
    [PERMISSIONS.CREATE]: 'Create new roles',
    [PERMISSIONS.UPDATE]: 'Modify role permissions',
    [PERMISSIONS.DELETE]: 'Delete roles'
  }
};

/**
 * Generate a permission key for storage
 * @param {string} resource - The resource being accessed
 * @param {string} permission - The permission type
 * @returns {string} Permission key in format "resource:permission"
 */
export function generatePermissionKey(resource, permission) {
  return `${resource}:${permission}`;
}

/**
 * Parse a permission key back to resource and permission
 * @param {string} permissionKey - Permission key in format "resource:permission"
 * @returns {Object} Object with resource and permission properties
 */
export function parsePermissionKey(permissionKey) {
  const [resource, permission] = permissionKey.split(':');
  return { resource, permission };
}

/**
 * Check if a user has a specific permission
 * @param {Object} user - User object with permissions or role
 * @param {string} resource - Resource being accessed
 * @param {string} permission - Permission required
 * @returns {boolean} True if user has permission
 */
export function hasPermission(user, resource, permission) {
  if (!user) return false;
  
  // Super admin bypass
  if (user.is_super_admin) return true;
  
  const permissionKey = generatePermissionKey(resource, permission);
  
  // Check direct user permissions first
  if (user.permissions && user.permissions.includes(permissionKey)) {
    return true;
  }
  
  // Check role-based permissions
  if (user.role_permissions && user.role_permissions.includes(permissionKey)) {
    return true;
  }
  
  return false;
}

/**
 * Check if user has any permission for a resource
 * @param {Object} user - User object
 * @param {string} resource - Resource being accessed
 * @returns {boolean} True if user has any permission for the resource
 */
export function hasAnyPermission(user, resource) {
  return Object.values(PERMISSIONS).some(permission => 
    hasPermission(user, resource, permission)
  );
}

/**
 * Get all permissions a user has for a specific resource
 * @param {Object} user - User object
 * @param {string} resource - Resource being accessed
 * @returns {Array} Array of permissions the user has for the resource
 */
export function getUserPermissions(user, resource) {
  return Object.values(PERMISSIONS).filter(permission => 
    hasPermission(user, resource, permission)
  );
}

/**
 * Get all resources a user has access to
 * @param {Object} user - User object
 * @returns {Array} Array of resources the user can access
 */
export function getUserResources(user) {
  return Object.values(RESOURCES).filter(resource => 
    hasAnyPermission(user, resource)
  );
}

/**
 * Generate default permissions for a role level
 * @param {number} hierarchyLevel - Role hierarchy level (0-100)
 * @returns {Array} Array of default permission keys
 */
export function getDefaultPermissionsForLevel(hierarchyLevel) {
  const permissions = [];
  
  // Basic read access for all levels
  Object.values(RESOURCES).forEach(resource => {
    permissions.push(generatePermissionKey(resource, PERMISSIONS.READ));
  });
  
  // Create/Update permissions for mid-level and above
  if (hierarchyLevel >= 40) {
    [RESOURCES.LEADS, RESOURCES.ACTIVITIES, RESOURCES.DOCUMENTS].forEach(resource => {
      permissions.push(generatePermissionKey(resource, PERMISSIONS.CREATE));
      permissions.push(generatePermissionKey(resource, PERMISSIONS.UPDATE));
    });
    // Allow mid-level roles to help with user onboarding (create/update)
    permissions.push(generatePermissionKey(RESOURCES.USERS, PERMISSIONS.CREATE));
    permissions.push(generatePermissionKey(RESOURCES.USERS, PERMISSIONS.UPDATE));
  }
  
  // Management permissions for senior level
  if (hierarchyLevel >= 60) {
    [RESOURCES.PROJECTS, RESOURCES.PROPOSALS].forEach(resource => {
      permissions.push(generatePermissionKey(resource, PERMISSIONS.CREATE));
      permissions.push(generatePermissionKey(resource, PERMISSIONS.UPDATE));
      permissions.push(generatePermissionKey(resource, PERMISSIONS.APPROVE));
    });
    // Senior roles can also remove users when needed
    permissions.push(generatePermissionKey(RESOURCES.USERS, PERMISSIONS.DELETE));
  }
  
  // Administrative permissions for executive level
  if (hierarchyLevel >= 80) {
    Object.values(RESOURCES).forEach(resource => {
      Object.values(PERMISSIONS).forEach(permission => {
        permissions.push(generatePermissionKey(resource, permission));
      });
    });
  }
  
  return permissions;
}

/**
 * Validate permission structure
 * @param {Array} permissions - Array of permission keys to validate
 * @returns {Object} Validation result with valid/invalid permissions
 */
export function validatePermissions(permissions) {
  const valid = [];
  const invalid = [];
  
  permissions.forEach(permissionKey => {
    const { resource, permission } = parsePermissionKey(permissionKey);
    
    if (Object.values(RESOURCES).includes(resource) && 
        Object.values(PERMISSIONS).includes(permission)) {
      valid.push(permissionKey);
    } else {
      invalid.push(permissionKey);
    }
  });
  
  return { valid, invalid };
}

/**
 * Merge permissions from multiple sources (role + user overrides)
 * @param {Array} rolePermissions - Permissions from user's role
 * @param {Array} userPermissions - Direct user permissions (overrides)
 * @returns {Array} Merged permission set
 */
export function mergePermissions(rolePermissions = [], userPermissions = []) {
  const merged = new Set([...rolePermissions, ...userPermissions]);
  return Array.from(merged);
}

/**
 * Group permissions by resource for display
 * @param {Array} permissions - Array of permission keys
 * @returns {Object} Permissions grouped by resource
 */
export function groupPermissionsByResource(permissions) {
  const grouped = {};
  
  permissions.forEach(permissionKey => {
    const { resource, permission } = parsePermissionKey(permissionKey);
    
    if (!grouped[resource]) {
      grouped[resource] = [];
    }
    
    grouped[resource].push(permission);
  });
  
  return grouped;
}