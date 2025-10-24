'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  PlusIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  DocumentArrowUpIcon,
  BuildingOfficeIcon
} from '@heroicons/react/24/outline';
import Papa from 'papaparse';

export default function Company() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('list');
  const [formData, setFormData] = useState({
    company_id: '',
    company_name: '',
    industry: '',
    company_size: '',
    website: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    country: '',
    postal_code: '',
    description: '',
    founded_year: '',
    revenue: '',
    notes: '',
    // New fields
    location: '',
    contact_person: '',
    designation: '',
    mobile_number: '',
    sector: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [companyFollowUps, setCompanyFollowUps] = useState([]);
  const [showFollowUpsPanel, setShowFollowUpsPanel] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
      const response = await fetch('/api/companies');
      const result = await response.json();
      
      if (result.success) {
        setCompanies(result.data);
      } else {
        console.error('Error fetching companies:', result.error);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanyFollowUps = async (companyId) => {
    try {
      // Fetch follow-ups for a given company (API supports company_id)
      const res = await fetch(`/api/followups?company_id=${companyId}`);
      const result = await res.json();
      if (result.success) {
        setCompanyFollowUps(result.data || []);
      } else {
        setCompanyFollowUps([]);
      }
    } catch (err) {
      console.error('Error fetching company follow-ups', err);
      setCompanyFollowUps([]);
    }
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const response = await fetch('/api/companies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      
      if (result.success) {
        alert('Company added successfully!');
        // Reset form
        setFormData({
          company_id: '',
          company_name: '',
          industry: '',
          company_size: '',
          website: '',
          phone: '',
          email: '',
          address: '',
          city: '',
          state: '',
          country: '',
          postal_code: '',
          description: '',
          founded_year: '',
          revenue: '',
          notes: ''
          ,
          // Reset new fields
          location: '',
          contact_person: '',
          designation: '',
          mobile_number: '',
          sector: ''
        });
        // Refresh companies list and switch to list tab
        fetchCompanies();
        setActiveTab('list');
      } else {
        alert('Error adding company: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error adding company');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    const isCsv = file.name.endsWith('.csv');

    if (!isExcel && !isCsv) {
      alert('Please select an Excel file (.xlsx or .xls) or CSV file (.csv)');
      return;
    }

    setImporting(true);

    try {
      if (isCsv) {
        // Handle CSV file parsing with Papa Parse
        Papa.parse(file, {
          header: true,
          complete: async (results) => {
            await processParsedData(results.data, 'csv');
          },
          error: (error) => {
            console.error('CSV parsing error:', error);
            alert('Error parsing CSV file');
            setImporting(false);
          }
        });
      } else {
        // Handle Excel file - send to server
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/companies/import', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();
        
        if (result.success) {
          alert(`Successfully imported ${result.imported} companies!`);
          fetchCompanies();
          setActiveTab('list');
        } else {
          alert('Error importing companies: ' + result.error);
        }
        setImporting(false);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error importing companies');
      setImporting(false);
    }
  };

  const processParsedData = async (data, fileType) => {
    try {
      const validCompanies = data.filter(row => {
        // Filter out empty rows and ensure we have required fields
        const hasCompanyId = row.company_id || row.Company_ID || row['Company ID'] || row.id || row.ID;
        const hasCompanyName = row.company_name || row.Company_Name || row['Company Name'] || row.name || row.Name;
        return hasCompanyId && hasCompanyName;
      }).map(row => {
        // Normalize field names to match our database schema
        return {
          company_id: row.company_id || row.Company_ID || row['Company ID'] || row.id || row.ID || '',
          company_name: row.company_name || row.Company_Name || row['Company Name'] || row.name || row.Name || '',
          industry: row.industry || row.Industry || '',
          company_size: row.company_size || row.Company_Size || row['Company Size'] || row.size || row.Size || '',
          website: row.website || row.Website || row.url || row.URL || '',
          phone: row.phone || row.Phone || row.telephone || row.Telephone || '',
          email: row.email || row.Email || row.Email_Address || row['Email Address'] || '',
          address: row.address || row.Address || row.street || row.Street || '',
          city: row.city || row.City || '',
          state: row.state || row.State || row.province || row.Province || '',
          country: row.country || row.Country || '',
          postal_code: row.postal_code || row.Postal_Code || row['Postal Code'] || row.zip || row.ZIP || '',
          description: row.description || row.Description || '',
          founded_year: row.founded_year || row.Founded_Year || row['Founded Year'] || row.founded || row.Founded || '',
          revenue: row.revenue || row.Revenue || '',
          notes: row.notes || row.Notes || row.comments || row.Comments || ''
          ,
          location: row.location || row.Location || row.Location_Name || '',
          contact_person: row.contact_person || row.Contact_Person || row['Contact Person'] || row.contact || row.Contact || '',
          designation: row.designation || row.Designation || '',
          mobile_number: row.mobile_number || row.Mobile || row.Phone || row.phone || '',
          sector: row.sector || row.Sector || row.industry_sector || ''
        };
      });

      if (validCompanies.length === 0) {
        alert('No valid companies found in the file. Please ensure your file has company_id and company_name columns.');
        setImporting(false);
        return;
      }

      // Send parsed data to server
      const response = await fetch('/api/companies/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ companies: validCompanies, fileType }),
      });

      const result = await response.json();
      
      if (result.success) {
        alert(`Successfully imported ${result.imported} companies from ${fileType.toUpperCase()} file!`);
        fetchCompanies();
        setActiveTab('list');
      } else {
        alert('Error importing companies: ' + result.error);
      }
    } catch (error) {
      console.error('Error processing parsed data:', error);
      alert('Error processing file data');
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id, companyName) => {
    if (window.confirm(`Are you sure you want to delete "${companyName}"?`)) {
      try {
        const response = await fetch(`/api/companies/${id}`, {
          method: 'DELETE',
        });

        const result = await response.json();
        
        if (result.success) {
          alert('Company deleted successfully!');
          fetchCompanies();
        } else {
          alert('Error deleting company: ' + result.error);
        }
      } catch (error) {
        console.error('Error:', error);
        alert('Error deleting company');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
  <div className="px-4 sm:px-6 lg:px-8 py-8 pt-16">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Companies</h1>
          <p className="text-gray-600">Manage your company database efficiently</p>
        </div>

        {/* Tabs */}
        <div className="mb-8">
          <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
            <nav className="flex" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('list')}
                className={`flex-1 py-4 px-6 text-center font-semibold text-sm transition-all duration-300 ${
                  activeTab === 'list'
                    ? 'bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Companies List ({companies.length})
              </button>
              <button
                onClick={() => setActiveTab('add')}
                className={`flex-1 py-4 px-6 text-center font-semibold text-sm transition-all duration-300 ${
                  activeTab === 'add'
                    ? 'bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Add New Company
              </button>
              <button
                onClick={() => setActiveTab('import')}
                className={`flex-1 py-4 px-6 text-center font-semibold text-sm transition-all duration-300 ${
                  activeTab === 'import'
                    ? 'bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                Import Files
              </button>
            </nav>
          </div>
        </div>

        {/* Content */}
        <div className="pb-8">
          {activeTab === 'list' ? (
            loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#64126D] mx-auto"></div>
                  <p className="mt-4 text-gray-600">Loading companies...</p>
                </div>
              </div>
            ) : companies.length === 0 ? (
              /* Empty State */
              <div className="bg-white shadow-lg rounded-xl border border-gray-200 text-center py-16">
                  <BuildingOfficeIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-600 mb-2">No companies yet</h3>
                  <p className="text-gray-500 mb-6">Get started by adding your first company or importing from Excel</p>
                  <div className="flex justify-center space-x-4">
                    <button
                      onClick={() => setActiveTab('add')}
                      className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl inline-flex items-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                    >
                      <PlusIcon className="h-5 w-5" />
                      <span>Add Company</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('import')}
                      className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-500 text-white px-6 py-3 rounded-xl inline-flex items-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                    >
                      <DocumentArrowUpIcon className="h-5 w-5" />
                      <span>Import Excel</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Companies Table */
                <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Sr
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Company Name
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Industry
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Size
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Location
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Contact
                          </th>
                          <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {companies.map((company, index) => (
                          <tr key={company.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">
                                {index + 1}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center">
                                <div className="relative">
                                  <div className="h-10 w-10 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-full flex items-center justify-center">
                                    <span className="font-medium text-sm">
                                      {company.company_name ? company.company_name.split(' ').map(n => n[0]).join('').slice(0,2) : 'C'}
                                    </span>
                                  </div>
                                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white bg-green-600 rounded-full">
                                    {typeof company.lead_count !== 'undefined' ? company.lead_count : 0}
                                  </span>
                                </div>
                                <div className="ml-4">
                                  <div className="text-sm font-medium text-gray-900">
                                    {company.company_name}
                                  </div>
                                  {company.website && (
                                    <div className="text-sm text-blue-600">
                                      {company.website}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900">
                                {company.industry || '-'}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900">
                                {company.company_size || '-'}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm text-gray-900">
                                {company.city || '-'}
                              </div>
                              {company.state && (
                                <div className="text-sm text-gray-500">
                                  {company.state}, {company.country}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              {company.email && (
                                <div className="text-sm text-gray-900">
                                  {company.email}
                                </div>
                              )}
                              {company.phone && (
                                <div className="text-sm text-gray-500">
                                  {company.phone}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex justify-end space-x-2">
                                <button 
                                  onClick={() => router.push(`/company/${company.id}`)}
                                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-full transition-colors"
                                  title="View Company"
                                >
                                  <EyeIcon className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={async () => {
                                    await fetchCompanyFollowUps(company.id);
                                    setSelectedCompanyId(company.id);
                                    setShowFollowUpsPanel(true);
                                  }}
                                  className="relative p-2 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-full transition-colors"
                                  title="View Follow Ups"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M8 9a3 3 0 100-6 3 3 0 000 6zM2 15a6 6 0 1112 0H2z" /></svg>
                                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white bg-red-600 rounded-full">
                                    {company.follow_up_count || 0}
                                  </span>
                                </button>
                                <button 
                                  onClick={() => router.push(`/company/${company.id}/edit`)}
                                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-full transition-colors"
                                  title="Edit Company"
                                >
                                  <PencilIcon className="h-4 w-4" />
                                </button>
                                <button 
                                  onClick={() => handleDelete(company.id, company.company_name)}
                                  className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-full transition-colors"
                                  title="Delete Company"
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
                  {/* Company Follow-ups Panel */}
                  {showFollowUpsPanel && (
                    <div className="bg-white border-t border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-medium text-gray-900">Follow Ups for {companies.find(c => c.id === selectedCompanyId)?.company_name || 'Company'}</h4>
                        <button onClick={() => { setShowFollowUpsPanel(false); setCompanyFollowUps([]); setSelectedCompanyId(null); }} className="text-xs text-gray-500">Close</button>
                      </div>
                      {companyFollowUps.length === 0 ? (
                        <div className="text-sm text-gray-500">No follow-ups for this company.</div>
                      ) : (
                        <ol className="list-decimal list-inside divide-y divide-gray-100">
                          {companyFollowUps.sort((a,b) => {
                            const da = new Date(a.follow_up_date || a.created_at || 0).getTime();
                            const db = new Date(b.follow_up_date || b.created_at || 0).getTime();
                            if (db !== da) return db - da;
                            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
                          }).map(fu => {
                            const d = fu.follow_up_date ? new Date(fu.follow_up_date) : (fu.created_at ? new Date(fu.created_at) : null);
                            const formattedDate = d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` : 'N/A';
                            return (
                              <li key={fu.id} className="py-2">
                                <div className="text-xs text-gray-900">{formattedDate}</div>
                                <div className="text-xs text-gray-600 mt-1">{fu.description}</div>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  )}
                </div>
              )
            ) : activeTab === 'add' ? (
              /* Add New Company Form */
              <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Add New Company</h3>
                  <p className="text-sm text-gray-600 mt-1">Fill in the company details to add to your database</p>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                  {/* Form Grid Layout */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Basic Information */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Company ID
                      </label>
                      <input
                        type="text"
                        name="company_id"
                        value={formData.company_id}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm transition-all duration-200"
                        placeholder="Enter company ID (optional)"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Company Name *
                      </label>
                      <input
                        type="text"
                        name="company_name"
                        value={formData.company_name}
                        onChange={handleFormChange}
                        required
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter company name"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Industry
                      </label>
                      <input
                        type="text"
                        name="industry"
                        value={formData.industry}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="e.g., Technology, Finance"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Company Size
                      </label>
                      <select
                        name="company_size"
                        value={formData.company_size}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                      >
                        <option value="">Select size</option>
                        <option value="1-10">1-10 employees</option>
                        <option value="11-50">11-50 employees</option>
                        <option value="51-200">51-200 employees</option>
                        <option value="201-500">201-500 employees</option>
                        <option value="501-1000">501-1000 employees</option>
                        <option value="1000+">1000+ employees</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Website
                      </label>
                      <input
                        type="url"
                        name="website"
                        value={formData.website}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="https://example.com"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Phone
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        value={formData.phone}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter phone number"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Email
                      </label>
                      <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter email address"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Contact Person
                      </label>
                      <input
                        type="text"
                        name="contact_person"
                        value={formData.contact_person}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Primary contact person"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Designation
                      </label>
                      <input
                        type="text"
                        name="designation"
                        value={formData.designation}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Contact designation"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Mobile Number
                      </label>
                      <input
                        type="tel"
                        name="mobile_number"
                        value={formData.mobile_number}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter mobile number"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Location
                      </label>
                      <input
                        type="text"
                        name="location"
                        value={formData.location}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="e.g., Head Office / Branch"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Sector
                      </label>
                      <input
                        type="text"
                        name="sector"
                        value={formData.sector}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="e.g., Manufacturing, Retail"
                      />
                    </div>
                  </div>

                  {/* Address & Description - Full Width */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Address
                      </label>
                      <textarea
                        name="address"
                        value={formData.address}
                        onChange={handleFormChange}
                        rows={2}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter full address"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Description
                      </label>
                      <textarea
                        name="description"
                        value={formData.description}
                        onChange={handleFormChange}
                        rows={2}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Company description"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Notes
                      </label>
                      <textarea
                        name="notes"
                        value={formData.notes}
                        onChange={handleFormChange}
                        rows={2}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Additional notes"
                      />
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl transition-all duration-300 disabled:opacity-50 flex items-center space-x-2 text-sm font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                    >
                      <PlusIcon className="h-5 w-5" />
                      <span>{submitting ? 'Adding...' : 'Add Company'}</span>
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              /* Import from Excel/CSV Tab */
              <div className="bg-white rounded-lg border border-gray-200 p-8 w-full">
                <h3 className="text-xl font-medium text-gray-900 mb-8">Import Companies from Excel or CSV</h3>
                
                <div className="space-y-8">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-12">
                    <div className="text-center">
                      <DocumentArrowUpIcon className="h-20 w-20 text-gray-400 mx-auto mb-6" />
                      <h4 className="text-2xl font-medium text-gray-900 mb-4">Upload File</h4>
                      <p className="text-gray-600 mb-8 max-w-2xl mx-auto text-lg">
                        Select an Excel file (.xlsx or .xls) or CSV file (.csv) containing company information
                      </p>
                      
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleFileUpload}
                        disabled={importing}
                        className="hidden"
                        id="file-upload"
                      />
                      <label
                        htmlFor="file-upload"
                        className={`bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-lg inline-flex items-center space-x-3 transition-colors cursor-pointer text-base font-medium ${
                          importing ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        <DocumentArrowUpIcon className="h-6 w-6" />
                        <span>{importing ? 'Importing...' : 'Choose File'}</span>
                      </label>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-8">
                    <h4 className="text-lg font-medium text-blue-900 mb-6">File Format Requirements:</h4>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="bg-white rounded-lg p-6 border border-blue-100">
                        <h5 className="text-base font-semibold text-blue-900 mb-4 flex items-center">
                          📊 Excel Files (.xlsx, .xls):
                        </h5>
                        <ul className="text-sm text-blue-800 space-y-2 ml-2">
                          <li>• Column A: Company ID (optional - unique identifier)</li>
                          <li>• Column B: Company Name (required)</li>
                          <li>• Simple 2-column format for basic imports</li>
                          <li>• Perfect for quick bulk company additions</li>
                        </ul>
                      </div>
                      <div className="bg-white rounded-lg p-6 border border-blue-100">
                        <h5 className="text-base font-semibold text-blue-900 mb-4 flex items-center">
                          📄 CSV Files (.csv):
                        </h5>
                        <ul className="text-sm text-blue-800 space-y-2 ml-2">
                          <li>• Supports flexible column names (company_id, Company_ID, ID, etc.)</li>
                          <li>• Required: Company ID and Company Name columns</li>
                          <li>• Optional: All other company fields will be imported if present</li>
                          <li>• Industry, size, contact info, and more supported</li>
                        </ul>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-blue-200">
                      <p className="text-sm text-blue-700 font-medium mb-1">
                        📝 Import Notes:
                      </p>
                      <p className="text-sm text-blue-700">
                        • First row should contain headers. CSV format supports importing all available fields.
                      </p>
                      <p className="text-sm text-blue-700">
                        • Additional company details can be added manually after import.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}
