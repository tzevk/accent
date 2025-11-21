'use client';

import { useState, useEffect } from 'react';
import { 
  UserIcon, 
  ClockIcon,
  ComputerDesktopIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

export default function ActiveUsersMonitor() {
  const [activeUsers, setActiveUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActiveUsers();
    const interval = setInterval(fetchActiveUsers, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchActiveUsers = async () => {
    try {
      const response = await fetch('/api/active-users');
      const data = await response.json();
      if (data.success) {
        setActiveUsers(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch active users:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTimeSince = (timestamp) => {
    const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const getStatusColor = (lastActivity) => {
    const seconds = Math.floor((new Date() - new Date(lastActivity)) / 1000);
    if (seconds < 120) return 'bg-green-500'; // Active (< 2 min)
    if (seconds < 600) return 'bg-yellow-500'; // Idle (< 10 min)
    return 'bg-gray-400'; // Inactive (> 10 min)
  };

  const getStatusText = (lastActivity) => {
    const seconds = Math.floor((new Date() - new Date(lastActivity)) / 1000);
    if (seconds < 120) return 'Active';
    if (seconds < 600) return 'Idle';
    return 'Away';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-center py-8">
          <ArrowPathIcon className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserIcon className="w-5 h-5 text-gray-500" />
          <h3 className="text-lg font-semibold text-gray-900">Active Users</h3>
          <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
            {activeUsers.length} online
          </span>
        </div>
        <button
          onClick={fetchActiveUsers}
          className="text-gray-400 hover:text-gray-600"
        >
          <ArrowPathIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
        {activeUsers.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            No active users at the moment
          </div>
        ) : (
          activeUsers.map((user) => (
            <div key={user.user_id} className="px-6 py-4 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <div className="relative">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <UserIcon className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className={`absolute -bottom-1 -right-1 w-3 h-3 ${getStatusColor(user.last_activity)} rounded-full border-2 border-white`}></div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {user.full_name || user.username}
                      </p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        getStatusText(user.last_activity) === 'Active' ? 'bg-green-100 text-green-700' :
                        getStatusText(user.last_activity) === 'Idle' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {getStatusText(user.last_activity)}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                      <div className="flex items-center gap-1">
                        <ClockIcon className="w-3 h-3" />
                        {getTimeSince(user.last_activity)}
                      </div>
                      {user.current_page && (
                        <div className="flex items-center gap-1 truncate">
                          <ComputerDesktopIcon className="w-3 h-3" />
                          <span className="truncate">{user.current_page}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right ml-4">
                  <p className="text-xs text-gray-500">Session</p>
                  <p className="text-sm font-medium text-gray-900">
                    {Math.floor(user.session_duration / 60)}m
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
