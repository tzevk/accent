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
  const [disciplineForm, setDisciplineForm] = useState({ name: '', description: '' });
  const [subActivityForm, setSubActivityForm] = useState(EMPTY_SUB_ACTIVITY);
  const [selectedDisciplineId, setSelectedDisciplineId] = useState(null);
  const [editingSubId, setEditingSubId] = useState(null);
  const [showDisciplineForm, setShowDisciplineForm] = useState(false); // unused but kept for safety
  const [showSubActivityForm, setShowSubActivityForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Use fixed disciplines list (non-editable)
  useEffect(() => {
    setLoading(true);
    const mapped = FIXED_DISCIPLINES.flatMap((entry, index) => {
      const parentId = `fixed_${index}`;
      const parent = {
        id: parentId,
        name: entry.name,
        description: '',
        activityCount: 0,
        subActivities: [],
        children: [],
      };
      const children = (entry.children || []).map((c, ci) => ({
        id: `${parentId}_child_${ci}`,
        name: c,
        parentId,
        description: '',
        activityCount: 0,
        subActivities: [],
      }));
      parent.children = children;
      return [parent, ...children];
    });
    setDisciplines(mapped);
    setLoading(false);
  }, []);

  // ✅ Fetch sub-activities when discipline selected
  useEffect(() => {
    if (!selectedDisciplineId) return;
    async function loadSubActivities() {
      try {
        // If the selected discipline is one of the fixed entries (string id), do not call server
        if (String(selectedDisciplineId).startsWith('fixed_')) {
          const local = disciplines.find((d) => d.id === selectedDisciplineId);
          const data = local?.subActivities || [];
          setActivities(data.map((a) => ({
            id: a.id || `local_${Math.random().toString(36).slice(2, 9)}`,
            name: a.activity_name || a.name,
            defaultDuration: a.default_duration || a.defaultDuration || "",
            defaultManhours: a.default_manhours || a.defaultManhours || "",
          })));
          return;
        }

        const res = await fetch(`/api/activities?function_id=${selectedDisciplineId}`);
        if (!res.ok) throw new Error("Failed to fetch sub-activities");
        const data = await res.json();
        setActivities(data.map((a) => ({
          id: a.id,
          name: a.activity_name,
          defaultDuration: a.default_duration || "",
          defaultManhours: a.default_manhours || "",
        })));

        // Update discipline list with sub-activities
        setDisciplines((prev) =>
          prev.map((d) =>
            d.id === selectedDisciplineId
              ? { ...d, subActivities: data, activityCount: data.length }
              : d
          )
        );
      } catch (err) {
        console.error(err);
      }
    }
    loadSubActivities();
  }, [selectedDisciplineId]);

  // ✅ Filter disciplines by search term
  const filteredDisciplines = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return disciplines.filter((discipline) => {
      const matchDiscipline =
        discipline.name.toLowerCase().includes(term) ||
        (discipline.description || "").toLowerCase().includes(term);
      const matchSub = discipline.subActivities?.some((sub) =>
        sub.name.toLowerCase().includes(term)
      );
      return matchDiscipline || matchSub;
    });
  }, [disciplines, searchTerm]);

  const selectedDiscipline = useMemo(
    () => disciplines.find((d) => d.id === selectedDisciplineId) || null,
    [disciplines, selectedDisciplineId]
  );

  // Discipline management removed — disciplines are fixed list

  // ✅ Create Sub-Activity
  const handleCreateSubActivity = (disciplineId) => {
    setSelectedDisciplineId(disciplineId);
    setSubActivityForm(EMPTY_SUB_ACTIVITY);
    setEditingSubId(null);
    setShowSubActivityForm(true);
  };

  // ✅ Edit Sub-Activity
  const handleEditSubActivity = (disciplineId, subId) => {
    setSelectedDisciplineId(disciplineId);
    const discipline = disciplines.find((d) => d.id === disciplineId);
    const sub = discipline?.subActivities.find((s) => s.id === subId);
    if (!sub) return;
    setSubActivityForm(sub);
    setEditingSubId(subId);
    setShowSubActivityForm(true);
  };

  // ✅ Delete Sub-Activity
  const handleDeleteSubActivity = async (subId) => {
    if (!confirm("Delete this sub-activity?")) return;
    // If fixed discipline (string id) treat as local delete
    if (String(selectedDisciplineId).startsWith('fixed_')) {
      setActivities((prev) => prev.filter((a) => a.id !== subId));
      setDisciplines((prev) =>
        prev.map((d) =>
          d.id === selectedDisciplineId
            ? {
                ...d,
                subActivities: d.subActivities.filter((a) => String(a.id) !== String(subId)),
                activityCount: Math.max(0, d.activityCount - 1),
              }
            : d
        )
      );
      return;
    }

    await fetch(`/api/activities/${subId}`, { method: "DELETE" });
    setActivities((prev) => prev.filter((a) => a.id !== subId));
    setDisciplines((prev) =>
      prev.map((d) =>
        d.id === selectedDisciplineId
          ? {
              ...d,
              subActivities: d.subActivities.filter((a) => a.id !== subId),
              activityCount: d.activityCount - 1,
            }
          : d
      )
    );
  };

  // ✅ Save Sub-Activity
  const handleSubActivitySubmit = async (e) => {
    e.preventDefault();
    if (!selectedDisciplineId || !subActivityForm.name.trim()) return;
    // If fixed discipline, add locally
    if (String(selectedDisciplineId).startsWith('fixed_')) {
      const newLocal = {
        id: `local_${Math.random().toString(36).slice(2, 9)}`,
        name: subActivityForm.name,
        defaultDuration: subActivityForm.defaultDuration,
        defaultManhours: subActivityForm.defaultManhours,
      };
      setActivities((prev) => [...prev, newLocal]);
      setDisciplines((prev) =>
        prev.map((d) =>
          d.id === selectedDisciplineId
            ? { ...d, subActivities: [...(d.subActivities || []), newLocal], activityCount: (d.activityCount || 0) + 1 }
            : d
        )
      );
      setSubActivityForm(EMPTY_SUB_ACTIVITY);
      setShowSubActivityForm(false);
      return;
    }

    const payload = {
      function_id: selectedDisciplineId,
      activity_name: subActivityForm.name,
      default_duration: subActivityForm.defaultDuration,
      default_manhours: subActivityForm.defaultManhours,
    };

    await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSubActivityForm(EMPTY_SUB_ACTIVITY);
    setShowSubActivityForm(false);

    // Refresh activities
    const res = await fetch(`/api/activities?function_id=${selectedDisciplineId}`);
    const data = await res.json();
    setActivities(data);
    setDisciplines((prev) =>
      prev.map((d) =>
        d.id === selectedDisciplineId
          ? { ...d, subActivities: data, activityCount: data.length }
          : d
      )
    );
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
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left - Discipline List */}
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <h2 className="text-sm font-semibold text-black">Disciplines</h2>
                {filteredDisciplines.length === 0 ? (
                  <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-5 text-center">
                    No disciplines yet. Create your first discipline.
                  </div>
                ) : (
                  // Render parents with their children nested beneath
                  filteredDisciplines
                    .filter((d) => !d.parentId)
                    .map((parent) => {
                      const children = filteredDisciplines.filter((c) => c.parentId === parent.id);
                      return (
                        <div key={parent.id} className="space-y-2">
                          <div
                            className={`border rounded-lg px-4 py-3 cursor-pointer ${
                              selectedDisciplineId === parent.id
                                ? "border-[#7F2487] bg-[#7F2487]/10"
                                : "border-gray-200 hover:bg-gray-50"
                            }`}
                            onClick={() => setSelectedDisciplineId(parent.id)}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-semibold text-black">{parent.name}</p>
                                <p className="text-xs text-gray-500">{parent.description}</p>
                              </div>
                              <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">
                                {parent.activityCount} activities
                              </span>
                            </div>
                            <div className="mt-2 text-xs text-gray-500">{parent.children?.length ? 'Discipline group' : 'Fixed discipline'}</div>
                          </div>

                          {children.length > 0 && (
                            <div className="pl-6 space-y-2">
                              {children.map((child) => (
                                <div
                                  key={child.id}
                                  className={`border rounded-lg px-3 py-2 cursor-pointer text-sm ${
                                    selectedDisciplineId === child.id
                                      ? "border-[#7F2487] bg-[#7F2487]/10"
                                      : "border-gray-200 hover:bg-gray-50"
                                  }`}
                                  onClick={() => setSelectedDisciplineId(child.id)}
                                >
                                  <div className="flex justify-between items-start">
                                    <div>
                                      <p className="font-semibold text-black">{child.name}</p>
                                    </div>
                                    <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">
                                      {child.activityCount} activities
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                )}

                {showDisciplineForm && (
                  <form onSubmit={handleDisciplineSubmit} className="space-y-3 border-t pt-4 mt-4">
                    <input
                      type="text"
                      value={disciplineForm.name}
                      onChange={(e) =>
                        setDisciplineForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder="Discipline Name"
                      required
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    />
                    <textarea
                      value={disciplineForm.description}
                      onChange={(e) =>
                        setDisciplineForm((prev) => ({ ...prev, description: e.target.value }))
                      }
                      placeholder="Description"
                      rows={3}
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setShowDisciplineForm(false)}
                        className="px-4 py-2 bg-gray-100 rounded-md"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 bg-[#7F2487] text-white rounded-md"
                      >
                        {editingDisciplineId ? "Update" : "Save"}
                      </button>
                    </div>
                  </form>
                )}
              </section>

              {/* Right - Sub-Activities */}
              <section className="lg:col-span-2 space-y-4">
                {!selectedDiscipline ? (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center text-sm text-gray-500">
                    Select a discipline to view its activities.
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                    <div className="px-6 py-5 border-b flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-black">{selectedDiscipline.name}</h3>
                      <button
                        onClick={() => handleCreateSubActivity(selectedDiscipline.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-[#7F2487] text-white rounded-md"
                      >
                        <PlusIcon className="h-4 w-4" /> Add Sub-Activity
                      </button>
                    </div>

                    {/* Activities Table */}
                    <div className="p-6">
                      {activities.length === 0 ? (
                        <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-4 py-8 text-center">
                          No sub-activities added yet.
                        </div>
                      ) : (
                        <table className="min-w-full text-xs border border-gray-200 rounded-lg">
                          <thead className="bg-gray-50 text-gray-600 uppercase">
                            <tr>
                              <th className="px-3 py-2 text-left">Sub-Activity</th>
                              <th className="px-3 py-2 text-left">Duration</th>
                              <th className="px-3 py-2 text-left">Manhours</th>
                              <th className="px-3 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activities.map((sub) => (
                              <tr key={sub.id} className="border-t hover:bg-gray-50">
                                <td className="px-3 py-2">{sub.name}</td>
                                <td className="px-3 py-2">{sub.defaultDuration || "—"}</td>
                                <td className="px-3 py-2">{sub.defaultManhours || "—"}</td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    onClick={() =>
                                      handleEditSubActivity(selectedDiscipline.id, sub.id)
                                    }
                                    className="p-1.5 text-gray-600 hover:text-gray-800"
                                  >
                                    <PencilIcon className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteSubActivity(sub.id)}
                                    className="p-1.5 text-red-600 hover:text-red-800"
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
                              placeholder="Default Duration (hrs)"
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
                              placeholder="Default Manhours (hrs)"
                              className="w-full px-3 py-2 border rounded-md text-sm"
                            />
                          </div>
                          <div className="flex justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => setShowSubActivityForm(false)}
                              className="px-4 py-2 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className="px-5 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors font-medium"
                            >
                              {editingSubId ? "Update Sub-Activity" : "Save Sub-Activity"}
                            </button>
                          </div>
                        </form>
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