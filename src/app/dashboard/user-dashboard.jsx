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

// ── Fixed shift times ──
const FIXED_IN_TIME = '09:00';  // 9:00 AM
const FIXED_OUT_TIME = '17:30'; // 5:30 PM
const LUNCH_BREAK_MINS = 60;    // 1 PM to 2 PM
// Expected work = (out - in) - lunch = (17:30 - 09:00) - 1h = 7h 30m = 450 min
const EXPECTED_WORK_MINS = (() => {
  const [inH, inM] = FIXED_IN_TIME.split(':').map(Number);
  const [outH, outM] = FIXED_OUT_TIME.split(':').map(Number);
  return (outH * 60 + outM) - (inH * 60 + inM) - LUNCH_BREAK_MINS;
})();

// Check if a time string (HH:MM) is outside the fixed shift window
function isOvertime(timeStr) {
  if (!timeStr) return false;
  const t = typeof timeStr === 'string' ? timeStr : timeStr.toString();
  if (!t.includes(':')) return false;
  const [h, m] = t.split(':').map(Number);
  const mins = h * 60 + (m || 0);
  const [inH, inM] = FIXED_IN_TIME.split(':').map(Number);
  const [outH, outM] = FIXED_OUT_TIME.split(':').map(Number);
  return mins < inH * 60 + inM || mins > outH * 60 + outM;
}

