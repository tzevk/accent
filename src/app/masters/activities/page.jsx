'use client';

import Navbar from '@/components/Navbar';
import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';

const EMPTY_DISCIPLINE = {
  id: '',
  name: '',
  description: '',
  status: 'active'
};

const EMPTY_SUB_ACTIVITY = {
  id: '',
  name: ''
};

const STATUS_OPTIONS = ['active', 'inactive'];

export default function ActivityMasterPage() {
  const [disciplines, setDisciplines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedDisciplineId, setSelectedDisciplineId] = useState(null);
  const [disciplineForm, setDisciplineForm] = useState(EMPTY_DISCIPLINE);
  const [editingDisciplineId, setEditingDisciplineId] = useState(null);
  const [showDisciplineForm, setShowDisciplineForm] = useState(false);

  const [subActivityForm, setSubActivityForm] = useState(EMPTY_SUB_ACTIVITY);
  const [editingSubId, setEditingSubId] = useState(null);
  const [showSubForm, setShowSubForm] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadDisciplines();
  }, []);

  const loadDisciplines = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/activity-master');
      const json = await response.json();
      if (json.success) {
        const mapped = (json.data || []).map((item) => ({
          id: item.id,
          name: item.function_name,
          description: item.description || '',
          status: item.status || 'active',
          subActivities: (item.subActivities || []).map((sub) => ({
            id: sub.id,
            name: sub.activity_name
          }))
        }));
        setDisciplines(mapped);

        if (!selectedDisciplineId && mapped.length > 0) {
          setSelectedDisciplineId(mapped[0].id);
        }
      } else {
        setError(json.error || 'Failed to load activity master');
        setDisciplines([]);
      }
    } catch (err) {
      console.error('Activity master fetch error', err);
      setError('Failed to load activity master');
      setDisciplines([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredDisciplines = useMemo(() => {
    if (!searchTerm) return disciplines;
    const term = searchTerm.toLowerCase();
    return disciplines.filter((discipline) =>
      discipline.name.toLowerCase().includes(term) ||
      (discipline.description || '').toLowerCase().includes(term) ||
      discipline.subActivities.some((sub) => sub.name.toLowerCase().includes(term))
    );
  }, [disciplines, searchTerm]);

  const selectedDiscipline = useMemo(
    () => disciplines.find((item) => item.id === selectedDisciplineId) || null,
    [disciplines, selectedDisciplineId]
  );

  const openDisciplineForm = (disciplineId = null) => {
    if (disciplineId) {
      const existing = disciplines.find((item) => item.id === disciplineId);
      if (!existing) return;
      setDisciplineForm({ ...existing });
      setEditingDisciplineId(disciplineId);
    } else {
      setDisciplineForm(EMPTY_DISCIPLINE);
      setEditingDisciplineId(null);
    }
    setShowDisciplineForm(true);
  };

  const handleDisciplineSubmit = async (event) => {
    event.preventDefault();
    if (!disciplineForm.name.trim()) {
      alert('Discipline name is required');
      return;
    }

    try {
      const payload = {
        function_name: disciplineForm.name,
        description: disciplineForm.description || '',
        status: disciplineForm.status || 'active'
      };

      if (editingDisciplineId) {
        await fetch('/api/activity-master', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingDisciplineId, ...payload })
        });
      } else {
        await fetch('/api/activity-master', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      setShowDisciplineForm(false);
      setDisciplineForm(EMPTY_DISCIPLINE);
      setEditingDisciplineId(null);
      await loadDisciplines();
    } catch (error) {
      console.error('Save discipline error', error);
      alert('Failed to save discipline');
    }
  };

  const handleDeleteDiscipline = async (disciplineId) => {
    if (!confirm('Delete this discipline and its activities?')) return;
    try {
      await fetch(`/api/activity-master?id=${disciplineId}`, { method: 'DELETE' });
      if (selectedDisciplineId === disciplineId) {
        setSelectedDisciplineId(null);
        setShowSubForm(false);
      }
      await loadDisciplines();
    } catch (error) {
      console.error('Delete discipline error', error);
      alert('Failed to delete discipline');
    }
  };

  const openSubForm = (disciplineId, subId = null) => {
    setSelectedDisciplineId(disciplineId);
    if (subId) {
      const discipline = disciplines.find((item) => item.id === disciplineId);
      const existing = discipline?.subActivities.find((sub) => sub.id === subId);
      if (existing) {
        setSubActivityForm({ ...existing });
        setEditingSubId(subId);
      }
    } else {
      setSubActivityForm(EMPTY_SUB_ACTIVITY);
      setEditingSubId(null);
    }
    setShowSubActivityForm(true);
  };

  const handleSubActivitySubmit = async (event) => {
    event.preventDefault();
    if (!selectedDisciplineId) return;
    if (!subActivityForm.name.trim()) {
      alert('Activity name is required');
      return;
    }

    try {
      if (editingSubId) {
        await fetch('/api/activity-master/activities', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingSubId,
            activity_name: subActivityForm.name,
            function_id: selectedDisciplineId
          })
        });
      } else {
        await fetch('/api/activity-master/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            function_id: selectedDisciplineId,
            activity_name: subActivityForm.name
          })
        });
      }

      setShowSubActivityForm(false);
      setSubActivityForm(EMPTY_SUB_ACTIVITY);
      setEditingSubId(null);
      await loadDisciplines();
    } catch (error) {
      console.error('Save sub-activity error', error);
      alert('Failed to save sub-activity');
    }
  };

  const handleDeleteSub = async (disciplineId, subId) => {
    if (!confirm('Delete this sub-activity?')) return;
    try {
      await fetch(`/api/activity-master/activities?id=${subId}`, { method: 'DELETE' });
      await loadDisciplines();
    } catch (error) {
      console.error('Delete sub-activity error', error);
      alert('Failed to delete sub-activity');
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8 space-y-6">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-black">Activity Master Catalogue</h1>
                <p className="text-sm text-gray-600">
                  Define disciplines and their reusable activities for project planning.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search disciplines or activities…"
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => openDisciplineForm()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
                >
                  <PlusIcon className="h-4 w-4" />
                  New Discipline
                </button>
              </div>
            </header>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <aside className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-black">Disciplines</h2>
                  <span className="text-xs text-gray-500">{filteredDisciplines.length}</span>
                </div>

                {loading ? (
                  <p className="text-sm text-gray-500">Loading…</p>
                ) : filteredDisciplines.length === 0 ? (
                  <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-5 text-center">
                    No disciplines yet. Create one to begin building your catalogue.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredDisciplines.map((discipline) => {
                      const isSelected = discipline.id === selectedDisciplineId;
                      return (
                        <div
                          key={discipline.id}
                          className={`border rounded-lg px-4 py-3 transition-colors ${
                            isSelected ? 'border-[#7F2487] bg-[#7F2487]/10' : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <button
                              type="button"
                              onClick={() => setSelectedDisciplineId(discipline.id)}
                              className="text-left flex-1"
                            >
                              <p className="text-sm font-semibold text-black">{discipline.name}</p>
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                {discipline.description || 'No description provided.'}
                              </p>
                              <span className="mt-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">
                                Status: {discipline.status}
                              </span>
                            </button>
                          </div>
                          <div className="mt-3 flex items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => openDisciplineForm(discipline.id)}
                              className="px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDiscipline(discipline.id)}
                              className="px-3 py-1.5 rounded border border-red-300 text-red-600 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {showDisciplineForm && (
                  <div className="mt-5 border-t border-gray-200 pt-4">
                    <form onSubmit={handleDisciplineSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Discipline Name *</label>
                        <input
                          type="text"
                          value={disciplineForm.name}
                          onChange={(event) => setDisciplineForm((prev) => ({ ...prev, name: event.target.value }))}
                          required
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Status</label>
                        <select
                          value={disciplineForm.status}
                          onChange={(event) => setDisciplineForm((prev) => ({ ...prev, status: event.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">Description</label>
                        <textarea
                          value={disciplineForm.description}
                          onChange={(event) => setDisciplineForm((prev) => ({ ...prev, description: event.target.value }))}
                          rows={3}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        />
                      </div>
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowDisciplineForm(false);
                            setEditingDisciplineId(null);
                            setDisciplineForm(EMPTY_DISCIPLINE);
                          }}
                          className="px-4 py-2 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-5 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors font-medium"
                        >
                          {editingDisciplineId ? 'Update Discipline' : 'Save Discipline'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </aside>

              <section className="lg:col-span-2 space-y-4">
                {loading ? (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center text-sm text-gray-500">
                    Loading…
                  </div>
                ) : !selectedDiscipline ? (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center text-sm text-gray-500">
                    Select a discipline to view its activities.
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                    <div className="px-6 py-5 border-b border-gray-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-black">{selectedDiscipline.name}</h3>
                        <p className="text-sm text-gray-600 max-w-2xl">
                          {selectedDiscipline.description || 'No description provided.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCreateSubActivity(selectedDiscipline.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
                      >
                        <PlusIcon className="h-4 w-4" />
                        Add Sub-Activity
                      </button>
                    </div>

                    <div className="px-6 py-5 space-y-5">
                      {selectedDiscipline.subActivities.length === 0 ? (
                        <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-4 py-12 text-center">
                          No sub-activities added yet. Use “Add Sub-Activity” to define reusable tasks.
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                          <table className="min-w-full text-xs">
                            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                              <tr>
                                <th className="px-3 py-2 text-left">Sub-Activity</th>
                                <th className="px-3 py-2 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedDiscipline.subActivities.map((sub) => (
                                <tr key={sub.id} className="border-t border-gray-200 hover:bg-gray-50">
                                  <td className="px-3 py-3 text-gray-800 font-medium">{sub.name}</td>
                                  <td className="px-3 py-3 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        type="button"
                                        title="Edit sub-activity"
                                        onClick={() => handleEditSubActivity(selectedDiscipline.id, sub.id)}
                                        className="p-1.5 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                                      >
                                        <PencilIcon className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Remove sub-activity"
                                        onClick={() => handleDeleteSub(selectedDiscipline.id, sub.id)}
                                        className="p-1.5 rounded-full text-red-500 hover:text-red-600 hover:bg-red-50"
                                      >
                                        <TrashIcon className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {showSubForm && (
                        <div className="border-t border-gray-200 pt-4">
                          <form onSubmit={handleSubActivitySubmit} className="space-y-4">
                            <div>
                              <label className="block text-xs font-medium text-black mb-1">Sub-Activity Name *</label>
                              <input
                                type="text"
                                name="name"
                                value={subActivityForm.name}
                                onChange={(event) =>
                                  setSubActivityForm((prev) => ({ ...prev, name: event.target.value }))
                                }
                                required
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                              />
                            </div>
                            <div className="flex justify-end gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowSubActivityForm(false);
                                  setEditingSubId(null);
                                  setSubActivityForm(EMPTY_SUB_ACTIVITY);
                                }}
                                className="px-4 py-2 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                className="px-5 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors font-medium"
                              >
                                {editingSubId ? 'Update Sub-Activity' : 'Save Sub-Activity'}
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
