'use client';

import { useState } from 'react';
import Image from 'next/image';
import { fetchJSON } from '@/utils/http';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { Poppins } from 'next/font/google';

// Font setup
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

// Background gradient style (was referenced but undefined)
// Kept subtle light radial blend to match existing overlay and brand tint.
const gradientStyle = {
  // Brand gradient similar to previous version: bright center fading to deeper purple edges
  background: 'radial-gradient(circle at 50% 40%, #cfa9e6 0%, #a562c9 28%, #7F2487 52%, #5F146D 72%, #4A0F5A 90%)',
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [isWindows, setIsWindows] = useState(false);
  const [platformStyles, setPlatformStyles] = useState({});

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
        // Wait a bit to ensure cookies are set before redirecting
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // If redirected here from a protected page, go back there
        const params = new URLSearchParams(window.location.search);
        const from = params.get('from');
        
        // Force a full page reload to ensure cookies are recognized
        window.location.href = from && from !== '/signin' ? from : '/dashboard';
      }
      else setError(data?.message || 'Invalid credentials');
    } catch (e) {
      setError(e?.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`${poppins.className} fixed inset-0 px-4 overflow-hidden`} style={gradientStyle}>
      {/* Background overlay: lighter glow on Mac, subtle darkening on Windows */}
      {/* Soft glow (original across all platforms) */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.15)_0%,transparent_70%)]" />

      {/* Card */}
      <div 
        className="relative bg-white rounded-[28px] text-center shadow-[0_20px_60px_rgba(93,0,132,0.25)] border border-[#f0e6f3] backdrop-blur-sm transition-all duration-300 hover:-translate-y-[2px] hover:shadow-[0_24px_70px_rgba(93,0,132,0.3)] p-10 w-[420px] sm:w-[440px]"
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Image
            src="/accent-logo.png"
            alt="Accent Techno Solutions"
            width={120}
            height={120}
            className="object-contain h-[110px] sm:h-[120px]"
            priority
          />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="text-left space-y-5">
          {/* Title */}
          <h2 className="font-semibold text-[#5F146D] text-[22px] mb-4">
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
              className="w-full rounded-lg border border-[#E2D8E9] px-3 py-2 text-sm h-[42px] placeholder:text-gray-400 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#7A2B91] focus:border-transparent transition-all duration-200 shadow-sm"
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
                className="w-full rounded-lg border border-[#E2D8E9] px-3 py-2 text-sm h-[42px] placeholder:text-gray-400 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#7A2B91] focus:border-transparent pr-10 shadow-sm"
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
            className="w-full bg-[#5F146D] hover:bg-[#4E0F58] text-white rounded-md font-semibold text-sm tracking-wide transition-all duration-200 shadow-[0_3px_6px_rgba(95,20,109,0.3)] hover:shadow-[0_4px_10px_rgba(95,20,109,0.4)] disabled:opacity-60 h-[44px]"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Footer */}
        <p className="text-xs text-[#7d6295] text-center mt-8">
          © 2025 Accent Techno Solutions. All rights reserved.
        </p>
      </div>
    </div>
  );
}
