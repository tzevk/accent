'use client';

import Navbar from '@/components/Navbar';
import RBACPermissionsManager from '@/components/RBACPermissionsManager';
import { useSessionRBAC } from '@/utils/client-rbac';
import { RESOURCES as RBAC_RESOURCES, PERMISSIONS as RBAC_PERMISSIONS } from '@/utils/rbac';
import React, { useState, useEffect } from 'react';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  UserIcon, 
  BriefcaseIcon, 
  ShieldCheckIcon,
  EyeIcon,
  EyeSlashIcon 
} from '@heroicons/react/24/outline';

export default function EnhancedUsersMaster() {
  const { loading: rbacLoading, user: sessionUser, can } = useSessionRBAC();
  const canUsersRead = !rbacLoading && can(RBAC_RESOURCES.USERS, RBAC_PERMISSIONS.READ);
  const canUsersCreate = !rbacLoading && can(RBAC_RESOURCES.USERS, RBAC_PERMISSIONS.CREATE);
  const canUsersUpdate = !rbacLoading && can(RBAC_RESOURCES.USERS, RBAC_PERMISSIONS.UPDATE);
  const canUsersDelete = !rbacLoading && can(RBAC_RESOURCES.USERS, RBAC_PERMISSIONS.DELETE);
  const [users, setUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('users');
  const [editing, setEditing] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // RBAC manager state
  const [rbacTargetType, setRbacTargetType] = useState('role'); // 'role' | 'user'
  const [rbacRoleId, setRbacRoleId] = useState('');
  const [rbacUserId, setRbacUserId] = useState('');
  
  const [form, setForm] = useState({
    employee_id: '',
    username: '',
    password: '',
    email: '',
    role_id: '',
    permissions: [],
    status: 'active'
  });

  const [editForm, setEditForm] = useState({
    employee_id: '',
    username: '',
    password: '',
    email: '',
    role_id: '',
    permissions: [],
    status: 'active'
  });

  // Fetch all data
  useEffect(() => {
    fetchUsers();
    fetchEmployees();
    fetchRoles();
  }, []);

  // Extract unique departments when roles are loaded
  useEffect(() => {
    if (roles.length > 0) {
      const uniqueDepts = [...new Set(roles.map(role => role.department).filter(Boolean))];
      setDepartments(uniqueDepts);
    }
  }, [roles]);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (data.success) {
        setUsers(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const res = await fetch('/api/employees/available-for-users');
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const fetchRoles = async () => {
    try {
      const res = await fetch('/api/roles-master');
      const data = await res.json();
      if (data.success) {
        setRoles(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching roles:', error);
    }
  };

  const openCreate = () => {
    if (!canUsersCreate) {
      alert('You do not have permission to create users.');
      return;
    }
    setForm({
      employee_id: '',
      username: '',
      password: '',
      email: '',
      role_id: '',
      permissions: [],
      status: 'active'
    });
    setEditing(null);
    setEditingUser(null);
    setActiveTab('add-user');
  };

  const openEdit = (user) => {
    if (!canUsersUpdate) {
      alert('You do not have permission to update users.');
      return;
    }
    setEditForm({
      employee_id: user.employee_id || '',
      username: user.username,
      password: '',
      email: user.email || '',
      role_id: user.role_id || '',
      permissions: user.permissions ? JSON.parse(user.permissions) : [],
      status: user.status || 'active'
    });
    setEditing(user.id);
    setEditingUser(user);
    setActiveTab('edit-user');
  };

  const handleEmployeeChange = (employeeId) => {
    const employee = employees.find(emp => emp.id === parseInt(employeeId));
    if (employee) {
      setForm(prev => ({
        ...prev,
        employee_id: employeeId,
        email: employee.email || '',
        username: `${employee.first_name.toLowerCase()}.${employee.last_name.toLowerCase()}`.replace(/\s+/g, '')
      }));
    } else {
      setForm(prev => ({
        ...prev,
        employee_id: employeeId,
        email: '',
        username: ''
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canUsersCreate) {
      alert('You do not have permission to create users.');
      return;
    }
    setSubmitting(true);

    try {
      const res = await fetch('/api/users', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(form) 
      });

      const j = await res.json();

      if (j.success) {
        setActiveTab('users');
        setForm({
          employee_id: '',
          username: '',
          password: '',
          email: '',
          role_id: '',
          permissions: [],
          status: 'active'
        });
        fetchUsers();
        fetchEmployees(); // Refresh to update available employees
      } else {
        alert('Error: ' + (j.error || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      alert('Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!canUsersUpdate) {
      alert('You do not have permission to update users.');
      return;
    }
    setSubmitting(true);

    try {
      const payload = { ...editForm, id: editing };
      const res = await fetch('/api/users', { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      });

      const j = await res.json();

      if (j.success) {
        setActiveTab('users');
        setEditing(null);
        setEditingUser(null);
        setEditForm({
          employee_id: '',
          username: '',
          password: '',
          email: '',
          role_id: '',
          permissions: [],
          status: 'active'
        });
        fetchUsers();
        fetchEmployees(); // Refresh to update available employees
      } else {
        alert('Error: ' + (j.error || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      alert('Failed to update user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!canUsersDelete) {
      alert('You do not have permission to delete users.');
      return;
    }
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' });
      const j = await res.json();
      if (j.success) {
        fetchUsers();
        fetchEmployees(); // Refresh available employees
      } else {
        alert('Error: ' + (j.error || 'Unknown error'));
      }
    } catch (e) {
      console.error(e);
      alert('Failed to delete user');
    }
  };

  const filteredRoles = selectedDepartment 
    ? roles.filter(role => role.department === selectedDepartment)
    : roles;

  const getStatusBadge = (status) => {
    if (status === 'active') {
      return (
        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
          Active
        </span>
      );
    }
    return (
      <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
        Inactive
      </span>
    );
  };

  const getHierarchyBadge = (hierarchy) => {
    if (hierarchy >= 80) {
      return <span className="text-purple-600 font-bold">Executive</span>;
    } else if (hierarchy >= 60) {
      return <span className="text-blue-600 font-semibold">Management</span>;
    } else if (hierarchy >= 40) {
      return <span className="text-green-600">Senior</span>;
    } else {
      return <span className="text-gray-600">Associate</span>;
    }
  };

  // Render Stats Cards
  const renderStatsCards = () => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <div className="flex items-center">
          <UserIcon className="h-8 w-8 text-blue-500" />
          <div className="ml-3">
            <p className="text-sm font-medium text-gray-500">Total Users</p>
            <p className="text-2xl font-bold text-gray-900">{users.length}</p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <div className="flex items-center">
          <BriefcaseIcon className="h-8 w-8 text-green-500" />
          <div className="ml-3">
            <p className="text-sm font-medium text-gray-500">Available Employees</p>
            <p className="text-2xl font-bold text-gray-900">
              {employees.filter(emp => !emp.user_id).length}
            </p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <div className="flex items-center">
          <ShieldCheckIcon className="h-8 w-8 text-purple-500" />
          <div className="ml-3">
            <p className="text-sm font-medium text-gray-500">Active Roles</p>
            <p className="text-2xl font-bold text-gray-900">{roles.length}</p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <div className="flex items-center">
          <div className="h-8 w-8 bg-orange-500 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">D</span>
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-gray-500">Departments</p>
            <p className="text-2xl font-bold text-gray-900">{departments.length}</p>
          </div>
        </div>
      </div>
    </div>
  );

  // Render Users List
  const renderUsersList = () => (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {!rbacLoading && !canUsersRead && (
        <div className="p-8 text-center text-sm text-yellow-900 bg-yellow-50 border-b border-yellow-200">
          You don’t have permission to view users. Please contact an administrator.
        </div>
      )}
      {loading ? (
        <div className="p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">Loading users...</p>
        </div>
      ) : users.length === 0 ? (
        <div className="p-8 text-center">
          <UserIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No users found</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by creating your first user.</p>
          <div className="mt-4">
            {canUsersCreate && (
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-black text-white hover:bg-gray-900 transition-colors shadow-sm"
              >
                <PlusIcon className="h-5 w-5" />
                Create New User
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User Details
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Employee
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role & Department
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="h-10 w-10 bg-gray-900 text-white rounded-full flex items-center justify-center">
                        <span className="font-medium">
                          {user.full_name ? user.full_name.split(' ').map(n => n[0]).join('') : user.username[0].toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{user.username}</div>
                        <div className="text-sm text-gray-500">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">
                      {user.employee_name || 'Not linked'}
                    </div>
                    <div className="text-sm text-gray-500">
                      {user.employee_code || 'No employee code'}
                    </div>
                    {user.employee_position && (
                      <div className="text-xs text-gray-400">{user.employee_position}</div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      {user.role_name ? (
                        <div>
                          <div className="text-sm font-medium text-gray-900">{user.role_name}</div>
                          <div className="text-sm text-gray-500">{user.role_department}</div>
                          <div className="text-xs">{getHierarchyBadge(user.role_hierarchy)}</div>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">No role assigned</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {getStatusBadge(user.status)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      {canUsersUpdate && (
                        <button
                          onClick={() => openEdit(user)}
                          className="text-blue-600 hover:text-blue-800 p-1 rounded"
                          title="Edit User"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                      )}
                      {canUsersDelete && (
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="text-red-600 hover:text-red-800 p-1 rounded"
                          title="Delete User"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // Render Add User Form
  const renderAddUserForm = () => (
    <div>
      <h2 className="text-xl font-bold mb-6 flex items-center space-x-2 text-black">
        <PlusIcon className="h-6 w-6 text-black" />
        <span>Create New User</span>
      </h2>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Employee Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Employee *
          </label>
          <select
            required
            value={form.employee_id}
            onChange={(e) => handleEmployeeChange(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
          >
            <option value="">Choose an employee...</option>
            {employees.filter(emp => !emp.user_id).map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.first_name} {emp.last_name} ({emp.employee_id}) - {emp.department}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Only employees without existing user accounts are shown
          </p>
        </div>

        {/* Username */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Username *
          </label>
          <input
            required
            type="text"
            value={form.username}
            onChange={(e) => setForm({...form, username: e.target.value})}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
            placeholder="Enter username"
          />
        </div>

        {/* Password */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Password *
          </label>
          <div className="relative">
            <input
              required
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => setForm({...form, password: e.target.value})}
              className="w-full border border-gray-300 rounded-md px-3 py-2 pr-10 focus:ring-2 focus:ring-black focus:border-transparent"
              placeholder="Enter password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
            >
              {showPassword ? (
                <EyeSlashIcon className="h-4 w-4 text-gray-400" />
              ) : (
                <EyeIcon className="h-4 w-4 text-gray-400" />
              )}
            </button>
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Email
          </label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({...form, email: e.target.value})}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
            placeholder="Enter email address"
          />
        </div>

        {/* Department Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filter by Department
          </label>
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
          >
            <option value="">All Departments</option>
            {departments.map((dept) => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>

        {/* Role Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Assign Role
          </label>
          <select
            value={form.role_id}
            onChange={(e) => setForm({...form, role_id: e.target.value})}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
          >
            <option value="">No role assigned</option>
            {filteredRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.role_name} ({role.role_code}) - {role.department}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            {filteredRoles.length} roles available
            {selectedDepartment && ` in ${selectedDepartment}`}
          </p>
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Status
          </label>
          <select
            value={form.status}
            onChange={(e) => setForm({...form, status: e.target.value})}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Form Actions */}
        <div className="flex justify-end space-x-3 pt-6 border-t">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-900 transition-colors disabled:opacity-50 font-medium shadow-sm"
          >
            {submitting ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </form>
    </div>
  );

  // Render Edit User Form
  const renderEditUserForm = () => (
    <div>
      <h2 className="text-xl font-bold mb-6 flex items-center space-x-2 text-black">
        <PencilIcon className="h-6 w-6 text-black" />
        <span>Edit User: {editingUser.username}</span>
      </h2>

      {/* User Info Display */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Current User Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-gray-500">Employee</span>
            <p className="text-sm font-medium text-black">{editingUser.employee_name || 'Not linked'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Current Role</span>
            <p className="text-sm font-medium text-black">{editingUser.role_name || 'No role assigned'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Department</span>
            <p className="text-sm font-medium text-black">{editingUser.role_department || 'N/A'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Status</span>
            <p className="text-sm font-medium text-black">{editingUser.status || 'Active'}</p>
          </div>
        </div>
      </div>
      
      <form onSubmit={handleEditSubmit} className="space-y-6">
        {/* Username */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Username *
          </label>
          <input
            required
            type="text"
            value={editForm.username}
            onChange={(e) => setEditForm({...editForm, username: e.target.value})}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
            placeholder="Enter username"
          />
        </div>

        {/* Password */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            New Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={editForm.password}
              onChange={(e) => setEditForm({...editForm, password: e.target.value})}
              className="w-full border border-gray-300 rounded-md px-3 py-2 pr-10 focus:ring-2 focus:ring-black focus:border-transparent"
              placeholder="Leave blank to keep current password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
            >
              {showPassword ? (
                <EyeSlashIcon className="h-4 w-4 text-gray-400" />
              ) : (
                <EyeIcon className="h-4 w-4 text-gray-400" />
              )}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Leave blank to keep the current password
          </p>
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Email
          </label>
          <input
            type="email"
            value={editForm.email}
            onChange={(e) => setEditForm({...editForm, email: e.target.value})}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
            placeholder="Enter email address"
          />
        </div>

        {/* Department Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filter by Department
          </label>
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
          >
            <option value="">All Departments</option>
            {departments.map((dept) => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>

        {/* Role Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Assign Role
          </label>
          <select
            value={editForm.role_id}
            onChange={(e) => setEditForm({...editForm, role_id: e.target.value})}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
          >
            <option value="">No role assigned</option>
            {filteredRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.role_name} ({role.role_code}) - {role.department}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            {filteredRoles.length} roles available
            {selectedDepartment && ` in ${selectedDepartment}`}
          </p>
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Status
          </label>
          <select
            value={editForm.status}
            onChange={(e) => setEditForm({...editForm, status: e.target.value})}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-black focus:border-transparent"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Form Actions */}
        <div className="flex justify-end space-x-3 pt-6 border-t">
          <button
            type="button"
            onClick={() => {
              setActiveTab('users');
              setEditing(null);
              setEditingUser(null);
            }}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-900 transition-colors disabled:opacity-50 font-medium shadow-sm"
          >
            {submitting ? 'Updating...' : 'Update User'}
          </button>
        </div>
      </form>
    </div>
  );

  // Render Permissions Tab
  const renderPermissionsTab = () => {
    // Only admins (is_super_admin) can access permissions management
    const isAdmin = sessionUser?.is_super_admin === true;
    
    return (
      <div>
        {/* RBAC Manager (Admins only) */}
        {rbacLoading ? (
          <div className="p-4 text-gray-600">Loading access…</div>
        ) : isAdmin ? (
          <div className="mb-6 bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-xl font-bold text-black">Manage Permissions</h2>
                <p className="text-sm text-gray-600">Grant or revoke permissions for roles or specific users. Only administrators can manage permissions.</p>
              </div>
              <div className="flex items-center space-x-2 px-3 py-1 bg-red-50 border border-red-200 rounded-md">
                <ShieldCheckIcon className="h-5 w-5 text-red-600" />
                <span className="text-sm font-semibold text-red-700">Admin Access</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Target</label>
                <select
                  value={rbacTargetType}
                  onChange={(e) => setRbacTargetType(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="role">Role</option>
                  <option value="user">User</option>
                </select>
              </div>
              {rbacTargetType === 'role' ? (
                <div className="md:col-span-2">
                  <label className="block text-xs text-gray-600 mb-1">Select Role</label>
                  <select
                    value={rbacRoleId}
                    onChange={(e) => setRbacRoleId(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="">Choose a role…</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.role_name} ({r.role_code})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="md:col-span-2">
                  <label className="block text-xs text-gray-600 mb-1">Select User</label>
                  <select
                    value={rbacUserId}
                    onChange={(e) => setRbacUserId(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="">Choose a user…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.username} {u.role_name ? `• ${u.role_name}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {(rbacTargetType === 'role' && rbacRoleId) && (
              <RBACPermissionsManager
                type="role"
                targetId={rbacRoleId}
                targetName={(roles.find(r => String(r.id) === String(rbacRoleId))?.role_name) || 'Role'}
                onPermissionsUpdated={() => {
                  // Refresh users list to reflect permission changes
                  fetchUsers();
                }}
              />
            )}
            {(rbacTargetType === 'user' && rbacUserId) && (
              <RBACPermissionsManager
                type="user"
                targetId={rbacUserId}
                targetName={(users.find(u => String(u.id) === String(rbacUserId))?.username) || 'User'}
                onPermissionsUpdated={() => {
                  // Refresh users list to reflect permission changes
                  fetchUsers();
                }}
              />
            )}
          </div>
        ) : (
          <div className="p-6 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-start space-x-3">
              <ShieldCheckIcon className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-semibold text-red-900 mb-2">Access Denied</h3>
                <p className="text-sm text-red-800 mb-2">
                  You don&apos;t have permission to manage permissions. Only administrators can access this section.
                </p>
                <p className="text-xs text-red-700">
                  If you believe you should have access, please contact your system administrator.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-24 pb-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-black mb-2">User Management</h1>
                <p className="text-gray-600">Create and manage user accounts with role-based permissions</p>
              </div>
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-black text-white hover:bg-gray-900 transition-colors shadow-sm"
              >
                <PlusIcon className="h-5 w-5" />
                Create New User
              </button>
            </div>

            {/* Tab Navigation - Fixed */}
            <div className="flex border-b border-gray-200 bg-white rounded-t-lg px-6 pt-4 mb-6">
              <button
                onClick={() => setActiveTab('users')}
                className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
                  activeTab === 'users'
                    ? 'border-black text-black bg-gray-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <UserIcon className="h-5 w-5 inline mr-2" />
                All Users ({users.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('add-user')}
                className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
                  activeTab === 'add-user'
                    ? 'border-black text-black bg-gray-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <PlusIcon className="h-5 w-5 inline mr-2" />
                Create New User
              </button>
              {editingUser && (
                <button
                  onClick={() => setActiveTab('edit-user')}
                  className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
                    activeTab === 'edit-user'
                      ? 'border-black text-black bg-gray-50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <PencilIcon className="h-5 w-5 inline mr-2" />
                  Edit: {editingUser.username}
                </button>
              )}
              {/* Only show Permissions tab for admins */}
              {!rbacLoading && sessionUser?.is_super_admin === true && (
                <button
                  onClick={() => setActiveTab('permissions')}
                  className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
                    activeTab === 'permissions'
                      ? 'border-black text-black bg-gray-50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <ShieldCheckIcon className="h-5 w-5 inline mr-2" />
                  Permissions
                </button>
              )}
            </div>

            {/* Tab Content */}
            {activeTab === 'users' && (
              <>
                {renderStatsCards()}
                {renderUsersList()}
              </>
            )}

            {activeTab === 'add-user' && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                {renderAddUserForm()}
              </div>
            )}

            {activeTab === 'edit-user' && editingUser && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                {renderEditUserForm()}
              </div>
            )}

            {activeTab === 'permissions' && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                {renderPermissionsTab()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}