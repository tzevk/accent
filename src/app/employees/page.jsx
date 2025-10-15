'use client';

import Navbar from '@/components/Navbar';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

// ComponentEditor for salary component configuration
const ComponentEditor = React.memo(({ componentConfig, setComponentConfig }) => {
  const components = useMemo(() => [
    { key: 'basic', label: 'Basic Salary', section: 'earnings' },
    { key: 'da', label: 'DA (Dearness Allowance)', section: 'earnings' },
    { key: 'hra', label: 'HRA (House Rent Allowance)', section: 'earnings' },
    { key: 'conveyance', label: 'Conveyance Allowance', section: 'earnings' },
    { key: 'call_allowance', label: 'Call Allowance', section: 'earnings' },
    { key: 'other_allowance', label: 'Other Allowance', section: 'earnings' },
    { key: 'pf', label: 'PF (Provident Fund)', section: 'deductions' },
    { key: 'pt', label: 'PT (Professional Tax)', section: 'deductions' },
    { key: 'mlwf', label: 'MLWF (Maharashtra Labour Welfare Fund)', section: 'deductions' },
  ], []);

  const earnings = useMemo(() => components.filter(c => c.section === 'earnings'), [components]);
  const deductions = useMemo(() => components.filter(c => c.section === 'deductions'), [components]);

  // Immediate update function - always update parent state for live preview
  const updateComponent = useCallback((key, field, value) => {
    setComponentConfig(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value
      }
    }));
  }, [setComponentConfig]);

  const ComponentRow = React.memo(({ component }) => {
    const config = componentConfig[component.key] || { type: 'fixed', value: '' };
    
    // Handle input changes - update parent immediately for live preview
    const handleInputChange = (e) => {
      const newValue = e.target.value;
      updateComponent(component.key, 'value', newValue);
    };
    
    // Handle Enter key
    const handleKeyPress = (e) => {
      if (e.key === 'Enter') {
        e.target.blur(); // Remove focus
      }
    };
    
    // Handle type changes immediately
    const handleTypeChange = (e) => {
      updateComponent(component.key, 'type', e.target.value);
    };
    
    return (
      <div className="grid grid-cols-12 gap-3 items-center py-2 border-b border-gray-100 last:border-b-0">
        <div className="col-span-4">
          <label className="text-sm font-medium text-gray-700">{component.label}</label>
        </div>
        <div className="col-span-3">
          <select 
            value={config.type} 
            onChange={handleTypeChange}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
          >
            <option value="fixed">Fixed Value</option>
            <option value="formula">Formula</option>
          </select>
        </div>
        <div className="col-span-5">
          {config.type === 'fixed' ? (
            <input 
              type="number" 
              min="0" 
              step="0.01"
              placeholder="Enter amount"
              value={config.value} 
              onChange={handleInputChange}
              onKeyDown={handleKeyPress}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          ) : (
            <input 
              type="text" 
              placeholder="e.g., basic * 0.10"
              value={config.value} 
              onChange={handleInputChange}
              onKeyDown={handleKeyPress}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          )}
        </div>
      </div>
    );
  });

  return (
    <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
      <h5 className="text-sm font-semibold text-gray-800 mb-4">Component Configuration</h5>
      
      {/* Earnings Section */}
      <div className="mb-6">
        <div className="flex items-center mb-3">
          <ArrowTrendingUpIcon className="h-4 w-4 text-green-600 mr-2" />
          <h6 className="text-sm font-medium text-green-700">Earnings Components</h6>
        </div>
        <div className="bg-white rounded-lg p-3">
          <div className="grid grid-cols-12 gap-3 items-center py-2 text-xs font-semibold text-gray-600 border-b border-gray-200">
            <div className="col-span-4">Component</div>
            <div className="col-span-3">Value Type</div>
            <div className="col-span-5">Amount/Formula</div>
          </div>
          {earnings.map(component => (
            <ComponentRow key={component.key} component={component} />
          ))}
        </div>
      </div>

      {/* Deductions Section */}
      <div>
        <div className="flex items-center mb-3">
          <ArrowTrendingDownIcon className="h-4 w-4 text-red-600 mr-2" />
          <h6 className="text-sm font-medium text-red-700">Deduction Components</h6>
        </div>
        <div className="bg-white rounded-lg p-3">
          <div className="grid grid-cols-12 gap-3 items-center py-2 text-xs font-semibold text-gray-600 border-b border-gray-200">
            <div className="col-span-4">Component</div>
            <div className="col-span-3">Value Type</div>
            <div className="col-span-5">Amount/Formula</div>
          </div>
          {deductions.map(component => (
            <ComponentRow key={component.key} component={component} />
          ))}
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        <strong>Formula examples:</strong> basic * 0.10, basic + da, 1500 (for fixed amount in formula)
      </div>
    </div>
  );
});

