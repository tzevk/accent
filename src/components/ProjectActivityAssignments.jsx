'use client';

import React, { useState, useEffect } from 'react';
import { fetchJSON } from '@/utils/http';
import { 
  ClipboardDocumentListIcon,
  CheckCircleIcon,
  PencilSquareIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

export default function ProjectActivityAssignments({ userId }) {
  const [assignments, setAssignments] = useState([]);
  const [stats, setStats] = useState({
    totalAssignments: 0,
    totalProjects: 0,
    totalQtyAssigned: 0,
    totalQtyCompleted: 0,
    totalPlannedHours: 0,
    totalActualHours: 0,
    completedCount: 0,
    inProgressCount: 0,
    notStartedCount: 0
  });
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all'); // all, pending, in-progress, completed

  useEffect(() => {
    if (!userId) return;
    
    const loadData = async () => {
      try {
        const res = await fetchJSON(`/api/users/${userId}/activity-assignments`);
        if (res.success) {
          setAssignments(res.data.assignments || []);
          setStats(res.data.stats || {});
        }
      } catch (err) {
        console.error('Failed to load activity assignments:', err);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [userId]);

  const loadAssignments = async () => {
    try {
      const res = await fetchJSON(`/api/users/${userId}/activity-assignments`);
      if (res.success) {
        setAssignments(res.data.assignments || []);
        setStats(res.data.stats || {});
      }
    } catch (err) {
      console.error('Failed to load activity assignments:', err);
    }
  };

  const startEditing = (assignment) => {
    setEditingId(`${assignment.project_id}-${assignment.activity_id}`);
    setEditForm({
      project_id: assignment.project_id,
      activity_id: assignment.activity_id,
      qty_completed: assignment.qty_completed || 0,
      actual_hours: assignment.actual_hours || 0,
      status: assignment.status || 'Not Started',
      remarks: assignment.remarks || ''
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveProgress = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}/activity-assignments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      const data = await res.json();
      if (data.success) {
        // Reload assignments
        await loadAssignments();
        setEditingId(null);
        setEditForm({});
      } else {
        alert('Failed to save: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to save progress:', err);
      alert('Failed to save progress');
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      'Completed': 'bg-green-100 text-green-700 border-green-200',
      'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
      'Not Started': 'bg-gray-100 text-gray-600 border-gray-200',
      'On Hold': 'bg-yellow-100 text-yellow-700 border-yellow-200'
    };
    return statusMap[status] || statusMap['Not Started'];
  };

  const filteredAssignments = assignments.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'pending') return a.status === 'Not Started';
    if (filter === 'in-progress') return a.status === 'In Progress';
    if (filter === 'completed') return a.status === 'Completed';
    return true;
  });

  // Group by project
  const groupedByProject = filteredAssignments.reduce((acc, a) => {
    const key = a.project_id;
    if (!acc[key]) {
      acc[key] = {
        project_id: a.project_id,
        project_name: a.project_name,
        project_code: a.project_code,
        activities: []
      };
    }
    acc[key].activities.push(a);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="text-center text-gray-500">Loading assignments...</div>
      </div>
    );
  }

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
          
          {/* Stats Pills */}
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
              {stats.notStartedCount} Pending
            </span>
            <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-xs font-medium">
              {stats.inProgressCount} In Progress
            </span>
            <span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-xs font-medium">
              {stats.completedCount} Completed
            </span>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 mt-3">
          {['all', 'pending', 'in-progress', 'completed'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                filter === f 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : f === 'in-progress' ? 'In Progress' : 'Completed'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {Object.keys(groupedByProject).length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <ClipboardDocumentListIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No activities assigned to you</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.values(groupedByProject).map(project => (
              <div key={project.project_id} className="border border-gray-200 rounded-lg overflow-hidden">
                {/* Project Header */}
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                  <p className="font-semibold text-gray-800 text-sm">{project.project_name}</p>
                  <p className="text-xs text-gray-500">{project.project_code} • {project.activities.length} activities</p>
                </div>

                {/* Activities Table */}
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium text-gray-500 uppercase">Activity</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500 uppercase">Discipline</th>
                      <th className="text-center py-2 px-2 font-medium text-gray-500 uppercase bg-purple-50">Qty Asgn</th>
                      <th className="text-center py-2 px-2 font-medium text-gray-500 uppercase bg-purple-50">Qty Done</th>
                      <th className="text-center py-2 px-2 font-medium text-gray-500 uppercase bg-blue-50">Plan Hrs</th>
                      <th className="text-center py-2 px-2 font-medium text-gray-500 uppercase bg-blue-50">Actual Hrs</th>
                      <th className="text-center py-2 px-2 font-medium text-gray-500 uppercase bg-blue-50">Due</th>
                      <th className="text-center py-2 px-2 font-medium text-gray-500 uppercase bg-blue-50">Status</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500 uppercase bg-amber-50">Remarks</th>
                      <th className="py-2 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.activities.map(activity => {
                      const rowKey = `${activity.project_id}-${activity.activity_id}`;
                      const isEditing = editingId === rowKey;

                      return (
                        <tr key={rowKey} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-medium text-gray-800">{activity.activity_name}</td>
                          <td className="py-2 px-2 text-gray-600">{activity.discipline}</td>
                          <td className="py-2 px-2 text-center bg-purple-50/50">{activity.qty_assigned || '–'}</td>
                          <td className="py-2 px-2 text-center bg-purple-50/50">
                            {isEditing ? (
                              <input
                                type="number"
                                value={editForm.qty_completed}
                                onChange={(e) => setEditForm({...editForm, qty_completed: e.target.value})}
                                className="w-14 px-1 py-0.5 text-xs border border-gray-300 rounded text-center"
                                min="0"
                              />
                            ) : (
                              activity.qty_completed || '–'
                            )}
                          </td>
                          <td className="py-2 px-2 text-center bg-blue-50/50">{activity.planned_hours || '–'}</td>
                          <td className="py-2 px-2 text-center bg-blue-50/50">
                            {isEditing ? (
                              <input
                                type="number"
                                value={editForm.actual_hours}
                                onChange={(e) => setEditForm({...editForm, actual_hours: e.target.value})}
                                className="w-14 px-1 py-0.5 text-xs border border-gray-300 rounded text-center"
                                min="0"
                                step="0.5"
                              />
                            ) : (
                              activity.actual_hours || '–'
                            )}
                          </td>
                          <td className="py-2 px-2 text-center bg-blue-50/50 text-gray-600">
                            {activity.due_date ? new Date(activity.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '–'}
                          </td>
                          <td className="py-2 px-2 text-center bg-blue-50/50">
                            {isEditing ? (
                              <select
                                value={editForm.status}
                                onChange={(e) => setEditForm({...editForm, status: e.target.value})}
                                className="px-1 py-0.5 text-xs border border-gray-300 rounded"
                              >
                                <option value="Not Started">Not Started</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Completed">Completed</option>
                                <option value="On Hold">On Hold</option>
                              </select>
                            ) : (
                              <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium border ${getStatusBadge(activity.status)}`}>
                                {activity.status}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 bg-amber-50/50">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editForm.remarks}
                                onChange={(e) => setEditForm({...editForm, remarks: e.target.value})}
                                className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded"
                                placeholder="Add remarks..."
                              />
                            ) : (
                              <span className="text-gray-600 truncate block max-w-[120px]" title={activity.remarks}>
                                {activity.remarks || '–'}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-center">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={saveProgress}
                                  disabled={saving}
                                  className="p-1 text-green-600 hover:bg-green-100 rounded"
                                  title="Save"
                                >
                                  <CheckCircleIcon className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={cancelEditing}
                                  className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                                  title="Cancel"
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEditing(activity)}
                                className="p-1 text-blue-600 hover:bg-blue-100 rounded"
                                title="Update Progress"
                              >
                                <PencilSquareIcon className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary Footer */}
      {assignments.length > 0 && (
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="text-gray-600">
              <span className="font-semibold text-purple-600">{stats.totalQtyCompleted}</span> / {stats.totalQtyAssigned} units completed
            </span>
            <span className="text-gray-600">
              <span className="font-semibold text-blue-600">{stats.totalActualHours}</span> / {stats.totalPlannedHours} hours logged
            </span>
          </div>
          <div className="text-gray-500">
            {Math.round((stats.completedCount / stats.totalAssignments) * 100) || 0}% activities completed
          </div>
        </div>
      )}
    </div>
  );
}
