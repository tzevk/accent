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
  BuildingOfficeIcon,
  PhoneIcon,
  EnvelopeIcon,
  CalendarIcon,
  BanknotesIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  DocumentArrowUpIcon,
  DocumentArrowDownIcon,
  CloudArrowUpIcon
} from '@heroicons/react/24/outline';

export default function EmployeesPage() {
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
  const [formData, setFormData] = useState({
    employee_id: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    department: '',
    position: '',
    hire_date: '',
    salary: '',
    status: 'active',
    address: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    notes: ''
  });
  const [formErrors, setFormErrors] = useState({});
  const [importFile, setImportFile] = useState(null);
  const [importResults, setImportResults] = useState(null);

  // Fetch employees
  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: currentPage,
        limit: 10,
        ...(searchTerm && { search: searchTerm }),
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
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setSuccessMessage(selectedEmployee ? 'Employee updated successfully!' : 'Employee added successfully!');
        setActiveTab('list');
        setFormData({});
        setSelectedEmployee(null);
        fetchEmployees();
      } else {
        const error = await response.json();
        setFormErrors(error.errors || { general: error.message || 'An error occurred' });
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
      ...employee,
      hire_date: employee.hire_date ? employee.hire_date.split('T')[0] : ''
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
    setFormData({
      employee_id: '',
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      department: '',
      position: '',
      hire_date: '',
      salary: '',
      status: 'active'
    });
    setFormErrors({});
    setActiveTab('add');
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="px-4 sm:px-6 lg:px-8 py-8 mt-16">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center">
            <UserGroupIcon className="h-8 w-8 mr-3 text-purple-600" />
            Employee Management
          </h1>
          <p className="text-gray-600">Manage your team members and organizational structure</p>
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
                  setActiveTab('add');
                  setFormData({
                    employee_id: '',
                    first_name: '',
                    last_name: '',
                    email: '',
                    phone: '',
                    department: '',
                    position: '',
                    hire_date: '',
                    salary: '',
                    status: 'active',
                    address: '',
                    emergency_contact_name: '',
                    emergency_contact_phone: '',
                    notes: ''
                  });
                  setFormErrors({});
                }}
                className={`flex-1 py-4 px-6 text-center font-semibold text-sm transition-all duration-300 ${
                  activeTab === 'add'
                    ? 'bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Add Employee
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
                      onChange={(e) => setSearchTerm(e.target.value)}
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
              <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                {loading ? (
                  <div className="p-8 text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-700 mx-auto"></div>
                    <p className="text-gray-600 mt-4">Loading employees...</p>
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
                            <tr key={employee.id} className="hover:bg-gray-50 transition-colors duration-200">
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
            <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-8">
              <h3 className="text-xl font-semibold text-gray-900 mb-6">Add New Employee</h3>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* First Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      First Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.first_name || ''}
                      onChange={(e) => setFormData({...formData, first_name: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  {/* Last Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Last Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.last_name || ''}
                      onChange={(e) => setFormData({...formData, last_name: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  {/* Employee ID */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Employee ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.employee_id || ''}
                      onChange={(e) => setFormData({...formData, employee_id: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.email || ''}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={formData.phone || ''}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  {/* Department */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Department
                    </label>
                    <input
                      type="text"
                      value={formData.department || ''}
                      onChange={(e) => setFormData({...formData, department: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  {/* Position */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Position
                    </label>
                    <input
                      type="text"
                      value={formData.position || ''}
                      onChange={(e) => setFormData({...formData, position: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Status <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.status || 'active'}
                      onChange={(e) => setFormData({...formData, status: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="terminated">Terminated</option>
                    </select>
                  </div>

                  {/* Hire Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Hire Date
                    </label>
                    <input
                      type="date"
                      value={formData.hire_date || ''}
                      onChange={(e) => setFormData({...formData, hire_date: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  {/* Salary */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Salary
                    </label>
                    <input
                      type="number"
                      value={formData.salary || ''}
                      onChange={(e) => setFormData({...formData, salary: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      min="0"
                      step="0.01"
                    />
                  </div>

                  {/* Address */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Address
                    </label>
                    <textarea
                      value={formData.address || ''}
                      onChange={(e) => setFormData({...formData, address: e.target.value})}
                      rows={3}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>

                {/* Submit Buttons */}
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
                    disabled={loading}
                    className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                  >
                    {loading ? 'Adding...' : 'Add Employee'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'import' && (
            <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-8">
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
            <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-8">
              <h3 className="text-xl font-semibold text-gray-900 mb-6">Edit Employee</h3>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Form fields same as add form */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      First Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.first_name || ''}
                      onChange={(e) => setFormData({...formData, first_name: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Last Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.last_name || ''}
                      onChange={(e) => setFormData({...formData, last_name: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Employee ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.employee_id || ''}
                      onChange={(e) => setFormData({...formData, employee_id: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.email || ''}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={formData.phone || ''}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Department
                    </label>
                    <input
                      type="text"
                      value={formData.department || ''}
                      onChange={(e) => setFormData({...formData, department: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Position
                    </label>
                    <input
                      type="text"
                      value={formData.position || ''}
                      onChange={(e) => setFormData({...formData, position: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Status <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.status || 'active'}
                      onChange={(e) => setFormData({...formData, status: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="terminated">Terminated</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Hire Date
                    </label>
                    <input
                      type="date"
                      value={formData.hire_date || ''}
                      onChange={(e) => setFormData({...formData, hire_date: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Salary
                    </label>
                    <input
                      type="number"
                      value={formData.salary || ''}
                      onChange={(e) => setFormData({...formData, salary: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                      min="0"
                      step="0.01"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Address
                    </label>
                    <textarea
                      value={formData.address || ''}
                      onChange={(e) => setFormData({...formData, address: e.target.value})}
                      rows={3}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
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
                    disabled={loading}
                    className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                  >
                    {loading ? 'Updating...' : 'Update Employee'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'view' && selectedEmployee && (
            <div className="bg-white shadow-lg rounded-xl border border-gray-200 p-8">
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
