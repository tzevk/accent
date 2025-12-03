'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import Navbar from '@/components/Navbar';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchJSON } from '@/utils/http';
import { 
  PlusIcon, 
  FolderIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  CalendarIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronUpDownIcon,
  FunnelIcon
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
const BOARD_COLUMNS = [
  { id: 'NEW', label: 'New' },
  { id: 'planning', label: 'Planning' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'on-hold', label: 'On Hold' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' }
];

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
  const [showFilters, setShowFilters] = useState(false);
  const [docProjectId, setDocProjectId] = useState(null);
  const [projectDocs, setProjectDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [sortBy, setSortBy] = useState('project_id');
  const [sortDir, setSortDir] = useState('desc');
  const projKey = (p) => String(p.id ?? p.project_id ?? p.project_code ?? '');
  const [boardOrder, setBoardOrder] = useState({});
  const [dragOverCol, setDragOverCol] = useState(null);
  const [draggingKey, setDraggingKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [dragInsertPos, setDragInsertPos] = useState(null); // 'before' | 'after' | null
  const [justDroppedKey, setJustDroppedKey] = useState(null);

  const toggleSort = (field) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  };

  // Initialize/normalize board order when projects change in board view
  useEffect(() => {
    if (activeTab !== 'board') return;
    const next = {};
    for (const col of BOARD_COLUMNS) next[col.id] = [];
    for (const p of projects) {
      const status = String(p.status || 'NEW');
      const colId = BOARD_COLUMNS.find((c) => c.id.toLowerCase() === status.toLowerCase())?.id || 'NEW';
      next[colId].push(projKey(p));
    }
    setBoardOrder((prev) => {
      // Keep any existing order when possible, append new items, drop missing
      const merged = {};
      for (const col of BOARD_COLUMNS) {
        const prevArr = Array.isArray(prev[col.id]) ? prev[col.id] : [];
        const present = new Set(next[col.id]);
        const kept = prevArr.filter((k) => present.has(k));
        const appended = next[col.id].filter((k) => !kept.includes(k));
        merged[col.id] = [...kept, ...appended];
      }
      return merged;
    });
  }, [projects, activeTab]);

  const findProjectByKey = (key) => projects.find((p) => projKey(p) === key);

  // (removed) onDragEnd handler from external DnD library; replaced with native HTML5 DnD handlers

  // Derived quick stats
  const stats = useMemo(() => {
    const total = projects.length;
    const inProgress = projects.filter(p => String(p.status || '').toLowerCase().includes('progress')).length;
    const completed = projects.filter(p => String(p.status || '').toLowerCase().includes('complete')).length;
    const budgetTotal = projects.reduce((s, p) => s + (Number(p.budget) || 0), 0);
    return { total, inProgress, completed, budgetTotal };
  }, [projects]);

  useEffect(() => {
    fetchProjects();
     
  }, []);

  useEffect(() => {
    // default the documentation panel to the first project when projects load
    if (!docProjectId && projects && projects.length > 0) setDocProjectId(projects[0].id ?? projects[0].project_id ?? null);
  }, [projects, docProjectId]);

  const fetchProjectDocs = async (projectId) => {
    if (!projectId) return setProjectDocs([]);
    setDocsLoading(true);
    try {
      const res = await fetchJSON(`/api/project-docs?project_id=${projectId}`);
      if (res?.success) setProjectDocs(res.data || []);
      else setProjectDocs([]);
    } catch (e) {
      console.error('Failed to load project docs', e);
      setProjectDocs([]);
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => {
    if (docProjectId) fetchProjectDocs(docProjectId);
    else setProjectDocs([]);
  }, [docProjectId]);

  useEffect(() => {
    // Sync active tab from URL param; default to 'list' when absent
    setActiveTab(viewParam || 'list');
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
      const result = await fetchJSON('/api/projects');
      if (result.success) setProjects(result.data);
      else console.error('Error fetching projects:', result.error);
    } catch (error) {
          console.error('Error fetching projects:', error.message);
    } finally {
      setLoading(false);
    }
  };



  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this project?')) return;
    try {
      const result = await fetchJSON(`/api/projects?id=${id}`, { method: 'DELETE' });
      if (result.success) fetchProjects();
      else alert('Error deleting project: ' + result.error);
    } catch (error) {
      console.error('Error deleting project:', error);
      alert('Error deleting project: ' + error.message);
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
    <div className="relative h-screen flex flex-col overflow-hidden bg-gray-50">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8">
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">Projects</h1>
                  <p className="text-sm text-gray-600">Manage and track your client projects</p>
                </div>

              </div>
              {/* Quick Stats */}
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <div className="bg-white border border-purple-200 rounded-lg p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Total Projects</p>
                        <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
                      </div>
                      <div className="bg-purple-50 p-3 rounded-lg">
                        <FolderIcon className="h-6 w-6 text-[#64126D]" />
                      </div>
                    </div>
                </div>
                <div className="bg-white border border-blue-200 rounded-lg p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">In Progress</p>
                        <p className="text-3xl font-bold text-gray-900">{stats.inProgress}</p>
                      </div>
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <CalendarIcon className="h-6 w-6 text-blue-600" />
                      </div>
                    </div>
                </div>
                <div className="bg-white border border-green-200 rounded-lg p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Completed</p>
                        <p className="text-3xl font-bold text-gray-900">{stats.completed}</p>
                      </div>
                      <div className="bg-green-50 p-3 rounded-lg">
                        <CheckIcon className="h-6 w-6 text-green-600" />
                      </div>
                    </div>
                </div>
                <div className="bg-white border border-amber-200 rounded-lg p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Total Budget</p>
                        <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.budgetTotal)}</p>
                      </div>
                      <div className="bg-amber-50 p-3 rounded-lg">
                        <FolderIcon className="h-6 w-6 text-amber-600" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="mb-6">
              <div role="tablist" aria-label="Projects views" className="flex flex-wrap items-center gap-2 p-2 bg-white border border-gray-200 rounded-lg">
                {[
                  { id: 'list', label: `Projects List (${projects.length})` },
                  { id: 'calendar', label: 'Calendar View' },
                  { id: 'board', label: 'Board' },
                  { id: 'planning', label: 'Project Planning', badge: '2 items' },
                  { id: 'documentation', label: 'Documentation', badge: 'Input Docs' },
                  { id: 'meetings', label: 'Meetings & Communications', badge: '2 types' }
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
                        const url = new URL(window.location.href);
                        url.searchParams.set('view', tab.id);
                        window.history.replaceState({}, '', url);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowRight') {
                          const next = arr[(idx + 1) % arr.length];
                          setActiveTab(next.id);
                          const url = new URL(window.location.href);
                          url.searchParams.set('view', next.id);
                          window.history.replaceState({}, '', url);
                        } else if (e.key === 'ArrowLeft') {
                          const prev = arr[(idx - 1 + arr.length) % arr.length];
                          setActiveTab(prev.id);
                          const url = new URL(window.location.href);
                          url.searchParams.set('view', prev.id);
                          window.history.replaceState({}, '', url);
                        }
                      }}
                      className={`py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                        isActive 
                          ? 'bg-[#64126D] text-white' 
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <span>{tab.label}</span>
                      {tab.badge && (
                        <span className="ml-2 px-2 py-0.5 text-[10px] rounded-full font-medium" style={isActive ? {
                          background: 'rgba(255, 255, 255, 0.25)',
                          color: '#ffffff'
                        } : {
                          background: 'rgba(100, 116, 139, 0.1)',
                          color: '#64748b'
                        }}>
                          {tab.badge}
                        </span>
                      )}
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
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-fade-blur delay-200">
                    <div className="flex-1 flex items-center gap-3">
                      <div className="relative w-full max-w-md">
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search by project or client name..."
                          className="w-full pl-11 pr-4 py-2.5 text-sm rounded-lg border border-gray-300 focus:outline-none focus:border-[#64126D] focus:ring-1 focus:ring-[#64126D]"
                        />
                        <svg className="absolute left-4 top-3.5 h-5 w-5 transition-colors duration-300" viewBox="0 0 20 20" fill="currentColor" style={{ color: '#8b5cf6' }}><path fillRule="evenodd" d="M12.9 14.32a8 8 0 111.414-1.414l3.386 3.387a1 1 0 01-1.414 1.414l-3.386-3.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z" clipRule="evenodd"/></svg>
                      </div>
                      <button
                        onClick={() => setShowFilters(v => !v)}
                        className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium border border-gray-300 hover:bg-gray-50 transition-colors text-black"
                      >
                        <FunnelIcon className="h-5 w-5" style={{ color: '#8b5cf6' }} /> <span>Filters</span>
                      </button>
                      {(statusFilter || priorityFilter || query) && (
                        <button
                          onClick={() => { setQuery(''); setStatusFilter(''); setPriorityFilter(''); }}
                          className="text-sm font-semibold px-4 py-2 rounded-xl transition-all duration-300 hover:scale-105"
                          style={{
                            color: '#ef4444',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.2)'
                          }}
                        >Clear All</button>
                      )}
                    </div>
                  </div>

                  {showFilters && (
                    <div className="mt-4 bg-white border border-gray-200 rounded-lg p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                          <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          >
                            <option value="">All Statuses</option>
                            <option value="NEW">NEW</option>
                            <option value="planning">Planning</option>
                            <option value="in-progress">In Progress</option>
                            <option value="on-hold">On Hold</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                          <select
                            value={priorityFilter}
                            onChange={(e) => setPriorityFilter(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          >
                            <option value="">All Priorities</option>
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                          </select>
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={() => setShowFilters(false)}
                            className="w-full inline-flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                          >
                            <CheckIcon className="h-5 w-5" />
                            Apply Filters
                          </button>
                        </div>
                      </div>
                      <div className="mt-5 pt-5 border-t flex flex-wrap items-center gap-3" style={{ borderColor: 'rgba(139, 92, 246, 0.1)' }}>
                        {statusFilter && (
                          <span className="inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl" style={{
                            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.15) 100%)',
                            color: '#7c3aed',
                            border: '1px solid rgba(139, 92, 246, 0.2)',
                            boxShadow: '0 2px 8px rgba(139, 92, 246, 0.1)'
                          }}>Status: {formatLabel(statusFilter)}</span>
                        )}
                        {priorityFilter && (
                          <span className="inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl" style={{
                            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(79, 70, 229, 0.15) 100%)',
                            color: '#4f46e5',
                            border: '1px solid rgba(99, 102, 241, 0.2)',
                            boxShadow: '0 2px 8px rgba(99, 102, 241, 0.1)'
                          }}>Priority: {priorityFilter}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Projects Table */}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    {loading ? (
                      <div className="p-8">
                        <div className="space-y-3">
                          {[...Array(6)].map((_, i) => (
                            <div key={i} className="h-12 bg-gray-100 rounded animate-pulse"></div>
                          ))}
                        </div>
                      </div>
                    ) : projects.length === 0 ? (
                      <div className="p-6 text-center">
                        <FolderIcon className="mx-auto h-10 w-10 text-gray-400" />
                        <h3 className="mt-2 text-sm font-medium text-gray-900">No projects found</h3>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                                <button className="inline-flex items-center gap-1 hover:text-purple-600" onClick={() => toggleSort('project_id')}>
                                  Project No.
                                  <ChevronUpDownIcon className="h-4 w-4" />
                                </button>
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                                <button className="inline-flex items-center gap-1 hover:text-purple-600" onClick={() => toggleSort('name')}>
                                  Project
                                  <ChevronUpDownIcon className="h-4 w-4" />
                                </button>
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                                <button className="inline-flex items-center gap-1 hover:text-purple-600" onClick={() => toggleSort('company_name')}>
                                  Client
                                  <ChevronUpDownIcon className="h-4 w-4" />
                                </button>
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                                <button className="inline-flex items-center gap-1 hover:text-purple-600" onClick={() => toggleSort('start_date')}>
                                  Timeline
                                  <ChevronUpDownIcon className="h-4 w-4" />
                                </button>
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Status</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Estimated Cost</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                                <button className="inline-flex items-center gap-1 hover:text-purple-600" onClick={() => toggleSort('budget')}>
                                  Budget
                                  <ChevronUpDownIcon className="h-4 w-4" />
                                </button>
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Progress</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {projects
                              .filter((p) => {
                                if (query && !(`${p.name || ''} ${p.company_name || ''}`.toLowerCase().includes(query.toLowerCase()))) return false;
                                if (statusFilter && String((p.status || '')).toLowerCase() !== statusFilter.toLowerCase()) return false;
                                if (priorityFilter && String((p.priority || '')).toLowerCase() !== priorityFilter.toLowerCase()) return false;
                                return true;
                              })
                              .sort((a, b) => {
                                const getVal = (p, field) => {
                                  switch (field) {
                                    case 'project_id': return String(p.project_id || p.id || '');
                                    case 'name': return String(p.name || '');
                                    case 'company_name': return String(p.company_name || '');
                                    case 'start_date': return toDateKey(p.start_date) || toDateKey(p.target_date) || '';
                                    case 'budget': return Number(p.budget) || 0;
                                    default: return '';
                                  }
                                };
                                const va = getVal(a, sortBy);
                                const vb = getVal(b, sortBy);
                                let cmp;
                                if (typeof va === 'number' || typeof vb === 'number') cmp = (va - vb);
                                else cmp = String(va).localeCompare(String(vb));
                                return sortDir === 'asc' ? cmp : -cmp;
                              })
                              .map((project, _idx) => (
                              <tr key={`${project.id ?? project.project_id ?? project.project_code ?? _idx}`} 
                                  className="hover:bg-gray-50 transition-colors"
                              >
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="text-sm font-mono text-gray-900">
                                    {project.project_id || '-'}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <div>
                                    <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold bg-purple-100 text-purple-700">
                                        {(project.name || '?').slice(0,1).toUpperCase()}
                                      </span>
                                      {project.name}
                                    </div>
                                    <div className="text-xs text-gray-600 mt-1 max-w-xs truncate">{project.description}</div>
                                    <div className={`text-xs font-medium mt-1 ${getPriorityColor(project.priority)}`}>
                                      {formatLabel(project.priority || 'Unassigned')} Priority
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="text-sm font-medium text-gray-900">{project.company_name || '-'}</div>
                                  <div className="text-xs text-gray-600 mt-1">PM: {project.project_manager || 'Not assigned'}</div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="text-sm text-gray-900">
                                    <div className="flex items-center gap-1.5">
                                      <CalendarIcon className="h-4 w-4 text-gray-400" />
                                      {formatDate(project.start_date)}
                                    </div>
                                    {project.end_date && (
                                      <div className="text-xs text-gray-600 mt-1">to {formatDate(project.end_date)}</div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-5 py-4 whitespace-nowrap">
                                  <span className={`px-3.5 py-1.5 inline-flex text-[11px] leading-4 font-bold rounded-xl shadow-sm uppercase tracking-wide ${getStatusColor(project.status)}`} style={{
                                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)'
                                  }}>
                                    {formatLabel(project.status)}
                                  </span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {(() => {
                                    try {
                                      if (project.cost_breakup) {
                                        const cb = typeof project.cost_breakup === 'string' ? JSON.parse(project.cost_breakup) : project.cost_breakup;
                                        const tot = cb.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);
                                        return tot > 0 ? formatCurrency(tot) : '-';
                                      }
                                    } catch {}
                                    return '-';
                                  })()}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {formatCurrency(project.budget)}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                      <div className="h-full bg-purple-600 rounded-full transition-all" style={{ width: `${project.progress || 0}%` }} />
                                    </div>
                                    <span className="text-xs font-medium text-gray-600 min-w-[35px]">{project.progress || 0}%</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => router.push(`/projects/${project.project_id ?? project.id ?? project.project_code ?? ''}`)}
                                      className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                      title="View Details"
                                    >
                                      <EyeIcon className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => router.push(`/projects/${project.project_id ?? project.id ?? project.project_code ?? ''}/edit`)}
                                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                      title="Edit Project"
                                    >
                                      <PencilIcon className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => handleDelete(project.project_id ?? project.id ?? project.project_code)}
                                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                      title="Delete Project"
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
                  </div>
                </div>
              )}

              {activeTab === 'calendar' && (
                <div className="space-y-4">
                  <div className="glass-panel rounded-lg p-4">
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

                  <div className="glass-panel rounded-lg overflow-hidden">
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
                                <div key={`${project.id ?? project.project_id ?? project.project_code ?? project.name ?? 'unknown'}`} className="border border-accent-primary/40 bg-accent-primary/10 rounded-md px-2 py-1">
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

              {/* Project Planning Tab */}
              {activeTab === 'planning' && (
                <div className="space-y-4">
                  <div className="glass-panel rounded-lg p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                          <CalendarIcon className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-bold text-black">Project Planning</h3>
                          <p className="text-sm text-gray-600 mt-1">Schedule, deliverables, and project roadmap</p>
                        </div>
                      </div>
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                        2 items
                      </span>
                    </div>
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <label className="text-xs text-gray-500">Project</label>
                        <select
                          value={docProjectId ?? ''}
                          onChange={(e) => setDocProjectId(e.target.value)}
                          className="px-3 py-1 text-sm border border-gray-200 rounded-md"
                        >
                          {projects.map((p) => (
                            <option key={p.id ?? p.project_id ?? p.project_code} value={p.id ?? p.project_id ?? ''}>
                              {p.name || p.project_id || `Project ${p.id ?? p.project_id ?? ''}`}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        {docsLoading ? (
                          <div className="text-sm text-gray-500">Loading documents…</div>
                        ) : projectDocs && projectDocs.length > 0 ? (
                          <ul className="space-y-2">
                            {projectDocs.map((d) => (
                              <li key={d.id} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-md px-3 py-2">
                                <div>
                                  <div className="text-sm font-medium text-gray-900">{d.name || d.master_name || 'Document'}</div>
                                  <div className="text-xs text-gray-500">{d.description || d.doc_key || d.file_url}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {d.file_url && (
                                    <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs text-purple-600 hover:underline">Open</a>
                                  )}
                                  <button onClick={() => router.push(`/projects/${d.project_id || docProjectId}`)} className="text-xs text-gray-600">View Project</button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-sm text-gray-500">No documents for this project.</div>
                        )}
                      </div>

                      <div className="md:ml-4">
                        <button onClick={() => router.push(`/projects/${docProjectId}`)} className="text-sm text-purple-600 hover:text-purple-700 font-medium flex items-center gap-2">
                          View Details
                          <ArrowRightIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Documentation Tab */}
              {activeTab === 'documentation' && (
                <div className="space-y-4">
                  <div className="glass-panel rounded-lg p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                          <FolderIcon className="h-5 w-5 text-purple-600" />
                        </div>
                        <div>
                          <h3 className="font-bold text-black">Documentation</h3>
                          <p className="text-sm text-gray-600 mt-1">Input documents, references, and file management</p>
                        </div>
                      </div>
                      <span className="px-3 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                        Input Docs
                      </span>
                    </div>
                    <button className="text-sm text-purple-600 hover:text-purple-700 font-medium flex items-center gap-2">
                      View Details
                      <ArrowRightIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Meetings & Communications Tab */}
              {activeTab === 'meetings' && (
                <div className="space-y-4">
                  <div className="glass-panel rounded-lg p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                          <CalendarIcon className="h-5 w-5 text-green-600" />
                        </div>
                        <div>
                          <h3 className="font-bold text-black">Meetings & Communications</h3>
                          <p className="text-sm text-gray-600 mt-1">Kickoff meetings, internal discussions, and follow-ups</p>
                        </div>
                      </div>
                      <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                        2 types
                      </span>
                    </div>
                    <button className="text-sm text-purple-600 hover:text-purple-700 font-medium flex items-center gap-2">
                      View Details
                      <ArrowRightIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Board (drag-and-drop) */}
              {activeTab === 'board' && (
                <div className="space-y-4">
                  <div className="glass-panel rounded-lg p-4 sm:p-6 hover:shadow-lg transition-shadow">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-black">Board View</h3>
                        <p className="text-sm text-gray-600 mt-1">Drag projects across columns to update status.</p>
                      </div>
                      <span className="px-3 py-1 bg-purple-50 text-[#64126D] text-xs font-medium rounded-full">Interactive</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
                      {BOARD_COLUMNS.map((col) => (
                        <div
                          key={col.id}
                          onDragOver={(e) => e.preventDefault()}
                          onDragEnter={() => setDragOverCol(col.id)}
                          onDragLeave={(e) => {
                            // If leaving the column area, clear highlight
                            if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCol((cur) => (cur === col.id ? null : cur));
                          }}
                          onTouchMove={() => {
                            // Basic mobile: mark current column while moving
                            setDragOverCol(col.id);
                          }}
                          onTouchEnd={() => {
                            // Drop into column on touch end (append)
                            const key = draggingKey;
                            if (!key) return;
                            const srcCol = BOARD_COLUMNS.find((c) => (boardOrder[c.id] || []).includes(key))?.id;
                            const dstCol = col.id;
                            if (!srcCol) return;
                            setDragOverCol(null);
                            setDraggingKey(null);
                            setDragOverKey(null);
                            setDragInsertPos(null);
                            setJustDroppedKey(key);
                            setTimeout(() => setJustDroppedKey(null), 300);
                            setBoardOrder((prev) => {
                              const next = { ...prev };
                              const srcArr = Array.isArray(next[srcCol]) ? next[srcCol].filter((k) => k !== key) : [];
                              const dstArr = Array.isArray(next[dstCol]) ? [...next[dstCol], key] : [key];
                              next[srcCol] = srcArr;
                              next[dstCol] = dstArr;
                              return next;
                            });
                            if (srcCol !== dstCol) {
                              const p = findProjectByKey(key);
                              if (p) {
                                const prevStatus = p.status;
                                const newStatus = dstCol;
                                setProjects((prev) => prev.map((it) => it === p ? { ...it, status: newStatus } : it));
                                fetchJSON(`/api/projects/${p.id ?? p.project_id ?? p.project_code}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: newStatus })
                                }).catch((err) => {
                                  console.error('Failed to persist status change', err);
                                  setProjects((prev) => prev.map((it) => it === p ? { ...it, status: prevStatus } : it));
                                  alert('Failed to update status on server. Please retry.');
                                });
                              }
                            }
                          }}
                          onDrop={(e) => {
                            const key = e.dataTransfer.getData('text/plain');
                            if (!key) return;
                            const srcCol = BOARD_COLUMNS.find((c) => (boardOrder[c.id] || []).includes(key))?.id;
                            const dstCol = col.id;
                            if (!srcCol) return;
                            setDragOverCol(null);
                            setDraggingKey(null);
                            const targetKey = dragOverKey;
                            const insertPos = dragInsertPos;
                            setDragOverKey(null);
                            setDragInsertPos(null);
                            setJustDroppedKey(key);
                            setTimeout(() => setJustDroppedKey(null), 300);
                            setBoardOrder((prev) => {
                              const next = { ...prev };
                              const srcArr = Array.isArray(next[srcCol]) ? next[srcCol].filter((k) => k !== key) : [];
                              let dstArr = Array.isArray(next[dstCol]) ? [...next[dstCol]] : [];
                              if (srcCol === dstCol && targetKey && dstArr.includes(targetKey) && key) {
                                // move within same column relative to hovered card
                                const idx = dstArr.indexOf(targetKey);
                                const insertIndex = Math.max(0, Math.min(dstArr.length, idx + (insertPos === 'after' ? 1 : 0)));
                                dstArr = dstArr.filter((k) => k !== key);
                                dstArr.splice(insertIndex, 0, key);
                              } else if (key) {
                                // cross-column or no specific target — append
                                dstArr = dstArr.filter((k) => k !== key);
                                dstArr.push(key);
                              }
                              next[srcCol] = srcArr;
                              next[dstCol] = dstArr;
                              return next;
                            });
                            if (srcCol !== dstCol) {
                              const p = findProjectByKey(key);
                              if (p) {
                                const prevStatus = p.status;
                                const newStatus = dstCol;
                                setProjects((prev) => prev.map((it) => it === p ? { ...it, status: newStatus } : it));
                                fetchJSON(`/api/projects/${p.id ?? p.project_id ?? p.project_code}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: newStatus })
                                }).catch((err) => {
                                  console.error('Failed to persist status change', err);
                                  setProjects((prev) => prev.map((it) => it === p ? { ...it, status: prevStatus } : it));
                                  alert('Failed to update status on server. Please retry.');
                                });
                              }
                            }
                          }}
                          className={`rounded-xl p-3 transition-colors glass-soft ${dragOverCol === col.id ? 'ring-1 ring-purple-300 bg-white/70' : ''}`}
                        >
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-black">{col.label}</h4>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-gray-700 border border-gray-200">{(boardOrder[col.id] || []).length}</span>
                          </div>
                          <div className="mt-3 space-y-2 min-h-[120px]">
                            {(boardOrder[col.id] || []).map((key) => {
                              const project = findProjectByKey(key);
                              if (!project) return null;
                              return (
                                <div
                                  key={key}
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData('text/plain', key);
                                    e.dataTransfer.effectAllowed = 'move';
                                    setDraggingKey(key);
                                  }}
                                  onDragEnd={() => {
                                    setDraggingKey(null);
                                    setDragOverKey(null);
                                    setDragInsertPos(null);
                                  }}
                                  onDragOver={(e) => {
                                    // Allow drop and calculate relative position
                                    e.preventDefault();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const offsetY = e.clientY - rect.top;
                                    const before = offsetY < rect.height / 2;
                                    setDragOverKey(key);
                                    setDragInsertPos(before ? 'before' : 'after');
                                  }}
                                  className={`bg-white/85 backdrop-blur rounded-md border border-white/70 px-3 py-2 shadow-sm transition-all duration-200 ease-out cursor-grab active:cursor-grabbing hover:scale-[1.02] hover:shadow-md ${draggingKey === key ? 'scale-[1.05] rotate-2 shadow-xl ring-2 ring-[#64126D] cursor-grabbing' : ''} ${dragOverKey === key ? 'ring-1 ring-purple-300' : ''} ${justDroppedKey === key ? 'animate-bounce-gentle' : ''}`}
                                >
                                  {dragOverKey === key && dragInsertPos === 'before' && (
                                    <div className="-mt-2 mb-2 h-1 bg-purple-200 rounded animate-pulse" />
                                  )}
                                  <div className="flex items-center justify-between">
                                    <div className="text-sm font-semibold text-black truncate" title={project.name}>{project.name || project.project_id}</div>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${getStatusColor(project.status)}`}>{formatLabel(project.status)}</span>
                                  </div>
                                  <div className="mt-1 text-[11px] text-gray-600 truncate" title={project.company_name}>{project.company_name || '—'}</div>
                                  <div className="mt-1 flex items-center justify-between">
                                    <span className="text-[11px] text-gray-600">Budget: {formatCurrency(project.budget || 0)}</span>
                                    <span className="text-[11px] text-gray-600">{project.progress || 0}%</span>
                                  </div>
                                  {dragOverKey === key && dragInsertPos === 'after' && (
                                    <div className="mt-2 -mb-2 h-1 bg-purple-200 rounded animate-pulse" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
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