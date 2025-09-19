'use client';

import Layout from '@/components/Layout';
import Link from 'next/link';
import { 
  PlusIcon, 
  DocumentTextIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon 
} from '@heroicons/react/24/outline';

export default function Proposals() {
  // Mock data - replace with real data from your API
  const proposals = [
    {
      id: 1,
      title: 'Website Redesign for Acme Corp',
      client: 'Acme Corporation',
      value: '$25,000',
      status: 'pending',
      createdAt: '2025-09-15',
      dueDate: '2025-09-25'
    },
    {
      id: 2,
      title: 'Mobile App Development',
      client: 'TechStart Inc',
      value: '$45,000',
      status: 'approved',
      createdAt: '2025-09-10',
      dueDate: '2025-09-20'
    },
    {
      id: 3,
      title: 'E-commerce Platform',
      client: 'ShopEasy Ltd',
      value: '$35,000',
      status: 'draft',
      createdAt: '2025-09-18',
      dueDate: '2025-09-30'
    }
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Layout 
      title="Proposals" 
      subtitle="Manage and track your client proposals"
    >
      {/* Header Actions */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex space-x-4">
          <select className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-accent-primary focus:border-accent-primary">
            <option>All Statuses</option>
            <option>Draft</option>
            <option>Pending</option>
            <option>Approved</option>
            <option>Rejected</option>
          </select>
        </div>
        <Link
          href="/proposals/new"
          className="bg-accent-primary hover:bg-accent-primary-light text-white px-4 py-2 rounded-md flex items-center space-x-2 transition-colors"
        >
          <PlusIcon className="h-5 w-5" />
          <span>New Proposal</span>
        </Link>
      </div>

      {/* Proposals Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {proposals.map((proposal) => (
          <div key={proposal.id} className="bg-white rounded-lg shadow-lg border border-gray-200 hover:shadow-xl transition-shadow">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {proposal.title}
                  </h3>
                  <p className="text-gray-600 mb-2">{proposal.client}</p>
                  <p className="text-2xl font-bold text-accent-primary">{proposal.value}</p>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(proposal.status)}`}>
                  {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                </span>
              </div>
              
              <div className="text-sm text-gray-500 mb-4">
                <p>Created: {proposal.createdAt}</p>
                <p>Due: {proposal.dueDate}</p>
              </div>

              {/* Actions */}
              <div className="flex space-x-2">
                <button className="flex-1 bg-accent-secondary hover:bg-accent-secondary-dark text-white py-2 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center space-x-1">
                  <EyeIcon className="h-4 w-4" />
                  <span>View</span>
                </button>
                <button className="flex-1 border border-accent-primary text-accent-primary hover:bg-accent-primary hover:text-white py-2 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center space-x-1">
                  <PencilIcon className="h-4 w-4" />
                  <span>Edit</span>
                </button>
                <button className="bg-red-100 hover:bg-red-200 text-red-700 py-2 px-3 rounded-md text-sm font-medium transition-colors">
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Add New Proposal Card */}
        <Link href="/proposals/new">
          <div className="bg-white rounded-lg shadow-lg border-2 border-dashed border-gray-300 hover:border-accent-primary hover:shadow-xl transition-all cursor-pointer h-full min-h-[280px] flex items-center justify-center">
            <div className="text-center">
              <PlusIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">Create New Proposal</h3>
              <p className="text-gray-500">Start building your next proposal</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Empty State */}
      {proposals.length === 0 && (
        <div className="text-center py-12">
          <DocumentTextIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">No proposals yet</h3>
          <p className="text-gray-500 mb-6">Get started by creating your first proposal</p>
          <Link
            href="/proposals/new"
            className="bg-accent-primary hover:bg-accent-primary-light text-white px-6 py-3 rounded-md inline-flex items-center space-x-2 transition-colors"
          >
            <PlusIcon className="h-5 w-5" />
            <span>Create Your First Proposal</span>
          </Link>
        </div>
      )}
    </Layout>
  );
}
