'use client';

import { useState, useEffect, useMemo } from 'react';
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
  ChevronLeftIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';

const HOLIDAY_TYPES = {
  national: { label: 'National', icon: '🇮🇳', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  religious: { label: 'Religious', icon: '🙏', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  regional: { label: 'Regional', icon: '📍', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  company: { label: 'Company', icon: '🏢', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  optional: { label: 'Optional', icon: '⭐', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function HolidayMasterPage() {
  const router = useRouter();
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [filterType, setFilterType] = useState('all');
  const [focusedMonth, setFocusedMonth] = useState(new Date().getMonth());
  
  const [formData, setFormData] = useState({
    name: '',
    date: '',
    type: 'national',
    is_optional: false,
    description: '',
    is_active: true
  });

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
        setHolidays([]);
      }
    } catch (err) {
      console.error('Error fetching holidays:', err);
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  };

  // Filter holidays
  const filteredHolidays = useMemo(() => {
    if (filterType === 'all') return holidays;
    return holidays.filter(h => h.type === filterType);
  }, [holidays, filterType]);

  // Group by month
  const holidaysByMonth = useMemo(() => {
    const grouped = {};
    MONTHS.forEach((m, i) => grouped[i] = []);
    filteredHolidays.forEach(h => {
      const monthIdx = new Date(h.date).getMonth();
      grouped[monthIdx].push(h);
    });
    return grouped;
  }, [filteredHolidays]);

  // Stats
  const stats = useMemo(() => ({
    total: holidays.length,
    national: holidays.filter(h => h.type === 'national').length,
    religious: holidays.filter(h => h.type === 'religious').length,
    regional: holidays.filter(h => h.type === 'regional').length,
    optional: holidays.filter(h => h.is_optional).length,
    upcoming: holidays.filter(h => new Date(h.date) >= new Date()).length
  }), [holidays]);

  // Calendar data for focused month
  const calendarDays = useMemo(() => {
    const firstDay = new Date(selectedYear, focusedMonth, 1);
    const lastDay = new Date(selectedYear, focusedMonth + 1, 0);
    const startPad = firstDay.getDay(); // 0 = Sunday
    const totalDays = lastDay.getDate();
    
    const days = [];
    // Padding for start
    for (let i = 0; i < startPad; i++) days.push(null);
    // Actual days
    for (let d = 1; d <= totalDays; d++) days.push(d);
    
    return days;
  }, [selectedYear, focusedMonth]);

  const getHolidayOnDate = (day) => {
    if (!day) return null;
    const dateStr = `${selectedYear}-${String(focusedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return holidays.find(h => h.date.split('T')[0] === dateStr);
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
        setSuccess(editingHoliday ? 'Holiday updated!' : 'Holiday added!');
        setTimeout(() => setSuccess(''), 3000);
        setShowModal(false);
        resetForm();
        fetchHolidays();
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Failed to save holiday');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this holiday?')) return;
    
    try {
      const res = await fetch(`/api/masters/holidays?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setSuccess('Holiday deleted!');
        setTimeout(() => setSuccess(''), 3000);
        fetchHolidays();
      } else {
        setError(data.error || 'Failed to delete');
      }
    } catch {
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
    setFormData({ name: '', date: '', type: 'national', is_optional: false, description: '', is_active: true });
  };

  const openAddModal = () => { resetForm(); setShowModal(true); };

  const isToday = (day) => {
    const today = new Date();
    return day === today.getDate() && focusedMonth === today.getMonth() && selectedYear === today.getFullYear();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/employees')} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
              <ArrowLeftIcon className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Holiday Calendar {selectedYear}</h1>
              <p className="text-sm text-gray-500">{stats.total} holidays • {stats.upcoming} upcoming</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
            >
              {[2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={openAddModal} className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
              <PlusIcon className="w-4 h-4" />
              Add Holiday
            </button>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
            <XMarkIcon className="w-4 h-4" />
            {error}
            <button onClick={() => setError('')} className="ml-auto"><XMarkIcon className="w-4 h-4" /></button>
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm flex items-center gap-2">
            <CheckIcon className="w-4 h-4" />
            {success}
          </div>
        )}

        {/* Type Stats Bar */}
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-all ${
              filterType === 'all' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            All ({stats.total})
          </button>
          {Object.entries(HOLIDAY_TYPES).map(([key, type]) => {
            const count = holidays.filter(h => h.type === key).length;
            return (
              <button
                key={key}
                onClick={() => setFilterType(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-all flex items-center gap-1.5 ${
                  filterType === key 
                    ? `${type.bg} ${type.text} border ${type.border}` 
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>{type.icon}</span>
                {type.label} ({count})
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12">
            <InlineSpinner message="Loading holidays..." />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Calendar */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Month Navigator */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <button onClick={() => setFocusedMonth(m => m > 0 ? m - 1 : 11)} className="p-1.5 hover:bg-gray-200 rounded-lg">
                    <ChevronLeftIcon className="w-5 h-5 text-gray-600" />
                  </button>
                  <h3 className="text-sm font-semibold text-gray-900">{MONTHS[focusedMonth]} {selectedYear}</h3>
                  <button onClick={() => setFocusedMonth(m => m < 11 ? m + 1 : 0)} className="p-1.5 hover:bg-gray-200 rounded-lg">
                    <ChevronRightIcon className="w-5 h-5 text-gray-600" />
                  </button>
                </div>
                
                {/* Calendar Grid */}
                <div className="p-4">
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                      <div key={d} className="text-center text-[10px] font-semibold text-gray-400 uppercase py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((day, idx) => {
                      const holiday = getHolidayOnDate(day);
                      const typeInfo = holiday ? HOLIDAY_TYPES[holiday.type] || HOLIDAY_TYPES.national : null;
                      const dayIsToday = isToday(day);
                      
                      return (
                        <div key={idx} className={`min-h-[60px] p-1 rounded-lg transition-all ${
                          day ? 'hover:bg-gray-50 cursor-pointer' : ''
                        } ${holiday ? `${typeInfo.bg} border ${typeInfo.border}` : ''} ${dayIsToday ? 'ring-2 ring-blue-400' : ''}`}
                        onClick={() => { if (day && !holiday) { setFormData(f => ({ ...f, date: `${selectedYear}-${String(focusedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` })); setShowModal(true); } else if (holiday) { handleEdit(holiday); } }}
                        >
                          {day && (
                            <>
                              <span className={`text-xs font-medium ${dayIsToday ? 'text-blue-600' : holiday ? typeInfo.text : 'text-gray-700'}`}>
                                {day}
                              </span>
                              {holiday && (
                                <div className="mt-0.5">
                                  <p className={`text-[10px] font-medium ${typeInfo.text} leading-tight truncate`}>{holiday.name}</p>
                                  <span className="text-[9px]">{typeInfo.icon}</span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {/* Month Quick Jump */}
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
                  <div className="flex flex-wrap gap-1">
                    {MONTHS.map((m, i) => {
                      const count = holidaysByMonth[i].length;
                      return (
                        <button
                          key={i}
                          onClick={() => setFocusedMonth(i)}
                          className={`px-2 py-1 text-[10px] font-medium rounded transition-all ${
                            focusedMonth === i 
                              ? 'bg-gray-900 text-white' 
                              : count > 0 
                                ? 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100' 
                                : 'text-gray-400 hover:text-gray-600'
                          }`}
                        >
                          {m.slice(0, 3)}
                          {count > 0 && <span className="ml-1 text-[9px] opacity-70">({count})</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Holiday List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">{MONTHS[focusedMonth]} Holidays</h3>
                <span className="text-xs text-gray-400">{holidaysByMonth[focusedMonth].length} holidays</span>
              </div>
              
              {holidaysByMonth[focusedMonth].length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                  <CalendarDaysIcon className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No holidays in {MONTHS[focusedMonth]}</p>
                  <button onClick={() => { setFormData(f => ({ ...f, date: `${selectedYear}-${String(focusedMonth + 1).padStart(2, '0')}-01` })); openAddModal(); }} className="mt-3 text-xs text-blue-600 hover:underline">
                    + Add holiday
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {holidaysByMonth[focusedMonth]
                    .sort((a, b) => new Date(a.date) - new Date(b.date))
                    .map(holiday => {
                      const typeInfo = HOLIDAY_TYPES[holiday.type] || HOLIDAY_TYPES.national;
                      const date = new Date(holiday.date);
                      const isPast = date < new Date();
                      
                      return (
                        <div key={holiday.id} className={`bg-white rounded-lg border border-gray-200 p-3 hover:shadow-sm transition-all ${isPast ? 'opacity-60' : ''}`}>
                          <div className="flex items-start gap-3">
                            <div className={`flex-shrink-0 w-10 h-10 rounded-lg ${typeInfo.bg} flex flex-col items-center justify-center`}>
                              <span className="text-xs font-bold text-gray-700">{date.getDate()}</span>
                              <span className="text-[9px] text-gray-500">{date.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-semibold text-gray-900 truncate">{holiday.name}</h4>
                                {holiday.is_optional && (
                                  <span className="px-1.5 py-0.5 text-[9px] font-medium bg-amber-100 text-amber-700 rounded">Optional</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`inline-flex items-center gap-1 text-[10px] ${typeInfo.text}`}>
                                  {typeInfo.icon} {typeInfo.label}
                                </span>
                              </div>
                              {holiday.description && (
                                <p className="text-[10px] text-gray-400 mt-1 line-clamp-1">{holiday.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5">
                              <button onClick={() => handleEdit(holiday)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                                <PencilSquareIcon className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDelete(holiday.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                                <TrashIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
              
              {/* Year Overview */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 mt-4">
                <h4 className="text-xs font-semibold text-gray-700 mb-3">Year Overview</h4>
                <div className="space-y-2">
                  {Object.entries(HOLIDAY_TYPES).map(([key, type]) => {
                    const count = holidays.filter(h => h.type === key).length;
                    const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-xs w-16">{type.icon} {type.label}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${type.dot} rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 w-6 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/40" onClick={() => setShowModal(false)} />
            
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900">
                  {editingHoliday ? 'Edit Holiday' : 'Add Holiday'}
                </h3>
                <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <XMarkIcon className="h-5 w-5 text-gray-500" />
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Holiday Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    placeholder="e.g., Republic Day"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    required
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(HOLIDAY_TYPES).map(([key, type]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setFormData({ ...formData, type: key })}
                        className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg border text-xs transition-all ${
                          formData.type === key
                            ? `${type.bg} ${type.text} ${type.border}`
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span>{type.icon}</span>
                        <span>{type.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Optional description..."
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_optional}
                    onChange={(e) => setFormData({ ...formData, is_optional: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-xs text-gray-700">Mark as Optional Holiday</span>
                </label>

                <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
                  <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                    Cancel
                  </button>
                  <button type="submit" className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800">
                    {editingHoliday ? 'Update' : 'Add Holiday'}
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
