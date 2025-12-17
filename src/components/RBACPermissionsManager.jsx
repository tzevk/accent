'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { RESOURCES, PERMISSIONS } from '@/utils/rbac';

export default function RBACPermissionsManager({ 
  type = 'user',
  targetId, 
  targetName,
  onPermissionsUpdated
}) {
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
        setPermissions(data.data.user_permissions?.grouped || {});
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

  const updatePermissions = async (newPermissions) => {
    try {
      setSaving(true);
      if (!targetId) return;
      
      const res = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [type === 'user' ? 'user_id' : 'role_id']: targetId,
          permissions: newPermissions,
          type,
          action: 'replace'
        })
      });

      const data = await res.json();
      if (data.success) {
        await fetchPermissions();
        if (onPermissionsUpdated) {
          onPermissionsUpdated();
        }
      }
    } catch (error) {
      console.error('Error updating permissions:', error);
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = (resource, permission) => {
    const key = `${resource}:${permission}`;
    const currentPerms = Object.entries(permissions).flatMap(([res, perms]) =>
      Object.keys(perms).map(perm => `${res}:${perm}`)
    );
    
    const newPerms = currentPerms.includes(key)
      ? currentPerms.filter(p => p !== key)
      : [...currentPerms, key];
    
    updatePermissions(newPerms);
  };

  const toggleAll = (resource, grant) => {
    const currentPerms = Object.entries(permissions).flatMap(([res, perms]) =>
      Object.keys(perms).map(perm => `${res}:${perm}`)
    );
    
    const resourcePerms = Object.values(PERMISSIONS).map(p => `${resource}:${p}`);
    
    let newPerms;
    if (grant) {
      newPerms = [...new Set([...currentPerms, ...resourcePerms])];
    } else {
      newPerms = currentPerms.filter(p => !p.startsWith(`${resource}:`));
    }
    
    updatePermissions(newPerms);
  };

  const hasPermission = (resource, permission) => {
    return permissions[resource]?.[permission] === true;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-gray-600">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Permissions: {targetName}
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            {type === 'user' ? 'User-specific permissions' : 'Role-based permissions'}
          </p>
        </div>
      </div>

      {/* Permissions Grid */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                Resource
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Read</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Create</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Update</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Delete</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Export</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Import</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Approve</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Assign</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {Object.values(RESOURCES).map(resource => (
              <tr key={resource} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <span className="text-sm font-medium text-gray-900 capitalize">
                    {resource.replace('_', ' ')}
                  </span>
                </td>
                {Object.values(PERMISSIONS).map(permission => {
                  const checked = hasPermission(resource, permission);
                  return (
                    <td key={permission} className="px-4 py-4 text-center">
                      <button
                        onClick={() => togglePermission(resource, permission)}
                        disabled={saving}
                        className={`h-6 w-6 rounded border-2 flex items-center justify-center transition-all ${
                          checked
                            ? 'bg-purple-600 border-purple-600 text-white'
                            : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'
                        } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {checked && <CheckIcon className="h-4 w-4" />}
                      </button>
                    </td>
                  );
                })}
                <td className="px-4 py-4 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => toggleAll(resource, true)}
                      disabled={saving}
                      className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                      title="Grant all"
                    >
                      <CheckIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleAll(resource, false)}
                      disabled={saving}
                      className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Revoke all"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {saving && (
        <div className="fixed bottom-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
          <span>Saving...</span>
        </div>
      )}
    </div>
  );
}
