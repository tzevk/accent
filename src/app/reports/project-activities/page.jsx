'use client';

import { useState, useEffect, Fragment } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import {
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FolderIcon,
  UserIcon,
  ArrowPathIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

export default function ProjectActivitiesReport() {
  const { loading: authLoading, user, can, RESOURCES, PERMISSIONS } = useSessionRBAC();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedProjects, setExpandedProjects] = useState({});
  const [expandedMembers, setExpandedMembers] = useState({});
  const [editingEntry, setEditingEntry] = useState(null); // Format: 'projectId-activityId-userId-entryIndex'
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  
  // Check if user has access - allow Rajesh Panchal, super admins, and users with reports permission
  const isRajeshPanchal = user?.full_name?.toLowerCase() === 'rajesh panchal';
  const isSuperAdmin = user?.is_super_admin === true || user?.is_super_admin === 1;
  const hasReportsPermission = can && can(RESOURCES.REPORTS, PERMISSIONS.READ);
  const hasAccess = isRajeshPanchal || isSuperAdmin || hasReportsPermission;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reports/project-activities');
      const data = await res.json();
      if (data.success) {
        setProjects(data.data || []);
        // Auto-expand all projects
        const expanded = {};
        (data.data || []).forEach(p => { expanded[p.project_id] = true; });
        setExpandedProjects(expanded);
        // Auto-expand all members that have daily entries
        const memberExp = {};
        (data.data || []).forEach(p => {
          (p.activities || []).forEach(a => {
            (a.members || []).forEach(m => {
              if ((m.daily_entries || []).length > 0) {
                memberExp[`${p.project_id}-${a.id}-${m.user_id}`] = true;
              }
            });
          });
        });
        setExpandedMembers(memberExp);
      }
    } catch (err) {
      console.error('Failed to load project activities report:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleProject = (id) => setExpandedProjects(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleMember = (key) => setExpandedMembers(prev => ({ ...prev, [key]: !prev[key] }));

  const startEditingEntry = (projectId, activityId, userId, entryIndex, entry) => {
    const key = `${projectId}-${activityId}-${userId}-${entryIndex}`;
    setEditingEntry(key);
    setEditForm({
      date: entry.date || '',
      qty_done: entry.qty_done || '',
      hours: entry.hours || '',
      remarks: entry.remarks || ''
    });
  };

  const cancelEditingEntry = () => {
    setEditingEntry(null);
    setEditForm({});
  };

  const saveEditedEntry = async (projectId, activityId, userId, member) => {
    if (!editingEntry) return;
    
    setSaving(true);
    try {
      const entryIndex = parseInt(editingEntry.split('-')[3]);
      const dailyEntries = [...(member.daily_entries || [])];
      
      // Update the specific entry
      dailyEntries[entryIndex] = {
        ...dailyEntries[entryIndex],
        date: editForm.date,
        qty_done: parseFloat(editForm.qty_done) || 0,
        hours: parseFloat(editForm.hours) || 0,
        remarks: editForm.remarks || ''
      };
      
      // Recalculate totals
      const totalQtyDone = dailyEntries.reduce((sum, e) => sum + (parseFloat(e.qty_done) || 0), 0);
      const totalHours = dailyEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
      
      // Save to backend
      const res = await fetch(`/api/users/${userId}/activity-assignments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          activity_id: activityId,
          daily_entries: dailyEntries,
          qty_completed: totalQtyDone,
          actual_hours: totalHours
        })
      });
      
      const data = await res.json();
      if (data.success) {
        // Reload data to reflect changes
        await loadData();
        setEditingEntry(null);
        setEditForm({});
      } else {
        alert('Failed to save changes: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to save entry:', err);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const formatShortDate = (d) => {
    if (!d) return '–';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };

  const getStatusBadge = (status) => {
    const map = {
      'Completed': 'bg-green-100 text-green-700 border-green-200',
      'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
      'Not Started': 'bg-gray-100 text-gray-600 border-gray-200',
      'On Hold': 'bg-yellow-100 text-yellow-700 border-yellow-200'
    };
    return map[status] || map['Not Started'];
  };

  const filteredProjects = projects.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (p.project_name || '').toLowerCase().includes(s) ||
      (p.project_code || '').toLowerCase().includes(s) ||
      String(p.project_id || '').toLowerCase().includes(s) ||
      p.activities?.some(a =>
        (a.activity_name || '').toLowerCase().includes(s) ||
        a.members?.some(m => (m.user_name || '').toLowerCase().includes(s))
      )
    );
  });

  // Compute project-level totals
  const getProjectTotals = (project) => {
    let totalActivities = 0, totalMembers = 0, totalQtyAssigned = 0, totalQtyDone = 0, totalPlannedHrs = 0, totalActualHrs = 0;
    for (const act of (project.activities || [])) {
      totalActivities++;
      for (const m of (act.members || [])) {
        totalMembers++;
        totalQtyAssigned += parseFloat(m.qty_assigned) || 0;
        totalQtyDone += parseFloat(m.qty_completed) || 0;
        totalPlannedHrs += parseFloat(m.planned_hours) || 0;
        totalActualHrs += parseFloat(m.actual_hours) || 0;
      }
    }
    return { totalActivities, totalMembers, totalQtyAssigned, totalQtyDone, totalPlannedHrs, totalActualHrs };
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="flex items-center justify-center h-[70vh]">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  // Access denied if user doesn't have permission
  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="flex items-center justify-center h-[70vh]">
          <div className="text-center">
            <div className="text-red-500 text-6xl mb-4">🔒</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
            <p className="text-gray-600">You do not have permission to view project activities.</p>
            <p className="text-sm text-gray-500 mt-2">Contact your administrator if you need access.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />

      <div className="pt-4 px-3 sm:px-4 lg:px-6 pb-4 w-full max-w-[1920px] mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/60 shadow-sm">
          <div className="px-5 py-5">
            {/* Header */}
            <div className="mb-6">
              <nav className="text-xs text-gray-500 mb-1">
                <ol className="inline-flex items-center gap-2">
                  <li>Home</li>
                  <li className="text-gray-300">/</li>
                  <li>Reports</li>
                  <li className="text-gray-300">/</li>
                  <li className="text-gray-700">Project Activities</li>
                </ol>
              </nav>
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Project Activities Report</h1>
                <button onClick={loadData} disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
                  <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="mb-4">
              <div className="relative max-w-md">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" placeholder="Search projects, activities, members..."
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-300 focus:border-purple-400" />
              </div>
            </div>

            {/* Projects List */}
            {loading ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">Loading project data...</div>
            ) : filteredProjects.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
                <FolderIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No projects with activities found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredProjects.map((project) => {
                  const isExpanded = expandedProjects[project.project_id];
                  const totals = getProjectTotals(project);

                  return (
                    <div key={project.project_id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                      {/* Project Header */}
                      <button onClick={() => toggleProject(project.project_id)}
                        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                            <FolderIcon className="w-5 h-5 text-purple-600" />
                          </div>
                          <div className="text-left">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-purple-700 font-semibold">{project.project_code || project.project_id}</span>
                              <span className="font-semibold text-gray-900 text-sm">{project.project_name}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusBadge(project.project_status)}`}>{project.project_status || 'Active'}</span>
                            </div>
                            <div className="flex items-center gap-4 text-[11px] text-gray-500 mt-0.5">
                              <span>{totals.totalActivities} activities</span>
                              <span>{totals.totalMembers} assignments</span>
                              <span className="text-purple-600 font-medium">{totals.totalQtyDone}/{totals.totalQtyAssigned} qty</span>
                              <span className="text-blue-600 font-medium">{totals.totalActualHrs}/{totals.totalPlannedHrs} hrs</span>
                            </div>
                          </div>
                        </div>
                        {isExpanded ? <ChevronUpIcon className="w-5 h-5 text-gray-400" /> : <ChevronDownIcon className="w-5 h-5 text-gray-400" />}
                      </button>

                      {/* Activities Table */}
                      {isExpanded && (
                        <div className="border-t border-gray-200">
                          {(project.activities || []).length === 0 ? (
                            <div className="px-5 py-6 text-center text-gray-400 text-sm">No activities defined</div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                  <th className="text-left py-2.5 px-4 font-semibold text-gray-500 uppercase tracking-wider">Activity</th>
                                  <th className="text-left py-2.5 px-3 font-semibold text-gray-500 uppercase tracking-wider">Team Member</th>
                                  <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Qty Asgn</th>
                                  <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Qty Done</th>
                                  <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Balance</th>
                                  <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Plan Hrs</th>
                                  <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Manhours</th>
                                  <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Due Date</th>
                                  <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                                  <th className="text-center py-2.5 px-2 font-semibold text-gray-500 uppercase tracking-wider w-8"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {(project.activities || []).map((activity) => {
                                  const members = activity.members || [];
                                  if (members.length === 0) {
                                    return (
                                      <tr key={activity.id} className="hover:bg-gray-50/50">
                                        <td className="py-2.5 px-4 align-middle">
                                          <div className="font-medium text-gray-900 text-[11px]">{activity.activity_name}</div>
                                          {activity.activity_description && <div className="text-[10px] text-gray-400">{activity.activity_description}</div>}
                                        </td>
                                        <td colSpan={9} className="py-2.5 px-3 text-gray-400 text-[11px] italic">No members assigned</td>
                                      </tr>
                                    );
                                  }

                                  return members.map((member, mIdx) => {
                                    const memberKey = `${project.project_id}-${activity.id}-${member.user_id}`;
                                    const isMemberExpanded = expandedMembers[memberKey];
                                    const dailyEntries = member.daily_entries || [];
                                    const qtyAssigned = parseFloat(member.qty_assigned) || 0;
                                    const qtyDone = parseFloat(member.qty_completed) || 0;
                                    const balance = qtyAssigned - qtyDone;
                                    const isDuePast = member.due_date && new Date(member.due_date) < new Date() && member.status !== 'Completed';

                                    return (
                                      <Fragment key={memberKey}>
                                        <tr className={`hover:bg-gray-50/50 ${isDuePast ? 'bg-red-50/30' : ''}`}>
                                          {/* Activity (only on first member row) */}
                                          {mIdx === 0 ? (
                                            <td className="py-2.5 px-4 align-middle" rowSpan={members.length}>
                                              <div className="font-medium text-gray-900 text-[11px]">{activity.activity_name}</div>
                                              {activity.activity_description && <div className="text-[10px] text-gray-400 max-w-[180px] truncate" title={activity.activity_description}>{activity.activity_description}</div>}
                                              {activity.discipline && <span className="inline-block mt-0.5 px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px]">{activity.discipline}</span>}
                                            </td>
                                          ) : null}

                                          {/* Team Member */}
                                          <td className="py-2.5 px-3 align-middle">
                                            <div className="flex items-center gap-1.5">
                                              <UserIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                              <span className="text-[11px] text-gray-800 font-medium">{member.user_name}</span>
                                            </div>
                                          </td>

                                          <td className="py-2.5 px-2 text-center align-middle text-gray-600">{qtyAssigned}</td>
                                          <td className="py-2.5 px-2 text-center align-middle font-medium text-purple-600">{qtyDone}</td>
                                          <td className="py-2.5 px-2 text-center align-middle">
                                            <span className={`font-medium ${balance > 0 ? 'text-amber-600' : balance === 0 ? 'text-green-600' : 'text-red-500'}`}>{balance}</span>
                                          </td>
                                          <td className="py-2.5 px-2 text-center align-middle text-gray-600">{member.planned_hours || 0}</td>
                                          <td className="py-2.5 px-2 text-center align-middle font-medium text-blue-600">{member.actual_hours || 0}</td>
                                          <td className="py-2.5 px-2 text-center align-middle">
                                            <span className={`text-[10px] ${isDuePast ? 'text-red-500 font-semibold' : 'text-gray-600'}`}>{formatShortDate(member.due_date)}</span>
                                          </td>
                                          <td className="py-2.5 px-2 text-center align-middle">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusBadge(member.status)}`}>{member.status}</span>
                                          </td>
                                          <td className="py-2.5 px-2 text-center align-middle">
                                            {dailyEntries.length > 0 && (
                                              <button onClick={() => toggleMember(memberKey)}
                                                className="p-1 text-gray-400 hover:bg-gray-100 rounded transition-colors" title="Daily entries">
                                                {isMemberExpanded ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
                                              </button>
                                            )}
                                          </td>
                                        </tr>

                                        {/* Daily Entries */}
                                        {isMemberExpanded && dailyEntries.length > 0 && (
                                          <tr>
                                            <td colSpan={10} className="px-4 py-2 bg-slate-50/80">
                                              <div className="ml-6 border-l-2 border-purple-200 pl-3">
                                                <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Daily Entries</div>
                                                <table className="w-full text-[10px]">
                                                  <thead>
                                                    <tr className="text-purple-400 uppercase">
                                                      <th className="text-center py-1 pr-2 font-semibold">Date</th>
                                                      <th className="text-center py-1 px-2 font-semibold">Qty Done</th>
                                                      <th className="text-center py-1 px-2 font-semibold">Manhours</th>
                                                      <th className="text-center py-1 px-2 font-semibold">Remarks</th>
                                                      {isRajeshPanchal && <th className="text-center py-1 px-2 font-semibold">Actions</th>}
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {dailyEntries.map((entry, eIdx) => {
                                                      const entryKey = `${project.project_id}-${activity.id}-${member.user_id}-${eIdx}`;
                                                      const isEditing = editingEntry === entryKey;
                                                      
                                                      return (
                                                        <tr key={eIdx} className="text-gray-600">
                                                          <td className="py-1 pr-2 text-center">
                                                            {isEditing ? (
                                                              <input 
                                                                type="date" 
                                                                value={editForm.date || ''} 
                                                                onChange={(e) => setEditForm({...editForm, date: e.target.value})}
                                                                className="w-full px-1 py-0.5 text-[10px] border border-purple-300 rounded focus:border-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              formatShortDate(entry.date)
                                                            )}
                                                          </td>
                                                          <td className="py-1 px-2 text-center">
                                                            {isEditing ? (
                                                              <input 
                                                                type="number" 
                                                                value={editForm.qty_done || ''} 
                                                                onChange={(e) => setEditForm({...editForm, qty_done: e.target.value})}
                                                                min="0"
                                                                step="0.01"
                                                                className="w-16 px-1 py-0.5 text-[10px] border border-purple-300 rounded text-center focus:border-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              entry.qty_done || 0
                                                            )}
                                                          </td>
                                                          <td className="py-1 px-2 text-center">
                                                            {isEditing ? (
                                                              <input 
                                                                type="number" 
                                                                value={editForm.hours || ''} 
                                                                onChange={(e) => setEditForm({...editForm, hours: e.target.value})}
                                                                min="0"
                                                                step="0.5"
                                                                className="w-16 px-1 py-0.5 text-[10px] border border-purple-300 rounded text-center focus:border-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              entry.hours || 0
                                                            )}
                                                          </td>
                                                          <td className="py-1 px-2 text-center text-gray-500">
                                                            {isEditing ? (
                                                              <input 
                                                                type="text" 
                                                                value={editForm.remarks || ''} 
                                                                onChange={(e) => setEditForm({...editForm, remarks: e.target.value})}
                                                                placeholder="Remarks..."
                                                                className="w-full px-1 py-0.5 text-[10px] border border-purple-300 rounded focus:border-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              entry.remarks || '–'
                                                            )}
                                                          </td>
                                                          {isRajeshPanchal && (
                                                            <td className="py-1 px-2 text-center">
                                                              {isEditing ? (
                                                                <div className="flex items-center justify-center gap-1">
                                                                  <button 
                                                                    onClick={() => saveEditedEntry(project.project_id, activity.id, member.user_id, member)}
                                                                    disabled={saving}
                                                                    className="p-0.5 text-green-600 hover:bg-green-100 rounded transition-colors disabled:opacity-50"
                                                                    title="Save"
                                                                  >
                                                                    <CheckIcon className="w-3.5 h-3.5" />
                                                                  </button>
                                                                  <button 
                                                                    onClick={cancelEditingEntry}
                                                                    disabled={saving}
                                                                    className="p-0.5 text-red-600 hover:bg-red-100 rounded transition-colors disabled:opacity-50"
                                                                    title="Cancel"
                                                                  >
                                                                    <XMarkIcon className="w-3.5 h-3.5" />
                                                                  </button>
                                                                </div>
                                                              ) : (
                                                                <button 
                                                                  onClick={() => startEditingEntry(project.project_id, activity.id, member.user_id, eIdx, entry)}
                                                                  className="p-0.5 text-purple-600 hover:bg-purple-100 rounded transition-colors"
                                                                  title="Edit"
                                                                >
                                                                  <PencilSquareIcon className="w-3.5 h-3.5" />
                                                                </button>
                                                              )}
                                                            </td>
                                                          )}
                                                        </tr>
                                                      );
                                                    })}
                                                    {/* Totals row */}
                                                    <tr className="border-t border-gray-200 font-semibold text-gray-700">
                                                      <td className="py-1 pr-2 text-[10px]">Total</td>
                                                      <td className="py-1 px-2 text-center">{dailyEntries.reduce((s, e) => s + (parseFloat(e.qty_done) || 0), 0)}</td>
                                                      <td className="py-1 px-2 text-center">{dailyEntries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)}</td>
                                                      <td className="py-1 px-2"></td>
                                                      {isRajeshPanchal && <td className="py-1 px-2"></td>}
                                                    </tr>
                                                  </tbody>
                                                </table>
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                  });
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
