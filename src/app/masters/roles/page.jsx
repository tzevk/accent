'use client';

import Navbar from '@/components/Navbar';
import { useEffect, useState } from 'react';
import { PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline';

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
    } catch (e) {
      console.error(e);
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
    } catch (e) {
      console.error(e);
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

  const permissionOptions = ['leads.view', 'leads.create', 'leads.edit', 'leads.delete', 'projects.view', 'projects.edit', 'users.manage', 'roles.manage'];

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-black">Role / Permission Master</h1>
                <p className="text-sm text-black">Create and manage roles and assign permissions</p>
              </div>
              <div>
                <button onClick={openCreate} className="bg-accent-primary text-white px-3 py-2 rounded-md inline-flex items-center space-x-2">
                  <PlusIcon className="h-4 w-4" />
                  <span>New Role</span>
                </button>
              </div>
            </div>

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
                            {(r.permissions && (() => { try { return JSON.parse(r.permissions).join(', '); } catch(e){ return '-'; } })()) || '-'}
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

            {showForm && (
              <div className="fixed inset-0 z-40 flex items-center justify-center">
                <div className="absolute inset-0 bg-black/30" onClick={() => setShowForm(false)} />
                <div className="bg-white rounded-lg shadow-lg p-6 z-50 w-full max-w-2xl">
                  <h2 className="text-lg font-medium mb-4">{editing ? 'Edit Role' : 'Create Role'}</h2>
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                      <label className="text-xs font-medium">Role Key (unique)</label>
                      <input required value={form.role_key} onChange={e => setForm({...form, role_key: e.target.value})} className="w-full border rounded-md p-2 mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-medium">Display Name</label>
                      <input value={form.display_name} onChange={e => setForm({...form, display_name: e.target.value})} className="w-full border rounded-md p-2 mt-1" />
                    </div>

                    <div>
                      <label className="text-xs font-medium">Permissions</label>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {permissionOptions.map(p => (
                          <label key={p} className={`inline-flex items-center space-x-2 p-2 border rounded ${form.permissions.includes(p) ? 'bg-accent-primary text-white' : 'bg-white'}`}>
                            <input type="checkbox" checked={form.permissions.includes(p)} onChange={() => togglePermission(p)} />
                            <span className="text-xs">{p}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end space-x-2 pt-3">
                      <button type="button" onClick={() => setShowForm(false)} className="px-3 py-2 rounded-md border">Cancel</button>
                      <button type="submit" className="px-3 py-2 rounded-md bg-accent-primary text-white">{editing ? 'Update' : 'Create'}</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
