'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeftIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

export default function EditLead({ params }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [formData, setFormData] = useState({
    company_name: '',
    contact_name: '',
    contact_email: '',
    phone: '',
    city: '',
    project_description: '',
    enquiry_type: '',
    enquiry_status: '',
    enquiry_date: '',
    lead_source: '',
    priority: '',
    notes: ''
  });

  useEffect(() => {
    const fetchLead = async () => {
      try {
        const leadId = await params;
        const response = await fetch(`/api/leads/${leadId.id}`);
        const result = await response.json();
        
        if (result.success) {
          const leadData = result.data;
          setLead(leadData);
          setFormData({
            company_name: leadData.company_name || '',
            contact_name: leadData.contact_name || '',
            contact_email: leadData.contact_email || '',
            phone: leadData.phone || '',
            city: leadData.city || '',
            project_description: leadData.project_description || '',
            enquiry_type: leadData.enquiry_type || '',
            enquiry_status: leadData.enquiry_status || '',
            enquiry_date: leadData.enquiry_date ? leadData.enquiry_date.split('T')[0] : '',
            lead_source: leadData.lead_source || '',
            priority: leadData.priority || '',
            notes: leadData.notes || ''
          });
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

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      
      if (result.success) {
        alert('Lead updated successfully!');
        router.push(`/leads/${lead.id}`);
      } else {
        alert('Error updating lead: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error updating lead');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    router.push(`/leads/${lead?.id || ''}`);
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
            <p className="mt-2 text-gray-600">The lead you&apos;re trying to edit doesn&apos;t exist.</p>
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
        <div className="h-full pl-4 pt-22">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between pr-4">
            <div className="flex items-center space-x-4">
              <button
                onClick={handleCancel}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-accent-primary">Edit Lead</h1>
                <p className="text-gray-600">{lead.company_name}</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="h-full overflow-y-auto pb-8 pr-4">
            <div className="w-full max-w-6xl">
              <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Company Name */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">
                      Company Name *
                    </label>
                    <input
                      type="text"
                      name="company_name"
                      value={formData.company_name}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      required
                    />
                  </div>

                  {/* Contact Name */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">
                      Contact Name
                    </label>
                    <input
                      type="text"
                      name="contact_name"
                      value={formData.contact_name}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    />
                  </div>

                  {/* Contact Email */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">
                      Contact Email
                    </label>
                    <input
                      type="email"
                      name="contact_email"
                      value={formData.contact_email}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">
                      Phone
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    />
                  </div>

                  {/* City */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      name="city"
                      value={formData.city}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    />
                  </div>

                  {/* Enquiry Type */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">
                      Enquiry Type
                    </label>
                    <select
                      name="enquiry_type"
                      value={formData.enquiry_type}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    >
                      <option value="">Select Type</option>
                      <option value="Email">Email</option>
                      <option value="Phone">Phone</option>
                      <option value="Website">Website</option>
                      <option value="Social Media">Social Media</option>
                      <option value="Referral">Referral</option>
                      <option value="Walk-in">Walk-in</option>
                      <option value="Event">Event</option>
                    </select>
                  </div>

                  {/* Enquiry Status */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">
                      Enquiry Status
                    </label>
                    <select
                      name="enquiry_status"
                      value={formData.enquiry_status}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    >
                      <option value="">Select Status</option>
                      <option value="new">New</option>
                      <option value="contacted">Contacted</option>
                      <option value="qualified">Qualified</option>
                      <option value="proposal">Proposal</option>
                      <option value="negotiation">Negotiation</option>
                      <option value="closed_won">Closed Won</option>
                      <option value="closed_lost">Closed Lost</option>
                      <option value="under_discussion">Under Discussion</option>
                    </select>
                  </div>

                  {/* Enquiry Date */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">
                      Enquiry Date
                    </label>
                    <input
                      type="date"
                      name="enquiry_date"
                      value={formData.enquiry_date}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    />
                  </div>

                  {/* Lead Source */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">
                      Lead Source
                    </label>
                    <select
                      name="lead_source"
                      value={formData.lead_source}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    >
                      <option value="">Select Source</option>
                      <option value="Website">Website</option>
                      <option value="Google Ads">Google Ads</option>
                      <option value="Social Media">Social Media</option>
                      <option value="Referral">Referral</option>
                      <option value="Cold Call">Cold Call</option>
                      <option value="Email Campaign">Email Campaign</option>
                      <option value="Trade Show">Trade Show</option>
                      <option value="Partner">Partner</option>
                      <option value="Direct">Direct</option>
                    </select>
                  </div>

                  {/* Priority */}
                  <div>
                    <label className="block text-xs font-medium text-black mb-1">
                      Priority
                    </label>
                    <select
                      name="priority"
                      value={formData.priority}
                      onChange={handleInputChange}
                      className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    >
                      <option value="">Select Priority</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>

                {/* Project Description */}
                <div className="mt-4">
                  <label className="block text-xs font-medium text-black mb-1">
                    Project Description
                  </label>
                  <textarea
                    name="project_description"
                    value={formData.project_description}
                    onChange={handleInputChange}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    placeholder="Describe the project requirements and details..."
                  />
                </div>

                {/* Notes */}
                <div className="mt-4">
                  <label className="block text-xs font-medium text-black mb-1">
                    Notes
                  </label>
                  <textarea
                    name="notes"
                    value={formData.notes}
                    onChange={handleInputChange}
                    rows={2}
                    className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                    placeholder="Additional notes and comments..."
                  />
                </div>

                {/* Action Buttons */}
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-4 py-1.5 text-xs border border-gray-300 rounded-md text-black hover:bg-gray-50 transition-colors flex items-center space-x-1"
                  >
                    <XMarkIcon className="h-3 w-3" />
                    <span>Cancel</span>
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-md transition-colors disabled:opacity-50 flex items-center space-x-1 text-xs"
                  >
                    <CheckIcon className="h-3 w-3" />
                    <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
