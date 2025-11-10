import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

export async function GET(req) {
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
}
