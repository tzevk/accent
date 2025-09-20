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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="px-4 sm:px-6 lg:px-8 py-8 mt-16">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
          <p className="text-gray-600">Welcome to AccentCRM! Manage your leads, proposals, and companies efficiently.</p>
        </div>

        {/* Quick Stats Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {/* Leads Card */}
          <div className="bg-white overflow-hidden shadow-lg rounded-xl border border-gray-200 hover:shadow-xl transition-all duration-300">
            <div className="p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-3 rounded-xl">
                    <UserGroupIcon className="h-6 w-6 text-white" />
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Total Leads
                    </dt>
                    <dd className="text-2xl font-bold text-gray-900">
                      {loading ? '...' : stats.leads.total_leads}
                    </dd>
                    <dd className="text-xs text-gray-600 mt-1">
                      {loading ? '' : `${stats.leads.under_discussion} under discussion, ${stats.leads.closed_won} won`}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-r from-blue-50 to-blue-100 px-6 py-3">
              <div className="text-sm">
                <Link href="/leads" className="font-semibold text-blue-600 hover:text-blue-700 flex items-center transition-colors">
                  <EyeIcon className="h-4 w-4 mr-1" />
                  View leads
                </Link>
              </div>
            </div>
          </div>

          {/* Proposals Card */}
          <div className="bg-white overflow-hidden shadow-lg rounded-xl border border-gray-200 hover:shadow-xl transition-all duration-300">
            <div className="p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="bg-gradient-to-r from-green-500 to-green-600 p-3 rounded-xl">
                    <DocumentTextIcon className="h-6 w-6 text-white" />
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Proposals
                    </dt>
                    <dd className="text-2xl font-bold text-gray-900">
                      {loading ? '...' : stats.proposals.total}
                    </dd>
                    <dd className="text-xs text-gray-600 mt-1">
                      {loading ? '' : `${stats.proposals.pending} pending, ${stats.proposals.approved} approved`}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-r from-green-50 to-green-100 px-6 py-3">
              <div className="text-sm">
                <Link href="/proposals" className="font-semibold text-green-600 hover:text-green-700 flex items-center transition-colors">
                  <EyeIcon className="h-4 w-4 mr-1" />
                  View proposals
                </Link>
              </div>
            </div>
          </div>

          {/* Companies Card */}
          <div className="bg-white overflow-hidden shadow-lg rounded-xl border border-gray-200 hover:shadow-xl transition-all duration-300">
            <div className="p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="bg-gradient-to-r from-[#64126D] to-[#86288F] p-3 rounded-xl">
                    <BuildingOfficeIcon className="h-6 w-6 text-white" />
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Companies
                    </dt>
                    <dd className="text-2xl font-bold text-gray-900">
                      {loading ? '...' : stats.companies.total}
                    </dd>
                    <dd className="text-xs text-gray-600 mt-1">
                      {loading ? '' : 'Registered companies'}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-r from-purple-50 to-purple-100 px-6 py-3">
              <div className="text-sm">
                <Link href="/company" className="font-semibold text-[#64126D] hover:text-[#86288F] flex items-center transition-colors">
                  <EyeIcon className="h-4 w-4 mr-1" />
                  View companies
                </Link>
              </div>
            </div>
          </div>

          {/* Projects Card */}
          <div className="bg-white overflow-hidden shadow-lg rounded-xl border border-gray-200 hover:shadow-xl transition-all duration-300">
            <div className="p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="bg-gradient-to-r from-indigo-500 to-indigo-600 p-3 rounded-xl">
                    <FolderIcon className="h-6 w-6 text-white" />
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Projects
                    </dt>
                    <dd className="text-2xl font-bold text-gray-900">
                      {loading ? '...' : stats.projects.total}
                    </dd>
                    <dd className="text-xs text-gray-600 mt-1">
                      {loading ? '' : `${stats.projects.in_progress} active, ${stats.projects.completed} completed`}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-r from-indigo-50 to-indigo-100 px-6 py-3">
              <div className="text-sm">
                <Link href="/projects" className="font-semibold text-indigo-600 hover:text-indigo-700 flex items-center transition-colors">
                  <EyeIcon className="h-4 w-4 mr-1" />
                  View projects
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Recent Activity */}
          <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="flex items-center">
                  <div className="bg-green-100 rounded-full p-2 mr-3">
                    <UserGroupIcon className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">New leads added</p>
                    <p className="text-xs text-gray-500">Track your growing pipeline</p>
                  </div>
                  <span className="text-sm font-semibold text-green-600">{loading ? '...' : stats.leads.total_leads}</span>
                </div>
                <div className="flex items-center">
                  <div className="bg-blue-100 rounded-full p-2 mr-3">
                    <DocumentTextIcon className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">Proposals created</p>
                    <p className="text-xs text-gray-500">Converting leads to opportunities</p>
                  </div>
                  <span className="text-sm font-semibold text-blue-600">{loading ? '...' : stats.proposals.total}</span>
                </div>
                <div className="flex items-center">
                  <div className="bg-purple-100 rounded-full p-2 mr-3">
                    <BuildingOfficeIcon className="h-4 w-4 text-[#64126D]" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">Companies registered</p>
                    <p className="text-xs text-gray-500">Expanding your network</p>
                  </div>
                  <span className="text-sm font-semibold text-[#64126D]">{loading ? '...' : stats.companies.total}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Pipeline Status */}
          <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Pipeline Status</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {/* Leads Progress */}
                <div>
                  <div className="flex justify-between text-sm font-medium text-gray-900 mb-1">
                    <span>Leads Under Discussion</span>
                    <span>{loading ? '...' : `${stats.leads.under_discussion}/${stats.leads.total_leads}`}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-300" 
                      style={{ 
                        width: loading ? '0%' : `${stats.leads.total_leads > 0 ? (stats.leads.under_discussion / stats.leads.total_leads) * 100 : 0}%` 
                      }}
                    ></div>
                  </div>
                </div>

                {/* Proposals Progress */}
                <div>
                  <div className="flex justify-between text-sm font-medium text-gray-900 mb-1">
                    <span>Proposals Approved</span>
                    <span>{loading ? '...' : `${stats.proposals.approved}/${stats.proposals.total}`}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full transition-all duration-300" 
                      style={{ 
                        width: loading ? '0%' : `${stats.proposals.total > 0 ? (stats.proposals.approved / stats.proposals.total) * 100 : 0}%` 
                      }}
                    ></div>
                  </div>
                </div>

                {/* Projects Progress */}
                <div>
                  <div className="flex justify-between text-sm font-medium text-gray-900 mb-1">
                    <span>Projects Completed</span>
                    <span>{loading ? '...' : `${stats.projects.completed}/${stats.projects.total}`}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-[#64126D] to-[#86288F] h-2 rounded-full transition-all duration-300" 
                      style={{ 
                        width: loading ? '0%' : `${stats.projects.total > 0 ? (stats.projects.completed / stats.projects.total) * 100 : 0}%` 
                      }}
                    ></div>
                  </div>
                </div>
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
