'use client'


import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import { Poppins } from 'next/font/google'


// Page-scoped font: used only on this sign-in page
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap' })


export default function SignIn() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)


  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')


    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Send both keys for compatibility with backend (username OR email)
        body: JSON.stringify({ username: email, email, password }),
      })


      const data = await response.json()


      if (data.success) {
        router.push('/dashboard')
      } else {
        setError(data.message || 'Login failed')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }


  return (
    <div
      className={`${poppins.className} min-h-screen w-full flex items-center justify-center px-4 py-8 sm:py-12`}
      style={{
        background:
          'radial-gradient(1200px 700px at 50% 35%, #b989c7 0%, #a468b5 25%, #8d46a4 50%, #73298f 70%, #5f146d 100%)',
      }}
    >
  <div className="w-full max-w-[360px] sm:max-w-[400px] mx-auto">
        <div className="bg-white rounded-2xl sm:rounded-[24px] shadow-2xl border border-gray-200 p-6 sm:p-8">
          {/* Logo */}
          <div className="flex flex-col items-center">
            <img
              src="/accent-logo.png"
              alt="Accent Techno Solutions"
              className="h-20 sm:h-24 mb-1.5 object-contain"
            />
          </div>


          <h2 className="mt-5 text-2xl font-semibold text-[#5f146d] text-center tracking-tight">Sign In</h2>


          {/* Sign In Form */}
          <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[#5f146d] mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                className="w-full h-11 text-black border border-gray-200 rounded-lg px-4 focus:outline-none focus:ring-2 focus:ring-[#5f146d] text-sm placeholder:text-gray-400"
                placeholder="username@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>


            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[#5f146d] mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="w-full h-11 text-black border border-gray-200 rounded-lg px-4 pr-10 focus:outline-none focus:ring-2 focus:ring-[#5f146d] text-sm placeholder:text-gray-400"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5" />
                  ) : (
                    <EyeIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>


            {/* Error Message */}
            {error && (
              <div className="text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-sm">
                {error}
              </div>
            )}


            {/* Sign In Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-[#5f146d] hover:bg-[#4e0f58] text-white h-11 rounded-lg transition-colors text-sm font-semibold disabled:opacity-60"
            >
              {loading ? (
                <span className="inline-flex items-center">
                  <svg className="animate-spin -ml-0.5 mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>


        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-white/80">© 2025 All rights reserved.</p>
        </div>
      </div>
    </div>
  )
}



