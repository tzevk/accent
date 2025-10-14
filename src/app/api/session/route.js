import { NextResponse } from 'next/server'

export async function GET(req) {
  const auth = req.cookies.get('auth')?.value
  if (!auth) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }
  return NextResponse.json({ authenticated: true })
}
