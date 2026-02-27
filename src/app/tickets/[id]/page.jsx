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

const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-300' },
  { value: 'medium', label: 'Medium', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-300' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-100 text-red-700 border-red-300' }
];

const STATUSES = [
  { value: 'new', label: 'New', color: 'bg-blue-100 text-blue-800' },
  { value: 'under_review', label: 'Under Review', color: 'bg-purple-100 text-purple-800' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'waiting_for_employee', label: 'Waiting for You', color: 'bg-orange-100 text-orange-800' },
  { value: 'resolved', label: 'Resolved', color: 'bg-green-100 text-green-800' },
  { value: 'closed', label: 'Closed', color: 'bg-gray-100 text-gray-800' }
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
    const s = STATUSES.find(s => s.value === status);
    if (!s) return status;
    return <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${s.color}`}>{s.label}</span>;
  };

  const getPriorityBadge = (priority) => {
    const p = PRIORITIES.find(p => p.value === priority);
    if (!p) return priority;
    return <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${p.color}`}>{p.label}</span>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <Sidebar />
        <div className="flex pt-16 sm:pl-16">
          <div className="flex-1">
            <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
              <div className="text-center py-16">
                <ArrowPathIcon className="h-6 w-6 text-gray-400 animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-500">Loading ticket...</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <Sidebar />
        <div className="flex pt-16 sm:pl-16">
          <div className="flex-1">
            <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
              <div className="text-center py-16">
                <TicketIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-900 mb-1">Ticket not found</p>
                <button
                  onClick={() => router.push('/tickets')}
                  className="mt-3 px-4 py-2 text-sm bg-[#64126D] text-white rounded-lg hover:bg-[#7a1785]"
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <Sidebar />
      
      <div className="flex pt-16 sm:pl-16">
        <div className="flex-1">
          <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
            {/* Back */}
            <button
              onClick={() => router.push('/tickets')}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back to Tickets
            </button>

            {/* Ticket Header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs font-mono text-gray-400">{ticket.ticket_number}</span>
                {getStatusBadge(ticket.status)}
                {getPriorityBadge(ticket.priority)}
              </div>
              <h1 className="text-xl font-bold text-gray-900">{ticket.subject}</h1>
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <UserIcon className="h-3.5 w-3.5" />
                  {ticket.user_name}
                </span>
                <span className="flex items-center gap-1">
                  <ClockIcon className="h-3.5 w-3.5" />
                  {new Date(ticket.created_at).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Waiting for Response Alert */}
            {ticket.status === 'waiting_for_employee' && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-5">
                <p className="text-sm font-medium text-orange-800">
                  Action Required: The support team needs additional information from you. Please reply below.
                </p>
              </div>
            )}

            {/* Description */}
            <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Description</h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
            </div>

            {/* Attachment */}
            {ticket.attachment_url && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <div className="flex items-center gap-2">
                  <PaperClipIcon className="h-4 w-4 text-gray-400" />
                  <a
                    href={ticket.attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#64126D] hover:underline break-all"
                  >
                    {ticket.attachment_url}
                  </a>
                </div>
              </div>
            )}

            {/* Resolution */}
            {ticket.resolution_notes && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <h2 className="text-sm font-semibold text-green-800 mb-1">Resolution</h2>
                <p className="text-sm text-green-900 whitespace-pre-wrap">{ticket.resolution_notes}</p>
                {ticket.resolved_at && (
                  <p className="text-xs text-green-700 mt-2">
                    Resolved on {new Date(ticket.resolved_at).toLocaleString()}
                    {ticket.resolved_by_name && ` by ${ticket.resolved_by_name}`}
                  </p>
                )}
              </div>
            )}

            {/* Sidebar Info */}
            <div className="flex flex-wrap gap-4 mb-5">
              {ticket.assigned_to_name && (
                <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-[#64126D] text-xs font-bold">
                    {ticket.assigned_to_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Assigned to</p>
                    <p className="text-sm font-medium text-gray-900">{ticket.assigned_to_name}</p>
                  </div>
                </div>
              )}
              {ticket.updated_at && ticket.updated_at !== ticket.created_at && (
                <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
                  <p className="text-xs text-gray-500">Last updated</p>
                  <p className="text-sm font-medium text-gray-900">{new Date(ticket.updated_at).toLocaleString()}</p>
                </div>
              )}
            </div>

            {/* Comments */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-1.5">
                <ChatBubbleLeftRightIcon className="h-4 w-4" />
                Comments ({ticket.comments?.length || 0})
              </h2>

              {ticket.comments && ticket.comments.length > 0 ? (
                <div className="space-y-3 mb-5">
                  {ticket.comments.map((comment) => {
                    const isAdmin = comment.commenter_is_admin || comment.user_id !== ticket.user_id;
                    return (
                      <div key={comment.id} className={`rounded-lg p-3 ${isAdmin ? 'bg-green-50 border-l-2 border-green-400' : 'bg-gray-50 border-l-2 border-gray-300'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-gray-900">{comment.user_name}</span>
                            {isAdmin && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-green-200 text-green-800 rounded font-medium">Support</span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">{new Date(comment.created_at).toLocaleString()}</span>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.comment}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6 mb-4">
                  <p className="text-xs text-gray-400">No comments yet</p>
                </div>
              )}

              {/* Reply */}
              {ticket.status !== 'closed' ? (
                <form onSubmit={handleAddComment} className="border-t border-gray-100 pt-4">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder={ticket.status === 'waiting_for_employee' ? 'Provide the requested information...' : 'Write a reply...'}
                    rows={3}
                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent resize-none ${
                      ticket.status === 'waiting_for_employee' ? 'border-orange-300 bg-orange-50' : 'border-gray-300'
                    }`}
                    required
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      type="submit"
                      disabled={!newComment.trim() || submittingComment}
                      className="px-4 py-2 text-sm bg-[#64126D] text-white rounded-lg hover:bg-[#7a1785] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {submittingComment ? (
                        <>
                          <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        'Send Reply'
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="border-t border-gray-100 pt-4 text-center">
                  <p className="text-xs text-gray-400">This ticket is closed</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
