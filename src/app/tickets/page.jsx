'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import {
  TicketIcon,
  PlusIcon,
  PaperClipIcon,
  XMarkIcon,
  MagnifyingGlassIcon, 
  ArrowPathIcon
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

export default function TicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTickets = useCallback(async (signal) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterStatus) params.append('status', filterStatus);
      if (filterPriority) params.append('priority', filterPriority);
      
      const res = await fetch(`/api/tickets?${params}`, { signal });
      const data = await res.json();
      if (data.success) {
        setTickets(data.data);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error fetching tickets:', error);
      }
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterPriority]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTickets(controller.signal);
    return () => controller.abort();
  }, [fetchTickets]);

  const searchLower = useMemo(() => searchQuery.toLowerCase(), [searchQuery]);

  const filteredTickets = useMemo(() => tickets.filter(ticket => 
    searchQuery === '' || 
    ticket.subject?.toLowerCase().includes(searchLower) ||
    ticket.ticket_number?.toLowerCase().includes(searchLower) ||
    ticket.description?.toLowerCase().includes(searchLower)
  ), [tickets, searchQuery, searchLower]);

  const getStatusBadge = useCallback((status) => {
    const s = STATUSES.find(s => s.value === status);
    if (!s) return status;
    return <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${s.color}`}>{s.label}</span>;
  }, []);

  const getPriorityBadge = useCallback((priority) => {
    const p = PRIORITIES.find(p => p.value === priority);
    if (!p) return priority;
    return <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${p.color}`}>{p.label}</span>;
  }, []);

  const { activeCount, waitingCount } = useMemo(() => ({
    activeCount: tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length,
    waitingCount: tickets.filter(t => t.status === 'waiting_for_employee').length
  }), [tickets]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="flex pt-2 sm:pl-16">
        <div className="flex-1">
          <div className="pl-0 pr-1 sm:pl-0.5 sm:pr-1.5 lg:pl-1 lg:pr-2 py-2">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Support Tickets</h1>
                <p className="text-sm text-gray-500 mt-1">
                  {activeCount} active{waitingCount > 0 && ` · ${waitingCount} waiting for you`}
                </p>
              </div>
              <button
                onClick={() => router.push('/tickets/new')}
                className="flex items-center gap-2 px-4 py-2 bg-[#64126D] text-white text-sm font-medium rounded-lg hover:bg-[#7a1785] transition-colors"
              >
                <PlusIcon className="h-4 w-4" />
                New Ticket
              </button>
            </div>

            {/* Search & Filters */}
            <div className="flex flex-wrap gap-3 items-center mb-5">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <MagnifyingGlassIcon className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search tickets..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
                  />
                </div>
              </div>
              
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
              >
                <option value="">All Statuses</option>
                {STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
              >
                <option value="">All Priorities</option>
                {PRIORITIES.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              
              {(filterStatus || filterPriority || searchQuery) && (
                <button
                  onClick={() => { setFilterStatus(''); setFilterPriority(''); setSearchQuery(''); }}
                  className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
            </div>

            {/* Tickets List */}
            {loading ? (
              <div className="text-center py-16">
                <ArrowPathIcon className="h-6 w-6 text-gray-400 animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-500">Loading...</p>
              </div>
            ) : filteredTickets.length === 0 ? (
              <div className="text-center py-16">
                <TicketIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-900 mb-1">No tickets found</p>
                <p className="text-xs text-gray-500 mb-4">
                  {searchQuery || filterStatus || filterPriority
                    ? 'Try adjusting your filters'
                    : 'Create your first ticket to get started'}
                </p>
                {!searchQuery && !filterStatus && !filterPriority && (
                  <button
                    onClick={() => router.push('/tickets/new')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#64126D] text-white text-sm rounded-lg hover:bg-[#7a1785]"
                  >
                    <PlusIcon className="h-4 w-4" />
                    New Ticket
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    onClick={() => router.push(`/tickets/${ticket.id}`)}
                    className="bg-white rounded-lg border border-gray-200 px-4 py-3 hover:border-[#64126D]/30 hover:shadow-sm transition-all cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-mono text-gray-400">{ticket.ticket_number}</span>
                          {getStatusBadge(ticket.status)}
                          {getPriorityBadge(ticket.priority)}
                        </div>
                        <h3 className="text-sm font-semibold text-gray-900 truncate">{ticket.subject}</h3>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{ticket.description}</p>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        <span className="text-xs text-gray-400">
                          {new Date(ticket.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                        </span>
                        {ticket.attachment_url && (
                          <PaperClipIcon className="h-3.5 w-3.5 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
