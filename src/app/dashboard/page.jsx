'use client';

import Navbar from '@/components/Navbar';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { 
  UserGroupIcon,
  DocumentTextIcon,
  BuildingOfficeIcon,
  FolderIcon,
  ChartBarIcon,
  PlusIcon,
  EyeIcon
} from '@heroicons/react/24/outline';

export default function Dashboard() {
  const [stats, setStats] = useState({
    leads: { total_leads: 0, under_discussion: 0, proposal_sent: 0, closed_won: 0 },
    proposals: { total: 0, pending: 0, approved: 0, draft: 0 },
    companies: { total: 0 },
    projects: { total: 0, in_progress: 0, completed: 0 }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      
      // Fetch leads stats
      const leadsResponse = await fetch('/api/leads?limit=1');
      const leadsData = await leadsResponse.json();
      
      // Fetch proposals stats
      const proposalsResponse = await fetch('/api/proposals');
      const proposalsData = await proposalsResponse.json();
      
      // Fetch companies stats
      const companiesResponse = await fetch('/api/companies');
      const companiesData = await companiesResponse.json();
      
      // Fetch projects stats
      const projectsResponse = await fetch('/api/projects');
      const projectsData = await projectsResponse.json();
      
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
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      
      <div className="flex-1 overflow-hidden">
        <div className="h-full px-8 pt-22">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-accent-primary">Dashboard</h1>
            <p className="text-gray-600">Welcome to AccentCRM! Manage your leads, proposals, and companies.</p>
          </div>

        {/* Quick Stats Cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {/* Leads Card */}
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <UserGroupIcon className="h-6 w-6 text-blue-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Total Leads
                    </dt>
                    <dd className="text-lg font-semibold text-gray-900">
                      {loading ? '...' : stats.leads.total_leads}
                    </dd>
                    <dd className="text-sm text-gray-600">
                      {loading ? '' : `${stats.leads.under_discussion} under discussion, ${stats.leads.closed_won} won`}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 px-5 py-3">
              <div className="text-sm">
                <Link href="/leads" className="font-medium text-blue-600 hover:text-blue-500 flex items-center">
                  <EyeIcon className="h-4 w-4 mr-1" />
                  View leads
                </Link>
              </div>
            </div>
          </div>

          {/* Proposals Card */}
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <DocumentTextIcon className="h-6 w-6 text-green-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Proposals
                    </dt>
                    <dd className="text-lg font-semibold text-gray-900">
                      {loading ? '...' : stats.proposals.total}
                    </dd>
                    <dd className="text-sm text-gray-600">
                      {loading ? '' : `${stats.proposals.pending} pending, ${stats.proposals.approved} approved`}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 px-5 py-3">
              <div className="text-sm">
                <Link href="/proposals" className="font-medium text-green-600 hover:text-green-500 flex items-center">
                  <EyeIcon className="h-4 w-4 mr-1" />
                  View proposals
                </Link>
              </div>
            </div>
          </div>

          {/* Companies Card */}
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <BuildingOfficeIcon className="h-6 w-6 text-purple-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Companies
                    </dt>
                    <dd className="text-lg font-semibold text-gray-900">
                      {loading ? '...' : stats.companies.total}
                    </dd>
                    <dd className="text-sm text-gray-600">
                      {loading ? '' : 'Registered companies'}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 px-5 py-3">
              <div className="text-sm">
                <Link href="/company" className="font-medium text-purple-600 hover:text-purple-500 flex items-center">
                  <EyeIcon className="h-4 w-4 mr-1" />
                  View companies
                </Link>
              </div>
            </div>
          </div>

          {/* Projects Card */}
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FolderIcon className="h-6 w-6 text-indigo-600" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Projects
                    </dt>
                    <dd className="text-lg font-semibold text-gray-900">
                      {loading ? '...' : stats.projects.total}
                    </dd>
                    <dd className="text-sm text-gray-600">
                      {loading ? '' : `${stats.projects.in_progress} active, ${stats.projects.completed} completed`}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 px-5 py-3">
              <div className="text-sm">
                <Link href="/projects" className="font-medium text-indigo-600 hover:text-indigo-500 flex items-center">
                  <EyeIcon className="h-4 w-4 mr-1" />
                  View projects
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Quick Actions
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Link
                href="/leads"
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-500 rounded-lg border border-gray-200 hover:border-blue-300 transition-colors"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-blue-50 text-blue-600 ring-4 ring-white">
                    <PlusIcon className="h-6 w-6" />
                  </span>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-medium">
                    <span className="absolute inset-0" aria-hidden="true" />
                    Add New Lead
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    Create a new lead and start tracking potential customers.
                  </p>
                </div>
              </Link>

              <Link
                href="/proposals"
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-green-500 rounded-lg border border-gray-200 hover:border-green-300 transition-colors"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-green-50 text-green-600 ring-4 ring-white">
                    <DocumentTextIcon className="h-6 w-6" />
                  </span>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-medium">
                    <span className="absolute inset-0" aria-hidden="true" />
                    Create Proposal
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    Generate a new proposal for your clients.
                  </p>
                </div>
              </Link>

              <Link
                href="/company"
                className="relative group bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-purple-500 rounded-lg border border-gray-200 hover:border-purple-300 transition-colors"
              >
                <div>
                  <span className="rounded-lg inline-flex p-3 bg-purple-50 text-purple-600 ring-4 ring-white">
                    <BuildingOfficeIcon className="h-6 w-6" />
                  </span>
                </div>
                <div className="mt-4">
                  <h3 className="text-lg font-medium">
                    <span className="absolute inset-0" aria-hidden="true" />
                    Add Company
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    Add a new company to your database.
                  </p>
                </div>
              </Link>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
