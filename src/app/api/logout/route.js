import { NextResponse } from 'next/server'

export async function POST() {
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

  return res
}
