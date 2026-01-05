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
    system_role_name: ''
  };
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeTab, setActiveTab] = useState('list'); // Keep for add/edit/view modes
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [formData, setFormData] = useState(defaultFormData);
  const [formErrors, setFormErrors] = useState({});
  const [photoUploading, setPhotoUploading] = useState(false);
  // Roles for System Role assignment
  const [roles, setRoles] = useState([]);
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
      setFormErrors({});
      setEditSubTab('personal');
      setActiveTab('edit');
    } catch (e) {
      console.error('openEditForm_safe failed', e);
    }
  };
  
  // Handle form submission for creating/updating employees
  const handleSubmit = async (e) => {
    e.preventDefault();
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
      
      // Reset form and go back to list
      setTimeout(() => {
        setActiveTab('list');
        setSelectedEmployee(null);
        setFormData(defaultFormData);
        setSuccessMessage('');
      }, 1500);

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
  const [manualOverride, setManualOverride] = useState(false);
  
  // New Salary Preview State (using core payroll tables)
  const [salaryPreview, setSalaryPreview] = useState({
    gross: '',
    other_allowances: '',
    pf_applicable: true,
    esic_applicable: false
  });
  const [currentDA, setCurrentDA] = useState(0);
  const [manualEdit, setManualEdit] = useState(false);
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

  // Manual salary values (used when manualOverride is true)
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

  // Fetch current DA for salary preview - from payroll schedules (da component)
  const fetchCurrentDA = async () => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      
      // First try to get DA from payroll schedules
      const schedulesRes = await fetch(`/api/payroll/schedules?component_type=da&active=true`);
      const schedulesData = await schedulesRes.json();
      
      if (schedulesData.success && schedulesData.data && schedulesData.data.length > 0) {
        // Find the most recent active DA schedule
        const activeDA = schedulesData.data.find(s => {
          const from = new Date(s.effective_from);
          const to = s.effective_to ? new Date(s.effective_to) : new Date('2099-12-31');
          const now = new Date();
          return now >= from && now <= to && s.is_active;
        });
        
        if (activeDA) {
          const daAmount = parseFloat(activeDA.value) || 0;
          setCurrentDA(daAmount);
          return daAmount;
        }
      }
      
      // Fallback to old DA schedule API
      const currentYear = new Date().getFullYear();
      const daRes = await fetch(`/api/payroll/da-schedule/current?date=${currentDate}&year=${currentYear}`);
      const daData = await daRes.json();
      
      if (daData.success && daData.data) {
        const daAmount = parseFloat(daData.data.da_amount) || 0;
        setCurrentDA(daAmount);
        return daAmount;
      }
    } catch (err) {
      console.error('Error fetching DA:', err);
    }
    return 0;
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

  // Calculate Salary Preview (using core payroll tables & frozen rules)
  // If manualEdit is true, use manualValues instead of auto-calculated values
  const calculateSalaryPreview = async (grossInput, otherAllowancesInput, useManual = false) => {
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
      
      // Use current DA (already fetched) or manual DA if in manual edit mode
      let daAmount = currentDA || 0;
      
      if (useManual || manualEdit) {
        // Use manual DA value if provided
        daAmount = parseFloat(manualValues.da) || currentDA || 0;
      } else if (daAmount === null || daAmount === 0) {
        // Fetch current DA based on today's date
        daAmount = await fetchCurrentDA();
      }
      
      let basic_plus_da, hra, conveyance, call_allowance, pf_employee, esic_employee, pf_employer, esic_employer;
      
      if (useManual || manualEdit) {
        // Use manual values if provided, otherwise fall back to calculated
        basic_plus_da = parseFloat(manualValues.basic_plus_da) || Math.round(gross * 0.60);
        hra = parseFloat(manualValues.hra) || Math.round(gross * 0.20);
        conveyance = parseFloat(manualValues.conveyance) || Math.round(gross * 0.10);
        call_allowance = parseFloat(manualValues.call_allowance) || Math.round(gross * 0.10);
        pf_employee = parseFloat(manualValues.pf_employee) || (salaryPreview.pf_applicable ? Math.round(gross * 0.12) : 0);
        esic_employee = parseFloat(manualValues.esic_employee) || (salaryPreview.esic_applicable ? Math.round(gross * 0.0075) : 0);
        pf_employer = parseFloat(manualValues.pf_employer) || (salaryPreview.pf_applicable ? Math.round(gross * 0.13) : 0);
        esic_employer = parseFloat(manualValues.esic_employer) || (salaryPreview.esic_applicable ? Math.round(gross * 0.0325) : 0);
      } else {
        // Calculate using frozen PAYROLL_CONFIG rules (60/20/10/10)
        basic_plus_da = Math.round(gross * 0.60);
        
        hra = Math.round(gross * 0.20);
        conveyance = Math.round(gross * 0.10);
        call_allowance = Math.round(gross * 0.10);
        pf_employee = salaryPreview.pf_applicable ? Math.round(gross * 0.12) : 0;
        esic_employee = salaryPreview.esic_applicable ? Math.round(gross * 0.0075) : 0;
        pf_employer = salaryPreview.pf_applicable ? Math.round(gross * 0.13) : 0;
        esic_employer = salaryPreview.esic_applicable ? Math.round(gross * 0.0325) : 0;
      }
      
      // Total earnings = sum of all earning components including DA and other allowances
      const total_earnings = basic_plus_da + daAmount + hra + conveyance + call_allowance + otherAllowances;
      const total_deductions = pf_employee + esic_employee;
      const net_pay = total_earnings - total_deductions;
      const employer_cost = total_earnings + pf_employer + esic_employer;
      
      setPreviewBreakdown({
        gross: gross, // Keep original gross for percentage calculations
        basic_plus_da,
        da: daAmount,
        hra,
        conveyance,
        call_allowance,
        other_allowances: otherAllowances,
        total_earnings,
        pf_employee,
        esic_employee,
        total_deductions,
        net_pay,
        pf_employer,
        esic_employer,
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
  const [loadingSavedProfiles, setLoadingSavedProfiles] = useState(false);
  const [deletingSalaryProfile, setDeletingSalaryProfile] = useState(false);
  
  // Fetch saved salary profiles for an employee
  const fetchSavedSalaryProfiles = async (employeeId) => {
    if (!employeeId) return;
    setLoadingSavedProfiles(true);
    try {
      const res = await fetch(`/api/payroll/salary-profile?employee_id=${employeeId}`);
      const data = await res.json();
      if (data.success && data.data) {
        setSavedSalaryProfiles(data.data);
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
      setSalaryProfileSuccess('Salary profile deleted successfully');
      setTimeout(() => setSalaryProfileSuccess(''), 3000);
    } catch (err) {
      console.error('Error deleting salary profile:', err);
      setPreviewError('Failed to delete: ' + err.message);
    } finally {
      setDeletingSalaryProfile(false);
    }
  };
  
  const handleSaveSalaryProfile = async () => {
    if (!selectedEmployee?.id) {
      setPreviewError('No employee selected');
      return;
    }
    
    if (!salaryPreview.gross) {
      setPreviewError('Please enter gross salary');
      return;
    }
    
    if (!previewBreakdown) {
      setPreviewError('Please enter a gross salary first to calculate breakdown');
      return;
    }
    
    setSalaryProfileSaving(true);
    setPreviewError('');
    setSalaryProfileSuccess('');
    
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const currentYear = new Date().getFullYear();
      
      const payload = {
        employee_id: selectedEmployee.id,
        gross_salary: parseFloat(salaryPreview.gross),
        other_allowances: parseFloat(salaryPreview.other_allowances) || 0,
        pf_applicable: salaryPreview.pf_applicable,
        esic_applicable: salaryPreview.esic_applicable,
        effective_from: currentDate,
        da_year: currentYear,
        // Include breakdown values (manual or calculated)
        basic_plus_da: previewBreakdown.basic_plus_da,
        da: previewBreakdown.da,
        hra: previewBreakdown.hra,
        conveyance: previewBreakdown.conveyance,
        call_allowance: previewBreakdown.call_allowance,
        pf_employee: previewBreakdown.pf_employee,
        esic_employee: previewBreakdown.esic_employee,
        pf_employer: previewBreakdown.pf_employer,
        esic_employer: previewBreakdown.esic_employer,
        total_earnings: previewBreakdown.total_earnings,
        total_deductions: previewBreakdown.total_deductions,
        net_pay: previewBreakdown.net_pay,
        employer_cost: previewBreakdown.employer_cost,
        is_manual_override: manualEdit
      };
      
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
      
      setSalaryProfileSuccess('✓ Salary profile saved successfully!');
      
      // Refresh saved profiles to show the new/updated record
      await fetchSavedSalaryProfiles(selectedEmployee.id);
      
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
  const handleSaveSalaryStructure = async () => {
    if (!selectedEmployee?.id) return;
    setSalaryLoading(true);
    setSalaryError('');
    try {
      const res = await fetch(`/api/employees/${selectedEmployee.id}/salary-structure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...salaryFormData,
          components: salaryComponents
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save salary structure');
      
      // Refresh salary structures
      await fetchSalaryStructures(selectedEmployee.id);
      setShowSalaryForm(false);
      setSuccessMessage('Salary structure saved successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error saving salary structure:', err);
      setSalaryError(err.message);
    } finally {
      setSalaryLoading(false);
    }
  };

  // Add component to salary structure
  const addSalaryComponent = () => {
    setSalaryComponents([...salaryComponents, {
      component_name: '',
      component_code: '',
      component_type: 'earning',
      calculation_type: 'fixed',
      fixed_amount: '',
      percentage_value: '',
      percentage_of: 'basic',
      is_taxable: true,
      is_statutory: false,
      statutory_type: '',
      show_in_slip: true
    }]);
  };

  // Remove component from salary structure
  const removeSalaryComponent = (index) => {
    setSalaryComponents(salaryComponents.filter((_, i) => i !== index));
  };

  // Update component
  const updateSalaryComponent = (index, field, value) => {
    const updated = [...salaryComponents];
    updated[index] = { ...updated[index], [field]: value };
    setSalaryComponents(updated);
  };

  // Reset salary form
  const resetSalaryForm = () => {
    setSalaryFormData({
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
    setSalaryComponents([]);
    setCalculatedBreakdown(null);
    setManualOverride(false);
    setManualSalaryValues({
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
  };

  // State for editing salary structure
  const [editingSalaryStructure, setEditingSalaryStructure] = useState(null);

  // Edit salary structure - load data into form
  const handleEditSalaryStructure = (structure) => {
    setEditingSalaryStructure(structure);
    setSalaryFormData({
      pay_type: structure.pay_type || 'monthly',
      effective_from: structure.effective_from ? new Date(structure.effective_from).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      ctc: structure.ctc || '',
      gross_salary: structure.gross_salary || '',
      basic_salary: structure.basic_salary || '',
      hourly_rate: structure.hourly_rate || '',
      daily_rate: structure.daily_rate || '',
      ot_multiplier: structure.ot_multiplier || '1.5',
      pf_applicable: structure.pf_applicable === 1,
      esic_applicable: structure.esic_applicable === 1,
      pt_applicable: structure.pt_applicable === 1,
      mlwf_applicable: structure.mlwf_applicable === 1,
      tds_applicable: structure.tds_applicable === 1,
      pf_wage_ceiling: structure.pf_wage_ceiling || '15000',
      standard_working_days: structure.standard_working_days || '26',
      standard_hours_per_day: structure.standard_hours_per_day || '8',
      remarks: structure.remarks || ''
    });
    setSalaryComponents(structure.components || []);
    setShowSalaryForm(true);
    
    // Calculate breakdown for edit mode
    if (structure.basic_salary) {
      const breakdown = calculateSalaryBreakdown(
        structure.basic_salary,
        structure.pf_applicable === 1,
        structure.esic_applicable === 1,
        structure.pf_wage_ceiling || '15000',
        salaryPercentages
      );
      setCalculatedBreakdown(breakdown);
    }
  };

  // Update existing salary structure
  const handleUpdateSalaryStructure = async () => {
    if (!selectedEmployee?.id || !editingSalaryStructure?.id) return;
    setSalaryLoading(true);
    setSalaryError('');
    try {
      const res = await fetch(`/api/employees/${selectedEmployee.id}/salary-structure`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salary_structure_id: editingSalaryStructure.id,
          ...salaryFormData,
          components: salaryComponents
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update salary structure');
      
      // Refresh salary structures
      await fetchSalaryStructures(selectedEmployee.id);
      setShowSalaryForm(false);
      setEditingSalaryStructure(null);
      resetSalaryForm();
      setSuccessMessage('Salary structure updated successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error updating salary structure:', err);
      setSalaryError(err.message);
    } finally {
      setSalaryLoading(false);
    }
  };

  // Delete salary structure
  const handleDeleteSalaryStructure = async (structureId) => {
    if (!selectedEmployee?.id || !structureId) return;
    
    if (!confirm('Are you sure you want to delete this salary structure? This action cannot be undone.')) {
      return;
    }
    
    setSalaryLoading(true);
    setSalaryError('');
    try {
      const res = await fetch(`/api/employees/${selectedEmployee.id}/salary-structure?structureId=${structureId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete salary structure');
      
      // Refresh salary structures
      await fetchSalaryStructures(selectedEmployee.id);
      setSuccessMessage('Salary structure deleted successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error deleting salary structure:', err);
      setSalaryError(err.message);
    } finally {
      setSalaryLoading(false);
    }
  };

  // Cancel editing
  const handleCancelSalaryEdit = () => {
    setShowSalaryForm(false);
    setEditingSalaryStructure(null);
    resetSalaryForm();
  };

  // Calculate breakdown from Gross Salary (reverse calculation)
  const calculateFromGrossSalary = useCallback((grossSalary, pfApplicable, esicApplicable, pfCeiling, percentages) => {
    const monthlyGross = parseFloat(grossSalary) || 0;

    if (monthlyGross === 0) return null;

    // Get percentages with defaults
    const {
      basic_percent = 60,
      da_fixed = 2000,
    } = percentages || {};

    // Basic = 60% of Gross
    const monthlyBasic = Math.round(monthlyGross * (basic_percent / 100));
    
    // DA = Fixed amount
    const monthlyDA = da_fixed;

    // Now use the standard calculation with the derived basic and DA
    return calculateSalaryBreakdown(monthlyBasic, monthlyDA, pfApplicable, esicApplicable, pfCeiling, percentages);
  }, []);

  // Auto-calculate Indian Payroll Salary Breakdown - Complete Breakdown
  // Based on: Gross = Basic (60%) + DA (Fixed) + HRA (20%) + Conveyance
  const calculateSalaryBreakdown = useCallback((basicSalary, daSalary, pfApplicable, esicApplicable, pfCeiling, percentages) => {
    const monthlyBasic = parseFloat(basicSalary) || 0;
    const monthlyDA = parseFloat(daSalary) || 0;

    if (monthlyBasic === 0) return null;

    // Get percentages with defaults
    const {
      basic_percent = 60,
      hra_percent = 20,
      conveyance: conveyanceFixed = 1600,
      employee_pf_percent = 12,
      employer_pf_percent = 12,
      employee_esic_percent = 0.75,
      employer_esic_percent = 3.25,
      gratuity_percent = 4.81,
      pf_admin_percent = 0.5,
      edli_percent = 0.5,
    } = percentages || {};

    // Calculate Gross from Basic (Basic = 60% of Gross, so Gross = Basic / 0.6)
    const calculatedGross = Math.round(monthlyBasic / (basic_percent / 100));

    // HRA: 20% of Gross
    const hra = Math.round(calculatedGross * (hra_percent / 100));
    
    // Conveyance Allowance (Transport Allowance) - Fixed amount
    const conveyance = conveyanceFixed;
    
    // Medical Allowance - Removed (set to 0)
    const medical = 0;
    
    // Calculate gross from components: Gross = Basic + DA + HRA + Conveyance
    const monthlyGross = monthlyBasic + monthlyDA + hra + conveyance;
    
    // Special Allowance - No longer needed as we're not balancing
    const specialAllowance = 0;

    const totalEarnings = monthlyGross;

    // ═══════════════════════════════════════════════════════════════════
    // EMPLOYEE DEDUCTIONS
    // ═══════════════════════════════════════════════════════════════════
    
    // PF Calculation Base (capped at ₹15,000 unless "actual" selected)
    const pfWageBase = pfCeiling === 'actual' ? monthlyBasic : Math.min(monthlyBasic, 15000);
    
    // Employee PF: % of Basic (or PF wage ceiling)
    const employeePF = pfApplicable ? Math.round(pfWageBase * (employee_pf_percent / 100)) : 0;
    
    // Employee Pension Scheme (EPS): Part of PF - 8.33% of Basic (max ₹15,000)
    const epsBase = Math.min(monthlyBasic, 15000);
    
    // EPF (actual EPF contribution) = Employee PF
    const employeeEPF = pfApplicable ? employeePF : 0;
    
    // ESI: % of Gross (only if Gross ≤ ₹21,000)
    const esicEligible = esicApplicable && monthlyGross <= 21000;
    const employeeESIC = esicEligible ? Math.round(monthlyGross * (employee_esic_percent / 100)) : 0;

    // Professional Tax (Maharashtra slab - varies by state)
    let pt = 0;
    if (monthlyGross > 10000) pt = 200;
    else if (monthlyGross > 7500) pt = 175;
    else if (monthlyGross > 5000) pt = 150;

    // Labour Welfare Fund (LWF) - Maharashtra (June & December)
    const lwf = 0; // Usually ₹25 twice a year, keeping 0 for monthly

    // TDS (Income Tax) - Placeholder, requires full tax calculation
    const tds = 0; // Will be calculated based on annual income & regime

    const totalEmployeeDeductions = employeePF + employeeESIC + pt + lwf + tds;

    // ═══════════════════════════════════════════════════════════════════
    // EMPLOYER CONTRIBUTIONS (Not deducted from salary)
    // ═══════════════════════════════════════════════════════════════════
    
    // Employer PF: % of Basic (3.67% to EPF + 8.33% to EPS)
    const employerPF = pfApplicable ? Math.round(pfWageBase * (employer_pf_percent / 100)) : 0;
    const employerEPF = pfApplicable ? Math.round(pfWageBase * 0.0367) : 0; // 3.67% to EPF
    const employerEPS = pfApplicable ? Math.round(epsBase * 0.0833) : 0; // 8.33% to EPS (max on 15k)
    
    // Employer ESI: % of Gross
    const employerESIC = esicEligible ? Math.round(monthlyGross * (employer_esic_percent / 100)) : 0;
    
    // PF Admin Charges: % of Basic
    const pfAdminCharges = pfApplicable ? Math.round(pfWageBase * (pf_admin_percent / 100)) : 0;
    
    // EDLI (Employee Deposit Linked Insurance): % of Basic
    const edliCharges = pfApplicable ? Math.round(pfWageBase * (edli_percent / 100)) : 0;
    
    // EDLI Admin: 0.01% (negligible, keeping for accuracy)
    const edliAdmin = pfApplicable ? Math.round(pfWageBase * 0.0001) : 0;

    // Gratuity Provision: % of Basic (for 5+ years service)
    const gratuity = Math.round(monthlyBasic * (gratuity_percent / 100));

    const totalEmployerContributions = employerPF + employerESIC + pfAdminCharges + edliCharges + edliAdmin + gratuity;

    // ═══════════════════════════════════════════════════════════════════
    // NET PAY & CTC CALCULATIONS
    // ═══════════════════════════════════════════════════════════════════
    
    const netSalary = totalEarnings - totalEmployeeDeductions;
    const monthlyCtc = monthlyGross + totalEmployerContributions;
    const annualCTC = monthlyCtc * 12;

    // ═══════════════════════════════════════════════════════════════════
    // ANNUAL CALCULATIONS
    // ═══════════════════════════════════════════════════════════════════
    
    const annualBasic = monthlyBasic * 12;
    const annualHRA = hra * 12;
    const annualGross = monthlyGross * 12;
    const annualNet = netSalary * 12;

    return {
      // Monthly Earnings
      earnings: {
        basic: monthlyBasic,
        da: monthlyDA,
        hra: hra,
        hraPercent: `${hra_percent}%`,
        conveyance: conveyance,
        medical: medical,
        specialAllowance: specialAllowance,
        total: totalEarnings
      },
      // Monthly Employee Deductions
      deductions: {
        employeePF: employeePF,
        employeePFPercent: employee_pf_percent,
        employeeEPF: employeeEPF,
        employeeESIC: employeeESIC,
        employeeESICPercent: employee_esic_percent,
        pt: pt,
        lwf: lwf,
        tds: tds,
        total: totalEmployeeDeductions
      },
      // Monthly Employer Contributions
      employer: {
        pf: employerPF,
        pfPercent: employer_pf_percent,
        epf: employerEPF,
        eps: employerEPS,
        esic: employerESIC,
        esicPercent: employer_esic_percent,
        pfAdmin: pfAdminCharges,
        pfAdminPercent: pf_admin_percent,
        edli: edliCharges,
        edliPercent: edli_percent,
        edliAdmin: edliAdmin,
        gratuity: gratuity,
        gratuityPercent: gratuity_percent,
        total: totalEmployerContributions
      },
      // PF Details
      pfDetails: {
        wageBase: pfWageBase,
        employeeContribution: employeePF,
        employeePercent: employee_pf_percent,
        employerEPF: employerEPF,
        employerEPS: employerEPS,
        employerPercent: employer_pf_percent,
        totalPF: employeePF + employerPF,
        annualPF: (employeePF + employerPF) * 12
      },
      // Summary
      summary: {
        grossSalary: monthlyGross,
        totalDeductions: totalEmployeeDeductions,
        netSalary: netSalary,
        employerCost: totalEmployerContributions,
        totalCTC: monthlyCtc,
        annualBasic: annualBasic,
        annualHRA: annualHRA,
        annualGross: annualGross,
        annualDeductions: totalEmployeeDeductions * 12,
        annualNet: annualNet,
        annualEmployerCost: totalEmployerContributions * 12,
        annualCTC: annualCTC
      },
      // Percentages used
      percentages: {
        hra: hra_percent,
        employeePF: employee_pf_percent,
        employerPF: employer_pf_percent,
        employeeESIC: employee_esic_percent,
        employerESIC: employer_esic_percent,
        gratuity: gratuity_percent,
        pfAdmin: pf_admin_percent,
        edli: edli_percent
      },
      // Flags
      flags: {
        pfApplicable: pfApplicable,
        esicApplicable: esicApplicable,
        esicEligible: esicEligible,
        pfCeiling: pfCeiling
      }
    };
  }, []);

  // Handle salary field changes with auto-calculation
  const handleSalaryFieldChange = (field, value) => {
    const newFormData = { ...salaryFormData, [field]: value };
    setSalaryFormData(newFormData);

    // Skip auto-calculation in manual mode
    if (manualOverride) {
      // In manual mode, calculate gross and CTC from manual values
      if (field === 'gross_salary') {
        // Derive basic from gross in manual mode
        const gross = parseFloat(value) || 0;
        const basic = Math.round(gross / 2);
        setSalaryFormData(prev => ({ ...prev, gross_salary: value, basic_salary: basic.toString() }));
        recalculateManualTotals(basic.toString());
      }
      return;
    }

    // Recalculate breakdown when relevant fields change (auto mode)
    if (['gross_salary', 'pf_applicable', 'esic_applicable', 'pf_wage_ceiling'].includes(field)) {
      const breakdown = calculateFromGrossSalary(
        field === 'gross_salary' ? value : newFormData.gross_salary,
        field === 'pf_applicable' ? value : newFormData.pf_applicable,
        field === 'esic_applicable' ? value : newFormData.esic_applicable,
        field === 'pf_wage_ceiling' ? value : newFormData.pf_wage_ceiling,
        salaryPercentages
      );
      setCalculatedBreakdown(breakdown);
      
      // Auto-fill basic and CTC from gross
      if (field === 'gross_salary' && breakdown) {
        setSalaryFormData(prev => ({
          ...prev,
          gross_salary: value,
          basic_salary: breakdown.earnings.basic.toString(),
          ctc: breakdown.summary.annualCTC.toString()
        }));
      }
    }
  };

  // Handle manual salary value changes
  const handleManualValueChange = (field, value) => {
    const newValues = { ...manualSalaryValues, [field]: value };
    setManualSalaryValues(newValues);
    recalculateManualTotals(salaryFormData.basic_salary, newValues);
  };

  // Recalculate totals in manual mode
  const recalculateManualTotals = (basicSalary, values = manualSalaryValues) => {
    const basic = parseFloat(basicSalary) || 0;
    const hra = parseFloat(values.hra) || 0;
    const conveyance = parseFloat(values.conveyance) || 0;
    const medical = parseFloat(values.medical) || 0;
    const specialAllowance = parseFloat(values.special_allowance) || 0;
    const employeePf = parseFloat(values.employee_pf) || 0;
    const employerPf = parseFloat(values.employer_pf) || 0;
    const employeeEsic = parseFloat(values.employee_esic) || 0;
    const employerEsic = parseFloat(values.employer_esic) || 0;
    const gratuity = parseFloat(values.gratuity) || 0;
    const pt = parseFloat(values.pt) || 0;

    const grossSalary = basic + hra + conveyance + medical + specialAllowance;
    const totalDeductions = employeePf + employeeEsic + pt;
    const employerContributions = employerPf + employerEsic + gratuity;
    const netSalary = grossSalary - totalDeductions;
    const monthlyCTC = grossSalary + employerContributions;
    const annualCTC = monthlyCTC * 12;

    setSalaryFormData(prev => ({
      ...prev,
      gross_salary: grossSalary.toString(),
      ctc: annualCTC.toString()
    }));

    // Set calculated breakdown for display
    setCalculatedBreakdown({
      earnings: {
        basic: basic,
        hra: hra,
        hraPercent: basic > 0 ? `${((hra / basic) * 100).toFixed(1)}%` : '0%',
        conveyance: conveyance,
        medical: medical,
        specialAllowance: specialAllowance,
        total: grossSalary
      },
      deductions: {
        employeePF: employeePf,
        employeePFPercent: basic > 0 ? ((employeePf / basic) * 100).toFixed(2) : 0,
        employeeEPF: employeePf,
        employeeESIC: employeeEsic,
        employeeESICPercent: grossSalary > 0 ? ((employeeEsic / grossSalary) * 100).toFixed(2) : 0,
        pt: pt,
        lwf: 0,
        tds: 0,
        total: totalDeductions
      },
      employer: {
        pf: employerPf,
        pfPercent: basic > 0 ? ((employerPf / basic) * 100).toFixed(2) : 0,
        epf: Math.round(employerPf * 0.3058),
        eps: Math.round(employerPf * 0.6942),
        esic: employerEsic,
        esicPercent: grossSalary > 0 ? ((employerEsic / grossSalary) * 100).toFixed(2) : 0,
        pfAdmin: 0,
        edli: 0,
        edliAdmin: 0,
        gratuity: gratuity,
        gratuityPercent: basic > 0 ? ((gratuity / basic) * 100).toFixed(2) : 0,
        total: employerContributions
      },
      summary: {
        grossSalary: grossSalary,
        totalDeductions: totalDeductions,
        netSalary: netSalary,
        employerCost: employerContributions,
        totalCTC: monthlyCTC,
        annualBasic: basic * 12,
        annualHRA: hra * 12,
        annualGross: grossSalary * 12,
        annualDeductions: totalDeductions * 12,
        annualNet: netSalary * 12,
        annualEmployerCost: employerContributions * 12,
        annualCTC: annualCTC
      },
      percentages: {
        hra: basic > 0 ? ((hra / basic) * 100).toFixed(1) : 0,
        employeePF: basic > 0 ? ((employeePf / basic) * 100).toFixed(2) : 0,
        employerPF: basic > 0 ? ((employerPf / basic) * 100).toFixed(2) : 0,
        employeeESIC: grossSalary > 0 ? ((employeeEsic / grossSalary) * 100).toFixed(2) : 0,
        employerESIC: grossSalary > 0 ? ((employerEsic / grossSalary) * 100).toFixed(2) : 0,
        gratuity: basic > 0 ? ((gratuity / basic) * 100).toFixed(2) : 0,
        pfAdmin: 0,
        edli: 0
      },
      pfDetails: {
        wageBase: Math.min(basic, 15000),
        employeeContribution: employeePf,
        employeePercent: basic > 0 ? ((employeePf / basic) * 100).toFixed(2) : 0,
        employerEPF: Math.round(employerPf * 0.3058),
        employerEPS: Math.round(employerPf * 0.6942),
        employerPercent: basic > 0 ? ((employerPf / basic) * 100).toFixed(2) : 0,
        totalPF: employeePf + employerPf,
        annualPF: (employeePf + employerPf) * 12
      },
      flags: {
        pfApplicable: salaryFormData.pf_applicable,
        esicApplicable: salaryFormData.esic_applicable,
        esicEligible: salaryFormData.esic_applicable && grossSalary <= 21000,
        manualMode: true
      }
    });
  };

  // Toggle manual override mode
  const toggleManualOverride = () => {
    const newManualMode = !manualOverride;
    setManualOverride(newManualMode);
    
    if (newManualMode && calculatedBreakdown) {
      // When switching to manual, populate fields with calculated values
      setManualSalaryValues({
        hra: calculatedBreakdown.earnings?.hra?.toString() || '',
        conveyance: calculatedBreakdown.earnings?.conveyance?.toString() || '',
        medical: calculatedBreakdown.earnings?.medical?.toString() || '',
        special_allowance: calculatedBreakdown.earnings?.specialAllowance?.toString() || '',
        employee_pf: calculatedBreakdown.deductions?.employeePF?.toString() || '',
        employer_pf: calculatedBreakdown.employer?.pf?.toString() || '',
        employee_esic: calculatedBreakdown.deductions?.employeeESIC?.toString() || '',
        employer_esic: calculatedBreakdown.employer?.esic?.toString() || '',
        gratuity: calculatedBreakdown.employer?.gratuity?.toString() || '',
        pt: calculatedBreakdown.deductions?.pt?.toString() || '',
      });
    } else if (!newManualMode && salaryFormData.basic_salary) {
      // When switching back to auto, recalculate from percentages
      const breakdown = calculateSalaryBreakdown(
        salaryFormData.basic_salary,
        salaryFormData.pf_applicable,
        salaryFormData.esic_applicable,
        salaryFormData.pf_wage_ceiling,
        salaryPercentages
      );
      setCalculatedBreakdown(breakdown);
      if (breakdown) {
        setSalaryFormData(prev => ({
          ...prev,
          gross_salary: breakdown.summary.grossSalary.toString(),
          ctc: breakdown.summary.annualCTC.toString()
        }));
      }
    }
  };

  // Handle percentage changes
  const handlePercentageChange = (field, value) => {
    const newPercentages = { ...salaryPercentages, [field]: parseFloat(value) || 0 };
    setSalaryPercentages(newPercentages);
    
    // Recalculate breakdown with new percentages
    if (salaryFormData.gross_salary) {
      const breakdown = calculateFromGrossSalary(
        salaryFormData.gross_salary,
        salaryFormData.pf_applicable,
        salaryFormData.esic_applicable,
        salaryFormData.pf_wage_ceiling,
        newPercentages
      );
      setCalculatedBreakdown(breakdown);
      
      if (breakdown) {
        setSalaryFormData(prev => ({
          ...prev,
          gross_salary: breakdown.summary.grossSalary.toString(),
          ctc: breakdown.summary.annualCTC.toString()
        }));
      }
    }
  };

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
  }, [currentPage, searchTerm, selectedDepartment, selectedStatus]);

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
                        { key: 'salary', label: 'Salary Structure' },
                        { key: 'academic', label: 'Academic & Experience' },
                        { key: 'govt', label: 'Government IDs' },
                        { key: 'bank', label: 'Bank Details' },
                        { key: 'attendance', label: 'Attendance & Exit' },
                      ].map((t) => (
                        <button
                          key={t.key}
                          onClick={async () => {
                            setEditSubTab(t.key);
                            if (t.key === 'salary' && selectedEmployee?.id) {
                              fetchSalaryStructures(selectedEmployee.id);
                              // Fetch current DA when salary tab is opened
                              await fetchCurrentDA();
                              // Fetch saved salary profiles
                              await fetchSavedSalaryProfiles(selectedEmployee.id);
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
                        </div>
                      </div>
                    )}


                    {/* Salary Structure Preview */}
                    {editSubTab === 'salary' && (
                      <div>
                        {/* Saved Salary Profiles Section */}
                        {savedSalaryProfiles.length > 0 && (
                          <div className="mb-6 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                              <h5 className="text-sm font-semibold text-purple-900 flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Current Salary Profile
                              </h5>
                              <div className="flex items-center gap-2">
                                {loadingSavedProfiles && (
                                  <span className="text-xs text-purple-600">Loading...</span>
                                )}
                                <button
                                  onClick={() => handleDeleteSalaryProfile(savedSalaryProfiles[0]?.id)}
                                  disabled={deletingSalaryProfile}
                                  className="px-2 py-1 text-xs bg-red-50 text-red-600 hover:bg-red-100 rounded-lg border border-red-200 transition-colors flex items-center gap-1 disabled:opacity-50"
                                  title="Delete salary profile"
                                >
                                  {deletingSalaryProfile ? (
                                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                  ) : (
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  )}
                                  Delete
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                              <div className="bg-white rounded-lg p-3 shadow-sm">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Gross Salary</p>
                                <p className="text-lg font-bold text-gray-900">₹{(savedSalaryProfiles[0]?.gross_salary || savedSalaryProfiles[0]?.gross || 0).toLocaleString('en-IN')}</p>
                              </div>
                              <div className="bg-white rounded-lg p-3 shadow-sm">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Basic</p>
                                <p className="text-lg font-bold text-gray-900">₹{(savedSalaryProfiles[0]?.basic_plus_da || 0).toLocaleString('en-IN')}</p>
                              </div>
                              <div className="bg-white rounded-lg p-3 shadow-sm">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Net Pay</p>
                                <p className="text-lg font-bold text-green-600">₹{(savedSalaryProfiles[0]?.net_pay || 0).toLocaleString('en-IN')}</p>
                              </div>
                              <div className="bg-white rounded-lg p-3 shadow-sm">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Employer Cost</p>
                                <p className="text-lg font-bold text-blue-600">₹{(savedSalaryProfiles[0]?.employer_cost || 0).toLocaleString('en-IN')}</p>
                              </div>
                              <div className="bg-white rounded-lg p-3 shadow-sm">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Effective From</p>
                                <p className="text-sm font-semibold text-gray-900">{savedSalaryProfiles[0]?.effective_from ? new Date(savedSalaryProfiles[0].effective_from).toLocaleDateString('en-IN') : '-'}</p>
                              </div>
                              <div className="bg-white rounded-lg p-3 shadow-sm">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Status</p>
                                <div className="flex items-center gap-1">
                                  {savedSalaryProfiles[0]?.pf_applicable ? (
                                    <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] rounded font-medium">PF</span>
                                  ) : null}
                                  {savedSalaryProfiles[0]?.esic_applicable ? (
                                    <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded font-medium">ESIC</span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                            
                            {/* Detailed Breakdown - Collapsible */}
                            <details className="mt-3">
                              <summary className="text-xs text-purple-700 cursor-pointer hover:text-purple-900 font-medium">
                                View Full Breakdown →
                              </summary>
                              <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">Basic</p>
                                  <p className="font-semibold">₹{(savedSalaryProfiles[0]?.basic_plus_da || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">DA</p>
                                  <p className="font-semibold">₹{(savedSalaryProfiles[0]?.da || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">HRA</p>
                                  <p className="font-semibold">₹{(savedSalaryProfiles[0]?.hra || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">Conveyance</p>
                                  <p className="font-semibold">₹{(savedSalaryProfiles[0]?.conveyance || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">Call Allow.</p>
                                  <p className="font-semibold">₹{(savedSalaryProfiles[0]?.call_allowance || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">PF (Emp)</p>
                                  <p className="font-semibold text-red-600">₹{(savedSalaryProfiles[0]?.pf_employee || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">ESIC (Emp)</p>
                                  <p className="font-semibold text-red-600">₹{(savedSalaryProfiles[0]?.esic_employee || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">PF (Empr)</p>
                                  <p className="font-semibold text-blue-600">₹{(savedSalaryProfiles[0]?.pf_employer || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">ESIC (Empr)</p>
                                  <p className="font-semibold text-blue-600">₹{(savedSalaryProfiles[0]?.esic_employer || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">Total Earnings</p>
                                  <p className="font-semibold text-green-600">₹{(savedSalaryProfiles[0]?.total_earnings || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">Deductions</p>
                                  <p className="font-semibold text-red-600">₹{(savedSalaryProfiles[0]?.total_deductions || 0).toLocaleString('en-IN')}</p>
                                </div>
                                <div className="bg-white/80 rounded p-2">
                                  <p className="text-gray-500">Other Allow.</p>
                                  <p className="font-semibold">₹{(savedSalaryProfiles[0]?.other_allowances || 0).toLocaleString('en-IN')}</p>
                                </div>
                              </div>
                            </details>
                          </div>
                        )}
                        
                        {/* Success Message */}
                        {salaryProfileSuccess && (
                          <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                            <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                            <div>
                              <p className="font-semibold text-green-800">{salaryProfileSuccess}</p>
                              <p className="text-sm text-green-600">Salary profile has been saved to the database.</p>
                            </div>
                          </div>
                        )}
                        
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-lg font-semibold text-gray-900">
                            {savedSalaryProfiles.length > 0 ? 'Update Salary Structure' : 'Create Salary Structure'}
                          </h4>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center cursor-pointer text-xs">
                              <input 
                                type="checkbox" 
                                checked={manualEdit} 
                                onChange={(e) => {
                                  setManualEdit(e.target.checked);
                                  if (!e.target.checked) {
                                    // Reset manual values and recalculate
                                    setManualValues({
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
                                    calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances, false);
                                  }
                                }}
                                className="w-3.5 h-3.5 text-orange-600 rounded focus:ring-orange-500 mr-1.5" 
                              />
                              <span className="text-orange-600 font-medium">Manual Edit</span>
                            </label>
                            <a 
                              href="/admin/payroll-schedules" 
                              target="_blank"
                              className="text-xs text-purple-600 hover:text-purple-700 underline flex items-center gap-1"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              Manage Payroll Schedules
                            </a>
                          </div>
                        </div>
                        
                        {/* Input Form - Compact */}
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Gross *</label>
                              <input 
                                type="number" 
                                value={salaryPreview.gross} 
                                onChange={(e) => {
                                  setSalaryPreview({ ...salaryPreview, gross: e.target.value });
                                  calculateSalaryPreview(e.target.value, salaryPreview.other_allowances);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500" 
                                placeholder="50000"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">
                                DA Amount
                                {!manualEdit && <span className="text-[10px] text-gray-500 ml-1">(from schedule)</span>}
                              </label>
                              <input 
                                type="number" 
                                value={manualEdit ? (manualValues.da || currentDA || '') : (currentDA || '')} 
                                onChange={(e) => {
                                  if (manualEdit) {
                                    setManualValues({ ...manualValues, da: e.target.value });
                                    setCurrentDA(parseFloat(e.target.value) || 0);
                                    calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances, true);
                                  }
                                }}
                                readOnly={!manualEdit}
                                className={`w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 ${
                                  manualEdit 
                                    ? 'border-orange-300 focus:ring-orange-500 bg-orange-50' 
                                    : 'border-gray-300 bg-gray-100 cursor-not-allowed focus:ring-purple-500'
                                }`}
                                placeholder="5000"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Other Allow.</label>
                              <input 
                                type="number" 
                                value={salaryPreview.other_allowances} 
                                onChange={(e) => {
                                  setSalaryPreview({ ...salaryPreview, other_allowances: e.target.value });
                                  calculateSalaryPreview(salaryPreview.gross, e.target.value);
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500" 
                                placeholder="0"
                              />
                            </div>
                          </div>
                          
                          <div className="flex gap-4 text-xs">
                            <label className="flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                checked={salaryPreview.pf_applicable} 
                                onChange={(e) => {
                                  setSalaryPreview({ ...salaryPreview, pf_applicable: e.target.checked });
                                  calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances);
                                }}
                                className="w-3.5 h-3.5 text-purple-600 rounded focus:ring-purple-500" 
                              />
                              <span className="ml-1.5 text-gray-700">PF</span>
                            </label>
                            <label className="flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                checked={salaryPreview.esic_applicable} 
                                onChange={(e) => {
                                  setSalaryPreview({ ...salaryPreview, esic_applicable: e.target.checked });
                                  calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances);
                                }}
                                className="w-3.5 h-3.5 text-purple-600 rounded focus:ring-purple-500" 
                              />
                              <span className="ml-1.5 text-gray-700">ESIC</span>
                            </label>
                          </div>
                        </div>

                        {/* Error Display */}
                        {previewError && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-2 mb-3">
                            <p className="text-xs text-red-800">{previewError}</p>
                          </div>
                        )}

                        {/* Manual Edit Info Banner */}
                        {manualEdit && (
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 mb-3">
                            <p className="text-xs text-orange-800 flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                              Manual Edit Mode: Click on values to edit them directly
                            </p>
                          </div>
                        )}

                        {/* Salary Bifurcation Table - Compact */}
                        {previewBreakdown && (
                          <>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">{/* Earnings Column */}
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                              <h5 className="text-xs font-semibold text-green-800 mb-2 flex items-center">
                                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Earnings
                              </h5>
                              <div className="space-y-1.5">
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-gray-600">Basic</span>
                                  {manualEdit ? (
                                    <input
                                      type="number"
                                      value={manualValues.basic_plus_da || previewBreakdown.basic_plus_da}
                                      onChange={(e) => {
                                        setManualValues({ ...manualValues, basic_plus_da: e.target.value });
                                        calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances, true);
                                      }}
                                      className="w-20 px-1 py-0.5 text-xs text-right border border-orange-300 rounded bg-orange-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                    />
                                  ) : (
                                    <span className="font-medium text-gray-900">₹{previewBreakdown.basic_plus_da.toLocaleString('en-IN')}</span>
                                  )}
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-gray-600">DA</span>
                                  <span className="font-medium text-gray-900">₹{(previewBreakdown.da || 0).toLocaleString('en-IN')}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-gray-600">HRA</span>
                                  {manualEdit ? (
                                    <input
                                      type="number"
                                      value={manualValues.hra || previewBreakdown.hra}
                                      onChange={(e) => {
                                        setManualValues({ ...manualValues, hra: e.target.value });
                                        calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances, true);
                                      }}
                                      className="w-20 px-1 py-0.5 text-xs text-right border border-orange-300 rounded bg-orange-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                    />
                                  ) : (
                                    <span className="font-medium text-gray-900">₹{previewBreakdown.hra.toLocaleString('en-IN')}</span>
                                  )}
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-gray-600">Conveyance</span>
                                  {manualEdit ? (
                                    <input
                                      type="number"
                                      value={manualValues.conveyance || previewBreakdown.conveyance}
                                      onChange={(e) => {
                                        setManualValues({ ...manualValues, conveyance: e.target.value });
                                        calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances, true);
                                      }}
                                      className="w-20 px-1 py-0.5 text-xs text-right border border-orange-300 rounded bg-orange-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                    />
                                  ) : (
                                    <span className="font-medium text-gray-900">₹{previewBreakdown.conveyance.toLocaleString('en-IN')}</span>
                                  )}
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-gray-600">Call Allow.</span>
                                  {manualEdit ? (
                                    <input
                                      type="number"
                                      value={manualValues.call_allowance || previewBreakdown.call_allowance}
                                      onChange={(e) => {
                                        setManualValues({ ...manualValues, call_allowance: e.target.value });
                                        calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances, true);
                                      }}
                                      className="w-20 px-1 py-0.5 text-xs text-right border border-orange-300 rounded bg-orange-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                    />
                                  ) : (
                                    <span className="font-medium text-gray-900">₹{previewBreakdown.call_allowance.toLocaleString('en-IN')}</span>
                                  )}
                                </div>
                                {previewBreakdown.other_allowances > 0 && (
                                  <div className="flex justify-between text-xs">
                                    <span className="text-gray-600">Other</span>
                                    <span className="font-medium text-gray-900">₹{previewBreakdown.other_allowances.toLocaleString('en-IN')}</span>
                                  </div>
                                )}
                                <div className="border-t border-green-300 pt-1.5 mt-1.5">
                                  <div className="flex justify-between font-semibold text-xs">
                                    <span className="text-green-900">Total</span>
                                    <span className="text-green-900">₹{previewBreakdown.total_earnings.toLocaleString('en-IN')}</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Deductions Column */}
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                              <h5 className="text-xs font-semibold text-red-800 mb-2 flex items-center">
                                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                </svg>
                                Deductions
                              </h5>
                              <div className="space-y-1.5">
                                {salaryPreview.pf_applicable && (
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="text-gray-600">Emp PF</span>
                                    {manualEdit ? (
                                      <input
                                        type="number"
                                        value={manualValues.pf_employee || previewBreakdown.pf_employee}
                                        onChange={(e) => {
                                          setManualValues({ ...manualValues, pf_employee: e.target.value });
                                          calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances, true);
                                        }}
                                        className="w-20 px-1 py-0.5 text-xs text-right border border-orange-300 rounded bg-orange-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                      />
                                    ) : (
                                      <span className="font-medium text-gray-900">₹{previewBreakdown.pf_employee.toLocaleString('en-IN')}</span>
                                    )}
                                  </div>
                                )}
                                {salaryPreview.esic_applicable && (
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="text-gray-600">Emp ESIC</span>
                                    {manualEdit ? (
                                      <input
                                        type="number"
                                        value={manualValues.esic_employee || previewBreakdown.esic_employee}
                                        onChange={(e) => {
                                          setManualValues({ ...manualValues, esic_employee: e.target.value });
                                          calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances, true);
                                        }}
                                        className="w-20 px-1 py-0.5 text-xs text-right border border-orange-300 rounded bg-orange-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                      />
                                    ) : (
                                      <span className="font-medium text-gray-900">₹{previewBreakdown.esic_employee.toLocaleString('en-IN')}</span>
                                    )}
                                  </div>
                                )}
                                <div className="border-t border-red-300 pt-1.5 mt-1.5">
                                  <div className="flex justify-between font-semibold text-xs">
                                    <span className="text-red-900">Total</span>
                                    <span className="text-red-900">₹{previewBreakdown.total_deductions.toLocaleString('en-IN')}</span>
                                  </div>
                                </div>
                                <div className="border-t-2 border-red-400 pt-1.5 mt-1">
                                  <div className="flex justify-between font-bold text-sm">
                                    <span className="text-green-900">Net Pay</span>
                                    <span className="text-green-900">₹{previewBreakdown.net_pay.toLocaleString('en-IN')}</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Employer Cost Column */}
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <h5 className="text-xs font-semibold text-blue-800 mb-2 flex items-center">
                                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                                Employer Cost
                              </h5>
                              <div className="space-y-1.5">
                                <div className="flex justify-between text-xs">
                                  <span className="text-gray-600">Earnings</span>
                                  <span className="font-medium text-gray-900">₹{previewBreakdown.total_earnings.toLocaleString('en-IN')}</span>
                                </div>
                                {salaryPreview.pf_applicable && (
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="text-gray-600">Empr PF</span>
                                    {manualEdit ? (
                                      <input
                                        type="number"
                                        value={manualValues.pf_employer || previewBreakdown.pf_employer}
                                        onChange={(e) => {
                                          setManualValues({ ...manualValues, pf_employer: e.target.value });
                                          calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances, true);
                                        }}
                                        className="w-20 px-1 py-0.5 text-xs text-right border border-orange-300 rounded bg-orange-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                      />
                                    ) : (
                                      <span className="font-medium text-gray-900">₹{previewBreakdown.pf_employer.toLocaleString('en-IN')}</span>
                                    )}
                                  </div>
                                )}
                                {salaryPreview.esic_applicable && (
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="text-gray-600">Empr ESIC</span>
                                    {manualEdit ? (
                                      <input
                                        type="number"
                                        value={manualValues.esic_employer || previewBreakdown.esic_employer}
                                        onChange={(e) => {
                                          setManualValues({ ...manualValues, esic_employer: e.target.value });
                                          calculateSalaryPreview(salaryPreview.gross, salaryPreview.other_allowances, true);
                                        }}
                                        className="w-20 px-1 py-0.5 text-xs text-right border border-orange-300 rounded bg-orange-50 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                      />
                                    ) : (
                                      <span className="font-medium text-gray-900">₹{previewBreakdown.esic_employer.toLocaleString('en-IN')}</span>
                                    )}
                                  </div>
                                )}
                                <div className="border-t border-blue-300 pt-1.5 mt-1.5">
                                  <div className="flex justify-between font-semibold text-xs">
                                    <span className="text-blue-900">Total CTC</span>
                                    <span className="text-blue-900">₹{previewBreakdown.employer_cost.toLocaleString('en-IN')}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                        {/* Action Buttons */}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSalaryPreview({
                                  gross: '',
                                  other_allowances: 0,
                                  pf_applicable: true,
                                  esic_applicable: true
                                });
                                setPreviewBreakdown(null);
                                setCurrentDA(null);
                                setPreviewError('');
                                setManualEdit(false);
                                setManualValues({
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
                              }}
                              className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveSalaryProfile}
                              className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                            >
                              Save Salary Profile
                            </button>
                          </div>
                          </>
                        )}
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
                        {editSubTabOrder.indexOf(editSubTab) === editSubTabOrder.length - 1 ? (
                          <>
                            <button type="button" onClick={() => setActiveTab('list')} className="px-6 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
                            <button type="submit" disabled={loading} className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1">{loading ? 'Updating...' : 'Update Employee'}</button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const currentIndex = editSubTabOrder.indexOf(editSubTab);
                              if (currentIndex < editSubTabOrder.length - 1) {
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