'use client';

import { useEffect, useState } from 'react';

/**
 * AutoRefresh Component
 * Automatically refreshes the page if loading takes too long
 * 
 * @param {number} timeout - Time in milliseconds before auto-refresh (default: 30 seconds)
 * @param {boolean} enabled - Whether auto-refresh is enabled (default: true)
 */
export default function AutoRefresh({ timeout = 30000, enabled = true }) {
  const [isLoading, setIsLoading] = useState(true);
  const [countdown, setCountdown] = useState(null);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    // Mark as loaded once the page is fully interactive
    const handleLoad = () => {
      setIsLoading(false);
      setShowWarning(false);
      setCountdown(null);
    };

    // Check if document is already loaded
    if (document.readyState === 'complete') {
      setIsLoading(false);
      return;
    }

    window.addEventListener('load', handleLoad);

    // Set up the timeout for auto-refresh
    const warningTime = timeout - 5000; // Show warning 5 seconds before refresh
    
    const warningTimer = setTimeout(() => {
      if (isLoading) {
        setShowWarning(true);
        setCountdown(5);
      }
    }, warningTime);

    const refreshTimer = setTimeout(() => {
      if (isLoading) {
        console.log('Page took too long to load. Auto-refreshing...');
        window.location.reload();
      }
    }, timeout);

    return () => {
      window.removeEventListener('load', handleLoad);
      clearTimeout(warningTimer);
      clearTimeout(refreshTimer);
    };
  }, [timeout, enabled, isLoading]);

  // Countdown timer
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown]);

  // Cancel refresh handler
  const cancelRefresh = () => {
    setShowWarning(false);
    setCountdown(null);
    setIsLoading(false); // Mark as loaded to prevent refresh
  };

  if (!showWarning) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] animate-pulse">
      <div className="bg-yellow-100 border border-yellow-400 rounded-lg shadow-lg p-4 max-w-sm">
        <div className="flex items-start gap-3">
          <div className="text-yellow-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-yellow-800">Page Loading Slowly</h4>
            <p className="text-xs text-yellow-700 mt-1">
              Auto-refresh in <span className="font-bold">{countdown}</span> seconds...
            </p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={cancelRefresh}
                className="px-3 py-1 text-xs bg-white border border-yellow-400 rounded hover:bg-yellow-50 text-yellow-800"
              >
                Cancel
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-3 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600"
              >
                Refresh Now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
