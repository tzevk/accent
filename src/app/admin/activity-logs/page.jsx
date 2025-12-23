'use client';

import React, { useState, useEffect } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { 
  ClockIcon, 
  UserIcon, 
  FunnelIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  ComputerDesktopIcon,
  CursorArrowRaysIcon,
  ChartBarIcon,
  BriefcaseIcon,
  ShieldExclamationIcon,
  ChevronDownIcon
} from '@heroicons/react/24/outline';
import StatusBadge, { StatusBadgeWithBg } from '@/components/StatusBadge';

// Audit Log Constants
const AUDIT_ACTION_LABELS = {
  update_permissions: 'Updated Permissions',
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  login: 'Logged In',
  logout: 'Logged Out',
  export: 'Exported Data',
  import: 'Imported Data'
};

const AUDIT_ACTION_COLORS = {
  update_permissions: 'bg-purple-100 text-purple-800',
  create: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
  login: 'bg-cyan-100 text-cyan-800',
  logout: 'bg-gray-100 text-gray-800',
  export: 'bg-yellow-100 text-yellow-800',
  import: 'bg-indigo-100 text-indigo-800'
};

const AUDIT_RESOURCE_LABELS = {
  user_permissions: 'User Permissions',
  users: 'Users',
  employees: 'Employees',
  leads: 'Leads',
  projects: 'Projects',
  vendors: 'Vendors',
  proposals: 'Proposals',
  documents: 'Documents'
};

