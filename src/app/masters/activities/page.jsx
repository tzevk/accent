'use client';

import Navbar from '@/components/Navbar';
import { useMemo, useState } from 'react';
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';

const EMPTY_DISCIPLINE = {
  id: '',
  name: '',
  description: '',
  subActivities: []
};

const EMPTY_SUB_ACTIVITY = {
  id: '',
  name: '',
  description: '',
  defaultDuration: '',
  defaultManhours: ''
};

export default function ActivityMasterPage() {
  const [disciplines, setDisciplines] = useState([]);
  const [disciplineForm, setDisciplineForm] = useState(EMPTY_DISCIPLINE);
  const [subActivityForm, setSubActivityForm] = useState(EMPTY_SUB_ACTIVITY);
  const [selectedDisciplineId, setSelectedDisciplineId] = useState(null);
  const [editingDisciplineId, setEditingDisciplineId] = useState(null);
  const [editingSubId, setEditingSubId] = useState(null);
  const [showDisciplineForm, setShowDisciplineForm] = useState(false);
  const [showSubActivityForm, setShowSubActivityForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredDisciplines = useMemo(() => {
    if (!searchTerm) return disciplines;
    const term = searchTerm.toLowerCase();
    return disciplines.filter((discipline) => {
      const matchDiscipline =
        discipline.name.toLowerCase().includes(term) ||
        (discipline.description || '').toLowerCase().includes(term);
      const matchSub = discipline.subActivities.some((sub) =>
        sub.name.toLowerCase().includes(term)
      );
      return matchDiscipline || matchSub;
    });
  }, [disciplines, searchTerm]);

  const selectedDiscipline = useMemo(
    () => disciplines.find((item) => item.id === selectedDisciplineId) || null,
    [disciplines, selectedDisciplineId]
  );

  const handleCreateDiscipline = () => {
    setDisciplineForm(EMPTY_DISCIPLINE);
    setEditingDisciplineId(null);
    setShowDisciplineForm(true);
  };

  const handleEditDiscipline = (disciplineId) => {
    const existing = disciplines.find((item) => item.id === disciplineId);
    if (!existing) return;
    setDisciplineForm({ ...existing });
    setEditingDisciplineId(disciplineId);
    setShowDisciplineForm(true);
  };

  const handleDeleteDiscipline = (disciplineId) => {
    setDisciplines((prev) => prev.filter((item) => item.id !== disciplineId));
    if (selectedDisciplineId === disciplineId) {
      setSelectedDisciplineId(null);
      setShowSubActivityForm(false);
    }
  };

  const handleDisciplineSubmit = (event) => {
    event.preventDefault();
    if (editingDisciplineId) {
      setDisciplines((prev) =>
        prev.map((item) =>
          item.id === editingDisciplineId
            ? { ...item, name: disciplineForm.name, description: disciplineForm.description }
            : item
        )
      );
    } else {
      const newDiscipline = {
        ...disciplineForm,
        id: `discipline-${Date.now()}`,
        subActivities: []
      };
      setDisciplines((prev) => [...prev, newDiscipline]);
      setSelectedDisciplineId(newDiscipline.id);
    }

    setDisciplineForm(EMPTY_DISCIPLINE);
    setEditingDisciplineId(null);
    setShowDisciplineForm(false);
  };

  const handleCreateSubActivity = (disciplineId) => {
    setSelectedDisciplineId(disciplineId);
    setSubActivityForm(EMPTY_SUB_ACTIVITY);
    setEditingSubId(null);
    setShowSubActivityForm(true);
  };

  const handleEditSubActivity = (disciplineId, subId) => {
    setSelectedDisciplineId(disciplineId);
    const discipline = disciplines.find((item) => item.id === disciplineId);
    const sub = discipline?.subActivities.find((item) => item.id === subId);
    if (!sub) return;
    setSubActivityForm({ ...sub });
    setEditingSubId(subId);
    setShowSubActivityForm(true);
  };

  const handleDeleteSubActivity = (disciplineId, subId) => {
    setDisciplines((prev) =>
      prev.map((discipline) =>
        discipline.id === disciplineId
          ? {
              ...discipline,
              subActivities: discipline.subActivities.filter((item) => item.id !== subId)
            }
          : discipline
      )
    );
  };

  const handleSubActivitySubmit = (event) => {
    event.preventDefault();
    if (!selectedDisciplineId) return;

    setDisciplines((prev) =>
      prev.map((discipline) => {
        if (discipline.id !== selectedDisciplineId) return discipline;

        if (editingSubId) {
          return {
            ...discipline,
            subActivities: discipline.subActivities.map((item) =>
              item.id === editingSubId ? { ...item, ...subActivityForm } : item
            )
          };
        }

        return {
          ...discipline,
          subActivities: [
            ...discipline.subActivities,
            { ...subActivityForm, id: `sub-${Date.now()}` }
          ]
        };
      })
    );

    setSubActivityForm(EMPTY_SUB_ACTIVITY);
    setEditingSubId(null);
    setShowSubActivityForm(false);
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-black">Activity Master Catalogue</h1>
                <p className="text-sm text-gray-600">
                  Configure reusable disciplines and sub-activities so new projects can be populated instantly.
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
                  onClick={handleCreateDiscipline}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
                >
                  <PlusIcon className="h-4 w-4" />
                  New Discipline
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-black">Disciplines</h2>
                  <span className="text-xs text-gray-500">{filteredDisciplines.length} total</span>
                </div>

                <div className="space-y-3">
                  {filteredDisciplines.length === 0 ? (
                    <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-5 text-center">
                      No disciplines yet. Create your first discipline to build the catalogue.
                    </div>
                  ) : (
                    filteredDisciplines.map((discipline) => {
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
                            </button>
                            <span className="ml-3 inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">
                              {discipline.subActivities.length} activities
                            </span>
                          </div>
                          <div className="mt-3 flex items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => handleEditDiscipline(discipline.id)}
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
                    })
                  )}
                </div>

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
                        <label className="block text-xs font-medium text-black mb-1">Description</label>
                        <textarea
                          value={disciplineForm.description}
                          onChange={(event) => setDisciplineForm((prev) => ({ ...prev, description: event.target.value }))}
                          rows={3}
                          placeholder="Outline what falls under this discipline"
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
              </section>

              <section className="lg:col-span-2 space-y-4">
                {selectedDiscipline ? (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                    <div className="px-6 py-5 border-b border-gray-200 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-black">{selectedDiscipline.name}</h3>
                        <button
                          type="button"
                          onClick={() => handleCreateSubActivity(selectedDiscipline.id)}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
                        >
                          <PlusIcon className="h-4 w-4" />
                          Add Sub-Activity
                        </button>
                      </div>
                      <p className="text-sm text-gray-600 max-w-2xl">
                        {selectedDiscipline.description || 'No description provided.'}
                      </p>
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
                                <th className="px-3 py-2 text-left">Description</th>
                                <th className="px-3 py-2 text-left">Default Duration</th>
                                <th className="px-3 py-2 text-left">Default Manhours</th>
                                <th className="px-3 py-2 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedDiscipline.subActivities.map((sub) => (
                                <tr key={sub.id} className="border-t border-gray-200 hover:bg-gray-50">
                                  <td className="px-3 py-3 text-gray-800 font-medium">{sub.name}</td>
                                  <td className="px-3 py-3 text-gray-600">{sub.description || '—'}</td>
                                  <td className="px-3 py-3 text-gray-600">{sub.defaultDuration || '—'}</td>
                                  <td className="px-3 py-3 text-gray-600">{sub.defaultManhours || '—'}</td>
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
                                        onClick={() => handleDeleteSubActivity(selectedDiscipline.id, sub.id)}
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

                      {showSubActivityForm && (
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
                            <div>
                              <label className="block text-xs font-medium text-black mb-1">Description</label>
                              <textarea
                                name="description"
                                value={subActivityForm.description}
                                onChange={(event) =>
                                  setSubActivityForm((prev) => ({ ...prev, description: event.target.value }))
                                }
                                rows={3}
                                placeholder="Define the expected deliverable for this task"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                              />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-black mb-1">Default Duration</label>
                                <input
                                  type="text"
                                  name="defaultDuration"
                                  value={subActivityForm.defaultDuration}
                                  onChange={(event) =>
                                    setSubActivityForm((prev) => ({ ...prev, defaultDuration: event.target.value }))
                                  }
                                  placeholder="e.g., 5 days"
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-black mb-1">Default Manhours</label>
                                <input
                                  type="text"
                                  name="defaultManhours"
                                  value={subActivityForm.defaultManhours}
                                  onChange={(event) =>
                                    setSubActivityForm((prev) => ({ ...prev, defaultManhours: event.target.value }))
                                  }
                                  placeholder="e.g., 24 hrs"
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                                />
                              </div>
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
                ) : (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center text-sm text-gray-500">
                    Select a discipline or create a new one to view sub-activities.
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
