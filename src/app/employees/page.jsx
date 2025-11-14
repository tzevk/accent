/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
'use client';

import Navbar from '@/components/Navbar';
import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';

import {
  UserGroupIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  PencilIcon,
  TrashIcon,
  EyeIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentArrowDownIcon,
  CogIcon,
  CalculatorIcon,
  CalendarDaysIcon,
  CurrencyDollarIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  EyeIcon as EyeOutlineIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline';

// Simple Salary Calculator Component
const SalaryCalculator = React.memo(({ basicSalary, onCalculate }) => {
  const [earnings, setEarnings] = useState({
    basic: parseFloat(basicSalary) || 0,
    da: 0,
    hra: 0,
    allowances: 0
  });

  const [deductions, setDeductions] = useState({
    pf: 0,
    pt: 0,
    esi: 0,
    tds: 0
  });

  const grossSalary = Object.values(earnings).reduce((sum, val) => sum + val, 0);
  const totalDeductions = Object.values(deductions).reduce((sum, val) => sum + val, 0);
  const netSalary = grossSalary - totalDeductions;

  useEffect(() => {
    onCalculate({ gross: grossSalary, net: netSalary, earnings, deductions });
  }, [grossSalary, netSalary, earnings, deductions, onCalculate]);

  const updateEarning = (key, value) => {
    setEarnings(prev => ({ ...prev, [key]: parseFloat(value) || 0 }));
  };

  const updateDeduction = (key, value) => {
    setDeductions(prev => ({ ...prev, [key]: parseFloat(value) || 0 }));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Earnings */}
      <div className="bg-green-50 p-4 rounded-lg border border-green-200">
        <h6 className="text-sm font-semibold text-green-800 mb-3 flex items-center">
          <ArrowTrendingUpIcon className="h-4 w-4 mr-2" />
          Earnings
        </h6>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Basic Salary</label>
            <input 
              type="number" 
              value={earnings.basic} 
              onChange={(e) => updateEarning('basic', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-green-300 rounded-md focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">DA (Dearness Allowance)</label>
            <input 
              type="number" 
              value={earnings.da} 
              onChange={(e) => updateEarning('da', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-green-300 rounded-md focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">HRA (House Rent Allowance)</label>
            <input 
              type="number" 
              value={earnings.hra} 
              onChange={(e) => updateEarning('hra', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-green-300 rounded-md focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Other Allowances</label>
            <input 
              type="number" 
              value={earnings.allowances} 
              onChange={(e) => updateEarning('allowances', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-green-300 rounded-md focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div className="pt-2 border-t border-green-300">
            <div className="flex justify-between text-sm font-semibold text-green-800">
              <span>Total Earnings:</span>
              <span>₹{grossSalary.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Deductions */}
      <div className="bg-red-50 p-4 rounded-lg border border-red-200">
        <h6 className="text-sm font-semibold text-red-800 mb-3 flex items-center">
          <ArrowTrendingDownIcon className="h-4 w-4 mr-2" />
          Deductions
        </h6>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">PF (Provident Fund)</label>
            <input 
              type="number" 
              value={deductions.pf} 
              onChange={(e) => updateDeduction('pf', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-red-300 rounded-md focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">PT (Professional Tax)</label>
            <input 
              type="number" 
              value={deductions.pt} 
              onChange={(e) => updateDeduction('pt', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-red-300 rounded-md focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">ESI (Employee State Insurance)</label>
            <input 
              type="number" 
              value={deductions.esi} 
              onChange={(e) => updateDeduction('esi', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-red-300 rounded-md focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">TDS (Tax Deducted at Source)</label>
            <input 
              type="number" 
              value={deductions.tds} 
              onChange={(e) => updateDeduction('tds', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-red-300 rounded-md focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="pt-2 border-t border-red-300">
            <div className="flex justify-between text-sm font-semibold text-red-800">
              <span>Total Deductions:</span>
              <span>₹{totalDeductions.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// Ensure memoized component has a display name for React/ESLint
SalaryCalculator.displayName = 'SalaryCalculator';

const Avatar = ({ src, firstName, lastName, size = 40 }) => {
  const initials = `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();
  
  if (src) {
    return (
      <div className="relative" style={{ width: size, height: size }}>
        <Image 
          src={src} 
          alt={`${firstName} ${lastName}`}
          fill
          className="rounded-full object-cover"
          unoptimized
        />
      </div>
    );
  }
  
  return (
    <div 
      className="rounded-full bg-gradient-to-r from-purple-500 to-purple-600 flex items-center justify-center text-white font-medium"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </div>
  );
};

// Custom hook for debounced input handling
const useDebouncedInput = (value, onChange, delay = 300) => {
  const [localValue, setLocalValue] = React.useState(value);
  const timeoutRef = React.useRef();

  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (newValue) => {
    setLocalValue(newValue);
    
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      onChange(newValue);
    }, delay);
  };

  const handleBlur = () => {
    // Clear timeout and update immediately on blur
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      onChange(localValue);
    }
  };

  return [localValue, handleChange, handleBlur];
};

export default function EmployeesPage() {
  const defaultFormData = {
    // Personal details
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    gender: '',
    date_of_birth: '',
    marital_status: '',
    nationality: '',
    
    // Address
    address: '',
    address_2: '',
    city: '',
    state: '',
    country: '',
    pin: '',
    
    // Work details
    employee_id: '',
    department: '',
    position: '',
    manager: '',
    hire_date: '',
    employment_status: '',
    status: '',
    workplace: '',
    level: '',
    reporting_to: '',
    salary: '',
    joining_date: '',

    // Statutory toggles (match API)
    bonus_eligible: false,
    stat_pf: false,
    stat_mlwf: false,
    stat_pt: false,
    stat_esic: false,
    stat_tds: false,

    // Academic / experience
    qualification: '',
    institute: '',
    passing_year: '',
    work_experience: '',

    // Salary structure (UI only; will be serialized)
    leave_structure: '',
    salary_structure: '',
    basic_salary: '',
    hra: '',
    conveyance: '',
    medical_allowance: '',
    special_allowance: '',
    incentives: '',
    deductions: '',

    // Bank details
    bank_name: '',
    bank_branch: '',
    account_holder_name: '',
    bank_account_no: '',
    bank_ifsc: '',

    // Govt IDs
    pan: '',
    aadhar: '',
    gratuity_no: '',
    uan: '',
    esi_no: '',

    // Attendance / exit
    biometric_code: '',
    attendance_id: '',
    exit_date: '',
    exit_reason: '',

    // Media
    profile_photo_url: '',

    // Emergency and misc
    emergency_contact_name: '',
    emergency_contact_phone: '',
    notes: '',
    // System Role assignment (maps to roles_master.id and role_name)
    system_role_id: '',
    system_role_name: ''
  };
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeTab, setActiveTab] = useState('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [formData, setFormData] = useState(defaultFormData);
  const [formErrors, setFormErrors] = useState({});
  const [importFile, setImportFile] = useState(null);
  const [importResults, setImportResults] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  // Roles for System Role assignment
  const [roles, setRoles] = useState([]);
  // Add Employee sub-tabs (like Projects edit tabs)
  const addSubTabOrder = ['personal','contact','work','academic','govt','bank','attendance','salary'];
  const [addSubTab, setAddSubTab] = useState('personal');
  
  // Edit Employee sub-tabs (same structure as add)
  const editSubTabOrder = ['personal','contact','work','academic','govt','bank','attendance','salary'];
  const [editSubTab, setEditSubTab] = useState('personal');
  // Simple Salary State
  const [salaryData, setSalaryData] = useState({
    // Leave details
    annual_leaves: 21,
    pl_used: '',
    pl_balance: '',
    
    // General details (attendance)
    month_days: '',
    working_days: '',
    week_offs: '',
    absent_days: '',
    paid_days: '',
    holiday_working_days: '',
    ot_hours: '',
    
  // Salary breakup
  gross_salary: '',
  basic_da: '',
  hra: '',
  conveyance_allowance: '',
  call_allowance: '',
  other_allowance: '',
  // Leave & OT
  // treat absent_days as leaveDays (user-visible field labelled 'Absent')
  absent_days: '',
  total_working_days: 26,
  ot_hours: '',
  ot_rate: '',
  total_working_hours: 208,
  // computed / derived fields
  adjusted_gross: 0,
  leave_deduction: 0,
  ot_pay: 0,
  employee_pf: 0,
  employer_pf: 0,
  bonus: 0,
  professional_tax: 200,
  mlwf_employee: 5,
  mlwf_employer: 13,
  mediclaim: 500,
  in_hand_salary: 0,
  ctc: 0,
  // manual overrides tracker: { fieldName: true }
  manual_overrides: {},
    
    // Other income
    holiday_working_hours: '',
    weekly_off_working: '',
    ot_charges: '',
    
    // Employee contributions (deductions)
    employee_pf: '',
    employee_pt: '',
    retention_amount: '',
    mlwf_employee: '',
    other_deductions: '',
    
    // In-hand salary
    in_hand_salary: '',
    
    // Company contributions
    employer_pf: '',
    bonus: '',
    mlwf_company: 13,
    medical_insurance: 500,
    
    // Employee CTC
    employee_ctc: '',
    
    // Legacy fields
    basic_salary: '',
    net_salary: 0,
    salary_structure: null, // Will store the JSON structure for server
    effective_from: ''
  });

  // Inputs model used for the Salary add/edit form and save flow
  const [salaryInputs, setSalaryInputs] = useState({
    basic_salary: '',
    attendance_days: '',
    total_working_days: 26,
    loan_active: 'no',
    loan_emi: '',
    advance_payment: '',
    salary_type: 'Monthly',
    effective_from: '',
    additional_earnings: '',
    additional_deductions: '',
    pf: '',
    pt: '',
    mlwf: '',
    da: '',
    hra: '',
    conveyance: '',
    call_allowance: '',
    other_allowance: '',
    pl_used: '',
    pl_balance: ''
  });

  // Helper to set salary fields and mark manual overrides
  const setSalaryField = (field, value, manual = true) => {
    // normalize numeric fields to empty string or number-like strings; actual parsing happens in compute
    // Special-case: when primary inputs that affect splits are edited (like gross_salary or other_allowance),
    // remove manual override flags for computed split fields so they bifurcate automatically.
    setSalaryData(prev => {
      const mo = { ...(prev.manual_overrides || {}) };
      // mark this field as manual if requested
      if (manual) mo[field] = true;

      // if gross or other allowance (or attendance/OT inputs) changed, clear split overrides so bifurcation runs
  const triggerClear = ['gross_salary', 'other_allowance', 'absent_days', 'total_working_days', 'month_days', 'ot_hours', 'ot_rate', 'total_working_hours'];
      if (triggerClear.includes(field)) {
        delete mo.basic_da;
        delete mo.hra;
        delete mo.conveyance_allowance;
      }

      return {
        ...prev,
        [field]: value,
        manual_overrides: mo
      };
    });
  };

  const resetFormula = (field) => {
    setSalaryData(prev => {
      const mo = { ...(prev.manual_overrides || {}) };
      delete mo[field];
      return { ...prev, manual_overrides: mo };
    });
  };
  
  const [salaryCalculation, setSalaryCalculation] = useState(null);
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [salaryError, setSalaryError] = useState('');
  const [salarySuccess, setSalarySuccess] = useState('');
  // Salary rows loaded from DB (most-recent-first)
  const [salaryRows, setSalaryRows] = useState([]);
  const [salaryRaw, setSalaryRaw] = useState(null);

  // Comprehensive reactive salary engine
  useEffect(() => {
    // compute derived values based on inputs and manual overrides
    setSalaryData(prev => {
      const toNum = (v) => {
        const n = Number(String(v || '').replace(/,/g, ''));
        return Number.isFinite(n) ? n : 0;
      };

      const grossInput = toNum(prev.gross_salary);
      const otherAllowance = toNum(prev.other_allowance);
      const totalWorkingDays = toNum(prev.total_working_days) || 26;
      const leaveDays = toNum(prev.absent_days);
      const totalWorkingHours = toNum(prev.total_working_hours) || 208;
      const otHours = toNum(prev.ot_hours);
      const otRate = toNum(prev.ot_rate) || 1;

      // Leave deduction based on input gross
  const leaveDeduction = Math.round((grossInput / totalWorkingDays) * leaveDays);

  // PL balance: annual leaves minus PL used (cannot be negative)
  const annualLeaves = toNum(prev.annual_leaves) || 0;
  const plUsed = toNum(prev.pl_used) || 0;
  const plBalance = Math.max(0, annualLeaves - plUsed);

  // Attendance-derived values: week offs, working days, paid days
  const monthDays = toNum(prev.month_days) || 0;
  // If monthDays provided, estimate weekly offs as floor(monthDays/7), otherwise use totalWorkingDays/7 rounded
  const weekOffsCalc = monthDays ? Math.floor(monthDays / 7) : Math.max(0, Math.floor(totalWorkingDays / 7));
  const workingDaysCalc = Math.max(0, (monthDays || totalWorkingDays) - weekOffsCalc);
  // paid days = working days - absent days (cannot be negative)
  const paidDaysCalc = Math.max(0, workingDaysCalc - leaveDays);

      // OT pay uses grossInput prorated to hours and multiplied by multiplier otRate
      const otPay = Math.round((grossInput / totalWorkingHours) * otHours * otRate);

      // Adjusted gross = grossInput - leaveDeduction + otPay
      const adjustedGross = Math.round(Math.max(0, grossInput - leaveDeduction + otPay));

      // Base for split excludes otherAllowance
      const baseForSplit = Math.max(0, adjustedGross - otherAllowance);

      // Default splits
      const defaultBasicDa = Math.round(0.6 * baseForSplit);
      const defaultHra = Math.round(0.2 * baseForSplit);
      const defaultConveyance = Math.round(0.1 * baseForSplit);

      // If user manually edited a field, preserve it; otherwise use default
      const basicDa = prev.manual_overrides?.basic_da ? Math.round(toNum(prev.basic_da)) : defaultBasicDa;
      const hra = prev.manual_overrides?.hra ? Math.round(toNum(prev.hra)) : defaultHra;
      const conveyance = prev.manual_overrides?.conveyance_allowance ? Math.round(toNum(prev.conveyance_allowance)) : defaultConveyance;

      // Employee PF = 12% of Basic+DA (cap 1800)
      const employeePfRaw = Math.round(0.12 * basicDa);
      const employeePf = Math.min(1800, employeePfRaw);

      // Employer PF = 13% of Basic+DA (cap 1950)
      const employerPfRaw = Math.round(0.13 * basicDa);
      const employerPf = Math.min(1950, employerPfRaw);

      // Bonus = 8.33% of Basic+DA
      const bonus = Math.round(0.0833 * basicDa);

      const professionalTax = 200;
      const mlwfEmployee = 5;
      const mlwfEmployer = 13;
      const mediclaim = 500;

      // In-Hand = adjustedGross - (employee PF + professional tax + mlwf employee)
      const inHand = Math.round(Math.max(0, adjustedGross - (employeePf + professionalTax + mlwfEmployee)));

      // CTC = adjustedGross + (employer PF + bonus + mlwf employer + mediclaim + otherAllowance)
      const ctc = Math.round(adjustedGross + (employerPf + bonus + mlwfEmployer + mediclaim + otherAllowance));

  // Prepare new state but only overwrite fields that are computed (do not unset manual overrides)
      const next = { ...prev };
    next.leave_deduction = leaveDeduction;
    next.pl_balance = plBalance;
    // Write attendance-derived fields unless manually overridden
    if (!prev.manual_overrides?.week_offs) next.week_offs = weekOffsCalc;
    if (!prev.manual_overrides?.working_days) next.working_days = workingDaysCalc;
    if (!prev.manual_overrides?.paid_days) next.paid_days = paidDaysCalc;
      next.ot_pay = otPay;
      next.adjusted_gross = adjustedGross;
      next.gross_salary = grossInput; // keep original gross input shown

      // Write computed splits only if not manual
      if (!prev.manual_overrides?.basic_da) next.basic_da = defaultBasicDa;
      if (!prev.manual_overrides?.hra) next.hra = defaultHra;
      if (!prev.manual_overrides?.conveyance_allowance) next.conveyance_allowance = defaultConveyance;

      next.employee_pf = employeePf;
      next.employer_pf = employerPf;
      next.bonus = bonus;
      next.professional_tax = professionalTax;
      next.mlwf_employee = mlwfEmployee;
      next.mlwf_employer = mlwfEmployer;
      next.mediclaim = mediclaim;
      next.in_hand_salary = inHand;
  next.ctc = ctc;
  // mirror computed CTC to employee_ctc for UI/editing consistency
  next.employee_ctc = ctc;

      // round all currency-like values to integers
      ['leave_deduction','ot_pay','adjusted_gross','employee_pf','employer_pf','bonus','in_hand_salary','ctc','pl_balance','week_offs','working_days','paid_days'].forEach(k => {
        if (next[k] !== undefined) next[k] = Math.round(Number(next[k]) || 0);
      });

      return next;
    });
  }, [
    salaryData.gross_salary,
    salaryData.other_allowance,
  salaryData.absent_days,
    salaryData.pl_used,
    salaryData.annual_leaves,
    salaryData.total_working_days,
  salaryData.month_days,
    salaryData.ot_hours,
    salaryData.ot_rate,
    salaryData.total_working_hours,
    JSON.stringify(salaryData.manual_overrides)
  ]);

  // Fetch persisted salary rows for the selected employee and map primary fields into the UI
  const loadSalaryRows = async (empId) => {
    try {
      console.debug('[salary] loadSalaryRows called for', empId);
      if (!empId) return;
      setSalaryLoading(true);
      setSalaryError('');
      const url = `/api/employees/${empId}/salary`;
      console.debug('[salary] fetching', url);
      const res = await fetch(url);
      console.debug('[salary] fetch response status', res.status);
      if (!res.ok) {
        const txt = await res.text();
        console.error('[salary] fetch failed:', txt || `Status ${res.status}`);
        throw new Error(txt || `Status ${res.status}`);
      }
      const resJson = await res.json();
      console.debug('[salary] response json', resJson);
      // Server returns { success: true, data: { record, computed } } or { success: true, data: null }
  setSalaryRaw(resJson);
      let rows = [];
      if (resJson && resJson.success) {
        const payload = resJson.data;
        if (!payload) {
          rows = [];
        } else if (Array.isArray(payload)) {
          rows = payload;
        } else if (payload.record) {
          rows = [payload.record];
        } else if (payload.rows) {
          rows = payload.rows;
        } else {
          // fallback: if data itself looks like a record
          rows = [payload];
        }
        // If no persisted record but server returned a computed breakdown, map computed -> fake row
        if (rows.length === 0 && payload && payload.computed) {
          const comp = payload.computed;
          const fake = {
            gross_salary: comp.inputs?.gross_salary ?? null,
            basic_da: comp.breakdown?.basic_da ?? null,
            hra: comp.breakdown?.hra ?? null,
            conveyance_allowance: comp.breakdown?.conveyance_allowance ?? null,
            call_allowance: null,
            other_allowance: comp.inputs?.other_allowance ?? null,
            effective_from: (payload.record && (payload.record.effective_from || payload.record.effectiveFrom)) || null,
          };
          console.debug('[salary] using server computed as fake row', fake);
          rows = [fake];
        }
      } else {
        // If the API returned a non-success wrapper, treat as empty and surface the raw payload in preview
        rows = [];
      }
      console.debug('[salary] normalized rows count', rows.length, rows[0]);
      // sort most-recent-first if effective_from present
      rows.sort((a, b) => {
        const da = a?.effective_from ? new Date(a.effective_from) : null;
        const db = b?.effective_from ? new Date(b.effective_from) : null;
        if (da && db) return db - da;
        if (db) return 1;
        if (da) return -1;
        return 0;
      });
      setSalaryRows(rows);

      // If we have at least one row, map the common DB fields into the salaryData UI state.
      if (rows.length > 0) {
        const row = rows[0];
        // compute mapping values for logging
        const g = row.gross_salary ?? row.gross ?? row.GROSS ?? row.Gross;
        const basic = row.basic ?? row.BASIC ?? row.Basic;
        const da = row.da ?? row.DA ?? row.Da;
        const basicDaCombined = (basic !== undefined || da !== undefined) ? (Number(basic || 0) + Number(da || 0)) : (row.basic_da ?? row.basicDa ?? undefined);
        const hra = row.hra ?? row.HRA ?? undefined;
        const convey = row.conveyance_allowance ?? row.conveyance ?? row['CONVEYANCE ALLOWANCE'] ?? undefined;
        const callAllow = row.call_allowance ?? row.call_allow ?? row.call ?? undefined;
        const other = row.other_allowance ?? row.other ?? row.other_allow ?? undefined;

        console.debug('[salary] mapping record -> UI', { gross: g, basicDaCombined, hra, convey, callAllow, other, effective_from: row.effective_from });

        setSalaryData(prev => {
          // Helper to coalesce multiple possible field names
          const g = row.gross_salary ?? row.gross ?? row.GROSS ?? row.Gross;
          const basic = row.basic ?? row.BASIC ?? row.Basic;
          const da = row.da ?? row.DA ?? row.Da;
          const basicDaCombined = (basic !== undefined || da !== undefined) ? (Number(basic || 0) + Number(da || 0)) : (row.basic_da ?? row.basicDa ?? prev.basic_da);
          const hra = row.hra ?? row.HRA ?? prev.hra;
          const convey = row.conveyance_allowance ?? row.conveyance ?? row['CONVEYANCE ALLOWANCE'] ?? prev.conveyance_allowance;
          const callAllow = row.call_allowance ?? row.call_allow ?? row.call ?? prev.call_allowance;
          const other = row.other_allowance ?? row.other ?? row.other_allow ?? prev.other_allowance;

          // Preserve existing manual overrides and mark fetched component fields as manual so
          // they reflect DB values until the user explicitly resets them via the UI.
          const prevMO = prev.manual_overrides || {};
          const newMO = { ...prevMO };
          // Prefer mapping component splits from gross: do not force basic/da/hra/conveyance from DB.
          // Remove manual override flags for those splits so the reactive engine computes them from gross.
          if (newMO.basic_da) delete newMO.basic_da;
          if (newMO.hra) delete newMO.hra;
          if (newMO.conveyance_allowance) delete newMO.conveyance_allowance;
          if (callAllow !== undefined || row.call_allowance !== undefined) newMO.call_allowance = true;
          if (other !== undefined || row.other_allowance !== undefined) newMO.other_allowance = true;

          return {
            ...prev,
            gross_salary: g !== undefined && g !== null ? g : prev.gross_salary,
            // Do not overwrite the component splits here; let the reactive salary engine derive them from gross.
            basic_da: prev.basic_da,
            hra: prev.hra,
            conveyance_allowance: prev.conveyance_allowance,
            call_allowance: callAllow !== undefined ? callAllow : prev.call_allowance,
            other_allowance: other !== undefined ? other : prev.other_allowance,
            effective_from: row.effective_from ?? prev.effective_from,
            manual_overrides: newMO
          };
        });
        // Also populate salaryInputs (used by the save flow) so add/edit flows stay in sync
        try {
          setSalaryInputs(prev => ({
            ...prev,
            basic_salary: row.basic ?? row.basic_salary ?? row.BASIC ?? prev.basic_salary,
            da: row.da ?? row.DA ?? prev.da,
            hra: row.hra ?? row.HRA ?? prev.hra,
            conveyance: row.conveyance_allowance ?? row.conveyance ?? prev.conveyance,
            call_allowance: row.call_allowance ?? row.call ?? prev.call_allowance,
            other_allowance: row.other_allowance ?? row.other ?? prev.other_allowance,
            effective_from: row.effective_from ?? prev.effective_from,
            pl_used: row.pl_used ?? prev.pl_used,
            pl_balance: row.pl_balance ?? prev.pl_balance,
          }));
          console.debug('[salary] salaryInputs populated from DB', { basic_salary: row.basic ?? row.basic_salary, da: row.da, hra: row.hra, conveyance: row.conveyance, call_allowance: row.call_allowance, other_allowance: row.other_allowance });
        } catch (e) { console.error('[salary] failed to set salaryInputs', e); }
      }

    } catch (err) {
      console.error('Failed to load salary rows', err);
      setSalaryError(String(err?.message || err));
      setSalaryRows([]);
    } finally {
      setSalaryLoading(false);
    }
  };

  useEffect(() => {
    loadSalaryRows(selectedEmployee?.id);
  }, [selectedEmployee?.id]);

  // Also reload when the Salary tab is shown to the user
  useEffect(() => {
    if (editSubTab === 'salary') loadSalaryRows(selectedEmployee?.id);
  }, [editSubTab, selectedEmployee?.id]);

  // Add attendance related extras
  // week_offs: weekly offs in the period; pl_use: paid leave used; pl_balance: informational
  // absent will be computed as derived below
  const [attendanceExtras, setAttendanceExtras] = useState({ week_offs: '', pl_use: '', pl_balance: '' });

  // Evaluate a simple arithmetic formula safely against provided variables
  const evaluateFormula = (expr, vars) => {
    try {
      if (!expr || typeof expr !== 'string') return 0;
      const sanitized = expr.replace(/[^0-9+\-*/(). _a-z]/gi, '');
      // Replace variable tokens with their numeric values from vars
      const replaced = sanitized.replace(/[a-z_]+/gi, (name) => {
        const key = name.toLowerCase();
        const v = vars[key];
        return (typeof v === 'number' && isFinite(v)) ? String(v) : '0';
      });
  const fn = new Function(`return (${replaced});`);
      const val = Number(fn());
      return isFinite(val) ? val : 0;
    } catch {
      return 0;
    }
  };

  // Compute locally for Add flow and for instant preview
  const computeLocal = () => {
    const salaryType = String(salaryInputs.salary_type || 'Monthly');
    const applicable = salaryType; // keep same for now
    const basicInput = componentConfig.basic;
    const baseBasic = Number(salaryInputs.basic_salary || 0);
    const additionalEarnings = Number(salaryInputs.additional_earnings || 0);
    const additionalDeductions = Number(salaryInputs.additional_deductions || 0);
    const loanActive = String(salaryInputs.loan_active).toLowerCase() === 'yes' ? 1 : 0;
    const loanEmi = Number(salaryInputs.loan_emi || 0);
    const advance = Number(salaryInputs.advance_payment || 0);
    const totalDays = Number(salaryInputs.total_working_days || 0);
    const weekOffs = Number(attendanceExtras.week_offs || 0);
    const plUse = Number(attendanceExtras.pl_use || 0);
    const attendanceDays = Number(salaryInputs.attendance_days || 0);

    const effectiveDays = Math.max(0, totalDays - weekOffs);
    const presentDays = Math.max(0, attendanceDays + plUse);
    const computedAbsent = Math.max(0, effectiveDays - presentDays);

    // Resolve components in order
    const resolved = {};
    // helper to resolve a component
    const resolveComp = (key, defVal) => {
      const conf = componentConfig[key] || { type: 'fixed', value: '' };
      if (conf.type === 'formula') return evaluateFormula(String(conf.value || ''), resolved);
      if (conf.type === 'fixed' && conf.value !== '') return Number(conf.value) || 0;
      return defVal;
    };

    // Defaults mirroring server
    const def_da = baseBasic * 0.10;
    const def_hra = baseBasic * 0.40;
    const def_conveyance = 1500;
    const def_call = String(salaryType).toLowerCase() === 'monthly' ? 1500 : 0;
    const def_other = baseBasic > 40000 ? 2000 : 1000;
    const def_pf = Math.min(15000, baseBasic) * 0.12;
    const grossForPTDefault = baseBasic + def_da + def_hra + def_conveyance + def_call + def_other + additionalEarnings;
    const def_pt = grossForPTDefault > 7500 ? 200 : 0;
    const now = new Date();
    const def_mlwf = (now.getMonth() + 1) === 6 ? 10 : 0;

    // Resolve with defaults available in 'resolved'
    resolved.basic = resolveComp('basic', baseBasic);
    resolved.da = resolveComp('da', def_da);
    resolved.hra = resolveComp('hra', def_hra);
    resolved.conveyance = resolveComp('conveyance', def_conveyance);
    resolved.call_allowance = resolveComp('call_allowance', def_call);
    resolved.other_allowance = resolveComp('other_allowance', def_other);

    const gross = resolved.basic + resolved.da + resolved.hra + resolved.conveyance + resolved.call_allowance + resolved.other_allowance + additionalEarnings;

    // Apply statutory flags to deductions - only calculate if enabled
    resolved.pf = formData.stat_pf ? resolveComp('pf', def_pf) : 0;
    resolved.pt = formData.stat_pt ? resolveComp('pt', def_pt) : 0;
    resolved.mlwf = formData.stat_mlwf ? resolveComp('mlwf', def_mlwf) : 0;
    resolved.esic = formData.stat_esic ? 0 : 0; // ESIC calculation can be added later
    const totalDeductions = resolved.pf + resolved.pt + resolved.mlwf + additionalDeductions;

    const netSalary = gross - totalDeductions;
    const payablePct = effectiveDays > 0 ? presentDays / effectiveDays : 0;
    const monthlySalary = netSalary * payablePct;
    const hourlySalary = String(salaryType).toLowerCase() === 'hourly' && effectiveDays > 0 ? monthlySalary / (effectiveDays * 8) : 0;
    const annualSalary = monthlySalary * 12;
    // Apply TDS only if stat_tds is enabled
    const tds = formData.stat_tds && annualSalary > 500000 ? annualSalary * 0.05 : 0;
    const tdsMonthly = tds / 12;
    const finalPayable = monthlySalary - (loanActive ? loanEmi : 0) - advance - tdsMonthly;

    return {
      inputs: {
        salary_type: salaryType,
        basic_salary: resolved.basic,
        attendance_days: attendanceDays,
        total_working_days: totalDays,
        week_offs: weekOffs,
        pl_use: plUse,
        absent: computedAbsent,
        loan_active: loanActive,
        loan_emi: loanEmi,
        advance_payment: advance,
        effective_from: salaryInputs.effective_from || null,
      },
      earnings: {
        da: resolved.da,
        hra: resolved.hra,
        conveyance: resolved.conveyance,
        call_allowance: resolved.call_allowance,
        other_allowance: resolved.other_allowance,
        additional_earnings: additionalEarnings,
        gross,
      },
      deductions: {
        pf: resolved.pf,
        pt: resolved.pt,
        mlwf: resolved.mlwf,
        esic: resolved.esic,
        additional_deductions: additionalDeductions,
        total_deductions: totalDeductions,
      },
      attendance: { absent_days: computedAbsent, payable_days_pct: payablePct },
      summary: { net_salary: netSalary, monthly_salary: monthlySalary, hourly_salary: hourlySalary, annual_salary: annualSalary, tds, tds_monthly: tdsMonthly, final_payable: finalPayable },
    };
  };


  // Fetch employees
  const fetchEmployees = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const s = (searchTerm || '').trim();
      const params = new URLSearchParams({
        page: currentPage,
        // Request a larger page size so the UI shows more employees (server caps at 100)
        limit: 100,
        ...(s && { search: s }),
        ...(selectedDepartment && { department: selectedDepartment }),
        ...(selectedStatus && { status: selectedStatus })
      });
      // Add a client-side timeout to avoid hanging forever on network issues
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12000);
      const response = await fetch(`/api/employees?${params}`, { signal: controller.signal });
      clearTimeout(t);
      const data = await response.json();

      if (response.ok) {
        // Sort employees by numeric suffix in their employee_id (e.g., ATS001 -> 1)
        const sortByIdNumber = (a, b) => {
          const extract = (s) => {
            if (!s) return Number.POSITIVE_INFINITY;
            const m = String(s).match(/(\d+)$/);
            if (!m) return Number.POSITIVE_INFINITY;
            return Number(m[1]);
          };
          const na = extract(a.employee_id);
          const nb = extract(b.employee_id);
          if (na === nb) return 0;
          return (na === Number.POSITIVE_INFINITY) ? 1 : (nb === Number.POSITIVE_INFINITY ? -1 : na - nb);
        };
        const sorted = Array.isArray(data.employees) ? [...data.employees].sort(sortByIdNumber) : (data.employees || []);
        setEmployees(sorted);
        setDepartments(data.departments);
        setPagination(data.pagination);
      } else {
        console.error('Error fetching employees:', data.error);
        setErrorMsg(data.error || 'Failed to fetch employees');
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
      setErrorMsg(error?.message || 'Failed to fetch employees');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [currentPage, searchTerm, selectedDepartment, selectedStatus]);

  // Compute next ATS id from current employees list (e.g. ATS001 -> ATS002)
  const nextAtsId = useMemo(() => {
    try {
      let max = 0;
      for (const e of (employees || [])) {
        const m = String(e.employee_id || '').match(/ATS0*(\d+)$/i);
        if (m) {
          const n = parseInt(m[1], 10);
          if (Number.isFinite(n)) max = Math.max(max, n);
        }
      }
      const next = String(max + 1).padStart(3, '0');
      return `ATS${next}`;
    } catch (err) { return 'ATS001'; }
  }, [employees]);

  // Load roles for System Role assignment
  useEffect(() => {
    const loadRoles = async () => {
      try {
        const res = await fetch('/api/roles-master');
        const json = await res.json();
        if (res.ok && json?.success) {
          setRoles(json.data || []);
        }
      } catch {}
    };
    loadRoles();
  }, []);

  const submitSalaryMaster = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    setSalaryError('');
    setSalarySuccess('');
    if (!selectedEmployee?.id) {
      setSalaryError('Select an employee first. In Add flow, save the employee to auto-create salary.');
      return;
    }
    if (!salaryInputs.basic_salary || Number(salaryInputs.basic_salary) <= 0) {
      setSalaryError('Basic Salary is required and must be greater than 0.');
      return;
    }
    if (!salaryInputs.effective_from) {
      setSalaryError('Effective From date is required.');
      return;
    }
    const payload = {
      basic_salary: Number(salaryInputs.basic_salary || 0),
      attendance_days: Number(salaryInputs.attendance_days || 0),
      total_working_days: Number(salaryInputs.total_working_days || 0),
      loan_active: String(salaryInputs.loan_active).toLowerCase() === 'yes' ? 1 : 0,
      loan_emi: Number(salaryInputs.loan_emi || 0),
      advance_payment: Number(salaryInputs.advance_payment || 0),
      salary_type: salaryInputs.salary_type,
      effective_from: salaryInputs.effective_from,
      additional_earnings: Number(salaryInputs.additional_earnings || 0),
      additional_deductions: Number(salaryInputs.additional_deductions || 0),
      pf: Number(salaryInputs.pf || 0),
      pt: Number(salaryInputs.pt || 0),
      mlwf: Number(salaryInputs.mlwf || 0),
      da: salaryInputs.da === '' ? null : Number(salaryInputs.da),
      hra: salaryInputs.hra === '' ? null : Number(salaryInputs.hra),
      conveyance: salaryInputs.conveyance === '' ? null : Number(salaryInputs.conveyance),
      call_allowance: salaryInputs.call_allowance === '' ? null : Number(salaryInputs.call_allowance),
      other_allowance: salaryInputs.other_allowance === '' ? null : Number(salaryInputs.other_allowance),
      // Preserve paid leave usage and balance so server stores PL info
      pl_used: Number(salaryInputs.pl_used || 0),
      pl_balance: Number(salaryInputs.pl_balance || 0),
    };
    try {
      setSalaryLoading(true);
      const res = await fetch(`/api/employees/${selectedEmployee.id}/salary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      let json = null;
      try { json = await res.json(); } catch {}
      if (res.ok && json && json.success) {
        // refresh with latest snapshot
        // const fresh = await fetch(`/api/employees/${selectedEmployee.id}/salary`).then(r => r.json()).catch(() => null);
        // if (fresh?.success && fresh?.data) setSalaryServerData(fresh.data.computed);
        setSalarySuccess('Salary entry saved successfully.');
        setSalaryError('');
      }
      else {
        const msg = (json && (json.error || json.message)) || 'Failed to save salary entry';
        setSalaryError(msg);
        setSalarySuccess('');
      }
    } catch (err) {
      console.error('Failed to submit salary master', err);
      setSalaryError('Network or server error while saving salary entry.');
      setSalarySuccess('');
    } finally {
      setSalaryLoading(false);
    }
  };

  // Handle form submission
    const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setFormErrors({});

    try {
      const url = selectedEmployee ? `/api/employees?id=${selectedEmployee.id}` : '/api/employees';
      const method = selectedEmployee ? 'PUT' : 'POST';

  // Prepare payload aligned with API
      const payload = { ...formData };
      // If a System Role is selected, mirror the human-friendly role name on the employee record
      if (formData.system_role_id) {
        const picked = roles.find(r => String(r.id) === String(formData.system_role_id));
        if (picked) {
          payload.role = picked.role_name;
          payload.system_role_name = picked.role_name;
        }
      }
      // Normalize enum-like fields to match DB
      if (payload.gender) {
        const g = String(payload.gender).toLowerCase();
        payload.gender = g === 'male' ? 'Male' : g === 'female' ? 'Female' : 'Other';
      }
      if (payload.marital_status) {
        const m = String(payload.marital_status).toLowerCase();
        payload.marital_status = m === 'single' ? 'Single' : m === 'married' ? 'Married' : 'Other';
      }
      // Mirror status to employment_status if only one is set
      if (payload.employment_status && !payload.status) payload.status = payload.employment_status;
      if (payload.status && !payload.employment_status) payload.employment_status = payload.status;
      // Prepare salary structure merging logic
      const rawParts = {
        basic_salary: payload.basic_salary,
        hra: payload.hra,
        conveyance: payload.conveyance,
        medical_allowance: payload.medical_allowance,
        special_allowance: payload.special_allowance,
        incentives: payload.incentives,
        deductions: payload.deductions
      };
      // Filter to only numeric values user actually provided
      const providedParts = Object.fromEntries(
        Object.entries(rawParts)
          .filter(([_, v]) => v !== '' && v != null && !Number.isNaN(Number(v)))
          .map(([k, v]) => [k, Number(v)])
      );
      let mergedStruct = null;
      if (Object.keys(providedParts).length > 0) {
        if (method === 'PUT' && selectedEmployee?.salary_structure) {
          try {
            const existing = typeof selectedEmployee.salary_structure === 'string'
              ? JSON.parse(selectedEmployee.salary_structure)
              : (selectedEmployee.salary_structure || {});
            mergedStruct = { ...(existing || {}), ...providedParts };
          } catch {
            mergedStruct = { ...providedParts };
          }
        } else {
          mergedStruct = { ...providedParts };
        }
        payload.salary_structure = JSON.stringify(mergedStruct);
        // Compute salary summary from merged values
        const gross = ['basic_salary','hra','conveyance','medical_allowance','special_allowance','incentives']
          .map(k => Number((mergedStruct && mergedStruct[k]) || 0))
          .reduce((a,b) => a + b, 0);
        const ded = Number((mergedStruct && mergedStruct.deductions) || 0);
        if (gross) payload.gross_salary = gross;
        if (ded) payload.total_deductions = ded;
        if (gross || ded) payload.net_salary = Math.max(0, gross - ded);
      }
      // Bank fields: API supports account_holder_name
      if (payload.bank_account_no === '') delete payload.bank_account_no;
      if (payload.bank_ifsc === '') delete payload.bank_ifsc;
      // Cleanup UI-only fields
      delete payload.account_number; // replaced by bank_account_no
      delete payload.ifsc; // replaced by bank_ifsc
      delete payload.biometric_id; // replaced by biometric_code
      // Convert booleans to 0/1 for tinyint flags
      ['bonus_eligible','stat_pf','stat_mlwf','stat_pt','stat_esic','stat_tds'].forEach((k) => {
        if (typeof payload[k] === 'boolean') payload[k] = payload[k] ? 1 : 0;
      });

      // PUT requires `id` in body (API reads from body, not query)
      if (selectedEmployee?.id && method === 'PUT') {
        payload.id = selectedEmployee.id;
      }

      // Do not overwrite date fields if user left them empty; normalize valid dates
      ['hire_date','joining_date','dob','exit_date'].forEach((k) => {
        if (payload[k] == null || payload[k] === '') {
          if (method === 'PUT') delete payload[k];
        } else if (typeof payload[k] === 'string') {
          payload[k] = payload[k].slice(0, 10);
        }
      });

      // For updates, avoid sending empty strings/nulls for any field to prevent clearing existing DB values
      if (method === 'PUT') {
        Object.keys(payload).forEach((k) => {
          if (k === 'id') return; // required for PUT
          const v = payload[k];
          if (v === '' || v === null || v === undefined) delete payload[k];
        });
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      let respJson = null;
      let respText = null;
      try { respJson = await response.json(); } catch (e) {
        try { respText = await response.text(); } catch (e2) { /* ignore */ }
      }

      if (response.ok) {
        // If this was a create, and salary inputs are present, create salary entry too
        if (method === 'POST' && respJson?.employeeId) {
          const hasSalaryBasics = salaryInputs?.effective_from && salaryInputs?.basic_salary !== '';
          if (hasSalaryBasics) {
            try {
              const salaryPayload = {
                basic_salary: Number(salaryInputs.basic_salary || 0),
                attendance_days: Number(salaryInputs.attendance_days || 0),
                total_working_days: Number(salaryInputs.total_working_days || 0),
                loan_active: String(salaryInputs.loan_active).toLowerCase() === 'yes' ? 1 : 0,
                loan_emi: Number(salaryInputs.loan_emi || 0),
                advance_payment: Number(salaryInputs.advance_payment || 0),
                salary_type: salaryInputs.salary_type,
                effective_from: salaryInputs.effective_from,
                additional_earnings: Number(salaryInputs.additional_earnings || 0),
                additional_deductions: Number(salaryInputs.additional_deductions || 0),
                pf: Number(salaryInputs.pf || 0),
                pt: Number(salaryInputs.pt || 0),
                mlwf: Number(salaryInputs.mlwf || 0),
                // Persist PL usage and remaining balance when creating salary along with employee
                pl_used: Number(salaryInputs.pl_used || 0),
                pl_balance: Number(salaryInputs.pl_balance || 0),
              };
              await fetch(`/api/employees/${respJson.employeeId}/salary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(salaryPayload)
              }).catch(() => {});
            } catch (e) {
              // Do not block employee creation if salary creation fails
              console.warn('Salary entry creation failed but employee saved:', e);
            }
          }
        }
        // Apply System Role to linked user if selected
        try {
          const roleId = formData.system_role_id || '';
          const employeeDbId = selectedEmployee ? selectedEmployee.id : respJson?.employeeId;
          if (roleId && employeeDbId) {
            await applySystemRoleToLinkedUser(employeeDbId, roleId);
          }
        } catch {}

        setSuccessMessage(selectedEmployee ? 'Employee updated successfully!' : 'Employee added successfully!');
        // Reset filters so the new record is visible
        setSearchTerm('');
        setSelectedDepartment('');
        setSelectedStatus('');
        setCurrentPage(1);
        setActiveTab('list');
        setFormData(defaultFormData);
        setSelectedEmployee(null);
        fetchEmployees();
      } else {
        const error = respJson || {};
        const fallback = respText || (error.error || error.message) || `Request failed: ${response.status}`;
        setFormErrors(error.errors || { general: fallback || 'An error occurred' });
      }
    } catch (error) {
      console.error('Error saving employee:', error);
      setFormErrors({ general: 'An error occurred while saving the employee' });
    } finally {
      setLoading(false);
    }
  };

    // Handle delete
  const handleDelete = async (employee) => {
    if (!window.confirm(`Are you sure you want to delete ${employee.first_name} ${employee.last_name}?`)) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/employees?id=${employee.id}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setSuccessMessage('Employee deleted successfully!');
        fetchEmployees();
      } else {
        const error = await response.json();
        setFormErrors({ general: error.message || 'Failed to delete employee' });
      }
    } catch (error) {
      console.error('Error deleting employee:', error);
      setFormErrors({ general: 'An error occurred while deleting the employee' });
    } finally {
      setLoading(false);
    }
  };

  const openEditForm = (employee) => {
    // Parse salary_structure JSON (if present) into granular fields so user sees current values
    let salaryParts = {};
    try {
      if (employee?.salary_structure) {
        const parsed = typeof employee.salary_structure === 'string'
          ? JSON.parse(employee.salary_structure)
          : employee.salary_structure;
        if (parsed && typeof parsed === 'object') {
          salaryParts = {
            basic_salary: parsed.basic_salary ?? '',
            hra: parsed.hra ?? '',
            conveyance: parsed.conveyance ?? '',
            medical_allowance: parsed.medical_allowance ?? '',
            special_allowance: parsed.special_allowance ?? '',
            incentives: parsed.incentives ?? '',
            deductions: parsed.deductions ?? ''
          };
        }
      }
    } catch {}

    setFormData({
      ...defaultFormData,
      ...employee,
      ...salaryParts,
      system_role_id: (() => {
        try {
          const match = roles.find(r => r.role_name === employee.role);
          return match ? String(match.id) : '';
        } catch { return ''; }
      })(),
      system_role_name: employee.role || '',
      hire_date: employee.hire_date ? employee.hire_date.split('T')[0] : '',
      joining_date: employee.joining_date ? employee.joining_date.split('T')[0] : '',
      dob: employee.dob ? employee.dob.split('T')[0] : ''
    });
    setSelectedEmployee(employee);
    setFormErrors({});
    setEditSubTab('personal'); // Initialize to first tab
    setActiveTab('edit');
  };

  const openViewForm = (employee) => {
    setSelectedEmployee(employee);
    setActiveTab('view');
  };

  // Handle CSV import
  const handleImport = async (e) => {
    e.preventDefault();
    if (!importFile) return;

    setLoading(true);
    setFormErrors({});

    try {
      const formData = new FormData();
      formData.append('file', importFile);

      const response = await fetch('/api/employees/import', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        setImportResults(data.summary);
        setSuccessMessage('Import completed successfully!');
        fetchEmployees(); // Refresh the employee list
        setImportFile(null);
      } else {
        setFormErrors({ general: data.error });
        if (data.details) {
          setFormErrors({ general: data.error, details: data.details });
        }
      }
    } catch (error) {
      setFormErrors({ general: 'An error occurred during import. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  // Download CSV template
  const downloadTemplate = async (format = 'csv') => {
    try {
      const response = await fetch(`/api/employees/import?format=${format}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'excel' ? 'employee_template.xlsx' : 'employee_template.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading template:', error);
    }
  };

  const openAddForm = () => {
    setFormData(defaultFormData);
    setFormErrors({});
    setAddSubTab('personal');
    setActiveTab('add');
  };

  // Helper: update linked user's role if a user account exists for this employee
  const applySystemRoleToLinkedUser = async (employeeDbId, roleId) => {
    try {
      if (!employeeDbId || !roleId) return;
      // Find linked user by employee id
      const res = await fetch('/api/employees/available-for-users?include_with_users=true');
      const json = await res.json();
      if (!res.ok || !json?.success) return;
      const record = (json.data || []).find(r => String(r.id) === String(employeeDbId));
      const userId = record?.user_id;
      if (!userId) return; // no linked user yet
      // Update user's role_id via Users API
      await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, role_id: Number(roleId) })
      });
    } catch {}
  };

  // Handle profile photo upload to /api/uploads
  const handleProfilePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhotoUploading(true);
  // Client-side checks: ensure it's an image and within size limits (15 MB)
      const isImage = (file.type && file.type.startsWith('image/'));
  const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
      if (!isImage) {
        setFormErrors((prev) => ({ ...prev, general: 'Please upload an image file (PNG, JPG, GIF, WebP, BMP, HEIC/HEIF, or SVG).' }));
        return;
      }
      if (file.size > MAX_BYTES) {
        setFormErrors((prev) => ({ ...prev, general: 'Image is too large. Please upload a file up to 15 MB.' }));
        return;
      }
      // Read file as base64
      const b64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const dataUrl = String(b64);
      const base64String = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name || 'upload.png', b64: base64String })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Upload failed');
      }
      const fileUrl = data?.data?.fileUrl;
      if (fileUrl) {
        setFormData((prev) => ({ ...prev, profile_photo_url: fileUrl }));
        // Also update selectedEmployee preview if present
        setSelectedEmployee((prev) => prev ? { ...prev, profile_photo_url: fileUrl } : prev);
      }
    } catch (err) {
      console.error('Photo upload error:', err);
      setFormErrors((prev) => ({ ...prev, general: err?.message || 'Failed to upload photo. Please try again.' }));
    } finally {
      setPhotoUploading(false);
    }
  };

  const formatCurrency = (amount) => {
    return amount ? new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount) : '-';
  };

  const formatDate = (date) => {
    return date ? new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }) : '-';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-24 pb-8">
            {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center">
              <UserGroupIcon className="h-8 w-8 mr-3 text-purple-600" />
              Employee Management
            </h1>
            <p className="text-gray-600">Manage your team members and organizational structure</p>
          </div>
          <div className="flex-shrink-0">
            <button
              onClick={() => {
                setActiveTab('add');
                setFormData(defaultFormData);
                setFormErrors({});
              }}
              className="inline-flex items-center space-x-2 bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-4 py-2.5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
            >
              <PlusIcon className="h-5 w-5" />
              <span>Add Employee</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-8">
          <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
            <nav className="flex" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('list')}
                className={`flex-1 py-4 px-6 text-center font-semibold text-sm transition-all duration-300 ${
                  activeTab === 'list'
                    ? 'bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Employee List ({employees.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('import');
                  setImportFile(null);
                  setImportResults(null);
                  setFormErrors({});
                }}
                className={`flex-1 py-4 px-6 text-center font-semibold text-sm transition-all duration-300 ${
                  activeTab === 'import'
                    ? 'bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Import CSV/Excel
              </button>
              {activeTab === 'edit' && (
                <button
                  className="flex-1 py-4 px-6 text-center font-semibold text-sm bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg"
                >
                  Edit Employee
                </button>
              )}
              {activeTab === 'view' && (
                <button
                  className="flex-1 py-4 px-6 text-center font-semibold text-sm bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg"
                >
                  View Employee
                </button>
              )}
            </nav>
          </div>
        </div>

        {/* Content */}
        <div className="pb-8">
          {activeTab === 'list' && (
            <>
              {/* Filters */}
              <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-6 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Search */}
                  <div className="relative">
                    <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search employees..."
                      value={searchTerm}
                      onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  {/* Department Filter */}
                  <select
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
                    className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">All Departments</option>
                    {departments.map(dept => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>

                  {/* Status Filter */}
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="terminated">Terminated</option>
                  </select>

                  {/* Clear Filters */}
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setSelectedDepartment('');
                      setSelectedStatus('');
                      setCurrentPage(1);
                    }}
                    className="px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center"
                  >
                    <FunnelIcon className="h-5 w-5 mr-2" />
                    Clear Filters
                  </button>
                </div>
              </div>

              {/* Employee Table */}
              <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden animate-slide-up">
                {loading ? (
                  <div className="p-6">
                    <div className="space-y-4">
                      {[...Array(6)].map((_, i) => (
                        <div key={i} className="skeleton h-12 w-full rounded-lg"></div>
                      ))}
                    </div>
                  </div>
                ) : errorMsg ? (
                  <div className="p-6 text-center">
                    <div className="mb-2 text-red-700 bg-red-50 border border-red-200 inline-block px-3 py-2 rounded">{errorMsg}</div>
                    <div>
                      <button onClick={fetchEmployees} className="mt-2 inline-flex items-center px-4 py-2 rounded-lg bg-[#64126D] text-white">Retry</button>
                    </div>
                  </div>
                ) : employees.length === 0 ? (
                  <div className="text-center py-16">
                    <UserGroupIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-600 mb-2">No employees yet</h3>
                    <p className="text-gray-500 mb-6">Get started by adding your first employee</p>
                    <button
                      onClick={() => setActiveTab('add')}
                      className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl inline-flex items-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                    >
                      <PlusIcon className="h-5 w-5" />
                      <span>Add Your First Employee</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                          <tr>
                            <th className="px-3 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100 w-28">
                              Employee ID
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
                              Employee
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
                              Department
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
                              Position
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
                              Hire Date
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
                              Status
                            </th>
                            <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {employees.map((employee) => (
                            <tr key={employee.id} className="hover:bg-gray-50 transition-colors duration-200 motion-safe:hover:scale-[1.01]">
                              <td className="px-3 py-4 whitespace-nowrap w-28">
                                <div className="text-sm font-medium text-[#64126D] truncate">{employee.employee_id}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <Avatar src={employee.profile_photo_url} firstName={employee.first_name} lastName={employee.last_name} size={48} />
                                  <div className="ml-4">
                                    <div className="text-sm font-medium text-gray-900">
                                      {employee.first_name} {employee.last_name}
                                    </div>
                                    <div className="text-sm text-gray-500">
                                      {employee.email}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{employee.department || '-'}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{employee.position || '-'}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{formatDate(employee.hire_date)}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                  employee.status === 'active' 
                                    ? 'bg-green-300 text-black'
                                    : employee.status === 'inactive'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-red-300 text-red-800'
                                }`}>
                                  {employee.status}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <div className="flex space-x-2 justify-end">
                                  <button
                                    onClick={() => openViewForm(employee)}
                                    className="text-purple-600 hover:text-purple-900 p-2 rounded-lg hover:bg-purple-50 transition-colors"
                                    title="View Details"
                                  >
                                    <EyeIcon className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => openEditForm(employee)}
                                    className="text-blue-600 hover:text-blue-900 p-2 rounded-lg hover:bg-blue-50 transition-colors"
                                    title="Edit Employee"
                                  >
                                    <PencilIcon className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(employee)}
                                    className="text-red-600 hover:text-red-900 p-2 rounded-lg hover:bg-red-50 transition-colors"
                                    title="Delete Employee"
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Pagination */}
                    {pagination.total > 1 && (
                      <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
                        <div className="flex-1 flex justify-between sm:hidden">
                          <button
                            onClick={() => setCurrentPage(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                          >
                            Previous
                          </button>
                          <button
                            onClick={() => setCurrentPage(currentPage + 1)}
                            disabled={currentPage === pagination.total}
                            className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                          >
                            Next
                          </button>
                        </div>
                        <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm text-gray-700">
                              Showing <span className="font-medium">{((currentPage - 1) * pagination.limit) + 1}</span> to{' '}
                              <span className="font-medium">
                                {Math.min(currentPage * pagination.limit, pagination.totalRecords)}
                              </span> of{' '}
                              <span className="font-medium">{pagination.totalRecords}</span> results
                            </p>
                          </div>
                          <div>
                            <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                              <button
                                onClick={() => setCurrentPage(currentPage - 1)}
                                disabled={currentPage === 1}
                                className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                              >
                                <ChevronLeftIcon className="h-5 w-5" />
                              </button>
                              <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                                {currentPage} of {pagination.total}
                              </span>
                              <button
                                onClick={() => setCurrentPage(currentPage + 1)}
                                disabled={currentPage === pagination.total}
                                className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                              >
                                <ChevronRightIcon className="h-5 w-5" />
                              </button>
                            </nav>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {activeTab === 'add' && (
            <div className="grid grid-cols-12 gap-6">
              {/* Left Pane: Employee list */}
              <aside className="col-span-12 lg:col-span-3">
                <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden max-h-[calc(100vh-220px)] flex flex-col">
                  <div className="px-4 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-gray-900 tracking-tight">EMPLOYEE</h2>
                        <p className="text-xs text-gray-500">{employees.length} Total</p>
                      </div>
                      <button
                        onClick={() => setActiveTab('add')}
                        className="h-8 px-3 rounded-lg text-white text-sm font-medium"
                        style={{ background: 'linear-gradient(135deg, #64126D 0%, #86288F 100%)' }}
                        title="Add Employee"
                      >
                        Add
                      </button>
                    </div>
                    <div className="relative mt-4">
                      <input
                        type="text"
                        placeholder="Search"
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                      />
                      <svg className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12.9 14.32a8 8 0 111.414-1.414l4.387 4.387a1 1 0 01-1.414 1.414l-4.387-4.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z" clipRule="evenodd"/></svg>
                    </div>
                  </div>
                  <div className="overflow-y-auto">
                    {employees.map(emp => (
                      <div key={emp.id} onClick={() => openViewForm(emp)} role="button" tabIndex={0} className="px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer focus:outline-none" onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openViewForm(emp); }}>
                        <div className="flex items-center">
                          <Avatar src={emp.profile_photo_url} firstName={emp.first_name} lastName={emp.last_name} size={44} />
                          <div className="ml-3 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{emp.first_name} {emp.last_name}</p>
                            <p className="text-xs text-gray-500 truncate">{emp.email}</p>
                            <p className="text-xs text-gray-400">Hired: {formatDate(emp.hire_date)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {employees.length === 0 && (
                      <div className="p-6 text-center text-sm text-gray-500">No employees found</div>
                    )}
                  </div>
                </div>
              </aside>

              {/* Right Pane: Add Employee form */}
              <section className="col-span-12 lg:col-span-9">
                <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-6 lg:p-8 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-2xl font-semibold text-gray-900">Add Employee</h3>
                  </div>

                  {/* Sub Tabs */}
                  <div className="border-b border-gray-200 mb-6">
                    <nav className="flex flex-wrap gap-4" aria-label="Employee Sections">
                      {[
                        { key: 'personal', label: 'Personal Information' },
                        { key: 'contact', label: 'Contact Information' },
                        { key: 'work', label: 'Work Details' },
                        { key: 'academic', label: 'Academic & Experience' },
                        { key: 'govt', label: 'Government IDs' },
                        { key: 'bank', label: 'Bank Details' },
                        { key: 'attendance', label: 'Attendance & Exit' },
                        { key: 'salary', label: 'Salary Structure' },
                      ].map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setAddSubTab(t.key)}
                          className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                            addSubTab === t.key
                              ? 'border-[#86288F] text-[#64126D]'
                              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </nav>
                  </div>

                  {successMessage && (
                    <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
                      {successMessage}
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-8">
                    {formErrors.general && (
                      <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                        {formErrors.general}
                      </div>
                    )}
                    {/* Personal Information */}
                    {addSubTab === 'personal' && (
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Personal Information</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="md:col-span-3 flex items-center gap-4">
                          <div className="relative">
                            <Avatar src={formData.profile_photo_url} firstName={formData.first_name} lastName={formData.last_name} size={80} />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Profile Photo</label>
                            <input type="file" accept="image/*,.heic,.heif,.bmp" onChange={handleProfilePhotoChange} className="block text-sm text-gray-600" />
                            {photoUploading && <p className="text-xs text-purple-600 mt-1">Uploading...</p>}
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">First Name <span className="text-red-500">*</span></label>
                          <input type="text" value={formData.first_name || ''} onChange={(e) => setFormData({ ...formData, first_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Middle Name</label>
                          <input type="text" value={formData.middle_name || ''} onChange={(e) => setFormData({ ...formData, middle_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Last Name <span className="text-red-500">*</span></label>
                          <input type="text" value={formData.last_name || ''} onChange={(e) => setFormData({ ...formData, last_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Employee ID <span className="text-red-500">*</span></label>
                          <div className="flex items-center gap-2">
                            <input type="text" value={formData.employee_id || ''} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })} className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required />
                            <button type="button" className="px-3 py-2 bg-gray-100 text-sm rounded-lg border border-gray-200 hover:bg-gray-200" onClick={() => setFormData({ ...formData, employee_id: nextAtsId })} title="Auto-fill next ATS id">Auto-fill</button>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">Next ATS: <span className="font-medium text-[#64126D]">{nextAtsId}</span></p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                          <input type="text" value={formData.username || ''} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">System Role</label>
                          <select
                            value={formData.system_role_id || ''}
                            onChange={(e) => {
                              const nextId = e.target.value;
                              const picked = roles.find(r => String(r.id) === String(nextId));
                              setFormData({
                                ...formData,
                                system_role_id: nextId,
                                role: picked ? picked.role_name : '',
                                system_role_name: picked ? picked.role_name : ''
                              });
                            }}
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                          >
                            <option value="">Select a role</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>{r.role_name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Gender</label>
                          <select value={formData.gender || ''} onChange={(e) => setFormData({ ...formData, gender: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                            <option value="">Select</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Date of Birth</label>
                          <input type="date" value={formData.dob || ''} onChange={(e) => setFormData({ ...formData, dob: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Marital Status</label>
                          <select value={formData.marital_status || ''} onChange={(e) => setFormData({ ...formData, marital_status: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                            <option value="">Select</option>
                            <option value="Single">Single</option>
                            <option value="Married">Married</option>
                            {/* Map these to Other in DB representation */}
                            <option value="Other">Divorced</option>
                            <option value="Other">Widowed</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Status <span className="text-red-500">*</span></label>
                          <select value={formData.employment_status || 'active'} onChange={(e) => setFormData({ ...formData, employment_status: e.target.value, status: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                            <option value="terminated">Terminated</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Contact Information */}
                    {addSubTab === 'contact' && (
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Contact Information</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Email <span className="text-red-500">*</span></label>
                          <input type="email" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Personal Email</label>
                          <input type="email" value={formData.personal_email || ''} onChange={(e) => setFormData({ ...formData, personal_email: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Mobile</label>
                          <input type="tel" value={formData.mobile || ''} onChange={(e) => setFormData({ ...formData, mobile: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div className="md:col-span-3">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Present Address</label>
                          <textarea rows={3} value={formData.present_address || formData.address || ''} onChange={(e) => setFormData({ ...formData, present_address: e.target.value, address: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">City</label>
                          <input type="text" value={formData.city || ''} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">State</label>
                          <input type="text" value={formData.state || ''} onChange={(e) => setFormData({ ...formData, state: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Country</label>
                          <input type="text" value={formData.country || ''} onChange={(e) => setFormData({ ...formData, country: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">PIN</label>
                          <input type="text" value={formData.pin || ''} onChange={(e) => setFormData({ ...formData, pin: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Work Details */}
                    {addSubTab === 'work' && (
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Work Details</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                          <input type="text" value={formData.department || ''} onChange={(e) => setFormData({ ...formData, department: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                          <input type="text" value={formData.position || ''} onChange={(e) => setFormData({ ...formData, position: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Employee Type</label>
                          <select value={formData.employee_type || ''} onChange={(e) => setFormData({ ...formData, employee_type: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                            <option value="">Select</option>
                            <option value="Permanent">Permanent</option>
                            <option value="Contract">Contract</option>
                            <option value="Intern">Intern</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Grade</label>
                          <input type="text" value={formData.grade || ''} onChange={(e) => setFormData({ ...formData, grade: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Workplace</label>
                          <input type="text" value={formData.workplace || ''} onChange={(e) => setFormData({ ...formData, workplace: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Level</label>
                          <input type="text" value={formData.level || ''} onChange={(e) => setFormData({ ...formData, level: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Reporting To</label>
                          <input type="text" value={formData.reporting_to || ''} onChange={(e) => setFormData({ ...formData, reporting_to: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Hire Date</label>
                          <input type="date" value={formData.hire_date || ''} onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Joining Date</label>
                          <input type="date" value={formData.joining_date || ''} onChange={(e) => setFormData({ ...formData, joining_date: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">PF No</label>
                          <input type="text" value={formData.pf_no || ''} onChange={(e) => setFormData({ ...formData, pf_no: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Salary</label>
                          <input type="number" min="0" step="0.01" value={formData.salary || ''} onChange={(e) => setFormData({ ...formData, salary: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Actions */}
                    {/* Statutory */}


                    {/* Academic & Experience */}
                    {addSubTab === 'academic' && (
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Academic & Experience</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Qualification</label>
                          <input type="text" value={formData.qualification || ''} onChange={(e) => setFormData({ ...formData, qualification: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Institute</label>
                          <input type="text" value={formData.institute || ''} onChange={(e) => setFormData({ ...formData, institute: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Passing Year</label>
                          <input type="text" value={formData.passing_year || ''} onChange={(e) => setFormData({ ...formData, passing_year: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div className="md:col-span-3">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Work Experience</label>
                          <textarea rows={2} value={formData.work_experience || ''} onChange={(e) => setFormData({ ...formData, work_experience: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Government IDs */}
                    {addSubTab === 'govt' && (
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Government IDs</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">PAN</label>
                          <input type="text" value={formData.pan || ''} onChange={(e) => setFormData({ ...formData, pan: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">AADHAR</label>
                          <input type="text" value={formData.aadhar || ''} onChange={(e) => setFormData({ ...formData, aadhar: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Gratuity No</label>
                          <input type="text" value={formData.gratuity_no || ''} onChange={(e) => setFormData({ ...formData, gratuity_no: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">UAN</label>
                          <input type="text" value={formData.uan || ''} onChange={(e) => setFormData({ ...formData, uan: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">ESI No</label>
                          <input type="text" value={formData.esi_no || ''} onChange={(e) => setFormData({ ...formData, esi_no: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Bank Details */}
                    {addSubTab === 'bank' && (
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Bank Details</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Bank Name</label>
                          <input type="text" value={formData.bank_name || ''} onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Branch</label>
                          <input type="text" value={formData.bank_branch || ''} onChange={(e) => setFormData({ ...formData, bank_branch: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Account Holder Name</label>
                          <input type="text" value={formData.account_holder_name || ''} onChange={(e) => setFormData({ ...formData, account_holder_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Account Number</label>
                          <input type="text" value={formData.bank_account_no || ''} onChange={(e) => setFormData({ ...formData, bank_account_no: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">IFSC</label>
                          <input type="text" value={formData.bank_ifsc || ''} onChange={(e) => setFormData({ ...formData, bank_ifsc: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Attendance & Exit */}
                    {addSubTab === 'attendance' && (
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Attendance & Exit</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Biometric ID</label>
                          <input type="text" value={formData.biometric_code || ''} onChange={(e) => setFormData({ ...formData, biometric_code: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Attendance ID</label>
                          <input type="text" value={formData.attendance_id || ''} onChange={(e) => setFormData({ ...formData, attendance_id: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Exit Date</label>
                          <input type="date" value={formData.exit_date || ''} onChange={(e) => setFormData({ ...formData, exit_date: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div className="md:col-span-3">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Exit Reason</label>
                          <textarea rows={2} value={formData.exit_reason || ''} onChange={(e) => setFormData({ ...formData, exit_reason: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Salary Structure */}
                    {addSubTab === 'salary' && (
                      <div className="space-y-6">
                        {/* Header */}
                        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 border border-purple-200">
                          <div className="flex items-center gap-3 mb-2">
                            <CurrencyDollarIcon className="h-8 w-8 text-purple-600" />
                            <div>
                              <h4 className="text-2xl font-bold text-gray-900">Salary Structure</h4>
                              <p className="text-sm text-purple-700 mt-1">Annual Leave: 21 days (April - March financial year)</p>
                              <p className="text-xs text-gray-600 mt-1">Sunday: Off | Saturday: 1st, 3rd Working | OT: Overtime</p>
                            </div>
                          </div>
                        </div>
                        {/* DB-backed salary preview / selector */}
                        <div>
                          {salaryLoading ? (
                            <div className="text-sm text-gray-600 py-2">Loading salary rows...</div>
                          ) : salaryError ? (
                            <div className="text-sm text-red-600 py-2">Error loading salary: {salaryError}</div>
                          ) : (salaryRows && salaryRows.length > 0) ? (
                            <div className="bg-white p-3 rounded-lg border border-gray-200 mb-4">
                              <div className="flex items-center justify-end gap-2 mb-2">
                                <button type="button" onClick={() => loadSalaryRows(selectedEmployee?.id)} className="text-xs px-2 py-1 rounded bg-gray-100 border">Reload from DB</button>
                                <button type="button" onClick={() => {
                                  // copy DB values into the form explicitly (same as load but safe)
                                  loadSalaryRows(selectedEmployee?.id);
                                }} className="text-xs px-2 py-1 rounded bg-white border">Load DB values</button>
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="text-sm text-gray-700">
                                  <div className="font-medium">Salary row loaded from DB</div>
                                  <div className="text-xs text-gray-500">Effective from: {salaryRows[0].effective_from ? new Date(salaryRows[0].effective_from).toLocaleDateString() : '—'}</div>
                                </div>
                                <div className="text-sm text-gray-700">
                                  <div>Gross: ₹{salaryRows[0].gross_salary ?? salaryRows[0].gross ?? '—'}</div>
                                </div>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-700">
                                <div>BASIC+DA: {salaryRows[0].basic_da ?? ((salaryRows[0].basic || 0) + (salaryRows[0].da || 0))}</div>
                                <div>HRA: {salaryRows[0].hra ?? '—'}</div>
                                <div>Conveyance: {salaryRows[0].conveyance_allowance ?? salaryRows[0].conveyance ?? '—'}</div>
                                <div>Call allowance: {salaryRows[0].call_allowance ?? salaryRows[0].call ?? '—'}</div>
                                <div>Other allowance: {salaryRows[0].other_allowance ?? salaryRows[0].other ?? '—'}</div>
                              </div>
                              {/* Debug: show raw API payload (compact) so we can confirm keys like gross_salary */}
                              {salaryRaw ? (
                                <pre className="text-xs text-gray-500 mt-2 max-h-36 overflow-auto bg-gray-50 p-2 rounded">{JSON.stringify(salaryRaw, null, 2)}</pre>
                              ) : null}
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500 py-2">No persisted salary rows found for this employee.</div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                          {/* Left Column - Form Fields */}
                          <div className="lg:col-span-2 space-y-6">
                            {/* Employee Details */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <UserGroupIcon className="h-5 w-5 text-purple-600" />
                                Employee Details
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Full Name</label>
                                  <input 
                                    type="text" 
                                    value={`${formData.first_name || ''} ${formData.last_name || ''}`.trim()} 
                                    disabled
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Designation</label>
                                  <input 
                                    type="text" 
                                    value={formData.position || ''} 
                                    disabled
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Leaves */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <CalendarDaysIcon className="h-5 w-5 text-blue-600" />
                                Leaves
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Annual Leaves</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.annual_leaves || 21}
                                    onChange={(e) => setSalaryField('annual_leaves', e.target.value, false)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">PL Used</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.pl_used || ''}
                                    onChange={(e) => setSalaryField('pl_used', e.target.value, false)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">PL Balance</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.pl_balance || ''}
                                    disabled
                                    placeholder="Auto-calculated"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* General Details */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <CalendarDaysIcon className="h-5 w-5 text-orange-600" />
                                General Details
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Month Days</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.month_days || ''}
                                    onChange={(e) => setSalaryField('month_days', e.target.value)}
                                    placeholder="e.g., 30"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Working Days</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.working_days || ''}
                                    onChange={(e) => setSalaryField('working_days', e.target.value)}
                                    placeholder="Auto-calculated"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">3. Week Offs</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.week_offs || ''}
                                    onChange={(e) => setSalaryField('week_offs', e.target.value)}
                                    placeholder="Auto-calculated"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">4. PL Used</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.pl_used || ''}
                                    onChange={(e) => setSalaryField('pl_used', e.target.value, false)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">5. Absent</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.absent_days || ''}
                                    onChange={(e) => setSalaryField('absent_days', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">6. Paid Days</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.paid_days || ''}
                                    onChange={(e) => setSalaryField('paid_days', e.target.value)}
                                    placeholder="Auto-calculated"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">7. Holiday Working Days</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.holiday_working_days || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, holiday_working_days: e.target.value })}
                                    placeholder="From holiday master"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">8. OT Hours</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.ot_hours || ''}
                                    onChange={(e) => setSalaryField('ot_hours', e.target.value)}
                                    step="0.5"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">9. OT Rate</label>
                                  <input
                                    type="number"
                                    value={salaryData.ot_rate || ''}
                                    onChange={(e) => setSalaryField('ot_rate', e.target.value)}
                                    step="0.1"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                    placeholder="Multiplier (e.g., 1.5)"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Salary Breakup */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <CurrencyDollarIcon className="h-5 w-5 text-green-600" />
                                Salary Breakup
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Gross Salary
                                    <span className="ml-2 text-xs text-gray-500">(editable)</span>
                                  </label>
                                  <input 
                                    type="number" 
                                    value={salaryData.gross_salary || ''}
                                    onChange={(e) => setSalaryField('gross_salary', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-semibold"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Basic + DA
                                    <small className="ml-2 text-xs text-gray-500">Basic+DA = 60% of (Adjusted Gross − Other Allowance)</small>
                                    {salaryData.manual_overrides?.basic_da ? <span className="ml-2 text-xs text-yellow-700">(manual)</span> : null}
                                  </label>
                                  <div className="flex gap-2">
                                    <input 
                                      type="number" 
                                      value={salaryData.basic_da || ''}
                                      onChange={(e) => setSalaryField('basic_da', e.target.value)}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                    />
                                    {salaryData.manual_overrides?.basic_da ? (
                                      <button type="button" onClick={() => resetFormula('basic_da')} className="text-xs text-gray-600 px-2">Reset</button>
                                    ) : null}
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">3. HRA
                                    <small className="ml-2 text-xs text-gray-500">HRA = 20% of (Adjusted Gross − Other Allowance)</small>
                                    {salaryData.manual_overrides?.hra ? <span className="ml-2 text-xs text-yellow-700">(manual)</span> : null}
                                  </label>
                                  <div className="flex gap-2">
                                    <input 
                                      type="number" 
                                      value={salaryData.hra || ''}
                                      onChange={(e) => setSalaryField('hra', e.target.value)}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                    />
                                    {salaryData.manual_overrides?.hra ? (
                                      <button type="button" onClick={() => resetFormula('hra')} className="text-xs text-gray-600 px-2">Reset</button>
                                    ) : null}
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">4. Conveyance Allowance
                                    <small className="ml-2 text-xs text-gray-500">Conveyance = 10% of (Adjusted Gross − Other Allowance)</small>
                                    {salaryData.manual_overrides?.conveyance_allowance ? <span className="ml-2 text-xs text-yellow-700">(manual)</span> : null}
                                  </label>
                                  <div className="flex gap-2">
                                    <input 
                                      type="number" 
                                      value={salaryData.conveyance_allowance || ''}
                                      onChange={(e) => setSalaryField('conveyance_allowance', e.target.value)}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                    />
                                    {salaryData.manual_overrides?.conveyance_allowance ? (
                                      <button type="button" onClick={() => resetFormula('conveyance_allowance')} className="text-xs text-gray-600 px-2">Reset</button>
                                    ) : null}
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">5. Call Allowance</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.call_allowance || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, call_allowance: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">6. Other Allowance
                                    <small className="ml-2 text-xs text-gray-500">Shown additive to CTC; excluded from base split when &gt; 0</small>
                                  </label>
                                  <div className="flex gap-2">
                                    <input 
                                      type="number" 
                                      value={salaryData.other_allowance || ''}
                                      onChange={(e) => setSalaryField('other_allowance', e.target.value)}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                    />
                                    {salaryData.manual_overrides?.other_allowance ? (
                                      <button type="button" onClick={() => resetFormula('other_allowance')} className="text-xs text-gray-600 px-2">Reset</button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Other Income */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <ArrowTrendingUpIcon className="h-5 w-5 text-teal-600" />
                                Other Income
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Holiday Working (Hours)</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.holiday_working_hours || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, holiday_working_hours: e.target.value })}
                                    step="0.5"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Weekly Off Working</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.weekly_off_working || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, weekly_off_working: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">3. OT Charges</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.ot_charges || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, ot_charges: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Employee Contribution (Deductions) */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <ArrowTrendingDownIcon className="h-5 w-5 text-red-600" />
                                Employee Contribution (Deductions)
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Employee Provident Fund</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.employee_pf || ''}
                                    onChange={(e) => setSalaryField('employee_pf', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Employee Professional Tax</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.employee_pt || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, employee_pt: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">3. Retention Amount</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.retention_amount || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, retention_amount: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">4. MLWF</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.mlwf_employee || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, mlwf_employee: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div className="md:col-span-2">
                                  <label className="block text-sm font-medium text-gray-700 mb-2">5. Other Deductions</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.other_deductions || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, other_deductions: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Employer Contributions (Company) */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <CurrencyDollarIcon className="h-5 w-5 text-purple-600" />
                                Employer Contributions (Company)
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Employer Provident Fund</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.employer_pf || ''}
                                    onChange={(e) => setSalaryField('employer_pf', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Bonus (8.33% on Basic+DA)</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.bonus || ''}
                                    onChange={(e) => setSalaryField('bonus', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">3. MLWF (₹13)</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.mlwf_company || 13}
                                    onChange={(e) => setSalaryData({ ...salaryData, mlwf_company: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">4. Medical/PA Accident Insurance (₹500)</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.medical_insurance || 500}
                                    onChange={(e) => setSalaryData({ ...salaryData, medical_insurance: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Right Column - Live Preview */}
                          <div className="lg:col-span-1">
                            <div className="bg-white rounded-lg border border-gray-300 p-4 sticky top-6">
                              <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">Summary</h3>
                              
                              <div className="space-y-3">
                                {/* In-Hand Salary */}
                                <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                                  <p className="text-xs text-gray-600 mb-1">In-Hand Salary</p>
                                  <input
                                    type="number"
                                    value={salaryData.in_hand_salary || ''}
                                    onChange={(e) => setSalaryField('in_hand_salary', e.target.value)}
                                    className="w-full text-2xl font-bold text-purple-700 text-right border-0 bg-transparent"
                                  />
                                </div>

                                {/* CTC */}
                                <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                                  <p className="text-xs text-gray-600 mb-1">Employee CTC</p>
                                  <input
                                    type="number"
                                    value={salaryData.employee_ctc || ''}
                                    onChange={(e) => setSalaryField('employee_ctc', e.target.value)}
                                    className="w-full text-2xl font-bold text-orange-700 text-right border-0 bg-transparent"
                                  />
                                </div>

                                {/* Breakdown */}
                                <div className="pt-2 border-t border-gray-200">
                                  <div className="space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Gross:</span>
                                      <span className="font-medium">₹{salaryData.gross_salary || '0.00'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Deductions:</span>
                                      <span className="font-medium text-red-600">₹{(parseFloat(salaryData.employee_pf || 0) + parseFloat(salaryData.employee_pt || 0) + parseFloat(salaryData.retention_amount || 0) + parseFloat(salaryData.mlwf_employee || 0) + parseFloat(salaryData.other_deductions || 0)).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Company:</span>
                                      <span className="font-medium text-purple-600">₹{(parseFloat(salaryData.employer_pf || 0) + parseFloat(salaryData.bonus || 0) + parseFloat(salaryData.mlwf_company || 13) + parseFloat(salaryData.medical_insurance || 500)).toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Attendance */}
                                <div className="pt-2 border-t border-gray-200">
                                  <div className="space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Working Days:</span>
                                      <span className="font-medium">{salaryData.working_days || 0}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Paid Days:</span>
                                      <span className="font-medium text-green-600">{salaryData.paid_days || 0}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-6 border-t border-gray-200">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            const idx = addSubTabOrder.indexOf(addSubTab);
                            if (idx > 0) setAddSubTab(addSubTabOrder[idx - 1]);
                          }}
                          disabled={addSubTabOrder.indexOf(addSubTab) === 0}
                          className="px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const idx = addSubTabOrder.indexOf(addSubTab);
                            if (idx < addSubTabOrder.length - 1) setAddSubTab(addSubTabOrder[idx + 1]);
                          }}
                          disabled={addSubTabOrder.indexOf(addSubTab) === addSubTabOrder.length - 1}
                          className="px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                      <div className="flex gap-3">
                        <button type="button" onClick={() => setActiveTab('list')} className="px-6 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
                        <button type="submit" disabled={loading} className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1">{loading ? 'Saving...' : 'Save Employee'}</button>
                      </div>
                    </div>
                  </form>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'import' && (
            <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-8 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
              <h3 className="text-xl font-semibold text-gray-900 mb-6">Import Employees</h3>
              
              {/* Instructions */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">Import Instructions:</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• Supported formats: CSV (.csv) and Excel (.xlsx, .xls)</li>
                  <li>• Required columns: SR.NO, Employee Code, Full Name</li>
                  <li>• Optional columns: Phone, Department, Position, Hire Date, Salary, Address, Notes</li>
                  <li>• Full Name will be split into First Name and Last Name</li>
                  <li>• Email will be auto-generated from the name</li>
                  <li>• Maximum file size: 5MB</li>
                </ul>
              </div>

              {/* Download Templates */}
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => downloadTemplate('csv')}
                  className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <DocumentArrowDownIcon className="h-5 w-5 mr-2" />
                  Download CSV Template
                </button>
                <button
                  onClick={() => downloadTemplate('excel')}
                  className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <DocumentArrowDownIcon className="h-5 w-5 mr-2" />
                  Download Excel Template
                </button>
              </div>

              {formErrors.general && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm font-medium">{formErrors.general}</p>
                  {formErrors.details && formErrors.details.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-y-auto">
                      <p className="text-red-600 text-xs font-medium mb-1">Validation Details:</p>
                      <ul className="text-xs text-red-500 space-y-1">
                        {formErrors.details.map((detail, index) => (
                          <li key={index}>• {detail}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {importResults && (
                <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h4 className="text-sm font-semibold text-green-900 mb-2">Import Results:</h4>
                  <div className="text-sm text-green-800 space-y-1">
                    <p>• Total processed: {importResults.total}</p>
                    <p>• Successfully imported: {importResults.success}</p>
                    <p>• Errors: {importResults.errors}</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleImport} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select CSV File
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setImportFile(e.target.files[0])}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                    required
                  />
                  {importFile && (
                    <p className="text-sm text-gray-600 mt-2">
                      Selected: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                </div>

                <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setActiveTab('list')}
                    className="px-6 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !importFile}
                    className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                  >
                    {loading ? 'Importing...' : 'Import Employees'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'edit' && selectedEmployee && (
            <div className="grid grid-cols-12 gap-6">
              {/* Left Pane: Employee list */}
              <aside className="col-span-12 lg:col-span-3">
                <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden max-h-[calc(100vh-220px)] flex flex-col">
                  <div className="px-4 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-gray-900 tracking-tight">EMPLOYEE</h2>
                        <p className="text-xs text-gray-500">{employees.length} Total</p>
                      </div>
                      <button
                        onClick={() => setActiveTab('add')}
                        className="h-8 px-3 rounded-lg text-white text-sm font-medium"
                        style={{ background: 'linear-gradient(135deg, #64126D 0%, #86288F 100%)' }}
                        title="Add Employee"
                      >
                        Add
                      </button>
                    </div>
                    <div className="relative mt-4">
                      <input
                        type="text"
                        placeholder="Search"
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                      />
                      <svg className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12.9 14.32a8 8 0 111.414-1.414l4.387 4.387a1 1 0 01-1.414 1.414l-4.387-4.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z" clipRule="evenodd"/></svg>
                    </div>
                  </div>
                  <div className="overflow-y-auto">
                    {employees.map(emp => (
                      <div 
                        key={emp.id} 
                        className={`px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                          selectedEmployee?.id === emp.id ? 'bg-purple-50 border-purple-200' : ''
                        }`}
                        onClick={() => {
                          setSelectedEmployee(emp);
                          setFormData(emp);
                          setEditSubTab('personal');
                        }}
                      >
                        <div className="flex items-center">
                          <Avatar src={emp.profile_photo_url} firstName={emp.first_name} lastName={emp.last_name} size={44} />
                          <div className="ml-3 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{emp.first_name} {emp.last_name}</p>
                            <p className="text-xs text-gray-500 truncate">{emp.email}</p>
                            <p className="text-xs text-gray-400">Hired: {formatDate(emp.hire_date)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {employees.length === 0 && (
                      <div className="p-6 text-center text-sm text-gray-500">No employees found</div>
                    )}
                  </div>
                </div>
              </aside>

              {/* Right Pane: Edit Employee form */}
              <section className="col-span-12 lg:col-span-9">
                <div className="bg-white shadow-lg rounded-xl border border-gray-200 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
                  {/* Edit Header */}
                  <div className="px-6 lg:px-8 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-gray-50">
                    <div className="flex items-center justify-between gap-6">
                      <div className="flex items-center gap-4">
                        <Avatar src={selectedEmployee.profile_photo_url} firstName={selectedEmployee.first_name} lastName={selectedEmployee.last_name} size={56} />
                        <div>
                          <h3 className="text-2xl font-semibold">Editing {selectedEmployee.first_name} {selectedEmployee.last_name}</h3>
                          <p className="text-sm mt-1">Employee ID • <span className="text-[#64126D] font-medium">{selectedEmployee.employee_id}</span></p>
                          <p className="text-sm">{selectedEmployee.department || '—'} {selectedEmployee.position ? `• ${selectedEmployee.position}` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setActiveTab('list')}
                          className="px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-50 transition-colors"
                        >
                          Back to List
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="p-6 lg:p-8">

                  {/* Sub Tabs */}
                  <div className="border-b border-gray-200 mb-6">
                    <nav className="flex flex-wrap gap-4" aria-label="Employee Sections">
                      {[
                        { key: 'personal', label: 'Personal Information' },
                        { key: 'contact', label: 'Contact Information' },
                        { key: 'work', label: 'Work Details' },
                        { key: 'academic', label: 'Academic & Experience' },
                        { key: 'govt', label: 'Government IDs' },
                        { key: 'bank', label: 'Bank Details' },
                        { key: 'attendance', label: 'Attendance & Exit' },
                        { key: 'salary', label: 'Salary Structure' },
                      ].map((t) => (
                        <button
                          key={t.key}
                          onClick={() => setEditSubTab(t.key)}
                          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            editSubTab === t.key
                              ? 'border-purple-500 text-purple-600'
                              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </nav>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-8">
                    {formErrors.general && (
                      <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                        {formErrors.general}
                      </div>
                    )}

                    {/* Personal Information */}
                    {editSubTab === 'personal' && (
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 mb-3">Personal Information</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="md:col-span-3 flex items-center gap-4">
                            <div className="relative">
                              <Avatar src={formData.profile_photo_url} firstName={formData.first_name} lastName={formData.last_name} size={80} />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Profile Photo</label>
                              <input type="file" accept="image/*,.heic,.heif,.bmp" onChange={handleProfilePhotoChange} className="block text-sm text-gray-600" />
                              {photoUploading && <p className="text-xs text-purple-600 mt-1">Uploading...</p>}
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">First Name <span className="text-red-500">*</span></label>
                            <input type="text" value={formData.first_name || ''} onChange={(e) => setFormData({ ...formData, first_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Middle Name</label>
                            <input type="text" value={formData.middle_name || ''} onChange={(e) => setFormData({ ...formData, middle_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Last Name <span className="text-red-500">*</span></label>
                            <input type="text" value={formData.last_name || ''} onChange={(e) => setFormData({ ...formData, last_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Employee ID <span className="text-red-500">*</span></label>
                            <input type="text" value={formData.employee_id || ''} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                            <input type="text" value={formData.username || ''} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">System Role</label>
                            <select
                              value={formData.system_role_id || ''}
                              onChange={(e) => {
                                const nextId = e.target.value;
                                const picked = roles.find(r => String(r.id) === String(nextId));
                                setFormData({
                                  ...formData,
                                  system_role_id: nextId,
                                  role: picked ? picked.role_name : '',
                                  system_role_name: picked ? picked.role_name : ''
                                });
                              }}
                              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                            >
                              <option value="">Select a role</option>
                              {roles.map((r) => (
                                <option key={r.id} value={r.id}>{r.role_name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Gender</label>
                            <select value={formData.gender || ''} onChange={(e) => setFormData({ ...formData, gender: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                              <option value="">Select</option>
                              <option value="male">Male</option>
                              <option value="female">Female</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Date of Birth</label>
                            <input type="date" value={formData.dob || ''} onChange={(e) => setFormData({ ...formData, dob: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Marital Status</label>
                            <select value={formData.marital_status || ''} onChange={(e) => setFormData({ ...formData, marital_status: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                              <option value="">Select</option>
                              <option value="Single">Single</option>
                              <option value="Married">Married</option>
                              <option value="Other">Divorced</option>
                              <option value="Other">Widowed</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Status <span className="text-red-500">*</span></label>
                            <select value={formData.employment_status || formData.status || 'active'} onChange={(e) => setFormData({ ...formData, employment_status: e.target.value, status: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required>
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                              <option value="terminated">Terminated</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Contact Information */}
                    {editSubTab === 'contact' && (
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 mb-3">Contact Information</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Email <span className="text-red-500">*</span></label>
                            <input type="email" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Personal Email</label>
                            <input type="email" value={formData.personal_email || ''} onChange={(e) => setFormData({ ...formData, personal_email: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Mobile</label>
                            <input type="tel" value={formData.mobile || ''} onChange={(e) => setFormData({ ...formData, mobile: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div className="md:col-span-3">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Present Address</label>
                            <textarea rows={3} value={formData.present_address || formData.address || ''} onChange={(e) => setFormData({ ...formData, present_address: e.target.value, address: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">City</label>
                            <input type="text" value={formData.city || ''} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">State</label>
                            <input type="text" value={formData.state || ''} onChange={(e) => setFormData({ ...formData, state: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Country</label>
                            <input type="text" value={formData.country || ''} onChange={(e) => setFormData({ ...formData, country: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">PIN</label>
                            <input type="text" value={formData.pin || ''} onChange={(e) => setFormData({ ...formData, pin: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Work Details */}
                    {editSubTab === 'work' && (
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 mb-3">Work Details</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                            <input type="text" value={formData.department || ''} onChange={(e) => setFormData({ ...formData, department: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                            <input type="text" value={formData.position || ''} onChange={(e) => setFormData({ ...formData, position: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Employee Type</label>
                            <select value={formData.employee_type || ''} onChange={(e) => setFormData({ ...formData, employee_type: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                              <option value="">Select</option>
                              <option value="Permanent">Permanent</option>
                              <option value="Contract">Contract</option>
                              <option value="Intern">Intern</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Grade</label>
                            <input type="text" value={formData.grade || ''} onChange={(e) => setFormData({ ...formData, grade: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Workplace</label>
                            <input type="text" value={formData.workplace || ''} onChange={(e) => setFormData({ ...formData, workplace: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Level</label>
                            <input type="text" value={formData.level || ''} onChange={(e) => setFormData({ ...formData, level: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Reporting To</label>
                            <input type="text" value={formData.reporting_to || ''} onChange={(e) => setFormData({ ...formData, reporting_to: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Hire Date</label>
                            <input type="date" value={formData.hire_date || ''} onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Joining Date</label>
                            <input type="date" value={formData.joining_date || ''} onChange={(e) => setFormData({ ...formData, joining_date: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">PF No</label>
                            <input type="text" value={formData.pf_no || ''} onChange={(e) => setFormData({ ...formData, pf_no: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Salary</label>
                            <input type="number" min="0" step="0.01" value={formData.salary || ''} onChange={(e) => setFormData({ ...formData, salary: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Statutory */}


                    {/* Academic & Experience */}
                    {editSubTab === 'academic' && (
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 mb-3">Academic & Experience</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Qualification</label>
                            <input type="text" value={formData.qualification || ''} onChange={(e) => setFormData({ ...formData, qualification: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Institute</label>
                            <input type="text" value={formData.institute || ''} onChange={(e) => setFormData({ ...formData, institute: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Passing Year</label>
                            <input type="text" value={formData.passing_year || ''} onChange={(e) => setFormData({ ...formData, passing_year: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div className="md:col-span-3">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Work Experience</label>
                            <textarea rows={2} value={formData.work_experience || ''} onChange={(e) => setFormData({ ...formData, work_experience: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Government IDs */}
                    {editSubTab === 'govt' && (
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 mb-3">Government IDs</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">PAN</label>
                            <input type="text" value={formData.pan || ''} onChange={(e) => setFormData({ ...formData, pan: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">AADHAR</label>
                            <input type="text" value={formData.aadhar || ''} onChange={(e) => setFormData({ ...formData, aadhar: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Gratuity No</label>
                            <input type="text" value={formData.gratuity_no || ''} onChange={(e) => setFormData({ ...formData, gratuity_no: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">UAN</label>
                            <input type="text" value={formData.uan || ''} onChange={(e) => setFormData({ ...formData, uan: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">ESI No</label>
                            <input type="text" value={formData.esi_no || ''} onChange={(e) => setFormData({ ...formData, esi_no: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Bank Details */}
                    {editSubTab === 'bank' && (
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 mb-3">Bank Details</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Bank Name</label>
                            <input type="text" value={formData.bank_name || ''} onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Branch</label>
                            <input type="text" value={formData.bank_branch || ''} onChange={(e) => setFormData({ ...formData, bank_branch: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Account Holder Name</label>
                            <input type="text" value={formData.account_holder_name || ''} onChange={(e) => setFormData({ ...formData, account_holder_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Account Number</label>
                            <input type="text" value={formData.bank_account_no || ''} onChange={(e) => setFormData({ ...formData, bank_account_no: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">IFSC</label>
                            <input type="text" value={formData.bank_ifsc || ''} onChange={(e) => setFormData({ ...formData, bank_ifsc: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Attendance & Exit */}
                    {editSubTab === 'attendance' && (
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 mb-3">Attendance & Exit</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Biometric Code</label>
                            <input type="text" value={formData.biometric_code || ''} onChange={(e) => setFormData({ ...formData, biometric_code: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Attendance ID</label>
                            <input type="text" value={formData.attendance_id || ''} onChange={(e) => setFormData({ ...formData, attendance_id: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Exit Date</label>
                            <input type="date" value={formData.exit_date || ''} onChange={(e) => setFormData({ ...formData, exit_date: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                          <div className="md:col-span-3">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Exit Reason</label>
                            <textarea rows={2} value={formData.exit_reason || ''} onChange={(e) => setFormData({ ...formData, exit_reason: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Salary Structure */}
                    {editSubTab === 'salary' && (
                      <div className="space-y-6">
                        {/* Header */}
                        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 border border-purple-200">
                          <div className="flex items-center gap-3 mb-2">
                            <CurrencyDollarIcon className="h-8 w-8 text-purple-600" />
                            <div>
                              <h4 className="text-2xl font-bold text-gray-900">Salary Structure</h4>
                              <p className="text-sm text-purple-700 mt-1">Annual Leave: 21 days (April - March financial year)</p>
                              <p className="text-xs text-gray-600 mt-1">Sunday: Off | Saturday: 1st, 3rd Working | OT: Overtime</p>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                          {/* Left Column - Form Fields */}
                          <div className="lg:col-span-2 space-y-6">
                            {/* Employee Details */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <UserGroupIcon className="h-5 w-5 text-purple-600" />
                                Employee Details
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Full Name</label>
                                  <input 
                                    type="text" 
                                    value={`${formData.first_name || ''} ${formData.last_name || ''}`.trim()} 
                                    disabled
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Designation</label>
                                  <input 
                                    type="text" 
                                    value={formData.position || ''} 
                                    disabled
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Leaves */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <CalendarDaysIcon className="h-5 w-5 text-blue-600" />
                                Leaves
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Annual Leaves</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.annual_leaves || 21}
                                    onChange={(e) => setSalaryField('annual_leaves', e.target.value, false)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">PL Used</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.pl_used || ''}
                                    onChange={(e) => setSalaryField('pl_used', e.target.value, false)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">PL Balance</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.pl_balance || ''}
                                    disabled
                                    placeholder="Auto-calculated"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* General Details */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <CalendarDaysIcon className="h-5 w-5 text-orange-600" />
                                General Details
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Month Days</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.month_days || ''}
                                    onChange={(e) => setSalaryField('month_days', e.target.value)}
                                    placeholder="e.g., 30"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Working Days</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.working_days || ''}
                                    onChange={(e) => setSalaryField('working_days', e.target.value)}
                                    placeholder="Auto-calculated"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">3. Week Offs</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.week_offs || ''}
                                    onChange={(e) => setSalaryField('week_offs', e.target.value)}
                                    placeholder="Auto-calculated"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">4. PL Used</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.pl_used || ''}
                                    onChange={(e) => setSalaryField('pl_used', e.target.value, false)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">5. Absent</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.absent_days || ''}
                                    onChange={(e) => setSalaryField('absent_days', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">6. Paid Days</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.paid_days || ''}
                                    onChange={(e) => setSalaryField('paid_days', e.target.value)}
                                    placeholder="Auto-calculated"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">7. Holiday Working Days</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.holiday_working_days || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, holiday_working_days: e.target.value })}
                                    placeholder="From holiday master"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">8. OT Hours</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.ot_hours || ''}
                                    onChange={(e) => setSalaryField('ot_hours', e.target.value)}
                                    step="0.5"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Salary Breakup */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <CurrencyDollarIcon className="h-5 w-5 text-green-600" />
                                Salary Breakup
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Gross Salary
                                    <span className="ml-2 text-xs text-gray-500">(editable)</span>
                                  </label>
                                  <input 
                                    type="number" 
                                    value={salaryData.gross_salary || ''}
                                    onChange={(e) => setSalaryField('gross_salary', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-semibold"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Basic + DA</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.basic_da || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, basic_da: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">3. HRA</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.hra || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, hra: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">4. Conveyance Allowance</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.conveyance_allowance || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, conveyance_allowance: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">5. Call Allowance</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.call_allowance || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, call_allowance: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">6. Other Allowance</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.other_allowance || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, other_allowance: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Other Income */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <ArrowTrendingUpIcon className="h-5 w-5 text-teal-600" />
                                Other Income
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Holiday Working (Hours)</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.holiday_working_hours || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, holiday_working_hours: e.target.value })}
                                    step="0.5"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Weekly Off Working</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.weekly_off_working || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, weekly_off_working: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">3. OT Charges</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.ot_charges || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, ot_charges: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Employee Contribution (Deductions) */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <ArrowTrendingDownIcon className="h-5 w-5 text-red-600" />
                                Employee Contribution (Deductions)
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Employee Provident Fund</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.employee_pf || ''}
                                    onChange={(e) => setSalaryField('employee_pf', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Employee Professional Tax</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.employee_pt || ''}
                                    onChange={(e) => setSalaryField('employee_pt', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">3. Retention Amount</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.retention_amount || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, retention_amount: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">4. MLWF</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.mlwf_employee || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, mlwf_employee: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div className="md:col-span-2">
                                  <label className="block text-sm font-medium text-gray-700 mb-2">5. Other Deductions</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.other_deductions || ''}
                                    onChange={(e) => setSalaryData({ ...salaryData, other_deductions: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Employer Contributions (Company) */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                              <h5 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <CurrencyDollarIcon className="h-5 w-5 text-purple-600" />
                                Employer Contributions (Company)
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">1. Employer Provident Fund</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.employer_pf || ''}
                                    onChange={(e) => setSalaryField('employer_pf', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">2. Bonus (8.33% on Basic+DA)</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.bonus || ''}
                                    onChange={(e) => setSalaryField('bonus', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">3. MLWF (₹13)</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.mlwf_company || 13}
                                    onChange={(e) => setSalaryData({ ...salaryData, mlwf_company: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">4. Medical/PA Accident Insurance (₹500)</label>
                                  <input 
                                    type="number" 
                                    value={salaryData.medical_insurance || 500}
                                    onChange={(e) => setSalaryData({ ...salaryData, medical_insurance: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Right Column - Live Preview */}
                          <div className="lg:col-span-1">
                            <div className="bg-white rounded-lg border border-gray-300 p-4 sticky top-6">
                              <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">Summary</h3>
                              
                              <div className="space-y-3">
                                {/* In-Hand Salary */}
                                <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                                  <p className="text-xs text-gray-600 mb-1">In-Hand Salary</p>
                                  <input
                                    type="number"
                                    value={salaryData.in_hand_salary || ''}
                                    onChange={(e) => setSalaryField('in_hand_salary', e.target.value)}
                                    className="w-full text-2xl font-bold text-purple-700 text-right border-0 bg-transparent"
                                  />
                                </div>

                                {/* CTC */}
                                <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                                  <p className="text-xs text-gray-600 mb-1">Employee CTC</p>
                                  <input
                                    type="number"
                                    value={salaryData.employee_ctc || ''}
                                    onChange={(e) => setSalaryField('employee_ctc', e.target.value)}
                                    className="w-full text-2xl font-bold text-orange-700 text-right border-0 bg-transparent"
                                  />
                                </div>

                                {/* Breakdown */}
                                <div className="pt-2 border-t border-gray-200">
                                  <div className="space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Gross:</span>
                                      <span className="font-medium">₹{salaryData.gross_salary || '0.00'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Deductions:</span>
                                      <span className="font-medium text-red-600">₹{(parseFloat(salaryData.employee_pf || 0) + parseFloat(salaryData.employee_pt || 0) + parseFloat(salaryData.retention_amount || 0) + parseFloat(salaryData.mlwf_employee || 0) + parseFloat(salaryData.other_deductions || 0)).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Company:</span>
                                      <span className="font-medium text-purple-600">₹{(parseFloat(salaryData.employer_pf || 0) + parseFloat(salaryData.bonus || 0) + parseFloat(salaryData.mlwf_company || 13) + parseFloat(salaryData.medical_insurance || 500)).toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Attendance */}
                                <div className="pt-2 border-t border-gray-200">
                                  <div className="space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Working Days:</span>
                                      <span className="font-medium">{salaryData.working_days || 0}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Paid Days:</span>
                                      <span className="font-medium text-green-600">{salaryData.paid_days || 0}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Navigation Buttons */}
                    <div className="flex justify-between items-center pt-6 border-t border-gray-200">
                      <button
                        type="button"
                        onClick={() => {
                          const currentIndex = editSubTabOrder.indexOf(editSubTab);
                          if (currentIndex > 0) {
                            setEditSubTab(editSubTabOrder[currentIndex - 1]);
                          }
                        }}
                        disabled={editSubTabOrder.indexOf(editSubTab) === 0}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        <ChevronLeftIcon className="h-4 w-4" />
                        Previous
                      </button>

                      <div className="flex space-x-4">
                        <button type="button" onClick={() => setActiveTab('list')} className="px-6 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
                        <button type="submit" disabled={loading} className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1">{loading ? 'Updating...' : 'Update Employee'}</button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const currentIndex = editSubTabOrder.indexOf(editSubTab);
                          if (currentIndex < editSubTabOrder.length - 1) {
                            setEditSubTab(editSubTabOrder[currentIndex + 1]);
                          }
                        }}
                        disabled={editSubTabOrder.indexOf(editSubTab) === editSubTabOrder.length - 1}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        Next
                        <ChevronRightIcon className="h-4 w-4" />
                      </button>
                    </div>

                  </form>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'view' && selectedEmployee && (
            <div className="bg-white shadow-lg rounded-2xl border border-gray-200 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
              {/* Top header */}
              <div className="px-8 py-6 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-gray-50">
                <div className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <Avatar src={selectedEmployee.profile_photo_url} firstName={selectedEmployee.first_name} lastName={selectedEmployee.last_name} size={72} />
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-2xl font-semibold text-gray-900">{selectedEmployee.first_name} {selectedEmployee.last_name}</h3>
                        <span className={`inline-flex px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                          selectedEmployee.status === 'active'
                            ? 'bg-green-300 text-black'
                            : selectedEmployee.status === 'inactive'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {selectedEmployee.status || 'active'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">Employee ID • <span className="text-[#64126D] font-medium">{selectedEmployee.employee_id}</span></p>
                      <p className="text-sm text-gray-500">{selectedEmployee.department || '—'} {selectedEmployee.position ? `• ${selectedEmployee.position}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openEditForm(selectedEmployee)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#64126D] text-white hover:bg-[#5a0f62] shadow-sm transition-colors"
                    >
                      <PencilIcon className="h-4 w-4" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('list')}
                      className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Back to List
                    </button>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-8 space-y-8">
                {/* Basic Info */}
                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h4 className="text-lg font-semibold text-gray-900">Basic Information</h4>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Employee ID</p>
                      <p className="mt-1 font-medium text-[#64126D]">{selectedEmployee.employee_id}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Full Name</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.first_name} {selectedEmployee.last_name}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Email</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.email || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Phone</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.phone || '—'}</p>
                    </div>
                  </div>
                </section>

                {/* Work Info */}
                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h4 className="text-lg font-semibold text-gray-900">Work Information</h4>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Department</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.department || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Position</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.position || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Hire Date</p>
                      <p className="mt-1 font-medium text-black">{formatDate(selectedEmployee.hire_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Salary</p>
                      <p className="mt-1 font-medium text-black">{formatCurrency(selectedEmployee.salary)}</p>
                    </div>
                  </div>
                </section>

                {/* Contact Details & Misc (always shown) */}
                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h4 className="text-lg font-semibold text-gray-900">Contact & Location</h4>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Address</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.address || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">City</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.city || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">State</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.state || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Country</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.country || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">PIN / ZIP</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.pin || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Phone</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.phone || selectedEmployee.mobile || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Personal Email</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.personal_email || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Emergency Contact</p>
                      <p className="mt-1 font-medium text-black">{(selectedEmployee.emergency_contact_name ? `${selectedEmployee.emergency_contact_name}${selectedEmployee.emergency_contact_phone ? ' • ' + selectedEmployee.emergency_contact_phone : ''}` : '—')}</p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Notes</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.notes || '—'}</p>
                    </div>
                  </div>
                </section>

                {/* Personal & Government IDs */}
                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h4 className="text-lg font-semibold text-gray-900">Personal & Government IDs</h4>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">DOB</p>
                      <p className="mt-1 font-medium text-black">{formatDate(selectedEmployee.dob)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Marital Status</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.marital_status || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">PAN</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.pan || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Aadhar / National ID</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.aadhar || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">UAN</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.uan || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">ESI No</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.esi_no || '—'}</p>
                    </div>
                  </div>
                </section>

                {/* Bank & Salary Details */}
                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h4 className="text-lg font-semibold text-gray-900">Bank & Salary</h4>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Bank Name</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.bank_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Account Holder</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.account_holder_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Account No</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.bank_account_no || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">IFSC / Branch</p>
                      <p className="mt-1 font-medium text-black">{(selectedEmployee.bank_ifsc || selectedEmployee.bank_branch) || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Gross Salary</p>
                      <p className="mt-1 font-medium text-black">{formatCurrency(selectedEmployee.gross_salary || selectedEmployee.salary)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Net Salary</p>
                      <p className="mt-1 font-medium text-black">{formatCurrency(selectedEmployee.net_salary)}</p>
                    </div>
                  </div>
                </section>

                {/* Statutory & Flags */}
                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h4 className="text-lg font-semibold text-gray-900">Statutory & Flags</h4>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Bonus Eligible</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.bonus_eligible ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">PF Applicable</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.stat_pf ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">MLWF</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.stat_mlwf ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Professional Tax</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.stat_pt ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">ESIC</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.stat_esic ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">TDS</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.stat_tds ? 'Yes' : 'No'}</p>
                    </div>
                  </div>
                </section>

                {/* Education & Experience */}
                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h4 className="text-lg font-semibold text-gray-900">Education & Experience</h4>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Qualification</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.qualification || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Institute</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.institute || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Passing Year</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.passing_year || '—'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Work Experience</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.work_experience || '—'}</p>
                    </div>
                  </div>
                </section>

                {/* Attendance / Exit */}
                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h4 className="text-lg font-semibold text-gray-900">Attendance & Exit</h4>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Attendance ID</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.attendance_id || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Biometric Code</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.biometric_code || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Exit Date</p>
                      <p className="mt-1 font-medium text-black">{formatDate(selectedEmployee.exit_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Exit Reason</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.exit_reason || '—'}</p>
                    </div>
                  </div>
                </section>

                {/* System & Role Info */}
                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h4 className="text-lg font-semibold text-gray-900">System & Role</h4>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Username</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.username || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Role</p>
                      <p className="mt-1 font-medium text-black">{selectedEmployee.role || selectedEmployee.system_role_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Created At</p>
                      <p className="mt-1 font-medium text-black">{formatDate(selectedEmployee.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Updated At</p>
                      <p className="mt-1 font-medium text-black">{formatDate(selectedEmployee.updated_at)}</p>
                    </div>
                  </div>
                </section>

              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