export default function ActivityLogsPage() {
  const { user, loading: authLoading } = useSessionRBAC();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('activity'); // 'activity', 'work-logs', or 'audit'
  const [logs, setLogs] = useState([]);
  const [workLogs, setWorkLogs] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workLogsLoading, setWorkLogsLoading] = useState(true);
  const [auditLogsLoading, setAuditLogsLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [userStatusMap, setUserStatusMap] = useState({});
  const [workSummary, setWorkSummary] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [workLogsPagination, setWorkLogsPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [auditLogsPagination, setAuditLogsPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [expandedAuditRow, setExpandedAuditRow] = useState(null);
  
  // Filters
  const [selectedUser, setSelectedUser] = useState('all');
  const [selectedActionType, setSelectedActionType] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Work Logs Filters
  const [workLogUser, setWorkLogUser] = useState('all');
  const [workLogType, setWorkLogType] = useState('all');
  const [workLogStartDate, setWorkLogStartDate] = useState('');
  const [workLogEndDate, setWorkLogEndDate] = useState('');

  // Audit Logs Filters
  const [auditAction, setAuditAction] = useState('all');
  const [auditResource, setAuditResource] = useState('all');
  const [auditStartDate, setAuditStartDate] = useState('');
  const [auditEndDate, setAuditEndDate] = useState('');
  const [auditSearch, setAuditSearch] = useState('');

  // Action type options
  const actionTypes = [
    'all', 'login', 'logout', 'create', 'read', 'update', 'delete', 
    'view_page', 'click', 'mouse_move', 'keypress', 'scroll', 
    'focus', 'blur', 'visibility_change', 'status_change', 'heartbeat'
  ];

  useEffect(() => {
    if (!authLoading && (!user || !(user.is_super_admin || user.role?.code === 'admin'))) {
      router.push('/dashboard');
    }
  }, [user, authLoading, router]);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users');
      const data = await response.json();
      if (data.success) {
        setUsers(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const fetchUserStatus = async () => {
    try {
      const response = await fetch('/api/user-status');
      const data = await response.json();
      if (data.success) {
        const statusMap = {};
        data.data.forEach(userStatus => {
          statusMap[userStatus.user_id] = userStatus;
        });
        setUserStatusMap(statusMap);
      }
    } catch (error) {
      console.error('Failed to fetch user status:', error);
    }
  };

  const fetchWorkSummary = async (userId) => {
    if (!userId || userId === 'all') {
      setWorkSummary(null);
      return;
    }
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      
      const response = await fetch(`/api/users/${userId}/activities?${params}`);
      const data = await response.json();
      if (data.success) {
        setWorkSummary(data.summary);
      }
    } catch (error) {
      console.error('Failed to fetch work summary:', error);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page,
        limit: pagination.limit,
      });

      if (selectedUser !== 'all') params.append('user_id', selectedUser);
      if (selectedActionType !== 'all') params.append('action_type', selectedActionType);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);

      const response = await fetch(`/api/activity-logs?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setLogs(data.data);
        setPagination(prev => ({
          ...prev,
          total: data.pagination.total,
          totalPages: data.pagination.totalPages
        }));
      }
    } catch (error) {
      console.error('Failed to fetch activity logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkLogs = async () => {
    setWorkLogsLoading(true);
    try {
      const params = new URLSearchParams({
        page: workLogsPagination.page,
        limit: workLogsPagination.limit,
      });

      if (workLogUser !== 'all') params.append('user_id', workLogUser);
      if (workLogType !== 'all') params.append('log_type', workLogType);
      if (workLogStartDate) params.append('start_date', workLogStartDate);
      if (workLogEndDate) params.append('end_date', workLogEndDate);

      const response = await fetch(`/api/work-logs?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setWorkLogs(data.data);
        setWorkLogsPagination(prev => ({
          ...prev,
          total: data.pagination.total,
          totalPages: data.pagination.totalPages
        }));
      }
    } catch (error) {
      console.error('Failed to fetch work logs:', error);
    } finally {
      setWorkLogsLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    setAuditLogsLoading(true);
    try {
      const params = new URLSearchParams({
        page: auditLogsPagination.page.toString(),
        limit: auditLogsPagination.limit.toString(),
      });
      
      if (auditAction !== 'all') params.append('action', auditAction);
      if (auditResource !== 'all') params.append('resource_type', auditResource);
      if (auditStartDate) params.append('start_date', auditStartDate);
      if (auditEndDate) params.append('end_date', auditEndDate);
      if (auditSearch) params.append('search', auditSearch);

      const response = await fetch(`/api/audit-logs?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setAuditLogs(data.data);
        setAuditLogsPagination(prev => ({
          ...prev,
          total: data.pagination.total,
          totalPages: data.pagination.totalPages
        }));
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setAuditLogsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchUserStatus();
    
    // Check if user_id is in URL params and set it
    const params = new URLSearchParams(window.location.search);
    const userIdParam = params.get('user_id');
    if (userIdParam) {
      setSelectedUser(userIdParam);
    }
    
    // Auto-refresh status every 30 seconds
    const interval = setInterval(fetchUserStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === 'activity') {
      fetchLogs();
      fetchWorkSummary(selectedUser);
    } else if (activeTab === 'work-logs') {
      fetchWorkLogs();
    } else if (activeTab === 'audit-logs') {
      fetchAuditLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, selectedUser, selectedActionType, startDate, endDate, workLogsPagination.page, workLogUser, workLogType, workLogStartDate, workLogEndDate, activeTab, auditLogsPagination.page, auditAction, auditResource, auditStartDate, auditEndDate, auditSearch]);

  const handleRefresh = () => {
    if (activeTab === 'activity') {
      fetchLogs();
      fetchUserStatus();
      if (selectedUser !== 'all') {
        fetchWorkSummary(selectedUser);
      }
    } else if (activeTab === 'work-logs') {
      fetchWorkLogs();
    } else if (activeTab === 'audit-logs') {
      fetchAuditLogs();
    }
  };

  const handleReset = () => {
    setSelectedUser('all');
    setSelectedActionType('all');
    setStartDate('');
    setEndDate('');
    setSearchTerm('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getActionIcon = (actionType) => {
    switch (actionType) {
      case 'login':
      case 'logout':
        return <UserIcon className="w-4 h-4" />;
      case 'view_page':
        return <ComputerDesktopIcon className="w-4 h-4" />;
      case 'click':
      case 'mouse_move':
        return <CursorArrowRaysIcon className="w-4 h-4" />;
      case 'create':
      case 'update':
      case 'delete':
        return <DocumentTextIcon className="w-4 h-4" />;
      default:
        return <ClockIcon className="w-4 h-4" />;
    }
  };

  const getActionColor = (actionType) => {
    switch (actionType) {
      case 'login': return 'text-green-600 bg-green-50';
      case 'logout': return 'text-gray-600 bg-gray-50';
      case 'create': return 'text-blue-600 bg-blue-50';
      case 'update': return 'text-yellow-600 bg-yellow-50';
      case 'delete': return 'text-red-600 bg-red-50';
      case 'view_page': return 'text-purple-600 bg-purple-50';
      case 'click':
      case 'mouse_move':
      case 'keypress':
      case 'scroll': return 'text-indigo-600 bg-indigo-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const filteredLogs = logs.filter(log => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      log.description?.toLowerCase().includes(searchLower) ||
      log.resource_type?.toLowerCase().includes(searchLower) ||
      log.resource_id?.toLowerCase().includes(searchLower)
    );
  });

  if (authLoading || (user && !(user.is_super_admin || user.role?.code === 'admin'))) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
        {/* Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <nav className="text-xs text-gray-500 mb-1" aria-label="Breadcrumb">
              <ol className="inline-flex items-center gap-2">
                <li>Admin</li>
                <li className="text-gray-300">/</li>
                <li className="text-gray-700">Admin Logs</li>
              </ol>
            </nav>
            <h1 className="text-3xl font-bold text-gray-900">Admin Logs</h1>
          </div>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 rounded-lg border border-purple-200 text-[#64126D] px-3.5 py-2 hover:bg-purple-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        {/* Tabs */}
        <div className="bg-white border border-purple-200 rounded-xl mb-6 overflow-hidden">
          <div className="flex border-b border-purple-100">
            <button
              onClick={() => setActiveTab('activity')}
              className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                activeTab === 'activity'
                  ? 'text-[#64126D] border-b-2 border-[#64126D] bg-purple-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <ClockIcon className="h-5 w-5" />
                Activity Logs
              </div>
            </button>
            <button
              onClick={() => setActiveTab('work-logs')}
              className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                activeTab === 'work-logs'
                  ? 'text-[#64126D] border-b-2 border-[#64126D] bg-purple-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <BriefcaseIcon className="h-5 w-5" />
                User Work Logs
              </div>
            </button>
            <button
              onClick={() => setActiveTab('audit-logs')}
              className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                activeTab === 'audit-logs'
                  ? 'text-[#64126D] border-b-2 border-[#64126D] bg-purple-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <ShieldExclamationIcon className="h-5 w-5" />
                Audit Logs
              </div>
            </button>
          </div>
        </div>

        {activeTab === 'activity' ? (
          <>
            {/* Filters */}
            <div className="bg-white border border-purple-200 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <FunnelIcon className="h-5 w-5 text-[#64126D]" />
            <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* User Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">User</label>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Users</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.username}
                  </option>
                ))}
              </select>
            </div>

            {/* Action Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Action Type</label>
              <select
                value={selectedActionType}
                onChange={(e) => setSelectedActionType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {actionTypes.map(type => (
                  <option key={type} value={type}>
                    {type === 'all' ? 'All Actions' : type.replace('_', ' ').toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
              <div className="relative">
                <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search logs..."
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Work Summary for Selected User */}
        {selectedUser !== 'all' && workSummary && (
          <div className="bg-white border border-purple-200 rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-[#64126D] to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                  {users.find(u => u.id === parseInt(selectedUser))?.full_name?.charAt(0) || 'U'}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {users.find(u => u.id === parseInt(selectedUser))?.full_name || 'User'}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    {userStatusMap[selectedUser] && (
                      <StatusBadgeWithBg 
                        status={userStatusMap[selectedUser].status} 
                        lastActivity={userStatusMap[selectedUser].last_activity}
                      />
                    )}
                    {userStatusMap[selectedUser]?.current_page && userStatusMap[selectedUser].status === 'online' && (
                      <span className="text-xs text-gray-500">📍 {userStatusMap[selectedUser].current_page.replace(/^\//,'')}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Total Work Session</p>
                <p className="text-2xl font-bold text-gray-900">{workSummary.total_hours || '0'}h</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ChartBarIcon className="w-5 h-5 text-blue-600" />
                  <p className="text-sm font-medium text-blue-900">Activities</p>
                </div>
                <p className="text-2xl font-bold text-blue-600">{workSummary.total_activities || 0}</p>
                <p className="text-xs text-blue-700 mt-1">{workSummary.unique_action_types || 0} types</p>
              </div>

              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DocumentTextIcon className="w-5 h-5 text-green-600" />
                  <p className="text-sm font-medium text-green-900">Pages Visited</p>
                </div>
                <p className="text-2xl font-bold text-green-600">{workSummary.pages_visited || 0}</p>
                <p className="text-xs text-green-700 mt-1">{workSummary.unique_pages || 0} unique</p>
              </div>

              <div className="bg-purple-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ClockIcon className="w-5 h-5 text-purple-600" />
                  <p className="text-sm font-medium text-purple-900">Active Time</p>
                </div>
                <p className="text-2xl font-bold text-purple-600">{workSummary.active_hours || '0'}h</p>
                <p className="text-xs text-purple-700 mt-1">{workSummary.active_percentage || 0}% active</p>
              </div>

              <div className="bg-orange-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <BriefcaseIcon className="w-5 h-5 text-orange-600" />
                  <p className="text-sm font-medium text-orange-900">Work Items</p>
                </div>
                <p className="text-2xl font-bold text-orange-600">{workSummary.work_items_touched || 0}</p>
                <p className="text-xs text-orange-700 mt-1">
                  {workSummary.creates || 0} created, {workSummary.updates || 0} updated
                </p>
              </div>
            </div>

            {workSummary.recent_pages && workSummary.recent_pages.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm font-medium text-gray-700 mb-2">Recent Work:</p>
                <div className="flex flex-wrap gap-2">
                  {workSummary.recent_pages.slice(0, 10).map((page, idx) => (
                    <span key={idx} className="inline-flex items-center px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                      {page.page.replace(/^\//,'') || 'Dashboard'}
                      <span className="ml-2 text-gray-500">({page.visits}x)</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <DocumentTextIcon className="h-5 w-5 text-[#64126D]" />
              <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Total Logs</span>
            </div>
            <span className="text-2xl font-bold text-gray-900">{pagination.total.toLocaleString()}</span>
          </div>

          <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-green-500" />
              <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Active Users</span>
            </div>
            <span className="text-2xl font-bold text-green-600">{users.length}</span>
          </div>

          <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <FunnelIcon className="h-5 w-5 text-purple-500" />
              <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Showing</span>
            </div>
            <span className="text-2xl font-bold text-purple-600">{filteredLogs.length}</span>
          </div>

          <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <DocumentTextIcon className="h-5 w-5 text-amber-500" />
              <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Current Page</span>
            </div>
            <span className="text-2xl font-bold text-amber-600">{pagination.page} / {pagination.totalPages}</span>
          </div>
        </div>

        {/* Activity Logs Table */}
        <div className="bg-white border border-purple-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-purple-50 border-b border-purple-100">
                <tr>
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
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    IP Address
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center">
                      <div className="flex items-center justify-center">
                        <ArrowPathIcon className="w-6 h-6 text-gray-400 animate-spin mr-2" />
                        <span className="text-gray-500">Loading activity logs...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                      No activity logs found
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3 relative">
                            <UserIcon className="w-4 h-4 text-blue-600" />
                            {userStatusMap[log.user_id]?.status === 'online' && (
                              <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white rounded-full animate-pulse" title="Online Now"></span>
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {users.find(u => u.id === log.user_id)?.full_name || 'Unknown User'}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">
                                {users.find(u => u.id === log.user_id)?.username}
                              </span>
                              {userStatusMap[log.user_id] && (
                                <StatusBadge status={userStatusMap[log.user_id].status} />
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${getActionColor(log.action_type)}`}>
                          {getActionIcon(log.action_type)}
                          {log.action_type.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {log.resource_type ? (
                          <div>
                            <div className="font-medium">{log.resource_type}</div>
                            {log.resource_id && (
                              <div className="text-xs text-gray-500 truncate max-w-[150px]">
                                {log.resource_id}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="max-w-md">
                          <div className="font-medium text-gray-700">{log.description || '-'}</div>
                          {log.details && typeof log.details === 'object' && (
                            <div className="mt-1 space-y-1">
                              {log.details.page && (
                                <div className="text-xs text-blue-600">📄 {log.details.page}</div>
                              )}
                              {log.details.durationMinutes && (
                                <div className="text-xs text-purple-600">⏱️ {log.details.durationMinutes} min</div>
                              )}
                              {log.details.project && (
                                <div className="text-xs text-green-600">📁 Project: {log.details.project}</div>
                              )}
                              {log.details.lead && (
                                <div className="text-xs text-yellow-600">👤 Lead: {log.details.lead}</div>
                              )}
                              {log.details.status && (
                                <div className="text-xs text-gray-600">Status: {log.details.status}</div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {log.ip_address || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && filteredLogs.length > 0 && (
            <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-t">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{((pagination.page - 1) * pagination.limit) + 1}</span> to{' '}
                <span className="font-medium">
                  {Math.min(pagination.page * pagination.limit, pagination.total)}
                </span> of{' '}
                <span className="font-medium">{pagination.total}</span> results
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={pagination.page === 1}
                  className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
          </>
        ) : activeTab === 'work-logs' ? (
          <>
            {/* Work Logs Filters */}
            <div className="bg-white border border-purple-200 rounded-xl p-6 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <FunnelIcon className="h-5 w-5 text-[#64126D]" />
                <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* User Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">User</label>
                  <select
                    value={workLogUser}
                    onChange={(e) => setWorkLogUser(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="all">All Users</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.full_name || u.username}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Log Type Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Log Type</label>
                  <select
                    value={workLogType}
                    onChange={(e) => setWorkLogType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="all">All Types</option>
                    <option value="plan">Plan</option>
                    <option value="done">Done</option>
                    <option value="note">Note</option>
                  </select>
                </div>

                {/* Start Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    value={workLogStartDate}
                    onChange={(e) => setWorkLogStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* End Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                  <input
                    type="date"
                    value={workLogEndDate}
                    onChange={(e) => setWorkLogEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => {
                    setWorkLogUser('all');
                    setWorkLogType('all');
                    setWorkLogStartDate('');
                    setWorkLogEndDate('');
                    setWorkLogsPagination(prev => ({ ...prev, page: 1 }));
                  }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Reset Filters
                </button>
              </div>
            </div>

            {/* Work Logs Stats */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
              <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <BriefcaseIcon className="h-5 w-5 text-[#64126D]" />
                  <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Total Logs</span>
                </div>
                <span className="text-2xl font-bold text-gray-900">{workLogsPagination.total.toLocaleString()}</span>
              </div>

              <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <DocumentTextIcon className="h-5 w-5 text-blue-500" />
                  <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Plan Logs</span>
                </div>
                <span className="text-2xl font-bold text-blue-600">
                  {workLogs.filter(log => log.log_type === 'plan').length}
                </span>
              </div>

              <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <DocumentTextIcon className="h-5 w-5 text-green-500" />
                  <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Done Logs</span>
                </div>
                <span className="text-2xl font-bold text-green-600">
                  {workLogs.filter(log => log.log_type === 'done').length}
                </span>
              </div>

              <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <DocumentTextIcon className="h-5 w-5 text-amber-500" />
                  <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Current Page</span>
                </div>
                <span className="text-2xl font-bold text-amber-600">
                  {workLogsPagination.page} / {workLogsPagination.totalPages}
                </span>
              </div>
            </div>

            {/* Work Logs Table */}
            <div className="bg-white border border-purple-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-purple-50 border-b border-purple-100">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        User
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Title
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Description
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Priority
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Time Spent
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {workLogsLoading ? (
                      <tr>
                        <td colSpan="8" className="px-6 py-12 text-center">
                          <div className="flex items-center justify-center">
                            <ArrowPathIcon className="w-6 h-6 text-gray-400 animate-spin mr-2" />
                            <span className="text-gray-500">Loading work logs...</span>
                          </div>
                        </td>
                      </tr>
                    ) : workLogs.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="px-6 py-12 text-center text-gray-500">
                          No work logs found
                        </td>
                      </tr>
                    ) : (
                      workLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {new Date(log.log_date).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                                <UserIcon className="w-4 h-4 text-blue-600" />
                              </div>
                              <div>
                                <div className="text-sm font-medium text-gray-900">
                                  {users.find(u => u.id === log.user_id)?.full_name || 'Unknown User'}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {users.find(u => u.id === log.user_id)?.username}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              log.log_type === 'plan' ? 'bg-blue-100 text-blue-800' :
                              log.log_type === 'done' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {log.log_type.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-gray-900">
                            {log.title}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            <div className="max-w-md truncate">
                              {log.description || '-'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              log.status === 'completed' ? 'bg-green-100 text-green-800' :
                              log.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                              log.status === 'blocked' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {log.status?.replace('_', ' ').toUpperCase()}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              log.priority === 'high' ? 'bg-red-100 text-red-800' :
                              log.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-green-100 text-green-800'
                            }`}>
                              {log.priority?.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {log.time_spent ? `${log.time_spent} min` : '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {!workLogsLoading && workLogs.length > 0 && (
                <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-t">
                  <div className="text-sm text-gray-700">
                    Showing <span className="font-medium">{((workLogsPagination.page - 1) * workLogsPagination.limit) + 1}</span> to{' '}
                    <span className="font-medium">
                      {Math.min(workLogsPagination.page * workLogsPagination.limit, workLogsPagination.total)}
                    </span> of{' '}
                    <span className="font-medium">{workLogsPagination.total}</span> results
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setWorkLogsPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                      disabled={workLogsPagination.page === 1}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setWorkLogsPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                      disabled={workLogsPagination.page >= workLogsPagination.totalPages}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : activeTab === 'audit-logs' ? (
          <>
            {/* Audit Logs Filters */}
            <div className="bg-white border border-purple-200 rounded-xl p-6 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <FunnelIcon className="h-5 w-5 text-[#64126D]" />
                <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Action Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Action</label>
                  <select
                    value={auditAction}
                    onChange={(e) => {
                      setAuditAction(e.target.value);
                      setAuditLogsPagination(prev => ({ ...prev, page: 1 }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">All Actions</option>
                    {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                {/* Resource Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Resource</label>
                  <select
                    value={auditResource}
                    onChange={(e) => {
                      setAuditResource(e.target.value);
                      setAuditLogsPagination(prev => ({ ...prev, page: 1 }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">All Resources</option>
                    {Object.entries(AUDIT_RESOURCE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                {/* Start Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    value={auditStartDate}
                    onChange={(e) => {
                      setAuditStartDate(e.target.value);
                      setAuditLogsPagination(prev => ({ ...prev, page: 1 }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* End Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                  <input
                    type="date"
                    value={auditEndDate}
                    onChange={(e) => {
                      setAuditEndDate(e.target.value);
                      setAuditLogsPagination(prev => ({ ...prev, page: 1 }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Search */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => {
                      setAuditSearch(e.target.value);
                      setAuditLogsPagination(prev => ({ ...prev, page: 1 }));
                    }}
                    placeholder="Search audit logs..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Clear Filters */}
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => {
                    setAuditAction('all');
                    setAuditResource('all');
                    setAuditStartDate('');
                    setAuditEndDate('');
                    setAuditSearch('');
                    setAuditLogsPagination(prev => ({ ...prev, page: 1 }));
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            </div>

            {/* Audit Logs Table */}
            <div className="bg-white border border-purple-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-purple-50 border-b border-purple-100">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sr. No.</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Resource</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {auditLogsLoading ? (
                      <tr>
                        <td colSpan="7" className="px-6 py-8 text-center text-gray-500">
                          <div className="flex items-center justify-center gap-2">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#64126D]"></div>
                            Loading audit logs...
                          </div>
                        </td>
                      </tr>
                    ) : auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="px-6 py-8 text-center text-gray-500">
                          No audit logs found
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log, index) => (
                        <React.Fragment key={log.id}>
                          <tr className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {((auditLogsPagination.page - 1) * auditLogsPagination.limit) + index + 1}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(log.created_at).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                                  <UserIcon className="w-4 h-4 text-purple-600" />
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-900">
                                    {log.user_name || 'Unknown User'}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {log.username || '-'}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${AUDIT_ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-800'}`}>
                                {AUDIT_ACTION_LABELS[log.action] || log.action}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {AUDIT_RESOURCE_LABELS[log.resource_type] || log.resource_type}
                              {log.resource_id && <span className="text-gray-500"> #{log.resource_id}</span>}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {log.ip_address || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {(log.old_values || log.new_values) ? (
                                <button
                                  onClick={() => setExpandedAuditRow(expandedAuditRow === log.id ? null : log.id)}
                                  className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                                >
                                  {expandedAuditRow === log.id ? 'Hide' : 'View'}
                                  <ChevronDownIcon className={`w-4 h-4 transition-transform ${expandedAuditRow === log.id ? 'rotate-180' : ''}`} />
                                </button>
                              ) : (
                                <span className="text-gray-400 text-sm">-</span>
                              )}
                            </td>
                          </tr>
                          {expandedAuditRow === log.id && (
                            <tr className="bg-gray-50">
                              <td colSpan="7" className="px-6 py-4">
                                <div className="grid grid-cols-2 gap-4">
                                  {log.old_values && (
                                    <div>
                                      <h4 className="text-sm font-medium text-gray-700 mb-2">Previous Values</h4>
                                      <pre className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 overflow-auto max-h-40">
                                        {typeof log.old_values === 'string' ? log.old_values : JSON.stringify(log.old_values, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {log.new_values && (
                                    <div>
                                      <h4 className="text-sm font-medium text-gray-700 mb-2">New Values</h4>
                                      <pre className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 overflow-auto max-h-40">
                                        {typeof log.new_values === 'string' ? log.new_values : JSON.stringify(log.new_values, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {!auditLogsLoading && auditLogs.length > 0 && (
                <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-t">
                  <div className="text-sm text-gray-700">
                    Showing <span className="font-medium">{((auditLogsPagination.page - 1) * auditLogsPagination.limit) + 1}</span> to{' '}
                    <span className="font-medium">
                      {Math.min(auditLogsPagination.page * auditLogsPagination.limit, auditLogsPagination.total)}
                    </span> of{' '}
                    <span className="font-medium">{auditLogsPagination.total}</span> results
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAuditLogsPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                      disabled={auditLogsPagination.page === 1}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setAuditLogsPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                      disabled={auditLogsPagination.page >= auditLogsPagination.totalPages}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
