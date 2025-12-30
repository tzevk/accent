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
    // If user is already authenticated and tries to access /signin, redirect to appropriate dashboard
    if (pathname === '/signin') {
      const authToken = req.cookies.get('auth')?.value
      const userId = req.cookies.get('user_id')?.value
      const isSuperAdmin = req.cookies.get('is_super_admin')?.value
      // Only redirect if BOTH cookies are present (full session)
      if (authToken && userId) {
        const url = req.nextUrl.clone()
        // Super admin goes to admin dashboard
        url.pathname = isSuperAdmin === '1' ? '/admin/productivity' : '/dashboard'
        return NextResponse.redirect(url)
      }
    }
    return NextResponse.next()
  }

  // All other routes require auth
  const authToken = req.cookies.get('auth')?.value
  const userId = req.cookies.get('user_id')?.value
  
  // Both cookies must be present for valid session
  if (!authToken || !userId) {
    // If it's an API request, return 401 JSON instead of redirect
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/signin'
    url.searchParams.set('from', pathname)
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
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public|uploads).*)',
  ],
}

