import { useState, useEffect, useCallback } from "react";
import { ChatBubbleLeftRightIcon, TrashIcon } from "@heroicons/react/24/outline";

export default function DiscussionTab({
  id: projectId,
  projectTeamMembers = [],
  sessionUser: currentUser,
}) {
  const [discussions, setDiscussions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    follow_up_date: new Date().toISOString().split("T")[0],
    description: "",
    responsible_person: "",
    logged_by: currentUser?.full_name || currentUser?.username || "",
  });

  const fetchDiscussions = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/followups`);
      const data = await res.json();
      if (data?.success) setDiscussions(data.data || []);
    } catch (e) {
      console.error("Error fetching discussions:", e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchDiscussions();
  }, [fetchDiscussions]);

  useEffect(() => {
    if (currentUser) {
      setFormData((prev) => {
        if (!prev.logged_by) {
          return {
            ...prev,
            logged_by: currentUser.full_name || currentUser.username || "",
          };
        }
        return prev;
      });
    }
  }, [currentUser]);

  const resetForm = () => {
    setFormData({
      follow_up_date: new Date().toISOString().split("T")[0],
      description: "",
      responsible_person: "",
      logged_by: currentUser?.full_name || currentUser?.username || "",
    });
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!formData.follow_up_date || !formData.description.trim()) {
      alert("Please fill in date and topic");
      return;
    }

    try {
      const url = `/api/projects/${projectId}/followups`;
      const method = editingId ? "PUT" : "POST";
      const body = editingId ? { id: editingId, ...formData } : formData;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data?.success) {
        resetForm();
        fetchDiscussions();
      } else {
        alert(data?.error || "Failed to save discussion");
      }
    } catch (e) {
      console.error("Error saving discussion:", e);
      alert("Failed to save discussion");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this discussion?")) return;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/followups?followup_id=${id}`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json();
      if (data?.success) {
        fetchDiscussions();
      } else {
        alert(data?.error || "Failed to delete");
      }
    } catch (e) {
      console.error("Error deleting discussion:", e);
      alert("Failed to delete discussion");
    }
  };

  const handleEdit = (item) => {
    setFormData({
      follow_up_date: item.follow_up_date?.split("T")[0] || "",
      description: item.description || "",
      responsible_person: item.responsible_person || "",
      logged_by: item.logged_by || item.created_by || "",
    });
    setEditingId(item.id);
  };

  if (loading) {
    return (
      <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <ChatBubbleLeftRightIcon className="h-5 w-5 text-purple-600" />
            Discussion
          </h3>
          <span className="text-sm text-gray-500">
            {discussions.length} entries
          </span>
        </div>

        {/* Table with Add Row */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase w-12">
                  S.No
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase w-28">
                  Date
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">
                  Topic
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase w-40">
                  Participants
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase w-32">
                  Logged By
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-600 uppercase w-24">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {/* Add/Edit Input Row */}
              <tr className="bg-purple-50 border-b-2 border-purple-200">
                <td className="px-3 py-2 text-gray-400 text-xs">
                  {editingId ? "#" : "New"}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="date"
                    value={formData.follow_up_date}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        follow_up_date: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-purple-500 focus:border-purple-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    placeholder="Discussion topic..."
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-purple-500 focus:border-purple-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={formData.responsible_person}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        responsible_person: e.target.value,
                      }))
                    }
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-purple-500 focus:border-purple-500"
                  >
                    <option value="">Select...</option>
                    {projectTeamMembers.map((member) => (
                      <option key={member.id} value={member.name}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={formData.logged_by}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        logged_by: e.target.value,
                      }))
                    }
                    placeholder="Your name"
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-purple-500 focus:border-purple-500 bg-gray-50"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-center gap-1">
                    {editingId && (
                      <button
                        onClick={resetForm}
                        className="px-2 py-1 text-gray-600 hover:bg-gray-200 rounded text-xs"
                        title="Cancel"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      onClick={handleSubmit}
                      className="px-3 py-1 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700"
                    >
                      {editingId ? "Update" : "Add"}
                    </button>
                  </div>
                </td>
              </tr>

              {/* Data Rows */}
              {discussions.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-3 py-8 text-center text-gray-400">
                    No discussions yet. Add one above.
                  </td>
                </tr>
              ) : (
                discussions.map((item, index) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-500 font-medium">
                      {index + 1}
                    </td>
                    <td className="px-3 py-2.5 text-gray-900">
                      {item.follow_up_date
                        ? new Date(item.follow_up_date).toLocaleDateString(
                            "en-IN",
                            {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            },
                          )
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">
                      {item.description || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 text-sm">
                      {item.responsible_person || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-sm">
                      {item.logged_by || item.created_by || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleEdit(item)}
                          className="p-1 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                          title="Edit"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1 text-red-500 hover:bg-red-100 rounded transition-colors"
                          title="Delete"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
