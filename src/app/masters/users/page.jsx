'use client';

import Navbar from '@/components/Navbar';
import LoadingSpinner from '@/components/LoadingSpinner';
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
  InformationCircleIcon,
  KeyIcon,
  PencilIcon
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
        <LoadingSpinner message="Loading Users" subMessage="Fetching user data..." fullScreen={false} />
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

// Users Tab - Shows only users (employees with user accounts)
function UsersTabContent() {
  const router = useRouter();
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [selectedUserForReset, setSelectedUserForReset] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState(null);

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

  const getEmployeeForUser = (employeeId) => {
    return employees.find(e => e.id === employeeId);
  };

  // Get employees without user accounts (for create user modal)
  const employeesWithoutAccount = employees.filter(emp => 
    !users.some(u => u.employee_id === emp.id)
  );

  // Filter users based on search
  const filteredUsers = users.filter(user => {
    const employee = getEmployeeForUser(user.employee_id);
    const fullName = employee ? `${employee.first_name || ''} ${employee.last_name || ''}`.toLowerCase() : '';
    const matchesSearch = !searchQuery || 
      user.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      fullName.includes(searchQuery.toLowerCase());
    
    const matchesFilter = filterStatus === 'all' ||
      (filterStatus === 'active' && user.status === 'active') ||
      (filterStatus === 'inactive' && user.status !== 'active');

    return matchesSearch && matchesFilter;
  });

  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.status === 'active').length;
  const inactiveUsers = totalUsers - activeUsers;

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
          <div className="text-sm text-gray-600">Total Users</div>
          <div className="text-2xl font-bold text-gray-900">{totalUsers}</div>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-white rounded-lg border border-green-100 p-4">
          <div className="text-sm text-gray-600">Active Users</div>
          <div className="text-2xl font-bold text-green-600">{activeUsers}</div>
        </div>
        <div className="bg-gradient-to-br from-orange-50 to-white rounded-lg border border-orange-100 p-4">
          <div className="text-sm text-gray-600">Inactive Users</div>
          <div className="text-2xl font-bold text-orange-600">{inactiveUsers}</div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by username, email, or name..."
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
            <option value="all">All Users</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          disabled={employeesWithoutAccount.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#64126D] text-white rounded-lg hover:bg-[#4a0d52] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PlusIcon className="h-5 w-5" />
          Create User
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Employee Details
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Permissions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Login
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
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    {users.length === 0 ? 'No users found. Create a user from an employee.' : 'No users match your search.'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const employee = getEmployeeForUser(user.employee_id);
                  const fullName = employee 
                    ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim() 
                    : user.full_name || user.username;
                  const permCount = getPermissionCount(user);
                  
                  return (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="h-10 w-10 rounded-full bg-[#64126D] flex items-center justify-center text-white font-medium">
                            {fullName.charAt(0).toUpperCase()}
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{user.username}</div>
                            <div className="text-sm text-gray-500">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {employee ? (
                          <div>
                            <div className="text-sm font-medium text-gray-900">{fullName}</div>
                            <div className="text-sm text-gray-500">
                              {employee.department || '-'} • {employee.position || '-'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 italic">No linked employee</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => goToPermissions(user.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 hover:bg-purple-200 transition-colors"
                        >
                          <span>{permCount} permissions</span>
                          <ChevronRightIcon className="h-3 w-3" />
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">
                          {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          user.status === 'active' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {user.status || 'Active'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-3">
                          <button 
                            onClick={() => {
                              setSelectedUserForEdit(user);
                              setShowEditModal(true);
                            }}
                            className="text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1"
                            title="Edit User"
                          >
                            <PencilIcon className="h-4 w-4" />
                            Edit
                          </button>
                          <button 
                            onClick={() => {
                              setSelectedUserForReset(user);
                              setShowResetPasswordModal(true);
                            }}
                            className="text-amber-600 hover:text-amber-700 font-medium inline-flex items-center gap-1"
                            title="Reset Password"
                          >
                            <KeyIcon className="h-4 w-4" />
                            Reset
                          </button>
                          <button 
                            onClick={() => goToPermissions(user.id)}
                            className="text-[#64126D] hover:text-[#4a0d52] font-medium inline-flex items-center gap-1"
                          >
                            Permissions
                            <ChevronRightIcon className="h-4 w-4" />
                          </button>
                        </div>
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
      {showCreateModal && (
        <SelectEmployeeModal
          employees={employeesWithoutAccount}
          onSelect={(emp) => {
            setSelectedEmployee(emp);
          }}
          onClose={() => {
            setShowCreateModal(false);
            setSelectedEmployee(null);
          }}
          selectedEmployee={selectedEmployee}
          onSuccess={() => {
            setShowCreateModal(false);
            setSelectedEmployee(null);
            fetchData();
          }}
        />
      )}

      {/* Reset Password Modal */}
      {showResetPasswordModal && selectedUserForReset && (
        <ResetPasswordModal
          user={selectedUserForReset}
          onClose={() => {
            setShowResetPasswordModal(false);
            setSelectedUserForReset(null);
          }}
          onSuccess={() => {
            setShowResetPasswordModal(false);
            setSelectedUserForReset(null);
            fetchData();
          }}
        />
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUserForEdit && (
        <EditUserModal
          user={selectedUserForEdit}
          employees={employees}
          onClose={() => {
            setShowEditModal(false);
            setSelectedUserForEdit(null);
          }}
          onSuccess={() => {
            setShowEditModal(false);
            setSelectedUserForEdit(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

// Select Employee Modal - First step to create a user
function SelectEmployeeModal({ employees, onSelect, onClose, selectedEmployee, onSuccess }) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Update form when employee is selected
  useEffect(() => {
    if (selectedEmployee) {
      setFormData(prev => ({
        ...prev,
        username: selectedEmployee.email?.split('@')[0] || ''
      }));
    }
  }, [selectedEmployee]);

  const filteredEmployees = employees.filter(emp => {
    const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
    return !searchQuery || 
      fullName.includes(searchQuery.toLowerCase()) ||
      emp.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.employee_id?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!selectedEmployee) {
      setError('Please select an employee first');
      return;
    }

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
          email: selectedEmployee.email,
          employee_id: selectedEmployee.id,
          full_name: `${selectedEmployee.first_name || ''} ${selectedEmployee.last_name || ''}`.trim(),
          permissions: []
        })
      });

      const data = await res.json();
      if (data.success) {
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Create User</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {selectedEmployee ? 'Set up login credentials' : 'Select an employee to create a user account'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-lg transition-colors">
            <XMarkIcon className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {!selectedEmployee ? (
          // Step 1: Select Employee
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200">
              <div className="relative">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-[#64126D]"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {filteredEmployees.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {employees.length === 0 
                    ? 'All employees already have user accounts'
                    : 'No employees match your search'}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredEmployees.map((emp) => {
                    const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
                    return (
                      <button
                        key={emp.id}
                        onClick={() => onSelect(emp)}
                        className="w-full flex items-center gap-4 p-4 rounded-lg border border-gray-200 hover:border-[#64126D] hover:bg-purple-50 transition-all text-left"
                      >
                        <div className="h-12 w-12 rounded-full bg-[#64126D] flex items-center justify-center text-white font-medium text-lg">
                          {fullName.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{fullName}</div>
                          <div className="text-sm text-gray-500">{emp.email}</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {emp.department || '-'} • {emp.position || '-'}
                          </div>
                        </div>
                        <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          // Step 2: Set Credentials
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Selected Employee Info */}
            <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-[#64126D] flex items-center justify-center text-white font-medium text-lg">
                  {`${selectedEmployee.first_name || ''} ${selectedEmployee.last_name || ''}`.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-gray-900">
                    {`${selectedEmployee.first_name || ''} ${selectedEmployee.last_name || ''}`.trim()}
                  </div>
                  <div className="text-sm text-gray-500">{selectedEmployee.email}</div>
                  <div className="text-xs text-gray-400">{selectedEmployee.department} • {selectedEmployee.position}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className="text-sm text-[#64126D] hover:underline"
                >
                  Change
                </button>
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
                placeholder="Enter password (min 6 characters)"
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
                  'Create User'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
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

// Reset Password Modal
function ResetPasswordModal({ user, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.newPassword) {
      setError('New password is required');
      return;
    }

    if (formData.newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          new_password: formData.newPassword
        })
      });

      const data = await res.json();
      if (data.success) {
        setSuccess(data.message || 'Password reset successfully');
        setTimeout(() => {
          onSuccess();
        }, 1500);
      } else {
        setError(data.error || 'Failed to reset password');
      }
    } catch {
      setError('Failed to reset password');
    } finally {
      setSaving(false);
    }
  };

  const fullName = user.full_name || user.username;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between rounded-t-xl">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Reset Password</h3>
            <p className="text-sm text-gray-500 mt-0.5">For user: {fullName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
            <div className="flex gap-2">
              <KeyIcon className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700">
                This will reset the password for <strong>{user.username}</strong>. The user will need to use the new password on their next login.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New Password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={formData.newPassword}
              onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-[#64126D]"
              placeholder="Enter new password"
              minLength={6}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm Password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#64126D] focus:border-[#64126D]"
              placeholder="Confirm new password"
            />
          </div>

          {/* Success Message */}
          {success && (
            <div className="bg-green-50 text-green-600 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {success}
            </div>
          )}

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
              disabled={saving || success}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Resetting...
                </>
              ) : (
                <>
                  <KeyIcon className="h-4 w-4" />
                  Reset Password
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Edit User Modal
function EditUserModal({ user, employees, onClose, onSuccess }) {
  const employee = employees?.find(e => e.id === user.employee_id);
  const [formData, setFormData] = useState({
    username: user.username || '',
    email: user.email || '',
    full_name: user.full_name || '',
    status: user.status || 'active',
    department: user.department || ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.username) {
      setError('Username is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          username: formData.username,
          email: formData.email,
          full_name: formData.full_name,
          status: formData.status,
          department: formData.department
        })
      });

      const data = await res.json();
      if (data.success) {
        setSuccess('User updated successfully');
        setTimeout(() => {
          onSuccess();
        }, 1000);
      } else {
        setError(data.error || 'Failed to update user');
      }
    } catch {
      setError('Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-white flex items-center justify-between rounded-t-xl">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Edit User</h3>
            <p className="text-sm text-gray-500 mt-0.5">Update user account details</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Linked Employee Info */}
          {employee && (
            <div className="bg-purple-50 rounded-lg p-3 border border-purple-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-[#64126D] flex items-center justify-center text-white font-medium">
                  {(employee.first_name || 'U').charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{employee.first_name} {employee.last_name}</p>
                  <p className="text-xs text-gray-500">{employee.department || 'No department'} • {employee.position || 'No position'}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter email"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter full name"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Department
              </label>
              <input
                type="text"
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter department"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* Success Message */}
          {success && (
            <div className="bg-green-50 text-green-600 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {success}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !!success}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Saving...
                </>
              ) : (
                <>
                  <PencilIcon className="h-4 w-4" />
                  Save Changes
                </>
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
