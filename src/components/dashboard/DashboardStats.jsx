'use client';

import { useState, useEffect } from 'react';
import { 
  UserGroupIcon,
  DocumentTextIcon,
  BuildingOfficeIcon,
  FolderIcon
} from '@heroicons/react/24/outline';

export default function DashboardStats() {
  const [stats, setStats] = useState({
    leads: { total_leads: 0, under_discussion: 0, closed_won: 0 },
    proposals: { total: 0, pending: 0, approved: 0 },
    companies: { total: 0 },
    projects: { total: 0, in_progress: 0, completed: 0 }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const fetchStats = async () => {
      try {
        // Parallel fetch for better performance
        const [leadsRes, proposalsRes, companiesRes, projectsRes] = await Promise.all([
          fetch('/api/leads?limit=1'),
          fetch('/api/proposals'),
          fetch('/api/companies'),
          fetch('/api/projects')
        ]);

        if (!mounted) return;

        const [leadsData, proposalsData, companiesData, projectsData] = await Promise.all([
          leadsRes.json(),
          proposalsRes.json(),
          companiesRes.json(),
          projectsRes.json()
        ]);

        if (!mounted) return;

        if (leadsData.success && proposalsData.success && companiesData.success && projectsData.success) {
          const proposals = proposalsData.data || [];
          const projects = projectsData.data || [];

          setStats({
            leads: leadsData.data?.stats || { total_leads: 0, under_discussion: 0, closed_won: 0 },
            proposals: {
              total: proposals.length,
              pending: proposals.filter(p => p.status === 'pending').length,
              approved: proposals.filter(p => p.status === 'approved').length
            },
            companies: { total: companiesData.data?.length || 0 },
            projects: {
              total: projects.length,
              in_progress: projects.filter(p => p.status === 'in-progress').length,
              completed: projects.filter(p => p.status === 'completed').length
            }
          });
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchStats();
    return () => { mounted = false; };
  }, []);

  const statCards = [
    {
      title: 'Total Leads',
      value: stats.leads.total_leads,
      subtitle: `${stats.leads.under_discussion} in discussion`,
      icon: UserGroupIcon,
      color: 'bg-blue-500',
      lightBg: 'bg-blue-50',
      textColor: 'text-blue-600'
    },
    {
      title: 'Proposals',
      value: stats.proposals.total,
      subtitle: `${stats.proposals.pending} pending`,
      icon: DocumentTextIcon,
      color: 'bg-green-500',
      lightBg: 'bg-green-50',
      textColor: 'text-green-600'
    },
    {
      title: 'Companies',
      value: stats.companies.total,
      subtitle: 'Active clients',
      icon: BuildingOfficeIcon,
      color: 'bg-purple-500',
      lightBg: 'bg-purple-50',
      textColor: 'text-purple-600'
    },
    {
      title: 'Projects',
      value: stats.projects.total,
      subtitle: `${stats.projects.in_progress} in progress`,
      icon: FolderIcon,
      color: 'bg-orange-500',
      lightBg: 'bg-orange-50',
      textColor: 'text-orange-600'
    }
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-32 bg-gray-200 animate-pulse rounded-xl"></div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {statCards.map((stat, idx) => (
        <div
          key={idx}
          className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 ${stat.lightBg} rounded-lg flex items-center justify-center`}>
              <stat.icon className={`w-6 h-6 ${stat.textColor}`} />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-600 mb-1">{stat.title}</p>
            <p className="text-3xl font-bold text-gray-900 mb-1">{stat.value.toLocaleString()}</p>
            <p className="text-xs text-gray-500">{stat.subtitle}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
