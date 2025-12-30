'use client';

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
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

  // Salary Structure State
  const [salaryStructures, setSalaryStructures] = useState([]);
  const [activeSalaryStructure, setActiveSalaryStructure] = useState(null);
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [salaryError, setSalaryError] = useState('');
  const [showSalaryForm, setShowSalaryForm] = useState(false);
  const [calculatedBreakdown, setCalculatedBreakdown] = useState(null);
  const [manualOverride, setManualOverride] = useState(false); // Toggle for manual salary entry
  
  // Salary calculation percentages (editable) - used in auto mode
  const [salaryPercentages, setSalaryPercentages] = useState({
    hra_percent: 50,           // HRA % of Basic
    conveyance: 1600,          // Fixed conveyance
    medical: 1250,             // Fixed medical
    employee_pf_percent: 12,   // Employee PF %
    employer_pf_percent: 12,   // Employer PF %
    employee_esic_percent: 0.75, // Employee ESIC %
    employer_esic_percent: 3.25, // Employer ESIC %
    gratuity_percent: 4.81,    // Gratuity %
    pf_admin_percent: 0.5,     // PF Admin %
    edli_percent: 0.5,         // EDLI %
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

  // Auto-calculate Indian Payroll Salary Breakdown - Complete Breakdown
  // Based on: Basic Pay is 50% of Gross (Gross = Basic × 2)
  const calculateSalaryBreakdown = useCallback((basicSalary, pfApplicable, esicApplicable, pfCeiling, percentages) => {
    const monthlyBasic = parseFloat(basicSalary) || 0;

    if (monthlyBasic === 0) return null;

    // Get percentages with defaults
    const {
      hra_percent = 50,
      conveyance: conveyanceFixed = 1600,
      medical: medicalFixed = 1250,
      employee_pf_percent = 12,
      employer_pf_percent = 12,
      employee_esic_percent = 0.75,
      employer_esic_percent = 3.25,
      gratuity_percent = 4.81,
      pf_admin_percent = 0.5,
      edli_percent = 0.5,
    } = percentages || {};

    // ═══════════════════════════════════════════════════════════════════
    // GROSS PAY CALCULATION
    // Basic Pay is 50% of Gross, so Gross = Basic × 2
    // ═══════════════════════════════════════════════════════════════════
    const monthlyGross = Math.round(monthlyBasic * 2);

    // ═══════════════════════════════════════════════════════════════════
    // EARNINGS / ALLOWANCES (Components of Gross Pay)
    // ═══════════════════════════════════════════════════════════════════
    
    // HRA: Fixed 50% of Basic
    const hra = Math.round(monthlyBasic * (hra_percent / 100));
    
    // Conveyance Allowance (Transport Allowance) - Fixed amount
    const conveyance = Math.min(conveyanceFixed, Math.round(monthlyGross * 0.04));
    
    // Medical Allowance - Fixed amount
    const medical = Math.min(medicalFixed, Math.round(monthlyGross * 0.03));
    
    // Special Allowance (Balancing figure to match Gross)
    const specialAllowance = Math.max(0, monthlyGross - monthlyBasic - hra - conveyance - medical);

    const totalEarnings = monthlyBasic + hra + conveyance + medical + specialAllowance;

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
      if (field === 'basic_salary') {
        recalculateManualTotals(value);
      }
      return;
    }

    // Recalculate breakdown when relevant fields change (auto mode)
    if (['basic_salary', 'pf_applicable', 'esic_applicable', 'pf_wage_ceiling'].includes(field)) {
      const breakdown = calculateSalaryBreakdown(
        field === 'basic_salary' ? value : newFormData.basic_salary,
        field === 'pf_applicable' ? value : newFormData.pf_applicable,
        field === 'esic_applicable' ? value : newFormData.esic_applicable,
        field === 'pf_wage_ceiling' ? value : newFormData.pf_wage_ceiling,
        salaryPercentages
      );
      setCalculatedBreakdown(breakdown);
      
      // Auto-fill gross from basic
      if (field === 'basic_salary' && breakdown) {
        setSalaryFormData(prev => ({
          ...prev,
          basic_salary: value,
          gross_salary: breakdown.summary.grossSalary.toString(),
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
    if (salaryFormData.basic_salary) {
      const breakdown = calculateSalaryBreakdown(
        salaryFormData.basic_salary,
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
                          onClick={() => {
                            setEditSubTab(t.key);
                            if (t.key === 'salary' && selectedEmployee?.id) {
                              fetchSalaryStructures(selectedEmployee.id);
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

                    {/* Salary Structure Tab */}
                    {editSubTab === 'salary' && (
                      <div>
                        <div className="flex items-center justify-between mb-6">
                          <h4 className="text-lg font-semibold text-gray-900">Salary Structure</h4>
                          {!showSalaryForm && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSalaryStructure(null);
                                resetSalaryForm();
                                setShowSalaryForm(true);
                              }}
                              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#64126D] to-[#86288F] text-white rounded-lg hover:from-[#86288F] hover:to-[#64126D] transition-all"
                            >
                              <PlusIcon className="h-5 w-5" />
                              New Salary Structure
                            </button>
                          )}
                        </div>

                        {salaryError && (
                          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                            {salaryError}
                          </div>
                        )}

                        {salaryLoading ? (
                          <div className="flex items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                            <span className="ml-3 text-gray-600">Loading salary structures...</span>
                          </div>
                        ) : showSalaryForm ? (
                          /* Salary Structure Form */
                          <div className="space-y-6">
                            {/* Form Header */}
                            <div className="flex items-center justify-between pb-4 border-b border-gray-200">
                              <div>
                                <h5 className="text-lg font-semibold text-gray-900">
                                  {editingSalaryStructure ? 'Edit Salary Structure' : 'New Salary Structure'}
                                </h5>
                                {editingSalaryStructure && (
                                  <p className="text-sm text-gray-500 mt-1">
                                    Editing Version {editingSalaryStructure.version} (Effective: {new Date(editingSalaryStructure.effective_from).toLocaleDateString('en-IN')})
                                  </p>
                                )}
                              </div>
                              {editingSalaryStructure && (
                                <span className="px-3 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-full">
                                  Editing
                                </span>
                              )}
                            </div>

                            {/* Basic Info */}
                            <div className="bg-gray-50 rounded-xl p-6">
                              <div className="flex items-center justify-between mb-4">
                                <h5 className="text-md font-semibold text-gray-800">Basic Details</h5>
                                
                                {/* Manual Override Toggle - Always visible */}
                                <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
                                  <div className={`p-2 rounded-lg ${manualOverride ? 'bg-amber-500' : 'bg-gray-300'}`}>
                                    <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  </div>
                                  <div className="mr-3">
                                    <h6 className="text-sm font-semibold text-gray-800">Manual Mode</h6>
                                    <p className="text-xs text-gray-600">
                                      {manualOverride ? 'Values ₹' : 'Auto %'}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={toggleManualOverride}
                                    className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
                                      manualOverride ? 'bg-amber-500' : 'bg-gray-300'
                                    }`}
                                  >
                                    <span
                                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${
                                        manualOverride ? 'translate-x-7' : 'translate-x-1'
                                      }`}
                                    />
                                  </button>
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Pay Type *</label>
                                  <select
                                    value={salaryFormData.pay_type}
                                    onChange={(e) => setSalaryFormData({ ...salaryFormData, pay_type: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  >
                                    <option value="monthly">Monthly</option>
                                    <option value="hourly">Hourly</option>
                                    <option value="daily">Daily</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Effective From *</label>
                                  <input
                                    type="date"
                                    value={salaryFormData.effective_from}
                                    onChange={(e) => setSalaryFormData({ ...salaryFormData, effective_from: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">Standard Working Days</label>
                                  <input
                                    type="number"
                                    value={salaryFormData.standard_working_days}
                                    onChange={(e) => setSalaryFormData({ ...salaryFormData, standard_working_days: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  />
                                </div>
                              </div>

                              {/* Monthly Pay Fields */}
                              {salaryFormData.pay_type === 'monthly' && (
                                <div className="space-y-4 mt-4">
                                  {/* Primary Input - Basic Salary */}
                                  <div className="bg-purple-50 border-2 border-purple-300 rounded-xl p-4">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                      <div className="md:col-span-2">
                                        <label className="block text-sm font-semibold text-purple-800 mb-2">
                                          Basic Salary (Monthly) * 
                                          <span className="text-xs font-normal text-purple-600 ml-2">
                                            {manualOverride ? 'Enter basic salary' : 'Enter to auto-calculate all'}
                                          </span>
                                        </label>
                                        <input
                                          type="number"
                                          value={salaryFormData.basic_salary}
                                          onChange={(e) => handleSalaryFieldChange('basic_salary', e.target.value)}
                                          placeholder="e.g., 25000"
                                          className="w-full px-4 py-3 border-2 border-purple-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-lg font-semibold"
                                        />
                                        <p className="text-xs text-purple-600 mt-1">
                                          {manualOverride ? 'Enter the basic salary amount' : 'Basic = 50% of Gross Salary (Gross = Basic × 2)'}
                                        </p>
                                      </div>
                                      {!manualOverride && (
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">HRA %</label>
                                        <input
                                          type="number"
                                          value={salaryPercentages.hra_percent}
                                          onChange={(e) => handlePercentageChange('hra_percent', e.target.value)}
                                          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">% of Basic</p>
                                      </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Percentage Configuration - Only shown in Auto mode */}
                                  {!manualOverride && (
                                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                    <h6 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                      </svg>
                                      Salary Component Configuration (Percentages)
                                    </h6>
                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Employee PF %</label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={salaryPercentages.employee_pf_percent}
                                          onChange={(e) => handlePercentageChange('employee_pf_percent', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Employer PF %</label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={salaryPercentages.employer_pf_percent}
                                          onChange={(e) => handlePercentageChange('employer_pf_percent', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Employee ESIC %</label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={salaryPercentages.employee_esic_percent}
                                          onChange={(e) => handlePercentageChange('employee_esic_percent', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Employer ESIC %</label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={salaryPercentages.employer_esic_percent}
                                          onChange={(e) => handlePercentageChange('employer_esic_percent', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Gratuity %</label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={salaryPercentages.gratuity_percent}
                                          onChange={(e) => handlePercentageChange('gratuity_percent', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">PF Admin %</label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={salaryPercentages.pf_admin_percent}
                                          onChange={(e) => handlePercentageChange('pf_admin_percent', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">EDLI %</label>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={salaryPercentages.edli_percent}
                                          onChange={(e) => handlePercentageChange('edli_percent', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Conveyance ₹</label>
                                        <input
                                          type="number"
                                          value={salaryPercentages.conveyance}
                                          onChange={(e) => handlePercentageChange('conveyance', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Medical ₹</label>
                                        <input
                                          type="number"
                                          value={salaryPercentages.medical}
                                          onChange={(e) => handlePercentageChange('medical', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  )}

                                  {/* Manual Value Inputs - Only shown in Manual mode */}
                                  {manualOverride && (
                                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                                    <h6 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                      Manual Component Values (₹)
                                    </h6>
                                    
                                    {/* Earnings Section */}
                                    <div className="mb-4">
                                      <p className="text-xs font-semibold text-green-700 mb-2 uppercase tracking-wide">Earnings / Allowances</p>
                                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 mb-1">HRA ₹</label>
                                          <input
                                            type="number"
                                            value={manualSalaryValues.hra}
                                            onChange={(e) => handleManualValueChange('hra', e.target.value)}
                                            placeholder="0"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 mb-1">Conveyance ₹</label>
                                          <input
                                            type="number"
                                            value={manualSalaryValues.conveyance}
                                            onChange={(e) => handleManualValueChange('conveyance', e.target.value)}
                                            placeholder="0"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 mb-1">Medical ₹</label>
                                          <input
                                            type="number"
                                            value={manualSalaryValues.medical}
                                            onChange={(e) => handleManualValueChange('medical', e.target.value)}
                                            placeholder="0"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 mb-1">Special Allowance ₹</label>
                                          <input
                                            type="number"
                                            value={manualSalaryValues.special_allowance}
                                            onChange={(e) => handleManualValueChange('special_allowance', e.target.value)}
                                            placeholder="0"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    {/* Deductions Section */}
                                    <div className="mb-4">
                                      <p className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wide">Employee Deductions</p>
                                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 mb-1">Employee PF ₹</label>
                                          <input
                                            type="number"
                                            value={manualSalaryValues.employee_pf}
                                            onChange={(e) => handleManualValueChange('employee_pf', e.target.value)}
                                            placeholder="0"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 mb-1">Employee ESIC ₹</label>
                                          <input
                                            type="number"
                                            value={manualSalaryValues.employee_esic}
                                            onChange={(e) => handleManualValueChange('employee_esic', e.target.value)}
                                            placeholder="0"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 mb-1">Prof. Tax ₹</label>
                                          <input
                                            type="number"
                                            value={manualSalaryValues.pt}
                                            onChange={(e) => handleManualValueChange('pt', e.target.value)}
                                            placeholder="0"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    {/* Employer Contributions Section */}
                                    <div>
                                      <p className="text-xs font-semibold text-blue-700 mb-2 uppercase tracking-wide">Employer Contributions</p>
                                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 mb-1">Employer PF ₹</label>
                                          <input
                                            type="number"
                                            value={manualSalaryValues.employer_pf}
                                            onChange={(e) => handleManualValueChange('employer_pf', e.target.value)}
                                            placeholder="0"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 mb-1">Employer ESIC ₹</label>
                                          <input
                                            type="number"
                                            value={manualSalaryValues.employer_esic}
                                            onChange={(e) => handleManualValueChange('employer_esic', e.target.value)}
                                            placeholder="0"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 mb-1">Gratuity ₹</label>
                                          <input
                                            type="number"
                                            value={manualSalaryValues.gratuity}
                                            onChange={(e) => handleManualValueChange('gratuity', e.target.value)}
                                            placeholder="0"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                  )}

                                  {/* Auto-calculated Fields */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Gross Salary (Monthly)</label>
                                      <input
                                        type="number"
                                        value={salaryFormData.gross_salary}
                                        readOnly
                                        placeholder="Auto-calculated (Basic × 2)"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-gray-100 text-gray-700 cursor-not-allowed"
                                      />
                                      <p className="text-xs text-gray-500 mt-1">Gross = Basic + HRA + Allowances</p>
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-2">Annual CTC</label>
                                      <input
                                        type="number"
                                        value={salaryFormData.ctc}
                                        readOnly
                                        placeholder="Auto-calculated"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-gray-100 text-gray-700 cursor-not-allowed"
                                      />
                                      <p className="text-xs text-gray-500 mt-1">CTC = (Gross + Employer PF + ESI) × 12</p>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Hourly Pay Fields */}
                              {salaryFormData.pay_type === 'hourly' && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Hourly Rate *</label>
                                    <input
                                      type="number"
                                      value={salaryFormData.hourly_rate}
                                      onChange={(e) => setSalaryFormData({ ...salaryFormData, hourly_rate: e.target.value })}
                                      placeholder="0.00"
                                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">OT Multiplier</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={salaryFormData.ot_multiplier}
                                      onChange={(e) => setSalaryFormData({ ...salaryFormData, ot_multiplier: e.target.value })}
                                      placeholder="1.5"
                                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Hours Per Day</label>
                                    <input
                                      type="number"
                                      value={salaryFormData.standard_hours_per_day}
                                      onChange={(e) => setSalaryFormData({ ...salaryFormData, standard_hours_per_day: e.target.value })}
                                      placeholder="8"
                                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                  </div>
                                </div>
                              )}

                              {/* Daily Pay Fields */}
                              {salaryFormData.pay_type === 'daily' && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Daily Rate *</label>
                                    <input
                                      type="number"
                                      value={salaryFormData.daily_rate}
                                      onChange={(e) => setSalaryFormData({ ...salaryFormData, daily_rate: e.target.value })}
                                      placeholder="0.00"
                                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">OT Multiplier</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={salaryFormData.ot_multiplier}
                                      onChange={(e) => setSalaryFormData({ ...salaryFormData, ot_multiplier: e.target.value })}
                                      placeholder="1.5"
                                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Statutory Deductions */}
                            <div className="bg-gray-50 rounded-xl p-6">
                              <h5 className="text-md font-semibold text-gray-800 mb-4">Statutory Applicability</h5>
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                                <label className="flex items-center gap-3 p-3 bg-white rounded-lg border cursor-pointer hover:border-purple-300">
                                  <input
                                    type="checkbox"
                                    checked={salaryFormData.pf_applicable}
                                    onChange={(e) => handleSalaryFieldChange('pf_applicable', e.target.checked)}
                                    className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                                  />
                                  <span className="text-sm font-medium">PF</span>
                                </label>
                                <label className="flex items-center gap-3 p-3 bg-white rounded-lg border cursor-pointer hover:border-purple-300">
                                  <input
                                    type="checkbox"
                                    checked={salaryFormData.esic_applicable}
                                    onChange={(e) => handleSalaryFieldChange('esic_applicable', e.target.checked)}
                                    className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                                  />
                                  <span className="text-sm font-medium">ESIC</span>
                                </label>
                                <label className="flex items-center gap-3 p-3 bg-white rounded-lg border cursor-pointer hover:border-purple-300">
                                  <input
                                    type="checkbox"
                                    checked={salaryFormData.pt_applicable}
                                    onChange={(e) => setSalaryFormData({ ...salaryFormData, pt_applicable: e.target.checked })}
                                    className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                                  />
                                  <span className="text-sm font-medium">PT</span>
                                </label>
                                <label className="flex items-center gap-3 p-3 bg-white rounded-lg border cursor-pointer hover:border-purple-300">
                                  <input
                                    type="checkbox"
                                    checked={salaryFormData.mlwf_applicable}
                                    onChange={(e) => setSalaryFormData({ ...salaryFormData, mlwf_applicable: e.target.checked })}
                                    className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                                  />
                                  <span className="text-sm font-medium">MLWF</span>
                                </label>
                                <label className="flex items-center gap-3 p-3 bg-white rounded-lg border cursor-pointer hover:border-purple-300">
                                  <input
                                    type="checkbox"
                                    checked={salaryFormData.tds_applicable}
                                    onChange={(e) => setSalaryFormData({ ...salaryFormData, tds_applicable: e.target.checked })}
                                    className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                                  />
                                  <span className="text-sm font-medium">TDS</span>
                                </label>
                                {salaryFormData.pf_applicable && (
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">PF Ceiling</label>
                                    <select
                                      value={salaryFormData.pf_wage_ceiling}
                                      onChange={(e) => handleSalaryFieldChange('pf_wage_ceiling', e.target.value)}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    >
                                      <option value="15000">₹15,000</option>
                                      <option value="actual">Actual Basic</option>
                                    </select>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Auto-Calculated Salary Breakdown */}
                            {calculatedBreakdown && salaryFormData.pay_type === 'monthly' && (
                              <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl p-6 border border-purple-200">
                                <h5 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                                  <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                  </svg>
                                  Complete Salary Breakdown
                                  <span className="ml-auto text-xs font-normal text-gray-500 bg-white px-2 py-1 rounded-lg border">
                                    PF: {calculatedBreakdown.percentages.employeePF}% | ESIC: {calculatedBreakdown.percentages.employeeESIC}% | HRA: {calculatedBreakdown.percentages.hra}%
                                  </span>
                                </h5>

                                {/* Main Summary Cards */}
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                                  <div className="bg-white rounded-xl p-4 text-center border-2 border-gray-200 shadow-sm">
                                    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Basic Salary</p>
                                    <p className="text-xl font-bold text-gray-800">₹{calculatedBreakdown.earnings.basic.toLocaleString('en-IN')}</p>
                                  </div>
                                  <div className="bg-white rounded-xl p-4 text-center border-2 border-gray-200 shadow-sm">
                                    <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Gross Salary</p>
                                    <p className="text-xl font-bold text-gray-800">₹{calculatedBreakdown.summary.grossSalary.toLocaleString('en-IN')}</p>
                                  </div>
                                  <div className="bg-white rounded-xl p-4 text-center border-2 border-red-200 shadow-sm">
                                    <p className="text-xs text-red-600 uppercase tracking-wide font-medium">Deductions</p>
                                    <p className="text-xl font-bold text-red-600">-₹{calculatedBreakdown.deductions.total.toLocaleString('en-IN')}</p>
                                  </div>
                                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 text-center border-2 border-green-300 shadow-sm">
                                    <p className="text-xs text-green-700 uppercase tracking-wide font-medium">Net Salary</p>
                                    <p className="text-2xl font-bold text-green-600">₹{calculatedBreakdown.summary.netSalary.toLocaleString('en-IN')}</p>
                                  </div>
                                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 text-center border-2 border-purple-300 shadow-sm">
                                    <p className="text-xs text-purple-700 uppercase tracking-wide font-medium">Monthly CTC</p>
                                    <p className="text-xl font-bold text-purple-600">₹{calculatedBreakdown.summary.totalCTC.toLocaleString('en-IN')}</p>
                                  </div>
                                </div>
                                
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                  {/* LEFT COLUMN - Earnings & Deductions */}
                                  <div className="space-y-4">
                                    {/* Earnings Section */}
                                    <div className="bg-white rounded-xl p-5 border border-green-200 shadow-sm">
                                      <h6 className="text-sm font-bold text-green-700 mb-4 uppercase tracking-wide flex items-center gap-2">
                                        <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                                        Monthly Earnings (Gross Pay)
                                      </h6>
                                      <div className="space-y-3 text-sm">
                                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                          <div>
                                            <span className="text-gray-700 font-medium">Basic Salary</span>
                                            <span className="text-xs text-gray-500 block">50% of Gross</span>
                                          </div>
                                          <span className="font-semibold text-gray-800">₹{calculatedBreakdown.earnings.basic.toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                          <div>
                                            <span className="text-gray-700 font-medium">House Rent Allowance (HRA)</span>
                                            <span className="text-xs text-gray-500 block">{salaryPercentages.hra_percent}% of Basic</span>
                                          </div>
                                          <span className="font-semibold text-gray-800">₹{calculatedBreakdown.earnings.hra.toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                          <div>
                                            <span className="text-gray-700 font-medium">Conveyance Allowance</span>
                                            <span className="text-xs text-gray-500 block">Fixed (max ₹{salaryPercentages.conveyance.toLocaleString('en-IN')})</span>
                                          </div>
                                          <span className="font-semibold text-gray-800">₹{calculatedBreakdown.earnings.conveyance.toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                          <div>
                                            <span className="text-gray-700 font-medium">Medical Allowance</span>
                                            <span className="text-xs text-gray-500 block">Fixed (max ₹{salaryPercentages.medical.toLocaleString('en-IN')})</span>
                                          </div>
                                          <span className="font-semibold text-gray-800">₹{calculatedBreakdown.earnings.medical.toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                          <div>
                                            <span className="text-gray-700 font-medium">Special Allowance</span>
                                            <span className="text-xs text-gray-500 block">Balancing Amount</span>
                                          </div>
                                          <span className="font-semibold text-gray-800">₹{calculatedBreakdown.earnings.specialAllowance.toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between items-center pt-3 border-t-2 border-green-300">
                                          <span className="font-bold text-green-800 text-base">GROSS SALARY (A)</span>
                                          <span className="font-bold text-green-800 text-lg">₹{calculatedBreakdown.earnings.total.toLocaleString('en-IN')}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Deductions Section */}
                                    <div className="bg-white rounded-xl p-5 border border-red-200 shadow-sm">
                                      <h6 className="text-sm font-bold text-red-700 mb-4 uppercase tracking-wide flex items-center gap-2">
                                        <span className="w-3 h-3 bg-red-500 rounded-full"></span>
                                        Monthly Deductions (Employee)
                                      </h6>
                                      <div className="space-y-3 text-sm">
                                        {calculatedBreakdown.deductions.employeePF > 0 && (
                                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                            <div>
                                              <span className="text-gray-700 font-medium">Provident Fund (PF)</span>
                                              <span className="text-xs text-gray-500 block">{salaryPercentages.employee_pf_percent}% of Basic (max ₹{calculatedBreakdown.pfDetails.wageBase.toLocaleString('en-IN')})</span>
                                            </div>
                                            <span className="font-semibold text-red-600">-₹{calculatedBreakdown.deductions.employeePF.toLocaleString('en-IN')}</span>
                                          </div>
                                        )}
                                        {calculatedBreakdown.deductions.employeeESIC > 0 && (
                                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                            <div>
                                              <span className="text-gray-700 font-medium">ESIC</span>
                                              <span className="text-xs text-gray-500 block">{salaryPercentages.employee_esic_percent}% of Gross</span>
                                            </div>
                                            <span className="font-semibold text-red-600">-₹{calculatedBreakdown.deductions.employeeESIC.toLocaleString('en-IN')}</span>
                                          </div>
                                        )}
                                        {calculatedBreakdown.deductions.pt > 0 && (
                                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                            <div>
                                              <span className="text-gray-700 font-medium">Professional Tax (PT)</span>
                                              <span className="text-xs text-gray-500 block">State Tax (Maharashtra)</span>
                                            </div>
                                            <span className="font-semibold text-red-600">-₹{calculatedBreakdown.deductions.pt.toLocaleString('en-IN')}</span>
                                          </div>
                                        )}
                                        {calculatedBreakdown.deductions.tds > 0 && (
                                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                            <div>
                                              <span className="text-gray-700 font-medium">TDS (Income Tax)</span>
                                              <span className="text-xs text-gray-500 block">Tax Deducted at Source</span>
                                            </div>
                                            <span className="font-semibold text-red-600">-₹{calculatedBreakdown.deductions.tds.toLocaleString('en-IN')}</span>
                                          </div>
                                        )}
                                        <div className="flex justify-between items-center pt-3 border-t-2 border-red-300">
                                          <span className="font-bold text-red-800 text-base">TOTAL DEDUCTIONS (B)</span>
                                          <span className="font-bold text-red-800 text-lg">-₹{calculatedBreakdown.deductions.total.toLocaleString('en-IN')}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Net Salary Calculation */}
                                    <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-xl p-5 text-white shadow-lg">
                                      <div className="flex justify-between items-center">
                                        <div>
                                          <span className="text-green-100 text-sm">NET SALARY (A - B)</span>
                                          <p className="text-xs text-green-200 mt-1">Take Home Pay</p>
                                        </div>
                                        <span className="text-3xl font-bold">₹{calculatedBreakdown.summary.netSalary.toLocaleString('en-IN')}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* RIGHT COLUMN - Employer Cost & Annual Summary */}
                                  <div className="space-y-4">
                                    {/* Employer Contributions Section */}
                                    <div className="bg-white rounded-xl p-5 border border-blue-200 shadow-sm">
                                      <h6 className="text-sm font-bold text-blue-700 mb-4 uppercase tracking-wide flex items-center gap-2">
                                        <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                                        Employer Contributions (Monthly)
                                      </h6>
                                      <div className="space-y-3 text-sm">
                                        {calculatedBreakdown.employer.pf > 0 && (
                                          <>
                                            <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                              <div>
                                                <span className="text-gray-700 font-medium">Employer PF (EPF + EPS)</span>
                                                <span className="text-xs text-gray-500 block">{salaryPercentages.employer_pf_percent}% of Basic</span>
                                              </div>
                                              <span className="font-semibold text-blue-600">₹{calculatedBreakdown.employer.pf.toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="flex justify-between items-center py-1 pl-4 text-xs text-gray-500">
                                              <span>↳ EPF (3.67% to PF A/c)</span>
                                              <span>₹{calculatedBreakdown.employer.epf.toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="flex justify-between items-center py-1 pl-4 text-xs text-gray-500 border-b border-gray-100">
                                              <span>↳ EPS (8.33% to Pension)</span>
                                              <span>₹{calculatedBreakdown.employer.eps.toLocaleString('en-IN')}</span>
                                            </div>
                                          </>
                                        )}
                                        {calculatedBreakdown.employer.esic > 0 && (
                                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                            <div>
                                              <span className="text-gray-700 font-medium">Employer ESIC</span>
                                              <span className="text-xs text-gray-500 block">{salaryPercentages.employer_esic_percent}% of Gross</span>
                                            </div>
                                            <span className="font-semibold text-blue-600">₹{calculatedBreakdown.employer.esic.toLocaleString('en-IN')}</span>
                                          </div>
                                        )}
                                        {calculatedBreakdown.employer.pfAdmin > 0 && (
                                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                            <div>
                                              <span className="text-gray-700 font-medium">PF Admin Charges</span>
                                              <span className="text-xs text-gray-500 block">{salaryPercentages.pf_admin_percent}% of PF Wages</span>
                                            </div>
                                            <span className="font-semibold text-blue-600">₹{calculatedBreakdown.employer.pfAdmin.toLocaleString('en-IN')}</span>
                                          </div>
                                        )}
                                        {calculatedBreakdown.employer.edli > 0 && (
                                          <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                            <div>
                                              <span className="text-gray-700 font-medium">EDLI (Insurance)</span>
                                              <span className="text-xs text-gray-500 block">{salaryPercentages.edli_percent}% of PF Wages</span>
                                            </div>
                                            <span className="font-semibold text-blue-600">₹{calculatedBreakdown.employer.edli.toLocaleString('en-IN')}</span>
                                          </div>
                                        )}
                                        <div className="flex justify-between items-center py-2 border-b border-gray-100">
                                          <div>
                                            <span className="text-gray-700 font-medium">Gratuity Provision</span>
                                            <span className="text-xs text-gray-500 block">{salaryPercentages.gratuity_percent}% of Basic</span>
                                          </div>
                                          <span className="font-semibold text-blue-600">₹{calculatedBreakdown.employer.gratuity.toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between items-center pt-3 border-t-2 border-blue-300">
                                          <span className="font-bold text-blue-800 text-base">TOTAL EMPLOYER COST (C)</span>
                                          <span className="font-bold text-blue-800 text-lg">₹{calculatedBreakdown.employer.total.toLocaleString('en-IN')}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* CTC Calculation */}
                                    <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl p-5 text-white shadow-lg">
                                      <div className="space-y-3">
                                        <div className="flex justify-between items-center text-purple-100 text-sm">
                                          <span>Gross Salary (A)</span>
                                          <span>₹{calculatedBreakdown.summary.grossSalary.toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-purple-100 text-sm">
                                          <span>+ Employer Cost (C)</span>
                                          <span>₹{calculatedBreakdown.employer.total.toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between items-center pt-2 border-t border-purple-400">
                                          <span className="font-bold">MONTHLY CTC (A + C)</span>
                                          <span className="text-2xl font-bold">₹{calculatedBreakdown.summary.totalCTC.toLocaleString('en-IN')}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* PF Account Summary */}
                                    {calculatedBreakdown.pfDetails.totalPF > 0 && (
                                      <div className="bg-white rounded-xl p-5 border border-amber-200 shadow-sm">
                                        <h6 className="text-sm font-bold text-amber-700 mb-4 uppercase tracking-wide flex items-center gap-2">
                                          <span className="w-3 h-3 bg-amber-500 rounded-full"></span>
                                          PF Account Summary
                                        </h6>
                                        <div className="space-y-2 text-sm">
                                          <div className="flex justify-between py-1">
                                            <span className="text-gray-600">PF Wage Base</span>
                                            <span className="font-medium">₹{calculatedBreakdown.pfDetails.wageBase.toLocaleString('en-IN')}</span>
                                          </div>
                                          <div className="flex justify-between py-1">
                                            <span className="text-gray-600">Employee PF ({salaryPercentages.employee_pf_percent}%)</span>
                                            <span className="font-medium">₹{calculatedBreakdown.pfDetails.employeeContribution.toLocaleString('en-IN')}</span>
                                          </div>
                                          <div className="flex justify-between py-1">
                                            <span className="text-gray-600">Employer EPF (3.67%)</span>
                                            <span className="font-medium">₹{calculatedBreakdown.pfDetails.employerEPF.toLocaleString('en-IN')}</span>
                                          </div>
                                          <div className="flex justify-between py-1">
                                            <span className="text-gray-600">Employer EPS (8.33%)</span>
                                            <span className="font-medium">₹{calculatedBreakdown.pfDetails.employerEPS.toLocaleString('en-IN')}</span>
                                          </div>
                                          <div className="flex justify-between py-2 border-t border-amber-200 font-semibold text-amber-800">
                                            <span>Total Monthly PF</span>
                                            <span>₹{calculatedBreakdown.pfDetails.totalPF.toLocaleString('en-IN')}</span>
                                          </div>
                                          <div className="flex justify-between py-1 text-amber-600">
                                            <span>Annual PF Savings</span>
                                            <span className="font-bold">₹{calculatedBreakdown.pfDetails.annualPF.toLocaleString('en-IN')}</span>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Annual Summary Table */}
                                <div className="mt-6 bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
                                  <h6 className="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wide">Annual Summary</h6>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="border-b-2 border-gray-200">
                                          <th className="text-left py-2 text-gray-600 font-medium">Component</th>
                                          <th className="text-right py-2 text-gray-600 font-medium">Monthly</th>
                                          <th className="text-right py-2 text-gray-600 font-medium">Annual</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        <tr className="border-b border-gray-100">
                                          <td className="py-2 text-gray-700">Basic Salary</td>
                                          <td className="py-2 text-right font-medium">₹{calculatedBreakdown.earnings.basic.toLocaleString('en-IN')}</td>
                                          <td className="py-2 text-right font-medium">₹{calculatedBreakdown.summary.annualBasic.toLocaleString('en-IN')}</td>
                                        </tr>
                                        <tr className="border-b border-gray-100">
                                          <td className="py-2 text-gray-700">HRA</td>
                                          <td className="py-2 text-right font-medium">₹{calculatedBreakdown.earnings.hra.toLocaleString('en-IN')}</td>
                                          <td className="py-2 text-right font-medium">₹{calculatedBreakdown.summary.annualHRA.toLocaleString('en-IN')}</td>
                                        </tr>
                                        <tr className="border-b border-gray-100 bg-green-50">
                                          <td className="py-2 text-green-700 font-medium">Gross Salary</td>
                                          <td className="py-2 text-right font-bold text-green-700">₹{calculatedBreakdown.summary.grossSalary.toLocaleString('en-IN')}</td>
                                          <td className="py-2 text-right font-bold text-green-700">₹{calculatedBreakdown.summary.annualGross.toLocaleString('en-IN')}</td>
                                        </tr>
                                        <tr className="border-b border-gray-100 bg-red-50">
                                          <td className="py-2 text-red-700 font-medium">Total Deductions</td>
                                          <td className="py-2 text-right font-bold text-red-700">-₹{calculatedBreakdown.summary.totalDeductions.toLocaleString('en-IN')}</td>
                                          <td className="py-2 text-right font-bold text-red-700">-₹{calculatedBreakdown.summary.annualDeductions.toLocaleString('en-IN')}</td>
                                        </tr>
                                        <tr className="border-b border-gray-100 bg-green-100">
                                          <td className="py-3 text-green-800 font-bold">Net Salary (Take Home)</td>
                                          <td className="py-3 text-right font-bold text-green-800 text-lg">₹{calculatedBreakdown.summary.netSalary.toLocaleString('en-IN')}</td>
                                          <td className="py-3 text-right font-bold text-green-800 text-lg">₹{calculatedBreakdown.summary.annualNet.toLocaleString('en-IN')}</td>
                                        </tr>
                                        <tr className="border-b border-gray-100 bg-blue-50">
                                          <td className="py-2 text-blue-700 font-medium">Employer Contributions</td>
                                          <td className="py-2 text-right font-bold text-blue-700">₹{calculatedBreakdown.employer.total.toLocaleString('en-IN')}</td>
                                          <td className="py-2 text-right font-bold text-blue-700">₹{calculatedBreakdown.summary.annualEmployerCost.toLocaleString('en-IN')}</td>
                                        </tr>
                                        <tr className="bg-purple-100">
                                          <td className="py-3 text-purple-800 font-bold">Total CTC</td>
                                          <td className="py-3 text-right font-bold text-purple-800 text-lg">₹{calculatedBreakdown.summary.totalCTC.toLocaleString('en-IN')}</td>
                                          <td className="py-3 text-right font-bold text-purple-800 text-lg">₹{calculatedBreakdown.summary.annualCTC.toLocaleString('en-IN')}</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                {/* Info Notes */}
                                <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                                  <p className="text-xs text-amber-800">
                                    <strong>Note:</strong> This is an estimated breakdown. Actual values may vary based on:
                                    • PF wage ceiling selection (₹15,000 or actual basic)
                                    • ESIC eligibility (Gross ≤ ₹21,000/month)
                                    • State-specific Professional Tax rates
                                    • TDS calculation based on income tax regime
                                    • LWF deductions (twice a year in some states)
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Salary Components */}
                            <div className="bg-gray-50 rounded-xl p-6">
                              <div className="flex items-center justify-between mb-4">
                                <h5 className="text-md font-semibold text-gray-800">Salary Components (Optional)</h5>
                                <button
                                  type="button"
                                  onClick={addSalaryComponent}
                                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border border-purple-300 text-purple-600 rounded-lg hover:bg-purple-50"
                                >
                                  <PlusIcon className="h-4 w-4" />
                                  Add Component
                                </button>
                              </div>

                              {salaryComponents.length === 0 ? (
                                <p className="text-sm text-gray-500 italic">No custom components added. Standard components (Basic, HRA, etc.) will be calculated automatically.</p>
                              ) : (
                                <div className="space-y-3">
                                  {salaryComponents.map((comp, idx) => (
                                    <div key={idx} className="bg-white p-4 rounded-lg border flex flex-wrap gap-3 items-end">
                                      <div className="flex-1 min-w-[150px]">
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                                        <input
                                          type="text"
                                          value={comp.component_name}
                                          onChange={(e) => updateSalaryComponent(idx, 'component_name', e.target.value)}
                                          placeholder="e.g., Special Allowance"
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        />
                                      </div>
                                      <div className="w-24">
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Code</label>
                                        <input
                                          type="text"
                                          value={comp.component_code}
                                          onChange={(e) => updateSalaryComponent(idx, 'component_code', e.target.value.toUpperCase())}
                                          placeholder="SPA"
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        />
                                      </div>
                                      <div className="w-32">
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                                        <select
                                          value={comp.component_type}
                                          onChange={(e) => updateSalaryComponent(idx, 'component_type', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        >
                                          <option value="earning">Earning</option>
                                          <option value="deduction">Deduction</option>
                                        </select>
                                      </div>
                                      <div className="w-28">
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Calc Type</label>
                                        <select
                                          value={comp.calculation_type}
                                          onChange={(e) => updateSalaryComponent(idx, 'calculation_type', e.target.value)}
                                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        >
                                          <option value="fixed">Fixed</option>
                                          <option value="percentage">Percentage</option>
                                        </select>
                                      </div>
                                      {comp.calculation_type === 'fixed' ? (
                                        <div className="w-28">
                                          <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                                          <input
                                            type="number"
                                            value={comp.fixed_amount}
                                            onChange={(e) => updateSalaryComponent(idx, 'fixed_amount', e.target.value)}
                                            placeholder="0.00"
                                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                          />
                                        </div>
                                      ) : (
                                        <>
                                          <div className="w-20">
                                            <label className="block text-xs font-medium text-gray-600 mb-1">%</label>
                                            <input
                                              type="number"
                                              value={comp.percentage_value}
                                              onChange={(e) => updateSalaryComponent(idx, 'percentage_value', e.target.value)}
                                              placeholder="0"
                                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            />
                                          </div>
                                          <div className="w-24">
                                            <label className="block text-xs font-medium text-gray-600 mb-1">Of</label>
                                            <select
                                              value={comp.percentage_of}
                                              onChange={(e) => updateSalaryComponent(idx, 'percentage_of', e.target.value)}
                                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            >
                                              <option value="basic">Basic</option>
                                              <option value="gross">Gross</option>
                                              <option value="ctc">CTC</option>
                                            </select>
                                          </div>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => removeSalaryComponent(idx)}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                      >
                                        <TrashIcon className="h-5 w-5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Remarks */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
                              <textarea
                                rows={2}
                                value={salaryFormData.remarks}
                                onChange={(e) => setSalaryFormData({ ...salaryFormData, remarks: e.target.value })}
                                placeholder="Any notes about this salary structure..."
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                              />
                            </div>

                            {/* Form Actions */}
                            <div className="flex justify-end gap-3 pt-4 border-t">
                              <button
                                type="button"
                                onClick={handleCancelSalaryEdit}
                                className="px-6 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={editingSalaryStructure ? handleUpdateSalaryStructure : handleSaveSalaryStructure}
                                disabled={salaryLoading}
                                className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50"
                              >
                                {salaryLoading ? 'Saving...' : (editingSalaryStructure ? 'Update Salary Structure' : 'Save Salary Structure')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* Salary Structures List */
                          <div>
                            {/* Active Structure Card */}
                            {activeSalaryStructure ? (
                              <div className="mb-6 p-6 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-200">
                                <div className="flex items-start justify-between mb-4">
                                  <div>
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                      Active
                                    </span>
                                    <h5 className="text-lg font-semibold text-gray-900 mt-2">
                                      {activeSalaryStructure.pay_type === 'monthly' ? 'Monthly Salary' : 
                                       activeSalaryStructure.pay_type === 'hourly' ? 'Hourly Wage' : 'Daily Wage'}
                                    </h5>
                                    <p className="text-sm text-gray-600">
                                      Effective from: {new Date(activeSalaryStructure.effective_from).toLocaleDateString('en-IN')}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-500 mr-2">Version {activeSalaryStructure.version}</span>
                                    <button
                                      onClick={() => handleEditSalaryStructure(activeSalaryStructure)}
                                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                      title="Edit"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => handleDeleteSalaryStructure(activeSalaryStructure.id)}
                                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                      title="Delete"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                  {activeSalaryStructure.pay_type === 'monthly' ? (
                                    <>
                                      <div>
                                        <p className="text-xs text-gray-500 uppercase">CTC</p>
                                        <p className="text-lg font-semibold text-gray-900">₹{Number(activeSalaryStructure.ctc || 0).toLocaleString('en-IN')}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500 uppercase">Gross</p>
                                        <p className="text-lg font-semibold text-gray-900">₹{Number(activeSalaryStructure.gross_salary || 0).toLocaleString('en-IN')}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500 uppercase">Basic</p>
                                        <p className="text-lg font-semibold text-gray-900">₹{Number(activeSalaryStructure.basic_salary || 0).toLocaleString('en-IN')}</p>
                                      </div>
                                    </>
                                  ) : activeSalaryStructure.pay_type === 'hourly' ? (
                                    <>
                                      <div>
                                        <p className="text-xs text-gray-500 uppercase">Hourly Rate</p>
                                        <p className="text-lg font-semibold text-gray-900">₹{Number(activeSalaryStructure.hourly_rate || 0).toLocaleString('en-IN')}/hr</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500 uppercase">OT Multiplier</p>
                                        <p className="text-lg font-semibold text-gray-900">{activeSalaryStructure.ot_multiplier}x</p>
                                      </div>
                                    </>
                                  ) : (
                                    <div>
                                      <p className="text-xs text-gray-500 uppercase">Daily Rate</p>
                                      <p className="text-lg font-semibold text-gray-900">₹{Number(activeSalaryStructure.daily_rate || 0).toLocaleString('en-IN')}/day</p>
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-xs text-gray-500 uppercase">Working Days</p>
                                    <p className="text-lg font-semibold text-gray-900">{activeSalaryStructure.standard_working_days}</p>
                                  </div>
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  {activeSalaryStructure.pf_applicable && <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">PF</span>}
                                  {activeSalaryStructure.esic_applicable && <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">ESIC</span>}
                                  {activeSalaryStructure.pt_applicable && <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">PT</span>}
                                  {activeSalaryStructure.mlwf_applicable && <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">MLWF</span>}
                                  {activeSalaryStructure.tds_applicable && <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">TDS</span>}
                                </div>
                              </div>
                            ) : (
                              <div className="mb-6 p-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 text-center">
                                <p className="text-gray-500">No active salary structure found.</p>
                                <p className="text-sm text-gray-400 mt-1">Click &quot;New Salary Structure&quot; to create one.</p>
                              </div>
                            )}

                            {/* Previous Versions */}
                            {salaryStructures.length > 1 && (
                              <div>
                                <h5 className="text-sm font-semibold text-gray-700 mb-3">Previous Versions</h5>
                                <div className="space-y-2">
                                  {salaryStructures
                                    .filter(s => s.id !== activeSalaryStructure?.id)
                                    .map((structure) => (
                                      <div key={structure.id} className="p-4 bg-gray-50 rounded-lg border flex items-center justify-between">
                                        <div className="flex-1">
                                          <span className="text-sm font-medium text-gray-700">Version {structure.version}</span>
                                          <span className="mx-2 text-gray-400">•</span>
                                          <span className="text-sm text-gray-500">
                                            {new Date(structure.effective_from).toLocaleDateString('en-IN')}
                                            {structure.effective_to && ` - ${new Date(structure.effective_to).toLocaleDateString('en-IN')}`}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <span className="text-sm text-gray-600">
                                            {structure.pay_type === 'monthly' 
                                              ? `₹${Number(structure.gross_salary || 0).toLocaleString('en-IN')}/mo` 
                                              : structure.pay_type === 'hourly'
                                              ? `₹${Number(structure.hourly_rate || 0).toLocaleString('en-IN')}/hr`
                                              : `₹${Number(structure.daily_rate || 0).toLocaleString('en-IN')}/day`}
                                          </span>
                                          <button
                                            onClick={() => handleEditSalaryStructure(structure)}
                                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                            title="Edit"
                                          >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                          </button>
                                          <button
                                            onClick={() => handleDeleteSalaryStructure(structure.id)}
                                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                                            title="Delete"
                                          >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )}
                          </div>
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