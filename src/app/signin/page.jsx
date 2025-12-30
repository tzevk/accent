'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { fetchJSON } from '@/utils/http';
import { clearSessionCache } from '@/context/SessionContext';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { Poppins } from 'next/font/google';

// Font setup
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [isWindows, setIsWindows] = useState(false);
  const [platformStyles, setPlatformStyles] = useState({});

  // Gradient background style
  const gradientStyle = {
    background: 'linear-gradient(135deg, #5F146D 0%, #7A2B91 50%, #5F146D 100%)',
  };

  useEffect(() => {
    const platform = navigator.userAgent;
    const windowsDetected = platform.includes('Windows');
    setIsWindows(windowsDetected);
    
    if (windowsDetected) {
      // Keep original gradient on Windows as requested; only apply size scaling
      
      // Windows-specific scaling to make form appear smaller and more comfortable
      setPlatformStyles({
        transform: 'scale(0.85)',
        transformOrigin: 'center',
      });
    }
  }, []);

  // Handle login
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await fetchJSON('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: email, email, password }),
      });

      if (data?.success) {
        // Clear cached session data to ensure fresh session is loaded
        clearSessionCache();
        
        // Wait for cookies to be set
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Verify session is actually established before redirecting
        // Keep checking until we get authenticated or timeout
        let sessionVerified = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const sessionCheck = await fetch('/api/session', { 
              credentials: 'include',
              cache: 'no-store',
              headers: { 'Cache-Control': 'no-cache, no-store' }
            });
            const sessionData = await sessionCheck.json();
            
            if (sessionData.authenticated && sessionData.user) {
              sessionVerified = true;
              break;
            }
          } catch (err) {
            console.warn('Session check attempt failed:', err);
          }
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        if (!sessionVerified) {
          console.warn('Session verification incomplete, proceeding with redirect anyway');
        }
        
        // Super admin goes to admin dashboard
        if (data.is_super_admin) {
          router.push('/admin/productivity');
          return;
        }
        
        // If redirected here from a protected page, go back there
        const params = new URLSearchParams(window.location.search);
        const from = params.get('from');
        router.push(from && from !== '/signin' ? from : '/dashboard');
      }
      else setError(data?.message || 'Invalid credentials');
    } catch (e) {
      setError(e?.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`${poppins.className} fixed inset-0 flex items-center justify-center px-4 overflow-hidden`}
      style={{ ...gradientStyle, ...platformStyles }}
    >
      {/* Background overlay: lighter glow on Mac, subtle darkening on Windows */}
      {/* Soft glow (original across all platforms) */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.15)_0%,transparent_70%)]" />

      {/* Card */}
      <div 
        className={`relative bg-white rounded-[28px] text-center shadow-[0_20px_60px_rgba(93,0,132,0.25)] border border-[#f0e6f3] backdrop-blur-sm transition-all duration-300 hover:-translate-y-[2px] hover:shadow-[0_24px_70px_rgba(93,0,132,0.3)] ${
          isWindows 
            ? 'p-8 w-[380px] sm:w-[400px]' 
            : 'p-10 w-[420px] sm:w-[440px]'
        }`}
        style={platformStyles}
      >
        {/* Logo */}
        <div className={`flex justify-center ${isWindows ? 'mb-5' : 'mb-6'}`}>
          <Image
            src="/accent-logo.png"
            alt="Accent Techno Solutions"
            width={120}
            height={120}
            className={`object-contain ${
              isWindows 
                ? 'h-[95px] sm:h-[105px]' 
                : 'h-[110px] sm:h-[120px]'
            }`}
            priority
          />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className={`text-left ${isWindows ? 'space-y-4' : 'space-y-5'}`}>
          {/* Title */}
          <h2 className={`font-semibold text-[#5F146D] ${
            isWindows 
              ? 'text-[20px] mb-3' 
              : 'text-[22px] mb-4'
          }`}>
            Sign In
          </h2>

          {/* Email */}
          <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-[#5F146D] mb-2"
              >
                Username or Email
              </label>
            <input
              id="email"
                type="text"
              required
              placeholder="username@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full rounded-lg border border-[#E2D8E9] px-3 py-2 text-sm placeholder:text-gray-400 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#7A2B91] focus:border-transparent transition-all duration-200 shadow-sm ${
                isWindows ? 'h-[38px]' : 'h-[42px]'
              }`}
            />
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[#5F146D] mb-2"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full rounded-lg border border-[#E2D8E9] px-3 py-2 text-sm placeholder:text-gray-400 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#7A2B91] focus:border-transparent pr-10 shadow-sm ${
                  isWindows ? 'h-[38px]' : 'h-[42px]'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
              >
                {showPassword ? (
                  <EyeSlashIcon className="h-5 w-5" />
                ) : (
                  <EyeIcon className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 text-red-600 border border-red-200 rounded-md px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className={`w-full bg-[#5F146D] hover:bg-[#4E0F58] text-white rounded-md font-semibold text-sm tracking-wide transition-all duration-200 shadow-[0_3px_6px_rgba(95,20,109,0.3)] hover:shadow-[0_4px_10px_rgba(95,20,109,0.4)] disabled:opacity-60 ${
              isWindows ? 'h-[40px]' : 'h-[44px]'
            }`}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Footer */}
        <p className={`text-xs text-[#7d6295] text-center ${
          isWindows ? 'mt-6' : 'mt-8'
        }`}>
          © 2025 Accent Techno Solutions. All rights reserved.
        </p>
      </div>
    </div>
  );
}
