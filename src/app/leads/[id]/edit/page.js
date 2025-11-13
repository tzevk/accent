'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchJSON } from '@/utils/http';
import { 
  ArrowLeftIcon,
  UserIcon,
  PhoneIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
  
} from '@heroicons/react/24/outline';

export default function EditLead({ params }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState('details');
  const [editingFollowUp, setEditingFollowUp] = useState(null);
  const [showAddFollowUp, setShowAddFollowUp] = useState(false);
  const [formData, setFormData] = useState({
    lead_id: '',
    company_name: '',
    contact_name: '',
    contact_email: '',
    inquiry_email: '',
    cc_emails: '',
    phone: '',
    city: '',
    project_description: '',
    enquiry_type: '',
    enquiry_status: '',
    enquiry_date: '',
    lead_source: '',
    priority: '',
    designation: '',
    notes: ''
  });

  // Follow-up state
  const [followUps, setFollowUps] = useState([]);
  const [followUpForm, setFollowUpForm] = useState({
    follow_up_date: new Date().toISOString().split('T')[0],
    follow_up_type: 'Call',
    description: '',
    status: 'Scheduled',
    next_action: '',
    next_follow_up_date: '',
    notes: ''
  });
  const [addingFollowUp, setAddingFollowUp] = useState(false);

  useEffect(() => {
    const fetchLead = async () => {
      try {
        const leadId = await params;
        const result = await fetchJSON(`/api/leads/${leadId.id}`);
        
        if (result.success) {
          const leadData = result.data;
          setLead(leadData);
          setFormData({
            lead_id: leadData.lead_id || '',
            company_name: leadData.company_name || '',
            contact_name: leadData.contact_name || '',
            contact_email: leadData.contact_email || '',
            inquiry_email: leadData.inquiry_email || '',
            cc_emails: leadData.cc_emails || '',
            phone: leadData.phone || '',
            city: leadData.city || '',
            project_description: leadData.project_description || '',
            enquiry_type: leadData.enquiry_type || '',
            enquiry_status: leadData.enquiry_status || '',
            enquiry_date: leadData.enquiry_date ? leadData.enquiry_date.split('T')[0] : '',
            lead_source: leadData.lead_source || '',
            priority: leadData.priority || '',
            designation: leadData.designation || '',
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

  // Initialize tab and follow-up editing from URL parameters
  useEffect(() => {
    const tab = searchParams.get('tab');
    const followupId = searchParams.get('followup');
    
    if (tab === 'followups') {
      setActiveTab('followups');
    }
    
    if (followupId && tab === 'followups') {
      setEditingFollowUp(parseInt(followupId));
    }
  }, [searchParams]);

  // Fetch follow-ups for this lead
  useEffect(() => {
    if (!lead) return;
    const fetchFollowUps = async () => {
      try {
        const result = await fetchJSON(`/api/followups?lead_id=${lead.id}`);
        if (result.success) setFollowUps(result.data);
      } catch { /* ignore */ }
    };
    fetchFollowUps();
  }, [lead]);

  // Load specific follow-up for editing
  useEffect(() => {
    if (!editingFollowUp) return;
    
    const loadFollowUp = async () => {
      try {
        const data = await fetchJSON(`/api/followups/${editingFollowUp}`);
        if (data.success) {
          const followUp = data.data;
          setFollowUpForm({
            follow_up_date: followUp.follow_up_date ? followUp.follow_up_date.split('T')[0] : new Date().toISOString().split('T')[0],
            follow_up_type: followUp.follow_up_type || 'Call',
            description: followUp.description || '',
            status: followUp.status || 'Scheduled',
            next_action: followUp.next_action || '',
            next_follow_up_date: followUp.next_follow_up_date ? followUp.next_follow_up_date.split('T')[0] : '',
            notes: followUp.notes || ''
          });
        }
      } catch (error) {
        console.error('Error loading follow-up:', error);
        alert('Error loading follow-up: ' + error.message);
      }
    };

    loadFollowUp();
  }, [editingFollowUp]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle follow-up form change
  const handleFollowUpChange = (e) => {
    const { name, value } = e.target;
    setFollowUpForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const result = await fetchJSON(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      
      if (result.success) {
        alert('Lead updated successfully!');
        router.push(`/leads/${lead.id}`);
      } else {
        alert('Error updating lead: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert(error?.message || 'Error updating lead');
    } finally {
      setSaving(false);
    }
  };

  // Handle follow-up submit
  const handleFollowUpSubmit = async (e) => {
    e.preventDefault();
    setAddingFollowUp(true);
    
    try {
      // Basic client-side validation
      if (!followUpForm.follow_up_date || !followUpForm.description) {
        alert('Please provide a date and description for the follow-up.');
        setAddingFollowUp(false);
        return;
      }

      if (editingFollowUp) {
        // Update existing follow-up
        const result = await fetchJSON(`/api/followups/${editingFollowUp}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(followUpForm)
        });
        
        if (result.success) {
          // Update in local state
          setFollowUps(prev => prev.map(f => f.id === editingFollowUp ? result.data : f));
          setEditingFollowUp(null);
          alert('Follow-up updated successfully!');
        } else {
          alert(result.error || 'Error updating follow-up');
        }
      } else {
        // Create new follow-up
        const result = await fetchJSON('/api/followups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...followUpForm,
            lead_id: lead.id
          })
        });
        
        if (result.success) {
          setFollowUps(prev => [result.data, ...prev]);
          setShowAddFollowUp(false);
          alert('Follow-up created successfully!');
        } else {
          alert(result.error || 'Error adding follow-up');
        }
      }
      
      // Reset form
      setFollowUpForm({
        follow_up_date: new Date().toISOString().split('T')[0],
        follow_up_type: 'Call',
        description: '',
        status: 'Scheduled',
        next_action: '',
        next_follow_up_date: '',
        notes: ''
      });
      
    } catch (error) {
      console.error('Error saving follow-up:', error);
      alert('Error saving follow-up: ' + error.message);
    } finally {
      setAddingFollowUp(false);
    }
  };

  const handleDeleteFollowUp = async (followUpId) => {
    if (!confirm('Are you sure you want to delete this follow-up?')) return;
    
    try {
      const result = await fetchJSON(`/api/followups/${followUpId}`, {
        method: 'DELETE'
      });
      
      if (result.success) {
        setFollowUps(prev => prev.filter(f => f.id !== followUpId));
        if (editingFollowUp === followUpId) {
          setEditingFollowUp(null);
        }
        alert('Follow-up deleted successfully!');
      } else {
        alert(result.error || 'Error deleting follow-up');
      }
    } catch (error) {
      console.error('Error deleting follow-up:', error);
      alert('Error deleting follow-up: ' + error.message);
    }
  };

  const handleCancel = () => {
    router.push('/leads');
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

      {/* Fixed header section */}
      <div className="flex-shrink-0 pt-24 px-8 pb-4">
        <div className="mb-6">
          <div className="flex items-center space-x-4 mb-4">
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-black mb-2">Edit Lead</h1>
              <p className="text-gray-600">{lead.company_name}</p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 bg-white rounded-t-lg px-6 pt-4">
          <button
            onClick={() => setActiveTab('details')}
            className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
              activeTab === 'details'
                ? 'border-black text-black bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <UserIcon className="h-5 w-5 inline mr-2" />
            Lead Details
          </button>

          <button
            onClick={() => setActiveTab('followups')}
            className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
              activeTab === 'followups'
                ? 'border-black text-black bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <PhoneIcon className="h-5 w-5 inline mr-2" />
            Follow-ups ({followUps.length})
          </button>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 px-8 overflow-hidden">
        <div className="h-full overflow-y-auto bg-white rounded-b-lg">
          <div className="p-6">
            {activeTab === 'details' && (
              <div className="h-full">
                <form onSubmit={handleSubmit} className="h-full flex flex-col">
                  {/* Header */}
                  <div className="flex-shrink-0 mb-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-2xl font-bold text-gray-900">Edit Lead Details</h2>
                        <p className="text-gray-600 mt-1">Update lead information and manage details</p>
                      </div>
                      <div className="text-sm text-gray-500">
                        <span className="text-red-500">*</span> Required fields
                      </div>
                    </div>
                  </div>

                  {/* Form Container - Scrollable */}
                  <div className="flex-1 overflow-y-auto">
                    <div className="space-y-6">
                      
                      {/* Lead Information Section */}
                      <div className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-blue-100">
                          Lead Information
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Lead ID */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Lead ID
                            </label>
                            <input
                              type="text"
                              name="lead_id"
                              value={formData.lead_id}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                          </div>

                          {/* Company Name */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Company Name *
                            </label>
                            <input
                              type="text"
                              name="company_name"
                              value={formData.company_name}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                              required
                            />
                          </div>

                          {/* Contact Name */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Contact Name
                            </label>
                            <input
                              type="text"
                              name="contact_name"
                              value={formData.contact_name}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Designation
                            </label>
                            <input
                              type="text"
                              name="designation"
                              value={formData.designation}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              City
                            </label>
                            <input
                              type="text"
                              name="city"
                              value={formData.city}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Phone Number
                            </label>
                            <input
                              type="tel"
                              name="phone"
                              value={formData.phone}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Lead Source
                            </label>
                            <input
                              type="text"
                              name="lead_source"
                              value={formData.lead_source}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Email Information Section */}
                      <div className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-green-100">
                          Email Information
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Contact Email
                            </label>
                            <input
                              type="email"
                              name="contact_email"
                              value={formData.contact_email}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Inquiry Email
                            </label>
                            <input
                              type="email"
                              name="inquiry_email"
                              value={formData.inquiry_email}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                            <p className="text-xs text-gray-500 mt-1">Email ID of person from whom inquiry was received</p>
                          </div>

                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              CC Emails (2-6 emails)
                            </label>
                            <input
                              type="text"
                              name="cc_emails"
                              value={formData.cc_emails}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                              placeholder="email1@example.com, email2@example.com, email3@example.com"
                            />
                            <p className="text-xs text-gray-500 mt-1">Enter 2-6 additional email IDs separated by commas</p>
                          </div>
                        </div>
                      </div>

                      {/* Project & Lead Details Section */}
                      <div className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-purple-100">
                          Project & Lead Details
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Priority
                            </label>
                            <select
                              name="priority"
                              value={formData.priority}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            >
                              <option value="Low">Low</option>
                              <option value="Medium">Medium</option>
                              <option value="High">High</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Enquiry Type
                            </label>
                            <select
                              name="enquiry_type"
                              value={formData.enquiry_type}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            >
                              <option value="Email">Email</option>
                              <option value="Call">Call</option>
                              <option value="Website">Website</option>
                              <option value="Justdial">Justdial</option>
                              <option value="Referral">Referral</option>
                              <option value="LinkedIn">LinkedIn</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Status
                            </label>
                            <select
                              name="enquiry_status"
                              value={formData.enquiry_status}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            >
                              <option value="Under Discussion">Under Discussion</option>
                              <option value="Awaiting">Awaiting</option>
                              <option value="Awarded">Awarded</option>
                              <option value="Regretted">Regretted</option>
                              <option value="Close">Close</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Enquiry Date
                            </label>
                            <input
                              type="date"
                              name="enquiry_date"
                              value={formData.enquiry_date}
                              onChange={handleInputChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Project Description
                            </label>
                            <textarea
                              name="project_description"
                              value={formData.project_description}
                              onChange={handleInputChange}
                              rows={3}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Notes
                            </label>
                            <textarea
                              name="notes"
                              value={formData.notes}
                              onChange={handleInputChange}
                              rows={3}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex justify-end items-center pt-4 mt-4 border-t border-gray-300 bg-white rounded-b-lg -m-3 p-3">
                        <div className="flex space-x-3">
                          <button
                            type="button"
                            onClick={handleCancel}
                            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={saving}
                            className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm shadow-md border-2 border-blue-600"
                          >
                            {saving ? 'Saving...' : 'Update Lead'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {activeTab === 'followups' && (
              <div className="space-y-4">
                {/* Add Follow-up Button */}
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-gray-900">Follow-ups</h3>
                  <button
                    onClick={() => setShowAddFollowUp(true)}
                    className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 flex items-center space-x-2"
                  >
                    <PlusIcon className="h-4 w-4" />
                    <span>Add Follow-up</span>
                  </button>
                </div>

                {/* Follow-ups List */}
                {followUps.length === 0 ? (
                  <div className="text-center py-8">
                    <PhoneIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No follow-ups yet</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Get started by creating your first follow-up.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {followUps.map((followUp) => (
                      <div key={followUp.id} className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                followUp.follow_up_type === 'Call' ? 'bg-blue-100 text-blue-800' :
                                followUp.follow_up_type === 'Email' ? 'bg-green-100 text-green-800' :
                                followUp.follow_up_type === 'Meeting' ? 'bg-purple-100 text-purple-800' :
                                followUp.follow_up_type === 'WhatsApp' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {followUp.follow_up_type}
                              </span>
                              <span className="text-sm text-gray-500">
                                {new Date(followUp.follow_up_date).toLocaleDateString()}
                              </span>
                              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                followUp.status === 'Completed' ? 'bg-green-100 text-green-800' :
                                followUp.status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {followUp.status}
                              </span>
                            </div>
                            <h4 className="text-sm font-medium text-gray-900 mb-1">
                              {followUp.description}
                            </h4>
                            {followUp.notes && (
                              <p className="text-sm text-gray-600">{followUp.notes}</p>
                            )}
                          </div>
                          <div className="flex space-x-2 ml-4">
                            <button
                              onClick={() => setEditingFollowUp(followUp.id)}
                              className="text-purple-600 hover:text-purple-800 p-1"
                            >
                              <PencilIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteFollowUp(followUp.id)}
                              className="text-red-600 hover:text-red-800 p-1"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add/Edit Follow-up Form */}
                {(showAddFollowUp || editingFollowUp) && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h4 className="text-lg font-medium text-gray-900 mb-4">
                      {editingFollowUp ? 'Edit Follow-up' : 'Add New Follow-up'}
                    </h4>
                    <form onSubmit={handleFollowUpSubmit} className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Follow-up Date
                          </label>
                          <input
                            type="date"
                            name="follow_up_date"
                            value={followUpForm.follow_up_date}
                            onChange={handleFollowUpChange}
                            required
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Follow-up Type
                          </label>
                          <select
                            name="follow_up_type"
                            value={followUpForm.follow_up_type}
                            onChange={handleFollowUpChange}
                            required
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          >
                            <option value="Call">Call</option>
                            <option value="Email">Email</option>
                            <option value="Meeting">Meeting</option>
                            <option value="WhatsApp">WhatsApp</option>
                            <option value="Site Visit">Site Visit</option>
                          </select>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Status
                          </label>
                          <select
                            name="status"
                            value={followUpForm.status}
                            onChange={handleFollowUpChange}
                            required
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          >
                            <option value="Pending">Pending</option>
                            <option value="Completed">Completed</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Next Follow-up Date
                          </label>
                          <input
                            type="date"
                            name="next_follow_up_date"
                            value={followUpForm.next_follow_up_date}
                            onChange={handleFollowUpChange}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Description
                        </label>
                        <textarea
                          name="description"
                          value={followUpForm.description}
                          onChange={handleFollowUpChange}
                          required
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          placeholder="Describe the follow-up activity..."
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Notes
                        </label>
                        <textarea
                          name="notes"
                          value={followUpForm.notes}
                          onChange={handleFollowUpChange}
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          placeholder="Additional notes..."
                        />
                      </div>
                      
                      <div className="flex justify-end space-x-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFollowUp(null);
                            setShowAddFollowUp(false);
                          }}
                          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={addingFollowUp}
                          className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
                        >
                          {addingFollowUp ? 'Saving...' : (editingFollowUp ? 'Update' : 'Create')} Follow-up
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div> // ✅ closes main wrapper
  );
}
