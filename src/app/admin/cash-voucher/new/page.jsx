'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { 
  BanknotesIcon,
  PlusIcon,
  TrashIcon,
  ArrowLeftIcon,
  CheckIcon
} from '@heroicons/react/24/outline';

export default function NewCashVoucherPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useSessionRBAC();
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [projects, setProjects] = useState([]);
  const [descriptions, setDescriptions] = useState([]);
  const [accountHeads, setAccountHeads] = useState([]);
  
  // Form state
  const [formData, setFormData] = useState({
    voucher_number: '',
    voucher_date: new Date().toISOString().split('T')[0],
    paid_to: '',
    project_number: '',
    payment_mode: 'cash', // cash or cheque
    total_amount: 0,
    amount_in_words: '',
    prepared_by: '',
    checked_by: '',
    approved_by: '',
    receiver_signature: '',
    notes: ''
  });

  // Line items
  const [lineItems, setLineItems] = useState([
    { sr_no: 1, bill_date: '', bill_no: '', account_head: '', amount_rs: '', amount_ps: '', description: '' }
  ]);

  // Fetch next voucher number and employees
  useEffect(() => {
    const fetchVoucherNumber = async () => {
      try {
        const res = await fetch('/api/admin/cash-vouchers/next-number');
        const data = await res.json();
        if (data.success) {
          setFormData(prev => ({ ...prev, voucher_number: data.voucher_number }));
        }
      } catch (error) {
        console.error('Error fetching voucher number:', error);
      }
    };

    const fetchEmployees = async () => {
      try {
        const res = await fetch('/api/employee-master/list');
        const data = await res.json();
        if (data.success) {
          setEmployees(data.data || []);
        }
      } catch (error) {
        console.error('Error fetching employees:', error);
      }
    };

    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/projects/list');
        const data = await res.json();
        if (data.success) {
          setProjects(data.data || []);
        }
      } catch (error) {
        console.error('Error fetching projects:', error);
      }
    };

    const fetchDescriptions = async () => {
      try {
        const res = await fetch('/api/masters/descriptions');
        const data = await res.json();
        if (data.success) {
          // Only get active descriptions
          setDescriptions((data.data || []).filter(d => d.is_active !== false));
        }
      } catch (error) {
        console.error('Error fetching descriptions:', error);
      }
    };

    const fetchAccountHeads = async () => {
      try {
        const res = await fetch('/api/masters/account-heads');
        const data = await res.json();
        if (data.success) {
          // Only get active account heads
          setAccountHeads((data.data || []).filter(d => d.is_active !== false));
        }
      } catch (error) {
        console.error('Error fetching account heads:', error);
      }
    };
    
    if (!authLoading && user) {
      fetchVoucherNumber();
      fetchEmployees();
      fetchProjects();
      fetchDescriptions();
      fetchAccountHeads();
      setFormData(prev => ({ ...prev, prepared_by: user.full_name || user.username || '' }));
    }
  }, [authLoading, user]);

  // Calculate total
  useEffect(() => {
    const total = lineItems.reduce((sum, item) => {
      const rs = parseFloat(item.amount_rs) || 0;
      const ps = parseFloat(item.amount_ps) || 0;
      return sum + rs + (ps / 100);
    }, 0);
    setFormData(prev => ({ ...prev, total_amount: total }));
  }, [lineItems]);

  // Convert number to words
  const numberToWords = (num) => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
      'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    if (num === 0) return 'Zero';
    
    const convertLessThanThousand = (n) => {
      if (n === 0) return '';
      if (n < 20) return ones[n];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
      return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertLessThanThousand(n % 100) : '');
    };
    
    const wholePart = Math.floor(num);
    const decimalPart = Math.round((num - wholePart) * 100);
    
    let result = '';
    
    if (wholePart >= 10000000) {
      result += convertLessThanThousand(Math.floor(wholePart / 10000000)) + ' Crore ';
      num = wholePart % 10000000;
    }
    if (wholePart >= 100000) {
      result += convertLessThanThousand(Math.floor((wholePart % 10000000) / 100000)) + ' Lakh ';
    }
    if (wholePart >= 1000) {
      result += convertLessThanThousand(Math.floor((wholePart % 100000) / 1000)) + ' Thousand ';
    }
    if (wholePart >= 100) {
      result += convertLessThanThousand(Math.floor((wholePart % 1000) / 100)) + ' Hundred ';
    }
    if (wholePart % 100 > 0) {
      result += convertLessThanThousand(wholePart % 100);
    }
    
    result = result.trim() + ' Rupees';
    
    if (decimalPart > 0) {
      result += ' and ' + convertLessThanThousand(decimalPart) + ' Paise';
    }
    
    return result + ' Only';
  };

  // Update amount in words when total changes
  useEffect(() => {
    if (formData.total_amount > 0) {
      setFormData(prev => ({ ...prev, amount_in_words: numberToWords(prev.total_amount) }));
    }
  }, [formData.total_amount]);

  // Add new line item
  const addLineItem = () => {
    setLineItems(prev => [
      ...prev,
      { sr_no: prev.length + 1, bill_date: '', bill_no: '', account_head: '', amount_rs: '', amount_ps: '', description: '' }
    ]);
  };

  // Remove line item
  const removeLineItem = (index) => {
    if (lineItems.length === 1) return;
    setLineItems(prev => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.map((item, i) => ({ ...item, sr_no: i + 1 }));
    });
  };

  // Update line item
  const updateLineItem = (index, field, value) => {
    setLineItems(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ));
  };

  // Handle form submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const res = await fetch('/api/admin/cash-vouchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          line_items: lineItems,
          voucher_type: 'payment'
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        router.push('/admin/cash-voucher');
      } else {
        alert('Failed to save voucher: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving voucher:', error);
      alert('Failed to save voucher');
    } finally {
      setSaving(false);
    }
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount || 0);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <Navbar />
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="flex-1 flex flex-col">
        <Navbar />
        
        <main className="flex-1 p-6 overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <BanknotesIcon className="h-7 w-7 text-purple-600" />
                  New Petty Cash Voucher
                </h1>
                <p className="text-sm text-gray-500 mt-1">Create a new cash/cheque payment voucher</p>
              </div>
            </div>
          </div>

          {/* Voucher Form - styled like the physical form */}
          <form onSubmit={handleSubmit}>
            <div className="bg-white border-2 border-gray-800 rounded-lg overflow-hidden max-w-10xl mx-auto">
                 {/* Header Section */}
              <div className="border-b-2 border-gray-800 flex">
                {/* Company Info */}
                <div className="flex-1 p-4 border-r-2 border-gray-800">
                  <h2 className="text-lg font-bold text-gray-900">Accent Techno Solutions Pvt. Ltd.</h2>
                  <p className="text-sm text-gray-600">17/130, Anand Nagar, Neharu Road, Vakola,</p>
                  <p className="text-sm text-gray-600">Santacruz (E), Mumbai - 400 055.</p>
                </div>
                {/* Title */}
                <div className="flex-1 p-4 border-r-2 border-gray-800 text-center">
                  <h1 className="text-xl font-bold text-gray-900">PETTY</h1>
                  <h1 className="text-xl font-bold text-gray-900">CASH-CHEQUE</h1>
                  <h1 className="text-xl font-bold text-gray-900">VOUCHER</h1>
                </div>
                {/* Voucher Details */}
                <div className="w-150">
                  <div className="flex border-b border-gray-800">
                    <div className="px-3 py-2 border-r border-gray-800 text-sm font-semibold bg-white w-24">SR. NO.:</div>
                    <input
                      type="text"
                      value={formData.voucher_number}
                      onChange={(e) => setFormData(prev => ({ ...prev, voucher_number: e.target.value }))}
                      className="flex-1 px-3 py-2 bg-transparent border-r border-gray-800 text-lg font-bold text-purple-700"
                      readOnly
                    />
                  </div>
                  <div className="flex border-b border-gray-800">
                    <div className="px-3 py-2 border-r border-gray-800 text-sm font-semibold bg-white w-24">DATE:</div>
                    <input
                      type="date"
                      value={formData.voucher_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, voucher_date: e.target.value }))}
                      className="flex-1 px-3 py-2 bg-transparent border-r border-gray-800 text-lg font-bold text-purple-700"
                    />
                  </div>
                  <div className="flex">
                    <div className="px-3 py-2 text-sm font-semibold bg-white w-24">PAID TO:</div>
                    <select
                      value={formData.paid_to}
                      onChange={(e) => setFormData(prev => ({ ...prev, paid_to: e.target.value }))}
                      className="flex-1 px-3 py-2 bg-transparent"
                    >
                      <option value="">Select Employee</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.full_name || `${emp.first_name} ${emp.last_name}`}>
                          {emp.full_name || `${emp.first_name} ${emp.last_name}`}
                        </option>
                      ))}
                    </select>
                  </div>
                                    <div className="flex border-b border-gray-800">
                    <div className="px-3 py-2 text-sm font-semibold bg-white w-24">PROJECT:</div>
                    <select
                      value={formData.project_number}
                      onChange={(e) => setFormData(prev => ({ ...prev, project_number: e.target.value }))}
                      className="flex-1 px-3 py-2 bg-transparent"
                    >
                      <option value="">Select Project</option>
                      {projects.map(proj => (
                        <option key={proj.id || proj.project_id} value={proj.project_id}>
                          {proj.project_id}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                
              </div>
              

              {/* Line Items Table */}
              <div className="border-b-2 border-gray-800">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white">
                      <th className="border-r border-gray-800 px-2 py-2 text-xs font-semibold text-gray-700 w-14">SR. NO.</th>
                      <th className="border-r border-gray-800 px-2 py-2 text-xs font-semibold text-gray-700 w-28">BILL DATE</th>
                      <th className="border-r border-gray-800 px-2 py-2 text-xs font-semibold text-gray-700 w-24">BILL NO.</th>
                      <th className="border-r border-gray-800 px-2 py-2 text-xs font-semibold text-gray-700 w-40">ACCOUNT HEAD</th>
                      <th className="border-r border-gray-800 px-2 py-2 text-xs font-semibold text-gray-700" colSpan="2">
                        <div>AMOUNT</div>
                        <div className="flex border-t border-gray-800 mt-1">
                          <div className="flex-1 border-r border-gray-800 px-1">RS.</div>
                          <div className="flex-1 px-1">PS.</div>
                        </div>
                      </th>
                      <th className="border-r border-gray-800 px-2 py-2 text-xs font-semibold text-gray-700">DESCRIPTION</th>
                      <th className="px-2 py-2 text-xs font-semibold text-gray-700 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, index) => (
                      <tr key={index} className="border-t border-gray-800">
                        <td className="border-r border-gray-800 px-2 py-1 text-center text-sm">{item.sr_no}</td>
                        <td className="border-r border-gray-800 px-1 py-1">
                          <input
                            type="date"
                            value={item.bill_date}
                            onChange={(e) => updateLineItem(index, 'bill_date', e.target.value)}
                            className="w-full px-1 py-1 bg-transparent text-sm"
                          />
                        </td>
                        <td className="border-r border-gray-800 px-1 py-1">
                          <input
                            type="text"
                            value={item.bill_no}
                            onChange={(e) => updateLineItem(index, 'bill_no', e.target.value)}
                            className="w-full px-1 py-1 bg-transparent text-sm"
                            placeholder="Bill #"
                          />
                        </td>
                        <td className="border-r border-gray-800 px-1 py-1">
                          <select
                            value={item.account_head}
                            onChange={(e) => updateLineItem(index, 'account_head', e.target.value)}
                            className="w-full px-1 py-1 bg-transparent text-sm"
                          >
                            <option value="">Select Account Head</option>
                            {accountHeads.map(head => (
                              <option key={head.id} value={head.account_head_name}>
                                {head.account_head_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="border-r border-gray-800 px-1 py-1 w-20">
                          <input
                            type="number"
                            value={item.amount_rs}
                            onChange={(e) => updateLineItem(index, 'amount_rs', e.target.value)}
                            className="w-full px-1 py-1 bg-transparent text-sm text-right"
                            placeholder="0"
                          />
                        </td>
                        <td className="border-r border-gray-800 px-1 py-1 w-16">
                          <input
                            type="number"
                            value={item.amount_ps}
                            onChange={(e) => updateLineItem(index, 'amount_ps', e.target.value)}
                            className="w-full px-1 py-1 bg-transparent text-sm text-right"
                            placeholder="00"
                            max="99"
                          />
                        </td>
                        <td className="border-r border-gray-800 px-1 py-1">
                          <select
                            value={item.description}
                            onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                            className="w-full px-1 py-1 bg-transparent text-sm"
                          >
                            <option value="">Select Description</option>
                            {descriptions.map(desc => (
                              <option key={desc.id} value={desc.description_name}>
                                {desc.description_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1 text-center">
                          {lineItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeLineItem(index)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                {/* Add Row Button */}
                <div className="border-t border-gray-800 p-2">
                  <button
                    type="button"
                    onClick={addLineItem}
                    className="flex items-center gap-1 px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Row
                  </button>
                </div>
              </div>

              {/* Total Section */}
              <div className="border-b-2 border-gray-800 flex">
                <div className="flex-1 p-3 border-r-2 border-gray-800">
                  <div className="flex items-center gap-4">
                    <span className="font-semibold text-sm">Paid by</span>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="payment_mode"
                        value="cash"
                        checked={formData.payment_mode === 'cash'}
                        onChange={(e) => setFormData(prev => ({ ...prev, payment_mode: e.target.value }))}
                        className="text-purple-600"
                      />
                      <span>Cash</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="payment_mode"
                        value="cheque"
                        checked={formData.payment_mode === 'cheque'}
                        onChange={(e) => setFormData(prev => ({ ...prev, payment_mode: e.target.value }))}
                        className="text-purple-600"
                      />
                      <span>Cheque</span>
                    </label>
                  </div>
                </div>
                <div className="w-40 p-3 border-r-2 border-gray-800 bg-white">
                  <div className="text-xs font-semibold text-gray-600">TOTAL</div>
                  <div className="text-lg font-bold text-gray-900">{formatCurrency(formData.total_amount)}</div>
                </div>
                <div className="flex-1 p-3">
                  <div className="text-xs font-semibold text-gray-600 mb-1">Rs. (In Words)</div>
                  <div className="text-sm text-gray-800">{formData.amount_in_words || '-'}</div>
                </div>
              </div>

              {/* Signatures Section */}
              <div className="flex">
                <div className="flex-1 p-4 border-r-2 border-gray-800">
                  <div className="text-xs font-semibold text-gray-600 mb-2 text-center">PREPARED BY</div>
                  <input
                    type="text"
                    value={formData.prepared_by}
                    onChange={(e) => setFormData(prev => ({ ...prev, prepared_by: e.target.value }))}
                    className="w-full px-2 py-1 bg-transparent border-b border-gray-400 text-center text-sm"
                  />
                </div>
                <div className="flex-1 p-4 border-r-2 border-gray-800">
                  <div className="text-xs font-semibold text-gray-600 mb-2 text-center">CHECKED BY</div>
                  <input
                    type="text"
                    value={formData.checked_by}
                    onChange={(e) => setFormData(prev => ({ ...prev, checked_by: e.target.value }))}
                    className="w-full px-2 py-1 bg-transparent border-b border-gray-400 text-center text-sm"
                    placeholder="Name"
                  />
                </div>
                <div className="flex-1 p-4 border-r-2 border-gray-800">
                  <div className="text-xs font-semibold text-gray-600 mb-2 text-center">APPROVED BY</div>
                  <input
                    type="text"
                    value={formData.approved_by}
                    onChange={(e) => setFormData(prev => ({ ...prev, approved_by: e.target.value }))}
                    className="w-full px-2 py-1 bg-transparent border-b border-gray-400 text-center text-sm"
                    placeholder="Name"
                  />
                </div>
                <div className="flex-1 p-4">
                  <div className="text-xs font-semibold text-gray-600 mb-2 text-center"> RECEIVER SIGNATURE</div>
                  <input
                    type="text"
                    value={formData.receiver_signature}
                    onChange={(e) => setFormData(prev => ({ ...prev, receiver_signature: e.target.value }))}
                    className="w-full px-2 py-1 bg-transparent border-b border-gray-400 text-center text-sm"
                    placeholder="Name"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-center gap-4 mt-6">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckIcon className="h-5 w-5" />
                    Save Voucher
                  </>
                )}
              </button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
