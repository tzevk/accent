import { hasPermission, getUserPermissions } from '@/utils/rbac';
import { NextResponse } from 'next/server';

/**
 * RBAC Middleware for API routes
 * Checks if the authenticated user has required permissions
 */

/**
 * Create RBAC middleware for API routes
 * @param {string} resource - Required resource
 * @param {string|Array} permissions - Required permission(s)
 * @param {Object} options - Additional options
 * @returns {Function} Middleware function
 */
export function createRBACMiddleware(resource, permissions, options = {}) {
  const { requireAll = false, allowSuperAdmin = true } = options;
  
  return async function rbacMiddleware(request, context = {}) {
    try {
      // Get user from session/auth (you'll need to implement this based on your auth system)
      const user = await getCurrentUser(request);
      
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Authentication required' },
          { status: 401 }
        );
      }

      // Allow super admin to bypass all checks
      if (allowSuperAdmin && user.is_super_admin) {
        return null; // Continue to handler
      }

      // Normalize permissions to array
      const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
      
      // Check permissions
      let hasAccess = false;
      
      if (requireAll) {
        // User must have ALL specified permissions
        hasAccess = requiredPermissions.every(permission => 
          hasPermission(user, resource, permission)
        );
      } else {
        // User must have ANY of the specified permissions
        hasAccess = requiredPermissions.some(permission => 
          hasPermission(user, resource, permission)
        );
      }

      if (!hasAccess) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Insufficient permissions',
            required: {
              resource,
              permissions: requiredPermissions,
              mode: requireAll ? 'all' : 'any'
            }
          },
          { status: 403 }
        );
      }

      // Store user in context for use in the handler
      context.user = user;
      context.userPermissions = getUserPermissions(user, resource);
      
      return null; // Continue to handler
      
    } catch (error) {
      console.error('RBAC Middleware error:', error);
      return NextResponse.json(
        { success: false, error: 'Authorization check failed' },
        { status: 500 }
      );
    }
  };
}

/**
 * Get current user with permissions from request
 * This should be implemented based on your authentication system
 * @param {Request} request - The request object
 * @returns {Object|null} User object with permissions or null
 */
async function getCurrentUser(request) {
  try {
    // This is a placeholder - implement based on your auth system
    // You might need to:
    // 1. Extract auth token/cookie from request
    // 2. Validate the token
    // 3. Query user data with permissions from database
    
    const authHeader = request.headers.get('authorization');
    const authCookie = request.cookies.get('auth');
    
    if (!authHeader && !authCookie) {
      return null;
    }

    // For now, return a mock user - replace with actual implementation
    // This should query your database to get the full user with permissions
    return {
      id: 1,
      username: 'admin',
      permissions: [], // Direct user permissions
      role_permissions: [], // Role-based permissions
      is_super_admin: false
    };
    
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

/**
 * Wrapper function to protect API routes with RBAC
 * @param {Function} handler - The API route handler
 * @param {string} resource - Required resource
 * @param {string|Array} permissions - Required permission(s)
 * @param {Object} options - Additional options
 * @returns {Function} Protected handler function
 */
export function withRBAC(handler, resource, permissions, options = {}) {
  return async function protectedHandler(request, context = {}) {
    const middleware = createRBACMiddleware(resource, permissions, options);
    const authResult = await middleware(request, context);
    
    // If middleware returns a response, it means access was denied
    if (authResult) {
      return authResult;
    }
    
    // Continue to the original handler with context containing user info
    return handler(request, context);
  };
}

/**
 * Check if current user can perform action on resource
 * Utility function for use within API handlers
 * @param {Request} request - Request object
 * @param {string} resource - Resource to check
 * @param {string} permission - Permission to check
 * @returns {Promise<boolean>} True if user has permission
 */
export async function canUserPerform(request, resource, permission) {
  try {
    const user = await getCurrentUser(request);
    return user ? hasPermission(user, resource, permission) : false;
  } catch (error) {
    console.error('Error checking user permission:', error);
    return false;
  }
}

/**
 * Get user's permissions for a resource
 * @param {Request} request - Request object  
 * @param {string} resource - Resource to check
 * @returns {Promise<Array>} Array of permissions user has for the resource
 */
export async function getUserResourcePermissions(request, resource) {
  try {
    const user = await getCurrentUser(request);
    return user ? getUserPermissions(user, resource) : [];
  } catch (error) {
    console.error('Error getting user permissions:', error);
    return [];
  }
}

/**
 * Filter data based on user permissions
 * Remove sensitive fields if user doesn't have read access
 * @param {Object|Array} data - Data to filter
 * @param {Object} user - User object
 * @param {string} resource - Resource type
 * @returns {Object|Array} Filtered data
 */
export function filterDataByPermissions(data, user, resource) {
  if (!user || !data) return data;
  
  // If user is super admin, return all data
  if (user.is_super_admin) return data;
  
  // Check if user has read permission for this resource
  if (!hasPermission(user, resource, 'read')) {
    return null; // No access to this resource
  }
  
  // You can add more granular filtering here based on specific permissions
  // For example, hide certain fields if user doesn't have 'read_sensitive' permission
  
  return data;
}

// Export commonly used RBAC decorators for specific resources
export const requireLeadsRead = (handler) => withRBAC(handler, 'leads', 'read');
export const requireLeadsWrite = (handler) => withRBAC(handler, 'leads', ['create', 'update'], { requireAll: false });
export const requireLeadsDelete = (handler) => withRBAC(handler, 'leads', 'delete');

export const requireProjectsRead = (handler) => withRBAC(handler, 'projects', 'read');
export const requireProjectsWrite = (handler) => withRBAC(handler, 'projects', ['create', 'update'], { requireAll: false });
export const requireProjectsDelete = (handler) => withRBAC(handler, 'projects', 'delete');

export const requireUsersManage = (handler) => withRBAC(handler, 'users', ['create', 'update', 'delete'], { requireAll: false });
export const requireRolesManage = (handler) => withRBAC(handler, 'roles', ['create', 'update', 'delete'], { requireAll: false });