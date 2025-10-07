'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import Navbar from '@/components/Navbar';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  PlusIcon, 
  FolderIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  CalendarIcon,
  ArrowLeftIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  isSameDay,
  isSameMonth
} from 'date-fns';



const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/** Suspense wrapper to satisfy Next.js for useSearchParams */
export default function Projects() {
  return (
    <Suspense fallback={<div className="p-8 text-sm">Loading…</div>}>
      <ProjectsInner />
    </Suspense>
  );
}

function ProjectsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view');
  const focusParam = searchParams.get('focus');

  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(() => (viewParam === 'calendar' ? 'calendar' : 'list'));
  const [calendarDate, setCalendarDate] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setActiveTab(viewParam === 'calendar' ? 'calendar' : 'list');
  }, [viewParam]);

  useEffect(() => {
    if (!focusParam) {
      setSelectedDate(null);
      return;
    }
    const parsed = new Date(focusParam);
    if (!Number.isNaN(parsed.getTime())) {
      setSelectedDate(parsed);
      setCalendarDate(startOfMonth(parsed));
    }
  }, [focusParam]);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      const result = await response.json();
      if (result.success) setProjects(result.data);
      else console.error('Error fetching projects:', result.error);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewProject = () => router.push('/projects/new');

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this project?')) return;
    try {
      const response = await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
      const result = await response.json();
      if (result.success) fetchProjects();
      else alert('Error deleting project: ' + result.error);
    } catch (error) {
      console.error('Error deleting project:', error);
      alert('Error deleting project');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'planning': return 'bg-yellow-100 text-yellow-800';
      case 'in-progress':
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'on-hold':
      case 'on_hold': return 'bg-orange-100 text-orange-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      case 'active': return 'bg-accent-primary/10 text-accent-primary';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority) => {
    switch ((priority || '').toLowerCase()) {
      case 'high': return 'text-red-600';
      case 'medium': return 'text-yellow-600';
      case 'low': return 'text-green-600';
      default: return 'text-gray-600';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatCurrency = (amount) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };

  const formatLabel = (value) =>
    (!value ? 'Status' : value.toString().replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

  const toDateKey = (value) => {
    if (!value) return null;
    if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : format(parsed, 'yyyy-MM-dd');
  };

  const projectsByDate = useMemo(() => {
    const grouped = {};
    projects.forEach((p) => {
      const key = toDateKey(p.start_date) || toDateKey(p.target_date);
      if (!key) return;
      (grouped[key] ||= []).push(p);
    });
    Object.values(grouped).forEach((items) => {
      items.sort((a, b) => {
        const pd = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
        return pd !== 0 ? pd : (a.name || '').localeCompare(b.name || '');
      });
    });
    return grouped;
  }, [projects]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarDate);
    const monthEnd = endOfMonth(calendarDate);
    const periodStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const periodEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    const days = [];
    for (let cur = periodStart; cur <= periodEnd; cur = addDays(cur, 1)) days.push(cur);
    return days;
  }, [calendarDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(calendarDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [calendarDate]);

  const handlePrevMonth = () => setCalendarDate((p) => subMonths(p, 1));
  const handleNextMonth = () => setCalendarDate((p) => addMonths(p, 1));
  const handleGoToToday = () => setCalendarDate(startOfMonth(new Date()));

  const handleQuickAdd = (date) => {
    const target = date instanceof Date ? date : new Date(date);
    if (!Number.isNaN(target.getTime())) {
      setSelectedDate(target);
      setCalendarDate(startOfMonth(target));
      router.push(`/projects/new?date=${format(target, 'yyyy-MM-dd')}`);
    } else {
      router.push('/projects/new');
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-xl font-bold text-black">Projects</h1>
              <p className="text-sm text-black">Manage and track your client projects</p>
            </div>

            {/* Tabs (accessible) */}
            <div className="border-b border-gray-200 mb-6">
              <div role="tablist" aria-label="Projects views" className="-mb-px flex space-x-2">
                {[
                  { id: 'list', label: `Projects List (${projects.length})` },
                  { id: 'calendar', label: 'Calendar View' }
                ].map((tab, idx, arr) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`panel-${tab.id}`}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => {
                        setActiveTab(tab.id);
                        // keep search params in sync
                        const url = new URL(window.location.href);
                        url.searchParams.set('view', tab.id === 'calendar' ? 'calendar' : 'list');
                        window.history.replaceState({}, '', url);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowRight') {
                          const next = arr[(idx + 1) % arr.length];
                          setActiveTab(next.id);
                          const url = new URL(window.location.href);
                          url.searchParams.set('view', next.id === 'calendar' ? 'calendar' : 'list');
                          window.history.replaceState({}, '', url);
                        } else if (e.key === 'ArrowLeft') {
                          const prev = arr[(idx - 1 + arr.length) % arr.length];
                          setActiveTab(prev.id);
                          const url = new URL(window.location.href);
                          url.searchParams.set('view', prev.id === 'calendar' ? 'calendar' : 'list');
                          window.history.replaceState({}, '', url);
                        }
                      }}
                      className={`py-2 px-3 border-b-2 font-medium text-xs rounded-t-md focus:outline-none ${
                        isActive
                          ? 'border-accent-primary text-black'
                          : 'border-transparent text-black hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Content */}
            <div className="space-y-6">
              {activeTab === 'list' && (
                <div className="space-y-6">
                  {/* Action Bar */}
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                      <button
                        onClick={handleNewProject}
                        className="bg-accent-primary hover:bg-accent-primary/90 text-white px-4 py-2 rounded-md inline-flex items-center space-x-2 transition-colors text-sm"
                      >
                        <PlusIcon className="h-4 w-4" />
                        <span>New Project</span>
                      </button>
                      <div className="ml-4 flex items-center space-x-2">
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search projects or client..."
                          className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        />
                        <select
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value)}
                          className="px-2 py-2 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">All Statuses</option>
                          <option value="NEW">NEW</option>
                          <option value="planning">Planning</option>
                          <option value="in-progress">In Progress</option>
                          <option value="on-hold">On Hold</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                        <select
                          value={priorityFilter}
                          onChange={(e) => setPriorityFilter(e.target.value)}
                          className="px-2 py-2 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">All Priorities</option>
                          <option value="HIGH">High</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="LOW">Low</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Projects Table */}
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    {loading ? (
                      <div className="p-6 text-center">
                        <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-accent-primary"></div>
                        <p className="mt-2 text-sm text-black">Loading projects...</p>
                      </div>
                    ) : projects.length === 0 ? (
                      <div className="p-6 text-center">
                        <FolderIcon className="mx-auto h-10 w-10 text-gray-400" />
                        <h3 className="mt-2 text-sm font-medium text-black">No projects found</h3>
                        <p className="mt-1 text-xs text-black">Get started by creating a new project.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Project No.</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Project</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Client</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Timeline</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Status</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Estimated Cost</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Budget</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Progress</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-black uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {projects
                              .filter((p) => {
                                if (query && !(`${p.name || ''} ${p.client_name || ''}`.toLowerCase().includes(query.toLowerCase()))) return false;
                                if (statusFilter && String((p.status || '')).toLowerCase() !== statusFilter.toLowerCase()) return false;
                                if (priorityFilter && String((p.priority || '')).toLowerCase() !== priorityFilter.toLowerCase()) return false;
                                return true;
                              })
                              .sort((a, b) => {
                                // Sort by project_id in descending order (newest first)
                                const idA = a.project_id || '';
                                const idB = b.project_id || '';
                                // Compare strings in reverse order for descending
                                return idB.localeCompare(idA);
                              })
                              .map((project) => (
                              <tr key={project.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="text-sm font-mono text-gray-900">
                                    {project.project_id || '-'}
                                  </div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div>
                                    <div className="text-sm font-medium text-black">{project.name}</div>
                                    <div className="text-xs text-black max-w-xs truncate">{project.description}</div>
                                    <div className={`text-xs font-medium mt-1 ${getPriorityColor(project.priority)}`}>
                                      {formatLabel(project.priority || 'Unassigned')} Priority
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="text-sm text-black">{project.client_name}</div>
                                  <div className="text-xs text-black">PM: {project.project_manager || 'Not assigned'}</div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="text-sm text-black">
                                    <div className="flex items-center">
                                      <CalendarIcon className="h-3 w-3 mr-1 text-gray-400" />
                                      {formatDate(project.start_date)}
                                    </div>
                                    {project.end_date && (
                                      <div className="text-xs text-black mt-1">to {formatDate(project.end_date)}</div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className={`px-2 py-1 inline-flex text-xs leading-4 font-semibold rounded-full ${getStatusColor(project.status)}`}>
                                    {formatLabel(project.status)}
                                  </span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-black">
                                  {(() => {
                                    try {
                                      if (project.cost_breakup) {
                                        const cb = typeof project.cost_breakup === 'string' ? JSON.parse(project.cost_breakup) : project.cost_breakup;
                                        const tot = cb.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);
                                        return tot > 0 ? formatCurrency(tot) : '-';
                                      }
                                    } catch (e) {}
                                    return '-';
                                  })()}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-black">
                                  {formatCurrency(project.budget)}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="flex items-center">
                                    <div className="w-12 bg-gray-200 rounded-full h-1.5 mr-2">
                                      <div className="bg-accent-primary h-1.5 rounded-full" style={{ width: `${project.progress || 0}%` }}></div>
                                    </div>
                                    <span className="text-xs text-black">{project.progress || 0}%</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                  <div className="flex items-center justify-end space-x-1">
                                    <button
                                      onClick={() => router.push(`/projects/${project.id}`)}
                                      className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-full transition-colors"
                                      title="View Details"
                                    >
                                      <EyeIcon className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => router.push(`/projects/${project.id}/edit`)}
                                      className="p-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-full transition-colors"
                                      title="Edit Project"
                                    >
                                      <PencilIcon className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDelete(project.id)}
                                      className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-full transition-colors"
                                      title="Delete Project"
                                    >
                                      <TrashIcon className="h-3 w-3" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'calendar' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-semibold text-black">Plan by Calendar</h2>
                        <p className="text-xs text-gray-500">Assign projects to specific days and monitor workload.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleGoToToday}
                          className="px-3 py-1.5 text-xs font-medium text-black border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
                        >
                          Today
                        </button>
                        <div className="flex items-center border border-gray-200 rounded-md overflow-hidden divide-x divide-gray-200 bg-gray-50">
                          <button
                            type="button"
                            onClick={handlePrevMonth}
                            className="p-2 text-gray-600 hover:bg-gray-100 transition-colors"
                            aria-label="Previous month"
                          >
                            <ArrowLeftIcon className="h-4 w-4" />
                          </button>
                          <div className="px-4 text-sm font-semibold text-black whitespace-nowrap">
                            {format(calendarDate, 'MMMM yyyy')}
                          </div>
                          <button
                            type="button"
                            onClick={handleNextMonth}
                            className="p-2 text-gray-600 hover:bg-gray-100 transition-colors"
                            aria-label="Next month"
                          >
                            <ArrowRightIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="grid grid-cols-7 gap-px bg-gray-200">
                      {weekDays.map((day) => (
                        <div key={`heading-${format(day, 'yyyy-MM-dd')}`} className="bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          {format(day, 'EEE')}
                        </div>
                      ))}
                      {calendarDays.map((day) => {
                        const key = format(day, 'yyyy-MM-dd');
                        const dayProjects = projectsByDate[key] || [];
                        const muted = !isSameMonth(day, calendarDate);
                        const isToday = isSameDay(day, new Date());
                        const isSelected = selectedDate && isSameDay(day, selectedDate);

                        return (
                          <div
                            key={key}
                            className={`min-h-[128px] bg-white p-2 flex flex-col border-b border-r border-gray-200 transition-colors hover:bg-accent-primary/5 ${
                              muted ? 'bg-gray-50 text-gray-400' : 'text-black'
                            } ${isSelected ? 'ring-2 ring-accent-primary ring-offset-2 ring-offset-white' : ''}`}
                          >
                            <div className="flex items-start justify-between">
                              <div className={`text-sm font-semibold ${muted ? 'text-gray-400' : 'text-black'}`}>
                                {format(day, 'd')}
                              </div>
                              <div className="flex items-center space-x-1">
                                {isToday && (
                                  <span className="text-[10px] font-semibold text-accent-primary bg-accent-primary/10 px-1.5 py-0.5 rounded-full">
                                    Today
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleQuickAdd(day)}
                                  className="p-1 rounded-full text-accent-primary hover:bg-accent-primary/10 transition-colors"
                                  aria-label={`Add project on ${format(day, 'MMMM d, yyyy')}`}
                                >
                                  <PlusIcon className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                            <div className="mt-2 space-y-2 overflow-y-auto max-h-32 pr-1">
                              {dayProjects.map((project) => (
                                <div key={project.id} className="border border-accent-primary/40 bg-accent-primary/10 rounded-md px-2 py-1">
                                  <p className="text-xs font-semibold text-black truncate" title={project.name}>
                                    {project.name}
                                  </p>
                                  <p className="text-[11px] text-gray-500 truncate" title={project.client_name}>
                                    {project.client_name}
                                  </p>
                                  <div className="mt-1 flex items-center justify-between">
                                    <span className={`text-[10px] font-medium ${getPriorityColor(project.priority)}`}>
                                      {formatLabel(project.priority || 'Unassigned')}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${getStatusColor(project.status)}`}>
                                      {formatLabel(project.status)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}