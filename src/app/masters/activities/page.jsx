"use client";
/* eslint-disable @typescript-eslint/no-unused-vars */

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, TrashIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, PencilIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function ActivityMasterPage() {
  const [disciplines, setDisciplines] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Form inputs
  const [selectedDisciplineId, setSelectedDisciplineId] = useState('');
  const [selectedActivityId, setSelectedActivityId] = useState('');
  const [newItemInput, setNewItemInput] = useState('');
  const [manhoursInput, setManhoursInput] = useState('');
  
  // Edit state for sub-activity manhours
  const [editingSubActivity, setEditingSubActivity] = useState(null); // { id, manhours }
  
  // Expanded disciplines in the grouped view
  const [expandedDisciplines, setExpandedDisciplines] = useState(new Set());

  // Fetch disciplines with nested activities and sub-activities
  const fetchData = async () => {
    try {
      const res = await fetch('/api/activity-master');
      const json = await res.json();
      if (json.success && json.data) {
        setDisciplines(json.data);
        // Auto-expand all disciplines initially
        setExpandedDisciplines(new Set(json.data.map(d => d.id)));
      }
    } catch (err) {
      console.error('Failed to fetch activity master', err);
      setDisciplines([]);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Get activities for selected discipline (IDs are UUIDs/strings)
  const selectedDiscipline = disciplines.find(d => String(d.id) === String(selectedDisciplineId));
  const activitiesForDiscipline = selectedDiscipline?.activities || [];

  // Filter disciplines by search term
  const filteredDisciplines = useMemo(() => {
    if (!searchTerm) return disciplines;
    const term = searchTerm.toLowerCase();
    
    return disciplines.filter(discipline => {
      const matchDiscipline = discipline.function_name.toLowerCase().includes(term);
      const matchActivity = (discipline.activities || []).some(activity => {
        const activityMatch = activity.activity_name.toLowerCase().includes(term);
        const subActivityMatch = (activity.subActivities || []).some(sub => 
          sub.name.toLowerCase().includes(term)
        );
        return activityMatch || subActivityMatch;
      });
      return matchDiscipline || matchActivity;
    });
  }, [disciplines, searchTerm]);

  // Toggle discipline expansion
  const toggleDiscipline = (disciplineId) => {
    setExpandedDisciplines(prev => {
      const newSet = new Set(prev);
      if (newSet.has(disciplineId)) {
        newSet.delete(disciplineId);
      } else {
        newSet.add(disciplineId);
      }
      return newSet;
    });
  };

  // Determine what we're adding based on selections
  const getAddContext = () => {
    if (selectedActivityId) {
      return { type: 'sub-activity', label: 'Sub-Activity', placeholder: 'Enter sub-activity name' };
    } else if (selectedDisciplineId) {
      return { type: 'activity', label: 'Activity', placeholder: 'Enter activity name' };
    } else {
      return { type: 'discipline', label: 'Discipline', placeholder: 'Enter discipline name' };
    }
  };

  const addContext = getAddContext();

  // Unified Add Handler
  const handleAdd = async () => {
    if (!newItemInput.trim()) {
      setError(`Please enter ${addContext.label.toLowerCase()} name`);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      let res;
      
      if (addContext.type === 'sub-activity') {
        res = await fetch('/api/activity-master/subactivities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            activity_id: selectedActivityId, 
            name: newItemInput.trim(),
            default_manhours: manhoursInput ? parseFloat(manhoursInput) : 0
          }),
        });
      } else if (addContext.type === 'activity') {
        res = await fetch('/api/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            function_id: selectedDisciplineId, 
            activity_name: newItemInput.trim() 
          }),
        });
      } else {
        res = await fetch('/api/activity-master', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            function_name: newItemInput.trim(),
            status: 'active'
          }),
        });
      }
      
      if (res.ok) {
        await fetchData();
        setNewItemInput('');
        setManhoursInput('');
        // Expand the discipline if we added an activity
        if (addContext.type === 'activity') {
          setExpandedDisciplines(prev => new Set([...prev, selectedDisciplineId]));
        }
      } else {
        const data = await res.json();
        setError(data.error || `Failed to add ${addContext.label.toLowerCase()}`);
      }
    } catch (err) {
      console.error(`Failed to add ${addContext.type}`, err);
      setError(`Failed to add ${addContext.label.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  };

  // Delete Discipline
  const handleDeleteDiscipline = async (disciplineId) => {
    if (!confirm("Delete this discipline and all its activities?")) return;
    try {
      const res = await fetch(`/api/activity-master?id=${disciplineId}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
        if (selectedDisciplineId === String(disciplineId)) {
          setSelectedDisciplineId('');
          setSelectedActivityId('');
        }
      }
    } catch (err) {
      console.error('Failed to delete discipline', err);
    }
  };

  // Delete Activity
  const handleDeleteActivity = async (activityId) => {
    if (!confirm("Delete this activity and all its sub-activities?")) return;
    try {
      const res = await fetch(`/api/activities?id=${activityId}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
        if (selectedActivityId === String(activityId)) {
          setSelectedActivityId('');
        }
      }
    } catch (err) {
      console.error('Failed to delete activity', err);
    }
  };

  // Delete Sub-Activity
  const handleDeleteSubActivity = async (subId) => {
    if (!confirm("Delete this sub-activity?")) return;
    try {
      const res = await fetch(`/api/activity-master/subactivities?id=${subId}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error('Failed to delete sub-activity', err);
    }
  };

  // Update Sub-Activity Manhours
  const handleUpdateSubActivity = async () => {
    if (!editingSubActivity) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/activity-master/subactivities', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingSubActivity.id,
          default_manhours: editingSubActivity.manhours ? parseFloat(editingSubActivity.manhours) : 0
        })
      });
      
      if (res.ok) {
        await fetchData();
        setEditingSubActivity(null);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update manhours');
      }
    } catch (err) {
      console.error('Failed to update sub-activity', err);
      setError('Failed to update manhours');
    } finally {
      setLoading(false);
    }
  };

  // Count totals
  const totalActivities = disciplines.reduce((sum, d) => sum + (d.activities?.length || 0), 0);
  const totalSubActivities = disciplines.reduce((sum, d) => 
    sum + (d.activities || []).reduce((s, a) => s + (a.subActivities?.length || 0), 0), 0
  );

  return (
    <AccessGuard resource="activities" permission="read" showNavbar={false}>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Activity Master</h1>
            <p className="text-sm text-gray-600">
              Configure disciplines, activities and sub-activities for projects
            </p>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg flex justify-between items-center">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold">×</button>
            </div>
          )}

          {/* Input Section - Simplified Step Flow */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex flex-wrap items-end gap-4">
              
              {/* Step 1: Discipline (optional - select existing or leave blank for new) */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  1. Discipline {selectedDisciplineId && <span className="text-green-600">✓</span>}
                </label>
                <select
                  value={selectedDisciplineId}
                  onChange={(e) => {
                    setSelectedDisciplineId(e.target.value);
                    setSelectedActivityId('');
                    setNewItemInput('');
                    setManhoursInput('');
                  }}
                  className="w-52 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white"
                >
                  <option value="">+ New Discipline</option>
                  {disciplines.map(d => (
                    <option key={d.id} value={d.id}>{d.function_name}</option>
                  ))}
                </select>
              </div>

              {/* Step 2: Activity (only if discipline selected) */}
              {selectedDisciplineId && (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
                    2. Activity {selectedActivityId && <span className="text-green-600">✓</span>}
                  </label>
                  <select
                    value={selectedActivityId}
                    onChange={(e) => {
                      setSelectedActivityId(e.target.value);
                      setNewItemInput('');
                      setManhoursInput('');
                    }}
                    className="w-52 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent bg-white"
                  >
                    <option value="">+ New Activity</option>
                    {activitiesForDiscipline.map(a => (
                      <option key={a.id} value={a.id}>{a.activity_name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Arrow indicator */}
              <div className="flex items-center text-gray-400 pb-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>

              {/* Dynamic Input - changes based on context */}
              <div className="flex-1 min-w-[200px] space-y-1">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Add {addContext.label}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newItemInput}
                    onChange={(e) => setNewItemInput(e.target.value)}
                    placeholder={addContext.placeholder}
                    className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                    onKeyDown={(e) => e.key === 'Enter' && !selectedActivityId && handleAdd()}
                  />
                  {/* Manhours input - only for sub-activities */}
                  {selectedActivityId && (
                    <input
                      type="number"
                      value={manhoursInput}
                      onChange={(e) => setManhoursInput(e.target.value)}
                      placeholder="Manhours"
                      min="0"
                      step="0.5"
                      className="w-28 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                      onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    />
                  )}
                  <button
                    onClick={handleAdd}
                    disabled={loading || !newItemInput.trim()}
                    className="px-5 py-2.5 bg-[#4472C4] text-white rounded-lg text-sm font-medium hover:bg-[#3961a8] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                  >
                    <PlusIcon className="w-4 h-4" />
                    Add {addContext.label}
                  </button>
                </div>
              </div>
            </div>

            {/* Helper text */}
            <p className="mt-4 text-xs text-gray-500">
              {!selectedDisciplineId && "Start by selecting an existing discipline or type a new one to create it."}
              {selectedDisciplineId && !selectedActivityId && `Adding activity to "${selectedDiscipline?.function_name}". Select an activity to add sub-activities.`}
              {selectedActivityId && `Adding sub-activity to "${activitiesForDiscipline.find(a => String(a.id) === String(selectedActivityId))?.activity_name}".`}
            </p>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-[#7F2487]">{disciplines.length}</div>
              <div className="text-sm text-gray-600">Disciplines</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-[#4472C4]">{totalActivities}</div>
              <div className="text-sm text-gray-600">Activities</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-green-600">{totalSubActivities}</div>
              <div className="text-sm text-gray-600">Sub-Activities</div>
            </div>
          </div>

          {/* Grouped Table Section */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* Search Bar */}
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search disciplines, activities or sub-activities…"
                className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
              />
              <div className="flex gap-2 ml-4">
                <button
                  onClick={() => setExpandedDisciplines(new Set(disciplines.map(d => d.id)))}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded border border-gray-300"
                >
                  Expand All
                </button>
                <button
                  onClick={() => setExpandedDisciplines(new Set())}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded border border-gray-300"
                >
                  Collapse All
                </button>
              </div>
            </div>

            {/* Grouped Display */}
            <div className="divide-y divide-gray-200">
              {filteredDisciplines.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  <p className="text-lg font-medium">No disciplines found</p>
                  <p className="text-sm mt-1">Add your first discipline using the form above</p>
                </div>
              ) : (
                filteredDisciplines.map((discipline) => {
                  const isExpanded = expandedDisciplines.has(discipline.id);
                  const activities = discipline.activities || [];
                  
                  return (
                    <div key={discipline.id} className="bg-white">
                      {/* Discipline Header */}
                      <div 
                        className="flex items-center justify-between px-4 py-3 bg-[#7F2487]/5 hover:bg-[#7F2487]/10 cursor-pointer"
                        onClick={() => toggleDiscipline(discipline.id)}
                      >
                        <div className="flex items-center gap-3">
                          {isExpanded ? (
                            <ChevronDownIcon className="w-5 h-5 text-[#7F2487]" />
                          ) : (
                            <ChevronRightIcon className="w-5 h-5 text-[#7F2487]" />
                          )}
                          <span className="font-semibold text-[#7F2487]">{discipline.function_name}</span>
                          <span className="text-xs bg-[#7F2487]/20 text-[#7F2487] px-2 py-0.5 rounded-full">
                            {activities.length} activities
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDiscipline(discipline.id);
                          }}
                          className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                          title="Delete discipline"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Activities & Sub-Activities Table */}
                      {isExpanded && (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                              <tr>
                                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-16">
                                  Sr.
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                  Activity
                                </th>
                                <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">
                                  
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                  Sub-Activity
                                </th>
                                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">
                                  Manhours
                                </th>
                                <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">
                                  
                                </th>
                                <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-20">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {activities.length === 0 ? (
                                <tr>
                                  <td colSpan={7} className="px-6 py-4 text-center text-gray-400 text-sm italic">
                                    No activities yet. Add one using the form above.
                                  </td>
                                </tr>
                              ) : (
                                activities.map((activity, actIdx) => {
                                  const subActivities = activity.subActivities || [];
                                  
                                  if (subActivities.length === 0) {
                                    return (
                                      <tr key={activity.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-2.5 text-sm text-gray-500">
                                          {actIdx + 1}
                                        </td>
                                        <td className="px-4 py-2.5 text-sm text-gray-900 font-medium">
                                          {activity.activity_name}
                                        </td>
                                        <td className="px-4 py-2.5 text-center">
                                          <CheckIcon className="w-5 h-5 text-green-500 mx-auto" />
                                        </td>
                                        <td className="px-4 py-2.5 text-sm text-gray-400 italic">
                                          —
                                        </td>
                                        <td className="px-4 py-2.5 text-right text-sm text-gray-400">
                                          —
                                        </td>
                                        <td className="px-4 py-2.5 text-center">
                                          
                                        </td>
                                        <td className="px-4 py-2.5 text-center">
                                          <button
                                            onClick={() => handleDeleteActivity(activity.id)}
                                            className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                            title="Delete activity"
                                          >
                                            <TrashIcon className="w-4 h-4" />
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  }
                                  
                                  return subActivities.map((sub, subIdx) => (
                                    <tr key={`${activity.id}-${sub.id}`} className="hover:bg-gray-50">
                                      <td className="px-6 py-2.5 text-sm text-gray-500">
                                        {subIdx === 0 ? `${actIdx + 1}` : ''}
                                      </td>
                                      <td className="px-4 py-2.5 text-sm text-gray-900 font-medium">
                                        {subIdx === 0 ? activity.activity_name : ''}
                                      </td>
                                      <td className="px-4 py-2.5 text-center">
                                        {subIdx === 0 && <CheckIcon className="w-5 h-5 text-green-500 mx-auto" />}
                                      </td>
                                      <td className="px-4 py-2.5 text-sm text-gray-700">
                                        {sub.name}
                                      </td>
                                      <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-700">
                                        {editingSubActivity?.id === sub.id ? (
                                          <div className="flex items-center justify-end gap-1">
                                            <input
                                              type="number"
                                              value={editingSubActivity.manhours}
                                              onChange={(e) => setEditingSubActivity({ ...editingSubActivity, manhours: e.target.value })}
                                              className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#7F2487] focus:border-transparent text-right"
                                              min="0"
                                              step="0.5"
                                              autoFocus
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleUpdateSubActivity();
                                                if (e.key === 'Escape') setEditingSubActivity(null);
                                              }}
                                            />
                                            <button
                                              onClick={handleUpdateSubActivity}
                                              className="p-1 text-green-600 hover:text-green-700 hover:bg-green-50 rounded"
                                              title="Save"
                                            >
                                              <CheckIcon className="w-4 h-4" />
                                            </button>
                                            <button
                                              onClick={() => setEditingSubActivity(null)}
                                              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                                              title="Cancel"
                                            >
                                              <XMarkIcon className="w-4 h-4" />
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center justify-end gap-1 group">
                                            <span>{sub.default_manhours ? `${sub.default_manhours} hrs` : '—'}</span>
                                            <button
                                              onClick={() => setEditingSubActivity({ id: sub.id, manhours: sub.default_manhours || '' })}
                                              className="p-1 text-gray-400 hover:text-[#7F2487] hover:bg-purple-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                              title="Edit manhours"
                                            >
                                              <PencilIcon className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-2.5 text-center">
                                        <CheckIcon className="w-5 h-5 text-green-500 mx-auto" />
                                      </td>
                                      <td className="px-4 py-2.5 text-center">
                                        <div className="flex justify-center gap-1">
                                          <button
                                            onClick={() => handleDeleteSubActivity(sub.id)}
                                            className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                            title="Delete sub-activity"
                                          >
                                            <TrashIcon className="w-4 h-4" />
                                          </button>
                                          {subIdx === 0 && subActivities.length > 0 && (
                                            <button
                                              onClick={() => handleDeleteActivity(activity.id)}
                                              className="p-1 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded"
                                              title="Delete entire activity"
                                            >
                                              <TrashIcon className="w-4 h-4" />
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  ));
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </AccessGuard>
  );
}
