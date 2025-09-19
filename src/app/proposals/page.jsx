'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  PlusIcon, 
  DocumentTextIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon 
} from '@heroicons/react/24/outline';

export default function Proposals() {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('list');
  const [formData, setFormData] = useState({
    title: '',
    client: '',
    contact_name: '',
    contact_email: '',
    phone: '',
    project_description: '',
    city: '',
    priority: 'Medium',
    value: '',
    status: 'draft',
    due_date: '',
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchProposals();
  }, []);

  const fetchProposals = async () => {
    try {
      const response = await fetch('/api/proposals');
      const result = await response.json();
      
      if (result.success) {
        setProposals(result.data);
      } else {
        console.error('Error fetching proposals:', result.error);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const response = await fetch('/api/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      
      if (result.success) {
        alert(`Proposal created successfully!\nProposal ID: ${result.data.proposalId}`);
        // Reset form
        setFormData({
          title: '',
          client: '',
          contact_name: '',
          contact_email: '',
          phone: '',
          project_description: '',
          city: '',
          priority: 'Medium',
          value: '',
          status: 'draft',
          due_date: '',
          notes: ''
        });
        // Refresh proposals list and switch to list tab
        fetchProposals();
        setActiveTab('list');
      } else {
        alert('Error creating proposal: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error creating proposal');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (proposalId, proposalName) => {
    if (window.confirm(`Are you sure you want to delete proposal ${proposalName}?`)) {
      try {
        const response = await fetch(`/api/proposals/${proposalId}`, {
          method: 'DELETE',
        });

        const result = await response.json();
        
        if (result.success) {
          alert('Proposal deleted successfully!');
          fetchProposals(); // Refresh the proposals list
        } else {
          alert('Error deleting proposal: ' + result.error);
        }
      } catch (error) {
        console.error('Error:', error);
        alert('Error deleting proposal');
      }
    }
  };

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
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      
      <div className="flex-1 overflow-hidden">
        <div className="h-full px-8 pt-22">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-accent-primary">Proposals</h1>
            <p className="text-gray-600">Manage and track your client proposals</p>
          </div>

          {/* Tabs */}
          <div className="mb-6">
            <nav className="flex space-x-8" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('list')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'list'
                    ? 'border-accent-primary text-accent-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Proposals List ({proposals.length})
              </button>
              <button
                onClick={() => setActiveTab('add')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'add'
                    ? 'border-accent-primary text-accent-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Add New Proposal
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="h-full overflow-y-auto pb-8">
            {activeTab === 'list' ? (
              loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading proposals...</p>
                  </div>
                </div>
              ) : proposals.length === 0 ? (
                /* Empty State */
                <div className="text-center py-12">
                  <DocumentTextIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-600 mb-2">No proposals yet</h3>
                  <p className="text-gray-500 mb-6">Get started by creating your first proposal</p>
                  <button
                    onClick={() => setActiveTab('add')}
                    className="bg-accent-primary hover:bg-accent-primary/90 text-white px-6 py-3 rounded-md inline-flex items-center space-x-2 transition-colors"
                  >
                    <PlusIcon className="h-5 w-5" />
                    <span>Create Your First Proposal</span>
                  </button>
                </div>
              ) : (
                /* Proposals Table */
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Proposal ID
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Title / Client
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Value
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Created
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Due Date
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {proposals.map((proposal) => (
                          <tr key={proposal.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-blue-600">
                                {proposal.proposal_id}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-gray-900">
                                {proposal.title}
                              </div>
                              <div className="text-sm text-gray-500">
                                {proposal.client}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">
                                {proposal.value ? `$${parseFloat(proposal.value).toLocaleString()}` : 'TBD'}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(proposal.status)}`}>
                                {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(proposal.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {proposal.due_date ? new Date(proposal.due_date).toLocaleDateString() : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex justify-end space-x-2">
                                <button 
                                  onClick={() => router.push(`/proposals/${proposal.id}`)}
                                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-full transition-colors"
                                  title="View Proposal"
                                >
                                  <EyeIcon className="h-4 w-4" />
                                </button>
                                <button 
                                  onClick={() => router.push(`/proposals/${proposal.id}`)}
                                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-full transition-colors"
                                  title="Edit Proposal"
                                >
                                  <PencilIcon className="h-4 w-4" />
                                </button>
                                <button 
                                  onClick={() => handleDelete(proposal.id, proposal.proposal_id)}
                                  className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-full transition-colors"
                                  title="Delete Proposal"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            ) : (
              /* Add New Proposal Form */
              <div className="bg-white rounded-lg border border-gray-200 p-3">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Create New Proposal</h3>
                
                <form onSubmit={handleSubmit} className="space-y-3">
                  {/* Form Grid Layout */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Basic Information */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Proposal Title *
                      </label>
                      <input
                        type="text"
                        name="title"
                        value={formData.title}
                        onChange={handleFormChange}
                        required
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter proposal title"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Client Company *
                      </label>
                      <input
                        type="text"
                        name="client"
                        value={formData.client}
                        onChange={handleFormChange}
                        required
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter client company name"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Contact Person
                      </label>
                      <input
                        type="text"
                        name="contact_name"
                        value={formData.contact_name}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter contact person name"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Email Address
                      </label>
                      <input
                        type="email"
                        name="contact_email"
                        value={formData.contact_email}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter email address"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        value={formData.phone}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter phone number"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        City
                      </label>
                      <input
                        type="text"
                        name="city"
                        value={formData.city}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter city"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Priority
                      </label>
                      <select
                        name="priority"
                        value={formData.priority}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Proposal Value
                      </label>
                      <input
                        type="number"
                        name="value"
                        value={formData.value}
                        onChange={handleFormChange}
                        step="0.01"
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="0.00"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Status
                      </label>
                      <select
                        name="status"
                        value={formData.status}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                      >
                        <option value="draft">Draft</option>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Due Date
                      </label>
                      <input
                        type="date"
                        name="due_date"
                        value={formData.due_date}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                      />
                    </div>
                  </div>

                  {/* Project Description & Notes - Full Width */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Project Description
                      </label>
                      <textarea
                        name="project_description"
                        value={formData.project_description}
                        onChange={handleFormChange}
                        rows={2}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Describe the project requirements"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Notes
                      </label>
                      <textarea
                        name="notes"
                        value={formData.notes}
                        onChange={handleFormChange}
                        rows={2}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Add any additional notes about this proposal"
                      />
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="bg-accent-primary hover:bg-accent-primary/90 text-white px-4 py-1.5 rounded-md transition-colors disabled:opacity-50 flex items-center space-x-1 text-xs"
                    >
                      <DocumentTextIcon className="h-3 w-3" />
                      <span>{submitting ? 'Creating...' : 'Create Proposal'}</span>
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
