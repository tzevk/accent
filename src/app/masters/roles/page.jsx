'use client';

import Navbar from '@/components/Navbar';
import { useEffect, useState } from 'react';
import { PlusIcon, TrashIcon, PencilIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function RolesMaster() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ role_key: '', display_name: '', permissions: [] });

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    try {
      const res = await fetch('/api/roles');
      const j = await res.json();
      if (j.success) setRoles(j.data || []);
    } catch {
        console.error('An error occurred while fetching roles');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ role_key: '', display_name: '', permissions: [] });
    setShowForm(true);
  };

  const openEdit = (role) => {
    setEditing(role.id);
    setForm({ role_key: role.role_key, display_name: role.display_name || '', permissions: role.permissions ? JSON.parse(role.permissions) : [] });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editing ? '/api/roles' : '/api/roles';
      const method = editing ? 'PUT' : 'POST';
      const payload = { ...form };
      if (editing) payload.id = editing;

      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (j.success) {
        setShowForm(false);
        fetchRoles();
      } else {
        alert('Error: ' + (j.error || 'Unknown'));
      }
    } catch (err) {
      console.error(err);
      alert('Failed');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete role?')) return;
    try {
      const res = await fetch(`/api/roles?id=${id}`, { method: 'DELETE' });
      const j = await res.json();
      if (j.success) fetchRoles(); else alert('Error: ' + (j.error || 'Unknown'));
    } catch {
        console.error('An error occurred while deleting the role');
      alert('Failed to delete');
    }
  };

  const togglePermission = (perm) => {
    setForm(prev => {
      const set = new Set(prev.permissions || []);
      if (set.has(perm)) set.delete(perm); else set.add(perm);
      return { ...prev, permissions: Array.from(set) };
    });
  };

  const toggleModulePermissions = (module, action) => {
    const modulePerm = `${module}:${action}`;
    togglePermission(modulePerm);
  };

  const selectAllForModule = (module) => {
    const actions = ['read', 'create', 'update', 'delete'];
    setForm(prev => {
      const set = new Set(prev.permissions || []);
      actions.forEach(action => set.add(`${module}:${action}`));
      return { ...prev, permissions: Array.from(set) };
    });
  };

  const clearAllForModule = (module) => {
    const actions = ['read', 'create', 'update', 'delete'];
    setForm(prev => {
      const set = new Set(prev.permissions || []);
      actions.forEach(action => set.delete(`${module}:${action}`));
      return { ...prev, permissions: Array.from(set) };
    });
  };

  const hasPermission = (module, action) => {
    return form.permissions.includes(`${module}:${action}`);
  };

  // Organized permission structure with descriptions
  const permissionGroups = [
    {
      name: 'Lead Management',
      module: 'leads',
      icon: '🎯',
      description: 'Manage customer leads and inquiries',
      permissions: [
        { action: 'read', label: 'View', description: 'View lead information' },
        { action: 'create', label: 'Create', description: 'Add new leads' },
        { action: 'update', label: 'Edit', description: 'Modify lead details' },
        { action: 'delete', label: 'Delete', description: 'Remove leads' },
        { action: 'assign', label: 'Assign', description: 'Assign leads to team members' },
        { action: 'import', label: 'Import', description: 'Import leads from files' },
      ]
    },
    {
      name: 'Project Management',
      module: 'projects',
      icon: '📊',
      description: 'Manage projects and proposals',
      permissions: [
        { action: 'read', label: 'View', description: 'View project details' },
        { action: 'create', label: 'Create', description: 'Create new projects' },
        { action: 'update', label: 'Edit', description: 'Modify projects' },
        { action: 'delete', label: 'Delete', description: 'Delete projects' },
        { action: 'approve', label: 'Approve', description: 'Approve proposals' },
      ]
    },
    {
      name: 'Employee Management',
      module: 'employees',
      icon: '👥',
      description: 'Manage employee records',
      permissions: [
        { action: 'read', label: 'View', description: 'View employee profiles' },
        { action: 'create', label: 'Create', description: 'Add new employees' },
        { action: 'update', label: 'Edit', description: 'Edit employee data' },
        { action: 'delete', label: 'Delete', description: 'Remove employees' },
      ]
    },
    {
      name: 'Company Management',
      module: 'companies',
      icon: '🏢',
      description: 'Manage company/client records',
      permissions: [
        { action: 'read', label: 'View', description: 'View companies' },
        { action: 'create', label: 'Create', description: 'Add companies' },
        { action: 'update', label: 'Edit', description: 'Edit companies' },
        { action: 'delete', label: 'Delete', description: 'Delete companies' },
      ]
    },
    {
      name: 'Vendor Management',
      module: 'vendors',
      icon: '🤝',
      description: 'Manage vendor relationships',
      permissions: [
        { action: 'read', label: 'View', description: 'View vendors' },
        { action: 'create', label: 'Create', description: 'Add vendors' },
        { action: 'update', label: 'Edit', description: 'Edit vendors' },
        { action: 'delete', label: 'Delete', description: 'Delete vendors' },
      ]
    },
    {
      name: 'User Management',
      module: 'users',
      icon: '🔐',
      description: 'Manage system users and accounts',
      permissions: [
        { action: 'read', label: 'View', description: 'View user accounts' },
        { action: 'create', label: 'Create', description: 'Create users' },
        { action: 'update', label: 'Edit', description: 'Modify users' },
        { action: 'delete', label: 'Delete', description: 'Remove users' },
      ]
    },
    {
      name: 'Role Management',
      module: 'roles',
      icon: '🛡️',
      description: 'Manage roles and permissions',
      permissions: [
        { action: 'read', label: 'View', description: 'View roles' },
        { action: 'create', label: 'Create', description: 'Create roles' },
        { action: 'update', label: 'Edit', description: 'Modify roles' },
        { action: 'delete', label: 'Delete', description: 'Delete roles' },
      ]
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
        {/* Header */}
        <div className="mb-6">
          <nav className="text-xs text-gray-500 mb-1" aria-label="Breadcrumb">
            <ol className="inline-flex items-center gap-2">
              <li>Home</li>
              <li className="text-gray-300">/</li>
              <li>Masters</li>
              <li className="text-gray-300">/</li>
              <li className="text-gray-700">Roles</li>
            </ol>
          </nav>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Role / Permission Master</h1>
              <p className="text-sm text-gray-600 mt-1">Create and manage roles and assign permissions</p>
            </div>
            {!showForm && (
              <button 
                onClick={openCreate} 
                className="inline-flex items-center gap-2 rounded-lg bg-[#64126D] text-white text-sm px-3.5 py-2 shadow-sm hover:bg-[#5a1161]"
              >
                <PlusIcon className="h-4 w-4" />
                <span>New Role</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Form (when active) */}
          {showForm && (
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">{editing ? 'Edit Role' : 'Create New Role'}</h2>
                  <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Role Info Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide border-b border-gray-200 pb-2">Role Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Role Key *</label>
                        <input 
                          type="text" 
                          required 
                          value={form.role_key} 
                          onChange={(e) => setForm({ ...form, role_key: e.target.value })} 
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          placeholder="e.g., admin, manager"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Display Name *</label>
                        <input 
                          type="text" 
                          required 
                          value={form.display_name} 
                          onChange={(e) => setForm({ ...form, display_name: e.target.value })} 
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                          placeholder="e.g., Administrator"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Permissions Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Permissions</h3>
                      <span className="text-xs text-gray-500">{form.permissions?.length || 0} selected</span>
                    </div>
                    
                    <div className="space-y-4">
                      {permissionGroups.map((group) => {
                        const selectedCount = group.permissions.filter(p => 
                          hasPermission(group.module, p.action)
                        ).length;
                        
                        return (
                          <div key={group.module} className="border border-gray-200 rounded-lg overflow-hidden">
                            {/* Module Header */}
                            <div className="bg-purple-50 px-4 py-3 border-b border-gray-200">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <span className="text-2xl">{group.icon}</span>
                                  <div>
                                    <h4 className="text-sm font-semibold text-gray-900">{group.name}</h4>
                                    <p className="text-xs text-gray-600 mt-0.5">{group.description}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-purple-700 font-medium bg-purple-100 px-2 py-1 rounded">
                                    {selectedCount}/{group.permissions.length}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => selectAllForModule(group.module)}
                                    className="text-xs text-purple-600 hover:text-purple-800 font-medium px-2 py-1 hover:bg-purple-100 rounded transition-colors"
                                  >
                                    Select All
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => clearAllForModule(group.module)}
                                    className="text-xs text-gray-600 hover:text-gray-800 font-medium px-2 py-1 hover:bg-gray-100 rounded transition-colors"
                                  >
                                    Clear
                                  </button>
                                </div>
                              </div>
                            </div>
                            
                            {/* Permissions Grid */}
                            <div className="p-4 bg-white">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {group.permissions.map((perm) => {
                                  const isChecked = hasPermission(group.module, perm.action);
                                  
                                  return (
                                    <label
                                      key={perm.action}
                                      className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                                        isChecked 
                                          ? 'bg-purple-50 border-purple-300 shadow-sm' 
                                          : 'bg-white border-gray-200 hover:border-purple-200 hover:bg-purple-25'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleModulePermissions(group.module, perm.action)}
                                        className="sr-only"
                                      />
                                      <div className={`flex items-center justify-center w-5 h-5 rounded border-2 transition-all flex-shrink-0 mt-0.5 ${
                                        isChecked 
                                          ? 'bg-purple-600 border-purple-600' 
                                          : 'bg-white border-gray-300'
                                      }`}>
                                        {isChecked && (
                                          <CheckIcon className="h-3 w-3 text-white" />
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className={`text-sm font-medium ${isChecked ? 'text-purple-900' : 'text-gray-900'}`}>
                                          {perm.label}
                                        </div>
                                        <div className="text-xs text-gray-500 mt-0.5">
                                          {perm.description}
                                        </div>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Form Actions */}
                  <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                    <button 
                      type="button" 
                      onClick={() => setShowForm(false)} 
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors"
                    >
                      {editing ? 'Update Role' : 'Create Role'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Right Column - Roles List */}
          <div className={showForm ? 'lg:col-span-1' : 'lg:col-span-3'}>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {loading ? (
                <div className="p-6 text-center">Loading...</div>
              ) : roles.length === 0 ? (
                <div className="p-6 text-center">No roles found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Role Key</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Display Name</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Permissions</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-black uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {roles.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-black">{r.role_key}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-black">{r.display_name || '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-black">
                            {(r.permissions && (() => { try { return JSON.parse(r.permissions).join(', '); } catch{ return '-'; } })()) || '-'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex items-center justify-end space-x-2">
                              <button title="Edit" onClick={() => openEdit(r)} className="p-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-full">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button title="Delete" onClick={() => handleDelete(r.id)} className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-full">
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
          </div>
        </div>
      </div>
    </div>
  );
}
