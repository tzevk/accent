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

/**
 * Middleware - Single source of truth for authentication
 * 
 * This is the ONLY place where auth is enforced:
 * 1. Public routes are allowed through
 * 2. Authenticated users on /signin are redirected to their dashboard
 * 3. Unauthenticated users are redirected to /signin
 * 4. Non-admins trying to access /admin/* are redirected to /user/dashboard
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  
  // Get auth cookies
  const auth = req.cookies.get('auth')?.value
  const userId = req.cookies.get('user_id')?.value
  const isAdmin = req.cookies.get('is_super_admin')?.value === '1'
  
  // Check if user is authenticated (both cookies must be present)
  const isAuthenticated = !!(auth && userId)

  // Allow public routes
  if (isPublicPath(pathname)) {
    // If authenticated user tries to access /signin, redirect to their dashboard
    if (pathname === '/signin' && isAuthenticated) {
      const url = req.nextUrl.clone()
      url.pathname = isAdmin ? '/admin/dashboard' : '/user/dashboard'
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  // All other routes require authentication
  if (!isAuthenticated) {
    // API requests get 401 JSON response
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }
    // Page requests redirect to signin
    const url = req.nextUrl.clone()
    url.pathname = '/signin'
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  // Admin route protection - non-admins cannot access /admin/*
  if (pathname.startsWith('/admin') && !isAdmin) {
    const url = req.nextUrl.clone()
    url.pathname = '/user/dashboard'
    return NextResponse.redirect(url)
  }

  // Add cache control headers to prevent caching of protected pages
  const response = NextResponse.next()
  response.headers.set('Cache-Control', 'no-store, must-revalidate')
  response.headers.set('Pragma', 'no-cache')
  return response
}

// Configure which paths the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes) - handled separately in middleware
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public|uploads).*)',
  ],
}

