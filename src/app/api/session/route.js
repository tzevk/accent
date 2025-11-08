import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { authenticateJWT } from '@/utils/jwt-auth';

export async function GET(req) {
  // Authenticate JWT token
  const auth = authenticateJWT(req);
  if (!auth.authenticated) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Load the current user with permissions for client-side RBAC
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  
  return NextResponse.json({ 
    authenticated: true, 
    user: {
      ...user,
      tokenData: auth.user // Include decoded token data
    }
  });
}
