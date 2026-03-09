import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { logActivity, updateScreenTime } from '@/utils/activity-logger';

/**
 * POST - Track detailed user activity (screen time, interactions, etc.)
 * This endpoint receives client-side activity data
 */
export async function POST(request) {
  try {
    // Users should always be able to track their own activity
    const auth = await ensurePermission(request, RESOURCES.PROFILE, PERMISSIONS.READ);
    if (auth instanceof NextResponse) {
      return auth;
    }

    // Parse request body with error handling
    let data;
    try {
      const text = await request.text();
      if (!text || text.trim() === '') {
        return NextResponse.json({ success: true }); // Silently ignore empty requests
      }
      data = JSON.parse(text);
    } catch (parseError) {
      console.warn('Activity tracking: Invalid JSON body', parseError.message);
      return NextResponse.json({ success: true }); // Silently ignore invalid JSON
    }
    
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
