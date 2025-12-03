import { NextResponse } from 'next/server';
import { getPoolStats, dbConnect } from '@/utils/database';

export async function GET() {
  try {
    const stats = getPoolStats();
    
    // Test connection
    let dbOk = false;
    let db;
    try {
      db = await dbConnect();
      const [rows] = await db.execute('SELECT 1');
      dbOk = rows.length > 0;
    } catch (err) {
      console.error('Health check DB error:', err);
    } finally {
      if (db) await db.end();
    }

    return NextResponse.json({
      success: true,
      status: dbOk ? 'healthy' : 'degraded',
      database: {
        connected: dbOk,
        pool: stats || { message: 'Pool not initialized' }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      status: 'unhealthy',
      error: error.message
    }, { status: 500 });
  }
}
