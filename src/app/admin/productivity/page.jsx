'use client';

import { useState, useEffect } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import { useRouter } from 'next/navigation';
import ActiveUsersMonitor from '@/components/ActiveUsersMonitor';
import {
  ClockIcon,
  ChartBarIcon,
  TrophyIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { 
  BarChart, 
  Bar, 
  LineChart, 
  Line,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';

export default function ProductivityPage() {
  const { user, loading: authLoading } = useSessionRBAC();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('7'); // days
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('all');
  const [screenTimeData, setScreenTimeData] = useState(null);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'Admin')) {
      router.push('/dashboard');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    fetchUsers();
  }, []);

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

  const fetchData = async () => {
    setLoading(true);
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
      });

      if (selectedUser !== 'all') {
        params.append('user_id', selectedUser);
      }

      // Fetch screen time data
      const screenTimeResponse = await fetch(`/api/screen-time?${params}`);
      const screenTimeResult = await screenTimeResponse.json();
      
      // Fetch work summary data
      const workSummaryResponse = await fetch(`/api/work-summary?${params}`);
      await workSummaryResponse.json();

      if (screenTimeResult.success) {
        setScreenTimeData(screenTimeResult.data);
      }
    } catch (error) {
      console.error('Failed to fetch productivity data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (users.length > 0) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, selectedUser, users]);

  const getDailyScreenTimeChart = () => {
    if (!screenTimeData?.daily) return [];
    return screenTimeData.daily.map(day => ({
      date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      active: Math.round(day.active_time_minutes),
      idle: Math.round(day.idle_time_minutes),
      total: Math.round(day.total_screen_time_minutes)
    }));
  };

  const getTopPagesData = () => {
    if (!screenTimeData?.pages) return [];
    return screenTimeData.pages.slice(0, 10).map(page => ({
      name: page.page_path.split('/').pop() || 'Home',
      visits: page.visit_count,
      minutes: Math.round(page.total_duration_seconds / 60)
    }));
  };

  const getProductivityScoreData = () => {
    if (!screenTimeData?.daily) return [];
    return screenTimeData.daily.map(day => ({
      date: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      productivity: Math.round(day.productivity_score || 0),
      focus: Math.round(day.focus_score || 0)
    }));
  };

  if (authLoading || (user && user.role !== 'Admin')) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Productivity Reports</h1>
              <p className="mt-1 text-sm text-gray-500">
                Analyze user activity, screen time, and productivity metrics
              </p>
            </div>
            <button
              onClick={fetchData}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <ArrowPathIcon className="w-5 h-5" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Time Period</label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={() => {
                  setSelectedUser('all');
                  setDateRange('7');
                }}
                className="w-full px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border"
              >
                Reset Filters
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Stats Cards */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Avg Screen Time</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {loading ? '...' : screenTimeData?.stats?.avgScreenTimePerDay 
                    ? `${Math.round(screenTimeData.stats.avgScreenTimePerDay)}m`
                    : '0m'}
                </p>
                <p className="text-xs text-gray-500 mt-1">per day</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <ClockIcon className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Avg Active Time</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {loading ? '...' : screenTimeData?.stats?.avgActiveTimePerDay 
                    ? `${Math.round(screenTimeData.stats.avgActiveTimePerDay)}m`
                    : '0m'}
                </p>
                <p className="text-xs text-gray-500 mt-1">per day</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <ChartBarIcon className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Avg Productivity</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {loading ? '...' : screenTimeData?.stats?.avgProductivityScore 
                    ? `${Math.round(screenTimeData.stats.avgProductivityScore)}%`
                    : '0%'}
                </p>
                <p className="text-xs text-gray-500 mt-1">score</p>
              </div>
              <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                <TrophyIcon className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Daily Screen Time Chart */}
          <div className="lg:col-span-2 bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Screen Time</h3>
            {loading ? (
              <div className="h-80 flex items-center justify-center">
                <ArrowPathIcon className="w-8 h-8 text-gray-400 animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={getDailyScreenTimeChart()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis label={{ value: 'Minutes', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="active" fill="#10B981" name="Active Time" />
                  <Bar dataKey="idle" fill="#F59E0B" name="Idle Time" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Active Users Monitor */}
          <div className="lg:col-span-1">
            <ActiveUsersMonitor />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Productivity & Focus Scores */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Productivity & Focus Trends</h3>
            {loading ? (
              <div className="h-80 flex items-center justify-center">
                <ArrowPathIcon className="w-8 h-8 text-gray-400 animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={getProductivityScoreData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} label={{ value: 'Score (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="productivity" stroke="#3B82F6" name="Productivity" strokeWidth={2} />
                  <Line type="monotone" dataKey="focus" stroke="#10B981" name="Focus" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top Pages by Time */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Most Visited Pages</h3>
            {loading ? (
              <div className="h-80 flex items-center justify-center">
                <ArrowPathIcon className="w-8 h-8 text-gray-400 animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={getTopPagesData()} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" label={{ value: 'Minutes', position: 'insideBottom', offset: -5 }} />
                  <YAxis dataKey="name" type="category" width={100} />
                  <Tooltip />
                  <Bar dataKey="minutes" fill="#8B5CF6" name="Time Spent" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Summary Stats */}
        {screenTimeData?.stats && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary Statistics</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-600 font-medium">Total Days</p>
                <p className="text-2xl font-bold text-blue-900 mt-1">
                  {screenTimeData.stats.totalDays || 0}
                </p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <p className="text-sm text-green-600 font-medium">Total Screen Time</p>
                <p className="text-2xl font-bold text-green-900 mt-1">
                  {Math.round((screenTimeData.stats.totalScreenTimeMinutes || 0) / 60)}h
                </p>
              </div>
              <div className="p-4 bg-yellow-50 rounded-lg">
                <p className="text-sm text-yellow-600 font-medium">Active Time</p>
                <p className="text-2xl font-bold text-yellow-900 mt-1">
                  {Math.round((screenTimeData.stats.totalActiveTimeMinutes || 0) / 60)}h
                </p>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg">
                <p className="text-sm text-purple-600 font-medium">Avg Focus Score</p>
                <p className="text-2xl font-bold text-purple-900 mt-1">
                  {Math.round(screenTimeData.stats.avgFocusScore || 0)}%
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
