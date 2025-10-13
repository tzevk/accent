import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';

export async function GET() {
  try {
    const db = await dbConnect();
    await db.execute(`CREATE TABLE IF NOT EXISTS sub_activities (
      id VARCHAR(36) PRIMARY KEY,
      activity_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      default_duration DECIMAL(10,2) DEFAULT 0,
      default_manhours DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    const [subActivities] = await db.execute(
      'SELECT id, activity_id, name, default_duration, default_manhours, created_at, updated_at FROM sub_activities ORDER BY name'
    );
    await db.end();

    return NextResponse.json({ success: true, data: subActivities });
  } catch (error) {
    console.error('Sub-activities GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sub-activities', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { activity_id, name, default_duration = 0, default_manhours = 0 } = body;

    if (!activity_id || !name) {
      return NextResponse.json({ success: false, error: 'Activity id and name are required' }, { status: 400 });
    }

    const id = randomUUID();
    const db = await dbConnect();
    await db.execute(`CREATE TABLE IF NOT EXISTS sub_activities (
      id VARCHAR(36) PRIMARY KEY,
      activity_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      default_duration DECIMAL(10,2) DEFAULT 0,
      default_manhours DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await db.execute(
      'INSERT INTO sub_activities (id, activity_id, name, default_duration, default_manhours) VALUES (?, ?, ?, ?, ?)',
      [id, activity_id, name, default_duration, default_manhours]
    );
    await db.end();

    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    console.error('Sub-activity POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create sub-activity', details: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, name, default_duration, default_manhours, activity_id } = body;
    if (!id) return NextResponse.json({ success: false, error: 'Sub-activity id is required' }, { status: 400 });

    const db = await dbConnect();
    await db.execute(
      `UPDATE sub_activities SET
         name = COALESCE(?, name),
         default_duration = COALESCE(?, default_duration),
         default_manhours = COALESCE(?, default_manhours),
         activity_id = COALESCE(?, activity_id)
       WHERE id = ?`,
      [name ?? null, default_duration ?? null, default_manhours ?? null, activity_id ?? null, id]
    );
    await db.end();

    return NextResponse.json({ success: true, message: 'Sub-activity updated' });
  } catch (error) {
    console.error('Sub-activity PUT error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update sub-activity', details: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'Sub-activity id is required' }, { status: 400 });

    const db = await dbConnect();
    await db.execute('DELETE FROM sub_activities WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({ success: true, message: 'Sub-activity deleted' });
  } catch (error) {
    console.error('Sub-activity DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete sub-activity', details: error.message }, { status: 500 });
  }
}
