import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

export async function GET(req) {
  const auth = req.cookies.get('auth')?.value;
  if (!auth) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Load the current user with permissions for client-side RBAC
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, user });
}
