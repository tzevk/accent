import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';

export async function GET() {
  try {
    const db = await dbConnect();
    // Ensure base tables exist
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
    const [functions] = await db.execute(
      'SELECT id, function_name, status, description, created_at, updated_at FROM functions_master ORDER BY function_name'
    );
    let activities = [];
    try {
      const [acts] = await db.execute(
        'SELECT id, function_id, activity_name, created_at, updated_at FROM activities_master ORDER BY activity_name'
      );
      activities = acts;
    } catch {
      activities = [];
    }

    // try fetching sub_activities (may not exist yet)
    let subActivities = [];
    try {
      const [subs] = await db.execute('SELECT id, activity_id, name, default_duration, default_manhours, default_rate, created_at, updated_at FROM sub_activities');
      subActivities = subs;
    } catch {
      subActivities = [];
    }

    await db.end();

    // Map functions to activities -> subActivities
    const mapped = functions.map((func) => ({
      id: func.id,
      function_name: func.function_name,
      status: func.status,
      description: func.description,
      created_at: func.created_at,
      updated_at: func.updated_at,
      activities: activities
        .filter((activity) => activity.function_id === func.id)
        .map((activity) => ({
          id: activity.id,
          activity_name: activity.activity_name,
          created_at: activity.created_at,
          updated_at: activity.updated_at,
          subActivities: subActivities.filter((s) => String(s.activity_id) === String(activity.id)).map((s) => ({ id: s.id, name: s.name, default_duration: s.default_duration, default_manhours: s.default_manhours, default_rate: s.default_rate }))
        }))
    }));

    return NextResponse.json({ success: true, data: mapped });
  } catch (error) {
    console.error('Activity master GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load activity master', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { function_name, status = 'active', description = '' } = body;

    if (!function_name) {
      return NextResponse.json({ success: false, error: 'Discipline name is required' }, { status: 400 });
    }

    const id = randomUUID();
    const db = await dbConnect();
    await db.execute(`CREATE TABLE IF NOT EXISTS functions_master (
      id VARCHAR(36) PRIMARY KEY,
      function_name VARCHAR(255) NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await db.execute(
      'INSERT INTO functions_master (id, function_name, status, description) VALUES (?, ?, ?, ?)',
      [id, function_name, status, description]
    );
    await db.end();

    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    console.error('Activity master POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create discipline', details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, function_name, status, description } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Discipline id is required' }, { status: 400 });
    }

    const db = await dbConnect();
    await db.execute(
      `UPDATE functions_master
       SET function_name = COALESCE(?, function_name),
           status = COALESCE(?, status),
           description = COALESCE(?, description)
       WHERE id = ?`,
      [function_name ?? null, status ?? null, description ?? null, id]
    );
    await db.end();

    return NextResponse.json({ success: true, message: 'Discipline updated' });
  } catch (error) {
    console.error('Activity master PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update discipline', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Discipline id is required' }, { status: 400 });
    }

    const db = await dbConnect();
    try {
      await db.execute('DELETE FROM activities_master WHERE function_id = ?', [id]);
    } catch {
      // ignore if table missing
    }
    await db.execute('DELETE FROM functions_master WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({ success: true, message: 'Discipline deleted' });
  } catch (error) {
    console.error('Activity master DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete discipline', details: error.message },
      { status: 500 }
    );
  }
}
