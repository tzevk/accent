'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { fetchJSON } from '@/utils/http';
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
  const [companies, setCompanies] = useState([]);
  const router = useRouter();

  useEffect(() => {
    fetchProposals();
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
  const json = await fetchJSON('/api/companies');
      if (json.success) setCompanies(json.data || []);
    } catch (err) {
      console.error('Error fetching companies', err);
    }
  };

  const fetchProposals = async () => {
    try {
  const result = await fetchJSON('/api/proposals');
      
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
      const result = await fetchJSON('/api/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      
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
      alert('Error creating proposal: ' + error.message);
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
  <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Proposals</h1>
          <p className="text-gray-600">Manage and track your client proposals efficiently</p>
        </div>

        {/* Tabs */}
        <div className="mb-8">
          <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
            <nav className="flex" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('list')}
                className={`flex-1 py-4 px-6 text-center font-semibold text-sm transition-all duration-300 ${
                  activeTab === 'list'
                    ? 'bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Proposals List ({proposals.length})
              </button>
              <button
                onClick={() => setActiveTab('add')}
                className={`flex-1 py-4 px-6 text-center font-semibold text-sm transition-all duration-300 ${
                  activeTab === 'add'
                    ? 'bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Add New Proposal
              </button>
            </nav>
          </div>
        </div>

        {/* Content */}
        <div className="pb-8">
          {activeTab === 'list' ? (
            loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#64126D] mx-auto"></div>
                  <p className="mt-4 text-gray-600">Loading proposals...</p>
                </div>
              </div>
            ) : proposals.length === 0 ? (
              /* Empty State */
              <div className="bg-white shadow-lg rounded-xl border border-gray-200 text-center py-16">
                <DocumentTextIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No proposals yet</h3>
                <p className="text-gray-500 mb-6">Get started by creating your first proposal</p>
                <button
                  onClick={() => setActiveTab('add')}
                  className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl inline-flex items-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                >
                  <PlusIcon className="h-5 w-5" />
                  <span>Create Your First Proposal</span>
                </button>
              </div>
            ) : (
              /* Proposals Table */
              <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Proposal ID
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Title / Client
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Value
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Created
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Due Date
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {proposals.map((proposal) => (
                        <tr key={proposal.id} className="hover:bg-gray-50 transition-colors duration-200">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-semibold text-[#64126D]">
                              {proposal.proposal_id}
                            </div>
                          </td>
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-gray-900">
                                {proposal.title}
                              </div>
                              <div className="text-sm text-gray-500">
                                {proposal.client}
                                {proposal.lead_id && (
                                  <span className="ml-2 text-xs text-indigo-600">• Linked Lead</span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">
                                {proposal.value ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(parseFloat(proposal.value)) : 'TBD'}
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
                                  className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-xl transition-all duration-200 transform hover:scale-105"
                                  title="View Proposal"
                                >
                                  <EyeIcon className="h-4 w-4" />
                                </button>
                                <button 
                                  onClick={() => router.push(`/proposals/${proposal.id}`)}
                                  className="p-2 text-[#64126D] hover:text-[#86288F] hover:bg-purple-50 rounded-xl transition-all duration-200 transform hover:scale-105"
                                  title="Edit Proposal"
                                >
                                  <PencilIcon className="h-4 w-4" />
                                </button>
                                <button 
                                  onClick={() => handleDelete(proposal.id, proposal.proposal_id)}
                                  className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-xl transition-all duration-200 transform hover:scale-105"
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
              <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Create New Proposal</h3>
                  <p className="text-sm text-gray-600 mt-1">Fill in the details to create a new proposal</p>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                  {/* Form Grid Layout */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Basic Information */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Proposal Title *
                      </label>
                      <input
                        type="text"
                        name="title"
                        value={formData.title}
                        onChange={handleFormChange}
                        required
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                        placeholder="Enter proposal title"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Client Company *
                      </label>
                      <div>
                        <select
                          name="client_select"
                          value={formData.client || ''}
                          onChange={(e) => {
                            const selected = companies.find(c => c.company_name === e.target.value);
                            setFormData(prev => ({
                              ...prev,
                              client: e.target.value,
                              contact_name: selected ? (selected.contact_person || prev.contact_name) : prev.contact_name,
                              contact_email: selected ? (selected.email || prev.contact_email) : prev.contact_email,
                              phone: selected ? (selected.mobile_number || selected.phone || prev.phone) : prev.phone
                            }));
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                        >
                          <option value="">Select client company or type below</option>
                          {companies.map(c => (
                            <option key={c.id} value={c.company_name}>{c.company_name}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          name="client"
                          value={formData.client}
                          onChange={handleFormChange}
                          required
                          className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                          placeholder="Or enter new client company name"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Contact Person
                      </label>
                      <input
                        type="text"
                        name="contact_name"
                        value={formData.contact_name}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                        placeholder="Enter contact person name"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email Address
                      </label>
                      <input
                        type="email"
                        name="contact_email"
                        value={formData.contact_email}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                        placeholder="Enter email address"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        value={formData.phone}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                        placeholder="Enter phone number"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        City
                      </label>
                      <input
                        type="text"
                        name="city"
                        value={formData.city}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                        placeholder="Enter city"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Priority
                      </label>
                      <select
                        name="priority"
                        value={formData.priority}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Proposal Value
                      </label>
                      <input
                        type="number"
                        name="value"
                        value={formData.value}
                        onChange={handleFormChange}
                        step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                        placeholder="0.00"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Status
                      </label>
                      <select
                        name="status"
                        value={formData.status}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                      >
                        <option value="draft">Draft</option>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Due Date
                      </label>
                      <input
                        type="date"
                        name="due_date"
                        value={formData.due_date}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                      />
                    </div>
                  </div>

                  {/* Project Description & Notes - Full Width */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Project Description
                      </label>
                      <textarea
                        name="project_description"
                        value={formData.project_description}
                        onChange={handleFormChange}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                        placeholder="Describe the project requirements"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Notes
                      </label>
                      <textarea
                        name="notes"
                        value={formData.notes}
                        onChange={handleFormChange}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                        placeholder="Add any additional notes about this proposal"
                      />
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl transition-all duration-300 disabled:opacity-50 flex items-center space-x-2 text-sm font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                    >
                      <DocumentTextIcon className="h-5 w-5" />
                      <span>{submitting ? 'Creating...' : 'Create Proposal'}</span>
                    </button>
                  </div>
                </form>
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}
