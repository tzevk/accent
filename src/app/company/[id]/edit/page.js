'use client';

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeftIcon,
  BuildingOfficeIcon,
  UserIcon,
  MapPinIcon,
  DocumentTextIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

export default function EditCompany({ params }) {
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('details');
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
    sector: '',
    gstin: '',
    pan_number: '',
    company_profile: ''
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
            company_id: companyData.company_id || '',
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
            notes: companyData.notes || '',
            location: companyData.location || '',
            contact_person: companyData.contact_person || '',
            designation: companyData.designation || '',
            mobile_number: companyData.mobile_number || '',
            sector: companyData.sector || '',
            gstin: companyData.gstin || '',
            pan_number: companyData.pan_number || '',
            company_profile: companyData.company_profile || ''
          });
        } else {
          console.error('Error fetching company:', result.error);
          alert('Company not found');
          router.push('/company');
        }
      } catch (error) {
        console.error('Error:', error);
        alert('Error loading company details');
        router.push('/company');
      } finally {
        setLoading(false);
      }
    };

    fetchCompany();
  }, [params, router]);

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
        router.push('/company');
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

  const handleCancel = () => {
    router.push('/company');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#64126D] mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading company details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <BuildingOfficeIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h2 className="mt-4 text-xl font-semibold text-gray-900">Company not found</h2>
            <p className="mt-2 text-gray-600">The company you&apos;re trying to edit doesn&apos;t exist.</p>
            <button
              onClick={() => router.push('/company')}
              className="mt-4 bg-gradient-to-r from-[#64126D] to-[#86288F] text-white px-4 py-2 rounded-md hover:from-[#86288F] hover:to-[#64126D] transition-all"
            >
              Back to Companies
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AccessGuard resource="companies" permission="write" showNavbar={false}>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
        <Navbar />

        {/* Fixed header section */}
        <div className="flex-shrink-0 pt-24 px-4 sm:px-6 lg:px-8 pb-4">
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleCancel}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Edit Company</h1>
                  <p className="text-gray-600 text-sm">{company.company_name}</p>
                </div>
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-2"
                >
                  <XMarkIcon className="h-4 w-4" />
                  <span>Cancel</span>
                </button>
                <button
                  type="submit"
                  form="edit-company-form"
                  disabled={saving}
                  className="px-4 py-2 text-sm text-white bg-gradient-to-r from-[#64126D] to-[#86288F] rounded-md hover:from-[#86288F] hover:to-[#64126D] transition-all flex items-center space-x-2 disabled:opacity-50 shadow-lg"
                >
                  <CheckIcon className="h-4 w-4" />
                  <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 bg-white rounded-t-lg px-6 pt-4">
            <button
              onClick={() => setActiveTab('details')}
              className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
                activeTab === 'details'
                  ? 'border-[#64126D] text-[#64126D] bg-purple-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <BuildingOfficeIcon className="h-5 w-5 inline mr-2" />
              Company Details
            </button>

            <button
              onClick={() => setActiveTab('contact')}
              className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
                activeTab === 'contact'
                  ? 'border-[#64126D] text-[#64126D] bg-purple-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <UserIcon className="h-5 w-5 inline mr-2" />
              Contact Info
            </button>

            <button
              onClick={() => setActiveTab('location')}
              className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
                activeTab === 'location'
                  ? 'border-[#64126D] text-[#64126D] bg-purple-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <MapPinIcon className="h-5 w-5 inline mr-2" />
              Location
            </button>

            <button
              onClick={() => setActiveTab('additional')}
              className={`px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors ${
                activeTab === 'additional'
                  ? 'border-[#64126D] text-[#64126D] bg-purple-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <DocumentTextIcon className="h-5 w-5 inline mr-2" />
              Additional
            </button>
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 px-4 sm:px-6 lg:px-8 overflow-hidden pb-8">
          <div className="h-full overflow-y-auto bg-white rounded-b-lg border border-t-0 border-gray-200">
            <div className="p-6">
              <form id="edit-company-form" onSubmit={handleSubmit}>
                
                {/* Company Details Tab */}
                {activeTab === 'details' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-xl font-bold text-gray-900">Company Information</h2>
                        <p className="text-gray-600 text-sm mt-1">Basic details about the company</p>
                      </div>
                      <div className="text-sm text-gray-500">
                        <span className="text-red-500">*</span> Required fields
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Company ID
                        </label>
                        <input
                          type="text"
                          name="company_id"
                          value={formData.company_id}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="e.g., COMP001"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Company Name <span className="text-red-500">*</span>
                        </label>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Industry
                        </label>
                        <select
                          name="industry"
                          value={formData.industry}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                        >
                          <option value="">Select industry</option>
                          <option value="Technology">Technology</option>
                          <option value="Finance">Finance</option>
                          <option value="Healthcare">Healthcare</option>
                          <option value="Manufacturing">Manufacturing</option>
                          <option value="Retail">Retail</option>
                          <option value="Construction">Construction</option>
                          <option value="Education">Education</option>
                          <option value="Real Estate">Real Estate</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Company Size
                        </label>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Sector
                        </label>
                        <input
                          type="text"
                          name="sector"
                          value={formData.sector}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="e.g., IT Services, Consulting"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Website
                        </label>
                        <input
                          type="url"
                          name="website"
                          value={formData.website}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="https://example.com"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Founded Year
                        </label>
                        <input
                          type="number"
                          name="founded_year"
                          value={formData.founded_year}
                          onChange={handleFormChange}
                          min="1800"
                          max="2026"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="e.g., 2010"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Annual Revenue
                        </label>
                        <input
                          type="text"
                          name="revenue"
                          value={formData.revenue}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="e.g., $1M-$10M"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <textarea
                        name="description"
                        value={formData.description}
                        onChange={handleFormChange}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                        placeholder="Brief description of the company"
                      />
                    </div>
                  </div>
                )}

                {/* Contact Info Tab */}
                {activeTab === 'contact' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-xl font-bold text-gray-900">Contact Information</h2>
                        <p className="text-gray-600 text-sm mt-1">Primary contact details for this company</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Contact Person
                        </label>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Designation
                        </label>
                        <input
                          type="text"
                          name="designation"
                          value={formData.designation}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="e.g., CEO, Manager"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Email
                        </label>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Phone
                        </label>
                        <input
                          type="tel"
                          name="phone"
                          value={formData.phone}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="Office phone number"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Mobile Number
                        </label>
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
                  </div>
                )}

                {/* Location Tab */}
                {activeTab === 'location' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-xl font-bold text-gray-900">Location Details</h2>
                        <p className="text-gray-600 text-sm mt-1">Company address and location information</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          City
                        </label>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          State
                        </label>
                        <input
                          type="text"
                          name="state"
                          value={formData.state}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="State/Province"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Country
                        </label>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Postal Code
                        </label>
                        <input
                          type="text"
                          name="postal_code"
                          value={formData.postal_code}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="ZIP/Postal code"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Location
                        </label>
                        <input
                          type="text"
                          name="location"
                          value={formData.location}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="Office location/branch"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Full Address
                      </label>
                      <textarea
                        name="address"
                        value={formData.address}
                        onChange={handleFormChange}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                        placeholder="Complete street address"
                      />
                    </div>
                  </div>
                )}

                {/* Additional Tab */}
                {activeTab === 'additional' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-xl font-bold text-gray-900">Additional Information</h2>
                        <p className="text-gray-600 text-sm mt-1">Registration, profile and other details</p>
                      </div>
                    </div>

                    {/* Registration Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          GSTIN
                        </label>
                        <input
                          type="text"
                          name="gstin"
                          value={formData.gstin}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="e.g., 22AAAAA0000A1Z5"
                          maxLength={15}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          PAN Number
                        </label>
                        <input
                          type="text"
                          name="pan_number"
                          value={formData.pan_number}
                          onChange={handleFormChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                          placeholder="e.g., AAAAA0000A"
                          maxLength={10}
                        />
                      </div>
                    </div>

                    {/* Company Profile */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Company Profile
                      </label>
                      <textarea
                        name="company_profile"
                        value={formData.company_profile}
                        onChange={handleFormChange}
                        rows={5}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                        placeholder="Detailed company profile, history, services offered, etc."
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
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm"
                        placeholder="Additional notes about this company..."
                      />
                    </div>

                    {/* Company Summary Card */}
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <h3 className="text-sm font-medium text-gray-900 mb-3">Company Summary</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Company ID:</span>
                          <p className="font-medium text-gray-900">{formData.company_id || '-'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Industry:</span>
                          <p className="font-medium text-gray-900">{formData.industry || '-'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Size:</span>
                          <p className="font-medium text-gray-900">{formData.company_size || '-'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">City:</span>
                          <p className="font-medium text-gray-900">{formData.city || '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              </form>
            </div>
          </div>
        </div>
      </div>
    </AccessGuard>
  );
}
