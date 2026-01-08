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
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({ authenticated: true, user });
  } catch (error) {
    console.error('[Session] Error:', error.message);
    return NextResponse.json({ authenticated: false }, { status: 500 });
  }
}
