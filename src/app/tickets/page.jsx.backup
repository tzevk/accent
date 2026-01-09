'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import {
  TicketIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
  PhotoIcon,
  XMarkIcon,
  PaperClipIcon,
  LightBulbIcon,
  ComputerDesktopIcon,
  BugAntIcon,
  ShieldExclamationIcon,
  QuestionMarkCircleIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';

const CATEGORIES = [
  { value: 'login_issues', label: 'Login / Authentication Issues', icon: ShieldExclamationIcon, hint: 'Problems signing in, password issues, session timeouts' },
  { value: 'performance', label: 'Slow Performance', icon: ClockIcon, hint: 'Pages loading slowly, timeouts, unresponsive buttons' },
  { value: 'bug_report', label: 'Bug / Error Report', icon: BugAntIcon, hint: 'Something not working as expected, error messages' },
  { value: 'feature_request', label: 'Feature Request', icon: LightBulbIcon, hint: 'Suggest new features or improvements' },
  { value: 'data_issue', label: 'Data / Display Issue', icon: ComputerDesktopIcon, hint: 'Wrong data showing, missing information, formatting problems' },
  { value: 'access_permission', label: 'Access / Permission Issue', icon: ShieldExclamationIcon, hint: 'Cannot access certain pages or features' },
  { value: 'other', label: 'Other', icon: QuestionMarkCircleIcon, hint: 'Any other technical issue' }
];

const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700', description: 'Minor issue, workaround exists' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-100 text-blue-700', description: 'Affects work but not critical' },
  { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-700', description: 'Major impact on productivity' },
  { value: 'critical', label: 'Critical', color: 'bg-red-100 text-red-700', description: 'Work completely blocked' }
];

