
'use client';

import Navbar from '@/components/Navbar';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { fetchJSON } from '@/utils/http';
import dynamic from 'next/dynamic';
import InteractiveDonut from '@/components/InteractiveDonut';
import { 
  UserGroupIcon,
  DocumentTextIcon,
  BuildingOfficeIcon,
  FolderIcon,
  ChartBarIcon,
  PlusIcon,
  EyeIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon
} from '@heroicons/react/24/outline';
import { useSessionRBAC } from '@/utils/client-rbac';
import ActivityAssignmentsSection from '@/components/ActivityAssignmentsSection';
const UserDashboard = dynamic(() => import('./user-dashboard'), { ssr: false });
// const DonutChart = dynamic(() => import('@/components/DonutChart'), { ssr: false });
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from 'recharts';

export default function Dashboard() {
  const { user } = useSessionRBAC();
  const [stats, setStats] = useState({
    leads: { total_leads: 0, under_discussion: 0, proposal_sent: 0, closed_won: 0 },
    proposals: { total: 0, pending: 0, approved: 0, draft: 0 },
    companies: { total: 0 },
    projects: { total: 0, in_progress: 0, completed: 0 }
  });
  const [loading, setLoading] = useState(true);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsList, setLeadsList] = useState([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsPage, setLeadsPage] = useState(1);
  const rowsPerPage = 10;
  const [followupsByLead, setFollowupsByLead] = useState({});
  const [deltas, setDeltas] = useState({ leads: 0, proposals: 0, companies: 0, projects: 0 });
  const [analyticsPeriod, setAnalyticsPeriod] = useState('Weekly'); // Weekly | Monthly | Quarterly
  const [salesMetric, setSalesMetric] = useState('count'); // 'count' | 'value' (default to count for wider compatibility)
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const fmtNum = new Intl.NumberFormat('en-IN');
  const [leadsError, setLeadsError] = useState(null);
  const [analytics, setAnalytics] = useState({
    funnel: { new: 0, discussion: 0, proposal: 0, won: 0, lost: 0 },
    topCities: [],
    series: { leads: [], proposals: [], companies: [], projects: [] },
    activity: { followupsThisWeek: 0, followupsPrevWeek: 0 }
  });
  const [leadsAll, setLeadsAll] = useState([]);
  // Real Sales Analytics from backend
  const [salesData, setSalesData] = useState([]);
  const [salesTotals, setSalesTotals] = useState({ total: 0, conversion: 0 });
  const [projectSeries, setProjectSeries] = useState([]); // {label, value}[] for bar chart
  
  
  useEffect(() => {
    // Load project bar series AND sales (proposals) donut data independently.
    let abort = false;

    const loadProjects = async () => {
      try {
        const url = `/api/analytics/projects?period=${encodeURIComponent(analyticsPeriod)}&metric=${encodeURIComponent(salesMetric)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!abort && json?.success) {
          setProjectSeries(Array.isArray(json.series) ? json.series : []);
        }
      } catch {
        if (!abort) setProjectSeries([]);
      }
    };

    const loadSales = async (metricToUse) => {
      try {
        const url = `/api/analytics/sales?period=${encodeURIComponent(analyticsPeriod)}&metric=${encodeURIComponent(metricToUse)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!abort && json?.success) {
          const arr = Array.isArray(json.data) ? json.data : [];
          const hasNonZero = arr.some(d => (Number(d.value) || 0) > 0);
          if (hasNonZero) {
            setSalesData(arr);
            setSalesTotals({ total: Number(json.total) || 0, conversion: Number(json.conversion) || 0 });
            return true;
          }
        }
      } catch {
        // ignore
      }
      return false;
    };

    const load = async () => {
      await loadProjects();
      const ok = await loadSales(salesMetric);
      if (!ok && salesMetric === 'value') {
        const okCount = await loadSales('count');
        if (okCount && !abort) {
          setSalesMetric('count');
          try { if (typeof window !== 'undefined') localStorage.setItem('salesMetric', 'count'); } catch {}
          return;
        }
      }
      if (!ok && !abort) {
        setSalesData([]);
        setSalesTotals({ total: 0, conversion: 0 });
      }
    };

    load();
    return () => { abort = true; };
  }, [analyticsPeriod, salesMetric]);

  // Persist and restore user's preferred sales metric
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('salesMetric') : null;
      if (saved === 'count' || saved === 'value') setSalesMetric(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') localStorage.setItem('salesMetric', salesMetric);
    } catch {}
  }, [salesMetric]);

  // Compact Indian currency formatter (K, Lakh, Crore)
  const formatINRCompact = (n, withSymbol = true) => {
    const num = Number(n) || 0;
    const abs = Math.abs(num);
    let value = num;
    let suffix = '';
    if (abs >= 1e7) { // Crore
      value = num / 1e7;
      suffix = 'Cr';
    } else if (abs >= 1e5) { // Lakh
      value = num / 1e5;
      suffix = 'L';
    } else if (abs >= 1e3) { // Thousand
      value = num / 1e3;
      suffix = 'K';
    }
    const fixed = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
    const sign = num < 0 ? '-' : '';
    return `${withSymbol ? '₹' : ''}${sign}${fixed}${suffix}`;
  };

