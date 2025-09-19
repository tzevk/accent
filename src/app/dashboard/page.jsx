'use client';

import Layout from '@/components/Layout';
import StatsCard from '@/components/StatsCard';
import Link from 'next/link';
import { 
  DocumentTextIcon, 
  UserGroupIcon, 
  BriefcaseIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  PlusIcon
} from '@heroicons/react/24/outline';

export default function Dashboard() {
  // Mock data - replace with real data from your API
  const stats = [
    {
      title: 'Active Proposals',
      value: '12',
      change: '+2 this week',
      changeType: 'positive',
      icon: DocumentTextIcon,
      color: 'primary'
    },
    {
      title: 'Qualified Leads',
      value: '34',
      change: '+8 this month',
      changeType: 'positive',
      icon: UserGroupIcon,
      color: 'secondary'
    },
    {
      title: 'Active Projects',
      value: '8',
      change: '+1 this week',
      changeType: 'positive',
      icon: BriefcaseIcon,
      color: 'primary'
    }
  ];

  const recentActivities = [
    { type: 'proposal', message: 'New proposal created for Acme Corp', time: '2 hours ago' },
    { type: 'lead', message: 'Lead John Smith converted to project', time: '4 hours ago' },
    { type: 'project', message: 'Project "Website Redesign" completed', time: '1 day ago' },
    { type: 'proposal', message: 'Proposal approved by TechStart Inc', time: '2 days ago' },
  ];

  return (
    <Layout 
      title="Dashboard" 
      subtitle="Overview of your CRM activity and performance"
    >
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {stats.map((stat, index) => (
          <StatsCard key={index} {...stat} />
        ))}
      </div>

      {/* Action Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold text-accent-primary mb-4 flex items-center">
            <PlusIcon className="h-6 w-6 mr-2" />
            Quick Actions
          </h2>
          <div className="space-y-3">
            <Link 
              href="/proposals/new"
              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-accent-primary hover:text-white transition-colors group"
            >
              <div className="flex items-center">
                <DocumentTextIcon className="h-5 w-5 text-accent-primary group-hover:text-white mr-3" />
                <span className="font-medium">Create New Proposal</span>
              </div>
              <span className="text-gray-400 group-hover:text-white">→</span>
            </Link>
            
            <Link 
              href="/leads/new"
              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-accent-secondary hover:text-white transition-colors group"
            >
              <div className="flex items-center">
                <UserGroupIcon className="h-5 w-5 text-accent-secondary group-hover:text-white mr-3" />
                <span className="font-medium">Add New Lead</span>
              </div>
              <span className="text-gray-400 group-hover:text-white">→</span>
            </Link>
            
            <Link 
              href="/projects/new"
              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-accent-primary hover:text-white transition-colors group"
            >
              <div className="flex items-center">
                <BriefcaseIcon className="h-5 w-5 text-accent-primary group-hover:text-white mr-3" />
                <span className="font-medium">Start New Project</span>
              </div>
              <span className="text-gray-400 group-hover:text-white">→</span>
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold text-accent-primary mb-4 flex items-center">
            <ChartBarIcon className="h-6 w-6 mr-2" />
            Recent Activity
          </h2>
          <div className="space-y-4">
            {recentActivities.map((activity, index) => (
              <div key={index} className="flex items-start space-x-3">
                <div className={`w-2 h-2 rounded-full mt-2 ${
                  activity.type === 'proposal' ? 'bg-accent-primary' :
                  activity.type === 'lead' ? 'bg-accent-secondary' :
                  'bg-gray-400'
                }`}></div>
                <div className="flex-1">
                  <p className="text-sm text-gray-800">{activity.message}</p>
                  <p className="text-xs text-gray-500 mt-1">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CRM Flow Navigation */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold text-accent-primary mb-4 flex items-center">
          <ArrowTrendingUpIcon className="h-6 w-6 mr-2" />
          CRM Flow
        </h2>
        <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0 md:space-x-6">
          {/* Proposals */}
          <Link href="/proposals" className="flex-1 group">
            <div className="bg-gradient-to-r from-accent-primary to-accent-primary-light p-6 rounded-lg text-center hover:shadow-lg transition-shadow">
              <DocumentTextIcon className="h-12 w-12 text-white mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-white mb-2">Proposals</h3>
              <p className="text-white opacity-90 text-sm">Create and manage client proposals</p>
            </div>
          </Link>

          {/* Arrow */}
          <div className="hidden md:block text-accent-primary">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>

          {/* Leads */}
          <Link href="/leads" className="flex-1 group">
            <div className="bg-gradient-to-r from-accent-secondary to-accent-secondary-light p-6 rounded-lg text-center hover:shadow-lg transition-shadow">
              <UserGroupIcon className="h-12 w-12 text-white mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-white mb-2">Leads</h3>
              <p className="text-white opacity-90 text-sm">Convert proposals to qualified leads</p>
            </div>
          </Link>

          {/* Arrow */}
          <div className="hidden md:block text-accent-primary">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>

          {/* Projects */}
          <Link href="/projects" className="flex-1 group">
            <div className="bg-gradient-to-r from-accent-primary to-accent-secondary p-6 rounded-lg text-center hover:shadow-lg transition-shadow">
              <BriefcaseIcon className="h-12 w-12 text-white mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-white mb-2">Projects</h3>
              <p className="text-white opacity-90 text-sm">Turn leads into active projects</p>
            </div>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
