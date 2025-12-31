import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { randomUUID } from 'crypto';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

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
      'SELECT id, function_name FROM functions_master ORDER BY function_name'
    );

    const [activities] = await db.execute(
      'SELECT id, function_id, activity_name, COALESCE(default_manhours, 0) as default_manhours FROM activities_master ORDER BY activity_name'
    );

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
          defaultManhours: parseFloat(a.default_manhours) || 0
        }))
    }));

    return NextResponse.json({ success: true, data: grouped });
  } catch (error) {
    console.error('GET /api/activities error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load activities', details: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  // RBAC check
  const authResultPost = await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.UPDATE);
  if (authResultPost.authorized === false) return authResultPost.response;

  try {
    const { function_id, activity_name, default_manhours } = await request.json();

    if (!function_id || !activity_name) {
      return NextResponse.json({ success: false, error: 'Function ID and activity name are required' }, { status: 400 });
    }

    const id = randomUUID();
    // Parse as float - preserve exact decimal values
    const parsed = parseFloat(default_manhours);
    const manhours = isNaN(parsed) ? 0 : parsed;
    console.log('Creating activity:', { id, function_id, activity_name, default_manhours, manhours });
    const db = await dbConnect();
    
    await db.execute(
      'INSERT INTO activities_master (id, function_id, activity_name, default_manhours) VALUES (?, ?, ?, ?)',
      [id, function_id, activity_name, manhours]
    );
    await db.end();

    return NextResponse.json({ 
      success: true, 
      message: 'Activity created successfully',
      id: id,
      default_manhours: manhours
    });
  } catch (error) {
    console.error('POST /api/activities error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create activity', details: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.UPDATE);
  if (authResult.authorized === false) return authResult.response;

  try {
    const body = await request.json();
    const { id, activity_name, default_manhours } = body;
    
    console.log('PUT /api/activities - Received body:', JSON.stringify(body));

    if (!id) {
      return NextResponse.json({ success: false, error: 'Activity ID is required' }, { status: 400 });
    }

    const db = await dbConnect();
    
    // Build dynamic update query based on what fields are provided
    const updates = [];
    const values = [];
    
    if (activity_name !== undefined && activity_name !== null) {
      updates.push('activity_name = ?');
      values.push(activity_name);
    }
    
    // Always update manhours if it's provided (including 0)
    if (default_manhours !== undefined) {
      const manhours = parseFloat(default_manhours);
      const finalManhours = isNaN(manhours) ? 0 : manhours;
      updates.push('default_manhours = ?');
      values.push(finalManhours);
      console.log('Updating manhours:', { default_manhours, manhours, finalManhours });
    }
    
    if (updates.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }
    
    values.push(id);
    const query = `UPDATE activities_master SET ${updates.join(', ')} WHERE id = ?`;
    console.log('Executing query:', query, 'with values:', values);
    
    const [result] = await db.execute(query, values);
    console.log('Update result:', result);
    await db.end();

    return NextResponse.json({ success: true, message: 'Activity updated successfully' });
  } catch (error) {
    console.error('PUT /api/activities error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update activity', details: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.DELETE);
  if (authResult.authorized === false) return authResult.response;

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
