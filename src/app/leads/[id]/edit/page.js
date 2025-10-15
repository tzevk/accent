'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchJSON } from '@/utils/http';
import { 
  ArrowLeftIcon,
  CheckIcon,
  XMarkIcon,
  UserIcon,
  PhoneIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon
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
            follow_up_date: followUp.follow_up_date,
            follow_up_type: followUp.follow_up_type || 'Call',
            description: followUp.description || '',
            status: followUp.status || 'Scheduled',
            next_action: followUp.next_action || '',
            next_follow_up_date: followUp.next_follow_up_date || '',
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
        
        {/* Tab Navigation - Fixed */}
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
              <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Lead ID */}
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">
                        Lead ID
                      </label>
                      <input
                        type="text"
                        name="lead_id"
                        value={formData.lead_id}
                        onChange={handleInputChange}
                        className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        placeholder="Enter lead ID"
                      />
                    </div>

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

                    {/* Inquiry Email */}
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">
                        Inquiry Email
                      </label>
                      <input
                        type="email"
                        name="inquiry_email"
                        value={formData.inquiry_email}
                        onChange={handleInputChange}
                        className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-0.5">Email ID of person from whom inquiry was received</p>
                    </div>

                    {/* CC Emails */}
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-black mb-1">
                        CC Emails
                      </label>
                      <input
                        type="text"
                        name="cc_emails"
                        value={formData.cc_emails}
                        onChange={handleInputChange}
                        placeholder="email1@example.com, email2@example.com, email3@example.com"
                        className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-0.5">Additional email IDs (2-6 emails, comma-separated)</p>
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
                )}
                
                {activeTab === 'followups' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h2 className="text-xl font-semibold text-gray-900">Follow-ups</h2>
                      <button
                        onClick={() => setShowAddFollowUp(true)}
                        className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                      >
                        <PlusIcon className="h-4 w-4 mr-2" />
                        Add Follow-up
                      </button>
                    </div>
                    
                    {(showAddFollowUp || editingFollowUp) && (
                      <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">
                            {editingFollowUp ? 'Edit Follow-up' : 'Add New Follow-up'}
                          </h3>
                          <button
                            onClick={() => {
                              setEditingFollowUp(null);
                              setShowAddFollowUp(false);
                              setFollowUpForm({
                                follow_up_date: new Date().toISOString().split('T')[0],
                                follow_up_type: 'Call',
                                description: '',
                                status: 'Scheduled',
                                next_action: '',
                                next_follow_up_date: '',
                                notes: ''
                              });
                            }}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            ✕
                          </button>
                        </div>
                        
                        <form onSubmit={handleFollowUpSubmit} className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Follow-up Date <span className="text-red-500">*</span>
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
                              <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                              <select
                                name="follow_up_type"
                                value={followUpForm.follow_up_type}
                                onChange={handleFollowUpChange}
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
                              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                              <select
                                name="status"
                                value={followUpForm.status}
                                onChange={handleFollowUpChange}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                              >
                                <option value="Scheduled">Scheduled</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Completed">Completed</option>
                                <option value="Cancelled">Cancelled</option>
                              </select>
                            </div>
                            
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Next Follow-up Date</label>
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
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Description <span className="text-red-500">*</span>
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
                            <label className="block text-sm font-medium text-gray-700 mb-2">Next Action</label>
                            <input
                              type="text"
                              name="next_action"
                              value={followUpForm.next_action}
                              onChange={handleFollowUpChange}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                              placeholder="What should be done next?"
                            />
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
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
                    
                    <div className="bg-white rounded-lg border border-gray-200">
                      {followUps.length === 0 ? (
                        <div className="p-8 text-center">
                          <PhoneIcon className="mx-auto h-12 w-12 text-gray-400" />
                          <h3 className="mt-2 text-sm font-medium text-gray-900">No follow-ups yet</h3>
                          <p className="mt-1 text-sm text-gray-500">
                            Create your first follow-up to track communication with this lead.
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-200">
                          {followUps.map((followUp) => (
                            <div key={followUp.id} className="p-6">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-3">
                                    <div className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                      followUp.status === 'Completed' ? 'bg-green-100 text-green-800' :
                                      followUp.status === 'Scheduled' ? 'bg-blue-100 text-blue-800' :
                                      followUp.status === 'In Progress' ? 'bg-yellow-100 text-yellow-800' :
                                      'bg-gray-100 text-gray-800'
                                    }`}>
                                      {followUp.status}
                                    </div>
                                    <span className="text-sm font-medium text-gray-900">
                                      {followUp.follow_up_type}
                                    </span>
                                    <span className="text-sm text-gray-500">
                                      {new Date(followUp.follow_up_date).toLocaleDateString()}
                                    </span>
                                  </div>
                                  
                                  <p className="mt-2 text-sm text-gray-700">
                                    {followUp.description}
                                  </p>
                                  
                                  {followUp.next_action && (
                                    <div className="mt-2 flex items-center text-sm text-gray-600">
                                      <ClockIcon className="h-4 w-4 mr-1" />
                                      Next: {followUp.next_action}
                                      {followUp.next_follow_up_date && (
                                        <span className="ml-2">
                                          ({new Date(followUp.next_follow_up_date).toLocaleDateString()})
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  
                                  {followUp.notes && (
                                    <div className="mt-2 text-sm text-gray-600">
                                      <ChatBubbleLeftRightIcon className="h-4 w-4 inline mr-1" />
                                      {followUp.notes}
                                    </div>
                                  )}
                                </div>
                                
                                <div className="flex items-center space-x-2 ml-4">
                                  <button
                                    onClick={() => setEditingFollowUp(followUp.id)}
                                    className="text-purple-600 hover:text-purple-800 p-1"
                                    title="Edit Follow-up"
                                  >
                                    <PencilIcon className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteFollowUp(followUp.id)}
                                    className="text-red-600 hover:text-red-800 p-1"
                                    title="Delete Follow-up"
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      </div>
  );
}
