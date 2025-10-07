import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';

export async function POST(request) {
  try {
    const body = await request.json();
    const { function_id, activity_name } = body;

    if (!function_id || !activity_name) {
      return NextResponse.json({ success: false, error: 'Function id and activity name are required' }, { status: 400 });
    }

    const id = randomUUID();
    const db = await dbConnect();
    await db.execute(
      'INSERT INTO activities_master (id, function_id, activity_name) VALUES (?, ?, ?)',
      [id, function_id, activity_name]
    );
    await db.end();

    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    console.error('Activity sub POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create sub-activity', details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, activity_name, function_id } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Sub-activity id is required' }, { status: 400 });
    }

    const db = await dbConnect();
    await db.execute(
      `UPDATE activities_master
       SET activity_name = COALESCE(?, activity_name),
           function_id = COALESCE(?, function_id)
       WHERE id = ?`,
      [activity_name ?? null, function_id ?? null, id]
    );
    await db.end();

    return NextResponse.json({ success: true, message: 'Sub-activity updated' });
  } catch (error) {
    console.error('Activity sub PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update sub-activity', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Sub-activity id is required' }, { status: 400 });
    }

    const db = await dbConnect();
    await db.execute('DELETE FROM sub_activities WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({ success: true, message: 'Sub-activity deleted' });
  } catch (error) {
    console.error('Activity sub DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete sub-activity', details: error.message },
      { status: 500 }
    );
  }
}