const Avatar = ({ src, firstName, lastName, size = 40 }) => {
  const initials = `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();
  
  if (src) {
    return (
      <Image 
        src={src} 
        alt={`${firstName} ${lastName}`}
        width={size}
        height={size}
        className="rounded-full object-cover"
      />
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
    notes: ''
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
  // Add Employee sub-tabs (like Projects edit tabs)
  const addSubTabOrder = ['personal','contact','work','academic','govt','bank','attendance','salary'];
  const [addSubTab, setAddSubTab] = useState('personal');
  
  // Edit Employee sub-tabs (same structure as add)
  const editSubTabOrder = ['personal','contact','work','academic','govt','bank','attendance','salary'];
  const [editSubTab, setEditSubTab] = useState('personal');
  // Salary Master local state
  const [salaryInputs, setSalaryInputs] = useState({
    basic_salary: '',
    attendance_days: '',
    total_working_days: 26,
    loan_active: 'No',
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
    other_allowance: ''
  });
  const [salaryServerData, setSalaryServerData] = useState(null); // Server loaded salary data
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [salaryError, setSalaryError] = useState('');
  const [salarySuccess, setSalarySuccess] = useState('');
  // Component-level config for nested structure (fixed or formula per component)
  const [componentConfig, setComponentConfig] = useState({
    basic: { type: 'fixed', value: '' },
    da: { type: 'fixed', value: '' },
    call_allowance: { type: 'fixed', value: '' },
    conveyance: { type: 'fixed', value: '' },
    hra: { type: 'fixed', value: '' },
    other_allowance: { type: 'fixed', value: '' },
    pf: { type: 'fixed', value: '' },
    pt: { type: 'fixed', value: '' },
    mlwf: { type: 'fixed', value: '' }
  });

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
      // eslint-disable-next-line no-new-func
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

  // Memoize computed salary - compute on every relevant change for live preview
  const salaryComputed = useMemo(() => {
    return computeLocal();
  }, [
    salaryInputs.salary_type,
    salaryInputs.basic_salary,
    salaryInputs.attendance_days,
    salaryInputs.total_working_days,
    salaryInputs.additional_earnings,
    salaryInputs.additional_deductions,
    salaryInputs.loan_active,
    salaryInputs.loan_emi,
    salaryInputs.advance_payment,
    componentConfig,  // React will do deep comparison
    attendanceExtras.week_offs,
    attendanceExtras.pl_use,
    attendanceExtras.pl_balance,
    // Statutory flags that affect calculations
    formData.stat_pf,
    formData.stat_pt,
    formData.stat_mlwf,
    formData.stat_esic,
    formData.stat_tds,
    formData.bonus_eligible
  ]);

  // Fetch employees
  const fetchEmployees = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const s = (searchTerm || '').trim();
      const params = new URLSearchParams({
        page: currentPage,
        limit: 10,
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
        setEmployees(data.employees);
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

  // Load latest salary snapshot when editing an employee
  useEffect(() => {
    const loadSalary = async () => {
      if (!selectedEmployee?.id) {
        setSalaryServerData(null);
        return;
      }
      try {
        setSalaryLoading(true);
        const res = await fetch(`/api/employees/${selectedEmployee.id}/salary`);
        const json = await res.json();
        if (res.ok && json.success && json.data) {
          setSalaryServerData(json.data.computed);
        } else {
          setSalaryServerData(null);
        }
      } catch {
        setSalaryServerData(null);
      } finally {
        setSalaryLoading(false);
      }
    };
    loadSalary();
  }, [selectedEmployee?.id]);

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
        const fresh = await fetch(`/api/employees/${selectedEmployee.id}/salary`).then(r => r.json()).catch(() => null);
        if (fresh?.success && fresh?.data) setSalaryServerData(fresh.data.computed);
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
      try { respJson = await response.json(); } catch {}

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
        setSuccessMessage(selectedEmployee ? 'Employee updated successfully!' : 'Employee added successfully!');
        // Reset filters so the new record is visible
        setSearchTerm('');
        setSelectedDepartment('');
        setSelectedStatus('');
        setCurrentPage(1);
        setActiveTab('list');
        setFormData(defaultFormData);
        setSelectedEmployee(null);
  setSalaryInputs({ basic_salary: '', attendance_days: '', total_working_days: 26, loan_active: 'No', loan_emi: '', advance_payment: '', salary_type: 'Monthly', effective_from: '', additional_earnings: '', additional_deductions: '', pf: '', pt: '', mlwf: '' });
        fetchEmployees();
      } else {
        const error = respJson || {};
        setFormErrors(error.errors || { general: error.error || error.message || 'An error occurred' });
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 animate-fade-in">
      <Navbar />
      
  <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
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
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                          <tr>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Employee
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Department
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Position
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Hire Date
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Status
                            </th>
                            <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {employees.map((employee) => (
                            <tr key={employee.id} className="hover:bg-gray-50 transition-colors duration-200 motion-safe:hover:scale-[1.01]">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <Avatar src={employee.profile_photo_url} firstName={employee.first_name} lastName={employee.last_name} size={48} />
                                  <div className="ml-4">
                                    <div className="text-sm font-medium text-gray-900">
                                      {employee.first_name} {employee.last_name}
                                    </div>
                                    <div className="text-sm text-[#64126D] font-medium">
                                      {employee.employee_id}
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
                                    ? 'bg-green-100 text-green-800'
                                    : employee.status === 'inactive'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-red-100 text-red-800'
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
                      <div key={emp.id} className="px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
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
                          <input type="text" value={formData.employee_id || ''} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" required />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                          <input type="text" value={formData.username || ''} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                          <input type="text" value={formData.role || ''} onChange={(e) => setFormData({ ...formData, role: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
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

                    {/* Salary Master */}
                    {addSubTab === 'salary' && (
                      <div className="space-y-8">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <CurrencyDollarIcon className="h-8 w-8 text-purple-600 mr-3" />
                            <div>
                              <h4 className="text-2xl font-bold text-gray-900">Salary Structure</h4>
                              <p className="text-sm text-gray-600 mt-1">Configure salary components and view live calculations</p>
                            </div>
                          </div>
                          {!selectedEmployee && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 max-w-md">
                              <div className="flex items-start">
                                <svg className="h-4 w-4 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                                <p className="text-sm text-blue-700"><strong>Tip:</strong> Save the employee first to enable salary calculations</p>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                          {/* Left Panel - Configuration */}
                          <div className="xl:col-span-2 space-y-6">
                            {/* Basic Configuration */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                              <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-blue-50">
                                <div className="flex items-center">
                                  <CogIcon className="h-5 w-5 text-purple-600 mr-2" />
                                  <h5 className="text-lg font-semibold text-gray-800">Basic Configuration</h5>
                                </div>
                              </div>
                              <div className="p-6">
                                <div className="space-y-6">
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Salary Type</label>
                                      <select value={salaryInputs.salary_type} onChange={(e) => setSalaryInputs({ ...salaryInputs, salary_type: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white">
                                        <option>Monthly</option>
                                        <option>Hourly</option>
                                        <option>TDS</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Applicable</label>
                                      <select value={salaryInputs.applicable || salaryInputs.salary_type} onChange={(e) => setSalaryInputs({ ...salaryInputs, applicable: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white">
                                        <option>Monthly</option>
                                        <option>Hourly</option>
                                        <option>TDS</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Effective From <span className="text-red-500">*</span></label>
                                      <input type="date" value={salaryInputs.effective_from} onChange={(e) => setSalaryInputs({ ...salaryInputs, effective_from: e.target.value })} required className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                    </div>
                                  </div>
                                  
                                  {/* Statutory Options */}
                                  <div>
                                    <h6 className="text-sm font-semibold text-gray-700 mb-3">Statutory Deductions</h6>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                      {[
                                        { key: 'bonus_eligible', label: 'Bonus Applicable' },
                                        { key: 'stat_pf', label: 'PF Applicable' },
                                        { key: 'stat_mlwf', label: 'MLWF Applicable' },
                                        { key: 'stat_pt', label: 'PT Applicable' },
                                        { key: 'stat_esic', label: 'ESIC Applicable' },
                                        { key: 'stat_tds', label: 'TDS Applicable' },
                                      ].map((opt) => (
                                        <label key={opt.key} className="inline-flex items-center gap-2 text-sm text-gray-700">
                                          <input type="checkbox" checked={!!formData[opt.key]} onChange={(e) => setFormData({ ...formData, [opt.key]: e.target.checked })} className="h-4 w-4 text-purple-600 border-gray-300 rounded" />
                                          {opt.label}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Component Editor */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                              <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
                                <div className="flex items-center">
                                  <CalculatorIcon className="h-5 w-5 text-green-600 mr-2" />
                                  <div>
                                    <h5 className="text-lg font-semibold text-gray-800">Salary Components</h5>
                                    <p className="text-sm text-gray-600 mt-1">Configure earnings and deductions with fixed amounts or formulas</p>
                                  </div>
                                </div>
                              </div>
                              <div className="p-6">
                                <ComponentEditor
                                  componentConfig={componentConfig}
                                  setComponentConfig={setComponentConfig}
                                />
                              </div>
                            </div>

                            {/* Attendance & Additional */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                              <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-orange-50 to-yellow-50">
                                <div className="flex items-center">
                                  <CalendarDaysIcon className="h-5 w-5 text-orange-600 mr-2" />
                                  <h5 className="text-lg font-semibold text-gray-800">Attendance & Additional</h5>
                                </div>
                              </div>
                              <div className="p-6 space-y-6">
                                {/* Attendance Section */}
                                <div>
                                  <h6 className="text-sm font-semibold text-gray-700 mb-3">Attendance Details</h6>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Attendance Days</label>
                                      <input type="number" min="0" step="1" value={salaryInputs.attendance_days} onChange={(e) => setSalaryInputs({ ...salaryInputs, attendance_days: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Total Working Days</label>
                                      <input type="number" min="0" step="1" value={salaryInputs.total_working_days} onChange={(e) => setSalaryInputs({ ...salaryInputs, total_working_days: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Week Offs</label>
                                      <input type="number" min="0" step="1" value={attendanceExtras.week_offs} onChange={(e) => setAttendanceExtras({ ...attendanceExtras, week_offs: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">PL Used</label>
                                      <input type="number" min="0" step="1" value={attendanceExtras.pl_use} onChange={(e) => setAttendanceExtras({ ...attendanceExtras, pl_use: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                    </div>
                                  </div>
                                </div>

                                {/* Additional Payments */}
                                <div>
                                  <h6 className="text-sm font-semibold text-gray-700 mb-3">Additional Payments</h6>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Additional Earnings</label>
                                      <input type="number" min="0" step="0.01" value={salaryInputs.additional_earnings} onChange={(e) => setSalaryInputs({ ...salaryInputs, additional_earnings: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Additional Deductions</label>
                                      <input type="number" min="0" step="0.01" value={salaryInputs.additional_deductions} onChange={(e) => setSalaryInputs({ ...salaryInputs, additional_deductions: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Advance Payment</label>
                                      <input type="number" min="0" step="0.01" value={salaryInputs.advance_payment} onChange={(e) => setSalaryInputs({ ...salaryInputs, advance_payment: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                    </div>
                                  </div>
                                </div>

                                {/* Loan Details */}
                                <div>
                                  <h6 className="text-sm font-semibold text-gray-700 mb-3">Loan Details</h6>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Loan Active</label>
                                      <select value={salaryInputs.loan_active} onChange={(e) => setSalaryInputs({ ...salaryInputs, loan_active: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white">
                                        <option>No</option>
                                        <option>Yes</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Loan EMI</label>
                                      <input type="number" min="0" step="0.01" value={salaryInputs.loan_emi} onChange={(e) => setSalaryInputs({ ...salaryInputs, loan_emi: e.target.value })} disabled={String(salaryInputs.loan_active).toLowerCase() !== 'yes'} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100" />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center justify-between">
                              {(salaryError || salarySuccess) && (
                                <div className="flex items-center">
                                  {salaryError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{salaryError}</div>}
                                  {salarySuccess && <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{salarySuccess}</div>}
                                </div>
                              )}
                              <div className="flex space-x-3 ml-auto">
                                <button type="button" onClick={() => {
                                  setSalaryInputs({
                                    basic_salary: '',
                                    attendance_days: '',
                                    total_working_days: 26,
                                    loan_active: 'No',
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
                                    other_allowance: ''
                                  });
                                  setComponentConfig({
                                    basic: { type: 'fixed', value: '' },
                                    da: { type: 'fixed', value: '' },
                                    call_allowance: { type: 'fixed', value: '' },
                                    conveyance: { type: 'fixed', value: '' },
                                    hra: { type: 'fixed', value: '' },
                                    other_allowance: { type: 'fixed', value: '' },
                                    pf: { type: 'fixed', value: '' },
                                    pt: { type: 'fixed', value: '' },
                                    mlwf: { type: 'fixed', value: '' }
                                  });
                                  setAttendanceExtras({ week_offs: '', pl_use: '', pl_balance: '' });
                                }} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                                  Reset
                                </button>
                                <button type="button" onClick={submitSalaryMaster} disabled={salaryLoading || !selectedEmployee} className="px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl">
                                  {salaryLoading ? (
                                    <span className="flex items-center">
                                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                      </svg>
                                      Saving…
                                    </span>
                                  ) : 'Save Salary Entry'}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Right Panel - Live Preview */}
                          <div className="xl:col-span-1">
                            <div className="sticky top-6 space-y-4">
                              <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                                <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-green-50 to-green-100">
                                  <div className="flex items-center">
                                    <EyeOutlineIcon className="h-5 w-5 text-green-700 mr-2" />
                                    <div>
                                      <h5 className="text-lg font-semibold text-green-800">Live Preview</h5>
                                      <p className="text-sm text-green-600 mt-1">Real-time salary calculation</p>
                                    </div>
                                  </div>
                                </div>
                                <div className="p-6">
                                  {salaryComputed ? (
                                    <div className="space-y-4">
                                      {/* Key Metrics */}
                                      <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-blue-50 p-3 rounded-lg text-center">
                                          <div className="text-xs text-blue-600 font-medium">GROSS</div>
                                          <div className="text-lg font-bold text-blue-900">₹{(salaryComputed.earnings?.gross || 0).toFixed(0)}</div>
                                        </div>
                                        <div className="bg-green-50 p-3 rounded-lg text-center">
                                          <div className="text-xs text-green-600 font-medium">NET</div>
                                          <div className="text-lg font-bold text-green-900">₹{(salaryComputed.summary?.final_payable || 0).toFixed(0)}</div>
                                        </div>
                                      </div>

                                      {/* Earnings Breakdown */}
                                      <div>
                                        <div className="flex items-center mb-2">
                                          <ArrowTrendingUpIcon className="h-4 w-4 text-green-600 mr-1" />
                                          <h6 className="text-sm font-semibold text-green-700">Earnings</h6>
                                        </div>
                                        <div className="space-y-1 text-sm">
                                          <div className="flex justify-between">
                                            <span>Basic:</span>
                                            <span className="font-medium">₹{(salaryComputed.inputs.basic_salary || 0).toFixed(0)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span>DA:</span>
                                            <span className="font-medium">₹{(salaryComputed.earnings.da || 0).toFixed(0)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span>HRA:</span>
                                            <span className="font-medium">₹{(salaryComputed.earnings.hra || 0).toFixed(0)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span>Conveyance:</span>
                                            <span className="font-medium">₹{(salaryComputed.earnings.conveyance || 0).toFixed(0)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span>Call Allow:</span>
                                            <span className="font-medium">₹{(salaryComputed.earnings.call_allowance || 0).toFixed(0)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span>Other Allow:</span>
                                            <span className="font-medium">₹{(salaryComputed.earnings.other_allowance || 0).toFixed(0)}</span>
                                          </div>
                                          {salaryComputed.earnings.additional_earnings > 0 && (
                                            <div className="flex justify-between">
                                              <span>Additional:</span>
                                              <span className="font-medium">₹{(salaryComputed.earnings.additional_earnings || 0).toFixed(0)}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Deductions Breakdown */}
                                      <div>
                                        <div className="flex items-center mb-2">
                                          <ArrowTrendingDownIcon className="h-4 w-4 text-red-600 mr-1" />
                                          <h6 className="text-sm font-semibold text-red-700">Deductions</h6>
                                        </div>
                                        <div className="space-y-1 text-sm">
                                          {formData.stat_pf && (
                                            <div className="flex justify-between">
                                              <span>PF:</span>
                                              <span className="font-medium">₹{(salaryComputed.deductions.pf || 0).toFixed(0)}</span>
                                            </div>
                                          )}
                                          {formData.stat_pt && (
                                            <div className="flex justify-between">
                                              <span>PT:</span>
                                              <span className="font-medium">₹{(salaryComputed.deductions.pt || 0).toFixed(0)}</span>
                                            </div>
                                          )}
                                          {formData.stat_mlwf && (
                                            <div className="flex justify-between">
                                              <span>MLWF:</span>
                                              <span className="font-medium">₹{(salaryComputed.deductions.mlwf || 0).toFixed(0)}</span>
                                            </div>
                                          )}
                                          {formData.stat_esic && salaryComputed.deductions.esic > 0 && (
                                            <div className="flex justify-between">
                                              <span>ESIC:</span>
                                              <span className="font-medium">₹{(salaryComputed.deductions.esic || 0).toFixed(0)}</span>
                                            </div>
                                          )}
                                          {salaryComputed.deductions.additional_deductions > 0 && (
                                            <div className="flex justify-between">
                                              <span>Additional:</span>
                                              <span className="font-medium">₹{(salaryComputed.deductions.additional_deductions || 0).toFixed(0)}</span>
                                            </div>
                                          )}
                                          {formData.stat_tds && salaryComputed.summary.tds_monthly > 0 && (
                                            <div className="flex justify-between">
                                              <span>TDS:</span>
                                              <span className="font-medium">₹{(salaryComputed.summary.tds_monthly || 0).toFixed(0)}</span>
                                            </div>
                                          )}
                                          {!formData.stat_pf && !formData.stat_pt && !formData.stat_mlwf && !formData.stat_esic && !formData.stat_tds && salaryComputed.deductions.additional_deductions === 0 && (
                                            <div className="text-xs text-gray-500 italic">No statutory deductions selected</div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Attendance Info */}
                                      <div>
                                        <div className="flex items-center mb-2">
                                          <CalendarDaysIcon className="h-4 w-4 text-orange-600 mr-1" />
                                          <h6 className="text-sm font-semibold text-orange-700">Attendance</h6>
                                        </div>
                                        <div className="space-y-1 text-sm">
                                          <div className="flex justify-between">
                                            <span>Absent Days:</span>
                                            <span className="font-medium">{salaryComputed.attendance.absent_days}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span>Payable %:</span>
                                            <span className="font-medium">{(salaryComputed.attendance.payable_days_pct * 100).toFixed(1)}%</span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-center py-8">
                                      <div className="text-gray-400 mb-2">
                                        <ChartBarIcon className="w-12 h-12 mx-auto" />
                                      </div>
                                      <p className="text-sm text-gray-500">Enter salary details to see live calculation</p>
                                    </div>
                                  )}
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
                <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-6 lg:p-8 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-2xl font-semibold text-gray-900">Edit Employee - {selectedEmployee.first_name} {selectedEmployee.last_name}</h3>
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
                            <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                            <input type="text" value={formData.role || ''} onChange={(e) => setFormData({ ...formData, role: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
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
                      <div className="space-y-8">
                        {/* Original Salary Structure */}
                        <div>
                          <h4 className="text-lg font-semibold text-gray-900 mb-3">Basic Salary Structure</h4>
                          <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Basic Salary</label>
                                <input type="number" min="0" step="0.01" value={formData.basic_salary || ''} onChange={(e) => setFormData({ ...formData, basic_salary: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">HRA</label>
                                <input type="number" min="0" step="0.01" value={formData.hra || ''} onChange={(e) => setFormData({ ...formData, hra: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Conveyance</label>
                                <input type="number" min="0" step="0.01" value={formData.conveyance || ''} onChange={(e) => setFormData({ ...formData, conveyance: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Medical Allowance</label>
                                <input type="number" min="0" step="0.01" value={formData.medical_allowance || ''} onChange={(e) => setFormData({ ...formData, medical_allowance: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Special Allowance</label>
                                <input type="number" min="0" step="0.01" value={formData.special_allowance || ''} onChange={(e) => setFormData({ ...formData, special_allowance: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Incentives</label>
                                <input type="number" min="0" step="0.01" value={formData.incentives || ''} onChange={(e) => setFormData({ ...formData, incentives: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Deductions</label>
                                <input type="number" min="0" step="0.01" value={formData.deductions || ''} onChange={(e) => setFormData({ ...formData, deductions: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" />
                              </div>
                            </div>
                            
                            {/* Statutory Options */}
                            <div>
                              <h6 className="text-sm font-semibold text-gray-700 mb-3">Statutory Deductions</h6>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                {[
                                  { key: 'bonus_eligible', label: 'Bonus Applicable' },
                                  { key: 'stat_pf', label: 'PF Applicable' },
                                  { key: 'stat_mlwf', label: 'MLWF Applicable' },
                                  { key: 'stat_pt', label: 'PT Applicable' },
                                  { key: 'stat_esic', label: 'ESIC Applicable' },
                                  { key: 'stat_tds', label: 'TDS Applicable' },
                                ].map((opt) => (
                                  <label key={opt.key} className="inline-flex items-center gap-2 text-sm text-gray-700">
                                    <input type="checkbox" checked={!!formData[opt.key]} onChange={(e) => setFormData({ ...formData, [opt.key]: e.target.checked })} className="h-4 w-4 text-purple-600 border-gray-300 rounded" />
                                    {opt.label}
                                  </label>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Advanced Salary Master */}
                        <div className="border-t border-gray-200 pt-8">
                          <h4 className="text-lg font-semibold text-gray-900 mb-3">Advanced Salary Master</h4>
                          <div className="grid grid-cols-12 gap-6">
                            {/* Component Editor Section */}
                            <div className="col-span-12 lg:col-span-8">
                              <ComponentEditor 
                                componentConfig={componentConfig} 
                                setComponentConfig={setComponentConfig} 
                              />
                            </div>

                            {/* Live Preview Panel */}
                            <div className="col-span-12 lg:col-span-4">
                              <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-200 sticky top-6">
                                <div className="flex items-center gap-3 mb-4">
                                  <EyeOutlineIcon className="h-6 w-6 text-blue-600" />
                                  <h3 className="text-lg font-semibold text-gray-900">Live Preview</h3>
                                </div>
                                
                                <div className="space-y-4">
                                  {/* Earnings */}
                                  <div className="bg-white rounded-lg p-4 border border-green-200">
                                    <div className="flex items-center gap-2 mb-3">
                                      <ArrowTrendingUpIcon className="h-5 w-5 text-green-600" />
                                      <h4 className="font-semibold text-green-800">Earnings</h4>
                                    </div>
                                    {salaryComputed ? (
                                      <div className="space-y-1 text-sm">
                                        <div className="flex justify-between">
                                          <span>Basic:</span>
                                          <span>₹{(parseFloat(salaryInputs.basic_salary) || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>DA:</span>
                                          <span>₹{(salaryComputed.earnings.da || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>HRA:</span>
                                          <span>₹{(salaryComputed.earnings.hra || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>Conveyance:</span>
                                          <span>₹{(salaryComputed.earnings.conveyance || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>Call Allowance:</span>
                                          <span>₹{(salaryComputed.earnings.call_allowance || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>Other Allowance:</span>
                                          <span>₹{(salaryComputed.earnings.other_allowance || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="border-t pt-1 flex justify-between font-semibold text-green-700">
                                          <span>Gross:</span>
                                          <span>₹{(salaryComputed.earnings.gross || 0).toFixed(2)}</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-gray-500">Enter basic salary to see calculations</div>
                                    )}
                                  </div>

                                  {/* Deductions */}
                                  <div className="bg-white rounded-lg p-4 border border-red-200">
                                    <div className="flex items-center gap-2 mb-3">
                                      <ArrowTrendingDownIcon className="h-5 w-5 text-red-600" />
                                      <h4 className="font-semibold text-red-800">Deductions</h4>
                                    </div>
                                    {salaryComputed ? (
                                      <div className="space-y-1 text-sm">
                                        {formData.stat_pf && (
                                          <div className="flex justify-between">
                                            <span>PF:</span>
                                            <span>₹{(salaryComputed.deductions.pf || 0).toFixed(2)}</span>
                                          </div>
                                        )}
                                        {formData.stat_pt && (
                                          <div className="flex justify-between">
                                            <span>PT:</span>
                                            <span>₹{(salaryComputed.deductions.pt || 0).toFixed(2)}</span>
                                          </div>
                                        )}
                                        {formData.stat_mlwf && (
                                          <div className="flex justify-between">
                                            <span>MLWF:</span>
                                            <span>₹{(salaryComputed.deductions.mlwf || 0).toFixed(2)}</span>
                                          </div>
                                        )}
                                        {formData.stat_esic && salaryComputed.deductions.esic > 0 && (
                                          <div className="flex justify-between">
                                            <span>ESIC:</span>
                                            <span>₹{(salaryComputed.deductions.esic || 0).toFixed(2)}</span>
                                          </div>
                                        )}
                                        {formData.stat_tds && salaryComputed.summary.tds_monthly > 0 && (
                                          <div className="flex justify-between">
                                            <span>TDS:</span>
                                            <span>₹{(salaryComputed.summary.tds_monthly || 0).toFixed(2)}</span>
                                          </div>
                                        )}
                                        {!formData.stat_pf && !formData.stat_pt && !formData.stat_mlwf && !formData.stat_esic && !formData.stat_tds && (
                                          <div className="text-xs text-gray-500 italic">No statutory deductions selected</div>
                                        )}
                                        <div className="border-t pt-1 flex justify-between font-semibold text-red-700">
                                          <span>Total:</span>
                                          <span>₹{(salaryComputed.deductions.total_deductions || 0).toFixed(2)}</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-gray-500">No deductions calculated</div>
                                    )}
                                  </div>

                                  {/* Net Salary */}
                                  <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                      <ChartBarIcon className="h-5 w-5" />
                                      <h4 className="font-semibold">Net Salary</h4>
                                    </div>
                                    <div className="text-2xl font-bold">
                                      ₹{salaryComputed ? (salaryComputed.summary.net_salary || 0).toFixed(2) : '0.00'}
                                    </div>
                                    {salaryComputed && (
                                      <div className="text-sm opacity-90 mt-1">
                                        Final Payable: ₹{(salaryComputed.summary.final_payable || 0).toFixed(2)}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Save Button */}
                                <div className="mt-6">
                                  <button 
                                    type="button" 
                                    onClick={submitSalaryMaster} 
                                    disabled={salaryLoading || !selectedEmployee}
                                    className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-lg disabled:opacity-50 transition-all duration-300 flex items-center justify-center gap-2"
                                  >
                                    <CurrencyDollarIcon className="h-5 w-5" />
                                    {salaryLoading ? 'Saving...' : 'Save Salary Entry'}
                                  </button>
                                  {(salaryError || salarySuccess) && (
                                    <div className="mt-2 text-center text-sm">
                                      {salaryError && <div className="text-red-600">{salaryError}</div>}
                                      {salarySuccess && <div className="text-green-600">{salarySuccess}</div>}
                                    </div>
                                  )}
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
              </section>
            </div>
          )}

          {activeTab === 'view' && selectedEmployee && (
            <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-8 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
              <div className="flex items-center gap-4 mb-6">
                <Avatar src={selectedEmployee.profile_photo_url} firstName={selectedEmployee.first_name} lastName={selectedEmployee.last_name} size={72} />
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Employee Details</h3>
                  <p className="text-sm text-gray-500">{selectedEmployee.first_name} {selectedEmployee.last_name} • {selectedEmployee.employee_id}</p>
                </div>
              </div>
              
              <div className="space-y-6">
                {/* Basic Info */}
                <div className="bg-gray-50 p-6 rounded-xl">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Employee ID</p>
                      <p className="font-medium text-[#64126D]">{selectedEmployee.employee_id}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Full Name</p>
                      <p className="font-medium">{selectedEmployee.first_name} {selectedEmployee.last_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Email</p>
                      <p className="font-medium">{selectedEmployee.email}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Phone</p>
                      <p className="font-medium">{selectedEmployee.phone || '-'}</p>
                    </div>
                  </div>
                </div>

                {/* Work Info */}
                <div className="bg-gray-50 p-6 rounded-xl">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">Work Information</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Department</p>
                      <p className="font-medium">{selectedEmployee.department || '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Position</p>
                      <p className="font-medium">{selectedEmployee.position || '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Hire Date</p>
                      <p className="font-medium">{formatDate(selectedEmployee.hire_date)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Salary</p>
                      <p className="font-medium">{formatCurrency(selectedEmployee.salary)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Status</p>
                      <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${
                        selectedEmployee.status === 'active' 
                          ? 'bg-green-100 text-green-800'
                          : selectedEmployee.status === 'inactive'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {selectedEmployee.status}
                      </span>
                    </div>
                  </div>
                </div>

                {selectedEmployee.address && (
                  <div className="bg-gray-50 p-6 rounded-xl">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4">Additional Information</h4>
                    <div>
                      <p className="text-sm text-gray-600">Address</p>
                      <p className="font-medium">{selectedEmployee.address}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-6 border-t border-gray-200">
                <button
                  onClick={() => setActiveTab('list')}
                  className="px-6 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Back to List
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
