'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  PlusIcon,
  TrashIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

// ── Status types ──
const STATUS_OPTIONS = ['P', 'A', 'H', 'WO', 'PL', 'CL', 'SL', 'HD', 'OT', 'LWP'];

const STATUS_STYLES = {
  'P':   { bg: 'bg-emerald-50',  text: 'text-emerald-700', label: 'P',   full: 'Present',     border: 'border-emerald-200' },
  'A':   { bg: 'bg-red-50',      text: 'text-red-700',     label: 'A',   full: 'Absent',      border: 'border-red-200' },
  'H':   { bg: 'bg-amber-50',    text: 'text-amber-700',   label: 'H',   full: 'Holiday',     border: 'border-amber-200' },
  'WO':  { bg: 'bg-gray-100',    text: 'text-gray-500',    label: 'WO',  full: 'Weekly Off',  border: 'border-gray-200' },
  'PL':  { bg: 'bg-blue-50',     text: 'text-blue-700',    label: 'PL',  full: 'Priv. Leave', border: 'border-blue-200' },
  'CL':  { bg: 'bg-cyan-50',     text: 'text-cyan-700',    label: 'CL',  full: 'Casual',      border: 'border-cyan-200' },
  'SL':  { bg: 'bg-pink-50',     text: 'text-pink-700',    label: 'SL',  full: 'Sick',        border: 'border-pink-200' },
  'HD':  { bg: 'bg-yellow-50',   text: 'text-yellow-700',  label: 'HD',  full: 'Half Day',    border: 'border-yellow-200' },
  'OT':  { bg: 'bg-violet-50',   text: 'text-violet-700',  label: 'OT',  full: 'Overtime',    border: 'border-violet-200' },
  'LWP': { bg: 'bg-rose-50',     text: 'text-rose-700',    label: 'LWP', full: 'LWP',         border: 'border-rose-200' },
};

const getStyle = (s) => STATUS_STYLES[s] || { bg: 'bg-gray-50', text: 'text-gray-400', label: '-', full: 'Not Marked', border: 'border-gray-200' };

// Calculate OT hours based on in/out time (standard 8-hour workday)
const calculateOTHours = (inTime, outTime) => {
  if (!inTime || !outTime) return 0;
  const [inH, inM] = inTime.split(':').map(Number);
  const [outH, outM] = outTime.split(':').map(Number);
  const inMinutes = inH * 60 + inM;
  const outMinutes = outH * 60 + outM;
  // Handle overnight shifts
  let totalMinutes = outMinutes >= inMinutes ? outMinutes - inMinutes : (24 * 60 - inMinutes) + outMinutes;
  const totalHours = totalMinutes / 60;
  // Standard work hours (8 hours)
  const standardHours = 8;
  const otHours = Math.max(0, totalHours - standardHours);
  return Math.round(otHours * 2) / 2; // Round to nearest 0.5
};

// Calculate total hours from in/out time
const calculateTotalHours = (inTime, outTime) => {
  if (!inTime || !outTime) return 0;
  const [inH, inM] = inTime.split(':').map(Number);
  const [outH, outM] = outTime.split(':').map(Number);
  const inMinutes = inH * 60 + inM;
  const outMinutes = outH * 60 + outM;
  // Handle overnight shifts
  let totalMinutes = outMinutes >= inMinutes ? outMinutes - inMinutes : (24 * 60 - inMinutes) + outMinutes;
  return Math.round((totalMinutes / 60) * 2) / 2; // Round to nearest 0.5
};

