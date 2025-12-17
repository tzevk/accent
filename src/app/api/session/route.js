import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

// Disable caching for session endpoint
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req) {
  try {
    const hasSession = !!req?.cookies?.get?.('auth')?.value;
    const hasUserId = !!req?.cookies?.get?.('user_id')?.value;

    if (!hasSession || !hasUserId) {
      console.log('[Session API] No auth cookies found');
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const user = await getCurrentUser(req);
    if (!user) {
      console.log('[Session API] getCurrentUser returned null');
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({ authenticated: true, user });
  } catch (error) {
    console.error('[Session API] Error:', error);
    return NextResponse.json({ 
      authenticated: false, 
      error: error.message 
    }, { status: 500 });
  }
}
