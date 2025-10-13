'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { fetchJSON } from '@/utils/http';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeftIcon,
  PencilIcon,
  TrashIcon,
  PhoneIcon,
  EnvelopeIcon,
  MapPinIcon,
  BuildingOfficeIcon,
  DocumentTextIcon,
  BanknotesIcon,
  ShieldCheckIcon,
  StarIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline';

export default function VendorDetails({ params }) {
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchVendor = async () => {
      try {
        const vendorId = await params;
  const result = await fetchJSON(`/api/vendors/${vendorId.id}`);
        
        if (result.success) {
          setVendor(result.data);
        } else {
          console.error('Error fetching vendor:', result.error);
          alert('Vendor not found');
          router.push('/vendors');
        }
      } catch (error) {
        console.error('Error:', error);
        alert('Error loading vendor details');
        router.push('/vendors');
      } finally {
        setLoading(false);
      }
    };

    fetchVendor();
  }, [params, router]);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-gray-100 text-gray-800';
      case 'blacklisted':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  const handleEdit = () => {
    router.push(`/vendors/${vendor.id}/edit`);
  };

  const handleDelete = async () => {
    if (window.confirm(`Are you sure you want to delete vendor "${vendor.vendor_name}"?`)) {
      try {
        const result = await fetchJSON(`/api/vendors/${vendor.id}`, { method: 'DELETE' });
        
        if (result.success) {
          alert('Vendor deleted successfully!');
          router.push('/vendors');
        } else {
          alert('Error deleting vendor: ' + result.error);
        }
      } catch (error) {
        console.error('Error:', error);
        alert('Error deleting vendor: ' + error.message);
      }
    }
  };

  const renderRating = (rating) => {
    if (!rating) return 'N/A';
    const stars = [];
    for (let i = 0; i < 5; i++) {
      stars.push(
        <StarIcon
          key={i}
          className={`h-4 w-4 ${i < rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`}
        />
      );
    }
    return <div className="flex items-center space-x-1">{stars}</div>;
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading vendor details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-gray-900">Vendor not found</h2>
            <p className="mt-2 text-gray-600">The vendor you&apos;re looking for doesn&apos;t exist.</p>
            <button
              onClick={() => router.push('/vendors')}
              className="mt-4 bg-accent-primary text-white px-4 py-2 rounded-md hover:bg-accent-primary/90"
            >
              Back to Vendors
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
        <div className="h-full px-4 pt-22">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.back()}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-accent-primary">{vendor.vendor_name}</h1>
                <p className="text-gray-600">Vendor Details</p>
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleEdit}
                className="bg-accent-primary text-white px-4 py-2 rounded-md hover:bg-accent-primary/90 flex items-center space-x-2"
              >
                <PencilIcon className="h-4 w-4" />
                <span>Edit</span>
              </button>
              <button
                onClick={handleDelete}
                className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 flex items-center space-x-2"
              >
                <TrashIcon className="h-4 w-4" />
                <span>Delete</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="h-full overflow-y-auto pb-8">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-7xl">
              {/* Main Details */}
              <div className="xl:col-span-2 space-y-6">
                {/* Basic Information */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <BuildingOfficeIcon className="h-5 w-5 mr-2 text-gray-500" />
                    Basic Information
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vendor ID</label>
                      <p className="text-sm text-gray-900 font-mono">{vendor.vendor_id || `#${vendor.id}`}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Name</label>
                      <p className="text-sm text-gray-900">{vendor.vendor_name}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Type</label>
                      <p className="text-sm text-gray-900">{vendor.vendor_type || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Industry / Category</label>
                      <p className="text-sm text-gray-900">{vendor.industry_category || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(vendor.status)}`}>
                        {vendor.status || 'Active'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <EnvelopeIcon className="h-5 w-5 mr-2 text-gray-500" />
                    Contact Information
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                      <p className="text-sm text-gray-900">{vendor.contact_person || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
                      <p className="text-sm text-gray-900">{vendor.contact_designation || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <p className="text-sm text-gray-900 flex items-center">
                        <PhoneIcon className="h-4 w-4 mr-1 text-gray-400" />
                        {vendor.phone || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <p className="text-sm text-gray-900 flex items-center">
                        <EnvelopeIcon className="h-4 w-4 mr-1 text-gray-400" />
                        {vendor.email || 'N/A'}
                      </p>
                    </div>
                    <div className="lg:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                      <p className="text-sm text-gray-900 flex items-start">
                        <MapPinIcon className="h-4 w-4 mr-1 mt-0.5 text-gray-400 flex-shrink-0" />
                        <span>
                          {[
                            vendor.address_street,
                            vendor.address_city,
                            vendor.address_state,
                            vendor.address_country,
                            vendor.address_pin
                          ].filter(Boolean).join(', ') || 'N/A'}
                        </span>
                      </p>
                    </div>
                    <div className="lg:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                      <p className="text-sm text-gray-900 flex items-center">
                        <GlobeAltIcon className="h-4 w-4 mr-1 text-gray-400" />
                        {vendor.website ? (
                          <a href={vendor.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                            {vendor.website}
                          </a>
                        ) : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Registration & Compliance */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <ShieldCheckIcon className="h-5 w-5 mr-2 text-gray-500" />
                    Registration & Compliance
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">GST / VAT / Tax ID</label>
                      <p className="text-sm text-gray-900">{vendor.gst_vat_tax_id || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">PAN / Legal Reg No.</label>
                      <p className="text-sm text-gray-900">{vendor.pan_legal_reg_no || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">MSME / SSI Registration</label>
                      <p className="text-sm text-gray-900">{vendor.msme_ssi_registration || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">ISO / ASME / API Certifications</label>
                      <p className="text-sm text-gray-900">{vendor.iso_certifications || 'N/A'}</p>
                    </div>
                    {vendor.other_compliance_docs && (
                      <div className="lg:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Other Compliance Docs</label>
                        <p className="text-sm text-gray-900">{vendor.other_compliance_docs}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Financial Information */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <BanknotesIcon className="h-5 w-5 mr-2 text-gray-500" />
                    Financial Information
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                      <p className="text-sm text-gray-900">{vendor.bank_name || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                      <p className="text-sm text-gray-900">{vendor.bank_account_no || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">IFSC / SWIFT Code</label>
                      <p className="text-sm text-gray-900">{vendor.ifsc_swift_code || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Currency Preference</label>
                      <p className="text-sm text-gray-900">{vendor.currency_preference || 'INR'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
                      <p className="text-sm text-gray-900">{vendor.payment_terms || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Credit Limit</label>
                      <p className="text-sm text-gray-900">
                        {vendor.credit_limit ? `${vendor.currency_preference || 'INR'} ${parseFloat(vendor.credit_limit).toLocaleString()}` : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Performance & Rating */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                    <StarIcon className="h-5 w-5 mr-2 text-gray-500" />
                    Performance & Rating
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Quality Rating</label>
                      {renderRating(vendor.avg_quality_rating)}
                      <p className="text-xs text-gray-500 mt-1">{vendor.avg_quality_rating || 'Not rated'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Rating</label>
                      {renderRating(vendor.avg_delivery_rating)}
                      <p className="text-xs text-gray-500 mt-1">{vendor.avg_delivery_rating || 'Not rated'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reliability Rating</label>
                      {renderRating(vendor.avg_reliability_rating)}
                      <p className="text-xs text-gray-500 mt-1">{vendor.avg_reliability_rating || 'Not rated'}</p>
                    </div>
                  </div>
                </div>

                {/* Blacklist / Warning Notes */}
                {vendor.blacklist_notes && (
                  <div className="bg-red-50 rounded-lg border border-red-200 p-6">
                    <h3 className="text-lg font-medium text-red-900 mb-2">⚠️ Warning Notes</h3>
                    <p className="text-sm text-red-800">{vendor.blacklist_notes}</p>
                  </div>
                )}

                {/* Remarks */}
                {vendor.remarks && (
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-medium text-gray-900 mb-2 flex items-center">
                      <DocumentTextIcon className="h-5 w-5 mr-2 text-gray-500" />
                      Remarks
                    </h3>
                    <p className="text-sm text-gray-900">{vendor.remarks}</p>
                  </div>
                )}

                {/* Timeline */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Timeline</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">Created:</span>
                      <span className="text-gray-900">{formatDate(vendor.created_at)}</span>
                    </div>
                    {vendor.updated_at && vendor.updated_at !== vendor.created_at && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">Last Updated:</span>
                        <span className="text-gray-900">{formatDate(vendor.updated_at)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
