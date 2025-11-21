import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

/**
 * POST - Track detailed user activity (screen time, interactions, etc.)
 * This endpoint receives client-side activity data
 */
export async function POST(request) {
  try {
    const auth = await ensurePermission(request, RESOURCES.DASHBOARD, PERMISSIONS.READ);
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();
    const {
      actionType,
      resourceType,
      description,
      details,
      timestamp
    } = data;

    // Validate required fields
    if (!actionType || !resourceType) {
      return NextResponse.json({ 
        success: false, 
        error: 'actionType and resourceType are required' 
      }, { status: 400 });
    }

    // Log the activity
    await logActivity({
      userId: auth.user.id,
      actionType,
      resourceType,
      description: description || `${actionType} on ${resourceType}`,
      details: {
        ...details,
        clientTimestamp: timestamp,
        userAgent: request.headers.get('user-agent'),
        referer: request.headers.get('referer')
      },
      request,
      status: 'success'
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error tracking activity:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to track activity' 
    }, { status: 500 });
  }
}
