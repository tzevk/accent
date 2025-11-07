"use client";

import Navbar from '@/components/Navbar';
import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';

// Fixed disciplines (cannot be edited)
const FIXED_DISCIPLINES = [
  { name: 'PROCESS ENGINEERING' },
  { name: 'CIVIL/STRUCTURAL' },
  { name: 'MECHANICAL', children: ['STATIC', 'ROTATING'] },
  { name: 'PIPING' },
  { name: 'FIREFIGHTING' },
  { name: 'HVAC' },
  { name: 'ELECTRICAL' },
  { name: 'INSTRUMENTATION' },
  { name: 'PROJECT MANAGEMENT' },
];

// Empty sub-activity object
const EMPTY_SUB_ACTIVITY = {
  name: "",
  defaultDuration: 0,
  defaultManhours: 0,
};

export default function ActivityMasterPage() {
  const [disciplines, setDisciplines] = useState([]);
  // disciplineForm and discipline editing removed — disciplines are fixed
  const [disciplineForm, setDisciplineForm] = useState({ name: '', description: '', status: 'active' });
  const [subActivityForm, setSubActivityForm] = useState(EMPTY_SUB_ACTIVITY);
  const [selectedDisciplineId, setSelectedDisciplineId] = useState(null);
  const [selectedActivityId, setSelectedActivityId] = useState(null);
  const [editingSubId, setEditingSubId] = useState(null);
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [showDisciplineForm, setShowDisciplineForm] = useState(false);
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [showSubActivityForm, setShowSubActivityForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activities, setActivities] = useState([]);
  const [subActivities, setSubActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activityForm, setActivityForm] = useState({ activity_name: '' });
  

  // Fetch disciplines with nested activities and sub-activities
  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/activity-master');
        const json = await res.json();
        if (json.success && json.data) {
          // Expected shape: [{ id, function_name, activities: [{ id, activity_name, subActivities: [...] }] }]
          setDisciplines(json.data);
        }
      } catch (err) {
        console.error('Failed to fetch activity master', err);
        setDisciplines([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  

  // Load activities when discipline is selected
  useEffect(() => {
    if (!selectedDisciplineId) {
      setActivities([]);
      setSelectedActivityId(null);
      return;
    }
    const discipline = disciplines.find((d) => d.id === selectedDisciplineId);
    if (discipline) {
      setActivities(discipline.activities || []);
    }
  }, [selectedDisciplineId, disciplines]);

  // Load sub-activities when activity is selected
  useEffect(() => {
    if (!selectedActivityId) {
      setSubActivities([]);
      return;
    }
    const activity = activities.find((a) => a.id === selectedActivityId);
    if (activity) {
      setSubActivities(activity.subActivities || []);
    }
  }, [selectedActivityId, activities]);

  // Filter disciplines by search term
  const filteredDisciplines = useMemo(() => {
    if (!searchTerm) return disciplines;
    const term = searchTerm.toLowerCase();
    return disciplines.filter((discipline) => {
      const matchDiscipline = String(discipline.function_name || discipline.name || '').toLowerCase().includes(term);
      const matchActivity = (discipline.activities || []).some((activity) => {
        const activityMatch = String(activity.activity_name || activity.name || '').toLowerCase().includes(term);
        const subActivityMatch = (activity.subActivities || []).some((sub) => {
          return String(sub.name || '').toLowerCase().includes(term);
        });
        return activityMatch || subActivityMatch;
      });
      return matchDiscipline || matchActivity;
    });
  }, [disciplines, searchTerm]);

  const selectedDiscipline = useMemo(
    () => disciplines.find((d) => d.id === selectedDisciplineId) || null,
    [disciplines, selectedDisciplineId]
  );

  const selectedActivity = useMemo(
    () => activities.find((a) => a.id === selectedActivityId) || null,
    [activities, selectedActivityId]
  );

  // Discipline management removed — disciplines are fixed list
  const handleCreateDiscipline = () => {
    setDisciplineForm({ name: '', description: '', status: 'active' });
    setShowDisciplineForm(true);
  };

  const handleDisciplineSubmit = async (e) => {
    e.preventDefault();
    const name = disciplineForm.name?.trim();
    if (!name) return;

    try {
      const res = await fetch('/api/activity-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          function_name: name,
          description: disciplineForm.description || '',
          status: disciplineForm.status || 'active',
        }),
      });
      if (res.ok) {
        // Refresh list and close form
        const disciplinesRes = await fetch('/api/activity-master');
        const disciplinesJson = await disciplinesRes.json();
        if (disciplinesJson.success) {
          setDisciplines(disciplinesJson.data);
        }
        setShowDisciplineForm(false);
        setDisciplineForm({ name: '', description: '', status: 'active' });
      }
    } catch (err) {
      console.error('Failed to create discipline', err);
    }
  };

  // Create Activity
  const handleCreateActivity = (disciplineId) => {
    setSelectedDisciplineId(disciplineId);
    setActivityForm({ activity_name: '' });
    setShowActivityForm(true);
  };

  // Create Sub-Activity
  const handleCreateSubActivity = (activityId) => {
    setSelectedActivityId(activityId);
    setSubActivityForm(EMPTY_SUB_ACTIVITY);
    setEditingSubId(null);
    setShowSubActivityForm(true);
  };

  // Edit Activity
  const handleEditActivity = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    if (activity) {
      setActivityForm({ activity_name: activity.activity_name });
      setEditingActivityId(activityId);
      setShowActivityForm(true);
    }
  };

  // Delete Activity
  const handleDeleteActivity = async (activityId) => {
    if (!confirm("Delete this activity and all its sub-activities?")) return;
    try {
      const res = await fetch(`/api/activities?id=${activityId}`, { method: "DELETE" });
      if (res.ok) {
        // Refresh disciplines to get updated data
        const disciplinesRes = await fetch('/api/activity-master');
        const disciplinesJson = await disciplinesRes.json();
        if (disciplinesJson.success) {
          setDisciplines(disciplinesJson.data);
          // Clear selected activity if it was deleted
          if (selectedActivityId === activityId) {
            setSelectedActivityId(null);
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete activity', err);
    }
  };

  // Edit and delete handlers for sub-activities
  const handleEditSubActivity = (subId) => {
    // TODO: Implement edit functionality
    console.log('Edit sub-activity:', subId);
  };

  const handleDeleteSubActivity = async (subId) => {
    if (!confirm("Delete this sub-activity?")) return;
    try {
      const res = await fetch(`/api/activity-master/subactivities?id=${subId}`, { method: "DELETE" });
      if (res.ok) {
        // Refresh disciplines to get updated data
        const disciplinesRes = await fetch('/api/activity-master');
        const disciplinesJson = await disciplinesRes.json();
        if (disciplinesJson.success) {
          setDisciplines(disciplinesJson.data);
        }
      }
    } catch (err) {
      console.error('Failed to delete sub-activity', err);
    }
  };

  // Save Activity (create or update)
  const handleActivitySubmit = async (e) => {
    e.preventDefault();
    if (!selectedDisciplineId || !activityForm.activity_name.trim()) return;

    try {
      if (editingActivityId) {
        // Update existing activity
        const res = await fetch('/api/activities', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingActivityId, activity_name: activityForm.activity_name }),
        });
        
        if (res.ok) {
          // Refresh disciplines to get updated activities
          const disciplinesRes = await fetch('/api/activity-master');
          const disciplinesJson = await disciplinesRes.json();
          if (disciplinesJson.success) {
            setDisciplines(disciplinesJson.data);
          }
        }
      } else {
        // Create new activity
        const res = await fetch('/api/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ function_id: selectedDisciplineId, activity_name: activityForm.activity_name }),
        });
        
        if (res.ok) {
          // Refresh disciplines to get updated activities
          const disciplinesRes = await fetch('/api/activity-master');
          const disciplinesJson = await disciplinesRes.json();
          if (disciplinesJson.success) {
            setDisciplines(disciplinesJson.data);
          }
        }
      }
    } catch (err) {
      console.error('Failed to save activity', err);
    }

    setActivityForm({ activity_name: '' });
    setEditingActivityId(null);
    setShowActivityForm(false);
  };

  // Save Sub-Activity
  const handleSubActivitySubmit = async (e) => {
    e.preventDefault();
    if (!selectedActivityId || !subActivityForm.name.trim()) return;

    try {
      const res = await fetch('/api/activity-master/subactivities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          activity_id: selectedActivityId, 
          name: subActivityForm.name,
          default_duration: subActivityForm.defaultDuration,
          default_manhours: subActivityForm.defaultManhours
        }),
      });
      if (res.ok) {
        // Refresh disciplines to get updated sub-activities
        const disciplinesRes = await fetch('/api/activity-master');
        const disciplinesJson = await disciplinesRes.json();
        if (disciplinesJson.success) {
          setDisciplines(disciplinesJson.data);
        }
      }
    } catch (err) {
      console.error('Failed to create sub-activity', err);
    }

    setSubActivityForm(EMPTY_SUB_ACTIVITY);
    setShowSubActivityForm(false);
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-black">
                  Activity Master Catalogue
                </h1>
                <p className="text-sm text-gray-600">
                  Configure reusable disciplines and sub-activities so new projects can be populated instantly.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search disciplines or activities…"
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                />
                {/* push button removed - disciplines are synced automatically from backend on load */}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Three Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Column 1 - Disciplines */}
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-black">Disciplines</h2>
                  <button
                    onClick={handleCreateDiscipline}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-[#7F2487] text-white rounded-md text-xs"
                  >
                    <PlusIcon className="h-3 w-3" /> Add Discipline
                  </button>
                </div>

                {showDisciplineForm && (
                  <form onSubmit={handleDisciplineSubmit} className="space-y-3 border border-gray-200 rounded-md p-3">
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">Name</label>
                        <input
                          type="text"
                          value={disciplineForm.name}
                          onChange={(e) => setDisciplineForm({ ...disciplineForm, name: e.target.value })}
                          placeholder="e.g., ELECTRICAL"
                          required
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-700 mb-1">Status</label>
                          <select
                            value={disciplineForm.status}
                            onChange={(e) => setDisciplineForm({ ...disciplineForm, status: e.target.value })}
                            className="w-full px-3 py-2 border rounded-md text-sm"
                          >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-700 mb-1">Description</label>
                          <input
                            type="text"
                            value={disciplineForm.description}
                            onChange={(e) => setDisciplineForm({ ...disciplineForm, description: e.target.value })}
                            placeholder="Optional short description"
                            className="w-full px-3 py-2 border rounded-md text-sm"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDisciplineForm(false);
                          setDisciplineForm({ name: '', description: '', status: 'active' });
                        }}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-xs text-black"
                      >
                        Cancel
                      </button>
                      <button type="submit" className="px-4 py-2 bg-[#7F2487] text-white rounded-md text-xs">
                        Save Discipline
                      </button>
                    </div>
                  </form>
                )}
                {filteredDisciplines.length === 0 ? (
                  <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-5 text-center">
                    No disciplines found.
                  </div>
                ) : (
                  filteredDisciplines.map((discipline) => (
                    <div
                      key={discipline.id}
                      className={`border rounded-lg px-4 py-3 cursor-pointer ${
                        selectedDisciplineId === discipline.id
                          ? "border-[#7F2487] bg-[#7F2487]/10"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                      onClick={() => {
                        setSelectedDisciplineId(discipline.id);
                        setSelectedActivityId(null);
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-semibold text-black">{discipline.function_name}</p>
                          <p className="text-xs text-gray-500">{discipline.description}</p>
                        </div>
                        <span className="text-xs bg-gray-100 text-black px-2 py-1 rounded-full">
                          {(discipline.activities || []).length} activities
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </section>

              {/* Column 2 - Activities */}
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-sm font-semibold text-black">Activities</h2>
                  {selectedDisciplineId && (
                    <button
                      onClick={() => handleCreateActivity(selectedDisciplineId)}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-[#7F2487] text-white rounded-md text-xs"
                    >
                      <PlusIcon className="h-3 w-3" /> Add Activity
                    </button>
                  )}
                </div>
                {!selectedDisciplineId ? (
                  <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-5 text-center">
                    Select a discipline to view activities.
                  </div>
                ) : activities.length === 0 ? (
                  <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-5 text-center">
                    No activities yet. Add your first activity.
                  </div>
                ) : (
                  activities.map((activity) => (
                    <div
                      key={activity.id}
                      className={`border rounded-lg px-4 py-3 ${
                        selectedActivityId === activity.id
                          ? "border-[#7F2487] bg-[#7F2487]/10"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div 
                          className="flex-1 cursor-pointer"
                          onClick={() => setSelectedActivityId(activity.id)}
                        >
                          <p className="text-sm font-semibold text-black">{activity.activity_name}</p>
                          <span className="text-xs bg-gray-100 text-black px-2 py-1 rounded-full inline-block mt-1">
                            {(activity.subActivities || []).length} sub-activities
                          </span>
                        </div>
                        <div className="flex gap-1 ml-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditActivity(activity.id);
                            }}
                            className="p-1 text-gray-600 hover:text-gray-800"
                            title="Edit activity"
                          >
                            <PencilIcon className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteActivity(activity.id);
                            }}
                            className="p-1 text-red-600 hover:text-red-800"
                            title="Delete activity"
                          >
                            <TrashIcon className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}

                {showActivityForm && (
                  <form onSubmit={handleActivitySubmit} className="space-y-3 border-t pt-4 mt-4">
                    <input
                      type="text"
                      value={activityForm.activity_name}
                      onChange={(e) => setActivityForm({ activity_name: e.target.value })}
                      placeholder="Activity Name"
                      required
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowActivityForm(false);
                          setEditingActivityId(null);
                          setActivityForm({ activity_name: '' });
                        }}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm text-black"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 bg-[#7F2487] text-white rounded-md text-sm"
                      >
                        {editingActivityId ? 'Update Activity' : 'Save Activity'}
                      </button>
                    </div>
                  </form>
                )}
              </section>

              {/* Column 3 - Sub-Activities */}
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-sm font-semibold text-black">Sub-Activities</h2>
                  {selectedActivityId && (
                    <button
                      onClick={() => handleCreateSubActivity(selectedActivityId)}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-[#7F2487] text-white rounded-md text-xs"
                    >
                      <PlusIcon className="h-3 w-3" /> Add Sub-Activity
                    </button>
                  )}
                </div>
                {!selectedActivityId ? (
                  <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-5 text-center">
                    Select an activity to view sub-activities.
                  </div>
                ) : subActivities.length === 0 ? (
                  <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-5 text-center">
                    No sub-activities yet. Add your first sub-activity.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {subActivities.map((subActivity) => (
                      <div
                        key={subActivity.id}
                        className="border rounded-lg px-4 py-3 border-gray-200 hover:bg-gray-50"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-black">{subActivity.name}</p>
                            <div className="mt-1 text-xs text-gray-500 space-y-1">
                              {subActivity.default_manhours !== undefined && subActivity.default_manhours !== null && (
                                <div>Manhours: {subActivity.default_manhours} hrs</div>
                              )}
                              {subActivity.default_rate !== undefined && subActivity.default_rate !== null && (
                                <div>Default Rate: ₹{subActivity.default_rate}</div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleEditSubActivity(subActivity.id)}
                              className="p-1 text-gray-600 hover:text-gray-800"
                            >
                              <PencilIcon className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteSubActivity(subActivity.id)}
                              className="p-1 text-red-600 hover:text-red-800"
                            >
                              <TrashIcon className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {showSubActivityForm && (
                  <form onSubmit={handleSubActivitySubmit} className="space-y-3 border-t pt-4 mt-4">
                    <input
                      value={subActivityForm.name}
                      onChange={(e) =>
                        setSubActivityForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder="Sub-Activity Name"
                      required
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <input
                        value={subActivityForm.defaultDuration}
                        onChange={(e) =>
                          setSubActivityForm((prev) => ({
                            ...prev,
                            defaultDuration: e.target.value,
                          }))
                        }
                        placeholder="Duration (hrs)"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                      <input
                        value={subActivityForm.defaultManhours}
                        onChange={(e) =>
                          setSubActivityForm((prev) => ({
                            ...prev,
                            defaultManhours: e.target.value,
                          }))
                        }
                        placeholder="Manhours (hrs)"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                      />
                      {/* Only collect name, duration and manhours when creating sub-activities */}
                    </div>
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setShowSubActivityForm(false)}
                        className="px-4 py-2 text-sm rounded-md bg-gray-100 hover:bg-gray-200 text-black"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 text-sm rounded-md bg-[#7F2487] text-white"
                      >
                        Save Sub-Activity
                      </button>
                    </div>
                  </form>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}