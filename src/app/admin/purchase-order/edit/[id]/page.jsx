'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import { 
  ClipboardDocumentListIcon,
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline';

export default function EditPurchaseOrderPage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading: authLoading } = useSessionRBAC();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [purchaseOrder, setPurchaseOrder] = useState({
    id: null,
    po_number: '',
    vendor_name: '',
    vendor_email: '',
    vendor_phone: '',
    vendor_address: '',
    vendor_gstin: '',
    kind_attn: '',
    quotation_no: '',
    quotation_date: '',
    delivery_date: '',
    description: '',
    status: 'draft',
    items: [{ description: '', quantity: 1, rate: 0, amount: 0 }],
    subtotal: 0,
    tax_rate: 18,
    tax_amount: 0,
    discount: 0,
    total: 0,
    notes: ''
  });

  // Fetch purchase order data
  useEffect(() => {
    const fetchPurchaseOrder = async () => {
      if (!params.id) return;
      
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/purchase-orders?id=${params.id}`);
        const data = await res.json();
        
        if (data.success && data.data) {
          // Find the specific PO from the list or fetch individually
          const poList = Array.isArray(data.data) ? data.data : [data.data];
          const po = poList.find(p => p.id === parseInt(params.id)) || poList[0];
          
          if (po) {
            const items = typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || []);
            
            // Auto-generate quotation number if empty
            let quotationNo = po.quotation_no || '';
            if (!quotationNo) {
              const now = new Date();
              const year = now.getFullYear().toString().slice(-2);
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const randomNum = Math.floor(1000 + Math.random() * 9000);
              quotationNo = `QT/${year}${month}/${randomNum}`;
            }
            
            setPurchaseOrder({
              ...po,
              items: items.length > 0 ? items : [{ description: '', quantity: 1, rate: 0, amount: 0 }],
              quotation_no: quotationNo,
              quotation_date: po.quotation_date ? po.quotation_date.split('T')[0] : '',
              delivery_date: po.delivery_date ? po.delivery_date.split('T')[0] : ''
            });
          }
        }
      } catch (error) {
        console.error('Error fetching purchase order:', error);
        alert('Failed to load purchase order');
      } finally {
        setLoading(false);
      }
    };

    if (!authLoading && user) {
      fetchPurchaseOrder();
    }
  }, [params.id, authLoading, user]);

  // Fetch vendors from vendor master
  useEffect(() => {
    const fetchVendors = async () => {
      try {
        const res = await fetch('/api/vendors');
        const data = await res.json();
        if (data.success) {
          setVendors(data.data || []);
        }
      } catch (error) {
        console.error('Error fetching vendors:', error);
      }
    };

    if (!authLoading && user) {
      fetchVendors();
    }
  }, [authLoading, user]);

  // Handle vendor selection - auto-populate GSTIN and address
  const handleVendorSelect = (vendorId) => {
    const selectedVendor = vendors.find(v => v.id === parseInt(vendorId));
    if (selectedVendor) {
      // Build full address from vendor master fields
      const addressParts = [
        selectedVendor.address_street,
        selectedVendor.address_city,
        selectedVendor.address_state,
        selectedVendor.address_country,
        selectedVendor.address_pin
      ].filter(Boolean);
      const fullAddress = addressParts.join(', ');

      setPurchaseOrder({
        ...purchaseOrder,
        vendor_name: selectedVendor.vendor_name || '',
        vendor_email: selectedVendor.email || '',
        vendor_phone: selectedVendor.phone || '',
        vendor_gstin: selectedVendor.gst_vat_tax_id || '',
        vendor_address: fullAddress
      });
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

  // Update item
  const updateItem = (index, field, value) => {
    const newItems = [...purchaseOrder.items];
    newItems[index][field] = value;
    
    // Recalculate amount only if qty or rate changed (not when amount is directly edited)
    if (field === 'quantity' || field === 'rate') {
      const qty = parseFloat(newItems[index].quantity) || 0;
      const rate = parseFloat(newItems[index].rate) || 0;
      newItems[index].amount = qty * rate;
    }
    
    // If amount is directly edited, update it as a number
    if (field === 'amount') {
      newItems[index].amount = parseFloat(value) || 0;
    }
    
    // Recalculate totals
    const subtotal = newItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    const taxRate = parseFloat(purchaseOrder.tax_rate) || 18;
    const taxAmount = subtotal * taxRate / 100;
    const total = subtotal + taxAmount - (parseFloat(purchaseOrder.discount) || 0);
    
    setPurchaseOrder({
      ...purchaseOrder,
      items: newItems,
      subtotal,
      tax_amount: taxAmount,
      total
    });
  };

  // Add item
  const addItem = () => {
    setPurchaseOrder({
      ...purchaseOrder,
      items: [...purchaseOrder.items, { description: '', quantity: 1, rate: 0, amount: 0 }]
    });
  };

  // Remove item
  const removeItem = (index) => {
    if (purchaseOrder.items.length <= 1) return;
    const newItems = purchaseOrder.items.filter((_, i) => i !== index);
    
    // Recalculate totals
    const subtotal = newItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    const taxRate = parseFloat(purchaseOrder.tax_rate) || 18;
    const taxAmount = subtotal * taxRate / 100;
    const total = subtotal + taxAmount - (parseFloat(purchaseOrder.discount) || 0);
    
    setPurchaseOrder({
      ...purchaseOrder,
      items: newItems,
      subtotal,
      tax_amount: taxAmount,
      total
    });
  };

  // Handle save
  const handleSave = async () => {
    if (!purchaseOrder.vendor_name) {
      alert('Vendor name is required');
      return;
    }
    
    setSaving(true);
    try {
      const res = await fetch('/api/admin/purchase-orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(purchaseOrder)
      });
      
      const data = await res.json();
      
      if (data.success) {
        alert('Purchase order updated successfully');
        router.push('/admin/purchase-order');
      } else {
        alert(data.message || 'Failed to update purchase order');
      }
    } catch (error) {
      console.error('Error updating purchase order:', error);
      alert('Failed to update purchase order');
    } finally {
      setSaving(false);
    }
  };

  // Handle download
  const handleDownload = () => {
    window.open(`/api/admin/purchase-orders/download?id=${purchaseOrder.id}`, '_blank');
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <main className="px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/admin/purchase-order')}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <ClipboardDocumentListIcon className="h-7 w-7 text-purple-600" />
                Edit Purchase Order
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {purchaseOrder.po_number || 'Loading...'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ArrowDownTrayIcon className="h-5 w-5" />
              Download PDF
            </button>
            <button
              onClick={() => router.push('/admin/purchase-order')}
              className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Vendor Details */}
            <div className="space-y-5">
              <h3 className="font-semibold text-gray-900 text-lg border-b pb-2">Vendor Details</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Vendor *</label>
                <select
                  value={vendors.find(v => v.vendor_name === purchaseOrder.vendor_name)?.id || ''}
                  onChange={(e) => handleVendorSelect(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">-- Select a vendor --</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.vendor_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Email</label>
                  <input
                    type="email"
                    value={purchaseOrder.vendor_email || ''}
                    onChange={(e) => setPurchaseOrder({ ...purchaseOrder, vendor_email: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
                    placeholder="Auto-filled from vendor master"
                    readOnly
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Phone</label>
                  <input
                    type="text"
                    value={purchaseOrder.vendor_phone || ''}
                    onChange={(e) => setPurchaseOrder({ ...purchaseOrder, vendor_phone: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
                    placeholder="Auto-filled from vendor master"
                    readOnly
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor GSTIN</label>
                <input
                  type="text"
                  value={purchaseOrder.vendor_gstin || ''}
                  onChange={(e) => setPurchaseOrder({ ...purchaseOrder, vendor_gstin: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
                  placeholder="Auto-filled from vendor master"
                  readOnly
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Address</label>
                <textarea
                  value={purchaseOrder.vendor_address || ''}
                  onChange={(e) => setPurchaseOrder({ ...purchaseOrder, vendor_address: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
                  placeholder="Auto-filled from vendor master"
                  readOnly
                />
              </div>
            </div>

            {/* PO Details */}
            <div className="space-y-5">
              <h3 className="font-semibold text-gray-900 text-lg border-b pb-2">PO Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PO Number *</label>
                  <input
                    type="text"
                    value={purchaseOrder.po_number || ''}
                    onChange={(e) => setPurchaseOrder({ ...purchaseOrder, po_number: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="Auto-generated or enter manually"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={purchaseOrder.status || 'draft'}
                    onChange={(e) => setPurchaseOrder({ ...purchaseOrder, status: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    <option value="draft">Draft</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kind Attention</label>
                <input
                  type="text"
                  value={purchaseOrder.kind_attn || ''}
                  onChange={(e) => setPurchaseOrder({ ...purchaseOrder, kind_attn: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Contact person name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quotation No.</label>
                  <input
                    type="text"
                    value={purchaseOrder.quotation_no || ''}
                    onChange={(e) => setPurchaseOrder({ ...purchaseOrder, quotation_no: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="MS0/21/2211"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quotation Date</label>
                  <input
                    type="date"
                    value={purchaseOrder.quotation_date || ''}
                    onChange={(e) => setPurchaseOrder({ ...purchaseOrder, quotation_date: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Date</label>
                <input
                  type="date"
                  value={purchaseOrder.delivery_date || ''}
                  onChange={(e) => setPurchaseOrder({ ...purchaseOrder, delivery_date: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={purchaseOrder.description || ''}
                  onChange={(e) => setPurchaseOrder({ ...purchaseOrder, description: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Brief description of purchase order"
                />
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 text-lg">Line Items</h3>
              <button
                onClick={addItem}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <PlusIcon className="h-5 w-5" />
                Add Item
              </button>
            </div>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Sr.</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase w-24">Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase w-32">Rate (₹)</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase w-32">Amount (₹)</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase w-20">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {purchaseOrder.items.map((item, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-center text-gray-600">{index + 1}</td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.description || ''}
                          onChange={(e) => updateItem(index, 'description', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          placeholder="Item description"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          value={item.quantity || 1}
                          onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-center focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          min="1"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          value={item.rate || 0}
                          onChange={(e) => updateItem(index, 'rate', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          min="0"
                          step="0.01"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          value={item.amount || 0}
                          onChange={(e) => updateItem(index, 'amount', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-right focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          min="0"
                          step="0.01"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => removeItem(index)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30"
                          disabled={purchaseOrder.items.length <= 1}
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="mt-6 flex justify-end">
              <div className="w-80 bg-gray-50 rounded-xl p-5 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal:</span>
                  <span className="font-medium text-gray-900">{formatCurrency(purchaseOrder.subtotal || 0)}</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-gray-600">Tax Rate:</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={purchaseOrder.tax_rate || 18}
                      onChange={(e) => {
                        const taxRate = parseFloat(e.target.value) || 0;
                        const taxAmount = (purchaseOrder.subtotal || 0) * taxRate / 100;
                        const total = (purchaseOrder.subtotal || 0) + taxAmount - (purchaseOrder.discount || 0);
                        setPurchaseOrder({ ...purchaseOrder, tax_rate: taxRate, tax_amount: taxAmount, total });
                      }}
                      className="w-16 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      min="0"
                      max="100"
                    />
                    <span>%</span>
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Tax Amount:</span>
                  <span className="font-medium text-gray-900">{formatCurrency(purchaseOrder.tax_amount || 0)}</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-gray-600">Discount:</span>
                  <input
                    type="number"
                    value={purchaseOrder.discount || 0}
                    onChange={(e) => {
                      const discount = parseFloat(e.target.value) || 0;
                      const total = (purchaseOrder.subtotal || 0) + (purchaseOrder.tax_amount || 0) - discount;
                      setPurchaseOrder({ ...purchaseOrder, discount, total });
                    }}
                    className="w-28 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    min="0"
                  />
                </div>
                <div className="border-t pt-3 flex justify-between text-lg font-bold">
                  <span>Total:</span>
                  <span className="text-purple-600">{formatCurrency(purchaseOrder.total || 0)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="mt-8">
            <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
            <textarea
              value={purchaseOrder.notes || ''}
              onChange={(e) => setPurchaseOrder({ ...purchaseOrder, notes: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="Additional notes or terms..."
            />
          </div>
        </div>
      </main>
    </div>
  );
}
