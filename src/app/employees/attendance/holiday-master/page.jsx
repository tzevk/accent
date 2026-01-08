'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { 
  ArrowLeftIcon, 
  CalendarDaysIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

const HOLIDAY_TYPES = [
  { value: 'national', label: 'National', color: 'bg-blue-100 text-blue-800' },
  { value: 'religious', label: 'Religious', color: 'bg-purple-100 text-purple-800' },
  { value: 'regional', label: 'Regional', color: 'bg-green-100 text-green-800' },
  { value: 'company', label: 'Company', color: 'bg-orange-100 text-orange-800' },
  { value: 'optional', label: 'Optional', color: 'bg-gray-100 text-gray-800' }
];

const getTypeStyle = (type) => {
  const found = HOLIDAY_TYPES.find(t => t.value === type);
  return found ? found.color : 'bg-gray-100 text-gray-800';
};

export default function HolidayMasterPage() {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Filter state
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedType, setSelectedType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [includeOptional, setIncludeOptional] = useState(true);
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    date: '',
    type: 'national',
    is_optional: false,
    description: '',
    is_active: true
  });
  const [saving, setSaving] = useState(false);
  
  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Generate year options (5 years back and 5 years ahead)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);

  // Fetch holidays
  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        year: selectedYear.toString(),
        include_optional: includeOptional.toString()
      });
      if (selectedType) {
        params.append('type', selectedType);
      }
      
      const res = await fetch(`/api/masters/holidays?${params.toString()}`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to fetch holidays');
      
      setHolidays(data.data || []);
    } catch (err) {
      console.error('Error fetching holidays:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedType, includeOptional]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  // Filter holidays by search query
  const filteredHolidays = holidays.filter(holiday => 
    holiday.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    holiday.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group holidays by month
  const groupedByMonth = filteredHolidays.reduce((acc, holiday) => {
    const month = new Date(holiday.date).toLocaleDateString('en-US', { month: 'long' });
    if (!acc[month]) acc[month] = [];
    acc[month].push(holiday);
    return acc;
  }, {});

  // Open modal for adding/editing
  const openModal = (holiday = null) => {
    if (holiday) {
      setEditingHoliday(holiday);
      setFormData({
        name: holiday.name,
        date: holiday.date.split('T')[0],
        type: holiday.type,
        is_optional: holiday.is_optional,
        description: holiday.description || '',
        is_active: holiday.is_active
      });
    } else {
      setEditingHoliday(null);
      setFormData({
        name: '',
        date: '',
        type: 'national',
        is_optional: false,
        description: '',
        is_active: true
      });
    }
    setShowModal(true);
  };

  // Close modal
  const closeModal = () => {
    setShowModal(false);
    setEditingHoliday(null);
    setFormData({
      name: '',
      date: '',
      type: 'national',
      is_optional: false,
      description: '',
      is_active: true
    });
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    
    try {
      const url = '/api/masters/holidays';
      const method = editingHoliday ? 'PUT' : 'POST';
      const body = editingHoliday 
        ? { ...formData, id: editingHoliday.id }
        : formData;
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to save holiday');
      
      setSuccess(editingHoliday ? 'Holiday updated successfully' : 'Holiday added successfully');
      closeModal();
      fetchHolidays();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error saving holiday:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async (id) => {
    try {
      const res = await fetch(`/api/masters/holidays?id=${id}`, {
        method: 'DELETE'
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to delete holiday');
      
      setSuccess('Holiday deleted successfully');
      setDeleteConfirm(null);
      fetchHolidays();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error deleting holiday:', err);
      setError(err.message);
    }
  };

  // Format date for display
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      day: 'numeric', 
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <div className="h-screen overflow-hidden bg-gray-50">
      <Navbar />
      
      {/* Main Content Area with proper spacing for navbar */}
      <div className="h-full pt-16 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 flex-shrink-0">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link 
                  href="/employees/attendance"
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
                </Link>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <CalendarDaysIcon className="h-7 w-7 text-orange-600" />
                    Holiday Master
                  </h1>
                  <p className="text-sm text-gray-500 mt-1">
                    Manage company holidays and observances
                  </p>
                </div>
              </div>
              
              <button
                onClick={() => openModal()}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#64126D] to-[#86288F] text-white rounded-lg hover:from-[#86288F] hover:to-[#64126D] transition-all"
              >
                <PlusIcon className="h-5 w-5" />
                Add Holiday
              </button>
            </div>
          </div>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mx-6 mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex-shrink-0 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')}>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        )}
        {success && (
          <div className="mx-6 mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 flex-shrink-0 flex items-center justify-between">
            <span>{success}</span>
            <button onClick={() => setSuccess('')}>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="px-6 py-4 flex-shrink-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search holidays..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>
            
            {/* Year Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Year:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                {yearOptions.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            
            {/* Type Filter */}
            <div className="flex items-center gap-2">
              <FunnelIcon className="h-5 w-5 text-gray-400" />
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="">All Types</option>
                {HOLIDAY_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            
            {/* Include Optional */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeOptional}
                onChange={(e) => setIncludeOptional(e.target.checked)}
                className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
              />
              <span className="text-sm text-gray-600">Include Optional</span>
            </label>
            
            {/* Refresh */}
            <button
              onClick={fetchHolidays}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <ArrowPathIcon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="px-6 py-4 flex-shrink-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-gray-900">{filteredHolidays.length}</div>
              <div className="text-sm text-gray-600">Total Holidays</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-blue-600">
                {filteredHolidays.filter(h => h.type === 'national').length}
              </div>
              <div className="text-sm text-gray-600">National Holidays</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-orange-600">
                {filteredHolidays.filter(h => h.type === 'company').length}
              </div>
              <div className="text-sm text-gray-600">Company Holidays</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-gray-600">
                {filteredHolidays.filter(h => h.is_optional).length}
              </div>
              <div className="text-sm text-gray-600">Optional Holidays</div>
            </div>
          </div>
        </div>

        {/* Holiday List */}
        <div className="px-6 pb-6 flex-1 overflow-auto min-h-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                <span className="ml-3 text-gray-600">Loading holidays...</span>
              </div>
            ) : filteredHolidays.length === 0 ? (
              <div className="text-center py-12">
                <CalendarDaysIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No holidays found for {selectedYear}</p>
                <button
                  onClick={() => openModal()}
                className="mt-4 text-purple-600 hover:text-purple-700 font-medium"
              >
                Add your first holiday
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {Object.entries(groupedByMonth).map(([month, monthHolidays]) => (
                <div key={month}>
                  {/* Month Header */}
                  <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
                    <h3 className="font-semibold text-gray-900">{month} {selectedYear}</h3>
                    <p className="text-sm text-gray-500">{monthHolidays.length} holiday(s)</p>
                  </div>
                  
                  {/* Month Holidays */}
                  {monthHolidays.map((holiday) => (
                    <div 
                      key={holiday.id}
                      className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        {/* Date Badge */}
                        <div className="w-16 h-16 bg-purple-50 rounded-lg flex flex-col items-center justify-center">
                          <span className="text-xs text-purple-600 font-medium">
                            {new Date(holiday.date).toLocaleDateString('en-US', { weekday: 'short' })}
                          </span>
                          <span className="text-2xl font-bold text-purple-700">
                            {new Date(holiday.date).getDate()}
                          </span>
                        </div>
                        
                        {/* Holiday Info */}
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-gray-900">{holiday.name}</h4>
                            {holiday.is_optional && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                                Optional
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getTypeStyle(holiday.type)}`}>
                              {HOLIDAY_TYPES.find(t => t.value === holiday.type)?.label || holiday.type}
                            </span>
                            <span className="text-sm text-gray-500">{formatDate(holiday.date)}</span>
                          </div>
                          {holiday.description && (
                            <p className="text-sm text-gray-500 mt-1">{holiday.description}</p>
                          )}
                        </div>
                      </div>
                      
                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openModal(holiday)}
                          className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(holiday)}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingHoliday ? 'Edit Holiday' : 'Add Holiday'}
              </h2>
              <button 
                onClick={closeModal}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Holiday Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="e.g., Republic Day"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              
              {/* Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              
              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  {HOLIDAY_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              
              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  placeholder="Optional description..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              
              {/* Checkboxes */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_optional}
                    onChange={(e) => setFormData({ ...formData, is_optional: e.target.checked })}
                    className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                  />
                  <span className="text-sm text-gray-700">Optional Holiday</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                  />
                  <span className="text-sm text-gray-700">Active</span>
                </label>
              </div>
              
              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckIcon className="h-4 w-4" />
                      {editingHoliday ? 'Update' : 'Add'} Holiday
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Holiday?</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete &quot;{deleteConfirm.name}&quot;? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
