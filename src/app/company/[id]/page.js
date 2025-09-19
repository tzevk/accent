'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeftIcon,
  BuildingOfficeIcon,
  PencilIcon,
  PhoneIcon,
  EnvelopeIcon,
  LinkIcon,
  MapIcon
} from '@heroicons/react/24/outline';

export default function CompanyView({ params }) {
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchCompany = async () => {
      try {
        const companyId = await params;
        const response = await fetch(`/api/companies/${companyId.id}`);
        const result = await response.json();
        
        if (result.success) {
          setCompany(result.data);
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
                  onClick={() => router.push('/company')}
                  className="p-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                </button>
                <div>
                  <h1 className="text-xl font-bold text-accent-primary">
                    {company.company_name}
                  </h1>
                  <p className="text-gray-600 text-sm">Company Details</p>
                </div>
              </div>
              
              <button
                onClick={() => router.push(`/company/${company.id}/edit`)}
                className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-1"
              >
                <PencilIcon className="h-3 w-3" />
                <span>Edit</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="h-full overflow-y-auto pb-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Basic Information */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <BuildingOfficeIcon className="h-5 w-5 mr-2" />
                  Company Information
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Company Name
                    </label>
                    <p className="text-gray-900 font-semibold">{company.company_name}</p>
                  </div>

                  {company.industry && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Industry
                      </label>
                      <p className="text-gray-900">{company.industry}</p>
                    </div>
                  )}

                  {company.company_size && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Company Size
                      </label>
                      <p className="text-gray-900">{company.company_size}</p>
                    </div>
                  )}

                  {company.founded_year && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Founded
                      </label>
                      <p className="text-gray-900">{company.founded_year}</p>
                    </div>
                  )}

                  {company.revenue && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Annual Revenue
                      </label>
                      <p className="text-gray-900">{company.revenue}</p>
                    </div>
                  )}

                  {company.description && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <p className="text-gray-900">{company.description}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Contact Information */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Contact Information
                </h3>
                
                <div className="space-y-4">
                  {company.website && (
                    <div className="flex items-center space-x-3">
                      <LinkIcon className="h-5 w-5 text-gray-400" />
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Website
                        </label>
                        <a 
                          href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {company.website}
                        </a>
                      </div>
                    </div>
                  )}

                  {company.email && (
                    <div className="flex items-center space-x-3">
                      <EnvelopeIcon className="h-5 w-5 text-gray-400" />
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Email
                        </label>
                        <a 
                          href={`mailto:${company.email}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {company.email}
                        </a>
                      </div>
                    </div>
                  )}

                  {company.phone && (
                    <div className="flex items-center space-x-3">
                      <PhoneIcon className="h-5 w-5 text-gray-400" />
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Phone
                        </label>
                        <a 
                          href={`tel:${company.phone}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {company.phone}
                        </a>
                      </div>
                    </div>
                  )}

                  {(company.address || company.city || company.state || company.country) && (
                    <div className="flex items-start space-x-3">
                      <MapIcon className="h-5 w-5 text-gray-400 mt-0.5" />
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Address
                        </label>
                        <div className="text-gray-900">
                          {company.address && (
                            <p>{company.address}</p>
                          )}
                          <p>
                            {[company.city, company.state, company.postal_code].filter(Boolean).join(', ')}
                          </p>
                          {company.country && (
                            <p>{company.country}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Additional Information */}
              {company.notes && (
                <div className="bg-white rounded-lg border border-gray-200 p-6 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Notes
                  </h3>
                  <p className="text-gray-700 whitespace-pre-wrap">{company.notes}</p>
                </div>
              )}

              {/* Metadata */}
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 lg:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Record Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Created
                    </label>
                    <p className="text-gray-900">
                      {new Date(company.created_at).toLocaleDateString()} at {new Date(company.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Last Updated
                    </label>
                    <p className="text-gray-900">
                      {new Date(company.updated_at).toLocaleDateString()} at {new Date(company.updated_at).toLocaleTimeString()}
                    </p>
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
