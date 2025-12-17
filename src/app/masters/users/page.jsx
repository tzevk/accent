'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import { RESOURCES as RBAC_RESOURCES, PERMISSIONS as RBAC_PERMISSIONS } from '@/utils/rbac';
import {
  UsersIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  LockClosedIcon,
  XMarkIcon,
  ChevronRightIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';

// Tab configuration
const TABS = [
  { id: 'users', label: 'Users', icon: UsersIcon, description: 'Manage user accounts and their permissions' },
  { id: 'audit', label: 'Audit Log', icon: ClockIcon, description: 'View permission change history' }
];

export default function UserMasterPage() {
  const { loading: rbacLoading, can } = useSessionRBAC();
  const canUsersRead = !rbacLoading && can(RBAC_RESOURCES.USERS, RBAC_PERMISSIONS.READ);
  
  const [activeTab, setActiveTab] = useState('users');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  if (rbacLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
          <div className="flex items-center justify-center h-[calc(100vh-120px)]">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#64126D]" />
              <span className="text-gray-500">Loading...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!canUsersRead) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
          <div className="flex items-center justify-center h-[calc(100vh-120px)]">
            <div className="text-center">
              <LockClosedIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-700">Access Denied</h2>
              <p className="text-gray-500 mt-2">You don&apos;t have permission to view this page.</p>
            </div>
          </div>
        </div>
      </div>
    );
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
                <li>Home</li>
                <li className="text-gray-300">/</li>
                <li>Masters</li>
                <li className="text-gray-300">/</li>
                <li className="text-gray-700">User Management</li>
              </ol>
            </nav>
            <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px" aria-label="Tabs">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`
                      group relative flex-1 py-4 px-6 text-center border-b-2 font-medium text-sm transition-all
                      ${isActive 
                        ? 'border-[#64126D] text-[#64126D] bg-purple-50/50' 
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                      }
                    `}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <Icon className={`h-5 w-5 ${isActive ? 'text-[#64126D]' : 'text-gray-400 group-hover:text-gray-500'}`} />
                      <span>{tab.label}</span>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Tab Description */}
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
            <p className="text-sm text-gray-600">
              {TABS.find(t => t.id === activeTab)?.description}
            </p>
          </div>

          {/* Tab Content Area */}
          <div className="p-6 min-h-[500px]">
            {activeTab === 'users' && <UsersTabContent />}
            {activeTab === 'audit' && <AuditTabContent />}
          </div>
        </div>
      </div>
    </div>
  );
}

// Users Tab - Shows employees and their linked user accounts
function UsersTabContent() {
  const router = useRouter();
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [empRes, usersRes] = await Promise.all([
        fetch('/api/employees?limit=1000'),
        fetch('/api/users?limit=1000')
      ]);
      
      const empData = await empRes.json();
      const usersData = await usersRes.json();

      setEmployees(empData.employees || empData.data || []);
      setUsers(usersData.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUserForEmployee = (employeeId) => {
    return users.find(u => u.employee_id === employeeId);
  };

  const filteredEmployees = employees.filter(emp => {
    const user = getUserForEmployee(emp.id);
    const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
    const matchesSearch = !searchQuery || 
      fullName.includes(searchQuery.toLowerCase()) ||
      emp.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.employee_id?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = filterStatus === 'all' ||
      (filterStatus === 'with-account' && user) ||
      (filterStatus === 'without-account' && !user);

    return matchesSearch && matchesFilter;
  });

  const totalEmployees = employees.length;
  const withAccount = employees.filter(emp => getUserForEmployee(emp.id)).length;
  const withoutAccount = totalEmployees - withAccount;

  // Count permissions for a user
  const getPermissionCount = (user) => {
    if (!user?.permissions) return 0;
    try {
      const perms = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions;
      return Array.isArray(perms) ? perms.length : 0;
    } catch {
      return 0;
    }
  };

  // Navigate to permissions page
  const goToPermissions = (userId) => {
    router.push(`/masters/users/${userId}/permissions`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#64126D]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-purple-50 to-white rounded-lg border border-purple-100 p-4">
          <div className="text-sm text-gray-600">Total Employees</div>
          <div className="text-2xl font-bold text-gray-900">{totalEmployees}</div>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-white rounded-lg border border-green-100 p-4">
          <div className="text-sm text-gray-600">With User Account</div>
          <div className="text-2xl font-bold text-green-600">{withAccount}</div>
        </div>
        <div className="bg-gradient-to-br from-orange-50 to-white rounded-lg border border-orange-100 p-4">
          <div className="text-sm text-gray-600">Without User Account</div>
          <div className="text-2xl font-bold text-orange-600">{withoutAccount}</div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, email, or employee ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-[#64126D]"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-[#64126D]"
          >
            <option value="all">All Employees</option>
            <option value="with-account">With User Account</option>
            <option value="without-account">Without User Account</option>
          </select>
        </div>
      </div>

      {/* Employees Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Employee
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Department
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User Account
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Permissions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No employees found
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => {
                  const user = getUserForEmployee(emp.id);
                  const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
                  const permCount = getPermissionCount(user);
                  
                  return (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="h-10 w-10 rounded-full bg-[#64126D] flex items-center justify-center text-white font-medium">
                            {fullName.charAt(0).toUpperCase()}
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{fullName}</div>
                            <div className="text-sm text-gray-500">{emp.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{emp.department || '-'}</div>
                        <div className="text-sm text-gray-500">{emp.position || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user ? (
                          <div>
                            <div className="text-sm font-medium text-gray-900">{user.username}</div>
                            <div className="text-xs text-gray-500">
                              Last login: {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 italic">No account</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user ? (
                          <button
                            onClick={() => goToPermissions(user.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 hover:bg-purple-200 transition-colors"
                          >
                            <span>{permCount} permissions</span>
                            <ChevronRightIcon className="h-3 w-3" />
                          </button>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user ? (
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            user.status === 'active' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {user.status || 'Active'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            No Account
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        {user ? (
                          <button 
                            onClick={() => goToPermissions(user.id)}
                            className="text-[#64126D] hover:text-[#4a0d52] font-medium inline-flex items-center gap-1"
                          >
                            Manage Permissions
                            <ChevronRightIcon className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setSelectedEmployee(emp);
                              setShowCreateModal(true);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#64126D] text-white text-xs rounded-lg hover:bg-[#4a0d52] transition-colors"
                          >
                            <PlusIcon className="h-4 w-4" />
                            Create Account
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && selectedEmployee && (
        <CreateUserModal
          employee={selectedEmployee}
          onClose={() => {
            setShowCreateModal(false);
            setSelectedEmployee(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setSelectedEmployee(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

// Create User Modal Component
function CreateUserModal({ employee, onClose, onSuccess }) {
  const router = useRouter();
  const [formData, setFormData] = useState({
    username: employee.email?.split('@')[0] || '',
    password: '',
    confirmPassword: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.username || !formData.password) {
      setError('Username and password are required');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
          email: employee.email,
          employee_id: employee.id,
          permissions: []
        })
      });

      const data = await res.json();
      if (data.success) {
        // Navigate to permissions page for the new user
        if (data.data?.id) {
          router.push(`/masters/users/${data.data.id}/permissions`);
        } else {
          onSuccess();
        }
      } else {
        setError(data.error || 'Failed to create user');
      }
    } catch {
      setError('Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const fullName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Create User Account</h3>
            <p className="text-sm text-gray-500 mt-0.5">for {fullName}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-lg transition-colors">
            <XMarkIcon className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Employee Info */}
          <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-[#64126D] flex items-center justify-center text-white font-medium text-lg">
                {fullName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-gray-900">{fullName}</div>
                <div className="text-sm text-gray-500">{employee.email}</div>
                <div className="text-xs text-gray-400">{employee.department} • {employee.position}</div>
              </div>
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-[#64126D]"
              placeholder="Enter username"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-[#64126D]"
              placeholder="Enter password"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm Password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-[#64126D]"
              placeholder="Confirm password"
            />
          </div>

          <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
            <div className="flex gap-2">
              <InformationCircleIcon className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-700">
                After creating the account, you&apos;ll be redirected to assign permissions.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-[#64126D] text-white rounded-lg hover:bg-[#4a0d52] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Creating...
                </>
              ) : (
                'Create & Set Permissions'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AuditTabContent() {
  return (
    <div className="space-y-4">
      <div className="bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
        <ClockIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Audit Log</h3>
        <p className="text-gray-500">Permission change history will be displayed here.</p>
      </div>
    </div>
  );
}
