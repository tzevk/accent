'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import { 
  DocumentCurrencyDollarIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  EyeIcon,
  PrinterIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

export default function ReportsPage() {
  const { user, loading: authLoading } = useSessionRBAC();
  
  const [payrollSlips, setPayrollSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [bulkExporting, setBulkExporting] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [salaryTypeFilter, setSalaryTypeFilter] = useState('payroll');
  const [includeBonus, setIncludeBonus] = useState(false);
  
  // Stats
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    processed: 0,
    paid: 0,
    hold: 0,
    totalAmount: 0
  });

  // Modal states
  const [showSlip, setShowSlip] = useState(false);
  const [selectedSlip, setSelectedSlip] = useState(null);
  const [editingSlip, setEditingSlip] = useState(null);
  const [editForm, setEditForm] = useState({ payment_status: '', remarks: '' });
  const slipRef = useRef(null);

  // Bonus selection modal states
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [bonusEmployees, setBonusEmployees] = useState([]);
  const [selectedBonusEmployees, setSelectedBonusEmployees] = useState(new Set());
  const [bonusSearch, setBonusSearch] = useState('');
  const [loadingBonusEmployees, setLoadingBonusEmployees] = useState(false);

  // Fetch payroll slips
  const fetchPayrollSlips = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString()
      });
      
      // Always filter by selected month
      params.append('month', `${selectedMonth}-01`);
      if (statusFilter !== 'all') params.append('payment_status', statusFilter);
      params.append('salary_type', salaryTypeFilter);

      const res = await fetch(`/api/payroll/slips?${params}`);
      const data = await res.json();
      
      if (data.success) {
        setPayrollSlips(data.data || []);
        setPagination(data.pagination || { page: 1, limit: 20, total: data.data?.length || 0, totalPages: 1 });
        
        // Calculate stats
        const slips = data.data || [];
        setStats({
          total: slips.length,
          pending: slips.filter(s => s.payment_status === 'pending').length,
          processed: slips.filter(s => s.payment_status === 'processed').length,
          paid: slips.filter(s => s.payment_status === 'paid').length,
          hold: slips.filter(s => s.payment_status === 'hold').length,
          totalAmount: slips.reduce((sum, s) => sum + (parseFloat(s.net_salary) || 0), 0)
        });
      } else {
        setPayrollSlips([]);
      }
    } catch (error) {
      console.error('Error fetching payroll slips:', error);
      setPayrollSlips([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, salaryTypeFilter, selectedMonth, pagination.limit]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchPayrollSlips(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, statusFilter, salaryTypeFilter, selectedMonth]);

  // Export salary sheet as Excel
  const handleExportSheet = async () => {
    setGenerating(true);
    try {
      const month = `${selectedMonth}-01`;
      const response = await fetch(`/api/payroll/export-sheet?month=${month}&salary_type=${salaryTypeFilter}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 404) {
          alert(errorData.error || 'No payroll slips found for this month. Please generate slips first.');
        } else {
          alert(errorData.error || 'Failed to export salary sheet');
        }
        setGenerating(false);
        return;
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Salary_Sheet_${selectedMonth}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Failed to export salary sheet');
    } finally {
      setGenerating(false);
    }
  };

  // Execute the actual payroll generation
  const executeGenerateSlips = async (bonusEmployeeIds) => {
    setGenerating(true);
    try {
      const month = `${selectedMonth}-01`;
      
      const payload = { month, all: true, salary_type: salaryTypeFilter, include_bonus: includeBonus };
      if (bonusEmployeeIds) {
        payload.bonus_employee_ids = bonusEmployeeIds;
      }

      const res = await fetch('/api/payroll/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (data.success) {
        const successCount = data.results?.success || 1;
        const failedCount = data.results?.failed || 0;
        const skippedCount = data.results?.skipped || 0;
        
        let message = `Salary slips generated! Success: ${successCount}`;
        if (failedCount > 0) message += `, Failed: ${failedCount}`;
        if (skippedCount > 0) message += `, Skipped (already exists): ${skippedCount}`;
        
        if (data.results?.errors?.length > 0) {
          message += '\n\nErrors:\n' + data.results.errors.map(e => `- Employee ${e.employee_id}: ${e.error}`).join('\n');
        }
        
        alert(message);
        fetchPayrollSlips(1);
      } else {
        let errorMsg = data.error || 'Failed to generate salary slips';
        if (data.suggestion) errorMsg += '\n\n' + data.suggestion;
        alert(errorMsg);
      }
    } catch {
      alert('Failed to generate salary slips');
    } finally {
      setGenerating(false);
    }
  };

  // Generate all individual slips (used before exporting sheet)
  const handleGenerateAllSlips = async () => {
    // If bonus is checked, show employee selection modal first
    if (includeBonus) {
      setLoadingBonusEmployees(true);
      setShowBonusModal(true);
      try {
        const res = await fetch('/api/employees?status=active&limit=1000');
        const data = await res.json();
        if (res.ok && data.employees) {
          // Filter to employees with bonus_applicable in their salary structure
          const employees = (data.employees || []).map(e => ({
            id: e.id,
            name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
            employee_id: e.employee_id,
            department: e.department || '',
          }));
          setBonusEmployees(employees);
          // Pre-select all by default
          setSelectedBonusEmployees(new Set(employees.map(e => e.id)));
        }
      } catch {
        console.error('Failed to fetch employees for bonus selection');
      } finally {
        setLoadingBonusEmployees(false);
      }
      return;
    }

    if (!confirm(`This will generate individual salary slips for ${salaryTypeFilter === 'contract' ? 'contract ' : 'payroll '}employees for the selected month. Continue?`)) {
      return;
    }
    
    await executeGenerateSlips(null);
  };

  // Bulk export all salary slips as PDF
  const handleBulkExportPDF = async () => {
    setBulkExporting(true);
    try {
      const month = `${selectedMonth}-01`;
      const response = await fetch(`/api/payroll/bulk-pdf?month=${month}&salary_type=${salaryTypeFilter}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 404) {
          alert(errorData.error || 'No payroll slips found for this month. Please generate slips first.');
        } else {
          alert(errorData.error || 'Failed to export bulk PDF');
        }
        setBulkExporting(false);
        return;
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Salary_Slips_${selectedMonth}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Failed to export bulk PDF');
    } finally {
      setBulkExporting(false);
    }
  };

  // Filter slips by search term
  const filteredSlips = payrollSlips.filter(slip => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      slip.employee_name?.toLowerCase().includes(search) ||
      slip.employee_code?.toLowerCase().includes(search) ||
      slip.department?.toLowerCase().includes(search)
    );
  });

  // Get status styling
  const getStatusStyle = (status) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-700';
      case 'processed':
        return 'bg-blue-100 text-blue-700';
      case 'paid':
        return 'bg-green-100 text-green-700';
      case 'hold':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount || 0);
  };

  // Format month
  const formatMonth = (monthStr) => {
    if (!monthStr) return '-';
    const date = new Date(monthStr);
    return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };

  // Handle view slip
  const handleView = (slip) => {
    setSelectedSlip(slip);
    setShowSlip(true);
  };

  // Handle edit
  const handleEdit = (slip) => {
    setEditingSlip(slip);
    setEditForm({
      payment_status: slip.payment_status || 'pending',
      remarks: slip.remarks || ''
    });
  };

  // Save edit
  const handleSaveEdit = async () => {
    try {
      const res = await fetch('/api/payroll/slips', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingSlip.id,
          payment_status: editForm.payment_status,
          remarks: editForm.remarks
        })
      });

      const data = await res.json();
      if (data.success) {
        setEditingSlip(null);
        fetchPayrollSlips(pagination.page);
      } else {
        alert(data.error || 'Failed to update');
      }
    } catch {
      alert('Failed to update slip');
    }
  };

  // Handle delete
  const handleDelete = async (slip) => {
    if (!confirm(`Are you sure you want to delete payroll slip for ${slip.employee_name}? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/payroll/slips?id=${slip.id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        fetchPayrollSlips(pagination.page);
      } else {
        alert(data.error || 'Failed to delete');
      }
    } catch {
      alert('Failed to delete slip');
    }
  };

  // Handle delete all
  const handleDeleteAll = async () => {
    if (!confirm(`Are you sure you want to delete ALL ${payrollSlips.length} payroll slips? This action cannot be undone.`)) {
      return;
    }
    if (!confirm('This is irreversible. Type OK to confirm you want to delete ALL slips.')) {
      return;
    }

    try {
      const res = await fetch('/api/payroll/slips?all=true', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        alert(data.message || 'All slips deleted successfully');
        fetchPayrollSlips(1);
      } else {
        alert(data.error || 'Failed to delete all slips');
      }
    } catch {
      alert('Failed to delete all slips');
    }
  };

  // Handle download/print
  const handleDownload = (slip) => {
    setSelectedSlip(slip);
    setShowSlip(true);
    // Auto print after modal opens
    setTimeout(() => {
      handlePrint();
    }, 500);
  };

  const handlePrint = () => {
    const printContent = slipRef.current;
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Salary Slip - ${selectedSlip?.employee_name} - ${formatMonth(selectedSlip?.month)}</title>
          <style>
            @page { size: A5 portrait; margin: 4mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; padding: 0; font-size: 6px; color: #1a1a2e; }
            .slip-container { width: 100%; max-height: 50vh; border: 0.25px solid #64126D; border-radius: 3px; overflow: hidden; }
            
            /* Header with Logo */
            .header { display: flex; align-items: center; padding: 4px 8px; background: linear-gradient(135deg, #64126D 0%, #86288F 50%, #86288F 100%); border-bottom: 0.25px solid #64126D; }
            .logo { width: 35px; margin-right: 8px; background: #fff; border-radius: 3px; padding: 2px; }
            .logo img { width: 100%; height: auto; }
            .company-info { flex: 1; text-align: center; }
            .company-info h1 { font-size: 9px; font-weight: 800; color: #fff; margin-bottom: 1px; letter-spacing: 0.4px; text-shadow: 1px 1px 2px rgba(0,0,0,0.2); }
            .company-info p { font-size: 5.5px; color: #e8d5f5; font-weight: 500; line-height: 1.3; }
            
            /* Month Title */
            .slip-title { text-align: center; padding: 2px; background: linear-gradient(90deg, #f3e5f5, #e1bee7, #f3e5f5); border-bottom: 0.25px solid #64126D; font-weight: 700; font-size: 6px; color: #64126D; letter-spacing: 0.3px; }
            
            /* Tables */
            .main-table { width: 100%; border-collapse: collapse; border-spacing: 0; table-layout: fixed; }
            .main-table th, .main-table td { padding: 1.5px 3px; font-size: 5.5px; vertical-align: middle; border: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .main-table tr > * { border-right: 0.1px solid #e8d0f0; border-bottom: 0.1px solid #e8d0f0; }
            .main-table tr > *:last-child { border-right: 0; }
            .main-table tr:last-child > * { border-bottom: 0; }
            .main-table th { background: linear-gradient(135deg, #64126D, #86288F); font-weight: 700; text-align: center; color: #fff; font-size: 5.5px; letter-spacing: 0.2px; }
            .label { font-weight: 700; background: #f3e5f5; color: #64126D; font-size: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .value { background: #fff; color: #1a1a2e; }
            td.amount { text-align: right; font-family: 'Arial', sans-serif; }
            .total-row { background: linear-gradient(90deg, #e8f5e9, #f3e5f5, #fce4ec); font-weight: 700; }
            .total-row td { border-top: 0.25px solid #64126D; }
            .net-salary-row { background: linear-gradient(135deg, #64126D, #86288F) !important; }
            .net-salary-cell { color: #fff !important; font-weight: 800; vertical-align: middle; font-size: 6px; letter-spacing: 0.2px; }
            .net-salary-cell.amount { font-size: 7px; }
            
            /* Footer */
            .footer { padding: 3px; text-align: center; font-size: 5px; border-top: 0.25px solid #64126D; background: #f3e5f5; color: #64126D; font-weight: 500; }
            
            @media print { 
              body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <div class="slip-container">
            <!-- Header with Logo -->
            <div class="header">
              <div class="logo">
                <img src="/accent-logo.png" alt="Accent Logo" />
              </div>
              <div class="company-info">
                <h1>ACCENT TECHNO SOLUTIONS PVT LTD</h1>
                <p>17/130, ANAND NAGAR, NEHRU ROAD, VAKOLA, SANTACRUZ (E),</p>
                <p>MUMBAI,MAHARASHTRA - 400055</p>
                <p>Mobile: 9324670725</p>
              </div>
            </div>
            
            <!-- Month Title -->
            <div class="slip-title">SALARY SLIP FOR THE MONTH OF ${formatMonth(selectedSlip?.month).toUpperCase()}</div>
            
            <!-- Employee Info + Content in Single Table -->
            <table class="main-table">
              <colgroup>
                <col style="width:10%">
                <col style="width:15%">
                <col style="width:11%">
                <col style="width:13%">
                <col style="width:12%">
                <col style="width:12%">
                <col style="width:13%">
                <col style="width:14%">
              </colgroup>
              <tr>
                <td class="label">NAME :</td>
                <td class="value">${selectedSlip?.employee_name || ''}</td>
                <td class="label">DESIGNATION :</td>
                <td class="value">${selectedSlip?.position || selectedSlip?.designation || ''}</td>
                <td class="label">TOTAL DAYS :</td>
                <td class="value">${selectedSlip?.standard_working_days || ''}</td>
                <td class="label">PAID LEAVES :</td>
                <td class="value">${selectedSlip?.pl_total || 21}</td>
              </tr>
              <tr>
                <td class="label">DEPARTMENT :</td>
                <td class="value">${selectedSlip?.department || ''}</td>
                <td class="label">DOJ :</td>
                <td class="value">${selectedSlip?.joining_date ? new Date(selectedSlip.joining_date).toLocaleDateString('en-IN') : ''}</td>
                <td class="label">PRESENT DAYS :</td>
                <td class="value">${selectedSlip?.payable_days || ''}</td>
                <td class="label">PL USED :</td>
                <td class="value">${selectedSlip?.pl_used || 0}</td>
              </tr>
              <tr>
                <td class="label">PF  NUMBER:</td>
                <td class="value">${selectedSlip?.pf_number || ''}</td>
                <td class="label">ESIC NUMBER:</td>
                <td class="value">${selectedSlip?.esic_number || ''}</td>
                <td class="label">ABSENT DAYS :</td>
                <td class="value">${selectedSlip?.standard_working_days && selectedSlip?.payable_days ? (parseFloat(selectedSlip.standard_working_days) - parseFloat(selectedSlip.payable_days)).toFixed(1) : (selectedSlip?.lop_days || '0.0')}</td>
                <td class="label">BALANCE :</td>
                <td class="value">${selectedSlip?.pl_balance ?? (21 - (selectedSlip?.pl_used || 0))}</td>
              </tr>
              <tr>
                <td class="label">UAN  NUMBER :</td>
                <td class="value">${selectedSlip?.uan_number || ''}</td>
                <td class="label">PAN NO :</td>
                <td class="value">${selectedSlip?.pan_number || ''}</td>
                <td class="label">PAYMENT MODE :</td>
                <td class="value" colspan="3">${selectedSlip?.payment_mode || 'NEFT'}</td>
              </tr>
              <tr>
                <th colspan="2">DESCRIPTION</th>
                <th>Gross</th>
                <th>EARNING</th>
                <th colspan="2">DESCRIPTION</th>
                <th colspan="2">AMOUNT</th>
              </tr>
              <tr class="earn-row">
                <td colspan="2">BASIC</td>
                <td class="amount">${selectedSlip?.basic || '0.00'}</td>
                <td class="amount">${selectedSlip?.basic || '0.00'}</td>
                <td colspan="2">PROVIDENT FUND</td>
                <td class="amount" colspan="2">${selectedSlip?.pf_employee || '0.00'}</td>
              </tr>
              <tr class="earn-row">
                <td colspan="2">DA</td>
                <td class="amount">${selectedSlip?.da || '0.00'}</td>
                <td class="amount">${selectedSlip?.da || '0.00'}</td>
                <td colspan="2">ESIC</td>
                <td class="amount" colspan="2">${selectedSlip?.esic_employee || '0.00'}</td>
              </tr>
              <tr class="earn-row">
                <td colspan="2">HRA</td>
                <td class="amount">${selectedSlip?.hra || '0.00'}</td>
                <td class="amount">${selectedSlip?.hra || '0.00'}</td>
                <td colspan="2">PROFESSIONAL TAX</td>
                <td class="amount" colspan="2">${selectedSlip?.pt || '0.00'}</td>
              </tr>
              <tr class="earn-row">
                <td colspan="2">CONVEYANCE ALLOWANCE</td>
                <td class="amount">${selectedSlip?.conveyance || '0.00'}</td>
                <td class="amount">${selectedSlip?.conveyance || '0.00'}</td>
                <td colspan="2">LOAN</td>
                <td class="amount" colspan="2">${selectedSlip?.loan || '0.00'}</td>
              </tr>
              <tr class="earn-row">
                <td colspan="2">CALL  ALLOWANCE</td>
                <td class="amount">${selectedSlip?.call_allowance || '0.00'}</td>
                <td class="amount">${selectedSlip?.call_allowance || '0.00'}</td>
                <td colspan="2">ADVANCE</td>
                <td class="amount" colspan="2">${selectedSlip?.advance || '0.00'}</td>
              </tr>
              <tr class="earn-row">
                <td colspan="2">OTHER  ALLOWANCE</td>
                <td class="amount">${selectedSlip?.other_allowances || '0.00'}</td>
                <td class="amount">${selectedSlip?.other_allowances || '0.00'}</td>
                <td colspan="2">TAX DEDUCTED AT SOURCE</td>
                <td class="amount" colspan="2">${selectedSlip?.tds || '0.00'}</td>
              </tr>
              <tr class="earn-row">
                <td colspan="2">BONUS</td>
                <td class="amount">${selectedSlip?.bonus || '0.00'}</td>
                <td class="amount">${selectedSlip?.bonus || '0.00'}</td>
                <td colspan="2">RETENTION AMOUNT</td>
                <td class="amount" colspan="2">${selectedSlip?.retention || '0.00'}</td>
              </tr>
              <tr class="earn-row">
                <td colspan="2">OT RATE</td>
                <td class="amount">${selectedSlip?.ot_rate || '0.00'}</td>
                <td class="amount">${selectedSlip?.ot_rate || '0.00'}</td>
                <td colspan="2">MLWF</td>
                <td class="amount" colspan="2">${selectedSlip?.mlwf || '0.00'}</td>
              </tr>
              <tr class="earn-row">
                <td colspan="2">INCENTIVE</td>
                <td class="amount">${selectedSlip?.incentive || '0.00'}</td>
                <td class="amount">${selectedSlip?.incentive || '0.00'}</td>
                <td colspan="2"></td>
                <td colspan="2"></td>
              </tr>
              <tr class="total-row">
                <td colspan="2">GROSS EARNING</td>
                <td class="amount"></td>
                <td class="amount">${selectedSlip?.total_earnings || selectedSlip?.gross_salary || '0.00'}</td>
                <td colspan="2">TOTAL DEDUCTION</td>
                <td class="amount" colspan="2">${selectedSlip?.total_deductions || '0.00'}</td>
              </tr>
              <tr class="net-salary-row">
                <td class="net-salary-cell" colspan="4"></td>
                <td class="net-salary-cell" colspan="2">NET SALARY PAYABLE</td>
                <td class="net-salary-cell amount" colspan="2">${selectedSlip?.net_salary || selectedSlip?.net_pay || '0.00'}</td>
              </tr>
            </table>
            
            <!-- Footer -->
            <div class="footer">
              <p>NOTE: THIS IS A COMPUTER GENERATED SALARY SLIP HENCE DOESN'T REQUIRE SIGNATURE</p>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <main className="px-6 lg:px-8 xl:px-12 2xl:px-16 py-6 max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <DocumentCurrencyDollarIcon className="h-7 w-7 text-purple-600" />
            Salary Reports
          </h1>
          <p className="text-sm text-gray-500 mt-1">Generate and manage salary slips</p>
        </div>

        {/* Controls Row */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            {/* Salary Type Toggle */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                onClick={() => setSalaryTypeFilter('payroll')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  salaryTypeFilter === 'payroll'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Payroll
              </button>
              <button
                onClick={() => setSalaryTypeFilter('contract')}
                className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${
                  salaryTypeFilter === 'contract'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Contract
              </button>
            </div>

            {/* Month Selector */}
            <select
              value={selectedMonth.split('-')[1]}
              onChange={(e) => setSelectedMonth(`${selectedMonth.split('-')[0]}-${e.target.value}`)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
            >
              <option value="01">January</option>
              <option value="02">February</option>
              <option value="03">March</option>
              <option value="04">April</option>
              <option value="05">May</option>
              <option value="06">June</option>
              <option value="07">July</option>
              <option value="08">August</option>
              <option value="09">September</option>
              <option value="10">October</option>
              <option value="11">November</option>
              <option value="12">December</option>
            </select>
            <select
              value={selectedMonth.split('-')[0]}
              onChange={(e) => setSelectedMonth(`${e.target.value}-${selectedMonth.split('-')[1]}`)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
            >
              {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>

            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <MagnifyingGlassIcon className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name, code, department..."
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="processed">Processed</option>
              <option value="paid">Paid</option>
              <option value="hold">On Hold</option>
            </select>

            <div className="flex items-center gap-2 ml-auto">
              {/* Include Bonus Toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none" title="Include bonus in salary slip calculation">
                <input
                  type="checkbox"
                  checked={includeBonus}
                  onChange={(e) => setIncludeBonus(e.target.checked)}
                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                />
                <span className="text-sm font-medium text-gray-700">Include Bonus</span>
              </label>

              {/* Generate All Slips */}
              <button
                onClick={handleGenerateAllSlips}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50"
                title="Generate salary slips for all employees"
              >
                {generating ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <PlusIcon className="h-4 w-4" />
                )}
                Generate Slips
              </button>

              {/* Export Sheet */}
              <button
                onClick={handleExportSheet}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {generating ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowDownTrayIcon className="h-4 w-4" />
                )}
                Export Excel
              </button>

              {/* Bulk Export PDF */}
              <button
                onClick={handleBulkExportPDF}
                disabled={bulkExporting || generating || payrollSlips.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors text-sm font-medium disabled:opacity-50"
                title="Download all salary slips as a single PDF"
              >
                {bulkExporting ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <PrinterIcon className="h-4 w-4" />
                )}
                {bulkExporting ? 'Generating PDF...' : 'Bulk Export PDF'}
              </button>

              {/* Delete All */}
              <button
                onClick={handleDeleteAll}
                disabled={generating || payrollSlips.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50"
                title="Delete all payroll slips"
              >
                <TrashIcon className="h-4 w-4" />
                Delete All
              </button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-xs text-gray-500">Total Slips</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <div className="text-xs text-gray-500">Pending</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.processed}</div>
            <div className="text-xs text-gray-500">Processed</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-green-600">{stats.paid}</div>
            <div className="text-xs text-gray-500">Paid</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-red-600">{stats.hold}</div>
            <div className="text-xs text-gray-500">On Hold</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="text-2xl font-bold text-purple-600">{formatCurrency(stats.totalAmount)}</div>
            <div className="text-xs text-gray-500">Total Payout</div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              <span className="ml-3 text-gray-600">Loading payroll slips...</span>
            </div>
          ) : filteredSlips.length === 0 ? (
            <div className="text-center py-12">
              <DocumentCurrencyDollarIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No payroll slips found for {formatMonth(`${selectedMonth}-01`)}</p>
              <p className="text-sm text-gray-500 mt-1">Generate payroll to create slips</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Employee</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Department</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Gross</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Deductions</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Net Pay</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredSlips.map((slip, index) => (
                    <tr key={`${slip.id}-${slip.employee_id || index}`} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{slip.employee_name}</div>
                        <div className="text-sm text-gray-500">{slip.employee_code}</div>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{slip.department || '-'}</td>
                      <td className="px-6 py-4 text-right font-mono text-gray-900">{formatCurrency(slip.gross_salary || slip.gross)}</td>
                      <td className="px-6 py-4 text-right font-mono text-red-600">{formatCurrency(slip.total_deductions)}</td>
                      <td className="px-6 py-4 text-right font-semibold font-mono text-green-600">{formatCurrency(slip.net_salary || slip.net_pay)}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusStyle(slip.payment_status)}`}>
                          {slip.payment_status?.charAt(0).toUpperCase() + slip.payment_status?.slice(1) || 'Pending'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleView(slip)}
                            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="View Slip"
                          >
                            <EyeIcon className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleEdit(slip)}
                            className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Edit Status"
                          >
                            <PencilIcon className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleDownload(slip)}
                            className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Download PDF"
                          >
                            <ArrowDownTrayIcon className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleDelete(slip)}
                            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchPayrollSlips(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <span className="px-3 py-1 text-sm">{pagination.page} / {pagination.totalPages}</span>
                <button
                  onClick={() => fetchPayrollSlips(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                  className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* View Slip Modal */}
      {showSlip && selectedSlip && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-7xl w-full max-h-[90vh] overflow-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-lg font-semibold text-gray-900">Salary Slip</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors"
                >
                  <PrinterIcon className="h-4 w-4" />
                  Print / Download
                </button>
                <button onClick={() => setShowSlip(false)} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div ref={slipRef} className="p-4 border-2 border-purple-800 rounded overflow-hidden">
              {/* Header with Logo */}
              <div className="flex items-center pb-0 rounded-t" style={{background: 'linear-gradient(135deg, #64126D 0%, #86288F 50%, #86288F 100%)', padding: '14px 20px'}}>
                <div className="w-[90px] mr-5 bg-white rounded-md p-1.5">
                  <img src="/accent-logo.png" alt="Accent Logo" className="w-full h-auto" />
                </div>
                <div className="flex-1 text-center">
                  <h1 className="text-[22px] font-extrabold text-white tracking-wide">ACCENT TECHNO SOLUTIONS PVT LTD</h1>
                  <p className="text-[11px] text-purple-200 font-medium leading-relaxed">17/130, ANAND NAGAR, NEHRU ROAD, VAKOLA, SANTACRUZ (E),</p>
                  <p className="text-[11px] text-purple-200 font-medium leading-relaxed">MUMBAI,MAHARASHTRA - 400055</p>
                  <p className="text-[11px] text-purple-200 font-medium leading-relaxed">Mobile: 9324670725</p>
                </div>
              </div>

              {/* Month Title */}
              <div className="border-b-2 border-purple-800 px-3 py-2 font-bold text-center text-xs text-purple-800 tracking-wide" style={{background: 'linear-gradient(90deg, #f3e5f5, #e1bee7, #f3e5f5)'}}>
                SALARY SLIP FOR THE MONTH OF {formatMonth(selectedSlip.month).toUpperCase()}
              </div>

              {/* Employee Info Table */}
              <table className="w-full border-collapse text-[11px]">
                <colgroup>
                  <col style={{width: '12%'}} />
                  <col style={{width: '15%'}} />
                  <col style={{width: '12%'}} />
                  <col style={{width: '13%'}} />
                  <col style={{width: '13%'}} />
                  <col style={{width: '13%'}} />
                  <col style={{width: '11%'}} />
                  <col style={{width: '11%'}} />
                </colgroup>
                <tbody>
                  <tr>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">NAME :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.employee_name || ''}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">DESIGNATION :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.designation || ''}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">TOTAL DAYS :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.standard_working_days || ''}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">TOTAL PAID LEAVES :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.pl_total || 21}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">DEPARTMENT :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.department || ''}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">DATE OF JOINING :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.joining_date ? new Date(selectedSlip.joining_date).toLocaleDateString('en-IN') : ''}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">PRESENT DAYS :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.payable_days || ''}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">PL USED :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.pl_used || 0}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">PF  NUMBER:</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.pf_number || ''}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">ESIC NUMBER:</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.esic_number || ''}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">ABSENT DAYS :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.standard_working_days && selectedSlip.payable_days ? (parseFloat(selectedSlip.standard_working_days) - parseFloat(selectedSlip.payable_days)).toFixed(1) : (selectedSlip.lop_days || '0.0')}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">BALANCE :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.pl_balance ?? (21 - (selectedSlip.pl_used || 0))}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">UAN  NUMBER :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.uan_number || ''}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">PAN NO :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white">{selectedSlip.pan_number || ''}</td>
                    <td className="border border-purple-300 px-2 py-1.5 font-bold text-purple-800 bg-purple-50 text-[10px]">PAYMENT MODE :</td>
                    <td className="border border-purple-300 px-2 py-1.5 bg-white" colSpan={3}>{selectedSlip.payment_mode || ''}</td>
                  </tr>
                </tbody>
              </table>

              {/* Main Content Table */}
              <table className="w-full border-collapse text-[11px]">
                <colgroup>
                  <col style={{width: '25%'}} />
                  <col style={{width: '12.5%'}} />
                  <col style={{width: '12.5%'}} />
                  <col style={{width: '25%'}} />
                  <col style={{width: '25%'}} />
                </colgroup>
                <thead>
                  <tr style={{background: 'linear-gradient(135deg, #64126D, #86288F)'}}>
                    <th className="border border-purple-400 px-2 py-1.7 text-white text-[11px] tracking-wide">DESCRIPTION</th>
                    <th className="border border-purple-400 px-2 py-1.5 text-white text-[11px] tracking-wide">Gross</th>
                    <th className="border border-purple-400 px-2 py-1.5 text-white text-[11px] tracking-wide">EARNING</th>
                    <th className="border border-purple-400 px-2 py-1.5 text-white text-[11px] tracking-wide">DESCRIPTION</th>
                    <th className="border border-purple-400 px-2 py-1.5 text-white text-[11px] tracking-wide">AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-purple-200 px-2 py-1 bg-green-50">BASIC</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-green-50">{selectedSlip.basic || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-green-50">{selectedSlip.basic || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 bg-red-50">PROVIDENT FUND</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-red-50">{selectedSlip.pf_employee || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-200 px-2 py-1 bg-emerald-50">DA</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-emerald-50">{selectedSlip.da || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-emerald-50">{selectedSlip.da || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 bg-rose-50">ESIC</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-rose-50">{selectedSlip.esic_employee || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-200 px-2 py-1 bg-green-50">HRA</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-green-50">{selectedSlip.hra || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-green-50">{selectedSlip.hra || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 bg-red-50">PROFESSIONAL TAX</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-red-50">{selectedSlip.pt || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-200 px-2 py-1 bg-emerald-50">CONVEYANCE ALLOWANCE</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-emerald-50">{selectedSlip.conveyance || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-emerald-50">{selectedSlip.conveyance || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 bg-rose-50">LOAN</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-rose-50">{selectedSlip.loan || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-200 px-2 py-1 bg-green-50">CALL  ALLOWANCE</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-green-50">{selectedSlip.call_allowance || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-green-50">{selectedSlip.call_allowance || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 bg-red-50">ADVANCE</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-red-50">{selectedSlip.advance || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-200 px-2 py-1 bg-emerald-50">OTHER  ALLOWANCE</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-emerald-50">{selectedSlip.other_allowances || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-emerald-50">{selectedSlip.other_allowances || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 bg-rose-50">TAX DEDUCTED AT SOURCE</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-rose-50">{selectedSlip.tds || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-200 px-2 py-1 bg-green-50">PAID HOLIDAY AMOUNT</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-green-50">{selectedSlip.paid_holiday || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-green-50">{selectedSlip.paid_holiday || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 bg-red-50">RETENTION AMOUNT</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-red-50">{selectedSlip.retention || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-200 px-2 py-1 bg-emerald-50">BONUS</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-emerald-50">{selectedSlip.bonus || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-emerald-50">{selectedSlip.bonus || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 bg-rose-50">MLWF</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-rose-50">{selectedSlip.mlwf || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-purple-200 px-2 py-1 bg-green-50">OT RATE</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-green-50">{selectedSlip.ot_rate || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-green-50">{selectedSlip.ot_rate || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 bg-red-50"></td>
                    <td className="border border-purple-200 px-2 py-1 bg-red-50"></td>
                  </tr>
                  <tr>
                    <td className="border border-purple-200 px-2 py-1 bg-emerald-50">INCENTIVE</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-emerald-50">{selectedSlip.incentive || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 text-right font-mono bg-emerald-50">{selectedSlip.incentive || ''}</td>
                    <td className="border border-purple-200 px-2 py-1 bg-rose-50"></td>
                    <td className="border border-purple-200 px-2 py-1 bg-rose-50"></td>
                  </tr>
                  <tr className="font-bold" style={{background: 'linear-gradient(90deg, #e8f5e9, #f3e5f5, #fce4ec)'}}>
                    <td className="border border-purple-300 border-t-2 border-t-purple-800 px-2 py-1.5">GROSS EARNING</td>
                    <td className="border border-purple-300 border-t-2 border-t-purple-800 px-2 py-1.5 text-right font-mono"></td>
                    <td className="border border-purple-300 border-t-2 border-t-purple-800 px-2 py-1.5 text-right font-mono text-green-700">{selectedSlip.total_earnings || selectedSlip.gross_salary || '0.00'}</td>
                    <td className="border border-purple-300 border-t-2 border-t-purple-800 px-2 py-1.5">TOTAL DEDUCTION</td>
                    <td className="border border-purple-300 border-t-2 border-t-purple-800 px-2 py-1.5 text-right font-mono text-red-700">{selectedSlip.total_deductions || '0.00'}</td>
                  </tr>
                  <tr style={{background: 'linear-gradient(135deg, #64126D, #86288F)'}}>
                    <td className="border border-purple-400 px-2 py-2 text-white" colSpan={3}></td>
                    <td className="border border-purple-400 px-2 py-2 text-white font-extrabold text-[12px] tracking-wide">NET SALARY PAYABLE</td>
                    <td className="border border-purple-400 px-2 py-2 text-right text-white font-extrabold text-[13px] font-mono">{selectedSlip.net_salary || selectedSlip.net_pay || '0.00'}</td>
                  </tr>
                </tbody>
              </table>

              {/* Footer */}
              <div className="text-center text-[10px] text-purple-700 border-t-2 border-purple-800 pt-2 mt-0 font-medium" style={{background: '#f3e5f5'}}>
                <p>NOTE: THIS IS A COMPUTER GENERATED SALARY SLIP HENCE DOESN&apos;T REQUIRE SIGNATURE</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingSlip && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Salary Slip</h3>
            <p className="text-sm text-gray-600 mb-4">{editingSlip.employee_name} - {formatMonth(editingSlip.month)}</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
                <select
                  value={editForm.payment_status}
                  onChange={(e) => setEditForm({ ...editForm, payment_status: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                >
                  <option value="pending">Pending</option>
                  <option value="processed">Processed</option>
                  <option value="paid">Paid</option>
                  <option value="hold">On Hold</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
                <textarea
                  value={editForm.remarks}
                  onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  rows={3}
                  placeholder="Add any remarks..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditingSlip(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSaveEdit} className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bonus Employee Selection Modal */}
      {showBonusModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Select Employees for Bonus</h3>
                <button onClick={() => { setShowBonusModal(false); setBonusSearch(''); }} className="p-1 text-gray-400 hover:text-gray-600">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-3">Choose which employees should receive bonus in this payroll generation.</p>
              <div className="relative">
                <MagnifyingGlassIcon className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={bonusSearch}
                  onChange={(e) => setBonusSearch(e.target.value)}
                  placeholder="Search employees..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-gray-500">{selectedBonusEmployees.size} of {bonusEmployees.length} selected</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedBonusEmployees(new Set(bonusEmployees.map(e => e.id)))}
                    className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setSelectedBonusEmployees(new Set())}
                    className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {loadingBonusEmployees ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
                  <span className="ml-2 text-sm text-gray-500">Loading employees...</span>
                </div>
              ) : (
                <div className="space-y-1">
                  {bonusEmployees
                    .filter(e => {
                      if (!bonusSearch) return true;
                      const term = bonusSearch.toLowerCase();
                      return e.name.toLowerCase().includes(term) || 
                             (e.employee_id && String(e.employee_id).includes(term)) ||
                             e.department.toLowerCase().includes(term);
                    })
                    .map(emp => (
                      <label key={emp.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedBonusEmployees.has(emp.id)}
                          onChange={(e) => {
                            const next = new Set(selectedBonusEmployees);
                            if (e.target.checked) next.add(emp.id);
                            else next.delete(emp.id);
                            setSelectedBonusEmployees(next);
                          }}
                          className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{emp.name}</div>
                          <div className="text-xs text-gray-500">{emp.employee_id} {emp.department ? `· ${emp.department}` : ''}</div>
                        </div>
                      </label>
                    ))
                  }
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => { setShowBonusModal(false); setBonusSearch(''); }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowBonusModal(false);
                  setBonusSearch('');
                  const bonusIds = Array.from(selectedBonusEmployees);
                  executeGenerateSlips(bonusIds);
                }}
                disabled={selectedBonusEmployees.size === 0}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50"
              >
                Generate with Bonus ({selectedBonusEmployees.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
