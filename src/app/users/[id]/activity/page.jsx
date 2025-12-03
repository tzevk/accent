'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import StatusBadge from '@/components/StatusBadge';
import UserActivityCard from '@/components/UserActivityCard';
import {
  ArrowLeftIcon,
  CalendarIcon,
  ClockIcon,
  ChartBarIcon,
  DocumentTextIcon,
  CursorArrowRaysIcon,
  FunnelIcon
} from '@heroicons/react/24/outline';

export default function UserActivityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id;
  const { user: sessionUser, loading: authLoading } = useSessionRBAC();

  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [activityData, setActivityData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [workSummary, setWorkSummary] = useState(null);

  // Filters
  const [dateRange, setDateRange] = useState('today'); // 'today' | 'week' | 'month' | 'custom'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [logLimit, setLogLimit] = useState(50);

  // Check permissions
  const canView = sessionUser && (
    sessionUser.role === 'Admin' || 
    sessionUser.id === parseInt(userId)
  );

  useEffect(() => {
    if (!authLoading && !canView) {
      router.push('/dashboard');
    }
  }, [authLoading, canView, router]);

  useEffect(() => {
    if (canView) {
      fetchAllData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dateRange, startDate, endDate, actionFilter, logLimit, canView]);

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.all([
      fetchUserData(),
      fetchActivityLogs(),
      fetchScreenTime(),
      fetchWorkSummary()
    ]);
    setLoading(false);
  };

  const fetchUserData = async () => {
    try {
      // Get user basic info and current status
      const [userRes, statusRes] = await Promise.all([
        fetch(`/api/users?id=${userId}`),
        fetch(`/api/user-status?user_id=${userId}`)
      ]);

      const userData = await userRes.json();
      const statusData = await statusRes.json();

      if (userData.success && userData.data.length > 0) {
        setUserData(userData.data[0]);
      }

      if (statusData.success) {
        setActivityData(statusData.data);
      }
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    }
  };

  const fetchActivityLogs = async () => {
    try {
      const params = new URLSearchParams({
        user_id: userId,
        limit: logLimit
      });

      if (actionFilter !== 'all') {
        params.append('action_type', actionFilter);
      }

      const dates = getDateRangeParams();
      if (dates.start) params.append('start_date', dates.start);
      if (dates.end) params.append('end_date', dates.end);

      const response = await fetch(`/api/activity-logs?${params}`);
      const data = await response.json();

      if (data.success) {
        setLogs(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch activity logs:', error);
    }
  };

  const fetchScreenTime = async () => {
    try {
      const params = new URLSearchParams({
        user_id: userId,
        type: 'daily'
      });

      const dates = getDateRangeParams();
      if (dates.start) params.append('start_date', dates.start);
      if (dates.end) params.append('end_date', dates.end);

      const response = await fetch(`/api/screen-time?${params}`);
      const data = await response.json();

      // Screen time data fetched for potential future use
      if (data.success) {
        // Could be used for charts/graphs in future enhancement
        console.debug('Screen time data available:', data.data);
      }
    } catch (error) {
      console.error('Failed to fetch screen time:', error);
    }
  };

  const fetchWorkSummary = async () => {
    try {
      const params = new URLSearchParams({
        user_id: userId
      });

      const dates = getDateRangeParams();
      if (dates.start) params.append('start_date', dates.start);
      if (dates.end) params.append('end_date', dates.end);

      const response = await fetch(`/api/work-summary?${params}`);
      const data = await response.json();

      if (data.success) {
        setWorkSummary(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch work summary:', error);
    }
  };

  const getDateRangeParams = () => {
    const today = new Date();
    let start, end;

    if (dateRange === 'today') {
      start = end = today.toISOString().split('T')[0];
    } else if (dateRange === 'week') {
      const weekAgo = new Date(today);
      weekAgo.setDate(today.getDate() - 7);
      start = weekAgo.toISOString().split('T')[0];
      end = today.toISOString().split('T')[0];
    } else if (dateRange === 'month') {
      const monthAgo = new Date(today);
      monthAgo.setMonth(today.getMonth() - 1);
      start = monthAgo.toISOString().split('T')[0];
      end = today.toISOString().split('T')[0];
    } else if (dateRange === 'custom') {
      start = startDate;
      end = endDate;
    }

    return { start, end };
  };

  const formatTime = (minutes) => {
    if (!minutes) return '0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const formatDateTime = (dateString) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getActionBadgeColor = (actionType) => {
    const colors = {
      login: 'bg-green-100 text-green-800',
      logout: 'bg-red-100 text-red-800',
      create: 'bg-blue-100 text-blue-800',
      update: 'bg-yellow-100 text-yellow-800',
      delete: 'bg-red-100 text-red-800',
      view_page: 'bg-purple-100 text-purple-800',
      click: 'bg-gray-100 text-gray-800',
      status_change: 'bg-indigo-100 text-indigo-800'
    };
    return colors[actionType] || 'bg-gray-100 text-gray-800';
  };

  if (authLoading || loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading activity details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600">User not found</p>
            <button
              onClick={() => router.back()}
              className="mt-4 text-blue-600 hover:text-blue-800"
            >
              Go Back
            </button>
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
              <button
                onClick={() => router.back()}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
              >
                <ArrowLeftIcon className="w-5 h-5" />
                Back
              </button>

              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">
                    {userData.full_name || userData.username}&apos;s Activity
                  </h1>
                  <p className="text-gray-600 mt-1">
                    {userData.email} • {userData.role_name || 'No role'}
                  </p>
                </div>
                {activityData && (
                  <StatusBadge 
                    lastActivity={activityData.last_activity} 
                    size="lg"
                  />
                )}
              </div>
            </div>

            {/* Activity Card */}
            <div className="mb-6">
              <UserActivityCard 
                userData={{ ...userData, ...activityData }}
                activityData={activityData}
              />
            </div>

            {/* Date Range Filter */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6 border border-gray-200">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Date Range:</span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setDateRange('today')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      dateRange === 'today'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    Today
                  </button>
                  <button
                    onClick={() => setDateRange('week')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      dateRange === 'week'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    Last 7 Days
                  </button>
                  <button
                    onClick={() => setDateRange('month')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      dateRange === 'month'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    Last 30 Days
                  </button>
                  <button
                    onClick={() => setDateRange('custom')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      dateRange === 'custom'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {dateRange === 'custom' && (
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                    />
                    <span className="text-gray-500 flex items-center">to</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2 ml-auto">
                  <FunnelIcon className="w-5 h-5 text-gray-500" />
                  <select
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="all">All Actions</option>
                    <option value="login">Login</option>
                    <option value="logout">Logout</option>
                    <option value="create">Create</option>
                    <option value="update">Update</option>
                    <option value="delete">Delete</option>
                    <option value="view_page">Page Views</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Summary Stats */}
            {workSummary && workSummary.stats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Total Work Time</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {formatTime(workSummary.stats.totalWorkMinutes)}
                      </p>
                    </div>
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <ClockIcon className="w-5 h-5 text-blue-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Total Activities</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {workSummary.stats.totalActivities || 0}
                      </p>
                    </div>
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <CursorArrowRaysIcon className="w-5 h-5 text-green-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Pages Viewed</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {workSummary.stats.totalPages || 0}
                      </p>
                    </div>
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <DocumentTextIcon className="w-5 h-5 text-purple-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">Avg Productivity</p>
                      <p className="text-2xl font-bold text-orange-600">
                        {workSummary.stats.avgProductivity?.toFixed(0) || 0}%
                      </p>
                    </div>
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                      <ChartBarIcon className="w-5 h-5 text-orange-600" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Activity Timeline */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Activity Timeline</h2>
                <select
                  value={logLimit}
                  onChange={(e) => setLogLimit(parseInt(e.target.value))}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                >
                  <option value={25}>Show 25</option>
                  <option value={50}>Show 50</option>
                  <option value={100}>Show 100</option>
                  <option value={200}>Show 200</option>
                </select>
              </div>

              <div className="overflow-y-auto max-h-[600px]">
                {logs.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    No activity logs found for the selected period
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {logs.map((log) => (
                      <div key={log.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getActionBadgeColor(log.action_type)}`}>
                                {log.action_type.replace('_', ' ')}
                              </span>
                              <span className="text-xs text-gray-500">
                                {formatDateTime(log.created_at)}
                              </span>
                              {log.status && (
                                <span className={`text-xs font-medium ${
                                  log.status === 'success' ? 'text-green-600' :
                                  log.status === 'failed' ? 'text-red-600' :
                                  'text-yellow-600'
                                }`}>
                                  {log.status}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-900 mb-1">{log.description}</p>
                            {log.resource_type && (
                              <p className="text-xs text-gray-500">
                                Resource: {log.resource_type}
                                {log.resource_id && ` #${log.resource_id}`}
                              </p>
                            )}
                            {log.details && (
                              <details className="mt-2">
                                <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">
                                  View details
                                </summary>
                                <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto">
                                  {JSON.stringify(JSON.parse(log.details), null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
