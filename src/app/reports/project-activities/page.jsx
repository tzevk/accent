"use client";

import { useState, useEffect, Fragment, useMemo } from "react";
import { useSessionRBAC } from "@/utils/client-rbac";
import Navbar from "@/components/Navbar";
import {
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  ArrowPathIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
  TrashIcon,
  UserIcon,
  ClockIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  BriefcaseIcon,
} from "@heroicons/react/24/outline";

/* ── helpers ────────────────────────────────────────────────────────── */
const statusCls = (s) => {
  const n = (s || "").toLowerCase();
  if (n.includes("completed") || n.includes("done"))
    return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (n.includes("progress") || n.includes("active"))
    return "bg-blue-50 text-blue-700 ring-blue-600/20";
  if (n.includes("hold") || n.includes("pending"))
    return "bg-amber-50 text-amber-700 ring-amber-600/20";
  if (n.includes("cancel"))
    return "bg-red-50 text-red-700 ring-red-600/20";
  return "bg-gray-50 text-gray-600 ring-gray-500/20";
};

function ProgressBar({ pct, color = "purple", className = "" }) {
  const c = Math.min(100, Math.max(0, pct));
  const bg =
    color === "blue"
      ? "bg-blue-500"
      : color === "green"
      ? "bg-emerald-500"
      : "bg-purple-500";
  return (
    <div className={`w-full bg-gray-100 rounded-full h-1.5 overflow-hidden ${className}`}>
      <div
        className={`${bg} h-full rounded-full transition-all duration-500`}
        style={{ width: `${c}%` }}
      />
    </div>
  );
}

const fmt = (d) => {
  if (!d) return "\u2013";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
};
const fmtShort = (d) => {
  if (!d) return "\u2013";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
};

