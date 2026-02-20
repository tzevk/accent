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

  // Ensure every activity has an unlocked entry for today
  const ensureTodayEntry = (list) => {
    const today = new Date().toISOString().split('T')[0];
    return list.map(a => {
      const entries = a.daily_entries || [];
      const hasUnlockedToday = entries.some(e => e.date === today && !e.isLocked);
      if (!hasUnlockedToday) {
        const locked = entries.map(e => ({ ...e, isLocked: true }));
        return { ...a, daily_entries: [...locked, { date: today, qty_done: '', hours: '', remarks: '', isLocked: false }] };
      }
      return a;
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
      'Not Started': 'bg-gray-100 text-gray-600 border-gray-200',
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
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="text-center text-gray-500">Loading assignments...</div>
      </div>
    );
  }

  if (!hasAccess) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <ClipboardDocumentListIcon className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">My Project Activities</h3>
              <p className="text-xs text-gray-500">{stats.totalAssignments} assignments across {stats.totalProjects} projects</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">{stats.notStartedCount} Pending</span>
            <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-xs font-medium">{stats.inProgressCount} In Progress</span>
            <span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-xs font-medium">{stats.completedCount} Completed</span>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          {['all', 'pending', 'in-progress', 'completed'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${filter === f ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : f === 'in-progress' ? 'In Progress' : 'Completed'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {filteredAssignments.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <ClipboardDocumentListIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No activities assigned to you</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-2.5 px-3 font-semibold text-gray-500 uppercase tracking-wider">Project</th>
                <th className="text-left py-2.5 px-3 font-semibold text-gray-500 uppercase tracking-wider">Activity</th>
                <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Plan Hrs</th>
                <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Manhours</th>
                <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Qty Asgn</th>
                <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Qty Done</th>
                <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Balance</th>
                <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Due Date</th>
                <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredAssignments.map((activity) => {
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
                    <tr className={`hover:bg-gray-50/80 transition-colors ${isDuePast ? 'bg-red-50/30' : ''}`}>
                      {/* Project */}
                      <td className="py-2.5 px-3 align-middle">
                        <div className="font-mono text-[11px] text-purple-700 font-semibold">{activity.project_code || '–'}</div>
                        <div className="text-[10px] text-gray-500 truncate max-w-[120px]" title={activity.project_name}>{activity.project_name}</div>
                      </td>

                      {/* Activity */}
                      <td className="py-2.5 px-3 align-middle">
                        <div className="font-medium text-gray-900 text-[11px]">{activity.activity_name}</div>
                        {activity.activity_description && <div className="text-[10px] text-gray-400 truncate max-w-[200px]" title={activity.activity_description}>{activity.activity_description}</div>}
                      </td>

                      {/* Plan Hrs */}
                      <td className="py-2.5 px-2 text-center align-middle text-gray-600">{activity.planned_hours || 0}</td>

                      {/* Manhours */}
                      <td className="py-2.5 px-2 text-center align-middle font-medium text-blue-600">{activity.actual_hours || 0}</td>

                      {/* Qty Asgn */}
                      <td className="py-2.5 px-2 text-center align-middle text-gray-600">{qtyAssigned}</td>

                      {/* Qty Done */}
                      <td className="py-2.5 px-2 text-center align-middle font-medium text-purple-600">{qtyDone}</td>

                      {/* Balance */}
                      <td className="py-2.5 px-2 text-center align-middle">
                        <span className={`font-medium ${balance > 0 ? 'text-amber-600' : balance === 0 ? 'text-green-600' : 'text-red-500'}`}>{balance}</span>
                      </td>

                      {/* Due Date */}
                      <td className="py-2.5 px-2 text-center align-middle">
                          <span className={`text-[10px] ${isDuePast ? 'text-red-500 font-semibold' : 'text-gray-600'}`}>{formatShortDate(activity.due_date)}</span>
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-2 text-center align-middle">
                        {isEditing ? (
                          <select value={editForm.status} onChange={(e) => setEditForm({...editForm, status: e.target.value})}
                            className="px-1 py-0.5 text-[10px] border border-gray-300 rounded">
                            <option value="Not Started">Not Started</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Completed">Completed</option>
                            <option value="On Hold">On Hold</option>
                          </select>
                        ) : (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusBadge(activity.status)}`}>{activity.status}</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-2 text-center align-middle">
                        <div className="flex items-center justify-center gap-0.5">
                          {isEditing ? (
                            <>
                              <button onClick={saveProgress} disabled={saving} className="p-1 text-green-600 hover:bg-green-100 rounded transition-colors" title="Save">
                                <CheckCircleIcon className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={cancelEditing} className="p-1 text-gray-400 hover:bg-gray-100 rounded transition-colors" title="Cancel">
                                <XMarkIcon className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => addDailyEntry(activity)} disabled={saving}
                                className="p-1 text-emerald-600 hover:bg-emerald-100 rounded transition-colors" title="Add Daily Entry">
                                <PlusIcon className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => startEditing(activity)}
                                className="p-1 text-blue-600 hover:bg-blue-100 rounded transition-colors" title="Edit Status/Date">
                                <PencilSquareIcon className="w-3.5 h-3.5" />
                              </button>
                              {dailyEntries.length > 0 && (
                                <button onClick={() => toggleExpand(rowKey)}
                                  className="p-1 text-gray-500 hover:bg-gray-100 rounded transition-colors" title={isExpanded ? 'Collapse' : 'Expand'}>
                                  {isExpanded ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
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
                        <td colSpan={10} className="px-3 py-2 bg-slate-50/80">
                          <div className="ml-4 border-l-2 border-purple-200 pl-3">
                            <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5">Daily Entries</div>
                            <table className="w-full text-[10px]">
                              <thead>
                                <tr className="text-gray-400 uppercase">
                                  <th className="text-left py-1 pr-2 font-semibold">Date</th>
                                  <th className="text-center py-1 px-2 font-semibold">Qty Done</th>
                                  <th className="text-center py-1 px-2 font-semibold">Manhours</th>
                                  <th className="text-left py-1 px-2 font-semibold">Remarks</th>
                                  <th className="text-center py-1 pl-2 font-semibold w-8"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {dailyEntries.map((entry, eIdx) => {
                                  const isLocked = entry.isLocked;
                                  return (
                                    <tr key={eIdx} className={`${isLocked ? 'text-gray-400' : 'text-gray-700'}`}>
                                      <td className="py-1 pr-2">
                                        <span className="text-[10px]">{formatShortDate(entry.date)}</span>
                                      </td>
                                      <td className="py-1 px-2 text-center">
                                        {isLocked ? (
                                          <span>{entry.qty_done || 0}</span>
                                        ) : (
                                          <input type="number" value={entry.qty_done || ''} onChange={(e) => updateDailyEntryLocal(rowKey, eIdx, 'qty_done', e.target.value)}
                                            onBlur={() => saveDailyEntries(activity)} min="0"
                                            className="w-14 px-1 py-0.5 text-[10px] border border-gray-300 rounded text-center focus:border-blue-500 focus:outline-none" />
                                        )}
                                      </td>
                                      <td className="py-1 px-2 text-center">
                                        {isLocked ? (
                                          <span>{entry.hours || 0}</span>
                                        ) : (
                                          <input type="number" value={entry.hours || ''} onChange={(e) => updateDailyEntryLocal(rowKey, eIdx, 'hours', e.target.value)}
                                            onBlur={() => saveDailyEntries(activity)} min="0" step="0.5"
                                            className="w-14 px-1 py-0.5 text-[10px] border border-gray-300 rounded text-center focus:border-blue-500 focus:outline-none" />
                                        )}
                                      </td>
                                      <td className="py-1 px-2">
                                        {isLocked ? (
                                          <span className="text-[10px] truncate max-w-[200px] block" title={entry.remarks}>{entry.remarks || '–'}</span>
                                        ) : (
                                          <input type="text" value={entry.remarks || ''} onChange={(e) => updateDailyEntryLocal(rowKey, eIdx, 'remarks', e.target.value)}
                                            onBlur={() => saveDailyEntries(activity)} placeholder="Remarks..."
                                            className="w-full px-1 py-0.5 text-[10px] border border-gray-300 rounded focus:border-blue-500 focus:outline-none" />
                                        )}
                                      </td>
                                      <td className="py-1 pl-2 text-center">
                                        {!isLocked && (
                                          <div className="flex items-center gap-0.5 justify-center">
                                            <button onClick={() => { saveDailyEntries(activity); }} disabled={saving}
                                              className="px-1.5 py-0.5 text-[9px] font-medium text-white bg-purple-600 hover:bg-purple-700 rounded transition-colors disabled:opacity-50" title="Submit entry">
                                              {saving ? '...' : 'Submit'}
                                            </button>
                                            <button onClick={() => removeDailyEntry(activity, eIdx)} className="p-0.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded" title="Remove entry">
                                              <XMarkIcon className="w-3 h-3" />
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
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
        )}
      </div>

      {/* Success Modal */}
      {successModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setSuccessModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3 animate-in" onClick={e => e.stopPropagation()}>
            <CheckCircleIcon className="w-12 h-12 text-green-500" />
            <p className="text-sm font-semibold text-gray-900">Submitted Successfully!</p>
            <p className="text-xs text-gray-500">Your entry has been saved.</p>
          </div>
        </div>
      )}

      {/* Summary Footer */}
      {assignments.length > 0 && (
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="text-gray-600"><span className="font-semibold text-purple-600">{stats.totalQtyCompleted}</span> / {stats.totalQtyAssigned} units</span>
            <span className="text-gray-600"><span className="font-semibold text-blue-600">{stats.totalActualHours}</span> / {stats.totalPlannedHours} hrs</span>
          </div>
          <div className="text-gray-500">{Math.round((stats.completedCount / stats.totalAssignments) * 100) || 0}% done</div>
        </div>
      )}
    </div>
  );
}
