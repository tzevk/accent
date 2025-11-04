'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { 
  DocumentTextIcon,
  PaperClipIcon,
  ArrowLeftIcon,
  DocumentArrowDownIcon
} from '@heroicons/react/24/outline';

export default function EditProposal() {
  const router = useRouter();
  const params = useParams();
  const proposalId = params.id;
  
  const [activeTab, setActiveTab] = useState('quotation');
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  // Quotation form data
  const [quotationData, setQuotationData] = useState({
    client_name: '',
    client_address: '',
    attention_person: '',
    attention_designation: '',
    quotation_no: '',
    date_of_quotation: new Date().toISOString().split('T')[0],
    enquiry_no: '',
    date_of_enquiry: '',
    scope_items: [],
    amount_in_words: '',
    total_amount: 0,
    gst_number: '',
    pan_number: '',
    tan_number: '',
    terms_and_conditions: '',
    payment_mode: '',
    receiver_signature: '',
    company_signature: '',
    signatory_name: '',
    signatory_designation: ''
  });

  // Annexure form data with default system-generated content
  const [annexureData, setAnnexureData] = useState({
    annexure_scope_of_work: [],
    annexure_input_documents: [],
    annexure_deliverables: [],
    annexure_software: [],
    annexure_duration: '',
    annexure_site_visit: [],
    annexure_quotation_validity: '',
    annexure_mode_of_delivery: [],
    annexure_revision: [],
    annexure_exclusions: [],
    annexure_billing_payment_terms: [
      'Payment shall be released by the client within 7 days from the date of the invoice.',
      'Payment shall be by way of RTGS transfer to ATSPL bank account.',
      'The late payment charges will be 2% per month on the total bill amount if bills are not settled within the credit period of 30 days.',
      'In case of project delays beyond two-month, software cost of ₹10,000/- per month will be charged.',
      'Upon completion of the above scope of work, if a project is cancelled or held by the client for any reason then Accent Techno Solutions Private Limited is entitled to 100% invoice against the completed work.'
    ],
    annexure_confidentiality: [
      'Input, output & any excerpts in between is intellectual properties of client. ATS shall not voluntarily disclose any of such documents to third parties & will undertake all the commonly accepted practices and tools to avoid the loss or spillover of such information.',
      'ATS shall take utmost care to maintain confidentiality of any information or intellectual property of client that it may come across.',
      'ATS is allowed to use the contract as a customer reference. However, no data or intellectual property of the client can be disclosed to third parties without the written consent of client.'
    ],
    annexure_codes_and_standards: [
      'Basic Engineering/ Detail Engineering should be carried out in ATS\'s office as per good engineering practices, project specifications and applicable client\'s inputs, Indian and International Standards'
    ],
    annexure_dispute_resolution: [
      'Should any disputes arise as claimed breach of the contract originated by this offer, it shall be finally settled amicably. Teamwork shall be the essence of this contract.',
      'We trust you will find our offer in line with your requirement, and we shall look forward to receiving your valued work order.',
      'Thanking you and always assuring you of our best services.'
    ]
  });

  useEffect(() => {
    if (proposalId) {
      fetchProposal();
    }
  }, [proposalId]);

  const fetchProposal = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/proposals/${proposalId}`);
      const data = await response.json();
      
      if (data.success && data.proposal) {
        setProposal(data.proposal);
        
        // Pre-fill quotation data with proposal info
        setQuotationData(prev => ({
          ...prev,
          client_name: data.proposal.client_name || data.proposal.client || '',
          client_address: data.proposal.client_address || '',
          attention_person: data.proposal.attention_person || data.proposal.contact_name || '',
          attention_designation: data.proposal.attention_designation || '',
          quotation_no: data.proposal.quotation_no || '',
          date_of_quotation: data.proposal.date_of_quotation || new Date().toISOString().split('T')[0],
          enquiry_no: data.proposal.enquiry_no || '',
          date_of_enquiry: data.proposal.date_of_enquiry || '',
          scope_items: (() => {
            try {
              return data.proposal.scope_items ? JSON.parse(data.proposal.scope_items) : [];
            } catch {
              return [];
            }
          })(),
          amount_in_words: data.proposal.amount_in_words || '',
          total_amount: data.proposal.total_amount || 0,
          gst_number: data.proposal.gst_number || '',
          pan_number: data.proposal.pan_number || '',
          tan_number: data.proposal.tan_number || '',
          terms_and_conditions: data.proposal.terms_and_conditions || '',
          payment_mode: data.proposal.payment_mode || '',
          receiver_signature: data.proposal.receiver_signature || '',
          company_signature: data.proposal.company_signature || '',
          signatory_name: data.proposal.signatory_name || '',
          signatory_designation: data.proposal.signatory_designation || ''
        }));
        
        // Helper function to convert string to array or keep default
        const convertToArray = (value, defaultValue = []) => {
          if (Array.isArray(value)) return value;
          if (value && typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              return Array.isArray(parsed) ? parsed : [value];
            } catch {
              return [value];
            }
          }
          return defaultValue;
        };

        // Pre-fill annexure data with proposal info, maintaining defaults for standard fields
        setAnnexureData(prev => ({
          ...prev,
          annexure_scope_of_work: convertToArray(data.proposal.annexure_scope_of_work),
          annexure_input_documents: convertToArray(data.proposal.annexure_input_documents),
          annexure_deliverables: convertToArray(data.proposal.annexure_deliverables),
          annexure_software: convertToArray(data.proposal.annexure_software),
          annexure_duration: data.proposal.annexure_duration || '',
          annexure_site_visit: convertToArray(data.proposal.annexure_site_visit),
          annexure_quotation_validity: data.proposal.annexure_quotation_validity || '',
          annexure_mode_of_delivery: convertToArray(data.proposal.annexure_mode_of_delivery),
          annexure_revision: convertToArray(data.proposal.annexure_revision),
          annexure_exclusions: convertToArray(data.proposal.annexure_exclusions),
          // Keep defaults for payment terms if not set in database
          annexure_billing_payment_terms: convertToArray(data.proposal.annexure_billing_payment_terms, prev.annexure_billing_payment_terms),
          // Keep defaults for confidentiality if not set in database
          annexure_confidentiality: convertToArray(data.proposal.annexure_confidentiality, prev.annexure_confidentiality),
          // Keep defaults for codes and standards if not set in database
          annexure_codes_and_standards: convertToArray(data.proposal.annexure_codes_and_standards, prev.annexure_codes_and_standards),
          // Keep defaults for dispute resolution if not set in database
          annexure_dispute_resolution: convertToArray(data.proposal.annexure_dispute_resolution, prev.annexure_dispute_resolution)
        }));
      }
    } catch (error) {
      console.error('Error fetching proposal:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      // Convert annexure arrays to JSON strings for database storage
      const processedAnnexureData = {};
      Object.keys(annexureData).forEach(key => {
        if (Array.isArray(annexureData[key])) {
          processedAnnexureData[key] = JSON.stringify(annexureData[key]);
        } else {
          processedAnnexureData[key] = annexureData[key];
        }
      });

      const payload = {
        // Basic proposal data
        title: proposal?.title,
        client: proposal?.client,
        contact_name: proposal?.contact_name,
        contact_email: proposal?.contact_email,
        phone: proposal?.phone,
        project_description: proposal?.project_description,
        city: proposal?.city,
        priority: proposal?.priority,
        value: proposal?.value,
        status: proposal?.status,
        due_date: proposal?.due_date,
        notes: proposal?.notes,
        lead_id: proposal?.lead_id,
        
        // Quotation data
        ...quotationData,
        
        // Processed annexure data
        ...processedAnnexureData
      };

      const response = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      
      if (result.success) {
        alert('Proposal saved successfully!');
      } else {
        alert('Failed to save proposal: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving proposal:', error);
      alert('Error saving proposal: ' + error.message);
    }
  };

  const handleGeneratePDF = () => {
    // Implementation for PDF generation
    console.log('Generating PDF for:', activeTab);
    // TODO: Implement PDF generation
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-purple"></div>
          <span className="ml-2 text-gray-500">Loading proposal...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      
      {/* Fixed header section */}
      <div className="flex-shrink-0 pt-24 pl-6 pr-8 pb-4">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/proposals')}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeftIcon className="h-6 w-6" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-black mb-2">
                Edit Proposal
              </h1>
              <p className="text-gray-600">
                {proposal?.title || 'Untitled Proposal'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setIsPreviewMode(!isPreviewMode)}
              className={`inline-flex items-center px-4 py-2 border text-sm font-medium rounded-lg transition-colors space-x-2 ${
                isPreviewMode 
                  ? 'bg-accent-purple text-white border-accent-purple hover:bg-accent-purple/90' 
                  : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span>{isPreviewMode ? 'Edit Mode' : 'Preview'}</span>
            </button>
            
            {isPreviewMode && (
              <button
                onClick={handleGeneratePDF}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 space-x-2"
              >
                <DocumentArrowDownIcon className="h-4 w-4" />
                <span>Generate PDF</span>
              </button>
            )}
            
            {!isPreviewMode && (
              <button
                onClick={handleSave}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors space-x-2"
              >
                <span>Save Changes</span>
              </button>
            )}
          </div>
        </div>
        
        {/* Tab Navigation - Fixed */}
        <div className="flex border-b border-gray-200 bg-white rounded-t-lg px-6 pt-4">
          <button
            onClick={() => setActiveTab('quotation')}
            className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
              activeTab === 'quotation'
                ? 'border-black text-black bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <DocumentTextIcon className="h-5 w-5 inline mr-2" />
            Quotation
          </button>
          
          <button
            onClick={() => setActiveTab('annexure')}
            className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
              activeTab === 'annexure'
                ? 'border-black text-black bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <PaperClipIcon className="h-5 w-5 inline mr-2" />
            Annexure
          </button>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white rounded-t-lg shadow-sm min-h-full">
          <div className="p-6">
            {isPreviewMode ? (
              // Preview Mode
              <>
                {/* Preview Mode Header with Back Button */}
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={() => setIsPreviewMode(false)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Back to Edit Mode"
                    >
                      <ArrowLeftIcon className="h-5 w-5" />
                    </button>
                    <h2 className="text-xl font-semibold text-gray-900">
                      Preview: {activeTab === 'quotation' ? 'Quotation' : 'Annexure'}
                    </h2>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setActiveTab('quotation')}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                        activeTab === 'quotation' 
                          ? 'bg-accent-purple text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Quotation Preview
                    </button>
                    <button
                      onClick={() => setActiveTab('annexure')}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                        activeTab === 'annexure' 
                          ? 'bg-accent-purple text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Annexure Preview
                    </button>
                  </div>
                </div>

                {activeTab === 'quotation' && (
                  <QuotationPreview 
                    quotationData={quotationData}
                    proposal={proposal}
                  />
                )}

                {activeTab === 'annexure' && (
                  <AnnexurePreview 
                    annexureData={annexureData}
                  />
                )}
              </>
            ) : (
              // Edit Mode
              <>
                {activeTab === 'quotation' && (
                  <QuotationForm 
                    quotationData={quotationData}
                    setQuotationData={setQuotationData}
                  />
                )}

                {activeTab === 'annexure' && (
                  <AnnexureForm 
                    annexureData={annexureData}
                    setAnnexureData={setAnnexureData}
                  />
                )}
              </>
            )}
            
            {/* Save and Cancel Buttons - Only show in edit mode */}
            {!isPreviewMode && (
              <div className="mt-6 pt-4 border-t border-gray-200">
                <div className="flex justify-end space-x-3 px-1">
                  <button
                    onClick={() => router.push('/proposals')}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  
                  <button
                    onClick={handleSave}
                    className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Quotation Preview Component
function QuotationPreview({ quotationData, proposal }) {
  return (
    <div className="max-w-4xl mx-auto bg-white border border-gray-200 rounded-lg shadow-sm">
      {/* Header */}
      <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-bold text-gray-900">Quotation Preview</h2>
        <p className="text-sm text-gray-600 mt-1">This is how your quotation will appear in the PDF</p>
      </div>
      
      {/* Content */}
      <div className="p-8 space-y-6">
        {/* Company Header */}
        <div className="text-center border-b pb-6">
          <h1 className="text-2xl font-bold text-gray-900">ACCENT TECHNO SOLUTIONS PVT. LTD.</h1>
          <p className="text-sm text-gray-600 mt-2">Technical Consultancy Services</p>
        </div>
        
        {/* Client Info */}
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">To:</h3>
            <div className="space-y-1 text-sm">
              <p><strong>Company:</strong> {quotationData.company_name || proposal?.client || 'N/A'}</p>
              <p><strong>Address:</strong> {quotationData.company_address || 'N/A'}</p>
              <p><strong>Attention:</strong> {quotationData.attention_person || 'N/A'}</p>
              <p><strong>Designation:</strong> {quotationData.attention_designation || 'N/A'}</p>
            </div>
          </div>
          
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Quotation Details:</h3>
            <div className="space-y-1 text-sm">
              <p><strong>Quotation No:</strong> {quotationData.quotation_no || 'N/A'}</p>
              <p><strong>Date:</strong> {quotationData.date_of_quotation || 'N/A'}</p>
              <p><strong>Enquiry No:</strong> {quotationData.enquiry_no || 'N/A'}</p>
              <p><strong>Enquiry Date:</strong> {quotationData.date_of_enquiry || 'N/A'}</p>
            </div>
          </div>
        </div>
        
        {/* Scope Items Table */}
        {quotationData.scope_items && quotationData.scope_items.length > 0 && (
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Scope of Work:</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r">Sr. No.</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r">Qty</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r">Unit</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r">Rate</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {quotationData.scope_items.map((item, index) => (
                    <tr key={index}>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r">{index + 1}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r">{item.description}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r">{item.quantity}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r">{item.unit}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 border-r">₹{item.rate}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">₹{item.amount}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-semibold">
                    <td colSpan="5" className="px-4 py-3 text-sm text-gray-900 border-r text-right">Total Amount:</td>
                    <td className="px-4 py-3 text-sm text-gray-900">₹{quotationData.total_amount}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {/* Additional Info */}
        <div className="grid grid-cols-2 gap-8 pt-4">
          <div>
            <p className="text-sm"><strong>Amount in Words:</strong> {quotationData.amount_in_words || 'N/A'}</p>
            <p className="text-sm mt-2"><strong>Payment Mode:</strong> {quotationData.payment_mode || 'N/A'}</p>
          </div>
          <div>
            <p className="text-sm"><strong>GST No:</strong> {quotationData.gst_number || 'N/A'}</p>
            <p className="text-sm mt-1"><strong>PAN No:</strong> {quotationData.pan_number || 'N/A'}</p>
            <p className="text-sm mt-1"><strong>TAN No:</strong> {quotationData.tan_number || 'N/A'}</p>
          </div>
        </div>
        
        {/* Terms and Conditions */}
        {quotationData.terms_and_conditions && (
          <div className="pt-4 border-t">
            <h3 className="font-semibold text-gray-900 mb-2">Terms & Conditions:</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{quotationData.terms_and_conditions}</p>
          </div>
        )}
        
        {/* Signatures */}
        <div className="grid grid-cols-2 gap-8 pt-8 border-t">
          <div className="text-center">
            <div className="h-16 border-b border-gray-300 mb-2"></div>
            <p className="text-sm font-medium">Client Signature</p>
            <p className="text-xs text-gray-600">{quotationData.receiver_signature || 'Receiver'}</p>
          </div>
          <div className="text-center">
            <div className="h-16 border-b border-gray-300 mb-2"></div>
            <p className="text-sm font-medium">Company Signature</p>
            <p className="text-xs text-gray-600">{quotationData.signatory_name || 'Signatory Name'}</p>
            <p className="text-xs text-gray-600">{quotationData.signatory_designation || 'Designation'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Annexure Preview Component
function AnnexurePreview({ annexureData }) {
  const renderListItems = (items, title) => {
    if (!items || (Array.isArray(items) && items.length === 0)) return null;
    
    const itemsToRender = Array.isArray(items) ? items : [items];
    
    return (
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 ml-4">
          {itemsToRender.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto bg-white border border-gray-200 rounded-lg shadow-sm">
      {/* Header */}
      <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-bold text-gray-900">Annexure Preview</h2>
        <p className="text-sm text-gray-600 mt-1">This is how your annexure will appear in the PDF</p>
      </div>
      
      {/* Content */}
      <div className="p-8 space-y-6">
        {/* Company Header */}
        <div className="text-center border-b pb-6">
          <h1 className="text-2xl font-bold text-gray-900">ANNEXURE</h1>
          <h2 className="text-lg font-semibold text-gray-800 mt-2">ACCENT TECHNO SOLUTIONS PVT. LTD.</h2>
        </div>
        
        {/* Project Details Section */}
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">Project Details</h2>
          
          {renderListItems(annexureData.annexure_scope_of_work, 'Scope of Work')}
          {renderListItems(annexureData.annexure_input_documents, 'Input Documents')}
          {renderListItems(annexureData.annexure_deliverables, 'Deliverables')}
          {renderListItems(annexureData.annexure_software, 'Software')}
          
          {annexureData.annexure_duration && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-2">Duration</h3>
              <p className="text-sm text-gray-700">{annexureData.annexure_duration}</p>
            </div>
          )}
          
          {renderListItems(annexureData.annexure_site_visit, 'Site Visit')}
          
          {annexureData.annexure_quotation_validity && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-2">Quotation Validity</h3>
              <p className="text-sm text-gray-700">{annexureData.annexure_quotation_validity}</p>
            </div>
          )}
        </div>
        
        {/* Terms & Conditions Section */}
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-4 border-b pb-2">Terms & Conditions</h2>
          
          {renderListItems(annexureData.annexure_mode_of_delivery, 'Mode of Delivery')}
          {renderListItems(annexureData.annexure_revision, 'Revision')}
          {renderListItems(annexureData.annexure_exclusions, 'Exclusions')}
          
          {/* Payment Terms */}
          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-2">Payment Terms</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 ml-4">
              {Array.isArray(annexureData.annexure_billing_payment_terms) && 
                annexureData.annexure_billing_payment_terms.map((item, index) => (
                  <li key={index}>{item}</li>
                ))
              }
            </ul>
          </div>
          
          {/* Other Terms & Conditions */}
          <div className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-2">12) Other Terms & Conditions</h3>
            
            {/* Confidentiality */}
            <div className="mb-4">
              <h4 className="font-medium text-gray-800 mb-1">12.1 Confidentiality</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 ml-4">
                {Array.isArray(annexureData.annexure_confidentiality) && 
                  annexureData.annexure_confidentiality.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))
                }
              </ul>
            </div>
            
            {/* Codes and Standards */}
            <div className="mb-4">
              <h4 className="font-medium text-gray-800 mb-1">12.2 Codes and Standards</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 ml-4">
                {Array.isArray(annexureData.annexure_codes_and_standards) && 
                  annexureData.annexure_codes_and_standards.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))
                }
              </ul>
            </div>
            
            {/* Dispute Resolution */}
            <div className="mb-4">
              <h4 className="font-medium text-gray-800 mb-1">12.3 Dispute Resolution</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 ml-4">
                {Array.isArray(annexureData.annexure_dispute_resolution) && 
                  annexureData.annexure_dispute_resolution.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))
                }
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Quotation Form Component
function QuotationForm({ quotationData, setQuotationData }) {
  const handleInputChange = (field, value) => {
    setQuotationData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const addScopeItem = () => {
    const newItem = {
      sr_no: quotationData.scope_items.length + 1,
      scope_of_work: '',
      quantity: 1,
      rate: 0,
      amount: 0
    };
    setQuotationData(prev => ({
      ...prev,
      scope_items: [...prev.scope_items, newItem]
    }));
  };

  const updateScopeItem = (index, field, value) => {
    const updatedItems = [...quotationData.scope_items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    
    // Calculate amount if quantity or rate changes
    if (field === 'quantity' || field === 'rate') {
      updatedItems[index].amount = updatedItems[index].quantity * updatedItems[index].rate;
    }
    
    setQuotationData(prev => ({
      ...prev,
      scope_items: updatedItems,
      total_amount: updatedItems.reduce((sum, item) => sum + (item.amount || 0), 0)
    }));
  };

  const removeScopeItem = (index) => {
    const updatedItems = quotationData.scope_items.filter((_, i) => i !== index);
    setQuotationData(prev => ({
      ...prev,
      scope_items: updatedItems,
      total_amount: updatedItems.reduce((sum, item) => sum + (item.amount || 0), 0)
    }));
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Client Information */}
        <div className="space-y-3">
          <h3 className="text-base font-medium text-gray-900 border-b pb-1">Client Information</h3>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Client Name</label>
            <input
              type="text"
              value={quotationData.client_name}
              onChange={(e) => handleInputChange('client_name', e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Client Address</label>
            <textarea
              value={quotationData.client_address}
              onChange={(e) => handleInputChange('client_address', e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Attention Person</label>
            <input
              type="text"
              value={quotationData.attention_person}
              onChange={(e) => handleInputChange('attention_person', e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Attention Designation</label>
            <input
              type="text"
              value={quotationData.attention_designation}
              onChange={(e) => handleInputChange('attention_designation', e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-accent-purple focus:border-transparent"
            />
          </div>
        </div>

        {/* Quotation Details */}
        <div className="space-y-3">
          <h3 className="text-base font-medium text-gray-900 border-b pb-1">Quotation Details</h3>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Quotation No</label>
            <input
              type="text"
              value={quotationData.quotation_no}
              onChange={(e) => handleInputChange('quotation_no', e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date of Quotation</label>
            <input
              type="date"
              value={quotationData.date_of_quotation}
              onChange={(e) => handleInputChange('date_of_quotation', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Enquiry No</label>
            <input
              type="text"
              value={quotationData.enquiry_no}
              onChange={(e) => handleInputChange('enquiry_no', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date of Enquiry</label>
            <input
              type="date"
              value={quotationData.date_of_enquiry}
              onChange={(e) => handleInputChange('date_of_enquiry', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Scope Items */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">Scope of Work Items</h3>
          <button
            onClick={addScopeItem}
            className="inline-flex items-center px-3 py-2 bg-accent-purple text-white text-sm font-medium rounded-md hover:bg-accent-purple/90"
          >
            Add Item
          </button>
        </div>

        {quotationData.scope_items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sr. No</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scope of Work</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {quotationData.scope_items.map((item, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.sr_no}</td>
                    <td className="px-6 py-4">
                      <input
                        type="text"
                        value={item.scope_of_work}
                        onChange={(e) => updateScopeItem(index, 'scope_of_work', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-accent-purple"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateScopeItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-accent-purple"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="number"
                        value={item.rate}
                        onChange={(e) => updateScopeItem(index, 'rate', parseFloat(e.target.value) || 0)}
                        className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-accent-purple"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ₹{(item.amount || 0).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => removeScopeItem(index)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Financial Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Financial Details</h3>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount</label>
            <input
              type="number"
              value={quotationData.total_amount}
              onChange={(e) => handleInputChange('total_amount', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount in Words</label>
            <input
              type="text"
              value={quotationData.amount_in_words}
              onChange={(e) => handleInputChange('amount_in_words', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Mode</label>
            <input
              type="text"
              value={quotationData.payment_mode}
              onChange={(e) => handleInputChange('payment_mode', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Tax Details</h3>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GST Number</label>
            <input
              type="text"
              value={quotationData.gst_number}
              onChange={(e) => handleInputChange('gst_number', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">PAN Number</label>
            <input
              type="text"
              value={quotationData.pan_number}
              onChange={(e) => handleInputChange('pan_number', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">TAN Number</label>
            <input
              type="text"
              value={quotationData.tan_number}
              onChange={(e) => handleInputChange('tan_number', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Terms and Signatures */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Terms & Conditions</h3>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Terms and Conditions</label>
            <textarea
              value={quotationData.terms_and_conditions}
              onChange={(e) => handleInputChange('terms_and_conditions', e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Signatures</h3>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Receiver Signature</label>
            <input
              type="text"
              value={quotationData.receiver_signature}
              onChange={(e) => handleInputChange('receiver_signature', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Signature</label>
            <input
              type="text"
              value={quotationData.company_signature}
              onChange={(e) => handleInputChange('company_signature', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Signatory Name</label>
            <input
              type="text"
              value={quotationData.signatory_name}
              onChange={(e) => handleInputChange('signatory_name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Signatory Designation</label>
            <input
              type="text"
              value={quotationData.signatory_designation}
              onChange={(e) => handleInputChange('signatory_designation', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// List Field Component for managing array-based fields
function ListField({ label, items, onUpdate }) {
  const [newItem, setNewItem] = useState('');

  const addItem = () => {
    if (newItem.trim()) {
      onUpdate([...items, newItem.trim()]);
      setNewItem('');
    }
  };

  const removeItem = (index) => {
    onUpdate(items.filter((_, i) => i !== index));
  };

  const editItem = (index, value) => {
    const updatedItems = [...items];
    updatedItems[index] = value;
    onUpdate(updatedItems);
  };

  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-2">{label}</label>
      
      {/* Display existing items */}
      {items.length > 0 && (
        <div className="mb-3 space-y-2">
          {items.map((item, index) => (
            <div key={index} className="flex items-start space-x-2 group">
              <span className="text-xs text-gray-500 mt-1.5">•</span>
              <textarea
                value={item}
                onChange={(e) => editItem(index, e.target.value)}
                rows={2}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-accent-purple focus:border-transparent resize-none"
              />
              <button
                onClick={() => removeItem(index)}
                className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove item"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new item */}
      <div className="flex space-x-2">
        <textarea
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder={`Add new ${label.toLowerCase()} item...`}
          rows={2}
          className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-accent-purple focus:border-transparent resize-none"
        />
        <button
          onClick={addItem}
          className="px-3 py-1.5 bg-accent-purple text-white text-xs rounded-md hover:bg-purple-700 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// Annexure Form Component
function AnnexureForm({ annexureData, setAnnexureData }) {
  const handleInputChange = (field, value) => {
    setAnnexureData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleListUpdate = (field, items) => {
    setAnnexureData(prev => ({
      ...prev,
      [field]: items
    }));
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="text-base font-medium text-gray-900 border-b pb-1">Project Details</h3>
          
          <ListField
            label="Scope of Work"
            items={annexureData.annexure_scope_of_work}
            onUpdate={(items) => handleListUpdate('annexure_scope_of_work', items)}
          />

          <ListField
            label="Input Documents"
            items={annexureData.annexure_input_documents}
            onUpdate={(items) => handleListUpdate('annexure_input_documents', items)}
          />

          <ListField
            label="Deliverables"
            items={annexureData.annexure_deliverables}
            onUpdate={(items) => handleListUpdate('annexure_deliverables', items)}
          />

          <ListField
            label="Software"
            items={annexureData.annexure_software}
            onUpdate={(items) => handleListUpdate('annexure_software', items)}
          />

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Duration</label>
            <input
              type="text"
              value={annexureData.annexure_duration}
              onChange={(e) => handleInputChange('annexure_duration', e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-accent-purple focus:border-transparent"
            />
          </div>

          <ListField
            label="Site Visit"
            items={annexureData.annexure_site_visit}
            onUpdate={(items) => handleListUpdate('annexure_site_visit', items)}
          />

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Quotation Validity</label>
            <input
              type="text"
              value={annexureData.annexure_quotation_validity}
              onChange={(e) => handleInputChange('annexure_quotation_validity', e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-accent-purple focus:border-transparent"
            />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-base font-medium text-gray-900 border-b pb-1">Terms & Conditions</h3>
          
          <ListField
            label="Mode of Delivery"
            items={annexureData.annexure_mode_of_delivery}
            onUpdate={(items) => handleListUpdate('annexure_mode_of_delivery', items)}
          />

          <ListField
            label="Revision"
            items={annexureData.annexure_revision}
            onUpdate={(items) => handleListUpdate('annexure_revision', items)}
          />

          <ListField
            label="Exclusions"
            items={annexureData.annexure_exclusions}
            onUpdate={(items) => handleListUpdate('annexure_exclusions', items)}
          />

          <ListField
            label="Payment Terms"
            items={annexureData.annexure_billing_payment_terms}
            onUpdate={(items) => handleListUpdate('annexure_billing_payment_terms', items)}
          />

          <ListField
            label="Confidentiality"
            items={annexureData.annexure_confidentiality}
            onUpdate={(items) => handleListUpdate('annexure_confidentiality', items)}
          />

          <ListField
            label="Codes and Standards"
            items={annexureData.annexure_codes_and_standards}
            onUpdate={(items) => handleListUpdate('annexure_codes_and_standards', items)}
          />

          <ListField
            label="Dispute Resolution"
            items={annexureData.annexure_dispute_resolution}
            onUpdate={(items) => handleListUpdate('annexure_dispute_resolution', items)}
          />
        </div>
      </div>
    </div>
  );
}