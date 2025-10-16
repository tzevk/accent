import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';

// GET - list employees who don't have user accounts yet
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeWithUsers = searchParams.get('include_with_users') === 'true';

    const db = await dbConnect();
    
    let query = `
      SELECT e.id, e.employee_id, e.first_name, e.last_name, e.email, e.department, e.position,
             e.status, e.hire_date,
             u.id as user_id, u.username, u.status as user_status
      FROM employees e
      LEFT JOIN users u ON e.id = u.employee_id AND u.is_active = TRUE
    `;
    
    if (!includeWithUsers) {
      query += ' WHERE u.id IS NULL';
    }
    
    query += ' ORDER BY e.first_name, e.last_name';

    const [rows] = await db.execute(query);
    await db.end();

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching employees for users:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch employees' }, { status: 500 });
  }
}