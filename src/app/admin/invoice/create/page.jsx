'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import { 
  DocumentCurrencyDollarIcon,
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon
} from '@heroicons/react/24/outline';

export default function CreateInvoicePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useSessionRBAC();
  
  const [saving, setSaving] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [formData, setFormData] = useState({
    client_name: '',
    client_email: '',
    client_phone: '',
    client_address: '',
    client_pan: '',
    client_gstin: '',
    client_state: '',
    client_state_code: '',
    kind_attn: '',
    po_number: '',
    po_date: '',
    po_value: '',
    balance_po_value: '',
    description: '',
    items: [{ description: '', quantity: 1, rate: 0, amount: 0 }],
    tax_rate: 18,
    discount: 0,
    notes: '',
    terms: '',
    due_date: '',
    status: 'draft'
  });

  // Fetch companies on mount
  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const res = await fetch('/api/companies');
        const data = await res.json();
        if (data.success) {
          setCompanies(data.data || []);
        }
      } catch (error) {
        console.error('Error fetching companies:', error);
      } finally {
        setLoadingCompanies(false);
      }
    };
    fetchCompanies();
  }, []);

  // Handle company selection
  const handleCompanySelect = (companyName) => {
    const selectedCompany = companies.find(c => c.company_name === companyName);
    if (selectedCompany) {
      // Build full address from company fields
      const addressParts = [
        selectedCompany.address,
        selectedCompany.city,
        selectedCompany.state,
        selectedCompany.country,
        selectedCompany.postal_code
      ].filter(Boolean);
      
      setFormData(prev => ({
        ...prev,
        client_name: selectedCompany.company_name || '',
        client_email: selectedCompany.email || '',
        client_phone: selectedCompany.phone || selectedCompany.mobile_number || '',
        client_address: addressParts.join(', ') || '',
        client_pan: selectedCompany.pan_number || '',
        client_gstin: selectedCompany.gstin || '',
        client_state: selectedCompany.state || '',
        client_state_code: selectedCompany.state_code || ''
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        client_name: companyName,
        client_email: '',
        client_phone: '',
        client_address: '',
        client_pan: '',
        client_gstin: '',
        client_state: '',
        client_state_code: ''
      }));
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

  // Calculate totals
  const calculateTotals = () => {
    const subtotal = formData.items.reduce((sum, item) => {
      // Use manual amount if set, otherwise calculate from qty * rate
      const itemAmount = item.amount > 0 ? item.amount : (item.quantity * item.rate);
      return sum + itemAmount;
    }, 0);
    const taxAmount = subtotal * (formData.tax_rate / 100);
    const total = subtotal + taxAmount - formData.discount;
    return { subtotal, taxAmount, total };
  };

  // Handle item change
  const handleItemChange = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index][field] = field === 'quantity' || field === 'rate' || field === 'amount' ? parseFloat(value) || 0 : value;
    setFormData({ ...formData, items: newItems });
  };

  // Add item
  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { description: '', quantity: 1, rate: 0, amount: 0 }]
    });
  };

  // Remove item
  const removeItem = (index) => {
    if (formData.items.length > 1) {
      const newItems = formData.items.filter((_, i) => i !== index);
      setFormData({ ...formData, items: newItems });
    }
  };

  // Save invoice
  const handleSaveInvoice = async () => {
    if (!formData.client_name) {
      alert('Client name is required');
      return;
    }

    setSaving(true);
    try {
      const { subtotal, taxAmount, total } = calculateTotals();
      
      const res = await fetch('/api/admin/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          subtotal,
          tax_amount: taxAmount,
          total,
          balance_due: total
        })
      });

      const data = await res.json();
      if (data.success) {
        router.push('/admin/invoice');
      } else {
        alert(data.message || 'Failed to save invoice');
      }
    } catch (error) {
      console.error('Error saving invoice:', error);
      alert('Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <main className="px-6 py-6">
        {/* Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center">
            <button
              onClick={() => router.push('/admin/invoice')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <DocumentCurrencyDollarIcon className="h-7 w-7 text-purple-600" />
                Create New Invoice
              </h1>
              <p className="text-sm text-gray-500 mt-1">Fill in the details to create a new invoice</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/admin/invoice')}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveInvoice}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  Saving...
                </>
              ) : (
                <>
                  <CheckIcon className="h-5 w-5" />
                  Save Invoice
                </>
              )}
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          {/* Client Information */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Client Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client Name *</label>
                <select
                  value={formData.client_name}
                  onChange={(e) => handleCompanySelect(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  disabled={loadingCompanies}
                >
                  <option value="">Select a client...</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.company_name}>
                      {company.company_name}
                    </option>
                  ))}
                </select>
                {loadingCompanies && (
                  <p className="text-xs text-gray-500 mt-1">Loading companies...</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client Email</label>
                <input
                  type="email"
                  value={formData.client_email}
                  onChange={(e) => setFormData({ ...formData, client_email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
                  placeholder="Auto-filled from company"
                  readOnly
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client Phone</label>
                <input
                  type="text"
                  value={formData.client_phone}
                  onChange={(e) => setFormData({ ...formData, client_phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
                  placeholder="Auto-filled from company"
                  readOnly
                />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Client Address</label>
                <textarea
                  value={formData.client_address}
                  onChange={(e) => setFormData({ ...formData, client_address: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
                  placeholder="Auto-filled from company"
                  readOnly
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PAN No.</label>
                <input
                  type="text"
                  value={formData.client_pan}
                  onChange={(e) => setFormData({ ...formData, client_pan: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Client PAN Number"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">GSTIN</label>
                <input
                  type="text"
                  value={formData.client_gstin}
                  onChange={(e) => setFormData({ ...formData, client_gstin: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Client GSTIN"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kind Attn.</label>
                <input
                  type="text"
                  value={formData.kind_attn}
                  onChange={(e) => setFormData({ ...formData, kind_attn: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Contact Person"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <input
                  type="text"
                  value={formData.client_state}
                  onChange={(e) => setFormData({ ...formData, client_state: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="State"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State Code</label>
                <input
                  type="text"
                  value={formData.client_state_code}
                  onChange={(e) => setFormData({ ...formData, client_state_code: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="State Code"
                />
              </div>
            </div>
          </div>

          {/* PO Information */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">PO Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PO Number</label>
                <input
                  type="text"
                  value={formData.po_number}
                  onChange={(e) => setFormData({ ...formData, po_number: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Purchase Order Number"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PO Date</label>
                <input
                  type="date"
                  value={formData.po_date}
                  onChange={(e) => setFormData({ ...formData, po_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Original PO Value (₹)</label>
                <input
                  type="number"
                  value={formData.po_value}
                  onChange={(e) => setFormData({ ...formData, po_value: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Balance PO Value (₹)</label>
                <input
                  type="number"
                  value={formData.balance_po_value}
                  onChange={(e) => setFormData({ ...formData, balance_po_value: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Invoice Items */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Invoice Items</h3>
              <button
                onClick={addItem}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <PlusIcon className="h-4 w-4" />
                Add Item
              </button>
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase w-24">Qty</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase w-32">Rate (₹)</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase w-32">Amount</th>
                    <th className="px-4 py-3 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {formData.items.map((item, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          placeholder="Item description"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-center focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          min="1"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          value={item.rate}
                          onChange={(e) => handleItemChange(index, 'rate', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-right focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          min="0"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          value={item.amount > 0 ? item.amount : item.quantity * item.rate}
                          onChange={(e) => handleItemChange(index, 'amount', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-right focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          min="0"
                        />
                      </td>
                      <td className="px-4 py-3">
                        {formData.items.length > 1 && (
                          <button
                            onClick={() => removeItem(index)}
                            className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full max-w-sm space-y-3 bg-gray-50 rounded-lg p-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal:</span>
                <span className="font-medium">{formatCurrency(calculateTotals().subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">GST Rate (%):</span>
                <input
                  type="number"
                  value={formData.tax_rate}
                  onChange={(e) => setFormData({ ...formData, tax_rate: parseFloat(e.target.value) || 0 })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-right focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">GST Amount:</span>
                <span className="font-medium">{formatCurrency(calculateTotals().taxAmount)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Discount (₹):</span>
                <input
                  type="number"
                  value={formData.discount}
                  onChange={(e) => setFormData({ ...formData, discount: parseFloat(e.target.value) || 0 })}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-right focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div className="flex justify-between text-lg font-bold border-t border-gray-300 pt-3">
                <span>Total:</span>
                <span className="text-purple-600">{formatCurrency(calculateTotals().total)}</span>
              </div>
            </div>
          </div>

          {/* Notes & Terms */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="Additional notes for the client"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Terms & Conditions</label>
              <textarea
                value={formData.terms}
                onChange={(e) => setFormData({ ...formData, terms: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="Payment terms and conditions"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={() => router.push('/admin/invoice')}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveInvoice}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                Saving...
              </>
            ) : (
              <>
                <CheckIcon className="h-5 w-5" />
                Save Invoice
              </>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}
