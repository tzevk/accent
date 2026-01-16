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
  ClockIcon
} from '@heroicons/react/24/outline';

export default function EmployeeAttendancePage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [modalData, setModalData] = useState({
    attendanceType: 'P',
    startDate: '',
    endDate: '',
    inTime: '09:00',
    outTime: '17:30',
    reason: ''
  });
  
  // Current month/year for calendar
  const [currentDate, setCurrentDate] = useState(new Date());
  const [attendanceData, setAttendanceData] = useState({});
  const [holidays, setHolidays] = useState([]);
  
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
      const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
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

  // Get weeks for the month
  const weeks = useMemo(() => {
    const weekMap = {};
    daysInMonth.forEach(day => {
      if (!weekMap[day.weekNumber]) {
        weekMap[day.weekNumber] = [];
      }
      weekMap[day.weekNumber].push(day);
    });
    return Object.entries(weekMap).map(([num, days]) => ({ weekNumber: parseInt(num), days }));
  }, [daysInMonth]);

  // Fetch holidays for the current month
  const fetchHolidays = useCallback(async () => {
    try {
      const res = await fetch(`/api/masters/holidays?year=${currentYear}`);
      const data = await res.json();
      if (res.ok && data.data) {
        setHolidays(data.data);
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
      // Fetch holidays first
      const holidayList = await fetchHolidays();
      
      // Create a set of holiday dates for quick lookup (only for current month)
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
      
      // Initialize attendance data for all employees
      const initialAttendance = {};
      employeeList.forEach(emp => {
        initialAttendance[emp.id] = {
          ...emp,
          days: {},
          overtime: 0,
          weeklyOff: 0,
          present: 0,
          absent: 0,
          privilegedLeave: 0,
          casualLeave: 0,
          sickLeave: 0,
          lwp: 0,
          halfDay: 0,
          holiday: 0
        };
        
        // Set default attendance for each day
        daysInMonth.forEach(day => {
          // Check if this day is a holiday first
          if (holidayDates.has(day.fullDate)) {
            initialAttendance[emp.id].days[day.fullDate] = 'H'; // Holiday
            initialAttendance[emp.id].holiday++;
          } else if (day.isSunday) {
            // Default: Sunday = weekly off
            initialAttendance[emp.id].days[day.fullDate] = 'WO'; // Weekly Off
            initialAttendance[emp.id].weeklyOff++;
          } else if (day.isSaturday) {
            // Check if 2nd or 4th Saturday (weekly off)
            const saturdayOfMonth = Math.ceil(day.date / 7);
            if (saturdayOfMonth === 2 || saturdayOfMonth === 4) {
              initialAttendance[emp.id].days[day.fullDate] = 'WO';
              initialAttendance[emp.id].weeklyOff++;
            } else {
              initialAttendance[emp.id].days[day.fullDate] = 'P';
              initialAttendance[emp.id].present++;
            }
          } else {
            initialAttendance[emp.id].days[day.fullDate] = 'P'; // Present
            initialAttendance[emp.id].present++;
          }
        });
      });
      
      setAttendanceData(initialAttendance);
    } catch (err) {
      console.error('Error fetching employees:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [daysInMonth, fetchHolidays, currentMonth, currentYear]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Open modal for attendance
  const openAttendanceModal = (employeeId, fullDate, currentStatus, employeeName) => {
    setSelectedCell({ employeeId, fullDate, currentStatus, employeeName });
    setModalData({
      attendanceType: currentStatus || 'P',
      startDate: fullDate,
      endDate: fullDate,
      inTime: '09:00',
      outTime: '17:30',
      reason: ''
    });
    setShowModal(true);
  };

  // Close modal
  const closeModal = () => {
    setShowModal(false);
    setSelectedCell(null);
  };

  // Handle modal form submission
  const handleModalSubmit = () => {
    if (!selectedCell) return;
    
    const { employeeId } = selectedCell;
    const { attendanceType, startDate, endDate, inTime, outTime, reason } = modalData;
    
    // Apply attendance to date range
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateKey = d.toISOString().split('T')[0];
      // Only update if the date is in the current month
      if (daysInMonth.some(day => day.fullDate === dateKey)) {
        updateAttendanceStatus(employeeId, dateKey, attendanceType, { inTime, outTime, reason });
      }
    }
    
    closeModal();
    setSuccess(`Attendance updated for ${selectedCell.employeeName}`);
    setTimeout(() => setSuccess(''), 3000);
  };

  // Update attendance status (shared function)
  const updateAttendanceStatus = (employeeId, fullDate, newStatus, extraData = {}) => {
    setAttendanceData(prev => {
      const empData = { ...prev[employeeId] };
      const oldStatus = empData.days[fullDate];
      
      // Create new days object to trigger re-render
      empData.days = { ...empData.days, [fullDate]: newStatus };
      
      // Store extra data if provided
      empData.dayDetails = { ...empData.dayDetails, [fullDate]: { ...(empData.dayDetails?.[fullDate] || {}), ...extraData, status: newStatus } };
      
      // Update counts - decrement old status
      if (oldStatus === 'P') empData.present--;
      if (oldStatus === 'A') empData.absent--;
      if (oldStatus === 'PL') empData.privilegedLeave--;
      if (oldStatus === 'CL') empData.casualLeave = (empData.casualLeave || 1) - 1;
      if (oldStatus === 'SL') empData.sickLeave = (empData.sickLeave || 1) - 1;
      if (oldStatus === 'LWP') empData.lwp = (empData.lwp || 1) - 1;
      if (oldStatus === 'HD') empData.halfDay = (empData.halfDay || 1) - 1;
      if (oldStatus === 'OT') empData.overtime = (empData.overtime || 8) - 8; // Subtract 8 hours
      if (oldStatus === 'WO') empData.weeklyOff--;
      if (oldStatus === 'H') empData.holiday = (empData.holiday || 1) - 1;
      
      // Update counts - increment new status
      if (newStatus === 'P') empData.present++;
      if (newStatus === 'A') empData.absent++;
      if (newStatus === 'PL') empData.privilegedLeave++;
      if (newStatus === 'CL') empData.casualLeave = (empData.casualLeave || 0) + 1;
      if (newStatus === 'SL') empData.sickLeave = (empData.sickLeave || 0) + 1;
      if (newStatus === 'LWP') empData.lwp = (empData.lwp || 0) + 1;
      if (newStatus === 'HD') empData.halfDay = (empData.halfDay || 0) + 1;
      if (newStatus === 'OT') empData.overtime = (empData.overtime || 0) + 8; // Add 8 hours
      if (newStatus === 'WO') empData.weeklyOff++;
      if (newStatus === 'H') empData.holiday = (empData.holiday || 0) + 1;
      
      return { ...prev, [employeeId]: empData };
    });
  };

  // Get status color and icon
  const getStatusStyle = (status) => {
    switch (status) {
      case 'P': return { bg: 'bg-green-100', text: 'text-green-700', label: 'P', fullLabel: 'Present' };
      case 'A': return { bg: 'bg-red-100', text: 'text-red-700', label: 'A', fullLabel: 'Absent' };
      case 'PL': return { bg: 'bg-blue-100', text: 'text-blue-700', label: 'PL', fullLabel: 'Privilege Leave' };
      case 'OT': return { bg: 'bg-purple-100', text: 'text-purple-700', label: 'OT', fullLabel: 'Overtime' };
      case 'WO': return { bg: 'bg-gray-200', text: 'text-gray-600', label: 'WO', fullLabel: 'Weekly Off' };
      case 'H': return { bg: 'bg-orange-100', text: 'text-orange-700', label: 'H', fullLabel: 'Holiday' };
      case 'HD': return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'HD', fullLabel: 'Half Day' };
      case 'CL': return { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'CL', fullLabel: 'Casual Leave' };
      case 'SL': return { bg: 'bg-pink-100', text: 'text-pink-700', label: 'SL', fullLabel: 'Sick Leave' };
      case 'LWP': return { bg: 'bg-rose-100', text: 'text-rose-700', label: 'LWP', fullLabel: 'Leave Without Pay' };
      default: return { bg: 'bg-gray-50', text: 'text-gray-400', label: '-', fullLabel: 'Not Marked' };
    }
  };

  // Navigate months
  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  };

  const goToCurrentMonth = () => {
    setCurrentDate(new Date());
  };

  // Save attendance to database
  const saveAttendance = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      // Prepare attendance records for API
      const attendance_records = [];
      const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
      
      // Standard out time for overtime calculation (17:30 = 17.5 hours)
      const STANDARD_OUT_TIME = 17.5;
      
      // Helper to convert time string to decimal hours
      const timeToDecimal = (timeStr) => {
        if (!timeStr) return 0;
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours + (minutes / 60);
      };
      
      Object.values(attendanceData).forEach(empData => {
        Object.entries(empData.days).forEach(([dateKey, status]) => {
          // Skip empty or undefined statuses
          if (!status || status === '-') return;
          
          // Get day details if available (contains in_time, out_time)
          const dayDetail = empData.dayDetails?.[dateKey] || {};
          
          // Calculate overtime hours based on out_time if available
          let overtimeHours = 0;
          if (dayDetail.outTime && (status === 'P' || status === 'OT')) {
            const outTimeDecimal = timeToDecimal(dayDetail.outTime);
            if (outTimeDecimal > STANDARD_OUT_TIME) {
              overtimeHours = parseFloat((outTimeDecimal - STANDARD_OUT_TIME).toFixed(2));
            }
          }
          
          // OT status means worked extra 8 hours
          if (status === 'OT') {
            overtimeHours = 8;
          }
          
          attendance_records.push({
            employee_id: empData.id,
            attendance_date: dateKey,
            status: status,
            overtime_hours: overtimeHours,
            is_weekly_off: status === 'WO',
            in_time: dayDetail.inTime || null,
            out_time: dayDetail.outTime || null
          });
        });
      });

      console.log('Saving attendance records:', attendance_records.length);

      if (attendance_records.length === 0) {
        setError('No attendance records to save. Please mark attendance first.');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_records, month: monthKey })
      });
      
      const data = await res.json();
      console.log('Save response:', data);
      
      if (!res.ok) throw new Error(data.error || 'Failed to save attendance');
      
      setSuccess(`Attendance saved successfully! ${data.successCount} records updated.`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error saving attendance:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Load saved attendance from API when month changes
  const loadSavedAttendance = useCallback(async () => {
    if (employees.length === 0) return;
    
    try {
      const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
      const res = await fetch(`/api/attendance?month=${monthKey}`);
      const data = await res.json();
      
      if (res.ok && data.summary && data.summary.length > 0) {
        // Merge saved attendance with current data
        setAttendanceData(prev => {
          const updated = { ...prev };
          data.summary.forEach(empSummary => {
            if (updated[empSummary.employee_id]) {
              // Update days from saved data
              Object.entries(empSummary.days).forEach(([dateKey, dayData]) => {
                updated[empSummary.employee_id].days[dateKey] = dayData.status;
              });
              
              // Recalculate all counts
              let present = 0, absent = 0, pl = 0, cl = 0, sl = 0, lwp = 0, hd = 0, ot = 0, wo = 0, holiday = 0;
              Object.values(updated[empSummary.employee_id].days).forEach(status => {
                if (status === 'P') present++;
                if (status === 'A') absent++;
                if (status === 'PL') pl++;
                if (status === 'CL') cl++;
                if (status === 'SL') sl++;
                if (status === 'LWP') lwp++;
                if (status === 'HD') hd++;
                if (status === 'OT') { ot += 8; present++; } // 8 hours per OT day
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
              updated[empSummary.employee_id].overtime = ot;
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
    if (employees.length > 0) {
      loadSavedAttendance();
    }
  }, [employees.length, currentMonth, currentYear, loadSavedAttendance]);

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
                  href="/employees"
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
                </Link>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <CalendarDaysIcon className="h-7 w-7 text-purple-600" />
                    Employee Attendance
                  </h1>
                  <p className="text-sm text-gray-500 mt-1">
                    Mark daily attendance for all employees
                  </p>
                </div>
              </div>
            
              {/* Month Navigation */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={goToPreviousMonth}
                    className="p-2 hover:bg-white rounded-lg transition-colors"
                  >
                    <ChevronLeftIcon className="h-5 w-5 text-gray-600" />
                  </button>
                  <span className="px-4 py-2 font-semibold text-gray-900 min-w-[180px] text-center">
                    {monthName}
                  </span>
                  <button
                    onClick={goToNextMonth}
                    className="p-2 hover:bg-white rounded-lg transition-colors"
                  >
                    <ChevronRightIcon className="h-5 w-5 text-gray-600" />
                  </button>
                </div>
                <button
                  onClick={goToCurrentMonth}
                  className="px-3 py-2 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                >
                  Today
                </button>
                <Link
                  href="/employees/attendance/holiday-master"
                  className="px-4 py-2 text-sm bg-orange-50 text-orange-600 hover:bg-orange-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  <CalendarDaysIcon className="h-4 w-4" />
                  Holiday Master
                </Link>
                <button
                  onClick={saveAttendance}
                  disabled={saving}
                  className="px-4 py-2 bg-gradient-to-r from-[#64126D] to-[#86288F] text-white rounded-lg hover:from-[#86288F] hover:to-[#64126D] transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Attendance'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mx-6 mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex-shrink-0">
            {error}
          </div>
        )}
        {success && (
          <div className="mx-6 mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 flex-shrink-0">
            {success}
          </div>
        )}

        {/* Legend */}
        <div className="px-6 py-4 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-4 text-sm bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <span className="text-gray-700 font-semibold">Legend:</span>
            <div className="flex items-center gap-1.5">
              <span className="w-7 h-7 flex items-center justify-center bg-green-100 text-green-700 rounded-lg text-xs font-bold">P</span>
              <span className="text-gray-600 text-xs">Present</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-7 h-7 flex items-center justify-center bg-red-100 text-red-700 rounded-lg text-xs font-bold">A</span>
              <span className="text-gray-600 text-xs">Absent</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-7 h-7 flex items-center justify-center bg-orange-100 text-orange-700 rounded-lg text-xs font-bold">H</span>
              <span className="text-gray-600 text-xs">Holiday</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-7 h-7 flex items-center justify-center bg-gray-200 text-gray-600 rounded-lg text-xs font-bold">WO</span>
              <span className="text-gray-600 text-xs">Weekly Off</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-7 h-7 flex items-center justify-center bg-blue-100 text-blue-700 rounded-lg text-xs font-bold">PL</span>
              <span className="text-gray-600 text-xs">Priv. Leave</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-7 h-7 flex items-center justify-center bg-cyan-100 text-cyan-700 rounded-lg text-xs font-bold">CL</span>
              <span className="text-gray-600 text-xs">Casual Leave</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-7 h-7 flex items-center justify-center bg-pink-100 text-pink-700 rounded-lg text-xs font-bold">SL</span>
              <span className="text-gray-600 text-xs">Sick Leave</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-7 h-7 flex items-center justify-center bg-yellow-100 text-yellow-700 rounded-lg text-xs font-bold">HD</span>
              <span className="text-gray-600 text-xs">Half Day</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-7 h-7 flex items-center justify-center bg-purple-100 text-purple-700 rounded-lg text-xs font-bold">OT</span>
              <span className="text-gray-600 text-xs">Overtime</span>
            </div>
            <span className="text-gray-400 text-xs ml-auto italic">Click on any cell to mark attendance</span>
          </div>
        </div>

        {/* Main Content */}
        <div className="px-6 pb-6 flex-1 overflow-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600"></div>
              <span className="ml-4 text-gray-600">Loading employees...</span>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                <thead>
                  {/* Week Headers */}
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="sticky left-0 z-20 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider min-w-[100px]">
                      Emp Code
                    </th>
                    <th className="sticky left-[100px] z-20 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider min-w-[180px]">
                      Full Name
                    </th>
                    {weeks.map(week => (
                      <th 
                        key={week.weekNumber}
                        colSpan={week.days.length}
                        className="px-2 py-2 text-center text-xs font-semibold text-purple-700 uppercase tracking-wider bg-purple-50 border-l border-purple-200"
                      >
                        Week {week.weekNumber}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-center text-xs font-semibold text-purple-600 uppercase tracking-wider bg-purple-50 border-l border-purple-200">OT</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider bg-gray-100">WO</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-orange-600 uppercase tracking-wider bg-orange-50">H</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-green-600 uppercase tracking-wider bg-green-50">P</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-red-600 uppercase tracking-wider bg-red-50">A</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-blue-600 uppercase tracking-wider bg-blue-50">PL</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-cyan-600 uppercase tracking-wider bg-cyan-50">CL</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-pink-600 uppercase tracking-wider bg-pink-50">SL</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-rose-600 uppercase tracking-wider bg-rose-50">LWP</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-yellow-600 uppercase tracking-wider bg-yellow-50">HD</th>
                  </tr>
                  {/* Day Headers */}
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="sticky left-0 z-20 bg-gray-50"></th>
                    <th className="sticky left-[100px] z-20 bg-gray-50"></th>
                    {daysInMonth.map(day => (
                      <th
                        key={day.fullDate}
                        className={`px-1 py-2 text-center text-xs font-medium min-w-[36px] ${
                          day.isToday ? 'bg-purple-100 text-purple-800' : 
                          day.isSunday ? 'bg-red-50 text-red-600' :
                          day.isSaturday ? 'bg-amber-50 text-amber-600' :
                          'text-gray-600'
                        }`}
                      >
                        <div>{day.dayName}</div>
                        <div className="font-bold">{day.date}</div>
                      </th>
                    ))}
                    <th className="bg-purple-50"></th>
                    <th className="bg-gray-100"></th>
                    <th className="bg-orange-50"></th>
                    <th className="bg-green-50"></th>
                    <th className="bg-red-50"></th>
                    <th className="bg-blue-50"></th>
                    <th className="bg-cyan-50"></th>
                    <th className="bg-pink-50"></th>
                    <th className="bg-rose-50"></th>
                    <th className="bg-yellow-50"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.values(attendanceData).map((empData, index) => (
                    <tr key={empData.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      <td className="sticky left-0 z-10 bg-inherit px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap border-r border-gray-100">
                        {empData.employee_id || empData.employee_code || empData.emp_code || `EMP${String(empData.id).padStart(3, '0')}`}
                      </td>
                      <td className="sticky left-[100px] z-10 bg-inherit px-4 py-3 text-sm text-gray-700 whitespace-nowrap border-r border-gray-200">
                        {`${empData.first_name || ''} ${empData.last_name || ''}`.trim() || 'N/A'}
                      </td>
                      {daysInMonth.map(day => {
                        const status = empData.days[day.fullDate] || '-';
                        const style = getStatusStyle(status);
                        const employeeName = `${empData.first_name || ''} ${empData.last_name || ''}`.trim().toUpperCase() || 'EMPLOYEE';
                        return (
                          <td
                            key={day.fullDate}
                            className={`px-1 py-2 text-center ${day.isSunday ? 'bg-red-50/30' : day.isSaturday ? 'bg-amber-50/30' : ''}`}
                          >
                            <button
                              onClick={() => openAttendanceModal(empData.id, day.fullDate, status, employeeName)}
                              className={`w-8 h-8 rounded-lg text-xs font-semibold ${style.bg} ${style.text} hover:ring-2 hover:ring-purple-300 transition-all`}
                              title={style.fullLabel}
                            >
                              {style.label}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-center text-sm font-semibold text-purple-600 bg-purple-50/50 border-l border-purple-100">
                        {empData.overtime || 0}
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-semibold text-gray-600 bg-gray-100/50">
                        {empData.weeklyOff || 0}
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-semibold text-orange-600 bg-orange-50/50">
                        {empData.holiday || 0}
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-semibold text-green-600 bg-green-50/50">
                        {empData.present || 0}
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-semibold text-red-600 bg-red-50/50">
                        {empData.absent || 0}
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-semibold text-blue-600 bg-blue-50/50">
                        {empData.privilegedLeave || 0}
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-semibold text-cyan-600 bg-cyan-50/50">
                        {empData.casualLeave || 0}
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-semibold text-pink-600 bg-pink-50/50">
                        {empData.sickLeave || 0}
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-semibold text-rose-600 bg-rose-50/50">
                        {empData.lwp || 0}
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-semibold text-yellow-600 bg-yellow-50/50">
                        {empData.halfDay || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary Footer */}
            {employees.length > 0 && (
              <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">
                    Total Employees: <span className="font-semibold text-gray-900">{employees.length}</span>
                  </span>
                  <span className="text-gray-600">
                    Days in Month: <span className="font-semibold text-gray-900">{daysInMonth.length}</span>
                  </span>
                </div>
              </div>
            )}
            </div>
          )}

          {!loading && employees.length === 0 && (
            <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
              <UserGroupIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Employees Found</h3>
              <p className="text-gray-500 mb-4">There are no active employees to display attendance for.</p>
              <Link
                href="/employees"
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Go to Employees
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mark Attendance Modal */}
      {showModal && selectedCell && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={closeModal}
            ></div>
            
            {/* Modal */}
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg transform transition-all">
              {/* Header */}
              <div className="bg-[#1a8a9b] px-6 py-4 rounded-t-xl flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  Mark Attendance - {selectedCell.employeeName}
                </h3>
                <button 
                  onClick={closeModal}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
              
              {/* Body */}
              <div className="p-6 space-y-5">
                {/* Attendance Type */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Attendance Type<span className="text-red-500">*</span>
                  </label>
                  <select
                    value={modalData.attendanceType}
                    onChange={(e) => setModalData({ ...modalData, attendanceType: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a8a9b] focus:border-transparent text-gray-700"
                  >
                    <option value="P">Present</option>
                    <option value="A">Absent</option>
                    <option value="P">Present</option>
                    <option value="A">Absent</option>
                    <option value="H">Holiday</option>
                    <option value="WO">Weekly Off</option>
                    <option value="PL">Privileged Leave</option>
                    <option value="CL">Casual Leave</option>
                    <option value="SL">Sick Leave</option>
                    <option value="HD">Half Day</option>
                    <option value="OT">Overtime</option>
                    <option value="LWP">Leave Without Pay</option>
                  </select>
                </div>

                {/* Date Range */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Start Date<span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={modalData.startDate}
                      onChange={(e) => setModalData({ ...modalData, startDate: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a8a9b] focus:border-transparent text-gray-700"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      End Date<span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={modalData.endDate}
                      onChange={(e) => setModalData({ ...modalData, endDate: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a8a9b] focus:border-transparent text-gray-700"
                    />
                  </div>
                </div>

                {/* Time Range */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      In-Time :
                    </label>
                    <div className="relative">
                      <input
                        type="time"
                        value={modalData.inTime}
                        onChange={(e) => setModalData({ ...modalData, inTime: e.target.value })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a8a9b] focus:border-transparent text-gray-700"
                      />
                      <ClockIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Out-Time :
                    </label>
                    <div className="relative">
                      <input
                        type="time"
                        value={modalData.outTime}
                        onChange={(e) => setModalData({ ...modalData, outTime: e.target.value })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a8a9b] focus:border-transparent text-gray-700"
                      />
                      <ClockIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Reason<span className="text-gray-400">(Optional)</span>
                  </label>
                  <textarea
                    value={modalData.reason}
                    onChange={(e) => setModalData({ ...modalData, reason: e.target.value })}
                    rows={3}
                    placeholder="Enter reason for attendance change..."
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a8a9b] focus:border-transparent text-gray-700 resize-none"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                <button
                  onClick={closeModal}
                  className="px-6 py-2.5 bg-red-500 text-white font-medium rounded-lg hover:bg-red-600 transition-colors"
                >
                  CLOSE
                </button>
                <button
                  onClick={handleModalSubmit}
                  className="px-6 py-2.5 bg-[#1a8a9b] text-white font-medium rounded-lg hover:bg-[#157a8a] transition-colors"
                >
                  SAVE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
