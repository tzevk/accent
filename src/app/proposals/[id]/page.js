'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { fetchJSON } from '@/utils/http';
import { 
  ArrowLeftIcon,
  DocumentTextIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
  ArrowRightIcon,
  PlusIcon,
  TrashIcon,
  DocumentArrowDownIcon
} from '@heroicons/react/24/outline';

export default function ProposalPage() {
  const router = useRouter();
  const { id: routeId } = useParams() || {};

  const [proposal, setProposal] = useState(null);
  const [linkedLead, setLinkedLead] = useState(null);
  const [loading, setLoading] = useState(true);
  // Local form state for editing proposal
  const [formData, setFormData] = useState({
    title: '',
    value: '',
    due_date: '',
    notes: '',
    client_name: ''
  });
  const [isEditing, setIsEditing] = useState(false);

  // Versions & approvals state
  const [versions, setVersions] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [newVersion, setNewVersion] = useState({
    version_label: '',
    file_url: '',
    original_name: '',
    uploaded_by: '',
    notes: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [approvalComment, setApprovalComment] = useState('');

  // Convert confirmation modal state
  const [showConvertConfirm, setShowConvertConfirm] = useState(false);
  const [convertLoading, setConvertLoading] = useState(false);

  // Quotation form state
  const [showQuotationForm, setShowQuotationForm] = useState(false);
  const [quotationData, setQuotationData] = useState({
    client: {
      name: '',
      address: '',
      contactPerson: '',
      designation: ''
    },
    quotation: {
      number: '',
      date: '',
      enquiryNo: '',
      enquiryDate: ''
    },
    work: [
      { id: 1, scope: '', qty: '', rate: '', amount: '' }
    ],
    amount: {
      inWords: '',
      total: ''
    },
    registration: {
      gst: '',
      pan: '',
      tan: ''
    },
    terms: '',
    payment: '',
    signature: {
      name: 'Santosh Dinkar Mestry',
      designation: 'Director'
    }
  });

  // Annexure form state
  const [showAnnexureForm, setShowAnnexureForm] = useState(false);
  const [annexureData, setAnnexureData] = useState({
    scopeOfWork: '',
    inputDocuments: '',
    deliverables: '',
    software: '',
    duration: '',
    siteVisit: '',
    quotationValidity: '',
    modeOfDelivery: '',
    revision: '',
    exclusions: '',
    billingAndPayment: ''
  });


  // Fetch proposal + linked lead
  useEffect(() => {
    const fetchProposal = async () => {
      if (!routeId) return;
      setLoading(true);
      try {
  const result = await fetchJSON(`/api/proposals/${routeId}`);

        if (result?.success && result?.data) {
          const proposalData = result.data;
          setProposal(proposalData);

          if (proposalData?.lead_id) {
            try {
              const leadJson = await fetchJSON(`/api/leads/${proposalData.lead_id}`);
              if (leadJson?.success) setLinkedLead(leadJson.data);
            } catch {
              /* ignore lead fetch errors */
            }
          }

          setFormData({
            title: proposalData?.title || '',
            value: proposalData?.value ?? '',
            due_date: proposalData?.due_date || '',
            notes: proposalData?.notes || '',
            client_name: proposalData?.client_name || ''
          });
        } else {
          // Defensive logging: result may be undefined or not contain error field
          console.error('Error fetching proposal:', result?.error ?? result ?? 'Unexpected empty response');
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProposal();
  }, [routeId]);

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    try {
      if (!proposal?.id) return alert('Proposal not loaded');
      const result = await fetchJSON(`/api/proposals/${proposal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (result?.success) {
        setProposal(prev => ({ ...prev, ...formData }));
        setIsEditing(false);
        alert('Proposal updated successfully!');
      } else {
        alert('Error updating proposal: ' + (result?.error || 'unknown'));
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error updating proposal');
    }
  };

  // Quotation form handlers
  const handleQuotationChange = (section, field, value) => {
    setQuotationData(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }));
  };

  const addWorkItem = () => {
    setQuotationData(prev => ({
      ...prev,
      work: [...prev.work, { scope: '', qty: '', rate: '', amount: 0 }]
    }));
  };

  const removeWorkItem = (index) => {
    setQuotationData(prev => ({
      ...prev,
      work: prev.work.filter((_, i) => i !== index)
    }));
  };

  const updateWorkItem = (index, field, value) => {
    setQuotationData(prev => {
      const newWork = [...prev.work];
      newWork[index] = { ...newWork[index], [field]: value };
      
      // Auto-calculate amount if qty and rate are provided
      if (field === 'qty' || field === 'rate') {
        const qty = parseFloat(newWork[index].qty) || 0;
        const rate = parseFloat(newWork[index].rate) || 0;
        newWork[index].amount = qty * rate;
      }
      
      return { ...prev, work: newWork };
    });
  };

  const calculateTotal = () => {
    return quotationData.work.reduce((total, item) => total + (item.amount || 0), 0);
  };

  const handleAnnexureChange = (field, value) => {
    setAnnexureData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const submitQuotation = async () => {
    try {
      setIsSubmitting(true);
      
      // Calculate total amount
      const totalAmount = calculateTotal();
      
      const quotationPayload = {
        ...quotationData,
        amount: {
          ...quotationData.amount,
          total: totalAmount
        },
        proposalId: proposal.id
      };

      const result = await fetchJSON(`/api/proposals/${proposal.id}/quotation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quotationPayload),
      });

      if (result?.success) {
        alert('Quotation saved successfully!');
        setShowQuotationForm(false);
        // Reset form if needed
      } else {
        alert('Error saving quotation: ' + (result?.error || 'unknown'));
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error saving quotation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitAnnexure = async () => {
    try {
      setIsSubmitting(true);
      
      const annexurePayload = {
        ...annexureData,
        proposalId: proposal.id
      };

      const result = await fetchJSON(`/api/proposals/${proposal.id}/annexure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(annexurePayload),
      });

      if (result?.success) {
        alert('Annexure saved successfully!');
        setShowAnnexureForm(false);
        // Reset form if needed
      } else {
        alert('Error saving annexure: ' + (result?.error || 'unknown'));
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error saving annexure');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetQuotationForm = () => {
    setQuotationData({
      client: { name: '', address: '', contactPerson: '', designation: '' },
      quotation: { number: '', date: '', enquiryNo: '', enquiryDate: '' },
      work: [{ scope: '', qty: '', rate: '', amount: 0 }],
      amount: { inWords: '', total: 0 },
      registration: { gst: '', pan: '', tan: '' },
      terms: '',
      payment: { advance: '', balance: '', bankDetails: '' },
      signature: { name: 'Santosh Dinkar Mestry', designation: 'Director', date: '' }
    });
  };

  const resetAnnexureForm = () => {
    setAnnexureData({
      projectName: '',
      clientName: '',
      projectType: '',
      timeline: '',
      budget: '',
      scope: '',
      deliverables: '',
      milestones: '',
      riskFactors: '',
      assumptions: '',
      additionalNotes: ''
    });
  };

  const generatePDF = async () => {
    try {
      setIsSubmitting(true);
      
      // Dynamic import to avoid SSR issues
      const jsPDF = (await import('jspdf')).default;
      const html2canvas = (await import('html2canvas')).default;
      
      const activeTab = showQuotationForm ? 'quotation' : 'annexure';
      const contentId = activeTab === 'quotation' ? 'quotation-content' : 'annexure-content';
      const element = document.getElementById(contentId);
      
      if (!element) {
        alert('Content not found for PDF generation');
        return;
      }

      // Create a temporary container with proper styling for PDF
      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      tempDiv.style.background = 'white';
      tempDiv.style.padding = '40px';
      tempDiv.style.width = '800px';
      tempDiv.style.fontFamily = 'Arial, sans-serif';
      tempDiv.innerHTML = `
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #64126D; font-size: 24px; margin: 0;">Accent CRM</h1>
          <h2 style="color: #333; font-size: 18px; margin: 10px 0;">${activeTab === 'quotation' ? 'Professional Quotation' : 'Project Annexure'}</h2>
          <hr style="border: 1px solid #64126D; margin: 20px 0;">
        </div>
        ${activeTab === 'quotation' ? generateQuotationHTML() : generateAnnexureHTML()}
        <div style="margin-top: 40px; text-align: center;">
          <p style="font-size: 12px; color: #666;">Generated on ${new Date().toLocaleDateString()}</p>
        </div>
      `;
      
      document.body.appendChild(tempDiv);
      
      // Generate PDF
      const canvas = await html2canvas(tempDiv, {
        scale: 2,
        backgroundColor: '#ffffff',
        width: 800,
        height: tempDiv.scrollHeight
      });
      
      document.body.removeChild(tempDiv);
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const imgWidth = 190;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 10;
      
      pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight + 10;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      
      const filename = `${activeTab}_${proposal.title || 'document'}_${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(filename);
      
      alert(`${activeTab === 'quotation' ? 'Quotation' : 'Annexure'} PDF generated successfully!`);
      
    } catch (error) {
      console.error('PDF generation error:', error);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateQuotationHTML = () => {
    const total = calculateTotal();
    return `
      <div style="line-height: 1.6;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
          <div>
            <h3 style="color: #64126D; margin-bottom: 10px;">Client Information</h3>
            <p><strong>Name:</strong> ${quotationData.client.name}</p>
            <p><strong>Address:</strong> ${quotationData.client.address}</p>
            <p><strong>Contact Person:</strong> ${quotationData.client.contactPerson}</p>
            <p><strong>Designation:</strong> ${quotationData.client.designation}</p>
          </div>
          <div>
            <h3 style="color: #64126D; margin-bottom: 10px;">Quotation Details</h3>
            <p><strong>Quotation No:</strong> ${quotationData.quotation.number}</p>
            <p><strong>Date:</strong> ${quotationData.quotation.date}</p>
            <p><strong>Enquiry No:</strong> ${quotationData.quotation.enquiryNo}</p>
            <p><strong>Enquiry Date:</strong> ${quotationData.quotation.enquiryDate}</p>
          </div>
        </div>
        
        <h3 style="color: #64126D; margin: 20px 0 10px;">Work Items</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background: #f5f5f5;">
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Scope of Work</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Qty</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Rate</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${quotationData.work.map(item => `
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px;">${item.scope}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${item.qty}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">₹${item.rate}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">₹${item.amount.toFixed(2)}</td>
              </tr>
            `).join('')}
            <tr style="background: #f5f5f5; font-weight: bold;">
              <td colspan="3" style="border: 1px solid #ddd; padding: 8px; text-align: right;">Total Amount:</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">₹${total.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        
        <p><strong>Amount in Words:</strong> ${quotationData.amount.inWords}</p>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0;">
          <div>
            <h3 style="color: #64126D;">Registration Details</h3>
            <p><strong>GST:</strong> ${quotationData.registration.gst}</p>
            <p><strong>PAN:</strong> ${quotationData.registration.pan}</p>
            <p><strong>TAN:</strong> ${quotationData.registration.tan}</p>
          </div>
          <div>
            <h3 style="color: #64126D;">Payment Details</h3>
            <p><strong>Advance:</strong> ${quotationData.payment.advance}</p>
            <p><strong>Balance:</strong> ${quotationData.payment.balance}</p>
            <p><strong>Bank Details:</strong> ${quotationData.payment.bankDetails}</p>
          </div>
        </div>
        
        <div style="margin: 20px 0;">
          <h3 style="color: #64126D;">Terms & Conditions</h3>
          <p style="white-space: pre-wrap;">${quotationData.terms}</p>
        </div>
        
        <div style="text-align: right; margin-top: 40px;">
          <p><strong>Signature</strong></p>
          <p>${quotationData.signature.name}</p>
          <p>${quotationData.signature.designation}</p>
          <p>Date: ${quotationData.signature.date}</p>
        </div>
      </div>
    `;
  };

  const generateAnnexureHTML = () => {
    return `
      <div style="line-height: 1.6;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
          <div>
            <h3 style="color: #64126D;">Project Information</h3>
            <p><strong>Project Name:</strong> ${annexureData.projectName}</p>
            <p><strong>Client Name:</strong> ${annexureData.clientName}</p>
            <p><strong>Project Type:</strong> ${annexureData.projectType}</p>
          </div>
          <div>
            <h3 style="color: #64126D;">Timeline & Budget</h3>
            <p><strong>Timeline:</strong> ${annexureData.timeline}</p>
            <p><strong>Budget:</strong> ${annexureData.budget}</p>
          </div>
        </div>
        
        <div style="margin: 20px 0;">
          <h3 style="color: #64126D;">Scope of Work</h3>
          <p style="white-space: pre-wrap;">${annexureData.scope}</p>
        </div>
        
        <div style="margin: 20px 0;">
          <h3 style="color: #64126D;">Deliverables</h3>
          <p style="white-space: pre-wrap;">${annexureData.deliverables}</p>
        </div>
        
        <div style="margin: 20px 0;">
          <h3 style="color: #64126D;">Milestones</h3>
          <p style="white-space: pre-wrap;">${annexureData.milestones}</p>
        </div>
        
        <div style="margin: 20px 0;">
          <h3 style="color: #64126D;">Risk Factors</h3>
          <p style="white-space: pre-wrap;">${annexureData.riskFactors}</p>
        </div>
        
        <div style="margin: 20px 0;">
          <h3 style="color: #64126D;">Assumptions</h3>
          <p style="white-space: pre-wrap;">${annexureData.assumptions}</p>
        </div>
        
        ${annexureData.additionalNotes ? `
          <div style="margin: 20px 0;">
            <h3 style="color: #64126D;">Additional Notes</h3>
            <p style="white-space: pre-wrap;">${annexureData.additionalNotes}</p>
          </div>
        ` : ''}
      </div>
    `;
  };

  const fetchVersions = useCallback(async () => {
    if (!proposal?.id) return;
    try {
  const j = await fetchJSON(`/api/proposals/${proposal.id}/versions`);
      if (j?.success) setVersions(j.data || []);
    } catch (e) { console.error('versions fetch', e); }
  }, [proposal]);

  const fetchApprovals = useCallback(async () => {
    if (!proposal?.id) return;
    try {
  const j = await fetchJSON(`/api/proposals/${proposal.id}/approvals`);
      if (j?.success) setApprovals(j.data || []);
    } catch (e) { console.error('approvals fetch', e); }
  }, [proposal]);

  // Parse complex JSON fields from proposal for rendering in view


  const parsedCommercialItems = useMemo(() => {
    if (!proposal || !proposal.commercial_items) return [];
    try {
      return Array.isArray(proposal.commercial_items)
        ? proposal.commercial_items
        : (typeof proposal.commercial_items === 'string' ? JSON.parse(proposal.commercial_items) : []);
    } catch {
      return [];
    }
  }, [proposal]);

  const parsedPlannedHoursByDiscipline = useMemo(() => {
    if (!proposal || !proposal.planned_hours_by_discipline) return {};
    try {
      return typeof proposal.planned_hours_by_discipline === 'string' ? JSON.parse(proposal.planned_hours_by_discipline) : proposal.planned_hours_by_discipline;
    } catch {
      return {};
    }
  }, [proposal]);

  // REMOVED unused parsedPlannedHoursPerActivity

  useEffect(() => {
    const fetchMeta = async () => {
      if (!proposal?.id) return;
      await fetchVersions();
      await fetchApprovals();
    };
    fetchMeta();
  }, [proposal, fetchVersions, fetchApprovals]);

  // Listen for custom events from proposals list page
  useEffect(() => {
    const handleOpenQuotationForm = () => {
      setShowQuotationForm(true);
      setShowAnnexureForm(false);
    };

    const handleOpenAnnexureForm = () => {
      setShowAnnexureForm(true);
      setShowQuotationForm(false);
    };

    window.addEventListener('openQuotationForm', handleOpenQuotationForm);
    window.addEventListener('openAnnexureForm', handleOpenAnnexureForm);

    return () => {
      window.removeEventListener('openQuotationForm', handleOpenQuotationForm);
      window.removeEventListener('openAnnexureForm', handleOpenAnnexureForm);
    };
  }, []);

  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setSelectedFile(f);
      setNewVersion(prev => ({ ...prev, original_name: f.name }));
    } else {
      setSelectedFile(null);
    }
  };

  const addVersion = async () => {
    try {
      if (!proposal?.id) return alert('Proposal not loaded');
      let fileUrl = newVersion.file_url;

      if (selectedFile) {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(selectedFile);
        });

        const upl = await fetch('/api/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: selectedFile.name, b64: dataUrl })
        });
        const uplj = await upl.json();
        if (!uplj?.success) return alert('Upload failed: ' + (uplj?.error || 'unknown'));
        fileUrl = uplj.data.fileUrl;
      }

      if (!fileUrl) return alert('Provide a file or URL');

      const payload = { ...newVersion, file_url: fileUrl };
      const res = await fetch(`/api/proposals/${proposal.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (j?.success) {
        setNewVersion({ version_label: '', file_url: '', original_name: '', uploaded_by: '', notes: '' });
        setSelectedFile(null);
        fetchVersions();
        alert('Version added');
      } else {
        alert('Failed to add version: ' + (j?.error || 'unknown'));
      }
    } catch (e) {
      console.error(e);
      alert('Failed to add version');
    }
  };

  const recordApproval = async (stage) => {
    try {
      if (!proposal?.id) return alert('Proposal not loaded');
      const res = await fetch(`/api/proposals/${proposal.id}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, changed_by: 'system', comment: approvalComment })
      });
      const j = await res.json();
      if (j?.success) {
        setApprovalComment('');
        await fetchApprovals();

        // refresh proposal to get updated approval_stage
  const prj = await fetchJSON(`/api/proposals/${proposal.id}`);
        if (prj?.success) setProposal(prj.data);
      } else {
        alert('Failed to record approval: ' + (j?.error || 'unknown'));
      }
    } catch (e) {
      console.error(e);
      alert('Failed to record approval');
    }
  };

  const getStatusColor = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'approved': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      case 'draft': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading proposal details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600">Proposal not found</p>
            <button
              onClick={() => router.push('/proposals')}
              className="mt-4 px-4 py-2 bg-accent-primary text-white rounded-md hover:bg-accent-primary/90"
            >
              Back to Proposals
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full px-8 pt-22">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => router.push('/proposals')}
                  className="p-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                </button>
                <div>
                  <div className="text-sm font-medium text-blue-600 mb-1">
                    Proposal ID: {proposal.proposal_id ?? proposal.id}
                  </div>
                  <h1 className="text-xl font-bold text-gray-900">
                    {proposal.title}
                  </h1>
                  <p className="text-gray-600 text-sm">{proposal.client}</p>
                  {linkedLead && (
                    <div className="text-sm mt-1">
                      <a href={`/leads/${linkedLead.id}/edit`} className="text-indigo-600 hover:underline">
                        Linked Lead: {linkedLead.company_name}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                {/* Quotation and Annexure Buttons */}
                <button
                  onClick={() => setShowQuotationForm(true)}
                  className="px-3 py-1.5 text-sm text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 transition-colors flex items-center space-x-1"
                >
                  <DocumentArrowDownIcon className="h-3 w-3" />
                  <span>Create Quotation</span>
                </button>
                
                <button
                  onClick={() => setShowAnnexureForm(true)}
                  className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                >
                  <PlusIcon className="h-3 w-3" />
                  <span>Create Annexure</span>
                </button>

                <button
                  onClick={() => {
                    try {
                      if (!proposal?.id) throw new Error('Proposal not loaded');
                      if (!proposal?.title) throw new Error('Proposal title is required');
                      if (!proposal?.client) throw new Error('Client is required in the proposal');

                      // Get company_id from linked lead if available
                      let companyId = linkedLead?.company_id || null;
                      if (!companyId && proposal?.company_id) companyId = proposal.company_id;
                      if (!companyId) {
                        alert('Company information is missing. Please ensure the proposal is linked to a lead with company details.');
                        return;
                      }

                      setConvertContext({ companyId });
                      setShowConvertConfirm(true);
                    } catch (err) {
                      console.error(err);
                      alert('Failed to create project: ' + (err.message || err));
                    }
                  }}
                  className="px-3 py-1.5 text-sm text-white bg-[#64126D] rounded-md hover:bg-[#86288F] transition-colors flex items-center space-x-1"
                >
                  <ArrowRightIcon className="h-3 w-3" />
                  <span>Convert to Project</span>
                </button>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(proposal.status)}`}>
                  {(proposal.status || 'draft').charAt(0).toUpperCase() + (proposal.status || 'draft').slice(1)}
                </span>

                {/* Convert confirmation modal */}
                {showConvertConfirm && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
                    <div className="bg-white rounded-lg shadow-lg w-[90%] max-w-md p-6">
                      <h3 className="text-lg font-semibold mb-2">Convert proposal to project</h3>
                      <p className="text-sm text-gray-700">Are you sure you want to convert <strong>{proposal?.title}</strong> to a project? This will create a project record and mark the proposal as converted.</p>
                      <div className="mt-4 flex justify-end space-x-2">
                        <button
                          onClick={() => setShowConvertConfirm(false)}
                          className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              setConvertLoading(true);
                              const res = await fetch(`/api/proposals/${proposal.id}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  start_date: new Date().toISOString().split('T')[0],
                                  budget: proposal.value || null,
                                  converted_by: undefined
                                })
                              });
                              const data = await res.json();
                              if (!res.ok) throw new Error(data?.error || 'Failed to convert proposal');
                              setShowConvertConfirm(false);
                              alert('Proposal converted to project. Redirecting...');
                              const proj = data?.data?.project;
                              const targetId = proj?.project_id ?? proj?.project_code ?? proj?.id;
                              if (!targetId) {
                                alert('Project created but no redirect id returned. Please open Projects list to view.');
                              } else {
                                router.push(`/projects/${targetId}/edit`);
                              }
                            } catch (err) {
                              console.error(err);
                              alert('Conversion failed: ' + (err.message || err));
                            } finally {
                              setConvertLoading(false);
                            }
                          }}
                          disabled={convertLoading}
                          className="px-3 py-1.5 text-sm text-white bg-[#64126D] rounded-md hover:bg-[#86288F]"
                        >
                          {convertLoading ? 'Converting...' : 'Convert'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {!isEditing ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                  >
                    <PencilIcon className="h-3 w-3" />
                    <span>Edit</span>
                  </button>
                ) : (
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                    >
                      <XMarkIcon className="h-3 w-3" />
                      <span>Cancel</span>
                    </button>
                    <button
                      onClick={handleSave}
                      className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-1"
                    >
                      <CheckIcon className="h-3 w-3" />
                      <span>Save</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="h-full overflow-y-auto pb-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Proposal Information */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <DocumentTextIcon className="h-5 w-5 mr-2" />
                  Proposal Details
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="title"
                        value={formData.title}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <p className="text-gray-900">{proposal.title}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
                    {isEditing ? (
                      <input
                        type="number"
                        name="value"
                        value={formData.value}
                        onChange={handleFormChange}
                        placeholder="0.00"
                        step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <p className="text-gray-900 text-xl font-semibold">
                        {proposal.value !== null && proposal.value !== undefined
                          ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
                              .format(Number(proposal.value) || 0)
                          : 'Not specified'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                    {isEditing ? (
                      <input
                        type="date"
                        name="due_date"
                        value={formData.due_date || ''}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <p className="text-gray-900">
                        {proposal.due_date ? new Date(proposal.due_date).toLocaleDateString() : 'Not set'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Created</label>
                    <p className="text-gray-900">
                      {proposal.created_at ? new Date(proposal.created_at).toLocaleDateString() : '—'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Client Information */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Client Information</h3>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                    <p className="text-gray-900">{proposal.client || '—'}</p>
                  </div>

                  {proposal.contact_name && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                      <p className="text-gray-900">{proposal.contact_name}</p>
                    </div>
                  )}

                  {proposal.contact_email && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <p className="text-gray-900">{proposal.contact_email}</p>
                    </div>
                  )}

                  {proposal.phone && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <p className="text-gray-900">{proposal.phone}</p>
                    </div>
                  )}

                  {proposal.city && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                      <p className="text-gray-900">{proposal.city}</p>
                    </div>
                  )}

                  {proposal.priority && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          proposal.priority === 'High'
                            ? 'bg-red-100 text-red-800'
                            : proposal.priority === 'Medium'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {proposal.priority}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Project Description */}
              {proposal.project_description && (
                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Project Description</h3>
                  <p className="text-gray-700 whitespace-pre-wrap">{proposal.project_description}</p>
                </div>
              )}

              {/* Notes */}
              <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Notes</h3>
                {isEditing ? (
                  <textarea
                    name="notes"
                    value={formData.notes}
                    onChange={handleFormChange}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Add notes about this proposal..."
                  />
                ) : (
                  <p className="text-gray-700 whitespace-pre-wrap">
                    {proposal.notes || 'No notes added yet.'}
                  </p>
                )}
              </div>

              {/* Annexure / Additional Details (display proposal fields if present) */}
              <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Annexure / Additional Details</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Scope of Work</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.scope_of_work || proposal.scope || proposal.annexure?.scopeOfWork || proposal.annexure?.scope || '—'
                    }</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Input Document</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.input_document || proposal.input_documents || proposal.annexure?.inputDocuments || proposal.annexure?.input_document || '—'
                    }</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Deliverables</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.deliverables || proposal.annexure?.deliverables || '—'
                    }</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Software</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.software || proposal.annexure?.software || '—'
                    }</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.duration || proposal.timeline || proposal.annexure?.duration || '—'
                    }</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Site Visit</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.site_visit || proposal.annexure?.siteVisit || proposal.annexure?.site_visit || '—'
                    }</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Quotation Validity</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.quotation_validity || proposal.annexure?.quotationValidity || proposal.annexure?.quotation_validity || '—'
                    }</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mode of Delivery</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.mode_of_delivery || proposal.annexure?.modeOfDelivery || proposal.annexure?.mode_of_delivery || '—'
                    }</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Revision</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.revision || proposal.annexure?.revision || '—'
                    }</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Exclusions</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.exclusions || proposal.annexure?.exclusions || '—'
                    }</p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Billing</label>
                    <p className="text-gray-700 whitespace-pre-wrap">{
                      proposal.billing || proposal.billing_and_payment || proposal.billingAndPayment || proposal.annexure?.billingAndPayment || '—'
                    }</p>
                  </div>
                </div>
              </div>
                {/* Scope / Commercials / Quotation / Meetings / Financial / Hours / Location (read-only mirrors of edit page) */}
                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Scope of Work</h3>
                  <div className="space-y-3">
                    <p className="text-gray-700 whitespace-pre-wrap">{proposal.scope_of_work || proposal.scope || proposal.project_description || '—'}</p>
                    {parsedPlanningActivities && parsedPlanningActivities.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 mt-2">Planned Activities</h4>
                        <ul className="mt-2 space-y-2">
                          {parsedPlanningActivities.map((pa, idx) => (
                            <li key={pa.id || idx} className="text-sm text-gray-700 border border-gray-100 rounded p-2 bg-gray-50">
                              <div className="font-medium">{pa.activity || pa.activity_description || `Activity ${idx+1}`}</div>
                              <div className="text-xs text-gray-500">{pa.start_date || pa.start || ''} → {pa.end_date || pa.end || ''}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {parsedDocumentsList && parsedDocumentsList.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 mt-2">Attached Documents</h4>
                        <ul className="mt-2 space-y-2">
                          {parsedDocumentsList.map((d, i) => (
                            <li key={d.id || i} className="text-sm text-gray-700">
                              {d.name || d.document_name || `Doc ${i+1}`} {d.remarks ? `— ${d.remarks}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Commercials</h3>
                  <div className="overflow-x-auto">
                    {parsedCommercialItems && parsedCommercialItems.length > 0 ? (
                      <table className="w-full text-sm text-left">
                        <thead>
                          <tr className="text-xs text-gray-500">
                            <th className="px-3 py-2">Sr. No</th>
                            <th className="px-3 py-2">Activity</th>
                            <th className="px-3 py-2">Manhours</th>
                            <th className="px-3 py-2">Rate</th>
                            <th className="px-3 py-2">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedCommercialItems.map((c, i) => (
                            <tr key={c.id || i} className="border-t border-gray-100">
                              <td className="px-3 py-2 align-top">{c.sr_no || i+1}</td>
                              <td className="px-3 py-2 align-top">{c.activities || c.scope_of_work || c.activity || '—'}</td>
                              <td className="px-3 py-2 align-top">{c.man_hours ?? c.manhours ?? '—'}</td>
                              <td className="px-3 py-2 align-top">{c.man_hour_rate ?? c.rate ?? '—'}</td>
                              <td className="px-3 py-2 align-top">{c.total_amount ?? c.amount ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-gray-500">No commercial items added.</p>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Quotation & Terms</h3>
                  <div className="space-y-3">
                    <div><span className="text-sm text-gray-500">Quotation No:</span> <span className="text-sm text-gray-900">{proposal.quotation_number || '—'}</span></div>
                    <div><span className="text-sm text-gray-500">Quotation Date:</span> <span className="text-sm text-gray-900">{proposal.quotation_date || '—'}</span></div>
                    <div><span className="text-sm text-gray-500">Enquiry No:</span> <span className="text-sm text-gray-900">{proposal.enquiry_number || '—'}</span></div>
                    <div><span className="text-sm text-gray-500">Enquiry Date:</span> <span className="text-sm text-gray-900">{proposal.enquiry_date || '—'}</span></div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mt-2">Billing & Payment Terms</h4>
                      <p className="text-gray-700 whitespace-pre-wrap">{proposal.billing || proposal.billing_and_payment || proposal.billing_payment_terms || proposal.billing_payment || proposal.billingAndPayment || '—'}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Meetings</h3>
                  <div className="space-y-3">
                    <div><span className="text-sm text-gray-500">Kickoff Meeting:</span> <span className="text-sm text-gray-900">{proposal.kickoff_meeting || '—'}</span></div>
                    <div><span className="text-sm text-gray-500">Kickoff Date:</span> <span className="text-sm text-gray-900">{proposal.kickoff_meeting_date || '—'}</span></div>
                    <div><span className="text-sm text-gray-500">Internal Meeting:</span> <span className="text-sm text-gray-900">{proposal.in_house_meeting || proposal.internal_meeting_date || '—'}</span></div>
                    <div><span className="text-sm text-gray-500">Next Internal Meeting:</span> <span className="text-sm text-gray-900">{proposal.next_internal_meeting || '—'}</span></div>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Financials</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gray-50 border border-gray-100 rounded p-3">
                      <p className="text-xs text-gray-500">Budget</p>
                      <p className="text-sm font-medium text-gray-900">{proposal.budget ?? '—'}</p>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded p-3">
                      <p className="text-xs text-gray-500">Cost to Company</p>
                      <p className="text-sm font-medium text-gray-900">{proposal.cost_to_company ?? '—'}</p>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded p-3">
                      <p className="text-xs text-gray-500">Profitability %</p>
                      <p className="text-sm font-medium text-gray-900">{proposal.profitability_estimate ?? '—'}</p>
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-gray-700">
                    <p><strong>Major Risks:</strong> {proposal.major_risks || '—'}</p>
                    <p className="mt-1"><strong>Mitigation:</strong> {proposal.mitigation_plans || '—'}</p>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Hours & Productivity</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gray-50 border border-gray-100 rounded p-3">
                      <p className="text-xs text-gray-500">Planned Hours Total</p>
                      <p className="text-sm font-medium text-gray-900">{proposal.planned_hours_total ?? '—'}</p>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded p-3">
                      <p className="text-xs text-gray-500">Actual Hours Total</p>
                      <p className="text-sm font-medium text-gray-900">{proposal.actual_hours_total ?? '—'}</p>
                    </div>
                  </div>
                  {parsedPlannedHoursByDiscipline && Object.keys(parsedPlannedHoursByDiscipline).length > 0 && (
                    <div className="mt-3">
                      <h4 className="text-sm font-semibold text-gray-900">Planned Hours by Discipline</h4>
                      <ul className="mt-2 text-sm text-gray-700">
                        {Object.entries(parsedPlannedHoursByDiscipline).map(([k,v]) => (
                          <li key={k}>{k}: {v}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Location</h3>
                  <div className="space-y-2 text-sm text-gray-700">
                    <p><strong>Country:</strong> {proposal.project_location_country || '—'}</p>
                    <p><strong>City:</strong> {proposal.project_location_city || '—'}</p>
                    <p><strong>Site:</strong> {proposal.project_location_site || '—'}</p>
                  </div>
                </div>

                {/* Versions */}
              <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Versions</h3>
                <div className="space-y-3">
                  {versions.length === 0 ? (
                    <p className="text-sm text-gray-500">No versions uploaded yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {versions.map(v => (
                        <li key={v.id} className="flex items-center justify-between">
                          <div>
                            <a
                              href={v.file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 hover:underline"
                            >
                              {v.version_label || 'Version'}
                            </a>
                            <div className="text-xs text-gray-500">
                              {v.original_name} • {v.created_at ? new Date(v.created_at).toLocaleString() : '—'}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                    <input
                      placeholder="Version label (v1, v2)"
                      value={newVersion.version_label}
                      onChange={(e) => setNewVersion(prev => ({ ...prev, version_label: e.target.value }))}
                      className="px-3 py-2 border rounded"
                    />
                    <input
                      placeholder="File URL (publicly accessible)"
                      value={newVersion.file_url}
                      onChange={(e) => setNewVersion(prev => ({ ...prev, file_url: e.target.value }))}
                      className="px-3 py-2 border rounded col-span-2"
                    />
                    <input
                      placeholder="Original filename"
                      value={newVersion.original_name}
                      onChange={(e) => setNewVersion(prev => ({ ...prev, original_name: e.target.value }))}
                      className="px-3 py-2 border rounded"
                    />
                    <input type="file" onChange={handleFileSelect} className="col-span-3" />
                    <input
                      placeholder="Uploaded by"
                      value={newVersion.uploaded_by}
                      onChange={(e) => setNewVersion(prev => ({ ...prev, uploaded_by: e.target.value }))}
                      className="px-3 py-2 border rounded"
                    />
                    <input
                      placeholder="Notes"
                      value={newVersion.notes}
                      onChange={(e) => setNewVersion(prev => ({ ...prev, notes: e.target.value }))}
                      className="px-3 py-2 border rounded col-span-2"
                    />
                    <div className="col-span-3 text-right">
                      <button onClick={addVersion} className="px-3 py-1 bg-accent-primary text-white rounded">
                        Add Version
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Approvals */}
              <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Approval Workflow</h3>
                <div className="space-y-3">
                  <div className="text-sm text-gray-700">
                    Current Stage: <strong>{proposal.approval_stage || 'Not set'}</strong>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => recordApproval('Draft')} className="px-3 py-1 bg-gray-200 rounded">Set Draft</button>
                    <button onClick={() => recordApproval('Reviewed')} className="px-3 py-1 bg-yellow-100 rounded">Mark Reviewed</button>
                    <button onClick={() => recordApproval('Approved')} className="px-3 py-1 bg-green-100 rounded">Approve</button>
                    <button onClick={() => recordApproval('Sent')} className="px-3 py-1 bg-blue-100 rounded">Mark Sent</button>
                  </div>
                  <div>
                    <textarea
                      placeholder="Approval comment (optional)"
                      value={approvalComment}
                      onChange={(e) => setApprovalComment(e.target.value)}
                      className="w-full px-3 py-2 border rounded"
                    />
                  </div>

                  <div>
                    <h4 className="text-sm font-medium">Approval History</h4>
                    {approvals.length === 0 ? (
                      <p className="text-sm text-gray-500">No approvals recorded yet.</p>
                    ) : (
                      <ul className="space-y-2 mt-2">
                        {approvals.map(a => (
                          <li key={a.id} className="text-sm text-gray-700">
                            <div className="font-medium">{a.stage}</div>
                            <div className="text-xs text-gray-500">
                              by {a.changed_by || 'unknown'} on {a.created_at ? new Date(a.created_at).toLocaleString() : '—'}
                            </div>
                            {a.comment && <div className="mt-1 text-gray-600">{a.comment}</div>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
              {/* End Approvals */}
            </div>
          </div>
        </div>
      </div>

      {/* Quotation and Annexure Tabs Modal */}
      {(showQuotationForm || showAnnexureForm) && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={() => {
              setShowQuotationForm(false);
              setShowAnnexureForm(false);
            }}></div>
            
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-7xl sm:w-full">
              <div className="bg-white px-6 pt-6 pb-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Professional Document Generator</h3>
                  <button
                    onClick={() => {
                      setShowQuotationForm(false);
                      setShowAnnexureForm(false);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                {/* Tab Navigation */}
                <div className="border-b border-gray-200 mb-6">
                  <nav className="-mb-px flex space-x-8">
                    <button
                      onClick={() => {
                        setShowQuotationForm(true);
                        setShowAnnexureForm(false);
                      }}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        showQuotationForm 
                          ? 'border-accent-primary text-accent-primary' 
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      Professional Quotation
                    </button>
                    <button
                      onClick={() => {
                        setShowQuotationForm(false);
                        setShowAnnexureForm(true);
                      }}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        showAnnexureForm 
                          ? 'border-accent-primary text-accent-primary' 
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      Project Annexure
                    </button>
                  </nav>
                </div>

                <div className="max-h-[70vh] overflow-y-auto">
                  {/* Quotation Tab Content */}
                  {showQuotationForm && (
                    <div id="quotation-content" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    
                    {/* Client Information */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="text-md font-semibold text-gray-900 mb-3">Client Information</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Client Name</label>
                          <input
                            type="text"
                            value={quotationData.client.name}
                            onChange={(e) => handleQuotationChange('client', 'name', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter client name"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                          <textarea
                            value={quotationData.client.address}
                            onChange={(e) => handleQuotationChange('client', 'address', e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter client address"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                          <input
                            type="text"
                            value={quotationData.client.contactPerson}
                            onChange={(e) => handleQuotationChange('client', 'contactPerson', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter contact person name"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
                          <input
                            type="text"
                            value={quotationData.client.designation}
                            onChange={(e) => handleQuotationChange('client', 'designation', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter designation"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Quotation Details */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="text-md font-semibold text-gray-900 mb-3">Quotation Details</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Quotation Number</label>
                          <input
                            type="text"
                            value={quotationData.quotation.number}
                            onChange={(e) => handleQuotationChange('quotation', 'number', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter quotation number"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                          <input
                            type="date"
                            value={quotationData.quotation.date}
                            onChange={(e) => handleQuotationChange('quotation', 'date', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Enquiry Number</label>
                          <input
                            type="text"
                            value={quotationData.quotation.enquiryNo}
                            onChange={(e) => handleQuotationChange('quotation', 'enquiryNo', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter enquiry number"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Enquiry Date</label>
                          <input
                            type="date"
                            value={quotationData.quotation.enquiryDate}
                            onChange={(e) => handleQuotationChange('quotation', 'enquiryDate', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Work Items Table */}
                    <div className="lg:col-span-2 bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-md font-semibold text-gray-900">Work Items</h4>
                        <button
                          onClick={addWorkItem}
                          className="px-3 py-1 text-sm bg-accent-primary text-white rounded-md hover:bg-accent-primary/90 flex items-center space-x-1"
                        >
                          <PlusIcon className="h-4 w-4" />
                          <span>Add Item</span>
                        </button>
                      </div>
                      
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                          <thead>
                            <tr className="bg-gray-100">
                              <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium">Scope of Work</th>
                              <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium">Qty</th>
                              <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium">Rate</th>
                              <th className="border border-gray-300 px-3 py-2 text-left text-sm font-medium">Amount</th>
                              <th className="border border-gray-300 px-3 py-2 text-center text-sm font-medium">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {quotationData.work.map((item, index) => (
                              <tr key={index}>
                                <td className="border border-gray-300 px-3 py-2">
                                  <textarea
                                    value={item.scope}
                                    onChange={(e) => updateWorkItem(index, 'scope', e.target.value)}
                                    className="w-full px-2 py-1 border-none resize-none focus:ring-2 focus:ring-accent-primary"
                                    rows={2}
                                    placeholder="Describe work scope"
                                  />
                                </td>
                                <td className="border border-gray-300 px-3 py-2">
                                  <input
                                    type="number"
                                    value={item.qty}
                                    onChange={(e) => updateWorkItem(index, 'qty', e.target.value)}
                                    className="w-full px-2 py-1 border-none focus:ring-2 focus:ring-accent-primary"
                                    placeholder="0"
                                  />
                                </td>
                                <td className="border border-gray-300 px-3 py-2">
                                  <input
                                    type="number"
                                    value={item.rate}
                                    onChange={(e) => updateWorkItem(index, 'rate', e.target.value)}
                                    className="w-full px-2 py-1 border-none focus:ring-2 focus:ring-accent-primary"
                                    placeholder="0.00"
                                  />
                                </td>
                                <td className="border border-gray-300 px-3 py-2 text-right font-medium">
                                  ₹{item.amount.toFixed(2)}
                                </td>
                                <td className="border border-gray-300 px-3 py-2 text-center">
                                  {quotationData.work.length > 1 && (
                                    <button
                                      onClick={() => removeWorkItem(index)}
                                      className="text-red-600 hover:text-red-800"
                                    >
                                      <TrashIcon className="h-4 w-4" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-gray-100 font-semibold">
                              <td colSpan={3} className="border border-gray-300 px-3 py-2 text-right">Total Amount:</td>
                              <td className="border border-gray-300 px-3 py-2 text-right">₹{calculateTotal().toFixed(2)}</td>
                              <td className="border border-gray-300"></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>

                    {/* Amount in Words */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="text-md font-semibold text-gray-900 mb-3">Amount</h4>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Amount in Words</label>
                        <input
                          type="text"
                          value={quotationData.amount.inWords}
                          onChange={(e) => handleQuotationChange('amount', 'inWords', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="Enter amount in words"
                        />
                      </div>
                    </div>

                    {/* Registration Numbers */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="text-md font-semibold text-gray-900 mb-3">Registration Details</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">GST Number</label>
                          <input
                            type="text"
                            value={quotationData.registration.gst}
                            onChange={(e) => handleQuotationChange('registration', 'gst', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter GST number"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">PAN Number</label>
                          <input
                            type="text"
                            value={quotationData.registration.pan}
                            onChange={(e) => handleQuotationChange('registration', 'pan', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter PAN number"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">TAN Number</label>
                          <input
                            type="text"
                            value={quotationData.registration.tan}
                            onChange={(e) => handleQuotationChange('registration', 'tan', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter TAN number"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Terms & Conditions */}
                    <div className="lg:col-span-2 bg-gray-50 rounded-lg p-4">
                      <h4 className="text-md font-semibold text-gray-900 mb-3">Terms & Conditions</h4>
                      <textarea
                        value={quotationData.terms}
                        onChange={(e) => setQuotationData(prev => ({ ...prev, terms: e.target.value }))}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        placeholder="Enter terms and conditions"
                      />
                    </div>

                    {/* Payment Details */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="text-md font-semibold text-gray-900 mb-3">Payment Details</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Advance Payment</label>
                          <input
                            type="text"
                            value={quotationData.payment.advance}
                            onChange={(e) => handleQuotationChange('payment', 'advance', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter advance payment details"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Balance Payment</label>
                          <input
                            type="text"
                            value={quotationData.payment.balance}
                            onChange={(e) => handleQuotationChange('payment', 'balance', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter balance payment details"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Bank Details</label>
                          <textarea
                            value={quotationData.payment.bankDetails}
                            onChange={(e) => handleQuotationChange('payment', 'bankDetails', e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Enter bank details"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Signature Section */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="text-md font-semibold text-gray-900 mb-3">Signature</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                          <input
                            type="text"
                            value={quotationData.signature.name}
                            onChange={(e) => handleQuotationChange('signature', 'name', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Signatory name"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
                          <input
                            type="text"
                            value={quotationData.signature.designation}
                            onChange={(e) => handleQuotationChange('signature', 'designation', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            placeholder="Designation"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                          <input
                            type="date"
                            value={quotationData.signature.date}
                            onChange={(e) => handleQuotationChange('signature', 'date', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          />
                        </div>
                      </div>
                    </div>
                    </div>
                  )}

                  {/* Annexure Tab Content */}
                  {showAnnexureForm && (
                    <div id="annexure-content" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Project Name *</label>
                        <input
                          type="text"
                          value={annexureData.projectName}
                          onChange={(e) => handleAnnexureChange('projectName', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="Enter project name"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Client Name *</label>
                        <input
                          type="text"
                          value={annexureData.clientName}
                          onChange={(e) => handleAnnexureChange('clientName', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="Enter client name"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Project Type *</label>
                        <select
                          value={annexureData.projectType}
                          onChange={(e) => handleAnnexureChange('projectType', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          required
                        >
                          <option value="">Select project type</option>
                          <option value="Web Development">Web Development</option>
                          <option value="Mobile App">Mobile App</option>
                          <option value="Software Development">Software Development</option>
                          <option value="Consulting">Consulting</option>
                          <option value="Design">Design</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Timeline *</label>
                        <input
                          type="text"
                          value={annexureData.timeline}
                          onChange={(e) => handleAnnexureChange('timeline', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="e.g., 3 months, 6 weeks"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Budget *</label>
                        <input
                          type="text"
                          value={annexureData.budget}
                          onChange={(e) => handleAnnexureChange('budget', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="Enter budget range"
                          required
                        />
                      </div>

                      <div className="lg:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Scope of Work *</label>
                        <textarea
                          value={annexureData.scope}
                          onChange={(e) => handleAnnexureChange('scope', e.target.value)}
                          rows={4}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="Detailed description of work scope"
                          required
                        />
                      </div>

                      <div className="lg:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Deliverables *</label>
                        <textarea
                          value={annexureData.deliverables}
                          onChange={(e) => handleAnnexureChange('deliverables', e.target.value)}
                          rows={4}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="List of expected deliverables"
                          required
                        />
                      </div>

                      <div className="lg:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Milestones *</label>
                        <textarea
                          value={annexureData.milestones}
                          onChange={(e) => handleAnnexureChange('milestones', e.target.value)}
                          rows={4}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="Key project milestones and timelines"
                          required
                        />
                      </div>

                      <div className="lg:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Risk Factors *</label>
                        <textarea
                          value={annexureData.riskFactors}
                          onChange={(e) => handleAnnexureChange('riskFactors', e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="Potential risks and mitigation strategies"
                          required
                        />
                      </div>

                      <div className="lg:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Assumptions *</label>
                        <textarea
                          value={annexureData.assumptions}
                          onChange={(e) => handleAnnexureChange('assumptions', e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="Key assumptions made for this project"
                          required
                        />
                      </div>

                      <div className="lg:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Additional Notes</label>
                        <textarea
                          value={annexureData.additionalNotes}
                          onChange={(e) => handleAnnexureChange('additionalNotes', e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          placeholder="Any additional notes or special requirements"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-between items-center">
                  <div className="flex space-x-3">
                    <button
                      onClick={() => {
                        setShowQuotationForm(false);
                        setShowAnnexureForm(false);
                      }}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={showQuotationForm ? resetQuotationForm : resetAnnexureForm}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Reset
                    </button>
                  </div>
                  
                  <div className="flex space-x-3">
                    <button
                      onClick={generatePDF}
                      disabled={isSubmitting}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center space-x-1"
                    >
                      <DocumentArrowDownIcon className="h-4 w-4" />
                      <span>Generate PDF</span>
                    </button>
                    <button
                      onClick={showQuotationForm ? submitQuotation : submitAnnexure}
                      disabled={isSubmitting}
                      className="px-4 py-2 text-sm font-medium text-white bg-accent-primary rounded-md hover:bg-accent-primary/90 disabled:opacity-50"
                    >
                      {isSubmitting ? 'Saving...' : showQuotationForm ? 'Save Quotation' : 'Save Annexure'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}