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
    <div className="relative h-screen flex flex-col overflow-hidden" style={{
      background: '#ffffff'
    }}>
      {/* God-level animated background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
        {/* Mega gradient orbs with layered depth */}
        <div className="absolute -top-[20%] -right-[15%] h-[900px] w-[900px] rounded-full"
             style={{
               background: 'radial-gradient(circle at 35% 35%, rgba(167,139,250,0.18) 0%, rgba(147,107,232,0.12) 20%, rgba(139,92,246,0.08) 35%, rgba(124,58,237,0.04) 55%, transparent 75%)',
               filter: 'blur(100px)',
               animation: 'orbit-smooth 35s ease-in-out infinite',
               mixBlendMode: 'multiply',
               willChange: 'transform'
             }} />
        <div className="absolute -bottom-[20%] -left-[15%] h-[1000px] w-[1000px] rounded-full"
             style={{
               background: 'radial-gradient(circle at 65% 65%, rgba(236,72,153,0.14) 0%, rgba(219,39,119,0.09) 25%, rgba(219,39,119,0.06) 40%, rgba(190,24,93,0.03) 60%, transparent 75%)',
               filter: 'blur(110px)',
               animation: 'orbit-smooth 40s ease-in-out infinite reverse',
               animationDelay: '8s',
               mixBlendMode: 'multiply',
               willChange: 'transform'
             }} />
        <div className="absolute top-[25%] right-[20%] h-[600px] w-[600px] rounded-full"
             style={{
               background: 'radial-gradient(circle, rgba(99,102,241,0.10) 0%, rgba(79,70,229,0.06) 30%, rgba(67,56,202,0.03) 50%, transparent 70%)',
               filter: 'blur(85px)',
               animation: 'breathe 22s ease-in-out infinite',
               mixBlendMode: 'multiply',
               willChange: 'transform'
             }} />
        <div className="absolute bottom-[30%] left-[25%] h-[550px] w-[550px] rounded-full"
             style={{
               background: 'radial-gradient(circle, rgba(168,85,247,0.08) 0%, rgba(147,51,234,0.05) 35%, transparent 65%)',
               filter: 'blur(90px)',
               animation: 'breathe 28s ease-in-out infinite',
               animationDelay: '5s',
               mixBlendMode: 'multiply',
               willChange: 'transform'
             }} />
        {/* Particle-like dots with parallax */}
        <div className="absolute inset-0 opacity-[0.025]"
             style={{
               backgroundImage: 'radial-gradient(circle, rgba(100,18,109,0.9) 0.5px, transparent 0.5px)',
               backgroundSize: '32px 32px',
               animation: 'drift 60s linear infinite',
               willChange: 'transform'
             }} />
        <div className="absolute inset-0 opacity-[0.018]"
             style={{
               backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.8) 1px, transparent 1px)',
               backgroundSize: '48px 48px',
               animation: 'drift-reverse 80s linear infinite',
               willChange: 'transform'
             }} />
        {/* Shimmer overlay */}
        <div className="absolute inset-0 opacity-[0.02]"
             style={{
               background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
               backgroundSize: '200% 100%',
               animation: 'shimmer-sweep 15s ease-in-out infinite'
             }} />
        {/* Enhanced noise texture */}
        <div className="absolute inset-0 opacity-[0.02]"
             style={{
               backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 400 400\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'1.2\' numOctaves=\'5\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")',
               mixBlendMode: 'soft-light'
             }} />
      </div>
      <Navbar />
      <style jsx>{`
        @keyframes orbit-smooth {
          0%, 100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
          25% { transform: translate(60px, -70px) scale(1.08) rotate(8deg); opacity: 0.92; }
          50% { transform: translate(90px, -40px) scale(1.12) rotate(12deg); opacity: 0.88; }
          75% { transform: translate(40px, 50px) scale(0.96) rotate(-6deg); opacity: 0.9; }
        }
        @keyframes drift {
          0% { transform: translate(0, 0); }
          100% { transform: translate(32px, 32px); }
        }
        @keyframes drift-reverse {
          0% { transform: translate(0, 0); }
          100% { transform: translate(-48px, -48px); }
        }
        @keyframes breathe {
          0%, 100% { transform: scale(1) translateY(0); opacity: 0.8; }
          50% { transform: scale(1.15) translateY(-20px); opacity: 1; }
        }
        @keyframes shimmer-sweep {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes slideInUp {
          0% { opacity: 0; transform: translateY(40px) scale(0.96); }
          60% { transform: translateY(-4px) scale(1.01); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes slideInRight {
          0% { opacity: 0; transform: translateX(-40px) scale(0.95); }
          60% { transform: translateX(4px) scale(1.02); }
          100% { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes scaleIn {
          0% { opacity: 0; transform: scale(0.85) rotateY(-10deg); }
          60% { transform: scale(1.03) rotateY(2deg); }
          100% { opacity: 1; transform: scale(1) rotateY(0); }
        }
        @keyframes fadeInBlur {
          0% { opacity: 0; filter: blur(10px); transform: translateY(20px); }
          100% { opacity: 1; filter: blur(0); transform: translateY(0); }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(139, 92, 246, 0.2), 0 0 40px rgba(139, 92, 246, 0.1); }
          50% { box-shadow: 0 0 30px rgba(139, 92, 246, 0.4), 0 0 60px rgba(139, 92, 246, 0.2); }
        }
        .animate-slide-in-up { animation: slideInUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-slide-in-right { animation: slideInRight 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-scale-in { animation: scaleIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-fade-blur { animation: fadeInBlur 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .delay-75 { animation-delay: 0.075s; }
        .delay-100 { animation-delay: 0.1s; }
        .delay-150 { animation-delay: 0.15s; }
        .delay-200 { animation-delay: 0.2s; }
        .delay-250 { animation-delay: 0.25s; }
        .delay-300 { animation-delay: 0.3s; }
        .delay-400 { animation-delay: 0.4s; }
        .delay-500 { animation-delay: 0.5s; }
      `}</style>
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8">
            {/* Header */}
            <div className="mb-8 animate-slide-in-right" style={{ position: 'relative', zIndex: 1 }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-1 w-12 rounded-full" style={{
                      background: 'linear-gradient(90deg, #8b5cf6, #ec4899)',
                      boxShadow: '0 2px 8px rgba(139, 92, 246, 0.3)'
                    }} />
                    <h1 className="text-4xl font-black tracking-tight" style={{
                      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 35%, #d946ef 70%, #ec4899 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                      letterSpacing: '-0.03em',
                      textShadow: '0 0 40px rgba(139, 92, 246, 0.1)'
                    }}>
                      Projects
                    </h1>
                  </div>
                  <p className="text-sm font-medium ml-15" style={{ color: '#64748b', letterSpacing: '0.01em' }}>Manage and track your client projects with precision</p>
                </div>

              </div>
              {/* Quick Stats */}
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <div className="rounded-2xl transition-all duration-400 cursor-pointer group relative overflow-hidden animate-scale-in"
                     style={{
                       background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)',
                       border: '1.5px solid rgba(139, 92, 246, 0.12)',
                       boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06)',
                       opacity: 0
                     }}
                     onMouseEnter={(e) => {
                       e.currentTarget.style.transform = 'translateY(-6px)';
                       e.currentTarget.style.boxShadow = '0 16px 32px rgba(15, 23, 42, 0.1), 0 8px 16px rgba(139, 92, 246, 0.15)';
                       e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                     }}
                     onMouseLeave={(e) => {
                       e.currentTarget.style.transform = 'translateY(0)';
                       e.currentTarget.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06)';
                       e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.12)';
                     }}>
                  <div className="p-6 relative">
                    <div className="absolute top-0 left-0 w-1.5 h-16 rounded-r-full transition-all duration-300 group-hover:h-20" style={{
                      background: 'linear-gradient(180deg, #8b5cf6 0%, #7c3aed 100%)',
                      boxShadow: '0 0 12px rgba(139, 92, 246, 0.3)'
                    }} />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{
                      background: 'radial-gradient(circle at top right, rgba(139, 92, 246, 0.03), transparent 70%)'
                    }} />
                    <div className="flex items-start justify-between gap-4 relative">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2.5">
                          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>Total Projects</div>
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{
                            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(124, 58, 237, 0.08))',
                            border: '1px solid rgba(139, 92, 246, 0.15)'
                          }}>
                            <svg className="w-3 h-3" style={{ color: '#8b5cf6' }} fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-[10px] font-bold" style={{ color: '#8b5cf6' }}>12%</span>
                          </div>
                        </div>
                        <div className="text-4xl font-bold transition-all duration-300 group-hover:scale-105" style={{ 
                          color: '#0f172a',
                          letterSpacing: '-0.02em'
                        }}>{stats.total}</div>
                        <div className="mt-3 flex items-center gap-2">
                          <div className="text-xs font-medium" style={{ color: '#94a3b8' }}>Active portfolio</div>
                          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.2), transparent)' }} />
                        </div>
                      </div>
                      <div className="p-3.5 rounded-xl transition-all duration-300 group-hover:scale-110 group-hover:rotate-3" style={{
                        background: 'linear-gradient(135deg, #f8f7ff 0%, #f3f1ff 100%)',
                        border: '1px solid rgba(139, 92, 246, 0.15)',
                        boxShadow: '0 4px 12px rgba(139, 92, 246, 0.1)'
                      }}>
                        <FolderIcon className="h-6 w-6" style={{ color: '#8b5cf6' }} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl transition-all duration-400 cursor-pointer group relative overflow-hidden animate-scale-in delay-100"
                     style={{
                       background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)',
                       border: '1.5px solid rgba(59, 130, 246, 0.12)',
                       boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06)',
                       opacity: 0
                     }}
                     onMouseEnter={(e) => {
                       e.currentTarget.style.transform = 'translateY(-6px)';
                       e.currentTarget.style.boxShadow = '0 16px 32px rgba(15, 23, 42, 0.1), 0 8px 16px rgba(59, 130, 246, 0.15)';
                       e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                     }}
                     onMouseLeave={(e) => {
                       e.currentTarget.style.transform = 'translateY(0)';
                       e.currentTarget.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06)';
                       e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.12)';
                     }}>
                  <div className="p-6 relative">
                    <div className="absolute top-0 left-0 w-1.5 h-16 rounded-r-full transition-all duration-300 group-hover:h-20" style={{
                      background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
                      boxShadow: '0 0 12px rgba(59, 130, 246, 0.3)'
                    }} />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{
                      background: 'radial-gradient(circle at top right, rgba(59, 130, 246, 0.03), transparent 70%)'
                    }} />
                    <div className="flex items-start justify-between gap-4 relative">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2.5">
                          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>In Progress</div>
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full animate-pulse" style={{
                            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(37, 99, 235, 0.08))',
                            border: '1px solid rgba(59, 130, 246, 0.2)'
                          }}>
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#3b82f6' }} />
                            <span className="text-[10px] font-bold" style={{ color: '#3b82f6' }}>Active</span>
                          </div>
                        </div>
                        <div className="text-4xl font-bold transition-all duration-300 group-hover:scale-105" style={{ 
                          color: '#0f172a',
                          letterSpacing: '-0.02em'
                        }}>{stats.inProgress}</div>
                        <div className="mt-3 flex items-center gap-2">
                          <div className="text-xs font-medium" style={{ color: '#94a3b8' }}>Currently active</div>
                          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.2), transparent)' }} />
                        </div>
                      </div>
                      <div className="p-3.5 rounded-xl transition-all duration-300 group-hover:scale-110 group-hover:rotate-3" style={{
                        background: 'linear-gradient(135deg, #f0f7ff 0%, #e6f2ff 100%)',
                        border: '1px solid rgba(59, 130, 246, 0.15)',
                        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.1)'
                      }}>
                        <CalendarIcon className="h-6 w-6" style={{ color: '#3b82f6' }} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl transition-all duration-400 cursor-pointer group relative overflow-hidden animate-scale-in delay-200"
                     style={{
                       background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)',
                       border: '1.5px solid rgba(34, 197, 94, 0.12)',
                       boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06)',
                       opacity: 0
                     }}
                     onMouseEnter={(e) => {
                       e.currentTarget.style.transform = 'translateY(-6px)';
                       e.currentTarget.style.boxShadow = '0 16px 32px rgba(15, 23, 42, 0.1), 0 8px 16px rgba(34, 197, 94, 0.15)';
                       e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.3)';
                     }}
                     onMouseLeave={(e) => {
                       e.currentTarget.style.transform = 'translateY(0)';
                       e.currentTarget.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06)';
                       e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.12)';
                     }}>
                  <div className="p-6 relative">
                    <div className="absolute top-0 left-0 w-1.5 h-16 rounded-r-full transition-all duration-300 group-hover:h-20" style={{
                      background: 'linear-gradient(180deg, #22c55e 0%, #16a34a 100%)',
                      boxShadow: '0 0 12px rgba(34, 197, 94, 0.3)'
                    }} />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{
                      background: 'radial-gradient(circle at top right, rgba(34, 197, 94, 0.03), transparent 70%)'
                    }} />
                    <div className="flex items-start justify-between gap-4 relative">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2.5">
                          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>Completed</div>
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{
                            background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(22, 163, 74, 0.08))',
                            border: '1px solid rgba(34, 197, 94, 0.15)'
                          }}>
                            <svg className="w-3 h-3" style={{ color: '#22c55e' }} fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-[10px] font-bold" style={{ color: '#22c55e' }}>100%</span>
                          </div>
                        </div>
                        <div className="text-4xl font-bold transition-all duration-300 group-hover:scale-105" style={{ 
                          color: '#0f172a',
                          letterSpacing: '-0.02em'
                        }}>{stats.completed}</div>
                        <div className="mt-3 flex items-center gap-2">
                          <div className="text-xs font-medium" style={{ color: '#94a3b8' }}>Successfully delivered</div>
                          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(34, 197, 94, 0.2), transparent)' }} />
                        </div>
                      </div>
                      <div className="p-3.5 rounded-xl transition-all duration-300 group-hover:scale-110 group-hover:rotate-3" style={{
                        background: 'linear-gradient(135deg, #f0fdf6 0%, #e6f9ed 100%)',
                        border: '1px solid rgba(34, 197, 94, 0.15)',
                        boxShadow: '0 4px 12px rgba(34, 197, 94, 0.1)'
                      }}>
                        <CheckIcon className="h-6 w-6" style={{ color: '#22c55e' }} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl transition-all duration-400 cursor-pointer group relative overflow-hidden animate-scale-in delay-300"
                     style={{
                       background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)',
                       border: '1.5px solid rgba(245, 158, 11, 0.12)',
                       boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06)',
                       opacity: 0
                     }}
                     onMouseEnter={(e) => {
                       e.currentTarget.style.transform = 'translateY(-6px)';
                       e.currentTarget.style.boxShadow = '0 16px 32px rgba(15, 23, 42, 0.1), 0 8px 16px rgba(245, 158, 11, 0.15)';
                       e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                     }}
                     onMouseLeave={(e) => {
                       e.currentTarget.style.transform = 'translateY(0)';
                       e.currentTarget.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06)';
                       e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.12)';
                     }}>
                  <div className="p-6 relative">
                    <div className="absolute top-0 left-0 w-1.5 h-16 rounded-r-full transition-all duration-300 group-hover:h-20" style={{
                      background: 'linear-gradient(180deg, #f59e0b 0%, #d97706 100%)',
                      boxShadow: '0 0 12px rgba(245, 158, 11, 0.3)'
                    }} />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{
                      background: 'radial-gradient(circle at top right, rgba(245, 158, 11, 0.03), transparent 70%)'
                    }} />
                    <div className="flex items-start justify-between gap-4 relative">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2.5">
                          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>Total Budget</div>
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{
                            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(217, 119, 6, 0.08))',
                            border: '1px solid rgba(245, 158, 11, 0.15)'
                          }}>
                            <span className="text-[10px] font-bold" style={{ color: '#f59e0b' }}>INR</span>
                          </div>
                        </div>
                        <div className="text-2xl font-bold transition-all duration-300 group-hover:scale-105" style={{ 
                          color: '#0f172a',
                          letterSpacing: '-0.01em'
                        }}>{formatCurrency(stats.budgetTotal)}</div>
                        <div className="mt-3 flex items-center gap-2">
                          <div className="text-xs font-medium" style={{ color: '#94a3b8' }}>Allocated funds</div>
                          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.2), transparent)' }} />
                        </div>
                      </div>
                      <div className="p-3.5 rounded-xl transition-all duration-300 group-hover:scale-110 group-hover:rotate-3" style={{
                        background: 'linear-gradient(135deg, #fffbf0 0%, #fff8e6 100%)',
                        border: '1px solid rgba(245, 158, 11, 0.15)',
                        boxShadow: '0 4px 12px rgba(245, 158, 11, 0.1)'
                      }}>
                        <FolderIcon className="h-6 w-6" style={{ color: '#f59e0b' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs (accessible) */}
            <div className="mb-6 animate-slide-in-up delay-400">
              <div role="tablist" aria-label="Projects views" className="flex flex-wrap items-center gap-2 p-1.5 rounded-2xl" style={{
                background: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)'
              }}>
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
                      className="py-2.5 px-4 rounded-xl text-xs font-semibold focus:outline-none transition-all duration-300 transform hover:scale-105"
                      style={isActive ? {
                        background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                        color: '#ffffff',
                        boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                        transform: 'translateY(-1px)'
                      } : {
                        background: 'transparent',
                        color: '#475569',
                        border: 'none'
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.8)';
                          e.currentTarget.style.color = '#1e293b';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = '#475569';
                        }
                      }}
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
                      <div className="relative w-full max-w-md group">
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search by project or client name..."
                          className="w-full pl-11 pr-4 py-3 text-sm rounded-2xl transition-all duration-300 focus:outline-none"
                          style={{
                            background: 'rgba(255, 255, 255, 0.9)',
                            backdropFilter: 'blur(16px)',
                            border: '1.5px solid rgba(139, 92, 246, 0.15)',
                            boxShadow: '0 4px 16px rgba(139, 92, 246, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
                            color: '#1e293b'
                          }}
                          onFocus={(e) => {
                            e.target.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                            e.target.style.boxShadow = '0 8px 24px rgba(139, 92, 246, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.9)';
                          }}
                          onBlur={(e) => {
                            e.target.style.borderColor = 'rgba(139, 92, 246, 0.15)';
                            e.target.style.boxShadow = '0 4px 16px rgba(139, 92, 246, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)';
                          }}
                        />
                        <svg className="absolute left-4 top-3.5 h-5 w-5 transition-colors duration-300" viewBox="0 0 20 20" fill="currentColor" style={{ color: '#8b5cf6' }}><path fillRule="evenodd" d="M12.9 14.32a8 8 0 111.414-1.414l3.386 3.387a1 1 0 01-1.414 1.414l-3.386-3.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z" clipRule="evenodd"/></svg>
                      </div>
                      <button
                        onClick={() => setShowFilters(v => !v)}
                        className="inline-flex items-center gap-2.5 rounded-2xl px-5 py-3 text-sm font-semibold transition-all duration-300"
                        style={{
                          background: 'rgba(255, 255, 255, 0.9)',
                          backdropFilter: 'blur(16px)',
                          border: '1.5px solid rgba(139, 92, 246, 0.15)',
                          boxShadow: '0 4px 16px rgba(139, 92, 246, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
                          color: '#475569'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 8px 24px rgba(139, 92, 246, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.9)';
                          e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 4px 16px rgba(139, 92, 246, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)';
                          e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.15)';
                        }}
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
                    <div className="mt-4 rounded-3xl p-6 animate-slide-in-up" style={{
                      background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 100%)',
                      backdropFilter: 'blur(24px)',
                      border: '1.5px solid rgba(139, 92, 246, 0.15)',
                      boxShadow: '0 8px 32px rgba(139, 92, 246, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.8)'
                    }}>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                        <div>
                          <label className="text-xs font-bold uppercase tracking-wider mb-2 block" style={{ color: '#94a3b8', letterSpacing: '0.1em' }}>Status</label>
                          <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 focus:outline-none"
                            style={{
                              background: 'rgba(255, 255, 255, 0.8)',
                              border: '1.5px solid rgba(139, 92, 246, 0.1)',
                              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                              color: '#1e293b'
                            }}
                            onFocus={(e) => {
                              e.target.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                              e.target.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.1)';
                            }}
                            onBlur={(e) => {
                              e.target.style.borderColor = 'rgba(139, 92, 246, 0.1)';
                              e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.04)';
                            }}
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
                          <label className="text-xs font-bold uppercase tracking-wider mb-2 block" style={{ color: '#94a3b8', letterSpacing: '0.1em' }}>Priority</label>
                          <select
                            value={priorityFilter}
                            onChange={(e) => setPriorityFilter(e.target.value)}
                            className="w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 focus:outline-none"
                            style={{
                              background: 'rgba(255, 255, 255, 0.8)',
                              border: '1.5px solid rgba(139, 92, 246, 0.1)',
                              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                              color: '#1e293b'
                            }}
                            onFocus={(e) => {
                              e.target.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                              e.target.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.1)';
                            }}
                            onBlur={(e) => {
                              e.target.style.borderColor = 'rgba(139, 92, 246, 0.1)';
                              e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.04)';
                            }}
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
                            className="w-full inline-flex items-center justify-center gap-2.5 rounded-2xl text-white px-6 py-3 text-sm font-bold transition-all duration-300"
                            style={{
                              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                              boxShadow: '0 8px 24px -4px rgba(139, 92, 246, 0.5), 0 0 0 1px rgba(139, 92, 246, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                              letterSpacing: '0.02em'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'translateY(-2px) scale(1.01)';
                              e.currentTarget.style.boxShadow = '0 12px 32px -4px rgba(139, 92, 246, 0.6), 0 0 0 1px rgba(139, 92, 246, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'translateY(0) scale(1)';
                              e.currentTarget.style.boxShadow = '0 8px 24px -4px rgba(139, 92, 246, 0.5), 0 0 0 1px rgba(139, 92, 246, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
                            }}
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
                  <div className="rounded-3xl overflow-hidden animate-slide-in-up delay-300" style={{
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.9) 100%)',
                    backdropFilter: 'blur(24px)',
                    border: '1.5px solid rgba(139, 92, 246, 0.15)',
                    boxShadow: '0 20px 60px rgba(139, 92, 246, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.8)'
                  }}>
                    {loading ? (
                      <div className="p-8">
                        <div className="space-y-4">
                          {[...Array(6)].map((_, i) => (
                            <div key={i} className="h-14 rounded-2xl" style={{
                              background: 'linear-gradient(90deg, rgba(249, 250, 251, 0.8) 0%, rgba(243, 232, 255, 0.4) 50%, rgba(249, 250, 251, 0.8) 100%)',
                              backgroundSize: '200% 100%',
                              animation: 'shimmer-sweep 2s ease-in-out infinite',
                              border: '1px solid rgba(139, 92, 246, 0.1)',
                              animationDelay: `${i * 0.1}s`
                            }}></div>
                          ))}
                        </div>
                      </div>
                    ) : projects.length === 0 ? (
                      <div className="p-6 text-center">
                        <FolderIcon className="mx-auto h-10 w-10 text-gray-400" />
                        <h3 className="mt-2 text-sm font-medium text-black">No projects found</h3>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y" style={{ borderColor: 'rgba(139, 92, 246, 0.1)' }}>
                          <thead className="sticky top-0 z-[1]" style={{
                            background: 'linear-gradient(135deg, rgba(249, 250, 251, 0.98) 0%, rgba(243, 244, 246, 0.98) 100%)',
                            backdropFilter: 'blur(16px)',
                            borderBottom: '2px solid rgba(139, 92, 246, 0.15)',
                            boxShadow: '0 4px 12px rgba(139, 92, 246, 0.08)'
                          }}>
                            <tr>
                              <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>
                                <button className="inline-flex items-center gap-1.5 hover:text-purple-600 transition-all duration-300 hover:scale-105" onClick={() => toggleSort('project_id')}>
                                  Project No.
                                  <ChevronUpDownIcon className="h-4 w-4" />
                                </button>
                              </th>
                              <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>
                                <button className="inline-flex items-center gap-1.5 hover:text-purple-600 transition-all duration-300 hover:scale-105" onClick={() => toggleSort('name')}>
                                  Project
                                  <ChevronUpDownIcon className="h-4 w-4" />
                                </button>
                              </th>
                              <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>
                                <button className="inline-flex items-center gap-1.5 hover:text-purple-600 transition-all duration-300 hover:scale-105" onClick={() => toggleSort('company_name')}>
                                  Client
                                  <ChevronUpDownIcon className="h-4 w-4" />
                                </button>
                              </th>
                              <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>
                                <button className="inline-flex items-center gap-1.5 hover:text-purple-600 transition-all duration-300 hover:scale-105" onClick={() => toggleSort('start_date')}>
                                  Timeline
                                  <ChevronUpDownIcon className="h-4 w-4" />
                                </button>
                              </th>
                              <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>Status</th>
                              <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>Estimated Cost</th>
                              <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>
                                <button className="inline-flex items-center gap-1.5 hover:text-purple-600 transition-all duration-300 hover:scale-105" onClick={() => toggleSort('budget')}>
                                  Budget
                                  <ChevronUpDownIcon className="h-4 w-4" />
                                </button>
                              </th>
                              <th className="px-5 py-4 text-left text-xs font-black uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>Progress</th>
                              <th className="px-5 py-4 text-right text-xs font-black uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y" style={{ 
                            background: 'transparent',
                            borderColor: 'rgba(226, 232, 240, 0.4)'
                          }}>
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
                                  className="transition-all duration-300"
                                  style={{
                                    background: _idx % 2 === 0 ? 'rgba(255, 255, 255, 0.4)' : 'rgba(248, 250, 252, 0.4)'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(90deg, rgba(243, 232, 255, 0.6) 0%, rgba(243, 232, 255, 0.3) 100%)';
                                    e.currentTarget.style.transform = 'translateX(4px) scale(1.005)';
                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.15)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = _idx % 2 === 0 ? 'rgba(255, 255, 255, 0.4)' : 'rgba(248, 250, 252, 0.4)';
                                    e.currentTarget.style.transform = 'translateX(0) scale(1)';
                                    e.currentTarget.style.boxShadow = 'none';
                                  }}>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="text-sm font-mono text-gray-900">
                                    {project.project_id || '-'}
                                  </div>
                                </td>
                                <td className="px-5 py-4 whitespace-nowrap">
                                  <div>
                                    <div className="text-sm font-bold flex items-center gap-2.5" style={{ color: '#0f172a' }}>
                                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl text-xs font-black transition-all duration-300" style={{
                                        background: 'linear-gradient(135deg, #ede9fe 0%, #f3e8ff 100%)',
                                        color: '#7c3aed',
                                        boxShadow: '0 2px 8px rgba(139, 92, 246, 0.2)'
                                      }}>
                                        {(project.name || '?').slice(0,1).toUpperCase()}
                                      </span>
                                      {project.name}
                                    </div>
                                    <div className="text-xs font-medium mt-1.5 max-w-xs truncate" style={{ color: '#64748b' }}>{project.description}</div>
                                    <div className={`text-[11px] font-bold uppercase mt-2 tracking-wide ${getPriorityColor(project.priority)}`}>
                                      {formatLabel(project.priority || 'Unassigned')} Priority
                                    </div>
                                  </div>
                                </td>
                                <td className="px-5 py-4">
                                  <div className="text-sm font-semibold" style={{ color: '#1e293b' }}>{project.company_name || '-'}</div>
                                  <div className="text-xs font-medium mt-1 px-2 py-1 rounded-lg inline-block" style={{
                                    background: 'rgba(99, 102, 241, 0.1)',
                                    color: '#4f46e5'
                                  }}>PM: {project.project_manager || 'Not assigned'}</div>
                                </td>
                                <td className="px-5 py-4 whitespace-nowrap">
                                  <div className="text-sm font-semibold" style={{ color: '#1e293b' }}>
                                    <div className="flex items-center gap-1.5">
                                      <CalendarIcon className="h-4 w-4" style={{ color: '#8b5cf6' }} />
                                      {formatDate(project.start_date)}
                                    </div>
                                    {project.end_date && (
                                      <div className="text-xs font-medium mt-1.5" style={{ color: '#64748b' }}>to {formatDate(project.end_date)}</div>
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
                                <td className="px-5 py-4 whitespace-nowrap text-sm font-bold" style={{ color: '#1e293b' }}>
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
                                <td className="px-5 py-4 whitespace-nowrap text-sm font-bold" style={{ color: '#1e293b' }}>
                                  {formatCurrency(project.budget)}
                                </td>
                                <td className="px-5 py-4 whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    <div className="w-24 h-2.5 rounded-full overflow-hidden" style={{
                                      background: 'rgba(226, 232, 240, 0.4)',
                                      boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.05)'
                                    }}>
                                      <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ 
                                        width: `${project.progress || 0}%`,
                                        background: 'linear-gradient(90deg, #a78bfa 0%, #8b5cf6 50%, #7c3aed 100%)',
                                        boxShadow: '0 0 10px rgba(139, 92, 246, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3)'
                                      }} />
                                    </div>
                                    <span className="text-xs font-black min-w-[35px]" style={{ color: '#64748b' }}>{project.progress || 0}%</span>
                                  </div>
                                </td>
                                <td className="px-5 py-4 whitespace-nowrap text-right text-sm font-medium">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => router.push(`/projects/${project.project_id ?? project.id ?? project.project_code ?? ''}`)}
                                      className="p-2.5 rounded-xl transition-all duration-300 group"
                                      style={{
                                        color: '#8b5cf6',
                                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.15) 100%)',
                                        border: '1px solid rgba(139, 92, 246, 0.2)',
                                        boxShadow: '0 2px 4px rgba(139, 92, 246, 0.1)'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(124, 58, 237, 0.25) 100%)';
                                        e.currentTarget.style.transform = 'translateY(-2px) scale(1.08)';
                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.25)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.15) 100%)';
                                        e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(139, 92, 246, 0.1)';
                                      }}
                                      title="View Details"
                                    >
                                      <EyeIcon className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
                                    </button>
                                    <button
                                      onClick={() => router.push(`/projects/${project.project_id ?? project.id ?? project.project_code ?? ''}/edit`)}
                                      className="p-2.5 rounded-xl transition-all duration-300 group"
                                      style={{
                                        color: '#3b82f6',
                                        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.15) 100%)',
                                        border: '1px solid rgba(59, 130, 246, 0.2)',
                                        boxShadow: '0 2px 4px rgba(59, 130, 246, 0.1)'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(37, 99, 235, 0.25) 100%)';
                                        e.currentTarget.style.transform = 'translateY(-2px) scale(1.08) rotate(5deg)';
                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.25)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.15) 100%)';
                                        e.currentTarget.style.transform = 'translateY(0) scale(1) rotate(0deg)';
                                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(59, 130, 246, 0.1)';
                                      }}
                                      title="Edit Project"
                                    >
                                      <PencilIcon className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
                                    </button>
                                    <button
                                      onClick={() => handleDelete(project.project_id ?? project.id ?? project.project_code)}
                                      className="p-2.5 rounded-xl transition-all duration-300 group"
                                      style={{
                                        color: '#ef4444',
                                        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.15) 100%)',
                                        border: '1px solid rgba(239, 68, 68, 0.2)',
                                        boxShadow: '0 2px 4px rgba(239, 68, 68, 0.1)'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.25) 100%)';
                                        e.currentTarget.style.transform = 'translateY(-2px) scale(1.08)';
                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.25)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.15) 100%)';
                                        e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(239, 68, 68, 0.1)';
                                      }}
                                      title="Delete Project"
                                    >
                                      <TrashIcon className="h-4 w-4 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
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

                      <div className="flex-1">
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