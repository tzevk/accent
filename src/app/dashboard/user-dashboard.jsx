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
  ArrowRightIcon,
  ArrowLeftStartOnRectangleIcon,
  ArrowRightStartOnRectangleIcon,
  CalendarDaysIcon,
  CalendarIcon,
  FireIcon,
  ExclamationTriangleIcon,
  ComputerDesktopIcon
} from '@heroicons/react/24/outline';
import { useIdleMonitor } from '@/hooks/useIdleMonitor';

export default function UserDashboard({ verifiedUser }) {
  // Use verifiedUser prop if available, otherwise fall back to context
  const { user: contextUser } = useSessionRBAC();
  const user = verifiedUser || contextUser;
  const [loading, setLoading] = useState(true);
  const [statsReady, setStatsReady] = useState(false);
  const [todoPanelOpen, setTodoPanelOpen] = useState(false);

  // Sync todoPanelOpen from localStorage on mount & listen for sidebar toggle
  useEffect(() => {
    try {
      if (localStorage.getItem('todoPanelOpen') === 'true') setTodoPanelOpen(true);
    } catch {}
    const handler = (e) => setTodoPanelOpen(e.detail?.open ?? false);
    window.addEventListener('toggleTodoPanel', handler);
    return () => window.removeEventListener('toggleTodoPanel', handler);
  }, []);

  // Idle monitoring - tracks mouse/keyboard interaction
  const { idleSeconds, isIdle, dismiss, dismissed, handleActivity } = useIdleMonitor();

  // Live clock
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Attendance & Time data
  const [attendance, setAttendance] = useState({
    inTime: null,
    outTime: null,
    loginTime: null,
    logoutTime: null,
    currentMonth: '',
    daysInMonth: 0,
    daysPresent: 0,
    weeklyOff: 0,
    holidays: 0,
    overtimeHours: 0,
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
        <div className="flex flex-1 pt-16">
          {todoPanelOpen && (
            <div className="todo-panel">
              <TodoList />
            </div>
          )}
          <div className={`flex-1 flex items-center justify-center ${todoPanelOpen ? 'ml-72' : 'ml-0'}`}>
            <div className="text-gray-500">Loading dashboard...</div>
          </div>
        </div>
      </div>
    );
  }

  // Format idle duration for display
  const formatIdleDuration = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />

      {/* Idle Warning Modal Popup */}
      {isIdle && !dismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="idle-warning-title">
          <div className="mx-4 max-w-md w-full bg-white rounded-2xl shadow-2xl overflow-hidden animate-[scaleIn_0.25s_ease-out]">
            {/* Amber header stripe */}
            <div className="bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-white/25 flex items-center justify-center shrink-0">
                <ExclamationTriangleIcon className="h-7 w-7 text-white" />
              </div>
              <h2 id="idle-warning-title" className="text-lg font-bold text-white">Idle Warning</h2>
            </div>

            {/* Body */}
            <div className="px-5 py-4">
              <p className="text-base font-semibold text-gray-800">
                You&apos;ve been idle for {formatIdleDuration(idleSeconds)}
              </p>
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                No mouse movement or keyboard activity has been detected. Your idle time is being logged and may affect your productivity report.
              </p>

              {/* Live idle timer */}
              <div className="mt-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <ClockIcon className="h-5 w-5 text-amber-600 shrink-0 animate-pulse" />
                <div>
                  <p className="text-xs font-medium text-amber-700">Current idle duration</p>
                  <p className="text-lg font-bold text-amber-800 tabular-nums">{formatIdleDuration(idleSeconds)}</p>
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={dismiss}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-amber-700 bg-amber-100 rounded-lg hover:bg-amber-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2"
              >
                Dismiss
              </button>
              <button
                onClick={() => { dismiss(); handleActivity?.(); }}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                I&apos;m Back
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex pt-4 sm:pl-0">
        {/* Todo List Panel - toggled from sidebar */}
        {todoPanelOpen && (
          <div className="todo-panel">
            <TodoList />
          </div>
        )}
        
        {/* Main Content */}
        <div className={`flex-1 transition-[margin] duration-200 ${todoPanelOpen ? 'ml-72' : 'ml-0'}`}>
          <div className="px-2 sm:px-3 lg:px-4 py-2 max-w-[1920px] mx-auto">
            <div className="bg-white/60 backdrop-blur-sm rounded-2xl border border-gray-200/60 shadow-sm p-2 sm:p-3 space-y-3">
            {/* Hero Header — Aesthetic-Usability + Peak-End Rule */}
            <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-[#64126D] via-[#7a1785] to-[#9333ea] px-4 py-2 shadow-md" style={{perspective: '800px', transformStyle: 'preserve-3d'}}>
              {/* Decorative bg shapes — 3D floating blobs */}
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/[0.07] blur-sm animate-[blobFloat1_8s_ease-in-out_infinite]" style={{transform: 'translateZ(20px)'}} />
              <div className="absolute -bottom-12 -left-8 w-28 h-28 rounded-full bg-white/[0.06] blur-sm animate-[blobFloat2_10s_ease-in-out_infinite]" style={{transform: 'translateZ(15px)'}} />
              <div className="absolute top-1/2 right-1/4 w-16 h-16 rounded-full bg-purple-300/10 blur-[2px] animate-[blobFloat3_12s_ease-in-out_infinite]" style={{transform: 'translateZ(30px)'}} />
              <div className="absolute -top-4 left-1/3 w-20 h-20 rounded-full bg-pink-300/[0.07] blur-sm animate-[blobFloat4_9s_ease-in-out_infinite]" style={{transform: 'translateZ(25px)'}} />
              <div className="relative flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <nav className="text-[10px] text-white/60 mb-0.5" aria-label="Breadcrumb">
                    <ol className="inline-flex items-center gap-1">
                      <li>Home</li>
                      <li className="text-white/30">/</li>
                      <li className="text-white/90 font-medium">Dashboard</li>
                    </ol>
                  </nav>
                  <h1 className="text-base sm:text-lg font-bold text-white leading-tight tracking-tight">Good {currentTime.getHours() < 12 ? 'Morning' : currentTime.getHours() < 17 ? 'Afternoon' : 'Evening'}, {user?.full_name?.split(' ')[0] || 'User'}</h1>
                  <p className="text-[10px] text-white/70">{currentTime.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Analog Clock */}
                  {(() => {
                    const h = currentTime.getHours() % 12;
                    const m = currentTime.getMinutes();
                    const s = currentTime.getSeconds();
                    const hDeg = h * 30 + m * 0.5;
                    const mDeg = m * 6 + s * 0.1;
                    const sDeg = s * 6;
                    return (
                      <div className="relative flex items-center gap-1" title={currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}>
                        <svg width="40" height="40" viewBox="0 0 52 52" className="drop-shadow-sm">
                          {/* Face */}
                          <circle cx="26" cy="26" r="25" fill="white" stroke="#7e22ce" strokeWidth="1.5" />
                          {/* Hour markers */}
                          {[...Array(12)].map((_, i) => {
                            const angle = (i * 30 - 90) * (Math.PI / 180);
                            const isMain = i % 3 === 0;
                            const outer = 22;
                            const inner = isMain ? 18 : 19.5;
                            return (
                              <line
                                key={i}
                                x1={26 + inner * Math.cos(angle)}
                                y1={26 + inner * Math.sin(angle)}
                                x2={26 + outer * Math.cos(angle)}
                                y2={26 + outer * Math.sin(angle)}
                                stroke={isMain ? '#581c87' : '#a855f7'}
                                strokeWidth={isMain ? 1.5 : 0.8}
                                strokeLinecap="round"
                              />
                            );
                          })}
                          {/* Hour hand */}
                          <line
                            x1="26" y1="26"
                            x2={26 + 12 * Math.cos((hDeg - 90) * Math.PI / 180)}
                            y2={26 + 12 * Math.sin((hDeg - 90) * Math.PI / 180)}
                            stroke="#581c87" strokeWidth="2" strokeLinecap="round"
                          />
                          {/* Minute hand */}
                          <line
                            x1="26" y1="26"
                            x2={26 + 17 * Math.cos((mDeg - 90) * Math.PI / 180)}
                            y2={26 + 17 * Math.sin((mDeg - 90) * Math.PI / 180)}
                            stroke="#7e22ce" strokeWidth="1.5" strokeLinecap="round"
                          />
                          {/* Second hand */}
                          <line
                            x1="26" y1="26"
                            x2={26 + 19 * Math.cos((sDeg - 90) * Math.PI / 180)}
                            y2={26 + 19 * Math.sin((sDeg - 90) * Math.PI / 180)}
                            stroke="#ef4444" strokeWidth="0.7" strokeLinecap="round"
                          />
                          {/* Center dot */}
                          <circle cx="26" cy="26" r="1.5" fill="#581c87" />
                        </svg>
                      </div>
                    );
                  })()}
                  {/* Live idle indicator */}
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold backdrop-blur-sm transition-colors duration-200 ${
                    idleSeconds > 60
                      ? 'bg-red-500/20 text-red-100 ring-1 ring-red-400/30'
                      : idleSeconds > 30
                        ? 'bg-amber-500/20 text-amber-100 ring-1 ring-amber-400/30'
                        : 'bg-white/15 text-white/90 ring-1 ring-white/20'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${
                      idleSeconds > 60 ? 'bg-red-400 animate-pulse' : idleSeconds > 30 ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                    }`} />
                    {idleSeconds > 30 ? `Idle: ${formatIdleDuration(idleSeconds)}` : 'Active'}
                  </div>
                </div>
              </div>
            </div>

            {/* Attendance — Law of Common Region + Proximity */}
            <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm p-2">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-0.5 h-3 rounded-full bg-gradient-to-b from-[#64126D] to-[#9333ea]"></div>
                <h2 className="text-[10px] font-semibold text-gray-800 tracking-wide uppercase">Today&apos;s Attendance</h2>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
                {/* In Time */}
                <div className="group relative rounded-lg border border-gray-100 bg-gradient-to-br from-white to-green-50/40 p-1.5 hover:shadow-sm hover:border-green-300 transition-all duration-200">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors duration-200 ${attendance.inTime ? 'bg-green-100 text-green-600 group-hover:bg-green-200' : 'bg-gray-100 text-gray-400'}`}>
                      <ArrowRightStartOnRectangleIcon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider leading-none">In Time</p>
                      <p className={`text-xs font-bold leading-tight ${attendance.inTime ? 'text-gray-900' : 'text-gray-300'}`}>
                        {formatTime(attendance.inTime)}
                      </p>
                      {attendance.loginTime && (
                        <p className="text-[10px] text-green-600 mt-0.5 font-medium">Login {formatTime(attendance.loginTime)}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Out Time */}
                <div className="group relative rounded-lg border border-gray-100 bg-gradient-to-br from-white to-red-50/40 p-1.5 hover:shadow-sm hover:border-red-300 transition-all duration-200">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors duration-200 ${attendance.outTime ? 'bg-red-100 text-red-600 group-hover:bg-red-200' : 'bg-gray-100 text-gray-400'}`}>
                      <ArrowLeftStartOnRectangleIcon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider leading-none">Out Time</p>
                      <p className={`text-xs font-bold leading-tight ${attendance.outTime ? 'text-gray-900' : 'text-gray-300'}`}>
                        {formatTime(attendance.outTime)}
                      </p>
                      {attendance.logoutTime && (
                        <p className="text-[10px] text-red-600 mt-0.5 font-medium">Logout {formatTime(attendance.logoutTime)}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Present Days */}
                <div className="group relative rounded-lg border border-gray-100 bg-gradient-to-br from-white to-blue-50/40 p-1.5 hover:shadow-sm hover:border-blue-300 transition-all duration-200">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors duration-200 ${attendance.daysPresent > 0 ? 'bg-blue-100 text-blue-600 group-hover:bg-blue-200' : 'bg-gray-100 text-gray-400'}`}>
                      <CalendarDaysIcon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider leading-none">Present</p>
                      <p className={`text-sm font-bold leading-tight ${attendance.daysPresent > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                        {attendance.daysPresent}<span className="text-xs font-normal text-gray-400">/{attendance.daysInMonth}</span>
                      </p>
                    </div>
                  </div>
                  {/* Mini progress bar (Aesthetic-Usability) */}
                  {attendance.daysInMonth > 0 && (
                    <div className="mt-1 h-0.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.round((attendance.daysPresent / attendance.daysInMonth) * 100)}%` }} />
                    </div>
                  )}
                </div>

                {/* Leave Days */}
                <div className="group relative rounded-lg border border-gray-100 bg-gradient-to-br from-white to-amber-50/40 p-1.5 hover:shadow-sm hover:border-amber-300 transition-all duration-200">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors duration-200 ${attendance.leaves.used > 0 ? 'bg-amber-100 text-amber-600 group-hover:bg-amber-200' : 'bg-gray-100 text-gray-400'}`}>
                      <CalendarIcon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider leading-none">Leaves</p>
                      <p className={`text-sm font-bold leading-tight ${attendance.leaves.used > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                        {attendance.leaves.used}<span className="text-xs font-normal text-gray-400">/{attendance.leaves.total}</span>
                      </p>
                    </div>
                  </div>
                  <p className="text-[9px] text-amber-600 font-medium mt-0.5">{attendance.leaves.balance} remaining</p>
                </div>

                {/* Overtime */}
                <div className="group relative rounded-lg border border-gray-100 bg-gradient-to-br from-white to-orange-50/40 p-1.5 hover:shadow-sm hover:border-orange-300 transition-all duration-200">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors duration-200 ${attendance.overtimeHours > 0 ? 'bg-orange-100 text-orange-600 group-hover:bg-orange-200' : 'bg-gray-100 text-gray-400'}`}>
                      <FireIcon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider leading-none">Overtime</p>
                      <p className={`text-sm font-bold leading-tight ${attendance.overtimeHours > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                        {attendance.overtimeHours}<span className="text-xs font-normal text-gray-400">h</span>
                      </p>
                      <p className="text-[9px] text-gray-400">this month</p>
                    </div>
                  </div>
                </div>

                {/* Idle Time (Live) — Von Restorff: stands out when high */}
                <div className={`group relative rounded-lg border p-1.5 hover:shadow-sm transition-all duration-200 ${
                  idleSeconds > 1800 ? 'border-red-200 bg-gradient-to-br from-red-50/80 to-red-100/50 ring-1 ring-red-100' : idleSeconds > 300 ? 'border-amber-200 bg-gradient-to-br from-white to-amber-50/40' : 'border-gray-100 bg-gradient-to-br from-white to-emerald-50/40'
                }`}>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors duration-200 ${
                      idleSeconds > 1800 ? 'bg-red-100 text-red-600' : idleSeconds > 300 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
                    }`}>
                      <ComputerDesktopIcon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider leading-none">Idle</p>
                      <p className={`text-xs font-bold leading-tight ${
                        idleSeconds > 1800 ? 'text-red-700' : idleSeconds > 300 ? 'text-amber-700' : 'text-emerald-700'
                      }`}>
                        {formatIdleDuration(idleSeconds)}
                      </p>
                      <p className="text-[9px] text-gray-400">{idleSeconds > 1800 ? 'action needed' : idleSeconds > 300 ? 'getting idle' : 'all good'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Activity Overview — Miller's Law: chunked into 4 digestible KPIs */}
            <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm p-2">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-0.5 h-3 rounded-full bg-gradient-to-b from-[#64126D] to-[#9333ea]"></div>
                <h2 className="text-[10px] font-semibold text-gray-800 tracking-wide uppercase">Activity Overview</h2>
              </div>
              {(() => {
                const stats = moduleAssignments.activityAssignments.stats;
                const completionPct = stats.totalAssignments > 0 ? Math.round((stats.completedCount / stats.totalAssignments) * 100) : 0;
                return (
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {/* Total Tasks */}
                    <div className="group rounded-lg border border-gray-100 bg-gradient-to-br from-purple-50/60 to-white p-1.5 hover:shadow-sm hover:border-purple-300 transition-all duration-200">
                      <div className="flex items-center justify-between">
                        <div className="w-6 h-6 rounded bg-purple-100 text-[#64126D] flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                          <ClipboardDocumentListIcon className="h-3 w-3" />
                        </div>
                        <p className="text-base font-bold text-gray-900">{stats.totalAssignments}</p>
                      </div>
                      <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider mt-1">Total Tasks</p>
                    </div>
                    {/* In Progress */}
                    <div className="group rounded-lg border border-gray-100 bg-gradient-to-br from-blue-50/60 to-white p-1.5 hover:shadow-sm hover:border-blue-300 transition-all duration-200">
                      <div className="flex items-center justify-between">
                        <div className="w-6 h-6 rounded bg-blue-100 text-blue-600 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                          <ClockIcon className="h-3 w-3" />
                        </div>
                        <p className="text-base font-bold text-gray-900">{stats.inProgressCount}</p>
                      </div>
                      <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider mt-1">In Progress</p>
                    </div>
                    {/* Completed — with progress ring (Aesthetic-Usability) */}
                    <div className="group rounded-lg border border-gray-100 bg-gradient-to-br from-emerald-50/60 to-white p-1.5 hover:shadow-sm hover:border-emerald-300 transition-all duration-200">
                      <div className="flex items-center justify-between">
                        <div className="relative w-6 h-6">
                          <svg viewBox="0 0 36 36" className="w-6 h-6 -rotate-90">
                            <circle cx="18" cy="18" r="15" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                            <circle cx="18" cy="18" r="15" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${completionPct * 0.942} 100`} className="transition-all duration-700" />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-emerald-700">{completionPct}%</span>
                        </div>
                        <p className="text-base font-bold text-gray-900">{stats.completedCount}</p>
                      </div>
                      <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider mt-1">Completed</p>
                    </div>
                    {/* Today's Logged */}
                    {moduleAccess.workLogs && (
                      <div className="group rounded-lg border border-gray-100 bg-gradient-to-br from-violet-50/60 to-white p-1.5 hover:shadow-sm hover:border-violet-300 transition-all duration-200">
                        <div className="flex items-center justify-between">
                          <div className="w-6 h-6 rounded bg-violet-100 text-violet-600 flex items-center justify-center group-hover:bg-violet-200 transition-colors">
                            <DocumentTextIcon className="h-3 w-3" />
                          </div>
                          <p className="text-base font-bold text-gray-900">{moduleAssignments.todayWorkHours}<span className="text-xs font-semibold text-gray-400">h</span></p>
                        </div>
                        <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider mt-1">Today&apos;s Logged</p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Upcoming Deadlines — Von Restorff: visually distinct warning section */}
            {moduleAccess.dashboard && moduleAssignments.upcomingDeadlines.length > 0 && (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl shadow-sm border border-amber-200/80 p-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <BellIcon className="w-3.5 h-3.5 text-amber-600" />
                  <h3 className="text-[10px] font-semibold text-amber-800 uppercase tracking-wide">Upcoming Deadlines (Next 7 Days)</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
                  {moduleAssignments.upcomingDeadlines.slice(0, 6).map((deadline, idx) => (
                    <div key={idx} className="bg-white rounded-md p-2 border border-amber-100">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 truncate">{deadline.activity_name || deadline.title || 'Activity'}</p>
                          <p className="text-[10px] text-gray-500 truncate">{deadline.project_title || deadline.project_code || ''}</p>
                        </div>
                        <span className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded ${
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

            {/* Support Tickets Section — Jakob's Law: familiar card-list pattern */}
            <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200/60">
              <div className="px-3 py-2 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-purple-100 flex items-center justify-center">
                      <TicketIcon className="h-3.5 w-3.5 text-[#64126D]" />
                    </div>
                    <h2 className="text-xs font-semibold text-gray-900">Support Tickets</h2>
                    {moduleAssignments.ticketStats.waitingForYou > 0 && (
                      <span className="px-2 py-0.5 text-xs font-semibold bg-orange-100 text-orange-700 rounded-full animate-pulse">
                        {moduleAssignments.ticketStats.waitingForYou} waiting for you
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Link
                      href="/tickets/new"
                      className="flex items-center gap-1 px-2 py-1 bg-[#64126D] text-white text-[10px] font-medium rounded hover:bg-[#7a1785] transition-colors"
                    >
                      <PlusIcon className="h-3 w-3" />
                      Raise Ticket
                    </Link>
                    <Link
                      href="/tickets"
                      className="flex items-center gap-1 px-2 py-1 border border-gray-300 text-gray-700 text-[10px] font-medium rounded hover:bg-gray-50 transition-colors"
                    >
                      View All
                      <ArrowRightIcon className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
                
                {/* Quick Stats — Law of Similarity: consistent pill badges */}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-[10px] font-medium text-blue-700">
                    <span className="w-1 h-1 rounded-full bg-blue-500"></span>
                    Open {moduleAssignments.ticketStats.open}
                  </span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-50 text-[10px] font-medium text-green-700">
                    <span className="w-1 h-1 rounded-full bg-green-500"></span>
                    Resolved {moduleAssignments.ticketStats.resolved}
                  </span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-[10px] font-medium text-gray-600">
                    <span className="w-1 h-1 rounded-full bg-gray-400"></span>
                    Total {moduleAssignments.ticketStats.total}
                  </span>
                </div>
              </div>
              
              {/* Recent/Active Tickets List */}
              <div className="px-3 py-2">
                {moduleAssignments.tickets.length === 0 ? (
                  <div className="text-center py-4">
                    <TicketIcon className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-xs text-gray-500 mb-2">No tickets yet</p>
                    <Link
                      href="/tickets/new"
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#64126D] text-white text-[10px] font-medium rounded hover:bg-[#7a1785] transition-colors"
                    >
                      <PlusIcon className="h-3 w-3" />
                      Create Your First Ticket
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {moduleAssignments.tickets
                      .filter(t => !['closed'].includes(t.status))
                      .slice(0, 5)
                      .map((ticket) => (
                        <Link
                          key={ticket.id}
                          href={`/tickets/${ticket.id}`}
                          className="block p-2 border border-gray-200 rounded-md hover:border-purple-300 hover:shadow-sm transition-all"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[10px] font-mono text-gray-500">{ticket.ticket_number}</span>
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
                              <p className="text-xs font-medium text-gray-900 truncate">{ticket.subject}</p>
                              <p className="text-[10px] text-gray-500 truncate">{ticket.description}</p>
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
    </div>
  );
}

