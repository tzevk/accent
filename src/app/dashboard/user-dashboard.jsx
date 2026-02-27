'use client';

import React, { useState, useEffect, useMemo, useCallback, memo, lazy, Suspense } from 'react';
import Navbar from '@/components/Navbar';
import { fetchJSON } from '@/utils/http';
import { useSessionRBAC } from '@/utils/client-rbac';
import { 
  ClockIcon, 
  BellIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  ArrowLeftStartOnRectangleIcon,
  ArrowRightStartOnRectangleIcon,
  CalendarDaysIcon,
  CalendarIcon,
  FireIcon,
  ExclamationTriangleIcon,
  ComputerDesktopIcon,
  ExclamationCircleIcon
} from '@heroicons/react/24/outline';
import { useIdleMonitor } from '@/hooks/useIdleMonitor';

// ── Lazy-load heavy components (code-split, only fetched when needed) ──
const TodoList = lazy(() => import('@/components/TodoList'));
const ProjectActivityAssignments = lazy(() => import('@/components/ProjectActivityAssignments'));

// ── Shared idle-time formatter ──
function fmtIdle(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60), s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ── Section skeleton for Suspense fallbacks ──
function SectionSkeleton({ h = 'h-32' }) {
  return <div className={`${h} bg-gray-100/60 rounded-xl animate-pulse`} />;
}

// ── AnalogClock: isolated 1-second interval — re-renders itself only ──
const AnalogClock = memo(function AnalogClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const h = time.getHours() % 12, m = time.getMinutes(), s = time.getSeconds();
  const hDeg = h * 30 + m * 0.5, mDeg = m * 6 + s * 0.1, sDeg = s * 6;
  return (
    <div className="relative flex items-center gap-1" title={time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}>
      <svg width="40" height="40" viewBox="0 0 52 52" className="drop-shadow-sm">
        <circle cx="26" cy="26" r="25" fill="white" stroke="#7e22ce" strokeWidth="1.5" />
        {[...Array(12)].map((_, i) => {
          const angle = (i * 30 - 90) * (Math.PI / 180);
          const isMain = i % 3 === 0;
          const outer = 22, inner = isMain ? 18 : 19.5;
          return <line key={i} x1={26 + inner * Math.cos(angle)} y1={26 + inner * Math.sin(angle)} x2={26 + outer * Math.cos(angle)} y2={26 + outer * Math.sin(angle)} stroke={isMain ? '#581c87' : '#a855f7'} strokeWidth={isMain ? 1.5 : 0.8} strokeLinecap="round" />;
        })}
        <line x1="26" y1="26" x2={26 + 12 * Math.cos((hDeg - 90) * Math.PI / 180)} y2={26 + 12 * Math.sin((hDeg - 90) * Math.PI / 180)} stroke="#581c87" strokeWidth="2" strokeLinecap="round" />
        <line x1="26" y1="26" x2={26 + 17 * Math.cos((mDeg - 90) * Math.PI / 180)} y2={26 + 17 * Math.sin((mDeg - 90) * Math.PI / 180)} stroke="#7e22ce" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="26" y1="26" x2={26 + 19 * Math.cos((sDeg - 90) * Math.PI / 180)} y2={26 + 19 * Math.sin((sDeg - 90) * Math.PI / 180)} stroke="#ef4444" strokeWidth="0.7" strokeLinecap="round" />
        <circle cx="26" cy="26" r="1.5" fill="#581c87" />
      </svg>
    </div>
  );
});

// ── IdleBadge: isolated from parent re-renders ──
const IdleBadge = memo(function IdleBadge({ idleSeconds }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold backdrop-blur-sm transition-colors duration-200 ${
      idleSeconds > 60 ? 'bg-red-500/20 text-red-100 ring-1 ring-red-400/30'
        : idleSeconds > 30 ? 'bg-amber-500/20 text-amber-100 ring-1 ring-amber-400/30'
        : 'bg-white/15 text-white/90 ring-1 ring-white/20'
    }`}>
      <span className={`w-2 h-2 rounded-full ${idleSeconds > 60 ? 'bg-red-400 animate-pulse' : idleSeconds > 30 ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
      {idleSeconds > 30 ? `Idle: ${fmtIdle(idleSeconds)}` : 'Active'}
    </div>
  );
});

