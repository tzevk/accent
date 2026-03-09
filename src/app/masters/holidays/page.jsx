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
  ChevronRightIcon,
  GlobeAltIcon,
  BuildingOfficeIcon,
  MapPinIcon,
  StarIcon,
  SparklesIcon,
  ListBulletIcon,
  CalendarIcon
} from '@heroicons/react/24/outline';

const HOLIDAY_TYPES = {
  national: { label: 'National', Icon: GlobeAltIcon, bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  religious: { label: 'Religious', Icon: SparklesIcon, bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  regional: { label: 'Regional', Icon: MapPinIcon, bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  company: { label: 'Company', Icon: BuildingOfficeIcon, bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  optional: { label: 'Optional', Icon: StarIcon, bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
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
  const [viewMode, setViewMode] = useState('calendar');
  
  const [formData, setFormData] = useState({
    name: '',
    date: '',
    type: 'national',
    is_optional: false,
    description: '',
    is_active: true
  });

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
    } catch {
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolidays();
  }, [selectedYear]);

  const filteredHolidays = useMemo(() => {
    if (filterType === 'all') return holidays;
    return holidays.filter(h => h.type === filterType);
  }, [holidays, filterType]);

  const holidaysByMonth = useMemo(() => {
    const grouped = {};
    MONTHS.forEach((_, i) => grouped[i] = []);
    filteredHolidays.forEach(h => {
      const monthIdx = new Date(h.date).getMonth();
      grouped[monthIdx].push(h);
    });
    return grouped;
  }, [filteredHolidays]);

  const stats = useMemo(() => ({
    total: holidays.length,
    national: holidays.filter(h => h.type === 'national').length,
    religious: holidays.filter(h => h.type === 'religious').length,
    regional: holidays.filter(h => h.type === 'regional').length,
    company: holidays.filter(h => h.type === 'company').length,
    optional: holidays.filter(h => h.is_optional).length,
    upcoming: holidays.filter(h => new Date(h.date) >= new Date()).length
  }), [holidays]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(selectedYear, focusedMonth, 1);
    const lastDay = new Date(selectedYear, focusedMonth + 1, 0);
    const startPad = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const days = [];
    for (let i = 0; i < startPad; i++) days.push(null);
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
      const body = editingHoliday ? { ...formData, id: editingHoliday.id } : formData;
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
  
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/employees')} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
              <ArrowLeftIcon className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <CalendarDaysIcon className="w-6 h-6 text-orange-500" />
                Holiday Master - {selectedYear}
              </h1>
              <p className="text-sm text-gray-500">{stats.total} holidays | {stats.upcoming} upcoming</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select value={selectedYear} onChange={(e) => setSelectedYear(parseInt(e.target.value))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">
              {[2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button onClick={() => setViewMode('calendar')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === 'calendar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                <CalendarIcon className="w-4 h-4" />Calendar
              </button>
              <button onClick={() => setViewMode('list')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                <ListBulletIcon className="w-4 h-4" />List
              </button>
            </div>
            <button onClick={openAddModal} className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
              <PlusIcon className="w-4 h-4" />Add Holiday
            </button>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
            <XMarkIcon className="w-4 h-4" />{error}
            <button onClick={() => setError('')} className="ml-auto"><XMarkIcon className="w-4 h-4" /></button>
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm flex items-center gap-2">
            <CheckIcon className="w-4 h-4" />{success}
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-6 gap-3 mb-6">
          {[
            { label: 'Total', value: stats.total, Icon: CalendarDaysIcon, bgClass: 'bg-gray-100', textClass: 'text-gray-600' },
            { label: 'National', value: stats.national, Icon: GlobeAltIcon, bgClass: 'bg-orange-100', textClass: 'text-orange-600' },
            { label: 'Religious', value: stats.religious, Icon: SparklesIcon, bgClass: 'bg-purple-100', textClass: 'text-purple-600' },
            { label: 'Regional', value: stats.regional, Icon: MapPinIcon, bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
            { label: 'Company', value: stats.company, Icon: BuildingOfficeIcon, bgClass: 'bg-emerald-100', textClass: 'text-emerald-600' },
            { label: 'Upcoming', value: stats.upcoming, Icon: CalendarIcon, bgClass: 'bg-indigo-100', textClass: 'text-indigo-600' },
          ].map((stat, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${stat.bgClass}`}><stat.Icon className={`w-5 h-5 ${stat.textClass}`} /></div>
                <div><p className="text-2xl font-bold text-gray-900">{stat.value}</p><p className="text-xs text-gray-500">{stat.label}</p></div>
              </div>
            </div>
          ))}
        </div>

        {/* Type Filter */}
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
          <button onClick={() => setFilterType('all')} className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-all ${filterType === 'all' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            All ({stats.total})
          </button>
          {Object.entries(HOLIDAY_TYPES).map(([key, type]) => {
            const count = holidays.filter(h => h.type === key).length;
            const TypeIcon = type.Icon;
            return (
              <button key={key} onClick={() => setFilterType(key)} className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-all flex items-center gap-1.5 ${filterType === key ? `${type.bg} ${type.text} border ${type.border}` : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                <TypeIcon className="w-3.5 h-3.5" />{type.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Main Content */}
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12"><InlineSpinner message="Loading holidays..." /></div>
        ) : viewMode === 'calendar' ? (
          /* Calendar View */
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
            <div className="xl:col-span-3">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
                  <button onClick={() => setFocusedMonth(m => m > 0 ? m - 1 : 11)} className="p-2 hover:bg-gray-200 rounded-lg"><ChevronLeftIcon className="w-5 h-5 text-gray-600" /></button>
                  <h3 className="text-lg font-semibold text-gray-900">{MONTHS[focusedMonth]} {selectedYear}</h3>
                  <button onClick={() => setFocusedMonth(m => m < 11 ? m + 1 : 0)} className="p-2 hover:bg-gray-200 rounded-lg"><ChevronRightIcon className="w-5 h-5 text-gray-600" /></button>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-7 gap-2 mb-3">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (<div key={d} className="text-center text-xs font-semibold text-gray-400 uppercase py-2">{d}</div>))}
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {calendarDays.map((day, idx) => {
                      const holiday = getHolidayOnDate(day);
                      const typeInfo = holiday ? HOLIDAY_TYPES[holiday.type] || HOLIDAY_TYPES.national : null;
                      const TypeIcon = typeInfo?.Icon;
                      const dayIsToday = isToday(day);
                      const isSunday = day && new Date(selectedYear, focusedMonth, day).getDay() === 0;
                      return (
                        <div key={idx} className={`min-h-[80px] p-2 rounded-lg transition-all ${day ? 'hover:bg-gray-50 cursor-pointer border border-transparent hover:border-gray-200' : ''} ${holiday ? `${typeInfo.bg} border ${typeInfo.border}` : ''} ${dayIsToday ? 'ring-2 ring-blue-400' : ''} ${isSunday && !holiday ? 'bg-red-50/50' : ''}`}
                          onClick={() => { if (day && !holiday) { setFormData(f => ({ ...f, date: `${selectedYear}-${String(focusedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` })); setShowModal(true); } else if (holiday) { handleEdit(holiday); } }}>
                          {day && (<>
                            <span className={`text-sm font-semibold ${dayIsToday ? 'text-blue-600' : holiday ? typeInfo.text : isSunday ? 'text-red-500' : 'text-gray-700'}`}>{day}</span>
                            {holiday && (<div className="mt-1"><div className="flex items-center gap-1"><TypeIcon className={`w-3 h-3 ${typeInfo.text}`} /><p className={`text-[11px] font-medium ${typeInfo.text} leading-tight truncate`}>{holiday.name}</p></div>{holiday.is_optional && (<span className="text-[9px] text-amber-600 font-medium">Optional</span>)}</div>)}
                          </>)}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
                  <div className="flex flex-wrap gap-2">
                    {MONTHS.map((m, i) => {
                      const count = holidaysByMonth[i].length;
                      return (<button key={i} onClick={() => setFocusedMonth(i)} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${focusedMonth === i ? 'bg-gray-900 text-white' : count > 0 ? 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}>{m.slice(0, 3)}{count > 0 && <span className="ml-1 text-[10px] opacity-70">({count})</span>}</button>);
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-gray-900">{MONTHS[focusedMonth]} Holidays</h3><span className="text-xs text-gray-400">{holidaysByMonth[focusedMonth].length}</span></div>
                {holidaysByMonth[focusedMonth].length === 0 ? (
                  <div className="text-center py-6"><CalendarDaysIcon className="w-10 h-10 text-gray-300 mx-auto mb-2" /><p className="text-sm text-gray-500">No holidays</p><button onClick={() => { setFormData(f => ({ ...f, date: `${selectedYear}-${String(focusedMonth + 1).padStart(2, '0')}-01` })); openAddModal(); }} className="mt-2 text-xs text-blue-600 hover:underline">+ Add holiday</button></div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {holidaysByMonth[focusedMonth].sort((a, b) => new Date(a.date) - new Date(b.date)).map(holiday => {
                      const typeInfo = HOLIDAY_TYPES[holiday.type] || HOLIDAY_TYPES.national;
                      const TypeIcon = typeInfo.Icon;
                      const date = new Date(holiday.date);
                      const isPast = date < new Date();
                      return (
                        <div key={holiday.id} className={`p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all ${isPast ? 'opacity-60' : ''}`}>
                          <div className="flex items-start gap-3">
                            <div className={`flex-shrink-0 w-10 h-10 rounded-lg ${typeInfo.bg} flex flex-col items-center justify-center`}><span className="text-xs font-bold text-gray-700">{date.getDate()}</span><span className="text-[9px] text-gray-500">{date.toLocaleDateString('en-IN', { weekday: 'short' })}</span></div>
                            <div className="flex-1 min-w-0"><h4 className="text-sm font-semibold text-gray-900 truncate">{holiday.name}</h4><div className="flex items-center gap-1 mt-0.5"><TypeIcon className={`w-3 h-3 ${typeInfo.text}`} /><span className={`text-[10px] ${typeInfo.text}`}>{typeInfo.label}</span>{holiday.is_optional && (<span className="px-1 py-0.5 text-[9px] font-medium bg-amber-100 text-amber-700 rounded ml-1">Optional</span>)}</div></div>
                            <div className="flex items-center gap-0.5"><button onClick={() => handleEdit(holiday)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><PencilSquareIcon className="w-3.5 h-3.5" /></button><button onClick={() => handleDelete(holiday.id)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><TrashIcon className="w-3.5 h-3.5" /></button></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h4 className="text-xs font-semibold text-gray-700 mb-3">Year Overview</h4>
                <div className="space-y-2">
                  {Object.entries(HOLIDAY_TYPES).map(([key, type]) => {
                    const TypeIcon = type.Icon;
                    const count = holidays.filter(h => h.type === key).length;
                    const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
                    return (<div key={key} className="flex items-center gap-2"><TypeIcon className={`w-3.5 h-3.5 ${type.text}`} /><span className="text-xs w-14 text-gray-600">{type.label}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${type.dot} rounded-full`} style={{ width: `${pct}%` }} /></div><span className="text-xs text-gray-500 w-6 text-right">{count}</span></div>);
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* List View */
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Date</th><th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Holiday Name</th><th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Type</th><th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Description</th><th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Optional</th><th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Actions</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredHolidays.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center"><CalendarDaysIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No holidays found</p><button onClick={openAddModal} className="mt-3 text-sm text-blue-600 hover:underline">+ Add Holiday</button></td></tr>
                  ) : (
                    filteredHolidays.sort((a, b) => new Date(a.date) - new Date(b.date)).map(holiday => {
                      const typeInfo = HOLIDAY_TYPES[holiday.type] || HOLIDAY_TYPES.national;
                      const TypeIcon = typeInfo.Icon;
                      const date = new Date(holiday.date);
                      const isPast = date < new Date();
                      return (
                        <tr key={holiday.id} className={`hover:bg-gray-50 ${isPast ? 'opacity-60' : ''}`}>
                          <td className="px-4 py-3"><div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-lg ${typeInfo.bg} flex flex-col items-center justify-center`}><span className="text-xs font-bold text-gray-700">{date.getDate()}</span><span className="text-[9px] text-gray-500">{date.toLocaleDateString('en-IN', { weekday: 'short' })}</span></div><div><p className="text-sm font-medium text-gray-900">{formatDate(holiday.date)}</p></div></div></td>
                          <td className="px-4 py-3"><p className="text-sm font-semibold text-gray-900">{holiday.name}</p></td>
                          <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${typeInfo.bg} ${typeInfo.text} border ${typeInfo.border}`}><TypeIcon className="w-3.5 h-3.5" />{typeInfo.label}</span></td>
                          <td className="px-4 py-3"><p className="text-sm text-gray-500 max-w-xs truncate">{holiday.description || '-'}</p></td>
                          <td className="px-4 py-3 text-center">{holiday.is_optional ? (<span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full"><StarIcon className="w-3 h-3 mr-1" />Yes</span>) : (<span className="text-xs text-gray-400">-</span>)}</td>
                          <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-1"><button onClick={() => handleEdit(holiday)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><PencilSquareIcon className="w-4 h-4" /></button><button onClick={() => handleDelete(holiday.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><TrashIcon className="w-4 h-4" /></button></div></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500"><span>{filteredHolidays.length} holiday{filteredHolidays.length !== 1 ? 's' : ''}</span><span>{selectedYear}</span></div>
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
                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><CalendarDaysIcon className="w-5 h-5 text-orange-500" />{editingHoliday ? 'Edit Holiday' : 'Add Holiday'}</h3>
                <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><XMarkIcon className="h-5 w-5 text-gray-500" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="block text-xs font-medium text-gray-700 mb-1">Holiday Name *</label><input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required placeholder="e.g., Republic Day" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="block text-xs font-medium text-gray-700 mb-1">Date *</label><input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} required className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="block text-xs font-medium text-gray-700 mb-1.5">Type</label><div className="grid grid-cols-3 gap-2">{Object.entries(HOLIDAY_TYPES).map(([key, type]) => { const TypeIcon = type.Icon; return (<button key={key} type="button" onClick={() => setFormData({ ...formData, type: key })} className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg border text-xs transition-all ${formData.type === key ? `${type.bg} ${type.text} ${type.border}` : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}><TypeIcon className="w-3.5 h-3.5" /><span>{type.label}</span></button>); })}</div></div>
                <div><label className="block text-xs font-medium text-gray-700 mb-1">Description</label><textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Optional description..." rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" /></div>
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.is_optional} onChange={(e) => setFormData({ ...formData, is_optional: e.target.checked })} className="w-4 h-4 text-blue-600 rounded" /><span className="text-xs text-gray-700">Mark as Optional Holiday</span></label>
                <div className="flex justify-end gap-2 pt-3 border-t border-gray-100"><button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800">{editingHoliday ? 'Update' : 'Add Holiday'}</button></div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
