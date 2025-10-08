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
    details: ''
  });
  const [addingFollowUp, setAddingFollowUp] = useState(false);

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

  // Fetch follow-ups for this lead
  useEffect(() => {
    if (!lead) return;
    const fetchFollowUps = async () => {
      try {
        const res = await fetch(`/api/followups?lead_id=${lead.id}`);
        const result = await res.json();
        if (result.success) setFollowUps(result.data);
  } catch { /* ignore */ }
    };
    fetchFollowUps();
  }, [lead]);

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

  // Handle follow-up submit
  const handleFollowUpSubmit = async (e) => {
    e.preventDefault();
    setAddingFollowUp(true);
    try {
      // Basic client-side validation
      if (!followUpForm.follow_up_date || !followUpForm.details) {
        alert('Please provide a date and details for the follow-up.');
        setAddingFollowUp(false);
        return;
      }

      const res = await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          follow_up_date: followUpForm.follow_up_date,
          follow_up_type: followUpForm.type || 'Call',
          description: followUpForm.details,
          status: 'Scheduled'
        })
      });

      const result = await res.json();
      if (result.success) {
        // Optimistically append the created follow-up to the list
        setFollowUps(prev => [result.data, ...prev]);
        setFollowUpForm({ follow_up_date: new Date().toISOString().split('T')[0], details: '' });
      } else {
        alert(result.error || 'Error adding follow-up');
      }
    } catch {
      alert('Error adding follow-up');
    } finally {
      setAddingFollowUp(false);
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

          {/* Content: Side-by-side layout */}
          <div className="h-full overflow-y-auto pb-8 pr-4">
            <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-8">
              {/* Edit Lead Form */}
              <div className="flex-1 min-w-0">
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
              </div>
              {/* Follow-Ups Container */}
              <div className="w-full lg:w-96 flex-shrink-0">
                <div className="bg-white rounded-lg border border-gray-200 p-6 h-full flex flex-col">
                  <h2 className="text-lg font-semibold mb-4 text-accent-primary">Follow Ups</h2>
                  {/* Add Follow Up Form */}
                  <form onSubmit={handleFollowUpSubmit} className="mb-6">
                    <div className="mb-2">
                      <label className="block text-xs font-medium text-black mb-1">Date</label>
                      <input
                        type="date"
                        name="follow_up_date"
                        value={followUpForm.follow_up_date}
                        onChange={handleFollowUpChange}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        required
                      />
                    </div>
                    <div className="mb-2">
                      <label className="block text-xs font-medium text-black mb-1">Details</label>
                      <textarea
                        name="details"
                        value={followUpForm.details}
                        onChange={handleFollowUpChange}
                        rows={2}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        placeholder="Follow-up details..."
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={addingFollowUp}
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-md transition-colors disabled:opacity-50 text-xs"
                    >
                      {addingFollowUp ? 'Adding...' : 'Add Follow Up'}
                    </button>
                  </form>
                  {/* Follow Ups List */}
                  <div className="flex-1 overflow-y-auto">
                    {followUps.length === 0 ? (
                      <div className="text-gray-500 text-sm text-center mt-8">No follow-ups yet.</div>
                    ) : (
                      <ol className="divide-y divide-gray-200 list-decimal list-inside">
                        {(
                          // Ensure newest-first sort by follow_up_date then created_at
                          [...followUps].sort((a, b) => {
                            const da = new Date(a.follow_up_date || a.created_at || 0).getTime();
                            const db = new Date(b.follow_up_date || b.created_at || 0).getTime();
                            if (db !== da) return db - da;
                            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
                          })
                        ).map((fu) => {
                          const d = fu.follow_up_date ? new Date(fu.follow_up_date) : (fu.created_at ? new Date(fu.created_at) : null);
                          const formattedDate = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : 'N/A';
                          return (
                            <li key={fu.id} className="py-3">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="text-xs font-medium text-black">{formattedDate}</div>
                                  <div className="text-xs text-gray-700 mt-1">{fu.description}</div>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
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
