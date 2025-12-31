'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/rbac';
import {
  CheckCircleIcon,
  XCircleIcon,
  ShieldCheckIcon,
  UserIcon,
  KeyIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';

export default function PermissionsTestPage() {
  const { user, loading: rbacLoading, can } = useSessionRBAC();
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testResults, setTestResults] = useState([]);
  const [expandedResources, setExpandedResources] = useState({});
  const [selectedResource, setSelectedResource] = useState('all');
  const [selectedPermission, setSelectedPermission] = useState('all');

  // Fetch raw session data from API
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        const data = await res.json();
        setSessionData(data);
      } catch (error) {
        console.error('Error fetching session:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchSession();
  }, []);

  // Run permission tests whenever user data changes
  useEffect(() => {
    if (!rbacLoading && user) {
      runAllTests();
    }
  }, [rbacLoading, user]);

  const runAllTests = () => {
    const results = [];
    Object.values(RESOURCES).forEach(resource => {
      Object.values(PERMISSIONS).forEach(permission => {
        const hasAccess = can(resource, permission);
        results.push({
          resource,
          permission,
          hasAccess,
          permissionKey: `${resource}:${permission}`
        });
      });
    });
    setTestResults(results);
  };

  const toggleResource = (resource) => {
    setExpandedResources(prev => ({
      ...prev,
      [resource]: !prev[resource]
    }));
  };

  const expandAll = () => {
    const expanded = {};
    Object.values(RESOURCES).forEach(r => { expanded[r] = true; });
    setExpandedResources(expanded);
  };

  const collapseAll = () => {
    setExpandedResources({});
  };

  // Group results by resource
  const groupedResults = testResults.reduce((acc, result) => {
    if (!acc[result.resource]) {
      acc[result.resource] = [];
    }
    acc[result.resource].push(result);
    return acc;
  }, {});

  // Filter results
  const filteredGroupedResults = Object.entries(groupedResults).filter(([resource]) => {
    if (selectedResource === 'all') return true;
    return resource === selectedResource;
  }).reduce((acc, [resource, perms]) => {
    const filteredPerms = selectedPermission === 'all' 
      ? perms 
      : perms.filter(p => p.permission === selectedPermission);
    if (filteredPerms.length > 0) {
      acc[resource] = filteredPerms;
    }
    return acc;
  }, {});

  // Stats
  const totalTests = testResults.length;
  const passedTests = testResults.filter(r => r.hasAccess).length;
  const failedTests = totalTests - passedTests;

  if (loading || rbacLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
          <div className="flex items-center justify-center h-[calc(100vh-120px)]">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#64126D]" />
              <span className="text-gray-500">Loading permissions...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
          <div className="flex items-center justify-center h-[calc(100vh-120px)]">
            <div className="text-center">
              <ExclamationTriangleIcon className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-700">Not Authenticated</h2>
              <p className="text-gray-500 mt-2">Please log in to test permissions.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
        {/* Header */}
        <div className="mb-6">
          <nav className="text-xs text-gray-500 mb-1">
            <ol className="inline-flex items-center gap-2">
              <li>Admin</li>
              <li className="text-gray-300">/</li>
              <li className="text-gray-700">Permissions Test</li>
            </ol>
          </nav>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <ShieldCheckIcon className="h-8 w-8 text-[#64126D]" />
                Permissions Test
              </h1>
              <p className="text-gray-600 mt-1">Verify your permission assignments are working correctly</p>
            </div>
            <button
              onClick={runAllTests}
              className="flex items-center gap-2 px-4 py-2 bg-[#64126D] text-white rounded-lg hover:bg-[#7a1a85] transition-colors"
            >
              <ArrowPathIcon className="h-5 w-5" />
              Re-run Tests
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <UserIcon className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Current User</p>
                <p className="font-semibold text-gray-900">{user.full_name || user.username}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <KeyIcon className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Role</p>
                <p className="font-semibold text-gray-900">{user.role?.name || 'No Role'}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircleIcon className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Permissions Granted</p>
                <p className="font-semibold text-green-600">{passedTests} / {totalTests}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <XCircleIcon className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Permissions Denied</p>
                <p className="font-semibold text-red-600">{failedTests} / {totalTests}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* User Details Card */}
          <div className="lg:col-span-1 space-y-4">
            {/* User Info */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-blue-100 border-b border-blue-200">
                <h3 className="font-semibold text-blue-800 flex items-center gap-2">
                  <UserIcon className="h-5 w-5" />
                  User Information
                </h3>
              </div>
              <div className="p-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">User ID:</span>
                  <span className="font-medium text-gray-900">{user.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Username:</span>
                  <span className="font-medium text-gray-900">{user.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Full Name:</span>
                  <span className="font-medium text-gray-900">{user.full_name || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Email:</span>
                  <span className="font-medium text-gray-900">{user.email || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Department:</span>
                  <span className="font-medium text-gray-900">{user.department || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Super Admin:</span>
                  <span className={`font-medium ${user.is_super_admin ? 'text-green-600' : 'text-gray-500'}`}>
                    {user.is_super_admin ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>

            {/* Role Info */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-purple-100 border-b border-purple-200">
                <h3 className="font-semibold text-purple-800 flex items-center gap-2">
                  <KeyIcon className="h-5 w-5" />
                  Role Information
                </h3>
              </div>
              <div className="p-4 space-y-3 text-sm">
                {user.role ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Role Name:</span>
                      <span className="font-medium text-gray-900">{user.role.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Role Code:</span>
                      <span className="font-medium text-gray-900">{user.role.code || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Hierarchy Level:</span>
                      <span className="font-medium text-gray-900">{user.role.hierarchy ?? '-'}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-gray-500 text-center py-2">No role assigned</p>
                )}
              </div>
            </div>

            {/* Raw Permissions */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-green-50 to-green-100 border-b border-green-200">
                <h3 className="font-semibold text-green-800 flex items-center gap-2">
                  <ShieldCheckIcon className="h-5 w-5" />
                  Raw Permissions ({(user.merged_permissions || []).length})
                </h3>
              </div>
              <div className="p-4 max-h-64 overflow-y-auto">
                {user.merged_permissions && user.merged_permissions.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {user.merged_permissions.map((perm, idx) => (
                      <span 
                        key={idx}
                        className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-2 text-sm">
                    No explicit permissions. May use role hierarchy defaults.
                  </p>
                )}
              </div>
            </div>

            {/* User Direct Permissions */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-orange-50 to-orange-100 border-b border-orange-200">
                <h3 className="font-semibold text-orange-800 flex items-center gap-2">
                  <UserIcon className="h-5 w-5" />
                  User Direct Permissions ({(user.permissions || []).length})
                </h3>
              </div>
              <div className="p-4 max-h-48 overflow-y-auto">
                {user.permissions && user.permissions.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {user.permissions.map((perm, idx) => (
                      <span 
                        key={idx}
                        className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-2 text-sm">No direct user permissions</p>
                )}
              </div>
            </div>

            {/* Role Permissions */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-indigo-100 border-b border-indigo-200">
                <h3 className="font-semibold text-indigo-800 flex items-center gap-2">
                  <KeyIcon className="h-5 w-5" />
                  Role Permissions ({(user.role_permissions || []).length})
                </h3>
              </div>
              <div className="p-4 max-h-48 overflow-y-auto">
                {user.role_permissions && user.role_permissions.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {user.role_permissions.map((perm, idx) => (
                      <span 
                        key={idx}
                        className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs rounded-full"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-2 text-sm">No role permissions</p>
                )}
              </div>
            </div>
          </div>

          {/* Permission Test Results */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <ShieldCheckIcon className="h-5 w-5" />
                    Permission Test Results
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={expandAll}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Expand All
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={collapseAll}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Collapse All
                    </button>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap gap-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Resource</label>
                  <select
                    value={selectedResource}
                    onChange={(e) => setSelectedResource(e.target.value)}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
                  >
                    <option value="all">All Resources</option>
                    {Object.values(RESOURCES).map(r => (
                      <option key={r} value={r}>{r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Permission</label>
                  <select
                    value={selectedPermission}
                    onChange={(e) => setSelectedPermission(e.target.value)}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
                  >
                    <option value="all">All Permissions</option>
                    {Object.values(PERMISSIONS).map(p => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Results List */}
              <div className="p-4 max-h-[600px] overflow-y-auto">
                {Object.entries(filteredGroupedResults).length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No permissions match the filter criteria.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(filteredGroupedResults).map(([resource, perms]) => {
                      const isExpanded = expandedResources[resource];
                      const grantedCount = perms.filter(p => p.hasAccess).length;
                      const totalCount = perms.length;

                      return (
                        <div key={resource} className="border border-gray-200 rounded-lg overflow-hidden">
                          <button
                            onClick={() => toggleResource(resource)}
                            className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              {isExpanded ? (
                                <ChevronDownIcon className="h-5 w-5 text-gray-400" />
                              ) : (
                                <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                              )}
                              <span className="font-medium text-gray-900 capitalize">
                                {resource.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-sm ${grantedCount === totalCount ? 'text-green-600' : grantedCount === 0 ? 'text-red-600' : 'text-yellow-600'}`}>
                                {grantedCount}/{totalCount} granted
                              </span>
                              <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all ${grantedCount === totalCount ? 'bg-green-500' : grantedCount === 0 ? 'bg-red-500' : 'bg-yellow-500'}`}
                                  style={{ width: `${(grantedCount / totalCount) * 100}%` }}
                                />
                              </div>
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="border-t border-gray-200 divide-y divide-gray-100">
                              {perms.map((perm) => (
                                <div 
                                  key={perm.permissionKey}
                                  className={`px-4 py-2 flex items-center justify-between ${perm.hasAccess ? 'bg-green-50' : 'bg-red-50'}`}
                                >
                                  <div className="flex items-center gap-2">
                                    {perm.hasAccess ? (
                                      <CheckCircleIcon className="h-5 w-5 text-green-600" />
                                    ) : (
                                      <XCircleIcon className="h-5 w-5 text-red-600" />
                                    )}
                                    <span className="text-sm capitalize">{perm.permission}</span>
                                  </div>
                                  <code className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-600">
                                    {perm.permissionKey}
                                  </code>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Raw Session Data (Debug) */}
        <div className="mt-6">
          <details className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-50">
              🔧 Raw Session Data (Debug)
            </summary>
            <div className="p-4 border-t border-gray-200">
              <pre className="text-xs bg-gray-900 text-green-400 p-4 rounded-lg overflow-auto max-h-64">
                {JSON.stringify(sessionData, null, 2)}
              </pre>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
