'use client';

import React, { useState, useEffect, Fragment } from 'react';
import { fetchJSON } from '@/utils/http';
import { 
  ClipboardDocumentListIcon,
  CheckCircleIcon,
  PencilSquareIcon,
  XMarkIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronUpIcon
} from '@heroicons/react/24/outline';

export default function ProjectActivityAssignments({ userId, preloadedData }) {
  const [assignments, setAssignments] = useState([]);
  const [stats, setStats] = useState({
    totalAssignments: 0, totalProjects: 0, totalQtyAssigned: 0, totalQtyCompleted: 0,
    totalPlannedHours: 0, totalActualHours: 0, completedCount: 0, inProgressCount: 0, notStartedCount: 0
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [hasAccess, setHasAccess] = useState(true);
  const [expandedRows, setExpandedRows] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [successModal, setSuccessModal] = useState(false);

  // Deduplicate entries by date (keep last occurrence) and ensure today has an entry
  const ensureTodayEntry = (list) => {
    const today = new Date().toISOString().split('T')[0];
    return list.map(a => {
      const raw = a.daily_entries || [];
      // Deduplicate by date — keep the last entry for each date
      const seen = new Map();
      raw.forEach(e => seen.set(e.date, e));
      const entries = Array.from(seen.values());
      const hasToday = entries.some(e => e.date === today);
      if (!hasToday) {
        const locked = entries.map(e => ({ ...e, isLocked: true }));
        return { ...a, daily_entries: [...locked, { date: today, qty_done: '', hours: '', remarks: '', isLocked: false }] };
      }
      return { ...a, daily_entries: entries };
    });
  };

  const autoExpandAll = (list) => {
    const expanded = {};
    list.forEach(a => { expanded[`${a.project_id}-${a.activity_id}`] = true; });
    setExpandedRows(expanded);
  };

  // Use preloaded data if available (from parent dashboard), skip duplicate fetch
  useEffect(() => {
    if (preloadedData) {
      const processed = ensureTodayEntry(preloadedData.assignments || []);
      setAssignments(processed);
      setStats(preloadedData.stats || {});
      autoExpandAll(processed);
      setLoading(false);
    }
  }, [preloadedData]);

  // Only fetch if no preloaded data provided
  useEffect(() => {
    if (!userId || preloadedData) return;
    const loadData = async () => {
      try {
        const response = await fetch(`/api/users/${userId}/activity-assignments`);
        if (response.status === 401 || response.status === 403) { setHasAccess(false); setLoading(false); return; }
        const res = await response.json();
        if (res.success) {
          const processed = ensureTodayEntry(res.data.assignments || []);
          setAssignments(processed); setStats(res.data.stats || {});
          autoExpandAll(processed);
        }
        else { setHasAccess(false); }
      } catch (err) { console.error('Failed to load activity assignments:', err); setHasAccess(false); }
      finally { setLoading(false); }
    };
    loadData();
  }, [userId, preloadedData]);

  const loadAssignments = async () => {
    try {
      const res = await fetchJSON(`/api/users/${userId}/activity-assignments`);
      if (res.success) {
        const processed = ensureTodayEntry(res.data.assignments || []);
        setAssignments(processed); setStats(res.data.stats || {});
        autoExpandAll(processed);
      }
    } catch (err) { console.error('Failed to load activity assignments:', err); }
  };

  const toggleExpand = (rowKey) => {
    setExpandedRows(prev => ({ ...prev, [rowKey]: !prev[rowKey] }));
  };

  const addDailyEntry = async (activity) => {
    const dailyEntries = [...(activity.daily_entries || [])];
    let nextDate;
    if (dailyEntries.length > 0) {
      const lastDate = new Date(dailyEntries[dailyEntries.length - 1].date);
      lastDate.setDate(lastDate.getDate() + 1);
      nextDate = lastDate.toISOString().split('T')[0];
    } else {
      nextDate = new Date().toISOString().split('T')[0];
    }
    // Prevent duplicate date entry
    if (dailyEntries.some(e => e.date === nextDate)) {
      alert('An entry for ' + nextDate + ' already exists.');
      return;
    }
    const lockedEntries = dailyEntries.map(e => ({ ...e, isLocked: true }));
    const updatedEntries = [...lockedEntries, { date: nextDate, qty_done: '', hours: '', remarks: '', isLocked: false }];
    const totalQtyDone = updatedEntries.reduce((sum, e) => sum + (parseFloat(e.qty_done) || 0), 0);
    const totalHours = updatedEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);

    setSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}/activity-assignments`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: activity.project_id, activity_id: activity.activity_id, daily_entries: updatedEntries, qty_completed: totalQtyDone, actual_hours: totalHours })
      });
      const data = await res.json();
      if (data.success) {
        await loadAssignments();
        setExpandedRows(prev => ({ ...prev, [`${activity.project_id}-${activity.activity_id}`]: true }));
      } else { alert('Failed to add entry: ' + (data.error || 'Unknown error')); }
    } catch (err) { console.error('Failed to add daily entry:', err); alert('Failed to add daily entry'); }
    finally { setSaving(false); }
  };

  const updateDailyEntryLocal = (activityKey, entryIndex, field, value) => {
    setAssignments(prev => prev.map(a => {
      if (`${a.project_id}-${a.activity_id}` === activityKey) {
        const entries = [...(a.daily_entries || [])];
        if (entries[entryIndex]) entries[entryIndex] = { ...entries[entryIndex], [field]: value };
        const totalQtyDone = entries.reduce((sum, e) => sum + (parseFloat(e.qty_done) || 0), 0);
        const totalHours = entries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
        return { ...a, daily_entries: entries, qty_completed: totalQtyDone, actual_hours: totalHours };
      }
      return a;
    }));
  };

  const removeDailyEntry = async (activity, entryIndex) => {
    const entries = [...(activity.daily_entries || [])];
    entries.splice(entryIndex, 1);
    const totalQtyDone = entries.reduce((sum, e) => sum + (parseFloat(e.qty_done) || 0), 0);
    const totalHours = entries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}/activity-assignments`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: activity.project_id, activity_id: activity.activity_id, daily_entries: entries, qty_completed: totalQtyDone, actual_hours: totalHours })
      });
      const data = await res.json();
      if (data.success) await loadAssignments();
    } catch (err) { console.error('Failed to remove entry:', err); }
    finally { setSaving(false); }
  };

  const saveDailyEntries = async (activity) => {
    const entries = activity.daily_entries || [];
    const totalQtyDone = entries.reduce((sum, e) => sum + (parseFloat(e.qty_done) || 0), 0);
    const totalHours = entries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}/activity-assignments`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: activity.project_id, activity_id: activity.activity_id, daily_entries: entries, qty_completed: totalQtyDone, actual_hours: totalHours })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessModal(true);
        setTimeout(() => setSuccessModal(false), 2000);
      } else { alert('Failed to submit: ' + (data.error || 'Unknown error')); }
    } catch (err) { console.error('Failed to save daily entries:', err); alert('Failed to submit entry'); }
    finally { setSaving(false); }
  };

  const startEditing = (assignment) => {
    setEditingId(`${assignment.project_id}-${assignment.activity_id}`);
    setEditForm({
      project_id: assignment.project_id, activity_id: assignment.activity_id,
      status: assignment.status || 'Not Started',
      due_date: assignment.due_date ? new Date(assignment.due_date).toISOString().split('T')[0] : '',
      remarks: assignment.remarks || ''
    });
  };
  const cancelEditing = () => { setEditingId(null); setEditForm({}); };

  const saveProgress = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}/activity-assignments`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm)
      });
      const data = await res.json();
      if (data.success) { await loadAssignments(); setEditingId(null); setEditForm({}); }
      else { alert('Failed to save: ' + (data.error || 'Unknown error')); }
    } catch (err) { console.error('Failed to save progress:', err); alert('Failed to save progress'); }
    finally { setSaving(false); }
  };

  const getStatusBadge = (status) => {
    const map = {
      'Completed': 'bg-green-100 text-green-700 border-green-200',
      'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
      'Not Started': 'bg-gray-100 text-[#4A1254] border-gray-200',
      'On Hold': 'bg-yellow-100 text-yellow-700 border-yellow-200'
    };
    return map[status] || map['Not Started'];
  };

  const filteredAssignments = assignments.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'pending') return a.status === 'Not Started';
    if (filter === 'in-progress') return a.status === 'In Progress';
    if (filter === 'completed') return a.status === 'Completed';
    return true;
  });

  const formatShortDate = (dateStr) => {
    if (!dateStr) return '–';
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
    const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return `${date} (${day})`;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-md border-2 border-purple-200 p-6 mb-6">
        <div className="text-center text-[#4A1254] text-sm">Loading assignments...</div>
      </div>
    );
  }

  if (!hasAccess) return null;

  return (
    <div className="bg-white rounded-xl shadow-lg border-2 border-purple-200 mb-6 ring-1 ring-purple-100">
      {/* Header */}
      <div className="px-4 py-3 border-b-2 border-purple-100 bg-gradient-to-r from-purple-50 to-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center shadow-sm">
              <ClipboardDocumentListIcon className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#4A1254]">My Project Activities</h3>
              <p className="text-xs text-[#4A1254]">{stats.totalAssignments} assignments across {stats.totalProjects} projects</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-2.5 py-1 bg-gray-100 text-[#4A1254] rounded-full text-xs font-semibold">{stats.notStartedCount} Pending</span>
            <span className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">{stats.inProgressCount} In Progress</span>
            <span className="px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">{stats.completedCount} Completed</span>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          {['all', 'pending', 'in-progress', 'completed'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${filter === f ? 'bg-purple-600 text-white shadow-sm' : 'bg-gray-100 text-[#4A1254] hover:bg-gray-200'}`}
            >
              {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : f === 'in-progress' ? 'In Progress' : 'Completed'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {filteredAssignments.length === 0 ? (
          <div className="text-center py-10 text-[#4A1254]">
            <ClipboardDocumentListIcon className="w-14 h-14 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No activities assigned to you</p>
          </div>
        ) : (
          (() => {
            // Group assignments by project
            const projectGroups = {};
            const projectOrder = [];
            filteredAssignments.forEach(a => {
              const pid = a.project_id || 'unknown';
              if (!projectGroups[pid]) {
                projectGroups[pid] = { project_code: a.project_code, project_name: a.project_name, activities: [] };
                projectOrder.push(pid);
              }
              projectGroups[pid].activities.push(a);
            });
            return projectOrder.map(pid => {
              const group = projectGroups[pid];
              const groupQtyAssigned = group.activities.reduce((s, a) => s + (parseFloat(a.qty_assigned) || 0), 0);
              const groupQtyDone = group.activities.reduce((s, a) => s + (parseFloat(a.qty_completed) || 0), 0);
              const groupPlannedHrs = group.activities.reduce((s, a) => s + (parseFloat(a.planned_hours) || 0), 0);
              const groupActualHrs = group.activities.reduce((s, a) => s + (parseFloat(a.actual_hours) || 0), 0);
              return (
                <div key={pid} className="mb-4 last:mb-0">
                  {/* Project Header */}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-[#64126D] to-[#7F2487] text-white">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-bold bg-white/20 px-2 py-0.5 rounded">{group.project_code || '–'}</span>
                      <span className="text-sm font-bold">{group.project_name || 'Unknown Project'}</span>
                      <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{group.activities.length} {group.activities.length === 1 ? 'activity' : 'activities'}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-semibold">
                      <span>Qty: {groupQtyDone}/{groupQtyAssigned}</span>
                      <span>Hrs: {groupActualHrs}/{groupPlannedHrs}</span>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-[#64126D]/10">
                      <tr className="divide-x divide-[#64126D]/10">
                        <th className="text-center py-2 px-4 font-bold text-[#64126D] uppercase tracking-wider text-xs">Activity</th>
                        <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">Plan Hrs</th>
                        <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">Manhours</th>
                        <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">Qty Asgn</th>
                        <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">Qty Done</th>
                        <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">Balance</th>
                        <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">Due Date</th>
                        <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">Status</th>
                        <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
              {group.activities.map((activity) => {
                const rowKey = `${activity.project_id}-${activity.activity_id}`;
                const isEditing = editingId === rowKey;
                const isExpanded = expandedRows[rowKey];
                const isDuePast = activity.due_date && new Date(activity.due_date) < new Date() && activity.status !== 'Completed';
                const dailyEntries = activity.daily_entries || [];
                const qtyAssigned = parseFloat(activity.qty_assigned) || 0;
                const qtyDone = parseFloat(activity.qty_completed) || 0;
                const balance = qtyAssigned - qtyDone;

                return (
                  <Fragment key={rowKey}>
                    {/* Main Activity Row */}
                    <tr className={`hover:bg-purple-50/40 transition-colors divide-x divide-gray-200 ${isDuePast ? 'bg-red-50/40' : ''}`}>
                      {/* Activity */}
                      <td className="py-3 px-4 align-middle">
                        <div className="font-semibold text-[#4A1254] text-sm">{activity.activity_name}</div>
                        {activity.activity_description && <div className="text-xs text-[#4A1254]/70 truncate max-w-[220px]" title={activity.activity_description}>{activity.activity_description}</div>}
                      </td>

                      {/* Plan Hrs */}
                      <td className="py-3 px-3 text-center align-middle text-[#4A1254]">{activity.planned_hours || 0}</td>

                      {/* Manhours */}
                      <td className="py-3 px-3 text-center align-middle font-bold text-black">{activity.actual_hours || 0}</td>

                      {/* Qty Asgn */}
                      <td className="py-3 px-3 text-center align-middle text-[#4A1254]">{qtyAssigned}</td>

                      {/* Qty Done */}
                      <td className="py-3 px-3 text-center align-middle font-bold text-black">{qtyDone}</td>

                      {/* Balance */}
                      <td className="py-3 px-3 text-center align-middle">
                        <span className={`font-semibold ${balance > 0 ? 'text-amber-600' : balance === 0 ? 'text-green-600' : 'text-red-500'}`}>{balance}</span>
                      </td>

                      {/* Due Date */}
                      <td className="py-3 px-3 text-center align-middle">
                          <span className={`text-xs font-bold ${isDuePast ? 'text-red-500' : 'text-[#64126D]'}`}>{formatShortDate(activity.due_date)}</span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-center align-middle">
                        {isEditing ? (
                          <select value={editForm.status} onChange={(e) => setEditForm({...editForm, status: e.target.value})}
                            className="px-2 py-1 text-xs border border-gray-300 rounded">
                            <option value="Not Started">Not Started</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Completed">Completed</option>
                            <option value="On Hold">On Hold</option>
                          </select>
                        ) : (
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusBadge(activity.status)}`}>{activity.status}</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-center align-middle">
                        <div className="flex items-center justify-center gap-1">
                          {isEditing ? (
                            <>
                              <button onClick={saveProgress} disabled={saving} className="p-1.5 text-green-600 hover:bg-green-100 rounded transition-colors" title="Save">
                                <CheckCircleIcon className="w-4 h-4" />
                              </button>
                              <button onClick={cancelEditing} className="p-1.5 text-[#4A1254] hover:bg-gray-100 rounded transition-colors" title="Cancel">
                                <XMarkIcon className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => addDailyEntry(activity)} disabled={saving}
                                className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded transition-colors" title="Add Daily Entry">
                                <PlusIcon className="w-4 h-4" />
                              </button>
                              <button onClick={() => startEditing(activity)}
                                className="p-1.5 text-blue-600 hover:bg-blue-100 rounded transition-colors" title="Edit Status/Date">
                                <PencilSquareIcon className="w-4 h-4" />
                              </button>
                              {dailyEntries.length > 0 && (
                                <button onClick={() => toggleExpand(rowKey)}
                                  className="p-1.5 text-[#4A1254] hover:bg-gray-100 rounded transition-colors" title={isExpanded ? 'Collapse' : 'Expand'}>
                                  {isExpanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Daily Entry Sub-Rows */}
                    {isExpanded && dailyEntries.length > 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-3 bg-purple-50/40">
                          <div className="ml-4 border-l-2 border-purple-300 pl-4">
                            <div className="text-xs font-bold text-[#4A1254] uppercase mb-2 tracking-wide">Daily Work Progress</div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-[#64126D] uppercase divide-x divide-[#64126D]/20">
                                  <th className="text-center py-1.5 px-3 font-extrabold text-[11px]">Date</th>
                                  <th className="text-center py-1.5 px-3 font-extrabold text-[11px]">Qty Asgn</th>
                                  <th className="text-center py-1.5 px-3 font-extrabold text-[11px]">Qty Done</th>
                                  <th className="text-center py-1.5 px-3 font-extrabold text-[11px]">Balance</th>
                                  <th className="text-center py-1.5 px-3 font-extrabold text-[11px]">Manhours</th>
                                  <th className="text-center py-1.5 px-3 font-extrabold text-[11px]">% Done</th>
                                  <th className="text-center py-1.5 px-3 font-extrabold text-[11px]">Remarks</th>
                                  <th className="text-center py-1.5 pl-3 font-extrabold w-10"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {(() => {
                                  let runningBalance = qtyAssigned;
                                  let cumDone = 0;
                                  let lastWeek = null;
                                  // Helper: get ISO week number
                                  const getWeek = (dateStr) => {
                                    if (!dateStr) return null;
                                    const d = new Date(dateStr);
                                    d.setHours(0, 0, 0, 0);
                                    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
                                    const jan4 = new Date(d.getFullYear(), 0, 4);
                                    return Math.round(((d - jan4) / 86400000 + jan4.getDay() + 1) / 7);
                                  };
                                  // Pre-compute weekly totals for summary
                                  const weekTotals = {};
                                  const weekMonths = {};
                                  dailyEntries.forEach(e => {
                                    const w = getWeek(e.date);
                                    if (!w) return;
                                    if (!weekTotals[w]) weekTotals[w] = { qty: 0, hours: 0, count: 0 };
                                    weekTotals[w].qty += parseFloat(e.qty_done) || 0;
                                    weekTotals[w].hours += parseFloat(e.hours) || 0;
                                    weekTotals[w].count++;
                                    if (!weekMonths[w] && e.date) {
                                      const d = new Date(e.date);
                                      weekMonths[w] = d.toLocaleString('default', { month: 'short', year: 'numeric' });
                                    }
                                  });
                                  const rows = [];
                                  dailyEntries.forEach((entry, eIdx) => {
                                    const week = getWeek(entry.date);
                                    // Insert week header when week changes
                                    if (week && week !== lastWeek) {
                                      const wt = weekTotals[week] || { qty: 0, hours: 0, count: 0 };
                                      rows.push(
                                        <tr key={`week-${week}`} className="bg-purple-100/60">
                                          <td colSpan={8} className="py-1.5 px-3">
                                            <div className="flex items-center justify-between">
                                              <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">Week {week} &middot; {weekMonths[week] || ''}</span>
                                              <div className="flex items-center gap-4 text-[10px] text-purple-600 font-semibold">
                                                <span>{wt.count} {wt.count === 1 ? 'day' : 'days'}</span>
                                                <span>Qty: {wt.qty}</span>
                                                <span>Hrs: {wt.hours}</span>
                                              </div>
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                      lastWeek = week;
                                    }
                                    const isLocked = entry.isLocked;
                                    const entryQtyDone = parseFloat(entry.qty_done) || 0;
                                    const dayQtyAsgn = runningBalance;
                                    runningBalance = runningBalance - entryQtyDone;
                                    cumDone += entryQtyDone;
                                    const cumPct = qtyAssigned > 0 ? Math.min(100, Math.round((cumDone / qtyAssigned) * 100)) : 0;
                                    const barColor = cumPct >= 75 ? '#059669' : cumPct >= 40 ? '#d97706' : '#7e22ce';
                                    rows.push(
                                    <tr key={eIdx} className={`divide-x divide-gray-200 ${isLocked ? 'text-[#4A1254]/50' : 'text-[#4A1254]'}`}>
                                      <td className="py-1.5 px-3 text-center">
                                        <span className="text-xs font-bold text-[#64126D]">{formatShortDate(entry.date)}</span>
                                      </td>
                                      <td className="py-1.5 px-3 text-center">
                                        <span className="text-xs font-medium text-[#4A1254]">{dayQtyAsgn}</span>
                                      </td>
                                      <td className="py-1.5 px-3 text-center">
                                        {isLocked ? (
                                          <span className="font-bold text-black">{entry.qty_done || 0}</span>
                                        ) : (
                                          <input type="number" value={entry.qty_done || ''} onChange={(e) => updateDailyEntryLocal(rowKey, eIdx, 'qty_done', e.target.value)}
                                            min="0"
                                            className="w-16 px-2 py-1 text-xs border border-gray-300 rounded text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none" />
                                        )}
                                      </td>
                                      <td className="py-1.5 px-3 text-center">
                                        <span className={`text-xs font-semibold ${runningBalance > 0 ? 'text-amber-600' : runningBalance === 0 ? 'text-green-600' : 'text-red-500'}`}>
                                          {runningBalance}
                                        </span>
                                      </td>
                                      <td className="py-1.5 px-3 text-center">
                                        {isLocked ? (
                                          <span className="font-bold text-black">{entry.hours || 0}</span>
                                        ) : (
                                          <input type="number" value={entry.hours || ''} onChange={(e) => updateDailyEntryLocal(rowKey, eIdx, 'hours', e.target.value)}
                                            min="0" step="0.5"
                                            className="w-16 px-2 py-1 text-xs border border-gray-300 rounded text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none" />
                                        )}
                                      </td>
                                      <td className="py-1.5 px-3 text-center">
                                        <div className="flex items-center gap-1.5 justify-center">
                                          <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                            <div className="h-full rounded-full transition-all" style={{ width: `${cumPct}%`, backgroundColor: barColor }} />
                                          </div>
                                          <span className="text-[10px] font-bold tabular-nums" style={{ color: barColor }}>{cumPct}%</span>
                                        </div>
                                      </td>
                                      <td className="py-1.5 px-3 text-center">
                                        {isLocked ? (
                                          <span className="text-xs truncate max-w-[220px] inline-block" title={entry.remarks}>{entry.remarks || '–'}</span>
                                        ) : (
                                          <input type="text" value={entry.remarks || ''} onChange={(e) => updateDailyEntryLocal(rowKey, eIdx, 'remarks', e.target.value)}
                                            placeholder="Remarks..."
                                            className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none" />
                                        )}
                                      </td>
                                      <td className="py-1.5 pl-3 text-center">
                                        {!isLocked && (
                                          <div className="flex items-center gap-1 justify-center">
                                            <button onClick={() => { saveDailyEntries(activity); }} disabled={saving}
                                              className="px-2.5 py-1 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded transition-colors disabled:opacity-50" title="Submit entry">
                                              {saving ? '...' : 'Submit'}
                                            </button>
                                            <button onClick={() => removeDailyEntry(activity, eIdx)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded" title="Remove entry">
                                              <XMarkIcon className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                    );
                                  });
                                  return rows;
                                })()}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
                    </tbody>
                  </table>
                </div>
              );
            })
          })()
        )}
      </div>

      {/* Success Modal */}
      {successModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setSuccessModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3 animate-in" onClick={e => e.stopPropagation()}>
            <CheckCircleIcon className="w-12 h-12 text-green-500" />
            <p className="text-sm font-semibold text-[#4A1254]">Submitted Successfully!</p>
            <p className="text-xs text-[#4A1254]">Your entry has been saved.</p>
          </div>
        </div>
      )}

      {/* Summary Footer */}
      {assignments.length > 0 && (
        <div className="px-6 py-4 bg-purple-50/50 border-t-2 border-purple-100 flex items-center justify-between text-sm">
          <div className="flex items-center gap-5">
            <span className="text-[#4A1254]"><span className="font-bold text-purple-700">{stats.totalQtyCompleted}</span> / {stats.totalQtyAssigned} units</span>
            <span className="text-[#4A1254]"><span className="font-bold text-blue-700">{stats.totalActualHours}</span> / {stats.totalPlannedHours} hrs</span>
          </div>
          <div className="font-semibold text-purple-700">{Math.round((stats.completedCount / stats.totalAssignments) * 100) || 0}% done</div>
        </div>
      )}
    </div>
  );
}