// Check if login/in time is after the fixed in time (late arrival)
function isLateLogin(timeStr) {
  if (!timeStr) return false;
  const t = typeof timeStr === 'string' ? timeStr : timeStr.toString();
  if (!t.includes(':')) return false;
  const [h, m] = t.split(':').map(Number);
  const mins = h * 60 + (m || 0);
  const [inH, inM] = FIXED_IN_TIME.split(':').map(Number);
  return mins > inH * 60 + inM;
}

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
  const { idleSeconds, cumulativeIdleSeconds, isIdle, dismiss, dismissed, handleActivity } = useIdleMonitor();

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
    leaves: { total: 24, used: 0, balance: 24 }
  });

  // Live total time: (now - loginTime) - cumulative idle
  const [liveTotalTime, setLiveTotalTime] = useState({ hrs: 0, mins: 0, elapsedHrs: 0, elapsedMins: 0, idleHrs: 0, idleMins: 0 });
  useEffect(() => {
    const calcTotal = () => {
      const lt = attendance.loginTime;
      if (!lt) { setLiveTotalTime({ hrs: 0, mins: 0, elapsedHrs: 0, elapsedMins: 0, idleHrs: 0, idleMins: 0 }); return; }
      const now = new Date();
      const [lh, lm] = (typeof lt === 'string' ? lt : lt.toString()).split(':').map(Number);
      const loginDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), lh, lm || 0);

      let endDate = now;
      // If logged out, cap elapsed time at logout
      if (attendance.logoutTime) {
        const [oh, om] = (typeof attendance.logoutTime === 'string' ? attendance.logoutTime : attendance.logoutTime.toString()).split(':').map(Number);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), oh, om || 0);
      }

      const elapsedMin = Math.max(0, Math.floor((endDate - loginDate) / 60000));
      // After logout, only use DB idle time — don't add live cumulative idle
      const idleMin = attendance.logoutTime
        ? (attendance.idleTime || 0)
        : Math.floor(cumulativeIdleSeconds / 60) + (attendance.idleTime || 0);
      const netMin = Math.max(0, elapsedMin - idleMin);
      setLiveTotalTime({
        hrs: Math.floor(netMin / 60), mins: netMin % 60,
        elapsedHrs: Math.floor(elapsedMin / 60), elapsedMins: elapsedMin % 60,
        idleHrs: Math.floor(idleMin / 60), idleMins: idleMin % 60
      });
    };
    calcTotal();
    // Don't keep interval running after logout
    if (attendance.logoutTime) return;
    const iv = setInterval(calcTotal, 50000);
    return () => clearInterval(iv);
  }, [attendance.loginTime, attendance.logoutTime, attendance.idleTime, cumulativeIdleSeconds]);

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

  // ── Poll attendance data (especially idle time) every 2 minutes ──
  useEffect(() => {
    const userId = verifiedUser?.id || user?.id;
    if (!userId || attendance.logoutTime) return; // Don't poll if logged out

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetchJSON(`/api/users/${userId}/attendance`);
        if (res?.success) {
          // Only update idle time to avoid disrupting other fields
          setAttendance(prev => ({
            ...prev,
            idleTime: res.data.idleTime || prev.idleTime
          }));
        }
      } catch (error) {
        // Silently fail - polling shouldn't disrupt UX
        console.debug('Attendance poll failed:', error);
      }
    }, 120000); // Poll every 2 minutes (matches heartbeat interval)

    return () => clearInterval(pollInterval);
  }, [verifiedUser?.id, user?.id, attendance.logoutTime]);

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
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 xl:p-4">
              <div className="flex items-center gap-2 mb-3 xl:mb-4">
                <div className="w-1 h-4 rounded-full bg-gradient-to-b from-[#64126D] to-[#9333ea]"></div>
                <h2 className="text-xs xl:text-sm font-semibold text-gray-800 tracking-wide uppercase">Today&apos;s Attendance</h2>
              </div>
              <div className="grid grid-cols-2 gap-2.5 xl:gap-3 sm:grid-cols-3 lg:grid-cols-7">
                {/* Punch In */}
                <div className="group relative rounded-xl border border-green-200 bg-gradient-to-br from-green-50 via-white to-emerald-50 p-3 hover:shadow-lg hover:border-green-400 hover:-translate-y-0.5 transition-all duration-300 overflow-hidden">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-green-200/30 rounded-full -translate-x-4 -translate-y-4 blur-lg group-hover:scale-125 transition-transform duration-500" />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 shadow-sm ${attendance.loginTime ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-green-200 group-hover:shadow-green-300 group-hover:shadow-md' : 'bg-gray-200 text-gray-500'}`}>
                        <ArrowRightStartOnRectangleIcon className="h-4 w-4" />
                      </div>
                      {attendance.loginTime && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-sm shadow-green-300" />}
                    </div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">Punch In</p>
                    <p className={`text-base font-extrabold leading-tight tracking-tight ${attendance.loginTime ? (isLateLogin(attendance.loginTime) ? 'text-red-600' : 'text-gray-900') : 'text-gray-400'}`}>
                      {attendance.loginTime ? formatTime(attendance.loginTime) : '--:--'}
                    </p>
                  </div>
                </div>
                {/* Punch Out */}
                <div className="group relative rounded-xl border border-red-200 bg-gradient-to-br from-red-50 via-white to-rose-50 p-3 hover:shadow-lg hover:border-red-400 hover:-translate-y-0.5 transition-all duration-300 overflow-hidden">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-red-200/30 rounded-full -translate-x-4 -translate-y-4 blur-lg group-hover:scale-125 transition-transform duration-500" />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 shadow-sm ${attendance.outTime ? 'bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-red-200 group-hover:shadow-red-300 group-hover:shadow-md' : 'bg-gray-200 text-gray-500'}`}>
                        <ArrowLeftStartOnRectangleIcon className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">Punch Out</p>
                    <p className={`text-base font-extrabold leading-tight tracking-tight ${attendance.logoutTime ? (isOvertime(attendance.logoutTime) ? 'text-red-600' : 'text-gray-900') : 'text-gray-400'}`}>
                      {attendance.logoutTime ? formatTime(attendance.logoutTime) : '--:--'}
                      {attendance.logoutTime && isOvertime(attendance.logoutTime) && <span className="ml-1 text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full align-middle">OT</span>}
                    </p>
                  </div>
                </div>
                {/* Total Time */}
                {(() => {
                  const totalMins = liveTotalTime.hrs * 60 + liveTotalTime.mins;
                  const isComplete = totalMins >= EXPECTED_WORK_MINS;
                  const hasLogin = !!attendance.loginTime;
                  return (
                <div className={`group relative rounded-xl border p-3 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 overflow-hidden ${
                  !hasLogin ? 'border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50' :
                  isComplete ? 'border-green-300 bg-gradient-to-br from-green-50 via-white to-emerald-50' :
                  'border-red-300 bg-gradient-to-br from-red-50 via-white to-rose-50'
                }`}>
                  <div className={`absolute top-0 right-0 w-20 h-20 rounded-full -translate-x-4 -translate-y-4 blur-lg group-hover:scale-125 transition-transform duration-500 ${
                    !hasLogin ? 'bg-indigo-200/30' : isComplete ? 'bg-green-200/30' : 'bg-red-200/30'
                  }`} />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 shadow-sm ${
                        !hasLogin ? 'bg-gray-200 text-gray-500' :
                        isComplete ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-green-200 group-hover:shadow-green-300 group-hover:shadow-md' :
                        'bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-red-200 group-hover:shadow-red-300 group-hover:shadow-md'
                      }`}>
                        <ClockIcon className="h-4 w-4" />
                      </div>
                      {hasLogin && <div className={`w-2 h-2 rounded-full animate-pulse shadow-sm ${isComplete ? 'bg-green-500 shadow-green-300' : 'bg-red-500 shadow-red-300'}`} />}
                    </div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">Total Time</p>
                    <p className={`text-base font-extrabold leading-tight tracking-tight ${!hasLogin ? 'text-gray-400' : isComplete ? 'text-green-700' : 'text-red-600'}`}>
                      {hasLogin ? `${liveTotalTime.hrs}h ${liveTotalTime.mins}m` : '--:--'}
                      {hasLogin && isComplete && <span className="ml-1 text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full align-middle">✓</span>}
                    </p>
                    {hasLogin && (
                      <p className={`text-[10px] mt-1 font-medium leading-snug ${isComplete ? 'text-green-600' : 'text-red-500'}`}>
                        {liveTotalTime.elapsedHrs}h {liveTotalTime.elapsedMins}m
                        <span className="text-red-500 font-bold"> − {liveTotalTime.idleHrs > 0 ? `${liveTotalTime.idleHrs}h ` : ''}{liveTotalTime.idleMins}m</span>
                        <span className="text-gray-400"> idle</span>
                      </p>
                    )}
                    {hasLogin && !isComplete && (
                      <p className="text-[9px] text-red-500 mt-0.5 font-semibold">
                        {Math.floor((EXPECTED_WORK_MINS - totalMins) / 60) > 0 ? `${Math.floor((EXPECTED_WORK_MINS - totalMins) / 60)}h ` : ''}{(EXPECTED_WORK_MINS - totalMins) % 60}m remaining
                      </p>
                    )}
                  </div>
                </div>
                  );
                })()}
                {/* Present Days */}
                <div className="group relative rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-sky-50 p-3 hover:shadow-lg hover:border-blue-400 hover:-translate-y-0.5 transition-all duration-300 overflow-hidden">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-blue-200/30 rounded-full -translate-x-4 -translate-y-4 blur-lg group-hover:scale-125 transition-transform duration-500" />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 shadow-sm ${attendance.daysPresent > 0 ? 'bg-gradient-to-br from-blue-500 to-sky-600 text-white shadow-blue-200 group-hover:shadow-blue-300 group-hover:shadow-md' : 'bg-gray-200 text-gray-500'}`}>
                        <CalendarDaysIcon className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">Present</p>
                    <p className={`text-base font-extrabold leading-tight tracking-tight ${attendance.daysPresent > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                      {attendance.daysPresent}<span className="text-sm font-semibold text-gray-400 ml-0.5">/ {attendance.daysInMonth}</span>
                    </p>
                    {attendance.daysInMonth > 0 && (
                      <div className="mt-2 h-1.5 rounded-full bg-blue-100 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-sky-500 transition-all duration-700 ease-out" style={{ width: `${Math.round((attendance.daysPresent / attendance.daysInMonth) * 100)}%` }} />
                      </div>
                    )}
                  </div>
                </div>
                {/* Leave Days */}
                <div className="group relative rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 p-3 hover:shadow-lg hover:border-amber-400 hover:-translate-y-0.5 transition-all duration-300 overflow-hidden">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-amber-200/30 rounded-full -translate-x-4 -translate-y-4 blur-lg group-hover:scale-125 transition-transform duration-500" />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 shadow-sm ${attendance.leaves.used > 0 ? 'bg-gradient-to-br from-amber-500 to-yellow-600 text-white shadow-amber-200 group-hover:shadow-amber-300 group-hover:shadow-md' : 'bg-gray-200 text-gray-500'}`}>
                        <CalendarIcon className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">Leaves</p>
                    <p className={`text-base font-extrabold leading-tight tracking-tight ${attendance.leaves.used > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                      {attendance.leaves.used}<span className="text-sm font-semibold text-gray-400 ml-0.5">/ {attendance.leaves.total}</span>
                    </p>
                    <p className="text-[11px] text-amber-700 font-semibold mt-1.5 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" /> {attendance.leaves.balance} remaining</p>
                  </div>
                </div>
                {/* Overtime */}
                <div className="group relative rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-3 hover:shadow-lg hover:border-orange-400 hover:-translate-y-0.5 transition-all duration-300 overflow-hidden">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-orange-200/30 rounded-full -translate-x-4 -translate-y-4 blur-lg group-hover:scale-125 transition-transform duration-500" />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 shadow-sm ${attendance.overtimeHours > 0 ? 'bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-orange-200 group-hover:shadow-orange-300 group-hover:shadow-md' : 'bg-gray-200 text-gray-500'}`}>
                        <FireIcon className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">Overtime</p>
                    <p className={`text-base font-extrabold leading-tight tracking-tight ${attendance.overtimeHours > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                      {attendance.overtimeHours}<span className="text-sm font-semibold text-gray-400 ml-0.5">h</span>
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1.5 font-medium">this month</p>
                  </div>
                </div>
                {/* Idle Time (Live + Total) */}
                {(() => {
                  // After logout, only show DB idle — don't add live cumulative
                  const effectiveIdleSecs = attendance.logoutTime ? 0 : idleSeconds;
                  const totalIdleMin = attendance.logoutTime
                    ? (attendance.idleTime || 0)
                    : Math.floor(cumulativeIdleSeconds / 60) + (attendance.idleTime || 0);
                  return (
                    <div className={`group relative rounded-xl border p-3 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 overflow-hidden ${
                      effectiveIdleSecs > 1800 ? 'border-red-300 bg-gradient-to-br from-red-50 via-white to-rose-50 ring-1 ring-red-200' : effectiveIdleSecs > 300 ? 'border-amber-300 bg-gradient-to-br from-amber-50 via-white to-yellow-50' : 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-green-50'
                    }`}>
                      <div className={`absolute top-0 right-0 w-20 h-20 rounded-full -translate-x-4 -translate-y-4 blur-lg group-hover:scale-125 transition-transform duration-500 ${
                        effectiveIdleSecs > 1800 ? 'bg-red-200/40' : effectiveIdleSecs > 300 ? 'bg-amber-200/40' : 'bg-emerald-200/30'
                      }`} />
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 shadow-sm ${
                            effectiveIdleSecs > 1800 ? 'bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-red-200' : effectiveIdleSecs > 300 ? 'bg-gradient-to-br from-amber-500 to-yellow-600 text-white shadow-amber-200' : 'bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-emerald-200'
                          }`}>
                            <ComputerDesktopIcon className="h-4 w-4" />
                          </div>
                          <div className={`w-2 h-2 rounded-full shadow-sm ${effectiveIdleSecs > 1800 ? 'bg-red-500 shadow-red-300' : effectiveIdleSecs > 300 ? 'bg-amber-500 shadow-amber-300' : 'bg-emerald-500 shadow-emerald-300'} animate-pulse`} />
                        </div>
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">Idle</p>
                        <p className={`text-base font-extrabold leading-tight tracking-tight ${
                          effectiveIdleSecs > 1800 ? 'text-red-800' : effectiveIdleSecs > 300 ? 'text-amber-800' : 'text-emerald-800'
                        }`}>{attendance.logoutTime ? `${totalIdleMin}m` : fmtIdle(effectiveIdleSecs)}</p>
                        <p className={`text-[11px] mt-1.5 font-semibold flex items-center gap-1 ${effectiveIdleSecs > 1800 ? 'text-red-600' : effectiveIdleSecs > 300 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full inline-block ${effectiveIdleSecs > 1800 ? 'bg-red-500' : effectiveIdleSecs > 300 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                          {attendance.logoutTime ? 'session ended' : totalIdleMin > 0 ? `Total ${totalIdleMin}m today` : (effectiveIdleSecs > 1800 ? 'action needed' : effectiveIdleSecs > 300 ? 'getting idle' : 'all good')}
                        </p>
                      </div>
                    </div>
                  );
                })()}
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
