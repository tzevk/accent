'use client';

import Navbar from '@/components/Navbar';
import { useEffect, useState } from 'react';
import { PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline';

export default function UsersMaster() {
  const [users, setUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
    const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', email: '', employee_id: '', role: '' });

  useEffect(() => {
    fetchUsers();
    fetchEmployees();
    fetchRoles();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      const j = await res.json();
      if (j.success) setUsers(j.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const res = await fetch('/api/employees?limit=1000');
      const j = await res.json();
      if (!j.error) setEmployees(j.employees || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRoles = async () => {
    try {
      const res = await fetch('/api/roles');
      const j = await res.json();
      if (j.success) setRoles(j.data || []);
    } catch (e) {
      console.error('Error fetching roles', e);
    }
  };

  const openCreate = () => {
    setForm({ username: '', password: '', email: '', employee_id: '', role: '' });
    setShowForm(true);
  };

  const openEdit = (user) => {
    setForm({ username: user.username, password: '', email: user.email || '', employee_id: user.employee_id || '', role: user.role || '' });
    setEditing(user.id);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let res, j;
      if (editing) {
        const payload = { id: editing, username: form.username, email: form.email, employee_id: form.employee_id || null, role: form.role || null };
        if (form.password) payload.password_hash = form.password;
        res = await fetch('/api/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        j = await res.json();
      } else {
        res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
        j = await res.json();
      }

      if (j.success) {
        setShowForm(false);
        setEditing(null);
        setForm({ username: '', password: '', email: '', employee_id: '', role: '' });
        fetchUsers();
      } else {
        alert('Error: ' + (j.error || 'Unknown'));
      }
    } catch (err) {
      console.error(err);
      alert('Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete user?')) return;
    try {
      const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' });
      const j = await res.json();
      if (j.success) fetchUsers(); else alert('Error: ' + (j.error || 'Unknown'));
    } catch (e) {
      console.error(e);
      alert('Failed to delete');
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-black">User Master</h1>
                <p className="text-sm text-black">Manage CRM users and link them to employees</p>
              </div>
              <div>
                <button onClick={openCreate} className="bg-accent-primary text-white px-3 py-2 rounded-md inline-flex items-center space-x-2">
                  <PlusIcon className="h-4 w-4" />
                  <span>New User</span>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {loading ? (
                <div className="p-6 text-center">Loading...</div>
              ) : users.length === 0 ? (
                <div className="p-6 text-center">No users found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Username</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Email</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Employee</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">Role</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-black uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {users.map(u => (
                        <tr key={u.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-black">{u.username}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-black">{u.email || '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-black">{u.employee_name ? `${u.employee_name} (${u.employee_code})` : '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-black">{(roles.find(r => r.role_key === u.role) || {}).display_name || u.role || '-'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex items-center justify-end space-x-2">
                              <button title="Edit" onClick={() => openEdit(u)} className="p-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-full">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button title="Delete" onClick={() => handleDelete(u.id)} className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-full">
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

            {/* Form modal */}
            {showForm && (
              <div className="fixed inset-0 z-40 flex items-center justify-center">
                <div className="absolute inset-0 bg-black/30" onClick={() => setShowForm(false)} />
                <div className="bg-white rounded-lg shadow-lg p-6 z-50 w-full max-w-lg">
                  <h2 className="text-lg font-medium mb-4">Create User</h2>
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                      <label className="text-xs font-medium">Username</label>
                      <input required value={form.username} onChange={e => setForm({...form, username: e.target.value})} className="w-full border rounded-md p-2 mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-medium">Password</label>
                      <input required type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="w-full border rounded-md p-2 mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-medium">Email</label>
                      <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full border rounded-md p-2 mt-1" />
                    </div>
                    <div>
                      <label className="text-xs font-medium">Employee</label>
                      <select value={form.employee_id} onChange={e => setForm({...form, employee_id: e.target.value})} className="w-full border rounded-md p-2 mt-1">
                        <option value="">-- none --</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name} ({emp.employee_id})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium">Role</label>
                      <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className="w-full border rounded-md p-2 mt-1">
                        <option value="">-- none --</option>
                        {roles.map(r => (
                          <option key={r.id} value={r.role_key}>{r.display_name || r.role_key}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex justify-end space-x-2 pt-3">
                      <button type="button" onClick={() => setShowForm(false)} className="px-3 py-2 rounded-md border">Cancel</button>
                      <button disabled={submitting} type="submit" className="px-3 py-2 rounded-md bg-accent-primary text-white">{submitting ? 'Saving...' : 'Save'}</button>
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
