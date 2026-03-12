'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import { useSessionRBAC } from '@/utils/client-rbac';
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  XMarkIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

const STATUS_OPTIONS = [
  { value: 'P', label: 'Present', color: 'bg-green-500', textColor: 'text-green-700', bgLight: 'bg-green-100' },
  { value: 'A', label: 'Absent', color: 'bg-red-500', textColor: 'text-red-700', bgLight: 'bg-red-100' },
  { value: 'HD', label: 'Half Day', color: 'bg-yellow-500', textColor: 'text-yellow-700', bgLight: 'bg-yellow-100' },
  { value: 'WO', label: 'Weekly Off', color: 'bg-blue-400', textColor: 'text-blue-700', bgLight: 'bg-blue-100' },
  { value: 'H', label: 'Holiday', color: 'bg-purple-500', textColor: 'text-purple-700', bgLight: 'bg-purple-100' },
  { value: 'PL', label: 'Privilege Leave', color: 'bg-teal-500', textColor: 'text-teal-700', bgLight: 'bg-teal-100' },
  { value: 'CL', label: 'Casual Leave', color: 'bg-cyan-500', textColor: 'text-cyan-700', bgLight: 'bg-cyan-100' },
  { value: 'SL', label: 'Sick Leave', color: 'bg-orange-500', textColor: 'text-orange-700', bgLight: 'bg-orange-100' },
  { value: 'LWP', label: 'Leave Without Pay', color: 'bg-gray-500', textColor: 'text-gray-700', bgLight: 'bg-gray-100' },
];

const getStatusInfo = (code) => STATUS_OPTIONS.find(s => s.value === code) || STATUS_OPTIONS[0];

