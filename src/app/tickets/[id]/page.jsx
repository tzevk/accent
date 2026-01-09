'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import {
  TicketIcon,
  ArrowLeftIcon,
  ChatBubbleLeftRightIcon,
  PaperClipIcon,
  ArrowPathIcon,
  ClockIcon,
  UserIcon
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
  { value: 'new', label: 'New', color: 'bg-blue-100 text-blue-800', icon: '🆕' },
  { value: 'under_review', label: 'Under Review', color: 'bg-purple-100 text-purple-800', icon: '👀' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-100 text-yellow-800', icon: '⚡' },
  { value: 'waiting_for_employee', label: 'Waiting for You', color: 'bg-orange-100 text-orange-800', icon: '⏳' },
  { value: 'resolved', label: 'Resolved', color: 'bg-green-100 text-green-800', icon: '✅' },
  { value: 'closed', label: 'Closed', color: 'bg-gray-100 text-gray-800', icon: '🔒' }
];

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ticketId = params.id;
  
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchTicketDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      const data = await res.json();
      if (data.success) {
        setTicket(data.data);
      } else {
        alert('Ticket not found');
        router.push('/tickets');
      }
    } catch (error) {
      console.error('Error fetching ticket:', error);
      alert('Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [ticketId, router]);

  useEffect(() => {
    if (ticketId) {
      fetchTicketDetails();
    }
  }, [ticketId, fetchTicketDetails]);

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) {
      alert('Please enter a comment');
      return;
    }

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
        fetchTicketDetails();
        alert('Comment added successfully!');
      } else {
        alert(data.error || 'Failed to add comment');
      }
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Failed to add comment');
    } finally {
      setSubmittingComment(false);
    }
  };

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <Sidebar />
        <div className="flex pt-16 sm:pl-16">
          <div className="flex-1">
            <div className="px-4 sm:px-6 lg:px-8 py-8">
              <div className="text-center py-12">
                <ArrowPathIcon className="h-8 w-8 text-gray-400 animate-spin mx-auto mb-4" />
                <p className="text-gray-500">Loading ticket...</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <Sidebar />
        <div className="flex pt-16 sm:pl-16">
          <div className="flex-1">
            <div className="px-4 sm:px-6 lg:px-8 py-8">
              <div className="text-center py-12">
                <TicketIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Ticket not found</h3>
                <button
                  onClick={() => router.push('/tickets')}
                  className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Back to Tickets
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const categoryInfo = getCategoryInfo(ticket.category);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      <Sidebar />
      
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
                <li className="text-gray-700">#{ticket.ticket_number}</li>
              </ol>
            </nav>
            
            {/* Header with Back Button */}
            <div className="mb-6">
              <button
                onClick={() => router.push('/tickets')}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
              >
                <ArrowLeftIcon className="h-5 w-5" />
                Back to Tickets
              </button>
          
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="text-sm font-mono text-gray-500">#{ticket.ticket_number}</span>
                {getStatusBadge(ticket.status)}
                {getPriorityBadge(ticket.priority)}
              </div>
              <h1 className="text-3xl font-bold text-gray-900">{ticket.subject}</h1>
              <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <UserIcon className="h-4 w-4" />
                  {ticket.user_name}
                </span>
                <span className="flex items-center gap-1">
                  <ClockIcon className="h-4 w-4" />
                  {new Date(ticket.created_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Ticket Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Waiting for Response Alert */}
            {ticket.status === 'waiting_for_employee' && (
              <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-5 animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">⏳</div>
                  <div className="flex-1">
                    <h4 className="font-bold text-orange-900 text-lg mb-1">
                      Action Required: Waiting for Your Response
                    </h4>
                    <p className="text-orange-800 text-sm">
                      The {categoryInfo.routedTo} team needs additional information from you. 
                      Please review the latest comments below and provide your response.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Description</h2>
              <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
            </div>

            {/* Attachment */}
            {ticket.attachment_url && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Attachment</h2>
                <div className="bg-gray-50 rounded-lg p-4 flex items-center gap-3">
                  <PaperClipIcon className="h-6 w-6 text-gray-400" />
                  <div className="flex-1">
                    <a
                      href={ticket.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-indigo-600 hover:text-indigo-700 break-all font-medium"
                    >
                      {ticket.attachment_url}
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Resolution Notes */}
            {ticket.resolution_notes && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-green-800 mb-3">✅ Resolution</h2>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-900 whitespace-pre-wrap">{ticket.resolution_notes}</p>
                  {ticket.resolved_at && (
                    <p className="text-xs text-green-700 mt-3 pt-3 border-t border-green-200">
                      Resolved on {new Date(ticket.resolved_at).toLocaleString()}
                      {ticket.resolved_by_name && ` by ${ticket.resolved_by_name}`}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Communication Thread */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ChatBubbleLeftRightIcon className="h-6 w-6" />
                Communication Thread ({ticket.comments?.length || 0})
              </h2>

              {/* Comments List */}
              {ticket.comments && ticket.comments.length > 0 ? (
                <div className="space-y-4 mb-6">
                  {ticket.comments.map((comment) => (
                    <div key={comment.id} className="border-l-4 border-indigo-400 bg-gray-50 rounded-r-lg p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold flex-shrink-0">
                          {comment.user_name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-gray-900">{comment.user_name}</span>
                            <span className="text-xs text-gray-500">
                              {new Date(comment.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{comment.comment}</p>
                          {comment.attachments && comment.attachments.length > 0 && (
                            <div className="mt-2 flex items-center gap-1 text-xs text-indigo-600">
                              <PaperClipIcon className="h-3 w-3" />
                              {comment.attachments.length} attachment(s)
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-8 text-center mb-6">
                  <ChatBubbleLeftRightIcon className="h-12 w-12 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">No comments yet. Start the conversation below.</p>
                </div>
              )}

              {/* Add Reply Section */}
              {ticket.status !== 'closed' ? (
                <form onSubmit={handleAddComment} className="border-t-2 border-gray-200 pt-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    {ticket.status === 'waiting_for_employee' 
                      ? '💬 Your Response (Required)' 
                      : '💬 Add a Reply or Update'}
                  </label>
                  <div className="space-y-3">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder={ticket.status === 'waiting_for_employee'
                        ? "Please provide the requested information..."
                        : "Ask a question, provide updates, or add information..."}
                      rows={5}
                      className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none ${
                        ticket.status === 'waiting_for_employee'
                          ? 'border-orange-300 bg-orange-50'
                          : 'border-gray-300'
                      }`}
                      required
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">
                        {ticket.status === 'waiting_for_employee'
                          ? '⚡ Your response will automatically move this ticket back to "In Progress"'
                          : '💡 Your comment will notify the assigned team member'}
                      </p>
                      <button
                        type="submit"
                        disabled={!newComment.trim() || submittingComment}
                        className={`px-6 py-2.5 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
                          ticket.status === 'waiting_for_employee'
                            ? 'bg-orange-600 hover:bg-orange-700 text-white'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        }`}
                      >
                        {submittingComment ? (
                          <>
                            <ArrowPathIcon className="h-4 w-4 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <ChatBubbleLeftRightIcon className="h-4 w-4" />
                            {ticket.status === 'waiting_for_employee' ? 'Send Response' : 'Send Reply'}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="bg-gray-100 rounded-lg p-4 text-center border-t-2 border-gray-200 mt-6">
                  <p className="text-gray-600 text-sm">
                    🔒 This ticket is closed. Comments are disabled.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Sidebar */}
          <div className="space-y-6">
            {/* Category & Routing */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Category</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{categoryInfo.icon}</span>
                  <div>
                    <p className="font-medium text-gray-900">{categoryInfo.label}</p>
                    <p className="text-xs text-gray-500">Routed to {categoryInfo.routedTo}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Assigned To */}
            {ticket.assigned_to_name && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Assigned To</h3>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">
                    {ticket.assigned_to_name.charAt(0).toUpperCase()}
                  </div>
                  <p className="font-medium text-gray-900">{ticket.assigned_to_name}</p>
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Timeline</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full mt-1.5"></div>
                  <div>
                    <p className="text-gray-600">Created</p>
                    <p className="text-gray-900 font-medium">{new Date(ticket.created_at).toLocaleString()}</p>
                  </div>
                </div>
                {ticket.updated_at && ticket.updated_at !== ticket.created_at && (
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 bg-yellow-400 rounded-full mt-1.5"></div>
                    <div>
                      <p className="text-gray-600">Last Updated</p>
                      <p className="text-gray-900 font-medium">{new Date(ticket.updated_at).toLocaleString()}</p>
                    </div>
                  </div>
                )}
                {ticket.resolved_at && (
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full mt-1.5"></div>
                    <div>
                      <p className="text-gray-600">Resolved</p>
                      <p className="text-gray-900 font-medium">{new Date(ticket.resolved_at).toLocaleString()}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Info */}
            <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-6">
              <h3 className="text-sm font-semibold text-indigo-900 mb-3">💡 Need Help?</h3>
              <p className="text-sm text-indigo-800 leading-relaxed">
                Use the communication thread to ask questions or provide additional information. 
                You&apos;ll receive notifications when the team responds.
              </p>
            </div>
          </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
