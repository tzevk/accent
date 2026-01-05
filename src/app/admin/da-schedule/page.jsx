'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { InlineSpinner } from '@/components/LoadingSpinner';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

export default function DASchedulePage() {
  const router = useRouter();
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    da_amount: '',
    effective_from: new Date().toISOString().split('T')[0],
    effective_to: '',
    is_active: true
  });

  useEffect(() => {
    fetchSchedule();
  }, []);

  const fetchSchedule = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/payroll/da-schedule');
      const data = await res.json();
      if (data.success) {
        setSchedule(data.data || []);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to fetch DA schedule');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const res = await fetch('/api/payroll/da-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          da_amount: parseFloat(formData.da_amount),
          effective_to: formData.effective_to || null
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        setFormData({
          da_amount: '',
          effective_from: new Date().toISOString().split('T')[0],
          effective_to: '',
          is_active: true
        });
        setShowForm(false);
        fetchSchedule();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to save DA schedule');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this DA schedule entry?')) return;
    
    try {
      const res = await fetch(`/api/payroll/da-schedule?id=${id}`, {
        method: 'DELETE'
      });
      
      const data = await res.json();
      
      if (data.success) {
        fetchSchedule();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to delete DA schedule');
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
          {/* Header with Back Button */}
          <div className="mb-6">
            <div className="flex items-center gap-4 mb-3">
              <button
                onClick={() => router.push('/employees?tab=edit&subtab=salary')}
                className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors bg-white"
                title="Back to Salary Structure"
              >
                <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <nav className="text-xs text-gray-500 mb-1" aria-label="Breadcrumb">
                  <ol className="inline-flex items-center gap-2">
                    <li>Admin</li>
                    <li className="text-gray-300">/</li>
                    <li className="text-gray-700">DA Schedule</li>
                  </ol>
                </nav>
                <h1 className="text-3xl font-bold text-gray-900">DA Schedule Management</h1>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">Manage Dearness Allowance (DA) rates for different years</p>
              <button
                onClick={() => setShowForm(!showForm)}
                className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
              >
                {showForm ? 'Cancel' : '+ Add DA Rate'}
              </button>
            </div>
          </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Add Form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New DA Rate</h2>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">DA Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    value={formData.da_amount}
                    onChange={(e) => setFormData({ ...formData, da_amount: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="5000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Effective From *</label>
                  <input
                    type="date"
                    required
                    value={formData.effective_from}
                    onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Effective To (Optional)</label>
                  <input
                    type="date"
                    value={formData.effective_to}
                    onChange={(e) => setFormData({ ...formData, effective_to: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
              
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                />
                <label htmlFor="is_active" className="ml-2 text-sm text-gray-700">Active</label>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Save DA Rate
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* DA Schedule Table */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Current DA Schedule</h2>
          </div>
          
          {loading ? (
            <InlineSpinner message="Loading DA schedule..." />
          ) : schedule.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No DA schedule entries found. Add one to get started.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">DA Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Effective From</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Effective To</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Year</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {schedule.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">₹{parseFloat(entry.da_amount).toLocaleString('en-IN')}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{new Date(entry.effective_from).toLocaleDateString('en-IN')}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{entry.effective_to ? new Date(entry.effective_to).toLocaleDateString('en-IN') : 'Ongoing'}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{new Date(entry.effective_from).getFullYear()}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          entry.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {entry.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleDelete(entry.id)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">📋 How it works:</h3>
          <ul className="text-xs text-blue-800 space-y-1">
            <li>• DA rates are applied based on the year and effective date range</li>
            <li>• When calculating salary, the system fetches DA for the specified year</li>
            <li>• Only active DA entries are used in salary calculations</li>
            <li>• You can have multiple DA rates for different time periods</li>
          </ul>
        </div>
        </div>
      </div>
    </>
  );
}
