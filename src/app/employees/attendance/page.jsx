'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { 
  ArrowLeftIcon, 
  CalendarDaysIcon,
  UserGroupIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

export default function EmployeeAttendancePage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // PL (Privilege Leave) data per employee from salary profiles
  const [plData, setPlData] = useState({});
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [modalData, setModalData] = useState({
    attendanceType: 'P',
    startDate: '',
    endDate: '',
    inTime: '09:00',
    outTime: '17:30',
    idleTime: 0,
    reason: ''
  });
  
  // Bulk time modal state
  const [showBulkTimeModal, setShowBulkTimeModal] = useState(false);
  const [bulkTimeData, setBulkTimeData] = useState({
    inTime: '09:00',
    outTime: '17:30'
  });

  // Current month/year for calendar
  const [currentDate, setCurrentDate] = useState(new Date());
  const [attendanceData, setAttendanceData] = useState({});
  
  // Get current month's days
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  
  // Generate days of the month with week info
  const daysInMonth = useMemo(() => {
    const days = [];
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(currentYear, currentMonth, d);
      const dayOfWeek = date.getDay();
      const weekNumber = Math.ceil((d + firstDay.getDay()) / 7);
      
      days.push({
        date: d,
        fullDate: date.toISOString().split('T')[0],
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dayOfWeek,
        weekNumber,
        isSunday: dayOfWeek === 0,
        isSaturday: dayOfWeek === 6,
        isToday: date.toDateString() === new Date().toDateString()
      });
    }
    return days;
  }, [currentYear, currentMonth]);

  // Fetch holidays for the current month
  const fetchHolidays = useCallback(async () => {
    try {
      const res = await fetch(`/api/masters/holidays?year=${currentYear}`);
      const data = await res.json();
      if (res.ok && data.data) {
        return data.data;
      }
      return [];
    } catch (err) {
      console.error('Error fetching holidays:', err);
      return [];
    }
  }, [currentYear]);

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const holidayList = await fetchHolidays();
      
      const holidayDates = new Set(
        holidayList
          .filter(h => {
            const hDate = new Date(h.date);
            return hDate.getMonth() === currentMonth && hDate.getFullYear() === currentYear;
          })
          .map(h => h.date.split('T')[0])
      );
      
      const res = await fetch('/api/employees?limit=1000&status=active');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch employees');
      
      const employeeList = data.employees || data.data || [];
      setEmployees(employeeList);
      
      const initialAttendance = {};
      employeeList.forEach(emp => {
        initialAttendance[emp.id] = {
          ...emp,
          days: {},
          dayDetails: {},
          overtime: 0,
          weeklyOff: 0,
          present: 0,
          absent: 0,
          privilegedLeave: 0,
          casualLeave: 0,
          sickLeave: 0,
          lwp: 0,
          halfDay: 0,
          holiday: 0,
          monthlyHours: 0,
          stdInTime: '09:00',
          stdOutTime: '17:30'
        };
        
        // Build weekly off dates: All Sundays + 2nd & 4th Saturdays
        const sundays = daysInMonth.filter(d => d.isSunday && !holidayDates.has(d.fullDate));
        const saturdaysForWO = daysInMonth
          .filter(d => d.isSaturday && !holidayDates.has(d.fullDate))
          .filter(d => {
            const satOfMonth = Math.ceil(d.date / 7);
            return satOfMonth === 2 || satOfMonth === 4;
          });
        const woDates = new Set();
        for (const day of sundays) {
          woDates.add(day.fullDate);
        }
        for (const day of saturdaysForWO) {
          woDates.add(day.fullDate);
        }

        daysInMonth.forEach(day => {
          if (holidayDates.has(day.fullDate)) {
            initialAttendance[emp.id].days[day.fullDate] = 'H';
            initialAttendance[emp.id].holiday++;
          } else if (woDates.has(day.fullDate)) {
            initialAttendance[emp.id].days[day.fullDate] = 'WO';
            initialAttendance[emp.id].weeklyOff++;
          } else {
            initialAttendance[emp.id].days[day.fullDate] = 'P';
            initialAttendance[emp.id].present++;
          }
        });
      });
      
      setAttendanceData(initialAttendance);
      
      // Stop loading immediately - attendance grid is ready to display
      setLoading(false);
      
      // Fetch PL data in background (non-blocking) and in parallel
      try {
        const plMap = {};
        
        // 1. Fetch pl_total from salary profiles - in parallel
        const plResults = await Promise.allSettled(
          employeeList.map(async (emp) => {
            const plRes = await fetch(`/api/payroll/salary-profile?employee_id=${emp.id}`);
            const plResult = await plRes.json();
            if (plRes.ok && plResult.data && plResult.data.length > 0) {
              const activeProfile = plResult.data[0];
              return {
                empId: emp.id,
                total: parseInt(activeProfile.pl_total) || 0,
              };
            }
            return null;
          })
        );
        
        plResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            plMap[result.value.empId] = {
              total: result.value.total,
              used: 0,
              balance: result.value.total
            };
          }
        });
        
        // 2. Fetch pl_used from attendance summary API (sum PL days across all months of the year)
        try {
          const summaryRes = await fetch(`/api/attendance/summary?year=${currentYear}`);
          const summaryResult = await summaryRes.json();
          if (summaryRes.ok && summaryResult.data && summaryResult.data.length > 0) {
            summaryResult.data.forEach(row => {
              const empId = row.employee_id;
              const plUsed = parseInt(row.total_privilege_leave) || 0;
              if (plMap[empId]) {
                plMap[empId].used += plUsed;
                plMap[empId].balance = Math.max(0, plMap[empId].total - plMap[empId].used);
              } else {
                plMap[empId] = { total: 0, used: plUsed, balance: 0 };
              }
            });
          }
        } catch (summaryErr) {
          console.error('Error fetching attendance summary for PL:', summaryErr);
        }
        
        setPlData(plMap);
      } catch (plFetchErr) {
        console.error('Error fetching PL data:', plFetchErr);
      }
    } catch (err) {
      console.error('Error fetching employees:', err);
      setError(err.message);
      setLoading(false);
    }
  }, [daysInMonth, fetchHolidays, currentMonth, currentYear]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Open modal for attendance
  const openAttendanceModal = (employeeId, fullDate, currentStatus, employeeName) => {
    const empData = attendanceData[employeeId] || {};
    const dayDetail = empData.dayDetails?.[fullDate] || {};
    setSelectedCell({ employeeId, fullDate, currentStatus, employeeName });
    setModalData({
      attendanceType: currentStatus || 'P',
      startDate: fullDate,
      endDate: fullDate,
      inTime: dayDetail.inTime || empData.stdInTime || '09:00',
      outTime: dayDetail.outTime || empData.stdOutTime || '17:30',
      idleTime: dayDetail.idleTime || 0,
      reason: dayDetail.reason || ''
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedCell(null);
  };

  const handleModalSubmit = () => {
    if (!selectedCell) return;
    
    const { employeeId } = selectedCell;
    const { attendanceType, startDate, endDate, inTime, outTime, idleTime, reason } = modalData;
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // If marking PL, check PL balance and auto-convert to LWP when exhausted
    if (attendanceType === 'PL') {
      const empPl = plData[employeeId] || { total: 0, used: 0, balance: 0 };
      // Count how many PL days the employee currently has marked in this month
      const empData = attendanceData[employeeId] || {};
      const currentMonthPLCount = Object.values(empData.days || {}).filter(s => s === 'PL').length;
      // Available PL balance = total - used from previous months - current month PL already marked
      let availablePL = Math.max(0, empPl.total - empPl.used);
      // Subtract PL already marked this month (since they haven't been saved/synced to summary yet)
      // But empPl.used already includes saved months
      // For current unsaved month, count PL days already in the grid
      let remainingPL = Math.max(0, availablePL - currentMonthPLCount);
      
      // Collect target dates
      const targetDates = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateKey = d.toISOString().split('T')[0];
        if (daysInMonth.some(day => day.fullDate === dateKey)) {
          // Don't re-count days that are already PL
          const existingStatus = empData.days?.[dateKey];
          if (existingStatus === 'PL') {
            // Already PL, no change needed for balance
            targetDates.push({ dateKey, status: 'PL' });
          } else {
            targetDates.push({ dateKey, status: null });
          }
        }
      }
      
      let lwpCount = 0;
      for (const target of targetDates) {
        if (target.status === 'PL') {
          // Already PL, just update details
          updateAttendanceStatus(employeeId, target.dateKey, 'PL', { inTime, outTime, idleTime, reason });
        } else if (remainingPL > 0) {
          updateAttendanceStatus(employeeId, target.dateKey, 'PL', { inTime, outTime, idleTime, reason });
          remainingPL--;
        } else {
          // No PL balance left, mark as LWP
          updateAttendanceStatus(employeeId, target.dateKey, 'LWP', { inTime, outTime, idleTime, reason: reason || 'Auto: PL balance exhausted' });
          lwpCount++;
        }
      }
      
      closeModal();
      if (lwpCount > 0) {
        setSuccess(`Attendance updated for ${selectedCell.employeeName} — ${lwpCount} day(s) marked as LWP (PL balance exhausted)`);
      } else {
        setSuccess(`Attendance updated for ${selectedCell.employeeName}`);
      }
      setTimeout(() => setSuccess(''), 4000);
      return;
    }
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateKey = d.toISOString().split('T')[0];
      if (daysInMonth.some(day => day.fullDate === dateKey)) {
        updateAttendanceStatus(employeeId, dateKey, attendanceType, { inTime, outTime, idleTime, reason });
      }
    }
    
    closeModal();
    setSuccess(`Attendance updated for ${selectedCell.employeeName}`);
    setTimeout(() => setSuccess(''), 3000);
  };

  const updateAttendanceStatus = (employeeId, fullDate, newStatus, extraData = {}) => {
    setAttendanceData(prev => {
      const empData = { ...prev[employeeId] };
      const oldStatus = empData.days[fullDate];
      const oldDayDetail = empData.dayDetails?.[fullDate] || {};
      
      empData.days = { ...empData.days, [fullDate]: newStatus };
      
      const STANDARD_OUT_TIME = 17.5;
      let newOvertimeHours = 0;
      if (extraData.outTime && (newStatus === 'P' || newStatus === 'OT')) {
        const [hours, minutes] = extraData.outTime.split(':').map(Number);
        const outTimeDecimal = hours + (minutes / 60);
        if (outTimeDecimal > STANDARD_OUT_TIME) {
          newOvertimeHours = parseFloat((outTimeDecimal - STANDARD_OUT_TIME).toFixed(2));
        }
      }
      
      empData.dayDetails = { 
        ...empData.dayDetails, 
        [fullDate]: { 
          ...(empData.dayDetails?.[fullDate] || {}), 
          ...extraData, 
          status: newStatus,
          overtimeHours: newOvertimeHours
        } 
      };
      
      const oldOvertimeHours = oldDayDetail.overtimeHours || 0;
      
      // Update counts
      if (oldStatus === 'P') empData.present--;
      if (oldStatus === 'A') empData.absent--;
      if (oldStatus === 'PL') empData.privilegedLeave--;
      if (oldStatus === 'CL') empData.casualLeave = (empData.casualLeave || 1) - 1;
      if (oldStatus === 'SL') empData.sickLeave = (empData.sickLeave || 1) - 1;
      if (oldStatus === 'LWP') empData.lwp = (empData.lwp || 1) - 1;
      if (oldStatus === 'HD') empData.halfDay = (empData.halfDay || 1) - 1;
      if (oldStatus === 'OT' || oldStatus === 'P') empData.overtime = (empData.overtime || oldOvertimeHours) - oldOvertimeHours;
      if (oldStatus === 'WO') empData.weeklyOff--;
      if (oldStatus === 'H') empData.holiday = (empData.holiday || 1) - 1;
      
      if (newStatus === 'P') empData.present++;
      if (newStatus === 'A') empData.absent++;
      if (newStatus === 'PL') empData.privilegedLeave++;
      if (newStatus === 'CL') empData.casualLeave = (empData.casualLeave || 0) + 1;
      if (newStatus === 'SL') empData.sickLeave = (empData.sickLeave || 0) + 1;
      if (newStatus === 'LWP') empData.lwp = (empData.lwp || 0) + 1;
      if (newStatus === 'HD') empData.halfDay = (empData.halfDay || 0) + 1;
      if (newStatus === 'OT' || newStatus === 'P') empData.overtime = (empData.overtime || 0) + newOvertimeHours;
      if (newStatus === 'WO') empData.weeklyOff++;
      if (newStatus === 'H') empData.holiday = (empData.holiday || 0) + 1;
      
      return { ...prev, [employeeId]: empData };
    });
  };

  const getStatusStyle = (status) => {
    const styles = {
      'P': { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'P', fullLabel: 'Present', border: 'border-emerald-200' },
      'A': { bg: 'bg-red-50', text: 'text-red-700', label: 'A', fullLabel: 'Absent', border: 'border-red-200' },
      'PL': { bg: 'bg-blue-50', text: 'text-blue-700', label: 'PL', fullLabel: 'Privilege Leave', border: 'border-blue-200' },
      'OT': { bg: 'bg-violet-50', text: 'text-violet-700', label: 'OT', fullLabel: 'Overtime', border: 'border-violet-200' },
      'WO': { bg: 'bg-gray-100', text: 'text-gray-500', label: 'WO', fullLabel: 'Weekly Off', border: 'border-gray-200' },
      'H': { bg: 'bg-amber-50', text: 'text-amber-700', label: 'H', fullLabel: 'Holiday', border: 'border-amber-200' },
      'HD': { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'HD', fullLabel: 'Half Day', border: 'border-yellow-200' },
      'CL': { bg: 'bg-cyan-50', text: 'text-cyan-700', label: 'CL', fullLabel: 'Casual Leave', border: 'border-cyan-200' },
      'SL': { bg: 'bg-pink-50', text: 'text-pink-700', label: 'SL', fullLabel: 'Sick Leave', border: 'border-pink-200' },
      'LWP': { bg: 'bg-rose-50', text: 'text-rose-700', label: 'LWP', fullLabel: 'Leave Without Pay', border: 'border-rose-200' },
    };
    return styles[status] || { bg: 'bg-gray-50', text: 'text-gray-400', label: '-', fullLabel: 'Not Marked', border: 'border-gray-200' };
  };

  const goToPreviousMonth = () => setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  const goToNextMonth = () => setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  const goToCurrentMonth = () => setCurrentDate(new Date());

  // Apply bulk in/out time to all employees
  const applyBulkTime = () => {
    const { inTime, outTime } = bulkTimeData;
    setAttendanceData(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(empId => {
        const empData = { ...updated[empId] };
        empData.stdInTime = inTime;
        empData.stdOutTime = outTime;
        empData.dayDetails = { ...empData.dayDetails };

        Object.entries(empData.days).forEach(([dateKey, status]) => {
          if (status === 'P' || status === 'HD' || status === 'OT') {
            const STANDARD_OUT_TIME = 17.5;
            let newOvertimeHours = 0;
            if (outTime) {
              const [hours, minutes] = outTime.split(':').map(Number);
              const outTimeDecimal = hours + (minutes / 60);
              if (outTimeDecimal > STANDARD_OUT_TIME) {
                newOvertimeHours = parseFloat((outTimeDecimal - STANDARD_OUT_TIME).toFixed(2));
              }
            }
            empData.dayDetails[dateKey] = {
              ...(empData.dayDetails[dateKey] || {}),
              inTime,
              outTime,
              overtimeHours: newOvertimeHours
            };
          }
        });

        // Recalculate overtime total
        let totalOvertime = 0;
        Object.entries(empData.dayDetails).forEach(([, detail]) => {
          totalOvertime += detail.overtimeHours || 0;
        });
        empData.overtime = parseFloat(totalOvertime.toFixed(2));

        updated[empId] = empData;
      });
      return updated;
    });
    setShowBulkTimeModal(false);
    setSuccess(`In time (${inTime}) and Out time (${outTime}) applied to all employees`);
    setTimeout(() => setSuccess(''), 3000);
  };

  // Save attendance
  const saveAttendance = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const attendance_records = [];
      const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
      const STANDARD_OUT_TIME = 17.5;
      
      const timeToDecimal = (timeStr) => {
        if (!timeStr) return 0;
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours + (minutes / 60);
      };
      
      Object.values(attendanceData).forEach(empData => {
        Object.entries(empData.days).forEach(([dateKey, status]) => {
          if (!status || status === '-') return;
          
          const dayDetail = empData.dayDetails?.[dateKey] || {};
          let overtimeHours = 0;
          if (dayDetail.outTime && (status === 'P' || status === 'OT')) {
            const outTimeDecimal = timeToDecimal(dayDetail.outTime);
            if (outTimeDecimal > STANDARD_OUT_TIME) {
              overtimeHours = parseFloat((outTimeDecimal - STANDARD_OUT_TIME).toFixed(2));
            }
          }
          if (status === 'OT') overtimeHours = 8;
          
          attendance_records.push({
            employee_id: empData.id,
            attendance_date: dateKey,
            status: status,
            overtime_hours: overtimeHours,
            is_weekly_off: status === 'WO',
            in_time: dayDetail.inTime || null,
            out_time: dayDetail.outTime || null,
            idle_time: dayDetail.idleTime || 0
          });
        });
      });

      if (attendance_records.length === 0) {
        setError('No attendance records to save.');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_records, month: monthKey })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save attendance');
      
      setSuccess(`Saved successfully! ${data.successCount} records updated.`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error saving attendance:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };



  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Load saved attendance
  const loadSavedAttendance = useCallback(async () => {
    if (employees.length === 0) return;
    
    try {
      const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
      const res = await fetch(`/api/attendance?month=${monthKey}`);
      const data = await res.json();
      
      if (res.ok && data.summary && data.summary.length > 0) {
        setAttendanceData(prev => {
          const updated = { ...prev };
          data.summary.forEach(empSummary => {
            if (updated[empSummary.employee_id]) {
              Object.entries(empSummary.days).forEach(([dateKey, dayData]) => {
                updated[empSummary.employee_id].days[dateKey] = dayData.status;
                if (!updated[empSummary.employee_id].dayDetails) {
                  updated[empSummary.employee_id].dayDetails = {};
                }
                const formatTime = (time) => time ? time.toString().substring(0, 5) : null;
                updated[empSummary.employee_id].dayDetails[dateKey] = {
                  ...updated[empSummary.employee_id].dayDetails[dateKey],
                  overtimeHours: parseFloat(dayData.overtime_hours || 0),
                  status: dayData.status,
                  inTime: formatTime(dayData.in_time),
                  outTime: formatTime(dayData.out_time),
                  idleTime: dayData.idle_time || 0
                };
              });
              
              let present = 0, absent = 0, pl = 0, cl = 0, sl = 0, lwp = 0, hd = 0, ot = 0, wo = 0, holiday = 0;
              Object.entries(updated[empSummary.employee_id].days).forEach(([dateKey, status]) => {
                const dayDetail = updated[empSummary.employee_id].dayDetails?.[dateKey] || {};
                if (status === 'P') present++;
                if (status === 'A') absent++;
                if (status === 'PL') pl++;
                if (status === 'CL') cl++;
                if (status === 'SL') sl++;
                if (status === 'LWP') lwp++;
                if (status === 'HD') hd++;
                if (status === 'OT' || status === 'P') ot += (dayDetail.overtimeHours || 0);
                if (status === 'WO') wo++;
                if (status === 'H') holiday++;
              });
              updated[empSummary.employee_id].present = present;
              updated[empSummary.employee_id].absent = absent;
              updated[empSummary.employee_id].privilegedLeave = pl;
              updated[empSummary.employee_id].casualLeave = cl;
              updated[empSummary.employee_id].sickLeave = sl;
              updated[empSummary.employee_id].lwp = lwp;
              updated[empSummary.employee_id].halfDay = hd;
              updated[empSummary.employee_id].overtime = parseFloat(ot.toFixed(2));
              updated[empSummary.employee_id].weeklyOff = wo;
              updated[empSummary.employee_id].holiday = holiday;
            }
          });
          return updated;
        });
      }
    } catch (err) {
      console.error('Error loading saved attendance:', err);
    }
  }, [currentYear, currentMonth, employees.length]);

  useEffect(() => {
    if (employees.length > 0) loadSavedAttendance();
  }, [employees.length, currentMonth, currentYear, loadSavedAttendance]);

  // Filter employees by search
  const filteredAttendance = useMemo(() => {
    if (!searchQuery) return Object.values(attendanceData);
    const q = searchQuery.toLowerCase();
    return Object.values(attendanceData).filter(emp => 
      `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(q) ||
      (emp.employee_id || '').toLowerCase().includes(q)
    );
  }, [attendanceData, searchQuery]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const stats = { totalEmployees: employees.length, totalPresent: 0, totalAbsent: 0 };
    Object.values(attendanceData).forEach(emp => {
      stats.totalPresent += emp.present || 0;
      stats.totalAbsent += emp.absent || 0;
    });
    return stats;
  }, [attendanceData, employees.length]);

  // Status legend items
  const legendItems = [
    { code: 'P', label: 'Present', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    { code: 'A', label: 'Absent', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
    { code: 'H', label: 'Holiday', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    { code: 'WO', label: 'Weekly Off', bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200' },
    { code: 'PL', label: 'Priv. Leave', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    { code: 'CL', label: 'Casual', bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
    { code: 'SL', label: 'Sick', bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
    { code: 'HD', label: 'Half Day', bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
    { code: 'OT', label: 'Overtime', bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
    { code: 'LWP', label: 'LWP', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div>
        {/* Hero Header */}
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-[1800px] mx-auto px-6 lg:px-8 py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link 
                  href="/employees"
                  className="p-2 hover:bg-gray-100 rounded-lg transition-all text-gray-500"
                >
                  <ArrowLeftIcon className="h-5 w-5" />
                </Link>
                <div>
                  <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-3">
                    <CalendarDaysIcon className="h-7 w-7 text-gray-700" />
                    Attendance
                  </h1>
                  <p className="text-gray-500 text-sm mt-0.5">
                    Track and manage employee attendance
                  </p>
                </div>
              </div>
              
              {/* Quick Stats */}
              <div className="flex items-center gap-4">
                <div className="text-center px-5 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-xl font-semibold text-gray-900">{summaryStats.totalEmployees}</div>
                  <div className="text-xs text-gray-500">Employees</div>
                </div>
                <div className="text-center px-5 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-xl font-semibold text-gray-900">{daysInMonth.length}</div>
                  <div className="text-xs text-gray-500">Days</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="bg-white border-b border-gray-200 sticky top-16 z-40">
          <div className="max-w-[1920px] mx-auto px-6 py-3">
            <div className="flex items-center justify-between gap-4">
              {/* Month Navigation */}
              <div className="flex items-center gap-2">
                <div className="flex items-center border border-gray-200 rounded-lg">
                  <button
                    onClick={goToPreviousMonth}
                    className="p-2 hover:bg-gray-50 rounded-l-lg transition-all border-r border-gray-200"
                  >
                    <ChevronLeftIcon className="h-4 w-4 text-gray-600" />
                  </button>
                  <div className="px-4 py-1.5 min-w-[160px] text-center">
                    <span className="font-medium text-gray-900">{monthName}</span>
                  </div>
                  <button
                    onClick={goToNextMonth}
                    className="p-2 hover:bg-gray-50 rounded-r-lg transition-all border-l border-gray-200"
                  >
                    <ChevronRightIcon className="h-4 w-4 text-gray-600" />
                  </button>
                </div>
                <button
                  onClick={goToCurrentMonth}
                  className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                >
                  Today
                </button>
              </div>

              {/* Search */}
              <div className="flex-1 max-w-sm">
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search employees..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 transition-all"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowBulkTimeModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-all"
                >
                  <ClockIcon className="h-4 w-4" />
                  Set All In/Out Time
                </button>
                <button
                  onClick={saveAttendance}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-all disabled:opacity-50"
                >
                  {saving ? (
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircleIcon className="h-4 w-4" />
                  )}
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Status Messages */}
        {(error || success) && (
          <div className="max-w-[1920px] mx-auto px-6 pt-4">
            {error && (
              <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
                <ExclamationCircleIcon className="h-5 w-5 flex-shrink-0" />
                <span>{error}</span>
                <button onClick={() => setError('')} className="ml-auto hover:bg-red-100 p-1 rounded-lg">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            )}
            {success && (
              <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700">
                <CheckCircleSolid className="h-5 w-5 flex-shrink-0" />
                <span>{success}</span>
              </div>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="max-w-[1920px] mx-auto px-6 py-3">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-xs text-gray-400 mr-1 flex-shrink-0">Legend:</span>
            {legendItems.map(item => (
              <div key={item.code} className="flex items-center gap-1 px-2 py-1 rounded flex-shrink-0">
                <span className={`w-5 h-5 ${item.bg} ${item.text} border ${item.border} rounded flex items-center justify-center text-[10px] font-semibold`}>
                  {item.code}
                </span>
                <span className="text-xs text-gray-500">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-[1920px] mx-auto px-6 pb-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin"></div>
              <span className="mt-4 text-sm text-gray-500">Loading...</span>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    {/* Main Headers */}
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="sticky left-0 z-20 bg-gray-50 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] border-r border-gray-200">
                        Code
                      </th>
                      <th className="sticky left-[100px] z-20 bg-gray-50 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[180px] border-r border-gray-200">
                        Name
                      </th>
                      {daysInMonth.map(day => (
                        <th
                          key={day.fullDate}
                          className={`px-0 py-2 text-center min-w-[36px] ${
                            day.isToday ? 'bg-gray-100' : 'bg-gray-50'
                          }`}
                        >
                          <div className={`text-[9px] font-medium uppercase ${
                            day.isSunday ? 'text-red-400' :
                            day.isSaturday ? 'text-amber-500' :
                            'text-gray-400'
                          }`}>{day.dayName}</div>
                          <div className={`text-xs font-medium ${
                            day.isToday ? 'text-gray-900' :
                            day.isSunday ? 'text-red-500' :
                            day.isSaturday ? 'text-amber-600' :
                            'text-gray-600'
                          }`}>{day.date}</div>
                        </th>
                      ))}
                      {/* Summary Columns */}
                      <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 bg-gray-50 border-l border-gray-200">P</th>
                      <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 bg-gray-50">A</th>
                      <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 bg-gray-50">WO</th>
                      <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 bg-gray-50">H</th>
                      <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 bg-gray-50">OT</th>
                      <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-rose-600 bg-rose-50">LWP</th>
                      <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-blue-600 bg-blue-50 border-l border-gray-200">PL Total</th>
                      <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-blue-600 bg-blue-50">PL Used</th>
                      <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-blue-600 bg-blue-50">PL Bal</th>
                      <th className="px-2 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 bg-gray-50 border-l border-gray-200">Hrs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredAttendance.map((empData, index) => (
                      <tr 
                        key={empData.id} 
                        className={`group hover:bg-gray-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                      >
                        <td className="sticky left-0 z-10 bg-inherit px-3 py-2 border-r border-gray-100 group-hover:bg-gray-50">
                          <span className="font-mono text-xs text-gray-600">
                            {empData.employee_id || empData.employee_code || `EMP${String(empData.id).padStart(3, '0')}`}
                          </span>
                        </td>
                        <td className="sticky left-[100px] z-10 bg-inherit px-3 py-2 border-r border-gray-200 group-hover:bg-gray-50">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-medium">
                              {(empData.first_name?.[0] || 'E').toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm text-gray-900">
                                {`${empData.first_name || ''} ${empData.last_name || ''}`.trim() || 'N/A'}
                              </div>
                            </div>
                          </div>
                        </td>
                        {daysInMonth.map(day => {
                          const status = empData.days[day.fullDate] || '-';
                          const style = getStatusStyle(status);
                          const employeeName = `${empData.first_name || ''} ${empData.last_name || ''}`.trim().toUpperCase() || 'EMPLOYEE';
                          
                          return (
                            <td
                              key={day.fullDate}
                              className={`px-0.5 py-1.5 text-center ${
                                day.isToday ? 'bg-purple-50/50' :
                                day.isSunday ? 'bg-red-50/30' : 
                                day.isSaturday ? 'bg-amber-50/30' : ''
                              }`}
                            >
                              <div className="relative group/cell">
                                <button
                                  onClick={() => openAttendanceModal(empData.id, day.fullDate, status, employeeName)}
                                  className={`w-7 h-7 rounded text-[10px] font-semibold border ${style.bg} ${style.text} ${style.border} hover:opacity-80 transition-all ${day.isToday ? 'ring-1 ring-gray-400' : ''}`}
                                >
                                  {style.label}
                                </button>

                              </div>
                            </td>
                          );
                        })}
                        {/* Summary cells */}
                        <td className="px-2 py-2 text-center border-l border-gray-100">
                          <span className="text-xs font-medium text-emerald-600">
                            {empData.present || 0}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className="text-xs font-medium text-red-600">
                            {empData.absent || 0}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className="text-xs font-medium text-gray-500">
                            {empData.weeklyOff || 0}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className="text-xs font-medium text-amber-600">
                            {empData.holiday || 0}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className="text-xs font-medium text-violet-600">
                            {empData.overtime || 0}
                          </span>
                        </td>
                        {/* LWP column */}
                        <td className="px-2 py-2 text-center">
                          <span className={`text-xs font-medium ${(empData.lwp || 0) > 0 ? 'text-rose-600 font-semibold' : 'text-gray-400'}`}>
                            {empData.lwp || 0}
                          </span>
                        </td>
                        {/* PL columns */}
                        <td className="px-2 py-2 text-center border-l border-gray-100 bg-blue-50/30">
                          <span className="text-xs font-medium text-blue-700">
                            {plData[empData.id]?.total || 0}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center bg-blue-50/30">
                          <span className="text-xs font-medium text-blue-600">
                            {(plData[empData.id]?.used || 0) + (empData.privilegedLeave || 0)}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center bg-blue-50/30">
                          <span className={`text-xs font-semibold ${
                            ((plData[empData.id]?.total || 0) - (plData[empData.id]?.used || 0) - (empData.privilegedLeave || 0)) > 0 ? 'text-green-600' : 'text-red-500'
                          }`}>
                            {Math.max(0, (plData[empData.id]?.total || 0) - (plData[empData.id]?.used || 0) - (empData.privilegedLeave || 0))}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center border-l border-gray-100">
                          <span className="text-xs font-medium text-gray-700">
                            {(() => {
                              let totalHours = 0;
                              const defaultInTime = empData.stdInTime || '09:00';
                              const defaultOutTime = empData.stdOutTime || '17:30';
                              
                              Object.entries(empData.days || {}).forEach(([dateKey, status]) => {
                                if (status === 'P' || status === 'HD' || status === 'OT') {
                                  const dayDetail = empData.dayDetails?.[dateKey] || {};
                                  const inTime = dayDetail.inTime || defaultInTime;
                                  const outTime = dayDetail.outTime || defaultOutTime;
                                  const idleMinutes = dayDetail.idleTime || 0;
                                  
                                  const [inH, inM] = inTime.split(':').map(Number);
                                  const [outH, outM] = outTime.split(':').map(Number);
                                  const inDecimal = inH + (inM / 60);
                                  const outDecimal = outH + (outM / 60);
                                  
                                  if (outDecimal > inDecimal) {
                                    let hours = outDecimal - inDecimal;
                                    // Subtract idle time (in minutes converted to hours)
                                    hours = Math.max(0, hours - (idleMinutes / 60));
                                    if (status === 'HD') hours = hours / 2;
                                    totalHours += hours;
                                  }
                                }
                              });
                              
                              return totalHours.toFixed(0);
                            })()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              {employees.length > 0 && (
                <div className="bg-gray-50 px-4 py-3 border-t border-gray-200">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {filteredAttendance.length} of {employees.length} employees
                    </span>
                    <span>
                      {daysInMonth.length} days
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && employees.length === 0 && (
            <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
              <UserGroupIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-1">No Employees Found</h3>
              <p className="text-sm text-gray-500 mb-4">
                Add employees to start tracking attendance.
              </p>
              <Link
                href="/employees"
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Go to Employees
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Bulk Time Modal */}
      {showBulkTimeModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/40" onClick={() => setShowBulkTimeModal(false)}></div>
            
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-sm">
              {/* Header */}
              <div className="px-5 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                      <ClockIcon className="h-5 w-5 text-gray-600" />
                      Set In/Out Time for All
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">Apply to all employees&apos; present days</p>
                  </div>
                  <button 
                    onClick={() => setShowBulkTimeModal(false)}
                    className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <XMarkIcon className="h-5 w-5 text-gray-500" />
                  </button>
                </div>
              </div>
              
              {/* Body */}
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">In Time</label>
                    <input
                      type="time"
                      value={bulkTimeData.inTime}
                      onChange={(e) => setBulkTimeData({ ...bulkTimeData, inTime: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Out Time</label>
                    <input
                      type="time"
                      value={bulkTimeData.outTime}
                      onChange={(e) => setBulkTimeData({ ...bulkTimeData, outTime: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 transition-all"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  This will update the in/out time for all {employees.length} employees on their present, half-day, and overtime days.
                </p>
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
                <button
                  onClick={() => setShowBulkTimeModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={applyBulkTime}
                  className="px-4 py-2 text-sm bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 transition-all"
                >
                  Apply to All
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mark Attendance Modal */}
      {showModal && selectedCell && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/40" onClick={closeModal}></div>
            
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md">
              {/* Header */}
              <div className="px-5 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Mark Attendance</h3>
                    <p className="text-sm text-gray-500 mt-0.5">{selectedCell.employeeName}</p>
                  </div>
                  <button 
                    onClick={closeModal}
                    className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <XMarkIcon className="h-5 w-5 text-gray-500" />
                  </button>
                </div>
              </div>
              
              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Attendance Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Attendance Type</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {legendItems.map(item => (
                      <button
                        key={item.code}
                        onClick={() => setModalData({ ...modalData, attendanceType: item.code })}
                        className={`flex flex-col items-center gap-0.5 p-2 rounded-lg border transition-all ${
                          modalData.attendanceType === item.code
                            ? 'border-gray-400 bg-gray-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className={`w-6 h-6 ${item.bg} ${item.text} border ${item.border} rounded flex items-center justify-center text-[10px] font-semibold`}>
                          {item.code}
                        </span>
                        <span className="text-[9px] text-gray-500 text-center leading-tight">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date Range */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={modalData.startDate}
                      onChange={(e) => setModalData({ ...modalData, startDate: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                    <input
                      type="date"
                      value={modalData.endDate}
                      onChange={(e) => setModalData({ ...modalData, endDate: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 transition-all"
                    />
                  </div>
                </div>

                {/* Time Range */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">In Time</label>
                    <input
                      type="time"
                      value={modalData.inTime}
                      onChange={(e) => setModalData({ ...modalData, inTime: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Out Time</label>
                    <input
                      type="time"
                      value={modalData.outTime}
                      onChange={(e) => setModalData({ ...modalData, outTime: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Idle (mins)</label>
                    <input
                      type="number"
                      min="0"
                      value={modalData.idleTime}
                      onChange={(e) => setModalData({ ...modalData, idleTime: parseInt(e.target.value) || 0 })}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 transition-all"
                    />
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Reason <span className="text-gray-400">(Optional)</span>
                  </label>
                  <textarea
                    value={modalData.reason}
                    onChange={(e) => setModalData({ ...modalData, reason: e.target.value })}
                    rows={2}
                    placeholder="Enter reason..."
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 transition-all resize-none"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleModalSubmit}
                  className="px-4 py-2 text-sm bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 transition-all"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