// 1. Fetch Stats - safe, no dependencies
useEffect(() => {
  fetchStats();
}, []);

// 2. Define fetchLeadsPage BEFORE using it in another useEffect
const fetchLeadsPage = useCallback(async (page) => {
  try {
    setLeadsLoading(true);
    setLeadsError(null);

    const res = await fetch(
      `/api/leads?page=${page}&limit=${rowsPerPage}&sortBy=${encodeURIComponent(sortBy)}&sortOrder=${encodeURIComponent(sortOrder)}`
    );
    const data = await res.json();

    if (data.success) {
      const rawLeads = Array.isArray(data.data?.leads) ? data.data.leads : [];

      const normalized = rawLeads.map(l => ({
        id: l.id ?? l.lead_id ?? null,
        lead_id: l.lead_id ?? null,
        city: l.city ?? l.location ?? '',
        contact_name: l.contact_name ?? l.director ?? '',
        enquiry_status: l.enquiry_status ?? l.status ?? '',
        enquiry_date: l.enquiry_date ?? l.deadline ?? l.created_at ?? null,
        created_at: l.created_at ?? null,
      }));

      setLeadsList(normalized);
      setLeadsTotal(Number(data.data.pagination?.total || normalized.length || 0));
      setLeadsError(null);
    } else {
      setLeadsError(data.error || 'Failed to fetch leads');
      setLeadsList([]);
      setLeadsTotal(0);
    }

    // fetch followups
    try {
      const fuRes = await fetch('/api/followups');
      const fuData = await fuRes.json();
      const map = {};

      (fuData.data || []).forEach(f => {
        map[f.lead_id] = (map[f.lead_id] || 0) + 1;
      });

      setFollowupsByLead(map);
    } catch (e) {
      console.warn('Followups fetch failed (optional):', e);
    }

  } catch (e) {
    console.error('Failed to fetch leads page', e);
    setLeadsError('Failed to fetch leads');
    setLeadsList([]);
    setLeadsTotal(0);
  } finally {
    setLeadsLoading(false);
  }
}, [rowsPerPage, sortBy, sortOrder]); 
// only depends on sort order + rowsPerPage
// IMPORTANT: does NOT depend on leadsPage or it will break pagination
// IMPORTANT: stable reference => safe for useEffect
  

