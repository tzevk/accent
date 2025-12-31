import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { logActivity, updateScreenTime } from '@/utils/activity-logger';

/**
 * POST - Track detailed user activity (screen time, interactions, etc.)
 * This endpoint receives client-side activity data
 */
export async function POST(request) {
  try {
    const auth = await ensurePermission(request, RESOURCES.DASHBOARD, PERMISSIONS.READ);
    if (auth instanceof NextResponse) {
      return auth;
    }

    const data = await request.json();
    
    // Handle batched activities
    if (data.batch && data.activities) {
      for (const activity of data.activities) {
        await processActivity(auth.user.id, activity, request);
      }
      return NextResponse.json({ success: true });
    }

    // Handle single activity
    await processActivity(auth.user.id, data, request);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error tracking activity:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to track activity' 
    }, { status: 500 });
  }
}

async function processActivity(userId, data, request) {
  const {
    actionType,
    resourceType,
    description,
    details,
    timestamp
  } = data;

  // Validate required fields
  if (!actionType || !resourceType) {
    return;
  }

  // Log the activity
  await logActivity({
    userId,
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

  // Update screen time for heartbeat events
  if (resourceType === 'heartbeat' && details) {
    await updateScreenTime(userId, {
      activeTimeMs: details.activeTime || 0,
      idleTimeMs: details.idleTime || 0,
      sessionDurationMs: details.sessionDurationMs || 0,
      currentPage: details.currentPage || null
    });
  }
}
