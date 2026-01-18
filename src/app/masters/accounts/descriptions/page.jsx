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
  DocumentTextIcon
} from '@heroicons/react/24/outline';

export default function DescriptionMasterPage() {
  const [descriptions, setDescriptions] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    description_name: '',
    is_active: true
  });

  // Fetch descriptions
  const fetchDescriptions = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/masters/descriptions');
      const data = await res.json();
      if (data.success) {
        setDescriptions(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch descriptions:', err);
      setError('Failed to load descriptions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDescriptions();
  }, []);

  // Filter descriptions
  const filteredDescriptions = descriptions.filter(desc => {
    if (!searchTerm) return true;
    return desc.description_name?.toLowerCase().includes(searchTerm.toLowerCase());
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
      description_name: '',
      is_active: true
    });
    setEditingId(null);
    setShowForm(false);
  };

  // Handle submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.description_name.trim()) {
      showError('Description name is required');
      return;
    }

    try {
      const url = editingId 
        ? `/api/masters/descriptions?id=${editingId}` 
        : '/api/masters/descriptions';
      
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (data.success) {
        showSuccess(editingId ? 'Description updated successfully' : 'Description created successfully');
        resetForm();
        fetchDescriptions();
      } else {
        showError(data.error || 'Failed to save description');
      }
    } catch (err) {
      console.error('Error saving description:', err);
      showError('Failed to save description');
    }
  };

  // Edit description
  const handleEdit = (desc) => {
    setFormData({
      description_name: desc.description_name || '',
      is_active: desc.is_active !== false
    });
    setEditingId(desc.id);
    setShowForm(true);
  };

  // Delete description
  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this description?')) return;

    try {
      const res = await fetch(`/api/masters/descriptions?id=${id}`, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (data.success) {
        showSuccess('Description deleted successfully');
        fetchDescriptions();
      } else {
        showError(data.error || 'Failed to delete description');
      }
    } catch (err) {
      console.error('Error deleting description:', err);
      showError('Failed to delete description');
    }
  };

  return (
    <AccessGuard resource="activities" permission="read">
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        
        <main className="max-w-10xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <DocumentTextIcon className="h-7 w-7 text-purple-600" />
                Description Master
              </h1>
              <p className="text-sm text-gray-500 mt-1">Manage descriptions for cash voucher line items</p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <PlusIcon className="h-5 w-5" />
              Add Description
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
                    {editingId ? 'Edit Description' : 'Add New Description'}
                  </h2>
                  <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description Name *
                    </label>
                    <input
                      type="text"
                      value={formData.description_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, description_name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="e.g., Travelling Expenses, Office Supplies"
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
                placeholder="Search descriptions..."
              />
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">#</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Description</th>
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
                ) : filteredDescriptions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                      No descriptions found
                    </td>
                  </tr>
                ) : (
                  filteredDescriptions.map((desc, index) => (
                    <tr key={desc.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {index + 1}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {desc.description_name}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          desc.is_active !== false 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {desc.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEdit(desc)}
                            className="p-1 text-gray-400 hover:text-purple-600"
                            title="Edit"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(desc.id)}
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
