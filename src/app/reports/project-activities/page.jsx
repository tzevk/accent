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
                    <div key={project.project_id} className="bg-white rounded-xl border border-gray-200 shadow-lg hover:shadow-xl transition-shadow overflow-hidden">
                      {/* Project Header */}
                      <button onClick={() => toggleProject(project.project_id)}
                        className="w-full px-6 py-5 flex items-center justify-between hover:bg-gradient-to-r hover:from-purple-50 hover:to-blue-50 transition-all border-b border-gray-100">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center shadow-md">
                            <FolderIcon className="w-6 h-6 text-white" />
                          </div>
                          <div className="text-left">
                            <div className="flex items-center gap-3 mb-1">
                              <span className="font-mono text-xs bg-purple-100 text-purple-700 px-2.5 py-1 rounded-md font-bold">{project.project_code || `#${project.project_id}`}</span>
                              <span className="font-semibold text-gray-900 text-base">{project.project_name}</span>
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border shadow-sm ${getStatusBadge(project.project_status)}`}>{project.project_status || 'Active'}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-gray-600 mt-1">
                              <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div>
                                <span className="font-medium">{totals.totalActivities}</span>
                                <span className="text-gray-400">activities</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                                <span className="font-medium">{totals.totalMembers}</span>
                                <span className="text-gray-400">assignments</span>
                              </div>
                              <span className="text-purple-700 font-semibold bg-purple-50 px-2 py-0.5 rounded">{totals.totalQtyDone}/{totals.totalQtyAssigned} qty</span>
                              <span className="text-blue-700 font-semibold bg-blue-50 px-2 py-0.5 rounded">{totals.totalActualHrs}/{totals.totalPlannedHrs} hrs</span>
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm ${
                                totals.overallProgress >= 100 ? 'bg-green-100 text-green-700' :
                                totals.overallProgress >= 75 ? 'bg-blue-100 text-blue-700' :
                                totals.overallProgress >= 50 ? 'bg-yellow-100 text-yellow-700' :
                                totals.overallProgress >= 25 ? 'bg-orange-100 text-orange-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {totals.overallProgress}% Complete
                              </span>
                            </div>
                          </div>
                        </div>
                        {isExpanded ? <ChevronUpIcon className="w-5 h-5 text-gray-400" /> : <ChevronDownIcon className="w-5 h-5 text-gray-400" />}
                      </button>

                      {/* Activities Table */}
                      {isExpanded && (
                        <div className="border-t border-gray-200">
                          {/* Project Progress Summary Bar */}
                          <div className="bg-gradient-to-r from-purple-50 via-blue-50 to-purple-50 px-6 py-4 border-b-2 border-purple-100">
                            <div className="flex items-center gap-6">
                              <div className="flex-1">
                                <div className="flex items-center justify-between text-xs mb-2">
                                  <span className="text-gray-700 font-semibold uppercase tracking-wide text-[10px]">Overall Progress</span>
                                  <span className="font-black text-2xl text-purple-700">{totals.overallProgress}%</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-4 shadow-inner">
                                  <div 
                                    className={`h-4 rounded-full transition-all shadow-md ${
                                      totals.overallProgress >= 100 ? 'bg-gradient-to-r from-green-500 to-green-600' :
                                      totals.overallProgress >= 75 ? 'bg-gradient-to-r from-blue-500 to-blue-600' :
                                      totals.overallProgress >= 50 ? 'bg-gradient-to-r from-yellow-500 to-yellow-600' :
                                      totals.overallProgress >= 25 ? 'bg-gradient-to-r from-orange-500 to-orange-600' :
                                      'bg-gradient-to-r from-red-500 to-red-600'
                                    }`}
                                    style={{ width: `${Math.min(totals.overallProgress, 100)}%` }}
                                  ></div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-[11px]">
                                <div className="text-center px-4 py-2 bg-white rounded-xl shadow-sm border border-purple-100">
                                  <div className="text-purple-700 font-black text-lg">{totals.qtyProgress}%</div>
                                  <div className="text-gray-500 text-[10px] font-medium uppercase tracking-wide">Quantity</div>
                                </div>
                                <div className="text-center px-4 py-2 bg-white rounded-xl shadow-sm border border-blue-100">
                                  <div className="text-blue-700 font-black text-lg">{totals.hrsProgress}%</div>
                                  <div className="text-gray-500 text-[10px] font-medium uppercase tracking-wide">Hours</div>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {(project.activities || []).length === 0 ? (
                            <div className="px-6 py-10 text-center">
                              <div className="text-gray-300 text-5xl mb-3">📋</div>
                              <p className="text-gray-500 font-medium">No activities defined</p>
                              <p className="text-gray-400 text-sm mt-1">Add activities to this project to track progress</p>
                            </div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                                <tr>
                                  <th className="text-left py-3 px-4 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Activity</th>
                                  <th className="text-center py-3 px-3 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Progress</th>
                                  <th className="text-left py-3 px-3 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Team Member</th>
                                  <th className="text-center py-3 px-2 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Qty Asgn</th>
                                  <th className="text-center py-3 px-2 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Qty Done</th>
                                  <th className="text-center py-3 px-2 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Balance</th>
                                  <th className="text-center py-3 px-2 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Plan Hrs</th>
                                  <th className="text-center py-3 px-2 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Manhours</th>
                                  <th className="text-center py-3 px-2 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Due Date</th>
                                  <th className="text-center py-3 px-2 font-bold text-gray-600 uppercase tracking-wider text-[10px]">Status</th>
                                  <th className="text-center py-3 px-2 font-bold text-gray-600 uppercase tracking-wider text-[10px] w-8"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {(project.activities || []).map((activity) => {
                                  const activityTotals = getActivityTotals(activity);
                                  const members = activity.members || [];
                                  
                                  if (members.length === 0) {
                                    return (
                                      <tr key={activity.id} className="hover:bg-purple-50/30 transition-colors">
                                        <td className="py-3 px-4 align-middle">
                                          <div className="font-semibold text-gray-900 text-[11px]">{activity.activity_name}</div>
                                          {activity.activity_description && <div className="text-[10px] text-gray-500 mt-0.5">{activity.activity_description}</div>}
                                          {activity.source && <span className="inline-block mt-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[9px] uppercase font-medium">{activity.source}</span>}
                                        </td>
                                        <td className="py-3 px-3 align-middle">
                                          <div className="text-[10px] text-gray-400 font-medium">—</div>
                                        </td>
                                        <td colSpan={9} className="py-3 px-3 text-gray-500 text-[11px] italic">
                                          <div className="flex items-center gap-2">
                                            <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                            </svg>
                                            <span>No team members assigned</span>
                                          </div>
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
                                        <tr className={`hover:bg-purple-50/20 transition-colors border-l-2 ${isDuePast ? 'bg-red-50/50 border-l-red-400' : 'border-l-transparent'}`}>
                                          {/* Activity (only on first member row) */}
                                          {mIdx === 0 ? (
                                            <td className="py-3 px-4 align-middle bg-gray-50/50" rowSpan={members.length}>
                                              <div className="font-semibold text-gray-900 text-[11px]">{activity.activity_name}</div>
                                              {activity.activity_description && <div className="text-[10px] text-gray-500 max-w-[200px] truncate mt-0.5" title={activity.activity_description}>{activity.activity_description}</div>}
                                              {activity.discipline && <span className="inline-block mt-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-[9px] font-medium">{activity.discipline}</span>}
                                              {activity.source && <span className="inline-block ml-1 mt-1 px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[9px] uppercase font-medium">{activity.source}</span>}
                                            </td>
                                          ) : null}

                                          {/* Activity Progress (only on first member row) */}
                                          {mIdx === 0 ? (
                                            <td className="py-3 px-3 align-middle bg-gray-50/50" rowSpan={members.length}>
                                              <div className="space-y-2.5">
                                                {/* Quantity Progress */}
                                                <div className="bg-white p-2 rounded-lg border border-gray-100">
                                                  <div className="flex items-center justify-between text-[9px] mb-1">
                                                    <span className="text-gray-600 font-semibold uppercase">Qty</span>
                                                    <span className="font-bold text-purple-700">{activityTotals.qtyProgress}%</span>
                                                  </div>
                                                  <div className="w-full bg-gray-200 rounded-full h-2 shadow-inner">
                                                    <div 
                                                      className={`h-2 rounded-full transition-all shadow-sm ${
                                                        activityTotals.qtyProgress >= 100 ? 'bg-green-500' :
                                                        activityTotals.qtyProgress >= 75 ? 'bg-blue-500' :
                                                        activityTotals.qtyProgress >= 50 ? 'bg-yellow-500' :
                                                        activityTotals.qtyProgress >= 25 ? 'bg-orange-500' :
                                                        'bg-red-500'
                                                      }`}
                                                      style={{ width: `${Math.min(activityTotals.qtyProgress, 100)}%` }}
                                                    ></div>
                                                  </div>
                                                  <div className="text-[9px] text-gray-600 mt-1 font-medium">
                                                    {activityTotals.qtyDone} / {activityTotals.qtyAssigned}
                                                  </div>
                                                </div>
                                                {/* Hours Progress */}
                                                <div className="bg-white p-2 rounded-lg border border-gray-100">
                                                  <div className="flex items-center justify-between text-[9px] mb-1">
                                                    <span className="text-gray-600 font-semibold uppercase">Hrs</span>
                                                    <span className="font-bold text-blue-700">{activityTotals.hrsProgress}%</span>
                                                  </div>
                                                  <div className="w-full bg-gray-200 rounded-full h-2 shadow-inner">
                                                    <div 
                                                      className={`h-2 rounded-full transition-all shadow-sm ${
                                                        activityTotals.hrsProgress >= 100 ? 'bg-green-500' :
                                                        activityTotals.hrsProgress >= 75 ? 'bg-blue-500' :
                                                        activityTotals.hrsProgress >= 50 ? 'bg-yellow-500' :
                                                        activityTotals.hrsProgress >= 25 ? 'bg-orange-500' :
                                                        'bg-red-500'
                                                      }`}
                                                      style={{ width: `${Math.min(activityTotals.hrsProgress, 100)}%` }}
                                                    ></div>
                                                  </div>
                                                  <div className="text-[9px] text-gray-600 mt-1 font-medium">
                                                    {activityTotals.actualHrs} / {activityTotals.plannedHrs} hrs
                                                  </div>
                                                </div>
                                              </div>
                                            </td>
                                          ) : null}

                                          {/* Team Member */}
                                          <td className="py-3 px-3 align-middle">
                                            <div className="flex items-center gap-2">
                                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-400 to-blue-400 flex items-center justify-center text-white font-bold text-[10px] shadow-sm">
                                                {member.user_name?.charAt(0)?.toUpperCase() || 'U'}
                                              </div>
                                              <span className="text-[11px] text-gray-900 font-semibold">{member.user_name}</span>
                                            </div>
                                          </td>

                                          <td className="py-3 px-2 text-center align-middle">
                                            <span className="text-[11px] text-gray-700 font-medium">{qtyAssigned}</span>
                                          </td>
                                          <td className="py-3 px-2 text-center align-middle">
                                            <span className="font-bold text-purple-600">{qtyDone}</span>
                                          </td>
                                          <td className="py-3 px-2 text-center align-middle">
                                            <span className={`font-bold text-[11px] px-2 py-0.5 rounded ${balance > 0 ? 'bg-amber-50 text-amber-700' : balance === 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>{balance}</span>
                                          </td>
                                          <td className="py-3 px-2 text-center align-middle">
                                            <span className="text-[11px] text-gray-700 font-medium">{member.planned_hours || 0}</span>
                                          </td>
                                          <td className="py-3 px-2 text-center align-middle">
                                            <span className="font-bold text-blue-600 text-[11px]">{member.actual_hours || 0}</span>
                                          </td>
                                          <td className="py-3 px-2 text-center align-middle">
                                            <span className={`text-[10px] font-semibold px-2 py-1 rounded ${isDuePast ? 'bg-red-100 text-red-700' : 'text-gray-600'}`}>{formatShortDate(member.due_date)}</span>
                                          </td>
                                          <td className="py-3 px-2 text-center align-middle">
                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm ${
                                              member.status === 'Completed' ? 'bg-green-100 text-green-800 border border-green-200' :
                                              member.status === 'In Progress' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                                              member.status === 'Pending' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' :
                                              'bg-gray-100 text-gray-700 border border-gray-200'
                                            }`}>
                                              {member.status}
                                            </span>
                                          </td>
                                          <td className="py-3 px-2 text-center align-middle">
                                            {dailyEntries.length > 0 && (
                                              <button onClick={() => toggleMember(memberKey)}
                                                className="p-1.5 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors shadow-sm" title="Daily entries">
                                                {isMemberExpanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
                                              </button>
                                            )}
                                          </td>
                                        </tr>

                                        {/* Daily Entries */}
                                        {isMemberExpanded && dailyEntries.length > 0 && (
                                          <tr>
                                            <td colSpan={11} className="px-6 py-4 bg-gradient-to-r from-purple-50/50 to-blue-50/50">
                                              <div className="ml-8 border-l-2 border-purple-300 pl-4 bg-white rounded-lg shadow-sm p-3">
                                                <div className="flex items-center gap-2 mb-2">
                                                  <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                  </svg>
                                                  <div className="text-[10px] font-bold text-gray-700 uppercase tracking-wide">Daily Entries</div>
                                                </div>
                                                <table className="w-full text-[10px] border border-gray-200 rounded-lg overflow-hidden">
                                                  <thead>
                                                    <tr className="bg-gradient-to-r from-purple-500 to-blue-500 text-white uppercase">
                                                      <th className="text-center py-2 px-3 font-bold">Date</th>
                                                      <th className="text-center py-2 px-3 font-bold">Qty Done</th>
                                                      <th className="text-center py-2 px-3 font-bold">Manhours</th>
                                                      <th className="text-center py-2 px-3 font-bold">Remarks</th>
                                                      {isSuperAdmin && <th className="text-center py-2 px-3 font-bold">Actions</th>}
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {dailyEntries.map((entry, eIdx) => {
                                                      const entryKey = `${project.project_id}-${activity.id}-${member.user_id}-${eIdx}`;
                                                      const isEditing = editingEntry === entryKey;
                                                      
                                                      return (
                                                        <tr key={eIdx} className="text-gray-700 border-b border-gray-100 hover:bg-purple-50/30 transition-colors">
                                                          <td className="py-2 px-3 text-center">
                                                            {isEditing ? (
                                                              <input 
                                                                type="date" 
                                                                value={editForm.date || ''} 
                                                                onChange={(e) => setEditForm({...editForm, date: e.target.value})}
                                                                className="w-full px-2 py-1 text-[10px] border border-purple-300 rounded-md focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              <span className="font-medium">{formatShortDate(entry.date)}</span>
                                                            )}
                                                          </td>
                                                          <td className="py-2 px-3 text-center">
                                                            {isEditing ? (
                                                              <input 
                                                                type="number" 
                                                                value={editForm.qty_done || ''} 
                                                                onChange={(e) => setEditForm({...editForm, qty_done: e.target.value})}
                                                                min="0"
                                                                step="0.01"
                                                                className="w-20 px-2 py-1 text-[10px] border border-purple-300 rounded-md text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              <span className="font-bold text-purple-600">{entry.qty_done || 0}</span>
                                                            )}
                                                          </td>
                                                          <td className="py-2 px-3 text-center">
                                                            {isEditing ? (
                                                              <input 
                                                                type="number" 
                                                                value={editForm.hours || ''} 
                                                                onChange={(e) => setEditForm({...editForm, hours: e.target.value})}
                                                                min="0"
                                                                step="0.5"
                                                                className="w-20 px-2 py-1 text-[10px] border border-purple-300 rounded-md text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              <span className="font-bold text-blue-600">{entry.hours || 0}</span>
                                                            )}
                                                          </td>
                                                          <td className="py-2 px-3 text-center">
                                                            {isEditing ? (
                                                              <input 
                                                                type="text" 
                                                                value={editForm.remarks || ''} 
                                                                onChange={(e) => setEditForm({...editForm, remarks: e.target.value})}
                                                                placeholder="Remarks..."
                                                                className="w-full px-2 py-1 text-[10px] border border-purple-300 rounded-md focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none"
                                                              />
                                                            ) : (
                                                              <span className="text-gray-600 italic">{entry.remarks || '–'}</span>
                                                            )}
                                                          </td>
                                                          {isSuperAdmin && (
                                                            <td className="py-2 px-3 text-center">
                                                              {isEditing ? (
                                                                <div className="flex items-center justify-center gap-1.5">
                                                                  <button 
                                                                    onClick={() => saveEditedEntry(project.project_id, activity.id, member.user_id, member)}
                                                                    disabled={saving}
                                                                    className="p-1 text-green-600 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                                                                    title="Save"
                                                                  >
                                                                    <CheckIcon className="w-4 h-4" />
                                                                  </button>
                                                                  <button 
                                                                    onClick={cancelEditingEntry}
                                                                    disabled={saving}
                                                                    className="p-1 text-red-600 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                                                                    title="Cancel"
                                                                  >
                                                                    <XMarkIcon className="w-4 h-4" />
                                                                  </button>
                                                                </div>
                                                              ) : (
                                                                <button 
                                                                  onClick={() => startEditingEntry(project.project_id, activity.id, member.user_id, eIdx, entry)}
                                                                  className="p-1 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors shadow-sm"
                                                                  title="Edit"
                                                                >
                                                                  <PencilSquareIcon className="w-4 h-4" />
                                                                </button>
                                                              )}
                                                            </td>
                                                          )}
                                                        </tr>
                                                      );
                                                    })}
                                                    {/* Totals row */}
                                                    <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-t-2 border-gray-300">
                                                      <td className="py-2 px-3 text-[10px] font-black text-gray-800 uppercase tracking-wide">Total</td>
                                                      <td className="py-2 px-3 text-center font-black text-purple-700">{dailyEntries.reduce((s, e) => s + (parseFloat(e.qty_done) || 0), 0)}</td>
                                                      <td className="py-2 px-3 text-center font-black text-blue-700">{dailyEntries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)}</td>
                                                      <td className="py-2 px-3"></td>
                                                      {isSuperAdmin && <td className="py-2 px-3"></td>}
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
