import { NextResponse } from 'next/server'
import { logActivity, endUserSession } from '@/utils/activity-logger'
import { cookies } from 'next/headers'

export async function POST(req) {
  // Get user ID from cookie before clearing
  const cookieStore = await cookies()
  const userIdCookie = cookieStore.get('user_id')
  const userId = userIdCookie ? parseInt(userIdCookie.value) : null

  if (userId) {
    // Log logout activity
    logActivity({
      userId,
      actionType: 'logout',
      description: 'User logged out',
      request: req,
      status: 'success'
    }).catch(console.error);

    // End work session
    endUserSession(userId).catch(console.error);
  }

  const res = NextResponse.json({ success: true, message: 'Logged out successfully' })
  const isProd = process.env.NODE_ENV === 'production'
  const baseCookie = {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/'
  }

  res.cookies.set('auth', '', { ...baseCookie, maxAge: 0 })
  res.cookies.set('user_id', '', { ...baseCookie, maxAge: 0 })
  res.cookies.set('is_super_admin', '', { ...baseCookie, maxAge: 0 })
  res.cookies.set('session_permissions', '', { ...baseCookie, maxAge: 0 })

  return res
}
