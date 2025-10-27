'use client';

import Navbar from '@/components/Navbar';
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
  const [rolePermissions, setRolePermissions] = useState({});
  const [employeePermissions, setEmployeePermissions] = useState({});
  
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
      
      // Initialize role permissions state
      const initialPermissions = {};
      roles.forEach(role => {
        initialPermissions[role.id] = {
          read: false,
          write: false,
          delete: false
        };
      });
      setRolePermissions(initialPermissions);
    }
  }, [roles]);

  // Initialize employee permissions when users are loaded
  useEffect(() => {
    if (users.length > 0) {
      const initialEmployeePermissions = {};
      users.forEach(user => {
        if (user.id) {
          initialEmployeePermissions[user.id] = {
            read: false,
            write: false,
            delete: false
          };
        }
      });
      setEmployeePermissions(initialEmployeePermissions);
    }
  }, [users]);

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

  // Handle permission checkbox changes
  const handlePermissionChange = (roleId, permissionType) => {
    setRolePermissions(prev => ({
      ...prev,
      [roleId]: {
        ...prev[roleId],
        [permissionType]: !prev[roleId]?.[permissionType]
      }
    }));
  };

  // Handle employee permission checkbox changes
  const handleEmployeePermissionChange = (employeeId, permissionType) => {
    setEmployeePermissions(prev => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        [permissionType]: !prev[employeeId]?.[permissionType]
      }
    }));
  };

  // Save permissions (placeholder for now)
  const savePermissions = () => {
    console.log('Saving role permissions:', rolePermissions);
    console.log('Saving employee permissions:', employeePermissions);
    alert('Permissions saved! (Frontend only - backend implementation pending)');
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
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-black text-white hover:bg-gray-900 transition-colors shadow-sm"
            >
              <PlusIcon className="h-5 w-5" />
              Create New User
            </button>
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
                      <button
                        onClick={() => openEdit(user)}
                        className="text-blue-600 hover:text-blue-800 p-1 rounded"
                        title="Edit User"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="text-red-600 hover:text-red-800 p-1 rounded"
                        title="Delete User"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
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
            <p className="text-sm font-medium">{editingUser.employee_name || 'Not linked'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Current Role</span>
            <p className="text-sm font-medium">{editingUser.role_name || 'No role assigned'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Department</span>
            <p className="text-sm font-medium">{editingUser.role_department || 'N/A'}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Status</span>
            <p className="text-sm font-medium">{editingUser.status || 'Active'}</p>
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
  const renderPermissionsTab = () => (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-green-600 text-xl font-bold flex items-center space-x-2">
            <ShieldCheckIcon className="h-6 w-6" />
            <span className='text-black'>Role Permissions Management</span>
          </h2>
          <p className="text-gray-600 mt-1">Assign read, write, and delete permissions to organizational roles</p>
        </div>
        <button
          onClick={savePermissions}
          className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-900 transition-colors font-medium shadow-sm"
        >
          Save Permissions
        </button>
      </div>

      {/* Permissions Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role & Employee Information
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="flex items-center justify-center space-x-2">
                    <span>Read</span>
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        // Select/deselect all read permissions for roles
                        const newPermissions = { ...rolePermissions };
                        const newEmployeePermissions = { ...employeePermissions };
                        roles.forEach(role => {
                          if (!newPermissions[role.id]) newPermissions[role.id] = {};
                          newPermissions[role.id].read = e.target.checked;
                        });
                        users.forEach(user => {
                          if (!newEmployeePermissions[user.id]) newEmployeePermissions[user.id] = {};
                          newEmployeePermissions[user.id].read = e.target.checked;
                        });
                        setRolePermissions(newPermissions);
                        setEmployeePermissions(newEmployeePermissions);
                      }}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                  </div>
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="flex items-center justify-center space-x-2">
                    <span>Write</span>
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        // Select/deselect all write permissions
                        const newPermissions = { ...rolePermissions };
                        const newEmployeePermissions = { ...employeePermissions };
                        roles.forEach(role => {
                          if (!newPermissions[role.id]) newPermissions[role.id] = {};
                          newPermissions[role.id].write = e.target.checked;
                        });
                        users.forEach(user => {
                          if (!newEmployeePermissions[user.id]) newEmployeePermissions[user.id] = {};
                          newEmployeePermissions[user.id].write = e.target.checked;
                        });
                        setRolePermissions(newPermissions);
                        setEmployeePermissions(newEmployeePermissions);
                      }}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                  </div>
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div className="flex items-center justify-center space-x-2">
                    <span>Delete</span>
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        // Select/deselect all delete permissions
                        const newPermissions = { ...rolePermissions };
                        const newEmployeePermissions = { ...employeePermissions };
                        roles.forEach(role => {
                          if (!newPermissions[role.id]) newPermissions[role.id] = {};
                          newPermissions[role.id].delete = e.target.checked;
                        });
                        users.forEach(user => {
                          if (!newEmployeePermissions[user.id]) newEmployeePermissions[user.id] = {};
                          newEmployeePermissions[user.id].delete = e.target.checked;
                        });
                        setRolePermissions(newPermissions);
                        setEmployeePermissions(newEmployeePermissions);
                      }}
                      className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                  </div>
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {roles.map((role) => {
                const roleEmployees = users.filter(user => user.role_id === role.id);
                
                return (
                  <React.Fragment key={role.id}>
                    {/* Role Header Row */}
                    <tr className="bg-blue-50 hover:bg-blue-100">
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <div className="h-10 w-10 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-full flex items-center justify-center">
                            <span className="font-medium text-sm">
                              {role.role_name.split(' ').map(n => n[0]).join('')}
                            </span>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-bold text-gray-900 flex items-center space-x-2">
                              <span>{role.role_name}</span>
                              <span className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded-full">
                                {roleEmployees.length} employee{roleEmployees.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <div className="text-sm text-gray-600">{role.role_code} • {role.department}</div>
                            <div className="flex items-center space-x-2 mt-1">
                              <span className="text-xs text-gray-400">Level {role.hierarchy_level}</span>
                              <span className="text-xs">•</span>
                              {getHierarchyBadge(role.hierarchy_level)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <input
                            type="checkbox"
                            checked={rolePermissions[role.id]?.read || false}
                            onChange={() => handlePermissionChange(role.id, 'read')}
                            className="h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          />
                          <span className="text-xs text-gray-500">Role</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <input
                            type="checkbox"
                            checked={rolePermissions[role.id]?.write || false}
                            onChange={() => handlePermissionChange(role.id, 'write')}
                            className="h-5 w-5 text-yellow-600 rounded border-gray-300 focus:ring-yellow-500"
                          />
                          <span className="text-xs text-gray-500">Role</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <input
                            type="checkbox"
                            checked={rolePermissions[role.id]?.delete || false}
                            onChange={() => handlePermissionChange(role.id, 'delete')}
                            className="h-5 w-5 text-red-600 rounded border-gray-300 focus:ring-red-500"
                          />
                          <span className="text-xs text-gray-500">Role</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => {
                              // Quick assign all permissions to role
                              setRolePermissions(prev => ({
                                ...prev,
                                [role.id]: {
                                  read: true,
                                  write: true,
                                  delete: true
                                }
                              }));
                            }}
                            className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                            title="Grant All Role Permissions"
                          >
                            All
                          </button>
                          <button
                            onClick={() => {
                              // Clear all permissions for role
                              setRolePermissions(prev => ({
                                ...prev,
                                [role.id]: {
                                  read: false,
                                  write: false,
                                  delete: false
                                }
                              }));
                            }}
                            className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                            title="Revoke All Role Permissions"
                          >
                            None
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Employee Rows for this Role */}
                    {roleEmployees.map((employee) => (
                      <tr key={`employee-${employee.id}`} className="hover:bg-gray-50 border-l-4 border-blue-200">
                        <td className="px-6 py-3 pl-12">
                          <div className="flex items-center">
                            <div className="h-8 w-8 bg-gray-100 text-gray-600 rounded-full flex items-center justify-center">
                              <span className="font-medium text-xs">
                                {employee.full_name ? employee.full_name.split(' ').map(n => n[0]).join('') : employee.username[0].toUpperCase()}
                              </span>
                            </div>
                            <div className="ml-3">
                              <div className="text-sm font-medium text-gray-900">
                                {employee.employee_name || employee.username}
                              </div>
                              <div className="text-xs text-gray-500">
                                {employee.employee_code || employee.email}
                              </div>
                              {employee.employee_position && (
                                <div className="text-xs text-gray-400">{employee.employee_position}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={employeePermissions[employee.id]?.read || false}
                            onChange={() => handleEmployeePermissionChange(employee.id, 'read')}
                            className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-6 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={employeePermissions[employee.id]?.write || false}
                            onChange={() => handleEmployeePermissionChange(employee.id, 'write')}
                            className="h-4 w-4 text-yellow-600 rounded border-gray-300 focus:ring-yellow-500"
                          />
                        </td>
                        <td className="px-6 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={employeePermissions[employee.id]?.delete || false}
                            onChange={() => handleEmployeePermissionChange(employee.id, 'delete')}
                            className="h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                          />
                        </td>
                        <td className="px-6 py-3 text-center">
                          <div className="flex items-center justify-center space-x-1">
                            <button
                              onClick={() => {
                                // Quick assign all permissions to employee
                                setEmployeePermissions(prev => ({
                                  ...prev,
                                  [employee.id]: {
                                    read: true,
                                    write: true,
                                    delete: true
                                  }
                                }));
                              }}
                              className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                              title="Grant All Employee Permissions"
                            >
                              All
                            </button>
                            <button
                              onClick={() => {
                                // Clear all permissions for employee
                                setEmployeePermissions(prev => ({
                                  ...prev,
                                  [employee.id]: {
                                    read: false,
                                    write: false,
                                    delete: false
                                  }
                                }));
                              }}
                              className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                              title="Revoke All Employee Permissions"
                            >
                              None
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {/* Show message if no employees in role */}
                    {roleEmployees.length === 0 && (
                      <tr className="border-l-4 border-blue-200">
                        <td colSpan={5} className="px-6 py-2 pl-12">
                          <div className="text-sm text-gray-400 italic">
                            No employees assigned to this role
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permission Summary */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-lg p-4">
          <h4 className="font-medium text-blue-900 mb-2">Read Permissions</h4>
          <div className="space-y-2">
            <div>
              <p className="text-2xl font-bold text-blue-600">
                {Object.values(rolePermissions).filter(p => p?.read).length}
              </p>
              <p className="text-xs text-blue-700">roles with read access</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-blue-500">
                {Object.values(employeePermissions).filter(p => p?.read).length}
              </p>
              <p className="text-xs text-blue-600">employees with read access</p>
            </div>
          </div>
        </div>
        <div className="bg-yellow-50 rounded-lg p-4">
          <h4 className="font-medium text-yellow-900 mb-2">Write Permissions</h4>
          <div className="space-y-2">
            <div>
              <p className="text-2xl font-bold text-yellow-600">
                {Object.values(rolePermissions).filter(p => p?.write).length}
              </p>
              <p className="text-xs text-yellow-700">roles with write access</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-yellow-500">
                {Object.values(employeePermissions).filter(p => p?.write).length}
              </p>
              <p className="text-xs text-yellow-600">employees with write access</p>
            </div>
          </div>
        </div>
        <div className="bg-red-50 rounded-lg p-4">
          <h4 className="font-medium text-red-900 mb-2">Delete Permissions</h4>
          <div className="space-y-2">
            <div>
              <p className="text-2xl font-bold text-red-600">
                {Object.values(rolePermissions).filter(p => p?.delete).length}
              </p>
              <p className="text-xs text-red-700">roles with delete access</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-red-500">
                {Object.values(employeePermissions).filter(p => p?.delete).length}
              </p>
              <p className="text-xs text-red-600">employees with delete access</p>
            </div>
          </div>
        </div>
      </div>

      {/* Department-wise Permission Overview */}
      <div className="mt-6 bg-gray-50 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Department Permission Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map((dept) => {
            const deptRoles = roles.filter(r => r.department === dept);
            const deptPermissions = deptRoles.reduce((acc, role) => {
              const perms = rolePermissions[role.id] || {};
              acc.read += perms.read ? 1 : 0;
              acc.write += perms.write ? 1 : 0;
              acc.delete += perms.delete ? 1 : 0;
              return acc;
            }, { read: 0, write: 0, delete: 0 });

            return (
              <div key={dept} className="bg-white rounded p-3 border border-gray-200">
                <h4 className="font-medium text-gray-900 mb-2">{dept}</h4>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Read:</span>
                    <span className="font-medium">{deptPermissions.read}/{deptRoles.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Write:</span>
                    <span className="font-medium">{deptPermissions.write}/{deptRoles.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Delete:</span>
                    <span className="font-medium">{deptPermissions.delete}/{deptRoles.length}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

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