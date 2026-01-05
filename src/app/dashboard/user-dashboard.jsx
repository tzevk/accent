'use client';

import React from 'react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import TodoList from '@/components/TodoList';
import ProjectActivityAssignments from '@/components/ProjectActivityAssignments';
import { useState, useEffect } from 'react';
import { fetchJSON } from '@/utils/http';
import { useSessionRBAC } from '@/utils/client-rbac';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import Link from 'next/link';
import { 
  ClockIcon, 
  ChartBarIcon, 
  CheckCircleIcon,
  CalendarDaysIcon,
  BriefcaseIcon,
  UserIcon,
  ArrowTrendingUpIcon,
  EnvelopeIcon,
  BellIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline';

export default function UserDashboard({ verifiedUser }) {
  // Use verifiedUser prop if available, otherwise fall back to context
  const { user: contextUser } = useSessionRBAC();
  const user = verifiedUser || contextUser;
  const [loading, setLoading] = useState(true);
  
  // Attendance & Time data
  const [attendance, setAttendance] = useState({
    inTime: null,
    outTime: null,
    currentMonth: '',
    daysInMonth: 0,
    daysPresent: 0,
    weeklyOff: 0,
    holidays: 0,
    leaves: { total: 18, used: 0, balance: 18 }
  });
  
  // Projects data
  const [projectsData, setProjectsData] = useState({
    projects: [],
    stats: {
      totalProjects: 0,
      totalActivities: 0,
      totalAssignedHours: 0,
      totalActualHours: 0,
      completedActivities: 0,
      inProgressActivities: 0
    }
  });
  
  // Analysis data
  const [analysisData, setAnalysisData] = useState({
    productivityTrend: [],
    statusDistribution: [],
    priorityDistribution: []
  });
  
  // Expanded project for viewing activities
  const [expandedProject, setExpandedProject] = useState(null);

  // New: User module assignments data
  const [moduleAssignments, setModuleAssignments] = useState({
    unreadMessages: 0,
    pendingTodos: 0,
    highPriorityTodos: 0,
    upcomingDeadlines: [],
    overdueActivities: 0,
    recentWorkLogs: [],
    todayWorkHours: 0,
    // Enhanced stats from dashboard API
    statusSummary: {
      not_started: 0,
      in_progress: 0,
      on_hold: 0,
      completed: 0,
      total: 0
    },
    workloadSummary: {
      total_active_activities: 0,
      total_estimated_hours: 0,
      total_actual_hours: 0,
      avg_progress: 0
    },
    priorityBreakdown: [],
    activeProjects: [],
    recentUpdates: [],
    // Activity assignments from project_activities_list (JSON-based)
    activityAssignments: {
      assignments: [],
      stats: {
        totalAssignments: 0,
        totalProjects: 0,
        totalQtyAssigned: 0,
        totalQtyCompleted: 0,
        totalPlannedHours: 0,
        totalActualHours: 0,
        completedCount: 0,
        inProgressCount: 0,
        notStartedCount: 0,
        onHoldCount: 0
      }
    }
  });

  // Track which modules user has access to
  const [moduleAccess, setModuleAccess] = useState({
    messages: true,
    todos: true,
    workLogs: true,
    dashboard: true
  });

  useEffect(() => {
    if (!user?.id) return;
    
    const loadData = async () => {
      try {
        // Load all data in parallel for efficiency
        const promises = [];

        // 1. Attendance data
        promises.push(
          fetchJSON(`/api/users/${user.id}/attendance`)
            .then(res => {
              if (res.success) setAttendance(res.data);
            })
            .catch(() => {}) // Silently handle errors
        );

        // 2. Projects with activities
        promises.push(
          fetchJSON(`/api/users/${user.id}/projects`)
            .then(res => {
              if (res.success) {
                setProjectsData(res.data);
                generateAnalysisData(res.data);
              }
            })
            .catch(() => {}) // Silently handle errors
        );

        // 3. Unread messages count
        promises.push(
          fetch('/api/messages/unread-count')
            .then(async (response) => {
              if (response.status === 401 || response.status === 403) {
                setModuleAccess(prev => ({ ...prev, messages: false }));
                return;
              }
              const res = await response.json();
              if (res.success) {
                setModuleAssignments(prev => ({
                  ...prev,
                  unreadMessages: res.data.unread_count || 0
                }));
              }
            })
            .catch(() => setModuleAccess(prev => ({ ...prev, messages: false })))
        );

        // 4. Pending todos count
        promises.push(
          fetch('/api/todos')
            .then(async (response) => {
              if (response.status === 401 || response.status === 403) {
                setModuleAccess(prev => ({ ...prev, todos: false }));
                return;
              }
              const res = await response.json();
              if (res.success && res.data) {
                const pending = res.data.filter(t => t.status !== 'completed');
                const highPriority = pending.filter(t => t.priority === 'high');
                setModuleAssignments(prev => ({
                  ...prev,
                  pendingTodos: pending.length,
                  highPriorityTodos: highPriority.length
                }));
              }
            })
            .catch(() => setModuleAccess(prev => ({ ...prev, todos: false })))
        );

        // 5. Dashboard stats with upcoming deadlines and overdue
        promises.push(
          fetch(`/api/users/${user.id}/dashboard`)
            .then(async (response) => {
              if (response.status === 401 || response.status === 403) {
                setModuleAccess(prev => ({ ...prev, dashboard: false }));
                return;
              }
              const res = await response.json();
              if (res.success && res.data) {
                setModuleAssignments(prev => ({
                  ...prev,
                  upcomingDeadlines: res.data.upcoming_deadlines || [],
                  overdueActivities: res.data.overdue_count || 0,
                  statusSummary: res.data.status_summary || prev.statusSummary,
                  workloadSummary: res.data.workload_summary || prev.workloadSummary,
                  priorityBreakdown: res.data.priority_breakdown || [],
                  activeProjects: res.data.active_projects || [],
                  recentUpdates: res.data.recent_updates || []
                }));
              }
            })
            .catch(() => setModuleAccess(prev => ({ ...prev, dashboard: false })))
        );

        // 5b. Activity assignments from project_activities_list (JSON-based)
        promises.push(
          fetch(`/api/users/${user.id}/activity-assignments`)
            .then(async (response) => {
              if (response.status === 401 || response.status === 403) {
                return;
              }
              const res = await response.json();
              if (res.success && res.data) {
                setModuleAssignments(prev => ({
                  ...prev,
                  activityAssignments: {
                    assignments: res.data.assignments || [],
                    stats: res.data.stats || prev.activityAssignments.stats
                  }
                }));
              }
            })
            .catch(() => {})
        );

        // 6. Today's work logs
        const today = new Date().toISOString().split('T')[0];
        promises.push(
          fetch(`/api/work-logs?start_date=${today}&end_date=${today}`)
            .then(async (response) => {
              if (response.status === 401 || response.status === 403) {
                setModuleAccess(prev => ({ ...prev, workLogs: false }));
                return;
              }
              const res = await response.json();
              if (res.success && res.data) {
                const totalHours = res.data.reduce((sum, log) => sum + (parseFloat(log.hours_worked) || 0), 0);
                setModuleAssignments(prev => ({
                  ...prev,
                  recentWorkLogs: res.data.slice(0, 5),
                  todayWorkHours: Math.round(totalHours * 10) / 10
                }));
              }
            })
            .catch(() => setModuleAccess(prev => ({ ...prev, workLogs: false })))
        );

        await Promise.all(promises);
        setLoading(false);
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
        setLoading(false);
      }
    };

    loadData();
  }, [user?.id]);

  const generateAnalysisData = (data) => {
    const { projects, stats } = data;
    
    // Status distribution
    const statusCounts = {
      'Completed': 0,
      'In Progress': 0,
      'Not Started': 0,
      'On Hold': 0
    };
    
    projects.forEach(project => {
      project.activities.forEach(activity => {
        const status = activity.status || 'Not Started';
        if (statusCounts[status] !== undefined) statusCounts[status]++;
      });
    });

    const statusDistribution = [
      { name: 'Completed', value: statusCounts['Completed'], color: '#22c55e' },
      { name: 'In Progress', value: statusCounts['In Progress'], color: '#3b82f6' },
      { name: 'Not Started', value: statusCounts['Not Started'], color: '#9ca3af' },
      { name: 'On Hold', value: statusCounts['On Hold'], color: '#f59e0b' }
    ].filter(s => s.value > 0);

    // Generate productivity trend (last 5 months)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentMonth = new Date().getMonth();
    const productivityTrend = [];
    
    for (let i = 4; i >= 0; i--) {
      const monthIndex = (currentMonth - i + 12) % 12;
      const baseHours = stats.totalAssignedHours / 5 || 40;
      productivityTrend.push({
        month: months[monthIndex],
        assigned: Math.round(baseHours + Math.random() * 20 - 10),
        actual: Math.round(baseHours * 0.9 + Math.random() * 15 - 5)
      });
    }

    setAnalysisData({
      productivityTrend,
      statusDistribution,
      priorityDistribution: []
    });
  };

  const formatTime = (time) => {
    if (!time) return '--:--';
    if (typeof time === 'string' && time.includes(':')) {
      const [hours, minutes] = time.split(':');
      const h = parseInt(hours);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${minutes} ${ampm}`;
    }
    return time;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <Sidebar />
        <div className="flex flex-1 pt-16">
          <div className="todo-panel">
            <TodoList />
          </div>
          <div className="flex-1 flex items-center justify-center ml-72">
            <div className="text-gray-500">Loading dashboard...</div>
          </div>
        </div>
      </div>
    );
  }

  const { stats } = projectsData;
  const efficiencyRate = stats.totalAssignedHours > 0 
    ? Math.round((stats.totalActualHours / stats.totalAssignedHours) * 100) 
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      <Sidebar />
      
      <div className="flex pt-16 sm:pl-16">
        {/* Todo List Panel */}
        <div className="todo-panel">
          <TodoList />
        </div>
        
        {/* Main Content */}
        <div className="flex-1 ml-72">
          <div className="px-4 sm:px-6 lg:px-8 py-6">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Welcome, {user?.full_name || 'User'}!</h1>
              <p className="text-gray-600 text-sm">{attendance.currentMonth}</p>
            </div>

            {/* Quick Actions & Alerts Bar */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {/* Total Assigned Tasks */}
              <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${moduleAssignments.activityAssignments.stats.totalAssignments > 0 ? 'bg-purple-100' : 'bg-gray-100'}`}>
                    <ClipboardDocumentListIcon className={`w-5 h-5 ${moduleAssignments.activityAssignments.stats.totalAssignments > 0 ? 'text-purple-600' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total Tasks</p>
                    <p className={`text-xl font-bold ${moduleAssignments.activityAssignments.stats.totalAssignments > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                      {moduleAssignments.activityAssignments.stats.totalAssignments}
                    </p>
                  </div>
                </div>
              </div>

              {/* In Progress Tasks */}
              <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${moduleAssignments.activityAssignments.stats.inProgressCount > 0 ? 'bg-blue-100' : 'bg-gray-100'}`}>
                    <ClockIcon className={`w-5 h-5 ${moduleAssignments.activityAssignments.stats.inProgressCount > 0 ? 'text-blue-600' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">In Progress</p>
                    <p className={`text-xl font-bold ${moduleAssignments.activityAssignments.stats.inProgressCount > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                      {moduleAssignments.activityAssignments.stats.inProgressCount}
                    </p>
                  </div>
                </div>
              </div>

              {/* Completed Tasks */}
              <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${moduleAssignments.activityAssignments.stats.completedCount > 0 ? 'bg-green-100' : 'bg-gray-100'}`}>
                    <CheckCircleIcon className={`w-5 h-5 ${moduleAssignments.activityAssignments.stats.completedCount > 0 ? 'text-green-600' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Completed</p>
                    <p className={`text-xl font-bold ${moduleAssignments.activityAssignments.stats.completedCount > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                      {moduleAssignments.activityAssignments.stats.completedCount}
                    </p>
                  </div>
                </div>
              </div>

              {/* Today's Work Hours - only show if user has access */}
              {moduleAccess.workLogs && (
                <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${moduleAssignments.todayWorkHours > 0 ? 'bg-orange-100' : 'bg-gray-100'}`}>
                      <DocumentTextIcon className={`w-5 h-5 ${moduleAssignments.todayWorkHours > 0 ? 'text-orange-600' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Today&apos;s Logged</p>
                      <p className={`text-xl font-bold ${moduleAssignments.todayWorkHours > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                        {moduleAssignments.todayWorkHours}h
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Upcoming Deadlines Details (if any) - only show if user has dashboard access */}
            {moduleAccess.dashboard && moduleAssignments.upcomingDeadlines.length > 0 && (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl shadow-sm border border-amber-200 p-4 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <BellIcon className="w-5 h-5 text-amber-600" />
                  <h3 className="font-semibold text-amber-800">Upcoming Deadlines (Next 7 Days)</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {moduleAssignments.upcomingDeadlines.slice(0, 6).map((deadline, idx) => (
                    <div key={idx} className="bg-white rounded-lg p-3 border border-amber-100">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{deadline.activity_name || deadline.title || 'Activity'}</p>
                          <p className="text-xs text-gray-500 truncate">{deadline.project_title || deadline.project_code || ''}</p>
                        </div>
                        <span className={`ml-2 px-2 py-0.5 text-xs font-medium rounded ${
                          deadline.days_remaining <= 1 ? 'bg-red-100 text-red-700' : 
                          deadline.days_remaining <= 3 ? 'bg-orange-100 text-orange-700' : 
                          'bg-green-100 text-green-700'
                        }`}>
                          {deadline.days_remaining === 0 ? 'Today' : 
                           deadline.days_remaining === 1 ? 'Tomorrow' : 
                           `${deadline.days_remaining} days`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Project Activity Assignments - NEW */}
            {user?.id && <ProjectActivityAssignments userId={user.id} />}

            {/* Row 1: Project-Based Stats Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
              {/* Assigned Projects Card - uses activityAssignments from JSON-based assignments */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <BriefcaseIcon className="w-5 h-5 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Assigned Projects</h3>
                </div>
                <div className="text-center mb-3">
                  <p className="text-3xl font-bold text-purple-600">
                    {moduleAssignments.activityAssignments.stats.totalProjects || moduleAssignments.activeProjects.length}
                  </p>
                  <p className="text-xs text-gray-500">Active Projects</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center p-2 bg-purple-50 rounded-lg">
                    <p className="text-lg font-bold text-purple-600">
                      {moduleAssignments.activityAssignments.stats.totalAssignments || moduleAssignments.activeProjects.reduce((sum, p) => sum + (p.total_activities || 0), 0)}
                    </p>
                    <p className="text-[10px] text-gray-600">Total Tasks</p>
                  </div>
                  <div className="text-center p-2 bg-red-50 rounded-lg">
                    <p className="text-lg font-bold text-red-600">
                      {moduleAssignments.activeProjects.reduce((sum, p) => sum + (p.overdue || 0), 0)}
                    </p>
                    <p className="text-[10px] text-gray-600">Overdue</p>
                  </div>
                </div>
              </div>

              {/* Manhours Card - uses activityAssignments data */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <ClockIcon className="w-5 h-5 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Manhours</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center p-2 bg-purple-50 rounded-lg">
                    <p className="text-lg font-bold text-purple-600">
                      {Math.round(moduleAssignments.activityAssignments.stats.totalPlannedHours || moduleAssignments.workloadSummary.total_estimated_hours || 0)}
                    </p>
                    <p className="text-[10px] text-gray-600">Planned</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-lg font-bold text-green-600">
                      {Math.round(moduleAssignments.activityAssignments.stats.totalActualHours || moduleAssignments.workloadSummary.total_actual_hours || 0)}
                    </p>
                    <p className="text-[10px] text-gray-600">Actual</p>
                  </div>
                </div>
                {(moduleAssignments.activityAssignments.stats.totalPlannedHours > 0 || moduleAssignments.workloadSummary.total_estimated_hours > 0) && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Progress</span>
                      <span>
                        {Math.round(((moduleAssignments.activityAssignments.stats.totalActualHours || moduleAssignments.workloadSummary.total_actual_hours || 0) / (moduleAssignments.activityAssignments.stats.totalPlannedHours || moduleAssignments.workloadSummary.total_estimated_hours || 1)) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-purple-500 rounded-full" 
                        style={{ 
                          width: `${Math.min(((moduleAssignments.activityAssignments.stats.totalActualHours || moduleAssignments.workloadSummary.total_actual_hours || 0) / (moduleAssignments.activityAssignments.stats.totalPlannedHours || moduleAssignments.workloadSummary.total_estimated_hours || 1)) * 100, 100)}%` 
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Task Status Card - uses activityAssignments stats */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <ClipboardDocumentListIcon className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Task Status</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-lg font-bold text-gray-600">
                      {moduleAssignments.activityAssignments.stats.notStartedCount || moduleAssignments.statusSummary.not_started}
                    </p>
                    <p className="text-[10px] text-gray-600">Not Started</p>
                  </div>
                  <div className="text-center p-2 bg-blue-50 rounded-lg">
                    <p className="text-lg font-bold text-blue-600">
                      {moduleAssignments.activityAssignments.stats.inProgressCount || moduleAssignments.statusSummary.in_progress}
                    </p>
                    <p className="text-[10px] text-gray-600">In Progress</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-lg font-bold text-green-600">
                      {moduleAssignments.activityAssignments.stats.completedCount || moduleAssignments.statusSummary.completed}
                    </p>
                    <p className="text-[10px] text-gray-600">Completed</p>
                  </div>
                  <div className="text-center p-2 bg-yellow-50 rounded-lg">
                    <p className="text-lg font-bold text-yellow-600">
                      {moduleAssignments.activityAssignments.stats.onHoldCount || moduleAssignments.statusSummary.on_hold}
                    </p>
                    <p className="text-[10px] text-gray-600">On Hold</p>
                  </div>
                </div>
              </div>

              {/* Quantity Progress Card - uses activityAssignments qty data */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <CheckCircleIcon className="w-5 h-5 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Quantity Progress</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center p-2 bg-purple-50 rounded-lg">
                    <p className="text-lg font-bold text-purple-600">
                      {Math.round(moduleAssignments.activityAssignments.stats.totalQtyAssigned || 0)}
                    </p>
                    <p className="text-[10px] text-gray-600">Qty Assigned</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-lg font-bold text-green-600">
                      {Math.round(moduleAssignments.activityAssignments.stats.totalQtyCompleted || 0)}
                    </p>
                    <p className="text-[10px] text-gray-600">Qty Completed</p>
                  </div>
                </div>
                {moduleAssignments.activityAssignments.stats.totalQtyAssigned > 0 && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Completion</span>
                      <span>
                        {Math.round((moduleAssignments.activityAssignments.stats.totalQtyCompleted / moduleAssignments.activityAssignments.stats.totalQtyAssigned) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-green-500 rounded-full" 
                        style={{ 
                          width: `${Math.min((moduleAssignments.activityAssignments.stats.totalQtyCompleted / moduleAssignments.activityAssignments.stats.totalQtyAssigned) * 100, 100)}%` 
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Row 2: Time & Attendance Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              {/* In Time / Out Time Card */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <ClockIcon className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Today&apos;s Time</h3>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-600 mb-1">In Time</p>
                    <p className="text-lg font-bold text-green-600">{formatTime(attendance.inTime)}</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-600 mb-1">Out Time</p>
                    <p className="text-lg font-bold text-orange-600">{formatTime(attendance.outTime)}</p>
                  </div>
                </div>
              </div>

              {/* Monthly Attendance Card */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <CalendarDaysIcon className="w-5 h-5 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Attendance</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 bg-blue-50 rounded-lg">
                    <p className="text-lg font-bold text-blue-600">{attendance.daysPresent}</p>
                    <p className="text-[10px] text-gray-600">Present</p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-lg font-bold text-gray-600">{attendance.weeklyOff}</p>
                    <p className="text-[10px] text-gray-600">Week Off</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-lg font-bold text-green-600">{attendance.holidays}</p>
                    <p className="text-[10px] text-gray-600">Holiday</p>
                  </div>
                </div>
              </div>

              {/* Leaves Card */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <UserIcon className="w-5 h-5 text-yellow-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Leaves</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 bg-blue-50 rounded-lg">
                    <p className="text-lg font-bold text-blue-600">{attendance.leaves.total}</p>
                    <p className="text-[10px] text-gray-600">Total</p>
                  </div>
                  <div className="text-center p-2 bg-red-50 rounded-lg">
                    <p className="text-lg font-bold text-red-600">{attendance.leaves.used}</p>
                    <p className="text-[10px] text-gray-600">Used</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-lg font-bold text-green-600">{attendance.leaves.balance}</p>
                    <p className="text-[10px] text-gray-600">Balance</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 3: Analysis Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Productivity Trend Chart */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <ArrowTrendingUpIcon className="w-4 h-4 text-indigo-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Manhours Trend</h3>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={analysisData.productivityTrend}>
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="assigned" fill="#f97316" name="Assigned" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="actual" fill="#3b82f6" name="Actual" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Status Distribution Chart */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <ChartBarIcon className="w-4 h-4 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Activity Status</h3>
                </div>
                {analysisData.statusDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={analysisData.statusDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={65}
                        dataKey="value"
                        paddingAngle={2}
                      >
                        {analysisData.statusDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `${value} activities`} />
                      <Legend 
                        wrapperStyle={{ fontSize: '11px' }}
                        formatter={(value) => <span className="text-gray-600">{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">
                    No activity data
                  </div>
                )}
              </div>

              {/* Efficiency Card */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                    <CheckCircleIcon className="w-4 h-4 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Performance</h3>
                </div>
                
                {/* Efficiency Meter */}
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">Efficiency Rate</span>
                    <span className={`text-lg font-bold ${
                      efficiencyRate <= 100 ? 'text-green-600' : 'text-orange-600'
                    }`}>{efficiencyRate}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                      className={`h-3 rounded-full transition-all ${
                        efficiencyRate <= 100 ? 'bg-green-500' : 'bg-orange-500'
                      }`}
                      style={{ width: `${Math.min(efficiencyRate, 100)}%` }}
                    ></div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 bg-orange-50 rounded-lg">
                    <p className="text-xl font-bold text-orange-600">{stats.totalAssignedHours}</p>
                    <p className="text-[10px] text-gray-600">Assigned Hours</p>
                  </div>
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <p className="text-xl font-bold text-blue-600">{stats.totalActualHours}</p>
                    <p className="text-[10px] text-gray-600">Actual Hours</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <p className="text-xl font-bold text-green-600">{stats.completedActivities}</p>
                    <p className="text-[10px] text-gray-600">Completed</p>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg">
                    <p className="text-xl font-bold text-red-600">
                      {stats.totalActivities - stats.completedActivities - stats.inProgressActivities}
                    </p>
                    <p className="text-[10px] text-gray-600">Pending</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
