import { Fragment, useState, useEffect } from "react";
import { fetchJSON } from "@/utils/http";
import {
  ClipboardDocumentListIcon,
  ClockIcon,
  CheckCircleIcon,
  XMarkIcon,
  PlusIcon,
  UserIcon,
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

export default function ProjectActivityTab({
  projectActivities,
  getActivityTotalPlanned,
  getActivityTotalActual,
  functions,
  toggleActivitySelector,
  showActivitySelector,
  activitySelectorSearch,
  setActivitySelectorSearch,
  getSelectedCount,
  addSelectedActivities,
  selectedActivitiesForAdd,
  toggleAllActivitiesInDiscipline,
  toggleActivitySelection,
  editingActivityId,
  setEditingActivityId,
  updateScopeActivity,
  allUsers,
  userMaster,
  projectTeamMembers,
  updateUserManhours,
  toggleUserForActivity,
  openUserSelectorForActivity,
  setOpenUserSelectorForActivity,
  isUserAssigned,
  removeScopeActivity,
}) {
  const [masterDisciplines, setMasterDisciplines] = useState([]);

  useEffect(() => {
    let active = true;
    const fetchActivities = async () => {
      try {
        const res = await fetchJSON("/api/activity-master");
        if (res.success && res.data && active) {
          setMasterDisciplines(res.data);
        }
      } catch (err) {
        console.error("Failed to fetch activity master:", err);
      }
    };
    fetchActivities();
    return () => {
      active = false;
    };
  }, []);

  const handleDoneEditing = async (act) => {
    setEditingActivityId(null);

    const matchingActivity = masterDisciplines
      ?.flatMap((d) => d.activities || [])
      ?.find(
        (a) =>
          String(a.id) === String(act.id) ||
          a.activity_name?.toLowerCase() ===
          (act.activity_name || act.name)?.toLowerCase()
      );
    const subActivities = matchingActivity?.subActivities || [];

    const exists = subActivities.some(
      (sub) =>
        sub.name?.trim().toLowerCase() ===
        act.sub_activity_name?.trim().toLowerCase()
    );

    if (act.sub_activity_name?.trim() && !exists && matchingActivity?.id) {
      try {
        const res = await fetchJSON("/api/activity-master/subactivities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activity_id: matchingActivity.id,
            name: act.sub_activity_name.trim(),
          }),
        });
        if (res.success) {
          const refreshRes = await fetchJSON("/api/activity-master");
          if (refreshRes.success && refreshRes.data) {
            setMasterDisciplines(refreshRes.data);
          }
        }
      } catch (err) {
        console.error("Failed to add sub-activity to master database:", err);
      }
    }
  };
  const disciplineColors = {
    0: "border-l-indigo-400",
    1: "border-l-teal-400",
    2: "border-l-rose-400",
    3: "border-l-amber-400",
    4: "border-l-cyan-400",
    5: "border-l-violet-400",
    6: "border-l-emerald-400",
    7: "border-l-orange-400",
  };

  const avatarColors = [
    "bg-blue-100 text-blue-600",
    "bg-emerald-100 text-emerald-600",
    "bg-purple-100 text-purple-600",
    "bg-rose-100 text-rose-600",
    "bg-amber-100 text-amber-600",
    "bg-cyan-100 text-cyan-600",
  ];

  return (
    <section
      className="bg-white border border-gray-200 rounded-xl shadow-sm"
      style={{ overflow: "visible" }}
    >
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white rounded-t-xl">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-100 rounded-lg">
            <ClipboardDocumentListIcon className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-800 text-base">
              Project Activities
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {projectActivities.length} activities across{" "}
              {
                Object.keys(
                  projectActivities.reduce((acc, a) => {
                    acc[
                      a.discipline || a.function_name || "Manual"
                    ] = true;
                    return acc;
                  }, {}),
                ).length
              }{" "}
              disciplines
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">
            <ClockIcon className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-xs text-blue-700 font-medium">
              Plan:{" "}
              {projectActivities
                .reduce(
                  (sum, a) => sum + getActivityTotalPlanned(a),
                  0,
                )
                .toFixed(1)}
              h
            </span>
          </div>
          <div className="flex items-center gap-2 bg-green-50 px-3 py-1.5 rounded-lg border border-green-100">
            <CheckCircleIcon className="h-3.5 w-3.5 text-green-500" />
            <span className="text-xs text-green-700 font-medium">
              Actual:{" "}
              {projectActivities
                .reduce(
                  (sum, a) => sum + getActivityTotalActual(a),
                  0,
                )
                .toFixed(1)}
              h
            </span>
          </div>
        </div>
      </div>

      <div
        className="p-5 space-y-5"
        style={{ overflow: "visible" }}
      >
        {functions.length > 0 && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleActivitySelector}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all shadow-sm ${showActivitySelector
                ? "bg-gray-100 text-gray-700 border border-gray-300"
                : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
            >
              {showActivitySelector ? (
                <>
                  <XMarkIcon className="h-4 w-4" />
                  Close
                </>
              ) : (
                <>
                  <PlusIcon className="h-4 w-4" />
                  Add Activities
                </>
              )}
            </button>
            {projectActivities.length > 0 && (
              <div className="text-xs text-gray-400 font-medium">
                {projectActivities.length} added
              </div>
            )}
          </div>
        )}

        {showActivitySelector && functions.length > 0 && (
          <div className="border border-gray-200 rounded-lg bg-white text-sm">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
              <input
                type="text"
                value={activitySelectorSearch}
                onChange={(e) =>
                  setActivitySelectorSearch(e.target.value)
                }
                placeholder="Search..."
                className="px-2 py-1 text-sm border border-gray-300 rounded w-48 focus:outline-none focus:border-blue-500"
              />
              <div className="flex items-center gap-3">
                {getSelectedCount() > 0 && (
                  <span className="text-blue-600 font-medium">
                    {getSelectedCount()} selected
                  </span>
                )}
                <button
                  type="button"
                  onClick={addSelectedActivities}
                  disabled={getSelectedCount() === 0}
                  className="px-3 py-1 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
              {functions.map((func) => {
                const filteredActs = (
                  func.activities || []
                ).filter(
                  (act) =>
                    !activitySelectorSearch ||
                    act.activity_name
                      ?.toLowerCase()
                      .includes(
                        activitySelectorSearch.toLowerCase(),
                      ),
                );
                if (
                  activitySelectorSearch &&
                  filteredActs.length === 0
                )
                  return null;
                const allSelected =
                  filteredActs.length > 0 &&
                  filteredActs.every(
                    (act) =>
                      selectedActivitiesForAdd[
                      `${func.id}|${act.id}`
                      ],
                  );
                const someSelected = filteredActs.some(
                  (act) =>
                    selectedActivitiesForAdd[
                    `${func.id}|${act.id}`
                    ],
                );
                return (
                  <div key={func.id}>
                    <div
                      className={`flex items-center gap-2 px-3 py-1 bg-gray-50 ${filteredActs.length > 0 ? "cursor-pointer hover:bg-gray-100" : ""}`}
                      onClick={() =>
                        filteredActs.length > 0 &&
                        toggleAllActivitiesInDiscipline(
                          func.id,
                          filteredActs,
                        )
                      }
                    >
                      {filteredActs.length > 0 ? (
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) =>
                            el &&
                            (el.indeterminate =
                              someSelected && !allSelected)
                          }
                          onChange={() =>
                            toggleAllActivitiesInDiscipline(
                              func.id,
                              filteredActs,
                            )
                          }
                          className="h-3.5 w-3.5 text-blue-600 rounded border-gray-300"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="h-3.5 w-3.5" />
                      )}
                      <span className="font-medium text-gray-700 text-xs">
                        {func.function_name}
                      </span>
                      <span className="text-gray-400 text-xs">
                        {filteredActs.length > 0
                          ? `(${filteredActs.length})`
                          : "(no activities)"}
                      </span>
                    </div>
                    {filteredActs.length > 0 && (
                      <div className="grid grid-cols-3 gap-x-1 px-2 py-1">
                        {filteredActs.map((activity) => {
                          const isAlreadyAdded =
                            projectActivities.some(
                              (pa) =>
                                String(pa.id) ===
                                String(activity.id) &&
                                pa.type === "activity",
                            );
                          const isSelected =
                            selectedActivitiesForAdd[
                            `${func.id}|${activity.id}`
                            ];
                          return (
                            <label
                              key={activity.id}
                              className={`flex items-center gap-1 py-0.5 cursor-pointer text-xs truncate ${isAlreadyAdded ? "opacity-40 cursor-not-allowed" : isSelected ? "text-blue-700" : "text-gray-600 hover:text-gray-900"}`}
                              title={activity.activity_name}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected || false}
                                disabled={isAlreadyAdded}
                                onChange={() =>
                                  !isAlreadyAdded &&
                                  toggleActivitySelection(
                                    func.id,
                                    activity.id,
                                  )
                                }
                                className="h-3 w-3 text-blue-600 rounded border-gray-300 flex-shrink-0"
                              />
                              <span
                                className={`truncate ${isAlreadyAdded ? "line-through" : ""}`}
                              >
                                {activity.activity_name}
                              </span>
                              {isAlreadyAdded && (
                                <span className="text-green-600 flex-shrink-0">
                                  ✓
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {projectActivities.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">
            No activities added yet. Click the button above to add
            activities.
          </div>
        ) : (
          <div>
            <div className="overflow-visible">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th
                      className="text-left py-2.5 px-3 font-semibold text-indigo-600 bg-indigo-50/50 text-[11px] uppercase tracking-wider"
                      style={{ width: "18%" }}
                    >
                      Activity Name
                    </th>
                    <th
                      className="text-left py-2.5 px-3 font-semibold text-slate-600 bg-slate-50/50 text-[11px] uppercase tracking-wider"
                      style={{ width: "22%" }}
                    >
                      Sub-Activity Name
                    </th>
                    <th
                      className="text-left py-2.5 px-3 font-semibold text-emerald-600 bg-emerald-50/50 text-[11px] uppercase tracking-wider"
                      style={{ width: "10%" }}
                    >
                      Team Member
                    </th>
                    <th
                      className="text-center py-2.5 px-2 font-semibold text-purple-600 bg-purple-50/40 text-[11px] uppercase tracking-wider"
                      style={{ width: "6%" }}
                    >
                      Unit Qty
                    </th>
                    <th
                      className="text-center py-2.5 px-2 font-semibold text-blue-600 bg-blue-50/40 text-[11px] uppercase tracking-wider"
                      style={{ width: "8%" }}
                    >
                      Start Date
                    </th>
                    <th
                      className="text-center py-2.5 px-2 font-semibold text-orange-600 bg-orange-50/40 text-[11px] uppercase tracking-wider"
                      style={{ width: "8%" }}
                    >
                      Due Date
                    </th>
                    <th
                      className="text-center py-2.5 px-2 font-semibold text-cyan-600 bg-cyan-50/40 text-[11px] uppercase tracking-wider"
                      style={{ width: "5%" }}
                    >
                      Status
                    </th>
                    <th
                      className="text-left py-2.5 px-2 font-semibold text-amber-600 bg-amber-50/40 text-[11px] uppercase tracking-wider"
                      style={{ width: "11%" }}
                    >
                      Notes
                    </th>
                    <th
                      className="text-center py-2.5 px-2 font-semibold text-gray-500 bg-gray-50/30 text-[11px] uppercase tracking-wider"
                      style={{ width: "8%" }}
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const groupedActivities =
                      projectActivities.reduce((acc, act) => {
                        const disciplineKey =
                          act.discipline ||
                          act.function_name ||
                          "Manual / Other";
                        if (!acc[disciplineKey])
                          acc[disciplineKey] = [];
                        acc[disciplineKey].push(act);
                        return acc;
                      }, {});

                    let globalActIdx = 0;

                    return Object.entries(groupedActivities).map(
                      (
                        [disciplineName, activitiesInDiscipline],
                        disciplineIdx,
                      ) => {
                        const disciplinePlanned =
                          activitiesInDiscipline.reduce(
                            (sum, a) =>
                              sum + getActivityTotalPlanned(a),
                            0,
                          );
                        const disciplineActual =
                          activitiesInDiscipline.reduce(
                            (sum, a) =>
                              sum + getActivityTotalActual(a),
                            0,
                          );

                        return (
                          <Fragment
                            key={`discipline-${disciplineName}-${disciplineIdx}`}
                          >
                            <tr className="bg-gradient-to-r from-blue-50 to-indigo-50 border-y border-blue-200">
                              <td
                                colSpan={9}
                                className="py-2 px-3"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                                      Discipline
                                    </span>
                                    <span className="text-xs font-semibold text-gray-800">
                                      {disciplineName}
                                    </span>
                                    <span className="text-[11px] text-gray-500">
                                      (
                                      {
                                        activitiesInDiscipline.length
                                      }{" "}
                                      activities)
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 text-[11px]">
                                    <span className="text-blue-700 font-medium">
                                      Plan:{" "}
                                      {disciplinePlanned.toFixed(
                                        1,
                                      )}
                                      h
                                    </span>
                                    <span className="text-green-700 font-medium">
                                      Actual:{" "}
                                      {disciplineActual.toFixed(
                                        1,
                                      )}
                                      h
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>

                            {activitiesInDiscipline.map((act) => {
                              const actIdx = globalActIdx;
                              globalActIdx += 1;
                              const matchingActivity = masterDisciplines
                                ?.flatMap((d) => d.activities || [])
                                ?.find(
                                  (a) =>
                                    String(a.id) === String(act.id) ||
                                    a.activity_name?.toLowerCase() ===
                                    (act.activity_name || act.name)?.toLowerCase(),
                                );
                              const subActivities = matchingActivity?.subActivities || [];
                              const assignedUsers =
                                act.assigned_users || [];
                              const rowCount = Math.max(
                                assignedUsers.length,
                                1,
                              );
                              const discipline =
                                act.discipline ||
                                act.function_name ||
                                "";
                              const leftBorderColor =
                                disciplineColors[actIdx % 8];

                              return (
                                <Fragment
                                  key={`${act.id}-${act.type}-${actIdx}`}
                                >
                                  {Array.from({
                                    length: rowCount,
                                  }).map((_, uIdx) => {
                                    const assignment =
                                      assignedUsers[uIdx];
                                    const hasAssignment =
                                      !!assignment;
                                    const odUserId = hasAssignment
                                      ? typeof assignment ===
                                        "object"
                                        ? assignment.user_id
                                        : assignment
                                      : null;

                                    let name = "";
                                    if (odUserId) {
                                      const userList =
                                        allUsers.length > 0
                                          ? allUsers
                                          : userMaster;
                                      const user = userList.find(
                                        (u) =>
                                          String(u.id) ===
                                          String(odUserId),
                                      );
                                      const teamMember = !user
                                        ? projectTeamMembers.find(
                                          (m) =>
                                            String(m.id) ===
                                            String(odUserId),
                                        )
                                        : null;
                                      name = user
                                        ? user.full_name ||
                                        user.employee_name ||
                                        user.username ||
                                        user.email ||
                                        "?"
                                        : teamMember
                                          ? teamMember.name ||
                                          teamMember.full_name ||
                                          teamMember.email ||
                                          "?"
                                          : "?";
                                    }

                                    const description =
                                      hasAssignment &&
                                        typeof assignment ===
                                        "object"
                                        ? assignment.description ||
                                        ""
                                        : "";
                                    const qtyAssigned =
                                      hasAssignment &&
                                        typeof assignment ===
                                        "object"
                                        ? assignment.qty_assigned ||
                                        ""
                                        : "";
                                    const startDate =
                                      hasAssignment &&
                                        typeof assignment ===
                                        "object"
                                        ? assignment.start_date ||
                                        ""
                                        : "";
                                    const dueDate =
                                      hasAssignment &&
                                        typeof assignment ===
                                        "object"
                                        ? assignment.due_date ||
                                        ""
                                        : "";
                                    const status =
                                      hasAssignment &&
                                        typeof assignment ===
                                        "object"
                                        ? assignment.status ||
                                        "Not Started"
                                        : "Not Started";
                                    const remarks =
                                      hasAssignment &&
                                        typeof assignment ===
                                        "object"
                                        ? assignment.remarks || ""
                                        : "";

                                    const statusStyles = {
                                      Completed:
                                        "text-green-700 bg-green-50 border-green-200",
                                      "In Progress":
                                        "text-blue-700 bg-blue-50 border-blue-200",
                                      "On Hold":
                                        "text-amber-700 bg-amber-50 border-amber-200",
                                      "Not Started":
                                        "text-gray-500 bg-gray-50 border-gray-200",
                                    };
                                    const isDuePast =
                                      dueDate &&
                                      new Date(dueDate) <
                                      new Date() &&
                                      status !== "Completed";
                                    const isFirstRow = uIdx === 0;
                                    const isLastRow =
                                      uIdx === rowCount - 1;

                                    return (
                                      <tr
                                        key={`${act.id}-row-${uIdx}`}
                                        className={`${isLastRow ? "border-b-2 border-b-gray-200" : "border-b border-b-gray-100"} transition-colors ${status === "Completed" ? "bg-green-50/20" : status === "On Hold" ? "bg-amber-50/20" : "hover:bg-gray-50/30"} border-l-3 ${leftBorderColor}`}
                                      >
                                        {/* Activity Name */}
                                        {isFirstRow && (
                                          <td
                                            className={`py-2 px-3 align-top border-r border-gray-100 ${editingActivityId === act.id ? "bg-blue-50/40 ring-2 ring-blue-300 ring-inset" : "bg-indigo-50/20"}`}
                                            rowSpan={rowCount}
                                          >
                                            <div className="flex flex-col gap-1">
                                              {editingActivityId ===
                                                act.id ? (
                                                <input
                                                  type="text"
                                                  value={
                                                    act.activity_name ||
                                                    act.name ||
                                                    ""
                                                  }
                                                  onChange={(e) =>
                                                    updateScopeActivity(
                                                      act.id,
                                                      "activity_name",
                                                      e.target
                                                        .value,
                                                    )
                                                  }
                                                  className="w-full px-1.5 py-1 text-xs font-medium border border-blue-400 bg-white rounded focus:outline-none focus:ring-2 focus:ring-blue-300 text-gray-800"
                                                  placeholder="Activity name"
                                                  autoFocus
                                                  onKeyDown={(
                                                    e,
                                                  ) => {
                                                    if (
                                                      e.key ===
                                                      "Enter" ||
                                                      e.key ===
                                                      "Escape"
                                                    )
                                                      handleDoneEditing(act);
                                                  }}
                                                />
                                              ) : (
                                                <span className="px-1.5 py-1 text-xs font-medium text-gray-800">
                                                  {act.activity_name ||
                                                    act.name ||
                                                    "—"}
                                                </span>
                                              )}
                                              {discipline && (
                                                <span className="text-[10px] text-gray-400 pl-1.5">
                                                  {discipline}
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                        )}
                                        {/* Sub-Activity Name */}
                                        {isFirstRow && (
                                          <td
                                            className={`py-2 px-3 align-top border-r border-gray-100 ${editingActivityId === act.id ? "bg-blue-50/40" : "bg-slate-50/20"}`}
                                            rowSpan={rowCount}
                                          >
                                            {editingActivityId ===
                                              act.id ? (
                                              <>
                                                <input
                                                  type="text"
                                                  list={`subactivities-${act.id}`}
                                                  value={
                                                    act.sub_activity_name ||
                                                    ""
                                                  }
                                                  onChange={(e) =>
                                                    updateScopeActivity(
                                                      act.id,
                                                      "sub_activity_name",
                                                      e.target.value,
                                                    )
                                                  }
                                                  onKeyDown={(e) => {
                                                    if (
                                                      e.key ===
                                                      "Enter" ||
                                                      e.key ===
                                                      "Escape"
                                                    )
                                                      handleDoneEditing(act);
                                                  }}
                                                  className="w-full px-1.5 py-1 text-xs border border-blue-400 bg-white rounded focus:outline-none focus:ring-2 focus:ring-blue-300 text-gray-800"
                                                  placeholder="Select or enter sub-activity..."
                                                />
                                                <datalist
                                                  id={`subactivities-${act.id}`}
                                                >
                                                  {subActivities.map(
                                                    (sub) => (
                                                      <option
                                                        key={sub.id}
                                                        value={sub.name}
                                                      />
                                                    ),
                                                  )}
                                                </datalist>
                                              </>
                                            ) : (
                                              <span className="px-1.5 py-1 text-xs text-gray-700">
                                                {act.sub_activity_name ||
                                                  "—"}
                                              </span>
                                            )}
                                          </td>
                                        )}
                                        {/* Team Member — one per row, same level as other fields */}
                                        <td className="py-2 px-3 bg-emerald-50/10">
                                          {hasAssignment ? (
                                            <div className="flex items-center gap-1.5">
                                              <div
                                                className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${avatarColors[uIdx % avatarColors.length]}`}
                                              >
                                                <span className="text-[9px] font-bold">
                                                  {name
                                                    .charAt(0)
                                                    .toUpperCase()}
                                                </span>
                                              </div>
                                              <span className="text-gray-800 font-medium truncate text-xs">
                                                {name}
                                              </span>
                                              <a
                                                href={`/users/${odUserId}/activity`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-shrink-0 text-blue-400 hover:text-blue-600 transition-colors"
                                                title={`View ${name}'s activity`}
                                                onClick={(e) =>
                                                  e.stopPropagation()
                                                }
                                              >
                                                <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                                              </a>
                                            </div>
                                          ) : (
                                            <span className="text-gray-300 text-xs italic">
                                              No members
                                            </span>
                                          )}
                                        </td>

                                        {/* Unit Qty */}
                                        <td className="py-2 px-2 text-center bg-purple-50/10">
                                          {hasAssignment ? (
                                            <input
                                              type="text"
                                              value={qtyAssigned}
                                              onChange={(e) =>
                                                updateUserManhours(
                                                  act.id,
                                                  odUserId,
                                                  "qty_assigned",
                                                  e.target.value,
                                                )
                                              }
                                              className="w-full px-1 py-1 text-[10px] border border-purple-200 rounded text-center focus:border-purple-400 focus:outline-none bg-white font-medium"
                                              placeholder="Qty"
                                            />
                                          ) : null}
                                        </td>
                                        {/* Start Date */}
                                        <td className="py-2 px-2 text-center bg-blue-50/10">
                                          {hasAssignment ? (
                                            <input
                                              type="date"
                                              value={startDate}
                                              onChange={(e) =>
                                                updateUserManhours(
                                                  act.id,
                                                  odUserId,
                                                  "start_date",
                                                  e.target.value,
                                                )
                                              }
                                              className="w-full px-1 py-1 text-[10px] border border-blue-200 rounded focus:border-blue-400 focus:outline-none bg-white"
                                            />
                                          ) : null}
                                        </td>
                                        {/* Due Date */}
                                        <td
                                          className={`py-2 px-2 ${isDuePast ? "bg-red-50/20" : "bg-orange-50/10"}`}
                                        >
                                          {hasAssignment ? (
                                            <input
                                              type="date"
                                              value={dueDate}
                                              onChange={(e) =>
                                                updateUserManhours(
                                                  act.id,
                                                  odUserId,
                                                  "due_date",
                                                  e.target.value,
                                                )
                                              }
                                              className={`w-full px-1 py-1 text-[10px] border rounded focus:outline-none bg-white ${isDuePast ? "border-red-300 text-red-600 focus:border-red-400" : "border-orange-200 focus:border-orange-400"}`}
                                            />
                                          ) : null}
                                        </td>
                                        {/* Status */}
                                        <td className="py-2 px-2 bg-cyan-50/10">
                                          {hasAssignment ? (
                                            <select
                                              value={status}
                                              onChange={(e) =>
                                                updateUserManhours(
                                                  act.id,
                                                  odUserId,
                                                  "status",
                                                  e.target.value,
                                                )
                                              }
                                              className={`w-full px-1 py-1 text-[10px] border rounded focus:outline-none font-medium ${statusStyles[status] || statusStyles["Not Started"]}`}
                                            >
                                              <option value="Not Started">
                                                Not Started
                                              </option>
                                              <option value="In Progress">
                                                In Progress
                                              </option>
                                              <option value="Completed">
                                                Completed
                                              </option>
                                              <option value="On Hold">
                                                On Hold
                                              </option>
                                            </select>
                                          ) : null}
                                        </td>
                                        {/* Notes */}
                                        <td className="py-2 px-2 bg-amber-50/10">
                                          {hasAssignment ? (
                                            <input
                                              type="text"
                                              value={remarks}
                                              onChange={(e) =>
                                                updateUserManhours(
                                                  act.id,
                                                  odUserId,
                                                  "remarks",
                                                  e.target.value,
                                                )
                                              }
                                              className="w-full px-2 py-1 text-xs border border-amber-200 rounded focus:border-amber-400 focus:outline-none bg-white"
                                              placeholder="Notes..."
                                            />
                                          ) : null}
                                        </td>
                                        {/* Actions */}
                                        <td className="py-2 px-2 text-center">
                                          <div className="flex items-center justify-center gap-1">
                                            {hasAssignment && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  toggleUserForActivity(
                                                    act.id,
                                                    odUserId,
                                                  )
                                                }
                                                className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                                                title={`Remove ${name}`}
                                              >
                                                <XMarkIcon className="h-3.5 w-3.5" />
                                              </button>
                                            )}
                                            {isFirstRow && (
                                              <>
                                                <div
                                                  className="relative"
                                                  data-user-selector-dropdown
                                                >
                                                  <button
                                                    type="button"
                                                    id={`add-member-btn-${act.id}`}
                                                    onClick={(
                                                      e,
                                                    ) => {
                                                      e.stopPropagation();
                                                      setOpenUserSelectorForActivity(
                                                        openUserSelectorForActivity ===
                                                          act.id
                                                          ? null
                                                          : act.id,
                                                      );
                                                    }}
                                                    className="p-1 rounded hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-colors"
                                                    title="Add team member"
                                                  >
                                                    <PlusIcon className="h-3.5 w-3.5" />
                                                  </button>
                                                  {openUserSelectorForActivity ===
                                                    act.id &&
                                                    (() => {
                                                      const btnEl =
                                                        document.getElementById(
                                                          `add-member-btn-${act.id}`,
                                                        );
                                                      const rect =
                                                        btnEl?.getBoundingClientRect() || {
                                                          bottom: 0,
                                                          right: 0,
                                                          top: 0,
                                                        };
                                                      const dropdownHeight = 220;
                                                      const spaceBelow =
                                                        window.innerHeight -
                                                        rect.bottom;
                                                      const openUpward =
                                                        spaceBelow <
                                                        dropdownHeight &&
                                                        rect.top >
                                                        dropdownHeight;
                                                      return (
                                                        <div
                                                          className="fixed z-[99999] w-56 bg-white border border-gray-200 rounded-lg shadow-2xl"
                                                          style={{
                                                            ...(openUpward
                                                              ? {
                                                                bottom:
                                                                  window.innerHeight -
                                                                  rect.top +
                                                                  4,
                                                              }
                                                              : {
                                                                top:
                                                                  rect.bottom +
                                                                  4,
                                                              }),
                                                            left: Math.max(
                                                              8,
                                                              rect.right -
                                                              224,
                                                            ),
                                                          }}
                                                          onClick={(
                                                            e,
                                                          ) =>
                                                            e.stopPropagation()
                                                          }
                                                        >
                                                          <div className="px-3 py-2 bg-emerald-50 border-b border-gray-200 text-xs font-semibold text-emerald-700 flex items-center justify-between rounded-t-lg">
                                                            <span>
                                                              Select
                                                              Team
                                                              Member
                                                            </span>
                                                            <button
                                                              type="button"
                                                              onClick={() =>
                                                                setOpenUserSelectorForActivity(
                                                                  null,
                                                                )
                                                              }
                                                              className="text-gray-400 hover:text-gray-600 text-sm"
                                                            >
                                                              ×
                                                            </button>
                                                          </div>
                                                          <div className="max-h-48 overflow-y-auto">
                                                            {projectTeamMembers
                                                              .filter(
                                                                (
                                                                  user,
                                                                ) =>
                                                                  !isUserAssigned(
                                                                    act.assigned_users,
                                                                    user.id,
                                                                  ),
                                                              )
                                                              .map(
                                                                (
                                                                  user,
                                                                ) => (
                                                                  <div
                                                                    key={
                                                                      user.id
                                                                    }
                                                                    onClick={() => {
                                                                      toggleUserForActivity(
                                                                        act.id,
                                                                        user.id,
                                                                      );
                                                                      setOpenUserSelectorForActivity(
                                                                        null,
                                                                      );
                                                                    }}
                                                                    className="px-3 py-2 cursor-pointer text-xs text-gray-700 hover:bg-blue-50 border-b border-gray-100 last:border-b-0 flex items-center gap-2"
                                                                  >
                                                                    <UserIcon className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                                                    {user.name ||
                                                                      user.full_name ||
                                                                      user.employee_name ||
                                                                      user.username ||
                                                                      user.email ||
                                                                      "Unknown"}
                                                                  </div>
                                                                ),
                                                              )}
                                                            {projectTeamMembers.filter(
                                                              (
                                                                user,
                                                              ) =>
                                                                !isUserAssigned(
                                                                  act.assigned_users,
                                                                  user.id,
                                                                ),
                                                            )
                                                              .length ===
                                                              0 && (
                                                                <div className="px-3 py-2 text-xs text-gray-400 text-center">
                                                                  All
                                                                  assigned
                                                                </div>
                                                              )}
                                                          </div>
                                                        </div>
                                                      );
                                                    })()}
                                                </div>
                                                {editingActivityId ===
                                                  act.id ? (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      handleDoneEditing(act)
                                                    }
                                                    className="p-1 rounded bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                                                    title="Done editing"
                                                  >
                                                    <CheckIcon className="h-3.5 w-3.5" />
                                                  </button>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setEditingActivityId(
                                                        act.id,
                                                      )
                                                    }
                                                    className="p-1 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                                                    title="Edit activity"
                                                  >
                                                    <PencilIcon className="h-3.5 w-3.5" />
                                                  </button>
                                                )}
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    removeScopeActivity(
                                                      act.id,
                                                    );
                                                    if (
                                                      editingActivityId ===
                                                      act.id
                                                    )
                                                      setEditingActivityId(
                                                        null,
                                                      );
                                                  }}
                                                  className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                                                  title="Delete activity"
                                                >
                                                  <TrashIcon className="h-3.5 w-3.5" />
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                          </Fragment>
                        );
                      },
                    );
                  })()}
                </tbody>
              </table>
            </div>

            {/* Summary Footer */}
            <div className="pt-3 mt-3 border-t border-gray-200 flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-medium border border-indigo-100">
                  {projectActivities.length} activities
                </span>
                <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-medium border border-emerald-100">
                  {(() => {
                    const s = new Set();
                    projectActivities.forEach((a) =>
                      (a.assigned_users || []).forEach((u) => {
                        const uid =
                          typeof u === "object" ? u.user_id : u;
                        if (uid) s.add(String(uid));
                      }),
                    );
                    return s.size;
                  })()}{" "}
                  members
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
