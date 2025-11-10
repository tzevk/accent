import { cookies } from 'next/headers';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * Server-side authentication helper for layouts and server components
 * Uses the same logic as the session API but for server-side usage
 */
export async function getServerAuth() {
  try {
    const cookieStore = cookies();
    const authCookie = cookieStore.get('auth');
    const userIdCookie = cookieStore.get('user_id');

    if (!authCookie || !userIdCookie) {
      return { authenticated: false, user: null, error: 'No active session' };
    }

    const mockRequest = {
      cookies: {
        get: (name) => cookieStore.get(name)
      }
    };

    const user = await getCurrentUser(mockRequest);
    if (!user) {
      return { authenticated: false, user: null, error: 'User not found' };
    }

    return { authenticated: true, user, error: null };
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