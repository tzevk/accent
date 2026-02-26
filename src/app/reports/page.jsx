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
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [salaryTypeFilter, setSalaryTypeFilter] = useState('payroll');
  
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

  // Generate all individual slips (used before exporting sheet)
  const handleGenerateAllSlips = async () => {
    if (!confirm(`This will generate individual salary slips for ${salaryTypeFilter === 'contract' ? 'contract ' : 'payroll '}employees for the selected month. Continue?`)) {
      return;
    }
    
    setGenerating(true);
    try {
      const month = `${selectedMonth}-01`;
      
      const res = await fetch('/api/payroll/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, all: true, salary_type: salaryTypeFilter })
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
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; padding: 10px; font-size: 11px; color: #000; }
            .slip-container { max-width: 1100px; margin: 0 auto; border: 2px solid #000; }
            
            /* Header with Logo */
            .header { display: flex; align-items: center; padding: 10px 15px; background: #fff; border-bottom: 2px solid #000; }
            .logo { width: 100px; margin-right: 20px; }
            .logo img { width: 100%; height: auto; }
            .company-info { flex: 1; text-align: center; }
            .company-info h1 { font-size: 24px; font-weight: bold; color: #4B0082; margin-bottom: 5px; }
            .company-info p { font-size: 12px; color: #000; font-weight: 600; line-height: 1.4; }
            
            /* Month Title */
            .slip-title { text-align: center; padding: 8px; background: #e8e8e8; border-bottom: 2px solid #000; font-weight: bold; font-size: 12px; }
            
            /* Info Table */
            .info-table { width: 100%; border-collapse: collapse; }
            .info-table td { padding: 4px 8px; border: 1px solid #000; font-size: 11px; vertical-align: middle; }
            .info-table .label { font-weight: bold; background: #fff; }
            .info-table .value { background: #fff; }
            .info-table .days-cell { font-weight: bold; background: #fff; }
            
            /* Main Table */
            .main-table { width: 100%; border-collapse: collapse; }
            .main-table th, .main-table td { border: 1px solid #000; padding: 4px 6px; font-size: 11px; }
            .main-table th { background: #e8e8e8; font-weight: bold; text-align: center; }
            .main-table td.amount { text-align: right; font-family: Arial, sans-serif; }
            .main-table tr.total-row { background: #e8e8e8; font-weight: bold; }
            .main-table tr.total-row td { border-top: 2px solid #000; }
            .net-salary-cell { background: #e8e8e8; font-weight: bold; vertical-align: middle; }
            
            /* Footer */
            .footer { padding: 10px; text-align: center; font-size: 10px; border-top: 2px solid #000; background: #fff; }
            
            @media print { 
              body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .slip-container { border: 2px solid #000; }
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
            
            <!-- Employee Info Section -->
            <table class="main-table">
              <colgroup>
                <col style="width:15%">
                <col style="width:18%">
                <col style="width:14%">
                <col style="width:14%">
                <col style="width:14%">
                <col style="width:25%">
              </colgroup>
              <tr>
                <td class="label">NAME :</td>
                <td class="value">${selectedSlip?.employee_name || ''}</td>
                <td class="label">DESIGNATION :</td>
                <td class="value">${selectedSlip?.designation || ''}</td>
                <td class="label" rowspan="2">TOTAL DAYS :</td>
                <td class="value" rowspan="2">${selectedSlip?.standard_working_days || ''}</td>
              </tr>
              <tr>
                <td class="label">DESIGNATION :</td>
                <td class="value">${selectedSlip?.designation || ''}</td>
                <td class="label">DEPARTMENT :</td>
                <td class="value">${selectedSlip?.department || ''}</td>
              </tr>
              <tr>
                <td class="label">DEPARTMENT :</td>
                <td class="value">${selectedSlip?.department || ''}</td>
                <td class="label">DATE OF JOINING :</td>
                <td class="value">${selectedSlip?.joining_date ? new Date(selectedSlip.joining_date).toLocaleDateString('en-IN') : ''}</td>
                <td class="label" rowspan="2">PRESENT DAYS :</td>
                <td class="value" rowspan="2">${selectedSlip?.payable_days || ''}</td>
              </tr>
              <tr>
                <td class="label">DATE OF JOINING :</td>
                <td class="value">${selectedSlip?.joining_date ? new Date(selectedSlip.joining_date).toLocaleDateString('en-IN') : ''}</td>
                <td class="label">ESIC NUMBER:</td>
                <td class="value">${selectedSlip?.esic_number || ''}</td>
              </tr>
              <tr>
                <td class="label">PF  NUMBER:</td>
                <td class="value">${selectedSlip?.pf_number || ''}</td>
                <td class="label">UAN  NUMBER :</td>
                <td class="value">${selectedSlip?.uan_number || ''}</td>
                <td class="label" rowspan="2">ABSENT DAYS :</td>
                <td class="value" rowspan="2">${selectedSlip?.standard_working_days && selectedSlip?.payable_days ? (parseFloat(selectedSlip.standard_working_days) - parseFloat(selectedSlip.payable_days)).toFixed(1) : (selectedSlip?.lop_days || '0.0')}</td>
              </tr>
              <tr>
                <td class="label">PAN NO :</td>
                <td class="value">${selectedSlip?.pan_number || ''}</td>
                <td class="label">PAYMENT MODE :</td>
                <td class="value">${selectedSlip?.payment_mode || ''}</td>
              </tr>
            </table>
            
            <!-- Main Content Table -->
            <table class="main-table">
              <colgroup>
                <col style="width:15%">
                <col style="width:9%">
                <col style="width:9%">
                <col style="width:14%">
                <col style="width:8%">
                <col style="width:6%">
                <col style="width:9%">
                <col style="width:9%">
                <col style="width:9%">
                <col style="width:12%">
              </colgroup>
              <tr>
                <th>DESCRIPTION</th>
                <th>Gross</th>
                <th>EARNING</th>
                <th>DESCRIPTION</th>
                <th>DEDUCTION</th>
                <th>LEAVE</th>
                <th>OPG.</th>
                <th>CR.</th>
                <th>DR.</th>
                <th>BALANCE</th>
              </tr>
              <tr>
                <td>BASIC</td>
                <td class="amount">${selectedSlip?.basic || ''}</td>
                <td class="amount">${selectedSlip?.basic || ''}</td>
                <td>PROVIDENT FUND</td>
                <td class="amount">${selectedSlip?.pf_employee || ''}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>DA</td>
                <td class="amount">${selectedSlip?.da || ''}</td>
                <td class="amount">${selectedSlip?.da || ''}</td>
                <td>ESIC</td>
                <td class="amount">${selectedSlip?.esic_employee || ''}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>HRA</td>
                <td class="amount">${selectedSlip?.hra || ''}</td>
                <td class="amount">${selectedSlip?.hra || ''}</td>
                <td>PROFESSIONAL TAX</td>
                <td class="amount">${selectedSlip?.pt || ''}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>CONVEYANCE ALLOWANCE</td>
                <td class="amount">${selectedSlip?.conveyance || ''}</td>
                <td class="amount">${selectedSlip?.conveyance || ''}</td>
                <td>LOAN</td>
                <td class="amount">${selectedSlip?.loan || ''}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>CALL  ALLOWANCE</td>
                <td class="amount">${selectedSlip?.call_allowance || ''}</td>
                <td class="amount">${selectedSlip?.call_allowance || ''}</td>
                <td>ADVANCE</td>
                <td class="amount">${selectedSlip?.advance || ''}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>OTHER  ALLOWANCE</td>
                <td class="amount">${selectedSlip?.other_allowances || ''}</td>
                <td class="amount">${selectedSlip?.other_allowances || ''}</td>
                <td>TAX DEDUCTED AT SOURCE</td>
                <td class="amount">${selectedSlip?.tds || ''}</td>
                <td>PL</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
              </tr>
              <tr>
                <td></td>
                <td></td>
                <td></td>
                <td>AMOUNT AFTER TDS</td>
                <td class="amount">${selectedSlip?.tds ? ((selectedSlip?.total_earnings || selectedSlip?.gross_salary || 0) - (selectedSlip?.tds || 0)).toFixed(2) : ''}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>PAID HOLIDAY AMOUNT</td>
                <td class="amount">${selectedSlip?.paid_holiday || ''}</td>
                <td class="amount">${selectedSlip?.paid_holiday || ''}</td>
                <td>RETENTION AMOUNT</td>
                <td class="amount">${selectedSlip?.retention || ''}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>BONUS</td>
                <td class="amount">${selectedSlip?.bonus || ''}</td>
                <td class="amount">${selectedSlip?.bonus || ''}</td>
                <td>MLWF</td>
                <td class="amount">${selectedSlip?.mlwf || ''}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>OT RATE</td>
                <td class="amount">${selectedSlip?.ot_rate || ''}</td>
                <td class="amount">${selectedSlip?.ot_rate || ''}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <td>INCENTIVE</td>
                <td class="amount">${selectedSlip?.incentive || ''}</td>
                <td class="amount">${selectedSlip?.incentive || ''}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
              <tr class="total-row">
                <td>GROSS EARNING</td>
                <td class="amount"></td>
                <td class="amount">${selectedSlip?.total_earnings || selectedSlip?.gross_salary || '0.00'}</td>
                <td>TOTAL DEDUCTION</td>
                <td class="amount">${selectedSlip?.total_deductions || '0.00'}</td>
                <td class="net-salary-cell" colspan="4">NET SALARY PAYABLE</td>
                <td class="net-salary-cell amount">${selectedSlip?.net_salary || selectedSlip?.net_pay || '0.00'}</td>
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
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-auto">
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

            <div ref={slipRef} className="p-4 border-2 border-black">
              {/* Header with Logo */}
              <div className="flex items-center pb-2 border-b-2 border-black">
                <div className="w-24 mr-5">
                  <img src="/accent-logo.png" alt="Accent Logo" className="w-full h-auto" />
                </div>
                <div className="flex-1 text-center">
                  <h1 className="text-2xl font-bold text-purple-800">ACCENT TECHNO SOLUTIONS PVT LTD</h1>
                  <p className="text-xs text-black font-semibold">17/130, ANAND NAGAR, NEHRU ROAD, VAKOLA, SANTACRUZ (E),</p>
                  <p className="text-xs text-black font-semibold">MUMBAI,MAHARASHTRA - 400055</p>
                  <p className="text-xs text-black font-semibold">Mobile: 9324670725</p>
                </div>
              </div>

              {/* Month Title */}
              <div className="bg-gray-200 border-b-2 border-black px-3 py-2 font-bold text-center text-xs">
                SALARY SLIP FOR THE MONTH OF {formatMonth(selectedSlip.month).toUpperCase()}
              </div>

              {/* Employee Info Table */}
              <table className="w-full border-collapse text-[11px]">
                <colgroup>
                  <col style={{width: '15%'}} />
                  <col style={{width: '18%'}} />
                  <col style={{width: '14%'}} />
                  <col style={{width: '14%'}} />
                  <col style={{width: '14%'}} />
                  <col style={{width: '25%'}} />
                </colgroup>
                <tbody>
                  <tr>
                    <td className="border border-black px-2 py-1 font-bold">NAME :</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.employee_name || ''}</td>
                    <td className="border border-black px-2 py-1 font-bold">DESIGNATION :</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.designation || ''}</td>
                    <td className="border border-black px-2 py-1 font-bold" rowSpan={2}>TOTAL DAYS :</td>
                    <td className="border border-black px-2 py-1" rowSpan={2}>{selectedSlip.standard_working_days || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1 font-bold">DESIGNATION :</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.designation || ''}</td>
                    <td className="border border-black px-2 py-1 font-bold">DEPARTMENT :</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.department || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1 font-bold">DEPARTMENT :</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.department || ''}</td>
                    <td className="border border-black px-2 py-1 font-bold">DATE OF JOINING :</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.joining_date ? new Date(selectedSlip.joining_date).toLocaleDateString('en-IN') : ''}</td>
                    <td className="border border-black px-2 py-1 font-bold" rowSpan={2}>PRESENT DAYS :</td>
                    <td className="border border-black px-2 py-1" rowSpan={2}>{selectedSlip.payable_days || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1 font-bold">DATE OF JOINING :</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.joining_date ? new Date(selectedSlip.joining_date).toLocaleDateString('en-IN') : ''}</td>
                    <td className="border border-black px-2 py-1 font-bold">ESIC NUMBER:</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.esic_number || ''}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1 font-bold">PF  NUMBER:</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.pf_number || ''}</td>
                    <td className="border border-black px-2 py-1 font-bold">UAN  NUMBER :</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.uan_number || ''}</td>
                    <td className="border border-black px-2 py-1 font-bold" rowSpan={2}>ABSENT DAYS :</td>
                    <td className="border border-black px-2 py-1" rowSpan={2}>{selectedSlip.standard_working_days && selectedSlip.payable_days ? (parseFloat(selectedSlip.standard_working_days) - parseFloat(selectedSlip.payable_days)).toFixed(1) : (selectedSlip.lop_days || '0.0')}</td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1 font-bold">PAN NO :</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.pan_number || ''}</td>
                    <td className="border border-black px-2 py-1 font-bold">PAYMENT MODE :</td>
                    <td className="border border-black px-2 py-1">{selectedSlip.payment_mode || ''}</td>
                  </tr>
                </tbody>
              </table>

              {/* Main Content Table */}
              <table className="w-full border-collapse text-[11px]">
                <colgroup>
                  <col style={{width: '15%'}} />
                  <col style={{width: '9%'}} />
                  <col style={{width: '9%'}} />
                  <col style={{width: '14%'}} />
                  <col style={{width: '8%'}} />
                  <col style={{width: '6%'}} />
                  <col style={{width: '9%'}} />
                  <col style={{width: '9%'}} />
                  <col style={{width: '9%'}} />
                  <col style={{width: '12%'}} />
                </colgroup>
                <thead>
                  <tr className="bg-gray-200">
                    <th className="border border-black px-2 py-1">DESCRIPTION</th>
                    <th className="border border-black px-2 py-1">Gross</th>
                    <th className="border border-black px-2 py-1">EARNING</th>
                    <th className="border border-black px-2 py-1">DESCRIPTION</th>
                    <th className="border border-black px-2 py-1">DEDUCTION</th>
                    <th className="border border-black px-2 py-1">LEAVE</th>
                    <th className="border border-black px-2 py-1">OPG.</th>
                    <th className="border border-black px-2 py-1">CR.</th>
                    <th className="border border-black px-2 py-1">DR.</th>
                    <th className="border border-black px-2 py-1">BALANCE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-black px-2 py-1">BASIC</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.basic || ''}</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.basic || ''}</td>
                    <td className="border border-black px-2 py-1">PROVIDENT FUND</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.pf_employee || ''}</td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1">DA</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.da || ''}</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.da || ''}</td>
                    <td className="border border-black px-2 py-1">ESIC</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.esic_employee || ''}</td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1">HRA</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.hra || ''}</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.hra || ''}</td>
                    <td className="border border-black px-2 py-1">PROFESSIONAL TAX</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.pt || ''}</td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1">CONVEYANCE ALLOWANCE</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.conveyance || ''}</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.conveyance || ''}</td>
                    <td className="border border-black px-2 py-1">LOAN</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.loan || ''}</td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1">CALL  ALLOWANCE</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.call_allowance || ''}</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.call_allowance || ''}</td>
                    <td className="border border-black px-2 py-1">ADVANCE</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.advance || ''}</td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1">OTHER  ALLOWANCE</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.other_allowances || ''}</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.other_allowances || ''}</td>
                    <td className="border border-black px-2 py-1">TAX DEDUCTED AT SOURCE</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.tds || ''}</td>
                    <td className="border border-black px-2 py-1">PL</td>
                    <td className="border border-black px-2 py-1 text-center">-</td>
                    <td className="border border-black px-2 py-1 text-center">-</td>
                    <td className="border border-black px-2 py-1 text-center">-</td>
                    <td className="border border-black px-2 py-1 text-center">-</td>
                  </tr>
                  {selectedSlip.tds ? (
                  <tr>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1 font-semibold">AMOUNT AFTER TDS</td>
                    <td className="border border-black px-2 py-1 text-right font-semibold">{((selectedSlip.total_earnings || selectedSlip.gross_salary || 0) - (selectedSlip.tds || 0)).toFixed(2)}</td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                  </tr>
                  ) : null}
                  <tr>
                    <td className="border border-black px-2 py-1">PAID HOLIDAY AMOUNT</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.paid_holiday || ''}</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.paid_holiday || ''}</td>
                    <td className="border border-black px-2 py-1">RETENTION AMOUNT</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.retention || ''}</td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1">BONUS</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.bonus || ''}</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.bonus || ''}</td>
                    <td className="border border-black px-2 py-1">MLWF</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.mlwf || ''}</td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1">OT RATE</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.ot_rate || ''}</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.ot_rate || ''}</td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                  </tr>
                  <tr>
                    <td className="border border-black px-2 py-1">INCENTIVE</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.incentive || ''}</td>
                    <td className="border border-black px-2 py-1 text-right">{selectedSlip.incentive || ''}</td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                    <td className="border border-black px-2 py-1"></td>
                  </tr>
                  <tr className="bg-gray-200 font-bold">
                    <td className="border border-black border-t-2 px-2 py-1">GROSS EARNING</td>
                    <td className="border border-black border-t-2 px-2 py-1 text-right"></td>
                    <td className="border border-black border-t-2 px-2 py-1 text-right">{selectedSlip.total_earnings || selectedSlip.gross_salary || '0.00'}</td>
                    <td className="border border-black border-t-2 px-2 py-1">TOTAL DEDUCTION</td>
                    <td className="border border-black border-t-2 px-2 py-1 text-right">{selectedSlip.total_deductions || '0.00'}</td>
                    <td className="border border-black border-t-2 px-2 py-1 bg-gray-200 font-bold" colSpan={4}>NET SALARY PAYABLE</td>
                    <td className="border border-black border-t-2 px-2 py-1 bg-gray-200 font-bold text-right">{selectedSlip.net_salary || selectedSlip.net_pay || '0.00'}</td>
                  </tr>
                </tbody>
              </table>

              {/* Footer */}
              <div className="text-center text-[10px] text-gray-600 border-t-2 border-black pt-2 mt-0">
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
    </div>
  );
}
