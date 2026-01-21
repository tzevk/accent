/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import PAYROLL_CONFIG from '@/utils/payroll-config';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';

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
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';

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

// Currency formatter with 2 decimal places for Indian Rupee
const formatCurrency = (value) => {
  const num = parseFloat(value) || 0;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};


export default function EmployeesPage() {
  // Safe profile photo change handler: forwards to canonical handler if present,
  // otherwise shows a friendly error and avoids runtime ReferenceError while
  // the file is mid-refactor.
  const handleProfilePhotoChange_safe = async (e) => {
    if (typeof handleProfilePhotoChange === 'function') {
      try {
        await handleProfilePhotoChange(e);
      } catch (err) {
        console.error('handleProfilePhotoChange invocation failed', err);
      }
      return;
    }
    try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch {}
    setFormErrors(prev => ({ ...prev, general: 'Photo upload temporarily unavailable while the editor is updating. Please try again.' }));
    console.error('handleProfilePhotoChange is not available yet');
  };
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
    system_role_name: '',
    // Deputation company
    deputation_company_id: ''
  };
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [workplaces, setWorkplaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeTab, setActiveTab] = useState('list'); // Keep for add/edit/view modes
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedWorkplace, setSelectedWorkplace] = useState('');
  const [selectedEmploymentStatus, setSelectedEmploymentStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [profileLocked, setProfileLocked] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [formData, setFormData] = useState(defaultFormData);
  const [formErrors, setFormErrors] = useState({});
  const [photoUploading, setPhotoUploading] = useState(false);
  // Roles for System Role assignment
  const [roles, setRoles] = useState([]);
  // Users from user master for username dropdown
  const [users, setUsers] = useState([]);
  // Companies for deputation dropdown
  const [companies, setCompanies] = useState([]);
  // Safe wrapper for opening the view form
  const openViewForm = (employee) => {
    if (!employee) return;
    try {
      setSelectedEmployee(employee);
      setActiveTab('view');
    } catch (e) {
      console.error('openViewForm failed', e);
    }
  };

  // Safe wrapper for opening the edit form. We add this wrapper to avoid TDZ/hoisting
  // issues if the original `openEditForm` declaration is temporarily unavailable
  // during ongoing edits. This mirrors the core behavior needed by the UI and
  // keeps changes minimal.
  const openEditForm_safe = (employee) => {
    if (!employee) return;
    try {
      const sysRoleId = (() => {
        try {
          const match = roles.find(r => r.role_name === employee.role);
          return match ? String(match.id) : '';
        } catch { return ''; }
      })();

      setFormData({ ...defaultFormData, ...employee, system_role_id: sysRoleId, system_role_name: employee.role || '', hire_date: employee.hire_date ? employee.hire_date.split('T')[0] : '', joining_date: employee.joining_date ? employee.joining_date.split('T')[0] : '', dob: employee.dob ? employee.dob.split('T')[0] : '' });
      setSelectedEmployee(employee);
      setProfileLocked(false); // Reset lock when opening new employee
      setFormErrors({});
      setEditSubTab('personal');
      setActiveTab('edit');
      
      // Reset all salary-related states for new employee profile
      setSavedSalaryProfiles([]);
      setEditingSalaryProfileId(null); // Reset editing state when switching employees
      setPreviewBreakdown(null);
      setManualValues({
        basic_plus_da: '',
        da: '',
        hra: '',
        conveyance: '',
        call_allowance: '',
        bonus: '',
        incentive: '',
        other_allowances: '',
        retention: '',
        insurance: '',
        pf_employee: '',
        esic_employee: '',
        pf_employer: '',
        esic_employer: ''
      });
      setSalaryPreview({
        salary_type: 'monthly',
        gross: '',
        hourly_rate: '',
        daily_rate: '',
        contract_amount: '',
        lumpsum_amount: '',
        lumpsum_description: '',
        contract_duration: 'monthly',
        contract_end_date: '',
        std_hours_per_day: 8,
        std_in_time: '09:00',
        std_out_time: '17:30',
        std_working_days: 26,
        ot_multiplier: 1.5,
        other_allowances: '',
        effective_from: new Date().toISOString().split('T')[0],
        effective_to: '',
        pf_applicable: true,
        esic_applicable: false,
        pt_applicable: false,
        mlwf_applicable: false,
        retention_applicable: false,
        bonus_applicable: false,
        incentive_applicable: false,
        insurance_applicable: false,
        custom_components: [],
        // Custom salary type fields
        custom_ctc: '',
        custom_hourly_rate: '',
        custom_monthly_hours: '',
        custom_basic: '',
        custom_da: '',
        custom_hra: '',
        custom_conveyance: '',
        custom_call_allowance: '',
        custom_incentive: '',
        custom_other_allowances: '',
        custom_pf_employee: '',
        custom_esic_employee: '',
        custom_pt: '',
        custom_mlwf: '',
        custom_retention: '',
        custom_pf_employer: '',
        custom_esic_employer: '',
        custom_mlwf_employer: '',
        custom_bonus: '',
        custom_insurance: ''
      });
      setSalaryProfileSuccess('');
      setPreviewError('');
      
      // Reset payroll component states
      setCurrentDA(0);
      setCurrentPT(0);
      setCurrentMLWF(0);
      setCurrentMLWFEmployer(0);
      setCurrentRetention(0);
      setCurrentBonus(0);
      setCurrentIncentive(0);
      setCurrentInsurance(0);
      
      // Fetch saved salary profiles for this employee
      if (employee.id) {
        fetchSavedSalaryProfiles(employee.id);
      }
    } catch (e) {
      console.error('openEditForm_safe failed', e);
    }
  };
  
  // Handle form submission for creating/updating employees
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Prevent submission if profile is locked
    if (profileLocked) {
      setFormErrors({ general: 'Profile is locked. Unlock to make changes.' });
      return;
    }
    
    // Validate required fields before submission
    const requiredFields = {
      employee_id: 'Employee ID',
      first_name: 'First Name',
      last_name: 'Last Name',
      email: 'Email'
    };
    
    const missingFields = [];
    for (const [field, label] of Object.entries(requiredFields)) {
      if (!formData[field] || formData[field].trim() === '') {
        missingFields.push(label);
      }
    }
    
    if (missingFields.length > 0) {
      setFormErrors({ general: `Please fill in required fields: ${missingFields.join(', ')}` });
      return;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setFormErrors({ general: 'Please enter a valid email address' });
      return;
    }
    
    setLoading(true);
    setFormErrors({});
    setErrorMsg('');
    setSuccessMessage('');

    try {
      const method = selectedEmployee ? 'PUT' : 'POST';
      const url = selectedEmployee ? `/api/employees?id=${selectedEmployee.id}` : '/api/employees';
      
      // Prepare the data to send
      const dataToSend = { ...formData };
      
      // If updating, include the id
      if (selectedEmployee) {
        dataToSend.id = selectedEmployee.id;
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSend)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.message || 'Failed to save employee');
      }

      setSuccessMessage(selectedEmployee ? 'Employee updated successfully!' : 'Employee created successfully!');
      
      // Refresh the employee list
      await fetchEmployees();
      
      // If editing, stay on the same page; if adding new, go back to list
      if (selectedEmployee) {
        // Update selectedEmployee with latest data and stay on edit page
        const updatedEmployee = result.data || { ...selectedEmployee, ...formData };
        setSelectedEmployee(updatedEmployee);
        setTimeout(() => {
          setSuccessMessage('');
        }, 2000);
      } else {
        // Reset form and go back to list for new employee
        setTimeout(() => {
          setActiveTab('list');
          setSelectedEmployee(null);
          setFormData(defaultFormData);
          setSuccessMessage('');
        }, 1500);
      }

    } catch (error) {
      console.error('Error saving employee:', error);
      setFormErrors({ general: error.message || 'Failed to save employee. Please try again.' });
    } finally {
      setLoading(false);
    }
  };
  
  // Safe submit wrapper to avoid runtime ReferenceError if `handleSubmit` is temporarily
  // undefined during an in-progress refactor. If the canonical `handleSubmit` exists
  // it will be invoked; otherwise we show a friendly error and prevent default.
  const handleSubmit_safe = async (e) => {
    // Try calling the canonical handleSubmit if it's available. In some
    // in-flight refactor states the `handleSubmit` binding may not be ready
    // yet; retry a few times before failing gracefully.
    const callIfReady = async () => {
      if (typeof handleSubmit === 'function') {
        try {
          await handleSubmit(e);
          return true;
        } catch (err) {
          // forward error to console but don't spam user with internal messages
          console.error('handleSubmit invocation failed', err);
          return false;
        }
      }
      return false;
    };

    // Immediate attempt
    if (await callIfReady()) return;

    // Retry a few times (short backoff) in case of a transient binding order issue
    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // small delay
       
      await new Promise(res => setTimeout(res, 50));
       
      if (await callIfReady()) return;
    }

    // If still not available, show a user-friendly message but avoid noisy console errors
    try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch {}
    setFormErrors(prev => ({ ...prev, general: 'Form submission temporarily unavailable. Please try again.' }));
  };

  // Autosave function - silently saves employee data without redirecting
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState(null);
  
  const autoSaveEmployee = async () => {
    // Only autosave if we're editing an existing employee and profile is not locked
    if (!selectedEmployee?.id || profileLocked) return;
    
    try {
      setAutoSaving(true);
      const dataToSend = { ...formData, id: selectedEmployee.id };
      
      const response = await fetch(`/api/employees?id=${selectedEmployee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSend)
      });

      if (response.ok) {
        setLastAutoSave(new Date());
        // Silently refresh employee list in background
        fetchEmployees();
      }
    } catch (error) {
      console.error('Autosave failed:', error);
    } finally {
      setAutoSaving(false);
    }
  };

  // Delete employee
  const handleDelete = async (employee) => {
    if (!employee?.id) return;
    
    if (!confirm(`Are you sure you want to delete ${employee.first_name} ${employee.last_name}? This action cannot be undone.`)) {
      return;
    }
    
    try {
      setLoading(true);
      const response = await fetch(`/api/employees?id=${employee.id}`, {
        method: 'DELETE'
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete employee');
      }
      
      setSuccessMessage('Employee deleted successfully!');
      // Refresh the employee list
      await fetchEmployees();
      
      setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
    } catch (error) {
      console.error('Error deleting employee:', error);
      setFormErrors({ general: error.message || 'Failed to delete employee. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  // Add Employee sub-tabs (like Projects edit tabs)
  const addSubTabOrder = ['personal','contact','work','academic','govt','bank','attendance'];
  const [addSubTab, setAddSubTab] = useState('personal');
  
  // Edit Employee sub-tabs (same structure as add) - includes salary structure
  const editSubTabOrder = ['personal','contact','work','salary','academic','govt','bank','attendance'];
  const [editSubTab, setEditSubTab] = useState('personal');

  // Salary Structure State - New Core Payroll Tables Based
  const [salaryStructures, setSalaryStructures] = useState([]);
  const [activeSalaryStructure, setActiveSalaryStructure] = useState(null);
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [salaryError, setSalaryError] = useState('');
  const [showSalaryForm, setShowSalaryForm] = useState(false);
  const [calculatedBreakdown, setCalculatedBreakdown] = useState(null);
  
  // New Salary Preview State (using core payroll tables)
  const [salaryPreview, setSalaryPreview] = useState({
    salary_type: 'monthly', // monthly, hourly, daily, contract, lumpsum, custom
    gross: '',
    hourly_rate: '',
    daily_rate: '',
    contract_amount: '',
    lumpsum_amount: '',
    other_allowances: '',
    effective_from: new Date().toISOString().split('T')[0],
    effective_to: '',
    pf_applicable: true,
    esic_applicable: false,
    pt_applicable: false,
    mlwf_applicable: false,
    retention_applicable: false,
    bonus_applicable: false,
    incentive_applicable: false,
    insurance_applicable: false,
    custom_components: [], // For custom salary type: [{name: 'Basic', amount: 10000, type: 'earning'}, ...]
    custom_hourly_rate: '', // For custom salary type hourly rate
    custom_monthly_hours: '160' // Standard 160 hours/month
  });
  const [currentDA, setCurrentDA] = useState(0);
  const [currentPT, setCurrentPT] = useState(0);
  const [currentMLWF, setCurrentMLWF] = useState(0);
  const [currentMLWFEmployer, setCurrentMLWFEmployer] = useState(0);
  const [currentRetention, setCurrentRetention] = useState(0);
  const [currentBonus, setCurrentBonus] = useState(0);
  const [currentIncentive, setCurrentIncentive] = useState(0);
  const [currentInsurance, setCurrentInsurance] = useState(0);
  const [manualValues, setManualValues] = useState({
    basic_plus_da: '',
    da: '',
    hra: '',
    conveyance: '',
    call_allowance: '',
    pf_employee: '',
    esic_employee: '',
    pf_employer: '',
    esic_employer: ''
  });
  const [currentComponents, setCurrentComponents] = useState({
    pf_employee: 0,
    pf_employer: 0,
    esic_employee: 0,
    esic_employer: 0,
    pt: 0,
    mlwf: 0,
    insurance: 0,
    personal_accident: 0,
    mediclaim: 0,
    bonus: 0,
    leaves: 0,
    tds: 0
  });
  const [previewBreakdown, setPreviewBreakdown] = useState(null);
  const [previewError, setPreviewError] = useState('');
  
  // Salary calculation percentages - now using centralized config
  // These values are frozen in /src/utils/payroll-config.js
  const [salaryPercentages, setSalaryPercentages] = useState({
    basic_percent: PAYROLL_CONFIG.BASIC_DA_PERCENT,     // 60% - Basic+DA % of Gross
    da_fixed: PAYROLL_CONFIG.DA_FIXED_AMOUNT,           // 0 - DA Fixed amount (if any)
    hra_percent: PAYROLL_CONFIG.HRA_PERCENT,            // 20% - HRA % of Gross
    conveyance_percent: PAYROLL_CONFIG.CONVEYANCE_PERCENT,  // 10% - Conveyance % of Gross
    conveyance: PAYROLL_CONFIG.CONVEYANCE_FIXED_AMOUNT, // 0 - Fixed conveyance (if any)
    call_allowance_percent: PAYROLL_CONFIG.CALL_ALLOWANCE_PERCENT, // 10% - Call Allowance % of Gross
    employee_pf_percent: PAYROLL_CONFIG.EMPLOYEE_PF_PERCENT,   // 12% - Employee PF
    employer_pf_percent: PAYROLL_CONFIG.EMPLOYER_PF_PERCENT,   // 13% - Employer PF
    employee_esic_percent: PAYROLL_CONFIG.EMPLOYEE_ESIC_PERCENT, // 0.75% - Employee ESIC
    employer_esic_percent: PAYROLL_CONFIG.EMPLOYER_ESIC_PERCENT, // 3.25% - Employer ESIC
    gratuity_percent: PAYROLL_CONFIG.GRATUITY_PERCENT,   // 4.81% - Gratuity
    pf_admin_percent: PAYROLL_CONFIG.PF_ADMIN_PERCENT,   // 0.5% - PF Admin
    edli_percent: PAYROLL_CONFIG.EDLI_PERCENT,           // 0.5% - EDLI
  });

  // Manual salary values for legacy form
  const [manualSalaryValues, setManualSalaryValues] = useState({
    hra: '',
    conveyance: '',
    medical: '',
    special_allowance: '',
    employee_pf: '',
    employer_pf: '',
    employee_esic: '',
    employer_esic: '',
    gratuity: '',
    pt: '',
  });

  const [salaryFormData, setSalaryFormData] = useState({
    pay_type: 'monthly',
    effective_from: new Date().toISOString().split('T')[0],
    ctc: '',
    gross_salary: '',
    basic_salary: '',
    hourly_rate: '',
    daily_rate: '',
    ot_multiplier: '1.5',
    pf_applicable: true,
    esic_applicable: false,
    pt_applicable: true,
    mlwf_applicable: true,
    tds_applicable: true,
    pf_wage_ceiling: '15000',
    standard_working_days: '26',
    standard_hours_per_day: '8',
    remarks: ''
  });
  const [salaryComponents, setSalaryComponents] = useState([]);

  // Fetch salary structures for an employee
  const fetchSalaryStructures = useCallback(async (employeeId) => {
    if (!employeeId) return;
    setSalaryLoading(true);
    setSalaryError('');
    try {
      const res = await fetch(`/api/employees/${employeeId}/salary-structure`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch salary structures');
      setSalaryStructures(data.salaryStructures || []);
      setActiveSalaryStructure(data.activeSalaryStructure || null);
    } catch (err) {
      console.error('Error fetching salary structures:', err);
      setSalaryError(err.message);
    } finally {
      setSalaryLoading(false);
    }
  }, []);

  // Fetch current DA, MLWF, Retention for salary preview - from payroll schedules
  const fetchCurrentDA = async () => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      
      // Fetch DA from payroll schedules - use active_only=true to get current active schedules
      const schedulesRes = await fetch(`/api/payroll/schedules?component_type=da&active_only=true&date=${currentDate}`);
      const schedulesData = await schedulesRes.json();
      
      let daAmount = 0;
      if (schedulesData.success && schedulesData.data && schedulesData.data.length > 0) {
        // Get the first active DA schedule (already filtered by API)
        const activeDA = schedulesData.data[0];
        if (activeDA) {
          daAmount = parseFloat(activeDA.value) || 0;
          setCurrentDA(daAmount);
          return daAmount;
        }
      }
      
      // Fallback to old DA schedule API if needed
      if (daAmount === 0) {
        const currentYear = new Date().getFullYear();
        const daRes = await fetch(`/api/payroll/da-schedule/current?date=${currentDate}&year=${currentYear}`);
        const daData = await daRes.json();
        
        if (daData.success && daData.data) {
          daAmount = parseFloat(daData.data.da_amount) || 0;
          setCurrentDA(daAmount);
        }
      }
      
      return daAmount;
    } catch (err) {
      console.error('Error fetching DA:', err);
    }
    return 0;
  };

  // Fetch MLWF amount from payroll schedules (both employee and employer)
  const fetchMLWF = async () => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      
      // Fetch employee MLWF (try mlwf_employee first, then fallback to mlwf)
      let mlwfEmployeeAmount = 0;
      const employeeRes = await fetch(`/api/payroll/schedules?component_type=mlwf_employee&active_only=true&date=${currentDate}`);
      const employeeData = await employeeRes.json();
      if (employeeData.success && employeeData.data && employeeData.data.length > 0) {
        mlwfEmployeeAmount = parseFloat(employeeData.data[0].value) || 0;
      } else {
        // Fallback to old 'mlwf' component type
        const fallbackRes = await fetch(`/api/payroll/schedules?component_type=mlwf&active_only=true&date=${currentDate}`);
        const fallbackData = await fallbackRes.json();
        if (fallbackData.success && fallbackData.data && fallbackData.data.length > 0) {
          mlwfEmployeeAmount = parseFloat(fallbackData.data[0].value) || 0;
        }
      }
      setCurrentMLWF(mlwfEmployeeAmount);
      
      // Fetch employer MLWF
      const employerRes = await fetch(`/api/payroll/schedules?component_type=mlwf_employer&active_only=true&date=${currentDate}`);
      const employerData = await employerRes.json();
      if (employerData.success && employerData.data && employerData.data.length > 0) {
        const mlwfEmployerAmount = parseFloat(employerData.data[0].value) || 0;
        setCurrentMLWFEmployer(mlwfEmployerAmount);
      }
      
      return mlwfEmployeeAmount;
    } catch (err) {
      console.error('Error fetching MLWF:', err);
    }
    return 0;
  };

  // Fetch MLWF with employer - returns both employee and employer values
  const fetchMLWFWithEmployer = async () => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      
      // Fetch employee MLWF (try mlwf_employee first, then fallback to mlwf)
      let mlwfEmployeeAmount = 0;
      const employeeRes = await fetch(`/api/payroll/schedules?component_type=mlwf_employee&active_only=true&date=${currentDate}`);
      const employeeData = await employeeRes.json();
      if (employeeData.success && employeeData.data && employeeData.data.length > 0) {
        mlwfEmployeeAmount = parseFloat(employeeData.data[0].value) || 0;
      } else {
        // Fallback to old 'mlwf' component type
        const fallbackRes = await fetch(`/api/payroll/schedules?component_type=mlwf&active_only=true&date=${currentDate}`);
        const fallbackData = await fallbackRes.json();
        if (fallbackData.success && fallbackData.data && fallbackData.data.length > 0) {
          mlwfEmployeeAmount = parseFloat(fallbackData.data[0].value) || 0;
        }
      }
      setCurrentMLWF(mlwfEmployeeAmount);
      
      // Fetch employer MLWF
      let mlwfEmployerAmount = 0;
      const employerRes = await fetch(`/api/payroll/schedules?component_type=mlwf_employer&active_only=true&date=${currentDate}`);
      const employerData = await employerRes.json();
      if (employerData.success && employerData.data && employerData.data.length > 0) {
        mlwfEmployerAmount = parseFloat(employerData.data[0].value) || 0;
        setCurrentMLWFEmployer(mlwfEmployerAmount);
      }
      
      return { employee: mlwfEmployeeAmount, employer: mlwfEmployerAmount };
    } catch (err) {
      console.error('Error fetching MLWF:', err);
    }
    return { employee: 0, employer: 0 };
  };

  // Fetch Retention amount from payroll schedules
  const fetchRetention = async () => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const schedulesRes = await fetch(`/api/payroll/schedules?component_type=retention&active_only=true&date=${currentDate}`);
      const schedulesData = await schedulesRes.json();
      
      if (schedulesData.success && schedulesData.data && schedulesData.data.length > 0) {
        const retentionAmount = parseFloat(schedulesData.data[0].value) || 0;
        setCurrentRetention(retentionAmount);
        return retentionAmount;
      }
    } catch (err) {
      console.error('Error fetching Retention:', err);
    }
    return 0;
  };

  // Fetch PT (Professional Tax) amount from payroll schedules
  const fetchPT = async () => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const schedulesRes = await fetch(`/api/payroll/schedules?component_type=pt&active_only=true&date=${currentDate}`);
      const schedulesData = await schedulesRes.json();
      
      if (schedulesData.success && schedulesData.data && schedulesData.data.length > 0) {
        const ptAmount = parseFloat(schedulesData.data[0].value) || 0;
        setCurrentPT(ptAmount);
        return ptAmount;
      }
    } catch (err) {
      console.error('Error fetching PT:', err);
    }
    return 0;
  };

  // Fetch Bonus rate from payroll schedules (percentage to apply on Basic + DA)
  const fetchBonus = async () => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const schedulesRes = await fetch(`/api/payroll/schedules?component_type=bonus&active_only=true&date=${currentDate}`);
      const schedulesData = await schedulesRes.json();
      
      if (schedulesData.success && schedulesData.data && schedulesData.data.length > 0) {
        // Bonus rate is stored as percentage (e.g., 8.33 for 8.33%)
        const bonusRate = parseFloat(schedulesData.data[0].value) || 0;
        setCurrentBonus(bonusRate);
        return bonusRate;
      }
    } catch (err) {
      console.error('Error fetching Bonus:', err);
    }
    return 0;
  };

  // Fetch Incentive amount from payroll schedules
  const fetchIncentive = async () => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const schedulesRes = await fetch(`/api/payroll/schedules?component_type=incentive&active_only=true&date=${currentDate}`);
      const schedulesData = await schedulesRes.json();
      
      if (schedulesData.success && schedulesData.data && schedulesData.data.length > 0) {
        const incentiveAmount = parseFloat(schedulesData.data[0].value) || 0;
        setCurrentIncentive(incentiveAmount);
        return incentiveAmount;
      }
    } catch (err) {
      console.error('Error fetching Incentive:', err);
    }
    return 0;
  };

  // Fetch Insurance amount from payroll schedules
  const fetchInsurance = async () => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const schedulesRes = await fetch(`/api/payroll/schedules?component_type=insurance&active_only=true&date=${currentDate}`);
      const schedulesData = await schedulesRes.json();
      
      if (schedulesData.success && schedulesData.data && schedulesData.data.length > 0) {
        const insuranceAmount = parseFloat(schedulesData.data[0].value) || 0;
        setCurrentInsurance(insuranceAmount);
        return insuranceAmount;
      }
    } catch (err) {
      console.error('Error fetching Insurance:', err);
    }
    return 0;
  };

  // Fetch monthly hours from attendance for custom salary calculation
  const fetchAttendanceHours = async (employeeId) => {
    if (!employeeId) return ''; // No employee
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const monthParam = `${year}-${month}`;
      
      console.log('Fetching attendance for employee:', employeeId, 'month:', monthParam);
      
      const res = await fetch(`/api/attendance?employee_id=${employeeId}&month=${monthParam}`);
      const data = await res.json();
      
      console.log('Attendance API response:', data);
      
      if (data.success) {
        // Check summary first
        if (data.summary && data.summary.length > 0) {
          const empData = data.summary.find(e => String(e.employee_id) === String(employeeId)) || data.summary[0];
          console.log('Found employee data in summary:', empData);
          
          if (empData && empData.days && Object.keys(empData.days).length > 0) {
            let totalHours = 0;
            const defaultHours = 8.5; // Default 9:00 to 17:30
            
            Object.entries(empData.days).forEach(([date, dayInfo]) => {
              if (['P', 'HD', 'OT'].includes(dayInfo.status)) {
                if (dayInfo.in_time && dayInfo.out_time) {
                  const hrs = calculateHoursDiff(dayInfo.in_time, dayInfo.out_time);
                  totalHours += hrs;
                  console.log(`Date ${date}: ${dayInfo.status} - ${dayInfo.in_time} to ${dayInfo.out_time} = ${hrs} hrs`);
                } else {
                  const hrs = dayInfo.status === 'HD' ? defaultHours / 2 : defaultHours;
                  totalHours += hrs;
                  console.log(`Date ${date}: ${dayInfo.status} - default = ${hrs} hrs`);
                }
              }
            });
            
            console.log('Total hours calculated:', totalHours);
            return totalHours > 0 ? totalHours.toFixed(1) : '';
          }
        }
        
        // If no summary, try to calculate from records directly
        if (data.records && data.records.length > 0) {
          console.log('Using records directly, count:', data.records.length);
          let totalHours = 0;
          const defaultHours = 8.5;
          
          data.records.forEach(record => {
            if (['P', 'HD', 'OT'].includes(record.status)) {
              if (record.in_time && record.out_time) {
                totalHours += calculateHoursDiff(record.in_time, record.out_time);
              } else {
                totalHours += record.status === 'HD' ? defaultHours / 2 : defaultHours;
              }
            }
          });
          
          console.log('Total hours from records:', totalHours);
          return totalHours > 0 ? totalHours.toFixed(1) : '';
        }
      }
    } catch (err) {
      console.error('Error fetching attendance hours:', err);
    }
    return '';
  };

  // Helper function to calculate hours difference
  const calculateHoursDiff = (inTime, outTime) => {
    if (!inTime || !outTime) return 8.5;
    try {
      // Handle various time formats (HH:MM:SS, HH:MM, etc.)
      const parseTime = (time) => {
        const timeStr = String(time).substring(0, 5); // Get HH:MM part
        const parts = timeStr.split(':').map(Number);
        return parts[0] + (parts[1] || 0) / 60;
      };
      
      const inDecimal = parseTime(inTime);
      const outDecimal = parseTime(outTime);
      const diff = outDecimal - inDecimal;
      
      return diff > 0 ? diff : 8.5;
    } catch (err) {
      console.error('Error parsing time:', inTime, outTime, err);
      return 8.5;
    }
  };

  // Check if employee is exempt from PT
  // Male: up to 7500 = exempt
  // Female: up to 25000 = exempt
  const isPTExempt = (grossSalary) => {
    const gender = formData.gender || selectedEmployee?.gender || '';
    const gross = parseFloat(grossSalary) || 0;
    if (gender === 'Female' && gross <= 25000) return true;
    if (gender === 'Male' && gross <= 7500) return true;
    return false;
  };

  // Calculate PT amount based on gender, salary and month
  // Male: 7501-10000 = 175, above 10000 = 200
  // Female: 25000+ = 200
  // February: 300 for all (except exempt employees)
  const calculatePTAmount = (grossSalary) => {
    const gender = formData.gender || selectedEmployee?.gender || '';
    const gross = parseFloat(grossSalary) || 0;
    const currentMonth = new Date().getMonth(); // 0 = Jan, 1 = Feb
    
    // Check exemptions first
    if (isPTExempt(gross)) return 0;
    
    // February special rate (300) for non-exempt employees
    if (currentMonth === 1) { // February
      return 300;
    }
    
    // Regular rates by gender and salary
    if (gender === 'Male') {
      if (gross >= 7501 && gross <= 10000) return 175;
      if (gross > 10000) return 200;
    }
    
    if (gender === 'Female') {
      if (gross >= 25000) return 200;
    }
    
    return 200; // Default PT amount
  };

  // Fetch all current payroll components (PF, PT, ESIC, Insurance, Bonus, Leaves, etc.)
  const fetchAllComponents = async (grossSalary = 0) => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const gross = parseFloat(grossSalary) || parseFloat(salaryPreview.gross) || 0;
      
      const schedulesRes = await fetch(`/api/payroll/schedules/current?date=${currentDate}&gross=${gross}`);
      const schedulesData = await schedulesRes.json();
      
      if (schedulesData.success && schedulesData.data) {
        const components = schedulesData.data.components;
        setCurrentComponents({
          pf_employee: components.pf_employee?.amount || 0,
          pf_employer: components.pf_employer?.amount || 0,
          esic_employee: components.esic_employee?.amount || 0,
          esic_employer: components.esic_employer?.amount || 0,
          pt: components.pt?.amount || 0,
          mlwf: components.mlwf?.amount || 0,
          insurance: components.insurance?.amount || 0,
          personal_accident: components.personal_accident?.amount || 0,
          mediclaim: components.mediclaim?.amount || 0,
          bonus: components.bonus?.amount || 0,
          leaves: components.leaves?.amount || 0,
          tds: components.tds?.amount || 0
        });
      }
    } catch (error) {
      console.error('Error fetching payroll components:', error);
    }
  };

  // Recalculate only totals from manual values (without recalculating breakdown)
  const recalculateTotalsFromManual = (updatedManualValues) => {
    if (!previewBreakdown) return;
    
    const gross = parseFloat(salaryPreview.gross) || 0;
    
    // Auto-calculate bifurcation based on gross salary (unless manually overridden)
    // Basic = 60% of Gross - DA, HRA = 20%, Conveyance = 10%, Call Allowance = 10%
    const calculatedBasic = Math.round(Math.max(0, gross * 0.60 - (currentDA || 0)));
    const calculatedHra = Math.round(gross * 0.20);
    const calculatedConveyance = Math.round(gross * 0.10);
    const calculatedCallAllowance = Math.round(gross * 0.10);
    
    // Use manual value if explicitly provided, otherwise use auto-calculated value
    const basic_plus_da = (updatedManualValues.basic_plus_da !== undefined && updatedManualValues.basic_plus_da !== '' && updatedManualValues.basic_plus_da !== null)
      ? parseFloat(updatedManualValues.basic_plus_da) || 0
      : calculatedBasic;
    
    const da = (updatedManualValues.da !== undefined && updatedManualValues.da !== '' && updatedManualValues.da !== null)
      ? parseFloat(updatedManualValues.da) || 0
      : (currentDA || previewBreakdown.da || 0);
    
    const hra = (updatedManualValues.hra !== undefined && updatedManualValues.hra !== '' && updatedManualValues.hra !== null)
      ? parseFloat(updatedManualValues.hra) || 0
      : calculatedHra;
    
    const conveyance = (updatedManualValues.conveyance !== undefined && updatedManualValues.conveyance !== '' && updatedManualValues.conveyance !== null)
      ? parseFloat(updatedManualValues.conveyance) || 0
      : calculatedConveyance;
    
    const call_allowance = (updatedManualValues.call_allowance !== undefined && updatedManualValues.call_allowance !== '' && updatedManualValues.call_allowance !== null)
      ? parseFloat(updatedManualValues.call_allowance) || 0
      : calculatedCallAllowance;
    
    const other_allowances = (updatedManualValues.other_allowances !== undefined && updatedManualValues.other_allowances !== '' && updatedManualValues.other_allowances !== null)
      ? parseFloat(updatedManualValues.other_allowances) || 0
      : (parseFloat(salaryPreview.other_allowances) || previewBreakdown.other_allowances || 0);
    
    // Calculate Basic + DA total for PF and Bonus calculations
    const basicPlusDaTotal = basic_plus_da + da;
    
    // PF calculation - always based on ₹15,000 ceiling
    // Employee PF = 12% of ₹15,000 = ₹1,800
    // Employer PF = 13% of ₹15,000 = ₹1,950
    const PF_CEILING = 15000;
    const calculatedPfEmployee = salaryPreview.pf_applicable ? Math.round(PF_CEILING * 0.12) : 0; // ₹1,800
    const calculatedPfEmployer = salaryPreview.pf_applicable ? Math.round(PF_CEILING * 0.13) : 0; // ₹1,950
    
    // Bonus is calculated as percentage of Basic + DA (currentBonus is the rate)
    // Always auto-calculate bonus based on current Basic + DA, unless manually overridden
    const calculatedBonus = salaryPreview.bonus_applicable ? Math.round(basicPlusDaTotal * currentBonus / 100) : 0;
    const bonus = salaryPreview.bonus_applicable 
      ? ((updatedManualValues.bonus !== undefined && updatedManualValues.bonus !== '' && updatedManualValues.bonus !== null)
          ? parseFloat(updatedManualValues.bonus) || 0
          : calculatedBonus)
      : 0;
    
    // Incentive - use manual value if explicitly provided, otherwise use fetched value
    const incentive = salaryPreview.incentive_applicable 
      ? ((updatedManualValues.incentive !== undefined && updatedManualValues.incentive !== '' && updatedManualValues.incentive !== null)
          ? parseFloat(updatedManualValues.incentive) || 0
          : (currentIncentive || previewBreakdown.incentive || 0))
      : 0;
    
    // PF values - ALWAYS use fixed ceiling values (₹1,800 employee, ₹1,950 employer)
    // Use user-edited value if explicitly entered, otherwise use calculated value
    const pf_employee = (updatedManualValues.pf_employee !== undefined && updatedManualValues.pf_employee !== '' && updatedManualValues.pf_employee !== null)
      ? parseFloat(updatedManualValues.pf_employee) || 0
      : calculatedPfEmployee; // Always use the fixed ceiling value, not old previewBreakdown value
    const pf_employer = (updatedManualValues.pf_employer !== undefined && updatedManualValues.pf_employer !== '' && updatedManualValues.pf_employer !== null)
      ? parseFloat(updatedManualValues.pf_employer) || 0
      : calculatedPfEmployer; // Always use the fixed ceiling value
    
    // ESIC - auto-calculate based on gross salary unless manually overridden
    const calculatedEsicEmployee = salaryPreview.esic_applicable ? Math.round(gross * 0.0075) : 0;
    const calculatedEsicEmployer = salaryPreview.esic_applicable ? Math.round(gross * 0.0325) : 0;
    const esic_employee = salaryPreview.esic_applicable
      ? ((updatedManualValues.esic_employee !== undefined && updatedManualValues.esic_employee !== '' && updatedManualValues.esic_employee !== null)
          ? parseFloat(updatedManualValues.esic_employee) || 0
          : calculatedEsicEmployee)
      : 0;
    const esic_employer = salaryPreview.esic_applicable
      ? ((updatedManualValues.esic_employer !== undefined && updatedManualValues.esic_employer !== '' && updatedManualValues.esic_employer !== null)
          ? parseFloat(updatedManualValues.esic_employer) || 0
          : calculatedEsicEmployer)
      : 0;
    
    // PT - use manual value if explicitly provided, otherwise always auto-calculate based on gender, salary and month rules
    const ptExempt = isPTExempt(salaryPreview.gross);
    const calculatedPt = calculatePTAmount(salaryPreview.gross);
    const pt = salaryPreview.pt_applicable && !ptExempt 
      ? ((updatedManualValues.pt !== undefined && updatedManualValues.pt !== '' && updatedManualValues.pt !== null)
          ? parseFloat(updatedManualValues.pt) || 0
          : calculatedPt)
      : 0;
    
    // MLWF - use manual value if explicitly provided, otherwise use fetched value
    const mlwf = salaryPreview.mlwf_applicable 
      ? ((updatedManualValues.mlwf !== undefined && updatedManualValues.mlwf !== '' && updatedManualValues.mlwf !== null)
          ? parseFloat(updatedManualValues.mlwf) || 0
          : (currentMLWF || previewBreakdown.mlwf || 0))
      : 0;
    
    // Retention - use manual value if explicitly provided, otherwise use fetched value
    const retention = salaryPreview.retention_applicable 
      ? ((updatedManualValues.retention !== undefined && updatedManualValues.retention !== '' && updatedManualValues.retention !== null)
          ? parseFloat(updatedManualValues.retention) || 0
          : (currentRetention || previewBreakdown.retention || 0))
      : 0;
    
    // Insurance - use manual value if explicitly provided, otherwise use fetched value
    const insurance = salaryPreview.insurance_applicable
      ? ((updatedManualValues.insurance !== undefined && updatedManualValues.insurance !== '' && updatedManualValues.insurance !== null)
          ? parseFloat(updatedManualValues.insurance) || 0
          : (currentInsurance || previewBreakdown.insurance || 0))
      : 0;
    
    // Total earnings = Basic + DA (within 60%) + HRA (20%) + Conveyance (10%) + Call Allowance (10%) = Gross
    // Plus any incentive and other allowances on top (bonus is added to CTC only, not earnings)
    const total_earnings = Math.round(basic_plus_da + da + hra + conveyance + call_allowance + other_allowances + incentive);
    const total_deductions = Math.round(pf_employee + esic_employee + pt + mlwf + retention);
    const net_pay = Math.round(total_earnings - total_deductions);
    
    // MLWF Employer - use manual value if explicitly provided, otherwise use fetched value
    const mlwf_employer = salaryPreview.mlwf_applicable 
      ? ((updatedManualValues.mlwf_employer !== undefined && updatedManualValues.mlwf_employer !== '' && updatedManualValues.mlwf_employer !== null)
          ? parseFloat(updatedManualValues.mlwf_employer) || 0
          : (currentMLWFEmployer || previewBreakdown.mlwf_employer || 0))
      : 0;
    
    // Employer cost = Total Earnings + Employer contributions + Bonus + Insurance
    const employer_cost = Math.round(total_earnings + pf_employer + esic_employer + mlwf_employer + bonus + insurance);
    const basic_da_total = Math.round(basic_plus_da + da);
    
    setPreviewBreakdown({
      ...previewBreakdown,
      basic_plus_da: Math.round(basic_plus_da),
      da: Math.round(da),
      hra: Math.round(hra),
      conveyance: Math.round(conveyance),
      call_allowance: Math.round(call_allowance),
      other_allowances: Math.round(other_allowances),
      bonus: Math.round(bonus),
      incentive: Math.round(incentive),
      pf_employee: Math.round(pf_employee),
      esic_employee: Math.round(esic_employee),
      pf_employer: Math.round(pf_employer),
      esic_employer: Math.round(esic_employer),
      pt: Math.round(pt),
      mlwf: Math.round(mlwf),
      mlwf_employer: Math.round(mlwf_employer),
      retention: Math.round(retention),
      insurance: Math.round(insurance),
      basic_da_total,
      total_earnings,
      total_deductions,
      net_pay,
      employer_cost
    });
  };

  // Calculate Salary Preview (using core payroll tables & frozen rules)
  // If useManual is true, use manualValues instead of auto-calculated values
  const calculateSalaryPreview = async (grossInput, otherAllowancesInput, useManual = false, overrideDA = null) => {
    const gross = parseFloat(grossInput) || 0;
    const otherAllowances = parseFloat(otherAllowancesInput) || 0;
    
    if (gross === 0) {
      setPreviewBreakdown(null);
      setPreviewError('');
      return;
    }
    
    try {
      setPreviewError('');
      
      // Fetch all components based on current date and gross salary
      await fetchAllComponents(gross);
      
      // Fetch DA, MLWF, Retention from payroll schedules
      // Use override if provided, otherwise fall back to state
      let daAmount = overrideDA !== null ? parseFloat(overrideDA) : (currentDA || 0);
      let mlwfAmount = currentMLWF || 0;
      let retentionAmount = currentRetention || 0;
      let mlwfEmployerAmount = currentMLWFEmployer || 0;
      let bonusRate = currentBonus || 0;
      let incentiveAmount = currentIncentive || 0;
      
      // Always fetch DA if not available
      if (daAmount === 0) {
        daAmount = await fetchCurrentDA();
      }
      
      // Always fetch MLWF (both employee and employer) and bonus/incentive rates if not available
      // These are from payroll schedules and should be fetched regardless of manual mode
      if (mlwfAmount === 0 || mlwfEmployerAmount === 0) {
        const fetchedMlwf = await fetchMLWFWithEmployer(); // Returns { employee, employer }
        mlwfAmount = mlwfAmount || fetchedMlwf.employee;
        mlwfEmployerAmount = mlwfEmployerAmount || fetchedMlwf.employer;
      }
      if (retentionAmount === 0) {
        retentionAmount = await fetchRetention();
      }
      if (salaryPreview.bonus_applicable && bonusRate === 0) {
        console.log('Fetching bonus rate in calculateSalaryPreview, bonus_applicable:', salaryPreview.bonus_applicable, 'current bonusRate:', bonusRate);
        bonusRate = await fetchBonus();
        console.log('After fetchBonus, bonusRate:', bonusRate);
      }
      if (salaryPreview.incentive_applicable && incentiveAmount === 0) {
        incentiveAmount = await fetchIncentive();
      }
      
      if (useManual) {
        // Use manual DA value if provided (and no override)
        if (overrideDA === null && manualValues.da) {
          daAmount = parseFloat(manualValues.da) || daAmount;
        }
      }
      
      let basic_plus_da, hra, conveyance, call_allowance, pf_employee, esic_employee, pf_employer, esic_employer;
      
      // PF ceiling is 15000 - if Basic+DA > 15000, PF = 1800 (flat), else 12% of Basic+DA
      const PF_CEILING = 15000;
      const PF_FLAT_AMOUNT = 1800; // 12% of 15000
      
      // Helper function to get value - properly handles 0, null, undefined, empty string
      const getManualValue = (manualVal, defaultVal) => {
        if (manualVal !== undefined && manualVal !== null && manualVal !== '') {
          const parsed = parseFloat(manualVal);
          return !isNaN(parsed) ? Math.round(parsed) : Math.round(defaultVal);
        }
        return Math.round(defaultVal);
      };
      
      if (useManual) {
        // Use manual values if provided, otherwise fall back to calculated
        // Basic = 60% of Gross - DA (so Basic + DA = 60% of Gross)
        const calculatedBasic = Math.round(Math.max(0, gross * 0.60 - daAmount));
        basic_plus_da = getManualValue(manualValues.basic_plus_da, calculatedBasic);
        // Get manual DA value if provided, otherwise use fetched DA
        const manualDa = (manualValues.da !== undefined && manualValues.da !== '' && manualValues.da !== null)
          ? Math.round(parseFloat(manualValues.da) || 0)
          : daAmount;
        hra = getManualValue(manualValues.hra, gross * 0.20);
        conveyance = getManualValue(manualValues.conveyance, gross * 0.10);
        call_allowance = getManualValue(manualValues.call_allowance, gross * 0.10);
        
        // PF calculation - always based on ₹15,000 ceiling
        // Employee PF = 12% of ₹15,000 = ₹1,800
        // Employer PF = 13% of ₹15,000 = ₹1,950
        const defaultPfEmployee = salaryPreview.pf_applicable 
          ? Math.round(PF_CEILING * 0.12) // ₹1,800
          : 0;
        const defaultPfEmployer = salaryPreview.pf_applicable 
          ? Math.round(PF_CEILING * 0.13) // ₹1,950
          : 0;
        
        pf_employee = getManualValue(manualValues.pf_employee, defaultPfEmployee);
        esic_employee = getManualValue(manualValues.esic_employee, salaryPreview.esic_applicable ? gross * 0.0075 : 0);
        pf_employer = getManualValue(manualValues.pf_employer, defaultPfEmployer);
        esic_employer = getManualValue(manualValues.esic_employer, salaryPreview.esic_applicable ? gross * 0.0325 : 0);
      } else {
        // Calculate using frozen PAYROLL_CONFIG rules
        // Basic = 60% of Gross - DA (so Basic + DA = 60% of Gross)
        // HRA = 20%, Conveyance = 10%, Call Allowance = 10%
        // Total = 60% + 20% + 10% + 10% = 100% = Gross
        basic_plus_da = Math.round(Math.max(0, gross * 0.60 - daAmount));
        
        hra = Math.round(gross * 0.20);
        conveyance = Math.round(gross * 0.10);
        call_allowance = Math.round(gross * 0.10);
        
        // PF calculation - always based on ₹15,000 ceiling
        // Employee PF = 12% of ₹15,000 = ₹1,800
        // Employer PF = 13% of ₹15,000 = ₹1,950
        pf_employee = salaryPreview.pf_applicable 
          ? Math.round(PF_CEILING * 0.12) // ₹1,800
          : 0;
        esic_employee = salaryPreview.esic_applicable ? Math.round(gross * 0.0075) : 0;
        pf_employer = salaryPreview.pf_applicable 
          ? Math.round(PF_CEILING * 0.13) // ₹1,950
          : 0;
        esic_employer = salaryPreview.esic_applicable ? Math.round(gross * 0.0325) : 0;
      }
      
      // PT, MLWF and Retention (from payroll schedules or manual input)
      // PT calculated based on gender, salary and month rules
      const ptExempt = isPTExempt(gross);
      const ptAmount = salaryPreview.pt_applicable ? calculatePTAmount(gross) : 0;
      const pt = (salaryPreview.pt_applicable && !ptExempt) ? Math.round(ptAmount) : 0;
      const mlwf = salaryPreview.mlwf_applicable ? Math.round(mlwfAmount) : 0;
      // Use manual retention value if provided, otherwise use fetched/current value
      const manualRetention = (manualValues.retention !== undefined && manualValues.retention !== '' && manualValues.retention !== null) 
        ? parseFloat(manualValues.retention) 
        : retentionAmount;
      const retention = salaryPreview.retention_applicable ? Math.round(manualRetention) : 0;
      
      // Insurance (employer cost)
      const manualInsurance = (manualValues.insurance !== undefined && manualValues.insurance !== '' && manualValues.insurance !== null)
        ? parseFloat(manualValues.insurance)
        : currentInsurance;
      const insurance = salaryPreview.insurance_applicable ? Math.round(manualInsurance) : 0;
      
      // Bonus and Incentive (from payroll schedules - these are earnings)
      // Bonus is calculated as percentage of Basic + DA
      // Calculate bonus amount as percentage of Basic + DA
      const basicPlusDaTotal = basic_plus_da + daAmount;
      const bonus = salaryPreview.bonus_applicable ? Math.round(basicPlusDaTotal * bonusRate / 100) : 0;
      console.log('Bonus calculation: basicPlusDaTotal:', basicPlusDaTotal, 'bonusRate:', bonusRate, 'bonus amount:', bonus);
      const incentive = salaryPreview.incentive_applicable ? Math.round(incentiveAmount) : 0;
      
      // Total earnings = Basic + DA + HRA + Conveyance + Call Allowance = Gross (when no bonus/incentive/other)
      // Basic + DA = 60% of Gross, HRA = 20%, Conv = 10%, Call = 10% => Total = 100% = Gross
      // Bonus is NOT included in earnings - it goes directly to CTC
      const total_earnings = Math.round(basic_plus_da + daAmount + hra + conveyance + call_allowance + otherAllowances + incentive);
      const total_deductions = Math.round(pf_employee + esic_employee + pt + mlwf + retention);
      const net_pay = Math.round(total_earnings - total_deductions);
      // Use fetched mlwfEmployerAmount (from payroll schedules)
      const mlwf_employer = salaryPreview.mlwf_applicable ? Math.round(mlwfEmployerAmount || currentMLWFEmployer) : 0;
      // Employer cost = Total Earnings + Employer PF + Employer ESIC + Employer MLWF + Bonus + Insurance (PA/Mediclaim)
      const employer_cost = Math.round(total_earnings + pf_employer + esic_employer + mlwf_employer + bonus + insurance);
      
      // Combined Basic + DA for display
      const basic_da_total = Math.round(basic_plus_da + daAmount);
      
      setPreviewBreakdown({
        gross: gross, // Keep original gross for percentage calculations
        basic_plus_da,
        da: daAmount,
        basic_da_total, // Combined Basic + DA
        hra,
        conveyance,
        call_allowance,
        bonus,
        incentive,
        other_allowances: otherAllowances,
        total_earnings,
        pf_employee,
        esic_employee,
        pt,
        mlwf,
        retention,
        total_deductions,
        net_pay,
        pf_employer,
        esic_employer,
        mlwf_employer,
        insurance,
        employer_cost
      });
    } catch (err) {
      console.error('Error calculating salary preview:', err);
      setPreviewError('Failed to calculate salary preview: ' + err.message);
      setPreviewBreakdown(null);
    }
  };

  // Save Salary Profile to employee_salary_profile table
  const [salaryProfileSaving, setSalaryProfileSaving] = useState(false);
  const [salaryProfileSuccess, setSalaryProfileSuccess] = useState('');
  const [savedSalaryProfiles, setSavedSalaryProfiles] = useState([]);
  const [editingSalaryProfileId, setEditingSalaryProfileId] = useState(null); // ID of profile being edited
  const [loadingSavedProfiles, setLoadingSavedProfiles] = useState(false);
  const [deletingSalaryProfile, setDeletingSalaryProfile] = useState(false);
  
  // Fetch saved salary profiles for an employee and load into form if exists
  const fetchSavedSalaryProfiles = async (employeeId) => {
    if (!employeeId) return;
    setLoadingSavedProfiles(true);
    try {
      const res = await fetch(`/api/payroll/salary-profile?employee_id=${employeeId}`);
      const data = await res.json();
      if (data.success && data.data) {
        setSavedSalaryProfiles(data.data);
        
        // If there's a saved profile, load it into the form
        if (data.data.length > 0) {
          const savedProfile = data.data[0]; // Most recent profile
          
          // Parse custom data from lumpsum_description if salary_type is custom
          let customData = { ctc: null, monthly_hours: 160, custom_components: [] };
          if (savedProfile.salary_type === 'custom' && savedProfile.lumpsum_description) {
            try {
              customData = JSON.parse(savedProfile.lumpsum_description);
            } catch (e) {
              console.error('Failed to parse custom salary data:', e);
            }
          }
          
          // Load gross and other settings
          setSalaryPreview({
            gross: savedProfile.gross_salary || savedProfile.gross || '',
            other_allowances: savedProfile.other_allowances || '',
            pf_applicable: savedProfile.pf_applicable === 1 || savedProfile.pf_applicable === true,
            esic_applicable: savedProfile.esic_applicable === 1 || savedProfile.esic_applicable === true,
            pt_applicable: savedProfile.pt_applicable === 1 || savedProfile.pt_applicable === true,
            mlwf_applicable: savedProfile.mlwf_applicable === 1 || savedProfile.mlwf_applicable === true,
            retention_applicable: savedProfile.retention_applicable === 1 || savedProfile.retention_applicable === true,
            bonus_applicable: savedProfile.bonus_applicable === 1 || savedProfile.bonus_applicable === true,
            incentive_applicable: savedProfile.incentive_applicable === 1 || savedProfile.incentive_applicable === true,
            insurance_applicable: savedProfile.insurance_applicable === 1 || savedProfile.insurance_applicable === true,
            // Salary type fields
            salary_type: savedProfile.salary_type || 'monthly',
            hourly_rate: savedProfile.hourly_rate || '',
            std_hours_per_day: savedProfile.std_hours_per_day || 8,
            std_in_time: savedProfile.std_in_time ? savedProfile.std_in_time.substring(0, 5) : '09:00',
            std_out_time: savedProfile.std_out_time ? savedProfile.std_out_time.substring(0, 5) : '17:30',
            ot_multiplier: savedProfile.ot_multiplier || 1.5,
            daily_rate: savedProfile.daily_rate || '',
            std_working_days: savedProfile.std_working_days || 26,
            contract_amount: savedProfile.contract_amount || '',
            contract_duration: savedProfile.contract_duration || 'monthly',
            contract_end_date: savedProfile.contract_end_date || '',
            lumpsum_amount: savedProfile.lumpsum_amount || '',
            lumpsum_description: savedProfile.salary_type === 'custom' ? '' : (savedProfile.lumpsum_description || ''),
            effective_from: savedProfile.effective_from ? savedProfile.effective_from.split('T')[0] : new Date().toISOString().split('T')[0],
            effective_to: savedProfile.effective_to ? savedProfile.effective_to.split('T')[0] : '',
            custom_components: customData.custom_components || [],
            // Custom salary type fields - load from saved data
            custom_ctc: customData.ctc || savedProfile.employer_cost || '',
            custom_hourly_rate: savedProfile.hourly_rate || '',
            custom_monthly_hours: customData.monthly_hours || '160',
            custom_basic: savedProfile.basic || '',
            custom_da: savedProfile.da || '',
            custom_hra: savedProfile.hra || '',
            custom_conveyance: savedProfile.conveyance || '',
            custom_call_allowance: savedProfile.call_allowance || '',
            custom_incentive: savedProfile.incentive || '',
            custom_other_allowances: savedProfile.other_allowances || '',
            custom_pf_employee: savedProfile.pf_employee || '',
            custom_esic_employee: savedProfile.esic_employee || '',
            custom_pt: savedProfile.pt || '',
            custom_mlwf: savedProfile.mlwf || '',
            custom_retention: savedProfile.retention || '',
            custom_pf_employer: savedProfile.pf_employer || '',
            custom_esic_employer: savedProfile.esic_employer || '',
            custom_mlwf_employer: savedProfile.mlwf_employer || '',
            custom_bonus: savedProfile.bonus || '',
            custom_insurance: savedProfile.insurance || ''
          });
          
          // Load the saved breakdown values directly (frozen/fixed)
          setPreviewBreakdown({
            gross: savedProfile.gross_salary || savedProfile.gross || 0,
            basic_plus_da: parseFloat(savedProfile.basic_plus_da) || 0,
            da: parseFloat(savedProfile.da) || 0,
            basic_da_total: (parseFloat(savedProfile.basic_plus_da) || 0) + (parseFloat(savedProfile.da) || 0),
            hra: parseFloat(savedProfile.hra) || 0,
            conveyance: parseFloat(savedProfile.conveyance) || 0,
            call_allowance: parseFloat(savedProfile.call_allowance) || 0,
            bonus: parseFloat(savedProfile.bonus) || 0,
            incentive: parseFloat(savedProfile.incentive) || 0,
            other_allowances: parseFloat(savedProfile.other_allowances) || 0,
            pf_employee: parseFloat(savedProfile.pf_employee) || 0,
            esic_employee: parseFloat(savedProfile.esic_employee) || 0,
            pf_employer: parseFloat(savedProfile.pf_employer) || 0,
            esic_employer: parseFloat(savedProfile.esic_employer) || 0,
            pt: parseFloat(savedProfile.pt) || 0,
            mlwf: parseFloat(savedProfile.mlwf) || 0,
            mlwf_employer: parseFloat(savedProfile.mlwf_employer) || 0,
            retention: parseFloat(savedProfile.retention) || 0,
            insurance: parseFloat(savedProfile.insurance) || 0,
            total_earnings: parseFloat(savedProfile.total_earnings) || 0,
            total_deductions: parseFloat(savedProfile.total_deductions) || 0,
            net_pay: parseFloat(savedProfile.net_pay) || 0,
            employer_cost: parseFloat(savedProfile.employer_cost) || 0
          });
          
          // Load saved values into manualValues for editing
          setManualValues({
            basic_plus_da: savedProfile.basic_plus_da?.toString() || '',
            da: savedProfile.da?.toString() || '',
            hra: savedProfile.hra?.toString() || '',
            conveyance: savedProfile.conveyance?.toString() || '',
            call_allowance: savedProfile.call_allowance?.toString() || '',
            bonus: savedProfile.bonus?.toString() || '',
            incentive: savedProfile.incentive?.toString() || '',
            other_allowances: savedProfile.other_allowances?.toString() || '',
            retention: savedProfile.retention?.toString() || '',
            insurance: savedProfile.insurance?.toString() || '',
            pf_employee: savedProfile.pf_employee?.toString() || '',
            esic_employee: savedProfile.esic_employee?.toString() || '',
            pf_employer: savedProfile.pf_employer?.toString() || '',
            esic_employer: savedProfile.esic_employer?.toString() || ''
          });
          
          // Set DA value
          if (savedProfile.da) {
            setCurrentDA(parseFloat(savedProfile.da));
          }
          
          // Set Insurance value
          if (savedProfile.insurance) {
            setCurrentInsurance(parseFloat(savedProfile.insurance));
          }
        }
      }
    } catch (err) {
      console.error('Error fetching saved salary profiles:', err);
    } finally {
      setLoadingSavedProfiles(false);
    }
  };
  
  // Delete salary profile
  const handleDeleteSalaryProfile = async (profileId) => {
    if (!profileId) return;
    
    if (!confirm('Are you sure you want to delete this salary profile? This action cannot be undone.')) {
      return;
    }
    
    setDeletingSalaryProfile(true);
    try {
      const res = await fetch(`/api/payroll/salary-profile?id=${profileId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete salary profile');
      }
      
      // Refresh the list
      await fetchSavedSalaryProfiles(selectedEmployee.id);
      // If we were editing this profile, reset the form
      if (editingSalaryProfileId === profileId) {
        handleResetSalaryForm();
      }
      setSalaryProfileSuccess('Salary profile deleted successfully');
      setTimeout(() => setSalaryProfileSuccess(''), 3000);
    } catch (err) {
      console.error('Error deleting salary profile:', err);
      setPreviewError('Failed to delete: ' + err.message);
    } finally {
      setDeletingSalaryProfile(false);
    }
  };
  
  // Function to edit an existing salary profile - load it into the form
  const handleEditSalaryProfile = (profile) => {
    setEditingSalaryProfileId(profile.id);
    
    // Parse custom data from lumpsum_description if salary_type is custom
    let customData = { ctc: null, monthly_hours: 160, custom_components: [] };
    if (profile.salary_type === 'custom' && profile.lumpsum_description) {
      try {
        customData = JSON.parse(profile.lumpsum_description);
      } catch (e) {
        console.error('Failed to parse custom salary data:', e);
      }
    }
    
    setSalaryPreview({
      salary_type: profile.salary_type || 'monthly',
      gross: profile.gross_salary || profile.gross || '',
      hourly_rate: profile.hourly_rate || '',
      daily_rate: profile.daily_rate || '',
      contract_amount: profile.contract_amount || '',
      lumpsum_amount: profile.lumpsum_amount || '',
      lumpsum_description: profile.salary_type === 'custom' ? '' : (profile.lumpsum_description || ''),
      contract_duration: profile.contract_duration || 'monthly',
      contract_end_date: profile.contract_end_date ? profile.contract_end_date.split('T')[0] : '',
      std_hours_per_day: profile.std_hours_per_day || 8,
      std_in_time: profile.std_in_time ? profile.std_in_time.substring(0, 5) : '09:00',
      std_out_time: profile.std_out_time ? profile.std_out_time.substring(0, 5) : '17:30',
      std_working_days: profile.std_working_days || 26,
      ot_multiplier: profile.ot_multiplier || 1.5,
      other_allowances: profile.other_allowances || '',
      effective_from: profile.effective_from ? profile.effective_from.split('T')[0] : new Date().toISOString().split('T')[0],
      effective_to: profile.effective_to ? profile.effective_to.split('T')[0] : '',
      pf_applicable: !!profile.pf_applicable,
      esic_applicable: !!profile.esic_applicable,
      pt_applicable: !!profile.pt_applicable,
      mlwf_applicable: !!profile.mlwf_applicable,
      retention_applicable: !!profile.retention_applicable,
      bonus_applicable: !!profile.bonus_applicable,
      incentive_applicable: !!profile.incentive_applicable,
      insurance_applicable: !!profile.insurance_applicable,
      custom_components: customData.custom_components || [],
      // Custom salary type fields - load from saved data
      custom_ctc: customData.ctc || profile.employer_cost || '',
      custom_hourly_rate: profile.hourly_rate || '',
      custom_monthly_hours: customData.monthly_hours || '160',
      custom_basic: profile.basic || '',
      custom_da: profile.da || '',
      custom_hra: profile.hra || '',
      custom_conveyance: profile.conveyance || '',
      custom_call_allowance: profile.call_allowance || '',
      custom_incentive: profile.incentive || '',
      custom_other_allowances: profile.other_allowances || '',
      custom_pf_employee: profile.pf_employee || '',
      custom_esic_employee: profile.esic_employee || '',
      custom_pt: profile.pt || '',
      custom_mlwf: profile.mlwf || '',
      custom_retention: profile.retention || '',
      custom_pf_employer: profile.pf_employer || '',
      custom_esic_employer: profile.esic_employer || '',
      custom_mlwf_employer: profile.mlwf_employer || '',
      custom_bonus: profile.bonus || '',
      custom_insurance: profile.insurance || ''
    });
    // If monthly, recalculate preview with the loaded gross
    if (profile.salary_type === 'monthly' || !profile.salary_type) {
      calculateSalaryPreview(profile.gross_salary || profile.gross, profile.other_allowances || 0);
    }
    // Set manual values if available
    setManualValues({
      basic_plus_da: profile.basic_plus_da || '',
      da: profile.da || '',
      hra: profile.hra || '',
      conveyance: profile.conveyance || '',
      call_allowance: profile.call_allowance || '',
      pf_employee: profile.pf_employee || '',
      esic_employee: profile.esic_employee || '',
      pf_employer: profile.pf_employer || '',
      esic_employer: profile.esic_employer || '',
      retention: profile.retention || '',
      insurance: profile.insurance || ''
    });
    setCurrentRetention(parseFloat(profile.retention) || 0);
    setCurrentInsurance(parseFloat(profile.insurance) || 0);
  };
  
  // Function to reset salary form for adding a new profile
  const handleResetSalaryForm = () => {
    setEditingSalaryProfileId(null);
    setSalaryPreview({
      salary_type: 'monthly',
      gross: '',
      hourly_rate: '',
      daily_rate: '',
      contract_amount: '',
      lumpsum_amount: '',
      lumpsum_description: '',
      contract_duration: 'monthly',
      contract_end_date: '',
      std_hours_per_day: 8,
      std_in_time: '09:00',
      std_out_time: '17:30',
      std_working_days: 26,
      ot_multiplier: 1.5,
      other_allowances: '',
      effective_from: new Date().toISOString().split('T')[0],
      effective_to: '',
      pf_applicable: true,
      esic_applicable: false,
      pt_applicable: false,
      mlwf_applicable: false,
      retention_applicable: false,
      bonus_applicable: false,
      incentive_applicable: false,
      insurance_applicable: false,
      custom_components: [],
      // Custom salary type fields
      custom_ctc: '',
      custom_hourly_rate: '',
      custom_monthly_hours: '160',
      custom_basic: '',
      custom_da: '',
      custom_hra: '',
      custom_conveyance: '',
      custom_call_allowance: '',
      custom_incentive: '',
      custom_other_allowances: '',
      custom_pf_employee: '',
      custom_esic_employee: '',
      custom_pt: '',
      custom_mlwf: '',
      custom_retention: '',
      custom_pf_employer: '',
      custom_esic_employer: '',
      custom_mlwf_employer: '',
      custom_bonus: '',
      custom_insurance: ''
    });
    setManualValues({
      basic_plus_da: '',
      da: '',
      hra: '',
      conveyance: '',
      call_allowance: '',
      pf_employee: '',
      esic_employee: '',
      pf_employer: '',
      esic_employer: '',
      retention: '',
      insurance: ''
    });
    setPreviewBreakdown(null);
    setCurrentRetention(0);
    setCurrentInsurance(0);
    setPreviewError('');
  };
  
  const handleSaveSalaryProfile = async () => {
    if (!selectedEmployee?.id) {
      setPreviewError('No employee selected');
      return;
    }
    
    // Validate based on salary type
    const salaryType = salaryPreview.salary_type || 'monthly';
    
    if (salaryType === 'monthly') {
      if (!salaryPreview.gross) {
        setPreviewError('Please enter gross salary');
        return;
      }
      if (!previewBreakdown) {
        setPreviewError('Please enter a gross salary first to calculate breakdown');
        return;
      }
    } else if (salaryType === 'hourly' && !salaryPreview.hourly_rate) {
      setPreviewError('Please enter hourly rate');
      return;
    } else if (salaryType === 'daily' && !salaryPreview.daily_rate) {
      setPreviewError('Please enter daily rate');
      return;
    } else if (salaryType === 'contract' && !salaryPreview.contract_amount) {
      setPreviewError('Please enter contract amount');
      return;
    } else if (salaryType === 'lumpsum' && !salaryPreview.lumpsum_amount) {
      setPreviewError('Please enter lumpsum amount');
      return;
    } else if (salaryType === 'custom' && !salaryPreview.custom_ctc) {
      setPreviewError('Please enter CTC amount');
      return;
    }
    
    setSalaryProfileSaving(true);
    setPreviewError('');
    setSalaryProfileSuccess('');
    
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const currentYear = new Date().getFullYear();
      
      // Build payload based on salary type
      // Include id if we're editing an existing profile
      let payload = {
        ...(editingSalaryProfileId ? { id: editingSalaryProfileId } : {}),
        employee_id: selectedEmployee.id,
        salary_type: salaryType,
        effective_from: salaryPreview.effective_from || currentDate,
        effective_to: salaryPreview.effective_to || null,
        da_year: currentYear,
        is_manual_override: false,
        std_in_time: salaryPreview.std_in_time || '09:00',
        std_out_time: salaryPreview.std_out_time || '17:30'
      };
      
      if (salaryType === 'monthly') {
        payload = {
          ...payload,
          gross_salary: parseFloat(salaryPreview.gross),
          other_allowances: parseFloat(salaryPreview.other_allowances) || 0,
          pf_applicable: salaryPreview.pf_applicable,
          esic_applicable: salaryPreview.esic_applicable,
          pt_applicable: salaryPreview.pt_applicable,
          mlwf_applicable: salaryPreview.mlwf_applicable,
          retention_applicable: salaryPreview.retention_applicable,
          bonus_applicable: salaryPreview.bonus_applicable,
          incentive_applicable: salaryPreview.incentive_applicable,
          insurance_applicable: salaryPreview.insurance_applicable,
          // Include breakdown values (manual or calculated)
          basic: previewBreakdown.basic_plus_da, // Basic (without DA)
          basic_plus_da: previewBreakdown.basic_plus_da,
          da: previewBreakdown.da,
          basic_da_total: previewBreakdown.basic_da_total, // Combined Basic + DA
          hra: previewBreakdown.hra,
          conveyance: previewBreakdown.conveyance,
          call_allowance: previewBreakdown.call_allowance,
          bonus: previewBreakdown.bonus || 0,
          incentive: previewBreakdown.incentive || 0,
          pf_employee: previewBreakdown.pf_employee,
          esic_employee: previewBreakdown.esic_employee,
          pt: previewBreakdown.pt || 0,
          mlwf: previewBreakdown.mlwf || 0,
          mlwf_employer: previewBreakdown.mlwf_employer || 0,
          retention: previewBreakdown.retention || 0,
          insurance: previewBreakdown.insurance || 0,
          pf_employer: previewBreakdown.pf_employer,
          esic_employer: previewBreakdown.esic_employer,
          total_earnings: previewBreakdown.total_earnings,
          total_deductions: previewBreakdown.total_deductions,
          net_pay: previewBreakdown.net_pay,
          employer_cost: previewBreakdown.employer_cost || 0,
        };
        console.log('Monthly salary payload - employer_cost (CTC):', previewBreakdown.employer_cost);
      } else if (salaryType === 'hourly') {
        const hourlyRate = parseFloat(salaryPreview.hourly_rate) || 0;
        const stdHours = parseFloat(salaryPreview.std_hours_per_day) || 8;
        const estimatedMonthly = hourlyRate * stdHours * 26;
        payload = {
          ...payload,
          hourly_rate: hourlyRate,
          std_hours_per_day: stdHours,
          ot_multiplier: parseFloat(salaryPreview.ot_multiplier) || 1.5,
          gross_salary: estimatedMonthly,
          net_pay: estimatedMonthly,
          employer_cost: estimatedMonthly,
        };
      } else if (salaryType === 'daily') {
        const dailyRate = parseFloat(salaryPreview.daily_rate) || 0;
        const stdDays = parseFloat(salaryPreview.std_working_days) || 26;
        const estimatedMonthly = dailyRate * stdDays;
        payload = {
          ...payload,
          daily_rate: dailyRate,
          std_working_days: stdDays,
          gross_salary: estimatedMonthly,
          net_pay: estimatedMonthly,
          employer_cost: estimatedMonthly,
        };
      } else if (salaryType === 'contract') {
        const contractAmount = parseFloat(salaryPreview.contract_amount) || 0;
        payload = {
          ...payload,
          contract_amount: contractAmount,
          contract_duration: salaryPreview.contract_duration || 'monthly',
          contract_end_date: salaryPreview.contract_end_date || null,
          gross_salary: contractAmount,
          net_pay: contractAmount,
          employer_cost: contractAmount,
        };
      } else if (salaryType === 'lumpsum') {
        const lumpsumAmount = parseFloat(salaryPreview.lumpsum_amount) || 0;
        payload = {
          ...payload,
          lumpsum_amount: lumpsumAmount,
          lumpsum_description: salaryPreview.lumpsum_description || '',
          gross_salary: lumpsumAmount,
          net_pay: lumpsumAmount,
          employer_cost: lumpsumAmount,
        };
      } else if (salaryType === 'custom') {
        // CTC-based calculation
        // CTC = Gross + Employer Contributions
        // So Gross = CTC - Employer Contributions
        const ctc = parseFloat(salaryPreview.custom_ctc) || 0;
        const employerContributions = 
          (parseFloat(salaryPreview.custom_pf_employer) || 0) +
          (parseFloat(salaryPreview.custom_esic_employer) || 0) +
          (parseFloat(salaryPreview.custom_mlwf_employer) || 0) +
          (parseFloat(salaryPreview.custom_bonus) || 0) +
          (parseFloat(salaryPreview.custom_insurance) || 0) +
          ((salaryPreview.custom_components || []).filter(c => c.type === 'employer').reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0));
        
        const grossSalary = ctc - employerContributions;
        
        // Calculate totals
        const totalEarnings = 
          (parseFloat(salaryPreview.custom_basic) || 0) +
          (parseFloat(salaryPreview.custom_da) || 0) +
          (parseFloat(salaryPreview.custom_hra) || 0) +
          (parseFloat(salaryPreview.custom_conveyance) || 0) +
          (parseFloat(salaryPreview.custom_call_allowance) || 0) +
          (parseFloat(salaryPreview.custom_incentive) || 0) +
          (parseFloat(salaryPreview.custom_other_allowances) || 0);
          
        const totalDeductions = 
          (parseFloat(salaryPreview.custom_pf_employee) || 0) +
          (parseFloat(salaryPreview.custom_esic_employee) || 0) +
          (parseFloat(salaryPreview.custom_pt) || 0) +
          (parseFloat(salaryPreview.custom_mlwf) || 0) +
          (parseFloat(salaryPreview.custom_retention) || 0);
          
        const netPay = totalEarnings - totalDeductions;
        
        payload = {
          ...payload,
          salary_type: 'custom',
          // CTC and hourly rate
          employer_cost: ctc,
          hourly_rate: parseFloat(salaryPreview.custom_hourly_rate) || 0,
          std_hours_per_day: (parseFloat(salaryPreview.custom_monthly_hours) || 160) / 20, // Convert monthly hours to daily
          // Gross salary (CTC - Employer Contributions)
          gross_salary: grossSalary,
          // Earnings breakdown
          basic: parseFloat(salaryPreview.custom_basic) || 0,
          basic_plus_da: (parseFloat(salaryPreview.custom_basic) || 0) + (parseFloat(salaryPreview.custom_da) || 0),
          da: parseFloat(salaryPreview.custom_da) || 0,
          hra: parseFloat(salaryPreview.custom_hra) || 0,
          conveyance: parseFloat(salaryPreview.custom_conveyance) || 0,
          call_allowance: parseFloat(salaryPreview.custom_call_allowance) || 0,
          incentive: parseFloat(salaryPreview.custom_incentive) || 0,
          other_allowances: parseFloat(salaryPreview.custom_other_allowances) || 0,
          // Employee deductions
          pf_employee: parseFloat(salaryPreview.custom_pf_employee) || 0,
          esic_employee: parseFloat(salaryPreview.custom_esic_employee) || 0,
          pt: parseFloat(salaryPreview.custom_pt) || 0,
          mlwf: parseFloat(salaryPreview.custom_mlwf) || 0,
          retention: parseFloat(salaryPreview.custom_retention) || 0,
          // Employer contributions
          pf_employer: parseFloat(salaryPreview.custom_pf_employer) || 0,
          esic_employer: parseFloat(salaryPreview.custom_esic_employer) || 0,
          mlwf_employer: parseFloat(salaryPreview.custom_mlwf_employer) || 0,
          bonus: parseFloat(salaryPreview.custom_bonus) || 0,
          insurance: parseFloat(salaryPreview.custom_insurance) || 0,
          // Totals
          total_earnings: totalEarnings,
          total_deductions: totalDeductions,
          net_pay: netPay,
          // Store custom components and CTC in description
          lumpsum_description: JSON.stringify({
            ctc: ctc,
            monthly_hours: parseFloat(salaryPreview.custom_monthly_hours) || 160,
            custom_components: salaryPreview.custom_components || []
          }),
        };
      }
      
      console.log('Sending salary profile:', payload);
      
      const res = await fetch('/api/payroll/salary-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      console.log('Response:', data);
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save salary profile');
      }
      
      const isUpdate = !!editingSalaryProfileId;
      setSalaryProfileSuccess(isUpdate ? '✓ Salary profile updated!' : '✓ New salary profile created!');
      
      // Refresh saved profiles to show the new/updated record
      await fetchSavedSalaryProfiles(selectedEmployee.id);
      
      // Reset form after successful save
      handleResetSalaryForm();
      
      // Auto clear success message after 4 seconds
      setTimeout(() => setSalaryProfileSuccess(''), 4000);
      
    } catch (err) {
      console.error('Error saving salary profile:', err);
      setPreviewError('Failed to save: ' + err.message);
    } finally {
      setSalaryProfileSaving(false);
    }
  };

  // Save salary structure

  // Add component to salary structure

  // Remove component from salary structure

  // Update component

  // Reset salary form

  // State for editing salary structure


  // Edit salary structure - load data into form

  // Update existing salary structure

  // Delete salary structure

  // Cancel editing

  // Calculate breakdown from Gross Salary (reverse calculation)

  // Auto-calculate Indian Payroll Salary Breakdown - Complete Breakdown
  // Based on: Gross = Basic (60%) + DA (Fixed) + HRA (20%) + Conveyance

  // Handle salary field changes with auto-calculation

  // Handle manual salary value changes

  // Handle percentage changes

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
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
        ...(selectedStatus && { status: selectedStatus }),
        ...(selectedWorkplace && { workplace: selectedWorkplace }),
        ...(selectedEmploymentStatus && { employment_status: selectedEmploymentStatus })
      });
      // Add a client-side timeout to avoid hanging forever on network issues
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12000);
      // Use optimized /api/employees/list endpoint for better TTFB
      const response = await fetch(`/api/employees/list?${params}`, { signal: controller.signal });
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
        setWorkplaces(data.workplaces || []);
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
  }, [currentPage, searchTerm, selectedDepartment, selectedStatus, selectedWorkplace, selectedEmploymentStatus]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

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
    } catch { return 'ATS001'; }
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

  // Load users from user master for username dropdown
  useEffect(() => {
    const loadUsers = async () => {
      try {
        const res = await fetch('/api/users?limit=1000');
        const json = await res.json();
        if (res.ok && json?.success) {
          setUsers(json.data || []);
        }
      } catch {}
    };
    loadUsers();
  }, []);

  // Load companies for deputation dropdown
  useEffect(() => {
    const loadCompanies = async () => {
      try {
        const res = await fetch('/api/companies');
        const json = await res.json();
        if (res.ok && json?.success) {
          setCompanies(json.data || []);
        }
      } catch {}
    };
    loadCompanies();
  }, []);

  // Fetch DA on component mount so it's available for all profiles
  useEffect(() => {
    fetchCurrentDA();
  }, []);

  // Clear success messages automatically after a short delay so setter is plainly used
  useEffect(() => {
    if (!successMessage) return undefined;
    const t = setTimeout(() => setSuccessMessage(''), 3000);
    return () => clearTimeout(t);
  }, [successMessage]);

  // Stable helper: update linked user's role if a user account exists for this employee
  const applySystemRoleToLinkedUser = useCallback(async (employeeDbId, roleId) => {
    try {
      if (!employeeDbId || !roleId) return;
      const response = await fetch('/api/employees/available-for-users?include_with_users=true');
      const json = await response.json();
      if (!response.ok || !json?.success) return;
      const record = (json.data || []).find(r => String(r.id) === String(employeeDbId));
      const userId = record?.user_id;
      if (!userId) return;
      await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, role_id: Number(roleId) })
      });
    } catch {}
  }, []);

  // No-op reference to ensure linter recognizes the helper as used (it is invoked conditionally elsewhere)
  useEffect(() => {
    if (typeof applySystemRoleToLinkedUser === 'function') {
      void applySystemRoleToLinkedUser;
    }
  }, [applySystemRoleToLinkedUser]);

  // Handle profile photo upload to /api/uploads
  const handleProfilePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhotoUploading(true);   // Client-side checks: ensure it's an image and within size limits (15 MB)
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
      const uploadRes = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name || 'upload.png', b64: base64String })
      });
      const data = await uploadRes.json();
      if (!uploadRes.ok || !data?.success) {
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

  const formatDate = (date) => {
    return date ? new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }) : '-';
  };

  return (
    <AccessGuard resource="employees" permission="read" showNavbar={false}>
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
            {successMessage && (
              <div className="mt-2 text-sm text-green-600">{successMessage}</div>
            )}
          </div>
          <div className="flex-shrink-0 flex items-center gap-3">
            <Link
              href="/employees/attendance"
              className="inline-flex items-center space-x-2 bg-white border-2 border-purple-600 text-purple-600 hover:bg-purple-50 px-4 py-2.5 rounded-xl shadow-md hover:shadow-lg transition-all duration-300"
            >
              <CalendarDaysIcon className="h-5 w-5" />
              <span>Attendance</span>
            </Link>
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



        {/* Content */}
        <div className="pb-8">
          {activeTab === 'list' && (
            <>
              {/* Filters */}
              <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-6 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
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



                  {/* Employment Status Filter (Resigned/Employed) */}
                  <select
                    value={selectedEmploymentStatus}
                    onChange={(e) => setSelectedEmploymentStatus(e.target.value)}
                    className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">All Employees</option>
                    <option value="employed">Employed</option>
                    <option value="resigned">Resigned</option>
                  </select>

                  {/* Clear Filters */}
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setSelectedDepartment('');
                      setSelectedStatus('');
                      setSelectedWorkplace('');
                      setSelectedEmploymentStatus('');
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
                              Branch
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
                                <div className="text-sm text-gray-900">{employee.workplace || '-'}</div>
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
                                    onClick={() => openEditForm_safe(employee)}
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
                      <div key={emp.id} onClick={() => openEditForm_safe(emp)} role="button" tabIndex={0} className="px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer focus:outline-none" onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openEditForm_safe(emp); }}>
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

                  <form onSubmit={handleSubmit_safe} className="space-y-8">
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
                            <input type="file" accept="image/*,.heic,.heif,.bmp" onChange={handleProfilePhotoChange_safe} className="block text-sm text-gray-600" />
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
                          <label className="block text-sm font-medium text-gray-700 mb-2">Username (from User Master)</label>
                          <select 
                            value={formData.username || ''} 
                            onChange={(e) => {
                              const selectedUser = users.find(u => u.username === e.target.value);
                              setFormData({ ...formData, username: e.target.value, user_id: selectedUser?.id || null });
                            }} 
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                          >
                            <option value="">Select user</option>
                            {users.filter(u => !u.employee_id || u.employee_id === formData.id).map(u => (
                              <option key={u.id} value={u.username}>{u.username} {u.full_name ? `(${u.full_name})` : ''}</option>
                            ))}
                          </select>
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
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
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
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Branch</label>
                          <select value={formData.workplace || ''} onChange={(e) => setFormData({ ...formData, workplace: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                            <option value="">Select Branch</option>
                            <option value="Malvan">Malvan</option>
                            <option value="Mumbai">Mumbai</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Employee Type</label>
                          <select value={formData.employee_type || ''} onChange={(e) => setFormData({ ...formData, employee_type: e.target.value, deputation_company_id: e.target.value !== 'Deputation' ? '' : formData.deputation_company_id })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                            <option value="">Select</option>
                            <option value="Payroll">Payroll</option>
                            <option value="Contract">Contract</option>
                            <option value="Deputation">Deputation</option>
                          </select>
                        </div>
                        {formData.employee_type === 'Deputation' && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Company Name *</label>
                            <select 
                              value={formData.deputation_company_id || ''} 
                              onChange={(e) => setFormData({ ...formData, deputation_company_id: e.target.value })} 
                              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                              <option value="">Select Company</option>
                              {companies.map((company) => (
                                <option key={company.id} value={company.id}>{company.company_name}</option>
                              ))}
                            </select>
                          </div>
                        )}
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
                      </div>
                    </div>
                    )}

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
                        onClick={() => openEditForm_safe(emp)}
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
                        {/* Autosave Status Indicator */}
                        {autoSaving && (
                          <span className="text-sm text-blue-600 flex items-center gap-1">
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Saving...
                          </span>
                        )}
                        {!autoSaving && lastAutoSave && (
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Saved
                          </span>
                        )}
                        {/* Lock/Unlock Toggle */}
                        <button
                          type="button"
                          onClick={() => setProfileLocked(!profileLocked)}
                          className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-colors ${
                            profileLocked 
                              ? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200' 
                              : 'bg-green-100 text-green-700 border border-green-300 hover:bg-green-200'
                          }`}
                          title={profileLocked ? 'Click to unlock and enable editing' : 'Click to lock and prevent changes'}
                        >
                          {profileLocked ? (
                            <>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                              Locked
                            </>
                          ) : (
                            <>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                              </svg>
                              Unlocked
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('list')}
                          className="px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-50 transition-colors"
                        >
                          Back to List
                        </button>
                      </div>
                    </div>
                    
                    {/* Locked Banner */}
                    {profileLocked && (
                      <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center gap-3">
                        <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <div>
                          <p className="font-semibold text-red-800">Profile is Locked</p>
                          <p className="text-sm text-red-600">All fields are read-only. Click the Locked button to unlock and enable editing.</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-6 lg:p-8">

                  {/* Sub Tabs */}
                  <div className="border-b border-gray-200 mb-6">
                    <nav className="flex flex-wrap gap-4" aria-label="Employee Sections">
                      {[
                        { key: 'personal', label: 'Personal Information' },
                        { key: 'contact', label: 'Contact Information' },
                        { key: 'work', label: 'Work Details' },
                        { key: 'salary', label: 'Salary Structure' },
                        { key: 'academic', label: 'Academic & Experience' },
                        { key: 'govt', label: 'Government IDs' },
                        { key: 'bank', label: 'Bank Details' },
                        { key: 'attendance', label: 'Attendance & Exit' },
                      ].map((t) => (
                        <button
                          key={t.key}
                          onClick={async () => {
                            // Autosave current tab data before switching (except when going to salary tab from another)
                            if (editSubTab !== 'salary' && !profileLocked) {
                              await autoSaveEmployee();
                            }
                            setEditSubTab(t.key);
                            if (t.key === 'salary' && selectedEmployee?.id) {
                              fetchSalaryStructures(selectedEmployee.id);
                              // Fetch saved salary profiles to load existing values
                              await fetchSavedSalaryProfiles(selectedEmployee.id);
                              // The fetchSavedSalaryProfiles function will load saved values if they exist
                            }
                          }}
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

                  <form onSubmit={handleSubmit_safe} className="space-y-8">
                    <fieldset disabled={profileLocked} style={profileLocked ? { pointerEvents: 'none', userSelect: 'none' } : {}} className={profileLocked ? 'opacity-60 cursor-not-allowed' : ''}>
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
                              <input type="file" accept="image/*,.heic,.heif,.bmp" onChange={handleProfilePhotoChange_safe} className="block text-sm text-gray-600" />
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
                            <label className="block text-sm font-medium text-gray-700 mb-2">Username (from User Master)</label>
                            <select 
                              value={formData.username || ''} 
                              onChange={(e) => {
                                const selectedUser = users.find(u => u.username === e.target.value);
                                setFormData({ ...formData, username: e.target.value, user_id: selectedUser?.id || null });
                              }} 
                              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                            >
                              <option value="">Select user</option>
                              {users.filter(u => !u.employee_id || u.employee_id === selectedEmployee?.id).map(u => (
                                <option key={u.id} value={u.username}>{u.username} {u.full_name ? `(${u.full_name})` : ''}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Employee Type</label>
                          <select value={formData.employee_type || ''} onChange={(e) => setFormData({ ...formData, employee_type: e.target.value, deputation_company_id: e.target.value !== 'Deputation' ? '' : formData.deputation_company_id })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                            <option value="">Select</option>
                            <option value="Payroll">Payroll</option>
                            <option value="Contract">Contract</option>
                            <option value="Deputation">Deputation</option>
                          </select>
                        </div>
                        {formData.employee_type === 'Deputation' && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Company Name *</label>
                            <select 
                              value={formData.deputation_company_id || ''} 
                              onChange={(e) => setFormData({ ...formData, deputation_company_id: e.target.value })} 
                              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                              <option value="">Select Company</option>
                              {companies.map((company) => (
                                <option key={company.id} value={company.id}>{company.company_name}</option>
                              ))}
                            </select>
                          </div>
                        )}
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
                              <option value="Male">Male</option>
                              <option value="Female">Female</option>
                              <option value="Other">Other</option>
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
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Branch</label>
                            <select value={formData.workplace || ''} onChange={(e) => setFormData({ ...formData, workplace: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                              <option value="">Select Branch</option>
                              <option value="Malvan">Malvan</option>
                              <option value="Mumbai">Mumbai</option>
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
                        </div>
                      </div>
                    )}

                    {/* Salary Structure */}
                    {editSubTab === 'salary' && (
                      <div className="space-y-6">


                        {/* SECTION 1: Salary Structure History - Shows ALL profiles as a set */}
                        {savedSalaryProfiles.length > 0 && (
                          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-4">
                              <h4 className="text-lg font-semibold text-purple-900 flex items-center gap-2">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Salary Structure History
                                <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-purple-200 text-purple-800 rounded-full">
                                  {savedSalaryProfiles.length} {savedSalaryProfiles.length === 1 ? 'record' : 'records'}
                                </span>
                              </h4>
                            </div>
                            
                            {/* List of all salary profiles */}
                            <div className="space-y-3 max-h-[400px] overflow-y-auto">
                              {savedSalaryProfiles.map((profile, index) => {
                                const isCurrentlyActive = !profile.effective_to || new Date(profile.effective_to) >= new Date();
                                const isBeingEdited = editingSalaryProfileId === profile.id;
                                
                                return (
                                  <div 
                                    key={profile.id} 
                                    className={`bg-white rounded-xl p-4 shadow-sm border-2 transition-all ${
                                      isBeingEdited ? 'border-purple-500 ring-2 ring-purple-200' : 
                                      isCurrentlyActive && index === 0 ? 'border-green-300' : 'border-gray-100'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-4">
                                      {/* Left side - Profile info */}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-2">
                                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${
                                            profile.salary_type === 'monthly' ? 'bg-blue-100 text-blue-700' :
                                            profile.salary_type === 'hourly' ? 'bg-orange-100 text-orange-700' :
                                            profile.salary_type === 'daily' ? 'bg-green-100 text-green-700' :
                                            profile.salary_type === 'contract' ? 'bg-purple-100 text-purple-700' :
                                            profile.salary_type === 'custom' ? 'bg-indigo-100 text-indigo-700' :
                                            profile.salary_type === 'lumpsum' ? 'bg-pink-100 text-pink-700' :
                                            'bg-gray-100 text-gray-700'
                                          }`}>
                                            {profile.salary_type || 'monthly'}
                                          </span>
                                          {isCurrentlyActive && index === 0 && (
                                            <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                                              ✓ Active
                                            </span>
                                          )}
                                          {isBeingEdited && (
                                            <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full animate-pulse">
                                              Editing...
                                            </span>
                                          )}
                                        </div>
                                        
                                        {/* Amount display based on salary type */}
                                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                          {(!profile.salary_type || profile.salary_type === 'monthly') && (
                                            <>
                                              <span className="text-lg font-bold text-gray-900">₹{formatCurrency(profile.gross_salary || 0)}</span>
                                              <span className="text-sm text-gray-500">Gross/month</span>
                                              <span className="text-sm text-green-600 font-medium">• Net: ₹{formatCurrency(profile.net_pay || 0)}</span>
                                              <span className="text-sm text-blue-600 font-medium">• CTC: ₹{formatCurrency(profile.employer_cost || 0)}</span>
                                            </>
                                          )}
                                          {profile.salary_type === 'hourly' && (
                                            <>
                                              <span className="text-lg font-bold text-gray-900">₹{formatCurrency(profile.hourly_rate || 0)}/hr</span>
                                              <span className="text-sm text-gray-500">{profile.std_hours_per_day || 8} hrs/day</span>
                                            </>
                                          )}
                                          {profile.salary_type === 'daily' && (
                                            <>
                                              <span className="text-lg font-bold text-gray-900">₹{formatCurrency(profile.daily_rate || 0)}/day</span>
                                              <span className="text-sm text-gray-500">{profile.std_working_days || 26} days/month</span>
                                            </>
                                          )}
                                          {profile.salary_type === 'contract' && (
                                            <>
                                              <span className="text-lg font-bold text-gray-900">₹{formatCurrency(profile.contract_amount || profile.gross_salary || 0)}</span>
                                              <span className="text-sm text-gray-500 capitalize">{profile.contract_duration?.replace('_', ' ') || 'Monthly'}</span>
                                            </>
                                          )}
                                          {profile.salary_type === 'lumpsum' && (
                                            <>
                                              <span className="text-lg font-bold text-gray-900">₹{formatCurrency(profile.lumpsum_amount || profile.gross_salary || 0)}</span>
                                              <span className="text-sm text-gray-500">Lumpsum</span>
                                            </>
                                          )}
                                          {profile.salary_type === 'custom' && (
                                            <>
                                              <span className="text-lg font-bold text-gray-900">₹{formatCurrency(profile.gross_salary || 0)}</span>
                                              <span className="text-sm text-gray-500">Earnings</span>
                                              <span className="text-sm text-green-600 font-medium">• Net: ₹{formatCurrency(profile.net_pay || 0)}</span>
                                              <span className="text-sm text-blue-600 font-medium">• CTC: ₹{formatCurrency(profile.employer_cost || 0)}</span>
                                            </>
                                          )}
                                        </div>
                                        
                                        {/* Date range */}
                                        <p className="text-xs text-gray-500 mt-2">
                                          <span className="font-medium">Effective:</span> {profile.effective_from ? new Date(profile.effective_from).toLocaleDateString('en-IN') : '-'}
                                          {profile.effective_to ? (
                                            <> → {new Date(profile.effective_to).toLocaleDateString('en-IN')}</>
                                          ) : (
                                            <span className="text-green-600 font-medium"> → Ongoing</span>
                                          )}
                                        </p>
                                      </div>
                                      
                                      {/* Right side - Actions */}
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        <button
                                          onClick={() => handleEditSalaryProfile(profile)}
                                          disabled={isBeingEdited}
                                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 ${
                                            isBeingEdited 
                                              ? 'bg-purple-100 text-purple-700 cursor-default' 
                                              : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
                                          }`}
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                          </svg>
                                          {isBeingEdited ? 'Editing' : 'Edit'}
                                        </button>
                                        <button
                                          onClick={() => handleDeleteSalaryProfile(profile.id)}
                                          disabled={deletingSalaryProfile}
                                          className="px-3 py-1.5 text-xs bg-red-50 text-red-600 hover:bg-red-100 rounded-lg border border-red-200 transition-colors flex items-center gap-1 disabled:opacity-50"
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Success Message */}
                        {salaryProfileSuccess && (
                          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <p className="font-semibold text-green-800">{salaryProfileSuccess}</p>
                          </div>
                        )}

                        {/* Error Display */}
                        {previewError && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <p className="text-sm text-red-800">{previewError}</p>
                          </div>
                        )}

                        {/* SECTION 2: Edit/Add Salary Structure */}
                        <div className={`bg-white border-2 rounded-xl p-4 ${editingSalaryProfileId ? 'border-purple-300' : 'border-gray-200'}`}>
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-4">
                              <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                                {editingSalaryProfileId ? (
                                  <>
                                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    Edit Salary Structure
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                    </svg>
                                    Add New Salary Structure
                                  </>
                                )}
                              </h4>
                              {editingSalaryProfileId && (
                                <button
                                  onClick={handleResetSalaryForm}
                                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-lg border border-gray-300 transition-colors flex items-center gap-1"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  Cancel Edit
                                </button>
                              )}
                            </div>
                            <a 
                              href="/admin/payroll-schedules" 
                              target="_blank"
                              className="text-xs text-purple-600 hover:text-purple-700 underline flex items-center gap-1"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              Manage Schedules
                            </a>
                          </div>

                          {/* Input Row: Gross + Checkboxes */}
                          <div className="bg-gray-50 rounded-lg p-4 mb-4">
                            {/* Salary Type Selection */}
                            <div className="mb-4">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Salary Type *</label>
                              <div className="flex flex-wrap gap-2">
                                {[
                                  { value: 'monthly', label: 'Monthly', desc: 'Fixed monthly salary' },
                                  { value: 'hourly', label: 'Hourly',  desc: 'Paid per hour worked' },
                                  { value: 'daily', label: 'Daily', desc: 'Paid per day worked' },
                                  { value: 'contract', label: 'Contract', desc: 'Fixed contract amount' },
                                  { value: 'lumpsum', label: 'Lumpsum', desc: 'One-time payment' },
                                  { value: 'custom', label: 'Custom', desc: 'Build your own structure' }
                                ].map((type) => (
                                  <button
                                    key={type.value}
                                    type="button"
                                    onClick={() => {
                                      // Set salary type - use functional update to ensure latest state
                                      setSalaryPreview(prev => {
                                        const newState = { ...prev, salary_type: type.value };
                                        
                                        // Fetch attendance hours when custom is selected
                                        if (type.value === 'custom' && selectedEmployee?.id) {
                                          // Use setTimeout to defer the async call after state update
                                          setTimeout(async () => {
                                            try {
                                              const hours = await fetchAttendanceHours(selectedEmployee.id);
                                              if (hours) {
                                                setSalaryPreview(latestPrev => {
                                                  // Only update if still on custom
                                                  if (latestPrev.salary_type !== 'custom') return latestPrev;
                                                  const hourlyRate = parseFloat(latestPrev.custom_hourly_rate) || 0;
                                                  return {
                                                    ...latestPrev,
                                                    custom_monthly_hours: hours,
                                                    custom_ctc: hourlyRate > 0 ? (hourlyRate * parseFloat(hours)).toFixed(2) : latestPrev.custom_ctc
                                                  };
                                                });
                                              }
                                            } catch (err) {
                                              console.error('Error fetching hours:', err);
                                            }
                                          }, 0);
                                        }
                                        
                                        return newState;
                                      });
                                    }}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all ${
                                      salaryPreview.salary_type === type.value
                                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                    }`}
                                  >
                                    <span className="text-lg">{type.icon}</span>
                                    <div className="text-left">
                                      <span className="font-medium text-sm">{type.label}</span>
                                    </div>
                                  </button>
                                ))}
                              </div>
                              <p className="text-xs text-gray-500 mt-2">
                                {salaryPreview.salary_type === 'monthly' && '💡 Standard monthly salary with statutory deductions like PF, ESIC, PT'}
                                {salaryPreview.salary_type === 'hourly' && '💡 Payment based on hours worked. Ideal for part-time or flexible workers'}
                                {salaryPreview.salary_type === 'daily' && '💡 Payment based on days worked. Common for casual/temporary workers'}
                                {salaryPreview.salary_type === 'contract' && '💡 Fixed amount for the contract duration. No statutory deductions'}
                                {salaryPreview.salary_type === 'lumpsum' && '💡 One-time payment for specific work. No recurring salary structure'}
                                {salaryPreview.salary_type === 'custom' && '💡 Build your own salary structure with hourly rate and custom earnings/deductions'}
                              </p>
                            </div>
                            {/* Effective Date Range */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Effective From *</label>
                                <input 
                                  type="date" 
                                  value={salaryPreview.effective_from || ''} 
                                  onChange={(e) => setSalaryPreview({ ...salaryPreview, effective_from: e.target.value })}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Effective To <span className="text-gray-400 text-xs">(Optional - leave blank for ongoing)</span></label>
                                <input 
                                  type="date" 
                                  value={salaryPreview.effective_to || ''} 
                                  onChange={(e) => setSalaryPreview({ ...salaryPreview, effective_to: e.target.value })}
                                  min={salaryPreview.effective_from}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                                />
                              </div>
                            </div>

                            {/* Standard Working Times */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Standard In Time</label>
                                <input 
                                  type="time" 
                                  value={salaryPreview.std_in_time || '09:00'} 
                                  onChange={(e) => setSalaryPreview({ ...salaryPreview, std_in_time: e.target.value })}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Standard Out Time</label>
                                <input 
                                  type="time" 
                                  value={salaryPreview.std_out_time || '17:30'} 
                                  onChange={(e) => setSalaryPreview({ ...salaryPreview, std_out_time: e.target.value })}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                                />
                              </div>
                            </div>

                            {/* Monthly Salary Fields */}
                            {salaryPreview.salary_type === 'monthly' && (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Gross Salary *</label>
                                <input 
                                  type="number" 
                                  value={salaryPreview.gross} 
                                  onChange={(e) => {
                                    setSalaryPreview({ ...salaryPreview, gross: e.target.value });
                                    calculateSalaryPreview(e.target.value, salaryPreview.other_allowances);
                                  }}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                                  placeholder="Enter gross salary"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Retention Amount</label>
                                <input 
                                  type="number"
                                  value={manualValues.retention !== undefined && manualValues.retention !== '' ? manualValues.retention : (currentRetention || '')} 
                                  onChange={(e) => {
                                    const retentionValue = parseFloat(e.target.value) || 0;
                                    const updated = { ...manualValues, retention: e.target.value };
                                    setManualValues(updated);
                                    setCurrentRetention(retentionValue);
                                    recalculateTotalsFromManual(updated);
                                  }}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                                  placeholder="Retention for this profile"
                                />
                              </div>
                               <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Insurance</label>
                                <input 
                                  type="number"
                                  value={manualValues.insurance !== undefined && manualValues.insurance !== '' ? manualValues.insurance : (currentInsurance || '')} 
                                  onChange={(e) => {
                                    const insuranceValue = parseFloat(e.target.value) || 0;
                                    const updated = { ...manualValues, insurance: e.target.value };
                                    setManualValues(updated);
                                    setCurrentInsurance(insuranceValue);
                                    recalculateTotalsFromManual(updated);
                                  }}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                                  placeholder="Insurance for this profile"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Other Allowances</label>
                                <input 
                                  type="number" 
                                  value={salaryPreview.other_allowances} 
                                  onChange={(e) => {
                                    setSalaryPreview({ ...salaryPreview, other_allowances: e.target.value });
                                    recalculateTotalsFromManual(manualValues);
                                  }}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                                  placeholder="0"
                                />
                              </div>
                            </div>
                            )}

                            {/* Hourly Rate Fields */}
                            {salaryPreview.salary_type === 'hourly' && (
                              <div className="space-y-4 mb-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Hourly Rate (₹) *</label>
                                    <input 
                                      type="number" 
                                      value={salaryPreview.hourly_rate} 
                                      onChange={(e) => setSalaryPreview({ ...salaryPreview, hourly_rate: e.target.value })}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" 
                                      placeholder="0"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Hours/Day</label>
                                    <input 
                                      type="number" 
                                      value={salaryPreview.std_hours_per_day || '8'} 
                                      onChange={(e) => setSalaryPreview({ ...salaryPreview, std_hours_per_day: e.target.value })}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" 
                                      placeholder="8"
                                    />
                                  </div>
                                </div>
                                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center justify-between">
                                  <div>
                                    <p className="text-xs text-orange-600 font-medium">Est. Monthly (26 days)</p>
                                    <p className="text-lg font-bold text-orange-700">₹{formatCurrency((parseFloat(salaryPreview.hourly_rate) || 0) * (parseFloat(salaryPreview.std_hours_per_day) || 8) * 26)}</p>
                                  </div>
                                  <button
                                    onClick={handleSaveSalaryProfile}
                                    disabled={salaryProfileSaving || !salaryPreview.hourly_rate}
                                    className={`px-5 py-2 text-sm rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow ${
                                      editingSalaryProfileId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-600 hover:bg-orange-700'
                                    }`}
                                  >
                                    {salaryProfileSaving ? '⏳' : editingSalaryProfileId ? 'Update' : '+ Add'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Daily Rate Fields */}
                            {salaryPreview.salary_type === 'daily' && (
                              <div className="space-y-4 mb-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Daily Rate (₹) *</label>
                                    <input 
                                      type="number" 
                                      value={salaryPreview.daily_rate} 
                                      onChange={(e) => setSalaryPreview({ ...salaryPreview, daily_rate: e.target.value })}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" 
                                      placeholder="0"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Days/Month</label>
                                    <input 
                                      type="number" 
                                      value={salaryPreview.std_working_days || '26'} 
                                      onChange={(e) => setSalaryPreview({ ...salaryPreview, std_working_days: e.target.value })}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" 
                                      placeholder="26"
                                    />
                                  </div>
                                </div>
                                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
                                  <div>
                                    <p className="text-xs text-green-600 font-medium">Est. Monthly</p>
                                    <p className="text-lg font-bold text-green-700">₹{formatCurrency((parseFloat(salaryPreview.daily_rate) || 0) * (parseFloat(salaryPreview.std_working_days) || 26))}</p>
                                  </div>
                                  <button
                                    onClick={handleSaveSalaryProfile}
                                    disabled={salaryProfileSaving || !salaryPreview.daily_rate}
                                    className={`px-5 py-2 text-sm rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow ${
                                      editingSalaryProfileId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
                                    }`}
                                  >
                                    {salaryProfileSaving ? '⏳' : editingSalaryProfileId ? 'Update' : '+ Add'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Contract Amount Fields */}
                            {salaryPreview.salary_type === 'contract' && (
                              <div className="space-y-4 mb-3">
                                <div className="grid grid-cols-3 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹) *</label>
                                    <input 
                                      type="number" 
                                      value={salaryPreview.contract_amount} 
                                      onChange={(e) => setSalaryPreview({ ...salaryPreview, contract_amount: e.target.value })}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" 
                                      placeholder="0"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Duration</label>
                                    <select 
                                      value={salaryPreview.contract_duration || 'monthly'} 
                                      onChange={(e) => setSalaryPreview({ ...salaryPreview, contract_duration: e.target.value })}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                    >
                                      <option value="monthly">Monthly</option>
                                      <option value="quarterly">Quarterly</option>
                                      <option value="half_yearly">6 Months</option>
                                      <option value="yearly">Yearly</option>
                                      <option value="project">Project</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                                    <input 
                                      type="date" 
                                      value={salaryPreview.contract_end_date || ''} 
                                      onChange={(e) => setSalaryPreview({ ...salaryPreview, contract_end_date: e.target.value })}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" 
                                    />
                                  </div>
                                </div>
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
                                  <p className="text-xs text-amber-700">💡 No PF/ESIC. TDS may apply.</p>
                                  <button
                                    onClick={handleSaveSalaryProfile}
                                    disabled={salaryProfileSaving || !salaryPreview.contract_amount}
                                    className={`px-5 py-2 text-sm rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow ${
                                      editingSalaryProfileId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-600 hover:bg-amber-700'
                                    }`}
                                  >
                                    {salaryProfileSaving ? '⏳' : editingSalaryProfileId ? 'Update' : '+ Add'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Lumpsum Amount Fields */}
                            {salaryPreview.salary_type === 'lumpsum' && (
                              <div className="space-y-4 mb-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹) *</label>
                                    <input 
                                      type="number" 
                                      value={salaryPreview.lumpsum_amount} 
                                      onChange={(e) => setSalaryPreview({ ...salaryPreview, lumpsum_amount: e.target.value })}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                                      placeholder="0"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                                    <input 
                                      type="text" 
                                      value={salaryPreview.lumpsum_description || ''} 
                                      onChange={(e) => setSalaryPreview({ ...salaryPreview, lumpsum_description: e.target.value })}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                                      placeholder="e.g., Bonus"
                                    />
                                  </div>
                                </div>
                                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center justify-between">
                                  <p className="text-xs text-purple-700">💰 One-time payment. No recurring.</p>
                                  <button
                                    onClick={handleSaveSalaryProfile}
                                    disabled={salaryProfileSaving || !salaryPreview.lumpsum_amount}
                                    className={`px-5 py-2 text-sm rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow ${
                                      editingSalaryProfileId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'
                                    }`}
                                  >
                                    {salaryProfileSaving ? '⏳' : editingSalaryProfileId ? 'Update' : '+ Add'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Custom Salary Structure Fields - Hourly Rate Based Calculation */}
                            {salaryPreview.salary_type === 'custom' && (
                              <div className="space-y-4 mb-3">
                                {/* Hourly Rate Input and CTC Calculation Section */}
                                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                                  <h5 className="text-sm font-semibold text-yellow-800 mb-3 flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Hourly Rate & CTC Calculation
                                  </h5>
                                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Hourly Rate (₹) *</label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={salaryPreview.custom_hourly_rate || ''}
                                        onChange={(e) => {
                                          const hourlyRate = parseFloat(e.target.value) || 0;
                                          const hours = parseFloat(salaryPreview.custom_monthly_hours) || 0;
                                          const ctc = hourlyRate * hours; // CTC = Hourly Rate × Hours
                                          
                                          // Fixed costs
                                          const mlwfEmployer = 72;
                                          const insurance = 500;
                                          
                                          // Iterative calculation to converge on correct values
                                          let calculatedGross = ctc * 0.90; // Initial estimate
                                          let basicDa, pfBase, pfEmployer, esicEmployer, bonus, employerCosts;
                                          
                                          // Iterate until values stabilize (usually 2-3 iterations)
                                          for (let i = 0; i < 5; i++) {
                                            basicDa = Math.round(calculatedGross * (PAYROLL_CONFIG.BASIC_DA_PERCENT / 100));
                                            pfBase = Math.min(basicDa, PAYROLL_CONFIG.PF_WAGE_CEILING);
                                            pfEmployer = Math.round(pfBase * (PAYROLL_CONFIG.EMPLOYER_PF_PERCENT / 100));
                                            esicEmployer = calculatedGross <= PAYROLL_CONFIG.ESIC_SALARY_CEILING 
                                              ? Math.round(calculatedGross * (PAYROLL_CONFIG.EMPLOYER_ESIC_PERCENT / 100)) 
                                              : 0;
                                            bonus = Math.round(basicDa * 0.0833);
                                            employerCosts = pfEmployer + esicEmployer + mlwfEmployer + bonus + insurance;
                                            const newGross = ctc - employerCosts;
                                            if (Math.abs(newGross - calculatedGross) < 1) break; // Converged
                                            calculatedGross = newGross;
                                          }
                                          
                                          // Final calculation with converged gross
                                          calculatedGross = ctc - employerCosts;
                                          basicDa = Math.round(calculatedGross * (PAYROLL_CONFIG.BASIC_DA_PERCENT / 100));
                                          const hra = Math.round(calculatedGross * (PAYROLL_CONFIG.HRA_PERCENT / 100));
                                          const callAllowance = Math.round(calculatedGross * (PAYROLL_CONFIG.CALL_ALLOWANCE_PERCENT / 100));
                                          const conveyance = Math.round(calculatedGross * (PAYROLL_CONFIG.CONVEYANCE_PERCENT / 100));
                                          const otherAllowance = calculatedGross - basicDa - hra - callAllowance - conveyance;
                                          
                                          // Recalculate employer PF/Bonus based on final basicDa
                                          pfBase = Math.min(basicDa, PAYROLL_CONFIG.PF_WAGE_CEILING);
                                          pfEmployer = Math.round(pfBase * (PAYROLL_CONFIG.EMPLOYER_PF_PERCENT / 100));
                                          bonus = Math.round(basicDa * 0.0833);
                                          
                                          // Calculate Employee Deductions
                                          const pfEmployee = Math.round(pfBase * (PAYROLL_CONFIG.EMPLOYEE_PF_PERCENT / 100));
                                          const esicEmployee = calculatedGross <= PAYROLL_CONFIG.ESIC_SALARY_CEILING 
                                            ? Math.round(calculatedGross * (PAYROLL_CONFIG.EMPLOYEE_ESIC_PERCENT / 100)) 
                                            : 0;
                                          const pt = PAYROLL_CONFIG.PROFESSIONAL_TAX.ABOVE_10000;
                                          const mlwf = PAYROLL_CONFIG.LWF_HALF_YEARLY;
                                          
                                          setSalaryPreview({ 
                                            ...salaryPreview, 
                                            custom_hourly_rate: e.target.value,
                                            custom_ctc: ctc.toFixed(2),
                                            // Employer contributions
                                            custom_pf_employer: pfEmployer.toString(),
                                            custom_esic_employer: esicEmployer.toString(),
                                            custom_mlwf_employer: mlwfEmployer.toString(),
                                            custom_bonus: bonus.toString(),
                                            custom_insurance: insurance.toString(),
                                            // Earnings (calculated from Calculated Gross)
                                            custom_basic: basicDa.toString(),
                                            custom_hra: hra.toString(),
                                            custom_conveyance: conveyance.toString(),
                                            custom_call_allowance: callAllowance.toString(),
                                            custom_other_allowances: Math.max(0, otherAllowance).toString(),
                                            // Employee deductions
                                            custom_pf_employee: pfEmployee.toString(),
                                            custom_esic_employee: esicEmployee.toString(),
                                            custom_pt: pt.toString(),
                                            custom_mlwf: mlwf.toString()
                                          });
                                        }}
                                        className="w-full px-2 py-1.5 text-sm border border-yellow-400 rounded focus:outline-none focus:ring-2 focus:ring-yellow-500 bg-yellow-100 font-semibold"
                                        placeholder="Enter Rate"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Monthly Hours</label>
                                      <div className={`w-full px-2 py-1.5 text-sm border rounded font-medium flex items-center gap-1 ${
                                        salaryPreview.custom_monthly_hours 
                                          ? 'bg-blue-100 border-blue-300 text-blue-700' 
                                          : 'bg-orange-100 border-orange-300 text-orange-700'
                                      }`}>
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        {salaryPreview.custom_monthly_hours ? `${salaryPreview.custom_monthly_hours} hrs` : 'No attendance'}
                                      </div>
                                      <p className="text-[10px] text-blue-600 mt-0.5">From Attendance (Current Month)</p>
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Calculated CTC (₹)</label>
                                      <div className="w-full px-2 py-1.5 text-sm bg-yellow-200 border border-yellow-400 rounded text-yellow-800 font-semibold">
                                        ₹{formatCurrency(parseFloat(salaryPreview.custom_ctc) || 0)}
                                      </div>
                                      <p className="text-[10px] text-yellow-700 mt-0.5">Rate × Hours</p>
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Employer Contributions</label>
                                      <div className="w-full px-2 py-1.5 text-sm bg-red-100 border border-red-300 rounded text-red-700 font-semibold">
                                        ₹{formatCurrency(
                                          (parseFloat(salaryPreview.custom_pf_employer) || 0) +
                                          (parseFloat(salaryPreview.custom_esic_employer) || 0) +
                                          (parseFloat(salaryPreview.custom_mlwf_employer) || 0) +
                                          (parseFloat(salaryPreview.custom_bonus) || 0) +
                                          (parseFloat(salaryPreview.custom_insurance) || 0) +
                                          ((salaryPreview.custom_components || []).filter(c => c.type === 'employer').reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0))
                                        )}
                                      </div>
                                      <p className="text-[10px] text-red-600 mt-0.5">PF + ESIC + MLWF + Bonus + Ins</p>
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Calculated Gross</label>
                                      <div className="w-full px-2 py-1.5 text-sm bg-green-100 border border-green-300 rounded text-green-700 font-semibold">
                                        ₹{formatCurrency(
                                          (parseFloat(salaryPreview.custom_ctc) || 0) - 
                                          ((parseFloat(salaryPreview.custom_pf_employer) || 0) +
                                          (parseFloat(salaryPreview.custom_esic_employer) || 0) +
                                          (parseFloat(salaryPreview.custom_mlwf_employer) || 0) +
                                          (parseFloat(salaryPreview.custom_bonus) || 0) +
                                          (parseFloat(salaryPreview.custom_insurance) || 0) +
                                          ((salaryPreview.custom_components || []).filter(c => c.type === 'employer').reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0)))
                                        )}
                                      </div>
                                      <p className="text-[10px] text-green-600 mt-0.5">CTC - Employer Costs</p>
                                    </div>
                                  </div>
                                  <p className="text-xs text-gray-500 mt-2">💡 Monthly Hours fetched from Attendance Master during payroll calculation</p>
                                </div>

                                {/* 3 COLUMNS SIDE BY SIDE */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  {/* COLUMN 1: EARNINGS (Editable, based on CTC) */}
                                  <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                                    <h5 className="text-sm font-semibold text-green-800 mb-3 flex items-center gap-2">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                      </svg>
                                      Earnings
                                    </h5>
                                    <div className="space-y-2">
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Basic + DA</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_basic || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_basic: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">HRA</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_hra || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_hra: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Conveyance</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_conveyance || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_conveyance: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Call Allowance</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_call_allowance || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_call_allowance: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Incentive</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_incentive || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_incentive: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Other</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_other_allowances || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_other_allowances: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="border-t border-green-300 pt-2 mt-2">
                                        <div className="flex justify-between font-semibold">
                                          <span className="text-green-900">Total Earnings</span>
                                          <span className="text-green-900">₹{formatCurrency(
                                            (parseFloat(salaryPreview.custom_basic) || 0) +
                                            (parseFloat(salaryPreview.custom_hra) || 0) +
                                            (parseFloat(salaryPreview.custom_conveyance) || 0) +
                                            (parseFloat(salaryPreview.custom_call_allowance) || 0) +
                                            (parseFloat(salaryPreview.custom_incentive) || 0) +
                                            (parseFloat(salaryPreview.custom_other_allowances) || 0)
                                          )}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* COLUMN 2: DEDUCTIONS (Fixed like Monthly) */}
                                  <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                                    <h5 className="text-sm font-semibold text-red-800 mb-3 flex items-center gap-2">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                      </svg>
                                      Deductions
                                    </h5>
                                    <div className="space-y-2">
                                      <div className="flex justify-between items-center text-sm text-gray-500 mb-2">
                                        <span>From Earnings:</span>
                                        <span>₹{formatCurrency(
                                          (parseFloat(salaryPreview.custom_basic) || 0) +
                                          (parseFloat(salaryPreview.custom_da) || 0) +
                                          (parseFloat(salaryPreview.custom_hra) || 0) +
                                          (parseFloat(salaryPreview.custom_conveyance) || 0) +
                                          (parseFloat(salaryPreview.custom_call_allowance) || 0) +
                                          (parseFloat(salaryPreview.custom_incentive) || 0) +
                                          (parseFloat(salaryPreview.custom_other_allowances) || 0)
                                        )}</span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Emp PF</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_pf_employee || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_pf_employee: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Emp ESIC</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_esic_employee || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_esic_employee: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">PT</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_pt || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_pt: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">MLWF</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_mlwf || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_mlwf: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Retention</span>
                                        <input
                                          type="number"
                                          value={salaryPreview.custom_retention || ''}
                                          onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_retention: e.target.value })}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
                                          placeholder="0"
                                        />
                                      </div>
                                      <div className="border-t border-red-300 pt-2 mt-2">
                                        <div className="flex justify-between font-semibold">
                                          <span className="text-red-900">Total Deductions</span>
                                          <span className="text-red-900">₹{formatCurrency(
                                            (parseFloat(salaryPreview.custom_pf_employee) || 0) +
                                            (parseFloat(salaryPreview.custom_esic_employee) || 0) +
                                            (parseFloat(salaryPreview.custom_pt) || 0) +
                                            (parseFloat(salaryPreview.custom_mlwf) || 0) +
                                            (parseFloat(salaryPreview.custom_retention) || 0)
                                          )}</span>
                                        </div>
                                      </div>
                                      <div className="border-t-2 border-green-400 pt-2 mt-2">
                                        <div className="flex justify-between font-bold text-base">
                                          <span className="text-green-700">Net Pay</span>
                                          <span className="text-green-700">₹{formatCurrency(
                                            ((parseFloat(salaryPreview.custom_basic) || 0) +
                                            (parseFloat(salaryPreview.custom_da) || 0) +
                                            (parseFloat(salaryPreview.custom_hra) || 0) +
                                            (parseFloat(salaryPreview.custom_conveyance) || 0) +
                                            (parseFloat(salaryPreview.custom_call_allowance) || 0) +
                                            (parseFloat(salaryPreview.custom_incentive) || 0) +
                                            (parseFloat(salaryPreview.custom_other_allowances) || 0)) -
                                            ((parseFloat(salaryPreview.custom_pf_employee) || 0) +
                                            (parseFloat(salaryPreview.custom_esic_employee) || 0) +
                                            (parseFloat(salaryPreview.custom_pt) || 0) +
                                            (parseFloat(salaryPreview.custom_mlwf) || 0) +
                                            (parseFloat(salaryPreview.custom_retention) || 0))
                                          )}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* COLUMN 3: EMPLOYER COST / CTC (Dynamic - can add custom items) */}
                                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                                    <div className="flex items-center justify-between mb-3">
                                      <h5 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                        </svg>
                                        CTC / Employer
                                      </h5>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const newComponent = { id: Date.now(), name: '', amount: '', type: 'employer' };
                                          setSalaryPreview({
                                            ...salaryPreview,
                                            custom_components: [...(salaryPreview.custom_components || []), newComponent]
                                          });
                                        }}
                                        className="p-1 bg-blue-600 text-white hover:bg-blue-700 rounded"
                                        title="Add Employer Cost"
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                        </svg>
                                      </button>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Total Earnings</span>
                                        <span className="text-sm font-medium text-gray-900">₹{formatCurrency(
                                          (parseFloat(salaryPreview.custom_basic) || 0) +
                                          (parseFloat(salaryPreview.custom_da) || 0) +
                                          (parseFloat(salaryPreview.custom_hra) || 0) +
                                          (parseFloat(salaryPreview.custom_conveyance) || 0) +
                                          (parseFloat(salaryPreview.custom_call_allowance) || 0) +
                                          (parseFloat(salaryPreview.custom_incentive) || 0) +
                                          (parseFloat(salaryPreview.custom_other_allowances) || 0)
                                        )}</span>
                                      </div>
                                      <div className="border-t border-blue-200 pt-2 mt-2">
                                        <p className="text-xs text-gray-500 mb-2">Employer Contributions:</p>
                                        <div className="flex justify-between items-center">
                                          <span className="text-sm text-gray-600">Empr PF</span>
                                          <input
                                            type="number"
                                            value={salaryPreview.custom_pf_employer || ''}
                                            onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_pf_employer: e.target.value })}
                                            className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            placeholder="0"
                                          />
                                        </div>
                                        <div className="flex justify-between items-center mt-2">
                                          <span className="text-sm text-gray-600">Empr ESIC</span>
                                          <input
                                            type="number"
                                            value={salaryPreview.custom_esic_employer || ''}
                                            onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_esic_employer: e.target.value })}
                                            className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            placeholder="0"
                                          />
                                        </div>
                                        <div className="flex justify-between items-center mt-2">
                                          <span className="text-sm text-gray-600">Empr MLWF</span>
                                          <input
                                            type="number"
                                            value={salaryPreview.custom_mlwf_employer || ''}
                                            onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_mlwf_employer: e.target.value })}
                                            className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            placeholder="0"
                                          />
                                        </div>
                                        <div className="flex justify-between items-center mt-2">
                                          <span className="text-sm text-gray-600">Bonus</span>
                                          <input
                                            type="number"
                                            value={salaryPreview.custom_bonus || ''}
                                            onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_bonus: e.target.value })}
                                            className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            placeholder="0"
                                          />
                                        </div>
                                        <div className="flex justify-between items-center mt-2">
                                          <span className="text-sm text-gray-600">Insurance</span>
                                          <input
                                            type="number"
                                            value={salaryPreview.custom_insurance || ''}
                                            onChange={(e) => setSalaryPreview({ ...salaryPreview, custom_insurance: e.target.value })}
                                            className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            placeholder="0"
                                          />
                                        </div>
                                        {/* Dynamic employer cost items */}
                                        {(salaryPreview.custom_components || []).filter(c => c.type === 'employer').map((comp) => (
                                          <div key={comp.id} className="flex justify-between items-center mt-2 gap-1">
                                            <input
                                              type="text"
                                              value={comp.name}
                                              onChange={(e) => {
                                                const updated = [...salaryPreview.custom_components];
                                                const idx = salaryPreview.custom_components.findIndex(c => c.id === comp.id);
                                                updated[idx].name = e.target.value;
                                                setSalaryPreview({ ...salaryPreview, custom_components: updated });
                                              }}
                                              placeholder="Name"
                                              className="flex-1 min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            />
                                            <input
                                              type="number"
                                              value={comp.amount}
                                              onChange={(e) => {
                                                const updated = [...salaryPreview.custom_components];
                                                const idx = salaryPreview.custom_components.findIndex(c => c.id === comp.id);
                                                updated[idx].amount = e.target.value;
                                                setSalaryPreview({ ...salaryPreview, custom_components: updated });
                                              }}
                                              placeholder="0"
                                              className="w-20 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const updated = salaryPreview.custom_components.filter(c => c.id !== comp.id);
                                                setSalaryPreview({ ...salaryPreview, custom_components: updated });
                                              }}
                                              className="p-0.5 text-gray-400 hover:text-red-500 rounded"
                                            >
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                              </svg>
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                      <div className="border-t-2 border-blue-400 pt-2 mt-2">
                                        <div className="flex justify-between font-bold text-base">
                                          <span className="text-blue-800">Total CTC</span>
                                          <span className="text-blue-800">₹{formatCurrency(parseFloat(salaryPreview.custom_ctc) || 0)}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Save Button */}
                                <div className="flex justify-end">
                                  <button
                                    onClick={handleSaveSalaryProfile}
                                    disabled={salaryProfileSaving || !(
                                      (parseFloat(salaryPreview.custom_basic) || 0) > 0 ||
                                      (parseFloat(salaryPreview.custom_da) || 0) > 0 ||
                                      (parseFloat(salaryPreview.custom_hra) || 0) > 0
                                    )}
                                    className={`px-5 py-2 text-sm rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow ${
                                      editingSalaryProfileId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-indigo-600 hover:bg-indigo-700'
                                    }`}
                                  >
                                    {salaryProfileSaving ? '⏳' : editingSalaryProfileId ? 'Update Custom Profile' : '+ Add Custom Profile'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Statutory Deductions - Only for Monthly type */}
                            {salaryPreview.salary_type === 'monthly' && (
                            <>
                            <div>
                            </div>
                            <div className="flex flex-wrap gap-4">
                              <label className="flex items-center cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={!!salaryPreview.pf_applicable} 
                                  onChange={(e) => {
                                    setSalaryPreview({ ...salaryPreview, pf_applicable: e.target.checked });
                                    recalculateTotalsFromManual(manualValues);
                                  }}
                                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500" 
                                />
                                <span className="ml-2 text-sm text-gray-700">PF</span>
                              </label>
                              <label className="flex items-center cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={!!salaryPreview.esic_applicable} 
                                  onChange={(e) => {
                                    setSalaryPreview({ ...salaryPreview, esic_applicable: e.target.checked });
                                    recalculateTotalsFromManual(manualValues);
                                  }}
                                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500" 
                                />
                                <span className="ml-2 text-sm text-gray-700">ESIC</span>
                              </label>
                              <label className={`flex items-center ${isPTExempt(salaryPreview.gross) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} title={isPTExempt(salaryPreview.gross) ? `PT exempt: ${(formData.gender || selectedEmployee?.gender) === 'Male' ? 'Male ≤₹7,500' : 'Female <₹25,000'}` : `PT: ${calculatePTAmount(salaryPreview.gross)}/month${new Date().getMonth() === 1 ? ' (Feb rate)' : ''}`}>
                                <input 
                                  type="checkbox" 
                                  checked={!!(salaryPreview.pt_applicable && !isPTExempt(salaryPreview.gross))} 
                                  disabled={isPTExempt(salaryPreview.gross)}
                                  onChange={async (e) => {
                                    const isChecked = e.target.checked;
                                    setSalaryPreview({ ...salaryPreview, pt_applicable: isChecked });
                                    
                                    if (isChecked && previewBreakdown && !isPTExempt(salaryPreview.gross)) {
                                      // Fetch PT value if not already loaded, or use calculated value
                                      let ptAmount = currentPT;
                                      if (ptAmount === 0) {
                                        ptAmount = await fetchPT();
                                      }
                                      // If no PT from schedules, use calculated value
                                      if (ptAmount === 0) {
                                        ptAmount = calculatePTAmount(salaryPreview.gross);
                                      }
                                      // Update previewBreakdown with fetched/calculated value
                                      setPreviewBreakdown(prev => {
                                        const newTotalDeductions = Math.round(
                                          prev.pf_employee + prev.esic_employee + ptAmount + (prev.mlwf || 0) + (prev.retention || 0)
                                        );
                                        const newNetPay = Math.round(prev.total_earnings - newTotalDeductions);
                                        return { ...prev, pt: ptAmount, total_deductions: newTotalDeductions, net_pay: newNetPay };
                                      });
                                    } else if (!isChecked && previewBreakdown) {
                                      // Unchecking - reset PT to 0
                                      setPreviewBreakdown(prev => {
                                        const newTotalDeductions = Math.round(
                                          prev.pf_employee + prev.esic_employee + 0 + (prev.mlwf || 0) + (prev.retention || 0)
                                        );
                                        const newNetPay = Math.round(prev.total_earnings - newTotalDeductions);
                                        return { ...prev, pt: 0, total_deductions: newTotalDeductions, net_pay: newNetPay };
                                      });
                                    }
                                  }}
                                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500" 
                                />
                                <span className="ml-2 text-sm text-gray-700">
                                  PT {isPTExempt(salaryPreview.gross) ? (
                                    <span className="text-xs text-green-600">(Exempt)</span>
                                  ) : (
                                    <span className="text-xs text-gray-500">(₹{calculatePTAmount(salaryPreview.gross)})</span>
                                  )}
                                </span>
                              </label>
                              <label className="flex items-center cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={!!salaryPreview.mlwf_applicable} 
                                  onChange={async (e) => {
                                    const isChecked = e.target.checked;
                                    setSalaryPreview({ ...salaryPreview, mlwf_applicable: isChecked });
                                    
                                    if (isChecked && previewBreakdown) {
                                      // Fetch MLWF values if not already loaded
                                      let mlwfEmployee = currentMLWF;
                                      let mlwfEmployer = currentMLWFEmployer;
                                      if (mlwfEmployee === 0 || mlwfEmployer === 0) {
                                        const mlwfValues = await fetchMLWFWithEmployer();
                                        mlwfEmployee = mlwfValues.employee;
                                        mlwfEmployer = mlwfValues.employer;
                                      }
                                      // Update previewBreakdown with fetched values
                                      setPreviewBreakdown(prev => {
                                        const newTotalDeductions = Math.round(
                                          prev.pf_employee + prev.esic_employee + (prev.pt || 0) + mlwfEmployee + (prev.retention || 0)
                                        );
                                        const newNetPay = Math.round(prev.total_earnings - newTotalDeductions);
                                        const newEmployerCost = Math.round(
                                          prev.total_earnings + prev.pf_employer + prev.esic_employer + mlwfEmployer + (prev.bonus || 0) + (prev.insurance || 0)
                                        );
                                        return { ...prev, mlwf: mlwfEmployee, mlwf_employer: mlwfEmployer, total_deductions: newTotalDeductions, net_pay: newNetPay, employer_cost: newEmployerCost };
                                      });
                                    } else if (!isChecked && previewBreakdown) {
                                      // Unchecking - reset MLWF values to 0
                                      setPreviewBreakdown(prev => {
                                        const newTotalDeductions = Math.round(
                                          prev.pf_employee + prev.esic_employee + (prev.pt || 0) + 0 + (prev.retention || 0)
                                        );
                                        const newNetPay = Math.round(prev.total_earnings - newTotalDeductions);
                                        const newEmployerCost = Math.round(
                                          prev.total_earnings + prev.pf_employer + prev.esic_employer + 0 + (prev.bonus || 0) + (prev.insurance || 0)
                                        );
                                        return { ...prev, mlwf: 0, mlwf_employer: 0, total_deductions: newTotalDeductions, net_pay: newNetPay, employer_cost: newEmployerCost };
                                      });
                                    }
                                  }}
                                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500" 
                                />
                                <span className="ml-2 text-sm text-gray-700">MLWF</span>
                              </label>
                              <label className="flex items-center cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={!!salaryPreview.retention_applicable} 
                                  onChange={async (e) => {
                                    const isChecked = e.target.checked;
                                    setSalaryPreview({ ...salaryPreview, retention_applicable: isChecked });
                                    
                                    if (isChecked && previewBreakdown) {
                                      // Fetch retention value if not already loaded
                                      let retentionAmount = currentRetention;
                                      if (retentionAmount === 0) {
                                        retentionAmount = await fetchRetention();
                                      }
                                      // Update previewBreakdown with fetched value
                                      setPreviewBreakdown(prev => {
                                        const newTotalDeductions = Math.round(
                                          prev.pf_employee + prev.esic_employee + (prev.pt || 0) + (prev.mlwf || 0) + retentionAmount
                                        );
                                        const newNetPay = Math.round(prev.total_earnings - newTotalDeductions);
                                        return { ...prev, retention: retentionAmount, total_deductions: newTotalDeductions, net_pay: newNetPay };
                                      });
                                    } else if (!isChecked && previewBreakdown) {
                                      // Unchecking - reset retention to 0
                                      setPreviewBreakdown(prev => {
                                        const newTotalDeductions = Math.round(
                                          prev.pf_employee + prev.esic_employee + (prev.pt || 0) + (prev.mlwf || 0) + 0
                                        );
                                        const newNetPay = Math.round(prev.total_earnings - newTotalDeductions);
                                        return { ...prev, retention: 0, total_deductions: newTotalDeductions, net_pay: newNetPay };
                                      });
                                    }
                                  }}
                                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500" 
                                />
                                <span className="ml-2 text-sm text-gray-700">Retention</span>
                              </label>
                              <label className="flex items-center cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={!!salaryPreview.bonus_applicable} 
                                  onChange={async (e) => {
                                    const isChecked = e.target.checked;
                                    setSalaryPreview({ ...salaryPreview, bonus_applicable: isChecked });
                                    
                                    if (isChecked && previewBreakdown) {
                                      // Fetch bonus rate if not already loaded
                                      let bonusRate = currentBonus;
                                      if (bonusRate === 0) {
                                        bonusRate = await fetchBonus();
                                      }
                                      // Calculate bonus amount
                                      const basicPlusDaTotal = (parseFloat(manualValues.basic_plus_da) || previewBreakdown.basic_plus_da || 0) + 
                                                                (parseFloat(manualValues.da) || previewBreakdown.da || currentDA || 0);
                                      const calculatedBonus = Math.round(basicPlusDaTotal * bonusRate / 100);
                                      
                                      // Update previewBreakdown with bonus and recalculate employer_cost
                                      setPreviewBreakdown(prev => {
                                        const newEmployerCost = Math.round(
                                          prev.total_earnings + 
                                          prev.pf_employer + 
                                          prev.esic_employer + 
                                          (prev.mlwf_employer || 0) + 
                                          calculatedBonus + 
                                          (prev.insurance || 0)
                                        );
                                        return { ...prev, bonus: calculatedBonus, employer_cost: newEmployerCost };
                                      });
                                    } else if (!isChecked && previewBreakdown) {
                                      // Unchecking - reset bonus to 0 and recalculate employer_cost
                                      setPreviewBreakdown(prev => {
                                        const newEmployerCost = Math.round(
                                          prev.total_earnings + 
                                          prev.pf_employer + 
                                          prev.esic_employer + 
                                          (prev.mlwf_employer || 0) + 
                                          0 + // bonus = 0
                                          (prev.insurance || 0)
                                        );
                                        return { ...prev, bonus: 0, employer_cost: newEmployerCost };
                                      });
                                    }
                                  }}
                                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500" 
                                />
                                <span className="ml-2 text-sm text-gray-700">Bonus</span>
                              </label>
                              <label className="flex items-center cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={!!salaryPreview.incentive_applicable} 
                                  onChange={async (e) => {
                                    const isChecked = e.target.checked;
                                    setSalaryPreview({ ...salaryPreview, incentive_applicable: isChecked });
                                    
                                    if (isChecked && previewBreakdown) {
                                      // Fetch incentive amount if not already loaded
                                      let incentiveAmount = currentIncentive;
                                      if (incentiveAmount === 0) {
                                        incentiveAmount = await fetchIncentive();
                                      }
                                      // Update previewBreakdown with fetched value
                                      setPreviewBreakdown(prev => {
                                        const newTotalEarnings = Math.round(
                                          prev.basic_plus_da + prev.da + prev.hra + prev.conveyance + prev.call_allowance + (prev.other_allowances || 0) + incentiveAmount
                                        );
                                        const newNetPay = Math.round(newTotalEarnings - prev.total_deductions);
                                        const newEmployerCost = Math.round(
                                          newTotalEarnings + prev.pf_employer + prev.esic_employer + (prev.mlwf_employer || 0) + (prev.bonus || 0) + (prev.insurance || 0)
                                        );
                                        return { ...prev, incentive: incentiveAmount, total_earnings: newTotalEarnings, net_pay: newNetPay, employer_cost: newEmployerCost };
                                      });
                                    } else if (!isChecked && previewBreakdown) {
                                      // Unchecking - reset incentive to 0
                                      setPreviewBreakdown(prev => {
                                        const newTotalEarnings = Math.round(
                                          prev.basic_plus_da + prev.da + prev.hra + prev.conveyance + prev.call_allowance + (prev.other_allowances || 0) + 0
                                        );
                                        const newNetPay = Math.round(newTotalEarnings - prev.total_deductions);
                                        const newEmployerCost = Math.round(
                                          newTotalEarnings + prev.pf_employer + prev.esic_employer + (prev.mlwf_employer || 0) + (prev.bonus || 0) + (prev.insurance || 0)
                                        );
                                        return { ...prev, incentive: 0, total_earnings: newTotalEarnings, net_pay: newNetPay, employer_cost: newEmployerCost };
                                      });
                                    }
                                  }}
                                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500" 
                                />
                                <span className="ml-2 text-sm text-gray-700">Incentive</span>
                              </label>
                              <label className="flex items-center cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  checked={!!salaryPreview.insurance_applicable} 
                                  onChange={async (e) => {
                                    const isChecked = e.target.checked;
                                    setSalaryPreview({ ...salaryPreview, insurance_applicable: isChecked });
                                    
                                    if (isChecked && previewBreakdown) {
                                      // Fetch insurance amount if not already loaded
                                      let insuranceAmount = currentInsurance;
                                      if (insuranceAmount === 0) {
                                        insuranceAmount = await fetchInsurance();
                                      }
                                      // Update previewBreakdown with fetched value
                                      setPreviewBreakdown(prev => {
                                        const newEmployerCost = Math.round(
                                          prev.total_earnings + prev.pf_employer + prev.esic_employer + (prev.mlwf_employer || 0) + (prev.bonus || 0) + insuranceAmount
                                        );
                                        return { ...prev, insurance: insuranceAmount, employer_cost: newEmployerCost };
                                      });
                                    } else if (!isChecked && previewBreakdown) {
                                      // Unchecking - reset insurance to 0
                                      setPreviewBreakdown(prev => {
                                        const newEmployerCost = Math.round(
                                          prev.total_earnings + prev.pf_employer + prev.esic_employer + (prev.mlwf_employer || 0) + (prev.bonus || 0) + 0
                                        );
                                        return { ...prev, insurance: 0, employer_cost: newEmployerCost };
                                      });
                                    }
                                  }}
                                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500" 
                                />
                                <span className="ml-2 text-sm text-gray-700">Insurance</span>
                              </label>
                            </div>
                            </>
                            )}
                          </div>

                          {/* 3-Column Breakdown - Only for Monthly */}
                          {salaryPreview.salary_type === 'monthly' && previewBreakdown && (
                            <>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                
                                {/* EARNINGS Column */}
                                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                                  <h5 className="text-sm font-semibold text-green-800 mb-3 flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    Earnings
                                  </h5>
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-gray-600">Basic</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={manualValues.basic_plus_da !== undefined && manualValues.basic_plus_da !== '' ? manualValues.basic_plus_da : (previewBreakdown.basic_plus_da || '')}
                                        onChange={(e) => {
                                          const updated = { ...manualValues, basic_plus_da: e.target.value };
                                          setManualValues(updated);
                                          recalculateTotalsFromManual(updated);
                                        }}
                                        className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                      />
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-gray-600">DA</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={manualValues.da !== undefined && manualValues.da !== '' ? manualValues.da : (previewBreakdown.da || currentDA || '')}
                                        onChange={(e) => {
                                          const updated = { ...manualValues, da: e.target.value };
                                          setManualValues(updated);
                                          recalculateTotalsFromManual(updated);
                                        }}
                                        className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                      />
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-gray-600">HRA</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={manualValues.hra !== undefined && manualValues.hra !== '' ? manualValues.hra : (previewBreakdown.hra || '')}
                                        onChange={(e) => {
                                          const updated = { ...manualValues, hra: e.target.value };
                                          setManualValues(updated);
                                          recalculateTotalsFromManual(updated);
                                        }}
                                        className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                      />
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-gray-600">Conveyance</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={manualValues.conveyance !== undefined && manualValues.conveyance !== '' ? manualValues.conveyance : (previewBreakdown.conveyance || '')}
                                        onChange={(e) => {
                                          const updated = { ...manualValues, conveyance: e.target.value };
                                          setManualValues(updated);
                                          recalculateTotalsFromManual(updated);
                                        }}
                                        className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                      />
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-gray-600">Call Allowance</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={manualValues.call_allowance !== undefined && manualValues.call_allowance !== '' ? manualValues.call_allowance : (previewBreakdown.call_allowance || '')}
                                        onChange={(e) => {
                                          const updated = { ...manualValues, call_allowance: e.target.value };
                                          setManualValues(updated);
                                          recalculateTotalsFromManual(updated);
                                        }}
                                        className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                      />
                                    </div>
                                    {salaryPreview.incentive_applicable && (
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Incentive</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={manualValues.incentive !== undefined && manualValues.incentive !== '' ? manualValues.incentive : (previewBreakdown.incentive || currentIncentive || '')}
                                          onChange={(e) => {
                                            const updated = { ...manualValues, incentive: e.target.value };
                                            setManualValues(updated);
                                            recalculateTotalsFromManual(updated);
                                          }}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        />
                                      </div>
                                    )}
                                    {(previewBreakdown.other_allowances > 0 || salaryPreview.other_allowances) && (
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Other</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={manualValues.other_allowances !== undefined && manualValues.other_allowances !== '' ? manualValues.other_allowances : (previewBreakdown.other_allowances || salaryPreview.other_allowances || '')}
                                          onChange={(e) => {
                                            const updated = { ...manualValues, other_allowances: e.target.value };
                                            setManualValues(updated);
                                            setSalaryPreview({ ...salaryPreview, other_allowances: e.target.value });
                                            recalculateTotalsFromManual(updated);
                                          }}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        />
                                      </div>
                                    )}
                                    <div className="border-t border-green-300 pt-2 mt-2">
                                      <div className="flex justify-between font-semibold">
                                        <span className="text-green-900">Total Earnings</span>
                                        <span className="text-green-900">₹{formatCurrency(previewBreakdown.total_earnings)}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* DEDUCTIONS Column */}
                                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                                  <h5 className="text-sm font-semibold text-red-800 mb-3 flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                    </svg>
                                    Deductions
                                  </h5>
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center text-sm text-gray-500 mb-2">
                                      <span>From Earnings:</span>
                                      <span>₹{formatCurrency(previewBreakdown.total_earnings)}</span>
                                    </div>
                                    {salaryPreview.pf_applicable && (
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Emp PF</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={manualValues.pf_employee !== undefined && manualValues.pf_employee !== '' ? manualValues.pf_employee : (previewBreakdown.pf_employee || '')}
                                          onChange={(e) => {
                                            const updated = { ...manualValues, pf_employee: e.target.value };
                                            setManualValues(updated);
                                            recalculateTotalsFromManual(updated);
                                          }}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        />
                                      </div>
                                    )}
                                    {salaryPreview.esic_applicable && (
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Emp ESIC</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={manualValues.esic_employee !== undefined && manualValues.esic_employee !== '' ? manualValues.esic_employee : (previewBreakdown.esic_employee || '')}
                                          onChange={(e) => {
                                            const updated = { ...manualValues, esic_employee: e.target.value };
                                            setManualValues(updated);
                                            recalculateTotalsFromManual(updated);
                                          }}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        />
                                      </div>
                                    )}
                                    {salaryPreview.pt_applicable && !isPTExempt(salaryPreview.gross) && (
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">PT {new Date().getMonth() === 1 && <span className="text-xs text-blue-600">(Feb)</span>}</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={manualValues.pt !== undefined && manualValues.pt !== '' ? manualValues.pt : (previewBreakdown.pt || calculatePTAmount(salaryPreview.gross) || '')}
                                          onChange={(e) => {
                                            const updated = { ...manualValues, pt: e.target.value };
                                            setManualValues(updated);
                                            recalculateTotalsFromManual(updated);
                                          }}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        />
                                      </div>
                                    )}
                                    {isPTExempt(salaryPreview.gross) && (
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">PT</span>
                                        <span className="text-sm font-medium text-green-600">Exempt</span>
                                      </div>
                                    )}
                                    {salaryPreview.mlwf_applicable && (
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">MLWF</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={manualValues.mlwf !== undefined && manualValues.mlwf !== '' ? manualValues.mlwf : (previewBreakdown.mlwf || currentMLWF || '')}
                                          onChange={(e) => {
                                            const updated = { ...manualValues, mlwf: e.target.value };
                                            setManualValues(updated);
                                            recalculateTotalsFromManual(updated);
                                          }}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        />
                                      </div>
                                    )}
                                    {salaryPreview.retention_applicable && (
                                      <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-600">Retention</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={manualValues.retention !== undefined && manualValues.retention !== '' ? manualValues.retention : (previewBreakdown.retention || currentRetention || '')}
                                          onChange={(e) => {
                                            const updated = { ...manualValues, retention: e.target.value };
                                            setManualValues(updated);
                                            recalculateTotalsFromManual(updated);
                                          }}
                                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        />
                                      </div>
                                    )}
                                    <div className="border-t border-red-300 pt-2 mt-2">
                                      <div className="flex justify-between font-semibold">
                                        <span className="text-red-900">Total Deductions</span>
                                        <span className="text-red-900">₹{formatCurrency(previewBreakdown.total_deductions)}</span>
                                      </div>
                                    </div>
                                    <div className="border-t-2 border-green-400 pt-2 mt-2">
                                      <div className="flex justify-between font-bold text-lg">
                                        <span className="text-green-700">Net Pay (In Hand)</span>
                                        <span className="text-green-700">₹{formatCurrency(previewBreakdown.net_pay)}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* CTC Column */}
                                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                  <h5 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                    </svg>
                                    CTC / Employer Cost
                                  </h5>
                                  <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                      <span className="text-sm text-gray-600">Total Earnings</span>
                                      <span className="text-sm font-medium text-gray-900">₹{formatCurrency(previewBreakdown.total_earnings)}</span>
                                    </div>
                                    <div className="border-t border-blue-200 pt-2 mt-2">
                                      <p className="text-xs text-gray-500 mb-2">Employer Contributions:</p>
                                      {salaryPreview.pf_applicable && (
                                        <div className="flex justify-between items-center">
                                          <span className="text-sm text-gray-600">Empr PF</span>
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={manualValues.pf_employer !== undefined && manualValues.pf_employer !== '' ? manualValues.pf_employer : (previewBreakdown.pf_employer || '')}
                                            onChange={(e) => {
                                              const updated = { ...manualValues, pf_employer: e.target.value };
                                              setManualValues(updated);
                                              recalculateTotalsFromManual(updated);
                                            }}
                                            className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                          />
                                        </div>
                                      )}
                                      {salaryPreview.esic_applicable && (
                                        <div className="flex justify-between items-center">
                                          <span className="text-sm text-gray-600">Empr ESIC</span>
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={manualValues.esic_employer !== undefined && manualValues.esic_employer !== '' ? manualValues.esic_employer : (previewBreakdown.esic_employer || '')}
                                            onChange={(e) => {
                                              const updated = { ...manualValues, esic_employer: e.target.value };
                                              setManualValues(updated);
                                              recalculateTotalsFromManual(updated);
                                            }}
                                            className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                          />
                                        </div>
                                      )}
                                      {salaryPreview.mlwf_applicable && (
                                        <div className="flex justify-between items-center">
                                          <span className="text-sm text-gray-600">Empr MLWF</span>
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={manualValues.mlwf_employer !== undefined && manualValues.mlwf_employer !== '' ? manualValues.mlwf_employer : (previewBreakdown.mlwf_employer || currentMLWFEmployer || '')}
                                            onChange={(e) => {
                                              const updated = { ...manualValues, mlwf_employer: e.target.value };
                                              setManualValues(updated);
                                              recalculateTotalsFromManual(updated);
                                            }}
                                            className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                          />
                                        </div>
                                      )}
                                      {salaryPreview.bonus_applicable && (
                                        <div className="flex justify-between items-center">
                                          <span className="text-sm text-gray-600">Bonus {currentBonus > 0 && <span className="text-xs text-blue-600">({currentBonus}%)</span>}</span>
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={manualValues.bonus !== undefined && manualValues.bonus !== '' ? manualValues.bonus : (previewBreakdown.bonus || '')}
                                            onChange={(e) => {
                                              const updated = { ...manualValues, bonus: e.target.value };
                                              setManualValues(updated);
                                              recalculateTotalsFromManual(updated);
                                            }}
                                            className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                          />
                                        </div>
                                      )}
                                      {salaryPreview.insurance_applicable && (
                                        <div className="flex justify-between items-center">
                                          <span className="text-sm text-gray-600">Insurance (PA/Mediclaim)</span>
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={manualValues.insurance !== undefined && manualValues.insurance !== '' ? manualValues.insurance : (previewBreakdown.insurance || currentInsurance || '')}
                                            onChange={(e) => {
                                              const updated = { ...manualValues, insurance: e.target.value };
                                              setManualValues(updated);
                                              recalculateTotalsFromManual(updated);
                                            }}
                                            className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                          />
                                        </div>
                                      )}
                                    </div>
                                    <div className="border-t-2 border-blue-400 pt-2 mt-2">
                                      <div className="flex justify-between font-bold text-lg">
                                        <span className="text-blue-700">Total CTC</span>
                                        <span className="text-blue-700">₹{formatCurrency(previewBreakdown.employer_cost)}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}

                          {/* Summary for Non-Monthly Types */}
                          {salaryPreview.salary_type !== 'monthly' && (salaryPreview.hourly_rate || salaryPreview.daily_rate || salaryPreview.contract_amount || salaryPreview.lumpsum_amount) && (
                            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5 mb-4">
                              <h5 className="text-lg font-semibold text-indigo-900 mb-4 flex items-center gap-2">
                                <span className="text-xl">
                                  {salaryPreview.salary_type === 'hourly' && '⏰'}
                                  {salaryPreview.salary_type === 'daily' && '📆'}
                                  {salaryPreview.salary_type === 'contract' && '📝'}
                                  {salaryPreview.salary_type === 'lumpsum' && '💰'}
                                </span>
                                {salaryPreview.salary_type.charAt(0).toUpperCase() + salaryPreview.salary_type.slice(1)} Payment Summary
                              </h5>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                                    {salaryPreview.salary_type === 'hourly' && 'Hourly Rate'}
                                    {salaryPreview.salary_type === 'daily' && 'Daily Rate'}
                                    {salaryPreview.salary_type === 'contract' && 'Contract Amount'}
                                    {salaryPreview.salary_type === 'lumpsum' && 'Lumpsum Amount'}
                                  </p>
                                  <p className="text-xl font-bold text-indigo-700">
                                    ₹{formatCurrency(
                                      salaryPreview.hourly_rate || 
                                      salaryPreview.daily_rate || 
                                      salaryPreview.contract_amount || 
                                      salaryPreview.lumpsum_amount || 0
                                    )}
                                  </p>
                                </div>
                                {salaryPreview.salary_type === 'hourly' && (
                                  <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Est. Monthly</p>
                                    <p className="text-xl font-bold text-green-600">
                                      ₹{formatCurrency((parseFloat(salaryPreview.hourly_rate) || 0) * (parseFloat(salaryPreview.std_hours_per_day) || 8) * 26)}
                                    </p>
                                  </div>
                                )}
                                {salaryPreview.salary_type === 'daily' && (
                                  <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Est. Monthly</p>
                                    <p className="text-xl font-bold text-green-600">
                                      ₹{formatCurrency((parseFloat(salaryPreview.daily_rate) || 0) * (parseFloat(salaryPreview.std_working_days) || 26))}
                                    </p>
                                  </div>
                                )}
                                {salaryPreview.salary_type === 'contract' && (
                                  <>
                                    <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Duration</p>
                                      <p className="text-lg font-bold text-gray-700">
                                        {salaryPreview.contract_duration === 'monthly' && 'Monthly'}
                                        {salaryPreview.contract_duration === 'quarterly' && 'Quarterly'}
                                        {salaryPreview.contract_duration === 'half_yearly' && '6 Months'}
                                        {salaryPreview.contract_duration === 'yearly' && 'Yearly'}
                                        {salaryPreview.contract_duration === 'project' && 'Project'}
                                        {!salaryPreview.contract_duration && 'Monthly'}
                                      </p>
                                    </div>
                                    {salaryPreview.contract_end_date && (
                                      <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">End Date</p>
                                        <p className="text-lg font-bold text-orange-600">
                                          {new Date(salaryPreview.contract_end_date).toLocaleDateString('en-IN')}
                                        </p>
                                      </div>
                                    )}
                                  </>
                                )}
                                <div className="bg-white rounded-xl p-4 shadow-sm text-center">
                                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Statutory</p>
                                  <p className="text-lg font-bold text-gray-500">N/A</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Action Buttons */}
                          {(salaryPreview.salary_type === 'monthly' ? previewBreakdown : (salaryPreview.hourly_rate || salaryPreview.daily_rate || salaryPreview.contract_amount || salaryPreview.lumpsum_amount)) && (
                            <>
                              <div className="flex justify-end gap-3 mt-4">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSalaryPreview({
                                      salary_type: 'monthly',
                                      gross: '',
                                      hourly_rate: '',
                                      daily_rate: '',
                                      contract_amount: '',
                                      lumpsum_amount: '',
                                      other_allowances: 0,
                                      pf_applicable: true,
                                      esic_applicable: false,
                                      pt_applicable: false,
                                      mlwf_applicable: false,
                                      retention_applicable: false,
                                      bonus_applicable: false,
                                      incentive_applicable: false,
                                      insurance_applicable: false
                                    });
                                    setPreviewBreakdown(null);
                                    setCurrentDA(0);
                                    setCurrentPT(0);
                                    setCurrentMLWF(0);
                                    setCurrentRetention(0);
                                    setCurrentBonus(0);
                                    setCurrentIncentive(0);
                                    setCurrentInsurance(0);
                                    setPreviewError('');
                                    setManualValues({
                                      basic_plus_da: '',
                                      da: '',
                                      hra: '',
                                      conveyance: '',
                                      call_allowance: '',
                                      bonus: '',
                                      incentive: '',
                                      other_allowances: '',
                                      retention: '',
                                      insurance: '',
                                      pf_employee: '',
                                      esic_employee: '',
                                      pf_employer: '',
                                      esic_employer: ''
                                    });
                                  }}
                                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                                >
                                  Clear
                                </button>
                                <button
                                  type="button"
                                  onClick={handleSaveSalaryProfile}
                                  disabled={salaryProfileSaving}
                                  className={`px-6 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50 flex items-center gap-2 ${
                                    editingSalaryProfileId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
                                  }`}
                                >
                                  {salaryProfileSaving && (
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                  )}
                                  {editingSalaryProfileId ? 'Update Salary Profile' : '+ Add New Salary Profile'}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}

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
                            <label className="block text-sm font-medium text-gray-700 mb-2">PF number</label>
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

                    {/* Navigation Buttons */}
                    <div className="flex justify-between items-center pt-6 border-t border-gray-200">
                      <button
                        type="button"
                        onClick={async () => {
                          const currentIndex = editSubTabOrder.indexOf(editSubTab);
                          if (currentIndex > 0) {
                            // Autosave before navigating
                            if (!profileLocked) await autoSaveEmployee();
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
                        <button type="submit" disabled={loading || profileLocked} className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1">{loading ? 'Saving...' : 'Save'}</button>
                        {editSubTabOrder.indexOf(editSubTab) < editSubTabOrder.length - 1 && (
                          <button
                            type="button"
                            onClick={async () => {
                              const currentIndex = editSubTabOrder.indexOf(editSubTab);
                              if (currentIndex < editSubTabOrder.length - 1) {
                                // Autosave before navigating
                                if (!profileLocked) await autoSaveEmployee();
                                setEditSubTab(editSubTabOrder[currentIndex + 1]);
                              }
                            }}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-[#64126D] to-[#86288F] rounded-lg hover:from-[#86288F] hover:to-[#64126D]"
                          >
                            Next
                            <ChevronRightIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    </fieldset>
                  </form>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
</div>
</AccessGuard>
);
}