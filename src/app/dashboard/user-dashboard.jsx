'use client';

import React from 'react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import TodoList from '@/components/TodoList';
import ProjectActivityAssignments from '@/components/ProjectActivityAssignments';
import { useState, useEffect } from 'react';
import { fetchJSON } from '@/utils/http';
import { useSessionRBAC } from '@/utils/client-rbac';
import Link from 'next/link';
import { 
  ClockIcon, 
  CheckCircleIcon,
  BellIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  TicketIcon,
  PlusIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';

export default function UserDashboard({ verifiedUser }) {
  // Use verifiedUser prop if available, otherwise fall back to context
  const { user: contextUser } = useSessionRBAC();
  const user = verifiedUser || contextUser;
  const [loading, setLoading] = useState(true);
  const [statsReady, setStatsReady] = useState(false);
  
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

  // New: User module assignments data
  const [moduleAssignments, setModuleAssignments] = useState({
    unreadMessages: 0,
    pendingTodos: 0,
    highPriorityTodos: 0,
    upcomingDeadlines: [],
    overdueActivities: 0,
    recentWorkLogs: [],
    todayWorkHours: 0,
    // Tickets data
    tickets: [],
    ticketStats: {
      total: 0,
      open: 0,
      resolved: 0,
      waitingForYou: 0
    },
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
    // Use verifiedUser first (passed from parent after auth check), then contextUser
    const userId = verifiedUser?.id || user?.id;
    if (!userId) {
      console.log('UserDashboard: No user ID available yet');
      return;
    }
    
    console.log('UserDashboard: Loading data for user:', userId);
    
    const loadData = async () => {
      setLoading(true);
      try {
        // Load all data in parallel for efficiency
        const promises = [];

        // 2. Attendance data for header
        promises.push(
          fetchJSON(`/api/users/${userId}/attendance`)
            .then(res => {
              if (res.success) setAttendance(res.data);
            })
            .catch(() => {})
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

        // 5. Activity assignments - single fetch, used for both stats cards and activity table
        promises.push(
          fetch(`/api/users/${userId}/activity-assignments`, { cache: 'no-store' })
            .then(async (response) => {
              if (response.status === 401 || response.status === 403) return;
              const res = await response.json();
              if (res.success && res.data) {
                setModuleAssignments(prev => ({
                  ...prev,
                  activityAssignments: {
                    assignments: res.data.assignments || [],
                    stats: res.data.stats || prev.activityAssignments.stats
                  }
                }));
                setStatsReady(true);
              }
            })
            .catch((err) => console.error('Activity assignments fetch error:', err))
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

        // 7. Support tickets
        promises.push(
          fetch('/api/tickets')
            .then(async (response) => {
              if (response.status === 401 || response.status === 403) return;
              const res = await response.json();
              if (res.success && res.data) {
                const tickets = res.data;
                const stats = {
                  total: tickets.length,
                  open: tickets.filter(t => ['new', 'under_review', 'in_progress'].includes(t.status)).length,
                  resolved: tickets.filter(t => ['resolved', 'closed'].includes(t.status)).length,
                  waitingForYou: tickets.filter(t => t.status === 'waiting_for_employee').length
                };
                setModuleAssignments(prev => ({
                  ...prev,
                  tickets: tickets,
                  ticketStats: stats
                }));
              }
            })
            .catch((err) => console.error('Tickets fetch error:', err))
        );

        await Promise.all(promises);
        setLoading(false);
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
        setLoading(false);
      }
    };

    loadData();
  }, [verifiedUser?.id, user?.id]);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="flex pt-16 sm:pl-16">
        {/* Todo List Panel */}
        <div className="todo-panel">
          <TodoList />
        </div>
        
        {/* Main Content */}
        <div className="flex-1 ml-72">
          <div className="px-6 py-6">
            {/* Header */}
            <div className="mb-6">
              <nav className="text-xs text-gray-500 mb-1" aria-label="Breadcrumb">
                <ol className="inline-flex items-center gap-2">
                  <li>Home</li>
                  <li className="text-gray-300">/</li>
                  <li className="text-gray-700">Dashboard</li>
                </ol>
              </nav>
              <h1 className="text-3xl font-bold text-gray-900">Welcome, {user?.full_name || 'User'}!</h1>
              <p className="text-sm text-gray-500 mt-1">{attendance.currentMonth}</p>
            </div>

            {/* Quick Actions & Alerts Bar */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
              {/* Total Assigned Tasks */}
              <div className="bg-white rounded-xl border border-purple-200 p-5 hover:border-purple-400 hover:shadow-md transition-all">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${moduleAssignments.activityAssignments.stats.totalAssignments > 0 ? 'bg-white border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
                    <ClipboardDocumentListIcon className={`h-5 w-5 ${moduleAssignments.activityAssignments.stats.totalAssignments > 0 ? 'text-[#64126D]' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 tracking-wider uppercase">Total Tasks</p>
                    <p className={`text-2xl font-bold ${moduleAssignments.activityAssignments.stats.totalAssignments > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                      {moduleAssignments.activityAssignments.stats.totalAssignments}
                    </p>
                  </div>
                </div>
              </div>

              {/* In Progress Tasks */}
              <div className="bg-white rounded-xl border border-purple-200 p-5 hover:border-purple-400 hover:shadow-md transition-all">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${moduleAssignments.activityAssignments.stats.inProgressCount > 0 ? 'bg-white border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
                    <ClockIcon className={`h-5 w-5 ${moduleAssignments.activityAssignments.stats.inProgressCount > 0 ? 'text-[#64126D]' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 tracking-wider uppercase">In Progress</p>
                    <p className={`text-2xl font-bold ${moduleAssignments.activityAssignments.stats.inProgressCount > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                      {moduleAssignments.activityAssignments.stats.inProgressCount}
                    </p>
                  </div>
                </div>
              </div>

              {/* Completed Tasks */}
              <div className="bg-white rounded-xl border border-purple-200 p-5 hover:border-purple-400 hover:shadow-md transition-all">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${moduleAssignments.activityAssignments.stats.completedCount > 0 ? 'bg-white border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
                    <CheckCircleIcon className={`h-5 w-5 ${moduleAssignments.activityAssignments.stats.completedCount > 0 ? 'text-[#64126D]' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 tracking-wider uppercase">Completed</p>
                    <p className={`text-2xl font-bold ${moduleAssignments.activityAssignments.stats.completedCount > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                      {moduleAssignments.activityAssignments.stats.completedCount}
                    </p>
                  </div>
                </div>
              </div>

              {/* Today's Work Hours - only show if user has access */}
              {moduleAccess.workLogs && (
                <div className="bg-white rounded-xl border border-purple-200 p-5 hover:border-purple-400 hover:shadow-md transition-all">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${moduleAssignments.todayWorkHours > 0 ? 'bg-white border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
                      <DocumentTextIcon className={`h-5 w-5 ${moduleAssignments.todayWorkHours > 0 ? 'text-[#64126D]' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 tracking-wider uppercase">Today&apos;s Logged</p>
                      <p className={`text-2xl font-bold ${moduleAssignments.todayWorkHours > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
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

            {/* Project Activity Assignments - Pass preloaded data to avoid duplicate fetch */}
            {user?.id && <ProjectActivityAssignments userId={user.id} preloadedData={statsReady ? moduleAssignments.activityAssignments : null} />}

            {/* Support Tickets Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
              <div className="p-5 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <TicketIcon className="h-6 w-6 text-[#64126D]" />
                    <h2 className="text-lg font-semibold text-gray-900">Support Tickets</h2>
                    {moduleAssignments.ticketStats.waitingForYou > 0 && (
                      <span className="px-2 py-0.5 text-xs font-semibold bg-orange-100 text-orange-700 rounded-full animate-pulse">
                        {moduleAssignments.ticketStats.waitingForYou} waiting for you
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href="/tickets/new"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#64126D] text-white text-sm font-medium rounded-lg hover:bg-[#7a1785] transition-colors"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Raise Ticket
                    </Link>
                    <Link
                      href="/tickets"
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      View All
                      <ArrowRightIcon className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
                
                {/* Quick Stats */}
                <div className="flex items-center gap-6 mt-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span className="text-sm text-gray-600">Open: <strong className="text-gray-900">{moduleAssignments.ticketStats.open}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    <span className="text-sm text-gray-600">Resolved: <strong className="text-gray-900">{moduleAssignments.ticketStats.resolved}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                    <span className="text-sm text-gray-600">Total: <strong className="text-gray-900">{moduleAssignments.ticketStats.total}</strong></span>
                  </div>
                </div>
              </div>
              
              {/* Recent/Active Tickets List */}
              <div className="p-5">
                {moduleAssignments.tickets.length === 0 ? (
                  <div className="text-center py-8">
                    <TicketIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 mb-3">No tickets yet</p>
                    <Link
                      href="/tickets/new"
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#64126D] text-white text-sm font-medium rounded-lg hover:bg-[#7a1785] transition-colors"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Create Your First Ticket
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {moduleAssignments.tickets
                      .filter(t => !['closed'].includes(t.status))
                      .slice(0, 5)
                      .map((ticket) => (
                        <Link
                          key={ticket.id}
                          href={`/tickets/${ticket.id}`}
                          className="block p-4 border border-gray-200 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-mono text-gray-500">{ticket.ticket_number}</span>
                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                  ticket.status === 'new' ? 'bg-blue-100 text-blue-700' :
                                  ticket.status === 'under_review' ? 'bg-purple-100 text-purple-700' :
                                  ticket.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                                  ticket.status === 'waiting_for_employee' ? 'bg-orange-100 text-orange-700' :
                                  ticket.status === 'resolved' ? 'bg-green-100 text-green-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {ticket.status === 'waiting_for_employee' ? '⏳ Waiting for You' :
                                   ticket.status === 'new' ? '🆕 New' :
                                   ticket.status === 'under_review' ? '👀 Under Review' :
                                   ticket.status === 'in_progress' ? '⚡ In Progress' :
                                   ticket.status === 'resolved' ? '✅ Resolved' :
                                   ticket.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                </span>
                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${
                                  ticket.priority === 'urgent' ? 'bg-red-50 text-red-700 border-red-200' :
                                  ticket.priority === 'high' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                  ticket.priority === 'medium' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                  'bg-gray-50 text-gray-700 border-gray-200'
                                }`}>
                                  {ticket.priority}
                                </span>
                              </div>
                              <p className="text-sm font-medium text-gray-900 truncate">{ticket.subject}</p>
                              <p className="text-xs text-gray-500 mt-1 truncate">{ticket.description}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs text-gray-400">
                                {new Date(ticket.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                → {ticket.routed_to?.toUpperCase()}
                              </p>
                            </div>
                          </div>
                        </Link>
                      ))}
                    
                    {moduleAssignments.tickets.filter(t => !['closed'].includes(t.status)).length > 5 && (
                      <Link
                        href="/tickets"
                        className="block text-center py-2 text-sm text-[#64126D] hover:text-[#7a1785] font-medium"
                      >
                        View all {moduleAssignments.tickets.filter(t => !['closed'].includes(t.status)).length} active tickets →
                      </Link>
                    )}
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

