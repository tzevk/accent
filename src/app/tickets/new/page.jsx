'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import {
  TicketIcon,
  PaperClipIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  InformationCircleIcon,
  ArrowLeftIcon
} from '@heroicons/react/24/outline';

// Categories with HR/Admin routing
const CATEGORIES = [
  // HR Categories
  { value: 'payroll', label: 'Payroll', routedTo: 'HR', icon: '💰', description: 'Salary, deductions, tax issues' },
  { value: 'leave', label: 'Leave', routedTo: 'HR', icon: '🏖️', description: 'Leave applications, balance queries' },
  { value: 'policy', label: 'Policy', routedTo: 'HR', icon: '📋', description: 'Company policies, guidelines' },
  { value: 'confidential', label: 'Confidential Matters', routedTo: 'HR (Restricted)', icon: '🔒', description: 'Private HR matters' },
  
  // Admin Categories
  { value: 'access_cards', label: 'Access Cards', routedTo: 'Admin', icon: '🪪', description: 'ID cards, access permissions' },
  { value: 'seating', label: 'Seating', routedTo: 'Admin', icon: '💺', description: 'Desk allocation, workspace requests' },
  { value: 'maintenance', label: 'Maintenance', routedTo: 'Admin', icon: '🔧', description: 'Facility issues, repairs' },
  { value: 'general_request', label: 'General Request', routedTo: 'Admin', icon: '📝', description: 'Other administrative requests' }
];

const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-300', description: 'Can wait, not blocking work' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-100 text-blue-700 border-blue-300', description: 'Normal priority' },
  { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-300', description: 'Needs attention soon' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-100 text-red-700 border-red-300', description: 'Critical, blocking work' }
];

export default function CreateTicketPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    subject: '',
    description: '',
    category: 'general_request',
    priority: 'medium',
    attachment_url: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await res.json();
      if (data.success) {
        // Navigate to the new ticket detail page
        router.push(`/tickets/${data.data.id}`);
      } else {
        alert(data.error || 'Failed to create ticket');
      }
    } catch (error) {
      console.error('Error creating ticket:', error);
      alert('Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCategory = CATEGORIES.find(c => c.value === formData.category);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="flex pt-16 sm:pl-16">
        <div className="flex-1">
          <div className="px-4 sm:px-6 lg:px-8 py-8">
            {/* Breadcrumb */}
            <nav className="text-xs text-gray-500 mb-1" aria-label="Breadcrumb">
              <ol className="inline-flex items-center gap-2">
                <li>Home</li>
                <li className="text-gray-300">/</li>
                <li><button onClick={() => router.push('/tickets')} className="hover:text-gray-700">Support Tickets</button></li>
                <li className="text-gray-300">/</li>
                <li className="text-gray-700">Create</li>
              </ol>
            </nav>
            
            {/* Back Button */}
            <button
              onClick={() => router.push('/tickets')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 group"
            >
              <ArrowLeftIcon className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
              Back to Tickets
            </button>

            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <TicketIcon className="h-8 w-8 text-indigo-600" />
                Create Support Ticket
              </h1>
              <p className="text-gray-600 mt-2">Fill out the form below to submit a support request</p>
            </div>

            {/* Form Card */}
            <div className="bg-white rounded-1xl shadow-sm border border-gray-200 max-w-10xl">
              <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Subject */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Subject *
              </label>
              <input
                type="text"
                required
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                placeholder="Brief summary of your request"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Category * <span className="text-xs font-normal text-gray-500">(Auto-routed to HR/Admin)</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {CATEGORIES.map((category) => (
                  <label
                    key={category.value}
                    className={`relative flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      formData.category === category.value
                        ? 'border-indigo-600 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="category"
                      value={category.value}
                      checked={formData.category === category.value}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="sr-only"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xl">{category.icon}</span>
                        <span className="font-semibold text-gray-900 text-sm">{category.label}</span>
                      </div>
                      <p className="text-xs text-gray-600">{category.description}</p>
                      <p className="text-xs font-medium text-indigo-600 mt-1">→ {category.routedTo}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Description *
              </label>
              <textarea
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Please describe your request in detail..."
                rows={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Priority *
              </label>
              <div className="grid grid-cols-4 gap-3">
                {PRIORITIES.map((priority) => (
                  <label
                    key={priority.value}
                    className={`relative flex flex-col items-center p-3 border-2 rounded-lg cursor-pointer transition-all ${
                      formData.priority === priority.value
                        ? 'border-indigo-600 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value={priority.value}
                      checked={formData.priority === priority.value}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                      className="sr-only"
                    />
                    <span className={`font-semibold text-sm ${priority.color.split(' ')[1]}`}>
                      {priority.label}
                    </span>
                    <span className="text-xs text-gray-600 text-center mt-1">{priority.description}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Attachment URL (Optional) */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Attachment URL <span className="text-xs font-normal text-gray-500">(Optional)</span>
              </label>
              <input
                type="url"
                value={formData.attachment_url}
                onChange={(e) => setFormData({ ...formData, attachment_url: e.target.value })}
                placeholder="https://example.com/file.pdf"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                <PaperClipIcon className="h-3 w-3 inline mr-1" />
                Paste a link to any supporting documents
              </p>
            </div>

            {/* Routing Preview */}
            {selectedCategory && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                <p className="text-sm text-indigo-800">
                  <span className="font-semibold">This ticket will be routed to:</span>{' '}
                  <span className="font-bold">{selectedCategory.routedTo}</span>
                </p>
              </div>
            )}

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
              <InformationCircleIcon className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">What happens next?</p>
                <p>Your ticket will be automatically routed to the appropriate department based on the category. You&apos;ll receive updates via notifications.</p>
              </div>
            </div>

            {/* Submit Buttons */}
            <div className="flex gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={() => router.push('/tickets')}
                className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <ArrowPathIcon className="h-5 w-5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="h-5 w-5" />
                    Create Ticket
                  </>
                )}
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
