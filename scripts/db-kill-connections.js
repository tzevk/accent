#!/usr/bin/env node

/**
 * Kill Stale Database Connections
 * This will terminate all connections for the configured user
 * Usage: node scripts/db-kill-connections.js [--all]
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function killConnections() {
  const killAll = process.argv.includes('--all');
  
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    console.log('\n🔍 Finding connections to kill...\n');

    // Get all connections for this user, excluding our current connection
    const [connections] = await conn.execute(`
      SELECT ID, TIME, STATE, INFO
      FROM information_schema.PROCESSLIST 
      WHERE USER = ? AND ID != CONNECTION_ID()
      ORDER BY TIME DESC
    `, [process.env.DB_USER]);

    if (connections.length === 0) {
      console.log('✅ No other connections found. You\'re all clean!\n');
      return;
    }

    const toKill = killAll 
      ? connections 
      : connections.filter(c => c.TIME > 30); // Kill connections idle >30s

    if (toKill.length === 0) {
      console.log(`ℹ️  Found ${connections.length} active connections but none are stale (>30s).`);
      console.log('   Use --all flag to kill all connections: node scripts/db-kill-connections.js --all\n');
      return;
    }

    console.log(`🎯 Killing ${toKill.length} connection(s)...\n`);

    let killed = 0;
    let failed = 0;

    for (const c of toKill) {
      try {
        await conn.execute(`KILL ${c.ID}`);
        console.log(`  ✅ Killed connection ID ${c.ID} (${c.TIME}s old, state: ${c.STATE || 'idle'})`);
        killed++;
      } catch (err) {
        console.log(`  ⚠️  Failed to kill connection ID ${c.ID}: ${err.message}`);
        failed++;
      }
    }

    console.log(`\n📊 Summary: Killed ${killed} connections, ${failed} failed\n`);
    console.log('💡 Now restart your Next.js app to reinitialize the connection pool:\n');
    console.log('   npm run dev\n');

  } finally {
    await conn.end();
  }
}

killConnections().catch(err => {
  console.error('❌ Error:', err.message);
  if (err.code === 'ER_TOO_MANY_USER_CONNECTIONS') {
    console.log('\n⚠️  You have too many connections! Contact your DB admin to kill connections or increase max_user_connections.\n');
  }
  process.exit(1);
});
