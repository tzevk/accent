'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import { fetchJSON } from '@/utils/http';
import Navbar from '@/components/Navbar';
import {
  InboxIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  MagnifyingGlassIcon,
  PaperClipIcon,
  TrashIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  ArrowLeftIcon,
  DocumentIcon,
  LinkIcon,
  XMarkIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline';

export default function MessagesPage() {
  const { user, loading: authLoading } = useSessionRBAC();
  const [activeView, setActiveView] = useState('inbox'); // 'inbox', 'sent', 'compose', 'thread'
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [threadUser, setThreadUser] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);

  // Compose state
  const [users, setUsers] = useState([]);
  const [composeData, setComposeData] = useState({
    receiver_id: '',
    subject: '',
    body: '',
    related_module: 'none',
    related_id: ''
  });
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [relatedOptions, setRelatedOptions] = useState([]);

  // Fetch messages
  const fetchMessages = useCallback(async (type = 'inbox', page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        type,
        page: page.toString(),
        limit: '20'
      });
      if (searchTerm) params.append('search', searchTerm);

      const res = await fetchJSON(`/api/messages?${params}`);
      if (res.success) {
        setMessages(res.data.messages);
        setPagination(res.data.pagination);
        setUnreadCount(res.data.unread_count);
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetchJSON('/api/messages/unread-count');
      if (res.success) {
        setUnreadCount(res.data.unread_count);
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  }, []);

  // Fetch users for compose
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetchJSON('/api/users?limit=1000');
      if (res.success) {
        setUsers(res.data.filter(u => u.id !== user?.id));
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  }, [user?.id]);

  // Fetch related options based on module
  const fetchRelatedOptions = useCallback(async (module) => {
    if (module === 'none') {
      setRelatedOptions([]);
      return;
    }

    try {
      let endpoint = '';
      switch (module) {
        case 'lead': endpoint = '/api/leads?limit=100'; break;
        case 'client':
        case 'company': endpoint = '/api/companies?limit=100'; break;
        case 'project': endpoint = '/api/projects?limit=100'; break;
        case 'employee': endpoint = '/api/employees?limit=100'; break;
        case 'proposal': endpoint = '/api/proposals?limit=100'; break;
        default: return;
      }

      const res = await fetchJSON(endpoint);
      if (res.success) {
        let options = [];
        if (module === 'lead') {
          options = (res.data?.leads || res.data || []).map(l => ({
            id: l.id,
            name: l.contact_name || l.company_name || `Lead #${l.id}`
          }));
        } else if (module === 'employee') {
          options = (res.employees || res.data || []).map(e => ({
            id: e.id,
            name: `${e.first_name} ${e.last_name}`
          }));
        } else {
          options = (res.data || []).map(item => ({
            id: item.id,
            name: item.name || item.title || item.company_name || `#${item.id}`
          }));
        }
        setRelatedOptions(options);
      }
    } catch (error) {
      console.error('Failed to fetch related options:', error);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!authLoading && user) {
      fetchMessages('inbox');
      fetchUsers();
    }
  }, [authLoading, user, fetchMessages, fetchUsers]);

  // View change handler
  const handleViewChange = (view) => {
    setActiveView(view);
    setSelectedMessage(null);
    setThreadUser(null);
    setThreadMessages([]);
    
    if (view === 'inbox' || view === 'sent') {
      fetchMessages(view);
    } else if (view === 'compose') {
      setComposeData({
        receiver_id: '',
        subject: '',
        body: '',
        related_module: 'none',
        related_id: ''
      });
      setAttachments([]);
    }
  };

  // Open message
  const openMessage = async (message) => {
    try {
      const res = await fetchJSON(`/api/messages/${message.id}`);
      if (res.success) {
        setSelectedMessage(res.data);
        // Update unread count if it was unread
        if (!message.read_status && activeView === 'inbox') {
          fetchUnreadCount();
        }
      }
    } catch (error) {
      console.error('Failed to fetch message:', error);
    }
  };

  // Open thread with user
  const openThread = async (userId, userName) => {
    setActiveView('thread');
    setThreadUser({ id: userId, name: userName });
    
    try {
      const res = await fetchJSON(`/api/messages/thread/${userId}`);
      if (res.success) {
        setThreadMessages(res.data.messages);
        fetchUnreadCount();
      }
    } catch (error) {
      console.error('Failed to fetch thread:', error);
    }
  };

  // File upload handler
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/messages/attachments', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        setAttachments([...attachments, data.data]);
      } else {
        alert(data.error || 'Failed to upload file');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload file');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Remove attachment
  const removeAttachment = (index) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  // Send message
  const handleSendMessage = async () => {
    if (!composeData.receiver_id || !composeData.subject || !composeData.body) {
      alert('Please fill in all required fields');
      return;
    }

    setSending(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...composeData,
          receiver_id: parseInt(composeData.receiver_id),
          related_id: composeData.related_id ? parseInt(composeData.related_id) : null,
          attachments
        })
      });
      const data = await res.json();

      if (data.success) {
        alert('Message sent successfully!');
        handleViewChange('sent');
      } else {
        alert(data.error || 'Failed to send message');
      }
    } catch (error) {
      console.error('Send error:', error);
      alert('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // Reply to message
  const handleReply = (message) => {
    setActiveView('compose');
    setComposeData({
      receiver_id: message.sender_id.toString(),
      subject: message.subject.startsWith('Re: ') ? message.subject : `Re: ${message.subject}`,
      body: `\n\n---\nOn ${new Date(message.created_at).toLocaleString()}, ${message.sender_name} wrote:\n${message.body}`,
      related_module: message.related_module || 'none',
      related_id: message.related_id?.toString() || ''
    });
  };

  // Delete message
  const handleDelete = async (messageId) => {
    if (!confirm('Are you sure you want to delete this message?')) return;

    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete' })
      });
      const data = await res.json();

      if (data.success) {
        setSelectedMessage(null);
        fetchMessages(activeView === 'sent' ? 'sent' : 'inbox');
      }
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  // Format date
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Get module icon/color
  const getModuleStyle = (module) => {
    switch (module) {
      case 'lead': return { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Lead' };
      case 'project': return { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Project' };
      case 'client':
      case 'company': return { bg: 'bg-green-100', text: 'text-green-700', label: 'Company' };
      case 'employee': return { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Employee' };
      case 'proposal': return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Proposal' };
      default: return null;
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
            <p className="text-sm text-gray-500">Internal communication and document sharing</p>
          </div>

          <div className="flex gap-6">
            {/* Left Sidebar */}
            <div className="w-64 flex-shrink-0">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                {/* Compose Button */}
                <div className="p-4 border-b border-gray-200">
                  <button
                    onClick={() => handleViewChange('compose')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#7F2487] text-white rounded-lg hover:bg-[#6a1e73] transition-colors font-medium"
                  >
                    <PencilSquareIcon className="w-5 h-5" />
                    Compose
                  </button>
                </div>

                {/* Navigation */}
                <nav className="p-2">
                  <button
                    onClick={() => handleViewChange('inbox')}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      activeView === 'inbox' 
                        ? 'bg-purple-50 text-[#7F2487]' 
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <InboxIcon className="w-5 h-5" />
                    <span className="flex-1 font-medium">Inbox</span>
                    {unreadCount > 0 && (
                      <span className="px-2 py-0.5 text-xs font-bold bg-red-500 text-white rounded-full">
                        {unreadCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => handleViewChange('sent')}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      activeView === 'sent' 
                        ? 'bg-purple-50 text-[#7F2487]' 
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <PaperAirplaneIcon className="w-5 h-5" />
                    <span className="flex-1 font-medium">Sent</span>
                  </button>
                </nav>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 min-h-[600px]">
                {/* Compose View */}
                {activeView === 'compose' && (
                  <div className="p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">New Message</h2>
                    
                    <div className="space-y-4">
                      {/* To */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">To *</label>
                        <select
                          value={composeData.receiver_id}
                          onChange={(e) => setComposeData({ ...composeData, receiver_id: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                        >
                          <option value="">Select recipient</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name || u.username} ({u.email})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Subject */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
                        <input
                          type="text"
                          value={composeData.subject}
                          onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
                          placeholder="Enter subject"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                        />
                      </div>

                      {/* Related To */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Related To</label>
                          <select
                            value={composeData.related_module}
                            onChange={(e) => {
                              setComposeData({ ...composeData, related_module: e.target.value, related_id: '' });
                              fetchRelatedOptions(e.target.value);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                          >
                            <option value="none">None</option>
                            <option value="lead">Lead</option>
                            <option value="project">Project</option>
                            <option value="company">Company</option>
                            <option value="employee">Employee</option>
                            <option value="proposal">Proposal</option>
                          </select>
                        </div>
                        {composeData.related_module !== 'none' && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Select {composeData.related_module}</label>
                            <select
                              value={composeData.related_id}
                              onChange={(e) => setComposeData({ ...composeData, related_id: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                            >
                              <option value="">Select...</option>
                              {relatedOptions.map((opt) => (
                                <option key={opt.id} value={opt.id}>{opt.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      {/* Body */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
                        <textarea
                          value={composeData.body}
                          onChange={(e) => setComposeData({ ...composeData, body: e.target.value })}
                          placeholder="Type your message..."
                          rows={10}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent resize-none"
                        />
                      </div>

                      {/* Attachments */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Attachments</label>
                        
                        {attachments.length > 0 && (
                          <div className="mb-3 space-y-2">
                            {attachments.map((att, idx) => (
                              <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                                <DocumentIcon className="w-5 h-5 text-gray-400" />
                                <span className="flex-1 text-sm text-gray-700 truncate">{att.original_name}</span>
                                <span className="text-xs text-gray-500">
                                  {(att.file_size / 1024).toFixed(1)} KB
                                </span>
                                <button
                                  onClick={() => removeAttachment(idx)}
                                  className="p-1 text-gray-400 hover:text-red-500"
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <label className={`inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                          <PaperClipIcon className="w-5 h-5 text-gray-500" />
                          <span className="text-sm text-gray-700">
                            {uploading ? 'Uploading...' : 'Attach File'}
                          </span>
                          <input
                            type="file"
                            onChange={handleFileUpload}
                            className="hidden"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.txt,.csv"
                          />
                        </label>
                        <p className="mt-1 text-xs text-gray-500">
                          Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, GIF, TXT, CSV (max 10MB)
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex justify-end gap-3 pt-4">
                        <button
                          onClick={() => handleViewChange('inbox')}
                          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSendMessage}
                          disabled={sending}
                          className="flex items-center gap-2 px-6 py-2 bg-[#7F2487] text-white rounded-lg hover:bg-[#6a1e73] transition-colors disabled:opacity-50"
                        >
                          <PaperAirplaneIcon className="w-5 h-5" />
                          {sending ? 'Sending...' : 'Send'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Message List View (Inbox/Sent) */}
                {(activeView === 'inbox' || activeView === 'sent') && !selectedMessage && (
                  <>
                    {/* Search Bar */}
                    <div className="p-4 border-b border-gray-200">
                      <div className="relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && fetchMessages(activeView)}
                          placeholder="Search messages..."
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-transparent"
                        />
                      </div>
                    </div>

                    {/* Message List */}
                    {loading ? (
                      <div className="flex items-center justify-center py-20">
                        <ArrowPathIcon className="w-8 h-8 text-gray-400 animate-spin" />
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                        <EnvelopeIcon className="w-16 h-16 mb-4 text-gray-300" />
                        <p className="text-lg font-medium">No messages</p>
                        <p className="text-sm">
                          {activeView === 'inbox' 
                            ? 'Your inbox is empty' 
                            : 'You haven\'t sent any messages yet'}
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {messages.map((msg) => (
                          <div
                            key={msg.id}
                            onClick={() => openMessage(msg)}
                            className={`flex items-start gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                              !msg.read_status && activeView === 'inbox' ? 'bg-blue-50/50' : ''
                            }`}
                          >
                            {/* Read/Unread indicator */}
                            <div className="pt-1">
                              {!msg.read_status && activeView === 'inbox' ? (
                                <EnvelopeIcon className="w-5 h-5 text-[#7F2487]" />
                              ) : (
                                <EnvelopeOpenIcon className="w-5 h-5 text-gray-400" />
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`font-medium truncate ${!msg.read_status && activeView === 'inbox' ? 'text-gray-900' : 'text-gray-700'}`}>
                                  {activeView === 'inbox' ? msg.sender_name : msg.receiver_name}
                                </span>
                                {msg.related_module && msg.related_module !== 'none' && (
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${getModuleStyle(msg.related_module)?.bg} ${getModuleStyle(msg.related_module)?.text}`}>
                                    {getModuleStyle(msg.related_module)?.label}
                                  </span>
                                )}
                                {msg.attachment_count > 0 && (
                                  <PaperClipIcon className="w-4 h-4 text-gray-400" />
                                )}
                              </div>
                              <p className={`text-sm truncate ${!msg.read_status && activeView === 'inbox' ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                                {msg.subject}
                              </p>
                              <p className="text-sm text-gray-500 truncate">{msg.body_preview}</p>
                            </div>

                            {/* Date */}
                            <div className="text-xs text-gray-500 whitespace-nowrap">
                              {formatDate(msg.created_at)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Pagination */}
                    {pagination.totalPages > 1 && (
                      <div className="flex items-center justify-between p-4 border-t border-gray-200">
                        <span className="text-sm text-gray-500">
                          Page {pagination.page} of {pagination.totalPages}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => fetchMessages(activeView, pagination.page - 1)}
                            disabled={pagination.page === 1}
                            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Previous
                          </button>
                          <button
                            onClick={() => fetchMessages(activeView, pagination.page + 1)}
                            disabled={pagination.page === pagination.totalPages}
                            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Single Message View */}
                {selectedMessage && activeView !== 'compose' && activeView !== 'thread' && (
                  <div>
                    {/* Message Header */}
                    <div className="p-4 border-b border-gray-200">
                      <button
                        onClick={() => setSelectedMessage(null)}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
                      >
                        <ArrowLeftIcon className="w-4 h-4" />
                        Back to {activeView}
                      </button>

                      <div className="flex items-start justify-between">
                        <div>
                          <h2 className="text-xl font-semibold text-gray-900">{selectedMessage.subject}</h2>
                          <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
                            <span>
                              <strong>From:</strong> {selectedMessage.sender_name} ({selectedMessage.sender_email})
                            </span>
                            <span>
                              <strong>To:</strong> {selectedMessage.receiver_name}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-gray-500">
                            {new Date(selectedMessage.created_at).toLocaleString()}
                          </div>
                          {selectedMessage.related_module && selectedMessage.related_module !== 'none' && (
                            <div className="mt-2 flex items-center gap-2">
                              <LinkIcon className="w-4 h-4 text-gray-400" />
                              <span className={`px-2 py-1 text-xs font-medium rounded ${getModuleStyle(selectedMessage.related_module)?.bg} ${getModuleStyle(selectedMessage.related_module)?.text}`}>
                                {getModuleStyle(selectedMessage.related_module)?.label}: {selectedMessage.related_entity_name || `#${selectedMessage.related_id}`}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2">
                          {activeView === 'inbox' && (
                            <>
                              <button
                                onClick={() => {
                                  const otherUserId = selectedMessage.sender_id;
                                  const otherUserName = selectedMessage.sender_name;
                                  openThread(otherUserId, otherUserName);
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                              >
                                <ChatBubbleLeftRightIcon className="w-4 h-4" />
                                View Conversation
                              </button>
                              <button
                                onClick={() => handleReply(selectedMessage)}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#7F2487] text-white rounded-lg hover:bg-[#6a1e73]"
                              >
                                Reply
                              </button>
                            </>
                          )}
                          {activeView === 'sent' && (
                            <button
                              onClick={() => {
                                const otherUserId = selectedMessage.receiver_id;
                                const otherUserName = selectedMessage.receiver_name;
                                openThread(otherUserId, otherUserName);
                              }}
                              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                            >
                              <ChatBubbleLeftRightIcon className="w-4 h-4" />
                              View Conversation
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(selectedMessage.id)}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Message Body */}
                    <div className="p-6">
                      <div className="prose max-w-none whitespace-pre-wrap text-gray-700">
                        {selectedMessage.body}
                      </div>

                      {/* Attachments */}
                      {selectedMessage.attachments && selectedMessage.attachments.length > 0 && (
                        <div className="mt-6 pt-6 border-t border-gray-200">
                          <h3 className="text-sm font-medium text-gray-700 mb-3">
                            Attachments ({selectedMessage.attachments.length})
                          </h3>
                          <div className="space-y-2">
                            {selectedMessage.attachments.map((att) => (
                              <a
                                key={att.id}
                                href={`/api/messages/attachments/${att.id}`}
                                download={att.original_name}
                                className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                              >
                                <DocumentIcon className="w-8 h-8 text-gray-400" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">{att.original_name}</p>
                                  <p className="text-xs text-gray-500">
                                    {(att.file_size / 1024).toFixed(1)} KB
                                  </p>
                                </div>
                                <span className="text-sm text-[#7F2487] font-medium">Download</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Thread View */}
                {activeView === 'thread' && threadUser && (
                  <div className="flex flex-col h-[600px]">
                    {/* Thread Header */}
                    <div className="p-4 border-b border-gray-200 flex items-center gap-4">
                      <button
                        onClick={() => handleViewChange('inbox')}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                      >
                        <ArrowLeftIcon className="w-5 h-5" />
                      </button>
                      <div>
                        <h2 className="font-semibold text-gray-900">{threadUser.name}</h2>
                        <p className="text-sm text-gray-500">Conversation</p>
                      </div>
                    </div>

                    {/* Thread Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {threadMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[70%] rounded-lg p-4 ${
                            msg.sender_id === user?.id
                              ? 'bg-[#7F2487] text-white'
                              : 'bg-gray-100 text-gray-900'
                          }`}>
                            <p className="text-sm font-medium mb-1">{msg.subject}</p>
                            <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                            <p className={`text-xs mt-2 ${
                              msg.sender_id === user?.id ? 'text-purple-200' : 'text-gray-500'
                            }`}>
                              {new Date(msg.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
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