// ═══════════════════════════════════════════════════
// ── Main Dashboard Component ──
// ═══════════════════════════════════════════════════
export default function UserDashboard({ verifiedUser }) {
  const { user: contextUser } = useSessionRBAC();
  const user = verifiedUser || contextUser;
  const [loading, setLoading] = useState(true);
  const [statsReady, setStatsReady] = useState(false);
  const [todoPanelOpen, setTodoPanelOpen] = useState(false);
  const [showActivityReminder, setShowActivityReminder] = useState(false);
  const [pendingActivities, setPendingActivities] = useState([]);

  // Sync todoPanelOpen from localStorage on mount & listen for sidebar toggle
  useEffect(() => {
    try {
      if (localStorage.getItem('todoPanelOpen') === 'true') setTodoPanelOpen(true);
    } catch {}
    const handler = (e) => setTodoPanelOpen(e.detail?.open ?? false);
    window.addEventListener('toggleTodoPanel', handler);
    return () => window.removeEventListener('toggleTodoPanel', handler);
  }, []);

  // Idle monitoring
  const { idleSeconds, isIdle, dismiss, dismissed, handleActivity } = useIdleMonitor();

  // Static greeting & date — computed once on mount, not every second
  const [greeting] = useState(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  });
  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    []
  );

  // Attendance
  const [attendance, setAttendance] = useState({
    inTime: null, outTime: null, loginTime: null, logoutTime: null,
    currentMonth: '', daysInMonth: 0, daysPresent: 0,
    weeklyOff: 0, holidays: 0, overtimeHours: 0,
    leaves: { total: 18, used: 0, balance: 18 }
  });

  // Module data
  const [moduleAssignments, setModuleAssignments] = useState({
    unreadMessages: 0, pendingTodos: 0, highPriorityTodos: 0,
    upcomingDeadlines: [], overdueActivities: 0,
    recentWorkLogs: [], todayWorkHours: 0,
    statusSummary: { not_started: 0, in_progress: 0, on_hold: 0, completed: 0, total: 0 },
    workloadSummary: { total_active_activities: 0, total_estimated_hours: 0, total_actual_hours: 0, avg_progress: 0 },
    priorityBreakdown: [], activeProjects: [], recentUpdates: [],
    activityAssignments: {
      assignments: [],
      stats: {
        totalAssignments: 0, totalProjects: 0, totalQtyAssigned: 0, totalQtyCompleted: 0,
        totalPlannedHours: 0, totalActualHours: 0, completedCount: 0,
        inProgressCount: 0, notStartedCount: 0, onHoldCount: 0
      }
    }
  });

  const [moduleAccess, setModuleAccess] = useState({
    messages: true, todos: true, workLogs: true, dashboard: true
  });

  // ── Data fetching with tiered loading + AbortController ──
  useEffect(() => {
    const userId = verifiedUser?.id || user?.id;
    if (!userId) return;

    const ac = new AbortController();
    const signal = ac.signal;

    const loadData = async () => {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];

      try {
        // ── Tier 1 (critical path): attendance + activity assignments ──
        // These paint the header & stats — fetch first so shell renders fast
        const [attendanceRes, activityRes] = await Promise.allSettled([
          fetchJSON(`/api/users/${userId}/attendance`, { signal }).catch(() => null),
          fetch(`/api/users/${userId}/activity-assignments`, { signal }).then(r => r.json()).catch(() => null),
        ]);

        if (signal.aborted) return;

        if (attendanceRes.status === 'fulfilled' && attendanceRes.value?.success) {
          setAttendance(attendanceRes.value.data);
        }

        let assignmentsList = [];
        if (activityRes.status === 'fulfilled' && activityRes.value?.success) {
          assignmentsList = activityRes.value.data.assignments || [];
          setModuleAssignments(prev => ({
            ...prev,
            activityAssignments: {
              assignments: assignmentsList,
              stats: activityRes.value.data.stats || prev.activityAssignments.stats,
            },
          }));
          setStatsReady(true);

          // Check for pending daily entries
          const missing = assignmentsList.filter(a => {
            const entries = a.daily_entries || [];
            return !entries.some(e => e.date === today && e.isLocked);
          });
          if (missing.length > 0) {
            setPendingActivities(missing);
            const reminderKey = `activity_reminder_${today}`;
            if (!sessionStorage.getItem(reminderKey)) {
              setShowActivityReminder(true);
              sessionStorage.setItem(reminderKey, '1');
            }
          }
        }

        // First paint is ready
        setLoading(false);

        // ── Tier 2 (non-blocking): messages, todos, work-logs ──
        // Fetched after shell renders so user sees content sooner
        const tier2 = await Promise.allSettled([
          fetch('/api/messages/unread-count', { signal }).then(r => {
            if (r.status === 401 || r.status === 403) return { _denied: 'messages' };
            return r.json();
          }).catch(() => ({ _denied: 'messages' })),

          fetch('/api/todos', { signal }).then(r => {
            if (r.status === 401 || r.status === 403) return { _denied: 'todos' };
            return r.json();
          }).catch(() => ({ _denied: 'todos' })),

          fetch(`/api/work-logs?start_date=${today}&end_date=${today}`, { signal }).then(r => {
            if (r.status === 401 || r.status === 403) return { _denied: 'workLogs' };
            return r.json();
          }).catch(() => ({ _denied: 'workLogs' })),
        ]);

        if (signal.aborted) return;

        // Batch all tier-2 updates into a single setState to avoid cascading re-renders
        const accessPatch = {};
        const dataPatch = {};

        const msgVal = tier2[0].status === 'fulfilled' ? tier2[0].value : null;
        if (msgVal?._denied) accessPatch.messages = false;
        else if (msgVal?.success) dataPatch.unreadMessages = msgVal.data.unread_count || 0;

        const todoVal = tier2[1].status === 'fulfilled' ? tier2[1].value : null;
        if (todoVal?._denied) accessPatch.todos = false;
        else if (todoVal?.success && todoVal.data) {
          const pending = todoVal.data.filter(t => t.status !== 'completed');
          dataPatch.pendingTodos = pending.length;
          dataPatch.highPriorityTodos = pending.filter(t => t.priority === 'high').length;
        }

        const wlVal = tier2[2].status === 'fulfilled' ? tier2[2].value : null;
        if (wlVal?._denied) accessPatch.workLogs = false;
        else if (wlVal?.success && wlVal.data) {
          const totalHours = wlVal.data.reduce((sum, log) => sum + (parseFloat(log.hours_worked) || 0), 0);
          dataPatch.recentWorkLogs = wlVal.data.slice(0, 5);
          dataPatch.todayWorkHours = Math.round(totalHours * 10) / 10;
        }

        // Single batched state updates
        if (Object.keys(dataPatch).length) setModuleAssignments(prev => ({ ...prev, ...dataPatch }));
        if (Object.keys(accessPatch).length) setModuleAccess(prev => ({ ...prev, ...accessPatch }));
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
        setLoading(false);
      }
    };

    loadData();
    return () => ac.abort();
  }, [verifiedUser?.id, user?.id]);

  // ── Memoized helpers ──
  const formatTime = useCallback((time) => {
    if (!time) return '--:--';
    if (typeof time === 'string' && time.includes(':')) {
      const [hours, minutes] = time.split(':');
      const h = parseInt(hours);
      return `${h % 12 || 12}:${minutes} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    return time;
  }, []);

  const activityStats = useMemo(() => {
    const stats = moduleAssignments.activityAssignments.stats;
    const completionPct = stats.totalAssignments > 0
      ? Math.round((stats.completedCount / stats.totalAssignments) * 100) : 0;
    return { ...stats, completionPct };
  }, [moduleAssignments.activityAssignments.stats]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex flex-1 pt-16">
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-purple-200 border-t-purple-600" />
              <div className="text-gray-500 text-sm">Loading dashboard...</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════
  // ── Render ──
  // ══════════════════════════════════════
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />

      {/* Activity Reminder Modal */}
      {showActivityReminder && pendingActivities.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="activity-reminder-title">
          <div className="mx-4 max-w-lg w-full bg-white rounded-2xl shadow-2xl overflow-hidden animate-[scaleIn_0.25s_ease-out]">
            <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-white/25 flex items-center justify-center shrink-0">
                <ExclamationCircleIcon className="h-7 w-7 text-white" />
              </div>
              <div>
                <h2 id="activity-reminder-title" className="text-lg font-bold text-white">Activity Update Required</h2>
                <p className="text-xs text-white/80">You have pending entries for today</p>
              </div>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-700 mb-3">
                The following <span className="font-bold text-gray-900">{pendingActivities.length}</span> {pendingActivities.length === 1 ? 'activity has' : 'activities have'} not been updated today. Please submit your daily progress.
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {pendingActivities.slice(0, 10).map((a, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-100 rounded-lg">
                    <div className="w-5 h-5 rounded bg-orange-200 text-orange-700 flex items-center justify-center shrink-0">
                      <ClipboardDocumentListIcon className="h-3 w-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{a.activity_name}</p>
                      <p className="text-[10px] text-gray-500 truncate">{a.project_name} &middot; {a.project_code}</p>
                    </div>
                    <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${
                      a.status === 'In Progress' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                      a.status === 'Completed' ? 'bg-green-50 text-green-700 border-green-200' :
                      'bg-gray-50 text-gray-600 border-gray-200'
                    }`}>{a.status}</span>
                  </div>
                ))}
                {pendingActivities.length > 10 && (
                  <p className="text-xs text-gray-400 text-center">+{pendingActivities.length - 10} more</p>
                )}
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => setShowActivityReminder(false)} className="flex-1 px-4 py-2.5 text-sm font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2">
                Remind Later
              </button>
              <button onClick={() => { setShowActivityReminder(false); document.querySelector('[data-section="project-activities"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-[#64126D] rounded-lg hover:bg-[#7a1785] transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2">
                Update Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Idle Warning Modal */}
      {isIdle && !dismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="idle-warning-title">
          <div className="mx-4 max-w-md w-full bg-white rounded-2xl shadow-2xl overflow-hidden animate-[scaleIn_0.25s_ease-out]">
            <div className="bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-white/25 flex items-center justify-center shrink-0">
                <ExclamationTriangleIcon className="h-7 w-7 text-white" />
              </div>
              <h2 id="idle-warning-title" className="text-lg font-bold text-white">Idle Warning</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-base font-semibold text-gray-800">You&apos;ve been idle for {fmtIdle(idleSeconds)}</p>
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">No mouse movement or keyboard activity has been detected. Your idle time is being logged and may affect your productivity report.</p>
              <div className="mt-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <ClockIcon className="h-5 w-5 text-amber-600 shrink-0 animate-pulse" />
                <div>
                  <p className="text-xs font-medium text-amber-700">Current idle duration</p>
                  <p className="text-lg font-bold text-amber-800 tabular-nums">{fmtIdle(idleSeconds)}</p>
                </div>
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={dismiss} className="flex-1 px-4 py-2.5 text-sm font-semibold text-amber-700 bg-amber-100 rounded-lg hover:bg-amber-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2">Dismiss</button>
              <button onClick={() => { dismiss(); handleActivity?.(); }} className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">I&apos;m Back</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex pt-2 sm:pl-0">
        {/* Todo List Panel — lazy loaded, only when opened */}
        {todoPanelOpen && (
          <div className="todo-panel">
            <Suspense fallback={<SectionSkeleton h="h-64" />}>
              <TodoList />
            </Suspense>
          </div>
        )}

        {/* Main Content */}
        <div className={`flex-1 transition-[margin] duration-200 ${todoPanelOpen ? 'ml-72' : 'ml-0'}`}>
          <div className="px-2 sm:px-3 lg:px-4 py-2">
            <div className="bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm p-2 sm:p-3 xl:p-4 space-y-3 xl:space-y-4">

            {/* ── Hero Header ── */}
            <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-[#64126D] via-[#7a1785] to-[#9333ea] px-4 py-3 xl:px-6 xl:py-4 shadow-md" style={{ perspective: '800px', transformStyle: 'preserve-3d' }}>
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/[0.07] blur-sm animate-[blobFloat1_8s_ease-in-out_infinite]" style={{ transform: 'translateZ(20px)' }} />
              <div className="absolute -bottom-12 -left-8 w-28 h-28 rounded-full bg-white/[0.06] blur-sm animate-[blobFloat2_10s_ease-in-out_infinite]" style={{ transform: 'translateZ(15px)' }} />
              <div className="absolute top-1/2 right-1/4 w-16 h-16 rounded-full bg-purple-300/10 blur-[2px] animate-[blobFloat3_12s_ease-in-out_infinite]" style={{ transform: 'translateZ(30px)' }} />
              <div className="absolute -top-4 left-1/3 w-20 h-20 rounded-full bg-pink-300/[0.07] blur-sm animate-[blobFloat4_9s_ease-in-out_infinite]" style={{ transform: 'translateZ(25px)' }} />
              <div className="relative flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <nav className="text-[11px] xl:text-xs text-white/60 mb-0.5" aria-label="Breadcrumb">
                    <ol className="inline-flex items-center gap-1">
                      <li>Home</li>
                      <li className="text-white/30">/</li>
                      <li className="text-white/90 font-medium">Dashboard</li>
                    </ol>
                  </nav>
                  <h1 className="text-lg sm:text-xl xl:text-2xl font-bold text-white leading-tight tracking-tight">Good {greeting}, {user?.full_name?.split(' ')[0] || 'User'}</h1>
                  <p className="text-xs xl:text-sm text-white/70">{dateLabel}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <AnalogClock />
                  <IdleBadge idleSeconds={idleSeconds} />
                </div>
              </div>
            </div>

            {/* ── Attendance ── */}
            <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm p-3 xl:p-4">
              <div className="flex items-center gap-2 mb-2 xl:mb-3">
                <div className="w-0.5 h-4 rounded-full bg-gradient-to-b from-[#64126D] to-[#9333ea]"></div>
                <h2 className="text-xs xl:text-sm font-semibold text-gray-800 tracking-wide uppercase">Today&apos;s Attendance</h2>
              </div>
              <div className="grid grid-cols-2 gap-2 xl:gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {/* In Time */}
                <div className="group relative rounded-lg border border-gray-100 bg-gradient-to-br from-white to-green-50/40 p-1.5 hover:shadow-sm hover:border-green-300 transition-all duration-200">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors duration-200 ${attendance.inTime ? 'bg-green-100 text-green-600 group-hover:bg-green-200' : 'bg-gray-100 text-gray-400'}`}>
                      <ArrowRightStartOnRectangleIcon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider leading-none">In Time</p>
                      <p className={`text-xs font-bold leading-tight ${attendance.inTime ? 'text-gray-900' : 'text-gray-300'}`}>{formatTime(attendance.inTime)}</p>
                      {attendance.loginTime && <p className="text-[10px] text-green-600 mt-0.5 font-medium">Login {formatTime(attendance.loginTime)}</p>}
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
                      <p className={`text-xs font-bold leading-tight ${attendance.outTime ? 'text-gray-900' : 'text-gray-300'}`}>{formatTime(attendance.outTime)}</p>
                      {attendance.logoutTime && <p className="text-[10px] text-red-600 mt-0.5 font-medium">Logout {formatTime(attendance.logoutTime)}</p>}
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
                {/* Idle Time (Live) */}
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
                      }`}>{fmtIdle(idleSeconds)}</p>
                      <p className="text-[9px] text-gray-400">{idleSeconds > 1800 ? 'action needed' : idleSeconds > 300 ? 'getting idle' : 'all good'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Activity Overview KPIs ── */}
            <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm p-3 xl:p-4">
              <div className="flex items-center gap-2 mb-2 xl:mb-3">
                <div className="w-0.5 h-4 rounded-full bg-gradient-to-b from-[#64126D] to-[#9333ea]"></div>
                <h2 className="text-xs xl:text-sm font-semibold text-gray-800 tracking-wide uppercase">Activity Overview</h2>
              </div>
              <div className="grid grid-cols-2 gap-2 xl:gap-3 sm:grid-cols-4">
                <div className="group rounded-lg border border-gray-100 bg-gradient-to-br from-purple-50/60 to-white p-1.5 hover:shadow-sm hover:border-purple-300 transition-all duration-200">
                  <div className="flex items-center justify-between">
                    <div className="w-6 h-6 rounded bg-purple-100 text-[#64126D] flex items-center justify-center group-hover:bg-purple-200 transition-colors"><ClipboardDocumentListIcon className="h-3 w-3" /></div>
                    <p className="text-base font-bold text-gray-900">{activityStats.totalAssignments}</p>
                  </div>
                  <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider mt-1">Total Tasks</p>
                </div>
                <div className="group rounded-lg border border-gray-100 bg-gradient-to-br from-blue-50/60 to-white p-1.5 hover:shadow-sm hover:border-blue-300 transition-all duration-200">
                  <div className="flex items-center justify-between">
                    <div className="w-6 h-6 rounded bg-blue-100 text-blue-600 flex items-center justify-center group-hover:bg-blue-200 transition-colors"><ClockIcon className="h-3 w-3" /></div>
                    <p className="text-base font-bold text-gray-900">{activityStats.inProgressCount}</p>
                  </div>
                  <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider mt-1">In Progress</p>
                </div>
                <div className="group rounded-lg border border-gray-100 bg-gradient-to-br from-emerald-50/60 to-white p-1.5 hover:shadow-sm hover:border-emerald-300 transition-all duration-200">
                  <div className="flex items-center justify-between">
                    <div className="relative w-6 h-6">
                      <svg viewBox="0 0 36 36" className="w-6 h-6 -rotate-90">
                        <circle cx="18" cy="18" r="15" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                        <circle cx="18" cy="18" r="15" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${activityStats.completionPct * 0.942} 100`} className="transition-all duration-700" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-emerald-700">{activityStats.completionPct}%</span>
                    </div>
                    <p className="text-base font-bold text-gray-900">{activityStats.completedCount}</p>
                  </div>
                  <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider mt-1">Completed</p>
                </div>
                {moduleAccess.workLogs && (
                  <div className="group rounded-lg border border-gray-100 bg-gradient-to-br from-violet-50/60 to-white p-1.5 hover:shadow-sm hover:border-violet-300 transition-all duration-200">
                    <div className="flex items-center justify-between">
                      <div className="w-6 h-6 rounded bg-violet-100 text-violet-600 flex items-center justify-center group-hover:bg-violet-200 transition-colors"><DocumentTextIcon className="h-3 w-3" /></div>
                      <p className="text-base font-bold text-gray-900">{moduleAssignments.todayWorkHours}<span className="text-xs font-semibold text-gray-400">h</span></p>
                    </div>
                    <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider mt-1">Today&apos;s Logged</p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Upcoming Deadlines ── */}
            {moduleAccess.dashboard && moduleAssignments.upcomingDeadlines.length > 0 && (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl shadow-sm border border-amber-200/80 p-3 xl:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <BellIcon className="w-4 h-4 xl:w-5 xl:h-5 text-amber-600" />
                  <h3 className="text-xs xl:text-sm font-semibold text-amber-800 uppercase tracking-wide">Upcoming Deadlines (Next 7 Days)</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 xl:gap-3">
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
                          {deadline.days_remaining === 0 ? 'Today' : deadline.days_remaining === 1 ? 'Tomorrow' : `${deadline.days_remaining} days`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Project Activity Assignments — lazy-loaded ── */}
            <div data-section="project-activities">
              {user?.id && (
                <Suspense fallback={<SectionSkeleton h="h-48" />}>
                  <ProjectActivityAssignments userId={user.id} preloadedData={statsReady ? moduleAssignments.activityAssignments : null} />
                </Suspense>
              )}
            </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
