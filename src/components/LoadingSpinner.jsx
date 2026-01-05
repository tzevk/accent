'use client';

import { useState, useEffect } from 'react';

/**
 * Premium loading spinner with elapsed timer
 * @param {Object} props
 * @param {string} props.message - Main loading message (default: "Loading")
 * @param {string} props.subMessage - Sub message (default: "Please wait...")
 * @param {boolean} props.showTimer - Whether to show elapsed time (default: true)
 * @param {boolean} props.fullScreen - Whether to take full screen (default: true)
 * @param {string} props.size - Size variant: 'sm', 'md', 'lg' (default: 'md')
 */
export default function LoadingSpinner({ 
  message = 'Loading', 
  subMessage = 'Please wait...', 
  showTimer = true,
  fullScreen = true,
  size = 'md'
}) {
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    if (!showTimer) return;
    const timer = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [showTimer]);
  
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const sizes = {
    sm: { spinner: 'w-10 h-10', icon: 'w-4 h-4', text: 'text-sm', subtext: 'text-xs' },
    md: { spinner: 'w-16 h-16', icon: 'w-6 h-6', text: 'text-base', subtext: 'text-sm' },
    lg: { spinner: 'w-20 h-20', icon: 'w-8 h-8', text: 'text-lg', subtext: 'text-base' }
  };
  
  const s = sizes[size] || sizes.md;

  const content = (
    <div className="text-center">
      {/* Animated spinner */}
      <div className="relative inline-flex mb-6">
        <div className={`${s.spinner} rounded-full border-4 border-gray-200`}></div>
        <div className={`absolute top-0 left-0 ${s.spinner} rounded-full border-4 border-transparent border-t-violet-500 border-r-violet-500 animate-spin`}></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className={`${s.icon} text-violet-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
      </div>
      
      {/* Loading text */}
      <div className="space-y-2">
        <p className={`${s.text} font-medium text-gray-700`}>{message}</p>
        <p className={`${s.subtext} text-gray-400`}>{subMessage}</p>
        {showTimer && elapsed > 0 && (
          <p className="text-xs text-gray-400 mt-3 font-mono bg-gray-100 px-3 py-1 rounded-full inline-block">
            ⏱️ {formatTime(elapsed)}
          </p>
        )}
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center">
        {content}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-8">
      {content}
    </div>
  );
}

/**
 * Inline loading spinner for smaller contexts
 */
export function InlineSpinner({ message = 'Loading...' }) {
  return (
    <div className="flex items-center justify-center gap-2 p-4 text-gray-500">
      <div className="w-5 h-5 rounded-full border-2 border-gray-200 border-t-violet-500 animate-spin"></div>
      <span className="text-sm">{message}</span>
    </div>
  );
}
