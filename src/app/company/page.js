'use client';

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  PlusIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  DocumentArrowUpIcon,
  BuildingOfficeIcon,
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FunnelIcon,
  UserGroupIcon,
  MapPinIcon
} from '@heroicons/react/24/outline';
import Papa from 'papaparse';

export default function Company() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total_companies: 0,
    with_leads: 0,
    by_industry: {}
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const searchDebounceRef = useRef(null);
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
    location: '',
    contact_person: '',
    designation: '',
    mobile_number: '',
    sector: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const fileInputRef = useRef(null);
  const router = useRouter();

  // Fetch companies with pagination and filters
  const fetchCompanies = async (searchOverride) => {
    try {
      setLoading(true);
      const searchValue = typeof searchOverride !== 'undefined' ? searchOverride : debouncedSearchTerm;
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
        sortBy: sortBy,
        sortOrder: sortOrder,
        ...(searchValue && { search: searchValue }),
        ...(industryFilter && { industry: industryFilter }),
        ...(cityFilter && { city: cityFilter })
      });

      const response = await fetch(`/api/companies?${params}`);
      const result = await response.json();
      
      if (result.success) {
        setCompanies(result.data);
        if (result.stats) {
          setStats(result.stats);
        } else {
          // Calculate stats from data if not provided
          setStats({
            total_companies: result.data.length,
            with_leads: result.data.filter(c => c.lead_count > 0).length,
            by_industry: {}
          });
        }
      }
    } catch (error) {
      console.error('Error fetching companies:', error);
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'list') {
      fetchCompanies();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, debouncedSearchTerm, industryFilter, cityFilter, sortBy, sortOrder, activeTab]);

  // Debounce searchTerm
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setCurrentPage(1);
      setDebouncedSearchTerm(searchTerm.trim());
    }, 350);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchTerm]);

  const clearFilters = () => {
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setIndustryFilter('');
    setCityFilter('');
    setSortBy('created_at');
    setSortOrder('desc');
    setCurrentPage(1);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const response = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      
      if (result.success) {
        alert('Company added successfully!');
        setFormData({
          company_id: '', company_name: '', industry: '', company_size: '',
          website: '', phone: '', email: '', address: '', city: '', state: '',
          country: '', postal_code: '', description: '', founded_year: '',
          revenue: '', notes: '', location: '', contact_person: '',
          designation: '', mobile_number: '', sector: ''
        });
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

  const handleDelete = async (id, companyName) => {
    if (!confirm(`Are you sure you want to delete "${companyName}"? This action cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/companies/${id}`, { method: 'DELETE' });
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
        const hasCompanyId = row.company_id || row.Company_ID || row['Company ID'] || row.id || row.ID;
        const hasCompanyName = row.company_name || row.Company_Name || row['Company Name'] || row.name || row.Name;
        return hasCompanyId && hasCompanyName;
      }).map(row => ({
        company_id: row.company_id || row.Company_ID || row['Company ID'] || row.id || row.ID || '',
        company_name: row.company_name || row.Company_Name || row['Company Name'] || row.name || row.Name || '',
        industry: row.industry || row.Industry || '',
        company_size: row.company_size || row.Company_Size || row['Company Size'] || '',
        website: row.website || row.Website || '',
        phone: row.phone || row.Phone || '',
        email: row.email || row.Email || '',
        address: row.address || row.Address || '',
        city: row.city || row.City || '',
        state: row.state || row.State || '',
        country: row.country || row.Country || '',
        postal_code: row.postal_code || row.Postal_Code || '',
        description: row.description || row.Description || '',
        founded_year: row.founded_year || row.Founded_Year || '',
        revenue: row.revenue || row.Revenue || '',
        notes: row.notes || row.Notes || '',
        location: row.location || row.Location || '',
        contact_person: row.contact_person || row.Contact_Person || '',
        designation: row.designation || row.Designation || '',
        mobile_number: row.mobile_number || row.Mobile || '',
        sector: row.sector || row.Sector || ''
      }));

      if (validCompanies.length === 0) {
        alert('No valid companies found in the file.');
        setImporting(false);
        return;
      }

      const response = await fetch('/api/companies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: validCompanies, fileType }),
      });

      const result = await response.json();
      
      if (result.success) {
        alert(`Successfully imported ${result.imported} companies!`);
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

  const downloadTemplate = () => {
    const csvContent = `Company ID,Company Name,Industry,Company Size,Website,Phone,Email,City,State,Country,Contact Person,Designation,Sector,Notes
COMP001,Example Corp,Technology,51-200,https://example.com,+91 9876543210,info@example.com,Mumbai,Maharashtra,India,John Smith,CEO,IT Services,Sample company`;
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'companies_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const renderCompaniesList = () => (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <span className="h-10 w-10 rounded-full bg-[#64126D] border border-purple-200 flex items-center justify-center text-white shadow-sm">
              <BuildingOfficeIcon className="h-5 w-5" />
            </span>
            <div className="ml-4">
              <p className="text-sm font-medium text-black">Total Companies</p>
              <p className="text-2xl font-semibold text-gray-900">
                {stats.total_companies || companies.length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <UserGroupIcon className="h-8 w-8 text-blue-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-black">With Leads</p>
              <p className="text-2xl font-semibold text-gray-900">
                {stats.with_leads || companies.filter(c => c.lead_count > 0).length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <MapPinIcon className="h-8 w-8 text-green-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-black">Cities</p>
              <p className="text-2xl font-semibold text-gray-900">
                {new Set(companies.map(c => c.city).filter(Boolean)).size}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Import Section (Collapsible) */}
      <div className="bg-white rounded-lg border border-gray-200">
        <button
          type="button"
          onClick={() => setShowImport(s => !s)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <DocumentArrowUpIcon className="h-5 w-5 text-[#64126D]" />
            <h3 className="text-base font-medium text-gray-900">Import Companies</h3>
            <span className="ml-2 text-xs text-gray-500">CSV/Excel supported</span>
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
                {importing ? 'Importing...' : 'Import Excel/CSV'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={importing}
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
                placeholder="Search companies by name, contact, or industry..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                    setDebouncedSearchTerm(searchTerm.trim());
                    setCurrentPage(1);
                    fetchCompanies(searchTerm.trim());
                  }
                }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
              />
            </div>
          </div>
          
          <div className="sm:w-48">
            <select
              value={industryFilter}
              onChange={(e) => { setIndustryFilter(e.target.value); setCurrentPage(1); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
            >
              <option value="">All Industries</option>
              <option value="Technology">Technology</option>
              <option value="Finance">Finance</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Manufacturing">Manufacturing</option>
              <option value="Retail">Retail</option>
              <option value="Construction">Construction</option>
              <option value="Other">Other</option>
            </select>
          </div>
          
          <div className="sm:w-32">
            <select
              value={cityFilter}
              onChange={(e) => { setCityFilter(e.target.value); setCurrentPage(1); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
            >
              <option value="">All Cities</option>
              <option value="Mumbai">Mumbai</option>
              <option value="Delhi">Delhi</option>
              <option value="Pune">Pune</option>
              <option value="Bangalore">Bangalore</option>
              <option value="Chennai">Chennai</option>
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
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
            >
              <option value="created_at-desc">Recently Added</option>
              <option value="created_at-asc">Oldest First</option>
              <option value="company_name-asc">Name A-Z</option>
              <option value="company_name-desc">Name Z-A</option>
              <option value="lead_count-desc">Most Leads</option>
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

      {/* Companies Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#64126D]"></div>
            <p className="mt-2 text-gray-600">Loading companies...</p>
          </div>
        ) : companies.length === 0 ? (
          <div className="p-8 text-center">
            <BuildingOfficeIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No companies found</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by adding companies manually or importing from Excel.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/75">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Sr
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Company ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Company & Contact
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Industry & Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Location
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Contact Info
                  </th>
                  <th className="relative px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {companies.map((company, index) => (
                  <tr key={company.id} className="hover:bg-gray-50 odd:bg-white even:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {(currentPage - 1) * 20 + index + 1}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-mono font-medium text-gray-900">
                        {company.company_id || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap max-w-sm">
                      <div className="flex items-center">
                        <div className="relative">
                          <div className="h-10 w-10 bg-gradient-to-r from-[#64126D] to-[#86288F] text-white rounded-full flex items-center justify-center">
                            <span className="font-medium text-sm">
                              {company.company_name ? company.company_name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() : 'C'}
                            </span>
                          </div>
                          {company.lead_count > 0 && (
                            <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white bg-green-600 rounded-full">
                              {company.lead_count}
                            </span>
                          )}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {company.company_name}
                          </div>
                          {company.contact_person && (
                            <div className="text-sm text-gray-500">
                              {company.contact_person}
                              {company.designation && <span className="text-xs text-gray-400"> • {company.designation}</span>}
                            </div>
                          )}
                          {company.website && (
                            <div className="text-xs text-blue-600 truncate max-w-[12rem]">
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
                      {company.company_size && (
                        <div className="text-xs text-gray-500">
                          {company.company_size}
                        </div>
                      )}
                      {company.sector && (
                        <span className="inline-flex px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded mt-1">
                          {company.sector}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {company.city || '-'}
                      </div>
                      {(company.state || company.country) && (
                        <div className="text-sm text-gray-500">
                          {[company.state, company.country].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {company.email && (
                        <div className="text-sm text-gray-900 truncate max-w-[10rem]">
                          {company.email}
                        </div>
                      )}
                      {company.phone && (
                        <div className="text-sm text-gray-500">
                          {company.phone}
                        </div>
                      )}
                      {company.mobile_number && (
                        <div className="text-xs text-gray-400">
                          M: {company.mobile_number}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button 
                          onClick={() => router.push(`/company/${company.id}`)}
                          className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-full transition-colors"
                          title="View Details"
                        >
                          <EyeIcon className="h-4 w-4" />
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
        )}
      </div>

      {/* Pagination */}
      {companies.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center text-sm text-gray-700">
            Showing {((currentPage - 1) * 20) + 1} to {Math.min(currentPage * 20, stats.total_companies || companies.length)} of {stats.total_companies || companies.length} companies
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
              disabled={currentPage * 20 >= (stats.total_companies || companies.length)}
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

  const renderAddCompanyForm = () => (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Add New Company</h3>
        <p className="text-sm text-gray-600 mt-1">Fill in the company details</p>
      </div>
      
      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company ID</label>
            <input
              type="text"
              name="company_id"
              value={formData.company_id}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="Enter company ID"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
            <input
              type="text"
              name="company_name"
              value={formData.company_name}
              onChange={handleFormChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="Enter company name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
            <input
              type="text"
              name="industry"
              value={formData.industry}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="e.g., Technology, Finance"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Size</label>
            <select
              name="company_size"
              value={formData.company_size}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Sector</label>
            <input
              type="text"
              name="sector"
              value={formData.sector}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="e.g., Manufacturing, Retail"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <input
              type="url"
              name="website"
              value={formData.website}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="https://example.com"
            />
          </div>
        </div>

        {/* Contact Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
            <input
              type="text"
              name="contact_person"
              value={formData.contact_person}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="Primary contact name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
            <input
              type="text"
              name="designation"
              value={formData.designation}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="Contact designation"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="company@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="Office phone"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
            <input
              type="tel"
              name="mobile_number"
              value={formData.mobile_number}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="Mobile number"
            />
          </div>
        </div>

        {/* Location */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
            <input
              type="text"
              name="city"
              value={formData.city}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="City"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <input
              type="text"
              name="state"
              value={formData.state}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="State"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
            <input
              type="text"
              name="country"
              value={formData.country}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="Country"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Postal Code</label>
            <input
              type="text"
              name="postal_code"
              value={formData.postal_code}
              onChange={handleFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="Postal code"
            />
          </div>
        </div>

        {/* Address & Notes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea
              name="address"
              value={formData.address}
              onChange={handleFormChange}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="Full address"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleFormChange}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
              placeholder="Additional notes"
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={submitting}
            className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-2.5 rounded-lg transition-all duration-300 disabled:opacity-50 flex items-center space-x-2 text-sm font-semibold shadow-lg hover:shadow-xl"
          >
            <PlusIcon className="h-5 w-5" />
            <span>{submitting ? 'Adding...' : 'Add Company'}</span>
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <AccessGuard resource="companies" permission="read" showNavbar={false}>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
          {/* Header */}
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Company Master</h1>
              <p className="text-gray-600 text-sm">Manage your company database</p>
            </div>
            <button
              onClick={() => setActiveTab(activeTab === 'list' ? 'add' : 'list')}
              className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-4 py-2 rounded-lg inline-flex items-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl text-sm font-medium"
            >
              <PlusIcon className="h-5 w-5" />
              <span>{activeTab === 'list' ? 'Add Company' : 'View List'}</span>
            </button>
          </div>

          {/* Content */}
          {activeTab === 'list' ? renderCompaniesList() : renderAddCompanyForm()}
        </div>
      </div>
    </AccessGuard>
  );
}
