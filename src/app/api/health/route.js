import { NextResponse } from 'next/server';
import { getPoolStats, dbConnect } from '@/utils/database';
import { ensureSchema, isSchemaInitialized } from '@/utils/schema-init';

// Track if we've done initialization on this instance
let serverInitialized = false;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const initSchema = searchParams.get('init') === 'true';
  
  try {
    const stats = getPoolStats();
    
    // Test connection
    let dbOk = false;
    let db;
    let schemaStatus = 'unknown';
    
    try {
      db = await dbConnect();
      const [rows] = await db.execute('SELECT 1');
      dbOk = rows.length > 0;
      
      // Initialize schema on first health check or if explicitly requested
      if (dbOk && (initSchema || !serverInitialized)) {
        try {
          await ensureSchema();
          serverInitialized = true;
          schemaStatus = 'initialized';
        } catch (schemaErr) {
          console.error('Schema init error:', schemaErr);
          schemaStatus = 'error';
        }
      } else {
        schemaStatus = isSchemaInitialized() ? 'initialized' : 'pending';
      }
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
        pool: stats || { message: 'Pool not initialized' },
        schema: schemaStatus
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
