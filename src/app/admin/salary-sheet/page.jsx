'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { InlineSpinner } from '@/components/LoadingSpinner';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  DocumentTextIcon,
  CalendarIcon,
  UserGroupIcon,
  CurrencyRupeeIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  FunnelIcon
} from '@heroicons/react/24/outline';

export default function SalarySheetPage() {
  const router = useRouter();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [salaryType, setSalaryType] = useState('payroll');
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [scheduledDA, setScheduledDA] = useState(0);

  const salaryTypes = [
    { value: 'payroll', label: 'Payroll Employees' },
    { value: 'contract', label: 'Contract Employees' },
    { value: 'all', label: 'All Employees' }
  ];

  useEffect(() => {
    fetchSlips();
    fetchScheduledDA();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, salaryType]);

  const fetchScheduledDA = async () => {
    try {
      const [yr, mn] = month.split('-');
      const monthDate = `${yr}-${mn}-01`;
      const res = await fetch(`/api/payroll/schedules?component_type=da&active_only=true&date=${monthDate}`);
      const data = await res.json();
      if (data.success && data.data && data.data.length > 0) {
        setScheduledDA(parseFloat(data.data[0].value) || 0);
      } else {
        setScheduledDA(0);
      }
    } catch {
      setScheduledDA(0);
    }
  };

  const fetchSlips = async () => {
    try {
      setLoading(true);
      setError('');
      let url = `/api/payroll/slips?month=${month}`;
      if (salaryType !== 'all') {
        url += `&salary_type=${salaryType}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setSlips(data.data || []);
      } else {
        setError(data.error);
      }
    } catch {
      setError('Failed to fetch payroll data');
    } finally {
      setLoading(false);
    }
  };

  const generatePayroll = async () => {
    if (!confirm(`Generate payroll for all employees for ${formatMonthDisplay(month)}?`)) return;
    
    try {
      setGenerating(true);
      setError('');
      setSuccess('');
      
      const res = await fetch('/api/payroll/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, all: true, salary_type: salaryType !== 'all' ? salaryType : null })
      });
      
      const data = await res.json();
      if (data.success) {
        setSuccess(`Payroll generated: ${data.results?.generated || 0} slips created, ${data.results?.skipped || 0} skipped, ${data.results?.errors || 0} errors`);
        fetchSlips();
      } else {
        setError(data.error);
      }
    } catch {
      setError('Failed to generate payroll');
    } finally {
      setGenerating(false);
    }
  };

  const exportToExcel = async () => {
    try {
      setExporting(true);
      setError('');
      
      let url = `/api/payroll/export-sheet?month=${month}`;
      if (salaryType !== 'all') {
        url += `&salary_type=${salaryType}`;
      }
      
      const res = await fetch(url);
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Export failed');
      }
      
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `Salary_Sheet_${month.substring(0, 7)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      
      setSuccess('Excel file downloaded successfully');
    } catch (err) {
      setError(err.message || 'Failed to export Excel');
    } finally {
      setExporting(false);
    }
  };

  const formatMonthDisplay = (monthStr) => {
    const d = new Date(monthStr);
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0);
  };

  // Calculate summary stats
  const isFeb = month.split('-')[1] === '02';
  const calcBasicPlusDa = (s) => Math.max(
    0,
    (Number(s.structure_basic_salary) || 0)
      || (Number(s.profile_basic) || 0)
      || (Number(s.profile_basic_plus_da) || 0)
      || (Number(s.basic) || 0)
  );
  const calcGross = (s) => {
    const basicPlusDa = calcBasicPlusDa(s);
    return basicPlusDa + (Number(s.hra) || 0) + (Number(s.conveyance) || 0) + (Number(s.call_allowance) || 0) + (Number(s.other_allowances) || 0) + (Number(s.bonus) || 0) + (Number(s.incentive) || 0) + (Number(s.paid_holiday) || 0) + (Number(s.ot_rate) || 0);
  };
  const totalGross = slips.reduce((sum, s) => sum + calcGross(s), 0);
  const totalNet = slips.reduce((sum, s) => sum + (calcGross(s) - (Number(s.total_deductions) || 0) - (isFeb ? (300 - (Number(s.pt) || 0)) : 0)), 0);
  const totalDeductions = slips.reduce((sum, s) => {
    const ptDiff = isFeb ? (300 - (Number(s.pt) || 0)) : 0;
    return sum + (Number(s.total_deductions) || 0) + ptDiff;
  }, 0);
  const paidCount = slips.filter(s => s.payment_status === 'paid').length;
  const pendingCount = slips.filter(s => s.payment_status === 'pending').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/employees')}
            className="flex items-center text-sm text-gray-600 hover:text-gray-900 mb-3 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            Back
          </button>
          
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <DocumentTextIcon className="w-7 h-7 text-green-600" />
                Salary Sheet
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">Export monthly salary data for all employees to Excel</p>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={generatePayroll}
                disabled={generating}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {generating ? <InlineSpinner className="w-4 h-4 mr-2" /> : <CurrencyRupeeIcon className="w-4 h-4 mr-2" />}
                Generate Payroll
              </button>
              
              <button
                onClick={exportToExcel}
                disabled={exporting || slips.length === 0}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {exporting ? <InlineSpinner className="w-4 h-4 mr-2" /> : <ArrowDownTrayIcon className="w-4 h-4 mr-2" />}
                Export Excel
              </button>
            </div>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
            <ExclamationCircleIcon className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
            <CheckCircleIcon className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{success}</span>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-gray-400" />
              <label className="text-sm font-medium text-gray-700">Month:</label>
              <input
                type="month"
                value={month.substring(0, 7)}
                onChange={(e) => setMonth(`${e.target.value}-01`)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <FunnelIcon className="w-5 h-5 text-gray-400" />
              <label className="text-sm font-medium text-gray-700">Type:</label>
              <select
                value={salaryType}
                onChange={(e) => setSalaryType(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {salaryTypes.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <UserGroupIcon className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Employees</p>
                <p className="text-lg font-bold text-gray-900">{slips.length}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CurrencyRupeeIcon className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Gross</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(totalGross)}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <CurrencyRupeeIcon className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Deductions</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(totalDeductions)}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <CurrencyRupeeIcon className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Net Pay</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(totalNet)}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <CheckCircleIcon className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <p className="text-sm font-medium text-gray-900">
                  <span className="text-green-600">{paidCount} paid</span> / <span className="text-yellow-600">{pendingCount} pending</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <InlineSpinner className="w-8 h-8" />
                <span className="ml-3 text-gray-500">Loading payroll data...</span>
              </div>
            ) : slips.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">No payroll slips found</p>
                <p className="text-sm mt-1">Generate payroll for {formatMonthDisplay(month)} to see data here.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-3 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10">#</th>
                    <th className="px-3 py-3 text-left font-semibold text-gray-700 sticky left-8 bg-gray-50 z-10 min-w-[160px]">Employee</th>
                    <th className="px-3 py-3 text-left font-semibold text-gray-700 min-w-[100px]">Department</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">Days</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">Present</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px]">Basic</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">HRA</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[70px]">DA</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px]">Conveyance</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px]">Call Allow</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px]">Other Allow</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">Bonus</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">Incentive</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px] bg-green-50">Gross</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[70px]">PF</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[70px]">ESIC</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[60px]">PT</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[70px]">MLWF</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[70px]">TDS</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">Retention</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">LOP</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px] bg-red-50">Deductions</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[100px] bg-green-100 sticky right-0 z-10">Net Pay</th>
                    <th className="px-3 py-3 text-center font-semibold text-gray-700 min-w-[80px]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {slips.map((slip, idx) => (
                    <tr key={slip.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 text-gray-500 sticky left-0 bg-white z-10">{idx + 1}</td>
                      <td className="px-3 py-3 sticky left-8 bg-white z-10">
                        <div className="font-medium text-gray-900">{slip.employee_name}</div>
                        <div className="text-xs text-gray-500">{slip.employee_code}</div>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{slip.department || '-'}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{slip.standard_working_days || 0}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{slip.payable_days || slip.standard_working_days || 0}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(calcBasicPlusDa(slip) - scheduledDA)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slip.hra)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(scheduledDA)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slip.conveyance)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slip.call_allowance)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slip.other_allowances)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slip.bonus)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slip.incentive)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-gray-900 bg-green-50">{formatCurrency(calcGross(slip))}</td>
                      <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slip.pf_employee)}</td>
                      <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slip.esic_employee)}</td>
                      <td className="px-3 py-3 text-right text-red-600">{formatCurrency(month.split('-')[1] === '02' ? 300 : slip.pt)}</td>
                      <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slip.mlwf)}</td>
                      <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slip.tds)}</td>
                      <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slip.retention)}</td>
                      <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slip.lop_deduction)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-red-600 bg-red-50">{formatCurrency((Number(slip.total_deductions) || 0) + (isFeb ? (300 - (Number(slip.pt) || 0)) : 0))}</td>
                      <td className="px-3 py-3 text-right font-bold text-green-700 bg-green-100 sticky right-0 z-10">{formatCurrency(calcGross(slip) - ((Number(slip.total_deductions) || 0) + (isFeb ? (300 - (Number(slip.pt) || 0)) : 0)))}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          slip.payment_status === 'paid' ? 'bg-green-100 text-green-700' :
                          slip.payment_status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          slip.payment_status === 'hold' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {slip.payment_status || 'pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                  <tr className="font-bold">
                    <td colSpan="3" className="px-3 py-3 text-right text-gray-700 sticky left-0 bg-gray-50 z-10">TOTALS:</td>
                    <td colSpan="2" className="px-3 py-3"></td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slips.reduce((s, r) => s + (calcBasicPlusDa(r) - scheduledDA), 0))}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slips.reduce((s, r) => s + (Number(r.hra) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(scheduledDA * slips.length)}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slips.reduce((s, r) => s + (Number(r.conveyance) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slips.reduce((s, r) => s + (Number(r.call_allowance) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slips.reduce((s, r) => s + (Number(r.other_allowances) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slips.reduce((s, r) => s + (Number(r.bonus) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{formatCurrency(slips.reduce((s, r) => s + (Number(r.incentive) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-gray-900 bg-green-50">{formatCurrency(totalGross)}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slips.reduce((s, r) => s + (Number(r.pf_employee) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slips.reduce((s, r) => s + (Number(r.esic_employee) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(month.split('-')[1] === '02' ? (300 * slips.length) : slips.reduce((s, r) => s + (Number(r.pt) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slips.reduce((s, r) => s + (Number(r.mlwf) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slips.reduce((s, r) => s + (Number(r.tds) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slips.reduce((s, r) => s + (Number(r.retention) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(slips.reduce((s, r) => s + (Number(r.lop_deduction) || 0), 0))}</td>
                    <td className="px-3 py-3 text-right text-red-600 bg-red-50">{formatCurrency(totalDeductions)}</td>
                    <td className="px-3 py-3 text-right text-green-700 bg-green-100 sticky right-0 z-10">{formatCurrency(totalNet)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
