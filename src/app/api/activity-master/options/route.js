import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/activity-master/options
 * Lightweight, auth-only (no SETTINGS permission required) endpoint that
 * returns Discipline -> Activity -> Sub-Activity master data for use in
 * dropdowns on the user dashboard self-service activity log.
 */
export async function GET(request) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  let db;
  try {
    db = await dbConnect();

    const [functions] = await db.execute(
      `SELECT id, function_name FROM functions_master WHERE status = 'active' OR status IS NULL ORDER BY function_name`
    );

    let activities = [];
    try {
      const [acts] = await db.execute(
        'SELECT id, function_id, activity_name, COALESCE(default_manhours, 0) as default_manhours FROM activities_master ORDER BY activity_name'
      );
      activities = acts;
    } catch {
      activities = [];
    }

    let subActivitiesList = [];
    try {
      const [subs] = await db.execute(
        'SELECT id, activity_id, name, default_manhours FROM sub_activities ORDER BY name'
      );
      subActivitiesList = subs;
    } catch {
      subActivitiesList = [];
    }

    const mapped = functions.map((func) => ({
      id: func.id,
      function_name: func.function_name,
      activities: activities
        .filter((activity) => activity.function_id === func.id)
        .map((activity) => ({
          id: activity.id,
          activity_name: activity.activity_name,
          default_manhours: parseFloat(activity.default_manhours) || 0,
          subActivities: subActivitiesList
            .filter((sub) => sub.activity_id === activity.id)
            .map((sub) => ({
              id: sub.id,
              name: sub.name,
              default_manhours: parseFloat(sub.default_manhours) || 0,
            })),
        })),
    }));

    return NextResponse.json({ success: true, data: mapped });
  } catch (error) {
    console.error('Activity master options GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load activity options' },
      { status: 500 }
    );
  } finally {
    if (db) db.release();
  }
}
