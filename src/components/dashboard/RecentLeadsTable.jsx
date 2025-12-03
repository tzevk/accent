'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  EyeIcon, 
  ArrowLeftIcon, 
  ArrowRightIcon,
  ChevronDownIcon 
} from '@heroicons/react/24/outline';

export default function RecentLeadsTable() {
  const [leadsList, setLeadsList] = useState([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsPage, setLeadsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [followupsByLead, setFollowupsByLead] = useState({});
  const rowsPerPage = 10;

  const fetchLeadsPage = useCallback(async (page) => {
    try {
      setLoading(true);

      const res = await fetch(
        `/api/leads?page=${page}&limit=${rowsPerPage}&sortBy=${encodeURIComponent(sortBy)}&sortOrder=${encodeURIComponent(sortOrder)}`
      );
      const data = await res.json();

      if (data.success) {
        const rawLeads = Array.isArray(data.data?.leads) ? data.data.leads : [];
        const normalized = rawLeads.map(l => ({
          id: l.id ?? l.lead_id ?? null,
          lead_id: l.lead_id ?? null,
          city: l.city ?? l.location ?? '',
          contact_name: l.contact_name ?? l.director ?? '',
          enquiry_status: l.enquiry_status ?? l.status ?? '',
          enquiry_date: l.enquiry_date ?? l.deadline ?? l.created_at ?? null,
          created_at: l.created_at ?? null,
        }));

        setLeadsList(normalized);
        setLeadsTotal(Number(data.data.pagination?.total || normalized.length || 0));

        // Fetch followups count
        try {
          const fuRes = await fetch('/api/followups');
          const fuData = await fuRes.json();
          const map = {};
          (fuData.data || []).forEach(f => {
            map[f.lead_id] = (map[f.lead_id] || 0) + 1;
          });
          setFollowupsByLead(map);
        } catch (e) {
          console.warn('Followups fetch failed:', e);
        }
      } else {
        setLeadsList([]);
        setLeadsTotal(0);
      }
    } catch (error) {
      console.error('Failed to fetch leads:', error);
      setLeadsList([]);
      setLeadsTotal(0);
    } finally {
      setLoading(false);
    }
  }, [sortBy, sortOrder]);

  useEffect(() => {
    fetchLeadsPage(leadsPage);
  }, [leadsPage, fetchLeadsPage]);

  const toggleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
    setLeadsPage(1);
  };

  const getStatusColor = (status) => {
    const s = (status || '').toLowerCase();
    if (s.includes('won') || s.includes('success')) return 'bg-green-100 text-green-800';
    if (s.includes('lost') || s.includes('rejected')) return 'bg-red-100 text-red-800';
    if (s.includes('discussion') || s.includes('pending')) return 'bg-yellow-100 text-yellow-800';
    if (s.includes('proposal')) return 'bg-blue-100 text-blue-800';
    return 'bg-gray-100 text-gray-800';
  };

  if (loading && leadsList.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="h-96 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Recent Leads</h3>
        <p className="text-sm text-gray-500 mt-1">Latest inquiries and opportunities</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th 
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => toggleSort('created_at')}
              >
                <div className="flex items-center gap-1">
                  Date
                  <ChevronDownIcon className={`w-4 h-4 transition-transform ${sortBy === 'created_at' && sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                </div>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Contact Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                City
              </th>
              <th 
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => toggleSort('enquiry_status')}
              >
                <div className="flex items-center gap-1">
                  Status
                  <ChevronDownIcon className={`w-4 h-4 transition-transform ${sortBy === 'enquiry_status' && sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                </div>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Followups
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {leadsList.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                  No leads found
                </td>
              </tr>
            ) : (
              leadsList.map((lead) => (
                <tr key={lead.id || lead.lead_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {lead.enquiry_date ? new Date(lead.enquiry_date).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{lead.contact_name || '-'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {lead.city || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(lead.enquiry_status)}`}>
                      {lead.enquiry_status || 'New'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {followupsByLead[lead.id] || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link 
                      href={`/leads/${lead.id || lead.lead_id}`}
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                    >
                      <EyeIcon className="w-4 h-4" />
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {leadsTotal > rowsPerPage && (
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-700">
            Showing {(leadsPage - 1) * rowsPerPage + 1} to {Math.min(leadsPage * rowsPerPage, leadsTotal)} of{' '}
            {leadsTotal} leads
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setLeadsPage(p => Math.max(1, p - 1))}
              disabled={leadsPage === 1}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              Previous
            </button>
            <button
              onClick={() => setLeadsPage(p => p + 1)}
              disabled={leadsPage * rowsPerPage >= leadsTotal}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              Next
              <ArrowRightIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
