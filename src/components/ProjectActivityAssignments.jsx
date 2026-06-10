'use client';

import React, { useState, useEffect } from 'react';
import { fetchJSON } from '@/utils/http';
import {
  ClipboardDocumentListIcon,
  PlusIcon,
  CheckIcon,
  XMarkIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';

const todayStr = () => new Date().toISOString().split('T')[0];

const STATUS_OPTIONS = ['Completed', 'Ongoing', 'Hold', 'Cancelled', 'Not Started'];

const STATUS_BADGE_CLASSES = {
  Completed: 'bg-green-100 text-green-700 border-green-200',
  Ongoing: 'bg-blue-100 text-blue-700 border-blue-200',
  'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
  Hold: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'On Hold': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  Cancelled: 'bg-red-100 text-red-700 border-red-200',
  'Not Started': 'bg-gray-100 text-gray-600 border-gray-200',
};

const getStatusBadge = (status) =>
  STATUS_BADGE_CLASSES[status] || 'bg-gray-100 text-gray-600 border-gray-200';

export default function ProjectActivityAssignments({ userId, preloadedData }) {
  const [assignments, setAssignments] = useState([]);
  const [emptyProjects, setEmptyProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disciplineOptions, setDisciplineOptions] = useState([]);

  const [editKey, setEditKey] = useState(null);
  const [editForm, setEditForm] = useState({});

  const [addingProjectId, setAddingProjectId] = useState(null);
  const [addForm, setAddForm] = useState({
    discipline_id: '',
    activity_id: '',
    sub_activity_id: '',
    manhours_assigned: '',
    start_date: todayStr(),
  });

  // Use preloaded data if available (from parent dashboard)
  useEffect(() => {
    if (preloadedData) {
      setAssignments(preloadedData.assignments || []);
      setEmptyProjects(preloadedData.emptyProjects || []);
      setLoading(false);
    }
  }, [preloadedData]);

  // Only fetch if no preloaded data provided
  useEffect(() => {
    if (!userId || preloadedData) return;
    loadAssignments();
  }, [userId, preloadedData]);

  // Load discipline/activity/sub-activity dropdown options
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const res = await fetchJSON('/api/activity-master/options');
        if (res?.success) setDisciplineOptions(res.data || []);
      } catch (err) {
        console.error('Failed to load activity options:', err);
      }
    })();
  }, [userId]);

  const loadAssignments = async () => {
    try {
      const response = await fetch(
        `/api/users/${userId}/activity-assignments`
      );
      if (response.status === 401 || response.status === 403) {
        setHasAccess(false);
        setLoading(false);
        return;
      }
      const res = await response.json();
      if (res.success) {
        setAssignments(res.data.assignments || []);
        setEmptyProjects(res.data.emptyProjects || []);
      } else {
        setHasAccess(false);
      }
    } catch (err) {
      console.error('Failed to load activity assignments:', err);
      setHasAccess(false);
    } finally {
      setLoading(false);
    }
  };

  const formatShortDate = (dateStr) => {
    if (!dateStr) return '–';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  // ── Inline edit of an existing activity row ──
  const startEdit = (activity) => {
    const rowKey = `${activity.project_id}-${activity.activity_id}`;
    setEditKey(rowKey);
    setEditForm({
      actual_hours: activity.actual_hours || '',
      due_date: activity.due_date
        ? new Date(activity.due_date).toISOString().split('T')[0]
        : '',
      progress_percentage: activity.progress_percentage || '',
      status: activity.status || 'Not Started',
    });
  };

  const cancelEdit = () => {
    setEditKey(null);
    setEditForm({});
  };

  const saveEdit = async (activity) => {
    setSaving(true);
    try {
      const res = await fetchJSON(`/api/users/${userId}/activity-assignments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: activity.project_id,
          activity_id: activity.activity_id,
          actual_hours: editForm.actual_hours,
          due_date: editForm.due_date || null,
          progress_percentage: editForm.progress_percentage,
          status: editForm.status,
        }),
      });
      if (res?.success) {
        await loadAssignments();
        setEditKey(null);
        setEditForm({});
      } else {
        alert(res?.error || 'Failed to save changes');
      }
    } catch (err) {
      console.error('Failed to save activity:', err);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // ── Add a new activity row to a project ──
  const openAddRow = (projectId) => {
    setAddingProjectId(projectId);
    setAddForm({
      discipline_id: '',
      activity_id: '',
      sub_activity_id: '',
      manhours_assigned: '',
      start_date: todayStr(),
    });
  };

  const closeAddRow = () => {
    if (saving) return;
    setAddingProjectId(null);
  };

  const selectedDiscipline = disciplineOptions.find(
    (d) => d.id === addForm.discipline_id
  );
  const selectedActivity = selectedDiscipline?.activities?.find(
    (a) => a.id === addForm.activity_id
  );

  const submitAdd = async (projectId) => {
    const discipline = disciplineOptions.find(
      (d) => d.id === addForm.discipline_id
    );
    const activity = discipline?.activities?.find(
      (a) => a.id === addForm.activity_id
    );
    const subActivity = activity?.subActivities?.find(
      (s) => s.id === addForm.sub_activity_id
    );

    if (!discipline || !activity) {
      alert('Please select a Discipline and Activity.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetchJSON(`/api/users/${userId}/activity-assignments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          discipline_name: discipline.function_name,
          activity_name: activity.activity_name,
          sub_activity_name: subActivity?.name || '',
          manhours_assigned: addForm.manhours_assigned,
          start_date: addForm.start_date || null,
        }),
      });
      if (res?.success) {
        setAddingProjectId(null);
        await loadAssignments();
      } else {
        alert(res?.error || 'Failed to add activity');
      }
    } catch (err) {
      console.error('Failed to add activity:', err);
      alert('Failed to add activity');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-md border-2 border-purple-200 p-6 mb-6">
        <div className="text-center text-[#4A1254] text-sm">
          Loading assignments...
        </div>
      </div>
    );
  }

  if (!hasAccess) return null;

  // Group assignments by project
  const projectGroups = {};
  const projectOrder = [];
  assignments.forEach((a) => {
    const pid = a.project_id || 'unknown';
    if (!projectGroups[pid]) {
      projectGroups[pid] = {
        project_code: a.project_code,
        project_name: a.project_name,
        activities: [],
      };
      projectOrder.push(pid);
    }
    projectGroups[pid].activities.push(a);
  });
  emptyProjects.forEach((p) => {
    const pid = p.project_id || 'unknown';
    if (!projectGroups[pid]) {
      projectGroups[pid] = {
        project_code: p.project_code,
        project_name: p.project_name,
        activities: [],
      };
      projectOrder.push(pid);
    }
  });

  const COLS = 9; // discipline, activity, sub-activity, manhours, actual, assigned date, completion date, progress, remarks
  const ACTION_COLS = 1;

  return (
    <div className="bg-white rounded-xl shadow-lg border-2 border-purple-200 mb-6 ring-1 ring-purple-100">
      {/* Header */}
      <div className="px-4 py-3 border-b-2 border-purple-100 bg-gradient-to-r from-purple-50 to-white flex items-center gap-2">
        <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center shadow-sm">
          <ClipboardDocumentListIcon className="w-5 h-5 text-purple-600" />
        </div>
        <h3 className="text-sm font-bold text-[#4A1254]">
          My Project Activities
        </h3>
      </div>

      {projectOrder.length === 0 ? (
        <div className="text-center py-10 text-[#4A1254]">
          <ClipboardDocumentListIcon className="w-14 h-14 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No projects assigned to you</p>
        </div>
      ) : (
        projectOrder.map((pid) => {
          const group = projectGroups[pid];
          const isAdding = addingProjectId === pid;

          return (
            <div key={pid} className="mb-4 last:mb-0">
              {/* Project Header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-[#64126D] to-[#7F2487] text-white">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold bg-white/20 px-2 py-0.5 rounded">
                    {group.project_code || '–'}
                  </span>
                  <span className="text-sm font-bold">
                    {group.project_name || 'Unknown Project'}
                  </span>
                </div>
                <button
                  onClick={() => openAddRow(pid)}
                  disabled={isAdding}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-white/15 hover:bg-white/25 transition-colors text-xs font-semibold disabled:opacity-50"
                  title="Add activity to this project"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#64126D]/10">
                    <tr className="divide-x divide-[#64126D]/10">
                      <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">
                        Discipline
                      </th>
                      <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">
                        Activity
                      </th>
                      <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">
                        Sub Activity
                      </th>
                      <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">
                        Manhours Assigned
                      </th>
                      <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">
                        Actual Manhours Used
                      </th>
                      <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">
                        Date Activity Assigned
                      </th>
                      <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">
                        Date Activity Completed
                      </th>
                      <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">
                        Work Progress %
                      </th>
                      <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">
                        Status
                      </th>
                      <th className="text-center py-2 px-3 font-bold text-[#64126D] uppercase tracking-wider text-xs">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {group.activities.length === 0 && !isAdding && (
                      <tr>
                        <td
                          colSpan={COLS + ACTION_COLS}
                          className="py-6 px-4 text-center text-sm text-[#4A1254]"
                        >
                          No activities added yet. Click{' '}
                          <span className="font-semibold">Add</span> above to
                          log your first activity for this project.
                        </td>
                      </tr>
                    )}

                    {group.activities.map((activity) => {
                      const rowKey = `${activity.project_id}-${activity.activity_id}`;
                      const isEditing = editKey === rowKey;

                      return (
                        <tr
                          key={rowKey}
                          className="hover:bg-purple-50/40 transition-colors divide-x divide-gray-200"
                        >
                          <td className="py-2.5 px-3 text-center align-middle text-[#4A1254]">
                            {activity.discipline}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle font-semibold text-[#4A1254]">
                            {activity.activity_name}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle text-[#4A1254]">
                            {activity.sub_activity_name || '–'}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle text-[#4A1254]">
                            {activity.planned_hours || 0}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle">
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={editForm.actual_hours}
                                onChange={(e) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    actual_hours: e.target.value,
                                  }))
                                }
                                className="w-20 px-2 py-1 text-xs border border-gray-300 rounded text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
                              />
                            ) : (
                              <span className="font-bold text-black">
                                {activity.actual_hours || 0}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle text-[#4A1254]">
                            {formatShortDate(activity.start_date)}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle">
                            {isEditing ? (
                              <input
                                type="date"
                                value={editForm.due_date}
                                onChange={(e) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    due_date: e.target.value,
                                  }))
                                }
                                className="px-2 py-1 text-xs border border-gray-300 rounded text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
                              />
                            ) : (
                              <span className="text-[#4A1254]">
                                {formatShortDate(activity.due_date)}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle">
                            {isEditing ? (
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={editForm.progress_percentage}
                                onChange={(e) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    progress_percentage: e.target.value,
                                  }))
                                }
                                className="w-16 px-2 py-1 text-xs border border-gray-300 rounded text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
                              />
                            ) : (
                              <span className="font-semibold text-purple-700">
                                {activity.progress_percentage || 0}%
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle">
                            {isEditing ? (
                              <select
                                value={editForm.status}
                                onChange={(e) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    status: e.target.value,
                                  }))
                                }
                                className="px-2 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
                              >
                                {STATUS_OPTIONS.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(
                                  activity.status
                                )}`}
                              >
                                {activity.status || 'Not Started'}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center align-middle">
                            {isEditing ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => saveEdit(activity)}
                                  disabled={saving}
                                  className="p-1.5 text-green-600 hover:bg-green-100 rounded transition-colors disabled:opacity-50"
                                  title="Save"
                                >
                                  <CheckIcon className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  disabled={saving}
                                  className="p-1.5 text-[#4A1254] hover:bg-gray-100 rounded transition-colors"
                                  title="Cancel"
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEdit(activity)}
                                className="p-1.5 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                                title="Edit"
                              >
                                <PencilSquareIcon className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Inline Add Row */}
                    {isAdding && (
                      <tr className="bg-purple-50/50 divide-x divide-gray-200">
                        <td className="py-2 px-2 text-center align-middle">
                          <select
                            value={addForm.discipline_id}
                            onChange={(e) =>
                              setAddForm((p) => ({
                                ...p,
                                discipline_id: e.target.value,
                                activity_id: '',
                                sub_activity_id: '',
                              }))
                            }
                            className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
                          >
                            <option value="">Select</option>
                            {disciplineOptions.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.function_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-2 text-center align-middle">
                          <select
                            value={addForm.activity_id}
                            disabled={!selectedDiscipline}
                            onChange={(e) =>
                              setAddForm((p) => ({
                                ...p,
                                activity_id: e.target.value,
                                sub_activity_id: '',
                              }))
                            }
                            className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none disabled:bg-gray-100"
                          >
                            <option value="">Select</option>
                            {(selectedDiscipline?.activities || []).map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.activity_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-2 text-center align-middle">
                          <select
                            value={addForm.sub_activity_id}
                            disabled={!selectedActivity?.subActivities?.length}
                            onChange={(e) =>
                              setAddForm((p) => ({
                                ...p,
                                sub_activity_id: e.target.value,
                              }))
                            }
                            className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none disabled:bg-gray-100"
                          >
                            <option value="">Select</option>
                            {(selectedActivity?.subActivities || []).map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-2 text-center align-middle">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={addForm.manhours_assigned}
                            onChange={(e) =>
                              setAddForm((p) => ({
                                ...p,
                                manhours_assigned: e.target.value,
                              }))
                            }
                            placeholder="Hrs"
                            className="w-20 px-2 py-1 text-xs border border-gray-300 rounded text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
                          />
                        </td>
                        <td className="py-2 px-2 text-center align-middle text-xs text-gray-400">
                          –
                        </td>
                        <td className="py-2 px-2 text-center align-middle">
                          <input
                            type="date"
                            value={addForm.start_date}
                            onChange={(e) =>
                              setAddForm((p) => ({
                                ...p,
                                start_date: e.target.value,
                              }))
                            }
                            className="px-2 py-1 text-xs border border-gray-300 rounded text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
                          />
                        </td>
                        <td className="py-2 px-2 text-center align-middle text-xs text-gray-400">
                          –
                        </td>
                        <td className="py-2 px-2 text-center align-middle text-xs text-gray-400">
                          –
                        </td>
                        <td className="py-2 px-2 text-center align-middle text-xs text-gray-400">
                          –
                        </td>
                        <td className="py-2 px-2 text-center align-middle">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => submitAdd(pid)}
                              disabled={saving}
                              className="p-1.5 text-green-600 hover:bg-green-100 rounded transition-colors disabled:opacity-50"
                              title="Save"
                            >
                              <CheckIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={closeAddRow}
                              disabled={saving}
                              className="p-1.5 text-[#4A1254] hover:bg-gray-100 rounded transition-colors"
                              title="Cancel"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
