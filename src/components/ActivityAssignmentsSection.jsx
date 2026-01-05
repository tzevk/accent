'use client';

import { useState, useEffect } from 'react';
import { ClockIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

export default function ActivityAssignmentsSection({ userId }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) return;

    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/users/${userId}/dashboard`);
        const data = await response.json();
        
        // Handle unauthorized gracefully - just don't show this section
        if (response.status === 401 || response.status === 403) {
          setError('unauthorized');
          return;
        }
        
        if (data.success) {
          setDashboardData(data.data);
        } else {
          // For other errors, also hide the section gracefully
          setError(data.error || 'unauthorized');
        }
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError('unauthorized');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [userId]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="animate-pulse bg-white rounded-xl border border-purple-200 p-6">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
            <div className="h-8 bg-gray-200 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    // Hide section completely if unauthorized or error
    return null;
  }

  if (!dashboardData) {
    return (
      <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200 text-center text-gray-500 text-sm">
        No activity data available
      </div>
    );
  }

  const { status_summary, overdue_count } = dashboardData;

  const cards = [
    {
      title: 'In Progress',
      value: status_summary.in_progress || 0,
      icon: ClockIcon,
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-600',
      href: `/users/${userId}/activities?status=In Progress`
    },
    {
      title: 'Not Started',
      value: status_summary.not_started || 0,
      icon: ExclamationTriangleIcon,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600',
      href: `/users/${userId}/activities?status=Not Started`
    },
    {
      title: 'Overdue',
      value: overdue_count || 0,
      icon: ExclamationTriangleIcon,
      iconBg: 'bg-red-50',
      iconColor: 'text-red-600',
      href: `/users/${userId}/activities?overdue=true`,
      alert: overdue_count > 0
    },
    {
      title: 'Completed',
      value: status_summary.completed || 0,
      icon: CheckCircleIcon,
      iconBg: 'bg-green-50',
      iconColor: 'text-green-600',
      href: `/users/${userId}/activities?status=Completed`
    }
  ];

  return (
    <div className="mb-6">
      {/* Section Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">My Activity Assignments</h2>
          <p className="text-sm text-gray-500">Track your assigned tasks and deadlines</p>
        </div>
        <Link
          href={`/users/${userId}/activities`}
          className="text-sm text-[#64126D] hover:text-[#5a1161] font-medium"
        >
          View All →
        </Link>
      </div>

      {/* Activity Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className={`bg-white rounded-xl border ${
              card.alert ? 'border-red-300' : 'border-purple-200'
            } p-6 hover:shadow-md transition-shadow`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`${card.iconBg} p-3 rounded-lg`}>
                <card.icon className={`h-6 w-6 ${card.iconColor}`} />
              </div>
              {card.alert && (
                <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-1 rounded-full">
                  Alert
                </span>
              )}
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{card.value}</div>
            <div className="text-sm text-gray-600">{card.title}</div>
          </Link>
        ))}
      </div>

    </div>
  );
}
