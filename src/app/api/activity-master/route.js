import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';

export async function GET() {
  try {
    const db = await dbConnect();
    const [functions] = await db.execute(
      'SELECT id, function_name, status, description, created_at, updated_at FROM functions_master ORDER BY function_name'
    );
    const [activities] = await db.execute(
      'SELECT id, function_id, activity_name, created_at, updated_at FROM activities_master ORDER BY activity_name'
    );
    await db.end();

    const mapped = functions.map((func) => ({
      ...func,
      subActivities: activities.filter((activity) => activity.function_id === func.id)
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
    await db.execute('DELETE FROM activities_master WHERE function_id = ?', [id]);
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
