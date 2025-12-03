'use client';

import React from 'react';
import StatusBadge from './StatusBadge';
import { ClockIcon, DocumentTextIcon, ChartBarIcon, CursorArrowRaysIcon } from '@heroicons/react/24/outline';

/**
 * UserActivityCard Component
 * Displays comprehensive user activity information including:
 * - Current online status
 * - Last seen time
 * - Current page/activity
 * - Today's statistics (screen time, activities, productivity)
 * 
 * Props:
 * - userData: object with user info
 * - activityData: object with activity stats
 * - compact: boolean (default false)
 */
export default function UserActivityCard({ userData, activityData, compact = false }) {
  const {
    full_name,
    username,
    role_name,
    last_activity,
    current_page,
    session_duration
  } = userData || {};

  const {
    total_screen_time_minutes = 0,
    activities_count = 0,
    productivity_score = 0,
    pages_viewed = 0,
    resources_modified = 0
  } = activityData || {};

  // Format screen time
  const formatScreenTime = (minutes) => {
    if (!minutes || minutes === 0) return '0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  };

  // Format current page
  const formatCurrentPage = (path) => {
    if (!path) return 'Not active';
    const cleanPath = path.replace(/^\//, '').replace(/\//g, ' › ');
    return cleanPath || 'Dashboard';
  };

  // Get productivity color
  const getProductivityColor = (score) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-orange-600';
  };

  if (compact) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge 
                lastActivity={last_activity} 
                size="sm"
                showLabel={false}
              />
              <span className="text-sm font-medium text-gray-900">{full_name || username}</span>
            </div>
            {current_page && (
              <p className="text-xs text-gray-500 truncate">{formatCurrentPage(current_page)}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Today</p>
            <p className="text-sm font-semibold text-gray-900">{formatScreenTime(total_screen_time_minutes)}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{full_name || username}</h3>
            <p className="text-sm text-gray-600">{role_name || 'No role'}</p>
          </div>
          <StatusBadge lastActivity={last_activity} size="md" />
        </div>
      </div>

      {/* Current Activity */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-start gap-2">
          <CursorArrowRaysIcon className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 mb-0.5">Current Activity</p>
            <p className="text-sm font-medium text-gray-900 truncate">
              {formatCurrentPage(current_page)}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 p-4">
        {/* Screen Time */}
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <ClockIcon className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500">Screen Time</p>
            <p className="text-lg font-bold text-gray-900">{formatScreenTime(total_screen_time_minutes)}</p>
            <p className="text-xs text-gray-400">Today</p>
          </div>
        </div>

        {/* Activities */}
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <DocumentTextIcon className="w-4 h-4 text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500">Activities</p>
            <p className="text-lg font-bold text-gray-900">{activities_count}</p>
            <p className="text-xs text-gray-400">{pages_viewed} pages</p>
          </div>
        </div>

        {/* Productivity Score */}
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <ChartBarIcon className="w-4 h-4 text-purple-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500">Productivity</p>
            <p className={`text-lg font-bold ${getProductivityColor(productivity_score)}`}>
              {productivity_score.toFixed(0)}%
            </p>
            <p className="text-xs text-gray-400">Score</p>
          </div>
        </div>

        {/* Resources Modified */}
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <DocumentTextIcon className="w-4 h-4 text-orange-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500">Changes</p>
            <p className="text-lg font-bold text-gray-900">{resources_modified}</p>
            <p className="text-xs text-gray-400">Edits</p>
          </div>
        </div>
      </div>

      {/* Session Duration (if active) */}
      {session_duration && session_duration > 0 && (
        <div className="px-4 py-2 bg-blue-50 border-t border-blue-100">
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-700">Current session</span>
            <span className="text-xs font-semibold text-blue-900">
              {formatScreenTime(Math.floor(session_duration / 60))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mini version for dropdowns/popovers
 */
export function UserActivityMini({ userData, activityData }) {
  const { last_activity, current_page } = userData || {};
  const { total_screen_time_minutes = 0, activities_count = 0 } = activityData || {};

  const formatScreenTime = (minutes) => {
    if (!minutes) return '0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  return (
    <div className="py-2 px-3 bg-gray-50 rounded-md">
      <div className="flex items-center gap-2 mb-2">
        <StatusBadge lastActivity={last_activity} size="sm" />
      </div>
      {current_page && (
        <p className="text-xs text-gray-600 mb-1 truncate">
          📍 {current_page.replace(/^\//, '')}
        </p>
      )}
      <div className="flex items-center gap-3 text-xs text-gray-600">
        <span>⏱️ {formatScreenTime(total_screen_time_minutes)}</span>
        <span>📊 {activities_count} actions</span>
      </div>
    </div>
  );
}