/* ── main ───────────────────────────────────────────────────────────── */
export default function ProjectActivitiesReport() {
  const { loading: authLoading, user, can, RESOURCES, PERMISSIONS } =
    useSessionRBAC();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedProjects, setExpandedProjects] = useState({});
  const [expandedActivities, setExpandedActivities] = useState({});
  const [expandedMembers, setExpandedMembers] = useState({});
  const [editingEntry, setEditingEntry] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const isSuperAdmin =
    user?.is_super_admin === true || user?.is_super_admin === 1;

  const hasProjectActivitiesFieldPermission = useMemo(() => {
    if (!user) return false;
    if (isSuperAdmin) return true;

    let fieldPerms = user.field_permissions;
    if (typeof fieldPerms === 'string') {
      try { fieldPerms = JSON.parse(fieldPerms); } catch { fieldPerms = null; }
    }

    const reportAccessSection = fieldPerms?.modules?.reports?.sections?.report_access;
    if (!reportAccessSection?.enabled) return false;

    const projectActivitiesPerm = reportAccessSection.fields?.project_activities?.permission;
    if (projectActivitiesPerm === 'view' || projectActivitiesPerm === 'edit') return true;

    // Backward compatibility for existing saved permissions.
    const legacyPerm = reportAccessSection.fields?.project_reports?.permission;
    return legacyPerm === 'view' || legacyPerm === 'edit';
  }, [user, isSuperAdmin]);

  const hasReportsPermission =
    can && can(RESOURCES.REPORTS, PERMISSIONS.READ);
  const hasAccess = isSuperAdmin || hasReportsPermission || hasProjectActivitiesFieldPermission;
  // Allow editing of daily entries for super admins or users with report update permission
  const canEditEntries = isSuperAdmin || (can && can(RESOURCES.REPORTS, PERMISSIONS.UPDATE));

  // Allow re-activating completed projects
  const canUpdateProjects = isSuperAdmin || (can && can(RESOURCES.PROJECTS, PERMISSIONS.UPDATE));
  const [activatingProjectId, setActivatingProjectId] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  /* ── data ─────────────────────────────────────────────────────────── */
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/project-activities", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setProjects(data.data || []);
      } else {
        setError(data.error || "Unknown error");
      }
    } catch (err) {
      console.error("Failed to load project activities:", err);
      setError("Failed to connect to server.");
    } finally {
      setLoading(false);
    }
  };

  const reactivateProject = async (project) => {
    if (!project?.project_id) return;
    if (!confirm('Activate this project again?')) return;

    setActivatingProjectId(project.project_id);
    try {
      const res = await fetch(`/api/projects/${project.project_id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Active' })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        alert('Failed to activate project: ' + (data?.error || data?.details || `HTTP ${res.status}`));
        return;
      }

      await loadData();
    } catch (e) {
      alert('Failed to activate project: ' + (e?.message || 'Unknown error'));
    } finally {
      setActivatingProjectId(null);
    }
  };

  /* ── toggles ──────────────────────────────────────────────────────── */
  const toggleProject = (id) =>
    setExpandedProjects((p) => ({ ...p, [id]: !p[id] }));
  const toggleActivity = (key) =>
    setExpandedActivities((p) => ({ ...p, [key]: !p[key] }));
  const toggleMember = (key) =>
    setExpandedMembers((p) => ({ ...p, [key]: !p[key] }));

  const expandAll = () => {
    const ep = {},
      ea = {};
    projects.forEach((p) => {
      ep[p.project_id] = true;
      (p.activities || []).forEach((a) => {
        ea[`${p.project_id}-${a.id}`] = true;
      });
    });
    setExpandedProjects(ep);
    setExpandedActivities(ea);
  };
  const collapseAll = () => {
    setExpandedProjects({});
    setExpandedActivities({});
    setExpandedMembers({});
  };

  /* ── inline editing ───────────────────────────────────────────────── */
  const startEditing = (pId, aId, uId, idx, entry) => {
    setEditingEntry(`${pId}-${aId}-${uId}-${idx}`);
    setEditForm({
      date: entry.date || "",
      qty_done: entry.qty_done || "",
      hours: entry.hours || "",
      remarks: entry.remarks || "",
    });
  };
  const cancelEditing = () => {
    setEditingEntry(null);
    setEditForm({});
  };

  const deleteEntry = async (pId, aId, uId, member, idx) => {
    if (!confirm("Are you sure you want to delete this entry?")) return;
    setSaving(true);
    try {
      const entries = [...(member.daily_entries || [])];
      entries.splice(idx, 1);
      const totQ = entries.reduce(
        (s, e) => s + ((e && parseFloat(e.qty_done)) || 0),
        0
      );
      const totH = entries.reduce(
        (s, e) => s + ((e && parseFloat(e.hours)) || 0),
        0
      );
      
      console.log('Deleting entry at index:', idx, 'Remaining entries:', entries.length);
      
      const res = await fetch(`/api/users/${uId}/activity-assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: pId,
          activity_id: aId,
          daily_entries: entries,
          qty_completed: totQ,
          actual_hours: totH,
        }),
      });
      const data = await res.json();
      if (data.success) {
        console.log('Delete successful, reloading data...');
        await loadData();
        cancelEditing();
      } else {
        console.error('Delete failed:', data.error);
        alert("Delete failed: " + (data.error || "Unknown"));
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert("Failed to delete entry");
    } finally {
      setSaving(false);
    }
  };

  const saveEdited = async (pId, aId, uId, member) => {
    if (!editingEntry) return;
    setSaving(true);
    try {
      // editingEntry is `${pId}-${aId}-${uId}-${idx}` but activity_id can be a UUID (contains '-')
      // so we must extract the last segment as the index.
      const lastDash = editingEntry.lastIndexOf("-");
      const idx = Number(editingEntry.slice(lastDash + 1));
      if (!Number.isFinite(idx) || idx < 0) {
        throw new Error("Invalid edit index");
      }
      const entries = [...(member.daily_entries || [])];
      
      // Ensure the entry is a proper object with required fields
      const oldEntry = entries[idx];
      entries[idx] = {
        date: editForm.date || "",
        qty_done: parseFloat(editForm.qty_done) || 0,
        hours: parseFloat(editForm.hours) || 0,
        remarks: editForm.remarks || "",
      };
      
      const totQ = entries.reduce(
        (s, e) => s + ((e && parseFloat(e.qty_done)) || 0),
        0
      );
      const totH = entries.reduce(
        (s, e) => s + ((e && parseFloat(e.hours)) || 0),
        0
      );
      
      console.log('[saveEdited] project_id:', pId, 'activity_id:', aId, 'user_id:', uId);
      console.log('[saveEdited] Old entry:', { date: oldEntry?.date, qty_done: oldEntry?.qty_done, hours: oldEntry?.hours });
      console.log('[saveEdited] New entry:', { date: entries[idx].date, qty_done: entries[idx].qty_done, hours: entries[idx].hours });
      console.log('[saveEdited] All entries count:', entries.length);
      console.log('[saveEdited] Totals - qty:', totQ, 'hours:', totH);
      
      const payload = {
        project_id: pId,
        activity_id: aId,
        daily_entries: entries,
        qty_completed: totQ,
        actual_hours: totH,
      };
      console.log('[saveEdited] Full payload:', JSON.stringify(payload));
      
      const res = await fetch(`/api/users/${uId}/activity-assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      const data = await res.json();
      console.log('[saveEdited] Response status:', res.status, 'success:', data.success, 'error:', data.error);
      
      if (!res.ok) {
        console.error('[saveEdited] Non-2xx response:', res.status, data);
        alert("Save failed: " + (data?.error || data?.details || `HTTP ${res.status}`));
      } else if (data.success) {
        console.log('[saveEdited] Save successful, reloading data...');
        // Add a small delay to ensure DB write completes
        await new Promise(r => setTimeout(r, 300));
        await loadData();
        console.log('[saveEdited] Data reloaded');
        cancelEditing();
      } else {
        console.error('[saveEdited] Save failed:', data.error);
        alert("Save failed: " + (data.error || "Unknown"));
      }
    } catch (err) {
      console.error('[saveEdited] Exception:', err);
      alert("Failed to save: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── totals ───────────────────────────────────────────────────────── */
  const pTotals = (project) => {
    let acts = 0,
      mems = 0,
      qA = 0,
      qD = 0,
      pH = 0,
      aH = 0;
    for (const a of project.activities || []) {
      acts++;
      for (const m of a.members || []) {
        mems++;
        qA += parseFloat(m.qty_assigned) || 0;
        qD += parseFloat(m.qty_completed) || 0;
        pH += parseFloat(m.planned_hours) || 0;
        aH += parseFloat(m.actual_hours) || 0;
      }
    }
    const qP = qA > 0 ? Math.round((qD / qA) * 100) : 0;
    const hP = pH > 0 ? Math.round((aH / pH) * 100) : 0;
    const oP = qA > 0 || pH > 0 ? Math.round((qP + hP) / 2) : 0;
    return { acts, mems, qA, qD, pH, aH, qP, hP, oP };
  };

  const aTotals = (act) => {
    let qA = 0,
      qD = 0,
      pH = 0,
      aH = 0;
    for (const m of act.members || []) {
      qA += parseFloat(m.qty_assigned) || 0;
      qD += parseFloat(m.qty_completed) || 0;
      pH += parseFloat(m.planned_hours) || 0;
      aH += parseFloat(m.actual_hours) || 0;
    }
    return {
      qA,
      qD,
      pH,
      aH,
      qP: qA > 0 ? Math.round((qD / qA) * 100) : 0,
      hP: pH > 0 ? Math.round((aH / pH) * 100) : 0,
    };
  };

  /* ── filtering ────────────────────────────────────────────────────── */
  const filtered = useMemo(
    () =>
      projects.filter((p) => {
        if (statusFilter !== "all") {
          const s = (p.project_status || "active").toLowerCase();
          if (
            statusFilter === "active" &&
            !s.includes("active") &&
            !s.includes("progress")
          )
            return false;
          if (
            statusFilter === "completed" &&
            !s.includes("completed") &&
            !s.includes("done")
          )
            return false;
          if (statusFilter === "hold" && !s.includes("hold")) return false;
        }
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          (p.project_name || "").toLowerCase().includes(q) ||
          (p.project_code || "").toLowerCase().includes(q) ||
          (p.client_name || "").toLowerCase().includes(q) ||
          String(p.project_id || "").includes(q) ||
          p.activities?.some(
            (a) =>
              (a.activity_name || "").toLowerCase().includes(q) ||
              a.members?.some((m) =>
                (m.user_name || "").toLowerCase().includes(q)
              )
          )
        );
      }),
    [projects, search, statusFilter]
  );

  const grand = useMemo(() => {
    let a = 0,
      m = 0;
    filtered.forEach((p) => {
      a += (p.activities || []).length;
      (p.activities || []).forEach((act) => {
        m += (act.members || []).length;
      });
    });
    return { projects: filtered.length, activities: a, members: m };
  }, [filtered]);

  /* ── auth guards ──────────────────────────────────────────────────── */
  if (authLoading)
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center h-[70vh]">
          <div className="animate-pulse text-gray-400 text-sm">
            Loading...
          </div>
        </div>
      </div>
    );

  if (!hasAccess)
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center h-[70vh]">
          <div className="text-center">
            <div className="bg-red-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
              <XMarkIcon className="w-7 h-7 text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-1">
              Access Denied
            </h2>
            <p className="text-gray-500 text-sm">
              You don&apos;t have permission to view this report.
            </p>
          </div>
        </div>
      </div>
    );

  /* ── render ────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="pt-4 px-3 sm:px-4 lg:px-6 pb-8 max-w-[1920px] mx-auto">
        {/* header */}
        <div className="mb-5">
          <p className="text-xs text-gray-400 mb-0.5">
            Home{" "}
            <span className="mx-1 text-gray-300">/</span> Reports{" "}
            <span className="mx-1 text-gray-300">/</span>{" "}
            <span className="text-gray-600">Project Activities</span>
          </p>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Project Activities
            </h1>
            <div className="flex items-center gap-2">
              <button
                onClick={expandAll}
                className="text-[11px] px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-white transition"
              >
                Expand All
              </button>
              <button
                onClick={collapseAll}
                className="text-[11px] px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-white transition"
              >
                Collapse All
              </button>
              <button
                onClick={loadData}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white border border-gray-200 rounded-md hover:border-gray-300 transition disabled:opacity-40"
              >
                <ArrowPathIcon
                  className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                />{" "}
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* stats */}
        {!loading && !error && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              {
                icon: BriefcaseIcon,
                label: "Projects",
                value: grand.projects,
                color: "text-purple-500",
              },
              {
                icon: ChartBarIcon,
                label: "Activities",
                value: grand.activities,
                color: "text-blue-500",
              },
              {
                icon: UserIcon,
                label: "Assignments",
                value: grand.members,
                color: "text-emerald-500",
              },
              {
                icon: CalendarDaysIcon,
                label: "Total in DB",
                value: projects.length,
                color: "text-amber-500",
              },
            ].map((c) => (
              <div
                key={c.label}
                className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm"
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <c.icon className={`w-3.5 h-3.5 ${c.color}`} />
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
                    {c.label}
                  </span>
                </div>
                <span className="text-2xl font-bold text-gray-900">
                  {c.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* search + filters */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search projects, activities, members&#8230;"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400 placeholder:text-gray-400"
            />
          </div>
          <div className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5 shadow-sm">
            {[
              ["all", "All"],
              ["active", "Active"],
              ["completed", "Completed"],
              ["hold", "On Hold"],
            ].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setStatusFilter(v)}
                className={`text-[11px] px-3 py-1.5 rounded-md font-medium transition ${
                  statusFilter === v
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          {!loading && (
            <span className="text-[11px] text-gray-400">
              {filtered.length} of {projects.length}
              {search ? " (filtered)" : ""}
            </span>
          )}
        </div>

        {/* body */}
        {error ? (
          <div className="bg-red-50 rounded-xl border border-red-100 p-8 text-center">
            <p className="text-red-700 font-semibold mb-1">
              Error Loading Data
            </p>
            <p className="text-red-500 text-sm mb-4">{error}</p>
            <button
              onClick={loadData}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="bg-white rounded-xl border border-gray-100 p-14 text-center text-gray-400 text-sm">
            <ArrowPathIcon className="w-5 h-5 mx-auto mb-2 animate-spin" />
            Loading&#8230;
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-14 text-center">
            <FolderIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="text-gray-500 font-medium text-sm">
              {search ? "No matching projects." : "No projects yet."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((project) => {
              const t = pTotals(project);
              return (
                <ProjectCard
                  key={project.project_id}
                  project={project}
                  isExpanded={!!expandedProjects[project.project_id]}
                  expandedActivities={expandedActivities}
                  expandedMembers={expandedMembers}
                  onToggleProject={toggleProject}
                  onToggleActivity={toggleActivity}
                  onToggleMember={toggleMember}
                  t={t}
                  aTotals={aTotals}
                  canEditEntries={canEditEntries}
                  canUpdateProjects={canUpdateProjects}
                  activatingProjectId={activatingProjectId}
                  reactivateProject={reactivateProject}
                  editingEntry={editingEntry}
                  editForm={editForm}
                  setEditForm={setEditForm}
                  saving={saving}
                  startEditing={startEditing}
                  cancelEditing={cancelEditing}
                  saveEdited={saveEdited}
                  deleteEntry={deleteEntry}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ProjectCard
   ═══════════════════════════════════════════════════════════════════════════ */
function ProjectCard({
  project,
  isExpanded,
  expandedActivities,
  expandedMembers,
  onToggleProject,
  onToggleActivity,
  onToggleMember,
  t,
  aTotals,
  canEditEntries,
  canUpdateProjects,
  activatingProjectId,
  reactivateProject,
  editingEntry,
  editForm,
  setEditForm,
  saving,
  startEditing,
  cancelEditing,
  saveEdited,
  deleteEntry,
}) {
  const statusText = (project.project_status || '').toString();
  const statusLower = statusText.toLowerCase();
  const isCompleted = statusLower.includes('completed') || statusLower.includes('done');
  const isActivating = activatingProjectId === project.project_id;

  return (
    <div
      className={`rounded-xl border transition-all duration-200 ${
        isExpanded
          ? "bg-white border-purple-200 shadow-lg ring-1 ring-purple-100"
          : "bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300"
      }`}
    >
      {/* header */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={() => onToggleProject(project.project_id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleProject(project.project_id);
          }
        }}
        className="w-full text-left px-5 py-4 flex items-start gap-3 group cursor-pointer"
      >
        <ChevronRightIcon
          className={`w-4 h-4 mt-1 flex-shrink-0 text-gray-400 group-hover:text-purple-500 transition-transform duration-200 ${
            isExpanded ? "rotate-90 text-purple-500" : ""
          }`}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {project.project_code && (
              <span className="font-mono text-[11px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                {project.project_code}
              </span>
            )}
            <h3 className="font-semibold text-gray-900 text-sm truncate">
              {project.project_name || `Project #${project.project_id}`}
            </h3>
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset ${statusCls(
                project.project_status
              )}`}
            >
              {project.project_status || "Active"}
            </span>

            {canUpdateProjects && isCompleted && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  reactivateProject(project);
                }}
                disabled={isActivating}
                className="text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset bg-blue-50 text-blue-700 ring-blue-600/20 hover:bg-blue-100 disabled:opacity-50"
                title="Activate this project again"
              >
                {isActivating ? 'Activating…' : 'Activate'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-4 mt-1.5 text-[11px] text-gray-400 flex-wrap">
            {project.client_name && (
              <span className="flex items-center gap-1">
                <BriefcaseIcon className="w-3 h-3" />
                {project.client_name}
              </span>
            )}
            {project.project_manager && (
              <span className="flex items-center gap-1">
                <UserIcon className="w-3 h-3" />
                {project.project_manager}
              </span>
            )}
            {(project.start_date || project.end_date) && (
              <span className="flex items-center gap-1">
                <CalendarDaysIcon className="w-3 h-3" />
                {fmt(project.start_date)} &ndash; {fmt(project.end_date)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5 flex-1 max-w-[200px]">
              <span className="text-[10px] text-gray-400 font-semibold tabular-nums w-7 text-right">
                {t.oP}%
              </span>
              <ProgressBar
                pct={t.oP}
                color={t.oP >= 80 ? "green" : "purple"}
              />
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="text-gray-400">{t.acts} act</span>
              <span className="text-gray-400">{t.mems} assign</span>
              <span className="text-purple-600 font-semibold tabular-nums">
                {t.qD}/{t.qA} qty
              </span>
              <span className="text-blue-600 font-semibold tabular-nums">
                {t.aH}/{t.pH} hrs
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* expanded */}
      {isExpanded && (
        <div className="border-t border-gray-100">
          {/* summary strip */}
          <div className="px-5 py-2 bg-gradient-to-r from-purple-50/80 via-blue-50/50 to-transparent flex items-center gap-5 text-[11px] text-gray-500 border-b border-gray-100">
            <span>
              Overall <b className="text-gray-800">{t.oP}%</b>
            </span>
            <span>
              Qty <b className="text-purple-700">{t.qP}%</b>
            </span>
            <span>
              Hours <b className="text-blue-700">{t.hP}%</b>
            </span>
            <span className="ml-auto text-[10px] text-gray-400">
              {t.acts} {t.acts === 1 ? "activity" : "activities"}
            </span>
          </div>

          {(project.activities || []).length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              No activities defined
            </div>
          ) : (
            <div>
              {(project.activities || []).map((activity) => {
                const aKey = `${project.project_id}-${activity.id}`;
                const isOpen = !!expandedActivities[aKey];
                const at = aTotals(activity);
                const members = activity.members || [];

                return (
                  <div
                    key={activity.id}
                    className={`border-b border-gray-50 last:border-b-0 ${
                      isOpen ? "bg-gray-50/30" : ""
                    }`}
                  >
                    {/* activity row */}
                    <button
                      onClick={() => onToggleActivity(aKey)}
                      className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-gray-50/80 transition group"
                    >
                      <ChevronRightIcon
                        className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${
                          isOpen ? "rotate-90 text-gray-600" : ""
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-800 text-[13px]">
                            {activity.activity_name}
                          </span>
                          {activity.discipline &&
                            activity.discipline !== "General" && (
                              <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-medium">
                                {activity.discipline}
                              </span>
                            )}
                          {activity.source === "table" && (
                            <span className="text-[8px] text-amber-600 bg-amber-50 px-1 py-0.5 rounded ring-1 ring-amber-200">
                              DB
                            </span>
                          )}
                        </div>
                        {activity.activity_description && (
                          <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-lg">
                            {activity.activity_description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] flex-shrink-0">
                        <div className="flex items-center gap-1">
                          <span className="text-purple-600 font-semibold tabular-nums">
                            {at.qP}%
                          </span>
                          <span className="text-gray-300">qty</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-blue-600 font-semibold tabular-nums">
                            {at.hP}%
                          </span>
                          <span className="text-gray-300">hrs</span>
                        </div>
                        <span className="text-gray-400 text-[10px]">
                          {members.length} mbr
                          {members.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </button>

                    {/* members */}
                    {isOpen && (
                      <div className="border-t border-gray-100">
                        {members.length === 0 ? (
                          <div className="px-12 py-5 text-sm text-gray-400 italic">
                            No team members assigned
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="bg-gray-50/80 border-b border-gray-200">
                                  <th className="text-left py-2.5 px-3 pl-14 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Team Member
                                  </th>
                                  <th className="text-right py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Assigned
                                  </th>
                                  <th className="text-right py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Done
                                  </th>
                                  <th className="text-right py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Balance
                                  </th>
                                  <th className="text-right py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Plan Hrs
                                  </th>
                                  <th className="text-right py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Actual
                                  </th>
                                  <th className="text-center py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Due
                                  </th>
                                  <th className="text-center py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                    Status
                                  </th>
                                  <th className="w-9"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {members.map((member, mi) => {
                                  const mKey = `${project.project_id}-${activity.id}-${member.user_id}`;
                                  const mOpen = !!expandedMembers[mKey];
                                  const daily = (
                                    member.daily_entries || []
                                  ).filter(Boolean);
                                  const qA =
                                    parseFloat(member.qty_assigned) || 0;
                                  const qD =
                                    parseFloat(member.qty_completed) || 0;
                                  const bal = qA - qD;
                                  const overdue =
                                    member.due_date &&
                                    new Date(member.due_date) < new Date() &&
                                    (member.status || "").toLowerCase() !==
                                      "completed";

                                  return (
                                    <Fragment key={mKey}>
                                      <tr
                                        className={`border-b border-gray-100 transition-colors ${
                                          overdue
                                            ? "bg-red-50/30"
                                            : mi % 2 === 0
                                            ? "bg-white"
                                            : "bg-gray-50/40"
                                        } hover:bg-purple-50/30`}
                                      >
                                        <td className="py-2.5 px-3 pl-14">
                                          <div className="flex items-center gap-2.5">
                                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center flex-shrink-0 shadow-sm">
                                              <span className="text-[10px] font-bold text-purple-700">
                                                {(member.user_name || "?")[0].toUpperCase()}
                                              </span>
                                            </div>
                                            <span className="text-[12px] text-gray-800 font-medium">
                                              {member.user_name}
                                            </span>
                                          </div>
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-[12px] text-gray-600 tabular-nums">
                                          {qA}
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-[12px] font-semibold text-purple-600 tabular-nums">
                                          {qD}
                                        </td>
                                        <td
                                          className={`py-2.5 px-3 text-right text-[12px] font-semibold tabular-nums ${
                                            bal > 0
                                              ? "text-amber-600"
                                              : bal === 0
                                              ? "text-emerald-600"
                                              : "text-red-600"
                                          }`}
                                        >
                                          {bal}
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-[12px] text-gray-600 tabular-nums">
                                          {member.planned_hours || 0}
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-[12px] font-semibold text-blue-600 tabular-nums">
                                          {member.actual_hours || 0}
                                        </td>
                                        <td
                                          className={`py-2.5 px-3 text-center text-[11px] tabular-nums ${
                                            overdue
                                              ? "text-red-600 font-bold"
                                              : "text-gray-500"
                                          }`}
                                        >
                                          {fmtShort(member.due_date)}
                                        </td>
                                        <td className="py-2.5 px-3 text-center">
                                          <span
                                            className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset ${statusCls(
                                              member.status
                                            )}`}
                                          >
                                            {member.status || "Not Started"}
                                          </span>
                                        </td>
                                        <td className="py-2.5 pr-3 text-center">
                                          {daily.length > 0 && (
                                            <button
                                              onClick={() =>
                                                onToggleMember(mKey)
                                              }
                                              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-purple-600 transition"
                                            >
                                              {mOpen ? (
                                                <ChevronDownIcon className="w-4 h-4" />
                                              ) : (
                                                <ChevronRightIcon className="w-4 h-4" />
                                              )}
                                            </button>
                                          )}
                                        </td>
                                      </tr>

                                      {/* daily entries */}
                                      {mOpen && daily.length > 0 && (
                                        <tr>
                                          <td colSpan={9} className="p-0">
                                            <div className="mx-14 my-2 rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                              <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center gap-1.5">
                                                <ClockIcon className="w-3 h-3 text-gray-400" />
                                                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                                  Daily Entries
                                                </span>
                                                <span className="text-[10px] text-gray-400">
                                                  ({daily.length})
                                                </span>
                                              </div>
                                              <table className="w-full text-[11px]">
                                                <thead>
                                                  <tr className="bg-gray-50/60 border-b border-gray-100">
                                                    <th className="text-left py-1.5 px-3 font-semibold text-gray-500">
                                                      Date
                                                    </th>
                                                    <th className="text-right py-1.5 px-3 font-semibold text-gray-500">
                                                      Assigned
                                                    </th>
                                                    <th className="text-right py-1.5 px-3 font-semibold text-gray-500">
                                                      Done
                                                    </th>
                                                    <th className="text-right py-1.5 px-3 font-semibold text-gray-500">
                                                      Balance
                                                    </th>
                                                    <th className="text-right py-1.5 px-3 font-semibold text-gray-500">
                                                      Plan Hrs
                                                    </th>
                                                    <th className="text-right py-1.5 px-3 font-semibold text-gray-500">
                                                      Actual
                                                    </th>
                                                    <th className="text-left py-1.5 px-3 font-semibold text-gray-500">
                                                      Remarks
                                                    </th>
                                                    {canEditEntries && (
                                                      <th className="text-center py-1.5 px-3 font-semibold text-gray-500 w-16">
                                                        Actions
                                                      </th>
                                                    )}
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {daily.map((entry, eIdx) => {
                                                    const eKey = `${project.project_id}-${activity.id}-${member.user_id}-${eIdx}`;
                                                    const editing =
                                                      editingEntry === eKey;
                                                    const cumDone = daily.slice(0, eIdx + 1).reduce((s, e) => s + (parseFloat(e.qty_done) || 0), 0);
                                                    const cumHrs = daily.slice(0, eIdx + 1).reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
                                                    const mQA = parseFloat(member.qty_assigned) || 0;
                                                    const mPH = parseFloat(member.planned_hours) || 0;
                                                    const runBal = mQA - cumDone;
                                                    return (
                                                      <tr
                                                        key={eIdx}
                                                        className="border-b border-gray-50 hover:bg-gray-50/60 transition"
                                                      >
                                                        <td className="py-1.5 px-3">
                                                          {editing ? (
                                                            <input
                                                              type="date"
                                                              value={
                                                                editForm.date ||
                                                                ""
                                                              }
                                                              onChange={(e) =>
                                                                setEditForm({
                                                                  ...editForm,
                                                                  date: e
                                                                    .target
                                                                    .value,
                                                                })
                                                              }
                                                              className="px-1 py-0.5 text-[11px] border border-gray-300 rounded focus:border-purple-500 focus:outline-none w-full"
                                                            />
                                                          ) : (
                                                            <span className="text-gray-700">
                                                              {fmtShort(
                                                                entry.date
                                                              )}
                                                            </span>
                                                          )}
                                                        </td>
                                                        <td className="py-1.5 px-3 text-right text-gray-500 tabular-nums">
                                                          {mQA}
                                                        </td>
                                                        <td className="py-1.5 px-3 text-right">
                                                          {editing ? (
                                                            <input
                                                              type="number"
                                                              value={
                                                                editForm.qty_done ||
                                                                ""
                                                              }
                                                              min="0"
                                                              step="0.01"
                                                              onChange={(e) =>
                                                                setEditForm({
                                                                  ...editForm,
                                                                  qty_done:
                                                                    e.target
                                                                      .value,
                                                                })
                                                              }
                                                              className="w-16 px-1 py-0.5 text-[11px] border border-gray-300 rounded text-right focus:border-purple-500 focus:outline-none"
                                                            />
                                                          ) : (
                                                            <span className="font-semibold text-purple-600 tabular-nums">
                                                              {entry.qty_done ||
                                                                0}
                                                            </span>
                                                          )}
                                                        </td>
                                                        <td className={`py-1.5 px-3 text-right font-semibold tabular-nums ${
                                                          runBal > 0 ? "text-amber-600" : runBal === 0 ? "text-emerald-600" : "text-red-600"
                                                        }`}>
                                                          {runBal}
                                                        </td>
                                                        <td className="py-1.5 px-3 text-right text-gray-500 tabular-nums">
                                                          {mPH}
                                                        </td>
                                                        <td className="py-1.5 px-3 text-right">
                                                          {editing ? (
                                                            <input
                                                              type="number"
                                                              value={
                                                                editForm.hours ||
                                                                ""
                                                              }
                                                              min="0"
                                                              step="0.5"
                                                              onChange={(e) =>
                                                                setEditForm({
                                                                  ...editForm,
                                                                  hours:
                                                                    e.target
                                                                      .value,
                                                                })
                                                              }
                                                              className="w-16 px-1 py-0.5 text-[11px] border border-gray-300 rounded text-right focus:border-purple-500 focus:outline-none"
                                                            />
                                                          ) : (
                                                            <span className="font-semibold text-blue-600 tabular-nums">
                                                              {entry.hours || 0}
                                                            </span>
                                                          )}
                                                        </td>
                                                        <td className="py-1.5 px-3">
                                                          {editing ? (
                                                            <input
                                                              type="text"
                                                              value={
                                                                editForm.remarks ||
                                                                ""
                                                              }
                                                              placeholder="Remarks..."
                                                              onChange={(e) =>
                                                                setEditForm({
                                                                  ...editForm,
                                                                  remarks:
                                                                    e.target
                                                                      .value,
                                                                })
                                                              }
                                                              className="w-full px-1 py-0.5 text-[11px] border border-gray-300 rounded focus:border-purple-500 focus:outline-none"
                                                            />
                                                          ) : (
                                                            <span className="text-gray-500">
                                                              {entry.remarks ||
                                                                "\u2013"}
                                                            </span>
                                                          )}
                                                        </td>
                                                        {canEditEntries && (
                                                          <td className="py-1.5 px-3 text-center">
                                                            {editing ? (
                                                              <div className="flex items-center justify-center gap-1">
                                                                <button
                                                                  onClick={() =>
                                                                    saveEdited(
                                                                      project.project_id,
                                                                      activity.id,
                                                                      member.user_id,
                                                                      member
                                                                    )
                                                                  }
                                                                  disabled={
                                                                    saving
                                                                  }
                                                                  className="text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
                                                                >
                                                                  <CheckIcon className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button
                                                                  onClick={
                                                                    cancelEditing
                                                                  }
                                                                  disabled={
                                                                    saving
                                                                  }
                                                                  className="text-red-500 hover:text-red-600 disabled:opacity-40"
                                                                >
                                                                  <XMarkIcon className="w-3.5 h-3.5" />
                                                                </button>
                                                              </div>
                                                            ) : (
                                                              <div className="flex items-center justify-center gap-1">
                                                                <button
                                                                  onClick={() =>
                                                                    startEditing(
                                                                      project.project_id,
                                                                      activity.id,
                                                                      member.user_id,
                                                                      eIdx,
                                                                      entry
                                                                    )
                                                                  }
                                                                  className="text-gray-400 hover:text-purple-600 transition"
                                                                >
                                                                  <PencilSquareIcon className="w-3.5 h-3.5" />
                                                                </button>
                                                                <button
                                                                  onClick={() =>
                                                                    deleteEntry(
                                                                      project.project_id,
                                                                      activity.id,
                                                                      member.user_id,
                                                                      member,
                                                                      eIdx
                                                                    )
                                                                  }
                                                                  disabled={saving}
                                                                  className="text-gray-400 hover:text-red-600 transition disabled:opacity-40"
                                                                >
                                                                  <TrashIcon className="w-3.5 h-3.5" />
                                                                </button>
                                                              </div>
                                                            )}
                                                          </td>
                                                        )}
                                                      </tr>
                                                    );
                                                  })}
                                                  {(() => {
                                                    const totQD = daily.reduce((s, e) => s + (parseFloat(e.qty_done) || 0), 0);
                                                    const totHrs = daily.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
                                                    const totBal = (parseFloat(member.qty_assigned) || 0) - totQD;
                                                    return (
                                                      <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                                                        <td className="py-1.5 px-3 text-gray-600">Total</td>
                                                        <td className="py-1.5 px-3 text-right text-gray-600 tabular-nums">{parseFloat(member.qty_assigned) || 0}</td>
                                                        <td className="py-1.5 px-3 text-right text-purple-600 tabular-nums">{totQD}</td>
                                                        <td className={`py-1.5 px-3 text-right tabular-nums ${totBal > 0 ? "text-amber-600" : totBal === 0 ? "text-emerald-600" : "text-red-600"}`}>{totBal}</td>
                                                        <td className="py-1.5 px-3 text-right text-gray-600 tabular-nums">{parseFloat(member.planned_hours) || 0}</td>
                                                        <td className="py-1.5 px-3 text-right text-blue-600 tabular-nums">{totHrs}</td>
                                                        <td className="py-1.5 px-3"></td>
                                                        {canEditEntries && <td></td>}
                                                      </tr>
                                                    );
                                                  })()}
                                                </tbody>
                                              </table>
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  );
                                })}

                                {/* activity totals row */}
                                <tr className="bg-gray-50 border-t border-gray-200">
                                  <td className="py-2 px-3 pl-14 text-[11px] font-semibold text-gray-600">
                                    Activity Total
                                  </td>
                                  <td className="py-2 px-3 text-right text-[11px] font-bold text-gray-700 tabular-nums">
                                    {at.qA}
                                  </td>
                                  <td className="py-2 px-3 text-right text-[11px] font-bold text-purple-700 tabular-nums">
                                    {at.qD}
                                  </td>
                                  <td
                                    className="py-2 px-3 text-right text-[11px] font-bold tabular-nums"
                                    style={{
                                      color:
                                        at.qA - at.qD > 0
                                          ? "#d97706"
                                          : "#059669",
                                    }}
                                  >
                                    {at.qA - at.qD}
                                  </td>
                                  <td className="py-2 px-3 text-right text-[11px] font-bold text-gray-700 tabular-nums">
                                    {at.pH}
                                  </td>
                                  <td className="py-2 px-3 text-right text-[11px] font-bold text-blue-700 tabular-nums">
                                    {at.aH}
                                  </td>
                                  <td colSpan={3}></td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
