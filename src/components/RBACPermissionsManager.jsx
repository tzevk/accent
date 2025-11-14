'use client';
/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheckIcon, 
  AdjustmentsHorizontalIcon,
  CheckIcon,
  XMarkIcon,
  LockClosedIcon,
  LockOpenIcon
} from '@heroicons/react/24/outline';
import { RESOURCES, PERMISSIONS, PERMISSION_DESCRIPTIONS, PERMISSION_TEMPLATES } from '@/utils/rbac';

export default function RBACPermissionsManager({ 
  type = 'user', // 'user' or 'role'
  targetId, 
  targetName,
  onPermissionsUpdated,
  readOnly = false 
}) {
  const [permissions, setPermissions] = useState({});
  const [rolePermissions, setRolePermissions] = useState({});
  const [effectivePermissions, setEffectivePermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [compactView, setCompactView] = useState(false);
  const [filterGrantedOnly, setFilterGrantedOnly] = useState(false);
  const [filterDirectOnly, setFilterDirectOnly] = useState(false);
  const [collapsedResources, setCollapsedResources] = useState({});

  const fetchPermissions = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        type: 'all',
        ...(type === 'user' ? { user_id: targetId } : { role_id: targetId })
      });
      
      const res = await fetch(`/api/permissions?${params}`);
      const data = await res.json();
      
      if (data.success) {
        console.log('📥 Loaded permissions from database:', {
          userPermissions: data.data.user_permissions?.direct || [],
          rolePermissions: data.data.role_permissions?.direct || [],
          effectivePermissions: data.data.effective_permissions?.direct || []
        });
        setPermissions(data.data.user_permissions?.grouped || {});
        setRolePermissions(data.data.role_permissions?.grouped || {});
        setEffectivePermissions(data.data.effective_permissions?.grouped || {});
      }
    } catch (error) {
      console.error('Error fetching permissions:', error);
    } finally {
      setLoading(false);
    }
  }, [targetId, type]);

  useEffect(() => {
    if (targetId) {
      fetchPermissions();
    } else {
      setLoading(false);
    }
  }, [targetId, type, fetchPermissions]);

  const updatePermissions = async (newPermissions, action = 'replace') => {
    try {
      setSaving(true);
      if (!targetId) {
        console.warn('No targetId provided for permission update');
        return;
      }
      
      console.log('🔄 Updating permissions:', {
        targetId,
        type,
        permissionCount: newPermissions.length,
        permissions: newPermissions
      });
      
      const res = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [type === 'user' ? 'user_id' : 'role_id']: targetId,
          permissions: newPermissions,
          type,
          action
        })
      });

      // Be resilient to non-JSON error responses (e.g., HTML error pages)
      const contentType = res.headers.get('content-type') || '';
      let data;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`${res.status} ${res.statusText} - ${text.substring(0, 200)}`);
      }

      if (data.success) {
        console.log('✅ Permissions saved to database:', data.data.permissions);
        const savedPermissions = data.data.permissions || [];
        await fetchPermissions(); // Refresh data from database
        onPermissionsUpdated?.(savedPermissions);
        
        // Show success notification
        const successMessage = type === 'user' 
          ? `User permissions updated successfully! ${savedPermissions.length} permission(s) saved.`
          : `Role permissions updated successfully! ${savedPermissions.length} permission(s) saved.`;
        
        // Show a temporary success message
        const notification = document.createElement('div');
        notification.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center space-x-2';
        notification.innerHTML = `
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>${successMessage}</span>
        `;
        document.body.appendChild(notification);
        setTimeout(() => {
          notification.remove();
        }, 3000);
      } else {
        console.error('❌ Failed to save permissions:', data.error);
        alert('Error updating permissions: ' + (data?.error || res.statusText || 'Unknown error'));
      }
    } catch (error) {
      console.error('❌ Error updating permissions:', error);
      alert('Failed to update permissions: ' + (error?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = (resource, permission) => {
    if (readOnly) return;
    if (!targetId) return;
    
    const currentResourcePerms = permissions[resource] || [];
    const hasPermission = currentResourcePerms.includes(permission);
    
    let newResourcePerms;
    if (hasPermission) {
      newResourcePerms = currentResourcePerms.filter(p => p !== permission);
    } else {
      newResourcePerms = [...currentResourcePerms, permission];
    }
    
    const newPermissions = {
      ...permissions,
      [resource]: newResourcePerms
    };
    
    setPermissions(newPermissions);
    
    // Only send the delta to the server for better reliability
    const key = `${resource}:${permission}`;
    const action = hasPermission ? 'revoke' : 'grant';
    updatePermissions([key], action);
  };

  const applyTemplate = (template) => {
    if (readOnly) return;
    if (!targetId) return;
    
    const templatePermissions = {};
    Object.values(RESOURCES).forEach(resource => {
      templatePermissions[resource] = [...PERMISSION_TEMPLATES[template]];
    });
    
    setPermissions(templatePermissions);
    
    const flatPermissions = Object.entries(templatePermissions)
      .flatMap(([res, perms]) => perms.map(perm => `${res}:${perm}`));
    
    updatePermissions(flatPermissions, 'replace');
    setShowTemplates(false);
  };

  const bulkToggleResource = (resource, enable) => {
    if (readOnly) return;
    if (!targetId) return;
    
    const newPermissions = {
      ...permissions,
      [resource]: enable ? Object.values(PERMISSIONS) : []
    };
    
    setPermissions(newPermissions);
    
    const flatPermissions = Object.entries(newPermissions)
      .flatMap(([res, perms]) => perms.map(perm => `${res}:${perm}`));
    
    updatePermissions(flatPermissions, 'replace');
  };

  const bulkTogglePermission = (permission, enable) => {
    if (readOnly) return;
    if (!targetId) return;
    
    const newPermissions = { ...permissions };
    Object.keys(RESOURCES).forEach(resourceKey => {
      const resource = RESOURCES[resourceKey];
      const currentPerms = newPermissions[resource] || [];
      
      if (enable && !currentPerms.includes(permission)) {
        newPermissions[resource] = [...currentPerms, permission];
      } else if (!enable) {
        newPermissions[resource] = currentPerms.filter(p => p !== permission);
      }
    });
    
    setPermissions(newPermissions);
    
    const flatPermissions = Object.entries(newPermissions)
      .flatMap(([res, perms]) => perms.map(perm => `${res}:${perm}`));
    
    updatePermissions(flatPermissions, 'replace');
  };

  const getPermissionCount = (resource) => {
    const userPerms = permissions[resource] || [];
    const rolePerms = rolePermissions[resource] || [];
    const effective = effectivePermissions[resource] || [];
    
    return {
      user: userPerms.length,
      role: rolePerms.length,
      effective: effective.length,
      total: Object.values(PERMISSIONS).length
    };
  };

  const hasEffectivePermission = (resource, permission) => {
    const effective = effectivePermissions[resource] || [];
    return effective.includes(permission);
  };

  const hasUserPermission = (resource, permission) => {
    const userPerms = permissions[resource] || [];
    return userPerms.includes(permission);
  };

  const hasRolePermission = (resource, permission) => {
    const rolePerms = rolePermissions[resource] || [];
    return rolePerms.includes(permission);
  };

  const toggleResourceCollapse = (resource) => {
    setCollapsedResources(prev => ({
      ...prev,
      [resource]: !prev[resource]
    }));
  };

  const getFilteredResources = () => {
    let resources = Object.entries(RESOURCES);
    
    if (filterGrantedOnly) {
      resources = resources.filter(([, resource]) => {
        const effective = effectivePermissions[resource] || [];
        return effective.length > 0;
      });
    }
    
    if (filterDirectOnly && type === 'user') {
      resources = resources.filter(([, resource]) => {
        const userPerms = permissions[resource] || [];
        return userPerms.length > 0;
      });
    }
    
    return resources;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
        <span className="ml-3 text-gray-600">Loading permissions...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between sticky top-0 bg-white z-10 pb-4 border-b border-gray-200">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <ShieldCheckIcon className="h-5 w-5" />
            <span>Permissions for {targetName}</span>
            <span className="text-sm font-normal text-gray-500">({type})</span>
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            {type === 'user' ? 'Manage direct user permissions and view inherited role permissions' : 'Configure role-based permissions that apply to all users with this role'}
          </p>
        </div>
        
        <div className="flex items-center space-x-2">
          {!readOnly && (
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors flex items-center space-x-2"
            >
              <AdjustmentsHorizontalIcon className="h-4 w-4" />
              <span>Templates</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters and View Options */}
      <div className="flex items-center justify-between bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg p-4 border border-gray-200 shadow-sm">
        <div className="flex items-center space-x-6">
          <span className="text-sm font-semibold text-gray-700">Filters:</span>
          <label className="flex items-center space-x-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={filterGrantedOnly}
              onChange={(e) => setFilterGrantedOnly(e.target.checked)}
              className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 focus:ring-2"
            />
            <span className="text-sm text-gray-700 group-hover:text-gray-900">Granted only</span>
          </label>
          {type === 'user' && (
            <label className="flex items-center space-x-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={filterDirectOnly}
                onChange={(e) => setFilterDirectOnly(e.target.checked)}
                className="h-4 w-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500 focus:ring-2"
              />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">Direct only</span>
            </label>
          )}
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-sm font-semibold text-gray-700">View:</span>
          <div className="flex items-center bg-white rounded-lg border border-gray-300 shadow-sm">
            <button
              onClick={() => setCompactView(false)}
              className={`px-4 py-2 text-xs font-medium rounded-l-lg transition-all ${
                !compactView 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Expanded
            </button>
            <button
              onClick={() => setCompactView(true)}
              className={`px-4 py-2 text-xs font-medium rounded-r-lg transition-all ${
                compactView 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Compact
            </button>
          </div>
        </div>
      </div>

      {/* Permission Templates */}
      {showTemplates && !readOnly && (
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
          <h4 className="font-medium text-blue-900 mb-3">Apply Permission Template</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {Object.entries(PERMISSION_TEMPLATES).map(([templateName, templatePerms]) => (
              <button
                key={templateName}
                onClick={() => applyTemplate(templateName)}
                className="p-3 bg-white border border-blue-200 rounded-md hover:bg-blue-50 transition-colors text-left"
              >
                <div className="font-medium text-blue-900 capitalize">{templateName.toLowerCase()}</div>
                <div className="text-xs text-blue-600 mt-1">
                  {templatePerms.length} permissions
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bulk Actions */}
      {!readOnly && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="font-medium text-gray-900 mb-3">Bulk Actions</h4>
          <div className="flex flex-wrap items-center gap-2">
            {Object.values(PERMISSIONS).map(permission => (
              <div key={permission} className="flex items-center space-x-1">
                <button
                  onClick={() => bulkTogglePermission(permission, true)}
                  className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors capitalize"
                >
                  Grant {permission} to All
                </button>
                <button
                  onClick={() => bulkTogglePermission(permission, false)}
                  className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors capitalize"
                >
                  Revoke {permission} from All
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Permissions Grid */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100 sticky top-0 z-30 shadow-md border-b-2 border-gray-300">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider w-64 bg-gradient-to-r from-gray-50 to-gray-100">
                  Resource
                </th>
                {Object.values(PERMISSIONS).map(permission => (
                  <th key={permission} className="px-4 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider min-w-[100px] bg-gradient-to-r from-gray-50 to-gray-100">
                    <div className="flex flex-col items-center space-y-2">
                      <span className="capitalize" title={`Grant or revoke ${permission} permission`}>
                        {permission}
                      </span>
                      {!readOnly && !compactView && (
                        <div className="flex space-x-1">
                          <button
                            onClick={() => bulkTogglePermission(permission, true)}
                            className="p-1.5 text-green-600 hover:bg-green-100 rounded-md transition-colors"
                            title={`Grant ${permission} to all resources`}
                          >
                            <CheckIcon className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => bulkTogglePermission(permission, false)}
                            className="p-1.5 text-red-600 hover:bg-red-100 rounded-md transition-colors"
                            title={`Revoke ${permission} from all resources`}
                          >
                            <XMarkIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-4 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider min-w-[120px] bg-gradient-to-r from-gray-50 to-gray-100">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {getFilteredResources().map(([, resource]) => {
                const counts = getPermissionCount(resource);
                const isCollapsed = collapsedResources[resource];
                
                return (
                  <React.Fragment key={resource}>
                    <tr className="hover:bg-blue-50 transition-colors">
                      <td className={`px-6 ${compactView ? 'py-3' : 'py-4'} border-r border-gray-100`}>
                        <div className="flex items-center space-x-3">
                          <button
                            onClick={() => toggleResourceCollapse(resource)}
                            className="text-gray-400 hover:text-gray-700 transition-colors p-1 hover:bg-gray-100 rounded"
                            title={isCollapsed ? 'Expand details' : 'Collapse details'}
                          >
                            {isCollapsed ? (
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            )}
                          </button>
                          <div className={`${compactView ? 'h-8 w-8' : 'h-10 w-10'} bg-gradient-to-br from-blue-500 to-purple-600 text-white rounded-lg flex items-center justify-center shadow-sm`}>
                            <span className={`font-bold ${compactView ? 'text-sm' : 'text-base'}`}>
                              {resource.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1">
                            <div className={`${compactView ? 'text-sm' : 'text-base'} font-semibold text-gray-900 capitalize`}>
                              {resource.replace('_', ' ')}
                            </div>
                            {!isCollapsed && !compactView && (
                              <div className="text-xs text-gray-500 mt-1 flex items-center space-x-2">
                                {type === 'user' ? (
                                  <>
                                    <span className="flex items-center">
                                      <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mr-1"></span>
                                      Direct: {counts.user}/{counts.total}
                                    </span>
                                    <span className="text-gray-300">•</span>
                                    <span className="flex items-center">
                                      <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1"></span>
                                      Role: {counts.role}/{counts.total}
                                    </span>
                                    <span className="text-gray-300">•</span>
                                    <span className="flex items-center">
                                      <span className="inline-block w-2 h-2 bg-purple-500 rounded-full mr-1"></span>
                                      Effective: {counts.effective}/{counts.total}
                                    </span>
                                  </>
                                ) : (
                                  <span>{counts.user}/{counts.total} permissions granted</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    
                                            
                      {Object.values(PERMISSIONS).map(permission => {
                        const hasUser = hasUserPermission(resource, permission);
                        const hasRole = hasRolePermission(resource, permission);
                        const hasEffective = hasEffectivePermission(resource, permission);
                        const description = PERMISSION_DESCRIPTIONS[resource]?.[permission] || `${permission} access to ${resource}`;
                        
                        return (
                          <td key={permission} className={`px-4 ${compactView ? 'py-3' : 'py-4'} text-center bg-gray-50 bg-opacity-30`}>
                            <div className="flex items-center justify-center">
                              {type === 'user' ? (
                                <div className="flex flex-col items-center space-y-1.5" title={description}>
                                  {/* Direct user permission */}
                                  <button
                                    onClick={() => togglePermission(resource, permission)}
                                    disabled={readOnly || saving || !targetId}
                                    className={`${compactView ? 'h-6 w-6' : 'h-7 w-7'} rounded-lg border-2 flex items-center justify-center transition-all shadow-sm ${
                                      hasUser
                                        ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700 hover:shadow-md'
                                        : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                                    } ${readOnly || saving ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                    title={`Direct permission: ${hasUser ? 'Granted ✓' : 'Not granted'}`}
                                  >
                                    {hasUser && <CheckIcon className={compactView ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
                                  </button>
                                  
                                  {!isCollapsed && !compactView && (
                                    <div className="flex items-center space-x-1">
                                      {/* Role permission indicator */}
                                      {hasRole && (
                                        <div className="h-2 w-2 bg-green-500 rounded-full shadow-sm" title="Inherited from role" />
                                      )}
                                      
                                      {/* Effective permission indicator */}
                                      {hasEffective ? (
                                        <LockOpenIcon className="h-3 w-3 text-green-600" title="Has effective access" />
                                      ) : (
                                        <LockClosedIcon className="h-3 w-3 text-gray-300" title="No access" />
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                /* Role permission */
                                <button
                                  onClick={() => togglePermission(resource, permission)}
                                  disabled={readOnly || saving || !targetId}
                                  className={`${compactView ? 'h-7 w-7' : 'h-8 w-8'} rounded-lg border-2 flex items-center justify-center transition-all shadow-sm ${
                                    hasUser
                                      ? 'bg-purple-600 border-purple-600 text-white hover:bg-purple-700 hover:shadow-md'
                                      : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'
                                  } ${readOnly || saving ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                  title={description}
                                >
                                  {hasUser && <CheckIcon className={compactView ? 'h-4 w-4' : 'h-5 w-5'} />}
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      
                      <td className={`px-4 ${compactView ? 'py-3' : 'py-4'} text-center border-l border-gray-100`}>
                        {!readOnly && !isCollapsed && (
                          <div className="flex items-center justify-center space-x-1.5">
                            <button
                              onClick={() => bulkToggleResource(resource, true)}
                              className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors shadow-sm"
                              title="Grant all permissions for this resource"
                            >
                              <CheckIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => bulkToggleResource(resource, false)}
                              className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors shadow-sm"
                              title="Revoke all permissions for this resource"
                            >
                              <XMarkIcon className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                      
                      <td className={`px-6 ${compactView ? 'py-2' : 'py-4'} text-center`}>
                        {!readOnly && !isCollapsed && (
                          <div className="flex items-center justify-center space-x-1">
                            <button
                              onClick={() => bulkToggleResource(resource, true)}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                              title="Grant all permissions for this resource"
                            >
                              <CheckIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => bulkToggleResource(resource, false)}
                              className="p-1 text-red-600 hover:bg-red-50 rounded"
                              title="Revoke all permissions for this resource"
                            >
                              <XMarkIcon className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend for user permissions */}
      {type === 'user' && !compactView && (
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-5 border border-blue-200 shadow-sm">
          <h4 className="font-semibold text-gray-900 mb-4 flex items-center">
            <svg className="h-5 w-5 mr-2 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Permission Legend
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center space-x-3 bg-white p-3 rounded-lg border border-blue-100">
              <div className="h-7 w-7 bg-blue-600 rounded-lg border-2 border-blue-600 flex items-center justify-center shadow-sm">
                <CheckIcon className="h-4 w-4 text-white" />
              </div>
              <div>
                <div className="font-medium text-gray-900">Direct Permission</div>
                <div className="text-xs text-gray-600">Toggleable by you</div>
              </div>
            </div>
            <div className="flex items-center space-x-3 bg-white p-3 rounded-lg border border-green-100">
              <div className="h-3 w-3 bg-green-500 rounded-full shadow-sm" />
              <div>
                <div className="font-medium text-gray-900">Role Inherited</div>
                <div className="text-xs text-gray-600">From user&apos;s role</div>
              </div>
            </div>
            <div className="flex items-center space-x-3 bg-white p-3 rounded-lg border border-purple-100">
              <LockOpenIcon className="h-5 w-5 text-green-600" />
              <div>
                <div className="font-medium text-gray-900">Has Access</div>
                <div className="text-xs text-gray-600">Effective permission</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Saving indicator */}
      {saving && (
        <div className="fixed bottom-4 right-4 bg-black text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
          <span>Saving permissions...</span>
        </div>
      )}
    </div>
  );
}