// 3. This useEffect now safely runs AFTER the callback is initialized
useEffect(() => {
  fetchLeadsPage(leadsPage);
}, [leadsPage, sortBy, sortOrder, fetchLeadsPage]);

  // Persist analytics period across visits
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('analyticsPeriod') : null;
      if (saved) setAnalyticsPeriod(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') localStorage.setItem('analyticsPeriod', analyticsPeriod);
    } catch {}
  }, [analyticsPeriod]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      
      // Fetch leads stats
  const leadsData = await fetchJSON('/api/leads?limit=1');
      
      // Fetch proposals stats
  const proposalsData = await fetchJSON('/api/proposals');
      
      // Fetch companies stats
  const companiesData = await fetchJSON('/api/companies');
      
      // Fetch projects stats
  const projectsData = await fetchJSON('/api/projects');
      
  if (leadsData.success && proposalsData.success && companiesData.success && projectsData.success) {
        // Calculate proposal stats
        const proposals = proposalsData.data || [];
        const proposalStats = {
          total: proposals.length,
          pending: proposals.filter(p => p.status === 'pending').length,
          approved: proposals.filter(p => p.status === 'approved').length,
          draft: proposals.filter(p => p.status === 'draft').length
        };
        
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
          const leadsAll = await fetchJSON('/api/leads?limit=10000&sortBy=created_at&sortOrder=desc');
          leadsArr = leadsAll.success ? (leadsAll.data?.leads || []) : [];
          setLeadsAll(leadsArr);
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
          const now = new Date();
          const last7 = new Date(now); last7.setDate(now.getDate()-7);
          const prev7 = new Date(now); prev7.setDate(now.getDate()-14);
          const inR = (d, s, e) => d && d>=s && d<e;
          const toDate = (x) => x?.created_at ? new Date(x.created_at) : (x?.date ? new Date(x.date) : null);
          const curr = fu.reduce((a,f)=> a + (inR(toDate(f), last7, now) ? 1 : 0), 0);
          const prev = fu.reduce((a,f)=> a + (inR(toDate(f), prev7, last7) ? 1 : 0), 0);
          activity = { followupsThisWeek: curr, followupsPrevWeek: prev };
        } catch {}

        setAnalytics({ funnel, topCities, series, activity });
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };


  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setLeadsPage(1);
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

  const downloadLeadsCSV = () => {
    try {
      const rows = leadsAll.length ? leadsAll : leadsList;
      if (!rows || !rows.length) return;
      const cols = ['id','company','contact_name','city','enquiry_status','enquiry_date','created_at'];
      const header = cols.join(',');
      const esc = (s) => `"${String(s ?? '').replaceAll('"','""')}"`;
      const lines = rows.map(r => cols.map(c => esc(r[c])).join(','));
      const csv = [header, ...lines].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'leads_snapshot.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { console.error('CSV export failed', e); }
  };

  const progressFromStatus = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('closed won') || s.includes('won')) return 100;
    if (s.includes('proposal')) return 75;
    if (s.includes('follow')) return 60;
    if (s.includes('discussion')) return 45;
    if (s.includes('lost')) return 10;
    return 25;
  };

  const conversionFromStatus = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('closed won') || s.includes('won')) return 90;
    if (s.includes('proposal')) return 65;
    if (s.includes('follow')) return 55;
    if (s.includes('discussion')) return 35;
    if (s.includes('lost')) return 8;
    return 20;
  };

  const formatDate = (d) => {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '-';
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = dt.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  // If user role is 'user' (not admin), show simplified user dashboard
  if (user && !user.is_super_admin && user.role?.code !== 'admin') {
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
          <div className="flex items-center gap-2">
            <button className="inline-flex items-center gap-2 rounded-lg bg-[#64126D] text-white text-sm px-3.5 py-2 shadow-sm hover:bg-[#5a1161]">
              <PlusIcon className="h-4 w-4" />
              Add Product
            </button>
            <button className="inline-flex items-center justify-center rounded-lg border border-purple-200 text-[#64126D] px-3 py-2 hover:bg-purple-50">
              <ChartBarIcon className="h-5 w-5" />
            </button>
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

        {/* Activity Assignments Section */}
        {user?.id && <ActivityAssignmentsSection userId={user.id} />}


        {/* Analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Project Analytics - interactive bar chart */}
          {(() => {
            const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const quarters = ['Q1','Q2','Q3','Q4'];

            // Use backend-provided series directly; fallback to zeroes sized by period labels
            const fallbackData = (labels) => labels.map(l => ({ label: l, value: 0 }));
            const labelSet = analyticsPeriod === 'Weekly' ? days : (analyticsPeriod === 'Monthly' ? months : quarters);
            const data = projectSeries && projectSeries.length ? projectSeries : fallbackData(labelSet);

            return (
              <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-purple-200 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Project Analytics</h3>
                  <select
                    value={analyticsPeriod}
                    onChange={(e) => setAnalyticsPeriod(e.target.value)}
                    className="text-xs px-2 py-1 rounded-md border border-purple-200 text-[#64126D] bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                  >
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                  </select>
                </div>
                <div className="p-4" style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={{ stroke: '#E5E7EB' }} />
                      <RTooltip cursor={{ fill: 'rgba(100,18,109,0.06)' }} formatter={(v) => [v, 'Projects']} labelFormatter={(l) => `${l}`} />
                      <Bar dataKey="value" fill="#64126D" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* Sales Analytics - Donut chart for proposal distribution */}
          {(() => {
            const data = salesData;
            const total = salesTotals.total;
            const conv = salesTotals.conversion;
            return (
              <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-purple-200 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Sales Analytics</h3>
                  <div className="flex items-center gap-2">
                    <select
                      value={analyticsPeriod}
                      onChange={(e) => setAnalyticsPeriod(e.target.value)}
                      className="text-xs px-2 py-1 rounded-md border border-purple-200 text-[#64126D] bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                    >
                      <option value="Weekly">Weekly</option>
                      <option value="Monthly">Monthly</option>
                      <option value="Quarterly">Quarterly</option>
                    </select>
                    <select
                      value={salesMetric}
                      onChange={(e) => setSalesMetric(e.target.value)}
                      className="text-xs px-2 py-1 rounded-md border border-purple-200 text-[#64126D] bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                    >
                      <option value="count">Count</option>
                      <option value="value">Value</option>
                    </select>
                  </div>
                </div>
                <div className="relative p-6">
                  {(!data || data.length === 0 || data.every(d => (Number(d.value) || 0) === 0)) ? (
                    <div className="h-64 flex flex-col items-center justify-center text-center text-gray-600">
                      <div className="text-sm">No {salesMetric === 'value' ? 'income' : 'project'} data for the selected period.</div>
                      <div className="text-xs mt-2">{salesMetric === 'value' ? 'Add budget to projects or switch to count' : 'Try a different period'}.</div>
                      <div className="mt-3">
                        {salesMetric === 'value' && (
                          <button
                            onClick={() => setSalesMetric('count')}
                            className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-purple-50 text-[#64126D] border border-purple-200 hover:bg-purple-100"
                          >
                            View Counts
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                      <InteractiveDonut
                        data={data}
                        totalLabel={salesMetric === 'value' ? 'Income' : 'Projects'}
                        showLegend={false}
                        showTotalBelow={false}
                        animationBegin={60}
                        animationDuration={520}
                        animationEasing="ease-out"
                        valueFormatter={salesMetric === 'value' ? formatINRCompact : undefined}
                      />
                      <div>
                        <div className="space-y-2">
                          {data.map((d) => (
                            <div key={d.name} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: d.color }} />
                                <span className="text-gray-800 font-medium">{d.name}</span>
                              </div>
                              <span className="text-gray-600">{salesMetric === 'value' ? formatINRCompact(d.value) : d.value}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-gray-700">
                          <div><span className="font-bold">{salesMetric === 'value' ? formatINRCompact(total) : total}</span> Total</div>
                          <div><span className="font-bold">{conv}%</span> Conversion</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Executive Insights: Funnel, Top Locations, Activity */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
          {/* Sales Funnel */}
          <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-purple-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Sales Funnel</h3>
              <button onClick={downloadLeadsCSV} className="text-xs px-2 py-1 rounded-md border border-purple-200 text-[#64126D]">Export CSV</button>
            </div>
            <div className="p-6">
              {(() => {
                const total = Object.values(analytics.funnel).reduce((a,b)=>a+b,0) || 1;
                // Brand-aligned fills and neutral track
                const rows = [
                  { label: 'New', key: 'new', fill: '#9CA3AF' },            // gray-400
                  { label: 'Under Discussion', key: 'discussion', fill: '#64126D' }, // brand purple
                  { label: 'Proposal Sent', key: 'proposal', fill: '#6366F1' },     // indigo-500
                  { label: 'Won', key: 'won', fill: '#10B981' },                    // emerald-500
                  { label: 'Lost', key: 'lost', fill: '#EF4444' },                  // red-500
                ];
                return (
                  <div className="space-y-3">
                    {rows.map((r, idx) => {
                      const v = analytics.funnel[r.key] || 0;
                      const pct = Math.round((v/total)*100);
                      return (
                        <div key={idx}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="font-medium text-gray-800 flex items-center gap-2">
                              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.fill }} />
                              {r.label}
                            </span>
                            <span className="text-gray-600">{v} ({pct}%)</span>
                          </div>
                          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: r.fill }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Top Locations */}
          <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-purple-200">
              <h3 className="text-lg font-semibold text-gray-900">Top Locations</h3>
            </div>
            <div className="p-6">
              {analytics.topCities.length === 0 ? (
                <div className="text-sm text-gray-600">Not enough data</div>
              ) : (
                <ul className="space-y-3">
                  {analytics.topCities.map((c) => (
                    <li key={c.city} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-2 w-2 rounded-full bg-[#64126D]" />
                        <span className="text-gray-800 font-medium">{c.city}</span>
                      </div>
                      <span className="text-gray-600 text-sm">{c.count} leads</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Activity Snapshot */}
          <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-purple-200">
              <h3 className="text-lg font-semibold text-gray-900">Activity Snapshot</h3>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="text-xs text-gray-600">Follow-ups (7d)</div>
                <div className="text-2xl font-bold text-[#64126D]">{analytics.activity.followupsThisWeek}</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="text-xs text-gray-600">Previous (7d)</div>
                <div className="text-2xl font-bold text-gray-700">{analytics.activity.followupsPrevWeek}</div>
              </div>
              <div className="col-span-2 text-xs text-gray-600">
                {(() => {
                  const a = analytics.activity.followupsThisWeek;
                  const b = analytics.activity.followupsPrevWeek || 0;
                  if (b === 0 && a === 0) return 'No activity recorded in the last two weeks';
                  const chg = b === 0 ? 100 : Math.round(((a-b)/b)*100);
                  const sign = chg >= 0 ? '+' : '';
                  return `Week over week change: ${sign}${chg}%`;
                })()}
              </div>
            </div>
          </div>
        </div>
        {/* Leads */}
        <div className="bg-white rounded-xl border border-purple-200 overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-purple-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Leads</h3>
            <button className="text-xs px-2 py-1 rounded-md border border-purple-200 text-[#64126D] inline-flex items-center gap-1">Progress <ChevronDownIcon className="h-3.5 w-3.5" /></button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#64126D] text-white">
                <tr>
                  <th className="px-4 py-3 text-left font-medium w-10"><input type="checkbox" className="accent-[#64126D]" /></th>
                  <th className="px-4 py-3 text-left font-medium">
                    <button onClick={() => toggleSort('city')} className="inline-flex items-center gap-1">
                      Location
                      <span className="text-[10px]">{sortBy==='city' ? (sortOrder==='asc' ? '▲' : '▼') : ''}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    <button onClick={() => toggleSort('contact_name')} className="inline-flex items-center gap-1">
                      Director
                      <span className="text-[10px]">{sortBy==='contact_name' ? (sortOrder==='asc' ? '▲' : '▼') : ''}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Progress %</th>
                  <th className="px-4 py-3 text-left font-medium">
                    <button onClick={() => toggleSort('enquiry_date')} className="inline-flex items-center gap-1">
                      Deadline
                      <span className="text-[10px]">{sortBy==='enquiry_date' ? (sortOrder==='asc' ? '▲' : '▼') : ''}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Conversion %</th>
                  <th className="px-4 py-3 text-left font-medium">Visiting</th>
                  <th className="px-4 py-3 text-left font-medium">
                    <button onClick={() => toggleSort('enquiry_status')} className="inline-flex items-center gap-1">
                      Status
                      <span className="text-[10px]">{sortBy==='enquiry_status' ? (sortOrder==='asc' ? '▲' : '▼') : ''}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leadsLoading ? (
                  [...Array(rowsPerPage)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-4 py-4"><div className="h-4 w-4 bg-gray-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-4"><div className="h-4 w-28 bg-gray-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-4"><div className="h-4 w-40 bg-gray-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-4"><div className="h-3 w-24 bg-gray-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-4"><div className="h-4 w-24 bg-gray-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-4"><div className="h-3 w-20 bg-gray-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-4"><div className="h-4 w-20 bg-gray-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-4"><div className="h-6 w-20 bg-gray-100 rounded-full animate-pulse" /></td>
                    </tr>
                  ))
                ) : leadsError ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-red-700 bg-red-50">
                      <div className="flex items-center justify-center gap-3">
                        <span>{String(leadsError)}</span>
                        <button
                          onClick={() => fetchLeadsPage(leadsPage)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#64126D] text-white border border-[#64126D]"
                        >
                          Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : leadsList.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-600">
                      <div className="flex flex-col items-center gap-2">
                        <EyeIcon className="h-6 w-6 text-gray-400" />
                        <div className="font-medium">No leads found</div>
                        <div className="text-xs">
                          {leadsError ? 'Leads failed to load.' : 'Either there are no leads yet or data columns are missing.'}
                        </div>
                        <Link href="/leads/new" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-50 text-[#64126D] border border-purple-200 hover:bg-purple-100 mt-2">Add Lead</Link>
                      </div>
                    </td>
                  </tr>
                ) : (
                  leadsList.map((lead) => {
                    const progress = progressFromStatus(lead.enquiry_status);
                    const conversion = conversionFromStatus(lead.enquiry_status);
                    const visiting = followupsByLead[lead.id] || 0;
                    const initials = (lead.contact_name || '-').split(' ').map(p=>p[0]).slice(0,2).join('').toUpperCase();
                    return (
                      <tr key={lead.id} className="hover:bg-purple-50/40">
                        <td className="px-4 py-4"><input type="checkbox" className="accent-[#64126D]" /></td>
                        <td className="px-4 py-4 text-gray-900">
                          <Link href={`/leads/${lead.id}`} className="hover:underline inline-flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-[#64126D]" />
                            {lead.city || '-'}
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-gray-700">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-purple-100 text-[#64126D] text-[10px] font-semibold border border-purple-200">{initials || '?'}</span>
                            {lead.contact_name || '-'}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-28 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-2 bg-[#64126D]" style={{ width: `${progress}%` }} />
                            </div>
                            <span className="text-xs text-gray-700 font-medium">{progress}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-gray-700">{formatDate(lead.enquiry_date || lead.created_at)}</td>
                        <td className="px-4 py-4 text-gray-700">{conversion}%</td>
                        <td className="px-4 py-4 text-gray-700">{visiting} {visiting === 1 ? 'person' : 'people'}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border ${String(lead.enquiry_status||'').toLowerCase().includes('progress') ? 'bg-purple-50 text-[#64126D] border-purple-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                            {lead.enquiry_status || '-'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-purple-200 flex items-center justify-between text-xs">
            <div className="text-gray-600">Rows per page: {rowsPerPage}</div>
            <div className="flex items-center gap-4 text-gray-600">
              <span>
                {leadsList.length === 0 ? '0-0' : `${(leadsPage - 1) * rowsPerPage + 1}-${(leadsPage - 1) * rowsPerPage + leadsList.length}`} of {leadsTotal}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLeadsPage(Math.max(1, leadsPage - 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-50 text-[#64126D] border border-purple-200 disabled:opacity-50"
                  disabled={leadsPage === 1}
                >
                  <ArrowLeftIcon className="h-4 w-4" /> Previous
                </button>
                <button
                  onClick={() => setLeadsPage(leadsPage + 1)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#64126D] text-white border border-[#64126D] disabled:opacity-50"
                  disabled={(leadsPage * rowsPerPage) >= leadsTotal}
                >
                  Next <ArrowRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

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
