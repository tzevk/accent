import { NextResponse } from 'next/server'
import { clearTokenCookie } from '@/utils/jwt-auth'

export async function POST() {
  const res = NextResponse.json({ success: true, message: 'Logged out successfully' })
  // Clear the JWT auth token cookie
  clearTokenCookie(res)
  return res
}