export default function EmployeeAttendancePage() {
  // ── Core state ──
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Month navigation
  const [currentDate, setCurrentDate] = useState(new Date());
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth(); // 0-indexed
  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // ── Attendance grid data ──
  // Shape: { "empId|YYYY-MM-DD": { status: 'P', inTime: '09:00', outTime: '17:30', otHours: 0 } }
  const [gridData, setGridData] = useState({});
  const [dirtyKeys, setDirtyKeys] = useState(new Set()); // edited keys

  // ── Monthly summary from attendance_monthly ──
  const [monthlyData, setMonthlyData] = useState([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [markedEmployeeIds, setMarkedEmployeeIds] = useState(new Set());

  // ── Inline editing for monthly totals ──
  const [editedRows, setEditedRows] = useState({});
  const [monthlyDirty, setMonthlyDirty] = useState(false);
  const [monthlySaving, setMonthlySaving] = useState(false);

  // ── Add employee modal ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRow, setNewRow] = useState({
    employee_id: '', present_days: '', absent_days: '', half_days: '',
    holidays: '', weekly_offs: '', overtime_hours: '', privileged_leave: '',
    sick_leave: '', casual_leave: '', lop_days: '', payable_days: '', remarks: ''
  });

  // ── Bulk time modal ──
  const [showBulkTimeModal, setShowBulkTimeModal] = useState(false);
  const [bulkTime, setBulkTime] = useState({ inTime: '09:00', outTime: '17:30' });

  // ── PL data ──
  const [plData, setPlData] = useState({});

  // ── Context menu for quick status pick ──
  const [ctxMenu, setCtxMenu] = useState(null);
  const ctxRef = useRef(null);

  // ── View mode ──
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'monthly'

  // ── Cell detail modal (replaces expandable rows) ──
  // { empId, fullDate, empName } or null
  const [cellModal, setCellModal] = useState(null);

  // ──────────────── Days of month ────────────────
  const daysInMonth = useMemo(() => {
    const days = [];
    const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(currentYear, currentMonth, d);
      const dow = date.getDay();
      days.push({
        date: d,
        fullDate: date.toISOString().split('T')[0],
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dow,
        isSun: dow === 0,
        isSat: dow === 6,
        isToday: date.toDateString() === new Date().toDateString()
      });
    }
    return days;
  }, [currentYear, currentMonth]);

  // ──────────────── Fetch holidays ────────────────
  const fetchHolidays = useCallback(async () => {
    try {
      const res = await fetch(`/api/masters/holidays?year=${currentYear}`);
      const data = await res.json();
      return (res.ok && data.data) ? data.data : [];
    } catch { return []; }
  }, [currentYear]);

  // ──────────────── Fetch employees + build default grid ────────────────
  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [holidayList, empRes] = await Promise.all([
        fetchHolidays(),
        fetch('/api/employees?limit=1000&status=active')
      ]);
      const empData = await empRes.json();
      if (!empRes.ok) throw new Error(empData.error || 'Failed to fetch employees');

      const employeeList = empData.employees || empData.data || [];
      setEmployees(employeeList);

      // Build holiday date set for this month
      const holidayDates = new Set(
        holidayList
          .filter(h => {
            const d = new Date(h.date);
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
          })
          .map(h => h.date.split('T')[0])
      );

      // Build default grid: all employees × all days
      const grid = {};
      employeeList.forEach(emp => {
        daysInMonth.forEach(day => {
          const key = `${emp.id}|${day.fullDate}`;
          let status = 'P';
          if (holidayDates.has(day.fullDate)) status = 'H';
          else if (day.isSun) status = 'WO';
          else if (day.isSat && (Math.ceil(day.date / 7) === 2 || Math.ceil(day.date / 7) === 4)) status = 'WO';

          grid[key] = { status, inTime: '', outTime: '', otHours: 0 };
        });
      });
      setGridData(grid);
      setDirtyKeys(new Set());

      // Load saved daily attendance and merge into grid
      try {
        const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
        const attnRes = await fetch(`/api/attendance?month=${monthKey}`);
        const attnData = await attnRes.json();
        if (attnRes.ok && attnData.summary && attnData.summary.length > 0) {
          const formatTime = (t) => t ? t.toString().substring(0, 5) : '';
          attnData.summary.forEach(empSummary => {
            Object.entries(empSummary.days).forEach(([dateKey, dayData]) => {
              const key = `${empSummary.employee_id}|${dateKey}`;
              if (grid[key]) {
                grid[key] = {
                  status: dayData.status || grid[key].status,
                  inTime: formatTime(dayData.in_time) || grid[key].inTime,
                  outTime: formatTime(dayData.out_time) || grid[key].outTime,
                  otHours: parseFloat(dayData.overtime_hours || 0)
                };
              }
            });
          });
          setGridData({ ...grid });
        }
      } catch (err) {
        console.error('Error loading saved attendance:', err);
      }

      setLoading(false);

      // Fetch PL data in background
      try {
        const plMap = {};
        const batchRes = await fetch('/api/payroll/salary-profile/batch');
        const batchResult = await batchRes.json();
        if (batchRes.ok && batchResult.data) {
          Object.entries(batchResult.data).forEach(([eid, profile]) => {
            plMap[Number(eid)] = { total: profile.pl_total || 0, used: 0 };
          });
        }
        try {
          const sumRes = await fetch(`/api/attendance/summary?year=${currentYear}`);
          const sumData = await sumRes.json();
          if (sumRes.ok && sumData.data) {
            sumData.data.forEach(row => {
              const eid = row.employee_id;
              const used = parseInt(row.total_privilege_leave) || 0;
              if (plMap[eid]) plMap[eid].used += used;
              else plMap[eid] = { total: 0, used };
            });
          }
        } catch {}
        setPlData(plMap);
      } catch {}
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [daysInMonth, fetchHolidays, currentMonth, currentYear]);

  // ──────────────── Load saved daily attendance (employee_attendance) ────────────────
  const loadSavedAttendance = useCallback(async () => {
    if (employees.length === 0) return;
    try {
      const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
      const res = await fetch(`/api/attendance?month=${monthKey}`);
      const data = await res.json();
      if (res.ok && data.summary && data.summary.length > 0) {
        setGridData(prev => {
          const updated = { ...prev };
          data.summary.forEach(empSummary => {
            Object.entries(empSummary.days).forEach(([dateKey, dayData]) => {
              const key = `${empSummary.employee_id}|${dateKey}`;
              if (updated[key]) {
                const formatTime = (t) => t ? t.toString().substring(0, 5) : '';
                updated[key] = {
                  status: dayData.status || updated[key].status,
                  inTime: formatTime(dayData.in_time) || updated[key].inTime,
                  outTime: formatTime(dayData.out_time) || updated[key].outTime,
                  otHours: parseFloat(dayData.overtime_hours || 0)
                };
              }
            });
          });
          return updated;
        });
      }
    } catch (err) {
      console.error('Error loading saved attendance:', err);
    }
  }, [currentYear, currentMonth, employees.length]);

  // ──────────────── Fetch monthly attendance data ────────────────
  const fetchMonthly = useCallback(async () => {
    setMonthlyLoading(true);
    try {
      const res = await fetch(`/api/attendance/monthly?month=${currentMonth + 1}&year=${currentYear}`);
      const data = await res.json();
      if (res.ok && data.data) {
        setMonthlyData(data.data);
        setMarkedEmployeeIds(new Set(data.markedEmployeeIds || []));
      } else {
        setMonthlyData([]);
        setMarkedEmployeeIds(new Set());
      }
    } catch { }
    finally { setMonthlyLoading(false); }
  }, [currentMonth, currentYear]);

  // ── Effects ──
  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);
  useEffect(() => { 
    if (employees.length > 0) loadSavedAttendance(); 
  }, [employees.length, loadSavedAttendance, currentMonth, currentYear]);
  useEffect(() => { fetchMonthly(); }, [fetchMonthly]);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const h = () => setCtxMenu(null);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [ctxMenu]);

  // ──────────────── Grid operations ────────────────
  const updateCell = (empId, fullDate, field, value) => {
    const key = `${empId}|${fullDate}`;
    setGridData(prev => {
      const currentCell = prev[key] || {};
      const updatedCell = { ...currentCell, [field]: value };
      
      // Auto-calculate OT when in/out time changes
      if (field === 'inTime' || field === 'outTime') {
        const inTime = field === 'inTime' ? value : currentCell.inTime;
        const outTime = field === 'outTime' ? value : currentCell.outTime;
        updatedCell.otHours = calculateOTHours(inTime, outTime);
      }
      
      return {
        ...prev,
        [key]: updatedCell
      };
    });
    setDirtyKeys(prev => new Set([...prev, key]));
  };

  const cycleStatus = (empId, fullDate) => {
    const key = `${empId}|${fullDate}`;
    const current = gridData[key]?.status || 'P';
    const idx = STATUS_OPTIONS.indexOf(current);
    const next = STATUS_OPTIONS[(idx + 1) % STATUS_OPTIONS.length];
    updateCell(empId, fullDate, 'status', next);
  };

  const openCtxMenu = (e, empId, fullDate) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, empId, fullDate });
  };

  const pickStatus = (status) => {
    if (!ctxMenu) return;
    updateCell(ctxMenu.empId, ctxMenu.fullDate, 'status', status);
    setCtxMenu(null);
  };

  // ──────────────── Navigation ────────────────
  const goToPrev = () => setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  const goToNext = () => setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  const goToNow = () => setCurrentDate(new Date());

  // ──────────────── Bulk time ────────────────
  const applyBulkTime = () => {
    setGridData(prev => {
      const updated = { ...prev };
      const dirty = new Set(dirtyKeys);
      Object.keys(updated).forEach(key => {
        const cell = updated[key];
        if (cell.status === 'P' || cell.status === 'HD' || cell.status === 'OT') {
          updated[key] = { ...cell, inTime: bulkTime.inTime, outTime: bulkTime.outTime };
          dirty.add(key);
        }
      });
      setDirtyKeys(dirty);
      return updated;
    });
    setShowBulkTimeModal(false);
    setSuccess('In/Out time applied to all present/HD/OT days');
    setTimeout(() => setSuccess(''), 3000);
  };

  // ──────────────── Save daily attendance ────────────────
  const saveAttendance = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
      const records = [];

      // Always save ALL grid data (not just dirty keys) to ensure complete attendance record
      const keysToSave = Object.keys(gridData);

      keysToSave.forEach(key => {
        const cell = gridData[key];
        if (!cell || !cell.status || cell.status === '-') return;
        const [empIdStr, dateKey] = key.split('|');
        records.push({
          employee_id: parseInt(empIdStr),
          attendance_date: dateKey,
          status: cell.status,
          overtime_hours: cell.otHours || 0,
          is_weekly_off: cell.status === 'WO',
          in_time: cell.inTime || null,
          out_time: cell.outTime || null,
          idle_time: 0
        });
      });

      if (records.length === 0) {
        setError('No attendance records to save');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_records: records, month: monthKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setSuccess(`Saved ${data.successCount || records.length} records`);
      setDirtyKeys(new Set());
      setTimeout(() => setSuccess(''), 3000);
      fetchMonthly();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ━━━━━━━━━━━━━━━ Monthly tab helpers ━━━━━━━━━━━━━━━
  const getCellValue = (rowId, field, orig) => {
    if (editedRows[rowId]?.[field] !== undefined) return editedRows[rowId][field];
    return orig;
  };

  const handleMonthlyChange = (rowId, field, raw) => {
    const v = raw === '' ? 0 : parseFloat(raw) || 0;
    setEditedRows(prev => ({ ...prev, [rowId]: { ...(prev[rowId] || {}), [field]: v } }));
    setMonthlyDirty(true);
  };

  const saveMonthlyChanges = async () => {
    if (!monthlyDirty || Object.keys(editedRows).length === 0) return;
    setMonthlySaving(true);
    setError('');
    try {
      const promises = Object.entries(editedRows).map(async ([rowId, changes]) => {
        const row = monthlyData.find(r => String(r.id) === String(rowId));
        if (!row) return;
        const g = (f) => changes[f] !== undefined ? changes[f] : parseFloat(row[f]) || 0;
        const payable = changes.payable_days !== undefined
          ? changes.payable_days
          : g('present_days') + g('half_days') * 0.5 + g('privileged_leave') + g('sick_leave') + g('casual_leave');
        const res = await fetch('/api/attendance/monthly', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: parseInt(rowId), ...changes, payable_days: payable })
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      });
      await Promise.all(promises);
      setEditedRows({});
      setMonthlyDirty(false);
      setSuccess('Monthly attendance saved');
      setTimeout(() => setSuccess(''), 3000);
      fetchMonthly();
    } catch (err) { setError(err.message); }
    finally { setMonthlySaving(false); }
  };

  const addEmployeeMonthly = async () => {
    if (!newRow.employee_id) { setError('Select an employee'); return; }
    setMonthlySaving(true);
    setError('');
    try {
      const payload = {
        employee_id: parseInt(newRow.employee_id),
        month: currentMonth + 1,
        year: currentYear,
        present_days: parseFloat(newRow.present_days) || 0,
        absent_days: parseFloat(newRow.absent_days) || 0,
        half_days: parseFloat(newRow.half_days) || 0,
        holidays: parseFloat(newRow.holidays) || 0,
        weekly_offs: parseFloat(newRow.weekly_offs) || 0,
        overtime_hours: parseFloat(newRow.overtime_hours) || 0,
        privileged_leave: parseFloat(newRow.privileged_leave) || 0,
        sick_leave: parseFloat(newRow.sick_leave) || 0,
        casual_leave: parseFloat(newRow.casual_leave) || 0,
        lop_days: parseFloat(newRow.lop_days) || 0,
        payable_days: newRow.payable_days ? parseFloat(newRow.payable_days) : null,
        remarks: newRow.remarks || ''
      };
      const res = await fetch('/api/attendance/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setShowAddModal(false);
      setNewRow({
        employee_id: '', present_days: '', absent_days: '', half_days: '',
        holidays: '', weekly_offs: '', overtime_hours: '', privileged_leave: '',
        sick_leave: '', casual_leave: '', lop_days: '', payable_days: '', remarks: ''
      });
      setSuccess('Employee added');
      setTimeout(() => setSuccess(''), 3000);
      fetchMonthly();
    } catch (err) { setError(err.message); }
    finally { setMonthlySaving(false); }
  };

  const deleteMonthlyRecord = async (id) => {
    if (!confirm('Remove this record?')) return;
    try {
      const res = await fetch(`/api/attendance/monthly?id=${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      setSuccess('Record removed');
      setTimeout(() => setSuccess(''), 3000);
      fetchMonthly();
    } catch (err) { setError(err.message); }
  };

  // ──────────────── Computed / memos ────────────────
  const unmarkedOptions = useMemo(() => employees.filter(e => !markedEmployeeIds.has(e.id)), [employees, markedEmployeeIds]);

  const filteredEmployees = useMemo(() => {
    let list = employees;
    if (viewMode === 'grid') {
      list = list.filter(e => !markedEmployeeIds.has(e.id));
    }
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(e =>
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
      (e.employee_id || '').toLowerCase().includes(q)
    );
  }, [employees, searchQuery, viewMode, markedEmployeeIds]);

  const filteredMonthly = useMemo(() => {
    if (!searchQuery) return monthlyData;
    const q = searchQuery.toLowerCase();
    return monthlyData.filter(r =>
      `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
      (r.employee_code || '').toLowerCase().includes(q)
    );
  }, [monthlyData, searchQuery]);

  // Per-employee summary stats from grid
  const empSummary = useCallback((empId) => {
    let p = 0, a = 0, wo = 0, h = 0, ot = 0, lwp = 0, pl = 0, cl = 0, sl = 0, hd = 0, totalOtHrs = 0, totalHrs = 0;
    daysInMonth.forEach(day => {
      const cell = gridData[`${empId}|${day.fullDate}`];
      if (!cell) return;
      const s = cell.status;
      if (s === 'P') p++;
      else if (s === 'A') a++;
      else if (s === 'WO') wo++;
      else if (s === 'H') h++;
      else if (s === 'OT') { ot++; }
      else if (s === 'LWP') lwp++;
      else if (s === 'PL') pl++;
      else if (s === 'CL') cl++;
      else if (s === 'SL') sl++;
      else if (s === 'HD') hd++;
      totalOtHrs += (cell.otHours || 0);
      // Calculate total hours from in/out time
      if (cell.inTime && cell.outTime) {
        totalHrs += calculateTotalHours(cell.inTime, cell.outTime);
      }
    });
    return { p, a, wo, h, ot, lwp, pl, cl, sl, hd, totalOtHrs, totalHrs };
  }, [daysInMonth, gridData]);

  const openCellModal = (emp, fullDate) => {
    const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'N/A';
    setCellModal({ empId: emp.id, fullDate, empName });
  };

  const closeCellModal = () => setCellModal(null);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-[1920px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/employees" className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
                <ArrowLeftIcon className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <CalendarDaysIcon className="h-6 w-6 text-gray-700" />
                  Attendance
                </h1>
                <p className="text-gray-500 text-xs mt-0.5">
                  Click to cycle status &middot; Right-click to pick &middot; Double-click for in/out time &amp; OT
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-center">
              <div className="px-4 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                <div className="text-lg font-semibold text-gray-900">{employees.length}</div>
                <div className="text-[10px] text-gray-500">Employees</div>
              </div>
              <div className="px-4 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                <div className="text-lg font-semibold text-gray-900">{daysInMonth.length}</div>
                <div className="text-[10px] text-gray-500">Days</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Controls Bar ── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-[1920px] mx-auto px-6 py-2.5">
          <div className="flex items-center justify-between gap-3">
            {/* Month nav */}
            <div className="flex items-center gap-2">
              <div className="flex items-center border border-gray-200 rounded-lg">
                <button onClick={goToPrev} className="p-2 hover:bg-gray-50 rounded-l-lg border-r border-gray-200">
                  <ChevronLeftIcon className="h-4 w-4 text-gray-600" />
                </button>
                <div className="px-4 py-1.5 min-w-[150px] text-center">
                  <span className="font-medium text-sm text-gray-900">{monthName}</span>
                </div>
                <button onClick={goToNext} className="p-2 hover:bg-gray-50 rounded-r-lg border-l border-gray-200">
                  <ChevronRightIcon className="h-4 w-4 text-gray-600" />
                </button>
              </div>
              <button onClick={goToNow} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200">Today</button>
            </div>

            {/* Search */}
            <div className="flex-1 max-w-xs">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input type="text" placeholder="Search employee..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-300" />
              </div>
            </div>

            {/* View toggle */}
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === 'grid' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                Daily Grid
              </button>
              <button onClick={() => setViewMode('monthly')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                Monthly
                <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${viewMode === 'monthly' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>{monthlyData.length}</span>
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {viewMode === 'grid' && (
                <>
                  <button onClick={() => setShowBulkTimeModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50">
                    <ClockIcon className="h-3.5 w-3.5" /> Bulk In/Out
                  </button>
                  <button onClick={saveAttendance} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
                    {saving ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <CheckCircleIcon className="h-3.5 w-3.5" />}
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </>
              )}
              {viewMode === 'monthly' && (
                <>
                  {monthlyDirty && (
                    <button onClick={saveMonthlyChanges} disabled={monthlySaving} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                      {monthlySaving ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <CheckCircleIcon className="h-3.5 w-3.5" />}
                      Save Changes
                    </button>
                  )}
                  <button onClick={() => setShowAddModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800">
                    <PlusIcon className="h-3.5 w-3.5" /> Add Employee
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status messages */}
      {(error || success) && (
        <div className="max-w-[1920px] mx-auto px-6 pt-3">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <ExclamationCircleIcon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError('')} className="hover:bg-red-100 p-1 rounded"><XMarkIcon className="h-4 w-4" /></button>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
              <CheckCircleSolid className="h-4 w-4 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="max-w-[1920px] mx-auto px-6 py-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          <span className="text-[10px] text-gray-400 mr-1">Legend:</span>
          {STATUS_OPTIONS.map(code => {
            const s = STATUS_STYLES[code];
            return (
              <div key={code} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded flex-shrink-0">
                <span className={`w-4 h-4 ${s.bg} ${s.text} border ${s.border} rounded flex items-center justify-center text-[8px] font-bold`}>{s.label}</span>
                <span className="text-[10px] text-gray-500">{s.full}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ════════════════ MAIN CONTENT ════════════════ */}
      <div className="max-w-[1920px] mx-auto px-6 pb-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
            <span className="mt-3 text-sm text-gray-500">Loading...</span>
          </div>
        ) : viewMode === 'grid' ? (
          /* ═══════ DAILY GRID VIEW ═══════ */
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="sticky left-0 z-20 bg-gray-50 px-2 py-2 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider min-w-[70px] border-r border-gray-200">Code</th>
                    <th className="sticky left-[70px] z-20 bg-gray-50 px-2 py-2 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider min-w-[140px] border-r border-gray-200">Name</th>
                    {daysInMonth.map(day => (
                      <th key={day.fullDate} className={`px-0 py-1.5 text-center min-w-[30px] ${day.isToday ? 'bg-purple-50' : 'bg-gray-50'}`}>
                        <div className={`text-[8px] font-medium uppercase ${day.isSun ? 'text-red-400' : day.isSat ? 'text-amber-500' : 'text-gray-400'}`}>{day.dayName.charAt(0)}</div>
                        <div className={`text-[10px] font-medium ${day.isToday ? 'text-gray-900 font-bold' : day.isSun ? 'text-red-500' : day.isSat ? 'text-amber-600' : 'text-gray-600'}`}>{day.date}</div>
                      </th>
                    ))}
                    {/* Summary columns */}
                    <th className="px-1 py-2 text-center text-[9px] font-medium text-emerald-600 bg-emerald-50 border-l border-gray-200 min-w-[28px]">P</th>
                    <th className="px-1 py-2 text-center text-[9px] font-medium text-red-600 bg-red-50 min-w-[28px]">A</th>
                    <th className="px-1 py-2 text-center text-[9px] font-medium text-gray-500 bg-gray-50 min-w-[28px]">WO</th>
                    <th className="px-1 py-2 text-center text-[9px] font-medium text-amber-600 bg-amber-50 min-w-[28px]">H</th>
                    <th className="px-1 py-2 text-center text-[9px] font-medium text-blue-600 bg-blue-50 min-w-[38px]">Total h</th>
                    <th className="px-1 py-2 text-center text-[9px] font-medium text-violet-600 bg-violet-50 min-w-[30px]">OT h</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredEmployees.map((emp, idx) => {
                    const stats = empSummary(emp.id);
                    return (
                      <React.Fragment key={emp.id}>
                        {/* Main status row */}
                        <tr className={`group hover:bg-gray-50/80 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                          {/* Code */}
                          <td className="sticky left-0 z-10 bg-inherit px-2 py-1 border-r border-gray-100 group-hover:bg-gray-50">
                            <span className="font-mono text-[10px] text-gray-600">{emp.employee_id || `EMP${String(emp.id).padStart(3, '0')}`}</span>
                          </td>
                          {/* Name */}
                          <td className="sticky left-[70px] z-10 bg-inherit px-2 py-1 border-r border-gray-200 group-hover:bg-gray-50">
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-[9px] font-medium flex-shrink-0">
                                {(emp.first_name?.[0] || 'E').toUpperCase()}
                              </div>
                              <span className="text-[11px] text-gray-900 truncate max-w-[100px]">
                                {`${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'N/A'}
                              </span>
                            </div>
                          </td>
                          {/* Day cells */}
                          {daysInMonth.map(day => {
                            const key = `${emp.id}|${day.fullDate}`;
                            const cell = gridData[key];
                            const status = cell?.status || '-';
                            const st = getStyle(status);
                            const isDirty = dirtyKeys.has(key);
                            return (
                              <td key={day.fullDate} className={`px-0.5 py-0.5 text-center ${day.isToday ? 'bg-purple-50/50' : day.isSun ? 'bg-red-50/20' : day.isSat ? 'bg-amber-50/20' : ''}`}>
                                <button
                                  onClick={() => openCellModal(emp, day.fullDate)}
                                  onContextMenu={(e) => openCtxMenu(e, emp.id, day.fullDate)}
                                  className={`w-[22px] h-[22px] rounded text-[8px] font-bold border ${st.bg} ${st.text} ${st.border} hover:scale-110 hover:shadow-sm transition-all ${day.isToday ? 'ring-1 ring-purple-400' : ''} ${isDirty ? 'ring-1 ring-yellow-400' : ''}`}
                                  title={`${st.full} — Click: mark attendance, Right-click: quick pick`}
                                >
                                  {st.label}
                                </button>
                              </td>
                            );
                          })}
                          {/* Summary */}
                          <td className="px-1 py-1 text-center border-l border-gray-100"><span className="text-[10px] font-medium text-emerald-600">{stats.p}</span></td>
                          <td className="px-1 py-1 text-center"><span className="text-[10px] font-medium text-red-600">{stats.a}</span></td>
                          <td className="px-1 py-1 text-center"><span className="text-[10px] font-medium text-gray-500">{stats.wo}</span></td>
                          <td className="px-1 py-1 text-center"><span className="text-[10px] font-medium text-amber-600">{stats.h}</span></td>
                          <td className="px-1 py-1 text-center"><span className="text-[10px] font-semibold text-blue-600">{stats.totalHrs > 0 ? stats.totalHrs.toFixed(1) : '0'}</span></td>
                          <td className="px-1 py-1 text-center"><span className="text-[10px] font-semibold text-violet-600">{stats.totalOtHrs > 0 ? stats.totalOtHrs.toFixed(1) : '0'}</span></td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bg-gray-50 px-4 py-2 border-t border-gray-200 flex items-center justify-between text-[10px] text-gray-500">
              <span>{filteredEmployees.length} employee{filteredEmployees.length !== 1 ? 's' : ''}</span>
              <span>{dirtyKeys.size > 0 ? `${dirtyKeys.size} unsaved changes` : monthName}</span>
            </div>
          </div>
        ) : (
          /* ═══════ MONTHLY VIEW ═══════ */
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {monthlyLoading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-7 h-7 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
                <span className="mt-3 text-sm text-gray-500">Loading...</span>
              </div>
            ) : filteredMonthly.length === 0 ? (
              <div className="text-center py-16">
                <CalendarDaysIcon className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500 mb-3">No records for {monthName}.</p>
                <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
                  <PlusIcon className="h-4 w-4" /> Add Employee
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                      <th className="px-3 py-2.5 text-left sticky left-0 bg-gray-50 border-r border-gray-200 min-w-[90px]">Code</th>
                      <th className="px-3 py-2.5 text-left sticky left-[90px] bg-gray-50 border-r border-gray-200 min-w-[160px]">Name</th>
                      <th className="px-2 py-2.5 text-center bg-emerald-50 text-emerald-700 min-w-[55px]">Present</th>
                      <th className="px-2 py-2.5 text-center bg-red-50 text-red-600 min-w-[55px]">Absent</th>
                      <th className="px-2 py-2.5 text-center min-w-[45px]">HD</th>
                      <th className="px-2 py-2.5 text-center bg-amber-50 text-amber-700 min-w-[45px]">H</th>
                      <th className="px-2 py-2.5 text-center bg-gray-100 min-w-[45px]">WO</th>
                      <th className="px-2 py-2.5 text-center bg-violet-50 text-violet-700 min-w-[45px]">OT</th>
                      <th className="px-2 py-2.5 text-center bg-blue-50 text-blue-700 min-w-[45px]">PL</th>
                      <th className="px-2 py-2.5 text-center bg-pink-50 text-pink-700 min-w-[45px]">SL</th>
                      <th className="px-2 py-2.5 text-center bg-cyan-50 text-cyan-700 min-w-[45px]">CL</th>
                      <th className="px-2 py-2.5 text-center bg-rose-50 text-rose-700 min-w-[45px]">LWP</th>
                      <th className="px-2 py-2.5 text-center bg-green-50 text-green-700 min-w-[65px]">Payable</th>
                      <th className="px-2 py-2.5 text-center min-w-[32px]"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredMonthly.map((row, idx) => {
                      const rid = row.id;
                      const isEd = !!editedRows[rid];

                      const eCell = (field, orig, color = 'text-gray-700') => {
                        const val = getCellValue(rid, field, orig);
                        const wasEd = isEd && editedRows[rid][field] !== undefined;
                        return (
                          <input type="number" step="0.5" min="0" value={val}
                            onChange={e => handleMonthlyChange(rid, field, e.target.value)}
                            className={`w-12 text-center text-xs font-medium border border-transparent hover:border-gray-300 focus:border-gray-400 focus:ring-1 focus:ring-gray-300 rounded px-0.5 py-0.5 bg-transparent transition-all ${color} ${wasEd ? 'bg-yellow-50 border-yellow-300' : ''}`}
                          />
                        );
                      };

                      const pD = parseFloat(getCellValue(rid, 'present_days', row.present_days) || 0);
                      const hD = parseFloat(getCellValue(rid, 'half_days', row.half_days) || 0);
                      const plD = parseFloat(getCellValue(rid, 'privileged_leave', row.privileged_leave) || 0);
                      const slD = parseFloat(getCellValue(rid, 'sick_leave', row.sick_leave) || 0);
                      const clD = parseFloat(getCellValue(rid, 'casual_leave', row.casual_leave) || 0);
                      const payable = (pD + hD * 0.5 + plD + slD + clD).toFixed(1);

                      return (
                        <tr key={rid} className={`hover:bg-gray-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} ${isEd ? 'ring-1 ring-inset ring-yellow-200' : ''}`}>
                          <td className="px-3 py-1.5 sticky left-0 bg-inherit border-r border-gray-100">
                            <span className="font-mono text-[11px] text-gray-600">{row.employee_code}</span>
                          </td>
                          <td className="px-3 py-1.5 sticky left-[90px] bg-inherit border-r border-gray-200">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-[10px] font-medium flex-shrink-0">
                                {(row.first_name?.[0] || 'E').toUpperCase()}
                              </div>
                              <span className="text-xs text-gray-900 truncate max-w-[120px]">{`${row.first_name || ''} ${row.last_name || ''}`.trim()}</span>
                            </div>
                          </td>
                          <td className="px-1 py-1 text-center">{eCell('present_days', row.present_days, 'text-emerald-600')}</td>
                          <td className="px-1 py-1 text-center">{eCell('absent_days', row.absent_days, 'text-red-600')}</td>
                          <td className="px-1 py-1 text-center">{eCell('half_days', row.half_days, 'text-yellow-600')}</td>
                          <td className="px-1 py-1 text-center">{eCell('holidays', row.holidays, 'text-amber-600')}</td>
                          <td className="px-1 py-1 text-center">{eCell('weekly_offs', row.weekly_offs, 'text-gray-500')}</td>
                          <td className="px-1 py-1 text-center">{eCell('overtime_hours', row.overtime_hours, 'text-violet-600')}</td>
                          <td className="px-1 py-1 text-center">{eCell('privileged_leave', row.privileged_leave, 'text-blue-600')}</td>
                          <td className="px-1 py-1 text-center">{eCell('sick_leave', row.sick_leave, 'text-pink-600')}</td>
                          <td className="px-1 py-1 text-center">{eCell('casual_leave', row.casual_leave, 'text-cyan-600')}</td>
                          <td className="px-1 py-1 text-center">{eCell('lop_days', row.lop_days, 'text-rose-600')}</td>
                          <td className="px-1 py-1.5 text-center">
                            <span className="text-xs font-semibold text-green-700">{payable}</span>
                          </td>
                          <td className="px-1 py-1.5 text-center">
                            <button onClick={() => deleteMonthlyRecord(rid)} className="p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded" title="Remove">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="bg-gray-50 px-4 py-2 border-t border-gray-200 flex items-center justify-between text-[10px] text-gray-500">
              <span>{filteredMonthly.length} employee{filteredMonthly.length !== 1 ? 's' : ''}</span>
              <span>{monthName}</span>
            </div>
          </div>
        )}

        {!loading && employees.length === 0 && (
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
            <UserGroupIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No Employees Found</h3>
            <p className="text-sm text-gray-500 mb-4">Add employees to start tracking attendance.</p>
            <Link href="/employees" className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
              <ArrowLeftIcon className="h-4 w-4" /> Go to Employees
            </Link>
          </div>
        )}
      </div>

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div ref={ctxRef}
          className="fixed z-[100] bg-white border border-gray-200 rounded-lg shadow-lg p-1 min-w-[120px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={e => e.stopPropagation()}>
          <div className="text-[9px] text-gray-400 px-2 py-1 font-medium uppercase">Set Status</div>
          {STATUS_OPTIONS.map(code => {
            const s = STATUS_STYLES[code];
            return (
              <button key={code} onClick={() => pickStatus(code)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-gray-50 rounded transition-colors text-left">
                <span className={`w-5 h-5 ${s.bg} ${s.text} border ${s.border} rounded flex items-center justify-center text-[8px] font-bold`}>{s.label}</span>
                <span className="text-gray-700">{s.full}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Add Employee Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/40" onClick={() => setShowAddModal(false)} />
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg">
              <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <PlusIcon className="h-4 w-4 text-gray-600" /> Add Employee &mdash; {monthName}
                </h3>
                <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><XMarkIcon className="h-4 w-4 text-gray-500" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Employee</label>
                  <select value={newRow.employee_id} onChange={e => setNewRow({ ...newRow, employee_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300">
                    <option value="">Select employee...</option>
                    {unmarkedOptions.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.employee_id} &mdash; {emp.first_name} {emp.last_name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-4 gap-2.5">
                  {[
                    { f: 'present_days', l: 'Present', c: 'text-emerald-600' },
                    { f: 'absent_days', l: 'Absent', c: 'text-red-600' },
                    { f: 'half_days', l: 'Half Days', c: 'text-yellow-600' },
                    { f: 'holidays', l: 'Holidays', c: 'text-amber-600' },
                    { f: 'weekly_offs', l: 'Weekly Off', c: 'text-gray-600' },
                    { f: 'overtime_hours', l: 'OT Hours', c: 'text-violet-600' },
                    { f: 'privileged_leave', l: 'PL', c: 'text-blue-600' },
                    { f: 'sick_leave', l: 'SL', c: 'text-pink-600' },
                    { f: 'casual_leave', l: 'CL', c: 'text-cyan-600' },
                    { f: 'lop_days', l: 'LWP', c: 'text-rose-600' },
                    { f: 'payable_days', l: 'Payable', c: 'text-green-600' },
                  ].map(({ f, l, c }) => (
                    <div key={f}>
                      <label className={`block text-[10px] font-medium mb-0.5 ${c}`}>{l}</label>
                      <input type="number" step="0.5" min="0" value={newRow[f]}
                        onChange={e => setNewRow({ ...newRow, [f]: e.target.value })} placeholder="0"
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
                <button onClick={() => setShowAddModal(false)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={addEmployeeMonthly} disabled={monthlySaving} className="px-3 py-1.5 text-xs bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
                  {monthlySaving ? 'Adding...' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Cell Detail Modal (In/Out Time & OT) ── */}
      {cellModal && (() => {
        const key = `${cellModal.empId}|${cellModal.fullDate}`;
        const cell = gridData[key] || { status: 'P', inTime: '', outTime: '', otHours: 0 };
        const st = getStyle(cell.status);
        const dayObj = daysInMonth.find(d => d.fullDate === cellModal.fullDate);
        const dateLabel = dayObj
          ? new Date(cellModal.fullDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
          : cellModal.fullDate;
        return (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <div className="fixed inset-0 bg-black/40" onClick={closeCellModal} />
              <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm">
                <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{cellModal.empName}</h3>
                    <p className="text-xs text-gray-500">{dateLabel}</p>
                  </div>
                  <button onClick={closeCellModal} className="p-1 hover:bg-gray-100 rounded-lg"><XMarkIcon className="h-4 w-4 text-gray-500" /></button>
                </div>
                <div className="p-5 space-y-4">
                  {/* Status picker */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Status</label>
                    <div className="flex flex-wrap gap-1.5">
                      {STATUS_OPTIONS.map(code => {
                        const s = STATUS_STYLES[code];
                        const active = cell.status === code;
                        return (
                          <button key={code} onClick={() => updateCell(cellModal.empId, cellModal.fullDate, 'status', code)}
                            className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-all ${active ? `${s.bg} ${s.text} ${s.border} ring-2 ring-offset-1 ring-gray-400` : `bg-white text-gray-500 border-gray-200 hover:${s.bg} hover:${s.text}`}`}>
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Time inputs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-blue-600 mb-1 flex items-center gap-1"><ClockIcon className="h-3 w-3" /> In Time</label>
                      <input type="time" value={cell.inTime || ''}
                        onChange={e => updateCell(cellModal.empId, cellModal.fullDate, 'inTime', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-orange-600 mb-1 flex items-center gap-1"><ClockIcon className="h-3 w-3" /> Out Time</label>
                      <input type="time" value={cell.outTime || ''}
                        onChange={e => updateCell(cellModal.empId, cellModal.fullDate, 'outTime', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-300 focus:border-orange-400" />
                    </div>
                  </div>
                  {/* OT Hours - Auto-calculated */}
                  <div>
                    <label className="block text-xs font-medium text-violet-600 mb-1 flex items-center gap-1">
                      Overtime Hours
                      <span className="text-[10px] text-gray-400 font-normal">(auto-calculated)</span>
                    </label>
                    <div className="w-full px-3 py-2 text-sm bg-violet-50 border border-violet-200 rounded-lg text-violet-700 font-medium">
                      {cell.otHours || 0} hrs
                      {cell.inTime && cell.outTime && (
                        <span className="text-[10px] text-violet-500 ml-2">
                          (based on {cell.inTime} → {cell.outTime}, 8hr standard)
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Current status badge */}
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 text-xs font-bold rounded ${st.bg} ${st.text} border ${st.border}`}>{st.label}</span>
                      <span className="text-xs text-gray-500">{st.full}</span>
                    </div>
                    {cell.inTime && cell.outTime && (
                      <span className="text-[10px] text-gray-400">{cell.inTime} &rarr; {cell.outTime}</span>
                    )}
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
                  <button onClick={closeCellModal} className="px-4 py-1.5 text-xs bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800">Done</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Bulk Time Modal ── */}
      {showBulkTimeModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/40" onClick={() => setShowBulkTimeModal(false)} />
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-sm">
              <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <ClockIcon className="h-4 w-4 text-gray-600" /> Set Bulk In/Out Time
                </h3>
                <button onClick={() => setShowBulkTimeModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><XMarkIcon className="h-4 w-4 text-gray-500" /></button>
              </div>
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">In Time</label>
                    <input type="time" value={bulkTime.inTime} onChange={e => setBulkTime({ ...bulkTime, inTime: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Out Time</label>
                    <input type="time" value={bulkTime.outTime} onChange={e => setBulkTime({ ...bulkTime, outTime: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300" />
                  </div>
                </div>
                <p className="text-xs text-gray-400">Applies to all employees&apos; present, half-day, and OT days.</p>
              </div>
              <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
                <button onClick={() => setShowBulkTimeModal(false)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={applyBulkTime} className="px-3 py-1.5 text-xs bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800">Apply</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
