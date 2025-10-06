"use client";

// Import necessary components and hooks
import Navbar from "@/components/Navbar";
import { useEffect, useMemo, useState } from "react";
import { PlusIcon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";

// Initial empty discipline object
const EMPTY_DISCIPLINE = {
  name: "",
  description: "",
};

// Initial empty sub-activity object
const EMPTY_SUB_ACTIVITY = {
  name: "",
  defaultDuration: 0,
  defaultManhours: 0,
};

// Main component for the Activity Master page
export default function ActivityMasterPage() {
  // State for list of disciplines (functions)
  const [disciplines, setDisciplines] = useState([]);
  // State for discipline form data
  const [disciplineForm, setDisciplineForm] = useState(EMPTY_DISCIPLINE);
  // State for sub-activity form data
  const [subActivityForm, setSubActivityForm] = useState(EMPTY_SUB_ACTIVITY);
  // State for currently selected discipline ID
  const [selectedDisciplineId, setSelectedDisciplineId] = useState(null);
  // State for discipline being edited
  const [editingDisciplineId, setEditingDisciplineId] = useState(null);
  // State for sub-activity being edited
  const [editingSubId, setEditingSubId] = useState(null);
  // State to show/hide discipline form
  const [showDisciplineForm, setShowDisciplineForm] = useState(false);
  // State to show/hide sub-activity form
  const [showSubActivityForm, setShowSubActivityForm] = useState(false);
  // State for search input
  const [searchTerm, setSearchTerm] = useState("");
  // State to store activities for a discipline
  const [activities, setActivities] = useState([]);

  // Fetch all disciplines (functions) on mount
  useEffect(() => {
    async function loadFunctions() {
      const res = await fetch("/api/functions");
      const data = await res.json();
      // Map API data to discipline objects
      const mapped = data.map((fn) => ({
        id: fn.id,
        name: fn.function_name,
        description: fn.description,
        activityCount: fn.activity_count || 0,
      }));
      setDisciplines(mapped);
    }
    loadFunctions();
  }, []);

  // Fetch sub-activities for the selected discipline
  useEffect(() => {
    if (!selectedDisciplineId) return;

    async function loadSubActivities() {
      const res = await fetch(
        `/api/activities?function_id=${selectedDisciplineId}`
      );
      if (!res.ok) {
        console.error("Failed to load sub activities");
        setActivities([]);
        return;
      }

      let data = [];
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : [];
        setActivities(
          data.map((a) => ({
            id: a.id,
            name: a.activity_name,
            defaultDuration: a.default_duration || "",
            defaultManhours: a.default_manhours || "",
          }))
        );
      } catch (err) {
        console.warn("Invalid JSON from /api/activities:", err);
        data = [];
      }

      // Update the selected discipline with its sub-activities
      setDisciplines((prev) =>
        prev.map((d) =>
          d.id === selectedDisciplineId
            ? {
                ...d,
                subActivities: data.map((a) => ({
                  id: a.id,
                  name: a.activity_name,
                  description: a.description,
                  defaultDuration: a.default_duration || "",
                  defaultManhours: a.default_manhours || "",
                })),
              }
            : d
        )
      );
    }

    loadSubActivities();
  }, [selectedDisciplineId]);

  // Filter disciplines and sub-activities by search term
  const filteredDisciplines = useMemo(() => {
    if (!searchTerm) {
      return disciplines;
    }
    const term = searchTerm.toLowerCase();
    return disciplines.filter((discipline) => {
      const matchDiscipline =
        discipline.name.toLowerCase().includes(term) ||
        (discipline.description || "").toLowerCase().includes(term);
      const matchSub = discipline.subActivities.some((sub) =>
        sub.name.toLowerCase().includes(term)
      );
      return matchDiscipline || matchSub;
    });
  }, [disciplines, searchTerm]);

  // Get the currently selected discipline object
  const selectedDiscipline = useMemo(
    () => disciplines.find((item) => item.id === selectedDisciplineId) || null,
    [disciplines, selectedDisciplineId]
  );

  // Show form to create a new discipline
  const handleCreateDiscipline = () => {
    setDisciplineForm(EMPTY_DISCIPLINE);
    setEditingDisciplineId(null);
    setShowDisciplineForm(true);
  };

  // Show form to edit an existing discipline
  const handleEditDiscipline = (disciplineId) => {
    const existing = disciplines.find((item) => item.id === disciplineId);
    if (!existing) return;
    setDisciplineForm({ ...existing });
    setEditingDisciplineId(disciplineId);
    setShowDisciplineForm(true);
  };

  // Delete a discipline from the list
  const handleDeleteDiscipline = (disciplineId) => {
    setDisciplines((prev) => prev.filter((item) => item.id !== disciplineId));
    if (selectedDisciplineId === disciplineId) {
      setSelectedDisciplineId(null);
      setShowSubActivityForm(false);
    }
  };

  // Submit handler for discipline form (create or update)
  const handleDisciplineSubmit = async (event) => {
    event.preventDefault();
    const payload = {
      function_name: disciplineForm.name,
      description: disciplineForm.description,
      status: "active",
    };

    if (editingDisciplineId) {
      // Update existing discipline
      await fetch(`/api/functions/${editingDisciplineId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      // Create new discipline
      await fetch("/api/functions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    setShowDisciplineForm(false);
    setDisciplineForm(EMPTY_DISCIPLINE);
    setEditingDisciplineId(null);
    // Reload disciplines from API
    const res = await fetch("/api/functions");
    setDisciplines(await res.json());
  };

  // Show form to create a new sub-activity for a discipline
  const handleCreateSubActivity = (disciplineId) => {
    setSelectedDisciplineId(disciplineId);
    setSubActivityForm(EMPTY_SUB_ACTIVITY);
    setEditingSubId(null);
    setShowSubActivityForm(true);
  };

  // Show form to edit an existing sub-activity
  const handleEditSubActivity = (disciplineId, subId) => {
    setSelectedDisciplineId(disciplineId);
    const discipline = disciplines.find((item) => item.id === disciplineId);
    const sub = discipline?.subActivities.find((item) => item.id === subId);
    if (!sub) return;
    setSubActivityForm({ ...sub });
    setEditingSubId(subId);
    setShowSubActivityForm(true);
  };

  // Delete a sub-activity from a discipline
  const handleDeleteSubActivity = async (subId) => {
    try {
      // Call the API to delete the sub-activity
      const res = await fetch(`/api/activities/${subId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        console.error("Failed to delete sub-activity");
        return;
      }

      // Remove from local state after successful deletion
      setDisciplines((prev) =>
        prev.map((discipline) =>
          discipline.id === disciplineId
            ? {
                ...discipline,
                subActivities: discipline.subActivities.filter(
                  (item) => item.id !== subId
                ),
                activityCount: (discipline.subActivities.length || 1) - 1, // update count
              }
            : discipline
        )
      );

      // Also update the activities state if currently selected
      if (disciplineId === selectedDisciplineId) {
        setActivities((prev) => prev.filter((item) => item.id !== subId));
      }
    } catch (error) {
      console.error("Error deleting sub-activity:", error);
    }
  };

  // Submit handler for sub-activity form (create only)
  const handleSubActivitySubmit = async (event) => {
    event.preventDefault();
    if (!selectedDisciplineId) return;

    const payload = {
      function_id: selectedDisciplineId,
      activity_name: subActivityForm.name,
      default_duration: subActivityForm.defaultDuration,
      default_manhours: subActivityForm.defaultManhours,
    };
    console.log(payload);

    await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSubActivityForm(EMPTY_SUB_ACTIVITY);
    setShowSubActivityForm(false);

    // Reload activities from the API
    const res = await fetch(
      `/api/activities?function_id=${selectedDisciplineId}`
    );
    const data = await res.json();

    // Update disciplines state with fresh sub-activities
    setDisciplines((prev) =>
      prev.map((d) =>
        d.id === selectedDisciplineId
          ? {
              ...d,
              subActivities: data.map((a) => ({
                id: a.id,
                name: a.activity_name,
                defaultDuration: a.default_duration || "",
                defaultManhours: a.default_manhours || "",
              })),
              activityCount: data.length, // update count
            }
          : d
      )
    );

    // Also update activities state for rendering
    setActivities(
      data.map((a) => ({
        id: a.id,
        name: a.activity_name,
        defaultDuration: a.default_duration || "",
        defaultManhours: a.default_manhours || "",
      }))
    );
  };

  // Render the page UI
  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Top navigation bar */}
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8 space-y-6">
            {/* Header and search bar */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-black">
                  Activity Master Catalogue
                </h1>
                <p className="text-sm text-gray-600">
                  Configure reusable disciplines and sub-activities so new
                  projects can be populated instantly.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* Search input */}
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search disciplines or activities…"
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                />
                {/* Button to create new discipline */}
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

            {/* Main grid: disciplines list and sub-activities section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Disciplines list section */}
              <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-black">
                    Disciplines
                  </h2>
                  <span className="text-xs text-gray-500">
                    {filteredDisciplines.length} total
                  </span>
                </div>

                {/* List of disciplines or empty state */}
                <div className="space-y-3">
                  {filteredDisciplines.length === 0 ? (
                    <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-5 text-center">
                      No disciplines yet. Create your first discipline to build
                      the catalogue.
                    </div>
                  ) : (
                    filteredDisciplines.map((discipline) => {
                      const isSelected = discipline.id === selectedDisciplineId;
                      return (
                        <div
                          key={discipline.id}
                          className={`border rounded-lg px-4 py-3 transition-colors ${
                            isSelected
                              ? "border-[#7F2487] bg-[#7F2487]/10"
                              : "border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            {/* Select discipline button */}
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedDisciplineId(discipline.id)
                              }
                              className="text-left flex-1"
                            >
                              <p className="text-sm font-semibold text-black">
                                {discipline.name}
                              </p>
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                {discipline.description ||
                                  "No description provided."}
                              </p>
                            </button>
                            {/* Activities count */}
                            <span className="ml-3 inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">
                              {discipline.activityCount} activities
                            </span>
                          </div>
                          {/* Edit and delete discipline buttons */}
                          <div className="mt-3 flex items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() =>
                                handleEditDiscipline(discipline.id)
                              }
                              className="px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleDeleteDiscipline(discipline.id)
                              }
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

                {/* Discipline form for create/edit */}
                {showDisciplineForm && (
                  <div className="mt-5 border-t border-gray-200 pt-4">
                    <form
                      onSubmit={handleDisciplineSubmit}
                      className="space-y-4"
                    >
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Discipline Name{" "}
                          <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={disciplineForm.name}
                          onChange={(event) =>
                            setDisciplineForm((prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          required
                          className="w-full px-3 py-2 text-sm border text-black  border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Description
                        </label>
                        <textarea
                          value={disciplineForm.description}
                          onChange={(event) =>
                            setDisciplineForm((prev) => ({
                              ...prev,
                              description: event.target.value,
                            }))
                          }
                          rows={3}
                          placeholder="Outline what falls under this discipline"
                          className="w-full px-3 py-2  text-black text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
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
                          {editingDisciplineId
                            ? "Update Discipline"
                            : "Save Discipline"}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </section>

              {/* Sub-activities section for selected discipline */}
              <section className="lg:col-span-2 space-y-4">
                {selectedDiscipline ? (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                    {/* Discipline header and add sub-activity button */}
                    <div className="px-6 py-5 border-b border-gray-200 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-black">
                          {selectedDiscipline.name}
                        </h3>
                        <button
                          type="button"
                          onClick={() =>
                            handleCreateSubActivity(selectedDiscipline.id)
                          }
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
                        >
                          <PlusIcon className="h-4 w-4" />
                          Add Sub-Activity
                        </button>
                      </div>
                      <p className="text-sm text-gray-600 max-w-2xl">
                        {selectedDiscipline.description ||
                          "No description provided."}
                      </p>
                    </div>

                    {/* Sub-activities table or empty state */}
                    <div className="px-6 py-5 space-y-5">
                      {selectedDiscipline.activityCount === 0 ? (
                        <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-4 py-12 text-center">
                          No sub-activities added yet. Use “Add Sub-Activity” to
                          define reusable tasks.
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                          <table className="min-w-full text-xs">
                            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                              <tr>
                                <th className="px-3 py-2 text-left">
                                  Sub-Activity
                                </th>
                                <th className="px-3 py-2 text-left">
                                  Default Duration
                                </th>
                                <th className="px-3 py-2 text-left">
                                  Default Manhours
                                </th>
                                <th className="px-3 py-2 text-right">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {activities.map((sub) => (
                                <tr
                                  key={sub.id}
                                  className="border-t border-gray-200 hover:bg-gray-50"
                                >
                                  <td className="px-3 py-3 text-gray-800 font-medium">
                                    {sub.name}
                                  </td>
                                  <td className="px-3 py-3 text-gray-600">
                                    {sub.defaultDuration || "—"}
                                  </td>
                                  <td className="px-3 py-3 text-gray-600">
                                    {sub.defaultManhours || "—"}
                                  </td>
                                  <td className="px-3 py-3 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      {/* Edit sub-activity button */}
                                      <button
                                        type="button"
                                        title="Edit sub-activity"
                                        onClick={() =>
                                          handleEditSubActivity(
                                            selectedDiscipline.id,
                                            sub.id
                                          )
                                        }
                                        className="p-1.5 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                                      >
                                        <PencilIcon className="h-4 w-4" />
                                      </button>
                                      {/* Delete sub-activity button */}
                                      <button
                                        type="button"
                                        title="Remove sub-activity"
                                        onClick={() =>
                                          handleDeleteSubActivity(sub.id)
                                        }
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

                      {/* Sub-activity form for create/edit */}
                      {showSubActivityForm && (
                        <div className="border-t border-gray-200 pt-4">
                          <form
                            onSubmit={handleSubActivitySubmit}
                            className="space-y-4"
                          >
                            <div>
                              <label className="block text-xs font-medium text-black mb-1">
                                Sub-Activity Name *
                              </label>
                              <input
                                type="text"
                                name="name"
                                value={subActivityForm.name}
                                onChange={(event) =>
                                  setSubActivityForm((prev) => ({
                                    ...prev,
                                    name: event.target.value,
                                  }))
                                }
                                required
                                className="w-full px-3 py-2 text-sm border  text-black border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                              />
                            </div>
                            {/* <div>
                              <label className="block text-xs font-medium text-black mb-1">
                                Description
                              </label>
                              <textarea
                                name="description"
                                value={subActivityForm.description}
                                onChange={(event) =>
                                  setSubActivityForm((prev) => ({
                                    ...prev,
                                    description: event.target.value,
                                  }))
                                }
                                rows={3}
                                placeholder="Define the expected deliverable for this task"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                              />
                            </div> */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-black mb-1">
                                  Default Duration (enter in hours)
                                </label>
                                <input
                                  type="text"
                                  name="defaultDuration"
                                  value={subActivityForm.defaultDuration}
                                  onChange={(event) =>
                                    setSubActivityForm((prev) => ({
                                      ...prev,
                                      defaultDuration: event.target.value,
                                    }))
                                  }
                                  placeholder="e.g., 5 days"
                                  className="w-full px-3 py-2 text-sm  text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-black mb-1">
                                  Default Manhours (enter in hours)
                                </label>
                                <input
                                  type="text"
                                  name="defaultManhours"
                                  value={subActivityForm.defaultManhours}
                                  onChange={(event) =>
                                    setSubActivityForm((prev) => ({
                                      ...prev,
                                      defaultManhours: event.target.value,
                                    }))
                                  }
                                  placeholder="e.g., 24 hrs"
                                  className="w-full px-3 py-2 text-sm  text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
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
                                {editingSubId
                                  ? "Update Sub-Activity"
                                  : "Save Sub-Activity"}
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  // Empty state when no discipline is selected
                  <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center text-sm text-gray-500">
                    Select a discipline or create a new one to view
                    sub-activities.
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
