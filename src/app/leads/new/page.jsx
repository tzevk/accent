'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

const STATUS_OPTIONS = ['NEW', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'cancelled'];
const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'];
const ENQUIRY_TYPE_OPTIONS = ['CONSULTANCY', 'EPC', 'PMC', 'ONGOING_PROJECT', 'MAINTENANCE', 'OTHER'];

const INITIAL_FORM = {
  lead_id: '',
  company_name: '',
  contact_name: '',
  contact_email: '',
  inquiry_email: '',
  cc_emails: '',
  phone: '',
  designation: '',
  city: '',
  project_description: '',
  enquiry_type: 'CONSULTANCY',
  enquiry_status: 'NEW',
  enquiry_date: '',
  lead_source: '',
  priority: 'MEDIUM',
  notes: ''
};

function LoadingFallback() {
  return (
    <LoadingSpinner message="Loading" subMessage="Preparing form..." size="sm" />
  );
}

function NewLeadForm() {
  const router = useRouter();
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        router.push('/leads');
      } else {
        alert(data.error || 'Failed to create lead');
      }
    } catch (error) {
      console.error('Error creating lead:', error);
      alert('Failed to create lead');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-24 pb-8">
            {/* Header */}
            <div className="mb-8 flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Add New Lead</h1>
                <p className="text-gray-600">Create a new lead entry</p>
              </div>
            </div>

            {/* Form */}
            <div className="max-w-4xl">
              <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Lead ID */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Lead ID
                    </label>
                    <input
                      type="text"
                      name="lead_id"
                      value={formData.lead_id}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="Auto-generated if empty"
                    />
                  </div>

                  {/* Company Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Company Name *
                    </label>
                    <input
                      type="text"
                      name="company_name"
                      value={formData.company_name}
                      onChange={handleChange}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  {/* Contact Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Contact Name *
                    </label>
                    <input
                      type="text"
                      name="contact_name"
                      value={formData.contact_name}
                      onChange={handleChange}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  {/* Contact Email */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Contact Email
                    </label>
                    <input
                      type="email"
                      name="contact_email"
                      value={formData.contact_email}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  {/* Inquiry Email */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Inquiry Email
                    </label>
                    <input
                      type="email"
                      name="inquiry_email"
                      value={formData.inquiry_email}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  {/* CC Emails */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      CC Emails
                    </label>
                    <input
                      type="text"
                      name="cc_emails"
                      value={formData.cc_emails}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="email1@example.com, email2@example.com"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Phone
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  {/* Designation */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Designation
                    </label>
                    <input
                      type="text"
                      name="designation"
                      value={formData.designation}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  {/* City */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      City
                    </label>
                    <input
                      type="text"
                      name="city"
                      value={formData.city}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  {/* Enquiry Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Enquiry Type
                    </label>
                    <select
                      name="enquiry_type"
                      value={formData.enquiry_type}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      {ENQUIRY_TYPE_OPTIONS.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  {/* Enquiry Status */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Enquiry Status
                    </label>
                    <select
                      name="enquiry_status"
                      value={formData.enquiry_status}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      {STATUS_OPTIONS.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  {/* Enquiry Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Enquiry Date
                    </label>
                    <input
                      type="date"
                      name="enquiry_date"
                      value={formData.enquiry_date}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  {/* Lead Source */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Lead Source
                    </label>
                    <input
                      type="text"
                      name="lead_source"
                      value={formData.lead_source}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="Website, Referral, etc."
                    />
                  </div>

                  {/* Priority */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Priority
                    </label>
                    <select
                      name="priority"
                      value={formData.priority}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      {PRIORITY_OPTIONS.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Project Description */}
                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Project Description
                  </label>
                  <textarea
                    name="project_description"
                    value={formData.project_description}
                    onChange={handleChange}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="Describe the project requirements..."
                  />
                </div>

                {/* Notes */}
                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notes
                  </label>
                  <textarea
                    name="notes"
                    value={formData.notes}
                    onChange={handleChange}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="Additional notes..."
                  />
                </div>

                {/* Submit Button */}
                <div className="mt-8 flex justify-end">
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="mr-4 px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? 'Creating...' : 'Create Lead'}
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

export default function NewLeadPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <NewLeadForm />
    </Suspense>
  );
}
