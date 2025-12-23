"use client";

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, TrashIcon, CheckIcon, PencilIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function ActivityMasterPage() {
  const [disciplines, setDisciplines] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Form inputs
  const [selectedDisciplineId, setSelectedDisciplineId] = useState('');
  const [newItemInput, setNewItemInput] = useState('');
  const [manhoursInput, setManhoursInput] = useState('');
  
  // Edit state for activity manhours
  const [editingActivity, setEditingActivity] = useState(null); // { id, manhours }

  // Fetch disciplines with nested activities
  const fetchData = async () => {
    try {
      const res = await fetch('/api/activity-master');
      const json = await res.json();
      if (json.success && json.data) {
        setDisciplines(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch activity master', err);
      setDisciplines([]);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Get activities for selected discipline
  const selectedDiscipline = disciplines.find(d => String(d.id) === String(selectedDisciplineId));

  // Filter disciplines by search term
  const filteredDisciplines = useMemo(() => {
    if (!searchTerm) return disciplines;
    const term = searchTerm.toLowerCase();
    
    return disciplines.filter(discipline => {
      const matchDiscipline = discipline.function_name.toLowerCase().includes(term);
      const matchActivity = (discipline.activities || []).some(activity => 
        activity.activity_name.toLowerCase().includes(term)
      );
      return matchDiscipline || matchActivity;
    });
  }, [disciplines, searchTerm]);

  // Determine what we're adding based on selections
  const getAddContext = () => {
    if (selectedDisciplineId) {
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
      
      if (addContext.type === 'activity') {
        res = await fetch('/api/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            function_id: selectedDisciplineId, 
            activity_name: newItemInput.trim(),
            default_manhours: manhoursInput ? parseFloat(manhoursInput) : 0
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
        }
      }
    } catch (err) {
      console.error('Failed to delete discipline', err);
    }
  };

  // Delete Activity
  const handleDeleteActivity = async (activityId) => {
    if (!confirm("Delete this activity?")) return;
    try {
      const res = await fetch(`/api/activities?id=${activityId}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error('Failed to delete activity', err);
    }
  };

  // Update Activity Manhours
  const handleUpdateActivity = async () => {
    if (!editingActivity) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/activities', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingActivity.id,
          default_manhours: editingActivity.manhours ? parseFloat(editingActivity.manhours) : 0
        })
      });
      
      if (res.ok) {
        await fetchData();
        setEditingActivity(null);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update manhours');
      }
    } catch (err) {
      console.error('Failed to update activity', err);
      setError('Failed to update manhours');
    } finally {
      setLoading(false);
    }
  };

  // Count totals
  const totalActivities = disciplines.reduce((sum, d) => sum + (d.activities?.length || 0), 0);

  return (
    <AccessGuard resource="activities" permission="read" showNavbar={false}>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Activity Master</h1>
            <p className="text-sm text-gray-600">
              Configure disciplines and activities for projects
            </p>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg flex justify-between items-center">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold">×</button>
            </div>
          )}

          {/* Input Section */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex flex-wrap items-end gap-4">
              
              {/* Step 1: Discipline */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  1. Discipline {selectedDisciplineId && <span className="text-green-600">✓</span>}
                </label>
                <select
                  value={selectedDisciplineId}
                  onChange={(e) => {
                    setSelectedDisciplineId(e.target.value);
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

              {/* Arrow indicator */}
              <div className="flex items-center text-gray-400 pb-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>

              {/* Dynamic Input */}
              <div className="flex-1 min-w-[200px] space-y-1">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {selectedDisciplineId ? '2. Add Activity' : 'Add Discipline'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newItemInput}
                    onChange={(e) => setNewItemInput(e.target.value)}
                    placeholder={addContext.placeholder}
                    className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  />
                  {/* Manhours input - only for activities */}
                  {selectedDisciplineId && (
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
              {selectedDisciplineId && `Adding activity to "${selectedDiscipline?.function_name}".`}
            </p>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-[#7F2487]">{disciplines.length}</div>
              <div className="text-sm text-gray-600">Disciplines</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-[#4472C4]">{totalActivities}</div>
              <div className="text-sm text-gray-600">Activities</div>
            </div>
          </div>

          {/* Table Section */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* Search Bar */}
            <div className="p-4 border-b border-gray-200">
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search disciplines or activities…"
                className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
              />
            </div>

            {/* Table Display */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">
                      Sr.
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Discipline
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Activity
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-32">
                      Manhours
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(() => {
                    // Flatten the data into rows
                    const rows = [];
                    let srNo = 0;
                    
                    filteredDisciplines.forEach((discipline) => {
                      const activities = discipline.activities || [];
                      
                      if (activities.length === 0) {
                        // Discipline with no activities
                        srNo++;
                        rows.push({
                          key: `d-${discipline.id}`,
                          srNo,
                          discipline: discipline,
                          activity: null,
                          type: 'discipline-only',
                          isFirstInDiscipline: true,
                          activityCount: 0
                        });
                      } else {
                        // Each activity gets a row
                        activities.forEach((activity, actIdx) => {
                          srNo++;
                          rows.push({
                            key: `a-${activity.id}`,
                            srNo,
                            discipline: discipline,
                            activity: activity,
                            type: 'full',
                            isFirstInDiscipline: actIdx === 0,
                            activityCount: activities.length
                          });
                        });
                      }
                    });

                    if (rows.length === 0) {
                      return (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                            <p className="text-lg font-medium">No data found</p>
                            <p className="text-sm mt-1">Add disciplines and activities using the form above</p>
                          </td>
                        </tr>
                      );
                    }

                    return rows.map((row) => (
                      <tr key={row.key} className={`hover:bg-gray-50 ${row.isFirstInDiscipline ? 'border-t-2 border-gray-200' : ''}`}>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {row.srNo}
                        </td>
                        <td className="px-4 py-3">
                          {row.isFirstInDiscipline ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[#7F2487]">
                                {row.discipline.function_name}
                              </span>
                              {row.activityCount > 0 && (
                                <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                  {row.activityCount}
                                </span>
                              )}
                              {row.type === 'discipline-only' && (
                                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                  No activities
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-300">↳</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {row.activity ? (
                            <span className="text-sm text-gray-900">{row.activity.activity_name}</span>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.activity ? (
                            editingActivity?.id === row.activity.id ? (
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  value={editingActivity.manhours}
                                  onChange={(e) => setEditingActivity({ ...editingActivity, manhours: e.target.value })}
                                  className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#7F2487] focus:border-transparent text-right"
                                  min="0"
                                  step="0.5"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleUpdateActivity();
                                    if (e.key === 'Escape') setEditingActivity(null);
                                  }}
                                />
                                <button
                                  onClick={handleUpdateActivity}
                                  className="p-1 text-green-600 hover:text-green-700 hover:bg-green-50 rounded"
                                  title="Save"
                                >
                                  <CheckIcon className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setEditingActivity(null)}
                                  className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                                  title="Cancel"
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1 group">
                                <span className="text-sm font-medium text-gray-700">
                                  {row.activity.default_manhours ? `${row.activity.default_manhours} hrs` : '—'}
                                </span>
                                <button
                                  onClick={() => setEditingActivity({ id: row.activity.id, manhours: row.activity.default_manhours || '' })}
                                  className="p-1 text-gray-400 hover:text-[#7F2487] hover:bg-purple-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Edit manhours"
                                >
                                  <PencilIcon className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex justify-center gap-1">
                            {/* Delete Activity */}
                            {row.activity && (
                              <button
                                onClick={() => handleDeleteActivity(row.activity.id)}
                                className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                title="Delete activity"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            )}
                            {/* Delete Discipline (show if no activity) */}
                            {!row.activity && (
                              <button
                                onClick={() => handleDeleteDiscipline(row.discipline.id)}
                                className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                title="Delete discipline"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AccessGuard>
  );
}
