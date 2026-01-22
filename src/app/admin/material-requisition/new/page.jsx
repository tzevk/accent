'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { 
  ClipboardDocumentListIcon,
  PlusIcon,
  TrashIcon,
  ArrowLeftIcon,
  CheckIcon
} from '@heroicons/react/24/outline';

export default function NewMaterialRequisitionPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useSessionRBAC();
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    requisition_number: '',
    requisition_date: new Date().toISOString().split('T')[0],
    requested_by: '',
    department: '',
    prepared_by: '',
    checked_by: '',
    approved_by: '',
    received_by: '',
    receipt_date: '',
    notes: ''
  });

  // Line items
  const [lineItems, setLineItems] = useState([
    { sr_no: 1, description: '', unit_qty: '', purpose: '' }
  ]);

  // Fetch next requisition number
  useEffect(() => {
    const fetchRequisitionNumber = async () => {
      try {
        const res = await fetch('/api/admin/material-requisitions/next-number');
        const data = await res.json();
        if (data.success) {
          setFormData(prev => ({ ...prev, requisition_number: data.requisition_number }));
        }
      } catch (error) {
        console.error('Error fetching requisition number:', error);
      }
    };
    
    if (!authLoading && user) {
      fetchRequisitionNumber();
      setFormData(prev => ({ 
        ...prev, 
        requested_by: user.full_name || user.username || '',
        prepared_by: user.full_name || user.username || ''
      }));
    }
  }, [authLoading, user]);

  // Add new line item
  const addLineItem = () => {
    setLineItems(prev => [
      ...prev,
      { sr_no: prev.length + 1, description: '', unit_qty: '', purpose: '' }
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
      const res = await fetch('/api/admin/material-requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          line_items: lineItems
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        router.push('/admin/material-requisition');
      } else {
        alert('Failed to save requisition: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving requisition:', error);
      alert('Failed to save requisition');
    } finally {
      setSaving(false);
    }
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
                  <ClipboardDocumentListIcon className="h-7 w-7 text-purple-600" />
                  New Material Requisition
                </h1>
                <p className="text-sm text-gray-500 mt-1">Create a new material/stationery requisition</p>
              </div>
            </div>
          </div>

          {/* Requisition Form - styled like the physical form */}
          <form onSubmit={handleSubmit}>
            <div className="bg-white border-2 border-gray-800 rounded-lg overflow-hidden max-w-10xl mx-auto">
              {/* Header Section */}
              <div className="border-b-2 border-gray-800 p-6">
                <div className="flex items-center">
                  <div className="flex items-center gap-3">
                    <img src="/accent-logo.png" alt="Accent Logo" className="h-20 w-auto" />
                    <div className="text-left">
                    </div>
                  </div>
                  <h1 className="text-lg font-bold text-gray-900 flex-1 text-center">MATERIAL / STATIONERY REQUISITION FORM</h1>
                </div>
              </div>

              {/* Form Details */}
              <div className="border-b-2 border-gray-800">
                <div className="flex border-b border-gray-800">
                  <div className="w-40 px-4 py-3 bg-gray-200 font-semibold text-sm border-r border-gray-800">Requisition No.</div>
                  <div className="flex-1 px-4 py-3 border-r border-gray-800">
                    <input
                      type="text"
                      value={formData.requisition_number}
                      onChange={(e) => setFormData(prev => ({ ...prev, requisition_number: e.target.value }))}
                      className="w-full bg-transparent font-medium text-purple-700"
                      readOnly
                    />
                  </div>
                  <div className="w-32 px-4 py-3 bg-gray-200 font-semibold text-sm border-r border-gray-800">Date of Req.</div>
                  <div className="w-40 px-4 py-3">
                    <input
                      type="date"
                      value={formData.requisition_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, requisition_date: e.target.value }))}
                      className="w-full bg-transparent"
                    />
                  </div>
                </div>
                <div className="flex">
                  <div className="w-40 px-4 py-3 bg-gray-200 font-semibold text-sm border-r border-gray-800">Requested By</div>
                  <div className="flex-1 px-4 py-3 border-r border-gray-800">
                    <input
                      type="text"
                      value={formData.requested_by}
                      onChange={(e) => setFormData(prev => ({ ...prev, requested_by: e.target.value }))}
                      className="w-full bg-transparent"
                      placeholder="Enter name"
                    />
                  </div>
                  <div className="w-32 px-4 py-3 bg-gray-200 font-semibold text-sm border-r border-gray-800">Department</div>
                  <div className="w-40 px-4 py-3">
                    <input
                      type="text"
                      value={formData.department}
                      onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
                      className="w-full bg-transparent"
                      placeholder="Department"
                    />
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="border-b-2 border-gray-800">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-200">
                      <th className="border-r border-gray-800 px-3 py-3 text-xs font-semibold text-gray-700 w-16">Sr. No.</th>
                      <th className="border-r border-gray-800 px-3 py-3 text-xs font-semibold text-gray-700">Material Description</th>
                      <th className="border-r border-gray-800 px-3 py-3 text-xs font-semibold text-gray-700 w-28">Unit / Qty</th>
                      <th className="border-r border-gray-800 px-3 py-3 text-xs font-semibold text-gray-700 w-40">Purpose</th>
                      <th className="px-3 py-3 text-xs font-semibold text-gray-700 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, index) => (
                      <tr key={index} className="border-t border-gray-800">
                        <td className="border-r border-gray-800 px-3 py-2 text-center text-sm">{item.sr_no}</td>
                        <td className="border-r border-gray-800 px-2 py-2">
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                            className="w-full px-2 py-1 bg-transparent text-sm"
                            placeholder="Enter material description"
                          />
                        </td>
                        <td className="border-r border-gray-800 px-2 py-2">
                          <input
                            type="text"
                            value={item.unit_qty}
                            onChange={(e) => updateLineItem(index, 'unit_qty', e.target.value)}
                            className="w-full px-2 py-1 bg-transparent text-sm text-center"
                            placeholder="Qty"
                          />
                        </td>
                        <td className="border-r border-gray-800 px-2 py-2">
                          <input
                            type="text"
                            value={item.purpose}
                            onChange={(e) => updateLineItem(index, 'purpose', e.target.value)}
                            className="w-full px-2 py-1 bg-transparent text-sm"
                            placeholder="Purpose"
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
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

              {/* Signatures Section */}
              <div className="flex border-b-2 border-gray-800">
                <div className="flex-1 p-6 border-r border-gray-800 text-center">
                  <input
                    type="text"
                    value={formData.prepared_by}
                    onChange={(e) => setFormData(prev => ({ ...prev, prepared_by: e.target.value }))}
                    className="w-full px-2 py-1 bg-transparent border-b border-gray-800 text-center text-sm mb-2"
                  />
                  <div className="text-xs font-semibold text-gray-600">Prepared By</div>
                </div>
                <div className="flex-1 p-6 border-r border-gray-800 text-center">
                  <input
                    type="text"
                    value={formData.checked_by}
                    onChange={(e) => setFormData(prev => ({ ...prev, checked_by: e.target.value }))}
                    className="w-full px-2 py-1 bg-transparent border-b border-gray-800 text-center text-sm mb-2"
                    placeholder="Name"
                  />
                  <div className="text-xs font-semibold text-gray-600">Checked By</div>
                </div>
                <div className="flex-1 p-6 text-center">
                  <input
                    type="text"
                    value={formData.approved_by}
                    onChange={(e) => setFormData(prev => ({ ...prev, approved_by: e.target.value }))}
                    className="w-full px-2 py-1 bg-transparent border-b border-gray-800 text-center text-sm mb-2"
                    placeholder="Name"
                  />
                  <div className="text-xs font-semibold text-gray-600">Approved By</div>
                </div>
              </div>

              {/* Receipt Section */}
              <div className="p-4 border-b-2 border-gray-800">
                <div className="flex gap-4 mb-2">
                  <span className="font-semibold text-sm">Material Received / Collected By:</span>
                  <input
                    type="text"
                    value={formData.received_by}
                    onChange={(e) => setFormData(prev => ({ ...prev, received_by: e.target.value }))}
                    className="flex-1 px-2 py-1 bg-transparent border-b border-gray-800 text-sm"
                    placeholder="Name"
                  />
                </div>
                <div className="flex gap-4">
                  <span className="font-semibold text-sm">Date of Receipt of Material:</span>
                  <input
                    type="date"
                    value={formData.receipt_date}
                    onChange={(e) => setFormData(prev => ({ ...prev, receipt_date: e.target.value }))}
                    className="px-2 py-1 bg-transparent border-b border-gray-800 text-sm"
                  />
                </div>
              </div>

              {/* Form Number */}
              <div className="p-3 text-sm text-gray-500">
                F/ATSPL/PUR/01
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
                    Save Requisition
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
