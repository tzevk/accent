import { cookies } from 'next/headers';
import { getCurrentUser } from '@/utils/api-permissions';
import { verifyToken } from '@/utils/jwt-auth';

/**
 * Server-side authentication helper for layouts and server components
 * Uses the same logic as the session API but for server-side usage
 */
export async function getServerAuth() {
  try {
    // Get the auth token from cookies
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token')?.value;
    
    if (!authToken) {
      return { authenticated: false, user: null, error: 'No token provided' };
    }

    // Verify the JWT token (same logic as authenticateJWT)
    const decoded = verifyToken(authToken);
    if (!decoded) {
      return { authenticated: false, user: null, error: 'Invalid or expired token' };
    }

    // Create a mock request object for getCurrentUser
    const mockRequest = {
      cookies: {
        get: (name) => cookieStore.get(name)
      }
    };

    // Load the current user with permissions (same as session API)
    const user = await getCurrentUser(mockRequest);
    if (!user) {
      return { authenticated: false, user: null, error: 'User not found' };
    }

    return {
      authenticated: true,
      user: {
        ...user,
        tokenData: decoded // Include decoded token data
      },
      error: null
    };
  } catch (error) {
    console.error('Server auth error:', error);
    return { authenticated: false, user: null, error: error.message };
  }
}

/**
 * Server-side authentication guard for layouts
 * Returns the authenticated user or redirects to signin
 */
export async function requireServerAuth(redirectPath = '/') {
  const auth = await getServerAuth();
  
  if (!auth.authenticated) {
    return { authenticated: false, redirectTo: `/signin?from=${encodeURIComponent(redirectPath)}` };
  }
  
  return { authenticated: true, user: auth.user };
}