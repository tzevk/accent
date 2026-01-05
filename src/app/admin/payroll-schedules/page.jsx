'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { InlineSpinner } from '@/components/LoadingSpinner';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

export default function PayrollSchedulesPage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [formData, setFormData] = useState({
    component_type: 'pf_employee',
    value_type: 'percentage',
    value: '',
    effective_from: new Date().toISOString().split('T')[0],
    effective_to: '',
    min_salary: '',
    max_salary: '',
    is_active: true,
    remarks: ''
  });

  const componentCategories = {
    statutory: {
      label: 'Statutory Contributions',
      icon: '⚖️',
      components: [
        { value: 'pf_employee', label: 'PF Employee', type: 'percentage', suffix: '%' },
        { value: 'pf_employer', label: 'PF Employer', type: 'percentage', suffix: '%' },
        { value: 'esic_employee', label: 'ESIC Employee', type: 'percentage', suffix: '%' },
        { value: 'esic_employer', label: 'ESIC Employer', type: 'percentage', suffix: '%' },
        { value: 'pt', label: 'Professional Tax', type: 'fixed', suffix: '₹', hasSlab: true },
        { value: 'mlwf', label: 'MLWF', type: 'fixed', suffix: '₹' },
        { value: 'tds', label: 'TDS', type: 'percentage', suffix: '%' },
      ]
    },
    insurance: {
      label: 'Insurance & Benefits',
      icon: '🛡️',
      components: [
        { value: 'insurance', label: 'Insurance', type: 'fixed', suffix: '₹' },
        { value: 'personal_accident', label: 'Personal Accident', type: 'fixed', suffix: '₹' },
        { value: 'mediclaim', label: 'Mediclaim', type: 'fixed', suffix: '₹' },
      ]
    },
    others: {
      label: 'Others',
      icon: '📋',
      components: [
        { value: 'bonus', label: 'Bonus', type: 'percentage', suffix: '%' },
        { value: 'leaves', label: 'Leaves', type: 'fixed', suffix: 'days' },
      ]
    }
  };

  const getAllComponents = () => {
    return Object.values(componentCategories).flatMap(cat => cat.components);
  };

  const getFilteredSchedules = () => {
    if (selectedCategory === 'all') return schedules;
    const categoryComponents = componentCategories[selectedCategory].components.map(c => c.value);
    return schedules.filter(s => categoryComponents.includes(s.component_type));
  };

  useEffect(() => {
    fetchSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSchedules = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/payroll/schedules');
      const data = await res.json();
      if (data.success) {
        setSchedules(data.data || []);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to fetch payroll schedules');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const res = await fetch('/api/payroll/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          min_salary: formData.min_salary ? parseFloat(formData.min_salary) : null,
          max_salary: formData.max_salary ? parseFloat(formData.max_salary) : null,
          effective_to: formData.effective_to || null
        })
      });
      
      const data = await res.json();
      if (data.success) {
        setShowForm(false);
        setFormData({
          component_type: 'pf_employee',
          value_type: 'percentage',
          value: '',
          effective_from: new Date().toISOString().split('T')[0],
          effective_to: '',
          min_salary: '',
          max_salary: '',
          is_active: true,
          remarks: ''
        });
        fetchSchedules();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to add schedule');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this schedule?')) return;
    
    try {
      const res = await fetch(`/api/payroll/schedules?id=${id}`, {
        method: 'DELETE'
      });
      
      const data = await res.json();
      if (data.success) {
        fetchSchedules();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to delete schedule');
    }
  };

  const handleComponentChange = (e) => {
    const allComponents = getAllComponents();
    const component = allComponents.find(c => c.value === e.target.value);
    setFormData({
      ...formData,
      component_type: e.target.value,
      value_type: component?.type || 'percentage'
    });
  };

  const getComponentLabel = (type) => {
    const allComponents = getAllComponents();
    return allComponents.find(c => c.value === type)?.label || type;
  };

  const selectedComponentInfo = getAllComponents().find(c => c.value === formData.component_type);
  const filteredSchedules = getFilteredSchedules();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-4">
          <button
            onClick={() => router.push('/employees')}
            className="flex items-center text-sm text-gray-600 hover:text-gray-900 mb-3 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            Back
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Payroll Schedules</h1>
              <p className="text-sm text-gray-500 mt-0.5">Manage all payroll component rates</p>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              {showForm ? 'Cancel' : '+ Add'}
            </button>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 text-sm rounded whitespace-nowrap ${
              selectedCategory === 'all'
                ? 'bg-purple-600 text-white'
                : 'bg-white text-gray-700 border hover:bg-gray-50'
            }`}
          >
            All
          </button>
          {Object.entries(componentCategories).map(([key, cat]) => (
            <button
              key={key}
              onClick={() => setSelectedCategory(key)}
              className={`px-3 py-1.5 text-sm rounded whitespace-nowrap flex items-center gap-1.5 ${
                selectedCategory === key
                  ? 'bg-purple-600 text-white'
                  : 'bg-white text-gray-700 border hover:bg-gray-50'
              }`}
            >
              <span>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2 mb-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Add Form */}
        {showForm && (
          <div className="bg-white rounded border shadow-sm p-4 mb-4">
            <h3 className="text-sm font-semibold mb-3">Add New Schedule</h3>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Component *</label>
                  <select
                    value={formData.component_type}
                    onChange={handleComponentChange}
                    required
                    className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                  >
                    {Object.entries(componentCategories).map(([catKey, cat]) => (
                      <optgroup key={catKey} label={cat.label}>
                        {cat.components.map(comp => (
                          <option key={comp.value} value={comp.value}>{comp.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Value * {selectedComponentInfo?.suffix}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                    required
                    className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Effective From *</label>
                  <input
                    type="date"
                    value={formData.effective_from}
                    onChange={(e) => setFormData({ ...formData, effective_from: e.target.value })}
                    required
                    className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Effective To</label>
                  <input
                    type="date"
                    value={formData.effective_to}
                    onChange={(e) => setFormData({ ...formData, effective_to: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>

                {selectedComponentInfo?.hasSlab && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Min Salary</label>
                      <input
                        type="number"
                        value={formData.min_salary}
                        onChange={(e) => setFormData({ ...formData, min_salary: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Max Salary</label>
                      <input
                        type="number"
                        value={formData.max_salary}
                        onChange={(e) => setFormData({ ...formData, max_salary: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Schedules List */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {loading ? (
            <InlineSpinner message="Loading schedules..." />
          ) : filteredSchedules.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No schedules found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Component</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Value</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Effective From</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Effective To</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Salary Range</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSchedules.map((schedule, index) => (
                    <tr 
                      key={schedule.id} 
                      className={`transition-colors duration-150 hover:bg-purple-50/50 ${
                        index % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
                      }`}
                    >
                      <td className="px-4 py-3.5 text-sm font-semibold text-gray-900">
                        {getComponentLabel(schedule.component_type)}
                      </td>
                      <td className="px-4 py-3.5 text-sm font-medium text-purple-700">
                        {schedule.value_type === 'percentage' 
                          ? `${schedule.value}%` 
                          : `₹${parseFloat(schedule.value).toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-gray-700">
                        {new Date(schedule.effective_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-gray-700">
                        {schedule.effective_to ? new Date(schedule.effective_to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-gray-700">
                        {schedule.min_salary && schedule.max_salary
                          ? `₹${parseFloat(schedule.min_salary).toLocaleString('en-IN')} - ₹${parseFloat(schedule.max_salary).toLocaleString('en-IN')}`
                          : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${
                          schedule.is_active 
                            ? 'bg-green-100 text-green-800 ring-1 ring-green-600/20' 
                            : 'bg-gray-100 text-gray-700 ring-1 ring-gray-600/20'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                            schedule.is_active ? 'bg-green-600' : 'bg-gray-500'
                          }`}></span>
                          {schedule.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <button
                          onClick={() => handleDelete(schedule.id)}
                          className="text-xs font-medium text-red-600 hover:text-white hover:bg-red-600 px-3 py-1.5 rounded transition-all duration-150 border border-transparent hover:border-red-600"
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
      </div>
    </div>
  );
}
