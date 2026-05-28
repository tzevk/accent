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
  BanknotesIcon,
  MagnifyingGlassIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BuildingLibraryIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

export default function BankMaster() {
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('list');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const searchDebounceRef = useRef(null);

  const [formData, setFormData] = useState({
    BankCode: '',
    BankName: '',
    IFSC_Prefix: '',
    SWIFT_Code: '',
    LEI_Code: '',
    HeadOfficeAddress: '',
    IsActive: true,
  });

  const fetchBanks = async (searchValue) => {
    try {
      setLoading(true);
      const search =
        typeof searchValue !== 'undefined' ? searchValue : debouncedSearchTerm;
      const response = await fetch(`/api/masters/banks`);
      const result = await response.json();

      if (result.success) {
        let filtered = result.data || [];
        if (search) {
          filtered = filtered.filter(
            (b) =>
              b.BankName.toLowerCase().includes(search.toLowerCase()) ||
              b.BankCode.toLowerCase().includes(search.toLowerCase())
          );
        }
        setBanks(filtered);
      }
    } catch (error) {
      console.error('Error fetching banks:', error);
      setBanks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'list') {
      fetchBanks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchTerm, activeTab]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 350);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchTerm]);

  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const url = editingId
        ? `/api/masters/banks?id=${editingId}`
        : '/api/masters/banks';

      const response = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success) {
        alert(
          editingId ? 'Bank updated successfully!' : 'Bank added successfully!'
        );
        resetForm();
        fetchBanks();
        setActiveTab('list');
      } else {
        alert('Error: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error saving bank');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (bank) => {
    setFormData({
      BankCode: bank.BankCode || '',
      BankName: bank.BankName || '',
      IFSC_Prefix: bank.IFSC_Prefix || '',
      SWIFT_Code: bank.SWIFT_Code || '',
      LEI_Code: bank.LEI_Code || '',
      HeadOfficeAddress: bank.HeadOfficeAddress || '',
      IsActive: bank.IsActive !== false,
    });
    setEditingId(bank.BankID);
    setActiveTab('add');
  };

  const handleDelete = async (id, bankName) => {
    if (!confirm(`Are you sure you want to delete "${bankName}"?`)) return;

    try {
      const response = await fetch(`/api/masters/banks?id=${id}`, {
        method: 'DELETE',
      });
      const result = await response.json();

      if (result.success) {
        alert('Bank deleted successfully!');
        fetchBanks();
      } else {
        alert('Error deleting bank: ' + result.error);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error deleting bank');
    }
  };

  const resetForm = () => {
    setFormData({
      BankCode: '',
      BankName: '',
      IFSC_Prefix: '',
      SWIFT_Code: '',
      LEI_Code: '',
      HeadOfficeAddress: '',
      IsActive: true,
    });
    setEditingId(null);
  };

  const renderBanksList = () => (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <span className="h-10 w-10 rounded-full bg-[#64126D] border border-purple-200 flex items-center justify-center text-white shadow-sm">
              <BuildingLibraryIcon className="h-5 w-5" />
            </span>
            <div className="ml-4">
              <p className="text-sm font-medium text-black">Total Banks</p>
              <p className="text-2xl font-semibold text-gray-900">
                {banks.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center">
            <BanknotesIcon className="h-8 w-8 text-green-500" />
            <div className="ml-4">
              <p className="text-sm font-medium text-black">Active Banks</p>
              <p className="text-2xl font-semibold text-gray-900">
                {banks.filter((b) => b.IsActive !== false).length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search banks by name or code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (searchDebounceRef.current)
                      clearTimeout(searchDebounceRef.current);
                    setDebouncedSearchTerm(searchTerm.trim());
                    fetchBanks(searchTerm.trim());
                  }
                }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#64126D]"></div>
            <p className="mt-2 text-gray-600">Loading banks...</p>
          </div>
        ) : banks.length === 0 ? (
          <div className="p-8 text-center">
            <BuildingLibraryIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">
              No banks found
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by adding a new bank.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Sr
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Bank Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Routing Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-black uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {banks.map((bank, index) => (
                  <tr key={bank.BankID} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {index + 1}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="h-10 w-10 flex-shrink-0 bg-gradient-to-r from-[#64126D] to-[#86288F] rounded-full flex items-center justify-center text-white font-medium">
                          {bank.BankName?.substring(0, 2).toUpperCase() || 'BK'}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {bank.BankName}
                          </div>
                          <div className="text-sm text-gray-500">
                            Code: {bank.BankCode}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        IFSC Prefix: {bank.IFSC_Prefix || '-'}
                      </div>
                      <div className="text-sm text-gray-500">
                        SWIFT: {bank.SWIFT_Code || '-'}
                      </div>
                      {bank.LEI_Code && (
                        <div className="text-xs text-gray-400">
                          LEI: {bank.LEI_Code}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          bank.IsActive !== false
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {bank.IsActive !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => handleEdit(bank)}
                          className="p-1 text-gray-400 hover:text-blue-600 rounded-full transition-colors"
                          title="Edit Bank"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() =>
                            handleDelete(bank.BankID, bank.BankName)
                          }
                          className="p-1 text-gray-400 hover:text-red-600 rounded-full transition-colors"
                          title="Delete Bank"
                        >
                          <TrashIcon className="h-5 w-5" />
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
    </div>
  );

  const renderAddBankForm = () => (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {editingId ? 'Edit Bank' : 'Add New Bank'}
          </h3>
          <p className="text-sm text-gray-600 mt-1">Enter bank details</p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => {
              setActiveTab('list');
              resetForm();
            }}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-2"
          >
            <XMarkIcon className="h-4 w-4" />
            <span>Cancel</span>
          </button>
          <button
            type="submit"
            form="add-bank-form"
            disabled={submitting}
            className="px-4 py-2 text-sm text-white bg-gradient-to-r from-[#64126D] to-[#86288F] rounded-md hover:from-[#86288F] hover:to-[#64126D] transition-all flex items-center space-x-2 disabled:opacity-50 shadow-lg"
          >
            <CheckIcon className="h-4 w-4" />
            <span>{submitting ? 'Saving...' : 'Save Bank'}</span>
          </button>
        </div>
      </div>

      <form id="add-bank-form" onSubmit={handleSubmit} className="p-6">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Bank Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="BankCode"
                value={formData.BankCode}
                onChange={handleFormChange}
                maxLength="10"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent uppercase"
                placeholder="e.g., HDFC"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Bank Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="BankName"
                value={formData.BankName}
                onChange={handleFormChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
                placeholder="e.g., HDFC Bank Ltd"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                IFSC Prefix
              </label>
              <input
                type="text"
                name="IFSC_Prefix"
                value={formData.IFSC_Prefix}
                onChange={handleFormChange}
                maxLength="4"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent uppercase"
                placeholder="e.g., HDFC"
              />
              <p className="mt-1 text-xs text-gray-500">
                First 4 characters of the IFSC code
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                SWIFT Code
              </label>
              <input
                type="text"
                name="SWIFT_Code"
                value={formData.SWIFT_Code}
                onChange={handleFormChange}
                maxLength="11"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent uppercase"
                placeholder="e.g., HDFCXXXX"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                LEI Code
              </label>
              <input
                type="text"
                name="LEI_Code"
                value={formData.LEI_Code}
                onChange={handleFormChange}
                maxLength="20"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent uppercase"
              />
              <p className="mt-1 text-xs text-gray-500">
                Legal Entity Identifier for regulatory compliance
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Head Office Address
            </label>
            <textarea
              name="HeadOfficeAddress"
              value={formData.HeadOfficeAddress}
              onChange={handleFormChange}
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
              placeholder="Full physical address of the main headquarters"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="IsActive"
              name="IsActive"
              checked={formData.IsActive}
              onChange={handleFormChange}
              className="h-4 w-4 text-[#64126D] focus:ring-[#64126D] border-gray-300 rounded"
            />
            <label
              htmlFor="IsActive"
              className="ml-2 block text-sm text-gray-900"
            >
              Active Bank
            </label>
          </div>
        </div>
      </form>
    </div>
  );

  return (
    <AccessGuard resource="companies" permission="read">
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Bank Master</h1>
              <p className="mt-1 text-sm text-gray-500">
                Manage banking partners and institutional details
              </p>
            </div>
            {activeTab === 'list' && (
              <div className="mt-4 sm:mt-0 flex gap-3">
                <button
                  onClick={() => {
                    setActiveTab('add');
                    resetForm();
                  }}
                  className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] shadow-sm transition-all"
                >
                  <PlusIcon className="h-5 w-5 mr-2 -ml-1" />
                  Add Bank
                </button>
              </div>
            )}
          </div>

          {activeTab === 'list' ? renderBanksList() : renderAddBankForm()}
        </main>
      </div>
    </AccessGuard>
  );
}
