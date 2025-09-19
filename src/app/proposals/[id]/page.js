'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeftIcon,
  DocumentTextIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

export default function ProposalDetails({ params }) {
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    value: '',
    due_date: '',
    notes: ''
  });
  const router = useRouter();

  useEffect(() => {
    const fetchProposal = async () => {
      try {
        const proposalId = await params;
        const response = await fetch(`/api/proposals/${proposalId.id}`);
        const result = await response.json();
        
        if (result.success) {
          const proposalData = result.data;
          setProposal(proposalData);
          setFormData({
            title: proposalData.title || '',
            value: proposalData.value || '',
            due_date: proposalData.due_date || '',
            notes: proposalData.notes || ''
          });
        } else {
          console.error('Error fetching proposal:', result.error);
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProposal();
  }, [params]);

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSave = async () => {
    try {
      const response = await fetch(`/api/proposals/${proposal.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      
      if (result.success) {
        setProposal({ ...proposal, ...formData });
        setIsEditing(false);
        alert('Proposal updated successfully!');
      } else {
        alert('Error updating proposal: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error updating proposal');
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

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading proposal details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600">Proposal not found</p>
            <button
              onClick={() => router.push('/proposals')}
              className="mt-4 px-4 py-2 bg-accent-primary text-white rounded-md hover:bg-accent-primary/90"
            >
              Back to Proposals
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      
      <div className="flex-1 overflow-hidden">
        <div className="h-full px-8 pt-22">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => router.push('/proposals')}
                  className="p-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                </button>
                <div>
                  <div className="text-sm font-medium text-blue-600 mb-1">
                    Proposal ID: {proposal.proposal_id}
                  </div>
                  <h1 className="text-xl font-bold text-accent-primary">
                    {proposal.title}
                  </h1>
                  <p className="text-gray-600 text-sm">{proposal.client}</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(proposal.status)}`}>
                  {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                </span>
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                  >
                    <PencilIcon className="h-3 w-3" />
                    <span>Edit</span>
                  </button>
                ) : (
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                    >
                      <XMarkIcon className="h-3 w-3" />
                      <span>Cancel</span>
                    </button>
                    <button
                      onClick={handleSave}
                      className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-1"
                    >
                      <CheckIcon className="h-3 w-3" />
                      <span>Save</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="h-full overflow-y-auto pb-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Proposal Information */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <DocumentTextIcon className="h-5 w-5 mr-2" />
                  Proposal Details
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Title
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="title"
                        value={formData.title}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <p className="text-gray-900">{proposal.title}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Value
                    </label>
                    {isEditing ? (
                      <input
                        type="number"
                        name="value"
                        value={formData.value}
                        onChange={handleFormChange}
                        placeholder="0.00"
                        step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <p className="text-gray-900 text-xl font-semibold">
                        {proposal.value ? `$${parseFloat(proposal.value).toLocaleString()}` : 'Not specified'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Due Date
                    </label>
                    {isEditing ? (
                      <input
                        type="date"
                        name="due_date"
                        value={formData.due_date}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <p className="text-gray-900">
                        {proposal.due_date ? new Date(proposal.due_date).toLocaleDateString() : 'Not set'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Created
                    </label>
                    <p className="text-gray-900">
                      {new Date(proposal.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Client Information */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Client Information
                </h3>
                
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Company
                    </label>
                    <p className="text-gray-900">{proposal.client}</p>
                  </div>

                  {proposal.contact_name && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Contact Person
                      </label>
                      <p className="text-gray-900">{proposal.contact_name}</p>
                    </div>
                  )}

                  {proposal.contact_email && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email
                      </label>
                      <p className="text-gray-900">{proposal.contact_email}</p>
                    </div>
                  )}

                  {proposal.phone && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Phone
                      </label>
                      <p className="text-gray-900">{proposal.phone}</p>
                    </div>
                  )}

                  {proposal.city && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        City
                      </label>
                      <p className="text-gray-900">{proposal.city}</p>
                    </div>
                  )}

                  {proposal.priority && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Priority
                      </label>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        proposal.priority === 'High' ? 'bg-red-100 text-red-800' :
                        proposal.priority === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {proposal.priority}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Project Description */}
              {proposal.project_description && (
                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Project Description
                  </h3>
                  <p className="text-gray-700 whitespace-pre-wrap">{proposal.project_description}</p>
                </div>
              )}

              {/* Notes */}
              <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Notes
                </h3>
                {isEditing ? (
                  <textarea
                    name="notes"
                    value={formData.notes}
                    onChange={handleFormChange}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Add notes about this proposal..."
                  />
                ) : (
                  <p className="text-gray-700 whitespace-pre-wrap">
                    {proposal.notes || 'No notes added yet.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
