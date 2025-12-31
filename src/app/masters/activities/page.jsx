"use client";

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import { useEffect, useMemo, useState } from 'react';
import { 
  PlusIcon, 
  TrashIcon, 
  CheckIcon, 
  PencilIcon, 
  XMarkIcon,
  FolderIcon,
  ClipboardDocumentListIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon
} from '@heroicons/react/24/outline';

export default function ActivityMasterPage() {
  const [disciplines, setDisciplines] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Selected discipline for viewing/adding activities
  const [selectedDisciplineId, setSelectedDisciplineId] = useState(null);
  
  // Form inputs
  const [newDisciplineName, setNewDisciplineName] = useState('');
  const [newActivityName, setNewActivityName] = useState('');
  const [newActivityManhours, setNewActivityManhours] = useState('');
  
  // Bulk add mode
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkActivities, setBulkActivities] = useState('');
  const [bulkManhours, setBulkManhours] = useState('');
  
  // Edit states
  const [editingDiscipline, setEditingDiscipline] = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);

  // Fetch disciplines with nested activities
  const fetchData = async () => {
    try {
      const res = await fetch('/api/activity-master');
      const json = await res.json();
      if (json.success && json.data) {
        console.log('Fetched activity master data:', json.data);
        // Log a sample activity to verify manhours are present
        if (json.data[0]?.activities?.[0]) {
          console.log('Sample activity:', json.data[0].activities[0]);
        }
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

  // Get selected discipline
  const selectedDiscipline = disciplines.find(d => d.id === selectedDisciplineId);

  // Filter disciplines by search term
  const filteredDisciplines = useMemo(() => {
    if (!searchTerm) return disciplines;
    const term = searchTerm.toLowerCase();
    return disciplines.filter(discipline => 
      discipline.function_name.toLowerCase().includes(term)
    );
  }, [disciplines, searchTerm]);

  // Filter activities by search term
  const filteredActivities = useMemo(() => {
    if (!selectedDiscipline) return [];
    const activities = selectedDiscipline.activities || [];
    if (!searchTerm) return activities;
    const term = searchTerm.toLowerCase();
    return activities.filter(activity => 
      activity.activity_name.toLowerCase().includes(term)
    );
  }, [selectedDiscipline, searchTerm]);

  // Show success message
  const showSuccess = (message) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  };

  // Add Discipline
  const handleAddDiscipline = async () => {
    if (!newDisciplineName.trim()) {
      setError('Please enter a discipline name');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch('/api/activity-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          function_name: newDisciplineName.trim(),
          status: 'active'
        }),
      });
      
      if (res.ok) {
        await fetchData();
        setNewDisciplineName('');
        showSuccess('Discipline added successfully');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to add discipline');
      }
    } catch (err) {
      console.error('Failed to add discipline', err);
      setError('Failed to add discipline');
    } finally {
      setLoading(false);
    }
  };

  // Add Activity
  const handleAddActivity = async () => {
    if (!newActivityName.trim()) {
      setError('Please enter an activity name');
      return;
    }
    if (!selectedDisciplineId) {
      setError('Please select a discipline first');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const manhours = newActivityManhours && newActivityManhours.trim() !== '' ? parseFloat(newActivityManhours) : 0;
      console.log('Adding activity with manhours:', { newActivityManhours, manhours });
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          function_id: selectedDisciplineId, 
          activity_name: newActivityName.trim(),
          default_manhours: manhours
        }),
      });
      
      if (res.ok) {
        await fetchData();
        setNewActivityName('');
        setNewActivityManhours('');
        showSuccess('Activity added successfully');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to add activity');
      }
    } catch (err) {
      console.error('Failed to add activity', err);
      setError('Failed to add activity');
    } finally {
      setLoading(false);
    }
  };

  // Add Activities in Bulk
  const handleBulkAddActivities = async () => {
    if (!bulkActivities.trim()) {
      setError('Please enter at least one activity');
      return;
    }
    if (!selectedDisciplineId) {
      setError('Please select a discipline first');
      return;
    }

    // Parse activities - split by newline
    const activityLines = bulkActivities
      .split(/\n/)
      .map(line => line.trim())
      .map(line => line.replace(/^[\s•\-\*\d\.]+/, '').trim()) // Remove bullet points, numbers, dashes
      .filter(line => line.length > 0);

    if (activityLines.length === 0) {
      setError('No valid activities found');
      return;
    }

    // Calculate manhours per activity
    const totalManhours = parseFloat(bulkManhours) || 0;
    const activityCount = activityLines.length;
    const manhoursPerActivity = totalManhours > 0 && activityCount > 0
      ? Math.round((totalManhours / activityCount) * 100) / 100 
      : 0;

    console.log('Bulk add:', { totalManhours, activityCount, manhoursPerActivity, activityLines });

    setLoading(true);
    setError(null);

    let successCount = 0;
    let failCount = 0;

    for (const activityName of activityLines) {
      try {
        console.log('Adding activity:', { activityName, manhoursPerActivity });
        const res = await fetch('/api/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            function_id: selectedDisciplineId, 
            activity_name: activityName,
            default_manhours: Number(manhoursPerActivity)
          }),
        });
        
        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }
    }

    await fetchData();
    setBulkActivities('');
    setBulkManhours('');
    setBulkMode(false);
    
    if (failCount === 0) {
      showSuccess(`${successCount} activities added successfully (${manhoursPerActivity}h each)`);
    } else {
      showSuccess(`${successCount} added, ${failCount} failed`);
    }
    
    setLoading(false);
  };

  // Delete Discipline
  const handleDeleteDiscipline = async (disciplineId) => {
    if (!confirm("Delete this discipline and all its activities?")) return;
    try {
      const res = await fetch(`/api/activity-master?id=${disciplineId}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
        if (selectedDisciplineId === disciplineId) {
          setSelectedDisciplineId(null);
        }
        showSuccess('Discipline deleted');
      }
    } catch (err) {
      console.error('Failed to delete discipline', err);
      setError('Failed to delete discipline');
    }
  };

  // Delete Activity
  const handleDeleteActivity = async (activityId) => {
    if (!confirm("Delete this activity?")) return;
    try {
      const res = await fetch(`/api/activities?id=${activityId}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
        showSuccess('Activity deleted');
      }
    } catch (err) {
      console.error('Failed to delete activity', err);
      setError('Failed to delete activity');
    }
  };

  // Update Discipline
  const handleUpdateDiscipline = async () => {
    if (!editingDiscipline || !editingDiscipline.name.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/activity-master', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingDiscipline.id,
          function_name: editingDiscipline.name.trim()
        })
      });
      
      if (res.ok) {
        await fetchData();
        setEditingDiscipline(null);
        showSuccess('Discipline updated');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update discipline');
      }
    } catch (err) {
      console.error('Failed to update discipline', err);
      setError('Failed to update discipline');
    } finally {
      setLoading(false);
    }
  };

  // Update Activity
  const handleUpdateActivity = async () => {
    if (!editingActivity) return;
    
    setLoading(true);
    try {
      const manhours = editingActivity.manhours !== undefined && editingActivity.manhours !== '' 
        ? parseFloat(editingActivity.manhours) 
        : 0;
      console.log('Updating activity with manhours:', { editingActivity, manhours });
      const res = await fetch('/api/activities', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingActivity.id,
          activity_name: editingActivity.name?.trim() || undefined,
          default_manhours: manhours
        })
      });
      
      if (res.ok) {
        await fetchData();
        setEditingActivity(null);
        showSuccess('Activity updated');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update activity');
      }
    } catch (err) {
      console.error('Failed to update activity', err);
      setError('Failed to update activity');
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
              Manage disciplines and their activities for project assignments
            </p>
          </div>

          {/* Messages */}
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg flex justify-between items-center">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold">×</button>
            </div>
          )}
          {success && (
            <div className="mb-4 bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg flex justify-between items-center">
              <span>{success}</span>
              <button onClick={() => setSuccess(null)} className="text-green-500 hover:text-green-700 font-bold">×</button>
            </div>
          )}

          {/* Quick Stats */}
          <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <FolderIcon className="h-5 w-5 text-[#7F2487]" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{disciplines.length}</div>
                <div className="text-xs text-gray-500">Disciplines</div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <ClipboardDocumentListIcon className="h-5 w-5 text-[#4472C4]" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{totalActivities}</div>
                <div className="text-xs text-gray-500">Total Activities</div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckIcon className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {disciplines.filter(d => (d.activities?.length || 0) > 0).length}
                </div>
                <div className="text-xs text-gray-500">With Activities</div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <FolderIcon className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {disciplines.filter(d => (d.activities?.length || 0) === 0).length}
                </div>
                <div className="text-xs text-gray-500">Empty Disciplines</div>
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="mb-6">
            <div className="relative max-w-md">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search disciplines or activities…"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
              />
            </div>
          </div>

          {/* Two Panel Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* LEFT PANEL - Disciplines */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Panel Header */}
              <div className="bg-gradient-to-r from-[#7F2487] to-[#9B3A9B] px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-lg">
                      <FolderIcon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Disciplines</h2>
                      <p className="text-xs text-white/70">{disciplines.length} total</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Add Discipline Form */}
              <div className="p-4 border-b border-gray-200 bg-purple-50/50">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDisciplineName}
                    onChange={(e) => setNewDisciplineName(e.target.value)}
                    placeholder="Enter new discipline name..."
                    className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddDiscipline()}
                  />
                  <button
                    onClick={handleAddDiscipline}
                    disabled={loading || !newDisciplineName.trim()}
                    className="px-4 py-2.5 bg-[#7F2487] text-white rounded-lg text-sm font-medium hover:bg-[#6a1f72] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <PlusIcon className="w-4 h-4" />
                    Add
                  </button>
                </div>
              </div>

              {/* Disciplines List */}
              <div className="max-h-[500px] overflow-y-auto">
                {filteredDisciplines.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <FolderIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No disciplines found</p>
                    <p className="text-sm mt-1">Add your first discipline above</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {filteredDisciplines.map((discipline, index) => (
                      <div
                        key={discipline.id}
                        className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-all ${
                          selectedDisciplineId === discipline.id 
                            ? 'bg-purple-100 border-l-4 border-[#7F2487]' 
                            : 'hover:bg-gray-50 border-l-4 border-transparent'
                        }`}
                        onClick={() => setSelectedDisciplineId(discipline.id)}
                      >
                        <span className="text-sm text-gray-400 w-6">{index + 1}.</span>
                        
                        {editingDiscipline?.id === discipline.id ? (
                          <div className="flex-1 flex items-center gap-2">
                            <input
                              type="text"
                              value={editingDiscipline.name}
                              onChange={(e) => setEditingDiscipline({ ...editingDiscipline, name: e.target.value })}
                              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateDiscipline();
                                if (e.key === 'Escape') setEditingDiscipline(null);
                              }}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); handleUpdateDiscipline(); }}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                            >
                              <CheckIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingDiscipline(null); }}
                              className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {discipline.function_name}
                              </p>
                              <p className="text-xs text-gray-500">
                                {discipline.activities?.length || 0} activities
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setEditingDiscipline({ id: discipline.id, name: discipline.function_name }); 
                                }}
                                className="p-1.5 text-gray-400 hover:text-[#7F2487] hover:bg-purple-50 rounded"
                                title="Edit discipline"
                              >
                                <PencilIcon className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteDiscipline(discipline.id); }}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Delete discipline"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            </div>
                            
                            <ChevronRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${
                              selectedDisciplineId === discipline.id ? 'text-[#7F2487]' : ''
                            }`} />
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT PANEL - Activities */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Panel Header */}
              <div className="bg-gradient-to-r from-[#4472C4] to-[#5A8AD8] px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-lg">
                      <ClipboardDocumentListIcon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Activities</h2>
                      <p className="text-xs text-white/70">
                        {selectedDiscipline 
                          ? `${selectedDiscipline.function_name} • ${selectedDiscipline.activities?.length || 0} activities`
                          : `${totalActivities} total`
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Add Activity Form */}
              <div className={`p-4 border-b border-gray-200 ${selectedDisciplineId ? 'bg-blue-50/50' : 'bg-gray-50'}`}>
                {selectedDisciplineId ? (
                  <div className="space-y-3">
                    {/* Mode Toggle */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">
                        Adding to: <span className="font-medium text-[#7F2487]">{selectedDiscipline?.function_name}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setBulkMode(!bulkMode)}
                        className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-semibold transition-all shadow-sm ${
                          bulkMode 
                            ? 'bg-[#4472C4] text-white shadow-blue-200' 
                            : 'bg-[#7F2387] text-white hover:bg-[#64126D] shadow-purple-200'
                        }`}
                      >
                        {bulkMode ? (
                          <><CheckIcon className="h-4 w-4" /> Bulk Mode ON</>
                        ) : (
                          <><Squares2X2Icon className="h-4 w-4" /> Bulk Add</>
                        )}
                      </button>
                    </div>

                    {bulkMode ? (
                      /* Bulk Add Form */
                      <div className="space-y-3 bg-white p-4 rounded-lg border border-blue-200">
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Activities (one per line)
                            </label>
                            <textarea
                              value={bulkActivities}
                              onChange={(e) => setBulkActivities(e.target.value)}
                              placeholder={"• Activity 1\n• Activity 2\n• Activity 3"}
                              rows={5}
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#4472C4] focus:border-transparent font-mono"
                            />
                          </div>
                          <div className="w-32">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Total Hours
                            </label>
                            <input
                              type="number"
                              value={bulkManhours}
                              onChange={(e) => setBulkManhours(e.target.value)}
                              placeholder="0"
                              min="0"
                              step="0.01"
                              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#4472C4] focus:border-transparent"
                            />
                            <p className="text-xs text-gray-400 mt-1">Distributed equally</p>
                          </div>
                        </div>
                        
                        {/* Preview */}
                        {bulkActivities.trim() && (
                          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                            <p className="text-xs font-medium text-gray-600 mb-2">Preview:</p>
                            <div className="flex flex-wrap gap-1">
                              {bulkActivities
                                .split(/[\n,]/)
                                .map(line => line.trim())
                                .map(line => line.replace(/^[\s•\-\*\d\.]+/, '').trim())
                                .filter(line => line.length > 0)
                                .map((activity, idx) => (
                                  <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                                    <span className="font-medium">{idx + 1}.</span> {activity}
                                    {bulkManhours && (
                                      <span className="text-blue-500">
                                        ({Math.round((parseFloat(bulkManhours) / bulkActivities.split(/[\n,]/).map(l => l.trim()).map(l => l.replace(/^[\s•\-\*\d\.]+/, '').trim()).filter(l => l.length > 0).length) * 100) / 100}h)
                                      </span>
                                    )}
                                  </span>
                                ))}
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                              {bulkActivities.split(/[\n,]/).map(l => l.trim()).map(l => l.replace(/^[\s•\-\*\d\.]+/, '').trim()).filter(l => l.length > 0).length} activities
                              {bulkManhours && ` × ${Math.round((parseFloat(bulkManhours) / bulkActivities.split(/[\n,]/).map(l => l.trim()).map(l => l.replace(/^[\s•\-\*\d\.]+/, '').trim()).filter(l => l.length > 0).length) * 100) / 100}h each = ${bulkManhours}h total`}
                            </p>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-2">
                          <button
                            type="button"
                            onClick={() => { setBulkMode(false); setBulkActivities(''); setBulkManhours(''); }}
                            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleBulkAddActivities}
                            disabled={loading || !bulkActivities.trim()}
                            className="px-4 py-2.5 bg-[#4472C4] text-white rounded-lg text-sm font-medium hover:bg-[#3961a8] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                          >
                            <PlusIcon className="w-4 h-4" />
                            Add All Activities
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Single Add Form */
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newActivityName}
                          onChange={(e) => setNewActivityName(e.target.value)}
                          placeholder="Enter new activity name..."
                          className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#4472C4] focus:border-transparent"
                          onKeyDown={(e) => e.key === 'Enter' && handleAddActivity()}
                        />
                        <input
                          type="number"
                          value={newActivityManhours}
                          onChange={(e) => setNewActivityManhours(e.target.value)}
                          placeholder="Hours"
                          min="0"
                          step="0.01"
                          className="w-24 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#4472C4] focus:border-transparent"
                          onKeyDown={(e) => e.key === 'Enter' && handleAddActivity()}
                        />
                        <button
                          onClick={handleAddActivity}
                          disabled={loading || !newActivityName.trim()}
                          className="px-4 py-2.5 bg-[#4472C4] text-white rounded-lg text-sm font-medium hover:bg-[#3961a8] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors whitespace-nowrap"
                        >
                          <PlusIcon className="w-4 h-4" />
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-2 text-sm text-gray-500">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-[#7F2487]">←</span>
                      Select a discipline to add activities
                    </span>
                  </div>
                )}
              </div>

              {/* Activities List */}
              <div className="max-h-[500px] overflow-y-auto">
                {!selectedDisciplineId ? (
                  <div className="p-8 text-center text-gray-500">
                    <ClipboardDocumentListIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">Select a discipline</p>
                    <p className="text-sm mt-1">Choose a discipline from the left panel to view and manage its activities</p>
                  </div>
                ) : filteredActivities.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <ClipboardDocumentListIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No activities yet</p>
                    <p className="text-sm mt-1">Add activities to &ldquo;{selectedDiscipline?.function_name}&rdquo;</p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-10">
                          #
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Activity Name
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-28">
                          Manhours
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredActivities.map((activity, index) => (
                        <tr key={activity.id} className="group hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-400">
                            {index + 1}
                          </td>
                          <td className="px-4 py-3">
                            {editingActivity?.id === activity.id ? (
                              <input
                                type="text"
                                value={editingActivity.name}
                                onChange={(e) => setEditingActivity({ ...editingActivity, name: e.target.value })}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#4472C4] focus:border-transparent"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleUpdateActivity();
                                  if (e.key === 'Escape') setEditingActivity(null);
                                }}
                              />
                            ) : (
                              <span className="text-sm text-gray-900">{activity.activity_name}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {editingActivity?.id === activity.id ? (
                              <input
                                type="number"
                                value={editingActivity.manhours}
                                onChange={(e) => setEditingActivity({ ...editingActivity, manhours: e.target.value })}
                                className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#4472C4] focus:border-transparent text-right"
                                min="0"
                                step="0.01"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleUpdateActivity();
                                  if (e.key === 'Escape') setEditingActivity(null);
                                }}
                              />
                            ) : (
                              <span className="text-sm font-medium text-gray-700">
                                {activity.default_manhours ? `${activity.default_manhours} hrs` : '—'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {editingActivity?.id === activity.id ? (
                              <div className="flex justify-center gap-1">
                                <button
                                  onClick={handleUpdateActivity}
                                  className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                                  title="Save"
                                >
                                  <CheckIcon className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setEditingActivity(null)}
                                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                                  title="Cancel"
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => setEditingActivity({ 
                                    id: activity.id, 
                                    name: activity.activity_name,
                                    manhours: activity.default_manhours || '' 
                                  })}
                                  className="p-1.5 text-gray-400 hover:text-[#4472C4] hover:bg-blue-50 rounded"
                                  title="Edit activity"
                                >
                                  <PencilIcon className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteActivity(activity.id)}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                  title="Delete activity"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AccessGuard>
  );
}
