'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { fetchJSON } from '@/utils/http';
import {
  ClipboardDocumentListIcon,
  UserIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CalendarDaysIcon,
  ClockIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';

/**
 * ProjectActivityTab — day-wise work-log display for every team member
 * on a given project.  Used in the super-admin project detail page
 * under the "Project Activity" tab.
 *
 * Data comes from GET /api/projects/[id]/work-logs (grouped by user → date).
 */
export default function ProjectActivityTab({ projectId }) {
  /* ---- state ---- */
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedUsers, setExpandedUsers] = useState({});
  const [expandedDates, setExpandedDates] = useState({});
  const [filterUser, setFilterUser] = useState('all');

  // date range – default last 30 days
  const today = new Date().toISOString().split('T')[0];
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(thirtyAgo);
  const [endDate, setEndDate] = useState(today);

  /* ---- fetch ---- */
  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ start_date: startDate, end_date: endDate });
      if (filterUser !== 'all') qs.set('user_id', filterUser);

      const res = await fetchJSON(`/api/projects/${projectId}/work-logs?${qs}`);
      if (res?.success) {
        setData(res.data);
        // expand all users & first date per user by default
        const eu = {};
        const ed = {};
        (res.data.users || []).forEach((u) => {
          eu[u.user_id] = true;
          if (u.dates?.[0]) ed[`${u.user_id}_${u.dates[0].date}`] = true;
        });
        setExpandedUsers(eu);
        setExpandedDates(ed);
      } else {
        setError(res?.error || 'Failed to load work logs');
      }
    } catch (err) {
      console.error('ProjectActivityTab load error', err);
      setError(err?.message || 'Unable to load work logs');
    } finally {
      setLoading(false);
    }
  }, [projectId, startDate, endDate, filterUser]);

  useEffect(() => {
    load();
  }, [load]);

  /* ---- toggles ---- */
  const toggleUser = (uid) =>
    setExpandedUsers((p) => ({ ...p, [uid]: !p[uid] }));
  const toggleDate = (uid, date) =>
    setExpandedDates((p) => {
      const key = `${uid}_${date}`;
      return { ...p, [key]: !p[key] };
    });

  /* ---- helpers ---- */
  const fmtDate = (d) => {
    if (!d) return '–';
    const dt = new Date(d + 'T00:00:00');
    const today2 = new Date();
    today2.setHours(0, 0, 0, 0);
    const diff = Math.round((today2 - dt) / 86400000);
    const label = dt.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    if (diff === 0) return `Today — ${label}`;
    if (diff === 1) return `Yesterday — ${label}`;
    return label;
  };

  const fmtMins = (m) => {
    if (!m) return '0m';
    const h = Math.floor(m / 60);
    const mins = m % 60;
    if (h === 0) return `${mins}m`;
    return mins > 0 ? `${h}h ${mins}m` : `${h}h`;
  };

  const logTypeBadge = (type) => {
    const map = {
      done: 'bg-green-100 text-green-700',
      todo: 'bg-blue-100 text-blue-700',
      blocker: 'bg-red-100 text-red-700',
      note: 'bg-gray-100 text-gray-600',
      review: 'bg-purple-100 text-purple-700',
    };
    return map[type] || 'bg-gray-100 text-gray-600';
  };

  const priorityDot = (p) => {
    const map = {
      critical: 'bg-red-500',
      high: 'bg-orange-400',
      medium: 'bg-blue-400',
      low: 'bg-gray-300',
    };
    return map[(p || '').toLowerCase()] || 'bg-gray-300';
  };

  /* ---- derived ---- */
  const users = data?.users || [];
  const totalLogs = data?.total_logs || 0;
  const allUserNames = users.map((u) => ({ id: u.user_id, name: u.full_name }));

  /* ---- render: loading ---- */
  if (loading) {
    return (
      <Section>
        <Header />
        <div className="px-6 py-12 text-center text-gray-500 text-sm">
          Loading day-wise activity logs…
        </div>
      </Section>
    );
  }

  /* ---- render: error ---- */
  if (error) {
    return (
      <Section>
        <Header />
        <div className="px-6 py-8 text-center">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <button
            onClick={load}
            className="inline-flex items-center gap-1 text-sm text-[#7F2487] hover:underline"
          >
            <ArrowPathIcon className="h-4 w-4" /> Retry
          </button>
        </div>
      </Section>
    );
  }

  /* ---- render: main ---- */
  return (
    <Section>
      {/* Header bar */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <CalendarDaysIcon className="h-5 w-5 text-[#7F2487]" />
            <h2 className="text-sm font-semibold text-black">
              Day-wise User Activity
            </h2>
            <span className="ml-1 text-xs text-gray-500">
              {totalLogs} log{totalLogs !== 1 ? 's' : ''} across {users.length} member
              {users.length !== 1 ? 's' : ''}
            </span>
          </div>

          <button
            onClick={load}
            className="p-1.5 text-gray-400 hover:text-[#7F2487] hover:bg-gray-100 rounded transition-colors"
            title="Refresh"
          >
            <ArrowPathIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-end gap-3 mt-3">
          {/* date range */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs"
            />
            <label className="text-xs text-gray-500">To</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs"
            />
          </div>

          {/* user filter */}
          {allUserNames.length > 1 && (
            <div className="flex items-center gap-1">
              <FunnelIcon className="h-3.5 w-3.5 text-gray-400" />
              <select
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs"
              >
                <option value="all">All Members</option>
                {allUserNames.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {users.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <ClipboardDocumentListIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No work logs found for this project in the selected range.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {users.map((user) => {
              const isUserOpen = expandedUsers[user.user_id] !== false;

              return (
                <div
                  key={user.user_id}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  {/* User accordion header */}
                  <button
                    onClick={() => toggleUser(user.user_id)}
                    className="w-full flex items-center justify-between bg-gray-50 px-4 py-3 border-b border-gray-200 hover:bg-gray-100 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-[#7F2487]/10 rounded-full flex items-center justify-center">
                        <UserIcon className="w-4 h-4 text-[#7F2487]" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 text-sm">{user.full_name}</p>
                        <p className="text-xs text-gray-500">
                          {user.total_logs} log{user.total_logs !== 1 ? 's' : ''} ·{' '}
                          {fmtMins(user.total_time_minutes)} total · {user.dates.length} day
                          {user.dates.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#7F2487]">
                        {fmtMins(user.total_time_minutes)}
                      </span>
                      {isUserOpen ? (
                        <ChevronUpIcon className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {/* Day list (nested accordion) */}
                  {isUserOpen && (
                    <div className="divide-y divide-gray-100">
                      {user.dates.map((day) => {
                        const dateKey = `${user.user_id}_${day.date}`;
                        const isDayOpen = expandedDates[dateKey] !== false;

                        return (
                          <div key={day.date}>
                            {/* Date sub-header */}
                            <button
                              onClick={() => toggleDate(user.user_id, day.date)}
                              className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-gray-50 transition-colors text-left"
                            >
                              <div className="flex items-center gap-2">
                                <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
                                <span className="text-xs font-medium text-gray-700">
                                  {fmtDate(day.date)}
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  ({day.logs.length} entr{day.logs.length !== 1 ? 'ies' : 'y'})
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="flex items-center gap-1 text-xs text-gray-500">
                                  <ClockIcon className="h-3.5 w-3.5" />
                                  {fmtMins(day.day_time_minutes)}
                                </span>
                                {isDayOpen ? (
                                  <ChevronUpIcon className="h-3.5 w-3.5 text-gray-400" />
                                ) : (
                                  <ChevronDownIcon className="h-3.5 w-3.5 text-gray-400" />
                                )}
                              </div>
                            </button>

                            {/* Log entries for this day */}
                            {isDayOpen && (
                              <div className="px-5 pb-3 space-y-2">
                                {day.logs.map((log) => (
                                  <div
                                    key={log.id}
                                    className="flex items-start gap-3 bg-white border border-gray-100 rounded-lg px-4 py-3 shadow-sm"
                                  >
                                    {/* priority dot */}
                                    <div
                                      className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${priorityDot(
                                        log.priority
                                      )}`}
                                      title={log.priority || 'medium'}
                                    />

                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-medium text-gray-800">
                                          {log.title}
                                        </span>
                                        <span
                                          className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${logTypeBadge(
                                            log.log_type
                                          )}`}
                                        >
                                          {log.log_type || 'done'}
                                        </span>
                                        {log.status && log.status !== 'completed' && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">
                                            {log.status}
                                          </span>
                                        )}
                                      </div>

                                      {log.description && (
                                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                          {log.description}
                                        </p>
                                      )}

                                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-400">
                                        {log.category && <span>{log.category}</span>}
                                        {log.time_spent && (
                                          <span className="flex items-center gap-0.5">
                                            <ClockIcon className="h-3 w-3" /> {log.time_spent}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary footer */}
      {totalLogs > 0 && (
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center justify-between text-xs gap-2">
          <span className="text-gray-600">
            <span className="font-semibold text-[#7F2487]">{totalLogs}</span> work log
            {totalLogs !== 1 ? 's' : ''} from{' '}
            <span className="font-semibold">{users.length}</span> member
            {users.length !== 1 ? 's' : ''}
          </span>
          <span className="text-gray-600">
            Total time:{' '}
            <span className="font-semibold text-blue-600">
              {fmtMins(users.reduce((s, u) => s + u.total_time_minutes, 0))}
            </span>
          </span>
        </div>
      )}
    </Section>
  );
}

/* Reusable wrappers */
function Section({ children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      {children}
    </section>
  );
}

function Header() {
  return (
    <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
      <CalendarDaysIcon className="h-5 w-5 text-[#7F2487]" />
      <h2 className="text-sm font-semibold text-black">Day-wise User Activity</h2>
    </div>
  );
}
