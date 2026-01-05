'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { InlineSpinner } from '@/components/LoadingSpinner';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeftIcon, 
  CalendarDaysIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
  SparklesIcon,
  SunIcon,
  GlobeAltIcon,
  StarIcon
} from '@heroicons/react/24/outline';

export default function HolidayMasterPage() {
  const router = useRouter();
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'calendar'
  
  const [formData, setFormData] = useState({
    name: '',
    date: '',
    type: 'national',
    is_optional: false,
    description: '',
    is_active: true
  });

  const holidayTypes = [
    { value: 'national', label: 'National Holiday', icon: '🇮🇳', color: 'orange' },
    { value: 'religious', label: 'Religious Holiday', icon: '🙏', color: 'purple' },
    { value: 'regional', label: 'Regional Holiday', icon: '📍', color: 'blue' },
    { value: 'company', label: 'Company Holiday', icon: '🏢', color: 'green' },
    { value: 'optional', label: 'Optional Holiday', icon: '⭐', color: 'yellow' },
  ];

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  useEffect(() => {
    fetchHolidays();
  }, [selectedYear]);

  const fetchHolidays = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/masters/holidays?year=${selectedYear}`);
      const data = await res.json();
      if (data.success) {
        setHolidays(data.data || []);
      } else {
        // If no holidays table exists, initialize with empty array
        setHolidays([]);
      }
    } catch (err) {
      console.error('Error fetching holidays:', err);
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      const method = editingHoliday ? 'PUT' : 'POST';
      const body = editingHoliday 
        ? { ...formData, id: editingHoliday.id }
        : formData;
      
      const res = await fetch('/api/masters/holidays', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const data = await res.json();
      if (data.success) {
        setSuccess(editingHoliday ? 'Holiday updated successfully!' : 'Holiday added successfully!');
        setTimeout(() => setSuccess(''), 3000);
        setShowModal(false);
        resetForm();
        fetchHolidays();
      } else {
        setError(data.error || 'Failed to save holiday');
      }
    } catch (err) {
      setError('Failed to save holiday');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this holiday?')) return;
    
    try {
      const res = await fetch(`/api/masters/holidays?id=${id}`, {
        method: 'DELETE'
      });
      
      const data = await res.json();
      if (data.success) {
        setSuccess('Holiday deleted successfully!');
        setTimeout(() => setSuccess(''), 3000);
        fetchHolidays();
      } else {
        setError(data.error || 'Failed to delete holiday');
      }
    } catch (err) {
      setError('Failed to delete holiday');
    }
  };

  const handleEdit = (holiday) => {
    setEditingHoliday(holiday);
    setFormData({
      name: holiday.name,
      date: holiday.date?.split('T')[0] || holiday.date,
      type: holiday.type || 'national',
      is_optional: holiday.is_optional || false,
      description: holiday.description || '',
      is_active: holiday.is_active !== false
    });
    setShowModal(true);
  };

  const resetForm = () => {
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

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const getTypeInfo = (type) => {
    return holidayTypes.find(t => t.value === type) || holidayTypes[0];
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { 
      weekday: 'short',
      day: '2-digit', 
      month: 'short', 
      year: 'numeric' 
    });
  };

  const getDayName = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { weekday: 'long' });
  };

  // Group holidays by month
  const holidaysByMonth = holidays.reduce((acc, holiday) => {
    const month = new Date(holiday.date).toLocaleDateString('en-IN', { month: 'long' });
    if (!acc[month]) acc[month] = [];
    acc[month].push(holiday);
    return acc;
  }, {});

  // Stats
  const stats = {
    total: holidays.length,
    national: holidays.filter(h => h.type === 'national').length,
    optional: holidays.filter(h => h.is_optional).length,
    upcoming: holidays.filter(h => new Date(h.date) >= new Date()).length
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-purple-50/30">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/employees')}
            className="flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4 transition-colors group"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1.5 group-hover:-translate-x-1 transition-transform" />
            Back to Employees
          </button>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl shadow-lg shadow-orange-200">
                <CalendarDaysIcon className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Holiday Master</h1>
                <p className="text-sm text-gray-500 mt-0.5">Manage company holidays and leave calendar</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Year Selector */}
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white shadow-sm"
              >
                {years.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              
              {/* View Toggle */}
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                    viewMode === 'list' 
                      ? 'bg-white text-purple-700 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  List
                </button>
                <button
                  onClick={() => setViewMode('calendar')}
                  className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                    viewMode === 'calendar' 
                      ? 'bg-white text-purple-700 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Calendar
                </button>
              </div>
              
              <button
                onClick={openAddModal}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm font-medium rounded-lg hover:from-purple-700 hover:to-indigo-700 shadow-md hover:shadow-lg transition-all"
              >
                <PlusIcon className="w-4 h-4" />
                Add Holiday
              </button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <CalendarDaysIcon className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                <p className="text-xs text-gray-500">Total Holidays</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <GlobeAltIcon className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.national}</p>
                <p className="text-xs text-gray-500">National Holidays</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <StarIcon className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.optional}</p>
                <p className="text-xs text-gray-500">Optional Holidays</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <SparklesIcon className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.upcoming}</p>
                <p className="text-xs text-gray-500">Upcoming</p>
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
            <XMarkIcon className="w-5 h-5" />
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700 flex items-center gap-2">
            <CheckIcon className="w-5 h-5" />
            {success}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12">
            <InlineSpinner message="Loading holidays..." />
          </div>
        ) : holidays.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
            <CalendarDaysIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Holidays Found</h3>
            <p className="text-gray-500 mb-6">Start by adding holidays for {selectedYear}</p>
            <button
              onClick={openAddModal}
              className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <PlusIcon className="w-5 h-5" />
              Add First Holiday
            </button>
          </div>
        ) : viewMode === 'list' ? (
          /* List View */
          <div className="space-y-6">
            {Object.entries(holidaysByMonth).map(([month, monthHolidays]) => (
              <div key={month} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 px-6 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-purple-800">{month} {selectedYear}</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {monthHolidays.map((holiday) => {
                    const typeInfo = getTypeInfo(holiday.type);
                    const isPast = new Date(holiday.date) < new Date();
                    return (
                      <div 
                        key={holiday.id} 
                        className={`px-6 py-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors ${
                          isPast ? 'opacity-60' : ''
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center ${
                            holiday.type === 'national' ? 'bg-orange-100' :
                            holiday.type === 'religious' ? 'bg-purple-100' :
                            holiday.type === 'regional' ? 'bg-blue-100' :
                            holiday.type === 'company' ? 'bg-green-100' :
                            'bg-yellow-100'
                          }`}>
                            <span className="text-lg">{typeInfo.icon}</span>
                            <span className="text-[10px] font-medium text-gray-600">
                              {new Date(holiday.date).getDate()}
                            </span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold text-gray-900">{holiday.name}</h4>
                              {holiday.is_optional && (
                                <span className="px-2 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-700 rounded-full">
                                  Optional
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 mt-0.5">
                              {getDayName(holiday.date)}, {formatDate(holiday.date)}
                            </p>
                            {holiday.description && (
                              <p className="text-xs text-gray-400 mt-1">{holiday.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                            holiday.type === 'national' ? 'bg-orange-100 text-orange-700' :
                            holiday.type === 'religious' ? 'bg-purple-100 text-purple-700' :
                            holiday.type === 'regional' ? 'bg-blue-100 text-blue-700' :
                            holiday.type === 'company' ? 'bg-green-100 text-green-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {typeInfo.label}
                          </span>
                          <button
                            onClick={() => handleEdit(holiday)}
                            className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                          >
                            <PencilSquareIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(holiday.id)}
                            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Calendar View */
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="grid grid-cols-4 gap-4">
              {Array.from({ length: 12 }, (_, i) => {
                const monthDate = new Date(selectedYear, i, 1);
                const monthName = monthDate.toLocaleDateString('en-IN', { month: 'short' });
                const monthHolidays = holidays.filter(h => {
                  const hDate = new Date(h.date);
                  return hDate.getMonth() === i;
                });
                
                return (
                  <div key={i} className="border border-gray-100 rounded-lg p-3 hover:border-purple-200 hover:shadow-sm transition-all">
                    <h4 className="font-semibold text-gray-900 mb-2 text-sm">{monthName}</h4>
                    {monthHolidays.length === 0 ? (
                      <p className="text-xs text-gray-400">No holidays</p>
                    ) : (
                      <div className="space-y-1">
                        {monthHolidays.slice(0, 3).map(h => {
                          const typeInfo = getTypeInfo(h.type);
                          return (
                            <div key={h.id} className="flex items-center gap-1.5 text-xs">
                              <span>{typeInfo.icon}</span>
                              <span className="truncate text-gray-700">{new Date(h.date).getDate()} - {h.name}</span>
                            </div>
                          );
                        })}
                        {monthHolidays.length > 3 && (
                          <p className="text-xs text-purple-600">+{monthHolidays.length - 3} more</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div 
              className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
              onClick={() => setShowModal(false)}
            />
            
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md transform transition-all">
              {/* Header */}
              <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4 rounded-t-2xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">
                    {editingHoliday ? 'Edit Holiday' : 'Add New Holiday'}
                  </h3>
                  <button 
                    onClick={() => setShowModal(false)}
                    className="text-white/80 hover:text-white transition-colors"
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>
              </div>
              
              {/* Form */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Holiday Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    placeholder="e.g., Republic Day"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    required
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Holiday Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {holidayTypes.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, type: type.value })}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-sm ${
                          formData.type === type.value
                            ? 'border-purple-500 bg-purple-50 text-purple-700'
                            : 'border-gray-200 hover:border-purple-200 text-gray-700'
                        }`}
                      >
                        <span>{type.icon}</span>
                        <span className="text-xs">{type.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Optional description..."
                    rows={2}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_optional}
                      onChange={(e) => setFormData({ ...formData, is_optional: e.target.checked })}
                      className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-700">Optional Holiday</span>
                  </label>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 text-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all"
                  >
                    {editingHoliday ? 'Update Holiday' : 'Add Holiday'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
