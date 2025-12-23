'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import {
  CurrencyDollarIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  CheckIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

export default function SalaryMasterPage() {
  const [salaryStructures, setSalaryStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const defaultFormData = {
    name: '',
    description: '',
    basic_salary: '',
    da: '',
    hra: '',
    conveyance_allowance: '',
    medical_allowance: '',
    special_allowance: '',
    call_allowance: '',
    other_allowance: '',
    pf_percentage: '12',
    esi_percentage: '0.75',
    professional_tax: '200',
    mlwf_employee: '5',
    mlwf_employer: '13',
    tds_percentage: '0',
    mediclaim: '0',
    employer_pf_percentage: '12',
    bonus_percentage: '8.33',
    gratuity_percentage: '4.81',
    annual_leaves: '21',
    casual_leaves: '7',
    sick_leaves: '7',
    ot_rate_per_hour: '',
    is_active: true,
  };

  const [formData, setFormData] = useState(defaultFormData);

  // Fetch salary structures
  const fetchSalaryStructures = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/salary-master');
      const data = await response.json();

      if (data.success) {
        setSalaryStructures(data.data || []);
      } else {
        setError(data.error || 'Failed to fetch salary structures');
      }
    } catch (err) {
      console.error('Error fetching salary structures:', err);
      setError('Failed to fetch salary structures');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSalaryStructures();
  }, []);

  // Calculate gross salary
  const calculateGross = (data) => {
    return (
      parseFloat(data.basic_salary || 0) +
      parseFloat(data.da || 0) +
      parseFloat(data.hra || 0) +
      parseFloat(data.conveyance_allowance || 0) +
      parseFloat(data.medical_allowance || 0) +
      parseFloat(data.special_allowance || 0) +
      parseFloat(data.call_allowance || 0) +
      parseFloat(data.other_allowance || 0)
    );
  };

  // Handle form input change
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  // Handle form submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    try {
      const url = editingId 
        ? `/api/salary-master?id=${editingId}` 
        : '/api/salary-master';
      
      const method = editingId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          gross_salary: calculateGross(formData)
        })
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage(editingId ? 'Salary structure updated!' : 'Salary structure created!');
        setShowForm(false);
        setEditingId(null);
        setFormData(defaultFormData);
        fetchSalaryStructures();
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch (err) {
      console.error('Error saving:', err);
      setError('Failed to save salary structure');
    }
  };

  // Handle edit
  const handleEdit = (structure) => {
    setFormData({
      name: structure.name || '',
      description: structure.description || '',
      basic_salary: structure.basic_salary || '',
      da: structure.da || '',
      hra: structure.hra || '',
      conveyance_allowance: structure.conveyance_allowance || '',
      medical_allowance: structure.medical_allowance || '',
      special_allowance: structure.special_allowance || '',
      call_allowance: structure.call_allowance || '',
      other_allowance: structure.other_allowance || '',
      pf_percentage: structure.pf_percentage || '12',
      esi_percentage: structure.esi_percentage || '0.75',
      professional_tax: structure.professional_tax || '200',
      mlwf_employee: structure.mlwf_employee || '5',
      mlwf_employer: structure.mlwf_employer || '13',
      tds_percentage: structure.tds_percentage || '0',
      mediclaim: structure.mediclaim || '0',
      employer_pf_percentage: structure.employer_pf_percentage || '12',
      bonus_percentage: structure.bonus_percentage || '8.33',
      gratuity_percentage: structure.gratuity_percentage || '4.81',
      annual_leaves: structure.annual_leaves || '21',
      casual_leaves: structure.casual_leaves || '7',
      sick_leaves: structure.sick_leaves || '7',
      ot_rate_per_hour: structure.ot_rate_per_hour || '',
      is_active: structure.is_active ?? true,
    });
    setEditingId(structure.id);
    setShowForm(true);
  };

  // Handle delete
  const handleDelete = async (id) => {
    try {
      const response = await fetch(`/api/salary-master?id=${id}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage('Salary structure deleted!');
        setDeleteConfirm(null);
        fetchSalaryStructures();
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setError(data.error || 'Failed to delete');
      }
    } catch (err) {
      console.error('Error deleting:', err);
      setError('Failed to delete salary structure');
    }
  };

  // Filter structures by search
  const filteredStructures = salaryStructures.filter(s =>
    s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Format currency
  const formatCurrency = (value) => {
    if (!value) return '₹0';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(value);
  };

  return (
    <AccessGuard resource="employees" permission="read">
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
          {/* Header */}
          <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <nav className="text-xs text-gray-500 mb-1" aria-label="Breadcrumb">
                <ol className="inline-flex items-center gap-2">
                  <li>Masters</li>
                  <li className="text-gray-300">/</li>
                  <li className="text-gray-700">Salary Master</li>
                </ol>
              </nav>
              <h1 className="text-3xl font-bold text-gray-900">Salary Master</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setFormData(defaultFormData);
                  setEditingId(null);
                  setShowForm(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-[#64126D] text-white text-sm px-3.5 py-2 shadow-sm hover:bg-[#5a1161]"
              >
                <PlusIcon className="h-4 w-4" />
                Add Salary Structure
              </button>
            </div>
          </div>

          {/* Messages */}
          {successMessage && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 text-green-700">
              <CheckIcon className="h-5 w-5" />
              {successMessage}
            </div>
          )}

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-red-700">
              <ExclamationTriangleIcon className="h-5 w-5" />
              {error}
              <button onClick={() => setError('')} className="ml-auto">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* Search */}
          <div className="mb-6">
            <div className="relative max-w-md">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search salary structures..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-purple-200 rounded-xl focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
              />
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading...</div>
            ) : filteredStructures.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No salary structures found
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-purple-50 border-b border-purple-200">
                  <tr>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-gray-700">Name</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-gray-700">Basic</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-gray-700">HRA</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-gray-700">Gross</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-gray-700">PF %</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-gray-700">Status</th>
                    <th className="text-right px-6 py-4 text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-100">
                  {filteredStructures.map((structure) => (
                    <tr key={structure.id} className="hover:bg-purple-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <div className="font-medium text-gray-900">{structure.name}</div>
                          {structure.description && (
                            <div className="text-sm text-gray-500 truncate max-w-xs">{structure.description}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">{formatCurrency(structure.basic_salary)}</td>
                      <td className="px-6 py-4 text-gray-700">{formatCurrency(structure.hra)}</td>
                      <td className="px-6 py-4 font-semibold text-gray-900">{formatCurrency(structure.gross_salary)}</td>
                      <td className="px-6 py-4 text-gray-700">{structure.pf_percentage}%</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          structure.is_active 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {structure.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEdit(structure)}
                            className="p-2 text-gray-500 hover:text-[#7F2487] hover:bg-purple-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(structure.id)}
                            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Delete Confirmation Modal */}
          {deleteConfirm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Salary Structure?</h3>
                <p className="text-gray-600 mb-6">
                  Are you sure you want to delete this salary structure? This action cannot be undone.
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDelete(deleteConfirm)}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add/Edit Form Modal */}
          {showForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8">
              <div className="bg-white rounded-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {editingId ? 'Edit Salary Structure' : 'Add Salary Structure'}
                  </h2>
                  <button
                    onClick={() => {
                      setShowForm(false);
                      setEditingId(null);
                      setFormData(defaultFormData);
                    }}
                    className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                  {/* Basic Info */}
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#7F2487]"></span>
                      Basic Information
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Structure Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          name="name"
                          value={formData.name}
                          onChange={handleInputChange}
                          required
                          placeholder="e.g., Junior Developer, Senior Manager"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <input
                          type="text"
                          name="description"
                          value={formData.description}
                          onChange={handleInputChange}
                          placeholder="Brief description"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Earnings */}
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      Earnings
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Basic Salary</label>
                        <input
                          type="number"
                          name="basic_salary"
                          value={formData.basic_salary}
                          onChange={handleInputChange}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">DA</label>
                        <input
                          type="number"
                          name="da"
                          value={formData.da}
                          onChange={handleInputChange}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">HRA</label>
                        <input
                          type="number"
                          name="hra"
                          value={formData.hra}
                          onChange={handleInputChange}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Conveyance</label>
                        <input
                          type="number"
                          name="conveyance_allowance"
                          value={formData.conveyance_allowance}
                          onChange={handleInputChange}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Medical</label>
                        <input
                          type="number"
                          name="medical_allowance"
                          value={formData.medical_allowance}
                          onChange={handleInputChange}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Special Allowance</label>
                        <input
                          type="number"
                          name="special_allowance"
                          value={formData.special_allowance}
                          onChange={handleInputChange}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Call Allowance</label>
                        <input
                          type="number"
                          name="call_allowance"
                          value={formData.call_allowance}
                          onChange={handleInputChange}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Other Allowance</label>
                        <input
                          type="number"
                          name="other_allowance"
                          value={formData.other_allowance}
                          onChange={handleInputChange}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                    </div>
                    <div className="mt-4 p-3 bg-green-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-green-700">Calculated Gross Salary:</span>
                        <span className="text-lg font-bold text-green-700">
                          {formatCurrency(calculateGross(formData))}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Deductions & Percentages */}
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500"></span>
                      Deductions & Statutory Percentages
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">PF %</label>
                        <input
                          type="number"
                          step="0.01"
                          name="pf_percentage"
                          value={formData.pf_percentage}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">ESI %</label>
                        <input
                          type="number"
                          step="0.01"
                          name="esi_percentage"
                          value={formData.esi_percentage}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Professional Tax</label>
                        <input
                          type="number"
                          name="professional_tax"
                          value={formData.professional_tax}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">TDS %</label>
                        <input
                          type="number"
                          step="0.01"
                          name="tds_percentage"
                          value={formData.tds_percentage}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">MLWF (Employee)</label>
                        <input
                          type="number"
                          name="mlwf_employee"
                          value={formData.mlwf_employee}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">MLWF (Employer)</label>
                        <input
                          type="number"
                          name="mlwf_employer"
                          value={formData.mlwf_employer}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Mediclaim</label>
                        <input
                          type="number"
                          name="mediclaim"
                          value={formData.mediclaim}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">OT Rate/Hour</label>
                        <input
                          type="number"
                          name="ot_rate_per_hour"
                          value={formData.ot_rate_per_hour}
                          onChange={handleInputChange}
                          placeholder="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Employer Contributions */}
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                      Employer Contributions
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Employer PF %</label>
                        <input
                          type="number"
                          step="0.01"
                          name="employer_pf_percentage"
                          value={formData.employer_pf_percentage}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Bonus %</label>
                        <input
                          type="number"
                          step="0.01"
                          name="bonus_percentage"
                          value={formData.bonus_percentage}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gratuity %</label>
                        <input
                          type="number"
                          step="0.01"
                          name="gratuity_percentage"
                          value={formData.gratuity_percentage}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Leave Policy */}
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      Leave Policy
                    </h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Annual Leaves</label>
                        <input
                          type="number"
                          name="annual_leaves"
                          value={formData.annual_leaves}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Casual Leaves</label>
                        <input
                          type="number"
                          name="casual_leaves"
                          value={formData.casual_leaves}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Sick Leaves</label>
                        <input
                          type="number"
                          name="sick_leaves"
                          value={formData.sick_leaves}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#7F2487] focus:border-[#7F2487]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="mb-6">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="is_active"
                        checked={formData.is_active}
                        onChange={handleInputChange}
                        className="w-4 h-4 text-[#7F2487] rounded focus:ring-[#7F2487]"
                      />
                      <span className="text-sm font-medium text-gray-700">Active</span>
                    </label>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setEditingId(null);
                        setFormData(defaultFormData);
                      }}
                      className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2 bg-gradient-to-r from-[#7F2487] to-[#64126D] text-white rounded-lg hover:opacity-90"
                    >
                      {editingId ? 'Update' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </AccessGuard>
  );
}
