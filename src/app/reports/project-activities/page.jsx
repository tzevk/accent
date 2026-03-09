'use client';

import { useState, useEffect, Fragment } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import {
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FolderIcon,
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
  const [error, setError] = useState(null);
  
  // Check if user has access - allow super admins and users with reports permission
  const isSuperAdmin = user?.is_super_admin === true || user?.is_super_admin === 1;
  const hasReportsPermission = can && can(RESOURCES.REPORTS, PERMISSIONS.READ);
  const hasAccess = isSuperAdmin || hasReportsPermission;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reports/project-activities');
      const data = await res.json();
      
      console.log('Project Activities API Response:', data); // Debug log
      
      if (data.success) {
        console.log('=== PROJECTS LOADED ===');
        console.log('Count:', data.data?.length || 0);
        console.log('Meta:', data.meta);
        console.log('Project IDs:', data.data?.map(p => p.project_id).sort((a,b) => a-b));
        console.log('All projects:', data.data?.map(p => ({ id: p.project_id, name: p.project_name, code: p.project_code, activities: p.activities?.length || 0 })));
        
        const totalActivities = data.data?.reduce((sum, p) => sum + (p.activities?.length || 0), 0) || 0;
        console.log('=== TOTAL ACTIVITIES IN FRONTEND ===', totalActivities);
        
        // Log activities by project
        data.data?.forEach(p => {
          const isProject1610 = p.project_id === 1610 || p.project_id === '1610' || p.project_code === '1610' || p.project_name?.includes('1610');
          
          if (isProject1610) {
            console.log(`🔍 [FRONTEND] FOUND PROJECT 1610:`, {
              id: p.project_id,
              name: p.project_name,
              code: p.project_code,
              activities_count: p.activities?.length || 0,
              activities: p.activities
            });
          }
          
          if (p.activities && p.activities.length > 0) {
            console.log(`Project ${p.project_id} activities:`, p.activities.map(a => ({
              id: a.id,
              name: a.activity_name,
              members: a.members?.length || 0,
              source: a.source
            })));
          }
        });
        
        // Check if 1610 is missing
        const has1610 = data.data?.some(p => 
          p.project_id === 1610 || p.project_id === '1610' || p.project_code === '1610' || p.project_name?.includes('1610')
        );
        if (!has1610) {
          console.error('❌ [FRONTEND] PROJECT 1610 NOT RECEIVED FROM API!');
        }
        
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
      } else {
        console.error('API returned error:', data.error); // Debug log
        setError(data.error || 'Unknown error');
      }
    } catch (err) {
      console.error('Failed to load project activities report:', err);
      setError('Failed to connect to server. Check console for details.');
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
      const totalQtyDone = dailyEntries.reduce((sum, e) => sum + (e && parseFloat(e.qty_done) || 0), 0);
      const totalHours = dailyEntries.reduce((sum, e) => sum + (e && parseFloat(e.hours) || 0), 0);
      
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

  const filteredProjects = projects.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    const matches = (
      (p.project_name || '').toLowerCase().includes(s) ||
      (p.project_code || '').toLowerCase().includes(s) ||
      String(p.project_id || '').toLowerCase().includes(s) ||
      p.activities?.some(a =>
        (a.activity_name || '').toLowerCase().includes(s) ||
        a.members?.some(m => (m.user_name || '').toLowerCase().includes(s))
      )
    );
    
    const isProject1610 = p.project_id === 1610 || p.project_id === '1610' || p.project_code === '1610' || p.project_name?.includes('1610');
    if (isProject1610) {
      console.log(`🔍 [FILTER] Project 1610 - Search: "${search}", Matches: ${matches}`);
    }
    
    return matches;
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
    const qtyProgress = totalQtyAssigned > 0 ? Math.round((totalQtyDone / totalQtyAssigned) * 100) : 0;
    const hrsProgress = totalPlannedHrs > 0 ? Math.round((totalActualHrs / totalPlannedHrs) * 100) : 0;
    const overallProgress = totalQtyAssigned > 0 || totalPlannedHrs > 0 
      ? Math.round(((qtyProgress + hrsProgress) / 2))
      : 0;
    return { totalActivities, totalMembers, totalQtyAssigned, totalQtyDone, totalPlannedHrs, totalActualHrs, qtyProgress, hrsProgress, overallProgress };
  };

  // Compute activity-level totals
  const getActivityTotals = (activity) => {
    let qtyAssigned = 0, qtyDone = 0, plannedHrs = 0, actualHrs = 0;
    for (const m of (activity.members || [])) {
      qtyAssigned += parseFloat(m.qty_assigned) || 0;
      qtyDone += parseFloat(m.qty_completed) || 0;
      plannedHrs += parseFloat(m.planned_hours) || 0;
      actualHrs += parseFloat(m.actual_hours) || 0;
    }
    const qtyProgress = qtyAssigned > 0 ? Math.round((qtyDone / qtyAssigned) * 100) : 0;
    const hrsProgress = plannedHrs > 0 ? Math.round((actualHrs / plannedHrs) * 100) : 0;
    return { qtyAssigned, qtyDone, plannedHrs, actualHrs, qtyProgress, hrsProgress };
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
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Project Activities Report</h1>
                  {!loading && (
                    <p className="text-sm text-gray-500 mt-1">
                      Showing {filteredProjects.length} of {projects.length} projects
                      {search && <span className="text-purple-600 font-medium"> (filtered)</span>}
                    </p>
                  )}
                </div>
                <button onClick={loadData} disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
                  <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-md">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" placeholder="Search projects, activities, members..."
                    value={search} onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-300 focus:border-purple-400" />
                </div>
                {isSuperAdmin && projects.length > 0 && (
                  <button
                    onClick={() => {
                      console.log('=== PROJECT DEBUG INFO ===');
                      console.log('Total projects loaded:', projects.length);
                      console.log('Filtered projects:', filteredProjects.length);
                      console.log('All project IDs and names:', projects.map(p => ({ id: p.project_id, name: p.project_name, code: p.project_code })));
                      console.log('Search term:', search);
                      console.log('=== ACTIVITIES BREAKDOWN ===');
                      projects.forEach(p => {
                        console.log(`\nProject ${p.project_id}: ${p.project_name}`);
                        console.log(`  Total activities: ${p.activities?.length || 0}`);
                        if (p.activities && p.activities.length > 0) {
                          p.activities.forEach((a, idx) => {
                            console.log(`  ${idx + 1}. [${a.source}] ${a.activity_name} (ID: ${a.id}, Members: ${a.members?.length || 0})`);
                          });
                        }
                      });
                      const totalActs = projects.reduce((sum, p) => sum + (p.activities?.length || 0), 0);
                      console.log(`\n=== GRAND TOTAL: ${totalActs} activities across ${projects.length} projects ===`);
                    }}
                    className="px-3 py-2 text-xs font-medium text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors whitespace-nowrap"
                  >
                    Debug (Console)
                  </button>
                )}
              </div>
            </div>

            {error ? (
              <div className="bg-red-50 rounded-xl border border-red-200 p-8 text-center">
                <div className="text-red-500 text-4xl mb-3">⚠️</div>
                <p className="text-red-800 font-semibold mb-2">Error Loading Projects</p>
                <p className="text-red-600 text-sm mb-4">{error}</p>
                <button 
                  onClick={loadData}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                >
                  Try Again
                </button>
              </div>
            ) : loading ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">Loading project data...</div>
            ) : filteredProjects.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <FolderIcon className="w-12 h-12 mx-auto mb-3 opacity-40 text-gray-400" />
                <p className="text-gray-600 font-medium mb-2">No projects found</p>
                <p className="text-sm text-gray-500 mb-4">
                  {search ? 'Try adjusting your search criteria.' : 'There are no projects created yet.'}
                </p>
                {!search && (
                  <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-4 py-3 inline-block">
                    💡 Tip: Create projects through the <strong>Projects</strong> page
                  </div>
                )}
                {!search && isSuperAdmin && (
                  <div className="mt-4">
                    <button 
                      onClick={() => console.log('API Response:', projects, 'User:', user)}
                      className="text-xs text-purple-600 hover:text-purple-700 underline"
                    >
                      Show debug info (Check console)
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredProjects.map((project) => {
                  const isExpanded = expandedProjects[project.project_id];
                  const totals = getProjectTotals(project);
                  const isProject1610 = project.project_id === 1610 || project.project_id === '1610' || project.project_code === '1610' || project.project_name?.includes('1610');
                  
                  if (isProject1610) {
                    console.log(`🎨 [RENDER] Rendering project 1610:`, {
                      id: project.project_id,
                      name: project.project_name,
                      activities_count: project.activities?.length || 0,
                      isExpanded,
                      activities: project.activities?.map(a => ({
                        id: a.id,
                        name: a.activity_name,
                        members: a.members?.length || 0
                      }))
                    });
                  }
                  
                  console.log(`Project ${project.project_id} "${project.project_name}":`, {
                    activities_count: project.activities?.length || 0,
                    activities: project.activities?.map(a => ({
                      id: a.id,
                      name: a.activity_name,
                      members_count: a.members?.length || 0,
                      source: a.source
                    }))
                  });

                  return (
                    <div key={project.project_id} className="bg-white border border-gray-300 mb-4">
                      {/* Project Header */}
                      <button onClick={() => toggleProject(project.project_id)}
                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-200">
                        <div className="flex items-center gap-4">
                          <div className="text-left">
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-500 font-mono">{project.project_code || `#${project.project_id}`}</span>
                              <span className="font-semibold text-gray-900 text-base">{project.project_name}</span>
                              <span className="text-[10px] text-gray-600">{project.project_status || 'Active'}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-gray-600 mt-1">
                              <span>{totals.totalActivities} activities</span>
                              <span>•</span>
                              <span>{totals.totalMembers} assignments</span>
                              <span>•</span>
                              <span className="text-purple-600 font-semibold">{totals.totalQtyDone}/{totals.totalQtyAssigned} qty</span>
                              <span>•</span>
                              <span className="text-blue-600 font-semibold">{totals.totalActualHrs}/{totals.totalPlannedHrs} hrs</span>
                              <span>•</span>
                              <span className="text-gray-700 font-semibold">{totals.overallProgress}% complete</span>
                            </div>
                          </div>
                        </div>
                        {isExpanded ? <ChevronUpIcon className="w-5 h-5 text-gray-400" /> : <ChevronDownIcon className="w-5 h-5 text-gray-400" />}
                      </button>

                      {/* Activities Table */}
                      {isExpanded && (
                        <div className="border-t border-gray-200">
                          {/* Project Progress Summary */}
                          <div className="bg-gray-50 px-6 py-3 border-b border-gray-300">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-6 text-xs text-gray-700">
                                <div>
                                  <span className="font-semibold">Overall: </span>
                                  <span className="font-bold text-gray-900">{totals.overallProgress}%</span>
                                </div>
                                <div>
                                  <span className="font-semibold">Qty: </span>
                                  <span className="font-bold text-purple-600">{totals.qtyProgress}%</span>
                                </div>
                                <div>
                                  <span className="font-semibold">Hours: </span>
                                  <span className="font-bold text-blue-600">{totals.hrsProgress}%</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {(project.activities || []).length === 0 ? (
                            <div className="px-6 py-10 text-center">
                              <div className="text-gray-300 text-5xl mb-3"></div>
                              <p className="text-gray-500 font-medium">No activities defined</p>
                              <p className="text-gray-400 text-sm mt-1">Add activities to this project to track progress</p>
                            </div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead className="border-b border-gray-300">
                                <tr>
                                  <th className="text-left py-2 px-3 font-semibold text-gray-700 text-[11px]">Activity</th>
                                  <th className="text-center py-2 px-3 font-semibold text-gray-700 text-[11px]">Qty %</th>
                                  <th className="text-center py-2 px-3 font-semibold text-gray-700 text-[11px]">Hrs %</th>
                                  <th className="text-left py-2 px-3 font-semibold text-gray-700 text-[11px]">Team Member</th>
                                  <th className="text-center py-2 px-2 font-semibold text-gray-700 text-[11px]">Assigned</th>
                                  <th className="text-center py-2 px-2 font-semibold text-gray-700 text-[11px]">Done</th>
                                  <th className="text-center py-2 px-2 font-semibold text-gray-700 text-[11px]">Balance</th>
                                  <th className="text-center py-2 px-2 font-semibold text-gray-700 text-[11px]">Plan Hrs</th>
                                  <th className="text-center py-2 px-2 font-semibold text-gray-700 text-[11px]">Actual</th>
                                  <th className="text-center py-2 px-2 font-semibold text-gray-700 text-[11px]">Due</th>
                                  <th className="text-center py-2 px-2 font-semibold text-gray-700 text-[11px]">Status</th>
                                  <th className="text-center py-2 px-2 font-semibold text-gray-700 text-[11px] w-8"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {(project.activities || []).map((activity) => {
                                  const activityTotals = getActivityTotals(activity);
                                  const members = activity.members || [];
                                  
                                  if (members.length === 0) {
                                    return (
                                      <tr key={activity.id} className="border-b border-gray-100 hover:bg-gray-50">
                                        <td className="py-2 px-3">
                                          <div className="font-medium text-gray-900 text-[11px]">{activity.activity_name}</div>
                                          {activity.activity_description && <div className="text-[10px] text-gray-500 mt-0.5">{activity.activity_description}</div>}
                                        </td>
                                        <td className="py-2 px-3 text-center text-gray-400 text-[10px]">—</td>
                                        <td className="py-2 px-3 text-center text-gray-400 text-[10px]">—</td>
                                        <td colSpan={9} className="py-2 px-3 text-gray-400 text-[10px] italic">
                                          No team members assigned
                                        </td>
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
                                        <tr className={`border-b border-gray-100 hover:bg-gray-50 ${isDuePast ? 'bg-red-50' : ''}`}>
                                          {/* Activity (only on first member row) */}
                                          {mIdx === 0 ? (
                                            <td className="py-2 px-3" rowSpan={members.length}>
                                              <div className="font-medium text-gray-900 text-[11px]">{activity.activity_name}</div>
                                              {activity.activity_description && <div className="text-[10px] text-gray-500 mt-0.5">{activity.activity_description}</div>}
                                            </td>
                                          ) : null}

                                          {/* Quantity Progress */}
                                          {mIdx === 0 ? (
                                            <td className="py-2 px-3 text-center" rowSpan={members.length}>
                                              <div className="font-semibold text-purple-600 text-[11px]">{activityTotals.qtyProgress}%</div>
                                              <div className="text-[9px] text-gray-500 mt-0.5">{activityTotals.qtyDone}/{activityTotals.qtyAssigned}</div>
                                            </td>
                                          ) : null}

                                          {/* Hours Progress */}
                                          {mIdx === 0 ? (
                                            <td className="py-2 px-3 text-center" rowSpan={members.length}>
                                              <div className="font-semibold text-blue-600 text-[11px]">{activityTotals.hrsProgress}%</div>
                                              <div className="text-[9px] text-gray-500 mt-0.5">{activityTotals.actualHrs}/{activityTotals.plannedHrs}</div>
                                            </td>
                                          ) : null}

                                          {/* Team Member */}
                                          <td className="py-2 px-3">
                                            <span className="text-[11px] text-gray-900">{member.user_name}</span>
                                          </td>

                                          <td className="py-2 px-2 text-center text-[11px] text-gray-700">{qtyAssigned}</td>
                                          <td className="py-2 px-2 text-center text-[11px] font-semibold text-purple-600">{qtyDone}</td>
                                          <td className={`py-2 px-2 text-center text-[11px] font-semibold ${
                                            balance > 0 ? 'text-amber-600' : 
                                            balance === 0 ? 'text-green-600' : 
                                            'text-red-600'
                                          }`}>{balance}</td>
                                          <td className="py-2 px-2 text-center text-[11px] text-gray-700">{member.planned_hours || 0}</td>
                                          <td className="py-2 px-2 text-center text-[11px] font-semibold text-blue-600">{member.actual_hours || 0}</td>
                                          <td className={`py-2 px-2 text-center text-[10px] ${
                                            isDuePast ? 'font-semibold text-red-600' : 'text-gray-600'
                                          }`}>{formatShortDate(member.due_date)}</td>
                                          <td className="py-2 px-2 text-center">
                                            <span className={`text-[10px] font-medium ${
                                              member.status === 'Completed' ? 'text-green-700' :
                                              member.status === 'In Progress' ? 'text-blue-700' :
                                              member.status === 'Pending' ? 'text-yellow-700' :
                                              'text-gray-600'
                                            }`}>
                                              {member.status}
                                            </span>
                                          </td>
                                          <td className="py-2 px-2 text-center">
                                            {dailyEntries.length > 0 && (
                                              <button onClick={() => toggleMember(memberKey)}
                                                className="text-gray-500 hover:text-purple-600" title="Daily entries">
                                                {isMemberExpanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
                                              </button>
                                            )}
                                          </td>
                                        </tr>

                                        {/* Daily Entries */}
                                        {isMemberExpanded && dailyEntries.length > 0 && (
                                          <tr>
                                            <td colSpan={12} className="py-0 px-3 bg-gray-50">
                                              <div className="ml-6 pl-4 py-2 border-l-2 border-gray-300">
                                                <div className="text-[10px] font-semibold text-gray-600 mb-1">Daily Entries</div>
                                                <table className="w-full text-[10px]">
                                                  <thead className="border-b border-gray-300">
                                                    <tr>
                                                      <th className="text-left py-1 px-2 font-semibold text-gray-600">Date</th>
                                                      <th className="text-center py-1 px-2 font-semibold text-gray-600">Qty</th>
                                                      <th className="text-center py-1 px-2 font-semibold text-gray-600">Hours</th>
                                                      <th className="text-left py-1 px-2 font-semibold text-gray-600">Remarks</th>
                                                      {isSuperAdmin && <th className="text-center py-1 px-2 font-semibold text-gray-600">Actions</th>}
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {dailyEntries.filter(e => e != null).map((entry, eIdx) => {
                                                      const entryKey = `${project.project_id}-${activity.id}-${member.user_id}-${eIdx}`;
                                                      const isEditing = editingEntry === entryKey;
                                                      
                                                      return (
                                                        <tr key={eIdx} className="border-b border-gray-100 hover:bg-gray-50">
                                                          <td className="py-1 px-2">
                                                            {isEditing ? (
                                                              <input 
                                                                type="date" 
                                                                value={editForm.date || ''} 
                                                                onChange={(e) => setEditForm({...editForm, date: e.target.value})}
                                                                className="w-full px-1 py-0.5 text-[10px] border border-gray-300 rounded focus:border-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              <span className="text-gray-700">{formatShortDate(entry.date)}</span>
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
                                                                className="w-16 px-1 py-0.5 text-[10px] border border-gray-300 rounded text-center focus:border-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              <span className="font-semibold text-purple-600">{entry.qty_done || 0}</span>
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
                                                                className="w-16 px-1 py-0.5 text-[10px] border border-gray-300 rounded text-center focus:border-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              <span className="font-semibold text-blue-600">{entry.hours || 0}</span>
                                                            )}
                                                          </td>
                                                          <td className="py-1 px-2">
                                                            {isEditing ? (
                                                              <input 
                                                                type="text" 
                                                                value={editForm.remarks || ''} 
                                                                onChange={(e) => setEditForm({...editForm, remarks: e.target.value})}
                                                                placeholder="Remarks..."
                                                                className="w-full px-1 py-0.5 text-[10px] border border-gray-300 rounded focus:border-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              <span className="text-gray-600 text-[10px]">{entry.remarks || '–'}</span>
                                                            )}
                                                          </td>
                                                          {isSuperAdmin && (
                                                            <td className="py-1 px-2 text-center">
                                                              {isEditing ? (
                                                                <div className="flex items-center justify-center gap-1">
                                                                  <button 
                                                                    onClick={() => saveEditedEntry(project.project_id, activity.id, member.user_id, member)}
                                                                    disabled={saving}
                                                                    className="text-green-600 hover:text-green-700 disabled:opacity-50"
                                                                    title="Save"
                                                                  >
                                                                    <CheckIcon className="w-3.5 h-3.5" />
                                                                  </button>
                                                                  <button 
                                                                    onClick={cancelEditingEntry}
                                                                    disabled={saving}
                                                                    className="text-red-600 hover:text-red-700 disabled:opacity-50"
                                                                    title="Cancel"
                                                                  >
                                                                    <XMarkIcon className="w-3.5 h-3.5" />
                                                                  </button>
                                                                </div>
                                                              ) : (
                                                                <button 
                                                                  onClick={() => startEditingEntry(project.project_id, activity.id, member.user_id, eIdx, entry)}
                                                                  className="text-purple-600 hover:text-purple-700"
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
                                                    <tr className="border-t-2 border-gray-300 font-semibold">
                                                      <td className="py-1 px-2 text-[10px] text-gray-700">Total</td>
                                                      <td className="py-1 px-2 text-center text-purple-600">{dailyEntries.reduce((s, e) => s + (e && parseFloat(e.qty_done) || 0), 0)}</td>
                                                      <td className="py-1 px-2 text-center text-blue-600">{dailyEntries.reduce((s, e) => s + (e && parseFloat(e.hours) || 0), 0)}</td>
                                                      <td className="py-1 px-2"></td>
                                                      {isSuperAdmin && <td className="py-1 px-2"></td>}
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
