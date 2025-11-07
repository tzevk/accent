'use client';

import React, { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';

export default function ProfilePage() {
  const { loading, user } = useSessionRBAC();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && user) {
      // Map user fields safely into form
      setForm({
        id: user.id,
        username: user.username || '',
        email: user.email || '',
        first_name: user.first_name || user.firstName || '',
        last_name: user.last_name || user.lastName || '',
        phone: user.phone || user.mobile || '',
        employee_id: user.employee_id || '',
        role_name: user.role_name || user.role || ''
      });
    }
  }, [loading, user]);

  const handleChange = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      // The API used elsewhere accepts PUT /api/users with id in payload
      const payload = { ...form, id: form.id };
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      });
      const j = await (res.headers.get('content-type')?.includes('application/json') ? res.json() : { success: res.ok });
      if (j && j.success) {
        setMessage('Profile updated');
      } else {
        setError((j && (j.error || j.message)) || `Failed to save (${res.status})`);
      }
    } catch (err) {
      console.error('Save profile failed', err);
      setError(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    window.location.href = '/signin';
  };

  if (loading) return (
    <div className="p-8">
      <div className="text-gray-600">Loading profile…</div>
    </div>
  );

  if (!user) return (
    <div className="p-8">
      <div className="text-gray-600">Not signed in. Please sign in to view your profile.</div>
    </div>
  );

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />

      <div className="flex-1 overflow-hidden">
        <div className="h-full px-4 pt-22">
          <div className="mb-6 flex items-center justify-between max-w-screen-2xl mx-auto px-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
              <p className="text-sm text-gray-600">Manage your account details</p>
            </div>
            <div className="text-sm text-gray-500">Signed in as <span className="font-medium">{user.username || user.email}</span></div>
          </div>

          <div className="h-full overflow-y-auto pb-8">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-screen-2xl mx-auto px-4">
              <div className="xl:col-span-2 space-y-6">
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Profile Information</h3>
                  <form onSubmit={handleSave} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-700">First name</label>
                        <input value={form.first_name || ''} onChange={(e) => handleChange('first_name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700">Last name</label>
                        <input value={form.last_name || ''} onChange={(e) => handleChange('last_name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700">Email</label>
                        <input value={form.email || ''} onChange={(e) => handleChange('email', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700">Phone</label>
                        <input value={form.phone || ''} onChange={(e) => handleChange('phone', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700">Employee ID</label>
                        <input value={form.employee_id || ''} onChange={(e) => handleChange('employee_id', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700">Role</label>
                        <input value={form.role_name || ''} onChange={(e) => handleChange('role_name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
                      </div>
                    </div>

                    {message && <div className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded">{message}</div>}
                    {error && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{error}</div>}

                    <div className="flex items-center space-x-3">
                      <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-[#64126D] text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
                      <button type="button" onClick={handleLogout} className="px-4 py-2 rounded-lg border">Sign out</button>
                    </div>
                  </form>
                </div>
              </div>

              <aside className="space-y-6">
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Account</h4>
                  <p className="text-sm text-gray-600">Username: <span className="font-medium">{user.username || '-'}</span></p>
                  <p className="text-sm text-gray-600 mt-2">Member since: <span className="font-medium">{user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}</span></p>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Security</h4>
                  <p className="text-sm text-gray-600">Change password from the Users section or request an admin to reset your password.</p>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
