#!/usr/bin/env node

/**
 * Database Connection Debugger
 * Run this to check current connection status and kill stale connections
 * Usage: node scripts/db-connections-check.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function checkConnections() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    console.log('\n🔍 Checking MySQL connections...\n');

    // Check current user connections
    const [connections] = await conn.execute(`
      SELECT 
        ID,
        USER,
        HOST,
        DB,
        COMMAND,
        TIME,
        STATE,
        INFO
      FROM information_schema.PROCESSLIST 
      WHERE USER = ?
      ORDER BY TIME DESC
    `, [process.env.DB_USER]);

    console.log(`📊 Active connections for user '${process.env.DB_USER}': ${connections.length}\n`);

    if (connections.length > 0) {
      console.log('Connection Details:');
      console.log('─'.repeat(120));
      connections.forEach((c, i) => {
        console.log(`${i + 1}. ID: ${c.ID} | Time: ${c.TIME}s | State: ${c.STATE || 'idle'} | Command: ${c.COMMAND}`);
        if (c.INFO) console.log(`   Query: ${c.INFO.substring(0, 100)}...`);
      });
      console.log('─'.repeat(120));
    }

    // Check max_user_connections limit
    const [limits] = await conn.execute(`SHOW VARIABLES LIKE 'max_user_connections'`);
    console.log(`\n⚙️  max_user_connections limit: ${limits[0]?.Value || 'unlimited'}`);

    // Check for long-running connections (>60s)
    const staleConnections = connections.filter(c => c.TIME > 60);
    if (staleConnections.length > 0) {
      console.log(`\n⚠️  Found ${staleConnections.length} stale connections (>60s old)`);
      console.log('\nTo kill these connections, run:');
      staleConnections.forEach(c => {
        console.log(`  mysql -u root -p -e "KILL ${c.ID};"`);
      });
    }

    // Connection recommendations
    console.log('\n💡 Recommendations:');
    const limit = parseInt(limits[0]?.Value || '0');
    if (limit > 0 && connections.length > limit * 0.8) {
      console.log(`  ⚠️  You're using ${connections.length}/${limit} connections (${Math.round(connections.length/limit*100)}%)`);
      console.log('  Consider reducing DB_CONNECTION_LIMIT in .env.local');
    } else if (limit > 0) {
      console.log(`  ✅ Connection usage is healthy: ${connections.length}/${limit} (${Math.round(connections.length/limit*100)}%)`);
    }

    if (staleConnections.length > 0) {
      console.log('  ⚠️  Kill stale connections using the commands above');
    }

    console.log('  💾 Current app pool config: DB_CONNECTION_LIMIT=' + (process.env.DB_CONNECTION_LIMIT || '5 (default)'));
    console.log('  🔄 Restart your Next.js app to apply latest connection pool settings\n');

  } finally {
    await conn.end();
  }
}

checkConnections().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
