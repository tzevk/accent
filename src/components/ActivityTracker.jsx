'use client';

import { useActivityTracker } from '@/hooks/useActivityTracker';

/**
 * Activity Tracker Component
 * Automatically tracks all user activity when mounted
 */
export default function ActivityTracker() {
  useActivityTracker();
  
  // This component doesn't render anything visible
  return null;
}