export default function AttendancePage() {
  useSessionRBAC();

  // Month/Year selector
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-12
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');

  // Data
  const [employees, setEmployees] = useState([]);
  const [attendanceData, setAttendanceData] = useState({}); // { empId: { 'YYYY-MM-DD': { status, overtime_hours, ... } } }
  const [salaryProfiles, setSalaryProfiles] = useState({}); // { empId: { basic, da, basic_plus_da, ... } }
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Attendance entry modal
  const [modal, setModal] = useState(null); // { empId, empName, dateStr, dateLabel }
  const [modalForm, setModalForm] = useState({ status: '', in_time: '', out_time: '', overtime_hours: '', remarks: '' });
  const modalRef = useRef(null);

  // Compute days in month
  const daysInMonth = useMemo(() => {
    return new Date(selectedYear, selectedMonth, 0).getDate();
  }, [selectedMonth, selectedYear]);

  const monthDates = useMemo(() => {
    const dates = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(selectedYear, selectedMonth - 1, d);
      dates.push({
        day: d,
        date: date,
        dateStr: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        dayName: date.toLocaleDateString('en-IN', { weekday: 'short' }),
        isSunday: date.getDay() === 0,
      });
    }
    return dates;
  }, [selectedYear, selectedMonth, daysInMonth]);

  const monthLabel = useMemo(() => {
    return new Date(selectedYear, selectedMonth - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }, [selectedMonth, selectedYear]);

  // Departments list from employees
  const departments = useMemo(() => {
    const deptSet = new Set(employees.map(e => e.department).filter(Boolean));
    return Array.from(deptSet).sort();
  }, [employees]);

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    let list = employees;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e =>
        `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
        (e.employee_id && e.employee_id.toLowerCase().includes(q)) ||
        (e.department && e.department.toLowerCase().includes(q))
      );
    }
    if (departmentFilter) {
      list = list.filter(e => e.department === departmentFilter);
    }
    return list;
  }, [employees, searchQuery, departmentFilter]);

  // Holiday date set for quick lookup
  const holidayDateSet = useMemo(() => {
    const set = new Set();
    holidays.forEach(h => {
      const d = new Date(h.date);
      if (d.getMonth() + 1 === selectedMonth && d.getFullYear() === selectedYear) {
        set.add(d.getDate());
      }
    });
    return set;
  }, [holidays, selectedMonth, selectedYear]);

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/employees/list?status=active&limit=500');
      const data = await res.json();
      if (data.success || data.employees) {
        setEmployees(data.employees || []);
      }
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  }, []);

  // Fetch attendance for selected month
  const fetchAttendance = useCallback(async () => {
    try {
      const monthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      const res = await fetch(`/api/attendance?month=${monthStr}`);
      const data = await res.json();
      if (data.success && data.summary) {
        const map = {};
        data.summary.forEach(emp => {
          map[emp.employee_id] = emp.days || {};
        });
        setAttendanceData(map);
      }
    } catch (err) {
      console.error('Error fetching attendance:', err);
    }
  }, [selectedMonth, selectedYear]);

  // Fetch holidays
  const fetchHolidays = useCallback(async () => {
    try {
      const res = await fetch(`/api/masters/holidays?year=${selectedYear}`);
      const data = await res.json();
      if (data.holidays || data.data) {
        setHolidays(data.holidays || data.data || []);
      }
    } catch (err) {
      console.error('Error fetching holidays:', err);
    }
  }, [selectedYear]);

  // Fetch salary profiles (full) for currently loaded employees to compute OT payout
  const fetchSalaryProfiles = useCallback(async (employeeList) => {
    try {
      if (!employeeList || employeeList.length === 0) {
        setSalaryProfiles({});
        return;
      }
      const ids = employeeList.map(e => e.id).filter(Boolean);
      if (ids.length === 0) {
        setSalaryProfiles({});
        return;
      }

      const res = await fetch(`/api/payroll/salary-profile/batch?ids=${ids.join(',')}&full=1`);
      const data = await res.json();
      if (data.success && data.data) {
        setSalaryProfiles(data.data);
      } else {
        setSalaryProfiles({});
      }
    } catch (err) {
      console.error('Error fetching salary profiles:', err);
      setSalaryProfiles({});
    }
  }, []);

  // Load data
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchEmployees(), fetchAttendance(), fetchHolidays()])
      .finally(() => setLoading(false));
  }, [fetchEmployees, fetchAttendance, fetchHolidays]);

  // Default all unmarked days to Present while preserving existing statuses.
  useEffect(() => {
    if (loading || employees.length === 0 || monthDates.length === 0) return;

    setAttendanceData(prev => {
      let changed = false;
      const updated = { ...prev };

      employees.forEach(emp => {
        const empDays = { ...(updated[emp.id] || {}) };
        monthDates.forEach(({ dateStr }) => {
          if (!empDays[dateStr]?.status) {
            empDays[dateStr] = { ...(empDays[dateStr] || {}), status: 'P' };
            changed = true;
          }
        });
        updated[emp.id] = empDays;
      });

      return changed ? updated : prev;
    });
  }, [loading, employees, monthDates]);

  useEffect(() => {
    if (employees.length > 0) {
      fetchSalaryProfiles(employees);
    } else {
      setSalaryProfiles({});
    }
  }, [employees, fetchSalaryProfiles]);

  // Navigate months
  const goToPrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear(selectedYear - 1);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
    setHasChanges(false);
  };

  const goToNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear(selectedYear + 1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
    setHasChanges(false);
  };

  // Open modal to mark/edit attendance for a single cell
  const openModal = (emp, dateStr, dateLabel) => {
    const existing = attendanceData[emp.id]?.[dateStr] || {};
    setModal({ empId: emp.id, empName: `${emp.first_name} ${emp.last_name}`, dateStr, dateLabel });
    setModalForm({
      status: existing.status || '',
      in_time: existing.in_time || '',
      out_time: existing.out_time || '',
      overtime_hours: existing.overtime_hours != null ? String(existing.overtime_hours) : '',
      remarks: existing.remarks || '',
    });
  };

  const closeModal = () => setModal(null);

  // Auto-compute OT from in/out times: hours beyond 8h, only if > 2h
  const computedOT = useMemo(() => {
    if (!modalForm.in_time || !modalForm.out_time) return null;
    const toDecimal = (t) => { const [h, m] = t.split(':').map(Number); return h + m / 60; };
    const worked = toDecimal(modalForm.out_time) - toDecimal(modalForm.in_time);
    if (worked <= 0) return null;
    const ot = worked - 8;
    return ot > 2 ? parseFloat(ot.toFixed(2)) : 0;
  }, [modalForm.in_time, modalForm.out_time]);

  const saveModal = () => {
    if (!modal || !modalForm.status) return;
    const otHours = modalForm.overtime_hours !== '' ? parseFloat(modalForm.overtime_hours) || 0
      : (computedOT != null ? computedOT : 0);
    // Only store OT if > 2 hours
    const finalOT = otHours > 2 ? otHours : 0;
    setAttendanceData(prev => {
      const empDays = { ...(prev[modal.empId] || {}) };
      empDays[modal.dateStr] = {
        status: modalForm.status,
        in_time: modalForm.in_time || null,
        out_time: modalForm.out_time || null,
        overtime_hours: finalOT,
        remarks: modalForm.remarks || '',
      };
      return { ...prev, [modal.empId]: empDays };
    });
    setHasChanges(true);
    closeModal();
  };

  // Mark all Sundays as WO for all employees
  const markSundaysAsWO = () => {
    setAttendanceData(prev => {
      const updated = { ...prev };
      employees.forEach(emp => {
        const empDays = { ...(updated[emp.id] || {}) };
        monthDates.forEach(({ dateStr, isSunday }) => {
          if (isSunday) {
            empDays[dateStr] = { ...(empDays[dateStr] || {}), status: 'WO' };
          }
        });
        updated[emp.id] = empDays;
      });
      return updated;
    });
    setHasChanges(true);
  };

  // Mark holidays for all employees
  const markHolidays = () => {
    setAttendanceData(prev => {
      const updated = { ...prev };
      employees.forEach(emp => {
        const empDays = { ...(updated[emp.id] || {}) };
        monthDates.forEach(({ dateStr, day }) => {
          if (holidayDateSet.has(day)) {
            empDays[dateStr] = { ...(empDays[dateStr] || {}), status: 'H' };
          }
        });
        updated[emp.id] = empDays;
      });
      return updated;
    });
    setHasChanges(true);
  };

  // Mark all days as Present (overrides existing statuses)
  const markAllPresent = () => {
    setAttendanceData(prev => {
      const updated = { ...prev };
      employees.forEach(emp => {
        const empDays = { ...(updated[emp.id] || {}) };
        monthDates.forEach(({ dateStr }) => {
          empDays[dateStr] = { ...(empDays[dateStr] || {}), status: 'P' };
        });
        updated[emp.id] = empDays;
      });
      return updated;
    });
    setHasChanges(true);
  };

  // Save attendance
  const saveAttendance = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const records = [];
      const monthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

      Object.entries(attendanceData).forEach(([empId, days]) => {
        Object.entries(days).forEach(([dateStr, dayData]) => {
          if (dayData.status) {
            records.push({
              employee_id: parseInt(empId),
              attendance_date: dateStr,
              status: dayData.status,
              overtime_hours: dayData.overtime_hours || 0,
              is_weekly_off: dayData.status === 'WO' ? 1 : 0,
              remarks: dayData.remarks || '',
              in_time: dayData.in_time || null,
              out_time: dayData.out_time || null,
              idle_time: dayData.idle_time || 0,
            });
          }
        });
      });

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_records: records, month: monthStr }),
      });

      const data = await res.json();
      if (data.success) {
        setSaveMessage({ type: 'success', text: `Saved ${data.successCount} records successfully!` });
        setHasChanges(false);
      } else {
        setSaveMessage({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch (err) {
      setSaveMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(null), 4000);
    }
  };

  // Compute summary stats for an employee
  const getEmployeeSummary = (empId) => {
    const days = attendanceData[empId] || {};
    const summary = { P: 0, A: 0, HD: 0, WO: 0, H: 0, PL: 0, CL: 0, SL: 0, LWP: 0, totalHours: 0, totalOTHours: 0, totalOTAmount: 0 };
    const profile = salaryProfiles[empId] || {};
    const basicDa =
      parseFloat(profile.basic_plus_da || 0) ||
      ((parseFloat(profile.basic || 0) || 0) + (parseFloat(profile.da || 0) || 0));
    const perHourRate = basicDa > 0 ? (basicDa / 8) : 0;

    Object.values(days).forEach(d => {
      if (d.status && summary[d.status] !== undefined) {
        summary[d.status]++;
      }
      // Calculate working hours — use in/out times if available, else standard 8h (P) / 4h (HD)
      if (d.status === 'P' || d.status === 'HD') {
        if (d.in_time && d.out_time) {
          const inStr = d.in_time.toString().substring(0, 5);
          const outStr = d.out_time.toString().substring(0, 5);
          const [inH, inM] = inStr.split(':').map(Number);
          const [outH, outM] = outStr.split(':').map(Number);
          const hrs = (outH + outM / 60) - (inH + inM / 60);
          if (hrs > 0) summary.totalHours += hrs;
        } else {
          summary.totalHours += d.status === 'HD' ? 4 : 8;
        }
      }
      // OT payout formula: (Basic + DA) / 8 * OT hours
      const ot = parseFloat(d.overtime_hours || 0);
      if (ot > 0) {
        summary.totalOTHours += ot;
        summary.totalOTAmount += perHourRate * ot;
      }
    });
    summary.payable = summary.P + (summary.HD * 0.5) + summary.PL + summary.CL + summary.SL;
    return summary;
  };

  // Export to CSV
  const exportCSV = () => {
    const headers = ['Employee ID', 'Employee Name', 'Department', ...monthDates.map(d => d.day), 'Present', 'Absent', 'Half Day', 'WO', 'Holiday', 'PL', 'CL', 'SL', 'LWP', 'Payable Days', 'Total Hours', 'OT Hours', 'OT Amount'];
    const rows = filteredEmployees.map(emp => {
      const summary = getEmployeeSummary(emp.id);
      const dayStatuses = monthDates.map(d => {
        const dayData = attendanceData[emp.id]?.[d.dateStr];
        return dayData?.status || '';
      });
      return [
        emp.employee_id,
        `${emp.first_name} ${emp.last_name}`,
        emp.department || '',
        ...dayStatuses,
        summary.P, summary.A, summary.HD, summary.WO, summary.H, summary.PL, summary.CL, summary.SL, summary.LWP,
        summary.payable.toFixed(1), summary.totalHours.toFixed(1), summary.totalOTHours.toFixed(1), summary.totalOTAmount.toFixed(2),
      ];
    });

    const csvContent = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Attendance_${monthLabel.replace(' ', '_')}.csv`;
    a.click();
  };

  return (
    <AccessGuard resource="employees" permission="read">
      <div className="min-h-screen bg-gray-50">
        <Navbar />

        {/* Attendance Entry Modal */}
        {modal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div ref={modalRef} className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{modal.empName}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{modal.dateLabel}</p>
                </div>
                <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Status */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Status <span className="text-red-500">*</span></label>
                  <div className="grid grid-cols-3 gap-2">
                    {STATUS_OPTIONS.map(s => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setModalForm(f => ({ ...f, status: s.value }))}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold border-2 transition-all ${
                          modalForm.status === s.value
                            ? `${s.bgLight} ${s.textColor} border-current`
                            : 'bg-gray-50 text-gray-600 border-transparent hover:bg-gray-100'
                        }`}
                      >
                        {s.value} — {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* In / Out Times */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">In Time</label>
                    <div className="relative">
                      <ClockIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="time"
                        value={modalForm.in_time}
                        onChange={e => setModalForm(f => ({ ...f, in_time: e.target.value }))}
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Out Time</label>
                    <div className="relative">
                      <ClockIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="time"
                        value={modalForm.out_time}
                        onChange={e => setModalForm(f => ({ ...f, out_time: e.target.value }))}
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                    </div>
                  </div>
                </div>

                {/* OT info */}
                {computedOT !== null && (() => {
                  const [ih, im] = modalForm.in_time.split(':').map(Number);
                  const [oh, om] = modalForm.out_time.split(':').map(Number);
                  const worked = (oh + om / 60) - (ih + im / 60);
                  const extra = worked - 8;
                  let msg, cls;
                  if (computedOT > 2) {
                    msg = `⏱ Auto OT: ${computedOT.toFixed(2)} hrs (time beyond 8h shift)`;
                    cls = 'bg-orange-50 text-orange-700 border border-orange-200';
                  } else if (extra > 0) {
                    msg = `OT not applicable — extra ${extra.toFixed(2)} hrs must exceed 2 hrs to qualify`;
                    cls = 'bg-gray-50 text-gray-500 border border-gray-200';
                  } else {
                    msg = `Worked ${worked > 0 ? worked.toFixed(2) : 0} hrs — no overtime`;
                    cls = 'bg-gray-50 text-gray-500 border border-gray-200';
                  }
                  return <div className={`text-xs px-3 py-2 rounded-lg ${cls}`}>{msg}</div>;
                })()}

                {/* Manual OT override */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">OT Hours <span className="text-gray-400 font-normal">(override — applied only if &gt; 2 hrs)</span></label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder={computedOT != null ? `Auto: ${computedOT > 2 ? computedOT : 0}` : '0'}
                    value={modalForm.overtime_hours}
                    onChange={e => setModalForm(f => ({ ...f, overtime_hours: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>

                {/* Remarks */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Remarks</label>
                  <input
                    type="text"
                    placeholder="Optional note..."
                    value={modalForm.remarks}
                    onChange={e => setModalForm(f => ({ ...f, remarks: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex gap-3 px-5 py-4 border-t border-gray-100">
                <button
                  onClick={closeModal}
                  className="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveModal}
                  disabled={!modalForm.status}
                  className="flex-1 py-2 bg-[#64126D] text-white rounded-lg text-sm font-medium hover:bg-[#86288F] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="p-4 md:p-6 max-w-full mx-auto">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#64126D] to-[#86288F] rounded-xl p-5 mb-6 text-white shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-3">
                <CalendarDaysIcon className="h-8 w-8" />
                <div>
                  <h1 className="text-2xl font-bold">Attendance Management</h1>
                  <p className="text-purple-200 text-sm">Mark and manage employee attendance</p>
                </div>
              </div>

              {/* Month Navigator */}
              <div className="flex items-center gap-2">
                <button
                  onClick={goToPrevMonth}
                  className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                >
                  <ChevronLeftIcon className="h-5 w-5" />
                </button>
                <div className="bg-white/20 rounded-lg px-4 py-2 min-w-[180px] text-center font-semibold">
                  {monthLabel}
                </div>
                <button
                  onClick={goToNextMonth}
                  className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                >
                  <ChevronRightIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              {/* Department Filter */}
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">All Departments</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              {/* Quick Actions */}
              <div className="flex gap-2 ml-auto flex-wrap">
                <button
                  onClick={markSundaysAsWO}
                  className="px-3 py-2 text-xs font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-200 transition-colors"
                >
                  Mark Sundays WO
                </button>
                <button
                  onClick={markHolidays}
                  className="px-3 py-2 text-xs font-medium bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 border border-purple-200 transition-colors"
                  disabled={holidays.length === 0}
                >
                  Mark Holidays
                </button>
                <button
                  onClick={markAllPresent}
                  className="px-3 py-2 text-xs font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100 border border-green-200 transition-colors"
                >
                  Fill Present
                </button>
                <button
                  onClick={exportCSV}
                  className="px-3 py-2 text-xs font-medium bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors flex items-center gap-1"
                >
                  <ArrowDownTrayIcon className="h-3.5 w-3.5" /> CSV
                </button>
              </div>
            </div>

            {/* Status Legend */}
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-100">
              {STATUS_OPTIONS.map(s => (
                <div key={s.value} className="flex items-center gap-1.5 text-xs">
                  <span className={`w-3 h-3 rounded-sm ${s.color}`}></span>
                  <span className="text-gray-600">{s.value} - {s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Save Bar */}
          {hasChanges && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 flex items-center justify-between">
              <p className="text-sm text-yellow-800 font-medium">You have unsaved changes</p>
              <button
                onClick={saveAttendance}
                disabled={saving}
                className="px-4 py-2 bg-[#64126D] text-white rounded-lg text-sm font-medium hover:bg-[#86288F] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Save Attendance'}
              </button>
            </div>
          )}

          {/* Save Message */}
          {saveMessage && (
            <div className={`rounded-xl p-3 mb-4 flex items-center gap-2 ${
              saveMessage.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              {saveMessage.type === 'success' ? <CheckCircleIcon className="h-5 w-5" /> : <XCircleIcon className="h-5 w-5" />}
              <p className="text-sm font-medium">{saveMessage.text}</p>
            </div>
          )}

          {/* Attendance Grid */}
          {loading ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Loading attendance data...</p>
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <p className="text-gray-500">No employees found</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="sticky left-0 z-20 bg-gray-50 px-3 py-3 text-left text-[11px] font-semibold text-gray-600 uppercase min-w-[200px]">
                        Employee
                      </th>
                      {monthDates.map(d => (
                        <th
                          key={d.day}
                          className={`px-1 py-2 text-center text-[10px] font-semibold uppercase min-w-[36px] ${
                            d.isSunday ? 'bg-blue-50 text-blue-700' : holidayDateSet.has(d.day) ? 'bg-purple-50 text-purple-700' : 'text-gray-600'
                          }`}
                        >
                          <div>{d.dayName}</div>
                          <div className="text-[11px] font-bold">{d.day}</div>
                        </th>
                      ))}
                      <th className="px-2 py-3 text-center text-[10px] font-semibold text-green-700 uppercase bg-green-50 min-w-[32px]">P</th>
                      <th className="px-2 py-3 text-center text-[10px] font-semibold text-red-700 uppercase bg-red-50 min-w-[32px]">A</th>
                      <th className="px-2 py-3 text-center text-[10px] font-semibold text-yellow-700 uppercase bg-yellow-50 min-w-[32px]">HD</th>
                      <th className="px-2 py-3 text-center text-[10px] font-semibold text-blue-700 uppercase bg-blue-50 min-w-[32px]">WO</th>
                      <th className="px-2 py-3 text-center text-[10px] font-semibold text-teal-700 uppercase bg-teal-50 min-w-[44px]">Pay</th>
                      <th className="px-2 py-3 text-center text-[10px] font-semibold text-indigo-700 uppercase bg-indigo-50 min-w-[44px]">Hrs</th>
                      <th className="px-2 py-3 text-center text-[10px] font-semibold text-orange-700 uppercase bg-orange-50 min-w-[32px]">OT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredEmployees.map((emp) => {
                      const summary = getEmployeeSummary(emp.id);
                      return (
                        <tr key={emp.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 border-r border-gray-100">
                            <div className="text-xs font-medium text-gray-900 truncate">
                              {emp.first_name} {emp.last_name}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate">
                              {emp.employee_id} • {emp.department || 'N/A'}
                            </div>
                          </td>
                          {monthDates.map(d => {
                            const dayData = attendanceData[emp.id]?.[d.dateStr];
                            const status = dayData?.status || '';
                            const statusInfo = status ? getStatusInfo(status) : null;
                            return (
                              <td
                                key={d.dateStr}
                                className={`px-0.5 py-1 text-center cursor-pointer transition-colors ${
                                  d.isSunday ? 'bg-blue-50/50' : holidayDateSet.has(d.day) ? 'bg-purple-50/50' : ''
                                }`}
                                onClick={() => openModal(emp, d.dateStr, `${d.dayName}, ${d.day} ${monthLabel}`)}
                                title={`${emp.first_name} ${emp.last_name} - ${d.dayName} ${d.day}: ${status ? getStatusInfo(status).label : 'Click to mark'}`}
                              >
                                {status ? (
                                  <span className={`inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-bold ${statusInfo.bgLight} ${statusInfo.textColor}`}>
                                    {status}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center justify-center w-7 h-6 rounded text-[10px] text-gray-300 hover:bg-gray-100">
                                    –
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          {/* Summary columns */}
                          <td className="px-2 py-2 text-center text-xs font-bold text-green-700 bg-green-50/50">{summary.P}</td>
                          <td className="px-2 py-2 text-center text-xs font-bold text-red-700 bg-red-50/50">{summary.A}</td>
                          <td className="px-2 py-2 text-center text-xs font-bold text-yellow-700 bg-yellow-50/50">{summary.HD}</td>
                          <td className="px-2 py-2 text-center text-xs font-bold text-blue-700 bg-blue-50/50">{summary.WO}</td>
                          <td className="px-2 py-2 text-center text-xs font-bold text-teal-700 bg-teal-50/50">{summary.payable.toFixed(1)}</td>
                          <td className="px-2 py-2 text-center text-xs font-bold text-indigo-700 bg-indigo-50/50">{summary.totalHours.toFixed(1)}</td>
                          <td className="px-2 py-2 text-center text-xs font-bold text-orange-700 bg-orange-50/50">{summary.totalOTHours > 0 ? summary.totalOTHours.toFixed(1) : '–'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="border-t border-gray-200 px-4 py-3 bg-gray-50 flex items-center justify-between text-xs text-gray-500">
                <span>Showing {filteredEmployees.length} of {employees.length} employees</span>
                <span>Click on a cell to open the attendance entry modal</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </AccessGuard>
  );
}
