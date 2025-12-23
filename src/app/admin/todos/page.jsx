'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { 
  ClipboardDocumentListIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';

export default function AdminTodosPage() {
  const { user, loading: authLoading } = useSessionRBAC();
  const router = useRouter();
  const [todos, setTodos] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  
  // Filters
  const [selectedUser, setSelectedUser] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedPriority, setSelectedPriority] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchTodos = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString()
      });
      
      if (selectedUser !== 'all') params.append('user_id', selectedUser);
      if (selectedStatus !== 'all') params.append('status', selectedStatus);
      if (selectedPriority !== 'all') params.append('priority', selectedPriority);

      const res = await fetch(`/api/admin/todos?${params}`);
      const data = await res.json();
      
      if (data.success) {
        setTodos(data.data || []);
        setUsers(data.users || []);
        setStats(data.stats || {});
        setPagination(data.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 });
      }
    } catch (error) {
      console.error('Error fetching todos:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedUser, selectedStatus, selectedPriority, pagination.limit]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchTodos(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, selectedUser, selectedStatus, selectedPriority]);

  // Filter todos by search term (client-side)
  const filteredTodos = todos.filter(todo => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      todo.title?.toLowerCase().includes(search) ||
      todo.description?.toLowerCase().includes(search) ||
      todo.username?.toLowerCase().includes(search) ||
      todo.full_name?.toLowerCase().includes(search)
    );
  });

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-700 border-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'low': return 'bg-green-100 text-green-700 border-green-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'in_progress': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const isOverdue = (dueDate, status) => {
    if (!dueDate || status === 'completed') return false;
    return new Date(dueDate) < new Date();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#7F2487]"></div>
        </div>
      </div>
    );
  }

  if (!user) {
    router.push('/signin');
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
        {/* Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <nav className="text-xs text-gray-500 mb-1" aria-label="Breadcrumb">
              <ol className="inline-flex items-center gap-2">
                <li>Admin</li>
                <li className="text-gray-300">/</li>
                <li className="text-gray-700">All Todos</li>
              </ol>
            </nav>
            <h1 className="text-3xl font-bold text-gray-900">All User To-Do Lists</h1>
          </div>
          <button
            onClick={() => fetchTodos(pagination.page)}
            className="inline-flex items-center gap-2 rounded-lg border border-purple-200 text-[#64126D] px-3.5 py-2 hover:bg-purple-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6 mb-6">
          <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <ClipboardDocumentListIcon className="h-5 w-5 text-[#64126D]" />
              <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Total</span>
            </div>
            <span className="text-2xl font-bold text-gray-900">{stats.total_todos || 0}</span>
          </div>
          <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <ClockIcon className="h-5 w-5 text-amber-500" />
              <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Pending</span>
            </div>
            <span className="text-2xl font-bold text-amber-600">{stats.pending_count || 0}</span>
          </div>
          <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <ArrowPathIcon className="h-5 w-5 text-blue-500" />
              <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">In Progress</span>
            </div>
            <span className="text-2xl font-bold text-blue-600">{stats.in_progress_count || 0}</span>
          </div>
          <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <CheckCircleIcon className="h-5 w-5 text-emerald-500" />
              <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Completed</span>
            </div>
            <span className="text-2xl font-bold text-emerald-600">{stats.completed_count || 0}</span>
          </div>
          <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
              <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">High Priority</span>
            </div>
            <span className="text-2xl font-bold text-red-600">{stats.high_priority_count || 0}</span>
          </div>
          <div className="bg-white border border-purple-200 rounded-xl px-6 py-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-orange-500" />
              <span className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Overdue</span>
            </div>
            <span className="text-2xl font-bold text-orange-600">{stats.overdue_count || 0}</span>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-purple-200 p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <FunnelIcon className="h-4 w-4 text-[#64126D]" />
            <span className="text-sm font-semibold text-gray-900">Filters</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Search */}
            <div className="lg:col-span-2">
              <div className="relative">
                <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search todos, users..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-300 focus:border-transparent"
                />
              </div>
            </div>
            
            {/* User Filter */}
            <div>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-300 focus:border-transparent"
              >
                <option value="all">All Users</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.username}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-300 focus:border-transparent"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            {/* Priority Filter */}
            <div>
              <select
                value={selectedPriority}
                onChange={(e) => setSelectedPriority(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-300 focus:border-transparent"
              >
                <option value="all">All Priority</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
        </div>

        {/* Todos Table */}
        <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-purple-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              Todos ({filteredTodos.length})
            </h3>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#64126D]"></div>
            </div>
          ) : filteredTodos.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardDocumentListIcon className="h-12 w-12 mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-500">No todos found</p>
              <p className="text-xs text-gray-400 mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-purple-50 border-b border-purple-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 w-12">Sr.</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">User</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Title</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Priority</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Due Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredTodos.map((todo, index) => (
                    <tr key={todo.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-500 font-medium">
                        {(pagination.page - 1) * pagination.limit + index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[#7F2487] to-[#5a1a61] flex items-center justify-center text-white text-xs font-medium">
                            {(todo.full_name || todo.username || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 text-xs">
                              {todo.full_name || todo.username || 'Unknown'}
                            </p>
                            {todo.department && (
                              <p className="text-[10px] text-gray-500">{todo.department}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 text-xs line-clamp-1">{todo.title}</p>
                        {todo.description && (
                          <p className="text-[10px] text-gray-500 line-clamp-1 mt-0.5">{todo.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full border ${getPriorityColor(todo.priority)}`}>
                          {todo.priority?.toUpperCase() || 'MEDIUM'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full border ${getStatusColor(todo.status)}`}>
                          {todo.status?.replace('_', ' ').toUpperCase() || 'PENDING'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {isOverdue(todo.due_date, todo.status) && (
                            <ExclamationTriangleIcon className="h-3.5 w-3.5 text-red-500" />
                          )}
                          <span className={`text-xs ${isOverdue(todo.due_date, todo.status) ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                            {formatDate(todo.due_date)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {formatDate(todo.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-purple-200 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                {pagination.total} results
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchTodos(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="p-1.5 text-[#64126D] hover:bg-purple-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <span className="text-xs text-gray-600">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => fetchTodos(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="p-1.5 text-[#64126D] hover:bg-purple-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
