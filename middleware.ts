import { NextResponse, type NextRequest } from 'next/server'

// Define paths that do NOT require authentication
const publicPaths = [
  '/signin',
  '/api/login',
  '/api/logout',
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
  '/accent-logo.png',
  '/public',
  '/uploads',
]

function isPublicPath(pathname: string) {
  return publicPaths.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // allow public routes
  if (isPublicPath(pathname)) {
    // If user is already authenticated and tries to access /signin, redirect to dashboard
    if (pathname === '/signin') {
      const auth = req.cookies.get('auth')?.value
      if (auth) {
        const url = req.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
      }
    }
    return NextResponse.next()
  }

  // All other routes require auth
  const auth = req.cookies.get('auth')?.value
  if (!auth) {
    // If it's an API request, return 401 JSON instead of redirect
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/signin'
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

