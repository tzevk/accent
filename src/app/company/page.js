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
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
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
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      
      <div className="flex-1 overflow-hidden">
        <div className="h-full px-8 pt-22">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-accent-primary">Companies</h1>
            <p className="text-gray-600">Manage your company database</p>
          </div>

          {/* Tabs */}
          <div className="mb-6">
            <nav className="flex space-x-8 border-b border-gray-200" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('list')}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'list'
                    ? 'border-accent-primary text-accent-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Companies List ({companies.length})
              </button>
              <button
                onClick={() => setActiveTab('add')}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'add'
                    ? 'border-accent-primary text-accent-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Add New Company
              </button>
              <button
                onClick={() => setActiveTab('import')}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'import'
                    ? 'border-accent-primary text-accent-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Import Files
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="h-full overflow-y-auto pb-8">
            {activeTab === 'list' ? (
              loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading companies...</p>
                  </div>
                </div>
              ) : companies.length === 0 ? (
                /* Empty State */
                <div className="text-center py-12">
                  <BuildingOfficeIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-600 mb-2">No companies yet</h3>
                  <p className="text-gray-500 mb-6">Get started by adding your first company or importing from Excel</p>
                  <div className="flex justify-center space-x-4">
                    <button
                      onClick={() => setActiveTab('add')}
                      className="bg-accent-primary hover:bg-accent-primary/90 text-white px-6 py-3 rounded-md inline-flex items-center space-x-2 transition-colors"
                    >
                      <PlusIcon className="h-5 w-5" />
                      <span>Add Company</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('import')}
                      className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-md inline-flex items-center space-x-2 transition-colors"
                    >
                      <DocumentArrowUpIcon className="h-5 w-5" />
                      <span>Import Excel</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Companies Table */
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Company ID
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Company Name
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Industry
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Size
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Location
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Contact
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {companies.map((company) => (
                          <tr key={company.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-blue-600">
                                {company.company_id || '-'}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-gray-900">
                                {company.company_name}
                              </div>
                              {company.website && (
                                <div className="text-sm text-blue-600">
                                  {company.website}
                                </div>
                              )}
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
                </div>
              )
            ) : activeTab === 'add' ? (
              /* Add New Company Form */
              <div className="bg-white rounded-lg border border-gray-200 p-3">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Add New Company</h3>
                
                <form onSubmit={handleSubmit} className="space-y-3">
                  {/* Form Grid Layout */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    {/* Basic Information */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Company ID
                      </label>
                      <input
                        type="text"
                        name="company_id"
                        value={formData.company_id}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter company ID (optional)"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
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
                        City
                      </label>
                      <input
                        type="text"
                        name="city"
                        value={formData.city}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter city"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        State
                      </label>
                      <input
                        type="text"
                        name="state"
                        value={formData.state}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter state"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Country
                      </label>
                      <input
                        type="text"
                        name="country"
                        value={formData.country}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="Enter country"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Founded Year
                      </label>
                      <input
                        type="number"
                        name="founded_year"
                        value={formData.founded_year}
                        onChange={handleFormChange}
                        min="1800"
                        max="2025"
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="e.g., 2010"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-0.5">
                        Annual Revenue
                      </label>
                      <input
                        type="text"
                        name="revenue"
                        value={formData.revenue}
                        onChange={handleFormChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                        placeholder="e.g., $1M-$10M"
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
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-md transition-colors disabled:opacity-50 flex items-center space-x-1 text-xs"
                    >
                      <PlusIcon className="h-3 w-3" />
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
