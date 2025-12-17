'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect, useCallback } from 'react';
import AccessGuard from '@/components/AccessGuard';
import {
  DocumentTextIcon,
  UserIcon,
  ClockIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

const ACTION_LABELS = {
  update_permissions: 'Updated Permissions',
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  login: 'Logged In',
  logout: 'Logged Out',
  export: 'Exported Data',
  import: 'Imported Data'
};

const ACTION_COLORS = {
  update_permissions: 'bg-purple-100 text-purple-800',
  create: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
  login: 'bg-cyan-100 text-cyan-800',
  logout: 'bg-gray-100 text-gray-800',
  export: 'bg-yellow-100 text-yellow-800',
  import: 'bg-indigo-100 text-indigo-800'
};

const RESOURCE_LABELS = {
  user_permissions: 'User Permissions',
  users: 'Users',
  employees: 'Employees',
  leads: 'Leads',
  projects: 'Projects',
  vendors: 'Vendors',
  proposals: 'Proposals',
  documents: 'Documents'
};

function AuditLogsContent() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  
  // Filters
  const [filters, setFilters] = useState({
    search: '',
    action: '',
    resource: '',
    startDate: '',
    endDate: '',
    userId: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  
  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit] = useState(20);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      if (filters.action) params.append('action', filters.action);
      if (filters.resource) params.append('resource', filters.resource);
      if (filters.startDate) params.append('start_date', filters.startDate);
      if (filters.endDate) params.append('end_date', filters.endDate);
      if (filters.userId) params.append('user_id', filters.userId);
      if (filters.search) params.append('search', filters.search);
      
      const res = await fetch(`/api/audit-logs?${params.toString()}`);
      const data = await res.json();
      
      if (data.success) {
        setLogs(data.data || []);
        setTotalPages(Math.ceil((data.total || 0) / limit));
      } else {
        setError(data.error || 'Failed to fetch audit logs');
      }
    } catch (err) {
      setError('Failed to fetch audit logs');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, filters]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      action: '',
      resource: '',
      startDate: '',
      endDate: '',
      userId: ''
    });
    setPage(1);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderChanges = (log) => {
    const oldVal = log.old_value;
    const newVal = log.new_value;
    
    if (!oldVal && !newVal) return null;
    
    // For permission changes, show a structured view
    if (log.action === 'update_permissions') {
      return (
        <div className="mt-3 space-y-4">
          {/* Module Permissions Changes */}
          {(oldVal?.permissions || newVal?.permissions) && (
            <div>
              <h5 className="text-sm font-medium text-gray-700 mb-2">Module Permissions</h5>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-red-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-red-700 mb-1">Previous</p>
                  <div className="flex flex-wrap gap-1">
                    {(oldVal?.permissions || []).length > 0 ? (
                      oldVal.permissions.slice(0, 10).map((p, i) => (
                        <span key={i} className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">
                          {p}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-500">No permissions</span>
                    )}
                    {(oldVal?.permissions || []).length > 10 && (
                      <span className="text-xs text-red-600">+{oldVal.permissions.length - 10} more</span>
                    )}
                  </div>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-green-700 mb-1">Updated</p>
                  <div className="flex flex-wrap gap-1">
                    {(newVal?.permissions || []).length > 0 ? (
                      newVal.permissions.slice(0, 10).map((p, i) => (
                        <span key={i} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                          {p}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-500">No permissions</span>
                    )}
                    {(newVal?.permissions || []).length > 10 && (
                      <span className="text-xs text-green-600">+{newVal.permissions.length - 10} more</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Field Permissions Changes */}
          {(oldVal?.field_permissions || newVal?.field_permissions) && (
            <div>
              <h5 className="text-sm font-medium text-gray-700 mb-2">Field Permissions</h5>
              <div className="text-xs text-gray-500">
                Field-level permission changes applied
              </div>
            </div>
          )}
        </div>
      );
    }
    
    // For other changes, show JSON diff
    return (
      <div className="mt-3 grid grid-cols-2 gap-4">
        {oldVal && (
          <div className="bg-red-50 rounded-lg p-3">
            <p className="text-xs font-medium text-red-700 mb-1">Previous Value</p>
            <pre className="text-xs text-gray-700 overflow-auto max-h-40">
              {JSON.stringify(oldVal, null, 2)}
            </pre>
          </div>
        )}
        {newVal && (
          <div className="bg-green-50 rounded-lg p-3">
            <p className="text-xs font-medium text-green-700 mb-1">New Value</p>
            <pre className="text-xs text-gray-700 overflow-auto max-h-40">
              {JSON.stringify(newVal, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <ShieldCheckIcon className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
                <p className="text-sm text-gray-500">Track all system changes and user actions</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`inline-flex items-center px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${
                  showFilters
                    ? 'border-purple-500 text-purple-700 bg-purple-50'
                    : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                }`}
              >
                <FunnelIcon className="h-4 w-4 mr-2" />
                Filters
              </button>
              <button
                onClick={fetchLogs}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <ArrowPathIcon className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {/* Search */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                    placeholder="Search..."
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
              </div>

              {/* Action Filter */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Action</label>
                <select
                  value={filters.action}
                  onChange={(e) => handleFilterChange('action', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="">All Actions</option>
                  {Object.entries(ACTION_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Resource Filter */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Resource</label>
                <select
                  value={filters.resource}
                  onChange={(e) => handleFilterChange('resource', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="">All Resources</option>
                  {Object.entries(RESOURCE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Start Date */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">From Date</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => handleFilterChange('startDate', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              {/* End Date */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">To Date</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => handleFilterChange('endDate', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              {/* Clear Button */}
              <div className="flex items-end">
                <button
                  onClick={clearFilters}
                  className="w-full px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center space-x-3">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Logs Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <DocumentTextIcon className="h-12 w-12 text-gray-300 mb-3" />
              <p className="text-gray-500">No audit logs found</p>
              {Object.values(filters).some(f => f) && (
                <button
                  onClick={clearFilters}
                  className="mt-2 text-sm text-purple-600 hover:text-purple-700"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                      
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timestamp
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Resource
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Resource ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      IP Address
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {logs.map((log) => (
                    <>
                      <tr
                        key={log.id}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${
                          expandedRow === log.id ? 'bg-purple-50' : ''
                        }`}
                        onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                      >
                        <td className="px-6 py-4">
                          {log.old_value || log.new_value ? (
                            expandedRow === log.id ? (
                              <ChevronUpIcon className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                            )
                          ) : null}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center text-sm text-gray-900">
                            <ClockIcon className="h-4 w-4 text-gray-400 mr-2" />
                            {formatDate(log.created_at)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center mr-3">
                              <UserIcon className="h-4 w-4 text-gray-500" />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {log.username || 'Unknown'}
                              </div>
                              {log.user_id && (
                                <div className="text-xs text-gray-500">
                                  ID: {log.user_id}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                            ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-800'
                          }`}>
                            {ACTION_LABELS[log.action] || log.action}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {RESOURCE_LABELS[log.resource] || log.resource}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {log.resource_id || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {log.ip_address || '-'}
                        </td>
                      </tr>
                      {expandedRow === log.id && (log.old_value || log.new_value) && (
                        <tr key={`${log.id}-details`}>
                          <td colSpan={7} className="px-6 py-4 bg-gray-50">
                            <div className="text-sm">
                              <h4 className="font-medium text-gray-900 mb-2">Change Details</h4>
                              {renderChanges(log)}
                              {log.user_agent && (
                                <div className="mt-3 text-xs text-gray-500">
                                  <span className="font-medium">User Agent:</span> {log.user_agent}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                Page {page} of {totalPages}
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AuditLogsPage() {
  return (
    <AccessGuard resource="users" permission="read">
      <AuditLogsContent />
    </AccessGuard>
  );
}
