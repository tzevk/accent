import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { randomUUID } from 'crypto';

export async function GET() {
  try {
    const db = await dbConnect();
    // Ensure tables exist
    await db.execute(`CREATE TABLE IF NOT EXISTS functions_master (
      id VARCHAR(36) PRIMARY KEY,
      function_name VARCHAR(255) NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS activities_master (
      id VARCHAR(36) PRIMARY KEY,
      function_id VARCHAR(36) NOT NULL,
      activity_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS sub_activities (
      id VARCHAR(36) PRIMARY KEY,
      activity_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      default_duration DECIMAL(10,2) DEFAULT 0,
      default_manhours DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    const [functions] = await db.execute(
      'SELECT id, function_name FROM functions_master ORDER BY function_name'
    );

    const [activities] = await db.execute(
      'SELECT id, function_id, activity_name FROM activities_master ORDER BY activity_name'
    );

    // fetch sub_activities if available
    let subActivities = [];
    try {
      const [subs] = await db.execute('SELECT id, activity_id, name, default_duration, default_manhours FROM sub_activities');
      subActivities = subs;
    } catch {
      // table might not exist yet; that's fine
      subActivities = [];
    }

    await db.end();

    // Group activities by function
    const grouped = functions.map((func) => ({
      id: func.id,
      discipline: func.function_name,
      name: func.function_name,
      activities: activities
        .filter((a) => a.function_id === func.id)
        .map((a) => ({
          id: a.id,
          name: a.activity_name,
          subActivities: subActivities.filter((s) => String(s.activity_id) === String(a.id)).map((s) => ({ id: s.id, name: s.name, defaultDuration: s.default_duration, defaultManhours: s.default_manhours }))
        }))
    }));

    return NextResponse.json({ success: true, data: grouped });
  } catch (error) {
    console.error('GET /api/activities error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load activities', details: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { function_id, activity_name } = await request.json();

    if (!function_id || !activity_name) {
      return NextResponse.json({ success: false, error: 'Function ID and activity name are required' }, { status: 400 });
    }

    const id = randomUUID();
    const db = await dbConnect();
    await db.execute(`CREATE TABLE IF NOT EXISTS activities_master (
      id VARCHAR(36) PRIMARY KEY,
      function_id VARCHAR(36) NOT NULL,
      activity_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await db.execute(
      'INSERT INTO activities_master (id, function_id, activity_name) VALUES (?, ?, ?)',
      [id, function_id, activity_name]
    );
    await db.end();

    return NextResponse.json({ 
      success: true, 
      message: 'Activity created successfully',
      id: id 
    });
  } catch (error) {
    console.error('POST /api/activities error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create activity', details: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { id, activity_name } = await request.json();

    if (!id || !activity_name) {
      return NextResponse.json({ success: false, error: 'ID and activity name are required' }, { status: 400 });
    }

    const db = await dbConnect();
    await db.execute('UPDATE activities_master SET activity_name = ? WHERE id = ?', [activity_name, id]);
    await db.end();

    return NextResponse.json({ success: true, message: 'Activity updated successfully' });
  } catch (error) {
    console.error('PUT /api/activities error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update activity', details: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Activity ID is required' }, { status: 400 });
    }

    const db = await dbConnect();
    
    // First delete all sub-activities that belong to this activity
    await db.execute('DELETE FROM sub_activities WHERE activity_id = ?', [id]);
    
    // Then delete the activity itself
    await db.execute('DELETE FROM activities_master WHERE id = ?', [id]);
    
    await db.end();

    return NextResponse.json({ success: true, message: 'Activity and its sub-activities deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/activities error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete activity', details: error.message }, { status: 500 });
  }
}
