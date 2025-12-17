'use client';

import { useSessionRBAC } from '@/utils/client-rbac';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import Navbar from './Navbar';

/**
 * AccessGuard - A component that checks if the user has permission to view a page
 * 
 * Usage:
 * <AccessGuard resource="employees" permission="read">
 *   <YourPageContent />
 * </AccessGuard>
 * 
 * Props:
 * - resource: The RBAC resource to check (e.g., 'employees', 'leads', 'users')
 * - permission: The permission to check (default: 'read')
 * - children: The page content to render if access is granted
 * - fallback: Optional custom fallback component for access denied
 * - showNavbar: Whether to show Navbar in the access denied screen (default: true)
 */
export default function AccessGuard({ 
  resource, 
  permission = 'read', 
  children, 
  fallback,
  showNavbar = true 
}) {
  const { loading, user, can, RESOURCES, PERMISSIONS } = useSessionRBAC();

  // While loading, show a loading spinner
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        {showNavbar && <Navbar />}
        <div className="flex items-center justify-center h-[calc(100vh-64px)] pt-16">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Map string resource to RESOURCES enum
  const resourceKey = resource.toUpperCase();
  const permissionKey = permission.toUpperCase();
  const rbacResource = RESOURCES[resourceKey] || resource;
  const rbacPermission = PERMISSIONS[permissionKey] || permission;

  // Check if user has permission
  const hasAccess = user?.is_super_admin || can(rbacResource, rbacPermission);

  // If no access, show access denied
  if (!hasAccess) {
    if (fallback) {
      return fallback;
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        {showNavbar && <Navbar />}
        <div className="flex items-center justify-center h-[calc(100vh-64px)] pt-16">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-200">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <LockClosedIcon className="h-8 w-8 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
              <p className="text-gray-600 mb-4">
                You don&apos;t have permission to access this page.
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Required permission: <span className="font-mono bg-gray-100 px-2 py-1 rounded">{resource}:{permission}</span>
              </p>
              <button
                onClick={() => window.history.back()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // User has access, render children
  return children;
}

/**
 * Hook version for more complex use cases
 */
export function useAccessCheck(resource, permission = 'read') {
  const { loading, user, can, RESOURCES, PERMISSIONS } = useSessionRBAC();
  
  const resourceKey = resource?.toUpperCase();
  const permissionKey = permission?.toUpperCase();
  const rbacResource = RESOURCES[resourceKey] || resource;
  const rbacPermission = PERMISSIONS[permissionKey] || permission;
  
  const hasAccess = !loading && (user?.is_super_admin || can(rbacResource, rbacPermission));
  
  return { loading, hasAccess, user };
}
