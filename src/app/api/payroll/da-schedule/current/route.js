import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

/**
 * GET - Fetch current active DA for a specific date and year
 * Query params: date (optional, defaults to today), year (optional, defaults to current year)
 */
export async function GET(request) {
  let db;
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const yearParam = searchParams.get('year');
    const forDate = dateParam || new Date().toISOString().split('T')[0];
    const forYear = yearParam ? parseInt(yearParam) : new Date().getFullYear();
    
    db = await dbConnect();
    
    const [rows] = await db.execute(
      `SELECT da_amount, effective_from, effective_to
       FROM da_schedule 
       WHERE is_active = 1 
       ORDER BY effective_from DESC
       LIMIT 1`,
      []
    );

    if (rows.length === 0) {
      return NextResponse.json({ 
        success: true, 
        data: { da_amount: 0, effective_from: forDate, effective_to: null },
        message: 'No active DA found, using 0'
      });
    }
    
    return NextResponse.json({ 
      success: true, 
      data: rows[0]
    });
  } catch (error) {
    console.error('GET /api/payroll/da-schedule/current error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch current DA', details: error.message },
      { status: 500 }
    );
  } finally {
    if (db) db.release();
  }
}
