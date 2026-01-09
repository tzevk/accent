'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { 
  DocumentTextIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  PencilSquareIcon
} from '@heroicons/react/24/outline';

export default function QuotationPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useSessionRBAC();
  
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  
  // Stats
  const [stats, setStats] = useState({
    total: 0,
    draft: 0,
    sent: 0,
    approved: 0,
    rejected: 0
  });

  // Fetch quotations
  const fetchQuotations = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString()
      });
      
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (sourceFilter !== 'all') params.append('source', sourceFilter);

      const res = await fetch(`/api/admin/quotations?${params}`);
      const data = await res.json();
      
      if (data.success) {
        setQuotations(data.data || []);
        setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
        setStats(data.stats || { total: 0, draft: 0, sent: 0, approved: 0, rejected: 0 });
      } else {
        setQuotations([]);
      }
    } catch (error) {
      console.error('Error fetching quotations:', error);
      setQuotations([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, pagination.limit]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchQuotations(1);
    }
  }, [authLoading, user, statusFilter, sourceFilter, fetchQuotations]);

  // Filter quotations by search term
  const filteredQuotations = quotations.filter(q => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      q.quotation_number?.toLowerCase().includes(search) ||
      q.client_name?.toLowerCase().includes(search) ||
      q.subject?.toLowerCase().includes(search)
    );
  });

  // Get status styling
  const getStatusStyle = (status) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 text-gray-700';
      case 'sent':
        return 'bg-blue-100 text-blue-700';
      case 'approved':
        return 'bg-green-100 text-green-700';
      case 'rejected':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount || 0);
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  // Handle download - opens quotation in new tab for printing/saving as PDF
  const handleDownload = (quotation) => {
    const source = quotation.source || 'quotations';
    const url = `/api/admin/quotations/download?id=${quotation.id}&source=${source}`;
    window.open(url, '_blank');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <Navbar />
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Navbar />
        
        <main className="flex-1 p-6 overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <DocumentTextIcon className="h-7 w-7 text-purple-600" />
              Quotations
            </h1>
            <p className="text-sm text-gray-500 mt-1">View and download quotations</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-900">{stats.total || 0}</div>
            <div className="text-sm text-gray-600">Total</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-600">{stats.draft || 0}</div>
            <div className="text-sm text-gray-600">Draft</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.sent || 0}</div>
            <div className="text-sm text-gray-600">Sent</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-green-600">{stats.approved || 0}</div>
            <div className="text-sm text-gray-600">Approved</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-red-600">{stats.rejected || 0}</div>
            <div className="text-sm text-gray-600">Rejected</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search quotations..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>
            
            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <FunnelIcon className="h-5 w-5 text-gray-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="all">All Status</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            {/* Source Filter */}
            <div className="flex items-center gap-2">
              <FolderIcon className="h-5 w-5 text-gray-400" />
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="all">All Sources</option>
                <option value="projects">From Projects</option>
                <option value="quotations">Standalone</option>
              </select>
            </div>
            
            {/* Refresh */}
            <button
              onClick={() => fetchQuotations(pagination.page)}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <ArrowPathIcon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Quotations Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              <span className="ml-3 text-gray-600">Loading quotations...</span>
            </div>
          ) : filteredQuotations.length === 0 ? (
            <div className="text-center py-12">
              <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No quotations found</p>
              <p className="text-sm text-gray-500 mt-2">Save a quotation in a project to see it here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Quotation #</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Client / Project</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Subject</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Source</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredQuotations.map((quotation) => (
                    <tr key={`${quotation.source}-${quotation.id}`} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-medium text-purple-600">{quotation.quotation_number}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{quotation.client_name}</div>
                        {quotation.source === 'project' && quotation.project_name && (
                          <div className="text-sm text-gray-500">Project: {quotation.project_name}</div>
                        )}
                        {quotation.client_email && (
                          <div className="text-sm text-gray-500">{quotation.client_email}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-600 max-w-[200px] truncate">{quotation.subject}</td>
                      <td className="px-6 py-4 font-semibold text-gray-900">{formatCurrency(quotation.total)}</td>
                      <td className="px-6 py-4 text-gray-600">{formatDate(quotation.created_at)}</td>
                      <td className="px-6 py-4">
                        {quotation.source === 'project' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                            <FolderIcon className="h-3 w-3" />
                            Project
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                            Standalone
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusStyle(quotation.status)}`}>
                          {quotation.status?.charAt(0).toUpperCase() + quotation.status?.slice(1) || 'Draft'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => router.push(`/admin/quotation/${quotation.id}/edit?source=${quotation.source || 'project'}`)}
                            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit Quotation"
                          >
                            <PencilSquareIcon className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleDownload(quotation)}
                            className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="View & Print Quotation"
                          >
                            <ArrowDownTrayIcon className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchQuotations(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <span className="px-3 py-1 text-sm">{pagination.page} / {pagination.totalPages}</span>
                <button
                  onClick={() => fetchQuotations(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                  className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      </div>
    </div>
  );
}
