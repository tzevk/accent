'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import { StatusBadgeWithBg } from '@/components/StatusBadge';
import {
  UserGroupIcon,
  ClockIcon,
  ChartBarIcon,
  ArrowPathIcon,
  FunnelIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';

export default function LiveMonitoringPage() {
  const { user, loading: authLoading } = useSessionRBAC();
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'online' | 'idle' | 'offline'
  const [sortBy, setSortBy] = useState('status'); // 'status' | 'name' | 'screen_time'
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch users on mount and set up auto-refresh
  useEffect(() => {
    fetchUsers();
    
    if (autoRefresh) {
      const interval = setInterval(() => {
        fetchUsers();
      }, 10000); // Refresh every 10 seconds
      
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/user-status');
      const data = await response.json();
      if (data.success) {
        setUsers(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    fetchUsers();
  };

  // Filter and sort users
  const getFilteredAndSortedUsers = () => {
    let filtered = users;

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(u => u.status === statusFilter);
    }

    // Apply search
    if (searchTerm) {
      filtered = filtered.filter(u => 
        u.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'status') {
        const statusOrder = { online: 0, idle: 1, offline: 2 };
        return statusOrder[a.status] - statusOrder[b.status];
      } else if (sortBy === 'name') {
        return (a.full_name || a.username).localeCompare(b.full_name || b.username);
      } else if (sortBy === 'screen_time') {
        return (b.total_screen_time_minutes || 0) - (a.total_screen_time_minutes || 0);
      }
      return 0;
    });

    return filtered;
  };

  const filteredUsers = getFilteredAndSortedUsers();

  // Calculate statistics
  const stats = {
    total: users.length,
    online: users.filter(u => u.status === 'online').length,
    idle: users.filter(u => u.status === 'idle').length,
    offline: users.filter(u => u.status === 'offline').length,
    totalScreenTime: users.reduce((sum, u) => sum + (u.total_screen_time_minutes || 0), 0),
    avgProductivity: users.length > 0 
      ? users.reduce((sum, u) => sum + (u.productivity_score || 0), 0) / users.length 
      : 0
  };

  // Format time
  const formatTime = (minutes) => {
    if (!minutes) return '0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#64126D]"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Redirect if not authenticated
  if (!user) {
    router.push('/signin');
    return null;
  }

  // Redirect if not admin
  if (!(user.is_super_admin || user.role?.code === 'admin')) {
    router.push('/dashboard');
    return null;
  }

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#64126D]"></div>
            <p className="mt-4 text-gray-600">Loading live monitoring...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col overflow-hidden">
      <Navbar />
      
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-24 pb-8">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                    <UserGroupIcon className="w-8 h-8 text-blue-600" />
                    Live User Monitoring
                  </h1>
                  <p className="text-gray-600 mt-1">Real-time view of all user activities</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Auto-refresh (10s)
                  </label>
                  <button
                    onClick={handleRefresh}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    <ArrowPathIcon className="w-5 h-5" />
                    Refresh Now
                  </button>
                </div>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Users</p>
                    <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <UserGroupIcon className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Online Now</p>
                    <p className="text-3xl font-bold text-green-600">{stats.online}</p>
                    <p className="text-xs text-gray-500 mt-1">{stats.idle} idle, {stats.offline} offline</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Screen Time</p>
                    <p className="text-3xl font-bold text-purple-600">{formatTime(stats.totalScreenTime)}</p>
                    <p className="text-xs text-gray-500 mt-1">Today</p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <ClockIcon className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Avg Productivity</p>
                    <p className="text-3xl font-bold text-orange-600">{stats.avgProductivity.toFixed(0)}%</p>
                    <p className="text-xs text-gray-500 mt-1">Team average</p>
                  </div>
                  <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                    <ChartBarIcon className="w-6 h-6 text-orange-600" />
                  </div>
                </div>
              </div>
            </div>

            {/* Filters and Search */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6 border border-gray-200">
              <div className="flex flex-wrap items-center gap-4">
                {/* Search */}
                <div className="flex-1 min-w-[250px]">
                  <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-2">
                  <FunnelIcon className="w-5 h-5 text-gray-500" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="all">All Status</option>
                    <option value="online">Online Only</option>
                    <option value="idle">Idle Only</option>
                    <option value="offline">Offline Only</option>
                  </select>
                </div>

                {/* Sort By */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Sort:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="status">By Status</option>
                    <option value="name">By Name</option>
                    <option value="screen_time">By Screen Time</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Users Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredUsers.map((user) => (
                <div
                  key={user.user_id}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow"
                >
                  {/* User Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold text-lg relative">
                        {user.full_name 
                          ? user.full_name.split(' ').map(n => n[0]).join('')
                          : user.username[0].toUpperCase()}
                        {user.status === 'online' && (
                          <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full animate-pulse"></span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{user.full_name || user.username}</h3>
                        <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="mb-3">
                    <StatusBadgeWithBg status={user.status} lastActivity={user.last_activity} />
                  </div>

                  {/* Current Activity */}
                  {user.current_page && user.status === 'online' && (
                    <div className="mb-3 p-2 bg-blue-50 rounded-lg border border-blue-100">
                      <p className="text-xs text-blue-600 font-medium mb-1">Currently viewing</p>
                      <p className="text-xs text-gray-700 truncate">
                        {user.current_page.replace(/^\//, '') || 'Dashboard'}
                      </p>
                    </div>
                  )}

                  {/* Session Duration */}
                  {user.session_duration && user.status === 'online' && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-500">Session duration</p>
                      <p className="text-sm font-semibold text-gray-900">{formatDuration(user.session_duration)}</p>
                    </div>
                  )}

                  {/* Today's Stats */}
                  <div className="border-t border-gray-100 pt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Screen Time</span>
                      <span className="font-semibold text-gray-900">{formatTime(user.total_screen_time_minutes)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Activities</span>
                      <span className="font-semibold text-gray-900">{user.activities_count || 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Productivity</span>
                      <span className={`font-semibold ${
                        user.productivity_score >= 80 ? 'text-green-600' :
                        user.productivity_score >= 60 ? 'text-yellow-600' :
                        'text-orange-600'
                      }`}>
                        {user.productivity_score?.toFixed(0) || 0}%
                      </span>
                    </div>
                  </div>

                  {/* View Details Button */}
                  <button
                    onClick={() => router.push(`/admin/activity-logs?user_id=${user.user_id}`)}
                    className="w-full mt-3 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-md transition-colors"
                  >
                    View Activity Logs
                  </button>
                </div>
              ))}
            </div>

            {/* No Results */}
            {filteredUsers.length === 0 && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <UserGroupIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">No users found</h3>
                <p className="text-sm text-gray-500">
                  {searchTerm 
                    ? 'Try adjusting your search or filters' 
                    : statusFilter !== 'all'
                    ? `No ${statusFilter} users at the moment`
                    : 'No users available'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
