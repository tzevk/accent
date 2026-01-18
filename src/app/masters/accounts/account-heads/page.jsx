'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import { 
  PlusIcon, 
  TrashIcon, 
  PencilIcon, 
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  BanknotesIcon
} from '@heroicons/react/24/outline';

export default function AccountHeadMasterPage() {
  const [accountHeads, setAccountHeads] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    account_head_name: '',
    is_active: true
  });

  // Fetch account heads
  const fetchAccountHeads = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/masters/account-heads');
      const data = await res.json();
      if (data.success) {
        setAccountHeads(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch account heads:', err);
      setError('Failed to load account heads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccountHeads();
  }, []);

  // Filter account heads
  const filteredAccountHeads = accountHeads.filter(item => {
    if (!searchTerm) return true;
    return item.account_head_name?.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Show messages
  const showSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const showError = (msg) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  // Reset form
  const resetForm = () => {
    setFormData({
      account_head_name: '',
      is_active: true
    });
    setEditingId(null);
    setShowForm(false);
  };

  // Handle submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.account_head_name.trim()) {
      showError('Account head name is required');
      return;
    }

    try {
      const url = editingId 
        ? `/api/masters/account-heads?id=${editingId}` 
        : '/api/masters/account-heads';
      
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (data.success) {
        showSuccess(editingId ? 'Account head updated successfully' : 'Account head created successfully');
        resetForm();
        fetchAccountHeads();
      } else {
        showError(data.error || 'Failed to save account head');
      }
    } catch (err) {
      console.error('Error saving account head:', err);
      showError('Failed to save account head');
    }
  };

  // Edit account head
  const handleEdit = (item) => {
    setFormData({
      account_head_name: item.account_head_name || '',
      is_active: item.is_active !== false
    });
    setEditingId(item.id);
    setShowForm(true);
  };

  // Delete account head
  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this account head?')) return;

    try {
      const res = await fetch(`/api/masters/account-heads?id=${id}`, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (data.success) {
        showSuccess('Account head deleted successfully');
        fetchAccountHeads();
      } else {
        showError(data.error || 'Failed to delete account head');
      }
    } catch (err) {
      console.error('Error deleting account head:', err);
      showError('Failed to delete account head');
    }
  };

  return (
    <AccessGuard resource="activities" permission="read">
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        
        <main className="max-w-10xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <BanknotesIcon className="h-7 w-7 text-purple-600" />
                Account Head Master
              </h1>
              <p className="text-sm text-gray-500 mt-1">Manage account heads for cash voucher line items</p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <PlusIcon className="h-5 w-5" />
              Add Account Head
            </button>
          </div>

          {/* Messages */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg">
              {success}
            </div>
          )}

          {/* Form Modal */}
          {showForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {editingId ? 'Edit Account Head' : 'Add New Account Head'}
                  </h2>
                  <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Account Head Name *
                    </label>
                    <input
                      type="text"
                      value={formData.account_head_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, account_head_name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="e.g., Office Supplies, Travel Expenses"
                      required
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={formData.is_active}
                      onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <label htmlFor="is_active" className="text-sm text-gray-700">
                      Active
                    </label>
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                    >
                      <CheckIcon className="h-4 w-4" />
                      {editingId ? 'Update' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="mb-6">
            <div className="relative max-w-md">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="Search account heads..."
              />
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">#</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Account Head</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600 mx-auto"></div>
                    </td>
                  </tr>
                ) : filteredAccountHeads.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                      No account heads found
                    </td>
                  </tr>
                ) : (
                  filteredAccountHeads.map((item, index) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {index + 1}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {item.account_head_name}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          item.is_active !== false 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {item.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEdit(item)}
                            className="p-1 text-gray-400 hover:text-purple-600"
                            title="Edit"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="p-1 text-gray-400 hover:text-red-600"
                            title="Delete"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </AccessGuard>
  );
}
