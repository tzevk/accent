'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJSON } from '@/utils/http';
import { 
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  PhoneIcon,
  EnvelopeIcon,
  MapPinIcon,
  CalendarIcon,
  FlagIcon,
  UserIcon,
  BuildingOfficeIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline';

export default function LeadDetails({ params }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchLead = async () => {
      try {
        const leadId = await params;
        const result = await fetchJSON(`/api/leads/${leadId.id}`);
        
        if (result.success) {
          setLead(result.data);
        } else {
          console.error('Error fetching lead:', result.error);
          alert('Lead not found');
          router.push('/leads');
        }
      } catch (error) {
        console.error('Error:', error);
        alert('Error loading lead details');
        router.push('/leads');
      } finally {
        setLoading(false);
      }
    };

    fetchLead();
  }, [params, router]);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'new':
        return 'bg-blue-100 text-blue-800';
      case 'contacted':
        return 'bg-yellow-100 text-yellow-800';
      case 'qualified':
        return 'bg-green-100 text-green-800';
      case 'proposal':
        return 'bg-purple-100 text-purple-800';
      case 'negotiation':
        return 'bg-orange-100 text-orange-800';
      case 'closed_won':
        return 'bg-emerald-100 text-emerald-800';
      case 'closed_lost':
        return 'bg-red-100 text-red-800';
      case 'under_discussion':
        return 'bg-indigo-100 text-indigo-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'high':
        return 'text-red-600';
      case 'medium':
        return 'text-yellow-600';
      case 'low':
        return 'text-green-600';
      default:
        return 'text-gray-600';
    }
  };

  const handleEdit = () => {
    router.push(`/leads/${lead.id}/edit`);
  };

  const handleDelete = async () => {
    if (window.confirm(`Are you sure you want to delete this lead from "${lead.company_name}"?`)) {
      try {
        const result = await fetchJSON(`/api/leads/${lead.id}`, {
          method: 'DELETE',
        });
        
        if (result.success) {
          alert('Lead deleted successfully!');
          router.push('/leads');
        } else {
          alert('Error deleting lead: ' + result.error);
        }
      } catch (error) {
        console.error('Error:', error);
        alert(error?.message || 'Error deleting lead');
      }
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading lead details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-gray-900">Lead not found</h2>
            <p className="mt-2 text-gray-600">The lead you&apos;re looking for doesn&apos;t exist.</p>
            <button
              onClick={() => router.push('/leads')}
              className="mt-4 bg-accent-primary text-white px-4 py-2 rounded-md hover:bg-accent-primary/90"
            >
              Back to Leads
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
        <div className="h-full px-4 pt-22">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.back()}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-accent-primary">{lead.company_name}</h1>
                <p className="text-gray-600">Lead Details</p>
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleEdit}
                className="bg-accent-primary text-white px-4 py-2 rounded-md hover:bg-accent-primary/90 flex items-center space-x-2"
              >
                <PencilIcon className="h-4 w-4" />
                <span>Edit</span>
              </button>
              <button
                onClick={handleDelete}
                className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 flex items-center space-x-2"
              >
                <TrashIcon className="h-4 w-4" />
                <span>Delete</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="h-full overflow-y-auto pb-8">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-7xl">
              {/* Main Details */}
              <div className="xl:col-span-2 space-y-6">
                {/* Company & Contact Info */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <BuildingOfficeIcon className="h-5 w-5 mr-2 text-gray-500" />
                    Company & Contact Information
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                      <p className="text-sm text-gray-900">{lead.company_name || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                      <p className="text-sm text-gray-900 flex items-center">
                        <UserIcon className="h-4 w-4 mr-1 text-gray-400" />
                        {lead.contact_name || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                      <p className="text-sm text-gray-900 flex items-center">
                        <EnvelopeIcon className="h-4 w-4 mr-1 text-gray-400" />
                        {lead.contact_email || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <p className="text-sm text-gray-900 flex items-center">
                        <PhoneIcon className="h-4 w-4 mr-1 text-gray-400" />
                        {lead.phone || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                      <p className="text-sm text-gray-900 flex items-center">
                        <MapPinIcon className="h-4 w-4 mr-1 text-gray-400" />
                        {lead.city || 'N/A'}
                      </p>
                    </div>
                    <div className="lg:col-span-2 xl:col-span-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Inquiry Email</label>
                      <p className="text-sm text-gray-900 flex items-center">
                        <EnvelopeIcon className="h-4 w-4 mr-1 text-gray-400" />
                        {lead.inquiry_email || 'N/A'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">Email ID of person from whom inquiry was received</p>
                    </div>
                    <div className="lg:col-span-2 xl:col-span-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">CC Emails</label>
                      <p className="text-sm text-gray-900 flex items-start">
                        <EnvelopeIcon className="h-4 w-4 mr-1 mt-0.5 text-gray-400 flex-shrink-0" />
                        <span className="break-all">{lead.cc_emails || 'N/A'}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">Additional email IDs (comma-separated)</p>
                    </div>
                  </div>
                </div>

                {/* Project Details */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <DocumentTextIcon className="h-5 w-5 mr-2 text-gray-500" />
                    Project Details
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Project Description</label>
                      <p className="text-sm text-gray-900 bg-gray-50 p-3 rounded-md">
                        {lead.project_description || 'No description provided'}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Enquiry Type</label>
                        <p className="text-sm text-gray-900">{lead.enquiry_type || 'N/A'}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Lead Source</label>
                        <p className="text-sm text-gray-900">{lead.lead_source || 'N/A'}</p>
                      </div>
                    </div>
                    {lead.notes && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                        <p className="text-sm text-gray-900 bg-gray-50 p-3 rounded-md">{lead.notes}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Status & Priority */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Status & Priority</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Current Status</label>
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(lead.enquiry_status)}`}>
                        {lead.enquiry_status?.replace('_', ' ').toUpperCase() || 'N/A'}
                      </span>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                      <p className={`text-sm font-medium flex items-center ${getPriorityColor(lead.priority)}`}>
                        <FlagIcon className="h-4 w-4 mr-1" />
                        {lead.priority?.toUpperCase() || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Enquiry Date</label>
                      <p className="text-sm text-gray-900 flex items-center">
                        <CalendarIcon className="h-4 w-4 mr-1 text-gray-400" />
                        {formatDate(lead.enquiry_date)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Timeline</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">Created:</span>
                      <span className="text-gray-900">{formatDate(lead.created_at)}</span>
                    </div>
                    {lead.updated_at && lead.updated_at !== lead.created_at && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">Last Updated:</span>
                        <span className="text-gray-900">{formatDate(lead.updated_at)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Lead ID */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Lead Information</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">Lead ID:</span>
                      <span className="text-gray-900 font-mono">#{lead.id}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
