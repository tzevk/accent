'use client';

import { useState, useEffect } from 'react';
import { ClockIcon, CheckCircleIcon, ExclamationTriangleIcon, FolderIcon } from '@heroicons/react/24/outline';
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
        console.log('[ActivityAssignments] Fetching for userId:', userId);
        const response = await fetch(`/api/users/${userId}/dashboard`);
        const data = await response.json();
        
        console.log('[ActivityAssignments] API response:', data.success, data.data?.active_projects?.length || 0, 'projects');
        console.log('[ActivityAssignments] Active Projects:', JSON.stringify(data.data?.active_projects, null, 2));
        console.log('[ActivityAssignments] Status Summary:', data.data?.status_summary);
        
        if (data.success) {
          setDashboardData(data.data);
        } else {
          setError(data.error || 'Failed to load dashboard data');
        }
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError('Failed to load activities');
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
    // Show error message
    return (
      <div className="mb-6 p-4 bg-red-50 rounded-xl border border-red-200 text-center text-red-600 text-sm">
        Error loading activities: {error}
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200 text-center text-gray-500 text-sm">
        No activity data available
      </div>
    );
  }

  const { status_summary, overdue_count, active_projects } = dashboardData;

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

      {/* Upcoming Deadlines & Active Projects Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Deadlines */}
        <div className="bg-white rounded-xl border border-purple-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Deadlines</h3>
          {dashboardData.upcoming_deadlines && dashboardData.upcoming_deadlines.length > 0 ? (
            <div className="space-y-3">
              {dashboardData.upcoming_deadlines.slice(0, 5).map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 truncate">
                      {activity.activity_name}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {activity.project_title || activity.project_name || 'No project'}
                    </div>
                  </div>
                  <div className="ml-4 flex-shrink-0 text-right">
                    <div
                      className={`text-xs font-medium ${
                        activity.days_remaining <= 1
                          ? 'text-red-600'
                          : activity.days_remaining <= 3
                          ? 'text-amber-600'
                          : 'text-gray-600'
                      }`}
                    >
                      {activity.days_remaining === 0
                        ? 'Today'
                        : activity.days_remaining === 1
                        ? '1 day'
                        : `${activity.days_remaining} days`}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(activity.due_date).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">
              No upcoming deadlines in the next 7 days
            </div>
          )}
        </div>

        {/* Active Projects */}
        <div className="bg-white rounded-xl border border-purple-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Assigned Projects</h3>
          {active_projects && active_projects.length > 0 ? (
            <div className="space-y-3">
              {active_projects.slice(0, 5).map((project) => (
                <Link
                  key={project.project_id}
                  href={`/projects/${project.project_id}`}
                  className="block p-4 rounded-lg bg-gradient-to-r from-purple-50 to-white hover:from-purple-100 border border-purple-100 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="bg-[#64126D] p-2.5 rounded-lg">
                        <FolderIcon className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-900 truncate">
                          {project.project_title || project.name}
                        </div>
                        <div className="text-xs text-gray-500 truncate mt-0.5">
                          {project.client_name} {project.project_code && `• ${project.project_code}`}
                        </div>
                      </div>
                    </div>
                    <div className="ml-4 text-right flex-shrink-0">
                      <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-purple-100 text-[#64126D] text-xs font-medium">
                        {project.total_activities} {project.total_activities === 1 ? 'task' : 'tasks'}
                      </div>
                      {project.overdue > 0 && (
                        <div className="text-xs text-red-600 mt-1 font-medium">
                          ⚠ {project.overdue} overdue
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">
              No projects assigned yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
