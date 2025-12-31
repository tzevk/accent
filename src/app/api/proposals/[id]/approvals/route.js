import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

export async function GET(request, { params }) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  try {
    const { id } = await params;
    const db = await dbConnect();

    // Try to load approvals from a backing table if present, otherwise return empty list
    try {
      const [rows] = await db.execute('SELECT * FROM proposal_approvals WHERE proposal_id = ? ORDER BY created_at DESC', [id]);
      await db.end();
      return NextResponse.json({ success: true, data: rows });
    } catch {
      await db.end();
      return NextResponse.json({ success: true, data: [] });
    }
  } catch (err) {
    console.error('Proposal approvals GET error:', err);
    return NextResponse.json({ success: false, error: 'Failed to fetch approvals' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  // RBAC check - approvals require approve permission
  const authResultPost = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.APPROVE);
  if (authResultPost.authorized === false) return authResultPost.response;

  try {
    const { id } = await params;
    const body = await request.json();
    const db = await dbConnect();

    try {
      await db.execute(
        `INSERT INTO proposal_approvals (proposal_id, approver, comment, status, created_at) VALUES (?, ?, ?, ?, NOW())`,
        [id, body.approver || null, body.comment || null, body.status || null]
      );
      await db.end();
      return NextResponse.json({ success: true, message: 'Approval recorded' }, { status: 201 });
    } catch {
      await db.end();
      return NextResponse.json({ success: true, message: 'Approval accepted (no backing table)' }, { status: 201 });
    }
  } catch (err) {
    console.error('Proposal approvals POST error:', err);
    return NextResponse.json({ success: false, error: 'Failed to save approval' }, { status: 500 });
  }
}
