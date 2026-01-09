'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import {
  TicketIcon,
  PlusIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
  PaperClipIcon,
  XMarkIcon,
  MagnifyingGlassIcon, 
  ArrowPathIcon
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

const STATUSES = [
  { value: 'new', label: 'New', color: 'bg-blue-100 text-blue-800', icon: '🆕' },
  { value: 'under_review', label: 'Under Review', color: 'bg-purple-100 text-purple-800', icon: '👀' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-100 text-yellow-800', icon: '⚡' },
  { value: 'waiting_for_employee', label: 'Waiting for You', color: 'bg-orange-100 text-orange-800', icon: '⏳' },
  { value: 'resolved', label: 'Resolved', color: 'bg-green-100 text-green-800', icon: '✅' },
  { value: 'closed', label: 'Closed', color: 'bg-gray-100 text-gray-800', icon: '🔒' }
];

export default function TicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterRoutedTo, setFilterRoutedTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTickets = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.append('status', filterStatus);
      if (filterPriority) params.append('priority', filterPriority);
      if (filterRoutedTo) params.append('routed_to', filterRoutedTo);
      
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
  }, [filterStatus, filterPriority, filterRoutedTo]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleViewTicket = (ticket) => {
    router.push(`/tickets/${ticket.id}`);
  };

  const filteredTickets = tickets.filter(ticket => 
    searchQuery === '' || 
    ticket.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ticket.ticket_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ticket.description.toLowerCase().includes(searchQuery.toLowerCase())
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
    const stats = {
      new: tickets.filter(t => t.status === 'new').length,
      in_progress: tickets.filter(t => t.status === 'in_progress' || t.status === 'under_review').length,
      waiting: tickets.filter(t => t.status === 'waiting_for_employee').length,
      resolved: tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length
    };
    return stats;
  };

  const stats = getTicketStats();

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
                <li className="text-gray-700">Support Tickets</li>
              </ol>
            </nav>
            
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                  <TicketIcon className="h-8 w-8 text-indigo-600" />
                  Support Tickets
                </h1>
                <p className="text-gray-600 mt-2">Submit and track your support requests</p>
              </div>
              <button
                onClick={() => router.push('/tickets/new')}
                className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
              >
                <PlusIcon className="h-5 w-5" />
                Create Ticket
              </button>
            </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">New</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{stats.new}</p>
              </div>
              <div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center text-2xl">
                🆕
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">In Progress</p>
                <p className="text-2xl font-bold text-yellow-600 mt-1">{stats.in_progress}</p>
              </div>
              <div className="h-12 w-12 bg-yellow-100 rounded-lg flex items-center justify-center text-2xl">
                ⚡
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Waiting for You</p>
                <p className="text-2xl font-bold text-orange-600 mt-1">{stats.waiting}</p>
              </div>
              <div className="h-12 w-12 bg-orange-100 rounded-lg flex items-center justify-center text-2xl">
                ⏳
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Resolved</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{stats.resolved}</p>
              </div>
              <div className="h-12 w-12 bg-green-100 rounded-lg flex items-center justify-center text-2xl">
                ✅
              </div>
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
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All Statuses</option>
              {STATUSES.map(status => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
            
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All Priorities</option>
              {PRIORITIES.map(priority => (
                <option key={priority.value} value={priority.value}>{priority.label}</option>
              ))}
            </select>
            
            <select
              value={filterRoutedTo}
              onChange={(e) => setFilterRoutedTo(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All Departments</option>
              <option value="hr">HR</option>
              <option value="admin">Admin</option>
            </select>
            
            {(filterStatus || filterPriority || filterRoutedTo || searchQuery) && (
              <button
                onClick={() => {
                  setFilterStatus('');
                  setFilterPriority('');
                  setFilterRoutedTo('');
                  setSearchQuery('');
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
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
            <p className="text-gray-500 mb-6">
              {searchQuery || filterStatus || filterPriority || filterRoutedTo
                ? "Try adjusting your filters"
                : "Create your first ticket to get started"}
            </p>
            {!searchQuery && !filterStatus && !filterPriority && !filterRoutedTo && (
              <button
                onClick={() => router.push('/tickets/new')}
                className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <PlusIcon className="h-5 w-5" />
                Create Ticket
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTickets.map((ticket) => {
              const categoryInfo = getCategoryInfo(ticket.category);
              return (
                <div
                  key={ticket.id}
                  onClick={() => handleViewTicket(ticket)}
                  className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-all cursor-pointer hover:border-indigo-300"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
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
                      <p className="text-gray-600 text-sm line-clamp-2">{ticket.description}</p>
                      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <ClockIcon className="h-4 w-4" />
                          {new Date(ticket.created_at).toLocaleString()}
                        </span>
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
        </div>
      </div>
    </div>
  );
}
