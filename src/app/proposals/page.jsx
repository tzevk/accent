'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { 
  DocumentTextIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon
} from '@heroicons/react/24/outline';
import { ArrowRightIcon } from '@heroicons/react/24/outline';

export default function Proposals() {
  const router = useRouter();
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [exporting, setExporting] = useState(false);

  // Fetch proposals data
  useEffect(() => {
    fetchProposals();
  }, []);

  const fetchProposals = async () => {
    try {
      setLoading(true);
      // API call will be implemented when you provide the form fields
      const response = await fetch('/api/proposals');
      if (response.ok) {
        const data = await response.json();
        setProposals(data.proposals || []);
      }
    } catch (error) {
      console.error('Error fetching proposals:', error);
      setProposals([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this proposal?')) return;
    
    try {
      const response = await fetch(`/api/proposals/${id}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setProposals(proposals.filter(proposal => proposal.id !== id));
        alert('Proposal deleted successfully');
      } else {
        alert('Failed to delete proposal');
      }
    } catch (error) {
      console.error('Error deleting proposal:', error);
      alert('Error deleting proposal');
    }
  };

  const handleConvert = async (proposal) => {
    try {
      if (!proposal?.id) return alert('Proposal not loaded');
      if (!window.confirm(`Convert proposal "${proposal.proposal_title || proposal.title}" to a project?`)) return;

      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // minimal overrides; server will copy fields
          start_date: new Date().toISOString().split('T')[0],
          budget: proposal.value || null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Conversion failed');

      // Update local list: mark as converted
      setProposals(prev => prev.map(p => p.id === proposal.id ? { ...p, status: 'CONVERTED', project_id: data.data.project.project_id } : p));

      alert('Proposal converted to project. Redirecting to project...');
      const proj = data?.data?.project;
      const targetId = proj?.project_id ?? proj?.project_code ?? proj?.id;
      if (!targetId) {
        alert('Project created but no redirect id returned. Open Projects list to view it.');
      } else {
        router.push(`/projects/${targetId}/edit`);
      }
    } catch (err) {
      console.error('Convert error:', err);
      alert('Failed to convert proposal: ' + (err.message || err));
    }
  };

  // Filter proposals based on search and status
  const filteredProposals = proposals.filter(proposal => {
    const matchesSearch = !searchQuery || 
      ((proposal.proposal_title ?? proposal.title) || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (proposal.client ?? '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || proposal.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });
  const [downloadingId, setDownloadingId] = useState(null);

  const downloadProposal = async (id) => {
    try {
      setDownloadingId(id);
      const res = await fetch(`/api/proposals/pdf?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`PDF export failed (${res.status})`);

      const contentDisposition = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
      let filename = `proposal_${id}.pdf`;
      if (contentDisposition) {
        const match = /filename\*?=([^;]+)/i.exec(contentDisposition);
        if (match) {
          filename = decodeURIComponent(match[1].replace(/UTF-8''/i, '').replace(/["']/g, '').trim());
        }
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      // Success toast
      showToast(`✅ PDF download complete: ${filename}`);
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to download PDF. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const exportAllProposals = async () => {
    try {
      setExporting(true);
      const res = await fetch('/api/proposals/pdf?all=true');
      if (!res.ok) throw new Error(`Export failed (${res.status})`);

      const contentDisposition = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
      let filename = `all_proposals_${new Date().toISOString().split('T')[0]}.pdf`;
      if (contentDisposition) {
        const match = /filename\*?=([^;]+)/i.exec(contentDisposition);
        if (match) {
          filename = decodeURIComponent(match[1].replace(/UTF-8''/i, '').replace(/["']/g, '').trim());
        }
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      showToast(`✅ Exported ${proposals.length} proposals to PDF: ${filename}`);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export proposals. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const showToast = (message) => {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.background = '#1E293B';
    toast.style.color = 'white';
    toast.style.padding = '10px 16px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)';
    toast.style.zIndex = 9999;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      
      {/* Fixed header section */}
      <div className="flex-shrink-0 pt-24 px-8 pb-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-black mb-2">
            Proposals Management
          </h1>
          <p className="text-gray-600">
            Manage and track your business proposals
          </p>
        </div>
        
        {/* Tab Navigation - Fixed */}
        <div className="flex border-b border-gray-200 bg-white rounded-t-lg px-6 pt-4">
          <button
            className="px-6 py-3 text-sm font-medium border-b-2 border-black text-black bg-gray-50 rounded-t-md transition-colors"
          >
            <DocumentTextIcon className="h-5 w-5 inline mr-2" />
            All Proposals ({proposals.length})
          </button>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white rounded-t-lg shadow-sm min-h-full">
          
          {/* Search and Filters */}
          <div className="px-6 pt-6 pb-4 border-b border-gray-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
              <div className="flex-1 max-w-lg">
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <input
                    type="text"
                    placeholder="Search proposals..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-purple focus:border-transparent"
                  />
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <FunnelIcon className="h-5 w-5 text-gray-400" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-accent-purple focus:border-transparent"
                  >
                    <option value="all">All Status</option>
                    <option value="draft">Draft</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                
                                <button className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 space-x-2">
                  <ArrowUpTrayIcon className="h-4 w-4" />
                  <span>Import</span>
                </button>
                
                <button 
                  onClick={exportAllProposals}
                  disabled={exporting}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 space-x-2 disabled:opacity-50"
                >
                  {exporting ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-700"></div>
                  ) : (
                    <ArrowDownTrayIcon className="h-4 w-4" />
                  )}
                  <span>Export All PDF</span>
                </button>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="px-6 py-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <div className="flex items-center">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <DocumentTextIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Total Proposals</p>
                    <p className="text-2xl font-bold text-gray-900">{proposals.length}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <div className="flex items-center">
                  <div className="p-2 bg-yellow-100 rounded-lg">
                    <DocumentTextIcon className="h-6 w-6 text-yellow-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Pending</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {proposals.filter(p => p.status === 'pending').length}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <div className="flex items-center">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <DocumentTextIcon className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Approved</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {proposals.filter(p => p.status === 'approved').length}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <div className="flex items-center">
                  <div className="p-2 bg-red-100 rounded-lg">
                    <DocumentTextIcon className="h-6 w-6 text-red-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-500">Rejected</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {proposals.filter(p => p.status === 'rejected').length}
                    </p>
                  </div>
                </div>
              </div>
            </div>

          {/* Table */}
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Proposal ID *
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Client
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created Date
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan="5" className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#64126D]"></div>
                          <span className="ml-2 text-gray-500">Loading proposals...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredProposals.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="px-6 py-12 text-center">
                        <DocumentTextIcon className="mx-auto h-12 w-12 text-gray-400" />
                        <h3 className="mt-2 text-sm font-medium text-gray-900">No proposals</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          Proposals are generated from leads using the &quot;Convert to Proposal&quot; button.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredProposals.map((proposal) => (
                      <tr key={proposal.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10">
                              <div className="h-10 w-10 rounded-lg bg-[#64126D] flex items-center justify-center">
                                <DocumentTextIcon className="h-6 w-6 text-white" />
                              </div>
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">
                                {proposal.proposal_id || proposal.proposal_number || `#${proposal.id}`}
                              </div>
                              <div className="text-sm text-gray-500">
                                {proposal.proposal_title || proposal.title || 'Untitled Proposal'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{proposal.client_name || proposal.client || '—'}</div>
                          <div className="text-sm text-gray-500">{proposal.contact_email || ''}</div>
                        </td>
                        {/* Value column removed as requested */}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            proposal.status === 'approved' ? 'bg-green-100 text-green-800' :
                            proposal.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            proposal.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {proposal.status ? proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1) : 'Draft'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {proposal.created_at ? new Date(proposal.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex justify-end space-x-2">
                            <button 
                              onClick={() => router.push(`/proposals/${proposal.id}`)}
                              className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
                              title="View Proposal"
                            >
                              <EyeIcon className="h-4 w-4" />
                            </button>
                            <button 
                              onClick={() => router.push(`/proposals/${proposal.id}/edit`)}
                              className="p-2 text-[#64126D] hover:text-[#86288F] hover:bg-purple-50 rounded-lg transition-colors"
                              title="Edit Proposal"
                            >
                              <PencilIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleConvert(proposal)}
                              className="p-2 text-green-600 hover:text-green-800 hover:bg-green-50 rounded-lg transition-colors"
                              title="Convert to Project"
                            >
                              <ArrowRightIcon className="h-4 w-4" />
                            </button>
                            <button 
                              onClick={() => handleDelete(proposal.id)}
                              className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete Proposal"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {filteredProposals.length > 0 && (
            <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6 mt-6 rounded-lg shadow-sm">
              <div className="flex-1 flex justify-between sm:hidden">
                <button className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                  Previous
                </button>
                <button className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                  Next
                </button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing <span className="font-medium">1</span> to{' '}
                    <span className="font-medium">{filteredProposals.length}</span> of{' '}
                    <span className="font-medium">{filteredProposals.length}</span> results
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                    <button className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                      Previous
                    </button>
                    <button className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
                      1
                    </button>
                    <button className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                      Next
                    </button>
                  </nav>
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
