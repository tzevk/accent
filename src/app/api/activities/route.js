import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

export async function GET() {
  try {
    const db = await dbConnect();

    const [functions] = await db.execute(
      'SELECT id, function_name FROM functions_master ORDER BY function_name'
    );

    const [activities] = await db.execute(
      'SELECT id, function_id, activity_name FROM activities_master ORDER BY activity_name'
    );

    await db.end();

    // Group activities by function
    const grouped = functions.map((func) => ({
      id: func.id,
      discipline: func.function_name,
      name: func.function_name,
      activities: activities.filter((a) => a.function_id === func.id).map((a) => ({ id: a.id, name: a.activity_name }))
    }));

    return NextResponse.json({ success: true, data: grouped });
  } catch (error) {
    console.error('GET /api/activities error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load activities', details: error.message }, { status: 500 });
  }
}
