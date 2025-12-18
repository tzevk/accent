'use client';

import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, PlusIcon, TrashIcon, UserIcon, ClockIcon } from '@heroicons/react/24/outline';
import { fetchJSON } from '@/utils/http';

export default function ActivityAssignmentModal({ isOpen, onClose, projectId, onSuccess }) {
  const [users, setUsers] = useState([]);
  const [projectActivities, setProjectActivities] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newAssignment, setNewAssignment] = useState({
    user_id: '',
    activity_name: '',
    activity_description: '',
    due_date: '',
    priority: 'MEDIUM',
    estimated_hours: ''
  });

  // Priority options
  const PRIORITY_OPTIONS = [
    { value: 'LOW', label: 'Low', color: 'bg-green-100 text-green-800' },
    { value: 'MEDIUM', label: 'Medium', color: 'bg-yellow-100 text-yellow-800' },
    { value: 'HIGH', label: 'High', color: 'bg-orange-100 text-orange-800' },
    { value: 'URGENT', label: 'Urgent', color: 'bg-red-100 text-red-800' }
  ];

  // Load users and existing assignments when modal opens
  useEffect(() => {
    if (isOpen && projectId) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load users from User Master
      const usersRes = await fetchJSON('/api/users?limit=10000');
      if (usersRes && usersRes.success && Array.isArray(usersRes.data)) {
        setUsers(usersRes.data);
      }

      // Load project activities (scope activities)
      const projRes = await fetchJSON(`/api/projects/${projectId}`);
      if (projRes.success && projRes.data) {
        // Parse scope activities from project
        const scopeActivities = projRes.data.scope_activities ? 
          (typeof projRes.data.scope_activities === 'string' 
            ? JSON.parse(projRes.data.scope_activities) 
            : projRes.data.scope_activities) 
          : [];
        setProjectActivities(scopeActivities);
      }

      // Load existing assignments
      const assignRes = await fetchJSON(`/api/projects/${projectId}/assign-activities`);
      if (assignRes.success && assignRes.data) {
        setAssignments(assignRes.data);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAssignment = () => {
    if (!newAssignment.user_id || !newAssignment.activity_name) {
      alert('Please select a user and activity');
      return;
    }

    const assignment = {
      user_id: parseInt(newAssignment.user_id),
      activity_name: newAssignment.activity_name,
      activity_description: newAssignment.activity_description,
      due_date: newAssignment.due_date,
      priority: newAssignment.priority,
      estimated_hours: parseFloat(newAssignment.estimated_hours) || 0,
      status: 'NOT_STARTED'
    };

    setSaving(true);
    
    // Save assignment immediately
    fetchJSON(`/api/projects/${projectId}/assign-activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activities: [assignment] })
    })
      .then((result) => {
        if (result.success) {
          // Reload assignments
          loadData();
          // Reset form
          setNewAssignment({
            user_id: '',
            activity_name: '',
            activity_description: '',
            due_date: '',
            priority: 'MEDIUM',
            estimated_hours: ''
          });
          if (onSuccess) onSuccess();
        } else {
          alert(result.error || 'Failed to assign activity');
        }
      })
      .catch((error) => {
        console.error('Assignment error:', error);
        alert('Failed to assign activity');
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const handleRemoveAssignment = async (assignmentId) => {
    if (!confirm('Are you sure you want to remove this assignment?')) return;

    try {
      const result = await fetchJSON(`/api/projects/${projectId}/assign-activities?id=${assignmentId}`, {
        method: 'DELETE'
      });

      if (result.success) {
        loadData();
        if (onSuccess) onSuccess();
      } else {
        alert(result.error || 'Failed to remove assignment');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to remove assignment');
    }
  };

  const getUserName = (userId) => {
    const user = users.find(u => u.id === userId);
    return user ? (user.full_name || user.username) : 'Unknown';
  };

  const getPriorityBadge = (priority) => {
    const p = PRIORITY_OPTIONS.find(o => o.value === priority) || PRIORITY_OPTIONS[1];
    return <span className={`px-2 py-0.5 text-xs rounded ${p.color}`}>{p.label}</span>;
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-4xl transform overflow-hidden rounded-lg bg-white shadow-xl transition-all">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#7F2487] to-[#9b2fa6] px-6 py-4">
                  <div className="flex items-center justify-between">
                    <Dialog.Title className="text-lg font-semibold text-white">
                      Assign Activities to Team Members
                    </Dialog.Title>
                    <button
                      onClick={onClose}
                      className="text-white hover:text-gray-200 transition-colors"
                    >
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="px-6 py-12 text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#7F2487] border-r-transparent"></div>
                    <p className="mt-4 text-sm text-gray-600">Loading...</p>
                  </div>
                ) : (
                  <>
                    {/* Add New Assignment Form */}
                    <div className="border-b border-gray-200 bg-gray-50 px-6 py-5">
                      <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <PlusIcon className="h-4 w-4 text-[#7F2487]" />
                        New Assignment
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Team Member *
                          </label>
                          <select
                            value={newAssignment.user_id}
                            onChange={(e) => setNewAssignment({ ...newAssignment, user_id: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                          >
                            <option value="">Select team member</option>
                            {users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.full_name || user.username}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Activity *
                          </label>
                          <select
                            value={newAssignment.activity_name}
                            onChange={(e) => {
                              const selected = projectActivities.find(a => a.name === e.target.value);
                              setNewAssignment({
                                ...newAssignment,
                                activity_name: e.target.value,
                                activity_description: selected?.description || ''
                              });
                            }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                          >
                            <option value="">Select activity</option>
                            {projectActivities.map((activity, idx) => (
                              <option key={idx} value={activity.name}>
                                {activity.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Due Date
                          </label>
                          <input
                            type="date"
                            value={newAssignment.due_date}
                            onChange={(e) => setNewAssignment({ ...newAssignment, due_date: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Priority
                          </label>
                          <select
                            value={newAssignment.priority}
                            onChange={(e) => setNewAssignment({ ...newAssignment, priority: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                          >
                            {PRIORITY_OPTIONS.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Estimated Hours
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={newAssignment.estimated_hours}
                            onChange={(e) => setNewAssignment({ ...newAssignment, estimated_hours: e.target.value })}
                            placeholder="0"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Description
                          </label>
                          <input
                            type="text"
                            value={newAssignment.activity_description}
                            onChange={(e) => setNewAssignment({ ...newAssignment, activity_description: e.target.value })}
                            placeholder="Optional description"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                          />
                        </div>
                      </div>

                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          onClick={handleAddAssignment}
                          disabled={saving || !newAssignment.user_id || !newAssignment.activity_name}
                          className="px-4 py-2 bg-[#7F2487] text-white text-sm font-medium rounded-md hover:bg-[#6a1e73] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                        >
                          <PlusIcon className="h-4 w-4" />
                          {saving ? 'Adding...' : 'Add Assignment'}
                        </button>
                      </div>
                    </div>

                    {/* Existing Assignments List */}
                    <div className="px-6 py-5 max-h-[400px] overflow-y-auto">
                      <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <UserIcon className="h-4 w-4 text-[#7F2487]" />
                        Assigned Activities ({assignments.length})
                      </h3>

                      {assignments.length === 0 ? (
                        <div className="text-center py-8 text-sm text-gray-500">
                          No activities assigned yet. Add your first assignment above.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {Object.entries(
                            assignments.reduce((acc, assign) => {
                              if (!acc[assign.user_id]) {
                                acc[assign.user_id] = [];
                              }
                              acc[assign.user_id].push(assign);
                              return acc;
                            }, {})
                          ).map(([userId, userAssignments]) => (
                            <div key={userId} className="border border-gray-200 rounded-lg overflow-hidden">
                              <div className="bg-purple-50 px-4 py-2 border-b border-purple-100">
                                <h4 className="text-sm font-semibold text-[#7F2487] flex items-center gap-2">
                                  <UserIcon className="h-4 w-4" />
                                  {getUserName(parseInt(userId))}
                                  <span className="text-xs font-normal text-gray-600">
                                    ({userAssignments.length} {userAssignments.length === 1 ? 'activity' : 'activities'})
                                  </span>
                                </h4>
                              </div>
                              <div className="divide-y divide-gray-100">
                                {userAssignments.map((assign) => (
                                  <div
                                    key={assign.id}
                                    className="px-4 py-3 hover:bg-gray-50 transition-colors"
                                  >
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          <p className="text-sm font-medium text-gray-900">
                                            {assign.activity_name}
                                          </p>
                                          {getPriorityBadge(assign.priority)}
                                          <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700">
                                            {assign.status.replace('_', ' ')}
                                          </span>
                                        </div>
                                        {assign.activity_description && (
                                          <p className="text-xs text-gray-600 mb-2">
                                            {assign.activity_description}
                                          </p>
                                        )}
                                        <div className="flex items-center gap-4 text-xs text-gray-500">
                                          {assign.due_date && (
                                            <span className="flex items-center gap-1">
                                              <ClockIcon className="h-3 w-3" />
                                              Due: {new Date(assign.due_date).toLocaleDateString()}
                                            </span>
                                          )}
                                          {assign.estimated_hours > 0 && (
                                            <span>Est. {assign.estimated_hours}h</span>
                                          )}
                                        </div>
                                      </div>
                                      <button
                                        onClick={() => handleRemoveAssignment(assign.id)}
                                        className="flex-shrink-0 text-red-500 hover:text-red-700 transition-colors p-1"
                                        title="Remove assignment"
                                      >
                                        <TrashIcon className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-end">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300 transition-colors"
                      >
                        Close
                      </button>
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
