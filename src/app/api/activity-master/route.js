import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

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
      default_manhours DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    
    // Add default_manhours column if it doesn't exist
    try {
      await db.execute(`ALTER TABLE activities_master ADD COLUMN default_manhours DECIMAL(10,2) DEFAULT 0`);
    } catch (e) {
      // Column already exists, ignore
    }
    
    const [functions] = await db.execute(
      'SELECT id, function_name, status, description, created_at, updated_at FROM functions_master ORDER BY function_name'
    );
    let activities = [];
    try {
      const [acts] = await db.execute(
        'SELECT id, function_id, activity_name, COALESCE(default_manhours, 0) as default_manhours, created_at, updated_at FROM activities_master ORDER BY activity_name'
      );
      activities = acts;
    } catch {
      activities = [];
    }

    await db.end();

    // Map functions to activities (without subActivities)
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
          default_manhours: parseFloat(activity.default_manhours) || 0,
          created_at: activity.created_at,
          updated_at: activity.updated_at
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
  // RBAC check
  const authResultPost = await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.UPDATE);
  if (authResultPost.authorized === false) return authResultPost.response;

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
