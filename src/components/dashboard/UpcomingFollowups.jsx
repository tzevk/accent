'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  PhoneIcon, 
  EnvelopeIcon, 
  UserIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  CheckCircleIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';

export default function UpcomingFollowups({ limit = 10 }) {
  const [followups, setFollowups] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchFollowups = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/followups');
      const data = await res.json();
      
      if (data.success && data.data) {
        setFollowups(data.data);
      }
    } catch (error) {
      console.error('Error fetching follow-ups:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFollowups();
  }, [fetchFollowups]);

  const getFilteredFollowups = () => {
    // Sort by date (most recent first)
    const sorted = [...followups].sort((a, b) => {
      const dateA = new Date(a.follow_up_date);
      const dateB = new Date(b.follow_up_date);
      return dateB - dateA;
    });
    
    return sorted.slice(0, limit);
  };

  const getTypeIcon = (type) => {
    const t = (type || '').toLowerCase();
    if (t.includes('call') || t.includes('phone')) return PhoneIcon;
    if (t.includes('email') || t.includes('mail')) return EnvelopeIcon;
    if (t.includes('meeting') || t.includes('visit')) return UserIcon;
    return ChatBubbleLeftRightIcon;
  };

  const getStatusColor = (status, followupDate) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const date = new Date(followupDate);
    date.setHours(0, 0, 0, 0);
    
    if (status === 'Completed') return 'bg-green-100 text-green-700 border-green-200';
    if (date.getTime() === now.getTime()) return 'bg-orange-100 text-orange-700 border-orange-200'; // Today
    return 'bg-blue-100 text-blue-700 border-blue-200';
  };

  const getDateLabel = (dateStr) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const date = new Date(dateStr);
    date.setHours(0, 0, 0, 0);
    
    const diffDays = Math.round((date - now) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays <= 7 && diffDays > 0) return `In ${diffDays} days`;
    
    return new Date(dateStr).toLocaleDateString('en-GB', { 
      day: '2-digit', 
      month: 'short' 
    });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric' 
    });
  };

  // Calculate stats
  const stats = {
    total: followups.length,
    completed: followups.filter(f => f.status === 'Completed').length
  };

  const filteredFollowups = getFilteredFollowups();

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-purple-200">
          <div className="h-6 w-48 bg-gray-200 rounded animate-pulse"></div>
        </div>
        <div className="p-6">
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-purple-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-purple-200">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white border border-purple-200 rounded-lg flex items-center justify-center">
              <ChatBubbleLeftRightIcon className="h-5 w-5 text-[#64126D]" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Follow-ups</h3>
              <p className="text-sm text-gray-500">
                {stats.total} total • {stats.completed} completed
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Follow-ups List */}
      <div className="divide-y divide-gray-100">
        {filteredFollowups.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <ChatBubbleLeftRightIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 font-medium">No follow-ups found</p>
            <p className="text-sm text-gray-400 mt-1">
              Follow-ups will appear here when scheduled
            </p>
          </div>
        ) : (
          filteredFollowups.map((followup) => {
            const TypeIcon = getTypeIcon(followup.follow_up_type);
            const dateLabel = getDateLabel(followup.follow_up_date);
            const isToday = dateLabel === 'Today';
            
            return (
              <Link 
                key={followup.id}
                href={`/leads/${followup.lead_id}/edit`}
                className={`block px-6 py-4 hover:bg-purple-50/40 transition-colors cursor-pointer ${
                  isToday ? 'bg-orange-50/30' : ''
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Type Icon */}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isToday ? 'bg-orange-100' : 'bg-purple-100'
                  }`}>
                    <TypeIcon className={`h-5 w-5 ${
                      isToday ? 'text-orange-600' : 'text-[#64126D]'
                    }`} />
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {followup.company_name || 'Unknown Company'}
                        </p>
                        <p className="text-sm text-gray-500 truncate">
                          {followup.contact_name && <span>{followup.contact_name} • </span>}
                          {followup.follow_up_type || 'Follow-up'}
                        </p>
                      </div>
                      
                      {/* Date Badge */}
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                        getStatusColor(followup.status, followup.follow_up_date)
                      }`}>
                        {followup.status === 'Completed' && <CheckCircleIcon className="h-3 w-3 inline mr-1" />}
                        {dateLabel}
                      </span>
                    </div>
                    
                    {/* Description */}
                    {followup.description && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {followup.description}
                      </p>
                    )}
                    
                    {/* Next Action */}
                    {followup.next_action && (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-purple-600">
                        <ArrowRightIcon className="h-3 w-3" />
                        <span className="font-medium">Next:</span>
                        <span className="truncate">{followup.next_action}</span>
                      </div>
                    )}
                    
                    {/* Footer Info */}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <CalendarDaysIcon className="h-3 w-3" />
                        {formatDate(followup.follow_up_date)}
                      </span>
                      {followup.next_follow_up_date && (
                        <span className="flex items-center gap-1">
                          <ClockIcon className="h-3 w-3" />
                          Next: {formatDate(followup.next_follow_up_date)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* Footer */}
      {followups.length > limit && (
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-sm">
          <Link href="/leads" className="text-[#64126D] font-medium hover:underline flex items-center gap-1">
            View all follow-ups
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
