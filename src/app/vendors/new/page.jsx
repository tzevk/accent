'use client';

import Navbar from '@/components/Navbar';
import { useState } from 'react';
import { fetchJSON } from '@/utils/http';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeftIcon,
  CheckIcon
} from '@heroicons/react/24/outline';

export default function NewVendor() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  
  const [formData, setFormData] = useState({
    vendor_id: '',
    vendor_name: '',
    vendor_type: '',
    industry_category: '',
    status: 'Active',
    contact_person: '',
    contact_designation: '',
    phone: '',
    email: '',
    address_street: '',
    address_city: '',
    address_state: '',
    address_country: '',
    address_pin: '',
    website: '',
    gst_vat_tax_id: '',
    pan_legal_reg_no: '',
    msme_ssi_registration: '',
    iso_certifications: '',
    other_compliance_docs: '',
    bank_name: '',
    bank_account_no: '',
    ifsc_swift_code: '',
    currency_preference: 'INR',
    payment_terms: '',
    credit_limit: '',
    previous_projects: '',
    avg_quality_rating: '',
    avg_delivery_rating: '',
    avg_reliability_rating: '',
    blacklist_notes: '',
    remarks: '',
    contract_attachments: '',
    certificate_attachments: '',
    profile_attachments: ''
  });

  const handleInputChange = (e) => {
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
      const result = await fetchJSON('/api/vendors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      
      if (result.success) {
        alert('Vendor created successfully!');
        router.push(`/vendors/${result.data.id}`);
      } else {
        alert('Error creating vendor: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error creating vendor: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (window.confirm('Are you sure you want to cancel? All entered data will be lost.')) {
      router.push('/vendors');
    }
  };

  const tabs = [
    { id: 'basic', name: 'Basic Information' },
    { id: 'contact', name: 'Contact Information' },
    { id: 'registration', name: 'Registration & Compliance' },
    { id: 'financial', name: 'Financial Information' },
    { id: 'performance', name: 'Performance & History' },
    { id: 'attachments', name: 'Attachments' }
  ];

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full px-4 pt-22">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={handleCancel}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Add New Vendor</h1>
                <p className="text-gray-600">Create a new vendor record</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-2 rounded-md bg-gray-100 text-black hover:bg-gray-200 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-6 py-2 rounded-md flex items-center space-x-2 font-medium text-white bg-gradient-to-r from-[#64126D] to-[#86288F] shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckIcon className="h-5 w-5" />
                <span>{saving ? 'Saving...' : 'Save Vendor'}</span>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6">
            <div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden">
              <nav className="flex min-w-full overflow-x-auto" aria-label="Tabs">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 whitespace-nowrap py-4 px-6 text-center font-semibold text-sm transition-all duration-300 ${
                      activeTab === tab.id
                        ? 'bg-gradient-to-r from-[#64126D] to-[#86288F] text-white shadow-lg'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    {tab.name}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Content */}
          <div className="h-full overflow-y-auto pb-8">
            <form onSubmit={handleSubmit}>
              {/* Basic Information Tab */}
              {activeTab === 'basic' && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Basic Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Vendor ID
                      </label>
                      <input
                        type="text"
                        name="vendor_id"
                        value={formData.vendor_id}
                        onChange={handleInputChange}
                        placeholder="Auto-generated if empty"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-0.5">Format: XXX-MM-YYYY (auto-generated)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Vendor Name *
                      </label>
                      <input
                        type="text"
                        name="vendor_name"
                        value={formData.vendor_name}
                        onChange={handleInputChange}
                        required
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Vendor Type
                      </label>
                      <select
                        name="vendor_type"
                        value={formData.vendor_type}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      >
                        <option value="">Select Type</option>
                        <option value="Supplier">Supplier</option>
                        <option value="Subcontractor">Subcontractor</option>
                        <option value="Consultant">Consultant</option>
                        <option value="OEM">OEM</option>
                        <option value="Service Provider">Service Provider</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Industry / Category
                      </label>
                      <select
                        name="industry_category"
                        value={formData.industry_category}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      >
                        <option value="">Select Category</option>
                        <option value="Civil">Civil</option>
                        <option value="Piping">Piping</option>
                        <option value="Electrical">Electrical</option>
                        <option value="Instrumentation">Instrumentation</option>
                        <option value="Mechanical">Mechanical</option>
                        <option value="HVAC">HVAC</option>
                        <option value="General">General</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Status
                      </label>
                      <select
                        name="status"
                        value={formData.status}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                        <option value="Blacklisted">Blacklisted</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Contact Information Tab */}
              {activeTab === 'contact' && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Contact Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Primary Contact Person
                      </label>
                      <input
                        type="text"
                        name="contact_person"
                        value={formData.contact_person}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Designation
                      </label>
                      <input
                        type="text"
                        name="contact_designation"
                        value={formData.contact_designation}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
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
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
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
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Street Address
                      </label>
                      <input
                        type="text"
                        name="address_street"
                        value={formData.address_street}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        City
                      </label>
                      <input
                        type="text"
                        name="address_city"
                        value={formData.address_city}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        State
                      </label>
                      <input
                        type="text"
                        name="address_state"
                        value={formData.address_state}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Country
                      </label>
                      <input
                        type="text"
                        name="address_country"
                        value={formData.address_country}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        PIN / Postal Code
                      </label>
                      <input
                        type="text"
                        name="address_pin"
                        value={formData.address_pin}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Website
                      </label>
                      <input
                        type="url"
                        name="website"
                        value={formData.website}
                        onChange={handleInputChange}
                        placeholder="https://example.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Registration & Compliance Tab */}
              {activeTab === 'registration' && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Registration & Compliance</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        GST / VAT / Tax ID
                      </label>
                      <input
                        type="text"
                        name="gst_vat_tax_id"
                        value={formData.gst_vat_tax_id}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        PAN / Legal Registration No.
                      </label>
                      <input
                        type="text"
                        name="pan_legal_reg_no"
                        value={formData.pan_legal_reg_no}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        MSME / SSI Registration
                      </label>
                      <input
                        type="text"
                        name="msme_ssi_registration"
                        value={formData.msme_ssi_registration}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        ISO / ASME / API Certifications
                      </label>
                      <input
                        type="text"
                        name="iso_certifications"
                        value={formData.iso_certifications}
                        onChange={handleInputChange}
                        placeholder="e.g., ISO 9001:2015, API 6D"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Other Compliance Documents
                      </label>
                      <textarea
                        name="other_compliance_docs"
                        value={formData.other_compliance_docs}
                        onChange={handleInputChange}
                        rows={3}
                        placeholder="List other compliance documents or certifications"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Financial Information Tab */}
              {activeTab === 'financial' && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Financial Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Bank Name
                      </label>
                      <input
                        type="text"
                        name="bank_name"
                        value={formData.bank_name}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Account Number
                      </label>
                      <input
                        type="text"
                        name="bank_account_no"
                        value={formData.bank_account_no}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        IFSC / SWIFT Code
                      </label>
                      <input
                        type="text"
                        name="ifsc_swift_code"
                        value={formData.ifsc_swift_code}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Currency Preference
                      </label>
                      <select
                        name="currency_preference"
                        value={formData.currency_preference}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      >
                        <option value="INR">INR - Indian Rupee</option>
                        <option value="USD">USD - US Dollar</option>
                        <option value="EUR">EUR - Euro</option>
                        <option value="GBP">GBP - British Pound</option>
                        <option value="AED">AED - UAE Dirham</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Payment Terms
                      </label>
                      <input
                        type="text"
                        name="payment_terms"
                        value={formData.payment_terms}
                        onChange={handleInputChange}
                        placeholder="e.g., 30 days credit, 50% advance"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Credit Limit
                      </label>
                      <input
                        type="number"
                        name="credit_limit"
                        value={formData.credit_limit}
                        onChange={handleInputChange}
                        step="0.01"
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Performance & History Tab */}
              {activeTab === 'performance' && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Performance & History</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Quality Rating (1-5)
                      </label>
                      <input
                        type="number"
                        name="avg_quality_rating"
                        value={formData.avg_quality_rating}
                        onChange={handleInputChange}
                        min="0"
                        max="5"
                        step="0.1"
                        placeholder="0.0"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Delivery Rating (1-5)
                      </label>
                      <input
                        type="number"
                        name="avg_delivery_rating"
                        value={formData.avg_delivery_rating}
                        onChange={handleInputChange}
                        min="0"
                        max="5"
                        step="0.1"
                        placeholder="0.0"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Reliability Rating (1-5)
                      </label>
                      <input
                        type="number"
                        name="avg_reliability_rating"
                        value={formData.avg_reliability_rating}
                        onChange={handleInputChange}
                        min="0"
                        max="5"
                        step="0.1"
                        placeholder="0.0"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Previous Projects Handled
                      </label>
                      <textarea
                        name="previous_projects"
                        value={formData.previous_projects}
                        onChange={handleInputChange}
                        rows={4}
                        placeholder="List previous projects, contracts, or work done..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Blacklist / Warning Notes
                      </label>
                      <textarea
                        name="blacklist_notes"
                        value={formData.blacklist_notes}
                        onChange={handleInputChange}
                        rows={3}
                        placeholder="Any issues, warnings, or blacklist reasons..."
                        className="w-full px-3 py-2 border border-red-300 rounded-md focus:ring-2 focus:ring-red-500 focus:border-transparent bg-red-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        General Remarks / Notes
                      </label>
                      <textarea
                        name="remarks"
                        value={formData.remarks}
                        onChange={handleInputChange}
                        rows={4}
                        placeholder="General notes, observations, or additional information..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Attachments Tab */}
              {activeTab === 'attachments' && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Attachments</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Contract / MOU Attachments
                      </label>
                      <input
                        type="text"
                        name="contract_attachments"
                        value={formData.contract_attachments}
                        onChange={handleInputChange}
                        placeholder="File paths or URLs (comma-separated)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Note: File upload functionality can be integrated later
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Certificate Attachments
                      </label>
                      <input
                        type="text"
                        name="certificate_attachments"
                        value={formData.certificate_attachments}
                        onChange={handleInputChange}
                        placeholder="ISO, PAN, GST, MSME certificates (comma-separated)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Note: File upload functionality can be integrated later
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Company Profile / Brochure
                      </label>
                      <input
                        type="text"
                        name="profile_attachments"
                        value={formData.profile_attachments}
                        onChange={handleInputChange}
                        placeholder="Company profiles, brochures (comma-separated)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Note: File upload functionality can be integrated later
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
