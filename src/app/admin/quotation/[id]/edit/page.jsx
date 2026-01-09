'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { 
  ArrowLeftIcon,
  DocumentTextIcon,
  PlusIcon,
  TrashIcon,
  PrinterIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline';

export default function EditQuotationPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useSessionRBAC();
  const id = params?.id;
  const source = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('source') || 'project' : 'project';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quotation, setQuotation] = useState({
    quotation_number: '',
    quotation_date: '',
    enquiry_number: '',
    enquiry_date: '',
    client_name: '',
    client_address: '',
    kind_attn: '',
    scope_items: [{ sr_no: 1, description: '', qty: '', rate: '', amount: '' }],
    amount_in_words: '',
    gst_number: '',
    pan_number: '',
    tan_number: '',
    terms_and_conditions: `• Any additional work will be charged extra.
• GST 18% extra as applicable on total project cost.
• The proposal is based on client's enquiry and provided input data.
• Work will start within 15 days after receipt of confirmed LOI/PO.
• Mode of Payments: - Through Wire transfer to 'Accent Techno Solutions Pvt Ltd.' payable at Mumbai A/c No. 917020044935714, IFS Code: UTIB0001244`,
    gross_amount: 0,
    gst_percentage: 18,
    gst_amount: 0,
    net_amount: 0,
    // Annexure fields
    annexure_scope_of_work: '',
    annexure_input_document: '',
    annexure_deliverables: '',
    annexure_software: '',
    annexure_duration: '',
    annexure_site_visit: '',
    annexure_quotation_validity: '',
    annexure_mode_of_delivery: '',
    annexure_revision: '',
    annexure_exclusions: '',
    annexure_billing_payment_terms: `• Payment shall be released by the client within 7 days from the date of the invoice.
• Payment shall be by way of RTGS transfer to ATSPL bank account.
• The late payment charges will be 2% per month on the total bill amount if bills are not settled within the credit period of 30 days.
• In case of project delays beyond two-month, software cost of ₹10,000/- per month will be charged.
• Upon completion of the above scope of work, if a project is cancelled or held by the client for any reason then Accent Techno Solutions Private Limited is entitled to 100% invoice against the completed work.`,
    annexure_confidentiality: `• Input, output & any excerpts in between are intellectual properties of client. ATS shall not voluntarily disclose any of such documents to third parties& will undertake all the commonly accepted practices and tools to avoid the loss or spillover of such information. ATS shall take utmost care to maintain confidentiality of any information or intellectual property of client that it may come across. ATS is allowed to use the contract as a customer reference. However, no data or intellectual property of the client can be disclosed to third parties without the written consent of client.`,
    annexure_codes_standards: `• Basic Engineering/ Detail Engineering should be carried out in ATS's office as per good engineering practices, project specifications and applicable client's inputs, Indian and International Standards`,
    annexure_dispute_resolution: `• Should any disputes arise as claimed breach of the contract originated by this offer, it shall be finally settled amicably. Teamwork shall be the essence of this contract.`
  });

  // Check if super admin
  const isSuperAdmin = user?.is_super_admin === true || user?.is_super_admin === 1;

  // Fetch quotation data
  const fetchQuotation = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/quotations/${id}?source=${source}`);
      const data = await res.json();
      
      if (data.success && data.data) {
        const q = data.data;
        // Parse scope_items if it's a string
        let scopeItems = [{ sr_no: 1, description: '', qty: '', rate: '', amount: '' }];
        if (q.scope_items) {
          try {
            scopeItems = typeof q.scope_items === 'string' ? JSON.parse(q.scope_items) : q.scope_items;
          } catch (e) {
            // If parsing fails, create item from scope_of_work
            if (q.scope_of_work) {
              scopeItems = [{ sr_no: 1, description: q.scope_of_work, qty: q.enquiry_quantity || '1', rate: q.gross_amount || '', amount: q.gross_amount || '' }];
            }
          }
        } else if (q.scope_of_work) {
          scopeItems = [{ sr_no: 1, description: q.scope_of_work, qty: q.enquiry_quantity || '1', rate: q.gross_amount || '', amount: q.gross_amount || '' }];
        }

        setQuotation({
          quotation_number: q.quotation_number || '',
          quotation_date: q.quotation_date ? q.quotation_date.split('T')[0] : '',
          enquiry_number: q.enquiry_number || '',
          enquiry_date: q.enquiry_date ? q.enquiry_date.split('T')[0] : '',
          client_name: q.client_name || '',
          client_address: q.client_address || '',
          kind_attn: q.kind_attn || '',
          scope_items: scopeItems.length > 0 ? scopeItems : [{ sr_no: 1, description: '', qty: '', rate: '', amount: '' }],
          amount_in_words: q.amount_in_words || '',
          gst_number: q.gst_number || '',
          pan_number: q.pan_number || '',
          tan_number: q.tan_number || '',
          terms_and_conditions: q.terms_and_conditions || quotation.terms_and_conditions,
          gross_amount: q.gross_amount || 0,
          gst_percentage: q.gst_percentage || 18,
          gst_amount: q.gst_amount || 0,
          net_amount: q.net_amount || 0,
          // Annexure fields - fetch from project if available
          annexure_scope_of_work: q.annexure_scope_of_work || q.scope_of_work || '',
          annexure_input_document: q.annexure_input_document || q.input_document || q.input_documents || '',
          annexure_deliverables: q.annexure_deliverables || q.deliverables || q.list_of_deliverables || '',
          annexure_software: q.annexure_software || q.software_included || '',
          annexure_duration: q.annexure_duration || q.duration || '',
          annexure_site_visit: q.annexure_site_visit || q.site_visit || '',
          annexure_quotation_validity: q.annexure_quotation_validity || q.quotation_validity || '',
          annexure_mode_of_delivery: q.annexure_mode_of_delivery || q.mode_of_delivery || '',
          annexure_revision: q.annexure_revision || q.revision || '',
          annexure_exclusions: q.annexure_exclusions || q.exclusion || '',
          annexure_billing_payment_terms: q.annexure_billing_payment_terms || q.billing_and_payment_terms || quotation.annexure_billing_payment_terms,
          annexure_confidentiality: q.annexure_confidentiality || quotation.annexure_confidentiality,
          annexure_codes_standards: q.annexure_codes_standards || quotation.annexure_codes_standards,
          annexure_dispute_resolution: q.annexure_dispute_resolution || quotation.annexure_dispute_resolution
        });
      }
    } catch (error) {
      console.error('Error fetching quotation:', error);
    } finally {
      setLoading(false);
    }
  }, [id, source]);

  useEffect(() => {
    if (!authLoading && user && id) {
      fetchQuotation();
    }
  }, [authLoading, user, id, fetchQuotation]);

  // Handle input change
  const handleChange = (e) => {
    const { name, value } = e.target;
    setQuotation(prev => ({ ...prev, [name]: value }));
  };

  // Handle scope item change
  const handleScopeItemChange = (index, field, value) => {
    setQuotation(prev => {
      const newItems = [...prev.scope_items];
      newItems[index] = { ...newItems[index], [field]: value };
      
      // Auto-calculate amount if qty and rate are provided
      if (field === 'qty' || field === 'rate') {
        const qty = parseFloat(field === 'qty' ? value : newItems[index].qty) || 0;
        const rate = parseFloat(field === 'rate' ? value : newItems[index].rate) || 0;
        newItems[index].amount = (qty * rate).toFixed(2);
      }
      
      // Recalculate totals
      const grossAmount = newItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      const gstAmount = (grossAmount * (prev.gst_percentage || 18)) / 100;
      const netAmount = grossAmount + gstAmount;
      
      return { 
        ...prev, 
        scope_items: newItems,
        gross_amount: grossAmount.toFixed(2),
        gst_amount: gstAmount.toFixed(2),
        net_amount: netAmount.toFixed(2)
      };
    });
  };

  // Add new scope item
  const addScopeItem = () => {
    setQuotation(prev => ({
      ...prev,
      scope_items: [...prev.scope_items, { sr_no: prev.scope_items.length + 1, description: '', qty: '', rate: '', amount: '' }]
    }));
  };

  // Remove scope item
  const removeScopeItem = (index) => {
    if (quotation.scope_items.length <= 1) return;
    setQuotation(prev => {
      const newItems = prev.scope_items.filter((_, i) => i !== index).map((item, i) => ({ ...item, sr_no: i + 1 }));
      const grossAmount = newItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      const gstAmount = (grossAmount * (prev.gst_percentage || 18)) / 100;
      const netAmount = grossAmount + gstAmount;
      return { 
        ...prev, 
        scope_items: newItems,
        gross_amount: grossAmount.toFixed(2),
        gst_amount: gstAmount.toFixed(2),
        net_amount: netAmount.toFixed(2)
      };
    });
  };

  // Convert number to words
  const numberToWords = (num) => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    if (num === 0) return 'Zero';
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + numberToWords(num % 100) : '');
    if (num < 100000) return numberToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + numberToWords(num % 1000) : '');
    if (num < 10000000) return numberToWords(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + numberToWords(num % 100000) : '');
    return numberToWords(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 ? ' ' + numberToWords(num % 10000000) : '');
  };

  // Auto-generate amount in words
  useEffect(() => {
    const amount = parseFloat(quotation.net_amount) || 0;
    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let words = 'Rupees ' + numberToWords(rupees);
    if (paise > 0) {
      words += ' and ' + numberToWords(paise) + ' Paise';
    }
    words += ' Only';
    setQuotation(prev => ({ ...prev, amount_in_words: words }));
  }, [quotation.net_amount]);

  // Save quotation
  const saveQuotation = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/quotations/${id}?source=${source}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quotation)
      });
      const data = await res.json();
      if (data.success) {
        alert('Quotation saved successfully!');
      } else {
        alert('Failed to save quotation: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving quotation:', error);
      alert('Error saving quotation');
    } finally {
      setSaving(false);
    }
  };

  // Download/Print quotation
  const handleDownload = () => {
    window.open(`/api/admin/quotations/download?id=${id}&source=${source}`, '_blank');
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount || 0);
  };

  if (authLoading || loading) {
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Navbar />
        
        <main className="flex-1 p-6 overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <DocumentTextIcon className="h-7 w-7 text-purple-600" />
                  Edit Quotation
                </h1>
                <p className="text-sm text-gray-500 mt-1">{quotation.quotation_number}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDownload}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
              >
                <PrinterIcon className="h-5 w-5" />
                Preview & Print
              </button>
              <button
                onClick={saveQuotation}
                disabled={saving}
                className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <ArrowDownTrayIcon className="h-5 w-5" />
                    Save Quotation
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quotation Form - Styled like the template */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Company Header */}
            <div className="bg-purple-600 text-white p-4 text-center">
              <h2 className="text-xl font-bold">Accent Techno Solutions Private Limited</h2>
              <p className="text-sm text-purple-100 mt-1">Engineering & Consultancy Services</p>
            </div>

            <div className="p-6">
              {/* Top Section - Client Info & Quotation Details */}
              <div className="border border-gray-300 mb-4">
                <div className="flex">
                  {/* Left - To Section */}
                  <div className="flex-1 border-r border-gray-300 p-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">To,</label>
                    <input
                      type="text"
                      name="client_name"
                      value={quotation.client_name}
                      onChange={handleChange}
                      placeholder="Client Name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent mb-2"
                    />
                    <textarea
                      name="client_address"
                      value={quotation.client_address}
                      onChange={handleChange}
                      placeholder="Client Address"
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                    />
                  </div>
                  
                  {/* Right - Quotation Details */}
                  <div className="w-80">
                    <div className="flex border-b border-gray-300">
                      <div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">Quotation No.</div>
                      <div className="w-1/2 p-2">
                        <input
                          type="text"
                          name="quotation_number"
                          value={quotation.quotation_number}
                          onChange={handleChange}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    <div className="flex border-b border-gray-300">
                      <div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">Date of Quotation</div>
                      <div className="w-1/2 p-2">
                        <input
                          type="date"
                          name="quotation_date"
                          value={quotation.quotation_date}
                          onChange={handleChange}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    <div className="flex border-b border-gray-300">
                      <div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">Enquiry No.</div>
                      <div className="w-1/2 p-2">
                        <input
                          type="text"
                          name="enquiry_number"
                          value={quotation.enquiry_number}
                          onChange={handleChange}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    <div className="flex">
                      <div className="w-1/2 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm">Date of Enquiry</div>
                      <div className="w-1/2 p-2">
                        <input
                          type="date"
                          name="enquiry_date"
                          value={quotation.enquiry_date}
                          onChange={handleChange}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Kind Attn */}
              <div className="border border-gray-300 mb-4">
                <div className="flex items-center">
                  <div className="w-24 p-3 bg-gray-50 font-semibold text-sm border-r border-gray-300">Kind Attn:</div>
                  <div className="flex-1 p-2">
                    <input
                      type="text"
                      name="kind_attn"
                      value={quotation.kind_attn}
                      onChange={handleChange}
                      placeholder="Contact Person Name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Scope of Work Table */}
              <div className="border border-gray-300 mb-4">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="w-16 p-3 text-left text-sm font-semibold border-r border-b border-gray-300">Sr. No.</th>
                      <th className="p-3 text-left text-sm font-semibold border-r border-b border-gray-300">Scope of the Work</th>
                      <th className="w-24 p-3 text-center text-sm font-semibold border-r border-b border-gray-300">Qty.</th>
                      <th className="w-28 p-3 text-center text-sm font-semibold border-r border-b border-gray-300">Rate</th>
                      <th className="w-32 p-3 text-center text-sm font-semibold border-b border-gray-300">Amount</th>
                      <th className="w-12 p-3 border-b border-gray-300"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotation.scope_items.map((item, index) => (
                      <tr key={index}>
                        <td className="p-2 border-r border-b border-gray-300 text-center text-sm">{item.sr_no}</td>
                        <td className="p-2 border-r border-b border-gray-300">
                          <textarea
                            value={item.description}
                            onChange={(e) => handleScopeItemChange(index, 'description', e.target.value)}
                            placeholder="Description of work"
                            rows={2}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                          />
                        </td>
                        <td className="p-2 border-r border-b border-gray-300">
                          <input
                            type="text"
                            value={item.qty}
                            onChange={(e) => handleScopeItemChange(index, 'qty', e.target.value)}
                            placeholder="Qty"
                            className="w-full px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </td>
                        <td className="p-2 border-r border-b border-gray-300">
                          <input
                            type="number"
                            value={item.rate}
                            onChange={(e) => handleScopeItemChange(index, 'rate', e.target.value)}
                            placeholder="Rate"
                            className="w-full px-2 py-1 text-sm text-right border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </td>
                        <td className="p-2 border-r border-b border-gray-300">
                          <input
                            type="number"
                            value={item.amount}
                            onChange={(e) => handleScopeItemChange(index, 'amount', e.target.value)}
                            placeholder="Amount"
                            className="w-full px-2 py-1 text-sm text-right border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </td>
                        <td className="p-2 border-b border-gray-300 text-center">
                          {quotation.scope_items.length > 1 && (
                            <button
                              onClick={() => removeScopeItem(index)}
                              className="p-1 text-red-500 hover:bg-red-50 rounded"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-2 border-t border-gray-300">
                  <button
                    onClick={addScopeItem}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50 rounded-md transition-colors"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Item
                  </button>
                </div>
              </div>

              {/* Totals Section */}
              <div className="border border-gray-300 mb-4">
                <div className="flex justify-end">
                  <div className="w-80">
                    <div className="flex border-b border-gray-300">
                      <div className="flex-1 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm text-right">Gross Amount:</div>
                      <div className="w-32 p-2 text-right font-medium">{formatCurrency(quotation.gross_amount)}</div>
                    </div>
                    <div className="flex border-b border-gray-300">
                      <div className="flex-1 p-2 border-r border-gray-300 bg-gray-50 font-semibold text-sm text-right">
                        GST @
                        <input
                          type="number"
                          name="gst_percentage"
                          value={quotation.gst_percentage}
                          onChange={(e) => {
                            const gstPct = parseFloat(e.target.value) || 0;
                            const gross = parseFloat(quotation.gross_amount) || 0;
                            const gstAmt = (gross * gstPct) / 100;
                            setQuotation(prev => ({
                              ...prev,
                              gst_percentage: gstPct,
                              gst_amount: gstAmt.toFixed(2),
                              net_amount: (gross + gstAmt).toFixed(2)
                            }));
                          }}
                          className="w-12 px-1 py-0.5 mx-1 text-sm text-center border border-gray-300 rounded"
                        />
                        %:
                      </div>
                      <div className="w-32 p-2 text-right font-medium">{formatCurrency(quotation.gst_amount)}</div>
                    </div>
                    <div className="flex bg-purple-50">
                      <div className="flex-1 p-2 border-r border-gray-300 font-bold text-sm text-right">Net Amount:</div>
                      <div className="w-32 p-2 text-right font-bold text-purple-700">{formatCurrency(quotation.net_amount)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Amount in Words */}
              <div className="border border-gray-300 mb-4">
                <div className="flex">
                  <div className="w-32 p-3 bg-gray-50 font-semibold text-sm border-r border-gray-300">Amount in words:</div>
                  <div className="flex-1 p-3 text-sm italic">{quotation.amount_in_words}</div>
                </div>
              </div>

              {/* GST/PAN/TAN */}
              <div className="border border-gray-300 mb-4">
                <div className="flex">
                  <div className="flex-1 border-r border-gray-300">
                    <div className="p-2 bg-gray-50 font-semibold text-sm text-center border-b border-gray-300">GST Number</div>
                    <div className="p-2">
                      <input
                        type="text"
                        name="gst_number"
                        value={quotation.gst_number}
                        onChange={handleChange}
                        placeholder="GST Number"
                        className="w-full px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div className="flex-1 border-r border-gray-300">
                    <div className="p-2 bg-gray-50 font-semibold text-sm text-center border-b border-gray-300">Pan Number</div>
                    <div className="p-2">
                      <input
                        type="text"
                        name="pan_number"
                        value={quotation.pan_number}
                        onChange={handleChange}
                        placeholder="PAN Number"
                        className="w-full px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="p-2 bg-gray-50 font-semibold text-sm text-center border-b border-gray-300">Tan Number</div>
                    <div className="p-2">
                      <input
                        type="text"
                        name="tan_number"
                        value={quotation.tan_number}
                        onChange={handleChange}
                        placeholder="TAN Number"
                        className="w-full px-2 py-1 text-sm text-center border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Terms and Conditions */}
              <div className="border border-gray-300 mb-4">
                <div className="p-3 bg-gray-50 font-semibold text-sm border-b border-gray-300">General Terms and conditions</div>
                <div className="p-3">
                  <textarea
                    name="terms_and_conditions"
                    value={quotation.terms_and_conditions}
                    onChange={handleChange}
                    rows={6}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                  />
                </div>
              </div>

              {/* Annexure Section */}
              <div className="border border-gray-300 mb-4">
                <div className="p-3 bg-purple-50 font-semibold text-lg border-b border-gray-300 text-center">
                  ANNEXURE – I
                </div>
                
                {/* Numbered Annexure Fields */}
                <div className="p-4 space-y-4">
                  {/* 1. Scope of Work */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">1)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Scope of Work:</label>
                      <textarea
                        name="annexure_scope_of_work"
                        value={quotation.annexure_scope_of_work}
                        onChange={handleChange}
                        rows={3}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                      />
                    </div>
                  </div>

                  {/* 2. Input Document */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">2)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Input Document:</label>
                      <textarea
                        name="annexure_input_document"
                        value={quotation.annexure_input_document}
                        onChange={handleChange}
                        rows={2}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                      />
                    </div>
                  </div>

                  {/* 3. Deliverables */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">3)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Deliverables:</label>
                      <textarea
                        name="annexure_deliverables"
                        value={quotation.annexure_deliverables}
                        onChange={handleChange}
                        rows={2}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                      />
                    </div>
                  </div>

                  {/* 4. Software */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">4)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Software:</label>
                      <input
                        type="text"
                        name="annexure_software"
                        value={quotation.annexure_software}
                        onChange={handleChange}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* 5. Duration */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">5)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Duration:</label>
                      <input
                        type="text"
                        name="annexure_duration"
                        value={quotation.annexure_duration}
                        onChange={handleChange}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* 6. Site Visit */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">6)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Site Visit:</label>
                      <input
                        type="text"
                        name="annexure_site_visit"
                        value={quotation.annexure_site_visit}
                        onChange={handleChange}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* 7. Quotation Validity */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">7)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Quotation Validity:</label>
                      <input
                        type="text"
                        name="annexure_quotation_validity"
                        value={quotation.annexure_quotation_validity}
                        onChange={handleChange}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* 8. Mode of Delivery */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">8)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Mode of Delivery:</label>
                      <input
                        type="text"
                        name="annexure_mode_of_delivery"
                        value={quotation.annexure_mode_of_delivery}
                        onChange={handleChange}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* 9. Revision */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">9)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Revision:</label>
                      <input
                        type="text"
                        name="annexure_revision"
                        value={quotation.annexure_revision}
                        onChange={handleChange}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* 10. Exclusions */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">10)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Exclusions:</label>
                      <textarea
                        name="annexure_exclusions"
                        value={quotation.annexure_exclusions}
                        onChange={handleChange}
                        rows={2}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                      />
                    </div>
                  </div>

                  {/* 11. Billing & Payment terms */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">11)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-1">Billing & Payment terms:</label>
                      <textarea
                        name="annexure_billing_payment_terms"
                        value={quotation.annexure_billing_payment_terms}
                        onChange={handleChange}
                        rows={6}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                      />
                    </div>
                  </div>

                  {/* 12. Other Terms & conditions */}
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-semibold w-6 shrink-0">12)</span>
                    <div className="flex-1">
                      <label className="block text-sm font-semibold mb-2">Other Terms & conditions:</label>
                      
                      {/* 12.1 Confidentiality */}
                      <div className="ml-4 mb-3">
                        <label className="block text-sm font-medium mb-1">12.1 Confidentiality:</label>
                        <textarea
                          name="annexure_confidentiality"
                          value={quotation.annexure_confidentiality}
                          onChange={handleChange}
                          rows={4}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                        />
                      </div>

                      {/* 12.2 Codes and Standards */}
                      <div className="ml-4 mb-3">
                        <label className="block text-sm font-medium mb-1">12.2 Codes and Standards:</label>
                        <textarea
                          name="annexure_codes_standards"
                          value={quotation.annexure_codes_standards}
                          onChange={handleChange}
                          rows={3}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                        />
                      </div>

                      {/* 12.3 Dispute Resolution */}
                      <div className="ml-4">
                        <label className="block text-sm font-medium mb-1">12.3 Dispute Resolution:</label>
                        <textarea
                          name="annexure_dispute_resolution"
                          value={quotation.annexure_dispute_resolution}
                          onChange={handleChange}
                          rows={3}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="border border-gray-300">
                <div className="flex">
                  <div className="flex-1 p-4 border-r border-gray-300">
                    <p className="text-sm text-gray-600">Receivers Signature with Company Seal.</p>
                    <div className="h-20"></div>
                  </div>
                  <div className="flex-1 p-4">
                    <p className="text-sm font-semibold">For <span className="text-purple-700">Accent Techno Solutions Private Limited</span></p>
                    <div className="h-12"></div>
                    <p className="text-sm font-semibold">Santosh Dinkar Mestry</p>
                    <p className="text-sm text-gray-600">Director</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
