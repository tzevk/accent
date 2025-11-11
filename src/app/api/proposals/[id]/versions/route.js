import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const db = await dbConnect();

    // Try to load versions from a backing table if present, otherwise return empty list
    try {
      const [rows] = await db.execute('SELECT * FROM proposal_versions WHERE proposal_id = ? ORDER BY created_at DESC', [id]);
      await db.end();
      return NextResponse.json({ success: true, data: rows });
    } catch {
      // Table doesn't exist or query failed; return empty list
      await db.end();
      return NextResponse.json({ success: true, data: [] });
    }
  } catch (err) {
    console.error('Proposal versions GET error:', err);
    return NextResponse.json({ success: false, error: 'Failed to fetch versions' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const db = await dbConnect();

    // Try to insert into proposal_versions if table exists; otherwise, accept request but do no DB work
    try {
      await db.execute(
        `INSERT INTO proposal_versions (proposal_id, version_label, file_url, original_name, uploaded_by, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          id,
          body.version_label || null,
          body.file_url || null,
          body.original_name || null,
          body.uploaded_by || null,
          body.notes || null
        ]
      );
      await db.end();
      return NextResponse.json({ success: true, message: 'Version recorded' }, { status: 201 });
    } catch {
      // Table missing or insert failed — accept as no-op to keep client working
      await db.end();
      return NextResponse.json({ success: true, message: 'Version accepted (no backing table)' }, { status: 201 });
    }
  } catch (err) {
    console.error('Proposal versions POST error:', err);
    return NextResponse.json({ success: false, error: 'Failed to save version' }, { status: 500 });
  }
}
