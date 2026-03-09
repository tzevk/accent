'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { InlineSpinner } from '@/components/LoadingSpinner';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  DocumentIcon,
  CalendarIcon,
  UserIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PrinterIcon,
  DocumentDuplicateIcon
} from '@heroicons/react/24/outline';

export default function SalarySlipPage() {
  const router = useRouter();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [salaryType, setSalaryType] = useState('payroll');
  const [slips, setSlips] = useState([]);
  const [filteredSlips, setFilteredSlips] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  // const [selectedSlips, setSelectedSlips] = useState([]); // For future batch selection
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [previewSlip, setPreviewSlip] = useState(null);

  const salaryTypes = [
    { value: 'payroll', label: 'Payroll Employees' },
    { value: 'contract', label: 'Contract Employees' },
    { value: 'all', label: 'All Employees' }
  ];

  useEffect(() => {
    fetchSlips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, salaryType]);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredSlips(slips);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredSlips(slips.filter(s => 
        s.employee_name?.toLowerCase().includes(query) ||
        s.employee_code?.toLowerCase().includes(query) ||
        s.department?.toLowerCase().includes(query)
      ));
    }
  }, [searchQuery, slips]);

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
        setFilteredSlips(data.data || []);
      } else {
        setError(data.error);
      }
    } catch {
      setError('Failed to fetch payroll data');
    } finally {
      setLoading(false);
    }
  };

  const exportSinglePDF = async (slip) => {
    try {
      setExporting(true);
      setError('');
      
      const url = `/api/payroll/bulk-pdf?month=${month}&employee_id=${slip.employee_id}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Export failed');
      }
      
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `Salary_Slip_${slip.employee_name?.replace(/\s+/g, '_') || slip.employee_id}_${month.substring(0, 7)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      
      setSuccess(`PDF generated for ${slip.employee_name}`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  const exportBulkPDF = async () => {
    try {
      setExporting(true);
      setError('');
      
      let url = `/api/payroll/bulk-pdf?month=${month}`;
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
      a.download = `Salary_Slips_${month.substring(0, 7)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      
      setSuccess(`PDF generated for all ${slips.length} employees`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  // For future: batch selection for multi-PDF export
  // const toggleSelectAll = () => {
  //   if (selectedSlips.length === filteredSlips.length) {
  //     setSelectedSlips([]);
  //   } else {
  //     setSelectedSlips(filteredSlips.map(s => s.id));
  //   }
  // };
  // const toggleSelectSlip = (slipId) => {
  //   if (selectedSlips.includes(slipId)) {
  //     setSelectedSlips(selectedSlips.filter(id => id !== slipId));
  //   } else {
  //     setSelectedSlips([...selectedSlips, slipId]);
  //   }
  // };

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
                <DocumentIcon className="w-7 h-7 text-blue-600" />
                Salary Slips
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">Download individual or bulk salary slip PDFs</p>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={exportBulkPDF}
                disabled={exporting || slips.length === 0}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {exporting ? <InlineSpinner className="w-4 h-4 mr-2" /> : <DocumentDuplicateIcon className="w-4 h-4 mr-2" />}
                Download All PDFs
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
            
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by name, code, or department..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Slips Grid */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <InlineSpinner className="w-8 h-8" />
              <span className="ml-3 text-gray-500">Loading salary slips...</span>
            </div>
          ) : filteredSlips.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <DocumentIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No salary slips found</p>
              <p className="text-sm mt-1">
                {slips.length === 0 
                  ? `Generate payroll for ${formatMonthDisplay(month)} to see slips here.`
                  : 'No employees match your search criteria.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
              {filteredSlips.map((slip) => (
                <div
                  key={slip.id}
                  className="bg-gray-50 rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  {/* Employee Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <UserIcon className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 text-sm">{slip.employee_name}</h3>
                        <p className="text-xs text-gray-500">{slip.employee_code}</p>
                      </div>
                    </div>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      slip.payment_status === 'paid' ? 'bg-green-100 text-green-700' :
                      slip.payment_status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                      slip.payment_status === 'hold' ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {slip.payment_status || 'pending'}
                    </span>
                  </div>
                  
                  {/* Slip Details */}
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Department</span>
                      <span className="text-gray-700">{slip.department || '-'}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Working Days</span>
                      <span className="text-gray-700">{slip.standard_working_days || 0} / {slip.payable_days || slip.standard_working_days || 0}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Gross Salary</span>
                      <span className="text-gray-900 font-medium">{formatCurrency(slip.gross)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Deductions</span>
                      <span className="text-red-600">{formatCurrency(slip.total_deductions)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-gray-200">
                      <span className="text-sm font-medium text-gray-700">Net Pay</span>
                      <span className="text-sm font-bold text-green-700">{formatCurrency(slip.net_pay)}</span>
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPreviewSlip(slip)}
                      className="flex-1 inline-flex items-center justify-center px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-xs font-medium"
                    >
                      <PrinterIcon className="w-4 h-4 mr-1" />
                      Preview
                    </button>
                    <button
                      onClick={() => exportSinglePDF(slip)}
                      disabled={exporting}
                      className="flex-1 inline-flex items-center justify-center px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-xs font-medium"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
                      PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Summary Footer */}
        {filteredSlips.length > 0 && (
          <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm text-gray-600">
                Showing <span className="font-semibold text-gray-900">{filteredSlips.length}</span> of <span className="font-semibold text-gray-900">{slips.length}</span> employees
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-gray-500">Total Gross:</span>
                  <span className="ml-2 font-semibold text-gray-900">
                    {formatCurrency(filteredSlips.reduce((s, r) => s + (Number(r.gross) || 0), 0))}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Total Net:</span>
                  <span className="ml-2 font-semibold text-green-700">
                    {formatCurrency(filteredSlips.reduce((s, r) => s + (Number(r.net_pay) || 0), 0))}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewSlip && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="p-6">
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-gray-900">Salary Slip Preview</h2>
                <button
                  onClick={() => setPreviewSlip(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Company Header */}
              <div className="text-center mb-6 pb-4 border-b border-gray-200">
                <h3 className="text-xl font-bold text-gray-900">ACCENT TECHNO SOLUTIONS PVT LTD</h3>
                <p className="text-xs text-gray-500 mt-1">17/130, ANAND NAGAR, NEHRU ROAD, VAKOLA, SANTACRUZ (E), MUMBAI - 400055</p>
                <div className="mt-3 inline-block bg-gray-100 px-4 py-1 rounded">
                  <span className="text-sm font-semibold text-gray-700">
                    SALARY SLIP FOR {formatMonthDisplay(previewSlip.month).toUpperCase()}
                  </span>
                </div>
              </div>
              
              {/* Employee Info */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Name:</span>
                    <span className="font-medium text-gray-900">{previewSlip.employee_name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Employee Code:</span>
                    <span className="font-medium text-gray-900">{previewSlip.employee_code}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Department:</span>
                    <span className="font-medium text-gray-900">{previewSlip.department || '-'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Designation:</span>
                    <span className="font-medium text-gray-900">{previewSlip.designation || previewSlip.position || '-'}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Working Days:</span>
                    <span className="font-medium text-gray-900">{previewSlip.standard_working_days || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Present Days:</span>
                    <span className="font-medium text-gray-900">{previewSlip.payable_days || previewSlip.standard_working_days || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">LOP Days:</span>
                    <span className="font-medium text-gray-900">{previewSlip.lop_days || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">PL Balance:</span>
                    <span className="font-medium text-gray-900">{previewSlip.pl_balance ?? 21}</span>
                  </div>
                </div>
              </div>
              
              {/* Earnings & Deductions */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                {/* Earnings */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b">Earnings</h4>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Basic</span>
                      <span className="text-gray-900">{formatCurrency(previewSlip.basic)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">DA</span>
                      <span className="text-gray-900">{formatCurrency(previewSlip.da)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">HRA</span>
                      <span className="text-gray-900">{formatCurrency(previewSlip.hra)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Conveyance</span>
                      <span className="text-gray-900">{formatCurrency(previewSlip.conveyance)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Call Allowance</span>
                      <span className="text-gray-900">{formatCurrency(previewSlip.call_allowance)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Other Allowances</span>
                      <span className="text-gray-900">{formatCurrency(previewSlip.other_allowances)}</span>
                    </div>
                    {Number(previewSlip.bonus) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Bonus</span>
                        <span className="text-gray-900">{formatCurrency(previewSlip.bonus)}</span>
                      </div>
                    )}
                    {Number(previewSlip.incentive) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Incentive</span>
                        <span className="text-gray-900">{formatCurrency(previewSlip.incentive)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-semibold pt-1 border-t">
                      <span className="text-gray-700">Total Earnings</span>
                      <span className="text-gray-900">{formatCurrency(previewSlip.total_earnings || previewSlip.gross)}</span>
                    </div>
                  </div>
                </div>
                
                {/* Deductions */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b">Deductions</h4>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Provident Fund</span>
                      <span className="text-red-600">{formatCurrency(previewSlip.pf_employee)}</span>
                    </div>
                    {Number(previewSlip.esic_employee) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">ESIC</span>
                        <span className="text-red-600">{formatCurrency(previewSlip.esic_employee)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Professional Tax</span>
                      <span className="text-red-600">{formatCurrency(previewSlip.pt)}</span>
                    </div>
                    {Number(previewSlip.tds) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">TDS</span>
                        <span className="text-red-600">{formatCurrency(previewSlip.tds)}</span>
                      </div>
                    )}
                    {Number(previewSlip.mlwf) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">MLWF</span>
                        <span className="text-red-600">{formatCurrency(previewSlip.mlwf)}</span>
                      </div>
                    )}
                    {Number(previewSlip.lop_deduction) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">LOP Deduction</span>
                        <span className="text-red-600">{formatCurrency(previewSlip.lop_deduction)}</span>
                      </div>
                    )}
                    {Number(previewSlip.other_deductions) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Other Deductions</span>
                        <span className="text-red-600">{formatCurrency(previewSlip.other_deductions)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-semibold pt-1 border-t">
                      <span className="text-gray-700">Total Deductions</span>
                      <span className="text-red-600">{formatCurrency(previewSlip.total_deductions)}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Net Pay */}
              <div className="bg-green-50 rounded-lg p-4 mb-6">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold text-gray-700">Net Salary Payable</span>
                  <span className="text-2xl font-bold text-green-700">{formatCurrency(previewSlip.net_pay)}</span>
                </div>
              </div>
              
              {/* Footer */}
              <p className="text-xs text-gray-400 text-center mb-4">
                This is a computer generated salary slip and does not require signature.
              </p>
              
              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setPreviewSlip(null)}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    exportSinglePDF(previewSlip);
                    setPreviewSlip(null);
                  }}
                  disabled={exporting}
                  className="flex-1 inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
                >
                  <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
                  Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
