'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';

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
  DocumentArrowDownIcon
} from '@heroicons/react/24/outline';

export default function EmployeesPage() {
  // Default form data with extended fields supported by the API
  const defaultFormData = {
    // Core identifiers
    employee_id: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    username: '',
    role: '',

    // Personal details
    gender: '',
    dob: '',
    marital_status: '',

    // Contact
    email: '',
    personal_email: '',
    phone: '',
    mobile: '',
    address: '',
    present_address: '',
    city: '',
    state: '',
    country: '',
    pin: '',

    // Work
    department: '',
    position: '',
    employee_type: '',
    grade: '',
    workplace: '',
    level: '',
    reporting_to: '',
    pf_no: '',
    hire_date: '',
    employment_status: 'active',
    status: 'active',
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

  // Fetch employees
  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const s = (searchTerm || '').trim();
      const params = new URLSearchParams({
        page: currentPage,
        limit: 10,
        ...(s && { search: s }),
        ...(selectedDepartment && { department: selectedDepartment }),
        ...(selectedStatus && { status: selectedStatus })
      });

      const response = await fetch(`/api/employees?${params}`);
      const data = await response.json();

      if (response.ok) {
        setEmployees(data.employees);
        setDepartments(data.departments);
        setPagination(data.pagination);
      } else {
        console.error('Error fetching employees:', data.error);
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [currentPage, searchTerm, selectedDepartment, selectedStatus]);

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
      // Coerce salary-related numeric fields
      ['salary','basic_salary','hra','conveyance','medical_allowance','special_allowance','incentives','deductions']
        .forEach((k) => { if (payload[k] === '') delete payload[k]; else if (payload[k] != null) payload[k] = Number(payload[k]); });
      // Compute salary summary if parts provided
      const parts = ['basic_salary','hra','conveyance','medical_allowance','special_allowance','incentives']
        .map(k => Number(payload[k] || 0));
      const gross = parts.reduce((a,b) => a + b, 0);
      const ded = Number(payload.deductions || 0);
      if (gross) payload.gross_salary = gross;
      if (ded) payload.total_deductions = ded;
      if (gross || ded) payload.net_salary = Math.max(0, gross - ded);
      // Serialize salary_structure if granular parts present
      const salaryStructObj = {
        basic_salary: payload.basic_salary,
        hra: payload.hra,
        conveyance: payload.conveyance,
        medical_allowance: payload.medical_allowance,
        special_allowance: payload.special_allowance,
        incentives: payload.incentives,
        deductions: payload.deductions
      };
      if (Object.values(salaryStructObj).some(v => v != null && v !== '' && !Number.isNaN(v))) {
        payload.salary_structure = JSON.stringify(salaryStructObj);
      }
      // Rename bank fields to match API
      if (payload.account_holder_name && !payload.account_holder) {
        // Keep account_holder_name as UI only field, API doesn't accept; embed inside salary_structure or remove
      }
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

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
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
        const error = await response.json().catch(() => ({}));
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
    setFormData({
      ...defaultFormData,
      ...employee,
      hire_date: employee.hire_date ? employee.hire_date.split('T')[0] : '',
      dob: employee.dob ? employee.dob.split('T')[0] : ''
    });
    setSelectedEmployee(employee);
    setFormErrors({});
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
    setActiveTab('add');
  };

  // Handle profile photo upload to /api/uploads
  const handleProfilePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhotoUploading(true);
      // Read file as base64
      const b64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const base64String = String(b64).split(',')[1] || '';
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, b64: base64String })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Upload failed');
      }
      const fileUrl = data?.data?.fileUrl;
      if (fileUrl) {
        setFormData((prev) => ({ ...prev, profile_photo_url: fileUrl }));
      }
    } catch (err) {
      console.error('Photo upload error:', err);
      setFormErrors((prev) => ({ ...prev, general: 'Failed to upload photo. Please try again.' }));
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
      
      <div className="px-4 sm:px-6 lg:px-8 py-8 mt-16">
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
                                  <div className="h-10 w-10 rounded-full bg-gradient-to-r from-[#64126D] to-[#86288F] flex items-center justify-center">
                                    <span className="text-sm font-medium text-white">
                                      {employee.first_name[0]}{employee.last_name[0]}
                                    </span>
                                  </div>
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
                          <div className="h-9 w-9 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-semibold">
                            {(emp.first_name?.[0] || 'E')}{(emp.last_name?.[0] || '')}
                          </div>
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
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Personal Information</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="md:col-span-3 flex items-center gap-4">
                          <div className="relative h-16 w-16 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center text-gray-500">
                            {formData.profile_photo_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={formData.profile_photo_url} alt="Profile" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-xs">No Photo</span>
                            )}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Profile Photo</label>
                            <input type="file" accept="image/*" onChange={handleProfilePhotoChange} className="block text-sm text-gray-600" />
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
                            <option value="single">Single</option>
                            <option value="married">Married</option>
                            <option value="divorced">Divorced</option>
                            <option value="widowed">Widowed</option>
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

                    {/* Contact Information */}
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

                    {/* Work Details */}
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

                    {/* Actions */}
                    {/* Statutory */}
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Statutory</h4>
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

                    {/* Academic & Experience */}
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

                    {/* Government IDs */}
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

                    {/* Bank Details */}
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

                    {/* Attendance & Exit */}
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

                    {/* Salary Structure Summary */}
                    <div>
                      <h4 className="text-lg font-semibold text-gray-900 mb-3">Salary Structure</h4>
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
                    </div>

                    <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
                      <button type="button" onClick={() => setActiveTab('list')} className="px-6 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
                      <button type="submit" disabled={loading} className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1">{loading ? 'Saving...' : 'Save Employee'}</button>
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
            <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-8 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
              <h3 className="text-xl font-semibold text-gray-900 mb-6">Edit Employee</h3>
              <form onSubmit={handleSubmit} className="space-y-8">
                {formErrors.general && (
                  <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    {formErrors.general}
                  </div>
                )}

                {/* Personal Information */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3">Personal Information</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-3 flex items-center gap-4">
                      <div className="relative h-16 w-16 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center text-gray-500">
                        {formData.profile_photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={formData.profile_photo_url} alt="Profile" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-xs">No Photo</span>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Profile Photo</label>
                        <input type="file" accept="image/*" onChange={handleProfilePhotoChange} className="block text-sm text-gray-600" />
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
                        <option value="single">Single</option>
                        <option value="married">Married</option>
                        <option value="divorced">Divorced</option>
                        <option value="widowed">Widowed</option>
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

                {/* Contact Information */}
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

                {/* Work Details */}
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

                {/* Statutory */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3">Statutory</h4>
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

                {/* Academic & Experience */}
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

                {/* Government IDs */}
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

                {/* Bank Details */}
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

                {/* Attendance & Exit */}
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

                {/* Salary Structure */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3">Salary Structure</h4>
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
                </div>

                <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
                  <button type="button" onClick={() => setActiveTab('list')} className="px-6 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
                  <button type="submit" disabled={loading} className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1">{loading ? 'Updating...' : 'Update Employee'}</button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'view' && selectedEmployee && (
            <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-8 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
              <h3 className="text-xl font-semibold text-gray-900 mb-6">Employee Details</h3>
              
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
