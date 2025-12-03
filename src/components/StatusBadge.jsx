'use client';

import React from 'react';

/**
 * StatusBadge Component
 * Displays user online/idle/offline status with color-coded indicators
 * 
 * Props:
 * - status: 'online' | 'idle' | 'offline' | 'away'
 * - lastActivity: ISO timestamp string (optional)
 * - showLabel: boolean (default true)
 * - size: 'sm' | 'md' | 'lg' (default 'md')
 * - animated: boolean (default true for online)
 */
export default function StatusBadge({ 
  status, 
  lastActivity, 
  showLabel = true, 
  size = 'md',
  animated = true 
}) {
  // Calculate status from lastActivity if not provided
  const getStatus = () => {
    if (status) return status;
    
    if (!lastActivity) return 'offline';
    
    const seconds = Math.floor((new Date() - new Date(lastActivity)) / 1000);
    if (seconds < 120) return 'online'; // Active (< 2 min)
    if (seconds < 600) return 'idle'; // Idle (< 10 min)
    return 'offline'; // Away (> 10 min)
  };

  const currentStatus = getStatus();

  // Size configurations
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-2.5 h-2.5',
    lg: 'w-3 h-3'
  };

  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  };

  // Status configurations
  const statusConfig = {
    online: {
      color: 'bg-green-500',
      textColor: 'text-green-700',
      bgColor: 'bg-green-50',
      label: 'Online',
      animate: animated
    },
    idle: {
      color: 'bg-yellow-500',
      textColor: 'text-yellow-700',
      bgColor: 'bg-yellow-50',
      label: 'Idle',
      animate: false
    },
    offline: {
      color: 'bg-gray-400',
      textColor: 'text-gray-600',
      bgColor: 'bg-gray-50',
      label: 'Offline',
      animate: false
    },
    away: {
      color: 'bg-orange-400',
      textColor: 'text-orange-700',
      bgColor: 'bg-orange-50',
      label: 'Away',
      animate: false
    }
  };

  const config = statusConfig[currentStatus] || statusConfig.offline;

  // Format last seen time
  const getLastSeenText = () => {
    if (!lastActivity || currentStatus === 'online') return null;
    
    const seconds = Math.floor((new Date() - new Date(lastActivity)) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const lastSeenText = getLastSeenText();

  if (!showLabel) {
    return (
      <span 
        className={`
          ${sizeClasses[size]} 
          ${config.color} 
          rounded-full 
          inline-block
          ${config.animate ? 'animate-pulse' : ''}
        `}
        title={`${config.label}${lastSeenText ? ` - ${lastSeenText}` : ''}`}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span 
        className={`
          ${sizeClasses[size]} 
          ${config.color} 
          rounded-full
          ${config.animate ? 'animate-pulse' : ''}
        `}
      />
      <div className="flex flex-col">
        <span className={`${textSizeClasses[size]} font-medium ${config.textColor}`}>
          {config.label}
        </span>
        {lastSeenText && (
          <span className={`${size === 'sm' ? 'text-xs' : 'text-xs'} text-gray-500`}>
            {lastSeenText}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Compact version for table cells
 */
export function StatusDot({ status, lastActivity }) {
  return (
    <StatusBadge 
      status={status}
      lastActivity={lastActivity}
      showLabel={false}
      size="md"
      animated={true}
    />
  );
}

/**
 * Badge version with background
 */
export function StatusBadgeWithBg({ status, lastActivity }) {
  const getStatus = () => {
    if (status) return status;
    if (!lastActivity) return 'offline';
    
    const seconds = Math.floor((new Date() - new Date(lastActivity)) / 1000);
    if (seconds < 120) return 'online';
    if (seconds < 600) return 'idle';
    return 'offline';
  };

  const currentStatus = getStatus();

  const statusConfig = {
    online: {
      bgColor: 'bg-green-100',
      textColor: 'text-green-800',
      dotColor: 'bg-green-500',
      label: 'Online'
    },
    idle: {
      bgColor: 'bg-yellow-100',
      textColor: 'text-yellow-800',
      dotColor: 'bg-yellow-500',
      label: 'Idle'
    },
    offline: {
      bgColor: 'bg-gray-100',
      textColor: 'text-gray-800',
      dotColor: 'bg-gray-400',
      label: 'Offline'
    },
    away: {
      bgColor: 'bg-orange-100',
      textColor: 'text-orange-800',
      dotColor: 'bg-orange-500',
      label: 'Away'
    }
  };

  const config = statusConfig[currentStatus] || statusConfig.offline;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${config.bgColor}`}>
      <span className={`w-2 h-2 ${config.dotColor} rounded-full ${currentStatus === 'online' ? 'animate-pulse' : ''}`} />
      <span className={`text-xs font-medium ${config.textColor}`}>
        {config.label}
      </span>
    </span>
  );
}
