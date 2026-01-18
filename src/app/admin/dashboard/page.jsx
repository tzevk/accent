'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import LoadingSpinner from '@/components/LoadingSpinner';
import Link from 'next/link';
import { fetchJSON } from '@/utils/http';
import { useSession } from '@/context/SessionContext';
import { 
  UserGroupIcon,
  DocumentTextIcon,
  BuildingOfficeIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  EyeIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  CalendarDaysIcon,
  UsersIcon
} from '@heroicons/react/24/outline';

/**
 * Admin Dashboard - Protected route
 * 
 * Uses SessionContext for consistent auth state.
 * Redirects non-super-admins to user dashboard.
 */
export default function AdminDashboard() {
  const router = useRouter();
  const { user, loading: sessionLoading, authenticated } = useSession();
  
  // Protection state
  const [isAuthorized, setIsAuthorized] = useState(false);
  
  // Dashboard data states
  const [stats, setStats] = useState({
    leads: { total_leads: 0, under_discussion: 0, proposal_sent: 0, closed_won: 0 },
    proposals: { total: 0, pending: 0, approved: 0, draft: 0 },
    companies: { total: 0 },
    projects: { total: 0, in_progress: 0, completed: 0 }
  });
  const [loading, setLoading] = useState(true);
  const [deltas, setDeltas] = useState({ leads: 0, proposals: 0, companies: 0, projects: 0 });
  const [manhours, setManhours] = useState({
    estimated: 0,
    actual: 0,
    byProject: [],
    weeklyTrend: []
  });
  const [analytics, setAnalytics] = useState({
    funnel: { new: 0, discussion: 0, proposal: 0, won: 0, lost: 0 },
    topCities: [],
    series: { leads: [], proposals: [], companies: [], projects: [] },
    activity: { followupsThisWeek: 0, followupsPrevWeek: 0 }
  });

  // Check authorization and start fetching data as soon as possible
  useEffect(() => {
    // Wait for session to load
    if (sessionLoading) return;

    // Not authenticated - AuthGate will handle redirect
    if (!authenticated || !user) return;

    // Check if super admin
    const isSuperAdmin = user.is_super_admin === true || user.is_super_admin === 1;

    if (!isSuperAdmin) {
      // NOT authorized - redirect to user dashboard
      router.replace('/user/dashboard');
      return;
    }

    // Authorized - immediately start fetching data
    setIsAuthorized(true);
    fetchStats();
  }, [sessionLoading, authenticated, user, router]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      
      // Use optimized dashboard-stats API with parallel queries
      // This replaces 6+ sequential API calls with 2 parallel calls
      const [dashboardRes, manhoursRes] = await Promise.all([
        fetchJSON('/api/admin/dashboard-stats'),
        fetchJSON('/api/admin/manhours-stats')
      ]);
      
      if (dashboardRes.success && dashboardRes.data) {
        const { stats: apiStats, deltas: apiDeltas, series, activity } = dashboardRes.data;
        
        setStats({
          leads: apiStats.leads,
          proposals: apiStats.proposals,
          companies: apiStats.companies,
          projects: apiStats.projects
        });
        
        setDeltas(apiDeltas);
        
        setAnalytics(prev => ({
          ...prev,
          series,
          activity
        }));
        
        // Log performance improvement
        if (dashboardRes.data._meta?.queryTimeMs) {
          console.log(`Dashboard stats loaded in ${dashboardRes.data._meta.queryTimeMs}ms`);
        }
      }
      
      if (manhoursRes.success && manhoursRes.data) {
        setManhours({
          estimated: manhoursRes.data.estimated,
          actual: manhoursRes.data.actual,
          byProject: manhoursRes.data.byProject,
          weeklyTrend: manhoursRes.data.weeklyTrend
        });
        
        if (manhoursRes.data._meta?.queryTimeMs) {
          console.log(`Manhours stats loaded in ${manhoursRes.data._meta.queryTimeMs}ms`);
        }
      }

    } catch (error) {
      console.error('Error fetching stats:', error);
      
      // Fallback to individual API calls if optimized endpoint fails
      try {
        console.log('Falling back to individual API calls...');
        await fetchStatsFallback();
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
      }
    } finally {
      setLoading(false);
    }
  };
  
  // Fallback function for backward compatibility
  const fetchStatsFallback = async () => {
    const [leadsData, proposalsData, companiesData, projectsData] = await Promise.all([
      fetchJSON('/api/leads?limit=1').catch(() => ({ success: false })),
      fetchJSON('/api/proposals').catch(() => ({ success: false, data: [] })),
      fetchJSON('/api/companies').catch(() => ({ success: false, data: [] })),
      fetchJSON('/api/projects').catch(() => ({ success: false, data: [] }))
    ]);
    
    const proposals = proposalsData.proposals || proposalsData.data || [];
    const projects = projectsData.data || [];
    
    setStats({
      leads: leadsData.data?.stats || { total_leads: 0, under_discussion: 0, active_leads: 0, closed_won: 0 },
      proposals: {
        total: proposals.length,
        pending: proposals.filter(p => p.status === 'pending').length,
        approved: proposals.filter(p => p.status === 'approved').length,
        draft: proposals.filter(p => p.status === 'draft').length
      },
      companies: { total: companiesData.data?.length || 0 },
      projects: {
        total: projects.length,
        in_progress: projects.filter(p => p.status === 'in-progress').length,
        completed: projects.filter(p => p.status === 'completed').length
      }
    });
  };

  const fmtNum = new Intl.NumberFormat('en-IN');

  // Simple clean sparkline - no gradient
  const Sparkline = ({ values = [], color = '#64126D' }) => {
    const w = 80, h = 32, pad = 4;
    
    // No data - show flat dashed line
    if (!values || values.length === 0 || values.every(v => v === 0)) {
      return (
        <svg width={w} height={h} className="opacity-40">
          <line x1={pad} y1={h/2} x2={w-pad} y2={h/2} stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="3,3" />
        </svg>
      );
    }
    
    // All same values - show flat line
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      return (
        <svg width={w} height={h}>
          <line x1={pad} y1={h/2} x2={w-pad} y2={h/2} stroke={color} strokeWidth="2" strokeLinecap="round" />
          <circle cx={w-pad} cy={h/2} r="3" fill={color} />
        </svg>
      );
    }
    
    const range = max - min;
    const step = (w - pad * 2) / (values.length - 1);
    
    // Calculate Y positions - higher values should be at TOP (lower Y)
    const points = values.map((v, i) => {
      const x = pad + i * step;
      // Normalize: 0 = bottom, 1 = top
      const normalized = (v - min) / range;
      // Y coordinate: top of chart is pad, bottom is h-pad
      const y = (h - pad) - (normalized * (h - pad * 2));
      return { x, y, v };
    });
    
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Last point dot */}
        <circle cx={points[points.length-1].x} cy={points[points.length-1].y} r="3" fill={color} />
      </svg>
    );
  };

  // PROTECTION: While checking, show ONLY loader - no admin UI
  if (sessionLoading || !isAuthorized) {
    return (
      <LoadingSpinner 
        message="Loading Admin Dashboard" 
        subMessage="Verifying permissions..." 
      />
    );
  }

  // Only render admin dashboard UI after authorization is confirmed
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <main className="px-6 py-6">
        {/* Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <nav className="text-xs text-gray-500 mb-1" aria-label="Breadcrumb">
              <ol className="inline-flex items-center gap-2">
                <li>Home</li>
                <li className="text-gray-300">/</li>
                <li className="text-gray-700">Admin Dashboard</li>
              </ol>
            </nav>
            <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          </div>
        </div>

        {/* Executive KPI Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          {[
            {
              title: 'TOTAL LEADS',
              value: stats.leads.total_leads,
              hint: 'View leads',
              href: '/leads',
              delta: deltas.leads,
              Icon: UserGroupIcon,
              series: analytics.series.leads
            },
            {
              title: 'PROPOSALS',
              value: stats.proposals.total,
              hint: 'View Proposals',
              href: '/proposals',
              delta: deltas.proposals,
              Icon: DocumentTextIcon,
              series: analytics.series.proposals
            },
            {
              title: 'COMPANIES',
              value: stats.companies.total,
              hint: 'View Companies',
              href: '/company',
              delta: deltas.companies,
              Icon: BuildingOfficeIcon,
              series: analytics.series.companies
            },
            {
              title: 'PROJECTS',
              value: stats.projects.total,
              hint: 'View Projects',
              href: '/projects',
              delta: deltas.projects,
              Icon: FolderIcon,
              series: analytics.series.projects
            }
          ].map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="block bg-white rounded-xl border border-purple-200 p-5 hover:border-purple-400 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-white border border-purple-200 rounded-lg flex items-center justify-center">
                  <card.Icon className="h-5 w-5 text-[#64126D]" />
                </div>
                <Sparkline values={card.series} />
              </div>
              <div className="text-xs font-medium text-gray-500 tracking-wider mb-1">{card.title}</div>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-gray-900">{fmtNum.format(card.value)}</span>
                {card.delta !== 0 && (
                  <span className={`text-xs font-medium ${card.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {card.delta > 0 ? '+' : ''}{card.delta} this week
                  </span>
                )}
              </div>
              <div className="text-xs text-[#64126D] mt-2 group-hover:underline">{card.hint} →</div>
            </Link>
          ))}
        </div>

        {/* Manhours Analytics Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Manhours Overview Card */}
          <div className="bg-white rounded-xl border border-purple-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Manhours Overview</h3>
              <ChartBarIcon className="h-5 w-5 text-[#64126D]" />
            </div>
            
            <div className="space-y-4">
              {/* Estimated vs Actual Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-purple-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <ClockIcon className="h-4 w-4 text-purple-500" />
                    <span className="text-xs font-medium text-purple-600">Estimated</span>
                  </div>
                  <p className="text-2xl font-bold text-purple-700">{fmtNum.format(manhours.estimated)}</p>
                  <p className="text-xs text-purple-500">hours planned</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircleIcon className="h-4 w-4 text-green-500" />
                    <span className="text-xs font-medium text-green-600">Actual</span>
                  </div>
                  <p className="text-2xl font-bold text-green-700">{fmtNum.format(manhours.actual)}</p>
                  <p className="text-xs text-green-500">hours logged</p>
                </div>
              </div>
              
              {/* Efficiency Indicator */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">Utilization Rate</span>
                  <span className={`text-sm font-semibold ${
                    manhours.estimated > 0 
                      ? (manhours.actual / manhours.estimated) <= 1 
                        ? 'text-green-600' 
                        : 'text-orange-600'
                      : 'text-gray-400'
                  }`}>
                    {manhours.estimated > 0 
                      ? `${Math.round((manhours.actual / manhours.estimated) * 100)}%` 
                      : 'N/A'}
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${
                      manhours.estimated > 0 
                        ? (manhours.actual / manhours.estimated) <= 1 
                          ? 'bg-green-500' 
                          : 'bg-orange-500'
                        : 'bg-gray-300'
                    }`}
                    style={{ 
                      width: manhours.estimated > 0 
                        ? `${Math.min((manhours.actual / manhours.estimated) * 100, 100)}%` 
                        : '0%' 
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {manhours.estimated > 0 && manhours.actual > manhours.estimated 
                    ? `${Math.round(manhours.actual - manhours.estimated)} hours over budget`
                    : manhours.estimated > 0 
                      ? `${Math.round(manhours.estimated - manhours.actual)} hours remaining`
                      : 'No estimates set'}
                </p>
              </div>
            </div>
          </div>

          {/* Weekly Hours Trend */}
          <div className="bg-white rounded-xl border border-purple-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Weekly Hours Trend</h3>
              <ArrowTrendingUpIcon className="h-5 w-5 text-[#64126D]" />
            </div>
            
            {manhours.weeklyTrend.length > 0 ? (
              <>
                <div className="flex items-end justify-center gap-4 h-32 mb-4">
                  {manhours.weeklyTrend.map((week, i) => {
                    const maxHours = Math.max(...manhours.weeklyTrend.map(w => w.hours), 1);
                    const heightPercent = (week.hours / maxHours) * 100;
                    const isCurrentWeek = i === manhours.weeklyTrend.length - 1;
                    return (
                      <div key={i} className="flex flex-col items-center gap-1 flex-1">
                        <span className="text-xs font-medium text-gray-700">{week.hours}h</span>
                        <div 
                          className={`w-full max-w-[40px] rounded-t-lg transition-all ${
                            isCurrentWeek ? 'bg-[#64126D]' : 'bg-purple-200'
                          }`}
                          style={{ height: `${Math.max(heightPercent, 8)}%` }}
                        />
                        <span className="text-xs text-gray-500">{week.week}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                  <span className="text-xs text-gray-500">Last 4 weeks</span>
                  <span className="text-xs font-medium text-[#64126D]">
                    Avg: {Math.round(manhours.weeklyTrend.reduce((sum, w) => sum + w.hours, 0) / manhours.weeklyTrend.length)}h/week
                  </span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                <CalendarDaysIcon className="h-10 w-10 mb-2" />
                <p className="text-sm">No data available</p>
              </div>
            )}
          </div>

          {/* Top Projects by Hours */}
          <div className="bg-white rounded-xl border border-purple-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Top Projects by Hours</h3>
              <FolderIcon className="h-5 w-5 text-[#64126D]" />
            </div>
            
            {manhours.byProject.length > 0 ? (
              <div className="space-y-3">
                {manhours.byProject.slice(0, 5).map((project, i) => {
                  const maxHours = Math.max(...manhours.byProject.map(p => p.actual), 1);
                  return (
                    <div key={i} className="group">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700 truncate max-w-[150px]" title={project.name}>
                          {project.name}
                        </span>
                        <span className="text-sm font-semibold text-[#64126D]">{project.actual}h</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-purple-400 to-[#64126D] rounded-full transition-all group-hover:from-purple-500 group-hover:to-purple-700"
                          style={{ width: `${(project.actual / maxHours) * 100}%` }}
                        />
                      </div>
                      {project.estimated > 0 && (
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-400">Est: {project.estimated}h</span>
                          <span className={`text-xs font-medium ${
                            project.actual <= project.estimated ? 'text-green-500' : 'text-orange-500'
                          }`}>
                            {project.actual <= project.estimated 
                              ? `${Math.round(100 - (project.actual / project.estimated) * 100)}% under`
                              : `${Math.round((project.actual / project.estimated - 1) * 100)}% over`
                            }
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                <UsersIcon className="h-10 w-10 mb-2" />
                <p className="text-sm">No project hours logged</p>
              </div>
            )}
          </div>
        </div>

        {/* Projects Overview */}
        <AdminProjectsOverview />
      </main>
    </div>
  );
}

// Admin Projects Overview Component
function AdminProjectsOverview() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/projects?limit=100');
        const data = await res.json();
        if (data.success) {
          setProjects(data.data || []);
        }
      } catch (error) {
        console.error('Error fetching projects:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProjects();
  }, []);

  const getStatusInfo = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('completed') || s.includes('done')) return { label: 'Completed', color: 'bg-green-100 text-green-700 border-green-200', icon: CheckCircleIcon };
    if (s.includes('progress') || s.includes('active') || s.includes('ongoing')) return { label: 'In Progress', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: PlayIcon };
    if (s.includes('hold') || s.includes('paused')) return { label: 'On Hold', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: ExclamationTriangleIcon };
    if (s.includes('planning') || s.includes('pending') || s.includes('new')) return { label: 'Planning', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: ClockIcon };
    return { label: status || 'Unknown', color: 'bg-gray-100 text-gray-700 border-gray-200', icon: FolderIcon };
  };

  const formatDate = (d) => {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '-';
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const filteredProjects = projects
    .filter(p => {
      const matchesSearch = !searchQuery || 
        (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.client_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || 
        String(p.status || '').toLowerCase().includes(statusFilter.toLowerCase());
      return matchesSearch && matchesStatus;
    });

  const stats = {
    total: projects.length,
    inProgress: projects.filter(p => String(p.status || '').toLowerCase().includes('progress')).length,
    completed: projects.filter(p => String(p.status || '').toLowerCase().includes('completed')).length,
    onHold: projects.filter(p => String(p.status || '').toLowerCase().includes('hold')).length
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-purple-200 overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-purple-200">
          <div className="h-6 w-48 bg-gray-200 rounded animate-pulse"></div>
        </div>
        <div className="p-6">
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-purple-200 overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-purple-200">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">All Projects</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {stats.total} total • {stats.inProgress} active • {stats.completed} completed • {stats.onHold} on hold
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 focus:border-purple-400 w-48"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
            >
              <option value="all">All Status</option>
              <option value="progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="hold">On Hold</option>
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 w-10">#</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Project</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Client</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 w-28">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 w-28">Start Date</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 w-28">Deadline</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-600 w-20">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredProjects.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  <FolderIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">No projects found</p>
                </td>
              </tr>
            ) : (
              filteredProjects.slice(0, 20).map((project, index) => {
                const statusInfo = getStatusInfo(project.status);
                const StatusIcon = statusInfo.icon;
                
                return (
                  <tr key={project.project_id} className="hover:bg-purple-50/40 transition-colors">
                    <td className="px-4 py-3 text-gray-500 font-medium">{index + 1}</td>
                    <td className="px-4 py-3">
                      <Link href={`/projects/${project.project_id}/edit`} className="font-medium text-gray-900 hover:text-[#64126D] hover:underline">
                        {project.name || 'Untitled Project'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{project.client_name || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusInfo.color}`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-sm">{formatDate(project.start_date)}</td>
                    <td className="px-4 py-3 text-gray-600 text-sm">{formatDate(project.end_date)}</td>
                    <td className="px-4 py-3 text-center">
                      <Link 
                        href={`/projects/${project.project_id}/edit`}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-[#64126D] hover:bg-purple-100 transition-colors"
                      >
                        <EyeIcon className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filteredProjects.length > 20 && (
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-600 flex items-center justify-between">
          <span>Showing 20 of {filteredProjects.length} projects</span>
          <Link href="/projects" className="text-[#64126D] font-medium hover:underline">
            View all projects →
          </Link>
        </div>
      )}
    </div>
  );
}
