
'use client';

import Navbar from '@/components/Navbar';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { fetchJSON } from '@/utils/http';
import dynamic from 'next/dynamic';
import { 
  UserGroupIcon,
  DocumentTextIcon,
  BuildingOfficeIcon,
  FolderIcon,
  ChartBarIcon,
  PlusIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlayIcon
} from '@heroicons/react/24/outline';
import { useSessionRBAC } from '@/utils/client-rbac';
const UserDashboard = dynamic(() => import('./user-dashboard'), { ssr: false });

// Admin Projects Overview Component - Crisp realistic view of all projects
function AdminProjectsOverview() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');

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

  const calculateProgress = (project) => {
    // Try to calculate from dates or status
    const status = String(project.status || '').toLowerCase();
    if (status.includes('completed')) return 100;
    if (status.includes('hold')) return project.progress || 30;
    if (status.includes('planning')) return 10;
    
    // Try from start/end dates
    if (project.start_date && project.end_date) {
      const start = new Date(project.start_date);
      const end = new Date(project.end_date);
      const now = new Date();
      if (now >= end) return 95;
      if (now <= start) return 5;
      const total = end - start;
      const elapsed = now - start;
      return Math.min(95, Math.max(5, Math.round((elapsed / total) * 100)));
    }
    return project.progress || 50;
  };

  // Filter and sort projects
  const filteredProjects = projects
    .filter(p => {
      const matchesSearch = !searchQuery || 
        (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.client_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.project_id || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || 
        String(p.status || '').toLowerCase().includes(statusFilter.toLowerCase());
      
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      let aVal = a[sortBy] || '';
      let bVal = b[sortBy] || '';
      if (sortBy === 'created_at' || sortBy === 'start_date' || sortBy === 'end_date') {
        aVal = new Date(aVal || 0).getTime();
        bVal = new Date(bVal || 0).getTime();
      }
      if (sortOrder === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });

  // Stats summary
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
      {/* Header */}
      <div className="px-6 py-4 border-b border-purple-200">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">All Projects</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {stats.total} total • {stats.inProgress} active • {stats.completed} completed • {stats.onHold} on hold
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Search */}
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
            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
            >
              <option value="all">All Status</option>
              <option value="progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="hold">On Hold</option>
              <option value="planning">Planning</option>
            </select>
            {/* Sort */}
            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [field, order] = e.target.value.split('-');
                setSortBy(field);
                setSortOrder(order);
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
            >
              <option value="created_at-desc">Newest First</option>
              <option value="created_at-asc">Oldest First</option>
              <option value="name-asc">Name A-Z</option>
              <option value="name-desc">Name Z-A</option>
              <option value="end_date-asc">Deadline (Soon)</option>
              <option value="end_date-desc">Deadline (Later)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Projects Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 w-10">#</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Project</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Client</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 w-28">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 w-40">Progress</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 w-28">Start Date</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600 w-28">Deadline</th>
              <th className="px-4 py-3 text-center font-semibold text-gray-600 w-20">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredProjects.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                  <FolderIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">No projects found</p>
                  <p className="text-sm mt-1">Try adjusting your search or filters</p>
                </td>
              </tr>
            ) : (
              filteredProjects.slice(0, 20).map((project, index) => {
                const statusInfo = getStatusInfo(project.status);
                const StatusIcon = statusInfo.icon;
                const progress = calculateProgress(project);
                
                return (
                  <tr key={project.project_id} className="hover:bg-purple-50/40 transition-colors">
                    <td className="px-4 py-3 text-gray-500 font-medium">{index + 1}</td>
                    <td className="px-4 py-3">
                      <div>
                        <Link href={`/projects/${project.project_id}/edit`} className="font-medium text-gray-900 hover:text-[#64126D] hover:underline">
                          {project.name || 'Untitled Project'}
                        </Link>
                        {project.project_code && (
                          <span className="ml-2 text-xs text-gray-400">#{project.project_code}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{project.client_name || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusInfo.color}`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-2 rounded-full transition-all ${
                              progress >= 100 ? 'bg-green-500' : 
                              progress >= 75 ? 'bg-blue-500' : 
                              progress >= 50 ? 'bg-purple-500' : 
                              progress >= 25 ? 'bg-yellow-500' : 'bg-gray-400'
                            }`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-600 w-10">{progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-sm">{formatDate(project.start_date)}</td>
                    <td className="px-4 py-3 text-gray-600 text-sm">
                      {project.end_date && new Date(project.end_date) < new Date() && !String(project.status || '').toLowerCase().includes('completed') ? (
                        <span className="text-red-600 font-medium">{formatDate(project.end_date)}</span>
                      ) : (
                        formatDate(project.end_date)
                      )}
                    </td>
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

      {/* Footer */}
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

export default function Dashboard() {
  const { user, loading: userLoading } = useSessionRBAC();
  
  // Compute isMainAdmin - only check once user is actually loaded
  const isMainAdmin = user && (user.is_super_admin === true || user.is_super_admin === 1);
  
  // Track if we've determined the dashboard type to prevent flickering
  const [dashboardDetermined, setDashboardDetermined] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  
  // Determine which dashboard to show only once user is loaded
  useEffect(() => {
    if (!userLoading && user) {
      const isAdmin = user.is_super_admin === true || user.is_super_admin === 1;
      setShowAdminDashboard(isAdmin);
      setDashboardDetermined(true);
    } else if (!userLoading && !user) {
      // User not authenticated, show user dashboard (will redirect to login)
      setShowAdminDashboard(false);
      setDashboardDetermined(true);
    }
  }, [user, userLoading]);
  
  const [stats, setStats] = useState({
    leads: { total_leads: 0, under_discussion: 0, proposal_sent: 0, closed_won: 0 },
    proposals: { total: 0, pending: 0, approved: 0, draft: 0 },
    companies: { total: 0 },
    projects: { total: 0, in_progress: 0, completed: 0 }
  });
  const [loading, setLoading] = useState(true);
  const [deltas, setDeltas] = useState({ leads: 0, proposals: 0, companies: 0, projects: 0 });
  const fmtNum = new Intl.NumberFormat('en-IN');
  const [analytics, setAnalytics] = useState({
    funnel: { new: 0, discussion: 0, proposal: 0, won: 0, lost: 0 },
    topCities: [],
    series: { leads: [], proposals: [], companies: [], projects: [] },
    activity: { followupsThisWeek: 0, followupsPrevWeek: 0 }
  });

// Fetch Stats - safe, no dependencies (skip for non-admin users)
useEffect(() => {
  if (!isMainAdmin) return;
  fetchStats();
}, [isMainAdmin]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      
      // Fetch all stats with individual error handling
      let leadsData = { success: false, data: null };
      let proposalsData = { success: false, data: [] };
      let companiesData = { success: false, data: [] };
      let projectsData = { success: false, data: [] };
      
      try {
        leadsData = await fetchJSON('/api/leads?limit=1');
      } catch (e) {
        console.error('Error fetching leads:', e.message);
      }
      
      try {
        proposalsData = await fetchJSON('/api/proposals');
      } catch (e) {
        console.error('Error fetching proposals:', e.message);
      }
      
      try {
        companiesData = await fetchJSON('/api/companies');
      } catch (e) {
        console.error('Error fetching companies:', e.message);
      }
      
      try {
        projectsData = await fetchJSON('/api/projects');
      } catch (e) {
        console.error('Error fetching projects:', e.message);
      }
      
      console.log('Dashboard stats fetched:', {
        leads: leadsData.success,
        proposals: proposalsData.success,
        companies: companiesData.success,
        projects: projectsData.success
      });

      // Process data even if some fetches failed
      {
        // Calculate proposal stats
        const proposals = proposalsData.proposals || proposalsData.data || [];
        console.log('Proposals array:', proposals, 'Length:', proposals.length);
        const proposalStats = {
          total: proposals.length,
          pending: proposals.filter(p => p.status === 'pending').length,
          approved: proposals.filter(p => p.status === 'approved').length,
          draft: proposals.filter(p => p.status === 'draft').length
        };
        
        console.log('Proposal stats calculated:', proposalStats);
        
        // Calculate project stats
        const projects = projectsData.data || [];
        const projectStats = {
          total: projects.length,
          in_progress: projects.filter(p => p.status === 'in-progress').length,
          completed: projects.filter(p => p.status === 'completed').length
        };
        
        setStats({
          leads: leadsData.data?.stats || { total_leads: 0, under_discussion: 0, active_leads: 0, closed_won: 0 },
          proposals: proposalStats,
          companies: { total: companiesData.data?.length || 0 },
          projects: projectStats
        });

        // Compute real week-over-week deltas (last 7 days vs previous 7 days)
        const now = new Date();
        const last7Start = new Date(now);
        last7Start.setDate(now.getDate() - 7);
        const prev7Start = new Date(now);
        prev7Start.setDate(now.getDate() - 14);

        const pickDate = (obj) => {
          const fields = ['created_at', 'createdAt', 'enquiry_date', 'enquiryDate', 'date'];
          for (const f of fields) {
            if (obj && obj[f]) return new Date(obj[f]);
          }
          return null;
        };
        const inRange = (d, start, end) => d && d >= start && d < end;
        const countWoW = (arr) => {
          const curr = arr.reduce((acc, it) => {
            const d = pickDate(it);
            return acc + (inRange(d, last7Start, now) ? 1 : 0);
          }, 0);
          const prev = arr.reduce((acc, it) => {
            const d = pickDate(it);
            return acc + (inRange(d, prev7Start, last7Start) ? 1 : 0);
          }, 0);
          if (prev === 0) return curr > 0 ? 100 : 0;
          return ((curr - prev) / prev) * 100;
        };

        // Leads: fetch a larger page to compute counts
        let leadsArr = [];
        try {
          const leadsAllData = await fetchJSON('/api/leads?limit=10000&sortBy=created_at&sortOrder=desc');
          leadsArr = leadsAllData.success ? (leadsAllData.data?.leads || []) : [];
        } catch (e) {
          console.warn('Could not fetch full leads for deltas:', e);
        }

        const proposalsArr = proposals;
        const companiesArr = companiesData.data || [];
        const projectsArr = projects;

        setDeltas({
          leads: countWoW(leadsArr),
          proposals: countWoW(proposalsArr),
          companies: countWoW(companiesArr),
          projects: countWoW(projectsArr)
        });

        // Build executive analytics
        const normStatus = (s='') => String(s).toLowerCase();
        const funnel = leadsArr.reduce((acc, l) => {
          const s = normStatus(l.enquiry_status || l.status);
          if (!s) acc.new++;
          else if (s.includes('discussion')) acc.discussion++;
          else if (s.includes('proposal')) acc.proposal++;
          else if (s.includes('won')) acc.won++;
          else if (s.includes('lost')) acc.lost++;
          else acc.new++;
          return acc;
        }, { new: 0, discussion: 0, proposal: 0, won: 0, lost: 0 });

        const cityMap = leadsArr.reduce((m, l) => {
          const c = (l.city || 'Unknown').trim();
          m[c] = (m[c] || 0) + 1; return m;
        }, {});
        const topCities = Object.entries(cityMap)
          .sort((a,b)=>b[1]-a[1])
          .slice(0, 5)
          .map(([city, count]) => ({ city, count }));

        // Build simple daily series for last 7 days
        const lastNDays = (n) => {
          const arr = [];
          const base = new Date();
          for (let i=n-1;i>=0;i--) {
            const d = new Date(base);
            d.setDate(base.getDate()-i);
            d.setHours(0,0,0,0);
            arr.push(d);
          }
          return arr;
        };
        const days = lastNDays(7);
        const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
        const bucketCounts = (arr) => {
          const buckets = Object.fromEntries(days.map(d=>[dayKey(d),0]));
          arr.forEach(it=>{
            const d = pickDate(it);
            if (!d) return;
            const k = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
            if (k in buckets) buckets[k]++;
          });
          return Object.values(buckets);
        };
        const series = {
          leads: bucketCounts(leadsArr),
          proposals: bucketCounts(proposalsArr),
          companies: bucketCounts(companiesArr),
          projects: bucketCounts(projectsArr)
        };

        // Optional: followups snapshot
        let activity = { followupsThisWeek: 0, followupsPrevWeek: 0 };
        try {
          const fuRes = await fetch('/api/followups');
          const fuData = await fuRes.json();
          const fu = fuData?.data || [];
          const now2 = new Date();
          const last7 = new Date(now2); last7.setDate(now2.getDate()-7);
          const prev7 = new Date(now2); prev7.setDate(now2.getDate()-14);
          const inR = (d, s, e) => d && d>=s && d<e;
          const toDate = (x) => x?.created_at ? new Date(x.created_at) : (x?.date ? new Date(x.date) : null);
          const curr = fu.reduce((a,f)=> a + (inR(toDate(f), last7, now2) ? 1 : 0), 0);
          const prev = fu.reduce((a,f)=> a + (inR(toDate(f), prev7, last7) ? 1 : 0), 0);
          activity = { followupsThisWeek: curr, followupsPrevWeek: prev };
        } catch {}

        setAnalytics({ funnel, topCities, series, activity });
      }  // End of data processing block
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  // Tiny SVG sparkline
  const Sparkline = ({ values = [], color = '#64126D' }) => {
    const w = 80, h = 28, pad = 2;
    if (!values || values.length === 0) return <svg width={w} height={h} />;
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const step = (w - pad*2) / (values.length - 1);
    const pts = values.map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / range) * (h - pad*2);
      return `${x},${y}`;
    }).join(' ');
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-80">
        <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />
      </svg>
    );
  };

  // Wait for user to load before deciding which dashboard to show
  if (userLoading || !dashboardDetermined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <div className="text-gray-500">Loading dashboard...</div>
        </div>
      </div>
    );
  }

  // Show user dashboard for all non-admin users - no flash of admin dashboard
  if (!showAdminDashboard) {
    return <UserDashboard />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
  <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
        {/* Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <nav className="text-xs text-gray-500 mb-1" aria-label="Breadcrumb">
              <ol className="inline-flex items-center gap-2">
                <li>Home</li>
                <li className="text-gray-300">/</li>
                <li className="text-gray-700">Dashboard</li>
              </ol>
            </nav>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          </div>
        </div>

        {/* Executive KPI Cards with Trends */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          {(() => {
            const cards = [
              {
                title: 'TOTAL LEADS',
                value: stats.leads.total_leads,
                hint: 'View leads',
                href: '/leads',
                delta: deltas.leads,
                Icon: UserGroupIcon,
                deltaColor: '',
                iconBg: 'bg-white border border-purple-200',
                iconColor: 'text-[#64126D]',
                series: analytics.series.leads
              },
              {
                title: 'PROPOSAL COUNT',
                value: stats.proposals.total,
                hint: 'View Proposals',
                href: '/proposals',
                delta: deltas.proposals,
                Icon: DocumentTextIcon,
                deltaColor: '',
                iconBg: 'bg-white border border-purple-200',
                iconColor: 'text-[#64126D]',
                series: analytics.series.proposals
              },
              {
                title: 'COMPANIES',
                value: stats.companies.total,
                hint: 'View Companies',
                href: '/company',
                delta: deltas.companies,
                Icon: BuildingOfficeIcon,
                deltaColor: '',
                iconBg: 'bg-white border border-purple-200',
                iconColor: 'text-[#64126D]',
                series: analytics.series.companies
              },
              {
                title: 'PROJECTS',
                value: stats.projects.total,
                hint: 'View Projects',
                href: '/projects',
                delta: deltas.projects,
                Icon: FolderIcon,
                deltaColor: '',
                iconBg: 'bg-white border border-purple-200',
                iconColor: 'text-[#64126D]',
                series: analytics.series.projects
              }
            ];
            const formatDelta = (n) => {
              if (typeof n !== 'number' || isNaN(n)) return '0.0%';
              const sign = n > 0 ? '+' : n < 0 ? '' : '';
              return `${sign}${Math.abs(n).toFixed(1)}%`;
            };
            const deltaBadgeColor = (n) => {
              if (n > 0) return 'text-green-700 bg-green-50 border-green-200';
              if (n < 0) return 'text-red-700 bg-red-50 border-red-200';
              return 'text-gray-600 bg-gray-50 border-gray-200';
            };
            return cards.map((c, i) => {
              const Icon = c.Icon;
              return (
                <div key={i} className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2 min-h-[120px]">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-gray-500 tracking-widest">{c.title}</span>
                      <span className="text-2xl font-bold text-gray-900">{loading ? '…' : fmtNum.format(c.value || 0)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold border rounded px-2 py-0.5 ${deltaBadgeColor(c.delta)}`}>{formatDelta(c.delta)}</span>
                      <span className={`ml-2 h-9 w-9 rounded-lg flex items-center justify-center ${c.iconBg}`}>
                        <Icon className={`h-5 w-5 ${c.iconColor}`} />
                      </span>
                    </div>
                  </div>
                  {/* sparkline */}
                  <div className="mt-1">
                    <Sparkline values={c.series} />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <Link href={c.href} className="inline-flex items-center gap-1 text-xs text-[#64126D] font-semibold hover:underline">
                      {c.hint}
                    </Link>
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {/* All Projects Overview */}
        <AdminProjectsOverview />

        {/* Quick Actions */}
        <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-6 sm:p-8">
            <h3 className="text-xl leading-6 font-bold text-gray-900 mb-6">
              Quick Actions
            </h3>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <Link
                href="/leads"
                className="group relative bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-xl border-2 border-blue-200 hover:border-blue-400 hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1"
              >
                <div>
                  <span className="rounded-xl inline-flex p-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg">
                    <PlusIcon className="h-6 w-6" />
                  </span>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Add New Lead
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Create a new lead and start tracking potential customers.
                  </p>
                </div>
                <div className="absolute inset-0 rounded-xl bg-blue-600 opacity-0 group-hover:opacity-5 transition-opacity duration-300"></div>
              </Link>

              <Link
                href="/proposals"
                className="group relative bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-xl border-2 border-green-200 hover:border-green-400 hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1"
              >
                <div>
                  <span className="rounded-xl inline-flex p-3 bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg">
                    <DocumentTextIcon className="h-6 w-6" />
                  </span>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Create Proposal
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Generate a new proposal for your clients.
                  </p>
                </div>
                <div className="absolute inset-0 rounded-xl bg-green-600 opacity-0 group-hover:opacity-5 transition-opacity duration-300"></div>
              </Link>

              <Link
                href="/company"
                className="group relative bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-xl border-2 border-purple-200 hover:border-purple-400 hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1"
              >
                <div>
                  <span className="rounded-xl inline-flex p-3 bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg">
                    <BuildingOfficeIcon className="h-6 w-6" />
                  </span>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Add Company
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Add a new company to your database.
                  </p>
                </div>
                <div className="absolute inset-0 rounded-xl bg-[#64126D] opacity-0 group-hover:opacity-5 transition-opacity duration-300"></div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
