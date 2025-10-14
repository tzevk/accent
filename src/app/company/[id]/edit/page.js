'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeftIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

export default function EditCompany({ params }) {
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [formData, setFormData] = useState({
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

  useEffect(() => {
    const fetchCompany = async () => {
      try {
        const companyId = await params;
        const response = await fetch(`/api/companies/${companyId.id}`);
        const result = await response.json();
        
        if (result.success) {
          const companyData = result.data;
          setCompany(companyData);
          setFormData({
            company_name: companyData.company_name || '',
            industry: companyData.industry || '',
            company_size: companyData.company_size || '',
            website: companyData.website || '',
            phone: companyData.phone || '',
            email: companyData.email || '',
            address: companyData.address || '',
            city: companyData.city || '',
            state: companyData.state || '',
            country: companyData.country || '',
            postal_code: companyData.postal_code || '',
            description: companyData.description || '',
            founded_year: companyData.founded_year || '',
            revenue: companyData.revenue || '',
            notes: companyData.notes || ''
          });
        } else {
          console.error('Error fetching company:', result.error);
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCompany();
  }, [params]);

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await fetch(`/api/companies/${company.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      
      if (result.success) {
        alert('Company updated successfully!');
        router.push(`/company/${company.id}`);
      } else {
        alert('Error updating company: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error updating company');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading company details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600">Company not found</p>
            <button
              onClick={() => router.push('/company')}
              className="mt-4 px-4 py-2 bg-accent-primary text-white rounded-md hover:bg-accent-primary/90"
            >
              Back to Companies
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
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => router.push(`/company/${company.id}`)}
                  className="p-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                </button>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">
                    Edit {company.company_name}
                  </h1>
                  <p className="text-gray-600 text-sm">Update company information</p>
                </div>
              </div>
              
              <div className="flex space-x-2">
                <button
                  onClick={() => router.push(`/company/${company.id}`)}
                  className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
                >
                  <XMarkIcon className="h-3 w-3" />
                  <span>Cancel</span>
                </button>
                <button
                  type="submit"
                  form="edit-company-form"
                  disabled={saving}
                  className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-1 disabled:opacity-50"
                >
                  <CheckIcon className="h-3 w-3" />
                  <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Edit Form */}
          <div className="h-full overflow-y-auto pb-8">
            <form id="edit-company-form" onSubmit={handleSubmit} className="space-y-3">
              <div className="bg-white rounded-lg border border-gray-200 p-3">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Edit Company Information</h3>
                
                {/* Form Grid Layout */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  {/* Basic Information */}
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
                      Postal Code
                    </label>
                    <input
                      type="text"
                      name="postal_code"
                      value={formData.postal_code}
                      onChange={handleFormChange}
                      className="w-full px-2 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent text-xs"
                      placeholder="Enter postal code"
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
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
