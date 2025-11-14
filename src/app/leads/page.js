'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  PlusIcon, 
  UserGroupIcon,
  PhoneIcon,
  EnvelopeIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  StarIcon,
  MagnifyingGlassIcon,
  DocumentArrowUpIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FunnelIcon
} from '@heroicons/react/24/outline';

export default function Leads() {
  const router = useRouter();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [sortBy, setSortBy] = useState('enquiry_date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState('list');
  const [companies, setCompanies] = useState([]);
  const [showImport, setShowImport] = useState(false);
  // follow-ups are managed within the individual lead edit page; removed global follow-ups state
  const [formData, setFormData] = useState({
    lead_id: '',
    company_id: '',
    company_name: '',
    designation: '',
    contact_name: '',
    inquiry_email: '',
    cc_emails: '',
    phone: '',
    city: '',
    project_description: '',
    enquiry_type: 'Email',
    enquiry_status: 'Under Discussion',
    enquiry_date: new Date().toISOString().split('T')[0],
    lead_source: 'Website',
    priority: 'Medium',
    notes: '',
    // First follow-up fields
    first_followup_date: '',
    first_followup_type: 'Call',
    first_followup_description: '',
    first_followup_notes: ''
  });
  const fileInputRef = useRef(null);
  const searchDebounceRef = useRef(null);

  // Robust JSON handling helpers to avoid SyntaxError when server returns HTML/text (e.g., Internal Server Error)
  const parseJSONSafe = async (response) => {
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      }
      // Fallback to text and surface as error
      const text = await response.text();
      throw new Error(text?.slice(0, 200) || `HTTP ${response.status}`);
    } catch (e) {
      // If JSON parsing itself fails, propagate a readable error
      if (e instanceof SyntaxError) {
        throw new Error('Received a non-JSON response from server');
      }
      throw e;
    }
  };

  const fetchJSON = async (url, options) => {
    const res = await fetch(url, options);
    const data = await parseJSONSafe(res);
    if (!res.ok || data?.success === false) {
      const errMsg = data?.error || data?.message || `Request failed (${res.status})`;
      const details = data?.details;
      throw new Error(details ? `${errMsg}: ${details}` : errMsg);
    }
    return data;
  };

  const fetchLeads = async (searchOverride) => {
    try {
      setLoading(true);
      const searchValue = typeof searchOverride !== 'undefined' ? searchOverride : debouncedSearchTerm;
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
        sortBy: sortBy,
        sortOrder: sortOrder,
        ...(searchValue && { search: searchValue }),
        ...(statusFilter && { status: statusFilter }),
        ...(cityFilter && { city: cityFilter })
      });

      const result = await fetchJSON(`/api/leads?${params}`);
      
      if (result.success) {
        setLeads(result.data.leads);
        setStats(result.data.stats);
      }
    } catch (error) {
      console.error('Error fetching leads:', error);
      // Ensure UI remains consistent on failure
      setLeads([]);
      setStats({});
    } finally {
      setLoading(false);
    }
  };

  // follow-up operations are handled in the Edit Lead page

  const fetchCompanies = async () => {
    try {
      const result = await fetchJSON('/api/companies');
      
      if (result.success) {
        setCompanies(result.data);
      }
    } catch (error) {
      console.error('Error fetching companies:', error);
    }
  };

  useEffect(() => {
    fetchCompanies(); // Fetch companies on component mount
    if (activeTab === 'list') {
      fetchLeads();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, debouncedSearchTerm, statusFilter, cityFilter, sortBy, sortOrder, activeTab]);

  // Debounce searchTerm so we don't fire a request on every keystroke
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setCurrentPage(1); // reset to first page on new search
      setDebouncedSearchTerm(searchTerm.trim());
    }, 350);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchTerm]);

  const clearFilters = () => {
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setStatusFilter('');
    setCityFilter('');
    setSortBy('enquiry_date');
    setSortOrder('desc');
    setCurrentPage(1);
  };

  // fetchFollowUps removed — follow-ups are displayed/managed per-lead in the Edit Lead page

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await fetchJSON('/api/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      
      if (result.success) {
        const newLeadId = result.data?.id;
        
        // Create first follow-up if provided
        if (newLeadId && formData.first_followup_date && formData.first_followup_description) {
          try {
            await fetchJSON('/api/followups', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lead_id: newLeadId,
                follow_up_date: formData.first_followup_date,
                follow_up_type: formData.first_followup_type || 'Call',
                description: formData.first_followup_description,
                notes: formData.first_followup_notes || null,
                status: 'Scheduled'
              })
            });
          } catch (followUpError) {
            console.warn('Lead created but follow-up creation failed:', followUpError);
          }
        }
        
        // Reset form
        setFormData({
          lead_id: '',
          company_id: '',
          company_name: '',
          designation: '',
          contact_name: '',
          inquiry_email: '',
          cc_emails: '',
          phone: '',
          city: '',
          project_description: '',
          enquiry_type: 'Email',
          enquiry_status: 'Under Discussion',
          enquiry_date: new Date().toISOString().split('T')[0],
          lead_source: 'Website',
          priority: 'Medium',
          notes: '',
          // First follow-up fields
          first_followup_date: '',
          first_followup_type: 'Call',
          first_followup_description: '',
          first_followup_notes: ''
        });
        // Switch back to list view and refresh
        setActiveTab('list');
        fetchLeads();
        alert('Lead created successfully!');
      } else {
        alert('Error creating lead: ' + (result.error || 'Unknown error') + (result.details ? '\nDetails: ' + result.details : ''));
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error creating lead: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleCompanyChange = (e) => {
    const selectedCompanyId = e.target.value;
    const selectedCompany = companies.find(company => company.id.toString() === selectedCompanyId);
    
    setFormData(prev => ({
      ...prev,
      company_id: selectedCompanyId,
      company_name: selectedCompany ? selectedCompany.company_name : ''
    }));
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'awarded': return 'bg-green-100 text-green-800';
      case 'under discussion': return 'bg-blue-100 text-blue-800';
      case 'awaiting': return 'bg-yellow-100 text-yellow-800';
      case 'regretted': return 'bg-red-100 text-red-800';
      case 'close': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'text-red-500';
      case 'medium': return 'text-yellow-500';
      case 'low': return 'text-green-500';
      default: return 'text-gray-500';
    }
  };

  // Handle lead deletion
  const handleDeleteLead = async (leadId, companyName) => {
    if (!confirm(`Are you sure you want to delete the lead for "${companyName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const result = await fetchJSON(`/api/leads/${leadId}`, {
        method: 'DELETE',
      });
      
      if (result.success) {
        alert('Lead deleted successfully!');
        fetchLeads(); // Refresh the leads list
      } else {
        alert('Error deleting lead: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error deleting lead: ' + error.message);
    }
  };

  const convertToProposal = async (lead) => {
    // Prevent converting if already converted
    if (lead.enquiry_status === 'Converted to Proposal') {
      alert('This lead has already been converted to a proposal.');
      return;
    }
    
    if (!confirm(`Convert lead for "${lead.company_name}" to a proposal?`)) return;

    try {
      // Build proposal payload from lead
      const payload = {
        title: lead.project_description ? `${lead.company_name} - ${lead.project_description.slice(0, 60)}` : `Proposal for ${lead.company_name}`,
        client: lead.company_name,
        contact_name: lead.contact_name || null,
        contact_email: lead.contact_email || null,
        phone: lead.phone || null,
        project_description: lead.project_description || null,
        city: lead.city || null,
        priority: lead.priority || 'Medium',
        value: null,
        status: 'pending',
        due_date: null,
        notes: lead.notes || null
      };

      const result = await fetchJSON('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, lead_id: lead.id })
      });
      if (!result.success) {
        alert('Failed to create proposal: ' + (result.error || 'Unknown'));
        return;
      }

      // Update lead status to Converted to Proposal
      // Ensure enquiry_date is in YYYY-MM-DD format (MySQL DATE) to avoid invalid value errors
      let formattedEnquiryDate = null;
      if (lead.enquiry_date) {
        try {
          // If it's an ISO datetime, convert to YYYY-MM-DD
          const d = new Date(lead.enquiry_date);
          if (!isNaN(d.getTime())) {
            formattedEnquiryDate = d.toISOString().split('T')[0];
          } else if (typeof lead.enquiry_date === 'string' && lead.enquiry_date.includes('T')) {
            formattedEnquiryDate = lead.enquiry_date.split('T')[0];
          } else {
            formattedEnquiryDate = lead.enquiry_date;
          }
        } catch {
          formattedEnquiryDate = null;
        }
      }

      const updateBody = {
        company_name: lead.company_name,
        contact_name: lead.contact_name || null,
        contact_email: lead.contact_email || null,
        phone: lead.phone || null,
        city: lead.city || null,
        project_description: lead.project_description || null,
        enquiry_type: lead.enquiry_type || 'Email',
        enquiry_status: 'Converted to Proposal',
        enquiry_date: formattedEnquiryDate,
        lead_source: lead.lead_source || null,
        priority: lead.priority || 'Medium',
        notes: lead.notes || null
      };

      const updResult = await fetchJSON(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody)
      });
      if (!updResult.success) {
        alert('Proposal created but failed to update lead status: ' + (updResult.error || 'Unknown'));
      } else {
  const createdId = result.data && result.data.id;
  // support multiple shapes returned by API
  const proposalId = result.data && (result.data.proposal_id || result.data.proposalId || (result.data.proposal && (result.data.proposal.proposal_id || result.data.proposal.proposalId)));
        // Redirect to proposal edit page if available
        if (createdId) {
          // navigate to the proposal edit page. Include the generated proposal_id as a query param so the edit page can display it immediately while the server fetch completes.
          const qp = proposalId ? `?pid=${encodeURIComponent(proposalId)}` : '';
          router.push(`/proposals/${createdId}/edit${qp}`);
        } else {
          alert('Proposal created: ' + (proposalId || ('ID ' + (result.data && result.data.id))));
          fetchLeads();
        }
      }
    } catch (error) {
      console.error('Error converting lead:', error);
      alert('Error converting lead to proposal: ' + error.message);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  // Handle CSV file upload
  const handleCsvUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please upload a valid CSV file (.csv)');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      setUploading(true);
      const result = await fetchJSON('/api/leads/import', {
        method: 'POST',
        body: formData,
      });
      if (result.success) {
        alert(`Successfully imported ${result.imported} leads!`);
        fetchLeads(); // Refresh the leads list
        fileInputRef.current.value = ''; // Clear file input
      } else {
        alert('Error importing leads: ' + result.error);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Error uploading file: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    // Create CSV template
  const csvContent = `Company Name,Contact Name,Designation,Contact Email,Phone,City,Project Description,Enquiry Type,Enquiry Status,Enquiry Date,Lead Source,Priority,Notes
Example Corp,John Smith,Sales Manager,john@example.com,+91 9876543210,Mumbai,Website Development,Email,Under Discussion,2025-09-19,Website,High,Sample lead data`;
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const renderLeadsList = () => (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <span className="h-10 w-10 rounded-full bg-[#64126D] border border-purple-200 flex items-center justify-center text-white shadow-sm">
              <UserGroupIcon className="h-5 w-5" />
            </span>
            <div className="ml-4">
              <p className="text-sm font-medium text-black">Total Leads</p>
              <p className="text-2xl font-semibold text-gray-900">
                {stats.total_leads || 0}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <StarIcon className="h-8 w-8 text-blue-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-black">Active Leads</p>
              <p className="text-2xl font-semibold text-gray-900">
                {stats.active_leads || 0}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <ArrowRightIcon className="h-8 w-8 text-green-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-black">Won Leads</p>
              <p className="text-2xl font-semibold text-gray-900">
                {stats.won_leads || 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Import Section (Collapsible) */}
      <div className="bg-white rounded-lg border border-gray-200">
        <button
          type="button"
          onClick={() => setShowImport((s) => !s)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <DocumentArrowUpIcon className="h-5 w-5 text-accent-purple" />
            <h3 className="text-base font-medium text-gray-900">Import Leads</h3>
            <span className="ml-2 text-xs text-gray-500">CSV template supported</span>
          </div>
          {showImport ? (
            <ChevronUpIcon className="h-5 w-5 text-gray-500" />
          ) : (
            <ChevronDownIcon className="h-5 w-5 text-gray-500" />
          )}
        </button>
        {showImport && (
          <div className="px-4 pb-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={downloadTemplate}
                className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors"
              >
                <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                Download Template
              </button>
              
              <label className="inline-flex items-center justify-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors cursor-pointer">
                <DocumentArrowUpIcon className="h-4 w-4 mr-2" />
                {uploading ? 'Uploading...' : 'Import Excel/CSV'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCsvUpload}
                  className="hidden"
                  disabled={uploading}
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search leads by company, contact, or project..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // flush debounce and trigger search immediately
                    if (searchDebounceRef.current) {
                      clearTimeout(searchDebounceRef.current);
                    }
                    setDebouncedSearchTerm(searchTerm.trim());
                    setCurrentPage(1);
                    fetchLeads(searchTerm.trim());
                  }
                }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
              />
            </div>
          </div>
          
          <div className="sm:w-48">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            >
              <option value="">All Status</option>
              <option value="Under Discussion">Under Discussion</option>
              <option value="Awarded">Awarded</option>
              <option value="Regretted">Regretted</option>
              <option value="Awaiting">Awaiting</option>
              <option value="Close">Close</option>
            </select>
          </div>
          
          <div className="sm:w-32">
            <select
              value={cityFilter}
              onChange={(e) => { setCityFilter(e.target.value); setCurrentPage(1); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            >
              <option value="">All Cities</option>
              <option value="Mumbai">Mumbai</option>
              <option value="Delhi">Delhi</option>
              <option value="Pune">Pune</option>
              <option value="Gujarat">Gujarat</option>
              <option value="Kolkata">Kolkata</option>
            </select>
          </div>

          <div className="sm:w-48">
            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [field, order] = e.target.value.split('-');
                setSortBy(field);
                setSortOrder(order);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent"
            >
              <option value="enquiry_date-desc">Date: Newest First</option>
              <option value="enquiry_date-asc">Date: Oldest First</option>
              <option value="created_at-desc">Recently Added</option>
              <option value="company_name-asc">Company A-Z</option>
              <option value="company_name-desc">Company Z-A</option>
              <option value="enquiry_status-asc">Status A-Z</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={clearFilters}
              className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50"
            >
              <FunnelIcon className="h-4 w-4 mr-1 text-gray-500" />
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Leads Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-accent-purple"></div>
            <p className="mt-2 text-gray-600">Loading leads...</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="p-8 text-center">
            <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No leads found</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by adding leads manually or importing from Excel.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/75">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Lead ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Sr
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Company & Contact
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Project Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Status & Priority
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Date & Source
                  </th>
                  <th className="relative px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {leads.map((lead, index) => (
                  <tr key={lead.id} className="hover:bg-gray-50 odd:bg-white even:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-mono font-medium text-gray-900">
                        {lead.lead_id || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {(currentPage - 1) * 20 + index + 1}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap max-w-sm">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {lead.company_name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {lead.contact_name}
                        </div>
                        {lead.designation && (
                          <div className="text-xs text-gray-400">
                            {lead.designation}
                          </div>
                        )}
                        <div className="flex items-center mt-1 space-x-3">
                          {lead.contact_email && (
                            <div className="flex items-center text-xs text-gray-400">
                              <EnvelopeIcon className="h-3 w-3 mr-1" />
                              <span className="truncate max-w-[9rem]">{lead.contact_email}</span>
                            </div>
                          )}
                          {lead.phone && (
                            <div className="flex items-center text-xs text-gray-400">
                              <PhoneIcon className="h-3 w-3 mr-1" />
                              {lead.phone}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 max-w-xs">
                        <div className="truncate font-medium">
                          {lead.project_description || 'No description'}
                        </div>
                        <div className="text-sm text-gray-500 mt-1">
                          <span className="inline-block mr-2">{lead.city}</span>
                          {lead.enquiry_type && (
                            <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">
                              {lead.enquiry_type}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-2">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(lead.enquiry_status)}`}>
                          {lead.enquiry_status}
                        </span>
                        <div className={`text-xs font-medium ${getPriorityColor(lead.priority)}`}>
                          {lead.priority} Priority
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500 space-y-1">
                        <div>{formatDate(lead.enquiry_date)}</div>
                        {lead.lead_source && (
                          <div className="text-xs text-gray-400">
                            via {lead.lead_source}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button 
                          onClick={() => router.push(`/leads/${lead.id}`)}
                          className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-full transition-colors"
                          title="View Details"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => router.push(`/leads/${lead.id}/edit`)}
                          className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-full transition-colors"
                          title="Edit Lead"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        {lead.enquiry_status !== 'Converted to Proposal' ? (
                          <button 
                            onClick={() => convertToProposal(lead)}
                            className="flex items-center gap-2 px-3 py-1 text-green-600 hover:text-green-800 hover:bg-green-50 rounded-md transition-colors"
                            title="Convert to Proposal"
                          >
                            <DocumentTextIcon className="h-4 w-4" />
                            <span className="hidden sm:inline text-sm">Convert</span>
                          </button>
                        ) : (
                          <span className="flex items-center gap-2 px-3 py-1 text-gray-400 text-sm" title="Already converted to proposal">
                            <DocumentTextIcon className="h-4 w-4" />
                            <span className="hidden sm:inline">Converted</span>
                          </span>
                        )}
                        <button 
                          onClick={() => handleDeleteLead(lead.id, lead.company_name)}
                          className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-full transition-colors"
                          title="Delete Lead"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {leads.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center text-sm text-gray-700">
            Showing {((currentPage - 1) * 20) + 1} to {Math.min(currentPage * 20, stats.total_leads || 0)} of {stats.total_leads || 0} leads
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 inline-flex items-center gap-1"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Previous
            </button>
            <span className="px-3 py-1 text-sm text-gray-700">
              Page {currentPage}
            </span>
            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage * 20 >= (stats.total_leads || 0)}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 inline-flex items-center gap-1"
            >
              Next
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Follow-ups list removed from main Leads view (now managed per-lead in Edit Lead)

  const renderAddLeadForm = () => (
    <div className="h-full">
      <form onSubmit={handleFormSubmit} className="h-full flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Add New Lead</h2>
              <p className="text-gray-600 mt-1">Create a new lead and set up initial follow-up</p>
            </div>
            <div className="text-sm text-gray-500">
              <span className="text-red-500">*</span> Required fields
            </div>
          </div>
        </div>

        {/* Form Container - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6">
          
          {/* Lead Information Section */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-blue-100">
              Lead Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Lead ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Lead ID
                </label>
                <input
                  type="text"
                  name="lead_id"
                  value={formData.lead_id}
                  onChange={handleFormChange}
                  placeholder="e.g., 001-10-2025 (auto-generated if empty)"
                  pattern="\d{3}-\d{2}-\d{4}"
                  title="Format: 001-10-2025 (serial-month-year)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm font-mono"
                />
                <p className="text-xs text-gray-500 mt-1">Format: Serial-Month-Year. Leave empty to auto-generate.</p>
              </div>
              
              {/* Company Information */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company *
                </label>
                <div className="space-y-2">
                  <select
                    name="company_id"
                    value={formData.company_id}
                    onChange={handleCompanyChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  >
                    <option value="">Select a company</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.company_name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    name="company_name"
                    value={formData.company_name}
                    onChange={handleFormChange}
                    placeholder="Or enter new company name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Name
                </label>
                <input
                  type="text"
                  name="contact_name"
                  value={formData.contact_name}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="Enter contact person name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Designation
                </label>
                <input
                  type="text"
                  name="designation"
                  value={formData.designation}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="Contact designation / role"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  City
                </label>
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="Enter city"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="Enter phone number"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Lead Source
                </label>
                <input
                  type="text"
                  name="lead_source"
                  value={formData.lead_source}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="Enter lead source"
                />
              </div>
            </div>
          </div>

          {/* Email Information Section */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-green-100">
              Email Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Inquiry Email
                </label>
                <input
                  type="email"
                  name="inquiry_email"
                  value={formData.inquiry_email}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="Email from whom inquiry was received"
                />
                <p className="text-xs text-gray-500 mt-1">Email ID of the person from whom the inquiry was received</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CC Emails (2-6 emails)
                </label>
                <input
                  type="text"
                  name="cc_emails"
                  value={formData.cc_emails}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="email1@example.com, email2@example.com, email3@example.com"
                />
                <p className="text-xs text-gray-500 mt-1">Enter 2-6 additional email IDs separated by commas</p>
              </div>
            </div>
          </div>

          {/* Project & Lead Details Section */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-purple-100">
              Project & Lead Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                </label>
                <select
                  name="priority"
                  value={formData.priority}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Enquiry Type
                </label>
                <select
                  name="enquiry_type"
                  value={formData.enquiry_type}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                >
                  <option value="Email">Email</option>
                  <option value="Call">Call</option>
                  <option value="Website">Website</option>
                  <option value="Justdial">Justdial</option>
                  <option value="Referral">Referral</option>
                  <option value="LinkedIn">LinkedIn</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  name="enquiry_status"
                  value={formData.enquiry_status}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                >
                  <option value="Under Discussion">Under Discussion</option>
                  <option value="Awaiting">Awaiting</option>
                  <option value="Awarded">Awarded</option>
                  <option value="Regretted">Regretted</option>
                  <option value="Close">Close</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Enquiry Date
                </label>
                <input
                  type="date"
                  name="enquiry_date"
                  value={formData.enquiry_date}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project Description
                </label>
                <textarea
                  name="project_description"
                  value={formData.project_description}
                  onChange={handleFormChange}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="Describe the project requirements"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleFormChange}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="Add any additional notes about this lead"
                />
              </div>
            </div>
          </div>

          {/* First Follow-up Section */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-orange-100">
              First Follow-up (Optional)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Follow-up Date
                </label>
                <input
                  type="date"
                  name="first_followup_date"
                  value={formData.first_followup_date}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Follow-up Type
                </label>
                <select
                  name="first_followup_type"
                  value={formData.first_followup_type}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                >
                  <option value="Call">Call</option>
                  <option value="Email">Email</option>
                  <option value="Meeting">Meeting</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Site Visit">Site Visit</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Follow-up Description
                </label>
                <textarea
                  name="first_followup_description"
                  value={formData.first_followup_description}
                  onChange={handleFormChange}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="Describe what needs to be done in this follow-up"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Follow-up Notes
                </label>
                <textarea
                  name="first_followup_notes"
                  value={formData.first_followup_notes}
                  onChange={handleFormChange}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm"
                  placeholder="Additional notes for this follow-up"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end items-center pt-4 mt-4 border-t border-gray-300 bg-white rounded-b-lg -m-3 p-3">
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setActiveTab('list')}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm shadow-md border-2 border-blue-600"
              >
                {loading ? 'Saving...' : 'Save Lead'}
              </button>
            </div>
          </div>

          {/* Form submission handled by both tab bar and form buttons */}
          </div>
        </div>
      </form>
    </div>
  );

  // Follow-ups are displayed and managed on the Edit Lead page; no follow-up UI on this listing page

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      
      {/* Fixed header section */}
      <div className="flex-shrink-0 pt-24 px-8 pb-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-black mb-2">
            Leads Management
          </h1>
          <p className="text-gray-600">
            Manage your leads through manual entry or Excel/CSV import
          </p>
        </div>
        
        {/* Tab Navigation - Fixed */}
        <div className="flex border-b border-gray-200 bg-white rounded-t-lg px-6 pt-4">
          <button
            onClick={() => setActiveTab('list')}
            className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
              activeTab === 'list'
                ? 'border-black text-black bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <UserGroupIcon className="h-5 w-5 inline mr-2" />
            All Leads ({stats.total_leads || 0})
          </button>
          <button
            onClick={() => setActiveTab('add')}
            className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
              activeTab === 'add'
                ? 'border-black text-black bg-gray-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <PlusIcon className="h-5 w-5 inline mr-2" />
            Add Lead
          </button>
          {/* Follow-ups tab removed as per request */}
          
          {/* Save Button - Only show on Add Lead tab */}
          {activeTab === 'add' && (
            <div className="ml-auto flex items-center">
              <button
                onClick={() => {
                  // Trigger form submission
                  const form = document.querySelector('form');
                  if (form) {
                    form.requestSubmit();
                  }
                }}
                disabled={loading}
                className="px-6 py-2 bg-accent-purple text-white rounded-md hover:bg-accent-purple/90 transition-colors disabled:opacity-50 text-sm"
              >
                {loading ? 'Saving...' : 'Save Lead'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 px-8 overflow-hidden">
        <div className="h-full overflow-y-auto bg-white rounded-b-lg">
          <div className="p-6">
            {activeTab === 'list' ? renderLeadsList() : renderAddLeadForm()}
          </div>
        </div>
      </div>
    </div>
  );
}

