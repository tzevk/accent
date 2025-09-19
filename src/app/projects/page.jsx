'use client';

import Layout from '@/components/Layout';
import Link from 'next/link';
import { 
  PlusIcon, 
  BriefcaseIcon,
  CalendarIcon,
  ClockIcon,
  CurrencyDollarIcon,
  UserIcon,
  PlayIcon,
  PauseIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

export default function Projects() {
  // Mock data - replace with real data from your API
  const projects = [
    {
      id: 1,
      name: 'Website Redesign',
      client: 'Acme Corporation',
      status: 'in-progress',
      progress: 65,
      value: '$25,000',
      startDate: '2025-09-01',
      endDate: '2025-10-15',
      team: ['John D.', 'Sarah M.', 'Mike R.'],
      description: 'Complete redesign of corporate website with modern UI/UX'
    },
    {
      id: 2,
      name: 'Mobile App Development',
      client: 'TechStart Inc',
      status: 'completed',
      progress: 100,
      value: '$45,000',
      startDate: '2025-07-15',
      endDate: '2025-09-15',
      team: ['Alice B.', 'Bob C.'],
      description: 'Native iOS and Android app for customer management'
    },
    {
      id: 3,
      name: 'E-commerce Platform',
      client: 'ShopEasy Ltd',
      status: 'planning',
      progress: 15,
      value: '$35,000',
      startDate: '2025-09-20',
      endDate: '2025-12-01',
      team: ['Emma W.', 'Tom H.', 'Lisa K.'],
      description: 'Full-featured e-commerce platform with payment integration'
    }
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'in-progress':
        return 'bg-blue-100 text-blue-800';
      case 'planning':
        return 'bg-yellow-100 text-yellow-800';
      case 'on-hold':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return CheckCircleIcon;
      case 'in-progress':
        return PlayIcon;
      case 'planning':
        return ClockIcon;
      case 'on-hold':
        return PauseIcon;
      default:
        return ClockIcon;
    }
  };

  return (
    <Layout 
      title="Projects" 
      subtitle="Manage your active projects and track progress"
    >
      {/* Header Actions */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex space-x-4">
          <select className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-accent-primary focus:border-accent-primary">
            <option>All Projects</option>
            <option>Planning</option>
            <option>In Progress</option>
            <option>Completed</option>
            <option>On Hold</option>
          </select>
        </div>
        <Link
          href="/projects/new"
          className="bg-accent-primary hover:bg-accent-primary-light text-white px-4 py-2 rounded-md flex items-center space-x-2 transition-colors"
        >
          <PlusIcon className="h-5 w-5" />
          <span>New Project</span>
        </Link>
      </div>

      {/* Projects Grid */}
      <div className="space-y-6">
        {projects.map((project) => {
          const StatusIcon = getStatusIcon(project.status);
          
          return (
            <div key={project.id} className="bg-white rounded-lg shadow-lg border border-gray-200 hover:shadow-xl transition-shadow">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-xl font-semibold text-gray-900">{project.name}</h3>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium flex items-center space-x-1 ${getStatusColor(project.status)}`}>
                        <StatusIcon className="h-4 w-4" />
                        <span>{project.status.charAt(0).toUpperCase() + project.status.slice(1).replace('-', ' ')}</span>
                      </span>
                    </div>
                    <p className="text-gray-600 mb-2">{project.client}</p>
                    <p className="text-gray-500 text-sm mb-4">{project.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-accent-primary">{project.value}</p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>Progress</span>
                    <span>{project.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-accent-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${project.progress}%` }}
                    ></div>
                  </div>
                </div>

                {/* Project Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="flex items-center text-sm text-gray-600">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    <span>Start: {project.startDate}</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-600">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    <span>End: {project.endDate}</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-600">
                    <UserIcon className="h-4 w-4 mr-2" />
                    <span>Team: {project.team.join(', ')}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex space-x-3">
                  <button className="flex-1 bg-accent-primary hover:bg-accent-primary-light text-white py-2 px-4 rounded-md text-sm font-medium transition-colors">
                    View Details
                  </button>
                  <button className="flex-1 border border-accent-secondary text-accent-secondary hover:bg-accent-secondary hover:text-white py-2 px-4 rounded-md text-sm font-medium transition-colors">
                    Edit Project
                  </button>
                  <button className="bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-4 rounded-md text-sm font-medium transition-colors">
                    Timeline
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {projects.length === 0 && (
        <div className="text-center py-12">
          <BriefcaseIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">No projects yet</h3>
          <p className="text-gray-500 mb-6">Start by creating your first project</p>
          <Link
            href="/projects/new"
            className="bg-accent-primary hover:bg-accent-primary-light text-white px-6 py-3 rounded-md inline-flex items-center space-x-2 transition-colors"
          >
            <PlusIcon className="h-5 w-5" />
            <span>Create Your First Project</span>
          </Link>
        </div>
      )}

      {/* Project Stats */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-2xl font-bold text-accent-primary">{projects.length}</p>
          <p className="text-sm text-gray-600">Total Projects</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-2xl font-bold text-blue-600">
            {projects.filter(p => p.status === 'in-progress').length}
          </p>
          <p className="text-sm text-gray-600">In Progress</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-2xl font-bold text-green-600">
            {projects.filter(p => p.status === 'completed').length}
          </p>
          <p className="text-sm text-gray-600">Completed</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-2xl font-bold text-accent-secondary">
            ${projects.reduce((acc, p) => acc + parseInt(p.value.replace(/[^0-9]/g, '')), 0).toLocaleString()}
          </p>
          <p className="text-sm text-gray-600">Total Value</p>
        </div>
      </div>
    </Layout>
  );
}
