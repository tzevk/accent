'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { 
  BanknotesIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowPathIcon,
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilSquareIcon,
  TrashIcon,
  EyeIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline';

export default function CashVoucherPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useSessionRBAC();
  
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  
  // Stats
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    total_amount: 0
  });

  // Fetch vouchers
  const fetchVouchers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString()
      });
      
      if (typeFilter !== 'all') params.append('type', typeFilter);
      if (statusFilter !== 'all') params.append('status', statusFilter);

      const res = await fetch(`/api/admin/cash-vouchers?${params}`);
      const data = await res.json();
      
      if (data.success) {
        setVouchers(data.data || []);
        setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
        setStats(data.stats || { total: 0, pending: 0, approved: 0, rejected: 0, total_amount: 0 });
      } else {
        setVouchers([]);
      }
    } catch (error) {
      console.error('Error fetching cash vouchers:', error);
      setVouchers([]);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, pagination.limit]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchVouchers(1);
    }
  }, [authLoading, user, typeFilter, statusFilter, fetchVouchers]);

  // Delete voucher
  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this voucher?')) return;
    
    try {
      const res = await fetch(`/api/admin/cash-vouchers?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      
      if (data.success) {
        fetchVouchers(pagination.page);
      } else {
        alert('Failed to delete: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error deleting voucher:', error);
      alert('Failed to delete voucher');
    }
  };

  // Filter vouchers by search term
  const filteredVouchers = vouchers.filter(v => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      v.voucher_number?.toLowerCase().includes(search) ||
      v.payee_name?.toLowerCase().includes(search) ||
      v.description?.toLowerCase().includes(search)
    );
  });

  // Get status styling
  const getStatusStyle = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-700';
      case 'approved':
        return 'bg-green-100 text-green-700';
      case 'rejected':
        return 'bg-red-100 text-red-700';
      case 'paid':
        return 'bg-blue-100 text-blue-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  // Get type styling
  const getTypeStyle = (type) => {
    switch (type?.toLowerCase()) {
      case 'payment':
        return 'bg-red-100 text-red-700';
      case 'receipt':
        return 'bg-green-100 text-green-700';
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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex">

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
      <div className="flex-1 flex flex-col">
        <Navbar />
        
        <main className="flex-1 p-6 overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <BanknotesIcon className="h-7 w-7 text-purple-600" />
                Cash Vouchers
              </h1>
              <p className="text-sm text-gray-500 mt-1">Manage cash payments and receipts</p>
            </div>
            <button
              onClick={() => router.push('/admin/cash-voucher/new')}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <PlusIcon className="h-5 w-5" />
              New Voucher
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-gray-900">{stats.total || 0}</div>
              <div className="text-sm text-gray-600">Total Vouchers</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-yellow-600">{stats.pending || 0}</div>
              <div className="text-sm text-gray-600">Pending</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-green-600">{stats.approved || 0}</div>
              <div className="text-sm text-gray-600">Approved</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-red-600">{stats.rejected || 0}</div>
              <div className="text-sm text-gray-600">Rejected</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-purple-600">{formatCurrency(stats.total_amount)}</div>
              <div className="text-sm text-gray-600">Total Amount</div>
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
                    placeholder="Search vouchers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>
              
              {/* Type Filter */}
              <div className="flex items-center gap-2">
                <FunnelIcon className="h-5 w-5 text-gray-400" />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="all">All Types</option>
                  <option value="payment">Payment</option>
                  <option value="receipt">Receipt</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
              
              {/* Refresh */}
              <button
                onClick={() => fetchVouchers(pagination.page)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Refresh"
              >
                <ArrowPathIcon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Vouchers Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                <span className="ml-3 text-gray-600">Loading vouchers...</span>
              </div>
            ) : filteredVouchers.length === 0 ? (
              <div className="text-center py-12">
                <BanknotesIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No cash vouchers found</p>
                <p className="text-sm text-gray-500 mt-2">Create a new voucher to get started</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Voucher #</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Paid To</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Prepared By</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                      <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredVouchers.map((voucher) => (
                      <tr key={voucher.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-medium text-purple-600">{voucher.voucher_number}</span>
                        </td>
                        <td className="px-6 py-4 text-gray-600">{formatDate(voucher.voucher_date)}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${getTypeStyle(voucher.voucher_type)}`}>
                            {voucher.voucher_type?.charAt(0).toUpperCase() + voucher.voucher_type?.slice(1) || '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{voucher.paid_to || voucher.payee_name || '-'}</div>
                        </td>
                        <td className="px-6 py-4 text-gray-600 max-w-[200px] truncate">{voucher.prepared_by || voucher.description || '-'}</td>
                        <td className="px-6 py-4 font-semibold text-gray-900">{formatCurrency(voucher.total_amount || voucher.amount)}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusStyle(voucher.status)}`}>
                            {voucher.status?.charAt(0).toUpperCase() + voucher.status?.slice(1) || 'Pending'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => router.push(`/admin/cash-voucher/${voucher.id}`)}
                              className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="View Voucher"
                            >
                              <EyeIcon className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => window.open(`/api/admin/cash-vouchers/download?id=${voucher.id}`, '_blank')}
                              className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="Download PDF"
                            >
                              <ArrowDownTrayIcon className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => router.push(`/admin/cash-voucher/edit/${voucher.id}`)}
                              className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                              title="Edit Voucher"
                            >
                              <PencilSquareIcon className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => handleDelete(voucher.id)}
                              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete Voucher"
                            >
                              <TrashIcon className="h-5 w-5" />
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
                    onClick={() => fetchVouchers(pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <span className="px-3 py-1 text-sm">{pagination.page} / {pagination.totalPages}</span>
                  <button
                    onClick={() => fetchVouchers(pagination.page + 1)}
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
