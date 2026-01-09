'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import {
  TicketIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  UserIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
  PaperClipIcon,
  XMarkIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  UserGroupIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline';

const CATEGORIES = [
  { value: 'payroll', label: 'Payroll', routedTo: 'HR', icon: '💰' },
  { value: 'leave', label: 'Leave', routedTo: 'HR', icon: '🏖️' },
  { value: 'policy', label: 'Policy', routedTo: 'HR', icon: '📋' },
  { value: 'confidential', label: 'Confidential Matters', routedTo: 'HR (Restricted)', icon: '🔒' },
  { value: 'access_cards', label: 'Access Cards', routedTo: 'Admin', icon: '🪪' },
  { value: 'seating', label: 'Seating', routedTo: 'Admin', icon: '💺' },
  { value: 'maintenance', label: 'Maintenance', routedTo: 'Admin', icon: '🔧' },
  { value: 'general_request', label: 'General Request', routedTo: 'Admin', icon: '📝' }
];

const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-300' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-300' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-100 text-red-700 border-red-300' }
];

const STATUSES = [
  { value: 'new', label: 'New', color: 'bg-blue-100 text-blue-800', icon: '🆕', nextStatus: 'under_review' },
  { value: 'under_review', label: 'Under Review', color: 'bg-purple-100 text-purple-800', icon: '👀', nextStatus: 'in_progress' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-100 text-yellow-800', icon: '⚡', nextStatus: 'waiting_for_employee' },
  { value: 'waiting_for_employee', label: 'Waiting for Employee', color: 'bg-orange-100 text-orange-800', icon: '⏳', nextStatus: 'in_progress' },
  { value: 'resolved', label: 'Resolved', color: 'bg-green-100 text-green-800', icon: '✅', nextStatus: 'closed' },
  { value: 'closed', label: 'Closed', color: 'bg-gray-100 text-gray-800', icon: '🔒', nextStatus: null }
];

export default function TicketManagementPage() {
  const [tickets, setTickets] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterRoutedTo, setFilterRoutedTo] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [updatingTicket, setUpdatingTicket] = useState(false);

  useEffect(() => {
    fetchTickets();
    fetchUsers();
  }, [filterStatus, filterPriority, filterRoutedTo, filterCategory]);

  const fetchTickets = async () => {
    try {
      const params = new URLSearchParams({ all: 'true' });
      if (filterStatus) params.append('status', filterStatus);
      if (filterPriority) params.append('priority', filterPriority);
      if (filterRoutedTo) params.append('routed_to', filterRoutedTo);
      if (filterCategory) params.append('category', filterCategory);
      
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

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (data.success) {
        setUsers(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
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

  const handleUpdateStatus = async (ticketId, newStatus, resolutionNotes = null) => {
    setUpdatingTicket(true);
    try {
      const payload = { id: ticketId, status: newStatus };
      if (resolutionNotes) payload.resolution_notes = resolutionNotes;

      const res = await fetch('/api/tickets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (data.success) {
        fetchTickets();
        if (selectedTicket) {
          handleViewTicket({ id: ticketId });
        }
        return true;
      } else {
        alert(data.error || 'Failed to update ticket');
        return false;
      }
    } catch (error) {
      console.error('Error updating ticket:', error);
      alert('Failed to update ticket');
      return false;
    } finally {
      setUpdatingTicket(false);
    }
  };

  const handleAssignTicket = async (ticketId, userId) => {
    setUpdatingTicket(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ticketId, assigned_to: userId })
      });
      
      const data = await res.json();
      if (data.success) {
        fetchTickets();
        if (selectedTicket) {
          handleViewTicket({ id: ticketId });
        }
        alert('Ticket assigned successfully');
      } else {
        alert(data.error || 'Failed to assign ticket');
      }
    } catch (error) {
      console.error('Error assigning ticket:', error);
      alert('Failed to assign ticket');
    } finally {
      setUpdatingTicket(false);
    }
  };

  const handleAddComment = async (ticketId) => {
    if (!newComment.trim()) return;

    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: newComment })
      });

      const data = await res.json();
      if (data.success) {
        setNewComment('');
        handleViewTicket({ id: ticketId });
      }
    } catch (error) {
      console.error('Error adding comment:', error);
    } finally {
      setSubmittingComment(false);
    }
  };

  const filteredTickets = tickets.filter(ticket => 
    searchQuery === '' || 
    ticket.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ticket.ticket_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ticket.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ticket.user_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusBadge = (status) => {
    const statusConfig = STATUSES.find(s => s.value === status);
    return statusConfig ? (
      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${statusConfig.color} inline-flex items-center gap-1`}>
        <span>{statusConfig.icon}</span>
        {statusConfig.label}
      </span>
    ) : status;
  };

  const getPriorityBadge = (priority) => {
    const priorityConfig = PRIORITIES.find(p => p.value === priority);
    return priorityConfig ? (
      <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${priorityConfig.color}`}>
        {priorityConfig.label}
      </span>
    ) : priority;
  };

  const getCategoryInfo = (category) => {
    return CATEGORIES.find(c => c.value === category) || { label: category, icon: '📝', routedTo: 'Admin' };
  };

  const getTicketStats = () => {
    return {
      new: tickets.filter(t => t.status === 'new').length,
      under_review: tickets.filter(t => t.status === 'under_review').length,
      in_progress: tickets.filter(t => t.status === 'in_progress').length,
      waiting: tickets.filter(t => t.status === 'waiting_for_employee').length,
      resolved: tickets.filter(t => t.status === 'resolved').length,
      closed: tickets.filter(t => t.status === 'closed').length,
    };
  };

  const stats = getTicketStats();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <ShieldCheckIcon className="h-8 w-8 text-indigo-600" />
            Ticket Management
          </h1>
          <p className="text-gray-600 mt-2">Manage and resolve employee support tickets</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{stats.new}</p>
              <p className="text-xs text-gray-600 mt-1">New</p>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-600">{stats.under_review}</p>
              <p className="text-xs text-gray-600 mt-1">Under Review</p>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-yellow-600">{stats.in_progress}</p>
              <p className="text-xs text-gray-600 mt-1">In Progress</p>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-orange-600">{stats.waiting}</p>
              <p className="text-xs text-gray-600 mt-1">Waiting</p>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{stats.resolved}</p>
              <p className="text-xs text-gray-600 mt-1">Resolved</p>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-600">{stats.closed}</p>
              <p className="text-xs text-gray-600 mt-1">Closed</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[250px]">
              <div className="relative">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search tickets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>
            
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            >
              <option value="">All Statuses</option>
              {STATUSES.map(status => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
            
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            >
              <option value="">All Priorities</option>
              {PRIORITIES.map(priority => (
                <option key={priority.value} value={priority.value}>{priority.label}</option>
              ))}
            </select>
            
            <select
              value={filterRoutedTo}
              onChange={(e) => setFilterRoutedTo(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            >
              <option value="">All Departments</option>
              <option value="hr">HR</option>
              <option value="admin">Admin</option>
            </select>
            
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
            
            {(filterStatus || filterPriority || filterRoutedTo || filterCategory || searchQuery) && (
              <button
                onClick={() => {
                  setFilterStatus('');
                  setFilterPriority('');
                  setFilterRoutedTo('');
                  setFilterCategory('');
                  setSearchQuery('');
                }}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
              >
                <XMarkIcon className="h-4 w-4" />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Tickets List */}
        {loading ? (
          <div className="text-center py-12">
            <ArrowPathIcon className="h-8 w-8 text-gray-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-500">Loading tickets...</p>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <TicketIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No tickets found</h3>
            <p className="text-gray-500">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTickets.map((ticket) => {
              const categoryInfo = getCategoryInfo(ticket.category);
              const statusInfo = STATUSES.find(s => s.value === ticket.status);
              return (
                <div
                  key={ticket.id}
                  onClick={() => handleViewTicket(ticket)}
                  className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-all cursor-pointer hover:border-indigo-300"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <span className="text-sm font-mono text-gray-500">#{ticket.ticket_number}</span>
                        {getStatusBadge(ticket.status)}
                        {getPriorityBadge(ticket.priority)}
                        <span className="text-sm text-gray-500 flex items-center gap-1">
                          <span className="text-lg">{categoryInfo.icon}</span>
                          {categoryInfo.label}
                        </span>
                        <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full font-medium">
                          → {categoryInfo.routedTo}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">{ticket.subject}</h3>
                      <p className="text-gray-600 text-sm line-clamp-2 mb-2">{ticket.description}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <UserIcon className="h-4 w-4" />
                          {ticket.user_name}
                        </span>
                        <span className="flex items-center gap-1">
                          <ClockIcon className="h-4 w-4" />
                          {new Date(ticket.created_at).toLocaleString()}
                        </span>
                        {ticket.assigned_to_name && (
                          <span className="flex items-center gap-1 text-indigo-600">
                            <UserGroupIcon className="h-4 w-4" />
                            Assigned to: {ticket.assigned_to_name}
                          </span>
                        )}
                        {ticket.attachment_url && (
                          <span className="flex items-center gap-1 text-indigo-600">
                            <PaperClipIcon className="h-4 w-4" />
                            Attachment
                          </span>
                        )}
                      </div>
                    </div>
                    <ChatBubbleLeftRightIcon className="h-6 w-6 text-gray-400" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* View/Manage Ticket Modal */}
      {showViewModal && selectedTicket && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-8">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Ticket #{selectedTicket.ticket_number}</h2>
                <p className="text-sm text-gray-500">By {selectedTicket.user_name} on {new Date(selectedTicket.created_at).toLocaleString()}</p>
              </div>
              <button
                onClick={() => setShowViewModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <XMarkIcon className="h-6 w-6 text-gray-500" />
              </button>
            </div>
            
            <div className="p-6 space-y-6 max-h-[calc(90vh-200px)] overflow-y-auto">
              {/* Quick Actions */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                <h4 className="font-semibold text-gray-900 mb-3">Quick Actions</h4>
                <div className="flex flex-wrap gap-2">
                  {STATUSES.map((status) => (
                    <button
                      key={status.value}
                      onClick={() => {
                        if (status.value === 'resolved' || status.value === 'closed') {
                          const notes = prompt('Enter resolution notes:');
                          if (notes) handleUpdateStatus(selectedTicket.id, status.value, notes);
                        } else {
                          handleUpdateStatus(selectedTicket.id, status.value);
                        }
                      }}
                      disabled={updatingTicket || selectedTicket.status === status.value}
                      className={`px-3 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        selectedTicket.status === status.value
                          ? `${status.color} font-semibold`
                          : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {status.icon} {status.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assign Ticket */}
              <div className="bg-gray-50 rounded-lg p-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Assign To
                </label>
                <select
                  value={selectedTicket.assigned_to || ''}
                  onChange={(e) => handleAssignTicket(selectedTicket.id, e.target.value ? parseInt(e.target.value) : null)}
                  disabled={updatingTicket}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="">Unassigned</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.full_name || user.username} - {user.email}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status & Priority */}
              <div className="flex items-center gap-3 flex-wrap">
                {getStatusBadge(selectedTicket.status)}
                {getPriorityBadge(selectedTicket.priority)}
                <span className="text-sm text-gray-500 flex items-center gap-1">
                  <span className="text-lg">{getCategoryInfo(selectedTicket.category).icon}</span>
                  {getCategoryInfo(selectedTicket.category).label}
                </span>
                <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full font-medium">
                  → {getCategoryInfo(selectedTicket.category).routedTo}
                </span>
              </div>

              {/* Subject & Description */}
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">{selectedTicket.subject}</h3>
                <p className="text-gray-700 whitespace-pre-wrap">{selectedTicket.description}</p>
              </div>

              {/* Attachment */}
              {selectedTicket.attachment_url && (
                <div className="bg-gray-50 rounded-lg p-4 flex items-center gap-3">
                  <PaperClipIcon className="h-6 w-6 text-gray-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">Attachment</p>
                    <a
                      href={selectedTicket.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-indigo-600 hover:text-indigo-700 break-all"
                    >
                      {selectedTicket.attachment_url}
                    </a>
                  </div>
                </div>
              )}

              {/* Resolution Notes */}
              {selectedTicket.resolution_notes && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-green-800 mb-2">Resolution Notes</p>
                  <p className="text-sm text-green-900 whitespace-pre-wrap">{selectedTicket.resolution_notes}</p>
                  {selectedTicket.resolved_at && (
                    <p className="text-xs text-green-700 mt-2">
                      Resolved on {new Date(selectedTicket.resolved_at).toLocaleString()}
                      {selectedTicket.resolved_by_name && ` by ${selectedTicket.resolved_by_name}`}
                    </p>
                  )}
                </div>
              )}

              {/* Comments */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <ChatBubbleLeftRightIcon className="h-5 w-5" />
                  Comments ({selectedTicket.comments?.length || 0})
                </h4>
                <div className="space-y-3">
                  {selectedTicket.comments?.map((comment) => (
                    <div key={comment.id} className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-medium text-gray-900">{comment.user_name}</span>
                        <span className="text-xs text-gray-500">
                          {new Date(comment.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-gray-700 text-sm whitespace-pre-wrap">{comment.comment}</p>
                    </div>
                  ))}

                  {/* Add Comment */}
                  {selectedTicket.status !== 'closed' && (
                    <div className="mt-4">
                      <textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Add a comment or update to the employee..."
                        rows={3}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                      />
                      <div className="flex justify-end mt-2">
                        <button
                          onClick={() => handleAddComment(selectedTicket.id)}
                          disabled={!newComment.trim() || submittingComment}
                          className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {submittingComment ? (
                            <>
                              <ArrowPathIcon className="h-4 w-4 animate-spin" />
                              Sending...
                            </>
                          ) : (
                            <>
                              <ChatBubbleLeftRightIcon className="h-4 w-4" />
                              Add Comment
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