const STATUSES = [
  { value: 'open', label: 'Open', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-blue-100 text-blue-800' },
  { value: 'pending_info', label: 'Pending Info', color: 'bg-purple-100 text-purple-800' },
  { value: 'resolved', label: 'Resolved', color: 'bg-green-100 text-green-800' },
  { value: 'closed', label: 'Closed', color: 'bg-gray-100 text-gray-800' }
];

// Contextual hints based on category
const CATEGORY_HINTS = {
  login_issues: [
    '💡 Have you tried clearing your browser cache and cookies?',
    '💡 Are you using the correct email address?',
    '💡 Check if Caps Lock is accidentally enabled',
    '💡 Try using a different browser (Chrome, Firefox, Edge)'
  ],
  performance: [
    '💡 How long does the page take to load?',
    '💡 Is this happening on all pages or specific ones?',
    '💡 Have you tried refreshing the page?',
    '💡 Are you on a stable internet connection?'
  ],
  bug_report: [
    '💡 What exactly did you click or do before the error?',
    '💡 Did you see any error message? If so, what did it say?',
    '💡 Can you reproduce this issue consistently?',
    '💡 Screenshots are very helpful for bug reports!'
  ],
  data_issue: [
    '💡 What data were you expecting to see?',
    '💡 When did you last see the correct data?',
    '💡 Is this affecting one record or multiple?',
    '💡 Have you tried refreshing the page?'
  ],
  access_permission: [
    '💡 Which page or feature are you trying to access?',
    '💡 What error message do you see?',
    '💡 Were you able to access this before?',
    '💡 Contact your admin if this is a new access request'
  ],
  feature_request: [
    '💡 Describe how this feature would help your work',
    '💡 Is there a workaround you currently use?',
    '💡 How often would you use this feature?',
    '💡 Would this benefit other team members too?'
  ],
  other: [
    '💡 Please describe your issue in detail',
    '💡 Include any error messages you see',
    '💡 Mention what you were trying to do',
    '💡 Screenshots always help!'
  ]
};

export default function TicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchTickets();
  }, [filterStatus, filterPriority]);

  const fetchTickets = async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.append('status', filterStatus);
      if (filterPriority) params.append('priority', filterPriority);
      
      const res = await fetch(`/api/tickets?${params}`);
      const data = await res.json();
      if (data.success) {
        setTickets(data.data);
      }
    } catch (error) {
      console.error('Error fetching tickets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewTicket = async (ticket) => {
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`);
      const data = await res.json();
      if (data.success) {
        setSelectedTicket(data.data);
        setShowViewModal(true);
      }
    } catch (error) {
      console.error('Error fetching ticket details:', error);
    }
  };

  const filteredTickets = tickets.filter(ticket => 
    searchQuery === '' || 
    ticket.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ticket.ticket_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ticket.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusBadge = (status) => {
    const statusConfig = STATUSES.find(s => s.value === status);
    return statusConfig ? (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusConfig.color}`}>
        {statusConfig.label}
      </span>
    ) : status;
  };

  const getPriorityBadge = (priority) => {
    const priorityConfig = PRIORITIES.find(p => p.value === priority);
    return priorityConfig ? (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${priorityConfig.color}`}>
        {priorityConfig.label}
      </span>
    ) : priority;
  };

  const getCategoryLabel = (category) => {
    const cat = CATEGORIES.find(c => c.value === category);
    return cat ? cat.label : category;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <TicketIcon className="h-7 w-7 text-violet-600" />
              Support Tickets
            </h1>
            <p className="text-gray-500 mt-1">Report technical issues and track their resolution</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors shadow-sm"
          >
            <PlusIcon className="h-5 w-5" />
            New Ticket
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search tickets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <FunnelIcon className="h-5 w-5 text-gray-400" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent text-sm"
              >
                <option value="">All Status</option>
                {STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent text-sm"
              >
                <option value="">All Priority</option>
                {PRIORITIES.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <button
                onClick={fetchTickets}
                className="p-2 text-gray-500 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                title="Refresh"
              >
                <ArrowPathIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Tickets List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-600 mx-auto"></div>
              <p className="mt-4 text-gray-500">Loading tickets...</p>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="p-12 text-center">
              <TicketIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No tickets found</h3>
              <p className="text-gray-500 mb-6">
                {searchQuery || filterStatus || filterPriority 
                  ? 'Try adjusting your filters'
                  : 'Create your first support ticket to get help'}
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700"
              >
                <PlusIcon className="h-5 w-5" />
                Create Ticket
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredTickets.map(ticket => (
                <div
                  key={ticket.id}
                  onClick={() => handleViewTicket(ticket)}
                  className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-violet-600 bg-violet-50 px-2 py-0.5 rounded">
                          {ticket.ticket_number}
                        </span>
                        {getStatusBadge(ticket.status)}
                        {getPriorityBadge(ticket.priority)}
                      </div>
                      <h3 className="font-medium text-gray-900 truncate">{ticket.title}</h3>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{ticket.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        <span>{getCategoryLabel(ticket.category)}</span>
                        <span>•</span>
                        <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                        {ticket.assigned_to_name && (
                          <>
                            <span>•</span>
                            <span>Assigned to: {ticket.assigned_to_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {ticket.screenshots?.length > 0 && (
                      <div className="flex items-center gap-1 text-gray-400">
                        <PhotoIcon className="h-5 w-5" />
                        <span className="text-xs">{ticket.screenshots.length}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Ticket Modal */}
      {showCreateModal && (
        <CreateTicketModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchTickets();
          }}
        />
      )}

      {/* View Ticket Modal */}
      {showViewModal && selectedTicket && (
        <ViewTicketModal
          ticket={selectedTicket}
          onClose={() => {
            setShowViewModal(false);
            setSelectedTicket(null);
          }}
          onUpdate={() => {
            fetchTickets();
            handleViewTicket(selectedTicket);
          }}
        />
      )}
    </div>
  );
}

// Create Ticket Modal Component
function CreateTicketModal({ onClose, onSuccess }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    priority: 'medium',
    screenshots: [],
    steps_to_reproduce: '',
    expected_behavior: '',
    actual_behavior: '',
    page_url: typeof window !== 'undefined' ? window.location.href : '',
    browser_info: typeof navigator !== 'undefined' ? navigator.userAgent : ''
  });
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const selectedCategory = CATEGORIES.find(c => c.value === form.category);
  const hints = form.category ? CATEGORY_HINTS[form.category] : [];

  const handleScreenshotUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploading(true);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', 'tickets');

        const res = await fetch('/api/uploads', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();
        if (data.success && data.file?.url) {
          setForm(prev => ({
            ...prev,
            screenshots: [...prev.screenshots, { url: data.file.url, name: file.name }]
          }));
        }
      }
    } catch (error) {
      console.error('Error uploading screenshot:', error);
    } finally {
      setUploading(false);
    }
  };

  const removeScreenshot = (index) => {
    setForm(prev => ({
      ...prev,
      screenshots: prev.screenshots.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async () => {
    if (!form.title || !form.description || !form.category) {
      alert('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });

      const data = await res.json();
      if (data.success) {
        alert(`Ticket ${data.data.ticket_number} created successfully!`);
        onSuccess();
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Report a Technical Issue</h2>
            <p className="text-sm text-gray-500 mt-1">
              {step === 1 ? 'Select issue category' : step === 2 ? 'Describe your issue' : 'Add details & submit'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(s => (
              <div key={s} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  s === step ? 'bg-violet-600 text-white' : s < step ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {s < step ? <CheckCircleIcon className="h-5 w-5" /> : s}
                </div>
                {s < 3 && (
                  <div className={`w-16 h-1 mx-2 rounded ${s < step ? 'bg-green-500' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 mb-4">What type of issue are you experiencing?</p>
              {CATEGORIES.map(cat => {
                const Icon = cat.icon;
                const isSelected = form.category === cat.value;
                return (
                  <button
                    key={cat.value}
                    onClick={() => setForm(prev => ({ ...prev, category: cat.value }))}
                    className={`w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                      isSelected 
                        ? 'border-violet-500 bg-violet-50' 
                        : 'border-gray-200 hover:border-violet-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${isSelected ? 'bg-violet-100 text-violet-600' : 'bg-gray-100 text-gray-500'}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{cat.label}</div>
                      <div className="text-sm text-gray-500 mt-0.5">{cat.hint}</div>
                    </div>
                    {isSelected && (
                      <CheckCircleIcon className="h-6 w-6 text-violet-600 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              {/* Helpful Hints */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <LightBulbIcon className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-amber-800 mb-2">Before you report:</h4>
                    <ul className="space-y-1">
                      {hints.map((hint, i) => (
                        <li key={i} className="text-sm text-amber-700">{hint}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Issue Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Brief summary of the issue..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Describe the Issue <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="What happened? What were you trying to do? Include any error messages..."
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-y"
                />
              </div>

              {/* Screenshots */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Screenshots
                  <span className="text-gray-400 font-normal ml-1">(optional but helpful!)</span>
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-violet-400 transition-colors">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleScreenshotUpload}
                    accept="image/*"
                    multiple
                    className="hidden"
                  />
                  <div className="text-center">
                    {uploading ? (
                      <div className="flex items-center justify-center gap-2 text-violet-600">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
                        <span>Uploading...</span>
                      </div>
                    ) : (
                      <>
                        <PhotoIcon className="h-10 w-10 text-gray-400 mx-auto mb-2" />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-violet-600 hover:text-violet-700 font-medium"
                        >
                          Click to upload screenshots
                        </button>
                        <p className="text-xs text-gray-500 mt-1">PNG, JPG up to 5MB each</p>
                      </>
                    )}
                  </div>
                </div>
                {form.screenshots.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {form.screenshots.map((ss, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={ss.url}
                          alt={ss.name}
                          className="h-20 w-20 object-cover rounded-lg border border-gray-200"
                        />
                        <button
                          onClick={() => removeScreenshot(index)}
                          className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  How urgent is this issue?
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {PRIORITIES.map(p => (
                    <button
                      key={p.value}
                      onClick={() => setForm(prev => ({ ...prev, priority: p.value }))}
                      className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                        form.priority === p.value 
                          ? 'border-violet-500 bg-violet-50' 
                          : 'border-gray-200 hover:border-violet-300'
                      }`}
                    >
                      <div className={`px-2 py-1 rounded text-xs font-medium ${p.color}`}>
                        {p.label}
                      </div>
                      <span className="text-xs text-gray-500">{p.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Steps to Reproduce (for bugs) */}
              {form.category === 'bug_report' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Steps to Reproduce
                      <span className="text-gray-400 font-normal ml-1">(optional)</span>
                    </label>
                    <textarea
                      value={form.steps_to_reproduce}
                      onChange={(e) => setForm(prev => ({ ...prev, steps_to_reproduce: e.target.value }))}
                      placeholder="1. Go to...&#10;2. Click on...&#10;3. See error"
                      rows={3}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-y"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Expected Behavior
                      </label>
                      <textarea
                        value={form.expected_behavior}
                        onChange={(e) => setForm(prev => ({ ...prev, expected_behavior: e.target.value }))}
                        placeholder="What should happen..."
                        rows={2}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-y"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Actual Behavior
                      </label>
                      <textarea
                        value={form.actual_behavior}
                        onChange={(e) => setForm(prev => ({ ...prev, actual_behavior: e.target.value }))}
                        placeholder="What actually happens..."
                        rows={2}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-y"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <h4 className="font-medium text-gray-900 mb-3">Ticket Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Category:</span>
                    <span className="font-medium">{selectedCategory?.label}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Title:</span>
                    <span className="font-medium truncate max-w-[200px]">{form.title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Priority:</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITIES.find(p => p.value === form.priority)?.color}`}>
                      {PRIORITIES.find(p => p.value === form.priority)?.label}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Screenshots:</span>
                    <span className="font-medium">{form.screenshots.length} attached</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium"
          >
            {step > 1 ? 'Back' : 'Cancel'}
          </button>
          <button
            onClick={() => {
              if (step < 3) {
                if (step === 1 && !form.category) {
                  alert('Please select a category');
                  return;
                }
                if (step === 2 && (!form.title || !form.description)) {
                  alert('Please fill in the title and description');
                  return;
                }
                setStep(step + 1);
              } else {
                handleSubmit();
              }
            }}
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {submitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Submitting...</span>
              </>
            ) : step < 3 ? (
              'Continue'
            ) : (
              <>
                <TicketIcon className="h-5 w-5" />
                <span>Submit Ticket</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// View Ticket Modal Component
function ViewTicketModal({ ticket, onClose, onUpdate }) {
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: newComment })
      });

      const data = await res.json();
      if (data.success) {
        setNewComment('');
        onUpdate();
      }
    } catch (error) {
      console.error('Error adding comment:', error);
    } finally {
      setSubmittingComment(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = STATUSES.find(s => s.value === status);
    return statusConfig ? (
      <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusConfig.color}`}>
        {statusConfig.label}
      </span>
    ) : status;
  };

  const getPriorityBadge = (priority) => {
    const priorityConfig = PRIORITIES.find(p => p.value === priority);
    return priorityConfig ? (
      <span className={`px-3 py-1 text-sm font-medium rounded-full ${priorityConfig.color}`}>
        {priorityConfig.label}
      </span>
    ) : priority;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-mono text-violet-600 bg-violet-50 px-3 py-1 rounded-lg">
                {ticket.ticket_number}
              </span>
              {getStatusBadge(ticket.status)}
              {getPriorityBadge(ticket.priority)}
            </div>
            <h2 className="text-xl font-semibold text-gray-900">{ticket.title}</h2>
            <p className="text-sm text-gray-500 mt-1">
              Created by {ticket.user_name} on {new Date(ticket.created_at).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Description */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Description</h3>
            <div className="bg-gray-50 rounded-lg p-4 text-gray-700 whitespace-pre-wrap">
              {ticket.description}
            </div>
          </div>

          {/* Screenshots */}
          {ticket.screenshots?.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Screenshots</h3>
              <div className="flex flex-wrap gap-3">
                {ticket.screenshots.map((ss, index) => (
                  <a
                    key={index}
                    href={ss.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <img
                      src={ss.url}
                      alt={ss.name || `Screenshot ${index + 1}`}
                      className="h-32 w-auto object-cover rounded-lg border border-gray-200 hover:border-violet-400 transition-colors"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Additional Details */}
          {(ticket.steps_to_reproduce || ticket.expected_behavior || ticket.actual_behavior) && (
            <div className="mb-6 space-y-4">
              {ticket.steps_to_reproduce && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Steps to Reproduce</h3>
                  <div className="bg-gray-50 rounded-lg p-4 text-gray-700 whitespace-pre-wrap text-sm">
                    {ticket.steps_to_reproduce}
                  </div>
                </div>
              )}
              {ticket.expected_behavior && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Expected Behavior</h3>
                  <div className="bg-gray-50 rounded-lg p-4 text-gray-700 whitespace-pre-wrap text-sm">
                    {ticket.expected_behavior}
                  </div>
                </div>
              )}
              {ticket.actual_behavior && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Actual Behavior</h3>
                  <div className="bg-gray-50 rounded-lg p-4 text-gray-700 whitespace-pre-wrap text-sm">
                    {ticket.actual_behavior}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Resolution Notes */}
          {ticket.resolution_notes && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Resolution</h3>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-green-800 whitespace-pre-wrap">{ticket.resolution_notes}</p>
                {ticket.resolved_by_name && (
                  <p className="text-sm text-green-600 mt-2">
                    Resolved by {ticket.resolved_by_name} on {new Date(ticket.resolved_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Comments */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
              <ChatBubbleLeftRightIcon className="h-5 w-5" />
              Comments ({ticket.comments?.length || 0})
            </h3>
            <div className="space-y-4">
              {ticket.comments?.map(comment => (
                <div key={comment.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-violet-600">
                      {comment.user_name?.charAt(0) || '?'}
                    </span>
                  </div>
                  <div className="flex-1 bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900 text-sm">{comment.user_name}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(comment.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-gray-700 text-sm whitespace-pre-wrap">{comment.comment}</p>
                  </div>
                </div>
              ))}

              {/* Add Comment */}
              {ticket.status !== 'closed' && (
                <div className="flex gap-3 mt-4">
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-gray-600">You</span>
                  </div>
                  <div className="flex-1">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment or update..."
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-y text-sm"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={handleAddComment}
                        disabled={!newComment.trim() || submittingComment}
                        className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {submittingComment ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            <span>Sending...</span>
                          </>
                        ) : (
                          'Add Comment'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
